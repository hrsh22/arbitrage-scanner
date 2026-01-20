import "dotenv/config";
import { logger } from "../logger.js";
import { TRACKED_WALLETS } from "../constants/trackedWallets.js";
import { resolvedPositionsRepository } from "../db/repositories/resolvedPositionsRepository.js";
import { walletAnalyticsRepository } from "../db/repositories/walletAnalyticsRepository.js";
import type { NewResolvedPosition, ResolvedPosition } from "../db/analyticsSchema.js";

const DATA_API_BASE = "https://data-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

const FIDELITY_MINUTES = 5;
const THRESHOLDS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90];
const BATCH_SIZE = 50;
const ENTRY_TIMING_HOURS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24];

const FORCE_RESYNC = process.argv.includes("--force");

interface PricePoint {
  t: number;
  p: number;
}

interface ClosedPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  timestamp: number;
  title: string;
  slug: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
}

interface Activity {
  timestamp: number;
  conditionId: string;
  type: "TRADE" | "REDEEM" | "MAKER_REBATE";
  size: number;
  usdcSize: number;
  price: number;
  asset: string;
  side: "BUY" | "SELL";
}

async function fetchClosedPositions(walletAddress: string): Promise<ClosedPosition[]> {
  const allPositions: ClosedPosition[] = [];
  let offset = 0;
  const batchSize = 50;

  while (true) {
    const url = `${DATA_API_BASE}/v1/closed-positions?user=${walletAddress}&limit=${batchSize}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch closed positions: ${response.status}`);
    const batch = (await response.json()) as ClosedPosition[];
    if (batch.length === 0) break;
    allPositions.push(...batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
    if (offset % 500 === 0) {
      logger.info("Closed positions fetch progress", { offset, fetched: allPositions.length });
    }
  }

  return allPositions;
}

async function fetchActivity(walletAddress: string): Promise<Activity[]> {
  const allActivities: Activity[] = [];
  const batchSize = 500;
  let lastTimestamp: number | null = null;
  const maxIterations = 100;

  for (let i = 0; i < maxIterations; i++) {
    let url = `${DATA_API_BASE}/activity?user=${walletAddress}&limit=${batchSize}&sortBy=TIMESTAMP&sortDirection=ASC`;
    if (lastTimestamp !== null) {
      url += `&start=${lastTimestamp + 1}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch activity: ${response.status}`);
    const batch = (await response.json()) as Activity[];
    if (batch.length === 0) break;

    allActivities.push(...batch);
    lastTimestamp = batch[batch.length - 1]!.timestamp;

    if (batch.length < batchSize) break;
  }

  return allActivities;
}

function buildEntryTimestampMap(activity: Activity[]): Map<string, number> {
  const entryMap = new Map<string, number>();

  for (const act of activity) {
    if (act.type === "TRADE" && act.side === "BUY") {
      const existing = entryMap.get(act.asset);
      if (!existing || act.timestamp < existing) {
        entryMap.set(act.asset, act.timestamp);
      }
    }
  }

  return entryMap;
}

async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  endTs: number,
  fidelityMinutes: number,
): Promise<{ timestamp: number; price: number }[]> {
  const url = `${CLOB_API_BASE}/prices-history?market=${tokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=${fidelityMinutes}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = (await response.json()) as { history?: PricePoint[] };
  return (data.history || []).map((p) => ({ timestamp: p.t, price: p.p }));
}

async function fetchEventTags(eventSlug: string): Promise<string[]> {
  try {
    const response = await fetch(`${GAMMA_API_BASE}/events/slug/${eventSlug}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const event = (await response.json()) as { tags?: { label: string }[] };
    return event.tags?.map((t) => t.label) ?? [];
  } catch {
    return [];
  }
}

function normalizeToCategory(tags: string[]): string {
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

function findActualResolutionTime(history: { timestamp: number; price: number }[]): Date | null {
  if (history.length === 0) return null;

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]!;
    if (curr.price < 0.001 || curr.price > 0.999) {
      return new Date(curr.timestamp * 1000);
    }
  }

  return new Date(sorted[sorted.length - 1]!.timestamp * 1000);
}

function findPriceAtTimestamp(
  history: { timestamp: number; price: number }[],
  targetTs: number,
): number | null {
  if (history.length === 0) return null;
  let closest = history[0]!;
  let minDiff = Math.abs(closest.timestamp - targetTs);
  for (const p of history) {
    const diff = Math.abs(p.timestamp - targetTs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }
  return minDiff <= 300 ? closest.price : null;
}

function simulateStopLoss(
  priceHistory: { timestamp: number; price: number }[],
  entryPrice: number,
  entryTs: number,
  cost: number,
  threshold: number,
  actualPnL: number,
) {
  const stopPrice = entryPrice * (1 - threshold / 100);
  const shares = cost / entryPrice;

  const entryPricePoint = { timestamp: entryTs, price: entryPrice };
  const historyWithEntryPoint = [...priceHistory, entryPricePoint].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const relevantHistory = historyWithEntryPoint.filter((p) => p.timestamp >= entryTs);

  let triggerIndex = -1;
  let interpolatedTrigger: { timestamp: number; price: number } | null = null;

  for (let i = 1; i < relevantHistory.length; i++) {
    const point = relevantHistory[i]!;
    if (point.price <= stopPrice) {
      if (i === 1) {
        const prevPoint = relevantHistory[0]!;
        const priceDiff = prevPoint.price - point.price;
        const thresholdDiff = prevPoint.price - stopPrice;
        const ratio = priceDiff > 0 ? thresholdDiff / priceDiff : 0.5;
        const interpolatedTs =
          prevPoint.timestamp + ratio * (point.timestamp - prevPoint.timestamp);
        interpolatedTrigger = { timestamp: interpolatedTs, price: stopPrice };
      } else {
        triggerIndex = i;
      }
      break;
    }
  }

  if (triggerIndex === -1 && interpolatedTrigger === null) {
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

  const triggerPoint = interpolatedTrigger ?? relevantHistory[triggerIndex]!;
  const afterTriggerStartIdx = interpolatedTrigger ? 1 : triggerIndex + 1;
  const afterTrigger = relevantHistory.slice(afterTriggerStartIdx);
  const maxPriceAfterTrigger =
    afterTrigger.length > 0 ? Math.max(...afterTrigger.map((p) => p.price)) : triggerPoint.price;
  const valueIfSold = shares * stopPrice;
  const profitLossIfSold = valueIfSold - cost;
  const recoveredAfterTrigger = actualPnL > profitLossIfSold;

  return {
    threshold,
    triggered: true,
    triggerPrice: triggerPoint.price,
    triggerTimestamp: triggerPoint.timestamp,
    recoveredAfterTrigger,
    maxPriceAfterTrigger,
    profitLossIfSold,
    profitLossIfHeld: actualPnL,
  };
}

function simulateHedging(
  priceHistory: { timestamp: number; price: number }[],
  oppositeHistory: { timestamp: number; price: number }[],
  entryPrice: number,
  entryTs: number,
  cost: number,
  threshold: number,
  actualPnL: number,
  didOriginalWin: boolean | null,
) {
  const triggerPrice = entryPrice * (1 - threshold / 100);
  const shares = cost / entryPrice;
  const entryPricePoint = { timestamp: entryTs, price: entryPrice };
  const historyWithEntryPoint = [...priceHistory, entryPricePoint].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const relevantHistory = historyWithEntryPoint.filter((p) => p.timestamp >= entryTs);

  let triggerIndex = -1;
  let interpolatedTrigger: { timestamp: number; price: number } | null = null;

  for (let i = 1; i < relevantHistory.length; i++) {
    const point = relevantHistory[i]!;
    if (point.price <= triggerPrice) {
      if (i === 1) {
        const prevPoint = relevantHistory[0]!;
        const priceDiff = prevPoint.price - point.price;
        const thresholdDiff = prevPoint.price - triggerPrice;
        const ratio = priceDiff > 0 ? thresholdDiff / priceDiff : 0.5;
        const interpolatedTs =
          prevPoint.timestamp + ratio * (point.timestamp - prevPoint.timestamp);
        interpolatedTrigger = { timestamp: interpolatedTs, price: triggerPrice };
      } else {
        triggerIndex = i;
      }
      break;
    }
  }

  if (triggerIndex === -1 && interpolatedTrigger === null) {
    return {
      threshold,
      triggered: false,
      triggerPrice: null,
      triggerTimestamp: null,
      oppositePrice: null,
      strategies: [],
    };
  }

  const triggerPoint = interpolatedTrigger ?? relevantHistory[triggerIndex]!;
  let oppPrice = findPriceAtTimestamp(oppositeHistory, triggerPoint.timestamp);
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

  const strategies: {
    name: string;
    hedgeShares: number;
    hedgeCost: number;
    totalInvestment: number;
    pnlIfOriginalWins: number;
    pnlIfOppositeWins: number;
    actualPnl: number | null;
    betterThanNoHedge: boolean | null;
  }[] = [];

  const fullHedgeShares = shares;
  const fullHedgeCost = fullHedgeShares * oppPrice;
  const fullTotalInvestment = cost + fullHedgeCost;
  const fullPnlIfOriginalWins = shares * 1 - fullTotalInvestment;
  const fullPnlIfOppositeWins = fullHedgeShares * 1 - fullTotalInvestment;
  let fullActualPnl: number | null = null;
  if (didOriginalWin === true) fullActualPnl = fullPnlIfOriginalWins;
  else if (didOriginalWin === false) fullActualPnl = fullPnlIfOppositeWins;

  strategies.push({
    name: "fullLockIn",
    hedgeShares: fullHedgeShares,
    hedgeCost: fullHedgeCost,
    totalInvestment: fullTotalInvestment,
    pnlIfOriginalWins: fullPnlIfOriginalWins,
    pnlIfOppositeWins: fullPnlIfOppositeWins,
    actualPnl: fullActualPnl,
    betterThanNoHedge: fullActualPnl !== null ? fullActualPnl > actualPnL : null,
  });

  const doubleHedgeShares = shares * 2;
  const doubleHedgeCost = doubleHedgeShares * oppPrice;
  const doubleTotalInvestment = cost + doubleHedgeCost;
  const doublePnlIfOriginalWins = shares * 1 - doubleTotalInvestment;
  const doublePnlIfOppositeWins = doubleHedgeShares * 1 - doubleTotalInvestment;
  let doubleActualPnl: number | null = null;
  if (didOriginalWin === true) doubleActualPnl = doublePnlIfOriginalWins;
  else if (didOriginalWin === false) doubleActualPnl = doublePnlIfOppositeWins;

  strategies.push({
    name: "doubleOpposite",
    hedgeShares: doubleHedgeShares,
    hedgeCost: doubleHedgeCost,
    totalInvestment: doubleTotalInvestment,
    pnlIfOriginalWins: doublePnlIfOriginalWins,
    pnlIfOppositeWins: doublePnlIfOppositeWins,
    actualPnl: doubleActualPnl,
    betterThanNoHedge: doubleActualPnl !== null ? doubleActualPnl > actualPnL : null,
  });

  return {
    threshold,
    triggered: true,
    triggerPrice: triggerPoint.price,
    triggerTimestamp: triggerPoint.timestamp,
    oppositePrice: oppPrice,
    strategies,
  };
}

async function syncWallet(wallet: string): Promise<{ synced: number; existing: number }> {
  const existingTokenIds = await resolvedPositionsRepository.getExistingTokenIds(wallet);
  logger.info("Found existing positions in DB", { wallet, count: existingTokenIds.size });

  const [closedPositions, activity] = await Promise.all([
    fetchClosedPositions(wallet),
    fetchActivity(wallet),
  ]);

  logger.info("Fetched data from API", {
    wallet,
    closedPositions: closedPositions.length,
    activityRecords: activity.length,
  });

  const entryTimestampMap = buildEntryTimestampMap(activity);
  logger.info("Built entry timestamp map", { entriesFound: entryTimestampMap.size });

  const won = closedPositions.filter((p) => p.realizedPnl >= 0).length;
  const lost = closedPositions.filter((p) => p.realizedPnl < 0).length;
  logger.info("Closed positions breakdown", { won, lost });

  const positionsToProcess = FORCE_RESYNC
    ? closedPositions
    : closedPositions.filter((p) => !existingTokenIds.has(p.asset));
  logger.info("Positions to process", {
    wallet,
    count: positionsToProcess.length,
    existingCount: existingTokenIds.size,
    forceResync: FORCE_RESYNC,
  });

  if (positionsToProcess.length === 0) {
    return { synced: 0, existing: existingTokenIds.size };
  }

  let totalInserted = 0;

  async function processClosedPosition(pos: ClosedPosition): Promise<NewResolvedPosition> {
    const result: "won" | "lost" = pos.realizedPnl >= 0 ? "won" : "lost";
    const resolvedTs = pos.timestamp;

    const actualEntryTs = entryTimestampMap.get(pos.asset);
    const entryTs = actualEntryTs ?? resolvedTs - 86400 * 7;

    const positionDurationSeconds = resolvedTs - entryTs;
    const positionDurationHours = positionDurationSeconds / 3600;
    const fidelity = positionDurationHours < 1 ? 1 : FIDELITY_MINUTES;

    const twentyFourHoursBeforeResolution = resolvedTs - 24 * 60 * 60;
    const historyStartTs = Math.min(entryTs, twentyFourHoursBeforeResolution);

    const [priceHistory, oppositeHistory] = await Promise.all([
      fetchPriceHistory(pos.asset, historyStartTs, resolvedTs, fidelity),
      pos.oppositeAsset
        ? fetchPriceHistory(pos.oppositeAsset, historyStartTs, resolvedTs, fidelity)
        : Promise.resolve([]),
    ]);

    const entryPrice = pos.avgPrice;
    // IMPORTANT: totalBought is shares, not USDC! Multiply by avgPrice to get actual USDC cost.
    const cost = pos.totalBought * pos.avgPrice;
    const actualPnL = pos.realizedPnl;
    const didOriginalWin = result === "won";

    const relevantHistory = priceHistory.filter((p) => p.timestamp >= entryTs);
    let lowestPrice = entryPrice;
    let highestPrice = entryPrice;
    for (const p of relevantHistory) {
      if (p.price < lowestPrice) lowestPrice = p.price;
      if (p.price > highestPrice) highestPrice = p.price;
    }

    const maxDrawdownPercent = entryPrice > 0 ? ((entryPrice - lowestPrice) / entryPrice) * 100 : 0;
    const stopLossSimulations = THRESHOLDS.map((t) =>
      simulateStopLoss(priceHistory, entryPrice, entryTs, cost, t, actualPnL),
    );
    const hedgingSimulations = THRESHOLDS.map((t) =>
      simulateHedging(
        priceHistory,
        oppositeHistory,
        entryPrice,
        entryTs,
        cost,
        t,
        actualPnL,
        didOriginalWin,
      ),
    );

    let tags: string[] = [];
    let category = "Unknown";
    if (pos.eventSlug) {
      tags = await fetchEventTags(pos.eventSlug);
      category = normalizeToCategory(tags);
    }

    return {
      walletAddress: wallet,
      tokenId: pos.asset,
      conditionId: pos.conditionId,
      eventSlug: pos.eventSlug || null,
      marketSlug: pos.slug,
      marketQuestion: pos.title,
      outcome: pos.outcome,
      entryPrice: entryPrice.toString(),
      cost: cost.toString(),
      size: (cost / entryPrice).toString(),
      createdAt: new Date(entryTs * 1000),
      resolvedAt: new Date(pos.timestamp * 1000),
      marketEndDate: findActualResolutionTime(priceHistory),
      finalPrice: pos.curPrice.toString(),
      profitLoss: pos.realizedPnl.toString(),
      result,
      maxDrawdownPercent: maxDrawdownPercent.toString(),
      lowestPrice: lowestPrice.toString(),
      highestPrice: highestPrice.toString(),
      priceHistory: priceHistory,
      oppositeOutcomePriceHistory: oppositeHistory,
      stopLossSimulations,
      hedgingSimulations,
      category,
      tags,
      fidelityMinutes: fidelity.toString(),
    };
  }

  for (let i = 0; i < positionsToProcess.length; i += BATCH_SIZE) {
    const batch = positionsToProcess.slice(i, i + BATCH_SIZE);
    const batchResults: NewResolvedPosition[] = [];

    for (const pos of batch) {
      try {
        const record = await processClosedPosition(pos);
        batchResults.push(record);
      } catch (err) {
        logger.warn("Failed to process closed position", {
          tokenId: pos.asset,
          error: (err as Error).message,
        });
      }
    }

    if (batchResults.length > 0) {
      const inserted = await resolvedPositionsRepository.upsertMany(batchResults);
      totalInserted += inserted;
      logger.info("Saved batch", {
        batch: Math.floor(i / BATCH_SIZE) + 1,
        inserted,
        totalInserted,
        remaining: positionsToProcess.length - i - batch.length,
      });
    }
  }

  return { synced: totalInserted, existing: existingTokenIds.size };
}

interface StopLossSimulation {
  threshold: number;
  triggered: boolean;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  recoveredAfterTrigger: boolean;
  maxPriceAfterTrigger: number | null;
  profitLossIfSold: number | null;
  profitLossIfHeld: number;
}

interface HedgingSimulation {
  threshold: number;
  triggered: boolean;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  oppositePrice: number | null;
  strategies: {
    name: string;
    hedgeShares: number;
    hedgeCost: number;
    totalInvestment: number;
    pnlIfOriginalWins: number;
    pnlIfOppositeWins: number;
    actualPnl: number | null;
    betterThanNoHedge: boolean | null;
  }[];
}

interface StopLossAnalysisItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  totalPnlIfSold: number;
  totalPnlIfHeld: number;
  netImpact: number;
  avgImpactPerTriggered: number;
}

interface HedgingAnalysisItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  fullLockGrossSavings: number;
  fullLockCostOnWinners: number;
  fullLockNetImpact: number;
  doubleOppositeGrossSavings: number;
  doubleOppositeCostOnWinners: number;
  doubleOppositeNetImpact: number;
}

interface CategoryStopLossItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  netImpact: number;
}

interface CategoryHedgingItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  fullLockGrossSavings: number;
  fullLockCostOnWinners: number;
  fullLockNetImpact: number;
  doubleOppositeGrossSavings: number;
  doubleOppositeCostOnWinners: number;
  doubleOppositeNetImpact: number;
}

interface BestStrategy {
  type: "none" | "stop-loss" | "hedge-full" | "hedge-double";
  threshold: number | null;
  expectedImprovement: number;
  reason: string;
}

interface CategoryBreakdownItem {
  category: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgDrawdown: number;
  stopLossAnalysis: CategoryStopLossItem[];
  hedgingAnalysis: CategoryHedgingItem[];
  bestStrategy: BestStrategy;
}

interface DailyPnlItem {
  date: string;
  pnl: number;
  positionCount: number;
  cumulativePnl: number;
}

interface EntryTimingItem {
  hoursBeforeResolution: number;
  positionsEligible: number;
  positionsWon: number;
  positionsLost: number;
  winRate: number;
  avgEntryPrice: number;
}

async function computeWalletAnalytics(wallet: string): Promise<void> {
  const positions = await resolvedPositionsRepository.findByWallet(wallet);
  if (positions.length === 0) {
    logger.info("No positions to compute analytics for", { wallet });
    return;
  }

  const wins = positions.filter((p) => p.result === "won");
  const losses = positions.filter((p) => p.result === "lost");

  const totalPnl = positions.reduce((sum, p) => sum + parseFloat(p.profitLoss || "0"), 0);
  const totalCost = positions.reduce((sum, p) => sum + parseFloat(p.cost || "0"), 0);
  const totalCount = positions.length;
  const winRate = totalCount > 0 ? wins.length / totalCount : 0;

  const avgEntryPrice =
    positions.reduce((sum, p) => sum + parseFloat(p.entryPrice || "0"), 0) / totalCount;
  const avgPnlPerPosition = totalPnl / totalCount;

  let totalHoldingHours = 0;
  for (const p of positions) {
    if (p.createdAt && p.marketEndDate) {
      const hours =
        (new Date(p.marketEndDate).getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60);
      totalHoldingHours += Math.max(0, hours);
    }
  }
  const avgHoldingHours = totalHoldingHours / totalCount;

  const stopLossAnalysis: StopLossAnalysisItem[] = THRESHOLDS.map((threshold) => {
    let triggeredCount = 0;
    let recoveredCount = 0;
    let totalPnlIfSold = 0;
    let totalPnlIfHeld = 0;

    for (const p of positions) {
      const sims = p.stopLossSimulations as StopLossSimulation[] | null;
      if (!sims) continue;
      const sim = sims.find((s) => s.threshold === threshold);
      if (sim?.triggered) {
        triggeredCount++;
        if (sim.recoveredAfterTrigger) recoveredCount++;
        if (sim.profitLossIfSold !== null) totalPnlIfSold += sim.profitLossIfSold;
        totalPnlIfHeld += sim.profitLossIfHeld;
      }
    }

    const netImpact = totalPnlIfSold - totalPnlIfHeld;
    return {
      threshold,
      triggeredCount,
      recoveredCount,
      totalPnlIfSold,
      totalPnlIfHeld,
      netImpact,
      avgImpactPerTriggered: triggeredCount > 0 ? netImpact / triggeredCount : 0,
    };
  });

  const hedgingAnalysis: HedgingAnalysisItem[] = THRESHOLDS.map((threshold) => {
    let triggeredCount = 0;
    let recoveredCount = 0;
    let fullLockGrossSavings = 0;
    let fullLockCostOnWinners = 0;
    let doubleOppositeGrossSavings = 0;
    let doubleOppositeCostOnWinners = 0;

    for (const p of positions) {
      const sims = p.hedgingSimulations as HedgingSimulation[] | null;
      if (!sims) continue;
      const sim = sims.find((s) => s.threshold === threshold);
      if (sim?.triggered && sim.strategies.length > 0) {
        triggeredCount++;
        const isWinner = p.result === "won";
        if (isWinner) recoveredCount++;
        const actualPnL = parseFloat(p.profitLoss || "0");

        for (const strat of sim.strategies) {
          if (strat.actualPnl !== null) {
            const impact = strat.actualPnl - actualPnL;
            if (strat.name === "fullLockIn") {
              if (impact > 0) {
                fullLockGrossSavings += impact;
              } else {
                fullLockCostOnWinners += Math.abs(impact);
              }
            } else if (strat.name === "doubleOpposite") {
              if (impact > 0) {
                doubleOppositeGrossSavings += impact;
              } else {
                doubleOppositeCostOnWinners += Math.abs(impact);
              }
            }
          }
        }
      }
    }

    return {
      threshold,
      triggeredCount,
      recoveredCount,
      fullLockGrossSavings,
      fullLockCostOnWinners,
      fullLockNetImpact: fullLockGrossSavings - fullLockCostOnWinners,
      doubleOppositeGrossSavings,
      doubleOppositeCostOnWinners,
      doubleOppositeNetImpact: doubleOppositeGrossSavings - doubleOppositeCostOnWinners,
    };
  });

  const categoryMap = new Map<string, ResolvedPosition[]>();
  for (const p of positions) {
    const cat = p.category || "Unknown";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(p);
  }

  const categoryBreakdown: CategoryBreakdownItem[] = [];
  for (const [category, catPositions] of categoryMap) {
    const catWins = catPositions.filter((p) => p.result === "won").length;
    const catLosses = catPositions.filter((p) => p.result === "lost").length;
    const catTotal = catPositions.length;
    const catPnl = catPositions.reduce((sum, p) => sum + parseFloat(p.profitLoss || "0"), 0);
    const catDrawdown =
      catPositions.reduce((sum, p) => sum + parseFloat(p.maxDrawdownPercent || "0"), 0) / catTotal;

    const catStopLossAnalysis: CategoryStopLossItem[] = THRESHOLDS.map((threshold) => {
      let triggeredCount = 0;
      let recoveredCount = 0;
      let netImpact = 0;

      for (const pos of catPositions) {
        const sims = pos.stopLossSimulations as StopLossSimulation[] | null;
        if (!sims) continue;
        const sim = sims.find((s) => s.threshold === threshold);
        if (sim && sim.triggered) {
          triggeredCount++;
          if (sim.recoveredAfterTrigger) recoveredCount++;
          const pnlIfSold = sim.profitLossIfSold ?? 0;
          netImpact += pnlIfSold - sim.profitLossIfHeld;
        }
      }

      return { threshold, triggeredCount, recoveredCount, netImpact };
    });

    const catHedgingAnalysis: CategoryHedgingItem[] = THRESHOLDS.map((threshold) => {
      let triggeredCount = 0;
      let recoveredCount = 0;
      let fullLockGrossSavings = 0;
      let fullLockCostOnWinners = 0;
      let doubleOppositeGrossSavings = 0;
      let doubleOppositeCostOnWinners = 0;

      for (const pos of catPositions) {
        const sims = pos.hedgingSimulations as HedgingSimulation[] | null;
        if (!sims) continue;
        const sim = sims.find((s) => s.threshold === threshold);
        if (sim && sim.triggered && sim.strategies) {
          triggeredCount++;
          const isWinner = pos.result === "won";
          if (isWinner) recoveredCount++;

          const actualPnL = parseFloat(pos.profitLoss || "0");
          const fullLock = sim.strategies.find((st) => st.name === "fullLockIn");
          const doubleOpp = sim.strategies.find((st) => st.name === "doubleOpposite");

          if (fullLock && fullLock.actualPnl !== null) {
            const impact = fullLock.actualPnl - actualPnL;
            if (impact > 0) {
              fullLockGrossSavings += impact;
            } else {
              fullLockCostOnWinners += Math.abs(impact);
            }
          }
          if (doubleOpp && doubleOpp.actualPnl !== null) {
            const impact = doubleOpp.actualPnl - actualPnL;
            if (impact > 0) {
              doubleOppositeGrossSavings += impact;
            } else {
              doubleOppositeCostOnWinners += Math.abs(impact);
            }
          }
        }
      }

      return {
        threshold,
        triggeredCount,
        recoveredCount,
        fullLockGrossSavings,
        fullLockCostOnWinners,
        fullLockNetImpact: fullLockGrossSavings - fullLockCostOnWinners,
        doubleOppositeGrossSavings,
        doubleOppositeCostOnWinners,
        doubleOppositeNetImpact: doubleOppositeGrossSavings - doubleOppositeCostOnWinners,
      };
    });

    let bestStopLoss = { threshold: 0, netImpact: -Infinity };
    for (const sl of catStopLossAnalysis) {
      if (sl.netImpact > bestStopLoss.netImpact) {
        bestStopLoss = { threshold: sl.threshold, netImpact: sl.netImpact };
      }
    }

    let bestHedgeFull = { threshold: 0, netImpact: -Infinity };
    let bestHedgeDouble = { threshold: 0, netImpact: -Infinity };
    for (const h of catHedgingAnalysis) {
      if (h.fullLockNetImpact > bestHedgeFull.netImpact) {
        bestHedgeFull = { threshold: h.threshold, netImpact: h.fullLockNetImpact };
      }
      if (h.doubleOppositeNetImpact > bestHedgeDouble.netImpact) {
        bestHedgeDouble = { threshold: h.threshold, netImpact: h.doubleOppositeNetImpact };
      }
    }

    let bestStrategy: BestStrategy;
    const improvements = [
      {
        type: "stop-loss" as const,
        threshold: bestStopLoss.threshold,
        improvement: bestStopLoss.netImpact,
      },
      {
        type: "hedge-full" as const,
        threshold: bestHedgeFull.threshold,
        improvement: bestHedgeFull.netImpact,
      },
      {
        type: "hedge-double" as const,
        threshold: bestHedgeDouble.threshold,
        improvement: bestHedgeDouble.netImpact,
      },
    ];

    const best = improvements.reduce((a, b) => (b.improvement > a.improvement ? b : a));

    if (best.improvement <= 0) {
      bestStrategy = {
        type: "none",
        threshold: null,
        expectedImprovement: 0,
        reason: "No strategy improves P/L for this category",
      };
    } else {
      const strategyNames = {
        "stop-loss": "Stop-Loss",
        "hedge-full": "Full Hedge",
        "hedge-double": "2x Hedge",
      };
      bestStrategy = {
        type: best.type,
        threshold: best.threshold,
        expectedImprovement: best.improvement,
        reason: `${strategyNames[best.type]} at ${best.threshold}% → net +$${best.improvement.toFixed(2)}`,
      };
    }

    categoryBreakdown.push({
      category,
      positionCount: catTotal,
      winCount: catWins,
      lossCount: catLosses,
      winRate: catTotal > 0 ? catWins / catTotal : 0,
      totalPnl: catPnl,
      avgPnl: catPnl / catTotal,
      avgDrawdown: catDrawdown,
      stopLossAnalysis: catStopLossAnalysis,
      hedgingAnalysis: catHedgingAnalysis,
      bestStrategy,
    });
  }
  categoryBreakdown.sort((a, b) => b.positionCount - a.positionCount);

  const dailyMap = new Map<string, { pnl: number; count: number }>();
  for (const p of positions) {
    if (!p.marketEndDate) continue;
    const date = new Date(p.marketEndDate).toISOString().split("T")[0]!;
    const existing = dailyMap.get(date) || { pnl: 0, count: 0 };
    existing.pnl += parseFloat(p.profitLoss || "0");
    existing.count++;
    dailyMap.set(date, existing);
  }

  const sortedDates = Array.from(dailyMap.keys()).sort();
  let cumulativePnl = 0;
  const dailyPnl: DailyPnlItem[] = sortedDates.map((date) => {
    const data = dailyMap.get(date)!;
    cumulativePnl += data.pnl;
    return {
      date,
      pnl: data.pnl,
      positionCount: data.count,
      cumulativePnl,
    };
  });

  const entryTimingAnalysis: EntryTimingItem[] = ENTRY_TIMING_HOURS.map((hours) => {
    let eligible = 0;
    let won = 0;
    let lost = 0;
    let totalEntryPrice = 0;

    for (const pos of positions) {
      if (!pos.priceHistory || !pos.marketEndDate) continue;

      const history = pos.priceHistory as { timestamp: number; price: number }[];
      if (history.length === 0) continue;

      const marketEndTs = Math.floor(new Date(pos.marketEndDate).getTime() / 1000);
      const windowStart = marketEndTs - hours * 3600;
      const windowEnd = marketEndTs;

      let wasEnterable = false;

      for (const point of history) {
        if (point.timestamp >= windowStart && point.timestamp <= windowEnd) {
          if (point.price >= 0.95 && point.price < 0.995) {
            wasEnterable = true;
            break;
          }
        }
      }

      if (wasEnterable) {
        eligible++;
        totalEntryPrice += parseFloat(pos.entryPrice || "0");
        if (pos.result === "won") {
          won++;
        } else {
          lost++;
        }
      }
    }

    return {
      hoursBeforeResolution: hours,
      positionsEligible: eligible,
      positionsWon: won,
      positionsLost: lost,
      winRate: eligible > 0 ? won / eligible : 0,
      avgEntryPrice: eligible > 0 ? totalEntryPrice / eligible : 0,
    };
  });

  await walletAnalyticsRepository.upsert({
    walletAddress: wallet,
    totalPnl: totalPnl.toFixed(4),
    totalCost: totalCost.toFixed(4),
    winCount: wins.length.toString(),
    lossCount: losses.length.toString(),
    winRate: winRate.toFixed(4),
    avgEntryPrice: avgEntryPrice.toFixed(6),
    avgPnlPerPosition: avgPnlPerPosition.toFixed(4),
    avgHoldingHours: avgHoldingHours.toFixed(2),
    stopLossAnalysis,
    hedgingAnalysis,
    categoryBreakdown,
    dailyPnl,
    entryTimingAnalysis,
  });

  logger.info("Computed wallet analytics", {
    wallet,
    positions: totalCount,
    totalPnl: totalPnl.toFixed(2),
    winRate: (winRate * 100).toFixed(1) + "%",
  });
}

async function main() {
  const startTime = Date.now();

  logger.info("=== CRON: Resolved Positions Sync Started ===", {
    walletCount: TRACKED_WALLETS.length,
    wallets: TRACKED_WALLETS,
    forceResync: FORCE_RESYNC,
  });

  const results: { wallet: string; synced: number; existing: number; error?: string }[] = [];

  for (const wallet of TRACKED_WALLETS) {
    try {
      const result = await syncWallet(wallet);
      results.push({ wallet, ...result });
      logger.info("Wallet sync complete", { wallet, ...result });

      await computeWalletAnalytics(wallet);
    } catch (err) {
      const error = (err as Error).message;
      results.push({ wallet, synced: 0, existing: 0, error });
      logger.error("Wallet sync failed", { wallet, error });
    }
  }

  const totalDuration = Date.now() - startTime;
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const failed = results.filter((r) => r.error).length;

  logger.info("=== CRON: Resolved Positions Sync Completed ===", {
    totalDurationMs: totalDuration,
    walletsProcessed: results.length,
    totalSynced,
    failed,
  });

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error("CRON: Unhandled error", { error: (err as Error).message });
  process.exit(1);
});
