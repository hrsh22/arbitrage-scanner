import {
  fetchPositions,
  fetchActivity,
  fetchPriceHistory,
  fetchResolvedPositionsFromDB,
  syncResolvedPositions,
  type PolymarketPosition,
  type PolymarketActivity,
  type ResolvedPositionFromDB,
} from "./polymarket-api";
import type {
  PositionAnalytics,
  PositionInfo,
  AnalyticsSummary,
  PricePoint,
  StopLossSimulation,
  HedgingSimulation,
  HedgeStrategy,
  TimeWindowAnalysis,
  OppositeOutcomeAnalysis,
  CategoryAnalysis,
  CategoryStopLossAnalysis,
  CategoryHedgingAnalysis,
  BestStrategyRecommendation,
} from "./types";

export interface AnalyticsOptions {
  fidelityMinutes: 1 | 5 | 15;
  stopLossThresholds: number[];
  timeWindows: number[];
  limit: number;
  status: "open" | "won" | "lost" | "expired" | "all";
}

const DEFAULT_OPTIONS: AnalyticsOptions = {
  fidelityMinutes: 5,
  stopLossThresholds: [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90],
  timeWindows: [1, 2, 3, 6, 12, 24],
  limit: 1000,
  status: "all",
};

export function normalizeToCategory(tags: string[]): string {
  const text = tags.join(" ").toLowerCase();

  if (text.includes("equities") || text.includes("stocks")) return "Stocks";
  if (text.includes("crypto") || text.includes("bitcoin") || text.includes("ethereum"))
    return "Crypto";
  if (
    text.includes("sports") ||
    text.includes("nfl") ||
    text.includes("nba") ||
    text.includes("tennis") ||
    text.includes("soccer") ||
    text.includes("games")
  )
    return "Sports";
  if (
    text.includes("politics") ||
    text.includes("elections") ||
    text.includes("trump") ||
    text.includes("government")
  )
    return "Politics";
  if (text.includes("weather") || text.includes("temperature") || text.includes("climate"))
    return "Weather";
  if (text.includes("ai") || text.includes("tech") || text.includes("technology"))
    return "Tech & AI";
  if (text.includes("entertainment") || text.includes("movies") || text.includes("box office"))
    return "Entertainment";
  if (text.includes("social") || text.includes("twitter") || text.includes("elon"))
    return "Social Media";

  if (tags.length > 0) return tags[0]!;
  return "Unknown";
}

interface ReconstructedPosition {
  tokenId: string;
  conditionId: string;
  title: string;
  slug: string;
  outcome: string;
  oppositeAsset: string;
  entryPrice: number;
  cost: number;
  size: number;
  currentPrice: number;
  profitLoss: number;
  status: "open" | "won" | "lost";
  createdAt: Date;
  resolvedAt: Date | null;
  endDate: string | null;
  eventSlug: string | null;
  redeemable: boolean;
}

export async function reconstructPositionsFromApi(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<ReconstructedPosition[]> {
  const [positions, activity] = await Promise.all([
    fetchPositions(walletAddress, signal),
    fetchActivity(walletAddress, 5000, signal),
  ]);

  const positionMap = new Map<string, ReconstructedPosition>();

  for (const pos of positions) {
    const status = determineStatus(pos);
    positionMap.set(pos.asset, {
      tokenId: pos.asset,
      conditionId: pos.conditionId,
      title: pos.title,
      slug: pos.slug,
      outcome: pos.outcome,
      oppositeAsset: pos.oppositeAsset,
      entryPrice: pos.avgPrice,
      cost: pos.initialValue,
      size: pos.size,
      currentPrice: pos.curPrice,
      profitLoss: pos.cashPnl,
      status,
      createdAt: findFirstBuyTimestamp(activity, pos.asset),
      resolvedAt: pos.redeemable ? new Date() : null,
      endDate: pos.endDate,
      eventSlug: pos.eventSlug || null,
      redeemable: pos.redeemable,
    });
  }

  const closedFromActivity = reconstructClosedPositions(activity, positionMap);
  for (const closed of closedFromActivity) {
    if (!positionMap.has(closed.tokenId)) {
      positionMap.set(closed.tokenId, closed);
    }
  }

  return Array.from(positionMap.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

function determineStatus(pos: PolymarketPosition): "open" | "won" | "lost" {
  if (pos.redeemable) {
    return pos.curPrice >= 0.99 ? "won" : "lost";
  }
  return "open";
}

function findFirstBuyTimestamp(activity: PolymarketActivity[], tokenId: string): Date {
  const buys = activity
    .filter((a) => a.asset === tokenId && a.type === "TRADE" && a.side === "BUY")
    .sort((a, b) => a.timestamp - b.timestamp);

  return buys.length > 0 ? new Date(buys[0]!.timestamp * 1000) : new Date();
}

function reconstructClosedPositions(
  activity: PolymarketActivity[],
  existingPositions: Map<string, ReconstructedPosition>,
): ReconstructedPosition[] {
  const closedPositions: ReconstructedPosition[] = [];

  const conditionGroups = new Map<string, PolymarketActivity[]>();
  for (const act of activity) {
    if (act.type !== "TRADE" && act.type !== "REDEEM") continue;
    const key = act.conditionId;
    if (!conditionGroups.has(key)) {
      conditionGroups.set(key, []);
    }
    conditionGroups.get(key)!.push(act);
  }

  for (const [conditionId, activities] of conditionGroups) {
    const buys = activities.filter((a) => a.type === "TRADE" && a.side === "BUY");
    const sells = activities.filter((a) => a.type === "TRADE" && a.side === "SELL");
    const redeems = activities.filter((a) => a.type === "REDEEM");

    if (buys.length === 0) continue;

    const firstBuy = buys.sort((a, b) => a.timestamp - b.timestamp)[0]!;
    const tokenId = firstBuy.asset;

    if (existingPositions.has(tokenId)) continue;

    const totalBought = buys.reduce((sum, b) => sum + b.usdcSize, 0);
    const totalSold = sells.reduce((sum, s) => sum + s.usdcSize, 0);
    const totalRedeemed = redeems.reduce((sum, r) => sum + r.usdcSize, 0);

    const avgEntryPrice =
      buys.reduce((sum, b) => sum + b.price * b.size, 0) / buys.reduce((sum, b) => sum + b.size, 0);

    const lastActivity = activities.sort((a, b) => b.timestamp - a.timestamp)[0]!;

    let status: "open" | "won" | "lost" = "open";
    let profitLoss = 0;
    let currentPrice = 0;

    if (redeems.length > 0) {
      profitLoss = totalRedeemed - totalBought;
      status = profitLoss >= 0 ? "won" : "lost";
      currentPrice = totalRedeemed > 0 ? 1 : 0;
    } else if (sells.length > 0 && totalSold >= totalBought * 0.9) {
      profitLoss = totalSold - totalBought;
      status = profitLoss >= 0 ? "won" : "lost";
      currentPrice = sells[0]?.price || 0;
    } else {
      continue;
    }

    closedPositions.push({
      tokenId,
      conditionId,
      title: firstBuy.title,
      slug: firstBuy.slug,
      outcome: firstBuy.outcome,
      oppositeAsset: "",
      entryPrice: avgEntryPrice,
      cost: totalBought,
      size: buys.reduce((sum, b) => sum + b.size, 0),
      currentPrice,
      profitLoss,
      status,
      createdAt: new Date(firstBuy.timestamp * 1000),
      resolvedAt: new Date(lastActivity.timestamp * 1000),
      endDate: null,
      eventSlug: firstBuy.eventSlug || null,
      redeemable: false,
    });
  }

  return closedPositions;
}

function findLowestPrice(
  history: PricePoint[],
  afterTimestamp: number,
): { price: number; timestamp: number } | null {
  const relevant = history.filter((p) => p.timestamp >= afterTimestamp);
  if (relevant.length === 0) return null;

  let lowest = relevant[0]!;
  for (const point of relevant) {
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
  const relevant = history.filter((p) => p.timestamp >= afterTimestamp);
  if (relevant.length === 0) return null;

  let highest = relevant[0]!;
  for (const point of relevant) {
    if (point.price > highest.price) {
      highest = point;
    }
  }
  return { price: highest.price, timestamp: highest.timestamp };
}

function findPriceAtTimestamp(history: PricePoint[], targetTs: number): number | null {
  if (history.length === 0) return null;

  let closest = history[0]!;
  let minDiff = Math.abs(closest.timestamp - targetTs);

  for (const point of history) {
    const diff = Math.abs(point.timestamp - targetTs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }

  return minDiff <= 1800 ? closest.price : null;
}

function analyzeTimeWindows(
  history: PricePoint[],
  closesAt: Date | null,
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
  actualPnL: number,
  cost: number,
  thresholds: number[],
): StopLossSimulation[] {
  const relevantHistory = history.filter((p) => p.timestamp >= entryTimestamp);

  return thresholds.map((threshold) => {
    const stopPrice = entryPrice * (1 - threshold / 100);

    let triggerIndex = -1;
    for (let i = 0; i < relevantHistory.length; i++) {
      if (relevantHistory[i]!.price <= stopPrice) {
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
        recoveredAfterTrigger: false,
        maxPriceAfterTrigger: null,
        profitLossIfSold: null,
        profitLossIfHeld: actualPnL,
      };
    }

    const triggerPoint = relevantHistory[triggerIndex]!;
    const afterTrigger = relevantHistory.slice(triggerIndex + 1);

    const maxAfterTrigger =
      afterTrigger.length > 0 ? Math.max(...afterTrigger.map((p) => p.price)) : triggerPoint.price;

    const shares = cost / entryPrice;
    // Ideal execution: sell at stopPrice, not the actual gapped-down triggerPoint.price
    const valueIfSold = shares * stopPrice;
    const profitLossIfSold = valueIfSold - cost;
    const recoveredAfterTrigger = actualPnL > profitLossIfSold;

    return {
      threshold,
      triggered: true,
      triggerPrice: triggerPoint.price,
      triggerTimestamp: triggerPoint.timestamp,
      recoveredAfterTrigger,
      maxPriceAfterTrigger: maxAfterTrigger,
      profitLossIfSold,
      profitLossIfHeld: actualPnL,
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

  return closest && minDiff <= maxDiffSeconds ? closest.price : null;
}

function simulateHedging(
  history: PricePoint[],
  oppositeHistory: PricePoint[],
  entryPrice: number,
  entryTimestamp: number,
  cost: number,
  actualPnL: number,
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

    const theoreticalOppPrice = 1 - triggerPrice;
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
      betterThanNoHedge: fullLockActual !== null ? fullLockActual > actualPnL : null,
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
      betterThanNoHedge: doubleActual !== null ? doubleActual > actualPnL : null,
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

async function analyzePosition(
  position: ReconstructedPosition,
  options: AnalyticsOptions,
  signal?: AbortSignal,
): Promise<PositionAnalytics | null> {
  const entryTs = Math.floor(position.createdAt.getTime() / 1000);
  let endTs = position.resolvedAt
    ? Math.floor(position.resolvedAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const MAX_RANGE_SECONDS = 7 * 24 * 60 * 60;
  const adjustedStartTs = Math.max(entryTs, endTs - MAX_RANGE_SECONDS);

  const [priceHistory, oppositeHistory] = await Promise.all([
    fetchPriceHistory(position.tokenId, adjustedStartTs, endTs, options.fidelityMinutes, signal),
    position.oppositeAsset
      ? fetchPriceHistory(
          position.oppositeAsset,
          adjustedStartTs,
          endTs,
          options.fidelityMinutes,
          signal,
        )
      : Promise.resolve([]),
  ]);

  const normalizedCategory = normalizeToCategory([]);

  if (priceHistory.length === 0) {
    const positionInfo: PositionInfo = {
      id: hashTokenId(position.tokenId),
      marketId: position.conditionId,
      marketQuestion: position.title,
      marketSlug: position.slug,
      eventSlug: position.eventSlug || undefined,
      tokenId: position.tokenId,
      outcome: position.outcome,
      entryPrice: position.entryPrice,
      cost: position.cost,
      closesAt: position.endDate || undefined,
      status: position.status,
      resolvedAt: position.resolvedAt?.toISOString(),
      profitLoss: position.profitLoss,
      isSimulated: false,
      createdAt: position.createdAt.toISOString(),
    };

    return {
      position: positionInfo,
      priceHistory: [],
      oppositeOutcomePriceHistory: [],
      entryPrice: position.entryPrice,
      lowestPriceAfterEntry: position.entryPrice,
      lowestPriceTimestamp: null,
      highestPriceAfterEntry: position.entryPrice,
      highestPriceTimestamp: null,
      maxDrawdownPercent: 0,
      currentOrFinalPrice: position.currentPrice,
      oppositeOutcome: null,
      timeWindowAnalysis: options.timeWindows.map((h) => ({
        hoursBeforeClose: h,
        price: null,
        timestamp: null,
      })),
      stopLossSimulations: options.stopLossThresholds.map((t) => ({
        threshold: t,
        triggered: false,
        triggerPrice: null,
        triggerTimestamp: null,
        recoveredAfterTrigger: false,
        maxPriceAfterTrigger: null,
        profitLossIfSold: null,
        profitLossIfHeld: position.profitLoss,
      })),
      hedgingSimulations: options.stopLossThresholds.map((t) => ({
        threshold: t,
        triggered: false,
        triggerPrice: null,
        triggerTimestamp: null,
        oppositePrice: null,
        strategies: [],
      })),
      category: {
        outcome: position.status,
        tags: [],
        normalized: normalizeToCategory([]),
      },
      analyzedAt: new Date().toISOString(),
      fidelityMinutes: options.fidelityMinutes,
    };
  }

  const entryPrice = position.entryPrice || priceHistory[0]?.price || 0;
  const lowest = findLowestPrice(priceHistory, entryTs);
  const highest = findHighestPrice(priceHistory, entryTs);
  const currentOrFinal = priceHistory[priceHistory.length - 1]?.price || entryPrice;

  const lowestPrice = lowest?.price ?? entryPrice;
  const maxDrawdownPercent = entryPrice > 0 ? ((entryPrice - lowestPrice) / entryPrice) * 100 : 0;

  let oppositeOutcome: OppositeOutcomeAnalysis | null = null;
  if (lowest && oppositeHistory.length > 0) {
    const oppPriceAtLowest = findPriceAtTimestamp(oppositeHistory, lowest.timestamp);
    if (oppPriceAtLowest !== null) {
      const shares = position.cost / entryPrice;
      oppositeOutcome = {
        priceAtLowest: oppPriceAtLowest,
        hedgeCost: shares * oppPriceAtLowest,
        timestamp: lowest.timestamp,
      };
    }
  }

  const closesAt = position.endDate ? new Date(position.endDate) : null;
  const timeWindowAnalysis = analyzeTimeWindows(priceHistory, closesAt, options.timeWindows);

  const stopLossSimulations = simulateStopLoss(
    priceHistory,
    entryPrice,
    entryTs,
    position.profitLoss,
    position.cost,
    options.stopLossThresholds,
  );

  const didOriginalWin =
    position.status === "won" ? true : position.status === "lost" ? false : null;

  const hedgingSimulations = simulateHedging(
    priceHistory,
    oppositeHistory,
    entryPrice,
    entryTs,
    position.cost,
    position.profitLoss,
    didOriginalWin,
    options.stopLossThresholds,
  );

  const positionInfo: PositionInfo = {
    id: hashTokenId(position.tokenId),
    marketId: position.conditionId,
    marketQuestion: position.title,
    marketSlug: position.slug,
    eventSlug: position.eventSlug || undefined,
    tokenId: position.tokenId,
    outcome: position.outcome,
    entryPrice: position.entryPrice,
    cost: position.cost,
    closesAt: position.endDate || undefined,
    status: position.status,
    resolvedAt: position.resolvedAt?.toISOString(),
    profitLoss: position.profitLoss,
    isSimulated: false,
    createdAt: position.createdAt.toISOString(),
  };

  return {
    position: positionInfo,
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
      outcome: position.status,
      tags: [],
      normalized: normalizedCategory,
    },
    analyzedAt: new Date().toISOString(),
    fidelityMinutes: options.fidelityMinutes,
  };
}

function hashTokenId(tokenId: string): number {
  let hash = 0;
  for (let i = 0; i < tokenId.length; i++) {
    const char = tokenId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function calculateCategoryAnalysis(
  analytics: PositionAnalytics[],
  stopLossThresholds: number[],
): CategoryAnalysis[] {
  const categoryMap = new Map<string, PositionAnalytics[]>();

  for (const a of analytics) {
    const cat = a.category.normalized;
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat)!.push(a);
  }

  const results: CategoryAnalysis[] = [];

  for (const [name, positions] of categoryMap) {
    const wonCount = positions.filter((p) => p.category.outcome === "won").length;
    const lostCount = positions.filter((p) => p.category.outcome === "lost").length;
    const openCount = positions.filter((p) => p.category.outcome === "open").length;
    const resolved = wonCount + lostCount;
    const winRate = resolved > 0 ? (wonCount / resolved) * 100 : 0;
    const totalPnL = positions.reduce((sum, p) => sum + (p.position.profitLoss ?? 0), 0);
    const avgPnL = positions.length > 0 ? totalPnL / positions.length : 0;
    const avgDrawdown =
      positions.length > 0
        ? positions.reduce((sum, p) => sum + p.maxDrawdownPercent, 0) / positions.length
        : 0;

    const resolvedPositions = positions.filter((p) => p.category.outcome !== "open");

    const stopLossAnalysis: CategoryStopLossAnalysis[] = stopLossThresholds.map((threshold) => {
      let triggered = 0;
      let recovered = 0;
      let netImpact = 0;

      for (const p of resolvedPositions) {
        const sim = p.stopLossSimulations.find((s) => s.threshold === threshold);
        if (sim?.triggered) {
          triggered++;
          if (sim.recoveredAfterTrigger) recovered++;
          if (sim.profitLossIfSold !== null && sim.profitLossIfHeld !== null) {
            netImpact += sim.profitLossIfSold - sim.profitLossIfHeld;
          }
        }
      }

      return {
        threshold,
        triggered,
        recovered,
        netImpact,
        avgImpactPerPosition: triggered > 0 ? netImpact / triggered : 0,
      };
    });

    const hedgingAnalysis: CategoryHedgingAnalysis[] = stopLossThresholds.map((threshold) => {
      let triggered = 0;
      let fullLockNetImpact = 0;
      let doubleOppositeNetImpact = 0;

      for (const p of resolvedPositions) {
        const sim = p.hedgingSimulations.find((s) => s.threshold === threshold);
        if (sim?.triggered && sim.strategies.length > 0) {
          triggered++;
          const actualPnL = p.position.profitLoss ?? 0;

          for (const strat of sim.strategies) {
            if (strat.actualPnl !== null) {
              if (strat.name === "fullLockIn") {
                fullLockNetImpact += strat.actualPnl - actualPnL;
              } else if (strat.name === "doubleOpposite") {
                doubleOppositeNetImpact += strat.actualPnl - actualPnL;
              }
            }
          }
        }
      }

      return {
        threshold,
        triggered,
        fullLockNetImpact,
        doubleOppositeNetImpact,
      };
    });

    const bestStrategy = determineBestStrategy(stopLossAnalysis, hedgingAnalysis);

    results.push({
      name,
      positions: positions.length,
      wonCount,
      lostCount,
      openCount,
      winRate,
      totalPnL,
      avgPnL,
      avgDrawdown,
      stopLossAnalysis,
      hedgingAnalysis,
      bestStrategy,
    });
  }

  return results.sort((a, b) => b.positions - a.positions);
}

function determineBestStrategy(
  stopLossAnalysis: CategoryStopLossAnalysis[],
  hedgingAnalysis: CategoryHedgingAnalysis[],
): BestStrategyRecommendation {
  let bestType: "none" | "stop-loss" | "hedge-full" | "hedge-double" = "none";
  let bestThreshold: number | null = null;
  let bestImprovement = 0;

  for (const sl of stopLossAnalysis) {
    if (sl.netImpact > bestImprovement) {
      bestImprovement = sl.netImpact;
      bestType = "stop-loss";
      bestThreshold = sl.threshold;
    }
  }

  for (const h of hedgingAnalysis) {
    if (h.fullLockNetImpact > bestImprovement) {
      bestImprovement = h.fullLockNetImpact;
      bestType = "hedge-full";
      bestThreshold = h.threshold;
    } else if (h.fullLockNetImpact === bestImprovement && bestImprovement > 0) {
      bestType = "hedge-full";
      bestThreshold = h.threshold;
    }

    if (h.doubleOppositeNetImpact > bestImprovement) {
      bestImprovement = h.doubleOppositeNetImpact;
      bestType = "hedge-double";
      bestThreshold = h.threshold;
    } else if (h.doubleOppositeNetImpact === bestImprovement && bestImprovement > 0) {
      bestType = "hedge-double";
      bestThreshold = h.threshold;
    }
  }

  let reason = "";
  if (bestType === "none") {
    reason = "No strategy improves P/L for this category";
  } else if (bestType === "stop-loss") {
    reason = `Stop-loss at ${bestThreshold}% would have saved $${bestImprovement.toFixed(2)}`;
  } else if (bestType === "hedge-full") {
    reason = `Full lock-in hedge at ${bestThreshold}% drop would have saved $${bestImprovement.toFixed(2)}`;
  } else if (bestType === "hedge-double") {
    reason = `2x opposite hedge at ${bestThreshold}% drop would have saved $${bestImprovement.toFixed(2)}`;
  }

  return {
    type: bestType,
    threshold: bestThreshold,
    expectedImprovement: bestImprovement,
    reason,
  };
}

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
      byCategory: [],
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

  const resolvedOnly = analytics.filter((a) => a.category.outcome !== "open");

  const stopLossImpact = stopLossThresholds.map((threshold) => {
    let triggered = 0;
    let recovered = 0;
    let netImpact = 0;

    for (const a of resolvedOnly) {
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

  const byCategory = calculateCategoryAnalysis(analytics, stopLossThresholds);

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
    byTags: byTags.sort((a, b) => b.count - a.count).slice(0, 20),
    byCategory,
  };
}

const CONCURRENCY_LIMIT = 10;

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

export async function getPositionAnalyticsFromApi(
  walletAddress: string,
  options: Partial<AnalyticsOptions> = {},
  signal?: AbortSignal,
): Promise<{
  positions: PositionAnalytics[];
  summary: AnalyticsSummary;
  options: AnalyticsOptions;
}> {
  const opts: AnalyticsOptions = { ...DEFAULT_OPTIONS, ...options };

  let positions = await reconstructPositionsFromApi(walletAddress, signal);

  if (opts.status !== "all") {
    positions = positions.filter((p) => p.status === opts.status);
  }

  if (opts.limit && positions.length > opts.limit) {
    positions = positions.slice(0, opts.limit);
  }

  const results = await parallelLimit(positions, CONCURRENCY_LIMIT, async (position) => {
    try {
      return await analyzePosition(position, opts, signal);
    } catch (error) {
      console.error("Failed to analyze position", position.tokenId, error);
      return null;
    }
  });

  const analytics = results.filter((r): r is PositionAnalytics => r !== null);
  const summary = calculateSummary(analytics, opts.stopLossThresholds);

  return { positions: analytics, summary, options: opts };
}

function convertDBRecordToPositionAnalytics(record: ResolvedPositionFromDB): PositionAnalytics {
  const entryPrice = parseFloat(record.entryPrice || "0");
  const cost = parseFloat(record.cost || "0");
  const profitLoss = parseFloat(record.profitLoss || "0");
  const maxDrawdownPercent = parseFloat(record.maxDrawdownPercent || "0");
  const lowestPrice = parseFloat(record.lowestPrice || "0");
  const highestPrice = parseFloat(record.highestPrice || "0");
  const finalPrice = parseFloat(record.finalPrice || "0");
  const fidelityMinutes = parseInt(record.fidelityMinutes || "5", 10) as 1 | 5 | 15;

  const priceHistory = (record.priceHistory || []) as { timestamp: number; price: number }[];
  const oppositeHistory = (record.oppositeOutcomePriceHistory || []) as {
    timestamp: number;
    price: number;
  }[];

  const stopLossSimulations = (record.stopLossSimulations || []) as StopLossSimulation[];
  const hedgingSimulations = (record.hedgingSimulations || []) as HedgingSimulation[];

  const result = record.result as "won" | "lost" | null;
  const status: "open" | "won" | "lost" =
    result === "won" ? "won" : result === "lost" ? "lost" : "open";

  return {
    position: {
      id: record.id,
      marketId: record.conditionId,
      marketQuestion: record.marketQuestion || "",
      marketSlug: record.marketSlug || undefined,
      eventSlug: record.eventSlug || undefined,
      tokenId: record.tokenId,
      outcome: record.outcome || "",
      entryPrice,
      cost,
      closesAt: undefined,
      status,
      resolvedAt: record.resolvedAt || undefined,
      profitLoss,
      isSimulated: false,
      createdAt: record.createdAt || new Date().toISOString(),
    },
    priceHistory,
    oppositeOutcomePriceHistory: oppositeHistory,
    entryPrice,
    lowestPriceAfterEntry: lowestPrice,
    lowestPriceTimestamp: null,
    highestPriceAfterEntry: highestPrice,
    highestPriceTimestamp: null,
    maxDrawdownPercent,
    currentOrFinalPrice: finalPrice,
    oppositeOutcome: null,
    timeWindowAnalysis: [],
    stopLossSimulations,
    hedgingSimulations,
    category: {
      outcome: status,
      tags: (record.tags || []) as string[],
      normalized: record.category || "Unknown",
    },
    analyzedAt: record.capturedAt,
    fidelityMinutes,
  };
}

export async function getPositionAnalyticsHybrid(
  walletAddress: string,
  options: Partial<AnalyticsOptions> = {},
  signal?: AbortSignal,
): Promise<{
  positions: PositionAnalytics[];
  summary: AnalyticsSummary;
  options: AnalyticsOptions;
  fromDB: number;
  fromAPI: number;
}> {
  const opts: AnalyticsOptions = { ...DEFAULT_OPTIONS, ...options };

  let resolvedFromDB: PositionAnalytics[] = [];
  try {
    const dbResponse = await fetchResolvedPositionsFromDB(walletAddress, signal);
    resolvedFromDB = dbResponse.positions.map(convertDBRecordToPositionAnalytics);
  } catch (error) {
    console.warn("Failed to fetch from DB, falling back to API only", error);
  }

  const resolvedTokenIds = new Set(resolvedFromDB.map((p) => p.position.tokenId));

  let openPositions = await reconstructPositionsFromApi(walletAddress, signal);
  openPositions = openPositions.filter(
    (p) => p.status === "open" && !resolvedTokenIds.has(p.tokenId),
  );

  if (opts.limit && openPositions.length > opts.limit) {
    openPositions = openPositions.slice(0, opts.limit);
  }

  const openResults = await parallelLimit(openPositions, CONCURRENCY_LIMIT, async (position) => {
    try {
      return await analyzePosition(position, opts, signal);
    } catch (error) {
      console.error("Failed to analyze position", position.tokenId, error);
      return null;
    }
  });

  const openAnalytics = openResults.filter((r): r is PositionAnalytics => r !== null);

  let allAnalytics = [...resolvedFromDB, ...openAnalytics];

  if (opts.status !== "all") {
    allAnalytics = allAnalytics.filter((p) => p.category.outcome === opts.status);
  }

  allAnalytics.sort((a, b) => {
    const dateA = new Date(a.position.createdAt).getTime();
    const dateB = new Date(b.position.createdAt).getTime();
    return dateB - dateA;
  });

  if (opts.limit && allAnalytics.length > opts.limit) {
    allAnalytics = allAnalytics.slice(0, opts.limit);
  }

  const summary = calculateSummary(allAnalytics, opts.stopLossThresholds);

  return {
    positions: allAnalytics,
    summary,
    options: opts,
    fromDB: resolvedFromDB.length,
    fromAPI: openAnalytics.length,
  };
}

export async function triggerResolvedPositionsSync(
  walletAddress: string,
  fidelity = 5,
  signal?: AbortSignal,
): Promise<{ synced: number; existing: number; total: number }> {
  const response = await syncResolvedPositions(walletAddress, fidelity, signal);
  return {
    synced: response.synced,
    existing: response.existing,
    total: response.total || response.existing + response.synced,
  };
}

export async function fetchLastSyncTime(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<Date | null> {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";
  const response = await fetch(`${apiBase}/resolved-positions/${walletAddress}/last-sync`, {
    signal,
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { success: boolean; lastSyncTime: string | null };
  return data.lastSyncTime ? new Date(data.lastSyncTime) : null;
}
