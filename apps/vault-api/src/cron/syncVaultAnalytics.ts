import "dotenv/config";

import { logger } from "../logger.js";
import * as mainnetVaults from "../config/vaults/mainnet/index.js";
import type { VaultInstanceConfig } from "../config/types.js";
import {
  vaultAnalyticsRepository,
  type NewVaultDetailedAnalytics,
  type NewVaultResolvedAnalyticsPosition,
} from "../repositories/vaultAnalyticsRepository.js";
import { computeVaultAnalytics } from "../services/vaultAnalyticsComputer.js";

const DATA_API_BASE = "https://data-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

const FORCE_RESYNC = process.argv.includes("--force");
const FIDELITY_MINUTES = 5;
const THRESHOLDS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90];
const BATCH_SIZE = 25;

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
  eventSlug?: string;
  outcome: string;
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

function getTrackedVaults(): VaultInstanceConfig[] {
  return Object.values(mainnetVaults).filter(
    (value): value is VaultInstanceConfig =>
      typeof value === "object" &&
      value !== null &&
      "vaultAddress" in value &&
      (value as VaultInstanceConfig).enabled === true,
  );
}

async function fetchClosedPositions(walletAddress: string): Promise<ClosedPosition[]> {
  const allPositions: ClosedPosition[] = [];
  let offset = 0;

  while (true) {
    const url = `${DATA_API_BASE}/v1/closed-positions?user=${walletAddress}&limit=50&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch closed positions: ${response.status}`);
    }

    const batch = (await response.json()) as ClosedPosition[];
    if (batch.length === 0) break;

    allPositions.push(...batch);
    offset += 50;
    if (batch.length < 50) break;
  }

  return allPositions;
}

async function fetchActivity(walletAddress: string, start?: number): Promise<Activity[]> {
  const allActivities: Activity[] = [];
  let lastTimestamp: number | null = start ?? null;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    let url = `${DATA_API_BASE}/activity?user=${walletAddress}&limit=500&sortBy=TIMESTAMP&sortDirection=ASC`;
    if (lastTimestamp !== null) {
      url += `&start=${lastTimestamp + 1}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch activity: ${response.status}`);
    }

    const batch = (await response.json()) as Activity[];
    if (batch.length === 0) break;

    allActivities.push(...batch);
    lastTimestamp = batch[batch.length - 1]!.timestamp;
    if (batch.length < 500) break;
  }

  return allActivities;
}

function buildEntryTimestampMap(activity: Activity[]): Map<string, number> {
  const entryMap = new Map<string, number>();

  for (const item of activity) {
    if (item.type === "TRADE" && item.side === "BUY") {
      const existing = entryMap.get(item.asset);
      if (!existing || item.timestamp < existing) {
        entryMap.set(item.asset, item.timestamp);
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
  return (data.history || []).map((point) => ({ timestamp: point.t, price: point.p }));
}

async function fetchEventTags(eventSlug: string): Promise<string[]> {
  try {
    const response = await fetch(`${GAMMA_API_BASE}/events/slug/${eventSlug}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const event = (await response.json()) as { tags?: Array<{ label: string }> };
    return event.tags?.map((tag) => tag.label) ?? [];
  } catch {
    return [];
  }
}

function normalizeToCategory(tags: string[]): string {
  const text = tags.join(" ").toLowerCase();
  if (text.includes("equities") || text.includes("stocks")) return "Stocks";
  if (text.includes("crypto") || text.includes("bitcoin") || text.includes("ethereum")) {
    return "Crypto";
  }
  if (
    text.includes("sports") ||
    text.includes("nfl") ||
    text.includes("nba") ||
    text.includes("tennis") ||
    text.includes("soccer")
  ) {
    return "Sports";
  }
  if (text.includes("politics") || text.includes("elections") || text.includes("government")) {
    return "Politics";
  }
  if (text.includes("weather") || text.includes("temperature") || text.includes("climate")) {
    return "Weather";
  }
  if (text.includes("ai") || text.includes("tech") || text.includes("technology")) {
    return "Tech & AI";
  }
  if (text.includes("entertainment") || text.includes("movies")) {
    return "Entertainment";
  }
  return tags[0] ?? "Unknown";
}

function findActualResolutionTime(history: { timestamp: number; price: number }[]): Date | null {
  if (history.length === 0) return null;

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  for (const point of sorted) {
    if (point.price < 0.001 || point.price > 0.999) {
      return new Date(point.timestamp * 1000);
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
  for (const point of history) {
    const diff = Math.abs(point.timestamp - targetTs);
    if (diff < minDiff) {
      closest = point;
      minDiff = diff;
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
): StopLossSimulation {
  const stopPrice = entryPrice * (1 - threshold / 100);
  const shares = cost / entryPrice;
  const relevantHistory = priceHistory.filter((point) => point.timestamp >= entryTs);

  let triggerIndex = -1;
  let interpolatedTrigger: { timestamp: number; price: number } | null = null;

  for (let index = 1; index < relevantHistory.length; index += 1) {
    const point = relevantHistory[index]!;
    if (point.price <= stopPrice) {
      if (index === 1) {
        const prevPoint = relevantHistory[0]!;
        const priceDiff = prevPoint.price - point.price;
        const thresholdDiff = prevPoint.price - stopPrice;
        const ratio = priceDiff > 0 ? thresholdDiff / priceDiff : 0.5;
        interpolatedTrigger = {
          timestamp: prevPoint.timestamp + ratio * (point.timestamp - prevPoint.timestamp),
          price: stopPrice,
        };
      } else {
        triggerIndex = index;
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
  const afterTrigger = relevantHistory.slice(interpolatedTrigger ? 1 : triggerIndex + 1);
  const maxPriceAfterTrigger =
    afterTrigger.length > 0
      ? Math.max(...afterTrigger.map((point) => point.price))
      : triggerPoint.price;
  const valueIfSold = shares * stopPrice;
  const profitLossIfSold = valueIfSold - cost;

  return {
    threshold,
    triggered: true,
    triggerPrice: triggerPoint.price,
    triggerTimestamp: triggerPoint.timestamp,
    recoveredAfterTrigger: actualPnL > profitLossIfSold,
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
): HedgingSimulation {
  const triggerPrice = entryPrice * (1 - threshold / 100);
  const shares = cost / entryPrice;
  const relevantHistory = priceHistory.filter((point) => point.timestamp >= entryTs);

  let triggerIndex = -1;
  for (let index = 0; index < relevantHistory.length; index += 1) {
    if (relevantHistory[index]!.price <= triggerPrice) {
      triggerIndex = index;
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
  let oppositePrice = findPriceAtTimestamp(oppositeHistory, triggerPoint.timestamp);
  const theoreticalOppositePrice = 1 - triggerPrice;

  if (oppositePrice !== null) {
    if (oppositePrice > theoreticalOppositePrice + 0.15) {
      oppositePrice = theoreticalOppositePrice + 0.05;
    }
  } else {
    oppositePrice = theoreticalOppositePrice + 0.05;
  }

  if (oppositePrice >= 0.99) oppositePrice = 0.99;
  if (oppositePrice <= 0) {
    return {
      threshold,
      triggered: true,
      triggerPrice: triggerPoint.price,
      triggerTimestamp: triggerPoint.timestamp,
      oppositePrice: null,
      strategies: [],
    };
  }

  const fullHedgeShares = shares;
  const fullHedgeCost = fullHedgeShares * oppositePrice;
  const fullTotalInvestment = cost + fullHedgeCost;
  const fullPnlIfOriginalWins = shares - fullTotalInvestment;
  const fullPnlIfOppositeWins = fullHedgeShares - fullTotalInvestment;
  const fullActualPnl =
    didOriginalWin === true
      ? fullPnlIfOriginalWins
      : didOriginalWin === false
        ? fullPnlIfOppositeWins
        : null;

  const doubleHedgeShares = shares * 2;
  const doubleHedgeCost = doubleHedgeShares * oppositePrice;
  const doubleTotalInvestment = cost + doubleHedgeCost;
  const doublePnlIfOriginalWins = shares - doubleTotalInvestment;
  const doublePnlIfOppositeWins = doubleHedgeShares - doubleTotalInvestment;
  const doubleActualPnl =
    didOriginalWin === true
      ? doublePnlIfOriginalWins
      : didOriginalWin === false
        ? doublePnlIfOppositeWins
        : null;

  return {
    threshold,
    triggered: true,
    triggerPrice: triggerPoint.price,
    triggerTimestamp: triggerPoint.timestamp,
    oppositePrice,
    strategies: [
      {
        name: "fullLockIn",
        hedgeShares: fullHedgeShares,
        hedgeCost: fullHedgeCost,
        totalInvestment: fullTotalInvestment,
        pnlIfOriginalWins: fullPnlIfOriginalWins,
        pnlIfOppositeWins: fullPnlIfOppositeWins,
        actualPnl: fullActualPnl,
        betterThanNoHedge: fullActualPnl !== null ? fullActualPnl > actualPnL : null,
      },
      {
        name: "doubleOpposite",
        hedgeShares: doubleHedgeShares,
        hedgeCost: doubleHedgeCost,
        totalInvestment: doubleTotalInvestment,
        pnlIfOriginalWins: doublePnlIfOriginalWins,
        pnlIfOppositeWins: doublePnlIfOppositeWins,
        actualPnl: doubleActualPnl,
        betterThanNoHedge: doubleActualPnl !== null ? doubleActualPnl > actualPnL : null,
      },
    ],
  };
}

async function processClosedPosition(
  config: VaultInstanceConfig,
  position: ClosedPosition,
  entryTimestampMap: Map<string, number>,
): Promise<NewVaultResolvedAnalyticsPosition> {
  const entryTs = entryTimestampMap.get(position.asset) ?? position.timestamp - 7 * 24 * 60 * 60;
  const resolvedTs = position.timestamp;
  const entryPrice = position.avgPrice;
  const cost = position.totalBought * position.avgPrice;
  const actualPnL = position.realizedPnl;
  const result: "won" | "lost" = actualPnL >= 0 ? "won" : "lost";
  const didOriginalWin = result === "won";

  const [priceHistory, oppositeHistory] = await Promise.all([
    fetchPriceHistory(position.asset, entryTs, resolvedTs, FIDELITY_MINUTES),
    position.oppositeAsset
      ? fetchPriceHistory(position.oppositeAsset, entryTs, resolvedTs, FIDELITY_MINUTES)
      : Promise.resolve([]),
  ]);

  const relevantHistory = priceHistory.filter((point) => point.timestamp >= entryTs);
  let lowestPrice = entryPrice;
  let highestPrice = entryPrice;
  for (const point of relevantHistory) {
    if (point.price < lowestPrice) lowestPrice = point.price;
    if (point.price > highestPrice) highestPrice = point.price;
  }

  const maxDrawdownPercent = entryPrice > 0 ? ((entryPrice - lowestPrice) / entryPrice) * 100 : 0;
  const stopLossSimulations = THRESHOLDS.map((threshold) =>
    simulateStopLoss(priceHistory, entryPrice, entryTs, cost, threshold, actualPnL),
  );
  const hedgingSimulations = THRESHOLDS.map((threshold) =>
    simulateHedging(
      priceHistory,
      oppositeHistory,
      entryPrice,
      entryTs,
      cost,
      threshold,
      actualPnL,
      didOriginalWin,
    ),
  );

  let tags: string[] = [];
  let category = "Unknown";
  if (position.eventSlug) {
    tags = await fetchEventTags(position.eventSlug);
    category = normalizeToCategory(tags);
  }

  return {
    network: (config.network ?? "mainnet").toLowerCase(),
    vaultAddress: config.vaultAddress.toLowerCase(),
    walletAddress: config.safeAddress.toLowerCase(),
    tokenId: position.asset,
    conditionId: position.conditionId,
    eventSlug: position.eventSlug ?? null,
    marketSlug: position.slug,
    marketQuestion: position.title,
    outcome: position.outcome,
    entryPrice: entryPrice.toString(),
    cost: cost.toString(),
    size: (cost / entryPrice).toString(),
    createdAt: new Date(entryTs * 1000),
    resolvedAt: new Date(resolvedTs * 1000),
    marketEndDate: findActualResolutionTime(priceHistory),
    finalPrice: position.curPrice.toString(),
    profitLoss: actualPnL.toString(),
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

async function computeAndStoreVaultAnalytics(config: VaultInstanceConfig): Promise<void> {
  const network = (config.network ?? "mainnet").toLowerCase();
  const vaultAddress = config.vaultAddress.toLowerCase();
  const walletAddress = config.safeAddress.toLowerCase();
  const positions = await vaultAnalyticsRepository.findResolvedPositions(network, vaultAddress);
  const analytics = computeVaultAnalytics(positions);

  await vaultAnalyticsRepository.upsertDetailedAnalytics({
    network,
    vaultAddress,
    walletAddress,
    totalPnl: analytics.totalPnl,
    totalCost: analytics.totalCost,
    winCount: analytics.winCount,
    lossCount: analytics.lossCount,
    winRate: analytics.winRate,
    avgEntryPrice: analytics.avgEntryPrice,
    avgPnlPerPosition: analytics.avgPnlPerPosition,
    avgHoldingHours: analytics.avgHoldingHours,
    stopLossAnalysis: analytics.stopLossAnalysis,
    hedgingAnalysis: analytics.hedgingAnalysis,
    categoryBreakdown: analytics.categoryBreakdown,
    dailyPnl: analytics.dailyPnl,
    entryTimingAnalysis: analytics.entryTimingAnalysis,
  } satisfies NewVaultDetailedAnalytics);
}

async function syncVault(config: VaultInstanceConfig): Promise<{
  synced: number;
  existing: number;
  lastActivityTimestamp: number | null;
}> {
  const network = (config.network ?? "mainnet").toLowerCase();
  const vaultAddress = config.vaultAddress.toLowerCase();
  const walletAddress = config.safeAddress.toLowerCase();

  const existingTokenIds = await vaultAnalyticsRepository.getExistingTokenIds(
    network,
    vaultAddress,
  );
  const syncState = await vaultAnalyticsRepository.getSyncState(network, vaultAddress);
  const lastActivityTimestamp = FORCE_RESYNC
    ? undefined
    : (syncState?.lastActivityTimestamp ?? undefined);

  try {
    await vaultAnalyticsRepository.upsertSyncState({
      network,
      vaultAddress,
      walletAddress,
      lastActivityTimestamp: syncState?.lastActivityTimestamp ?? null,
      lastAttemptedSyncAt: new Date(),
      lastSuccessfulSyncAt: syncState?.lastSuccessfulSyncAt ?? null,
      lastError: null,
    });

    const newActivity = await fetchActivity(walletAddress, lastActivityTimestamp);
    const maxSeenTimestamp =
      newActivity.length > 0
        ? newActivity[newActivity.length - 1]!.timestamp
        : (syncState?.lastActivityTimestamp ?? null);

    const changedAssets = new Set(newActivity.map((item) => item.asset));
    const closedPositions = await fetchClosedPositions(walletAddress);
    const positionsToProcess = FORCE_RESYNC
      ? closedPositions
      : closedPositions.filter(
          (position) => !existingTokenIds.has(position.asset) || changedAssets.has(position.asset),
        );

    if (!FORCE_RESYNC && newActivity.length === 0 && positionsToProcess.length === 0) {
      logger.info("Vault analytics sync: No new activity", { vaultAddress, walletAddress });
      await vaultAnalyticsRepository.upsertSyncState({
        network,
        vaultAddress,
        walletAddress,
        lastActivityTimestamp: maxSeenTimestamp ?? null,
        lastAttemptedSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastError: null,
      });
      return {
        synced: 0,
        existing: existingTokenIds.size,
        lastActivityTimestamp: maxSeenTimestamp,
      };
    }

    let entryTimestampMap = buildEntryTimestampMap(
      syncState?.lastActivityTimestamp && !FORCE_RESYNC
        ? newActivity
        : await fetchActivity(walletAddress),
    );
    const missingEntryTimestamps = positionsToProcess.some(
      (position) => !entryTimestampMap.has(position.asset),
    );
    if (missingEntryTimestamps) {
      entryTimestampMap = buildEntryTimestampMap(await fetchActivity(walletAddress));
    }

    let totalSynced = 0;
    const processingErrors: string[] = [];
    for (let index = 0; index < positionsToProcess.length; index += BATCH_SIZE) {
      const batch = positionsToProcess.slice(index, index + BATCH_SIZE);
      const records: NewVaultResolvedAnalyticsPosition[] = [];

      for (const position of batch) {
        try {
          records.push(await processClosedPosition(config, position, entryTimestampMap));
        } catch (error) {
          processingErrors.push(`${position.asset}: ${(error as Error).message}`);
          logger.warn("Vault analytics sync: Failed to process closed position", {
            vaultAddress,
            tokenId: position.asset,
            error: (error as Error).message,
          });
        }
      }

      totalSynced += await vaultAnalyticsRepository.upsertResolvedPositions(records);
    }

    if (processingErrors.length > 0) {
      throw new Error(`Vault analytics sync failed for ${processingErrors.length} positions`);
    }

    await computeAndStoreVaultAnalytics(config);
    await vaultAnalyticsRepository.upsertSyncState({
      network,
      vaultAddress,
      walletAddress,
      lastActivityTimestamp: maxSeenTimestamp ?? null,
      lastAttemptedSyncAt: new Date(),
      lastSuccessfulSyncAt: new Date(),
      lastError: null,
    });

    return {
      synced: totalSynced,
      existing: existingTokenIds.size,
      lastActivityTimestamp: maxSeenTimestamp,
    };
  } catch (error) {
    await vaultAnalyticsRepository.upsertSyncState({
      network,
      vaultAddress,
      walletAddress,
      lastActivityTimestamp: syncState?.lastActivityTimestamp ?? null,
      lastAttemptedSyncAt: new Date(),
      lastSuccessfulSyncAt: syncState?.lastSuccessfulSyncAt ?? null,
      lastError: (error as Error).message,
    });
    throw error;
  }
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const vaults = getTrackedVaults();

  logger.info("=== CRON: Vault Analytics Sync Started ===", {
    vaultCount: vaults.length,
    vaults: vaults.map((vault) => ({
      id: vault.id,
      name: vault.name,
      vaultAddress: vault.vaultAddress,
    })),
    forceResync: FORCE_RESYNC,
  });

  const results: Array<{
    vaultId: number;
    vaultAddress: string;
    synced: number;
    existing: number;
    error?: string;
  }> = [];

  for (const vault of vaults) {
    try {
      const result = await syncVault(vault);
      results.push({ vaultId: vault.id, vaultAddress: vault.vaultAddress, ...result });
      logger.info("Vault analytics sync complete", {
        vaultId: vault.id,
        vaultAddress: vault.vaultAddress,
        ...result,
      });
    } catch (error) {
      const message = (error as Error).message;
      results.push({
        vaultId: vault.id,
        vaultAddress: vault.vaultAddress,
        synced: 0,
        existing: 0,
        error: message,
      });

      logger.error("Vault analytics sync failed", {
        vaultId: vault.id,
        vaultAddress: vault.vaultAddress,
        error: message,
      });
    }
  }

  const totalDuration = Date.now() - startTime;
  const totalSynced = results.reduce((sum, row) => sum + row.synced, 0);
  const failed = results.filter((row) => row.error).length;

  logger.info("=== CRON: Vault Analytics Sync Completed ===", {
    totalDurationMs: totalDuration,
    vaultsProcessed: results.length,
    totalSynced,
    failed,
  });

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  logger.error("CRON: Vault analytics sync unhandled error", {
    error: (error as Error).message,
  });
  process.exit(1);
});
