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
import { and, gte, isNotNull, sql } from "drizzle-orm";

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
import { getVaultTradingClient, VaultTradingClient } from "./tradingClient.js";
import { isValidOpportunity, calculatePPH, calculateExpectedProfit } from "./strategyEngine.js";
import type { TradeRequest, VaultStatus } from "../types.js";
import { withdrawalRepository } from "../repositories/withdrawalRepository.js";
import { getVaultProvider } from "./vaultProviderFactory.js";

const USDC_DECIMALS = 1_000_000;
const DEFAULT_MAX_DEPLOYED_RATIO = 0.25;
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const EVENT_BATCH_SIZE = 100;
const DEFAULT_MARKET_SOON_CLOSING_LIMIT = 100;
const DEFAULT_MARKET_MAX_EVENTS = 1000;
const MARKET_FETCH_TIMEOUT_MS = 15_000;

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

  private readonly mode: "simulation" | "live";
  private readonly tradingClient: VaultTradingClient;
  private readonly resolvedIdentity: ResolvedVaultIdentity | null;
  private readonly navOraclePusher: {
    calculateAndPushNav: () => Promise<{ updatedOnChain: boolean }>;
  } | null;
  private safeWalletService: SafeWalletService | null = null;
  private lastScanAt: Date | undefined;

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

    const existingPositions = await positionRepository.getOpenPositions();
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
      positionRepository.getOpenPositions(),
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
    const currentEpochEnd = vaultInfo.epochInfo?.currentEpochEnd;
    if (!currentEpochEnd) {
      return null;
    }

    return new Date(currentEpochEnd.getTime() - this.epochBoundarySafetyBufferMinutes * 60 * 1000);
  }

  private async getCircuitBreakerStatus(): Promise<CircuitBreakerStatus> {
    const [todayRealizedPnl, openPositions] = await Promise.all([
      this.getTodayRealizedPnl(),
      positionRepository.getOpenPositions(),
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
      .where(and(gte(vaultPositions.resolvedAt, start), isNotNull(vaultPositions.resolvedPnl)));

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
      this.safeWalletService = new SafeWalletService(
        tradingSafeAddress,
        privateKey,
        env.POLYGON_RPC_URL,
      );
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
  return new TradingOrchestratorService(
    config,
    tradingClient ?? getVaultTradingClient(),
    navOraclePusher ?? null,
    identity,
  );
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
