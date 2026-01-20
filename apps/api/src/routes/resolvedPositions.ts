import { Router } from "express";
import { logger } from "../logger.js";
import { resolvedPositionsRepository } from "../db/repositories/resolvedPositionsRepository.js";
import { walletAnalyticsRepository } from "../db/repositories/walletAnalyticsRepository.js";
import type { NewResolvedPosition } from "../db/analyticsSchema.js";

const DATA_API_BASE = "https://data-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

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

interface StopLossSimulation {
  threshold: number;
  triggered: boolean;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  recoveredAfterTrigger: boolean;
  maxPriceAfterTrigger: number | null;
  profitLossIfSold: number | null;
  profitLossIfHeld: number | null;
}

interface HedgeStrategy {
  name: string;
  hedgeShares: number;
  hedgeCost: number;
  totalInvestment: number;
  pnlIfOriginalWins: number;
  pnlIfOppositeWins: number;
  actualPnl: number | null;
  betterThanNoHedge: boolean | null;
}

interface HedgingSimulation {
  threshold: number;
  triggered: boolean;
  triggerPrice: number | null;
  triggerTimestamp: number | null;
  oppositePrice: number | null;
  strategies: HedgeStrategy[];
}

function simulateStopLoss(
  priceHistory: { timestamp: number; price: number }[],
  entryPrice: number,
  entryTs: number,
  cost: number,
  threshold: number,
  actualPnL: number,
): StopLossSimulation {
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

function simulateHedging(
  priceHistory: { timestamp: number; price: number }[],
  oppositeHistory: { timestamp: number; price: number }[],
  entryPrice: number,
  entryTs: number,
  cost: number,
  threshold: number,
  actualPnL: number,
  didOriginalWin: boolean | null,
): HedgingSimulation {
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

  // Apply same logic as frontend: fallback, sanity check, and price cap
  const theoreticalOppPrice = 1 - triggerPrice;
  if (oppPrice !== null) {
    // Sanity check: if oppPrice is way off from theoretical, use fallback
    if (oppPrice > theoreticalOppPrice + 0.15) {
      oppPrice = theoreticalOppPrice + 0.05;
    }
  } else {
    // FALLBACK: when no opposite history available
    oppPrice = theoreticalOppPrice + 0.05;
  }

  // Price cap at 0.99
  if (oppPrice >= 0.99) oppPrice = 0.99;

  // Safety check for invalid prices
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

  // Full lock-in strategy: buy same shares of opposite
  const fullHedgeShares = shares;
  const fullHedgeCost = fullHedgeShares * oppPrice; // Use adjusted oppPrice, not theoretical!
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

  // Double opposite strategy: buy 2x shares of opposite
  const doubleHedgeShares = shares * 2;
  const doubleHedgeCost = doubleHedgeShares * oppPrice; // Use adjusted oppPrice!
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

export function buildResolvedPositionsRouter(): Router {
  const router = Router();

  router.get("/:wallet", async (req, res) => {
    try {
      const wallet = req.params.wallet;
      if (!wallet) {
        res.status(400).json({ success: false, error: "Wallet address required" });
        return;
      }

      const positions = await resolvedPositionsRepository.findByWalletLightweight(wallet);
      const stats = await resolvedPositionsRepository.getStats(wallet);

      res.json({
        success: true,
        positions,
        stats,
        count: positions.length,
      });
    } catch (error) {
      logger.error("Failed to fetch resolved positions", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.post("/:wallet/sync", async (req, res) => {
    try {
      const wallet = req.params.wallet;
      if (!wallet) {
        res.status(400).json({ success: false, error: "Wallet address required" });
        return;
      }

      const fidelityMinutes = Number(req.query.fidelity) || 5;
      const thresholds = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90];

      logger.info("Starting resolved positions sync", { wallet });

      const existingTokenIds = await resolvedPositionsRepository.getExistingTokenIds(wallet);
      logger.info("Found existing positions in DB", { count: existingTokenIds.size });

      const [positions, activity] = await Promise.all([
        fetchPositions(wallet),
        fetchActivity(wallet, 10000),
      ]);

      logger.info("Fetched from API", { positions: positions.length, activity: activity.length });

      const positionMap = new Map<string, PolymarketPosition>();
      for (const p of positions) {
        positionMap.set(p.asset, p);
      }

      const resolvedFromAPI = positions.filter((p) => p.redeemable);
      const closedFromActivity = reconstructClosedPositions(
        activity,
        positionMap,
        existingTokenIds,
      );

      logger.info("Found resolved positions", {
        fromAPI: resolvedFromAPI.length,
        fromActivity: closedFromActivity.length,
      });

      const newFromAPI = resolvedFromAPI.filter((p) => !existingTokenIds.has(p.asset));
      const newFromActivity = closedFromActivity.filter((p) => !existingTokenIds.has(p.tokenId));

      logger.info("New positions to process", {
        fromAPI: newFromAPI.length,
        fromActivity: newFromActivity.length,
      });

      if (newFromAPI.length === 0 && newFromActivity.length === 0) {
        res.json({
          success: true,
          synced: 0,
          existing: existingTokenIds.size,
          message: "No new resolved positions to sync",
        });
        return;
      }

      // Process in batches and save incrementally to avoid timeouts
      const BATCH_SIZE = 10;
      let totalInserted = 0;

      // Helper to process a single position from API
      async function processAPIPosition(pos: PolymarketPosition): Promise<NewResolvedPosition> {
        const result: "won" | "lost" = pos.curPrice >= 0.99 ? "won" : "lost";
        const createdAt = findFirstBuyTimestamp(activity, pos.asset);
        const entryTs = Math.floor(createdAt.getTime() / 1000);
        const nowTs = Math.floor(Date.now() / 1000);

        const [priceHistory, oppositeHistory] = await Promise.all([
          fetchPriceHistory(pos.asset, entryTs, nowTs, fidelityMinutes),
          pos.oppositeAsset
            ? fetchPriceHistory(pos.oppositeAsset, entryTs, nowTs, fidelityMinutes)
            : Promise.resolve([]),
        ]);

        const entryPrice = pos.avgPrice;
        const finalPrice = pos.curPrice;
        const cost = pos.initialValue;

        let lowestPrice = entryPrice;
        let highestPrice = entryPrice;
        for (const p of priceHistory) {
          if (p.timestamp >= entryTs) {
            if (p.price < lowestPrice) lowestPrice = p.price;
            if (p.price > highestPrice) highestPrice = p.price;
          }
        }

        const maxDrawdownPercent =
          entryPrice > 0 ? ((entryPrice - lowestPrice) / entryPrice) * 100 : 0;

        const actualPnL = pos.cashPnl;
        const didOriginalWin = result === "won";

        const stopLossSimulations = thresholds.map((t) =>
          simulateStopLoss(priceHistory, entryPrice, entryTs, cost, t, actualPnL),
        );

        const hedgingSimulations = thresholds.map((t) =>
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
          finalPrice: finalPrice.toString(),
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
          fidelityMinutes: fidelityMinutes.toString(),
        };
      }

      // Helper to process a single position from activity
      async function processActivityPosition(
        pos: ReconstructedPosition,
      ): Promise<NewResolvedPosition> {
        const entryTs = Math.floor(pos.createdAt.getTime() / 1000);
        const nowTs = Math.floor(Date.now() / 1000);

        const priceHistory = await fetchPriceHistory(pos.tokenId, entryTs, nowTs, fidelityMinutes);

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

        const stopLossSimulations = thresholds.map((t) =>
          simulateStopLoss(priceHistory, pos.entryPrice, entryTs, pos.cost, t, actualPnL),
        );

        const hedgingSimulations = thresholds.map((t) =>
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
          fidelityMinutes: fidelityMinutes.toString(),
        };
      }

      // Process API positions in batches
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

      // Process activity positions in batches
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

      logger.info("Sync complete", { synced: totalInserted, existing: existingTokenIds.size });

      res.json({
        success: true,
        synced: totalInserted,
        existing: existingTokenIds.size,
        total: existingTokenIds.size + totalInserted,
      });
    } catch (error) {
      logger.error("Failed to sync resolved positions", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/:wallet/stats", async (req, res) => {
    try {
      const wallet = req.params.wallet;
      if (!wallet) {
        res.status(400).json({ success: false, error: "Wallet address required" });
        return;
      }

      const stats = await resolvedPositionsRepository.getStats(wallet);
      res.json({ success: true, stats });
    } catch (error) {
      logger.error("Failed to fetch stats", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/:wallet/last-sync", async (req, res) => {
    try {
      const wallet = req.params.wallet;
      if (!wallet) {
        res.status(400).json({ success: false, error: "Wallet address required" });
        return;
      }

      const lastSyncTime = await resolvedPositionsRepository.getLastSyncTime(wallet);
      res.json({ success: true, lastSyncTime });
    } catch (error) {
      logger.error("Failed to fetch last sync time", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/:wallet/position/:tokenId", async (req, res) => {
    try {
      const { wallet, tokenId } = req.params;
      if (!wallet || !tokenId) {
        res.status(400).json({ success: false, error: "Wallet and tokenId required" });
        return;
      }

      const position = await resolvedPositionsRepository.findByTokenId(wallet, tokenId);
      if (!position) {
        res.status(404).json({ success: false, error: "Position not found" });
        return;
      }

      res.json({ success: true, position });
    } catch (error) {
      logger.error("Failed to fetch position", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/:wallet/analytics", async (req, res) => {
    try {
      const wallet = req.params.wallet;
      if (!wallet) {
        res.status(400).json({ success: false, error: "Wallet address required" });
        return;
      }

      const analytics = await walletAnalyticsRepository.findByWallet(wallet);
      if (!analytics) {
        res.status(404).json({ success: false, error: "Analytics not found. Run sync first." });
        return;
      }

      res.json({ success: true, analytics });
    } catch (error) {
      logger.error("Failed to fetch wallet analytics", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/:wallet/analytics/compute", async (req, res) => {
    try {
      const wallet = req.params.wallet;
      const period = (req.query.period as string) || "all";

      if (!wallet) {
        res.status(400).json({ success: false, error: "Wallet address required" });
        return;
      }

      if (!["all", "before", "after"].includes(period)) {
        res.status(400).json({ success: false, error: "Invalid period. Use: all, before, after" });
        return;
      }

      const { computeAnalytics } = await import("../services/analyticsComputer.js");

      let positions = await resolvedPositionsRepository.findByWallet(wallet);

      const SCALE_UP_TIMESTAMP = new Date("2026-01-14T12:30:00Z").getTime();

      if (period === "before") {
        positions = positions.filter(
          (p) => new Date(p.createdAt || 0).getTime() < SCALE_UP_TIMESTAMP,
        );
      } else if (period === "after") {
        positions = positions.filter(
          (p) => new Date(p.createdAt || 0).getTime() >= SCALE_UP_TIMESTAMP,
        );
      }

      const analytics = computeAnalytics(positions);

      res.json({
        success: true,
        analytics: {
          ...analytics,
          period,
          computedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Failed to compute wallet analytics", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  return router;
}
