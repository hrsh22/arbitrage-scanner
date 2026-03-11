import "dotenv/config";

import type { VaultInstanceConfig } from "./config/types.js";
import { getEnabledVaultConfigs, resolveVaultIdentity } from "./config/index.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { createNavOracle } from "./services/navOracle.js";
import { ResolutionCheckerService } from "./services/resolutionChecker.js";
import {
  createTradingOrchestrator,
  fetchGammaMarkets,
  type GammaMarket,
  type MarketFetchConfig,
  TradingOrchestratorService,
} from "./services/tradingOrchestrator.js";
import { HedgingChecker } from "./services/hedgingChecker.js";
import { SafeWalletService } from "./services/safeWallet.js";
import { createVaultTradingClient } from "./services/tradingClient.js";
import { positionRepository } from "./repositories/positionRepository.js";
import type { ResolvedVaultIdentity } from "./config/identityResolver.js";
import { Wallet } from "ethers";
import { ClobClient } from "@polymarket/clob-client";
import { POLYGON_CHAIN_ID } from "./constants.js";
import { createPublicClient, type Address } from "viem";
import { polygon } from "viem/chains";
import { createPolygonTransport } from "./rpcTransport.js";

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
const vaultOrchestrators = new Map<number, TradingOrchestratorService>();
const vaultHedgingCheckers = new Map<number, HedgingChecker>();

const resolutionInFlight = new Set<number>();
const scanInFlight = new Set<number>();
const hedgingInFlight = new Set<number>();

function isTradingEnabledConfig(config: VaultInstanceConfig): boolean {
  return config.enabled && config.tradingScanIntervalMin > 0 && config.betSize > 0;
}

async function runStartupProbes(
  config: VaultInstanceConfig,
  identity: ResolvedVaultIdentity,
): Promise<void> {
  const vaultLabel = `Vault ${config.id} (${config.name})`;

  // 1. Identity Format Sanity Probe
  const keyChecks = [
    { key: identity.allocatorNavSignerKey, name: "allocatorNavSignerKey" },
    { key: identity.safeOperatorKey, name: "safeOperatorKey" },
    { key: identity.tradingSignerKey, name: "tradingSignerKey" },
  ];

  for (const { key, name } of keyChecks) {
    if (!isValidPrivateKey(key)) {
      throw new Error(
        `${vaultLabel}: Identity probe failed - ${name} is not a valid private key (must be 0x + 64 hex chars)`,
      );
    }
  }

  const addressChecks: Array<{ addr: string; name: string }> = [
    { addr: identity.tradingFunderAddress, name: "tradingFunderAddress" },
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
    const client = createPublicClient({
      chain: polygon,
      transport: createPolygonTransport(env.POLYGON_RPC_URL || "https://polygon-rpc.com"),
    });

    const owners = (await client.readContract({
      address: config.safeAddress as Address,
      abi: SAFE_ABI,
      functionName: "getOwners",
    })) as string[];

    const operatorWallet = new Wallet(identity.safeOperatorKey);
    const operatorAddress = operatorWallet.address.toLowerCase();
    const normalizedOwners = owners.map((o) => o.toLowerCase());

    if (!normalizedOwners.includes(operatorAddress)) {
      throw new Error(
        `${vaultLabel}: Safe owner probe failed - safeOperatorKey address ${operatorAddress} is not in Safe owners list [${owners.join(", ")}]`,
      );
    }

    logger.debug(`${vaultLabel}: Safe owner probe passed (operator ${operatorAddress} is owner)`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Safe owner probe failed")) {
      throw error;
    }
    throw new Error(
      `${vaultLabel}: Safe owner probe failed - could not query Safe contract: ${(error as Error).message}`,
    );
  }

  // 3. CLOB Identity Probe (warning only)
  if (config.type === "bot") {
    try {
      const wallet = new Wallet(identity.tradingSignerKey);
      const builderConfig = undefined; // Skip builder config for probe - not required

      const bootstrapClient = new ClobClient(
        "https://clob.polymarket.com",
        POLYGON_CHAIN_ID,
        wallet,
        undefined,
        identity.tradingSignatureType,
        identity.tradingFunderAddress,
        undefined,
        true,
        builderConfig,
      );

      const apiCreds = await bootstrapClient.createOrDeriveApiKey();

      if (!apiCreds?.key || !apiCreds?.secret || !apiCreds?.passphrase) {
        logger.warn(
          `${vaultLabel}: CLOB identity probe warning - could not derive API key (may need funds deposited)`,
        );
      } else {
        logger.debug(`${vaultLabel}: CLOB identity probe passed (API key derived successfully)`);
      }
    } catch (error) {
      logger.warn(
        `${vaultLabel}: CLOB identity probe warning - could not derive API key: ${(error as Error).message} (may need funds deposited)`,
      );
    }
  }

  // 4. Single-Safe Mode Invariant Probe (critical for live mode)
  if (config.singleSafeMode === true) {
    logger.debug(`${vaultLabel}: Running single-safe mode validation`);

    const normalizedSafeAddress = identity.safeAddress.toLowerCase();
    const normalizedFunderAddress = identity.tradingFunderAddress.toLowerCase();

    // Invariant 1: safeAddress must equal tradingFunderAddress
    if (normalizedSafeAddress !== normalizedFunderAddress) {
      const reason = `safeAddress (${identity.safeAddress}) does not match tradingFunderAddress (${identity.tradingFunderAddress})`;
      if (env.VAULT_MODE === "live") {
        throw new Error(
          `${vaultLabel}: Single-safe mode probe FAILED - ${reason}. Single-safe mode requires safeAddress == tradingFunderAddress.`,
        );
      } else {
        logger.warn(
          `${vaultLabel}: Single-safe mode probe WARNING - ${reason}. Live mode would fail.`,
        );
      }
    }

    // Invariant 2: signatureType must be 2 (Safe signature type)
    if (identity.tradingSignatureType !== 2) {
      const reason = `signatureType is ${identity.tradingSignatureType}, expected 2 (Safe)`;
      if (env.VAULT_MODE === "live") {
        throw new Error(
          `${vaultLabel}: Single-safe mode probe FAILED - ${reason}. Single-safe mode requires Safe signature type (2).`,
        );
      } else {
        logger.warn(
          `${vaultLabel}: Single-safe mode probe WARNING - ${reason}. Live mode would fail.`,
        );
      }
    }

    logger.debug(`${vaultLabel}: Single-safe mode validation passed`);
  }

  logger.info(`${vaultLabel}: All startup probes passed`);
}

function isVaultLiveExecutionAllowed(config: VaultInstanceConfig): boolean {
  return env.VAULT_MODE === "live" && config.enabled;
}

async function fetchMarketsOnce(): Promise<GammaMarket[]> {
  try {
    const tradingConfigs = getEnabledVaultConfigs().filter(isTradingEnabledConfig);
    if (tradingConfigs.length === 0) {
      return [];
    }

    const sharedMarketFetchConfig: MarketFetchConfig = {
      maxEvents: Math.max(...tradingConfigs.map((config) => config.marketFetchMaxEvents), 1000),
    };
    return await fetchGammaMarkets(sharedMarketFetchConfig);
  } catch (error) {
    logger.error("TradingWorker [Markets]: Failed to fetch markets", {
      error: (error as Error).message,
    });
    return [];
  }
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

async function runTradingScanForVault(
  vaultId: number,
  orchestrator: TradingOrchestratorService,
  markets: GammaMarket[],
): Promise<void> {
  if (isShuttingDown) return;
  if (scanInFlight.has(vaultId)) {
    logger.debug("TradingWorker [TradingScan]: Skipping vault (previous scan still running)", {
      vaultId,
    });
    return;
  }

  scanInFlight.add(vaultId);
  try {
    const config = getEnabledVaultConfigs().find((item) => item.id === vaultId);
    if (!config || !isVaultLiveExecutionAllowed(config)) {
      return;
    }

    const results = await orchestrator.runScanCycle(markets);
    const trades = results.filter((result) => result.success);
    const failures = results.filter((result) => !result.success);

    if (results.length > 0) {
      logger.info("TradingWorker [TradingScan]: Scan complete", {
        vaultId,
        candidates: results.length,
        tradesExecuted: trades.length,
        tradesFailed: failures.length,
      });
    }
  } catch (error) {
    logger.error("TradingWorker [TradingScan]: Scan failed", {
      vaultId,
      error: (error as Error).message,
    });
  } finally {
    scanInFlight.delete(vaultId);
  }
}

async function runHedgingCheckForVault(vaultId: number, checker: HedgingChecker): Promise<void> {
  if (isShuttingDown) return;
  if (hedgingInFlight.has(vaultId)) {
    logger.debug("TradingWorker [Hedging]: Skipping vault (previous check still running)", {
      vaultId,
    });
    return;
  }

  hedgingInFlight.add(vaultId);
  try {
    const config = getEnabledVaultConfigs().find((item) => item.id === vaultId);
    if (!config || !isVaultLiveExecutionAllowed(config)) {
      return;
    }

    const result = await checker.checkAndHedgePositions();
    if (result.checked > 0) {
      logger.info("TradingWorker [Hedging]: Check complete", {
        vaultId,
        checked: result.checked,
        hedged: result.hedged,
        skipped: result.skipped,
        errors: result.errors,
      });
    }
  } catch (error) {
    logger.error("TradingWorker [Hedging]: Check failed", {
      vaultId,
      error: (error as Error).message,
    });
  } finally {
    hedgingInFlight.delete(vaultId);
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

      const safeWallet = new SafeWalletService(
        config.safeAddress,
        identity.safeOperatorKey,
        env.POLYGON_RPC_URL,
      );
      const resolutionChecker = new ResolutionCheckerService(
        positionRepository,
        navOracle,
        safeWallet,
      );
      vaultResolutionCheckers.set(config.id, resolutionChecker);

      if (isTradingEnabledConfig(config)) {
        const tradingClient = createVaultTradingClient(config);
        const orchestrator = createTradingOrchestrator(config, tradingClient, navOracle);
        vaultOrchestrators.set(config.id, orchestrator);

        if (config.hedging.enabled) {
          const checker = new HedgingChecker(config, tradingClient, positionRepository);
          vaultHedgingCheckers.set(config.id, checker);
        }
      }

      initialized++;

      logger.info("TradingWorker: Initialized vault", {
        vaultId: config.id,
        name: config.name,
        type: config.type,
        mode: env.VAULT_MODE,
        hedgingEnabled: isTradingEnabledConfig(config) ? config.hedging.enabled : false,
        intervals: {
          resolutionCheckMin: config.resolutionCheckIntervalMin,
          tradingScanMin: isTradingEnabledConfig(config) ? config.tradingScanIntervalMin : null,
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

    const orchestrator = vaultOrchestrators.get(config.id);
    if (orchestrator) {
      scheduleInterval(
        async () => {
          const markets = await fetchMarketsOnce();
          if (markets.length === 0) return;
          await runTradingScanForVault(config.id, orchestrator, markets);
        },
        config.tradingScanIntervalMin * 60 * 1000,
        `TradingScan [${vaultLabel}]`,
      );
    }

    const hedgingChecker = vaultHedgingCheckers.get(config.id);
    if (hedgingChecker) {
      scheduleInterval(
        () => runHedgingCheckForVault(config.id, hedgingChecker),
        config.tradingScanIntervalMin * 60 * 1000,
        `HedgingCheck [${vaultLabel}]`,
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

  const tradingConfigs = enabledConfigs.filter(isTradingEnabledConfig);
  if (tradingConfigs.length === 0) {
    logger.info("TradingWorker: No enabled trading vaults, skipping initial trading scan");
    return;
  }

  logger.info("TradingWorker: Running initial trading scans...", {
    tradingVaults: tradingConfigs.map((config) => ({ id: config.id, name: config.name })),
  });

  const markets = await fetchMarketsOnce();
  if (markets.length === 0) {
    logger.warn("TradingWorker: No markets fetched, skipping initial scans");
    return;
  }

  const scanPromises = tradingConfigs.map(async (config) => {
    const orchestrator = vaultOrchestrators.get(config.id);
    if (!orchestrator) return;
    await runTradingScanForVault(config.id, orchestrator, markets);
  });
  await Promise.allSettled(scanPromises);

  const hedgingPromises = tradingConfigs.map(async (config) => {
    const checker = vaultHedgingCheckers.get(config.id);
    if (!checker) return;
    await runHedgingCheckForVault(config.id, checker);
  });
  await Promise.allSettled(hedgingPromises);
}

async function start(): Promise<void> {
  logger.info("=== Vault Trading Worker Starting ===");
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
  logger.info("=== Vault Trading Worker Running ===");
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
