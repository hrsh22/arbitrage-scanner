/**
 * Trading Orchestrator — Config-Driven Market Scanning & Trade Execution
 *
 * Coordinates the full scan→evaluate→allocate→trade→record cycle for bot vaults.
 * All strategy params come from VaultInstanceConfig (no env vars for strategy).
 *
 * Refactored to use the ported StrategyEngine for opportunity evaluation,
 * replacing the inline strategy logic.
 */

import { randomUUID } from "node:crypto";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

import { SUPPORTS_POLYMARKET_TRADING, USDC_E_ADDRESS } from "../constants.js";
import type { VaultInstanceConfig } from "../config/types.js";
import type { ResolvedVaultIdentity } from "../config/identityResolver.js";
import { resolveVaultIdentity } from "../config/identityResolver.js";
import { db } from "../db/index.js";
import { vaultPositions } from "../db/schema.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { navCalculator } from "./navCalculator.js";
import { positionRepository } from "../repositories/positionRepository.js";
import { SafeWalletService } from "./safeWallet.js";
import {
  createVaultTradingClient,
  getVaultTradingClient,
  VaultTradingClient,
} from "./tradingClient.js";
import { isValidOpportunity, calculatePPH, calculateExpectedProfit } from "./strategyEngine.js";
import type { TradeRequest, VaultStatus } from "../types.js";
import { withdrawalRepository } from "../repositories/withdrawalRepository.js";
import { getVaultProvider } from "./vaultProviderFactory.js";
import { FlatnessDetector, type FlatnessCheckResult } from "./flatnessDetector.js";

const USDC_DECIMALS = 1_000_000;
const DEFAULT_MAX_DEPLOYED_RATIO = 0.25;
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const EVENT_BATCH_SIZE = 100;
const DEFAULT_MARKET_SOON_CLOSING_LIMIT = 100;
const DEFAULT_MARKET_MAX_EVENTS = 1000;
const MARKET_FETCH_TIMEOUT_MS = 15_000;

// ============================================================================
// Emergency Pause & Starvation Policy Constants (T5)
// ============================================================================

/** Maximum time allowed for flattening attempt before forced-unwind triggers (ms)
 *  Default: 1 hour - if book cannot be flattened within this window, starvation
 *  protocol engages forced-unwind with slippage caps
 */
export const MAX_FLATTENING_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Maximum slippage allowed for forced-unwind before emergency pause triggers
 *  Default: 5% - if unwind would incur >5% slippage, pause instead of unsafe unwind
 */
export const DEFAULT_FORCE_UNWIND_SLIPPAGE_CAP = 0.05; // 5%

/** Maximum consecutive slippage breaches before emergency pause triggers */
export const MAX_SLIPPAGE_BREACH_COUNT = 3;

/** Vault operational states for starvation/emergency handling */
export type VaultOperationalState =
  | "normal" // Normal trading operations
  | "flattening" // Book flattening in progress
  | "forced_unwind" // Forced unwind due to timeout
  | "emergency_paused" // Emergency pause - manual recovery required
  | "settling" // Settlement in progress
  | "settled"; // Settlement complete, vault flat

/** Flattening attempt tracking */
export interface FlatteningAttempt {
  vaultId: number;
  startedAt: Date;
  expectedDeadline: Date;
  status: "in_progress" | "timeout" | "completed" | "failed";
  blockingConditions: string[];
  timeoutTriggered: boolean;
  slippageBreaches: number;
  lastSlippagePercent: number;
}

/** Emergency pause state */
export interface EmergencyPauseState {
  isPaused: boolean;
  pausedAt: Date | null;
  reason: string | null;
  triggeredBy: "timeout" | "slippage" | "operator" | "system" | null;
  recoveryAction?: string;
}

/** Vault policy configuration for timeout/slippage/emergency handling */
export interface VaultPolicyConfig {
  /** Maximum flattening window in milliseconds */
  maxFlatteningWindowMs: number;
  /** Slippage cap for forced unwind (0.05 = 5%) */
  forceUnwindSlippageCap: number;
  /** Maximum consecutive slippage breaches before emergency pause */
  maxSlippageBreachCount: number;
  /** Whether to allow operator override of emergency pause */
  allowOperatorOverride: boolean;
}

interface GammaToken {
  token_id?: string;
  tokenId?: string;
  outcome?: string;
  price?: string | number | null;
  bestAsk?: string | number | null;
  best_ask?: string | number | null;
  bestBid?: string | number | null;
  best_bid?: string | number | null;
  liquidity?: string | number | null;
  volume?: string | number | null;
}

interface GammaEventTag {
  slug?: string;
  label?: string;
}

interface GammaEvent {
  id?: string;
  slug?: string;
  title?: string;
  endDate?: string;
  markets?: GammaMarket[];
  tags?: GammaEventTag[];
}

export interface GammaMarket {
  id: string;
  question?: string;
  slug?: string;
  conditionId?: string;
  condition_id?: string;
  endDate?: string;
  end_date_iso?: string;
  tags?: Array<{ slug?: string; label?: string } | string>;
  tokens?: GammaToken[];
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
}

export interface MarketFetchConfig {
  maxEvents: number;
}

export interface TradeCandidate {
  marketId: string;
  marketQuestion: string;
  conditionId: string;
  tokenId: string;
  outcome: "YES" | "NO";
  side: "buy";
  price: number;
  size: number;
  cost: number;
  closesAt: Date;
  hoursUntilClose: number;
  probability: number;
  pphScore: number;
  expectedProfit: number;
  projectedDeployedRatio: number;
}

export interface OrchestratorTradeRequest extends TradeRequest {
  conditionId: string;
  outcome: "YES" | "NO";
  marketQuestion?: string;
  closesAt?: Date;
}

export interface TradeExecutionResult {
  success: boolean;
  simulated: boolean;
  orderId?: string;
  positionId?: number;
  allocatedAmount?: number;
  navUpdated?: boolean;
  error?: string;
}

interface CircuitBreakerStatus {
  canTrade: boolean;
  reason?: string;
  todayRealizedPnl: number;
  openPositions: number;
}

interface ScanFunnelStats {
  processed: number;
  candidates: number;
  rejectedExistingPosition: number;
  rejectedMissingCloseTime: number;
  rejectedAlreadyClosed: number;
  rejectedTooFarOut: number;
  rejectedInvalidTokens: number;
  rejectedInvalidPricing: number;
  rejectedStrategy: number;
  rejectedNoProfit: number;
  rejectedDeployedRatio: number;
  rejectedEpochBoundary: number;
}

export class TradingOrchestratorService {
  private readonly vaultConfig: VaultInstanceConfig | null;

  // Strategy params — from VaultInstanceConfig when available, else env fallbacks
  private readonly minOdds: number;
  private readonly maxOdds: number;
  private readonly highOddsThreshold: number;
  private readonly maxHoursGeneral: number;
  private readonly maxHoursForHighOdds: number;
  private readonly betSize: number;
  private readonly dailyLossLimitUsd: number;
  private readonly maxTradesPerScan: number;
  private readonly categoryTimeLimits: Record<string, number>;
  private readonly skipCategories: string[];
  private readonly deployedRatioLimit: number;
  private readonly marketFetchConfig: MarketFetchConfig;
  private readonly epochBoundarySafetyBufferMinutes: number;

  private getVaultAddress(): string {
    if (!this.vaultConfig) {
      throw new Error("TradingOrchestrator: vault config is required");
    }
    return this.vaultConfig.vaultAddress;
  }

  private readonly mode: "simulation" | "live";
  private readonly tradingClient: VaultTradingClient;
  private readonly resolvedIdentity: ResolvedVaultIdentity | null;
  private readonly navOraclePusher: {
    calculateAndPushNav: () => Promise<{ updatedOnChain: boolean }>;
  } | null;
  private safeWalletService: SafeWalletService | null = null;
  private lastScanAt: Date | undefined;

  // ============================================================================
  // Starvation Policy & Emergency Pause State (T5)
  // ============================================================================

  private vaultOperationalState: VaultOperationalState = "normal";
  private currentFlatteningAttempt: FlatteningAttempt | null = null;
  private emergencyPauseState: EmergencyPauseState = {
    isPaused: false,
    pausedAt: null,
    reason: null,
    triggeredBy: null,
  };
  private readonly vaultPolicyConfig: VaultPolicyConfig;
  private settlementInProgress: boolean = false;

  constructor(
    config?: VaultInstanceConfig,
    tradingClient: VaultTradingClient = getVaultTradingClient(),
    navOraclePusher: {
      calculateAndPushNav: () => Promise<{ updatedOnChain: boolean }>;
    } | null = null,
    resolvedIdentity?: ResolvedVaultIdentity,
  ) {
    this.vaultConfig = config ?? null;
    this.tradingClient = tradingClient;
    this.resolvedIdentity = resolvedIdentity ?? null;
    this.navOraclePusher = navOraclePusher ?? null;

    if (config) {
      // Config-driven: all params from VaultInstanceConfig
      this.minOdds = config.minOdds ?? 0.95;
      this.maxOdds = config.maxOdds ?? 0.995;
      this.highOddsThreshold = config.highOddsThreshold ?? 0.99;
      this.maxHoursGeneral = config.maxHoursGeneral ?? 24;
      this.maxHoursForHighOdds = config.maxHoursForHighOdds ?? 6;
      this.betSize = config.betSize;
      this.dailyLossLimitUsd = config.maxDailyLoss ?? Infinity;
      this.maxTradesPerScan = 3; // Could add to config later
      this.categoryTimeLimits = config.categoryTimeLimits ?? {};
      this.skipCategories = config.skipCategories ?? [];
      this.maxOdds = config.maxOdds ?? 0.995;
      this.highOddsThreshold = config.highOddsThreshold ?? 0.99;
      this.maxHoursGeneral = config.maxHoursGeneral ?? 24;
      this.maxHoursForHighOdds = config.maxHoursForHighOdds ?? 6;
      this.betSize = config.betSize;
      this.dailyLossLimitUsd = config.maxDailyLoss ?? Infinity;
      this.maxTradesPerScan = 3; // Could add to config later
      this.categoryTimeLimits = config.categoryTimeLimits ?? {};
      this.skipCategories = config.skipCategories ?? [];
      this.mode = env.VAULT_MODE;
      this.mode = env.VAULT_MODE;
      this.deployedRatioLimit = config.maxDeployedRatio;
      this.epochBoundarySafetyBufferMinutes = config.epochBoundarySafetyBufferMinutes ?? 0;
      this.marketFetchConfig = {
        maxEvents: config.marketFetchMaxEvents,
      };
      this.vaultPolicyConfig = {
        maxFlatteningWindowMs: config.maxFlatteningWindowMs ?? MAX_FLATTENING_WINDOW_MS,
        forceUnwindSlippageCap: config.forceUnwindSlippageCap ?? DEFAULT_FORCE_UNWIND_SLIPPAGE_CAP,
        maxSlippageBreachCount: config.maxSlippageBreachCount ?? MAX_SLIPPAGE_BREACH_COUNT,
        allowOperatorOverride:
          config.allowOperatorOverride ?? process.env.VAULT_ALLOW_OPERATOR_OVERRIDE === "true",
      };
    } else {
      // Legacy: env-var fallbacks for backward compatibility
      this.minOdds = this.numberFromEnv("VAULT_MIN_ODDS", 0.95);
      this.maxOdds = this.numberFromEnv("VAULT_MAX_ODDS", 0.995);
      this.highOddsThreshold = this.numberFromEnv("VAULT_HIGH_ODDS_THRESHOLD", 0.99);
      this.maxHoursGeneral = this.numberFromEnv("VAULT_MAX_HOURS_GENERAL", 24);
      this.maxHoursForHighOdds = this.numberFromEnv("VAULT_MAX_HOURS_HIGH_ODDS", 6);
      this.betSize = this.numberFromEnv("VAULT_TARGET_NOTIONAL", 5);
      this.dailyLossLimitUsd = this.numberFromEnv("VAULT_DAILY_LOSS_LIMIT", 100);
      this.maxTradesPerScan = this.intFromEnv("VAULT_MAX_TRADES_PER_SCAN", 3);
      this.categoryTimeLimits = {};
      this.skipCategories = [];
      this.mode = env.VAULT_MODE;
      this.deployedRatioLimit = DEFAULT_MAX_DEPLOYED_RATIO;
      this.epochBoundarySafetyBufferMinutes = 0;
      this.marketFetchConfig = {
        maxEvents: DEFAULT_MARKET_MAX_EVENTS,
      };
      this.vaultPolicyConfig = {
        maxFlatteningWindowMs: MAX_FLATTENING_WINDOW_MS,
        forceUnwindSlippageCap: DEFAULT_FORCE_UNWIND_SLIPPAGE_CAP,
        maxSlippageBreachCount: MAX_SLIPPAGE_BREACH_COUNT,
        allowOperatorOverride: process.env.VAULT_ALLOW_OPERATOR_OVERRIDE === "true",
      };
    }
  }

  async scanAndEvaluate(markets: GammaMarket[]): Promise<TradeCandidate[]> {
    const status = await this.getVaultStatus();
    const opportunities: TradeCandidate[] = [];
    const stats: ScanFunnelStats = {
      processed: 0,
      candidates: 0,
      rejectedExistingPosition: 0,
      rejectedMissingCloseTime: 0,
      rejectedAlreadyClosed: 0,
      rejectedTooFarOut: 0,
      rejectedInvalidTokens: 0,
      rejectedInvalidPricing: 0,
      rejectedStrategy: 0,
      rejectedNoProfit: 0,
      rejectedDeployedRatio: 0,
      rejectedEpochBoundary: 0,
    };

    const epochTradingDeadline = await this.getEpochTradingDeadline();

    logger.info("TradingOrchestrator: evaluating markets", {
      vaultId: this.vaultConfig?.id,
      markets: markets.length,
      deployedRatio: status.deployedRatio,
      limit: this.deployedRatioLimit,
      totalAssets: status.nav.totalAssets,
      safeBalance: status.safeBalance,
    });

    if (status.deployedRatio >= this.deployedRatioLimit) {
      logger.warn("TradingOrchestrator: deployed ratio at/above limit", {
        vaultId: this.vaultConfig?.id,
        deployedRatio: status.deployedRatio,
        limit: this.deployedRatioLimit,
      });
      return [];
    }

    const existingPositions = await positionRepository.getOpenPositions(this.getVaultAddress());
    const existingMarketIds = new Set(existingPositions.map((p) => p.marketId));

    for (const market of markets) {
      stats.processed += 1;
      const evaluation = this.evaluateMarket(
        market,
        status.deployedRatio,
        status.nav.totalAssets,
        existingMarketIds,
        epochTradingDeadline,
      );
      if (evaluation.candidate) {
        opportunities.push(evaluation.candidate);
        stats.candidates += 1;
      } else {
        switch (evaluation.rejectReason) {
          case "existing_position":
            stats.rejectedExistingPosition += 1;
            break;
          case "missing_close_time":
            stats.rejectedMissingCloseTime += 1;
            break;
          case "already_closed":
            stats.rejectedAlreadyClosed += 1;
            break;
          case "too_far_out":
            stats.rejectedTooFarOut += 1;
            break;
          case "invalid_tokens":
            stats.rejectedInvalidTokens += 1;
            break;
          case "invalid_pricing":
            stats.rejectedInvalidPricing += 1;
            break;
          case "strategy_rejected":
            stats.rejectedStrategy += 1;
            break;
          case "no_profit":
            stats.rejectedNoProfit += 1;
            break;
          case "deployed_ratio":
            stats.rejectedDeployedRatio += 1;
            break;
          case "epoch_boundary":
            stats.rejectedEpochBoundary += 1;
            break;
          default:
            break;
        }
      }
    }

    opportunities.sort((a, b) => b.pphScore - a.pphScore);

    if (opportunities.length === 0) {
      logger.warn("TradingOrchestrator: no candidates after filters", {
        vaultId: this.vaultConfig?.id,
        markets: markets.length,
        processed: stats.processed,
        minOdds: this.minOdds,
        maxOdds: this.maxOdds,
        maxHoursGeneral: this.maxHoursGeneral,
        maxHoursForHighOdds: this.maxHoursForHighOdds,
        highOddsThreshold: this.highOddsThreshold,
        skipCategories: this.skipCategories,
        funnel: stats,
      });
    } else {
      logger.info("TradingOrchestrator: scan funnel", {
        vaultId: this.vaultConfig?.id,
        markets: markets.length,
        funnel: stats,
      });
    }

    return opportunities;
  }

  async executeTrade(tradeRequest: OrchestratorTradeRequest): Promise<TradeExecutionResult> {
    const tradeCost = Math.max(0, tradeRequest.price * tradeRequest.size);

    if (tradeCost <= 0) {
      return {
        success: false,
        simulated: this.mode === "simulation",
        error: "Trade cost must be positive",
      };
    }

    if (tradeCost > this.betSize) {
      return {
        success: false,
        simulated: this.mode === "simulation",
        error: `Trade size ${tradeCost.toFixed(4)} exceeds bet size ${this.betSize.toFixed(4)}`,
      };
    }

    const breaker = await this.getCircuitBreakerStatus();
    if (!breaker.canTrade) {
      return { success: false, simulated: this.mode === "simulation", error: breaker.reason };
    }

    const status = await this.getVaultStatus();
    const navBase = Math.max(status.nav.totalAssets, tradeCost);
    const projectedRatio = status.deployedRatio + tradeCost / navBase;
    if (projectedRatio > this.deployedRatioLimit) {
      return {
        success: false,
        simulated: this.mode === "simulation",
        error: `Projected deployed ratio ${projectedRatio.toFixed(4)} exceeds max ${this.deployedRatioLimit.toFixed(4)}`,
      };
    }

    if (this.mode === "simulation") {
      logger.info("TradingOrchestrator: simulation trade", {
        vaultId: this.vaultConfig?.id,
        marketId: tradeRequest.marketId,
        tokenId: tradeRequest.tokenId,
        side: tradeRequest.side,
        price: tradeRequest.price,
        size: tradeRequest.size,
        cost: tradeCost,
      });
      return { success: true, simulated: true };
    }

    try {
      if (tradeRequest.closesAt) {
        const epochTradingDeadline = await this.getEpochTradingDeadline();
        if (
          epochTradingDeadline &&
          tradeRequest.closesAt.getTime() > epochTradingDeadline.getTime()
        ) {
          return {
            success: false,
            simulated: false,
            error: `Trade closes after the current epoch boundary (${epochTradingDeadline.toISOString()}).`,
          };
        }
      }

      const safeBalance = await this.getSafeBalanceUsdc();
      const allocatedAmount = 0;

      if (safeBalance + 1e-9 < tradeCost) {
        return {
          success: false,
          simulated: false,
          error: `Insufficient Safe balance for trade. Need ${tradeCost.toFixed(6)} USDC, have ${safeBalance.toFixed(6)} USDC`,
        };
      }

      await this.ensureTradingClientInitialized();
      const tradeResult = await this.tradingClient.createOrder(
        tradeRequest.tokenId,
        tradeRequest.side,
        tradeRequest.price,
        tradeRequest.size,
      );

      if (!tradeResult.success || !tradeResult.orderId) {
        return {
          success: false,
          simulated: false,
          allocatedAmount,
          error: tradeResult.error || "Order failed",
        };
      }

      const avgPrice = tradeResult.avgPrice ?? tradeRequest.price;
      const filledSize = tradeResult.filledSize ?? tradeRequest.size;
      const costBasis = avgPrice * filledSize;

      const position = await positionRepository.createPosition({
        positionId: `pos-${Date.now()}-${randomUUID()}`,
        vaultAddress: this.getVaultAddress(),
        marketId: tradeRequest.marketId,
        conditionId: tradeRequest.conditionId,
        tokenId: tradeRequest.tokenId,
        outcome: tradeRequest.outcome,
        costBasis: costBasis.toFixed(6),
        quantity: filledSize.toFixed(6),
      });

      await positionRepository.recordTrade({
        tradeId: `trade-${Date.now()}-${randomUUID()}`,
        positionId: position.id,
        orderId: tradeResult.orderId,
        side: tradeRequest.side,
        price: avgPrice.toFixed(6),
        size: tradeRequest.size.toFixed(6),
        filledSize: filledSize.toFixed(6),
        status: tradeResult.filledSize ? "filled" : "pending",
      });

      const navUpdate = await this.pushNav();

      logger.info("TradingOrchestrator: trade executed", {
        vaultId: this.vaultConfig?.id,
        marketId: tradeRequest.marketId,
        marketQuestion: tradeRequest.marketQuestion,
        orderId: tradeResult.orderId,
        tokenId: tradeRequest.tokenId,
        outcome: tradeRequest.outcome,
        side: tradeRequest.side,
        requestedPrice: tradeRequest.price,
        requestedSize: tradeRequest.size,
        avgPrice,
        filledSize,
        costBasis,
        allocatedAmount,
        navUpdated: navUpdate,
      });

      return {
        success: true,
        simulated: false,
        orderId: tradeResult.orderId,
        positionId: position.id,
        allocatedAmount,
        navUpdated: navUpdate,
      };
    } catch (error) {
      return {
        success: false,
        simulated: false,
        error: (error as Error).message,
      };
    }
  }

  async getVaultStatus(): Promise<VaultStatus> {
    const [openPositions, safeBalance] = await Promise.all([
      positionRepository.getOpenPositions(this.getVaultAddress()),
      this.getSafeBalanceUsdc(),
    ]);

    const positionCostBasis = openPositions.reduce(
      (sum, pos) => sum + parseFloat(pos.costBasis),
      0,
    );
    const deployedCostBasis = positionCostBasis;
    const idleAssets = Math.max(safeBalance, 0);
    const nav = navCalculator.calculateNav(
      idleAssets,
      deployedCostBasis,
      deployedCostBasis,
      0,
      openPositions.length,
    );
    const deployedRatio = nav.totalAssets > 0 ? deployedCostBasis / nav.totalAssets : 0;

    return {
      nav,
      positionCount: openPositions.length,
      deployedRatio,
      safeBalance,
      lastScanAt: this.lastScanAt,
      mode: this.mode,
    };
  }

  async runScanCycle(preloadedMarkets?: GammaMarket[]): Promise<TradeExecutionResult[]> {
    if (this.vaultConfig) {
      const pendingWithdrawals = await withdrawalRepository.getPendingRequests(
        this.vaultConfig.vaultAddress,
      );
      if (pendingWithdrawals.length > 0) {
        logger.warn("TradingOrchestrator: scan skipped due to pending withdrawal queue", {
          vaultId: this.vaultConfig.id,
          pending: pendingWithdrawals.length,
        });
        return [];
      }
    }

    const breaker = await this.getCircuitBreakerStatus();
    if (!breaker.canTrade) {
      logger.warn("TradingOrchestrator: scan skipped by circuit breaker", {
        vaultId: this.vaultConfig?.id,
        reason: breaker.reason,
        todayRealizedPnl: breaker.todayRealizedPnl,
        openPositions: breaker.openPositions,
      });
      return [];
    }
    // Check vault operational state (T6: close-on-flat gating)
    const tradeCheck = this.canTrade();
    if (!tradeCheck.allowed) {
      logger.warn("TradingOrchestrator: scan skipped - trading halted", {
        vaultId: this.vaultConfig?.id,
        operationalState: this.vaultOperationalState,
        reason: tradeCheck.reason,
      });
      return [];
    }

    const markets = preloadedMarkets ?? (await this.fetchMarkets());
    const candidates = await this.scanAndEvaluate(markets);
    const selected = candidates.slice(0, this.maxTradesPerScan);

    const results: TradeExecutionResult[] = [];
    for (const candidate of selected) {
      const result = await this.executeTrade({
        marketId: candidate.marketId,
        conditionId: candidate.conditionId,
        tokenId: candidate.tokenId,
        side: candidate.side,
        price: candidate.price,
        size: candidate.size,
        outcome: candidate.outcome,
        marketQuestion: candidate.marketQuestion,
        closesAt: candidate.closesAt,
      });
      results.push(result);
    }

    if (this.mode === "live") {
      await this.pushNav();
    } else {
      logger.info("TradingOrchestrator: simulation mode, NAV push skipped");
    }

    this.lastScanAt = new Date();

    logger.info("TradingOrchestrator: scan cycle complete", {
      vaultId: this.vaultConfig?.id,
      markets: markets.length,
      candidates: candidates.length,
      executed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      mode: this.mode,
    });

    return results;
  }

  private evaluateMarket(
    market: GammaMarket,
    currentDeployedRatio: number,
    totalAssets: number,
    existingMarketIds: Set<string>,
    epochTradingDeadline: Date | null,
  ): { candidate: TradeCandidate | null; rejectReason?: string } {
    // Skip markets we already have positions in
    if (existingMarketIds.has(market.id)) {
      return { candidate: null, rejectReason: "existing_position" };
    }

    const closesAtRaw = market.endDate ?? market.end_date_iso;
    if (!closesAtRaw) {
      return { candidate: null, rejectReason: "missing_close_time" };
    }

    const closesAt = new Date(closesAtRaw);
    const hoursUntilClose = (closesAt.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilClose <= 0) {
      return { candidate: null, rejectReason: "already_closed" };
    }
    if (hoursUntilClose > this.maxHoursGeneral) {
      return { candidate: null, rejectReason: "too_far_out" };
    }
    if (epochTradingDeadline && closesAt.getTime() > epochTradingDeadline.getTime()) {
      return { candidate: null, rejectReason: "epoch_boundary" };
    }

    const tokens = Array.isArray(market.tokens) ? market.tokens : [];
    if (tokens.length !== 2) {
      return { candidate: null, rejectReason: "invalid_tokens" };
    }

    const normalized = tokens
      .map((token) => {
        const midPrice = this.toNumber(token.price);
        const bestAsk = this.toNumber(token.bestAsk ?? token.best_ask) || midPrice;
        const bestBid = this.toNumber(token.bestBid ?? token.best_bid);
        const liquidity = this.toNumber(token.liquidity ?? token.volume);

        return {
          tokenId: token.token_id ?? token.tokenId ?? "",
          outcomeName: (token.outcome || "").toUpperCase(),
          probability: midPrice,
          bestAsk,
          bestBid,
          liquidity,
        };
      })
      .filter((token) => token.tokenId && token.bestAsk > 0);

    if (normalized.length !== 2) {
      return { candidate: null, rejectReason: "invalid_pricing" };
    }

    const likely =
      normalized[0]!.probability >= normalized[1]!.probability ? normalized[0]! : normalized[1]!;
    const buyPrice = likely.bestAsk;
    const tags = this.extractTagSlugs(market.tags);

    // Use ported strategy validation when config is available
    if (this.vaultConfig) {
      const validation = isValidOpportunity(buyPrice, hoursUntilClose, this.vaultConfig, tags);
      if (!validation.valid) {
        return { candidate: null, rejectReason: "strategy_rejected" };
      }
    } else {
      // Legacy: inline bounds check
      if (!this.isWithinStrategyBounds(buyPrice, hoursUntilClose, tags)) {
        return { candidate: null, rejectReason: "strategy_rejected" };
      }
    }

    const expectedProfit = calculateExpectedProfit(buyPrice);
    if (expectedProfit <= 0) {
      return { candidate: null, rejectReason: "no_profit" };
    }

    const pphScore = calculatePPH(buyPrice, hoursUntilClose);
    const notional = this.betSize;
    const size = notional / buyPrice;
    const projectedRatio =
      currentDeployedRatio +
      notional / Math.max(totalAssets > 0 ? totalAssets : notional, notional);
    if (projectedRatio > this.deployedRatioLimit) {
      return { candidate: null, rejectReason: "deployed_ratio" };
    }

    const conditionId = market.conditionId ?? market.condition_id ?? market.id;
    const outcome = likely.outcomeName.includes("NO") ? "NO" : "YES";

    return {
      candidate: {
        marketId: market.id,
        marketQuestion: market.question || market.id,
        conditionId,
        tokenId: likely.tokenId,
        outcome,
        side: "buy",
        price: buyPrice,
        size,
        cost: notional,
        closesAt,
        hoursUntilClose,
        probability: likely.probability,
        pphScore,
        expectedProfit,
        projectedDeployedRatio: projectedRatio,
      },
    };
  }

  /**
   * Legacy inline strategy bounds check (used when no VaultInstanceConfig).
   * When config is available, isValidOpportunity() from strategyEngine is used instead.
   */
  private isWithinStrategyBounds(
    buyPrice: number,
    hoursUntilClose: number,
    tags: string[],
  ): boolean {
    if (buyPrice < this.minOdds || buyPrice >= this.maxOdds) return false;
    if (buyPrice >= this.highOddsThreshold && hoursUntilClose > this.maxHoursForHighOdds)
      return false;

    const categoryLimit = this.getCategoryMaxHours(tags);
    if (hoursUntilClose > categoryLimit) return false;

    return true;
  }

  private getCategoryMaxHours(tags: string[]): number {
    if (Object.keys(this.categoryTimeLimits).length > 0) {
      let limit = this.maxHoursGeneral;
      for (const tag of tags) {
        const value = this.categoryTimeLimits[tag];
        if (typeof value === "number" && value < limit) {
          limit = value;
        }
      }
      return limit;
    }

    // Legacy: env-var fallback
    const rawConfig = process.env.VAULT_CATEGORY_TIME_LIMITS;
    if (!rawConfig) return this.maxHoursGeneral;

    try {
      const parsed = JSON.parse(rawConfig) as Record<string, number>;
      let limit = this.maxHoursGeneral;
      for (const tag of tags) {
        const value = parsed[tag];
        if (typeof value === "number" && value < limit) {
          limit = value;
        }
      }
      return limit;
    } catch {
      return this.maxHoursGeneral;
    }
  }

  private extractTagSlugs(tags: GammaMarket["tags"]): string[] {
    if (!tags) return [];

    const slugs: string[] = [];
    for (const tag of tags) {
      if (typeof tag === "string") {
        slugs.push(tag.toLowerCase());
      } else if (tag.slug) {
        slugs.push(tag.slug.toLowerCase());
      } else if (tag.label) {
        slugs.push(tag.label.toLowerCase());
      }
    }

    return slugs;
  }

  async fetchMarkets(): Promise<GammaMarket[]> {
    return fetchGammaMarkets(this.marketFetchConfig);
  }

  private async getEpochTradingDeadline(): Promise<Date | null> {
    if (
      !this.vaultConfig ||
      this.vaultConfig.type !== "custom" ||
      !this.vaultConfig.enforceEpochBoundarySafety
    ) {
      return null;
    }

    const provider = getVaultProvider(this.vaultConfig.id);
    const vaultInfo = await provider.getVaultInfo();
    const currentBatchEnd = vaultInfo.batchInfo?.currentBatchEnd;
    if (!currentBatchEnd) {
      return null;
    }

    return new Date(currentBatchEnd.getTime() - this.epochBoundarySafetyBufferMinutes * 60 * 1000);
  }

  private async getCircuitBreakerStatus(): Promise<CircuitBreakerStatus> {
    const [todayRealizedPnl, openPositions] = await Promise.all([
      this.getTodayRealizedPnl(),
      positionRepository.getOpenPositions(this.getVaultAddress()),
    ]);

    const maxPositions = this.vaultConfig ? 20 : this.intFromEnv("VAULT_MAX_POSITIONS", 20);

    if (
      Number.isFinite(this.dailyLossLimitUsd) &&
      todayRealizedPnl <= -Math.abs(this.dailyLossLimitUsd)
    ) {
      return {
        canTrade: false,
        reason: `Daily loss limit reached (${todayRealizedPnl.toFixed(4)} <= -${Math.abs(this.dailyLossLimitUsd).toFixed(4)})`,
        todayRealizedPnl,
        openPositions: openPositions.length,
      };
    }

    if (openPositions.length >= maxPositions) {
      return {
        canTrade: false,
        reason: `Max positions reached (${openPositions.length}/${maxPositions})`,
        todayRealizedPnl,
        openPositions: openPositions.length,
      };
    }

    return { canTrade: true, todayRealizedPnl, openPositions: openPositions.length };
  }

  private async getTodayRealizedPnl(): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    const rows = await db
      .select({ total: sql<string>`coalesce(sum(${vaultPositions.resolvedPnl}::numeric), 0)` })
      .from(vaultPositions)
      .where(
        and(
          eq(vaultPositions.vaultAddress, this.getVaultAddress()),
          gte(vaultPositions.resolvedAt, start),
          isNotNull(vaultPositions.resolvedPnl),
        ),
      );

    return this.toNumber(rows[0]?.total);
  }

  private async getSafeBalanceUsdc(): Promise<number> {
    try {
      const service = this.getSafeWalletService();
      const raw = await service.getBalance(USDC_E_ADDRESS);
      return Number(raw) / USDC_DECIMALS;
    } catch {
      return 0;
    }
  }

  private getSafeWalletService(): SafeWalletService {
    if (!this.safeWalletService) {
      if (!this.vaultConfig) {
        throw new Error("TradingOrchestrator: vaultConfig is required for SafeWalletService");
      }
      const privateKey = process.env[this.vaultConfig.safeOperatorKeyEnv] ?? "";
      const tradingSafeAddress =
        this.vaultConfig.tradingSafeAddress ?? this.vaultConfig.safeAddress;
      this.safeWalletService = new SafeWalletService(tradingSafeAddress, privateKey);
    }
    return this.safeWalletService;
  }

  private async ensureTradingClientInitialized(): Promise<void> {
    if (!this.tradingClient.isInitialized()) {
      await this.tradingClient.initialize();
    }
  }

  private async pushNav(): Promise<boolean> {
    if (this.mode !== "live") return false;

    if (this.navOraclePusher) {
      const result = await this.navOraclePusher.calculateAndPushNav();
      return result.updatedOnChain;
    }

    const navOracleModule = (await import("./navOracle.js")) as {
      navOracle: { calculateAndPushNav: () => Promise<{ updatedOnChain: boolean }> };
    };
    const result = await navOracleModule.navOracle.calculateAndPushNav();
    return result.updatedOnChain;
  }

  private toNumber(value: string | number | null | undefined): number {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private numberFromEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private intFromEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  // ============================================================================
  // Flatness Checks
  // ============================================================================

  /**
   * Check if the vault is in a "flat" state - ready for settlement.
   *
   * A vault is considered flat when all five conditions are met:
   * 1. Zero open Polymarket positions
   * 2. Zero resting orders on CLOB
   * 3. deployedCapital == 0
   * 4. Zero non-dust CTF token balances
   * 5. Successful reconciliation pass
   */
  async checkFlatness(): Promise<FlatnessCheckResult> {
    if (!this.vaultConfig) {
      throw new Error("TradingOrchestrator: vaultConfig is required for flatness check");
    }

    const flatnessDetector = new FlatnessDetector({}, this.tradingClient);
    const tradingSafeAddress = this.vaultConfig.tradingSafeAddress ?? this.vaultConfig.safeAddress;
    return flatnessDetector.checkFlatness(this.vaultConfig, tradingSafeAddress);
  }

  /**
   * Quick check if vault is flat (returns boolean only).
   */
  async isFlat(): Promise<boolean> {
    const result = await this.checkFlatness();
    return result.isFlat;
  }

  /**
   * Check if vault is NOT flat and return blocking conditions.
   * Useful for pre-trade checks to avoid trading when settlement is pending.
   */
  async getFlatnessBlockingConditions(): Promise<string[]> {
    const result = await this.checkFlatness();
    return result.blockingConditions;
  }

  // ============================================================================
  // Close-on-Flat Automation (T6)
  // ============================================================================

  /**
   * Cancel all resting orders on the CLOB.
   *
   * This is a critical step before settlement - all open orders must be
   * cancelled to achieve flatness condition #2 (zero resting orders).
   *
   * @returns Result of cancellation attempt
   */
  async cancelAllRestingOrders(): Promise<{
    success: boolean;
    cancelledCount: number;
    error?: string;
  }> {
    if (!this.tradingClient.isInitialized()) {
      await this.tradingClient.initialize();
    }

    try {
      const result = await this.tradingClient.cancelAllOrders();

      if (result.success) {
        logger.info("TradingOrchestrator: All resting orders cancelled", {
          vaultId: this.vaultConfig?.id,
        });
        return { success: true, cancelledCount: 0 }; // CLOB client doesn't return count
      } else {
        logger.error("TradingOrchestrator: Failed to cancel resting orders", {
          vaultId: this.vaultConfig?.id,
          error: result.error,
        });
        return { success: false, cancelledCount: 0, error: result.error };
      }
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("TradingOrchestrator: Exception cancelling resting orders", {
        vaultId: this.vaultConfig?.id,
        error: errorMsg,
      });
      return { success: false, cancelledCount: 0, error: errorMsg };
    }
  }

  /**
   * Check if trading should be halted due to batch state.
   *
   * Trading is halted when:
   * - Emergency pause is active
   * - Settlement is in progress
   * - Flattening is in progress (not timed out)
   * - Forced unwind is in progress
   *
   * @returns Object with allowed flag and reason if blocked
   */
  canTrade(): { allowed: boolean; reason?: string } {
    // Reuse canReopen logic which covers the same conditions
    return this.canReopen();
  }

  /**
   * Initiate the close-on-flat sequence when a batch is sealed.
   *
   * This method:
   * 1. Transitions vault to 'flattening' state
   * 2. Cancels all resting orders
   * 3. Begins monitoring for flatness
   * 4. Will trigger settlement only after flatness is achieved
   *
   * @returns Result of initiation
   */
  async initiateCloseOnFlat(): Promise<{
    success: boolean;
    ordersCancelled: boolean;
    flatnessCheck: FlatnessCheckResult | null;
    error?: string;
  }> {
    if (!this.vaultConfig) {
      return {
        success: false,
        ordersCancelled: false,
        flatnessCheck: null,
        error: "Vault config required for close-on-flat",
      };
    }

    logger.info("TradingOrchestrator: Initiating close-on-flat sequence", {
      vaultId: this.vaultConfig.id,
      currentState: this.vaultOperationalState,
    });

    // Step 1: Start flattening attempt (sets state to 'flattening')
    this.startFlatteningAttempt();

    // Step 2: Cancel all resting orders immediately
    const cancelResult = await this.cancelAllRestingOrders();
    if (!cancelResult.success) {
      logger.error("TradingOrchestrator: Failed to cancel orders during close-on-flat", {
        vaultId: this.vaultConfig.id,
        error: cancelResult.error,
      });
      // Continue with flatness check even if cancellation fails -
      // it may be a transient error or there may be no orders
    }

    // Step 3: Check flatness
    const flatnessCheck = await this.checkFlatness();

    // Step 4: Update flattening progress with current blocking conditions
    if (!flatnessCheck.isFlat) {
      this.updateFlatteningProgress(flatnessCheck.blockingConditions);
      logger.info("TradingOrchestrator: Vault not yet flat, flattening in progress", {
        vaultId: this.vaultConfig.id,
        blockingConditions: flatnessCheck.blockingConditions,
      });
    } else {
      this.completeFlattening();
      logger.info("TradingOrchestrator: Vault is already flat", {
        vaultId: this.vaultConfig.id,
      });
    }

    return {
      success: true,
      ordersCancelled: cancelResult.success,
      flatnessCheck,
    };
  }

  /**
   * Check if settlement can proceed.
   *
   * Settlement is gated by:
   * 1. Vault must be in 'flattening' or 'forced_unwind' state (close-on-flat initiated)
   * 2. All five flatness conditions must pass
   * 3. No emergency pause active
   * 4. No settlement already in progress
   *
   * This prevents settlement from front-running the flatness check.
   *
   * @returns Object with allowed flag and details
   */
  async canProceedWithSettlement(): Promise<{
    allowed: boolean;
    reason?: string;
    flatnessCheck?: FlatnessCheckResult;
  }> {
    if (!this.vaultConfig) {
      return { allowed: false, reason: "Vault config required" };
    }

    // Check emergency pause
    if (this.emergencyPauseState.isPaused) {
      return {
        allowed: false,
        reason: `Emergency pause active: ${this.emergencyPauseState.reason}`,
      };
    }

    // Check if settlement already in progress
    if (this.settlementInProgress) {
      return { allowed: false, reason: "Settlement already in progress" };
    }

    // Check if close-on-flat has been initiated
    const validStatesForSettlement: VaultOperationalState[] = ["flattening", "forced_unwind"];
    if (!validStatesForSettlement.includes(this.vaultOperationalState)) {
      return {
        allowed: false,
        reason: `Invalid state for settlement: ${this.vaultOperationalState}. Must be in 'flattening' or 'forced_unwind' state.`,
      };
    }

    // Perform fresh flatness check
    const flatnessCheck = await this.checkFlatness();

    if (!flatnessCheck.isFlat) {
      return {
        allowed: false,
        reason: `Flatness check failed: ${flatnessCheck.blockingConditions.join(", ")}`,
        flatnessCheck,
      };
    }

    return { allowed: true, flatnessCheck };
  }

  /**
   * Poll for flatness with timeout.
   *
   * Used during the flattening phase to wait for positions to be closed
   * and capital to be recalled. Implements the starvation policy from T5.
   *
   * @param maxWaitMs Maximum time to wait for flatness
   * @param pollIntervalMs Interval between checks
   * @returns Result with flatness status
   */
  async waitForFlatness(
    maxWaitMs: number = this.vaultPolicyConfig.maxFlatteningWindowMs,
    pollIntervalMs: number = 5000,
  ): Promise<{
    success: boolean;
    flatnessCheck: FlatnessCheckResult | null;
    timedOut: boolean;
  }> {
    const startTime = Date.now();
    const deadline = startTime + maxWaitMs;

    logger.info("TradingOrchestrator: Waiting for flatness", {
      vaultId: this.vaultConfig?.id,
      maxWaitMs,
      pollIntervalMs,
    });

    while (Date.now() < deadline) {
      const flatnessCheck = await this.checkFlatness();

      if (flatnessCheck.isFlat) {
        logger.info("TradingOrchestrator: Flatness achieved", {
          vaultId: this.vaultConfig?.id,
          elapsedMs: Date.now() - startTime,
        });
        return { success: true, flatnessCheck, timedOut: false };
      }

      // Update flattening progress
      this.updateFlatteningProgress(flatnessCheck.blockingConditions);

      // Check for timeout (starvation)
      if (this.hasFlatteningTimeout()) {
        logger.warn("TradingOrchestrator: Flattening timeout detected", {
          vaultId: this.vaultConfig?.id,
          elapsedMs: Date.now() - startTime,
        });
        return { success: false, flatnessCheck, timedOut: true };
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    logger.warn("TradingOrchestrator: Wait for flatness timed out", {
      vaultId: this.vaultConfig?.id,
      maxWaitMs,
    });

    return { success: false, flatnessCheck: null, timedOut: true };
  }

  // ============================================================================
  // Starvation Policy & Emergency Pause Methods (T5)
  // ============================================================================
  // Starvation Policy & Emergency Pause Methods (T5)
  // ============================================================================

  /**
   * Get the current vault operational state.
   *
   * This provides machine-readable status for monitoring and gating decisions.
   */
  getVaultOperationalState(): VaultOperationalState {
    return this.vaultOperationalState;
  }

  /**
   * Check if the vault is currently in emergency pause state.
   */
  isEmergencyPaused(): boolean {
    return this.emergencyPauseState.isPaused;
  }

  /**
   * Get the current emergency pause state with details.
   */
  getEmergencyPauseState(): EmergencyPauseState {
    return { ...this.emergencyPauseState };
  }

  /**
   * Get the current flattening attempt, if any.
   */
  getCurrentFlatteningAttempt(): FlatteningAttempt | null {
    return this.currentFlatteningAttempt ? { ...this.currentFlatteningAttempt } : null;
  }

  /**
   * Start a flattening attempt with timeout tracking.
   *
   * This initiates the starvation protocol - if flattening exceeds
   * MAX_FLATTENING_WINDOW_MS, forced-unwind mode is triggered.
   */
  startFlatteningAttempt(): FlatteningAttempt {
    if (!this.vaultConfig) {
      throw new Error("TradingOrchestrator: vaultConfig is required to start flattening");
    }

    const now = new Date();
    const deadline = new Date(now.getTime() + this.vaultPolicyConfig.maxFlatteningWindowMs);

    this.currentFlatteningAttempt = {
      vaultId: this.vaultConfig.id,
      startedAt: now,
      expectedDeadline: deadline,
      status: "in_progress",
      blockingConditions: [],
      timeoutTriggered: false,
      slippageBreaches: 0,
      lastSlippagePercent: 0,
    };

    this.vaultOperationalState = "flattening";

    logger.info("TradingOrchestrator: Flattening attempt started", {
      vaultId: this.vaultConfig.id,
      startedAt: now.toISOString(),
      expectedDeadline: deadline.toISOString(),
      maxFlatteningWindowMs: this.vaultPolicyConfig.maxFlatteningWindowMs,
    });

    return { ...this.currentFlatteningAttempt };
  }

  /**
   * Update flattening attempt with current blocking conditions.
   */
  updateFlatteningProgress(blockingConditions: string[]): void {
    if (!this.currentFlatteningAttempt) {
      return;
    }

    this.currentFlatteningAttempt.blockingConditions = blockingConditions;

    // Check for timeout
    const now = new Date();
    if (
      now > this.currentFlatteningAttempt.expectedDeadline &&
      !this.currentFlatteningAttempt.timeoutTriggered
    ) {
      this.currentFlatteningAttempt.timeoutTriggered = true;
      this.currentFlatteningAttempt.status = "timeout";

      logger.warn("TradingOrchestrator: Flattening timeout triggered - starvation detected", {
        vaultId: this.vaultConfig?.id,
        startedAt: this.currentFlatteningAttempt.startedAt.toISOString(),
        expectedDeadline: this.currentFlatteningAttempt.expectedDeadline.toISOString(),
        blockingConditions,
      });

      // Transition to forced_unwind state
      this.vaultOperationalState = "forced_unwind";
    }
  }

  /**
   * Record a slippage breach during forced unwind.
   *
   * Returns true if the breach count exceeds the threshold (emergency pause should trigger).
   */
  recordSlippageBreach(slippagePercent: number): boolean {
    if (!this.currentFlatteningAttempt) {
      return false;
    }

    this.currentFlatteningAttempt.slippageBreaches++;
    this.currentFlatteningAttempt.lastSlippagePercent = slippagePercent;

    const shouldEmergencyPause =
      this.currentFlatteningAttempt.slippageBreaches >=
        this.vaultPolicyConfig.maxSlippageBreachCount ||
      slippagePercent > this.vaultPolicyConfig.forceUnwindSlippageCap;

    logger.warn("TradingOrchestrator: Slippage breach recorded", {
      vaultId: this.vaultConfig?.id,
      slippagePercent: `${(slippagePercent * 100).toFixed(2)}%`,
      breachCount: this.currentFlatteningAttempt.slippageBreaches,
      maxBreaches: this.vaultPolicyConfig.maxSlippageBreachCount,
      slippageCap: `${(this.vaultPolicyConfig.forceUnwindSlippageCap * 100).toFixed(2)}%`,
      shouldEmergencyPause,
    });

    if (shouldEmergencyPause) {
      this.triggerEmergencyPause(
        "slippage",
        `Slippage breach: ${(slippagePercent * 100).toFixed(2)}% exceeds cap`,
      );
    }

    return shouldEmergencyPause;
  }

  /**
   * Trigger emergency pause.
   *
   * Once triggered, reopen is blocked until manual recovery action is taken.
   */
  triggerEmergencyPause(
    triggeredBy: "timeout" | "slippage" | "operator" | "system",
    reason: string,
  ): void {
    this.emergencyPauseState = {
      isPaused: true,
      pausedAt: new Date(),
      reason,
      triggeredBy,
      recoveryAction:
        "Manual operator intervention required. Review blocking conditions and take recovery action.",
    };

    this.vaultOperationalState = "emergency_paused";

    logger.error("TradingOrchestrator: EMERGENCY PAUSE TRIGGERED", {
      vaultId: this.vaultConfig?.id,
      triggeredBy,
      reason,
      pausedAt: this.emergencyPauseState.pausedAt?.toISOString(),
    });
  }

  /**
   * Clear emergency pause (operator recovery action).
   *
   * Requires explicit operator action. Can only be called if:
   * - Operator override is enabled, OR
   * - The vault is confirmed to be in a safe state
   */
  async clearEmergencyPause(operatorId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.emergencyPauseState.isPaused) {
      return { success: false, error: "Vault is not in emergency pause state" };
    }

    // Verify operator override is allowed
    if (!this.vaultPolicyConfig.allowOperatorOverride) {
      // Even without override, we allow clearing if vault is flat
      const isCurrentlyFlat = await this.isFlat();
      if (!isCurrentlyFlat) {
        return {
          success: false,
          error: "Operator override disabled and vault is not flat. Cannot clear emergency pause.",
        };
      }
    }

    // Clear the pause
    this.emergencyPauseState = {
      isPaused: false,
      pausedAt: null,
      reason: null,
      triggeredBy: null,
    };

    this.vaultOperationalState = "normal";
    this.currentFlatteningAttempt = null;

    logger.info("TradingOrchestrator: Emergency pause cleared by operator", {
      vaultId: this.vaultConfig?.id,
      operatorId,
      clearedAt: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Check if reopen (trading) is currently allowed.
   *
   * Reopen is blocked if:
   * - Emergency pause is active
   * - Flattening is in progress and not timed out
   * - Settlement is in progress
   */
  canReopen(): { allowed: boolean; reason?: string } {
    // Emergency pause blocks everything
    if (this.emergencyPauseState.isPaused) {
      return {
        allowed: false,
        reason: `Emergency pause active: ${this.emergencyPauseState.reason}`,
      };
    }

    // Flattening in progress blocks reopen
    if (this.vaultOperationalState === "flattening" && this.currentFlatteningAttempt) {
      if (this.currentFlatteningAttempt.status === "in_progress") {
        return {
          allowed: false,
          reason: `Flattening in progress since ${this.currentFlatteningAttempt.startedAt.toISOString()}`,
        };
      }
    }

    // Settlement in progress blocks reopen
    if (this.settlementInProgress) {
      return { allowed: false, reason: "Settlement in progress" };
    }

    // Forced_unwind state requires explicit state change before reopen
    if (this.vaultOperationalState === "forced_unwind") {
      return {
        allowed: false,
        reason: "Forced unwind in progress - must complete or clear emergency state",
      };
    }

    return { allowed: true };
  }

  /**
   * Check if the flattening attempt has timed out (starvation detected).
   */
  hasFlatteningTimeout(): boolean {
    if (!this.currentFlatteningAttempt) {
      return false;
    }
    return this.currentFlatteningAttempt.timeoutTriggered;
  }

  /**
   * Mark settlement as started.
   *
   * This blocks reopen until settlement completes or fails.
   */
  startSettlement(): void {
    this.settlementInProgress = true;
    this.vaultOperationalState = "settling";

    logger.info("TradingOrchestrator: Settlement started", {
      vaultId: this.vaultConfig?.id,
    });
  }

  /**
   * Mark settlement as completed.
   */
  completeSettlement(): void {
    this.settlementInProgress = false;
    this.vaultOperationalState = "settled";
    this.currentFlatteningAttempt = null;

    logger.info("TradingOrchestrator: Settlement completed", {
      vaultId: this.vaultConfig?.id,
    });
  }

  /**
   * Complete flattening attempt successfully.
   */
  completeFlattening(): void {
    if (this.currentFlatteningAttempt) {
      this.currentFlatteningAttempt.status = "completed";
    }

    logger.info("TradingOrchestrator: Flattening completed successfully", {
      vaultId: this.vaultConfig?.id,
    });
  }

  /**
   * Get the current vault policy configuration.
   */
  getVaultPolicyConfig(): VaultPolicyConfig {
    return { ...this.vaultPolicyConfig };
  }
}

/**
 * Create a config-driven orchestrator for a specific vault.
 * Resolves vault identity and passes explicit signer keys to services.
 */
export function createTradingOrchestrator(
  config: VaultInstanceConfig,
  tradingClient?: VaultTradingClient,
  navOraclePusher?: {
    calculateAndPushNav: () => Promise<{ updatedOnChain: boolean }>;
  },
  resolvedIdentity?: ResolvedVaultIdentity,
): TradingOrchestratorService {
  // Resolve identity if not provided
  const identity = resolvedIdentity ?? resolveVaultIdentity(config);
  const resolvedTradingClient = tradingClient ?? createVaultTradingClient(config);
  return new TradingOrchestratorService(
    config,
    resolvedTradingClient,
    navOraclePusher ?? null,
    identity,
  );
}

const tradingOrchestratorRegistry = new Map<number, TradingOrchestratorService>();

export function getTradingOrchestratorForVault(
  config: VaultInstanceConfig,
): TradingOrchestratorService {
  const existing = tradingOrchestratorRegistry.get(config.id);
  if (existing) {
    return existing;
  }

  const orchestrator = createTradingOrchestrator(config);
  tradingOrchestratorRegistry.set(config.id, orchestrator);
  return orchestrator;
}

function buildMarketOffsets(maxEvents: number, batchSize: number): number[] {
  const batchCount = Math.max(1, Math.ceil(maxEvents / batchSize));
  return Array.from({ length: batchCount }, (_, index) => index * batchSize);
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function buildTokensFromOutcomeFields(market: GammaMarket): GammaToken[] {
  const outcomes = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices);
  const tokenIds = parseJsonArray(market.clobTokenIds);

  if (outcomes.length !== 2 || prices.length !== 2 || tokenIds.length !== 2) {
    return [];
  }

  return outcomes.map((outcome, index) => {
    const priceRaw = Number.parseFloat(prices[index] ?? "0");
    const price = Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;
    return {
      token_id: tokenIds[index],
      outcome,
      price,
      bestAsk: price,
      bestBid: price,
    };
  });
}

async function fetchEventsPage(url: string): Promise<GammaEvent[]> {
  const payload = await fetchMarketsPage(url);
  return payload as unknown as GammaEvent[];
}

function normalizeEventMarkets(event: GammaEvent): GammaMarket[] {
  if (!Array.isArray(event.markets)) return [];

  const eventTags = (event.tags ?? [])
    .map((tag) => tag.slug ?? tag.label)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return event.markets
    .filter((market): market is GammaMarket => Boolean(market?.id))
    .map((market) => ({
      ...market,
      endDate: market.endDate ?? event.endDate,
      tokens:
        Array.isArray(market.tokens) && market.tokens.length === 2
          ? market.tokens
          : buildTokensFromOutcomeFields(market),
      tags: market.tags && market.tags.length > 0 ? market.tags : eventTags,
    }));
}

async function fetchMarketsPage(url: string): Promise<GammaMarket[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MARKET_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`TradingOrchestrator: market fetch failed ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("TradingOrchestrator: unexpected market payload");
    }
    return payload as GammaMarket[];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGammaMarkets(
  options: Partial<MarketFetchConfig> = {},
): Promise<GammaMarket[]> {
  // Block market fetching on unsupported networks
  if (!SUPPORTS_POLYMARKET_TRADING) {
    logger.warn(
      "TradingOrchestrator: Polymarket market fetching is not supported on the current network",
    );
    return [];
  }

  const maxEvents = options.maxEvents ?? DEFAULT_MARKET_MAX_EVENTS;
  const soonClosingLimit = DEFAULT_MARKET_SOON_CLOSING_LIMIT;

  const baseQuery = "active=true&closed=false&order=liquidity&ascending=false";
  const batchUrls = buildMarketOffsets(maxEvents, EVENT_BATCH_SIZE).map(
    (offset) => `${GAMMA_BASE_URL}/events?${baseQuery}&limit=${EVENT_BATCH_SIZE}&offset=${offset}`,
  );

  const liquidityBatches = await Promise.allSettled(batchUrls.map((url) => fetchEventsPage(url)));
  const liquidityEvents: GammaEvent[] = [];
  for (const batch of liquidityBatches) {
    if (batch.status === "fulfilled") {
      liquidityEvents.push(...batch.value);
    }
  }

  const nowIso = new Date().toISOString();
  let soonEvents: GammaEvent[] = [];
  if (soonClosingLimit > 0) {
    const soonUrl = `${GAMMA_BASE_URL}/events?active=true&closed=false&order=endDate&ascending=true&end_date_min=${encodeURIComponent(nowIso)}&limit=${soonClosingLimit}`;
    try {
      soonEvents = await fetchEventsPage(soonUrl);
    } catch (error) {
      logger.warn("TradingOrchestrator: failed to fetch soon-closing markets", {
        error: (error as Error).message,
      });
    }
  }

  const liquidityMarkets = liquidityEvents.flatMap(normalizeEventMarkets);
  const soonMarkets = soonEvents.flatMap(normalizeEventMarkets);

  const unique = new Map<string, GammaMarket>();
  for (const market of [...liquidityMarkets, ...soonMarkets]) {
    if (market.id) {
      unique.set(market.id, market);
    }
  }

  const markets = [...unique.values()];
  logger.info("TradingOrchestrator: fetched markets universe", {
    maxEvents,
    batchSize: EVENT_BATCH_SIZE,
    soonClosingLimit,
    liquidityEvents: liquidityEvents.length,
    soonEvents: soonEvents.length,
    liquidityMarkets: liquidityMarkets.length,
    soonMarkets: soonMarkets.length,
    uniqueMarkets: markets.length,
  });

  if (markets.length === 0) {
    const fallbackUrl = `${GAMMA_BASE_URL}/markets?active=true&closed=false&limit=${EVENT_BATCH_SIZE}`;
    return fetchMarketsPage(fallbackUrl);
  }

  return markets;
}

/**
 * Legacy singleton (no config, uses env vars).
 * Kept for backward compatibility with existing routes/tests.
 */
let tradingOrchestrator: TradingOrchestratorService | null = null;

export function getTradingOrchestrator(): TradingOrchestratorService {
  if (!tradingOrchestrator) {
    tradingOrchestrator = new TradingOrchestratorService();
  }

  return tradingOrchestrator;
}
