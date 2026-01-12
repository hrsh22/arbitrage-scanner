/**
 * Position Analytics Service
 *
 * Fetches price history from Polymarket CLOB API and calculates
 * post-entry analytics for live trading positions.
 */

import { logger } from "../logger.js";
import { getBotRepository } from "../bot/repository.js";
import type { Position } from "../bot/types.js";

// ===========================================
// Types
// ===========================================

export interface PricePoint {
  timestamp: number; // Unix timestamp in seconds
  price: number; // 0-1 range
}

export interface PriceHistory {
  tokenId: string;
  history: PricePoint[];
}

export interface OppositeOutcomeAnalysis {
  /** Price of the opposite outcome when our position hit its lowest */
  priceAtLowest: number;
  /** Cost to fully hedge at that moment (buy enough opposite shares to cover our position) */
  hedgeCost: number;
  /** Timestamp when this occurred */
  timestamp: number;
}

export interface TimeWindowAnalysis {
  /** Hours before close */
  hoursBeforeClose: number;
  /** Price at that point */
  price: number | null;
  /** Timestamp */
  timestamp: number | null;
}

export interface StopLossSimulation {
  /** Stop-loss threshold as percentage drop from entry (e.g., 10 = 10% drop) */
  threshold: number;
  /** Would this position have triggered the stop-loss? */
  triggered: boolean;
  /** Price when stop-loss was triggered (null if not triggered) */
  triggerPrice: number | null;
  /** Timestamp when triggered */
  triggerTimestamp: number | null;
  /** Did the price recover back above entry after triggering? */
  recoveredAfterTrigger: boolean;
  /** Maximum recovery price after trigger */
  maxPriceAfterTrigger: number | null;
  /** Final outcome if we had sold at stop-loss vs held */
  profitLossIfSold: number | null;
  /** Actual profit/loss from holding */
  profitLossIfHeld: number | null;
}

export interface HedgeStrategy {
  name: "fullLockIn" | "doubleOpposite";
  hedgeShares: number;
  hedgeCost: number;
  totalInvestment: number;
  pnlIfOriginalWins: number;
  pnlIfOppositeWins: number;
  actualPnl: number | null;
  betterThanNoHedge: boolean | null;
}

export interface HedgingSimulation {
  threshold: number;
  triggered: boolean;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  oppositePrice: number | null;
  strategies: HedgeStrategy[];
}

export interface PositionAnalytics {
  position: Position;
  priceHistory: PricePoint[];
  oppositeOutcomePriceHistory: PricePoint[];

  // Price fluctuation analysis
  entryPrice: number;
  lowestPriceAfterEntry: number;
  lowestPriceTimestamp: number | null;
  highestPriceAfterEntry: number;
  highestPriceTimestamp: number | null;
  maxDrawdownPercent: number; // (entry - lowest) / entry * 100
  currentOrFinalPrice: number;

  // Opposite outcome analysis (for hedging)
  oppositeOutcome: OppositeOutcomeAnalysis | null;

  // Time window analysis (price at X hours before close)
  timeWindowAnalysis: TimeWindowAnalysis[];

  // Stop-loss simulations
  stopLossSimulations: StopLossSimulation[];

  // Hedging simulations
  hedgingSimulations: HedgingSimulation[];

  // Category info
  category: {
    outcome: "won" | "lost" | "open";
    tags: string[];
  };

  // Metadata
  analyzedAt: string;
  fidelityMinutes: number;
}

export interface AnalyticsSummary {
  totalPositions: number;
  wonCount: number;
  lostCount: number;
  openCount: number;

  // Aggregate metrics
  avgMaxDrawdownPercent: number;
  avgLowestPriceDropPercent: number;
  positionsWithDrawdownOver10Percent: number;
  positionsWithDrawdownOver20Percent: number;

  // Stop-loss analysis across all positions
  stopLossImpact: {
    threshold: number;
    wouldHaveTriggered: number;
    wouldHaveRecovered: number;
    netImpactIfUsed: number; // Sum of (profitLossIfSold - profitLossIfHeld)
  }[];

  // Breakdown by outcome
  byOutcome: {
    outcome: string;
    count: number;
    avgDrawdown: number;
    totalPnL: number;
  }[];

  // Breakdown by tags
  byTags: {
    tag: string;
    count: number;
    avgDrawdown: number;
    totalPnL: number;
    winRate: number;
  }[];
}

export interface AnalyticsOptions {
  /** Price history fidelity in minutes (1, 5, or 15). Default: 5 */
  fidelityMinutes?: 1 | 5 | 15;
  /** Stop-loss thresholds to simulate (as percentage drops). Default: [5, 10, 15, 20, 25, 30, 40, 50] */
  stopLossThresholds?: number[];
  /** Time windows to analyze (hours before close). Default: [1, 2, 3, 6, 12, 24] */
  timeWindows?: number[];
  /** Limit number of positions to analyze. Default: all */
  limit?: number;
  /** Filter by position status. Default: all */
  status?: "open" | "won" | "lost" | "expired" | "all";
}

// ===========================================
// Constants
// ===========================================

const CLOB_BASE_URL = "https://clob.polymarket.com";
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const CONCURRENCY_LIMIT = 25;

const DEFAULT_OPTIONS: Required<AnalyticsOptions> = {
  fidelityMinutes: 5,
  stopLossThresholds: [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90],
  timeWindows: [1, 2, 3, 6, 12, 24],
  limit: 1000,
  status: "all",
};

const marketTagsCache = new Map<string, string[]>();
const oppositeTokenCache = new Map<string, string | null>();

async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      if (item !== undefined) {
        results[currentIndex] = await fn(item);
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ===========================================
// API Helpers
// ===========================================

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Fetch price history for a token from Polymarket CLOB API
 */
async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  endTs: number,
  fidelityMinutes: number,
): Promise<PricePoint[]> {
  try {
    const url = `${CLOB_BASE_URL}/prices-history?market=${tokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=${fidelityMinutes}`;

    const response = await fetchJson<{ history: { t: number; p: number }[] }>(url);

    return (response.history || []).map((point) => ({
      timestamp: point.t,
      price: point.p,
    }));
  } catch (error) {
    logger.warn("Failed to fetch price history", {
      tokenId,
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Fetch market info including tags from Gamma API
 */
async function fetchMarketTags(marketId: string): Promise<string[]> {
  const cached = marketTagsCache.get(marketId);
  if (cached !== undefined) return cached;

  try {
    const marketUrl = `${GAMMA_BASE_URL}/markets/${marketId}`;
    const market = await fetchJson<{ eventSlug?: string }>(marketUrl);

    if (!market.eventSlug) {
      marketTagsCache.set(marketId, []);
      return [];
    }

    const eventUrl = `${GAMMA_BASE_URL}/events/slug/${market.eventSlug}`;
    const event = await fetchJson<{ tags?: { slug: string }[] }>(eventUrl);

    const tags = (event.tags || []).map((t) => t.slug);
    marketTagsCache.set(marketId, tags);
    return tags;
  } catch {
    marketTagsCache.set(marketId, []);
    return [];
  }
}

/**
 * Get the opposite token ID for a market
 * For a binary market, if we have Yes token, get No token and vice versa
 */
async function getOppositeTokenId(
  marketId: string,
  currentTokenId: string,
): Promise<string | null> {
  const cacheKey = `${marketId}:${currentTokenId}`;
  const cached = oppositeTokenCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const url = `${GAMMA_BASE_URL}/markets/${marketId}`;
    const market = await fetchJson<{ clobTokenIds?: string }>(url);

    if (!market.clobTokenIds) {
      oppositeTokenCache.set(cacheKey, null);
      return null;
    }

    const tokenIds = JSON.parse(market.clobTokenIds) as string[];
    if (tokenIds.length !== 2) {
      oppositeTokenCache.set(cacheKey, null);
      return null;
    }

    const result = tokenIds[0] === currentTokenId ? (tokenIds[1] ?? null) : (tokenIds[0] ?? null);
    oppositeTokenCache.set(cacheKey, result);
    return result;
  } catch {
    oppositeTokenCache.set(cacheKey, null);
    return null;
  }
}

// ===========================================
// Analysis Functions
// ===========================================

function determineOutcome(position: Position): "won" | "lost" | "open" {
  if (position.status === "open" || position.status === "in_review") {
    return "open";
  }
  if (position.profitLoss !== undefined && position.profitLoss !== null) {
    return position.profitLoss >= 0 ? "won" : "lost";
  }
  if (position.status === "won") return "won";
  if (position.status === "lost" || position.status === "expired") return "lost";
  return "open";
}

function findLowestPrice(
  history: PricePoint[],
  afterTimestamp: number,
): { price: number; timestamp: number } | null {
  const relevantHistory = history.filter((p) => p.timestamp >= afterTimestamp);
  if (relevantHistory.length === 0) return null;

  let lowest = relevantHistory[0]!;
  for (const point of relevantHistory) {
    if (point.price < lowest.price) {
      lowest = point;
    }
  }
  return { price: lowest.price, timestamp: lowest.timestamp };
}

function findHighestPrice(
  history: PricePoint[],
  afterTimestamp: number,
): { price: number; timestamp: number } | null {
  const relevantHistory = history.filter((p) => p.timestamp >= afterTimestamp);
  if (relevantHistory.length === 0) return null;

  let highest = relevantHistory[0]!;
  for (const point of relevantHistory) {
    if (point.price > highest.price) {
      highest = point;
    }
  }
  return { price: highest.price, timestamp: highest.timestamp };
}

function findPriceAtTimestamp(history: PricePoint[], targetTs: number): number | null {
  if (history.length === 0) return null;

  // Find the closest price point to the target timestamp
  let closest = history[0]!;
  let minDiff = Math.abs(closest.timestamp - targetTs);

  for (const point of history) {
    const diff = Math.abs(point.timestamp - targetTs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }

  // Only return if within 30 minutes of target
  if (minDiff <= 1800) {
    return closest.price;
  }
  return null;
}

function analyzeTimeWindows(
  history: PricePoint[],
  closesAt: Date | undefined,
  windows: number[],
): TimeWindowAnalysis[] {
  if (!closesAt || history.length === 0) {
    return windows.map((h) => ({
      hoursBeforeClose: h,
      price: null,
      timestamp: null,
    }));
  }

  const closeTs = Math.floor(closesAt.getTime() / 1000);

  return windows.map((hoursBeforeClose) => {
    const targetTs = closeTs - hoursBeforeClose * 3600;
    const price = findPriceAtTimestamp(history, targetTs);

    return {
      hoursBeforeClose,
      price,
      timestamp: price !== null ? targetTs : null,
    };
  });
}

function simulateStopLoss(
  history: PricePoint[],
  entryPrice: number,
  entryTimestamp: number,
  actualPnL: number | undefined,
  cost: number,
  thresholds: number[],
): StopLossSimulation[] {
  const relevantHistory = history.filter((p) => p.timestamp >= entryTimestamp);

  return thresholds.map((threshold) => {
    const stopPrice = entryPrice * (1 - threshold / 100);

    // Find first point where price dropped below stop
    let triggerIndex = -1;
    for (let i = 0; i < relevantHistory.length; i++) {
      if (relevantHistory[i]!.price <= stopPrice) {
        triggerIndex = i;
        break;
      }
    }

    if (triggerIndex === -1) {
      // Never triggered
      return {
        threshold,
        triggered: false,
        triggerPrice: null,
        triggerTimestamp: null,
        recoveredAfterTrigger: false,
        maxPriceAfterTrigger: null,
        profitLossIfSold: null,
        profitLossIfHeld: actualPnL ?? null,
      };
    }

    const triggerPoint = relevantHistory[triggerIndex]!;
    const afterTrigger = relevantHistory.slice(triggerIndex + 1);

    const maxAfterTrigger =
      afterTrigger.length > 0 ? Math.max(...afterTrigger.map((p) => p.price)) : triggerPoint.price;

    const shares = cost / entryPrice;
    const valueIfSold = shares * triggerPoint.price;
    const profitLossIfSold = valueIfSold - cost;

    const recoveredAfterTrigger = (actualPnL ?? 0) > profitLossIfSold;

    return {
      threshold,
      triggered: true,
      triggerPrice: triggerPoint.price,
      triggerTimestamp: triggerPoint.timestamp,
      recoveredAfterTrigger,
      maxPriceAfterTrigger: maxAfterTrigger,
      profitLossIfSold,
      profitLossIfHeld: actualPnL ?? null,
    };
  });
}

function findClosestOppositePrice(
  oppositeHistory: PricePoint[],
  timestamp: number,
  maxDiffSeconds = 300,
): number | null {
  if (oppositeHistory.length === 0) return null;

  let closest: PricePoint | null = null;
  let minDiff = Infinity;

  for (const point of oppositeHistory) {
    const diff = Math.abs(point.timestamp - timestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }

  if (closest && minDiff <= maxDiffSeconds) {
    return closest.price;
  }
  return null;
}

function simulateHedging(
  history: PricePoint[],
  oppositeHistory: PricePoint[],
  entryPrice: number,
  entryTimestamp: number,
  cost: number,
  actualPnL: number | undefined,
  didOriginalWin: boolean | null,
  thresholds: number[],
): HedgingSimulation[] {
  const relevantHistory = history.filter((p) => p.timestamp >= entryTimestamp);
  const shares = cost / entryPrice;

  return thresholds.map((threshold) => {
    const triggerPrice = entryPrice * (1 - threshold / 100);

    let triggerIndex = -1;
    for (let i = 0; i < relevantHistory.length; i++) {
      if (relevantHistory[i]!.price <= triggerPrice) {
        triggerIndex = i;
        break;
      }
    }

    if (triggerIndex === -1) {
      return {
        threshold,
        triggered: false,
        triggerPrice: null,
        triggerTimestamp: null,
        oppositePrice: null,
        strategies: [],
      };
    }

    const triggerPoint = relevantHistory[triggerIndex]!;
    let oppPrice = findClosestOppositePrice(oppositeHistory, triggerPoint.timestamp);

    const theoreticalOppPrice = 1 - triggerPoint.price;
    if (oppPrice !== null) {
      if (oppPrice > theoreticalOppPrice + 0.15) {
        oppPrice = theoreticalOppPrice + 0.05;
      }
    } else {
      oppPrice = theoreticalOppPrice + 0.05;
    }

    if (oppPrice >= 0.99) oppPrice = 0.99;

    if (oppPrice <= 0) {
      return {
        threshold,
        triggered: true,
        triggerPrice: triggerPoint.price,
        triggerTimestamp: triggerPoint.timestamp,
        oppositePrice: null,
        strategies: [],
      };
    }

    const strategies: HedgeStrategy[] = [];

    const fullLockShares = shares;
    const fullLockCost = fullLockShares * oppPrice;
    const fullLockTotal = cost + fullLockCost;
    const fullLockPnlOrigWins = shares * 1 - fullLockTotal;
    const fullLockPnlOppWins = fullLockShares * 1 - fullLockTotal;
    let fullLockActual: number | null = null;
    if (didOriginalWin === true) fullLockActual = fullLockPnlOrigWins;
    else if (didOriginalWin === false) fullLockActual = fullLockPnlOppWins;
    strategies.push({
      name: "fullLockIn",
      hedgeShares: fullLockShares,
      hedgeCost: fullLockCost,
      totalInvestment: fullLockTotal,
      pnlIfOriginalWins: fullLockPnlOrigWins,
      pnlIfOppositeWins: fullLockPnlOppWins,
      actualPnl: fullLockActual,
      betterThanNoHedge:
        fullLockActual !== null && actualPnL !== undefined ? fullLockActual > actualPnL : null,
    });

    const doubleShares = shares * 2;
    const doubleCost = doubleShares * oppPrice;
    const doubleTotal = cost + doubleCost;
    const doublePnlOrigWins = shares * 1 - doubleTotal;
    const doublePnlOppWins = doubleShares * 1 - doubleTotal;
    let doubleActual: number | null = null;
    if (didOriginalWin === true) doubleActual = doublePnlOrigWins;
    else if (didOriginalWin === false) doubleActual = doublePnlOppWins;
    strategies.push({
      name: "doubleOpposite",
      hedgeShares: doubleShares,
      hedgeCost: doubleCost,
      totalInvestment: doubleTotal,
      pnlIfOriginalWins: doublePnlOrigWins,
      pnlIfOppositeWins: doublePnlOppWins,
      actualPnl: doubleActual,
      betterThanNoHedge:
        doubleActual !== null && actualPnL !== undefined ? doubleActual > actualPnL : null,
    });

    return {
      threshold,
      triggered: true,
      triggerPrice: triggerPoint.price,
      triggerTimestamp: triggerPoint.timestamp,
      oppositePrice: oppPrice,
      strategies,
    };
  });
}

// ===========================================
// Main Analytics Functions
// ===========================================

/**
 * Analyze a single position's price history and calculate metrics
 */
async function analyzePosition(
  position: Position,
  options: Required<AnalyticsOptions>,
): Promise<PositionAnalytics | null> {
  const { fidelityMinutes, stopLossThresholds, timeWindows } = options;

  if (!position.tokenId) {
    logger.warn("Position has no tokenId", { positionId: position.id });
    return null;
  }

  // Determine time range for price history
  const entryTs = Math.floor(position.createdAt.getTime() / 1000);
  const endTs = position.resolvedAt
    ? Math.floor(position.resolvedAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // Fetch price history for our position
  const priceHistory = await fetchPriceHistory(position.tokenId, entryTs, endTs, fidelityMinutes);

  if (priceHistory.length === 0) {
    logger.warn("No price history available", { positionId: position.id });
    return null;
  }

  // Fetch opposite token price history
  const oppositeTokenId = await getOppositeTokenId(position.marketId, position.tokenId);
  let oppositeHistory: PricePoint[] = [];
  if (oppositeTokenId) {
    oppositeHistory = await fetchPriceHistory(oppositeTokenId, entryTs, endTs, fidelityMinutes);
  }

  // Fetch market tags
  const tags = await fetchMarketTags(position.marketId);

  // Calculate metrics
  const entryPrice = position.entryPrice || priceHistory[0]?.price || 0;
  const lowest = findLowestPrice(priceHistory, entryTs);
  const highest = findHighestPrice(priceHistory, entryTs);
  const currentOrFinal = priceHistory[priceHistory.length - 1]?.price || entryPrice;

  const lowestPrice = lowest?.price ?? entryPrice;
  const maxDrawdownPercent = entryPrice > 0 ? ((entryPrice - lowestPrice) / entryPrice) * 100 : 0;

  // Opposite outcome analysis at lowest point
  let oppositeOutcome: OppositeOutcomeAnalysis | null = null;
  if (lowest && oppositeHistory.length > 0) {
    const oppPriceAtLowest = findPriceAtTimestamp(oppositeHistory, lowest.timestamp);
    if (oppPriceAtLowest !== null) {
      // To fully hedge, we'd need to buy enough opposite shares
      // If we have `shares` of Yes at entryPrice, we need `shares` of No
      // Cost to hedge = shares * oppositePrice
      const shares = position.cost / entryPrice;
      const hedgeCost = shares * oppPriceAtLowest;

      oppositeOutcome = {
        priceAtLowest: oppPriceAtLowest,
        hedgeCost,
        timestamp: lowest.timestamp,
      };
    }
  }

  // Time window analysis
  const timeWindowAnalysis = analyzeTimeWindows(priceHistory, position.closesAt, timeWindows);

  // Stop-loss simulations
  const stopLossSimulations = simulateStopLoss(
    priceHistory,
    entryPrice,
    entryTs,
    position.profitLoss,
    position.cost,
    stopLossThresholds,
  );

  const outcome = determineOutcome(position);
  const didOriginalWin = outcome === "won" ? true : outcome === "lost" ? false : null;

  const hedgingSimulations = simulateHedging(
    priceHistory,
    oppositeHistory,
    entryPrice,
    entryTs,
    position.cost,
    position.profitLoss,
    didOriginalWin,
    stopLossThresholds,
  );

  return {
    position,
    priceHistory,
    oppositeOutcomePriceHistory: oppositeHistory,
    entryPrice,
    lowestPriceAfterEntry: lowestPrice,
    lowestPriceTimestamp: lowest?.timestamp ?? null,
    highestPriceAfterEntry: highest?.price ?? entryPrice,
    highestPriceTimestamp: highest?.timestamp ?? null,
    maxDrawdownPercent,
    currentOrFinalPrice: currentOrFinal,
    oppositeOutcome,
    timeWindowAnalysis,
    stopLossSimulations,
    hedgingSimulations,
    category: {
      outcome,
      tags,
    },
    analyzedAt: new Date().toISOString(),
    fidelityMinutes,
  };
}

/**
 * Get all live positions from the database and analyze them
 */
export async function getPositionAnalytics(options: AnalyticsOptions = {}): Promise<{
  positions: PositionAnalytics[];
  summary: AnalyticsSummary;
  options: Required<AnalyticsOptions>;
}> {
  const opts: Required<AnalyticsOptions> = { ...DEFAULT_OPTIONS, ...options };

  // Get positions from all bot instances (live only)
  const repository = getBotRepository("1");
  let positions = await repository.getAllPositionHistory(opts.limit);

  // Filter to live positions only
  positions = positions.filter((p) => !p.isSimulated);

  // Apply status filter
  if (opts.status !== "all") {
    positions = positions.filter((p) => p.status === opts.status);
  }

  logger.info("Analyzing positions", { count: positions.length, options: opts });

  const results = await parallelLimit(positions, CONCURRENCY_LIMIT, async (position) => {
    try {
      return await analyzePosition(position, opts);
    } catch (error) {
      logger.error("Failed to analyze position", {
        positionId: position.id,
        error: (error as Error).message,
      });
      return null;
    }
  });

  const analytics = results.filter((r): r is PositionAnalytics => r !== null);

  // Calculate summary
  const summary = calculateSummary(analytics, opts.stopLossThresholds);

  return { positions: analytics, summary, options: opts };
}

/**
 * Analyze a single position by ID
 */
export async function getPositionAnalyticsById(
  positionId: number,
  options: AnalyticsOptions = {},
): Promise<PositionAnalytics | null> {
  const opts: Required<AnalyticsOptions> = { ...DEFAULT_OPTIONS, ...options };

  const repository = getBotRepository("1");
  const positions = await repository.getAllPositionHistory(1000);

  const position = positions.find((p) => p.id === positionId && !p.isSimulated);
  if (!position) {
    return null;
  }

  return analyzePosition(position, opts);
}

/**
 * Calculate aggregate summary from analyzed positions
 */
function calculateSummary(
  analytics: PositionAnalytics[],
  stopLossThresholds: number[],
): AnalyticsSummary {
  if (analytics.length === 0) {
    return {
      totalPositions: 0,
      wonCount: 0,
      lostCount: 0,
      openCount: 0,
      avgMaxDrawdownPercent: 0,
      avgLowestPriceDropPercent: 0,
      positionsWithDrawdownOver10Percent: 0,
      positionsWithDrawdownOver20Percent: 0,
      stopLossImpact: stopLossThresholds.map((t) => ({
        threshold: t,
        wouldHaveTriggered: 0,
        wouldHaveRecovered: 0,
        netImpactIfUsed: 0,
      })),
      byOutcome: [],
      byTags: [],
    };
  }

  const wonCount = analytics.filter((a) => a.category.outcome === "won").length;
  const lostCount = analytics.filter((a) => a.category.outcome === "lost").length;
  const openCount = analytics.filter((a) => a.category.outcome === "open").length;

  const avgMaxDrawdown =
    analytics.reduce((sum, a) => sum + a.maxDrawdownPercent, 0) / analytics.length;

  const avgLowestDrop =
    analytics.reduce((sum, a) => {
      const drop =
        a.entryPrice > 0 ? ((a.entryPrice - a.lowestPriceAfterEntry) / a.entryPrice) * 100 : 0;
      return sum + drop;
    }, 0) / analytics.length;

  // Stop-loss impact analysis
  const stopLossImpact = stopLossThresholds.map((threshold) => {
    let triggered = 0;
    let recovered = 0;
    let netImpact = 0;

    for (const a of analytics) {
      const sim = a.stopLossSimulations.find((s) => s.threshold === threshold);
      if (sim?.triggered) {
        triggered++;
        if (sim.recoveredAfterTrigger) {
          recovered++;
        }
        if (sim.profitLossIfSold !== null && sim.profitLossIfHeld !== null) {
          netImpact += sim.profitLossIfSold - sim.profitLossIfHeld;
        }
      }
    }

    return {
      threshold,
      wouldHaveTriggered: triggered,
      wouldHaveRecovered: recovered,
      netImpactIfUsed: netImpact,
    };
  });

  // Breakdown by outcome
  const outcomeGroups = new Map<string, PositionAnalytics[]>();
  for (const a of analytics) {
    const outcome = a.category.outcome;
    if (!outcomeGroups.has(outcome)) {
      outcomeGroups.set(outcome, []);
    }
    outcomeGroups.get(outcome)!.push(a);
  }

  const byOutcome = Array.from(outcomeGroups.entries()).map(([outcome, group]) => ({
    outcome,
    count: group.length,
    avgDrawdown: group.reduce((sum, a) => sum + a.maxDrawdownPercent, 0) / group.length,
    totalPnL: group.reduce((sum, a) => sum + (a.position.profitLoss ?? 0), 0),
  }));

  // Breakdown by tags
  const tagGroups = new Map<string, PositionAnalytics[]>();
  for (const a of analytics) {
    for (const tag of a.category.tags) {
      if (!tagGroups.has(tag)) {
        tagGroups.set(tag, []);
      }
      tagGroups.get(tag)!.push(a);
    }
  }

  const byTags = Array.from(tagGroups.entries()).map(([tag, group]) => {
    const wonInGroup = group.filter((a) => a.category.outcome === "won").length;
    return {
      tag,
      count: group.length,
      avgDrawdown: group.reduce((sum, a) => sum + a.maxDrawdownPercent, 0) / group.length,
      totalPnL: group.reduce((sum, a) => sum + (a.position.profitLoss ?? 0), 0),
      winRate: group.length > 0 ? (wonInGroup / group.length) * 100 : 0,
    };
  });

  return {
    totalPositions: analytics.length,
    wonCount,
    lostCount,
    openCount,
    avgMaxDrawdownPercent: avgMaxDrawdown,
    avgLowestPriceDropPercent: avgLowestDrop,
    positionsWithDrawdownOver10Percent: analytics.filter((a) => a.maxDrawdownPercent > 10).length,
    positionsWithDrawdownOver20Percent: analytics.filter((a) => a.maxDrawdownPercent > 20).length,
    stopLossImpact,
    byOutcome,
    byTags: byTags.sort((a, b) => b.count - a.count).slice(0, 20), // Top 20 tags
  };
}
