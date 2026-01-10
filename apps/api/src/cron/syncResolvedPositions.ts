import "dotenv/config";
import { logger } from "../logger.js";
import { TRACKED_WALLETS } from "../constants/trackedWallets.js";
import { resolvedPositionsRepository } from "../db/repositories/resolvedPositionsRepository.js";
import type { NewResolvedPosition } from "../db/analyticsSchema.js";

const DATA_API_BASE = "https://data-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

const FIDELITY_MINUTES = 5;
const THRESHOLDS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90];
const BATCH_SIZE = 50;

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
  const relevantHistory = priceHistory.filter((p) => p.timestamp >= entryTs);

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
  const relevantHistory = priceHistory.filter((p) => p.timestamp >= entryTs);

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

  const newPositions = closedPositions.filter((p) => !existingTokenIds.has(p.asset));
  logger.info("New positions to process", {
    wallet,
    newCount: newPositions.length,
    existingCount: existingTokenIds.size,
  });

  if (newPositions.length === 0) {
    return { synced: 0, existing: existingTokenIds.size };
  }

  let totalInserted = 0;

  async function processClosedPosition(pos: ClosedPosition): Promise<NewResolvedPosition> {
    const result: "won" | "lost" = pos.realizedPnl >= 0 ? "won" : "lost";
    const resolvedTs = pos.timestamp;

    const actualEntryTs = entryTimestampMap.get(pos.asset);
    const entryTs = actualEntryTs ?? resolvedTs - 86400 * 7;

    const [priceHistory, oppositeHistory] = await Promise.all([
      fetchPriceHistory(pos.asset, entryTs, resolvedTs, FIDELITY_MINUTES),
      pos.oppositeAsset
        ? fetchPriceHistory(pos.oppositeAsset, entryTs, resolvedTs, FIDELITY_MINUTES)
        : Promise.resolve([]),
    ]);

    const entryPrice = pos.avgPrice;
    const cost = pos.totalBought;
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
      finalPrice: pos.curPrice.toString(),
      profitLoss: pos.realizedPnl.toString(),
      result,
      maxDrawdownPercent: maxDrawdownPercent.toString(),
      lowestPrice: lowestPrice.toString(),
      highestPrice: highestPrice.toString(),
      priceHistory: relevantHistory,
      oppositeOutcomePriceHistory: oppositeHistory.filter((p) => p.timestamp >= entryTs),
      stopLossSimulations,
      hedgingSimulations,
      category,
      tags,
      fidelityMinutes: FIDELITY_MINUTES.toString(),
    };
  }

  for (let i = 0; i < newPositions.length; i += BATCH_SIZE) {
    const batch = newPositions.slice(i, i + BATCH_SIZE);
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
        remaining: newPositions.length - i - batch.length,
      });
    }
  }

  return { synced: totalInserted, existing: existingTokenIds.size };
}

async function main() {
  const startTime = Date.now();

  logger.info("=== CRON: Resolved Positions Sync Started ===", {
    walletCount: TRACKED_WALLETS.length,
    wallets: TRACKED_WALLETS,
  });

  const results: { wallet: string; synced: number; existing: number; error?: string }[] = [];

  for (const wallet of TRACKED_WALLETS) {
    try {
      const result = await syncWallet(wallet);
      results.push({ wallet, ...result });
      logger.info("Wallet sync complete", { wallet, ...result });
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
