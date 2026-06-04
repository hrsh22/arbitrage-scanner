import type { VaultInstanceConfig } from "../config/types.js";

const DATA_API_BASE = "https://data-api.polymarket.com";
const TRADING_ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;

interface ClosedPosition {
  realizedPnl: number;
  timestamp: number;
}

export interface ExternalTradingAnalyticsResult {
  vaultAddress: string;
  walletAddress: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnlPerPosition: number;
  lastResolvedAt: string | null;
  computedAt: string;
}

interface CachedExternalTradingAnalytics {
  value: ExternalTradingAnalyticsResult;
  expiresAt: number;
}

const analyticsCache = new Map<string, CachedExternalTradingAnalytics>();
const inFlightAnalytics = new Map<string, Promise<ExternalTradingAnalyticsResult>>();

function getCacheKey(config: VaultInstanceConfig): string {
  return `${config.vaultAddress.toLowerCase()}:${config.safeAddress.toLowerCase()}`;
}

export function clearExternalTradingAnalyticsCache(): void {
  analyticsCache.clear();
  inFlightAnalytics.clear();
}

export function computeExternalTradingAnalytics(params: {
  vaultAddress: string;
  walletAddress: string;
  closedPositions: ClosedPosition[];
  computedAt?: Date;
}): ExternalTradingAnalyticsResult {
  const { vaultAddress, walletAddress, closedPositions, computedAt = new Date() } = params;

  let winCount = 0;
  let totalPnl = 0;
  let latestTimestamp: number | null = null;

  for (const position of closedPositions) {
    if (position.realizedPnl >= 0) {
      winCount += 1;
    }

    totalPnl += position.realizedPnl;
    if (latestTimestamp === null || position.timestamp > latestTimestamp) {
      latestTimestamp = position.timestamp;
    }
  }

  const positionCount = closedPositions.length;
  const lossCount = positionCount - winCount;

  return {
    vaultAddress,
    walletAddress,
    positionCount,
    winCount,
    lossCount,
    winRate: positionCount > 0 ? winCount / positionCount : 0,
    totalPnl,
    avgPnlPerPosition: positionCount > 0 ? totalPnl / positionCount : 0,
    lastResolvedAt: latestTimestamp !== null ? new Date(latestTimestamp * 1000).toISOString() : null,
    computedAt: computedAt.toISOString(),
  };
}

async function fetchClosedPositions(walletAddress: string): Promise<ClosedPosition[]> {
  const allPositions: ClosedPosition[] = [];
  let offset = 0;

  while (true) {
    const url = `${DATA_API_BASE}/v1/closed-positions?user=${encodeURIComponent(walletAddress)}&limit=50&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch closed positions: ${response.status}`);
    }

    const batch = (await response.json()) as ClosedPosition[];
    if (batch.length === 0) {
      break;
    }

    allPositions.push(...batch);
    offset += 50;
    if (batch.length < 50) {
      break;
    }
  }

  return allPositions;
}

export async function getExternalTradingAnalytics(
  config: VaultInstanceConfig,
): Promise<ExternalTradingAnalyticsResult> {
  const cacheKey = getCacheKey(config);
  const now = Date.now();
  const cached = analyticsCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existingRequest = inFlightAnalytics.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const closedPositions = await fetchClosedPositions(config.safeAddress);
      const value = computeExternalTradingAnalytics({
        vaultAddress: config.vaultAddress,
        walletAddress: config.safeAddress,
        closedPositions,
      });

      analyticsCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + TRADING_ANALYTICS_CACHE_TTL_MS,
      });

      return value;
    } catch (error) {
      if (cached) {
        return cached.value;
      }

      throw error;
    } finally {
      inFlightAnalytics.delete(cacheKey);
    }
  })();

  inFlightAnalytics.set(cacheKey, request);
  return request;
}
