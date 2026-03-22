import "dotenv/config";

import type { VaultInstanceConfig } from "./config/types.js";
import { getEnabledVaultConfigs, resolveVaultIdentity } from "./config/index.js";
import { env, isTradingEnabled } from "./env.js";
import { logger } from "./logger.js";
import { createNavOracle } from "./services/navOracle.js";
import { ResolutionCheckerService } from "./services/resolutionChecker.js";
import { SafeWalletService } from "./services/safeWallet.js";
import { positionRepository } from "./repositories/positionRepository.js";
import type { ResolvedVaultIdentity } from "./config/identityResolver.js";
import { Wallet } from "ethers";
import { createPublicClient, type Address } from "viem";
import { createNetworkTransport } from "./rpcTransport.js";
import { getNetworkConfigFromEnv } from "./config/network.js";

const SAFE_ABI = [
  {
    inputs: [],
    name: "getOwners",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function isValidPrivateKey(key: string): boolean {
  if (!key.startsWith("0x")) return false;
  if (key.length !== 66) return false;
  const hexPart = key.slice(2);
  return /^[0-9a-fA-F]+$/.test(hexPart);
}

function isValidAddress(addr: string): boolean {
  if (!addr.startsWith("0x")) return false;
  if (addr.length !== 42) return false;
  const hexPart = addr.slice(2);
  return /^[0-9a-fA-F]+$/.test(hexPart);
}

let isShuttingDown = false;
const intervals: NodeJS.Timeout[] = [];

const vaultResolutionCheckers = new Map<number, ResolutionCheckerService>();

const resolutionInFlight = new Set<number>();

async function runStartupProbes(
  config: VaultInstanceConfig,
  identity: ResolvedVaultIdentity,
): Promise<void> {
  const vaultLabel = `Vault ${config.id} (${config.name})`;

  // 1. Identity Format Sanity Probe
  const keyChecks = [
    { key: identity.allocatorNavSignerKey, name: "allocatorNavSignerKey" },
    { key: identity.safeOperatorKey, name: "safeOperatorKey" },
  ];

  for (const { key, name } of keyChecks) {
    if (!isValidPrivateKey(key)) {
      throw new Error(
        `${vaultLabel}: Identity probe failed - ${name} is not a valid private key (must be 0x + 64 hex chars)`,
      );
    }
  }

  const addressChecks: Array<{ addr: string; name: string }> = [
    { addr: identity.safeAddress, name: "safeAddress" },
    { addr: identity.vaultAddress, name: "vaultAddress" },
  ];

  for (const { addr, name } of addressChecks) {
    if (!isValidAddress(addr)) {
      throw new Error(
        `${vaultLabel}: Identity probe failed - ${name} is not a valid address (must be 0x + 40 hex chars)`,
      );
    }
  }

  logger.debug(`${vaultLabel}: Identity format probes passed`);

  // 2. Safe Owner Probe
  try {
    const networkConfig = getNetworkConfigFromEnv();
    const client = createPublicClient({
      chain: networkConfig.chain,
      transport: createNetworkTransport(),
    });

    const safeContractAddress = config.safeAddress as Address;
    const code = await client.getCode({ address: safeContractAddress });
    const operatorWallet = new Wallet(identity.safeOperatorKey);
    const operatorAddress = operatorWallet.address.toLowerCase();
    if (!code || code === "0x") {
      if (operatorAddress !== safeContractAddress.toLowerCase()) {
        throw new Error(
          `${vaultLabel}: EOA wallet probe failed - safeOperatorKey address ${operatorAddress} does not match trading wallet ${safeContractAddress}`,
        );
      }

      logger.debug(`${vaultLabel}: EOA wallet probe passed (${operatorAddress})`);
    } else {
      const owners = (await client.readContract({
        address: safeContractAddress,
        abi: SAFE_ABI,
        functionName: "getOwners",
      })) as string[];
      const normalizedOwners = owners.map((o) => o.toLowerCase());

      if (!normalizedOwners.includes(operatorAddress)) {
        throw new Error(
          `${vaultLabel}: Safe owner probe failed - safeOperatorKey address ${operatorAddress} is not in Safe owners list [${owners.join(", ")}]`,
        );
      }

      logger.debug(`${vaultLabel}: Safe owner probe passed (operator ${operatorAddress} is owner)`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Safe owner probe failed") ||
        error.message.includes("EOA wallet probe failed"))
    ) {
      throw error;
    }
    throw new Error(`${vaultLabel}: Trading wallet probe failed - ${(error as Error).message}`);
  }
  logger.info(`${vaultLabel}: All startup probes passed`);
}

function isVaultLiveExecutionAllowed(config: VaultInstanceConfig): boolean {
  return env.VAULT_MODE === "live" && config.enabled;
}

function scheduleInterval(fn: () => Promise<void>, intervalMs: number, name: string): void {
  const timer = setInterval(() => {
    fn().catch((error) =>
      logger.error(`TradingWorker: Unhandled error in ${name}`, {
        error: (error as Error).message,
      }),
    );
  }, intervalMs);

  intervals.push(timer);
  logger.info(`TradingWorker: Scheduled ${name} every ${intervalMs / 1000}s`);
}

async function runResolutionCheckForVault(vaultId: number): Promise<void> {
  if (isShuttingDown) return;
  if (resolutionInFlight.has(vaultId)) {
    logger.debug("TradingWorker [Resolution]: Skipping vault (previous check still running)", {
      vaultId,
    });
    return;
  }

  const checker = vaultResolutionCheckers.get(vaultId);
  if (!checker) return;

  const config = getEnabledVaultConfigs().find((item) => item.id === vaultId);
  if (!config || !isVaultLiveExecutionAllowed(config)) {
    return;
  }

  resolutionInFlight.add(vaultId);
  try {
    const result = await checker.checkResolutions();
    if (result.checked > 0) {
      logger.info("TradingWorker [Resolution]: Check completed", {
        vaultId,
        checked: result.checked,
        resolved: result.resolved,
        won: result.won,
        lost: result.lost,
        redeemed: result.redeemed,
        errors: result.errors.length,
      });
    }
  } catch (error) {
    logger.error("TradingWorker [Resolution]: Check failed", {
      vaultId,
      error: (error as Error).message,
    });
  } finally {
    resolutionInFlight.delete(vaultId);
  }
}

async function initializeVaults(): Promise<{
  initialized: number;
  failed: Array<{ id: number; name: string }>;
}> {
  const enabledConfigs = getEnabledVaultConfigs();
  const failed: Array<{ id: number; name: string }> = [];
  let initialized = 0;

  for (const config of enabledConfigs) {
    try {
      // Resolve vault identity (keys/addresses) from environment
      const identity = resolveVaultIdentity(config);

      // Run startup probes to validate identity and Safe ownership
      await runStartupProbes(config, identity);
      const navOracle = createNavOracle(config, identity);

      const safeWallet = new SafeWalletService(config.safeAddress, identity.safeOperatorKey);
      const resolutionChecker = new ResolutionCheckerService(
        positionRepository,
        navOracle,
        safeWallet,
      );
      vaultResolutionCheckers.set(config.id, resolutionChecker);
      initialized++;

      logger.info("TradingWorker: Initialized vault", {
        vaultId: config.id,
        name: config.name,
        type: config.type,
        mode: env.VAULT_MODE,
        intervals: {
          resolutionCheckMin: config.resolutionCheckIntervalMin,
        },
      });
    } catch (error) {
      logger.error("TradingWorker: Failed to initialize vault", {
        vaultId: config.id,
        name: config.name,
        error: (error as Error).message,
      });
      failed.push({ id: config.id, name: config.name });
    }
  }

  return { initialized, failed };
}

function scheduleVaultCrons(): void {
  const enabledConfigs = getEnabledVaultConfigs();

  for (const config of enabledConfigs) {
    const vaultLabel = `vault=${config.id}/${config.name}`;

    if (vaultResolutionCheckers.has(config.id)) {
      scheduleInterval(
        () => runResolutionCheckForVault(config.id),
        config.resolutionCheckIntervalMin * 60 * 1000,
        `Resolution [${vaultLabel}]`,
      );
    }
  }
}

async function runInitialTasks(): Promise<void> {
  const enabledConfigs = getEnabledVaultConfigs();

  const initialResolutionPromises = enabledConfigs.map((config) =>
    runResolutionCheckForVault(config.id),
  );
  await Promise.allSettled(initialResolutionPromises);
}

async function start(): Promise<void> {
  logger.info("=== Vault Resolution Worker Starting ===");
  logger.info(
    `TradingWorker: PID ${process.pid}, mode: ${env.VAULT_MODE}, network: ${env.VAULT_NETWORK}`,
  );

  if (!isTradingEnabled()) {
    logger.info("Vault resolution worker disabled on current network - exiting");
    process.exit(0);
  }
  logger.info("=== Vault Resolution Worker Starting ===");
  logger.info(`TradingWorker: PID ${process.pid}, mode: ${env.VAULT_MODE}`);

  const enabledConfigs = getEnabledVaultConfigs();
  logger.info("TradingWorker: Enabled vaults", {
    count: enabledConfigs.length,
    vaults: enabledConfigs.map((config) => ({
      id: config.id,
      name: config.name,
      type: config.type,
    })),
  });

  const initialization = await initializeVaults();
  if (initialization.failed.length > 0) {
    throw new Error(
      `TradingWorker startup aborted: failed to initialize vaults ${initialization.failed
        .map((vault) => `${vault.id}:${vault.name}`)
        .join(", ")}`,
    );
  }

  logger.info("TradingWorker: Running initial tasks...");
  await runInitialTasks();

  scheduleVaultCrons();
  logger.info("=== Vault Resolution Worker Running ===");
}

function shutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("TradingWorker: Shutting down...");

  for (const timer of intervals) {
    clearInterval(timer);
  }
  intervals.length = 0;

  logger.info("TradingWorker: Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((error) => {
  logger.error("TradingWorker: Failed to start", { error: (error as Error).message });
  process.exit(1);
});
