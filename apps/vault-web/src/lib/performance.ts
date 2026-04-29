import type { VaultNavHistoryItem } from "../types";

export interface VaultPerformancePoint {
  timestamp: string;
  value: number;
  totalAssets: number;
}

export interface DerivedVaultPerformanceStats {
  apy: number | null;
  sinceInception: number | null;
  thirtyDay: number | null;
  maxDrawdown: number | null;
  minPointValue: number | null;
  maxPointValue: number | null;
  daysCovered: number;
  first: number | null;
  latest: number | null;
  points: VaultPerformancePoint[];
}

export interface VaultChartSeriesOptions {
  maxPoints: number;
  rangeDays?: number;
  smooth?: boolean;
}

const MIN_MEANINGFUL_TOTAL_ASSETS = 1;
const MIN_APY_DAYS = 1; // Require at least 1 day to avoid wild extrapolations
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeNavPoints(snapshots: VaultNavHistoryItem[]): VaultPerformancePoint[] {
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

  const meaningfulPoints = rawPoints.filter(
    (point) => point.totalAssets >= MIN_MEANINGFUL_TOTAL_ASSETS,
  );
  return meaningfulPoints.length >= 2 ? meaningfulPoints : rawPoints;
}

function deriveStatsFromPoints(points: VaultPerformancePoint[]): DerivedVaultPerformanceStats {
  if (points.length === 0) {
    return {
      apy: null,
      sinceInception: null,
      thirtyDay: null,
      maxDrawdown: null,
      minPointValue: null,
      maxPointValue: null,
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
    first !== null && latest !== null && first > 0 && latest > 0 && days >= MIN_APY_DAYS
      ? Math.pow(latest / first, 365 / days) - 1
      : null;

  let peak = firstPoint?.value ?? 0;
  let maxDrawdown = 0;
  let minPointValue = firstPoint?.value ?? null;
  let maxPointValue = firstPoint?.value ?? null;

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index]?.value ?? peak;

    if (minPointValue === null || current < minPointValue) {
      minPointValue = current;
    }

    if (maxPointValue === null || current > maxPointValue) {
      maxPointValue = current;
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
    minPointValue,
    maxPointValue,
    daysCovered: days,
    first,
    latest,
    points,
  };
}

function filterPointsByRange(
  points: VaultPerformancePoint[],
  rangeDays: number | undefined,
): VaultPerformancePoint[] {
  if (rangeDays === undefined || points.length < 2) {
    return points;
  }

  const latestTimestamp = new Date(points[points.length - 1]?.timestamp ?? Date.now()).getTime();
  const cutoff = latestTimestamp - rangeDays * DAY_MS;
  const filtered = points.filter((point) => new Date(point.timestamp).getTime() >= cutoff);

  if (filtered.length >= 2) {
    return filtered;
  }

  return points.slice(-Math.min(points.length, 2));
}

function downsampleEvenly(
  points: VaultPerformancePoint[],
  maxPoints: number,
): VaultPerformancePoint[] {
  if (points.length <= maxPoints || maxPoints < 2) {
    return points;
  }

  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]).filter(
    (point): point is VaultPerformancePoint => point !== undefined,
  );
}

function smoothIntoTimeBuckets(
  points: VaultPerformancePoint[],
  maxPoints: number,
): VaultPerformancePoint[] {
  if (points.length <= maxPoints || maxPoints < 4) {
    return downsampleEvenly(points, maxPoints);
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) {
    return points;
  }

  const interiorPoints = points.slice(1, -1);
  const bucketCount = Math.max(maxPoints - 2, 1);
  const firstTimestamp = new Date(firstPoint.timestamp).getTime();
  const lastTimestamp = new Date(lastPoint.timestamp).getTime();
  const bucketMs = Math.max((lastTimestamp - firstTimestamp) / bucketCount, 1);

  const buckets = new Map<
    number,
    {
      timestamp: number;
      valueTotal: number;
      assetsTotal: number;
      count: number;
    }
  >();

  for (const point of interiorPoints) {
    const timestamp = new Date(point.timestamp).getTime();
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((timestamp - firstTimestamp) / bucketMs)),
    );
    const bucket = buckets.get(bucketIndex);

    if (!bucket) {
      buckets.set(bucketIndex, {
        timestamp,
        valueTotal: point.value,
        assetsTotal: point.totalAssets,
        count: 1,
      });
      continue;
    }

    bucket.timestamp = timestamp;
    bucket.valueTotal += point.value;
    bucket.assetsTotal += point.totalAssets;
    bucket.count += 1;
  }

  const smoothed = [...buckets.values()].map((bucket) => ({
    timestamp: new Date(bucket.timestamp).toISOString(),
    value: bucket.valueTotal / bucket.count,
    totalAssets: bucket.assetsTotal / bucket.count,
  }));

  return [firstPoint, ...smoothed, lastPoint];
}

export function deriveVaultPerformanceStats(
  snapshots: VaultNavHistoryItem[],
): DerivedVaultPerformanceStats {
  return deriveStatsFromPoints(normalizeNavPoints(snapshots));
}

export function deriveVaultChartStats(
  snapshots: VaultNavHistoryItem[],
  options: VaultChartSeriesOptions,
): DerivedVaultPerformanceStats {
  const points = filterPointsByRange(normalizeNavPoints(snapshots), options.rangeDays);
  const chartPoints = options.smooth
    ? smoothIntoTimeBuckets(points, options.maxPoints)
    : downsampleEvenly(points, options.maxPoints);

  return deriveStatsFromPoints(chartPoints);
}
