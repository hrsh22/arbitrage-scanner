#!/usr/bin/env node
import "dotenv/config";

import { createPublicClient, createWalletClient, erc20Abi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getVaultConfig, resolveVaultIdentity } from "../config/index.js";
import { getNetworkConfigFromEnv, getRpcUrlsForNetwork } from "../config/network.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { createCustomVaultClient } from "../services/customVaultClient.js";

interface CliOptions {
  vaultId: number;
  amount?: bigint;
}

function parseArgs(argv: string[]): CliOptions {
  let vaultId = 1;
  let amount: bigint | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--vault-id") {
      const next = argv[index + 1];
      if (!next) throw new Error("--vault-id requires a value");
      vaultId = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg === "--amount") {
      const next = argv[index + 1];
      if (!next) throw new Error("--amount requires a value");
      amount = BigInt(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { vaultId, amount };
}

async function main(): Promise<void> {
  const { vaultId, amount } = parseArgs(process.argv.slice(2));

  const config = getVaultConfig(vaultId);
  if (!config) {
    throw new Error(`Vault ${vaultId} not found`);
  }

  const identity = resolveVaultIdentity(config);
  const network = getNetworkConfigFromEnv();
  const rpcUrls = getRpcUrlsForNetwork(network.name);
  const transport = createNetworkTransport(rpcUrls);

  const publicClient = createPublicClient({
    chain: network.chain,
    transport,
  });

  const account = privateKeyToAccount(identity.allocatorNavSignerKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: network.chain,
    transport,
  });

  const customVaultClient = createCustomVaultClient(
    config.vaultAddress as `0x${string}`,
    rpcUrls[0],
    network.chain,
  );
  const usdcAddress = network.addresses.usdcE as `0x${string}`;

  const [vaultBalanceBefore, safeBalanceBefore] = await Promise.all([
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [config.vaultAddress as `0x${string}`],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [config.safeAddress as `0x${string}`],
    }),
  ]);

  const sweepAmount = amount ?? vaultBalanceBefore;
  if (sweepAmount <= 0n) {
    console.log("Vault balance already zero; nothing to sweep.");
    return;
  }

  if (sweepAmount > vaultBalanceBefore) {
    throw new Error(
      `Requested sweep amount ${sweepAmount.toString()} exceeds vault balance ${vaultBalanceBefore.toString()}`,
    );
  }

  const result = await customVaultClient.allocateToTradingWallet(walletClient, sweepAmount);
  console.log(JSON.stringify({ sweepAmount: sweepAmount.toString(), result }, null, 2));

  if (!result.success || !result.txHash) {
    throw new Error(result.error ?? "allocateToTradingWallet failed");
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: result.txHash });
  if (receipt.status !== "success") {
    throw new Error(`Sweep transaction reverted: ${result.txHash}`);
  }

  const [vaultBalanceAfter, safeBalanceAfter] = await Promise.all([
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [config.vaultAddress as `0x${string}`],
    }),
    publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [config.safeAddress as `0x${string}`],
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        txHash: result.txHash,
        vaultBalanceBefore: formatUnits(vaultBalanceBefore, 6),
        safeBalanceBefore: formatUnits(safeBalanceBefore, 6),
        vaultBalanceAfter: formatUnits(vaultBalanceAfter, 6),
        safeBalanceAfter: formatUnits(safeBalanceAfter, 6),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
});
