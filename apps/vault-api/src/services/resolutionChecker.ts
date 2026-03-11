/**
 * Resolution Checker — Monitors open vault positions for market resolution.
 * Adapted from apps/api/src/bot/resolutionChecker.ts for vault usage.
 * Queries Polymarket Gamma API directly (no cross-app imports).
 *
 * T6: Event-driven reconciliation dispatcher — triggers reconciliation on position resolution.
 */

import type { VaultInstanceConfig } from "../config/types.js";
import { env } from "../env.js";
import { encodeFunctionData, type Address } from "viem";

import { CTF_ADDRESS, SUPPORTS_POLYMARKET_TRADING, USDC_E_ADDRESS } from "../constants.js";
import { logger } from "../logger.js";
import {
  PositionRepository,
  positionRepository as defaultPositionRepository,
} from "../repositories/positionRepository.js";
import { navOracle as defaultNavOracle } from "./navOracle.js";
import { SafeWalletService } from "./safeWallet.js";
import { pendingTxRegistry } from "./pendingTxRegistry.js";
import { LiquidityManager } from "./liquidityManager.js";

const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_DELAY_MS = 200;

interface MarketResolutionStatus {
  closed: boolean;
  active: boolean;
  resolved: boolean;
  winningOutcome?: string;
  outcomePrices: [number, number] | null;
}

// CTF redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)
const CTF_REDEEM_ABI = [
  {
    name: "redeemPositions",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "collateralToken", type: "address" as const },
      { name: "parentCollectionId", type: "bytes32" as const },
      { name: "conditionId", type: "bytes32" as const },
      { name: "indexSets", type: "uint256[]" as const },
    ],
    outputs: [],
  },
] as const;

const PARENT_COLLECTION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

const BINARY_INDEX_SETS = [1n, 2n];

export interface ResolutionCheckResult {
  checked: number;
  resolved: number;
  won: number;
  lost: number;
  redeemed: number;
  errors: string[];
}

export interface ResolvedStats {
  totalWins: number;
  totalLosses: number;
  totalPnl: number;
  winRate: number;
}

interface NavResolutionClient {
  handleResolution(positionId: number, isWin: boolean): Promise<unknown>;
}

function isNavResolutionResult(
  value: unknown,
): value is { updatedOnChain: boolean; delta: string; txHash?: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("updatedOnChain" in value) || !("delta" in value)) return false;

  const candidate = value as {
    updatedOnChain?: unknown;
    delta?: unknown;
    txHash?: unknown;
  };

  const hasValidTxHash =
    candidate.txHash === undefined ||
    candidate.txHash === null ||
    typeof candidate.txHash === "string";

  return (
    typeof candidate.updatedOnChain === "boolean" &&
    typeof candidate.delta === "string" &&
    hasValidTxHash
  );
}

function parseJsonArray(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchMarketStatus(marketId: string): Promise<MarketResolutionStatus | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(`${GAMMA_BASE_URL}/markets/${marketId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn("ResolutionChecker: Gamma API request failed", {
        marketId,
        status: response.status,
      });
      return null;
    }

    const market = (await response.json()) as {
      id?: string;
      closed?: boolean;
      active?: boolean;
      outcomes?: string;
      outcomePrices?: string;
    };

    if (!market?.id) return null;

    const closed = market.closed ?? false;
    const active = market.active ?? true;
    const outcomePricesArr = parseJsonArray(market.outcomePrices);
    const outcomes = parseJsonArray(market.outcomes);
    const price0 = toNumber(outcomePricesArr[0]);
    const price1 = toNumber(outcomePricesArr[1]);

    // Resolved = closed AND one outcome price === 1 (winner pays $1)
    let resolved = false;
    let winningOutcome: string | undefined;

    if (closed && price0 !== null && price1 !== null) {
      if (price0 === 1) {
        resolved = true;
        winningOutcome = outcomes[0] || "Yes";
      } else if (price1 === 1) {
        resolved = true;
        winningOutcome = outcomes[1] || "No";
      }
    }

    return {
      closed,
      active,
      resolved,
      winningOutcome,
      outcomePrices: price0 !== null && price1 !== null ? [price0, price1] : null,
    };
  } catch (error) {
    logger.error("ResolutionChecker: Failed to fetch market status", {
      marketId,
      error: (error as Error).message,
    });
    return null;
  }
}

export class ResolutionCheckerService {
  private config?: VaultInstanceConfig;

  constructor(
    private readonly positions: PositionRepository = defaultPositionRepository,
    private readonly navOracle: NavResolutionClient = defaultNavOracle,
    private readonly safeWallet: SafeWalletService,
    config?: VaultInstanceConfig,
  ) {
    this.config = config;
  }

  async checkResolutions(): Promise<ResolutionCheckResult> {
    // Block resolution checking on unsupported networks
    if (!SUPPORTS_POLYMARKET_TRADING) {
      logger.warn(
        "ResolutionChecker: Polymarket Gamma API is not available on the current network",
      );
      return {
        checked: 0,
        resolved: 0,
        won: 0,
        lost: 0,
        redeemed: 0,
        errors: [
          "Resolution checking is not supported on the current network (Amoy). Only available on Polygon mainnet.",
        ],
      };
    }

    const startTime = Date.now();
    const result: ResolutionCheckResult = {
      checked: 0,
      resolved: 0,
      won: 0,
      lost: 0,
      redeemed: 0,
      errors: [],
    };

    try {
      const openPositions = await this.positions.getOpenPositions();

      if (openPositions.length === 0) {
        logger.info("ResolutionChecker: No open positions to check");
        return result;
      }

      logger.info("ResolutionChecker: Checking positions", { count: openPositions.length });
      result.checked = openPositions.length;

      for (const position of openPositions) {
        try {
          await this.checkSinglePosition(position, result);
        } catch (error) {
          const errMsg = `Failed to check position ${position.id}: ${(error as Error).message}`;
          logger.error("ResolutionChecker: Position check failed", {
            positionId: position.id,
            marketId: position.marketId,
            error: (error as Error).message,
          });
          result.errors.push(errMsg);
        }

        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }

      logger.info("ResolutionChecker: Check cycle complete", {
        ...result,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      logger.error("ResolutionChecker: Check cycle failed", {
        error: (error as Error).message,
      });
      result.errors.push(`Check cycle failed: ${(error as Error).message}`);
      return result;
    }
  }

  async redeemConditionalTokens(
    conditionId: string,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      await this.safeWallet.initialize();

      const data = encodeFunctionData({
        abi: CTF_REDEEM_ABI,
        functionName: "redeemPositions",
        args: [
          USDC_E_ADDRESS as Address,
          PARENT_COLLECTION_ID,
          conditionId as `0x${string}`,
          BINARY_INDEX_SETS,
        ],
      });

      logger.info("ResolutionChecker: Redeeming conditional tokens", {
        conditionId,
        ctfAddress: CTF_ADDRESS,
      });

      const txResult = await this.safeWallet.executeRawTransaction(CTF_ADDRESS, data);

      if (txResult.success) {
        logger.info("ResolutionChecker: CT redemption successful", {
          conditionId,
          txHash: txResult.txHash,
        });
      }

      return txResult;
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("ResolutionChecker: CT redemption failed", {
        conditionId,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async getResolvedStats(): Promise<ResolvedStats> {
    try {
      const { db } = await import("../db/index.js");
      const { vaultPositions } = await import("../db/schema.js");
      const { inArray } = await import("drizzle-orm");

      const resolvedPositions = await db
        .select({
          status: vaultPositions.status,
          resolvedPnl: vaultPositions.resolvedPnl,
        })
        .from(vaultPositions)
        .where(inArray(vaultPositions.status, ["resolved_win", "resolved_loss"]));

      let totalWins = 0;
      let totalLosses = 0;
      let totalPnl = 0;

      for (const pos of resolvedPositions) {
        const pnl = parseFloat(pos.resolvedPnl ?? "0");

        if (pos.status === "resolved_win") {
          totalWins++;
          totalPnl += pnl;
        } else if (pos.status === "resolved_loss") {
          totalLosses++;
          totalPnl += pnl;
        }
      }

      const totalResolved = totalWins + totalLosses;
      const winRate = totalResolved > 0 ? totalWins / totalResolved : 0;
      totalPnl = Math.round(totalPnl * 1e6) / 1e6;

      logger.debug("ResolutionChecker: Resolved stats", {
        totalWins,
        totalLosses,
        totalPnl,
        winRate: (winRate * 100).toFixed(1) + "%",
      });

      return { totalWins, totalLosses, totalPnl, winRate };
    } catch (error) {
      logger.error("ResolutionChecker: Failed to get resolved stats", {
        error: (error as Error).message,
      });
      return { totalWins: 0, totalLosses: 0, totalPnl: 0, winRate: 0 };
    }
  }

  /**
   * T6: Event-driven reconciliation dispatcher — trigger reconciliation after position resolution.
   * Uses pendingTxRegistry lock to prevent duplicate dispatches.
   */
  private async triggerEventReconciliation(): Promise<void> {
    if (!this.config) {
      logger.debug("ResolutionChecker: No config available, skipping event reconciliation");
      return;
    }

    const vaultId = this.config.id;
    const vaultAddress = this.config.vaultAddress;

    const lockResult = pendingTxRegistry.acquireLock(
      vaultId,
      vaultAddress,
      "reconcile",
      "api",
      { ttlMs: 300000 }, // 5 minute TTL
    );

    if (!lockResult.acquired) {
      logger.info("eventReconciliationDispatched", {
        eventType: "position_resolution",
        vaultId,
        lockAcquired: false,
        reason: "Reconciliation already in progress, skipping duplicate dispatch",
      });
      return;
    }

    logger.info("eventReconciliationDispatched", {
      eventType: "position_resolution",
      vaultId,
      lockAcquired: true,
      source: "api",
    });

    // Fire-and-forget: run reconciliation asynchronously without blocking
    (async () => {
      try {
        const liquidityManager = new LiquidityManager({ config: this.config });
        const result = await liquidityManager.runReconciliation();

        logger.info("eventReconciliationCompleted", {
          eventType: "position_resolution",
          vaultId,
          action: result.action,
          amount: result.amount,
          details: result.details,
        });
      } catch (error) {
        logger.error("eventReconciliationFailed", {
          eventType: "position_resolution",
          vaultId,
          error: (error as Error).message,
        });
      } finally {
        pendingTxRegistry.releaseLock(vaultId, "reconcile");
      }
    })();
  }

  private async checkSinglePosition(
    position: Awaited<ReturnType<PositionRepository["getOpenPositions"]>>[number],
    result: ResolutionCheckResult,
  ): Promise<void> {
    const marketStatus = await fetchMarketStatus(position.marketId);

    if (!marketStatus) {
      logger.warn("ResolutionChecker: Market not found", {
        positionId: position.id,
        marketId: position.marketId,
      });
      return;
    }

    logger.debug("ResolutionChecker: Market status", {
      positionId: position.id,
      marketId: position.marketId,
      closed: marketStatus.closed,
      resolved: marketStatus.resolved,
      winningOutcome: marketStatus.winningOutcome,
    });

    if (!marketStatus.resolved) return;

    const isWin = position.outcome === marketStatus.winningOutcome;
    const costBasis = parseFloat(position.costBasis);
    const quantity = parseFloat(position.quantity);

    let pnl: number;
    if (!marketStatus.winningOutcome) {
      pnl = 0;
    } else if (isWin) {
      pnl = quantity - costBasis;
    } else {
      pnl = -costBasis;
    }
    pnl = Math.round(pnl * 1e6) / 1e6;

    try {
      const navResultRaw = await this.navOracle.handleResolution(position.id, isWin);
      if (!isNavResolutionResult(navResultRaw)) {
        throw new Error("Invalid NAV resolution response");
      }

      const navResult = navResultRaw;
      logger.info("ResolutionChecker: NAV updated after resolution", {
        positionId: position.id,
        isWin,
        navDelta: navResult.delta,
        txHash: navResult.txHash,
      });
    } catch (navError) {
      const errMsg = `NAV update failed for position ${position.id}: ${(navError as Error).message}`;
      logger.error("ResolutionChecker: NAV oracle error", {
        positionId: position.id,
        error: (navError as Error).message,
      });
      result.errors.push(errMsg);
    }

    result.resolved++;
    if (isWin) {
      result.won++;
    } else {
      result.lost++;
    }

    if (isWin) {
      try {
        const redeemResult = await this.redeemConditionalTokens(position.conditionId);
        if (redeemResult.success) {
          result.redeemed++;
          logger.info("ResolutionChecker: CT tokens redeemed", {
            positionId: position.id,
            conditionId: position.conditionId,
            txHash: redeemResult.txHash,
          });
        } else {
          result.errors.push(
            `CT redemption failed for position ${position.id}: ${redeemResult.error}`,
          );
        }
      } catch (redeemError) {
        result.errors.push(
          `CT redemption error for position ${position.id}: ${(redeemError as Error).message}`,
        );
      }
    }

    // T6: Trigger event-driven reconciliation after position resolution
    void this.triggerEventReconciliation();

    logger.info("ResolutionChecker: Position resolved", {
      positionId: position.id,
      positionDbId: position.positionId,
      marketId: position.marketId,
      outcome: position.outcome,
      winningOutcome: marketStatus.winningOutcome,
      isWin,
      costBasis,
      quantity,
      pnl,
    });
  }
}

