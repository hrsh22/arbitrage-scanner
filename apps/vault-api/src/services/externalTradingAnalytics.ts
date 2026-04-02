import type { VaultInstanceConfig } from "../config/types.js";

const DATA_API_BASE = "https://data-api.polymarket.com";

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

export function computeExternalTradingAnalytics(params: {
  vaultAddress: string;
  walletAddress: string;
  closedPositions: ClosedPosition[];
  computedAt?: Date;
}): ExternalTradingAnalyticsResult {
  const { vaultAddress, walletAddress, closedPositions, computedAt = new Date() } = params;

  const sorted = [...closedPositions].sort((left, right) => right.timestamp - left.timestamp);
  const winCount = sorted.filter((position) => position.realizedPnl >= 0).length;
  const lossCount = sorted.length - winCount;
  const totalPnl = sorted.reduce((sum, position) => sum + position.realizedPnl, 0);
  const positionCount = sorted.length;

  return {
    vaultAddress,
    walletAddress,
    positionCount,
    winCount,
    lossCount,
    winRate: positionCount > 0 ? winCount / positionCount : 0,
    totalPnl,
    avgPnlPerPosition: positionCount > 0 ? totalPnl / positionCount : 0,
    lastResolvedAt:
      sorted[0] !== undefined ? new Date(sorted[0].timestamp * 1000).toISOString() : null,
    computedAt: computedAt.toISOString(),
  };
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
  const closedPositions = await fetchClosedPositions(config.safeAddress);
  return computeExternalTradingAnalytics({
    vaultAddress: config.vaultAddress,
    walletAddress: config.safeAddress,
    closedPositions,
  });
}
