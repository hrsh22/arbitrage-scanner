#!/usr/bin/env node
import "dotenv/config";

import { createPublicClient, createWalletClient, erc20Abi, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { VaultInstanceConfig } from "../config/types.js";
import { VAULT_CONFIGS } from "../config/vaults/index.js";
import { getNetworkConfigFromEnv, getRpcUrlsForNetwork } from "../config/network.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { SafeWalletService } from "../services/safeWallet.js";

const MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

interface CliOptions {
  vaultId?: number;
  amount: string;
}

function parseArgs(argv: string[]): CliOptions {
  let vaultId: number | undefined;
  let amount = MAX_UINT256;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--vault-id") {
      const next = argv[i + 1];
      if (!next) throw new Error("--vault-id requires a value");
      vaultId = Number(next);
      if (!Number.isInteger(vaultId) || vaultId <= 0) {
        throw new Error(`Invalid --vault-id value: ${next}`);
      }
      i += 1;
      continue;
    }

    if (arg === "--amount") {
      const next = argv[i + 1];
      if (!next) throw new Error("--amount requires a value");
      if (!/^\d+$/.test(next)) {
        throw new Error(`--amount must be raw integer token units. Received: ${next}`);
      }
      amount = next;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { vaultId, amount };
}

function printUsage(): void {
  console.log(`Usage:
  pnpm exec tsx src/scripts/approveTradingSafeRecall.ts [--vault-id 1] [--amount 500000]

Options:
  --vault-id <id>   Vault config ID to use (defaults to first enabled vault)
  --amount <raw>    Raw USDC units to approve. Defaults to unlimited allowance.

Examples:
  pnpm exec tsx src/scripts/approveTradingSafeRecall.ts
  pnpm exec tsx src/scripts/approveTradingSafeRecall.ts --amount 500000
`);
}

function getTargetVaultConfig(vaultId?: number): VaultInstanceConfig {
  if (vaultId) {
    const explicit = VAULT_CONFIGS.find((config) => config.id === vaultId);
    if (!explicit) {
      throw new Error(`Vault config ${vaultId} not found for current network`);
    }
    return explicit;
  }

  const enabled = VAULT_CONFIGS.find((config) => config.enabled);
  if (enabled) return enabled;

  if (VAULT_CONFIGS.length === 0) {
    throw new Error("No vault configs loaded for current network");
  }

  return VAULT_CONFIGS[0]!;
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const networkConfig = getNetworkConfigFromEnv();
  const vaultConfig = getTargetVaultConfig(options.vaultId);

  const vaultAddress = getAddress(vaultConfig.vaultAddress);
  const tradingWalletAddress = getAddress(vaultConfig.safeAddress);
  const usdcAddress = getAddress(networkConfig.addresses.collateral);
  const safeOperatorKey = getRequiredEnv(vaultConfig.safeOperatorKeyEnv);
  const rpcUrls = getRpcUrlsForNetwork(networkConfig.name);

  console.log("=== Trading Wallet Recall Approval ===");
  console.log(`Network:        ${networkConfig.name} (${networkConfig.chainId})`);
  console.log(`Vault ID:       ${vaultConfig.id}`);
  console.log(`Vault:          ${vaultAddress}`);
  console.log(`Trading Wallet: ${tradingWalletAddress}`);
  console.log(`${networkConfig.addresses.collateralSymbol}:           ${usdcAddress}`);
  console.log(`Amount:         ${options.amount === MAX_UINT256 ? "unlimited" : options.amount}`);
  console.log(`RPCs:           ${rpcUrls.join(", ")}`);
  console.log("");

  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: createNetworkTransport(rpcUrls),
  });

  const code = await publicClient.getCode({ address: tradingWalletAddress });
  const isContractTradingWallet = Boolean(code && code !== "0x");

  const allowanceBefore = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [tradingWalletAddress, vaultAddress],
  });
  console.log(`Allowance before: ${allowanceBefore.toString()}`);

  if (allowanceBefore >= BigInt(options.amount)) {
    console.log("Allowance already sufficient; no transaction submitted.");
    return;
  }

  let txHash: string;

  if (isContractTradingWallet) {
    console.log("Detected deployed Safe/contract trading wallet; using Safe transaction flow.");
    const safe = new SafeWalletService(
      tradingWalletAddress,
      safeOperatorKey,
      undefined,
      networkConfig.chain,
    );
    await safe.initialize();

    const result = await safe.approveToken(usdcAddress, vaultAddress, options.amount);
    if (!result.success) {
      throw new Error(`Safe approval failed: ${result.error ?? "unknown error"}`);
    }
    txHash = result.txHash ?? "unknown";
  } else {
    console.log("Detected EOA trading wallet; using direct wallet approval flow.");
    const account = privateKeyToAccount(safeOperatorKey as Hex);
    if (account.address.toLowerCase() !== tradingWalletAddress.toLowerCase()) {
      throw new Error(
        `AMOY_VAULT_1_SAFE_OPERATOR_KEY resolves to ${account.address}, but trading wallet is ${tradingWalletAddress}. Set the env key to the private key for the trading wallet EOA.`,
      );
    }

    const walletClient = createWalletClient({
      account,
      chain: networkConfig.chain,
      transport: createNetworkTransport(rpcUrls),
    });

    txHash = await walletClient.writeContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [vaultAddress, BigInt(options.amount)],
      account,
      chain: networkConfig.chain,
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });
  if (receipt.status !== "success") {
    throw new Error(`Approval transaction reverted: ${txHash}`);
  }

  const allowanceAfter = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [tradingWalletAddress, vaultAddress],
  });

  console.log(`Approval tx hash:${txHash}`);
  console.log(`Allowance after: ${allowanceAfter.toString()}`);

  if (allowanceAfter < BigInt(options.amount)) {
    throw new Error(
      `Allowance still below requested amount after tx. Expected at least ${options.amount}, got ${allowanceAfter.toString()}`,
    );
  }

  console.log("Approval complete.");
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
});
