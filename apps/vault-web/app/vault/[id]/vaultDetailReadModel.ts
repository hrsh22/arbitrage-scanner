import type { DerivedVaultPerformanceStats } from "../../../src/lib/performance";
import type {
  Cycle,
  VaultActivityFeedItem,
  VaultInstance,
  VaultNAV,
  VaultNavHistoryItem,
} from "../../../src/types";

export interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  timestamp: string | null;
  tone: "neutral" | "good" | "warning";
}

export interface HeroMetric {
  label: string;
  value: string;
  hint: string;
  tooltip: string;
}

const MEANINGFUL_ACTIVITY_TYPES = new Set([
  "cycle_opened",
  "cycle_reopened",
  "vault_reopened",
  "vault_paused",
  "book_closed",
  "close_book",
  "processing_started",
  "begin_processing",
  "process_deposits_chunk",
  "deposit_queued",
  "deposit_queue_processed",
  "process_redeems_chunk",
  "withdraw_ready",
  "withdraw_settled",
  "claim_window_opened",
  "strategy_update_posted",
  "mandate_changed",
  "fee_changed",
  "fee_change",
  "processing_completed",
  "finalize_processing",
]);

interface FreshestNavSnapshot {
  sharePrice: number;
  totalAssets: number;
  trackedTotalAssets?: number;
  lastUpdated: string;
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getDisplayedTvl(
  snapshot: {
    totalAssets: number;
    trackedTotalAssets?: number;
  } | null,
): number | null {
  if (!snapshot) {
    return null;
  }

  return snapshot.trackedTotalAssets ?? snapshot.totalAssets;
}

function formatActivityAmount(
  value: string | undefined,
  formatCurrency: (value: number, maximumFractionDigits?: number) => string,
  suffix = "USDC.e",
): string | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return `${formatCurrency(parsed)} ${suffix}`;
}

function mapFeedItemsToTimeline(
  items: VaultActivityFeedItem[],
  formatCurrency: (value: number, maximumFractionDigits?: number) => string,
): ActivityItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    detail: [
      item.detail,
      formatActivityAmount(item.amounts?.assets, formatCurrency),
      formatActivityAmount(item.amounts?.shares, formatCurrency, "shares"),
    ]
      .filter(Boolean)
      .join(" · "),
    timestamp: item.occurredAt,
    tone:
      item.type.includes("claim") ||
      item.type.includes("completed") ||
      item.type.includes("processed")
        ? "good"
        : item.type.includes("cancel") || item.type.includes("blocked")
          ? "warning"
          : "neutral",
  }));
}

function isMeaningfulActivity(item: VaultActivityFeedItem): boolean {
  const normalizedType = item.type.toLowerCase();
  if (normalizedType.includes("nav") || normalizedType.includes("capital")) {
    return false;
  }

  if (MEANINGFUL_ACTIVITY_TYPES.has(normalizedType)) {
    return true;
  }

  return /deposit batch processed|withdrawal processed|claim window opened|strategy update|mandate|fee change|vault paused|vault reopened/i.test(
    `${item.title} ${item.detail}`,
  );
}

function getHeroStateLabel(vault: VaultInstance, cycle: Cycle | null): string {
  if (!vault.enabled || cycle?.executionMode === "blocked") {
    return "Paused";
  }

  if (
    cycle?.batchState === "processing" ||
    cycle?.batchState === "flattening" ||
    cycle?.batchState === "settling"
  ) {
    return "Trading";
  }

  if (vault.type === "custom" && cycle?.executionMode === "queued") {
    if (cycle.batchState !== "closed") {
      return "Processing";
    }
    return "Accepting deposits";
  }

  return "Open";
}

function getLatestHistorySnapshot(snapshots: VaultNavHistoryItem[]): {
  timestamp: number;
  sharePrice: number;
  totalAssets: number;
} | null {
  return snapshots.reduce<{
    timestamp: number;
    sharePrice: number;
    totalAssets: number;
  } | null>((latest, snapshot) => {
    const snapshotTime = new Date(snapshot.timestamp).getTime();
    const candidate = {
      timestamp: snapshotTime,
      sharePrice: Number(snapshot.sharePrice),
      totalAssets: Number(snapshot.totalAssets),
    };
    return !latest || candidate.timestamp > latest.timestamp ? candidate : latest;
  }, null);
}

function selectFreshestNavSnapshot(args: {
  vault: VaultInstance | undefined;
  statusNav: VaultNAV | null | undefined;
  navHistorySnapshots: VaultNavHistoryItem[];
}): FreshestNavSnapshot | null {
  const { vault, statusNav, navHistorySnapshots } = args;

  if (vault?.type === "custom" && statusNav) {
    return statusNav;
  }

  const statusUpdatedAt = statusNav?.lastUpdated ? new Date(statusNav.lastUpdated).getTime() : 0;
  const historyLatest = getLatestHistorySnapshot(navHistorySnapshots);

  if (historyLatest && historyLatest.timestamp > statusUpdatedAt) {
    return {
      sharePrice: historyLatest.sharePrice,
      totalAssets: historyLatest.totalAssets,
      lastUpdated: new Date(historyLatest.timestamp).toISOString(),
    };
  }

  return statusNav ?? null;
}

function buildHeroMetrics(args: {
  performance: DerivedVaultPerformanceStats;
  freshestNavSnapshot: FreshestNavSnapshot | null;
  formatPercent: (value: number | null) => string;
  formatSharePrice: (value: number) => string;
  formatDate: (iso: string | null | undefined) => string;
  formatCompactCurrency: (value: number) => string;
}): HeroMetric[] {
  const {
    performance,
    freshestNavSnapshot,
    formatPercent,
    formatSharePrice,
    formatDate,
    formatCompactCurrency,
  } = args;

  return [
    {
      label: "APY",
      value: formatPercent(performance.apy),
      hint: performance.apy !== null ? "Based on past performance." : "Not enough history yet.",
      tooltip: "Estimated annual return based on vault performance.",
    },
    {
      label: "NAV",
      value: freshestNavSnapshot ? formatSharePrice(freshestNavSnapshot.sharePrice) : "--",
      hint: freshestNavSnapshot?.lastUpdated
        ? `Updated ${formatDate(freshestNavSnapshot.lastUpdated)}`
        : "Waiting for first update.",
      tooltip: "Current price per share.",
    },
    {
      label: "TVL",
      value: freshestNavSnapshot
        ? formatCompactCurrency(getDisplayedTvl(freshestNavSnapshot) ?? 0)
        : "--",
      hint: freshestNavSnapshot ? "Total value in this vault." : "Waiting for first update.",
      tooltip: "Total value held in this vault.",
    },
  ];
}

export function buildVaultDetailReadModel(args: {
  vault: VaultInstance | undefined;
  cycle: Cycle | null;
  statusNav: VaultNAV | null | undefined;
  navHistorySnapshots: VaultNavHistoryItem[];
  performance: DerivedVaultPerformanceStats;
  vaultEventItems: VaultActivityFeedItem[];
  userActivityItems: VaultActivityFeedItem[];
  formatPercent: (value: number | null) => string;
  formatSharePrice: (value: number) => string;
  formatDate: (iso: string | null | undefined) => string;
  formatCompactCurrency: (value: number) => string;
  formatCurrency: (value: number, maximumFractionDigits?: number) => string;
}): {
  freshestNavSnapshot: FreshestNavSnapshot | null;
  tags: string[];
  heroMetrics: HeroMetric[];
  vaultActivity: ActivityItem[];
  userActivity: ActivityItem[];
} {
  const {
    vault,
    cycle,
    statusNav,
    navHistorySnapshots,
    performance,
    vaultEventItems,
    userActivityItems,
    formatPercent,
    formatSharePrice,
    formatDate,
    formatCompactCurrency,
    formatCurrency,
  } = args;

  const freshestNavSnapshot = selectFreshestNavSnapshot({
    vault,
    statusNav,
    navHistorySnapshots,
  });

  return {
    freshestNavSnapshot,
    tags: vault
      ? [
          vault.profile.strategyLabel,
          getHeroStateLabel(vault, cycle),
          `${toTitleCase(vault.profile.riskLevel)} risk`,
        ]
      : [],
    heroMetrics: buildHeroMetrics({
      performance,
      freshestNavSnapshot,
      formatPercent,
      formatSharePrice,
      formatDate,
      formatCompactCurrency,
    }),
    vaultActivity: mapFeedItemsToTimeline(
      vaultEventItems.filter(isMeaningfulActivity),
      formatCurrency,
    ),
    userActivity: mapFeedItemsToTimeline(userActivityItems, formatCurrency),
  };
}
