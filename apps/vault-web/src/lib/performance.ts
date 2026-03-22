import type { VaultNavHistoryItem } from "../types";

export interface DerivedVaultPerformanceStats {
  apy: number | null;
  sinceInception: number | null;
  thirtyDay: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  daysCovered: number;
  first: number | null;
  latest: number | null;
  points: Array<{ timestamp: string; value: number; totalAssets: number }>;
}

function normalizeNavPoints(snapshots: VaultNavHistoryItem[]) {
  const rawPoints = [...snapshots]
    .map((snapshot) => ({
      timestamp: snapshot.timestamp,
      value: Number.parseFloat(snapshot.sharePrice),
      totalAssets: Number.parseFloat(snapshot.totalAssets),
    }))
    .filter(
      (point) =>
        Number.isFinite(new Date(point.timestamp).getTime()) &&
        Number.isFinite(point.value) &&
        point.value > 0 &&
        Number.isFinite(point.totalAssets),
    )
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const meaningfulPoints = rawPoints.filter((point) => point.totalAssets > 0);
  return meaningfulPoints.length >= 2 ? meaningfulPoints : rawPoints;
}

export function deriveVaultPerformanceStats(
  snapshots: VaultNavHistoryItem[],
): DerivedVaultPerformanceStats {
  const points = normalizeNavPoints(snapshots);

  if (points.length === 0) {
    return {
      apy: null,
      sinceInception: null,
      thirtyDay: null,
      maxDrawdown: null,
      winRate: null,
      daysCovered: 0,
      first: null,
      latest: null,
      points,
    };
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const first = firstPoint?.value ?? null;
  const latest = lastPoint?.value ?? null;

  let sinceInception: number | null = null;
  if (first && latest) {
    sinceInception = latest / first - 1;
  }

  const firstTimestamp = new Date(firstPoint?.timestamp ?? Date.now()).getTime();
  const latestTimestamp = new Date(lastPoint?.timestamp ?? Date.now()).getTime();
  const days = Math.max((latestTimestamp - firstTimestamp) / (1000 * 60 * 60 * 24), 0);
  const cutoff = latestTimestamp - 30 * 24 * 60 * 60 * 1000;
  const baseThirtyDay = [...points]
    .reverse()
    .find((point) => new Date(point.timestamp).getTime() <= cutoff);
  const thirtyDay =
    latest !== null && baseThirtyDay && baseThirtyDay.value > 0
      ? latest / baseThirtyDay.value - 1
      : null;

  const apy =
    first !== null && latest !== null && first > 0 && latest > 0 && days > 0
      ? Math.pow(latest / first, 365 / days) - 1
      : null;

  let peak = firstPoint?.value ?? 0;
  let maxDrawdown = 0;
  let positiveMoves = 0;

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index]?.value ?? peak;
    const previous = points[index - 1]?.value ?? peak;

    if (current > previous) {
      positiveMoves += 1;
    }

    if (current > peak) {
      peak = current;
    }

    const drawdown = peak > 0 ? current / peak - 1 : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return {
    apy,
    sinceInception,
    thirtyDay,
    maxDrawdown,
    winRate: points.length > 1 ? positiveMoves / (points.length - 1) : null,
    daysCovered: days,
    first,
    latest,
    points,
  };
}
