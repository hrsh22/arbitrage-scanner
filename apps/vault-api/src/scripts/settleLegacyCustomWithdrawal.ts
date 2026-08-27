#!/usr/bin/env node
import "dotenv/config";

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getAllVaultConfigs, resolveVaultIdentity } from "../config/index.js";
import { getNetworkConfigFromEnv, getRpcUrlsForNetwork } from "../config/network.js";
import { withdrawalRepository } from "../repositories/withdrawalRepository.js";
import { activityEventRepository } from "../repositories/activityEventRepository.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { createCustomVaultClient } from "../services/customVaultClient.js";
import { SafeWalletService } from "../services/safeWallet.js";

interface CliOptions {
  requestId: string;
  skipAllocation: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let requestId: string | undefined;
  let skipAllocation = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    }

    if (arg === "--request-id") {
      const next = argv[i + 1];
      if (!next) throw new Error("--request-id requires a value");
      requestId = next;
      i += 1;
      continue;
    }

    if (arg === "--skip-allocation") {
      skipAllocation = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!requestId) {
    throw new Error("--request-id is required");
  }

  return { requestId, skipAllocation };
}

function printUsage(): void {
  console.log(`Usage:
  pnpm exec tsx src/scripts/settleLegacyCustomWithdrawal.ts --request-id <request-id> [--skip-allocation]

Options:
  --request-id <id>   Legacy withdrawal request ID to settle
  --skip-allocation   Skip vault -> trading safe top-up (only if exact amount is already on safe)
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const request = await withdrawalRepository.getRequestById(options.requestId);

  if (!request) {
    throw new Error(`Withdrawal request ${options.requestId} not found`);
  }

  if (request.status === "completed") {
    console.log(`Request ${request.requestId} is already completed.`);
    return;
  }

  if (request.status !== "ready") {
    throw new Error(
      `Request ${request.requestId} must be ready. Current status: ${request.status}`,
    );
  }

  const vaultConfig = getAllVaultConfigs().find(
    (config) => config.vaultAddress.toLowerCase() === request.vaultAddress.toLowerCase(),
  );
  if (!vaultConfig) {
    throw new Error(`No vault config found for ${request.vaultAddress}`);
  }

  if (vaultConfig.type !== "custom") {
    throw new Error(`Request ${request.requestId} is not for a custom vault`);
  }

  const identity = resolveVaultIdentity(vaultConfig);
  const networkConfig = getNetworkConfigFromEnv();
  const rpcUrls = getRpcUrlsForNetwork(networkConfig.name);
  const amountUnits = parseUnits(request.assetsEstimated, 6);
  const amountRaw = amountUnits.toString();
  const vaultAddress = getAddress(vaultConfig.vaultAddress);
  const safeAddress = getAddress(vaultConfig.safeAddress);
  const userAddress = getAddress(request.userAddress);
  const usdcAddress = getAddress(networkConfig.addresses.collateral);

  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: createNetworkTransport(rpcUrls),
  });

  const [vaultUsdcBefore, safeUsdcBefore] = await Promise.all([
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [vaultAddress],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [safeAddress],
    }),
  ]);

  console.log("=== Settle Legacy Custom Withdrawal ===");
  console.log(`Request ID:      ${request.requestId}`);
  console.log(`User:            ${userAddress}`);
  console.log(`Vault:           ${vaultAddress}`);
  console.log(`Trading Safe:    ${safeAddress}`);
  console.log(`Shares:          ${request.shares}`);
  console.log(`Locked Amount:   ${request.assetsEstimated} ${networkConfig.addresses.collateralSymbol}`);
  console.log(
    `Vault balance:   ${formatUnits(vaultUsdcBefore, networkConfig.addresses.collateralDecimals)} ${networkConfig.addresses.collateralSymbol}`,
  );
  console.log(
    `Safe balance:    ${formatUnits(safeUsdcBefore, networkConfig.addresses.collateralDecimals)} ${networkConfig.addresses.collateralSymbol}`,
  );

  let allocationTxHash: string | undefined;
  if (!options.skipAllocation) {
    if (vaultUsdcBefore < amountUnits) {
      throw new Error(
        `Vault balance ${formatUnits(vaultUsdcBefore, networkConfig.addresses.collateralDecimals)} ${networkConfig.addresses.collateralSymbol} is below locked amount ${request.assetsEstimated}`,
      );
    }

    const adminAccount = privateKeyToAccount(identity.allocatorNavSignerKey as `0x${string}`);
    const adminWalletClient = createWalletClient({
      account: adminAccount,
      chain: networkConfig.chain,
      transport: createNetworkTransport(rpcUrls),
    });

    const customVaultClient = createCustomVaultClient(
      vaultAddress,
      rpcUrls[0],
      networkConfig.chain,
    );
    const allocationResult = await customVaultClient.allocateToTradingWallet(
      adminWalletClient,
      amountUnits,
    );
    if (!allocationResult.success || !allocationResult.txHash) {
      throw new Error(
        `Vault->safe allocation failed: ${allocationResult.error ?? "unknown error"}`,
      );
    }

    const allocationReceipt = await publicClient.waitForTransactionReceipt({
      hash: allocationResult.txHash as `0x${string}`,
    });
    if (allocationReceipt.status !== "success") {
      throw new Error(`Allocation transaction reverted: ${allocationResult.txHash}`);
    }

    allocationTxHash = allocationResult.txHash;
    console.log(`Allocated to safe: ${allocationTxHash}`);
  }

  const safeWallet = new SafeWalletService(
    safeAddress,
    identity.safeOperatorKey,
    undefined,
    networkConfig.chain,
  );
  await safeWallet.initialize();
  const transferResult = await safeWallet.transferToken(usdcAddress, userAddress, amountRaw);
  if (!transferResult.success || !transferResult.txHash) {
    throw new Error(`Safe payout failed: ${transferResult.error ?? "unknown error"}`);
  }

  const completion = await withdrawalRepository.markCompletedIdempotent(
    request.requestId,
    transferResult.txHash,
  );
  if (!completion.success) {
    throw new Error(`Failed to mark request completed: ${completion.error ?? "unknown error"}`);
  }

  await activityEventRepository.appendUserVaultActivityEvent({
    vaultId: vaultConfig.id,
    vaultAddress: request.vaultAddress,
    userAddress: request.userAddress,
    eventType: "claim_completed",
    title: "Claim completed",
    detail: "Legacy withdrawal settled manually from the trading safe.",
    requestId: request.requestId,
    txHash: transferResult.txHash,
    status: completion.request?.status ?? "completed",
    assetAmount: request.assetsEstimated,
    shareAmount: request.shares,
    occurredAt: completion.request?.completedAt ?? new Date(),
    metadata: allocationTxHash ? { allocationTxHash } : undefined,
  });

  console.log(`User payout tx:   ${transferResult.txHash}`);
  console.log(`Request status:   ${completion.request?.status ?? "completed"}`);
  console.log("Legacy withdrawal settled successfully.");
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
});
