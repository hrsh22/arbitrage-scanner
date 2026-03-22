import "dotenv/config";

import type { VaultInstanceConfig } from "./config/types.js";
import { getEnabledVaultConfigs, resolveVaultIdentity } from "./config/index.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { runStartupValidationOrExit } from "./startupValidation.js";
import { createNavOracle, NavOracleService } from "./services/navOracle.js";
import { LiquidityManager, createLiquidityManager } from "./services/liquidityManager.js";
import { pendingTxRegistry } from "./services/pendingTxRegistry.js";

// Run startup validation early - this will exit if validation fails
await runStartupValidationOrExit();

let isShuttingDown = false;
const intervals: NodeJS.Timeout[] = [];

const vaultNavOracles = new Map<number, NavOracleService>();
const vaultLiquidityManagers = new Map<number, LiquidityManager>();

const navInFlight = new Map<number, Promise<boolean>>();
const reconciliationInFlight = new Set<number>();

function isVaultLiveExecutionAllowed(config: VaultInstanceConfig): boolean {
  return env.VAULT_MODE === "live" && config.enabled;
}

function shouldSchedulePeriodicNavRefresh(config: VaultInstanceConfig): boolean {
  return config.type === "custom";
}

function scheduleInterval(fn: () => Promise<void>, intervalMs: number, name: string): void {
  const timer = setInterval(() => {
    fn().catch((error) =>
      logger.error(`CapitalWorker: Unhandled error in ${name}`, {
        error: (error as Error).message,
      }),
    );
  }, intervalMs);

  intervals.push(timer);
  logger.info(`CapitalWorker: Scheduled ${name} every ${intervalMs / 1000}s`);
}

async function runNavRefreshForVault(vaultId: number): Promise<boolean> {
  if (isShuttingDown) return false;
  const existingRefresh = navInFlight.get(vaultId);
  if (existingRefresh) {
    logger.debug("CapitalWorker [NAV]: Skipping vault (previous refresh still running)", {
      vaultId,
    });
    return existingRefresh;
  }

  const oracle = vaultNavOracles.get(vaultId);
  if (!oracle) return false;

  const config = getEnabledVaultConfigs().find((item) => item.id === vaultId);
  if (!config || !isVaultLiveExecutionAllowed(config)) {
    return false;
  }

  let refreshPromise!: Promise<boolean>;
  refreshPromise = (async () => {
    try {
      const result = await oracle.calculateAndPushNav();
      logger.info("CapitalWorker [NAV]: Refresh completed", {
        vaultId,
        updatedOnChain: result.updatedOnChain,
        newValue: result.newValue,
        txHash: result.txHash,
      });
      return true;
    } catch (error) {
      const err = error as Error & { cause?: unknown };
      logger.error("CapitalWorker [NAV]: Refresh failed", {
        vaultId,
        error: err.message,
        stack: err.stack,
        cause:
          err.cause instanceof Error
            ? err.cause.message
            : err.cause !== undefined
              ? String(err.cause)
              : undefined,
      });
      return false;
    } finally {
      if (navInFlight.get(vaultId) === refreshPromise) {
        navInFlight.delete(vaultId);
      }
    }
  })();

  navInFlight.set(vaultId, refreshPromise);
  return refreshPromise;
}

async function runReconciliationForVault(vaultId: number): Promise<void> {
  if (isShuttingDown) return;

  // Check global pause modes
  if (env.LIQUIDITY_EMERGENCY_STOP) {
    logger.error(
      "CapitalWorker [Liquidity]: EMERGENCY STOP active - skipping all reconciliations",
      {
        vaultId,
      },
    );
    return;
  }

  if (env.LIQUIDITY_PAUSE) {
    logger.warn("CapitalWorker [Liquidity]: PAUSE mode active - skipping reconciliation", {
      vaultId,
    });
    return;
  }

  if (reconciliationInFlight.has(vaultId)) {
    logger.debug(
      "CapitalWorker [Liquidity]: Skipping vault (previous reconciliation still running)",
      {
        vaultId,
      },
    );
    return;
  }

  const manager = vaultLiquidityManagers.get(vaultId);
  if (!manager) {
    logger.debug("CapitalWorker [Liquidity]: Skipping vault (manager not initialized)", {
      vaultId,
    });
    return;
  }

  const config = getEnabledVaultConfigs().find((item) => item.id === vaultId);
  if (!config) {
    logger.debug("CapitalWorker [Liquidity]: Skipping vault (config missing)", { vaultId });
    return;
  }
  if (!isVaultLiveExecutionAllowed(config)) {
    logger.debug("CapitalWorker [Liquidity]: Skipping vault (live execution not allowed)", {
      vaultId,
      globalMode: env.VAULT_MODE,
      vaultEnabled: config.enabled,
    });
    return;
  }

  const oracle = vaultNavOracles.get(vaultId);
  let flatBookLifecycleDecision:
    | Awaited<ReturnType<(typeof manager)["evaluateFlatBookLifecycle"]>>
    | undefined;

  const isFlatBookLifecycleVault = true;

  if (isFlatBookLifecycleVault) {
    try {
      const lifecycleDecision = await manager.evaluateFlatBookLifecycle();
      flatBookLifecycleDecision = lifecycleDecision;

      if (lifecycleDecision.riskState === "unknown") {
        logger.warn(
          "CapitalWorker [Lifecycle]: Flatness telemetry unavailable, skipping transitions",
          {
            vaultId,
            batchStatus: lifecycleDecision.batchStatus,
            reason: lifecycleDecision.reason,
            blockingConditions: lifecycleDecision.flatnessCheck?.blockingConditions,
          },
        );
        return;
      }

      if (lifecycleDecision.riskState === "risk_on") {
        if (lifecycleDecision.action === "close_book") {
          const closeResult = await manager.closeBook();
          if (!closeResult.success) {
            logger.error("CapitalWorker [Lifecycle]: Failed to close book on risk-on signal", {
              vaultId,
              error: closeResult.error,
              txHash: closeResult.txHash,
            });
          }
        }
        return;
      }

      if (lifecycleDecision.action === "process_queue") {
        const navReady = await runNavRefreshForVault(vaultId);
        if (!navReady) {
          logger.warn(
            "CapitalWorker [Lifecycle]: Skipping queue processing because NAV refresh failed",
            { vaultId },
          );
          return;
        }
        const processResult = await manager.processQueue();
        if (!processResult.success) {
          logger.error("CapitalWorker [Lifecycle]: Queue processing failed", {
            vaultId,
            error: processResult.error,
            txHash: processResult.txHash,
          });
        }
        return;
      }

      if (lifecycleDecision.action === "reopen_idle_cycle") {
        const navReady = await runNavRefreshForVault(vaultId);
        if (!navReady) {
          logger.warn(
            "CapitalWorker [Lifecycle]: Skipping idle reopen because NAV refresh failed",
            { vaultId },
          );
          return;
        }
        const reopenResult = await manager.reopenIdleCycle();
        if (!reopenResult.success) {
          logger.error("CapitalWorker [Lifecycle]: Idle cycle reopen failed", {
            vaultId,
            error: reopenResult.error,
            txHash: reopenResult.txHash,
          });
        }
        return;
      }
    } catch (error) {
      logger.warn("CapitalWorker [Lifecycle]: Flat-book lifecycle evaluation failed", {
        vaultId,
        error: (error as Error).message,
      });
      return;
    }
  }

  if (oracle) {
    try {
      let health = await oracle.getNavHealth();
      if (health.stale) {
        if (
          flatBookLifecycleDecision?.riskState === "flat" &&
          flatBookLifecycleDecision.action === "none"
        ) {
          logger.info(
            "CapitalWorker [Liquidity]: NAV is stale for flat/open vault; continuing with idle capital reconciliation",
            {
              vaultId,
              secondsSinceUpdate: health.secondsSinceUpdate,
              thresholdSeconds: health.thresholdSeconds,
            },
          );
        } else {
          logger.warn(
            "CapitalWorker [Liquidity]: NAV stale, attempting refresh before reconciliation",
            {
              vaultId,
              secondsSinceUpdate: health.secondsSinceUpdate,
              thresholdSeconds: health.thresholdSeconds,
            },
          );

          await runNavRefreshForVault(vaultId);
          health = await oracle.getNavHealth();

          if (health.stale) {
            logger.warn(
              "CapitalWorker [Liquidity]: Skipping reconciliation while NAV remains stale",
              {
                vaultId,
                secondsSinceUpdate: health.secondsSinceUpdate,
                thresholdSeconds: health.thresholdSeconds,
              },
            );
            return;
          }
        }
      }
    } catch (error) {
      logger.warn(
        "CapitalWorker [Liquidity]: Unable to verify NAV health, skipping reconciliation",
        {
          vaultId,
          error: (error as Error).message,
        },
      );
      return;
    }
  }

  reconciliationInFlight.add(vaultId);
  try {
    const result = await manager.runReconciliation();

    if (result.action !== "none") {
      logger.info("CapitalWorker [Liquidity]: Reconciliation action taken", {
        vaultId,
        action: result.action,
        amount: result.amount,
        details: result.details,
        vaultBalance: result.vaultBalance,
        safeBalance: result.safeBalance,
        pendingWithdrawals: result.pendingWithdrawals,
      });
    } else {
      // Check if dry-run mode is active and log appropriately
      if (env.LIQUIDITY_DRY_RUN) {
        logger.info("CapitalWorker [Liquidity]: DRY RUN mode - no action executed", {
          vaultId,
          vaultBalance: result.vaultBalance,
          safeBalance: result.safeBalance,
          details: result.details,
        });
      } else {
        logger.debug("CapitalWorker [Liquidity]: No action needed", {
          vaultId,
          vaultBalance: result.vaultBalance,
          safeBalance: result.safeBalance,
          details: result.details,
        });
      }
    }
  } catch (error) {
    logger.error("CapitalWorker [Liquidity]: Reconciliation failed", {
      vaultId,
      error: (error as Error).message,
    });
  } finally {
    reconciliationInFlight.delete(vaultId);
  }
}

function initializeVaults(): { initialized: number; failed: Array<{ id: number; name: string }> } {
  const enabledConfigs = getEnabledVaultConfigs();
  const failed: Array<{ id: number; name: string }> = [];
  let initialized = 0;

  for (const config of enabledConfigs) {
    try {
      // Resolve vault identity (keys/addresses) from environment
      const identity = resolveVaultIdentity(config);

      const navOracle = createNavOracle(config, identity, config.id);
      vaultNavOracles.set(config.id, navOracle);

      const liquidityManager = createLiquidityManager(config);
      vaultLiquidityManagers.set(config.id, liquidityManager);

      initialized++;

      logger.info("CapitalWorker: Initialized vault", {
        vaultId: config.id,
        name: config.name,
        type: config.type,
        mode: env.VAULT_MODE,
        intervals: {
          navRefreshMin: config.navRefreshIntervalMin,
          reconciliationMin: config.reconciliationIntervalMin,
        },
      });
    } catch (error) {
      logger.error("CapitalWorker: Failed to initialize vault", {
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

    if (vaultNavOracles.has(config.id) && shouldSchedulePeriodicNavRefresh(config)) {
      scheduleInterval(
        async () => {
          await runNavRefreshForVault(config.id);
        },
        config.navRefreshIntervalMin * 60 * 1000,
        `NAV [${vaultLabel}]`,
      );
    }

    if (vaultLiquidityManagers.has(config.id)) {
      scheduleInterval(
        () => runReconciliationForVault(config.id),
        config.reconciliationIntervalMin * 60 * 1000,
        `Reconciliation [${vaultLabel}]`,
      );
    }
  }
}

async function runInitialTasks(): Promise<void> {
  const enabledConfigs = getEnabledVaultConfigs();

  const initialPromises = enabledConfigs.map(async (config) => {
    const shouldRunInitialNavRefresh = false;

    if (shouldRunInitialNavRefresh) {
      await runNavRefreshForVault(config.id);
    }
    await runReconciliationForVault(config.id);
  });

  await Promise.allSettled(initialPromises);
}

async function start(): Promise<void> {
  logger.info("=== Vault Capital Worker Starting ===");
  logger.info(
    `CapitalWorker: PID ${process.pid}, mode: ${env.VAULT_MODE}, network: ${env.VAULT_NETWORK}`,
  );

  // Amoy enforcement notice
  if (env.VAULT_NETWORK === "amoy") {
    logger.info("Amoy vault: trading disabled, live mode enforced");
  }
  logger.info("=== Vault Capital Worker Starting ===");
  logger.info(`CapitalWorker: PID ${process.pid}, mode: ${env.VAULT_MODE}`);

  // Log circuit breaker status
  logger.info("CapitalWorker: Circuit breaker status", {
    emergencyStop: env.LIQUIDITY_EMERGENCY_STOP,
    pause: env.LIQUIDITY_PAUSE,
    dryRun: env.LIQUIDITY_DRY_RUN,
  });

  if (env.LIQUIDITY_EMERGENCY_STOP) {
    logger.error("CapitalWorker: WARNING - Emergency stop is active!");
  }
  if (env.LIQUIDITY_PAUSE) {
    logger.warn("CapitalWorker: WARNING - Liquidity manager is paused");
  }
  if (env.LIQUIDITY_DRY_RUN) {
    logger.warn("CapitalWorker: WARNING - Dry-run mode active (no transactions will be executed)");
  }

  const enabledConfigs = getEnabledVaultConfigs();
  logger.info("CapitalWorker: Enabled vaults", {
    count: enabledConfigs.length,
    vaults: enabledConfigs.map((config) => ({
      id: config.id,
      name: config.name,
      type: config.type,
    })),
  });

  const initialization = initializeVaults();
  if (initialization.failed.length > 0) {
    throw new Error(
      `CapitalWorker startup aborted: failed to initialize vaults ${initialization.failed
        .map((vault) => `${vault.id}:${vault.name}`)
        .join(", ")}`,
    );
  }

  logger.info("CapitalWorker: Running initial tasks...");
  await runInitialTasks();

  scheduleVaultCrons();
  logger.info("=== Vault Capital Worker Running ===");
}

function shutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("CapitalWorker: Shutting down...");

  // Stop the pending transaction registry cleanup interval
  pendingTxRegistry.stop();

  for (const timer of intervals) {
    clearInterval(timer);
  }
  intervals.length = 0;

  logger.info("CapitalWorker: Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((error) => {
  logger.error("CapitalWorker: Failed to start", { error: (error as Error).message });
  process.exit(1);
});
