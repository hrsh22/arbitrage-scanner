/**
 * Vault Health Monitor Service
 *
 * Monitors critical health metrics for both legacy and custom vaults:
 * - Epoch settlement lag (alert if > 1 hour past expected)
 * - NAV staleness (alert if > 6 hours old)
 * - Claim backlog (alert if > 100 pending claims)
 * - Failed settlement transactions
 *
 * Provides health check endpoints and alert triggers for PagerDuty/Slack.
 */

import { createPublicClient, type Address, type Hex } from "viem";
import { polygon } from "viem/chains";
import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { epochs, epochRequests, vaultAllocations } from "../db/schema.js";
import { logger } from "../logger.js";
import { env } from "../env.js";
import { createPolygonTransport } from "../rpcTransport.js";
import type { VaultInstanceConfig } from "../config/types.js";
import { getAllVaultConfigs, getVaultConfig } from "../config/index.js";
import { resolveVaultIdentity } from "../config/identityResolver.js";
import { getVaultProvider } from "./vaultProviderFactory.js";
import { createNavOracle } from "./navOracle.js";
import { FlatnessDetector, type FlatnessCheckResult } from "./flatnessDetector.js";

// ===== Constants =====

import { ALERT_THRESHOLDS as ALERT_CONFIG_THRESHOLDS } from "../config/alerts.js";

/** Alert thresholds - re-export from config for backward compatibility */
const ALERT_THRESHOLDS = ALERT_CONFIG_THRESHOLDS;

/** Snapshot-tranche specific thresholds */
const SNAPSHOT_TRANCHE_THRESHOLDS = {
  /** Unresolved position timeout: alert if frozen positions unresolved for >25 days */
  UNRESOLVED_POSITION_TIMEOUT_DAYS: 25,
  /** Payout backlog: alert if >100 pending payouts (distributed but unclaimed) */
  PAYOUT_BACKLOG_COUNT: 100,
  /** Frozen snapshot staleness: alert if positions frozen >7 days without realization */
  FROZEN_SNAPSHOT_STALE_DAYS: 7,
  /** Realization processing lag: alert if realizations pending >4 hours */
  REALIZATION_PROCESSING_LAG_HOURS: 4,
} as const;

/** Severity levels */

/** Severity levels */
type Severity = "info" | "warning" | "critical";

/** Health check result */
interface HealthCheckResult {
  name: string;
  status: "healthy" | "degraded" | "critical";
  severity: Severity;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  runbookUrl?: string;
}

/** Epoch lag check result */
interface EpochLagCheck {
  vaultId: number;
  epochId: string;
  expectedSettlementTime: Date;
  actualSettlementTime?: Date;
  lagSeconds: number;
  isDelayed: boolean;
}

/** NAV staleness check result */
interface NavStalenessCheck {
  vaultId: number;
  vaultAddress: string;
  lastUpdateTime: Date;
  secondsSinceUpdate: number;
  isStale: boolean;
  thresholdSeconds: number;
}

/** Claim backlog check result */
interface ClaimBacklogCheck {
  vaultId?: number;
  pendingClaims: number;
  settledUnclaimed: number;
  totalBacklog: number;
  isBacklogged: boolean;
}

/** Failed settlement check result */
interface FailedSettlementCheck {
  vaultId?: number;
  failedCount24h: number;
  recentFailures: Array<{
    txHash?: string;
    error: string;
    timestamp: Date;
  }>;
  hasFailures: boolean;
}

/** Unresolved positions timeout check result */
interface UnresolvedPositionsCheck {
  vaultId?: number;
  totalFrozen: number;
  oldestFrozenDays: number;
  positionsNearTimeout: number;
  hasTimeoutRisk: boolean;
}

/** Payout backlog check result */
interface PayoutBacklogCheck {
  vaultId?: number;
  pendingPayouts: number;
  distributedUnclaimed: number;
  totalBacklog: number;
  isBacklogged: boolean;
}

/** Frozen snapshot staleness check result */
interface FrozenSnapshotStalenessCheck {
  vaultId?: number;
  epochId: string;
  frozenPositionCount: number;
  daysSinceFrozen: number;
  realizationsPending: number;
  isStale: boolean;
}

/** Complete health status */
interface VaultHealthStatus {
  overall: "healthy" | "degraded" | "critical";
  checks: HealthCheckResult[];
  summary: {
    critical: number;
    warning: number;
    healthy: number;
  };
  timestamp: Date;
}

// ===== ABIs =====

const CUSTOM_VAULT_NAV_ABI = [
  {
    type: "function",
    name: "lastNAVUpdate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isNAVFresh",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ===== VaultHealthMonitor Class =====

export class VaultHealthMonitor {
  private readonly publicClient;

  constructor() {
    this.publicClient = createPublicClient({
      chain: polygon,
      transport: createPolygonTransport(env.POLYGON_RPC_URL),
    });
  }

  // ============================================================================
  // Epoch Settlement Lag Checks
  // ============================================================================

  /**
   * Check for epoch settlement lag across all custom vaults.
   * Alerts if settlement is > 1 hour past expected epoch end.
   */
  async checkEpochSettlementLag(vaultId?: number): Promise<HealthCheckResult> {
    const checks: EpochLagCheck[] = [];
    const delayedEpochs: EpochLagCheck[] = [];

    try {
      const vaults = vaultId ? [getVaultConfig(vaultId)].filter(Boolean) : getAllVaultConfigs();

      for (const vault of vaults) {
        if (!vault) continue;

        try {
          // Get provider to check vault type
          const provider = getVaultProvider(vault.id);
          const capabilities = provider.getCapabilities();

          // Only check custom vaults with epochs
          if (!capabilities.epochBased) continue;

          // Get current epoch status
          const epochStatus = await provider.getEpochStatus();

          // Check if epoch has ended but not settled
          const now = new Date();
          const epochEnd = epochStatus.endTime;

          if (now > epochEnd && !epochStatus.settled) {
            const lagSeconds = Math.floor((now.getTime() - epochEnd.getTime()) / 1000);

            const check: EpochLagCheck = {
              vaultId: vault.id,
              epochId: epochStatus.epochId.toString(),
              expectedSettlementTime: epochEnd,
              lagSeconds,
              isDelayed: lagSeconds > ALERT_THRESHOLDS.EPOCH_SETTLEMENT_LAG_SECONDS,
            };

            checks.push(check);

            if (check.isDelayed) {
              delayedEpochs.push(check);
            }
          }
        } catch (error) {
          logger.warn("HealthMonitor: Failed to check epoch lag", {
            vaultId: vault.id,
            error: (error as Error).message,
          });
        }
      }

      if (delayedEpochs.length > 0) {
        const mostDelayed = delayedEpochs.reduce((max, curr) =>
          curr.lagSeconds > max.lagSeconds ? curr : max,
        );

        return {
          name: "epoch_settlement_lag",
          status: "critical",
          severity: "critical",
          message: `${delayedEpochs.length} epoch(s) delayed. Most delayed: ${mostDelayed.lagSeconds}s (vault ${mostDelayed.vaultId}, epoch ${mostDelayed.epochId})`,
          details: {
            delayedCount: delayedEpochs.length,
            maxLagSeconds: mostDelayed.lagSeconds,
            epochs: delayedEpochs,
          },
          timestamp: new Date(),
          runbookUrl:
            "https://github.com/polymarket-mvp/runbooks/blob/main/epoch-settlement-lag.md",
        };
      }

      return {
        name: "epoch_settlement_lag",
        status: "healthy",
        severity: "info",
        message: `All ${checks.length} epoch(s) on schedule`,
        details: { checkedEpochs: checks.length },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "epoch_settlement_lag",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // NAV Staleness Checks
  // ============================================================================

  /**
   * Check NAV staleness for all vaults.
   * Alerts if NAV is > 6 hours old.
   */
  async checkNavStaleness(vaultId?: number): Promise<HealthCheckResult> {
    const checks: NavStalenessCheck[] = [];
    const staleVaults: NavStalenessCheck[] = [];

    try {
      const vaults = vaultId ? [getVaultConfig(vaultId)].filter(Boolean) : getAllVaultConfigs();

      for (const vault of vaults) {
        if (!vault) continue;

        try {
          // Use NavOracle to get health status
          const navOracle = createNavOracle(vault);
          const health = await navOracle.getNavHealth();

          const check: NavStalenessCheck = {
            vaultId: vault.id,
            vaultAddress: vault.vaultAddress,
            lastUpdateTime: health.lastUpdateTime,
            secondsSinceUpdate: health.secondsSinceUpdate,
            isStale: health.stale,
            thresholdSeconds: health.thresholdSeconds,
          };

          checks.push(check);

          if (check.isStale) {
            staleVaults.push(check);
          }
        } catch (error) {
          logger.warn("HealthMonitor: Failed to check NAV staleness", {
            vaultId: vault.id,
            error: (error as Error).message,
          });

          // If we can't check NAV, mark as stale
          staleVaults.push({
            vaultId: vault.id,
            vaultAddress: vault.vaultAddress,
            lastUpdateTime: new Date(0),
            secondsSinceUpdate: Infinity,
            isStale: true,
            thresholdSeconds: ALERT_THRESHOLDS.NAV_STALENESS_SECONDS,
          });
        }
      }

      if (staleVaults.length > 0) {
        const stalest = staleVaults.reduce((max, curr) =>
          curr.secondsSinceUpdate > max.secondsSinceUpdate ? curr : max,
        );

        const hoursStale = Math.floor(stalest.secondsSinceUpdate / 3600);

        return {
          name: "nav_staleness",
          status: "critical",
          severity: "critical",
          message: `${staleVaults.length} vault(s) have stale NAV. Stalest: ${hoursStale}h old (vault ${stalest.vaultId})`,
          details: {
            staleCount: staleVaults.length,
            maxStalenessHours: hoursStale,
            vaults: staleVaults.map((v) => ({
              vaultId: v.vaultId,
              hoursStale: Math.floor(v.secondsSinceUpdate / 3600),
            })),
          },
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/nav-staleness.md",
        };
      }

      return {
        name: "nav_staleness",
        status: "healthy",
        severity: "info",
        message: `All ${checks.length} vault(s) have fresh NAV`,
        details: {
          checkedVaults: checks.length,
          avgStalenessSeconds: Math.round(
            checks.reduce((sum, c) => sum + c.secondsSinceUpdate, 0) / checks.length,
          ),
        },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "nav_staleness",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Claim Backlog Checks
  // ============================================================================

  /**
   * Check claim backlog (settled but unclaimed requests).
   * Alerts if > 100 pending claims.
   */
  async checkClaimBacklog(vaultId?: number): Promise<HealthCheckResult> {
    try {
      // Query settled but unclaimed requests
      const conditions = [eq(epochRequests.status, "claimable")];

      if (vaultId) {
        const vault = getVaultConfig(vaultId);
        if (vault) {
          conditions.push(eq(epochRequests.vaultAddress, vault.vaultAddress));
        }
      }

      const settledRequests = await db
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(epochRequests)
        .where(and(...conditions));

      const pendingCount = settledRequests[0]?.count ?? 0;

      // Also check legacy withdrawal queue
      const { withdrawalRepository } = await import("../repositories/withdrawalRepository.js");
      const readyWithdrawals = await withdrawalRepository.getReadyRequests(
        vaultId ? getVaultConfig(vaultId)?.vaultAddress : undefined,
      );

      const totalBacklog = pendingCount + readyWithdrawals.length;

      const check: ClaimBacklogCheck = {
        pendingClaims: pendingCount,
        settledUnclaimed: readyWithdrawals.length,
        totalBacklog: totalBacklog,
        isBacklogged: totalBacklog > ALERT_THRESHOLDS.CLAIM_BACKLOG_COUNT,
      };

      if (check.isBacklogged) {
        return {
          name: "claim_backlog",
          status: "degraded",
          severity: "warning",
          message: `Claim backlog: ${totalBacklog} pending claims (${pendingCount} epoch + ${readyWithdrawals.length} legacy)`,
          details: { ...check } as Record<string, unknown>,
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/claim-backlog.md",
        };
      }

      return {
        name: "claim_backlog",
        status: "healthy",
        severity: "info",
        message: `Claim backlog: ${totalBacklog} pending claims`,
        details: { ...check } as Record<string, unknown>,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "claim_backlog",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Failed Settlement Checks
  // ============================================================================

  /**
   * Check for failed settlement transactions in the last 24 hours.
   * Alerts if > 5 failures.
   */
  async checkFailedSettlements(vaultId?: number): Promise<HealthCheckResult> {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Query recent allocation events with errors
      // Note: vaultAllocations table tracks successful allocations
      // Failed transactions tracked via epochs table cancellations
      // Filter by vault ID via epochs query below
      const vaultFilter = vaultId ? getVaultConfig(vaultId) : null;

      // Build conditions
      const conditions = [
        eq(epochs.status, "cancelled"),
        sql`${epochs.updatedAt} > ${twentyFourHoursAgo}`,
      ];

      if (vaultFilter) {
        conditions.push(eq(epochs.vaultAddress, vaultFilter.vaultAddress));
      }

      const failedEpochs = await db
        .select({
          epochId: epochs.epochId,
          status: epochs.status,
          updatedAt: epochs.updatedAt,
          vaultAddress: epochs.vaultAddress,
        })
        .from(epochs)
        .where(and(...conditions))
        .orderBy(desc(epochs.updatedAt));

      const check: FailedSettlementCheck = {
        failedCount24h: failedEpochs.length,
        recentFailures: failedEpochs.map((e: { updatedAt: Date }) => ({
          error: "Epoch settlement cancelled",
          timestamp: e.updatedAt,
        })),
        hasFailures: failedEpochs.length > 0,
      };

      if (check.failedCount24h >= ALERT_THRESHOLDS.FAILED_SETTLEMENTS_24H) {
        return {
          name: "failed_settlements",
          status: "critical",
          severity: "critical",
          message: `${check.failedCount24h} settlement failures in last 24h`,
          details: { ...check } as Record<string, unknown>,
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/failed-settlements.md",
        };
      }

      if (check.hasFailures) {
        return {
          name: "failed_settlements",
          status: "degraded",
          severity: "warning",
          message: `${check.failedCount24h} settlement failure(s) in last 24h`,
          details: { ...check } as Record<string, unknown>,
          timestamp: new Date(),
        };
      }

      return {
        name: "failed_settlements",
        status: "healthy",
        severity: "info",
        message: "No settlement failures in last 24h",
        details: { ...check } as Record<string, unknown>,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "failed_settlements",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Worker Heartbeat Check
  // ============================================================================

  /**
   * Check worker heartbeat.
   * Alerts if no heartbeat > 10 minutes.
   */
  async checkWorkerHeartbeat(): Promise<HealthCheckResult> {
    // This would typically check a heartbeat table or Redis key
    // For now, we check the last NAV update as a proxy

    try {
      const { navCalculator } = await import("./navCalculator.js");
      const history = await navCalculator.getNavHistory(1);

      if (history.length === 0) {
        return {
          name: "worker_heartbeat",
          status: "critical",
          severity: "critical",
          message: "No NAV history found - worker may be down",
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/worker-heartbeat.md",
        };
      }

      const lastUpdate = new Date(String(history[0]!.timestamp));
      const secondsSinceUpdate = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);

      if (secondsSinceUpdate > ALERT_THRESHOLDS.WORKER_HEARTBEAT_SECONDS) {
        const minutesStale = Math.floor(secondsSinceUpdate / 60);
        return {
          name: "worker_heartbeat",
          status: "critical",
          severity: "critical",
          message: `Worker heartbeat stale: ${minutesStale} minutes since last NAV update`,
          details: {
            lastUpdate: lastUpdate.toISOString(),
            secondsSinceUpdate,
          },
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/worker-heartbeat.md",
        };
      }

      return {
        name: "worker_heartbeat",
        status: "healthy",
        severity: "info",
        message: `Worker heartbeat OK: ${Math.floor(secondsSinceUpdate / 60)}m since last update`,
        details: {
          lastUpdate: lastUpdate.toISOString(),
          secondsSinceUpdate,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "worker_heartbeat",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Snapshot-Tranche Specific Health Checks
  // ============================================================================

  /**
   * Check for unresolved positions approaching timeout.
   * Alerts if frozen positions are unresolved for >25 days.
   */
  async checkUnresolvedPositionsTimeout(vaultId?: number): Promise<HealthCheckResult> {
    try {
      const { positionSnapshotRepository } = await import("../repositories/positionSnapshotRepository.js");
      const { epochRepository } = await import("../repositories/epochRepository.js");

      // Get all settled epochs that have frozen positions
      const epochs = vaultId 
        ? await epochRepository.getEpochsByVault(vaultId.toString())
        : await epochRepository.getAllSettledEpochs();

      let totalFrozen = 0;
      let oldestFrozenDays = 0;
      let positionsNearTimeout = 0;
      let oldestEpochId = "";

      const now = Date.now();
      const timeoutThresholdDays = SNAPSHOT_TRANCHE_THRESHOLDS.UNRESOLVED_POSITION_TIMEOUT_DAYS;
      const warningThresholdDays = timeoutThresholdDays - 3; // Warn 3 days before timeout

      for (const epoch of epochs) {
        const frozenSnapshots = await positionSnapshotRepository.getFrozenByEpoch(epoch.epochId);
        
        if (frozenSnapshots.length > 0) {
          totalFrozen += frozenSnapshots.length;
          
          // Calculate days since epoch was settled (when positions were frozen)
          const settledAt = epoch.claimableAt ? new Date(epoch.claimableAt).getTime() : now;
          const daysFrozen = Math.floor((now - settledAt) / (1000 * 60 * 60 * 24));
          
          if (daysFrozen > oldestFrozenDays) {
            oldestFrozenDays = daysFrozen;
            oldestEpochId = epoch.epochId;
          }

          // Count positions near timeout (within 3 days of 25-day limit)
          if (daysFrozen >= warningThresholdDays) {
            positionsNearTimeout += frozenSnapshots.length;
          }
        }
      }

      const check: UnresolvedPositionsCheck = {
        vaultId,
        totalFrozen,
        oldestFrozenDays,
        positionsNearTimeout,
        hasTimeoutRisk: oldestFrozenDays >= timeoutThresholdDays,
      };

      if (check.hasTimeoutRisk) {
        return {
          name: "unresolved_positions_timeout",
          status: "critical",
          severity: "critical",
          message: `${totalFrozen} unresolved position(s) in ${oldestEpochId} frozen for ${oldestFrozenDays} days (timeout: ${timeoutThresholdDays} days)`,
          details: { ...check } as Record<string, unknown>,
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/unresolved-positions-timeout.md",
        };
      }

      if (positionsNearTimeout > 0) {
        return {
          name: "unresolved_positions_timeout",
          status: "degraded",
          severity: "warning",
          message: `${positionsNearTimeout} position(s) approaching timeout (${oldestFrozenDays}/${timeoutThresholdDays} days)`,
          details: { ...check } as Record<string, unknown>,
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/unresolved-positions-timeout.md",
        };
      }

      return {
        name: "unresolved_positions_timeout",
        status: "healthy",
        severity: "info",
        message: totalFrozen > 0 
          ? `${totalFrozen} frozen position(s), oldest ${oldestFrozenDays} days (within threshold)`
          : "No frozen positions awaiting resolution",
        details: { ...check } as Record<string, unknown>,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "unresolved_positions_timeout",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check for payout backlog (distributed but unclaimed payouts).
   * Alerts if >100 pending payouts.
   */
  async checkPayoutBacklog(vaultId?: number): Promise<HealthCheckResult> {
    try {
      const { payoutRepository } = await import("../repositories/payoutRepository.js");
      const { epochRepository } = await import("../repositories/epochRepository.js");

      // Get all settled epochs
      const epochs = vaultId 
        ? await epochRepository.getEpochsByVault(vaultId.toString())
        : await epochRepository.getAllSettledEpochs();

      let totalDistributedUnclaimed = 0;

      for (const epoch of epochs) {
        // Get cumulative stats for this epoch
        const totalDistributed = await payoutRepository.getTotalByEpoch(epoch.epochId, "distributed");
        const totalClaimed = await payoutRepository.getTotalByEpoch(epoch.epochId, "claimed");
        
        const distributed = BigInt(totalDistributed);
        const claimed = BigInt(totalClaimed);
        
        // Count distributed but not claimed
        if (distributed > claimed) {
          totalDistributedUnclaimed += Number(distributed - claimed);
        }
      }

      // Also count individual pending payout records
      const pendingPayouts = totalDistributedUnclaimed; // Approximation

      const check: PayoutBacklogCheck = {
        vaultId,
        pendingPayouts,
        distributedUnclaimed: totalDistributedUnclaimed,
        totalBacklog: pendingPayouts,
        isBacklogged: pendingPayouts > SNAPSHOT_TRANCHE_THRESHOLDS.PAYOUT_BACKLOG_COUNT,
      };

      if (check.isBacklogged) {
        return {
          name: "payout_backlog",
          status: "degraded",
          severity: "warning",
          message: `Payout backlog: ${pendingPayouts} pending payouts exceeding threshold (${SNAPSHOT_TRANCHE_THRESHOLDS.PAYOUT_BACKLOG_COUNT})`,
          details: { ...check } as Record<string, unknown>,
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/payout-backlog.md",
        };
      }

      return {
        name: "payout_backlog",
        status: "healthy",
        severity: "info",
        message: `Payout backlog: ${pendingPayouts} pending payouts (within threshold)`,
        details: { ...check } as Record<string, unknown>,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "payout_backlog",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check for stale frozen snapshots (positions frozen without realizations).
   * Alerts if positions frozen >7 days without realization activity.
   */
  async checkFrozenSnapshotStaleness(vaultId?: number): Promise<HealthCheckResult> {
    try {
      const { positionSnapshotRepository } = await import("../repositories/positionSnapshotRepository.js");
      const { epochRepository } = await import("../repositories/epochRepository.js");
      const { realizationRepository } = await import("../repositories/realizationRepository.js");

      // Get all settled epochs
      const epochs = vaultId 
        ? await epochRepository.getEpochsByVault(vaultId.toString())
        : await epochRepository.getAllSettledEpochs();

      const now = Date.now();
      const staleThresholdDays = SNAPSHOT_TRANCHE_THRESHOLDS.FROZEN_SNAPSHOT_STALE_DAYS;
      let stalestEpoch: { epochId: string; daysFrozen: number; frozenCount: number; realizationsPending: number } | null = null;

      for (const epoch of epochs) {
        const frozenCount = await positionSnapshotRepository.getFrozenByEpoch(epoch.epochId);
        
        if (frozenCount.length > 0) {
          const settledAt = epoch.claimableAt ? new Date(epoch.claimableAt).getTime() : now;
          const daysFrozen = Math.floor((now - settledAt) / (1000 * 60 * 60 * 24));
          
          // Check for realizations in this epoch
          const realizations = await realizationRepository.getByEpoch(epoch.epochId);
          const realizationsPending = frozenCount.length - realizations.length;
          
          if (daysFrozen >= staleThresholdDays && !stalestEpoch) {
            stalestEpoch = {
              epochId: epoch.epochId,
              daysFrozen,
              frozenCount: frozenCount.length,
              realizationsPending,
            };
          }
        }
      }

      const check: FrozenSnapshotStalenessCheck = {
        vaultId,
        epochId: stalestEpoch?.epochId ?? "",
        frozenPositionCount: stalestEpoch?.frozenCount ?? 0,
        daysSinceFrozen: stalestEpoch?.daysFrozen ?? 0,
        realizationsPending: stalestEpoch?.realizationsPending ?? 0,
        isStale: stalestEpoch !== null,
      };

      if (check.isStale) {
        return {
          name: "frozen_snapshot_stale",
          status: "degraded",
          severity: "warning",
          message: `Frozen snapshot ${check.epochId} is stale: ${check.frozenPositionCount} positions frozen for ${check.daysSinceFrozen} days without realizations`,
          details: { ...check } as Record<string, unknown>,
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/snapshot-tranche/frozen-snapshot-stale.md",
        };
      }

      return {
        name: "frozen_snapshot_stale",
        status: "healthy",
        severity: "info",
        message: "All frozen snapshots within freshness threshold",
        details: { ...check } as Record<string, unknown>,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "frozen_snapshot_stale",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Flatness Check
  // ============================================================================

  /**
   * Check if the vault is in a "flat" state.
   *
   * A vault is flat when all five conditions are met:
   * 1. Zero open Polymarket positions
   * 2. Zero resting orders on CLOB
   * 3. deployedCapital == 0
   * 4. Zero non-dust CTF token balances
   * 5. Successful reconciliation pass
   *
   * Flatness is a prerequisite for settlement.
   */
  async checkFlatness(vaultId?: number): Promise<HealthCheckResult> {
    try {
      const vaults = vaultId ? [getVaultConfig(vaultId)].filter(Boolean) : getAllVaultConfigs();
      const failedChecks: { vaultId: number; blockingConditions: string[] }[] = [];

      for (const vault of vaults) {
        if (!vault) continue;

        try {
          // Only check custom vaults that use flatness-based settlement
          const provider = getVaultProvider(vault.id);
          const capabilities = provider.getCapabilities();

          if (!capabilities.batchBased) continue;

          const flatnessDetector = new FlatnessDetector();
          const tradingSafeAddress = vault.tradingSafeAddress ?? vault.safeAddress;
          const result = await flatnessDetector.checkFlatness(vault, tradingSafeAddress);

          if (!result.isFlat) {
            failedChecks.push({
              vaultId: vault.id,
              blockingConditions: result.blockingConditions,
            });
          }
        } catch (error) {
          logger.warn("HealthMonitor: Failed to check flatness", {
            vaultId: vault.id,
            error: (error as Error).message,
          });
        }
      }

      if (failedChecks.length > 0) {
        const firstFailure = failedChecks[0]!;
        return {
          name: "vault_flatness",
          status: "degraded",
          severity: "warning",
          message: `${failedChecks.length} vault(s) are not flat. First: vault ${firstFailure.vaultId} blocked by: ${firstFailure.blockingConditions.join(
)}`,
          details: {
            failedCount: failedChecks.length,
            failures: failedChecks,
          },
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/vault-flatness.md",
        };
      }

      return {
        name: "vault_flatness",
        status: "healthy",
        severity: "info",
        message: "All checked vaults are flat",
        details: { checkedVaults: vaults.filter(Boolean).length },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "vault_flatness",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Starvation & Emergency Pause Health Checks (T5)
  // ============================================================================

  /**
   * Check for flattening timeout (starvation detection).
   * 
   * Alerts if book flattening exceeds MAX_FLATTENING_WINDOW_MS.
   */
  async checkFlatteningTimeout(vaultId?: number): Promise<HealthCheckResult> {
    try {
      const configs = vaultId ? [getVaultConfig(vaultId)].filter(Boolean) : getAllVaultConfigs();
      const timeoutChecks: Array<{
        vaultId: number;
        startedAt: string;
        expectedDeadline: string;
        blockingConditions: string[];
        timeoutTriggered: boolean;
      }> = [];

      for (const vault of configs) {
        if (!vault) continue;

        try {
          // Get the trading orchestrator for this vault
          const { createTradingOrchestrator } = await import("./tradingOrchestrator.js");
          const orchestrator = createTradingOrchestrator(vault);

          const attempt = orchestrator.getCurrentFlatteningAttempt();
          const hasTimeout = orchestrator.hasFlatteningTimeout();

          if (attempt && (hasTimeout || attempt.status === "timeout")) {
            timeoutChecks.push({
              vaultId: vault.id,
              startedAt: attempt.startedAt.toISOString(),
              expectedDeadline: attempt.expectedDeadline.toISOString(),
              blockingConditions: attempt.blockingConditions,
              timeoutTriggered: true,
            });
          }
        } catch (error) {
          logger.warn("HealthMonitor: Failed to check flattening timeout", {
            vaultId: vault.id,
            error: (error as Error).message,
          });
        }
      }

      if (timeoutChecks.length > 0) {
        const first = timeoutChecks[0]!;
        return {
          name: "flattening_timeout",
          status: "critical",
          severity: "critical",
          message: `${timeoutChecks.length} vault(s) have flattening timeout. First: vault ${first.vaultId} started at ${first.startedAt}, deadline was ${first.expectedDeadline}`,
          details: {
            timeoutCount: timeoutChecks.length,
            timeouts: timeoutChecks,
            maxFlatteningWindowMs: 60 * 60 * 1000, // 1 hour
          },
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/starvation/flattening-timeout.md",
        };
      }

      return {
        name: "flattening_timeout",
        status: "healthy",
        severity: "info",
        message: "No flattening timeouts detected",
        details: { checkedVaults: configs.filter(Boolean).length },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "flattening_timeout",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check for emergency pause state.
   * 
   * Critical alert if vault is in emergency pause.
   */
  async checkEmergencyPause(vaultId?: number): Promise<HealthCheckResult> {
    try {
      const configs = vaultId ? [getVaultConfig(vaultId)].filter(Boolean) : getAllVaultConfigs();
      const pausedVaults: Array<{
        vaultId: number;
        pausedAt: string | null;
        reason: string | null;
        triggeredBy: string | null;
      }> = [];

      for (const vault of configs) {
        if (!vault) continue;

        try {
          const { createTradingOrchestrator } = await import("./tradingOrchestrator.js");
          const orchestrator = createTradingOrchestrator(vault);

          const pauseState = orchestrator.getEmergencyPauseState();

          if (pauseState.isPaused) {
            pausedVaults.push({
              vaultId: vault.id,
              pausedAt: pauseState.pausedAt?.toISOString() ?? null,
              reason: pauseState.reason,
              triggeredBy: pauseState.triggeredBy,
            });
          }
        } catch (error) {
          logger.warn("HealthMonitor: Failed to check emergency pause", {
            vaultId: vault.id,
            error: (error as Error).message,
          });
        }
      }

      if (pausedVaults.length > 0) {
        const first = pausedVaults[0]!;
        return {
          name: "emergency_pause",
          status: "critical",
          severity: "critical",
          message: `EMERGENCY PAUSE: ${pausedVaults.length} vault(s) paused. First: vault ${first.vaultId} paused at ${first.pausedAt}, reason: ${first.reason}`,
          details: {
            pausedCount: pausedVaults.length,
            pausedVaults,
          },
          timestamp: new Date(),
          runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/starvation/emergency-pause.md",
        };
      }

      return {
        name: "emergency_pause",
        status: "healthy",
        severity: "info",
        message: "No emergency pauses active",
        details: { checkedVaults: configs.filter(Boolean).length },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        name: "emergency_pause",
        status: "critical",
        severity: "critical",
        message: `Check failed: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  // ============================================================================
  // Composite Health Check
  // ============================================================================

  /**
   * Run all health checks and return comprehensive status.
   */
  /**
   * Run all health checks and return comprehensive status.
   * Includes both legacy vault checks and snapshot-tranche specific checks.
   */
  async runFullHealthCheck(vaultId?: number): Promise<VaultHealthStatus> {
    const checks = await Promise.all([
      // Legacy vault checks
      this.checkEpochSettlementLag(vaultId),
      this.checkNavStaleness(vaultId),
      this.checkClaimBacklog(vaultId),
      this.checkFailedSettlements(vaultId),
      this.checkWorkerHeartbeat(),
      // Snapshot-tranche specific checks
      this.checkUnresolvedPositionsTimeout(vaultId),
      this.checkPayoutBacklog(vaultId),
      this.checkFrozenSnapshotStaleness(vaultId),
      // Flatness check (for closed-book batch vaults)
      this.checkFlatness(vaultId),
      // Starvation & Emergency Pause checks (T5)
      this.checkFlatteningTimeout(vaultId),
      this.checkEmergencyPause(vaultId),
    ]);

    const critical = checks.filter((c) => c.severity === "critical").length;
    const warning = checks.filter((c) => c.severity === "warning").length;
    const healthy = checks.filter((c) => c.severity === "info").length;

    let overall: "healthy" | "degraded" | "critical" = "healthy";
    if (critical > 0) {
      overall = "critical";
    } else if (warning > 0) {
      overall = "degraded";
    }

    return {
      overall,
      checks,
      summary: { critical, warning, healthy },
      timestamp: new Date(),
    };
  }

  // ============================================================================
  // Alert Helpers
  // ============================================================================

  /**
   * Format health check result for PagerDuty alert.
   */
  formatPagerDutyPayload(result: HealthCheckResult, vaultId?: number): Record<string, unknown> {
    return {
      payload: {
        summary: `[${result.severity.toUpperCase()}] Vault ${vaultId ?? "all"}: ${result.message}`,
        severity: result.severity === "critical" ? "critical" : result.severity,
        source: "vault-health-monitor",
        component: result.name,
        custom_details: {
          ...result.details,
          vaultId,
          runbook: result.runbookUrl,
        },
      },
      routing_key: process.env.PAGERDUTY_ROUTING_KEY,
      event_action: result.severity === "info" ? "resolve" : "trigger",
    };
  }

  /**
   * Format health check result for Slack notification.
   */
  formatSlackPayload(result: HealthCheckResult, vaultId?: number): Record<string, unknown> {
    const emoji =
      result.status === "healthy"
        ? ":white_check_mark:"
        : result.status === "degraded"
          ? ":warning:"
          : ":rotating_light:";

    return {
      text: `${emoji} *Vault Health Alert*`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${emoji} Vault Health: ${result.name}`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Vault:*\n${vaultId ?? "all"}`,
            },
            {
              type: "mrkdwn",
              text: `*Status:*\n${result.status}`,
            },
            {
              type: "mrkdwn",
              text: `*Severity:*\n${result.severity}`,
            },
            {
              type: "mrkdwn",
              text: `*Time:*\n${result.timestamp.toISOString()}`,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Message:*\n${result.message}`,
          },
        },
        ...(result.runbookUrl
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `<${result.runbookUrl}|View Runbook>`,
                },
              },
            ]
          : []),
      ],
    };
  }
}
// ===== Singleton Export =====

let monitorInstance: VaultHealthMonitor | null = null;

export function getVaultHealthMonitor(): VaultHealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new VaultHealthMonitor();
  }
  return monitorInstance;
}

export {
  ALERT_THRESHOLDS,
  SNAPSHOT_TRANCHE_THRESHOLDS,
  type HealthCheckResult,
  type VaultHealthStatus,
  type EpochLagCheck,
  type NavStalenessCheck,
  type ClaimBacklogCheck,
  type FailedSettlementCheck,
  type UnresolvedPositionsCheck,
  type PayoutBacklogCheck,
  type FrozenSnapshotStalenessCheck,
  type Severity,
};
