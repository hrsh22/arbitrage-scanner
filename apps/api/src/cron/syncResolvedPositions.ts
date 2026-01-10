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
const BATCH_SIZE = 10;

interface PolymarketPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  redeemable: boolean;
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
}

interface PolymarketActivity {
  timestamp: number;
  conditionId: string;
  type: "TRADE" | "REDEEM" | "MAKER_REBATE";
  size: number;
  usdcSize: number;
  price: number;
  asset: string;
  side: "BUY" | "SELL";
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
}

interface PricePoint {
  t: number;
  p: number;
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
  eventSlug: string | null;
}

async function fetchPositions(walletAddress: string): Promise<PolymarketPosition[]> {
  const allPositions: PolymarketPosition[] = [];
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const url = `${DATA_API_BASE}/positions?user=${walletAddress}&sizeThreshold=0&limit=${batchSize}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch positions: ${response.status}`);
    const batch = (await response.json()) as PolymarketPosition[];
    if (batch.length === 0) break;
    allPositions.push(...batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  return allPositions;
}

async function fetchActivity(
  walletAddress: string,
  maxRecords = 5000,
): Promise<PolymarketActivity[]> {
  const allActivities: PolymarketActivity[] = [];
  let offset = 0;
  const batchSize = 500;

  while (allActivities.length < maxRecords) {
    const url = `${DATA_API_BASE}/activity?user=${walletAddress}&limit=${batchSize}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch activity: ${response.status}`);
    const batch = (await response.json()) as PolymarketActivity[];
    if (batch.length === 0) break;
    allActivities.push(...batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  return allActivities;
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

function reconstructClosedPositions(
  activity: PolymarketActivity[],
  existingPositions: Map<string, PolymarketPosition>,
  existingTokenIds: Set<string>,
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
    if (existingTokenIds.has(tokenId)) continue;

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
      eventSlug: firstBuy.eventSlug || null,
    });
  }

  return closedPositions;
}

function findFirstBuyTimestamp(activity: PolymarketActivity[], tokenId: string): Date {
  const buys = activity
    .filter((a) => a.asset === tokenId && a.type === "TRADE" && a.side === "BUY")
    .sort((a, b) => a.timestamp - b.timestamp);
  return buys.length > 0 ? new Date(buys[0]!.timestamp * 1000) : new Date();
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

  const [positions, activity] = await Promise.all([
    fetchPositions(wallet),
    fetchActivity(wallet, 10000),
  ]);

  logger.info("Fetched from API", {
    wallet,
    positions: positions.length,
    activity: activity.length,
  });

  const positionMap = new Map<string, PolymarketPosition>();
  for (const p of positions) {
    positionMap.set(p.asset, p);
  }

  const resolvedFromAPI = positions.filter((p) => p.redeemable);
  const closedFromActivity = reconstructClosedPositions(activity, positionMap, existingTokenIds);

  const newFromAPI = resolvedFromAPI.filter((p) => !existingTokenIds.has(p.asset));
  const newFromActivity = closedFromActivity.filter((p) => !existingTokenIds.has(p.tokenId));

  logger.info("New positions to process", {
    wallet,
    fromAPI: newFromAPI.length,
    fromActivity: newFromActivity.length,
  });

  if (newFromAPI.length === 0 && newFromActivity.length === 0) {
    return { synced: 0, existing: existingTokenIds.size };
  }

  let totalInserted = 0;

  async function processAPIPosition(pos: PolymarketPosition): Promise<NewResolvedPosition> {
    const result: "won" | "lost" = pos.curPrice >= 0.99 ? "won" : "lost";
    const createdAt = findFirstBuyTimestamp(activity, pos.asset);
    const entryTs = Math.floor(createdAt.getTime() / 1000);
    const nowTs = Math.floor(Date.now() / 1000);

    const [priceHistory, oppositeHistory] = await Promise.all([
      fetchPriceHistory(pos.asset, entryTs, nowTs, FIDELITY_MINUTES),
      pos.oppositeAsset
        ? fetchPriceHistory(pos.oppositeAsset, entryTs, nowTs, FIDELITY_MINUTES)
        : Promise.resolve([]),
    ]);

    const entryPrice = pos.avgPrice;
    const cost = pos.initialValue;
    const actualPnL = pos.cashPnl;
    const didOriginalWin = result === "won";

    let lowestPrice = entryPrice;
    let highestPrice = entryPrice;
    for (const p of priceHistory) {
      if (p.timestamp >= entryTs) {
        if (p.price < lowestPrice) lowestPrice = p.price;
        if (p.price > highestPrice) highestPrice = p.price;
      }
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
      size: pos.size.toString(),
      createdAt,
      resolvedAt: new Date(),
      finalPrice: pos.curPrice.toString(),
      profitLoss: pos.cashPnl.toString(),
      result,
      maxDrawdownPercent: maxDrawdownPercent.toString(),
      lowestPrice: lowestPrice.toString(),
      highestPrice: highestPrice.toString(),
      priceHistory,
      oppositeOutcomePriceHistory: oppositeHistory,
      stopLossSimulations,
      hedgingSimulations,
      category,
      tags,
      fidelityMinutes: FIDELITY_MINUTES.toString(),
    };
  }

  async function processActivityPosition(pos: ReconstructedPosition): Promise<NewResolvedPosition> {
    const entryTs = Math.floor(pos.createdAt.getTime() / 1000);
    const nowTs = Math.floor(Date.now() / 1000);
    const priceHistory = await fetchPriceHistory(pos.tokenId, entryTs, nowTs, FIDELITY_MINUTES);

    let lowestPrice = pos.entryPrice;
    let highestPrice = pos.entryPrice;
    for (const p of priceHistory) {
      if (p.timestamp >= entryTs) {
        if (p.price < lowestPrice) lowestPrice = p.price;
        if (p.price > highestPrice) highestPrice = p.price;
      }
    }

    const maxDrawdownPercent =
      pos.entryPrice > 0 ? ((pos.entryPrice - lowestPrice) / pos.entryPrice) * 100 : 0;
    const actualPnL = pos.profitLoss;
    const didOriginalWin = pos.status === "won";

    const stopLossSimulations = THRESHOLDS.map((t) =>
      simulateStopLoss(priceHistory, pos.entryPrice, entryTs, pos.cost, t, actualPnL),
    );
    const hedgingSimulations = THRESHOLDS.map((t) =>
      simulateHedging(
        priceHistory,
        [],
        pos.entryPrice,
        entryTs,
        pos.cost,
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
      tokenId: pos.tokenId,
      conditionId: pos.conditionId,
      eventSlug: pos.eventSlug,
      marketSlug: pos.slug,
      marketQuestion: pos.title,
      outcome: pos.outcome,
      entryPrice: pos.entryPrice.toString(),
      cost: pos.cost.toString(),
      size: pos.size.toString(),
      createdAt: pos.createdAt,
      resolvedAt: pos.resolvedAt,
      finalPrice: pos.currentPrice.toString(),
      profitLoss: pos.profitLoss.toString(),
      result: pos.status as "won" | "lost",
      maxDrawdownPercent: maxDrawdownPercent.toString(),
      lowestPrice: lowestPrice.toString(),
      highestPrice: highestPrice.toString(),
      priceHistory,
      oppositeOutcomePriceHistory: [],
      stopLossSimulations,
      hedgingSimulations,
      category,
      tags,
      fidelityMinutes: FIDELITY_MINUTES.toString(),
    };
  }

  for (let i = 0; i < newFromAPI.length; i += BATCH_SIZE) {
    const batch = newFromAPI.slice(i, i + BATCH_SIZE);
    const batchResults: NewResolvedPosition[] = [];

    for (const pos of batch) {
      try {
        const record = await processAPIPosition(pos);
        batchResults.push(record);
      } catch (err) {
        logger.warn("Failed to process API position", {
          tokenId: pos.asset,
          error: (err as Error).message,
        });
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    if (batchResults.length > 0) {
      const inserted = await resolvedPositionsRepository.upsertMany(batchResults);
      totalInserted += inserted;
      logger.info("Saved batch", {
        batch: Math.floor(i / BATCH_SIZE) + 1,
        inserted,
        totalInserted,
      });
    }
  }

  for (let i = 0; i < newFromActivity.length; i += BATCH_SIZE) {
    const batch = newFromActivity.slice(i, i + BATCH_SIZE);
    const batchResults: NewResolvedPosition[] = [];

    for (const pos of batch) {
      try {
        const record = await processActivityPosition(pos);
        batchResults.push(record);
      } catch (err) {
        logger.warn("Failed to process activity position", {
          tokenId: pos.tokenId,
          error: (err as Error).message,
        });
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    if (batchResults.length > 0) {
      const inserted = await resolvedPositionsRepository.upsertMany(batchResults);
      totalInserted += inserted;
      logger.info("Saved batch", {
        batch: Math.floor(i / BATCH_SIZE) + 1 + Math.ceil(newFromAPI.length / BATCH_SIZE),
        inserted,
        totalInserted,
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
