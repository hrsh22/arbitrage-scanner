"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Wallet,
  User,
  Building2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  deriveVaultChartStats,
  deriveVaultPerformanceStats,
  type DerivedVaultPerformanceStats,
} from "../../../src/lib/performance";
import { resolveVaultFromRouteSegment } from "../../../src/lib/vaultRouting";
import {
  useCycleStatus,
  useRequests,
  useVaultDepositFlow,
  useVaultEvents,
  useVaultInstances,
  useVaultNavHistory,
  useVaultPositionHistory,
  useVaultShares,
  useVaultStatus,
  useVaultTradingAnalytics,
  useUserVaultHistory,
  useAuthSession,
  invalidatePublicVaultDetailQueries,
  invalidateUserVaultDetailQueries,
  useTransientState,
} from "../../../src/lib/hooks";
import {
  COLLATERAL_SYMBOL,
  SUPPORTS_POLYMARKET_TRADING,
  USER_COLLATERAL_SYMBOL,
  VAULT_NETWORK,
} from "../../../src/constants";
import type {
  Cycle,
  VaultInstance,
  VaultPositionHistoryResponse,
  VaultStatusResponse,
  VaultTradingAnalytics,
} from "../../../src/types";
import { RedemptionPanel } from "./components";
import { AssetLogoStack, type AssetType } from "../../../components/asset-logo";
import {
  buildVaultDetailReadModel,
  type ActivityItem,
  type HeroMetric,
} from "./vaultDetailReadModel";

declare global {
  interface Window {
    __E2E_EFFECTIVE_CONNECTED__?: boolean;
  }
}

interface DepositSuccessResult {
  amount?: number;
  mode: "queued" | "minted";
}

interface OptimisticDepositState {
  amount: number;
  mode: DepositSuccessResult["mode"];
  createdAt: number;
}

interface VaultActivityPaginationState {
  routeVaultId: number;
  offset: number;
}

interface UserActivityPaginationState {
  scope: string;
  offset: number;
}

interface VaultDetailUiState {
  e2eConnectedSeam: boolean;
  tradesOffset: number;
  optimisticDeposit: OptimisticDepositState | null;
  vaultActivityPagination: VaultActivityPaginationState;
  userActivityPagination: UserActivityPaginationState;
}

type VaultDetailUiAction =
  | { type: "set-e2e-connected-seam"; value: boolean }
  | { type: "set-optimistic-deposit"; value: OptimisticDepositState | null }
  | { type: "previous-trades-page" }
  | { type: "next-trades-page" }
  | { type: "previous-vault-activity-page"; routeVaultId: number }
  | { type: "next-vault-activity-page"; routeVaultId: number }
  | { type: "previous-user-activity-page"; scope: string }
  | { type: "next-user-activity-page"; scope: string };

function createVaultDetailUiState(
  routeVaultId: number,
  userActivityScope: string,
): VaultDetailUiState {
  return {
    e2eConnectedSeam: false,
    tradesOffset: 0,
    optimisticDeposit: null,
    vaultActivityPagination: {
      routeVaultId,
      offset: 0,
    },
    userActivityPagination: {
      scope: userActivityScope,
      offset: 0,
    },
  };
}

function vaultDetailUiReducer(
  state: VaultDetailUiState,
  action: VaultDetailUiAction,
): VaultDetailUiState {
  switch (action.type) {
    case "set-e2e-connected-seam":
      return { ...state, e2eConnectedSeam: action.value };
    case "set-optimistic-deposit":
      return { ...state, optimisticDeposit: action.value };
    case "previous-trades-page":
      return {
        ...state,
        tradesOffset: Math.max(state.tradesOffset - ACTIVITY_PAGE_SIZE, 0),
      };
    case "next-trades-page":
      return { ...state, tradesOffset: state.tradesOffset + ACTIVITY_PAGE_SIZE };
    case "previous-vault-activity-page":
      return {
        ...state,
        vaultActivityPagination: {
          routeVaultId: action.routeVaultId,
          offset:
            state.vaultActivityPagination.routeVaultId === action.routeVaultId
              ? Math.max(state.vaultActivityPagination.offset - ACTIVITY_PAGE_SIZE, 0)
              : 0,
        },
      };
    case "next-vault-activity-page":
      return {
        ...state,
        vaultActivityPagination: {
          routeVaultId: action.routeVaultId,
          offset:
            state.vaultActivityPagination.routeVaultId === action.routeVaultId
              ? state.vaultActivityPagination.offset + ACTIVITY_PAGE_SIZE
              : ACTIVITY_PAGE_SIZE,
        },
      };
    case "previous-user-activity-page":
      return {
        ...state,
        userActivityPagination: {
          scope: action.scope,
          offset:
            state.userActivityPagination.scope === action.scope
              ? Math.max(state.userActivityPagination.offset - ACTIVITY_PAGE_SIZE, 0)
              : 0,
        },
      };
    case "next-user-activity-page":
      return {
        ...state,
        userActivityPagination: {
          scope: action.scope,
          offset:
            state.userActivityPagination.scope === action.scope
              ? state.userActivityPagination.offset + ACTIVITY_PAGE_SIZE
              : ACTIVITY_PAGE_SIZE,
        },
      };
    default:
      return state;
  }
}

function formatCurrency(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value) || !Number.isFinite(value)) {
    return "--";
  }

  const percentage = value * 100;
  if (!Number.isFinite(percentage) || Math.abs(percentage) > 100_000) {
    return "--";
  }
  const sign = percentage > 0 ? "+" : "";
  return `${sign}${percentage.toFixed(2)}%`;
}

function formatSharePrice(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return "Unknown";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getLiquidityLabel(vault: VaultInstance, cycle: Cycle | null): string {
  if (vault.type === "custom") {
    return "Periodic withdrawals";
  }

  if (cycle?.executionMode === "instant") {
    return "Instant when liquidity is available";
  }

  return "Cycle-based exit windows";
}

function getFeeLabel(vault: VaultInstance): string {
  return `${vault.profile.fees.management}% management / ${vault.profile.fees.performance}% performance`;
}

function getDepositActionLabel(
  vault: VaultInstance,
  cycle: Cycle | null,
  migration: VaultStatusResponse["migration"] | null,
): string {
  if (migration?.depositsDisabled ?? vault.migration?.depositsDisabled) {
    return "Migration mode";
  }

  if (!vault.enabled || cycle?.executionMode === "blocked") {
    return "Paused";
  }

  if (vault.type === "custom" && cycle?.executionMode === "instant") {
    return "Open";
  }

  if (
    vault.type === "custom" &&
    cycle?.executionMode === "queued" &&
    cycle.batchState !== "closed"
  ) {
    return "Accepting soon";
  }

  if (vault.type === "custom" && cycle?.executionMode === "queued") {
    return "Queue deposit";
  }

  return "Open";
}

function getHeroSentence(vault: VaultInstance): string {
  return `${vault.profile.strategyLabel} strategy with ${vault.profile.riskLevel} risk, running on Polymarket.`;
}

function getManagementLabel(vault: VaultInstance): string {
  return vault.type === "custom" ? "Agent-operated" : "Automated";
}

function getRiskScore(level: VaultInstance["profile"]["riskLevel"]): string {
  switch (level) {
    case "low":
      return "3.4 / 10";
    case "medium":
      return "5.9 / 10";
    case "high":
      return "8.2 / 10";
    default:
      return "--";
  }
}

function getRiskSummary(vault: VaultInstance, cycle: Cycle | null): string {
  return `${toTitleCase(vault.profile.riskLevel)} risk strategy. ${getLiquidityLabel(vault, cycle)}. No principal protection.`;
}

const ACTIVITY_PAGE_SIZE = 10;
const NAV_CHART_TARGET_POINTS = 120;

const NAV_CHART_RANGES = [
  {
    value: "1M",
    label: "1M",
    rangeDays: 30,
    maxPoints: NAV_CHART_TARGET_POINTS,
    description: "Last 30 days",
  },
  {
    value: "3M",
    label: "3M",
    rangeDays: 90,
    maxPoints: NAV_CHART_TARGET_POINTS,
    description: "Last 3 months",
  },
  {
    value: "6M",
    label: "6M",
    rangeDays: 183,
    maxPoints: NAV_CHART_TARGET_POINTS,
    description: "Last 6 months",
  },
  {
    value: "1Y",
    label: "1Y",
    rangeDays: 365,
    maxPoints: NAV_CHART_TARGET_POINTS,
    description: "Last year",
  },
  {
    value: "ALL",
    label: "All",
    rangeDays: undefined,
    maxPoints: NAV_CHART_TARGET_POINTS,
    description: "All history",
  },
] as const;

type NavChartRange = (typeof NAV_CHART_RANGES)[number]["value"];

type ActivityTab = "user" | "vault" | "trades";
type PositionActionTab = "deposit" | "withdraw";

const ACTIVITY_TAB_OPTIONS = [
  { value: "user", label: "Your activity" },
  { value: "vault", label: "Vault activity" },
  { value: "trades", label: "Trades" },
] as const satisfies Array<{ value: ActivityTab; label: string }>;

function getNavChartRangeConfig(range: NavChartRange) {
  return NAV_CHART_RANGES.find((option) => option.value === range) ?? NAV_CHART_RANGES[0];
}

function getVaultTradingAssets(vault: VaultInstance): AssetType[] {
  return [
    ...(vault.profile.tradingMetadata?.assets || []),
    ...(vault.profile.tradingMetadata?.platforms || []),
  ].filter((asset): asset is AssetType =>
    ["usdc", "btc", "gnosis-safe", "polymarket"].includes(asset),
  );
}

function InfoTooltip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#615E4E] transition-colors hover:bg-[#F6F4F3] hover:text-[#8A6231] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/50"
        >
          <AlertCircle className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={8}
        className="max-w-xs rounded-xl border-[#CCCAC4] bg-[#FAF8F5] px-3 py-2 text-[#302B2C] shadow-[0_18px_45px_-24px_rgba(48,43,44,0.45)]"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function SectionShell({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      id={id}
      className="min-w-0 overflow-hidden rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] shadow-[0_22px_80px_-58px_rgba(26,32,44,0.48)]"
    >
      <CardHeader className="border-b border-[#CCCAC4] pb-5">
        {eyebrow ? (
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#615E4E]">
            {eyebrow}
          </p>
        ) : null}
        <CardTitle className="font-serif text-3xl font-bold tracking-tight text-[#1A202C]">
          {title}
        </CardTitle>
        {description ? (
          <CardDescription className="max-w-2xl text-sm leading-6 text-[#615E4E]">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

function SummaryMetric({
  label,
  value,
  hint,
  tooltip,
}: {
  label: string;
  value: string;
  hint: string;
  tooltip?: string;
}) {
  return (
    <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">{label}</p>
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-[#1A202C]">{value}</p>
      <p className="mt-2 text-xs leading-6 text-[#615E4E]">{hint}</p>
    </div>
  );
}

function PerformanceTile({
  label,
  value,
  tone = "neutral",
  tooltip,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warning";
  tooltip?: string;
}) {
  return (
    <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">{label}</p>
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-xl font-semibold tracking-tight",
          tone === "good" && "text-[#2F7A35]",
          tone === "warning" && "text-[#8A6231]",
          tone === "neutral" && "text-[#1A202C]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function NavChart({
  stats,
  isLoading,
  selectedRange,
  onRangeChange,
}: {
  stats: DerivedVaultPerformanceStats;
  isLoading: boolean;
  selectedRange: NavChartRange;
  onRangeChange: (range: NavChartRange) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const rangeConfig = getNavChartRangeConfig(selectedRange);
  const chartGeometry = useMemo(() => {
    const width = 880;
    const height = 220;
    let min = stats.minPointValue ?? stats.points[0]?.value ?? 0;
    let max = stats.maxPointValue ?? stats.points[0]?.value ?? 0;

    if (min === max) {
      const padding = min === 0 ? 0.01 : min * 0.01;
      min -= padding;
      max += padding;
    }

    const range = Math.max(max - min, 0.000001);
    const coordinates = stats.points.map((point, index) => {
      const x = (index / Math.max(stats.points.length - 1, 1)) * width;
      const y = height - ((point.value - min) / range) * height;
      return { ...point, x, y };
    });

    const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");

    return {
      width,
      height,
      coordinates,
      line,
      area: `0,${height} ${line} ${width},${height}`,
    };
  }, [stats.maxPointValue, stats.minPointValue, stats.points]);

  if (isLoading) {
    return <Skeleton className="h-[320px] w-full rounded-2xl bg-[#E8D9C0]" />;
  }

  if (stats.points.length < 2) {
    return (
      <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-6 text-sm text-[#615E4E]">
        Not enough NAV history yet to render a performance curve.
      </div>
    );
  }

  const { width, height, coordinates, line, area } = chartGeometry;

  const hoveredPoint = hoveredIndex !== null ? coordinates[hoveredIndex] : null;

  const selectNearestPoint = (clientX: number, bounds: DOMRect) => {
    const relativeX = ((clientX - bounds.left) / Math.max(bounds.width, 1)) * width;
    const nearestIndex = Math.min(
      coordinates.length - 1,
      Math.max(0, Math.round((relativeX / width) * Math.max(coordinates.length - 1, 0))),
    );
    setHoveredIndex(nearestIndex);
  };

  return (
    <div className="rounded-2xl border border-[#CCCAC4] bg-[#F0EDE8] p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">
            NAV chart
          </p>
          <p className="mt-2 font-serif text-4xl font-bold tracking-tight text-[#1A202C]">
            {stats.latest !== null ? formatSharePrice(stats.latest) : "--"}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div
            className="inline-flex w-fit rounded-full border border-[#CCCAC4] bg-[#F1EEE8] p-1"
            aria-label="NAV chart time range"
          >
            {NAV_CHART_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setHoveredIndex(null);
                  onRangeChange(option.value);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/50",
                  selectedRange === option.value
                    ? "bg-[#E8C08C]/25 text-[#1A202C] ring-1 ring-inset ring-[#615E4E]/25"
                    : "text-[#615E4E] hover:bg-[#F6F4F3] hover:text-[#1A202C]",
                )}
                aria-pressed={selectedRange === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 text-xs text-[#615E4E] sm:grid-cols-2 sm:text-right">
            <div>Start: {stats.first !== null ? formatSharePrice(stats.first) : "--"}</div>
            <div>
              Latest snapshot:{" "}
              {formatDate(stats.points[stats.points.length - 1]?.timestamp ?? null)}
            </div>
            <div className="sm:col-span-2 text-[#615E4E]">{rangeConfig.description}</div>
          </div>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-56 w-full touch-none"
          preserveAspectRatio="none"
          role="img"
          aria-label="NAV performance chart"
          tabIndex={0}
          onPointerMove={(event) =>
            selectNearestPoint(event.clientX, event.currentTarget.getBoundingClientRect())
          }
          onPointerLeave={() => setHoveredIndex(null)}
          onFocus={() => setHoveredIndex(coordinates.length - 1)}
          onBlur={() => setHoveredIndex(null)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
              return;
            }

            event.preventDefault();
            setHoveredIndex((current) => {
              const fallback = event.key === "ArrowLeft" ? coordinates.length - 1 : 0;
              const next = current ?? fallback;
              return event.key === "ArrowLeft"
                ? Math.max(0, next - 1)
                : Math.min(coordinates.length - 1, next + 1);
            });
          }}
        >
          <defs>
            <linearGradient id="vault-line" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(184,145,91,0.95)" />
              <stop offset="100%" stopColor="rgba(232,192,140,0.95)" />
            </linearGradient>
            <linearGradient id="vault-area" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(232,192,140,0.34)" />
              <stop offset="100%" stopColor="rgba(232,192,140,0.02)" />
            </linearGradient>
          </defs>
          <polyline fill="url(#vault-area)" stroke="none" points={area} />
          <polyline fill="none" stroke="url(#vault-line)" strokeWidth="3" points={line} />
          {hoveredPoint ? (
            <g>
              <line
                x1={hoveredPoint.x}
                x2={hoveredPoint.x}
                y1={0}
                y2={height}
                stroke="rgba(155,140,118,0.48)"
                strokeDasharray="5 5"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r="6"
                fill="#F1EEE8"
                stroke="rgba(184,145,91,0.95)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}
        </svg>
        {hoveredPoint ? (
          <div
            className="pointer-events-none absolute top-3 w-max min-w-0 max-w-[calc(100vw-3rem)] rounded-xl border border-[#CCCAC4] bg-[#FAF8F5]/95 px-3 py-2 text-xs shadow-[0_18px_45px_-24px_rgba(48,43,44,0.5)] backdrop-blur"
            style={{
              left: `${Math.min(Math.max((hoveredPoint.x / width) * 100, 8), 92)}%`,
              transform: hoveredPoint.x / width > 0.75 ? "translateX(-100%)" : "translateX(-8%)",
            }}
          >
            <p className="font-bold text-[#302B2C]">{formatSharePrice(hoveredPoint.value)}</p>
            <p className="mt-1 text-[#61604E]">{formatDate(hoveredPoint.timestamp)}</p>
            <p className="mt-1 text-[#8A6231]">
              Assets {formatCompactCurrency(hoveredPoint.totalAssets)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityTimeline({
  items,
  emptyState = "No recent updates yet.",
  pageSize = ACTIVITY_PAGE_SIZE,
}: {
  items: ActivityItem[];
  emptyState?: string;
  pageSize?: number;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-5 text-sm text-[#615E4E]">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="min-h-[92px] rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    item.tone === "good" && "bg-emerald-300",
                    item.tone === "warning" && "bg-amber-300",
                    item.tone === "neutral" && "bg-[#E8C08C]",
                  )}
                />
                <p className="text-sm font-bold text-[#1A202C]">{item.title}</p>
              </div>
              <p className="text-sm leading-6 text-[#615E4E]">{item.detail}</p>
            </div>
            <p className="whitespace-nowrap text-xs font-medium text-[#615E4E] mt-0.5">
              {formatDate(item.timestamp)}
            </p>
          </div>
        </div>
      ))}

      {Array.from({ length: Math.max(pageSize - items.length, 0) }).map((_, index) => (
        <div
          key={`activity-placeholder-${index}`}
          className="invisible min-h-[92px] rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ActivityPaginationControls({
  offset,
  currentCount,
  hasMore,
  isLoading,
  onPrevious,
  onNext,
}: {
  offset: number;
  currentCount: number;
  hasMore: boolean;
  isLoading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const start = currentCount > 0 ? offset + 1 : 0;
  const end = offset + currentCount;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] px-4 py-3 text-xs text-[#615E4E] sm:flex-row sm:items-center sm:justify-between">
      <span>{currentCount > 0 ? `Showing ${start}-${end}` : "No activity on this page"}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={offset === 0 || isLoading}
          className="h-8 rounded-full border-[#CCCAC4] bg-[#F1EEE8] px-3 text-xs font-bold text-[#615E4E] hover:border-[#615E4E] hover:bg-[#F6F4F3] hover:text-[#1A202C] disabled:opacity-40"
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!hasMore || isLoading}
          className="h-8 rounded-full border-[#CCCAC4] bg-[#F1EEE8] px-3 text-xs font-bold text-[#615E4E] hover:border-[#615E4E] hover:bg-[#F6F4F3] hover:text-[#1A202C] disabled:opacity-40"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function TradesList({
  positions,
  emptyState = "No trades yet.",
  pageSize,
}: {
  positions: VaultPositionHistoryResponse["positions"];
  emptyState?: string;
  pageSize: number;
}) {
  if (!positions || positions.length === 0) {
    return (
      <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-5 text-sm text-[#615E4E]">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#CCCAC4] bg-[#F0EDE8]">
      {positions.map((pos) => {
        const isClosed = pos.status === "closed";
        const pnl = pos.realizedPnl ?? pos.cashPnl ?? 0;
        const isWin = pnl >= 0;
        const pnlFormatted = `${isWin ? "+" : ""}${formatCurrency(pnl)}`;

        return (
          <div
            key={`${pos.tokenId}-${pos.conditionId}-${pos.outcome}-${pos.endDate}`}
            className="group flex flex-col gap-3 border-b border-[#CCCAC4] p-4 transition-colors hover:bg-[#F6F4F3] last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-1 flex-col min-w-0 pr-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full bg-[#F1EEE8] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ring-[#CCCAC4]",
                    pos.outcome === "Yes"
                      ? "text-emerald-400"
                      : pos.outcome === "No"
                        ? "text-rose-400"
                        : "text-[#8A6231]",
                  )}
                >
                  {pos.outcome}
                </span>
                <span className="whitespace-nowrap text-xs font-medium text-[#615E4E]">
                  {formatDate(pos.endDate)}
                </span>
                {!isClosed && (
                  <span className="rounded-full bg-[#E8C08C]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#8A6231]">
                    Open
                  </span>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="cursor-default truncate text-sm font-bold text-[#1A202C] transition-colors group-hover:text-[#8A6231]">
                    {pos.title}
                  </p>
                </TooltipTrigger>
                <TooltipContent
                  sideOffset={8}
                  className="max-w-[320px] rounded-xl bg-[#1A202C] px-3 py-2 text-[#F6F4F3] shadow-2xl"
                >
                  <p className="text-sm font-medium leading-relaxed">{pos.title}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex flex-wrap gap-4 sm:shrink-0 sm:flex-nowrap sm:items-center sm:gap-8">
              <div className="flex flex-col text-left sm:text-right">
                <span className="text-[10px] uppercase tracking-wider text-[#615E4E]">
                  Invested
                </span>
                <span className="font-mono text-sm text-[#1A202C]">
                  {Number.isFinite(pos.size) && Number.isFinite(pos.avgPrice)
                    ? formatCurrency(pos.size * pos.avgPrice)
                    : "--"}
                </span>
                {Number.isFinite(pos.size) && (
                  <span className="mt-0.5 font-mono text-[9px] text-[#615E4E]">
                    {pos.size.toFixed(2)} shares
                  </span>
                )}
              </div>
              <div className="flex flex-col text-left sm:text-right">
                <span className="text-[10px] uppercase tracking-wider text-[#615E4E]">
                  Avg Price
                </span>
                <span className="font-mono text-sm text-[#1A202C]">
                  {Number.isFinite(pos.avgPrice) ? `$${pos.avgPrice.toFixed(2)}` : "--"}
                </span>
              </div>
              <div className="flex flex-col text-left sm:text-right">
                {!isClosed ? (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-[#615E4E]">
                      Value
                    </span>
                    <span className="font-mono text-sm font-bold text-[#1A202C]">
                      {typeof pos.currentValue === "number"
                        ? formatCurrency(pos.currentValue)
                        : "--"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-[#615E4E]">
                      Return
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold",
                        isWin ? "text-[#2F7A35]" : "text-[#615E4E]",
                      )}
                    >
                      {pnlFormatted}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {Array.from({ length: Math.max(pageSize - positions.length, 0) }).map((_, index) => (
        <div
          key={`trades-placeholder-${index}`}
          className="invisible min-h-[96px] border-b border-[#CCCAC4] last:border-b-0"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function RailStat({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-[#615E4E]">
        {label}
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </span>
      <span className="text-sm font-bold text-[#1A202C]">{value}</span>
    </div>
  );
}

function KeyInfoItem({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip?: string;
}) {
  return (
    <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-3">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">{label}</p>
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </div>
      <p className="mt-1.5 text-sm font-bold text-[#1A202C]">{value}</p>
    </div>
  );
}

function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function AddressField({
  label,
  address,
  balanceLabel,
  balance,
  logoSrc,
}: {
  label: string;
  address: string;
  balanceLabel?: string;
  balance?: string;
  logoSrc?: string;
}) {
  const {
    value: copied,
    activate: copyAddress,
    deactivate: resetCopied,
  } = useTransientState({ durationMs: 1500 });

  useEffect(() => {
    resetCopied();
  }, [address, resetCopied]);

  return (
    <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">
          {logoSrc && <Image src={logoSrc} alt={label} width={16} height={16} />}
          {label}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(address);
                copyAddress();
              }}
              className="rounded-full border border-[#CCCAC4] bg-[#F1EEE8] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#615E4E] transition-colors hover:border-[#D4A574] hover:bg-[#E8C08C] hover:text-[#302B2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/40"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </TooltipTrigger>
          <TooltipContent
            sideOffset={8}
            className="max-w-sm rounded-xl border-[#CCCAC4] bg-[#FAF8F5] px-3 py-2 text-xs text-[#302B2C] shadow-xl"
          >
            Click to copy full address
          </TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="mt-3 block min-h-8 rounded-lg py-1 text-left font-mono text-sm font-semibold text-[#302B2C] transition-colors hover:text-[#8A6231] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/40"
            onClick={() => {
              void navigator.clipboard.writeText(address);
              copyAddress();
            }}
          >
            {formatAddress(address)}
          </button>
        </TooltipTrigger>
        <TooltipContent
          sideOffset={8}
          className="max-w-sm rounded-xl border-[#CCCAC4] bg-[#FAF8F5] px-3 py-2 font-mono text-xs text-[#302B2C] shadow-xl"
        >
          {address}
        </TooltipContent>
      </Tooltip>

      {balance !== undefined && (
        <div className="mt-4 flex flex-col items-start gap-1 border-t border-[#CCCAC4] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">
            {balanceLabel}
          </span>
          <span className="font-mono text-sm font-semibold text-[#1A202C]">{balance}</span>
        </div>
      )}
    </div>
  );
}

function TechnicalDetailsDialog({
  vault,
  status,
}: {
  vault: VaultInstance;
  status: VaultStatusResponse | null;
}) {
  const tradingWalletCollateral = status ? status.nav.safeUsdc : null;
  const vaultCollateral = status ? status.nav.vaultUsdc : null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="rounded-full border border-[#D4A574] bg-[#FAF8F5] px-4 font-bold text-[#1A202C] shadow-none ring-1 ring-white/70 hover:border-[#8A6231] hover:bg-white hover:text-[#1A202C] focus-visible:ring-[#8A6231]/30"
        >
          Addresses
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] text-[#1A202C] shadow-[0_35px_120px_-55px_rgba(26,32,44,0.55)] [&_[data-slot=dialog-close]]:text-[#615E4E] [&_[data-slot=dialog-close]]:hover:text-[#302B2C]">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-bold tracking-tight text-[#1A202C]">
            Addresses
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-[#615E4E]">
            Contract addresses and wallet balances.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <AddressField
            label="Operator safe"
            address={vault.config.safeAddress}
            balanceLabel="Trading Wallet Balance"
            balance={
              tradingWalletCollateral !== null ? formatCurrency(tradingWalletCollateral) : "--"
            }
            logoSrc="/logo/gnosis-safe.svg"
          />
          <AddressField
            label="Vault contract"
            address={vault.config.vaultAddress}
            balanceLabel="Vault Balance"
            balance={vaultCollateral !== null ? formatCurrency(vaultCollateral) : "--"}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HowVaultWorksDialog({ vault }: { vault: VaultInstance }) {
  const [open, setOpen] = useState(false);

  const flowSteps = [
    {
      key: "depositor",
      icon: User,
      label: "Depositor",
      sublabel: "You",
      color: "orange",
    },
    {
      key: "collateral",
      logoSrc: "/logo/usdc-logo.svg",
      label: COLLATERAL_SYMBOL,
      sublabel: "Deposit",
      color: "amber",
    },
    {
      key: "vault",
      icon: Building2,
      label: "Vault",
      sublabel: "NAV Tracking",
      color: "emerald",
    },
    {
      key: "safe",
      logoSrc: "/logo/gnosis-safe.svg",
      label: "Trading Safe",
      sublabel: "Execution",
      color: "slate",
      bidirectional: true,
    },
  ];

  const colorMap = {
    orange: {
      bg: "from-orange-500/15 to-orange-600/5",
      border: "border-orange-400/30",
      glow: "shadow-[0_0_20px_rgba(251,146,60,0.15)]",
      icon: "text-orange-400",
      ring: "ring-orange-400/30",
      line: "from-orange-400",
    },
    amber: {
      bg: "from-amber-500/15 to-amber-600/5",
      border: "border-amber-400/30",
      glow: "shadow-[0_0_20px_rgba(251,191,36,0.15)]",
      icon: "text-amber-400",
      ring: "ring-amber-400/30",
      line: "from-amber-400",
    },
    emerald: {
      bg: "from-emerald-500/15 to-emerald-600/5",
      border: "border-emerald-400/30",
      glow: "shadow-[0_0_20px_rgba(52,211,153,0.15)]",
      icon: "text-emerald-400",
      ring: "ring-emerald-400/30",
      line: "from-emerald-400",
    },
    slate: {
      bg: "from-[#E8D9C0]/60 to-[#F1EEE8]/70",
      border: "border-[#CCCAC4]",
      glow: "shadow-[0_12px_30px_-24px_rgba(48,43,44,0.28)]",
      icon: "text-[#615E4E]",
      ring: "ring-[#CCCAC4]",
      line: "from-[#B8915B]",
    },
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 self-start items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#CCCAC4] bg-[#F1EEE8] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#615E4E] transition-all hover:border-[#615E4E] hover:bg-[#F6F4F3] hover:text-[#1A202C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/50"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span>How Vaults Work</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[min(1120px,96vw)] !max-w-none overflow-y-auto overscroll-contain rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] p-0 text-[#1A202C] shadow-[0_35px_120px_-55px_rgba(26,32,44,0.65)] [&_[data-slot=dialog-close]]:text-[#615E4E] [&_[data-slot=dialog-close]]:hover:text-[#302B2C]">
        <DialogTitle className="sr-only">How Vaults Work Flowchart</DialogTitle>
        <DialogDescription className="sr-only">
          Explains the lifecycle of a vault deposit.
        </DialogDescription>

        <div className="grid min-h-0 lg:grid-cols-[1fr_1.4fr]">
          <div className="relative border-b border-[#CCCAC4] bg-[#F0EDE8] p-8 lg:border-b-0 lg:border-r lg:p-10">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, rgba(184,145,91,0.42) 1px, transparent 0)`,
                backgroundSize: "24px 24px",
              }}
            />

            <h3 className="mb-8 text-center text-xs font-bold uppercase tracking-[0.2em] text-[#615E4E]">
              Capital Flow
            </h3>

            <div className="relative mx-auto flex max-w-[200px] flex-col items-center gap-3">
              {flowSteps.map((step, index) => {
                const colors = colorMap[step.color as keyof typeof colorMap];
                const Icon = "icon" in step ? step.icon : undefined;
                const logoSrc = "logoSrc" in step ? step.logoSrc : undefined;
                const isLast = index === flowSteps.length - 1;

                return (
                  <div key={step.key} className="relative flex w-full flex-col items-center">
                    <div
                      className={cn(
                        "group relative flex h-[72px] w-full items-center gap-4 rounded-xl border bg-gradient-to-br px-4 transition-all duration-300 hover:scale-[1.02]",
                        colors.border,
                        colors.bg,
                        colors.glow,
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EEE8] ring-1",
                          colors.ring,
                        )}
                      >
                        {logoSrc ? (
                          <Image src={logoSrc} alt={step.label} width={24} height={24} />
                        ) : Icon ? (
                          <Icon className={cn("h-5 w-5", colors.icon)} />
                        ) : null}
                      </div>

                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-[#1A202C]">{step.label}</span>
                        <span className="text-[11px] text-[#615E4E]">{step.sublabel}</span>
                      </div>

                      <div
                        className={cn(
                          "absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full",
                          step.color === "orange" && "bg-orange-400",
                          step.color === "amber" && "bg-amber-400",
                          step.color === "slate" && "bg-[#A09E96]",
                          step.color === "emerald" && "bg-emerald-400",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute inset-0 animate-ping rounded-full opacity-75",
                            step.color === "orange" && "bg-orange-400",
                            step.color === "amber" && "bg-amber-400",
                            step.color === "slate" && "bg-[#A09E96]",
                            step.color === "emerald" && "bg-emerald-400",
                          )}
                        />
                      </div>
                    </div>

                    {!isLast && (
                      <div className="flex h-8 flex-col items-center justify-center">
                        {flowSteps[index + 1]?.bidirectional ? (
                          <div className="flex items-center gap-0.5">
                            <ChevronDown className={cn("h-4 w-4", colors.icon, "opacity-70")} />
                            <ChevronUp className={cn("h-4 w-4", colors.icon, "opacity-70")} />
                          </div>
                        ) : (
                          <>
                            <div
                              className={cn(
                                "h-4 w-px bg-gradient-to-b to-transparent",
                                colors.line,
                              )}
                            />
                            <ChevronDown
                              className={cn("h-4 w-4 -mt-1", colors.icon, "opacity-60")}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-8 lg:p-12">
            <h2 className="mb-10 font-serif text-2xl font-bold tracking-tight text-[#1A202C] lg:text-4xl">
              How Vaults Work
            </h2>

            <div className="space-y-8">
              <div className="group flex gap-5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E8C08C]/25 text-sm font-bold text-[#8A6231] ring-1 ring-[#615E4E]/25">
                  1
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#1A202C]">
                    Deposit and receive shares
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#615E4E]">
                    Your {USER_COLLATERAL_SYMBOL} deposit is converted atomically into vault
                    collateral and mints vault shares, giving you proportional exposure to the
                    vault&apos;s pooled strategy and returns.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#58A65C]/10 text-sm font-bold text-[#2F7A35] ring-1 ring-[#58A65C]/20">
                  2
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#1A202C]">
                    Trading safe executes strategy
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#615E4E]">
                    The trading safe deploys capital under{" "}
                    {vault.profile.strategyLabel?.toLowerCase() || "the defined strategy"} rules
                    with built-in risk controls and active position management.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E8D9C0] text-sm font-bold text-[#615E4E] ring-1 ring-[#CCCAC4]">
                  3
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#1A202C]">
                    Withdraw and claim proceeds
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#615E4E]">
                    Withdrawal requests enter queue processing, then become claimable as{" "}
                    {USER_COLLATERAL_SYMBOL} by default once settlement completes.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
              <p className="text-[12px] leading-relaxed text-[#615E4E]">
                <span className="font-bold text-[#1A202C]">Risk notice:</span> Strategy performance
                varies with market conditions, execution quality, and liquidity. Review the risk
                profile before allocating capital.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TxFeedback({ message, error }: { message: string | null; error: string | null }) {
  if (!message && !error) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-[2px] border px-4 py-3 text-sm leading-6",
        error
          ? "border-rose-400/25 bg-rose-50 text-rose-700"
          : "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]",
      )}
    >
      {error ?? message}
    </div>
  );
}

function DepositRail({
  vault,
  cycle,
  nav,
  migration,
  onSuccess,
  walletConnected,
  sessionKnown,
  userAuthorized,
  vaultId,
}: {
  vault: VaultInstance;
  cycle: Cycle | null;
  nav: VaultStatusResponse["nav"] | null;
  migration: VaultStatusResponse["migration"] | null;
  onSuccess: (result?: DepositSuccessResult) => void;
  walletConnected: boolean;
  sessionKnown: boolean;
  userAuthorized: boolean;
  vaultId: number;
}) {
  const isCustomVault = vault.type === "custom";
  const depositDisplaySymbol = isCustomVault ? USER_COLLATERAL_SYMBOL : COLLATERAL_SYMBOL;
  const depositsDisabled =
    migration?.depositsDisabled ?? vault.migration?.depositsDisabled ?? false;
  const depositDisabledReason = migration?.message ?? vault.migration?.message;
  const {
    amount,
    setAmount,
    handleMaxAmount,
    handleApprove,
    handleDeposit,
    parsedAmount,
    previewShares,
    meetsMinDeposit,
    isValidAmount,
    walletAddress,
    walletBalanceFormatted,
    walletBalanceLoading,
    needsApproval,
    actionPending,
    navSyncPending,
    depositPreflightPending,
    approvePending,
    approveConfirming,
    depositPending,
    depositConfirming,
    queueDepositPending,
    queueDepositConfirming,
    message,
    errorMessage,
    customQueueWindowOpen,
    customQueuePendingClose,
    cycleStateUnavailable,
    hasQueuedDeposit,
    queuedFormatted,
    queuedSharesFormatted,
    depositCreatedAt,
    estimateBasis,
    depositQueueLoading,
  } = useVaultDepositFlow({
    vault,
    vaultId,
    cycle,
    userAuthorized,
    depositsDisabled,
    depositDisabledReason,
    onSuccess,
  });

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <RailStat label="Status" value={getDepositActionLabel(vault, cycle, migration)} />
        <RailStat label="NAV" value={nav ? formatSharePrice(nav.sharePrice) : "--"} />
        <RailStat label="Min deposit" value={formatCurrency(vault.profile.minDeposit)} />
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-[#615E4E]">
            <Image src="/logo/usdc-logo.svg" alt={depositDisplaySymbol} width={16} height={16} />
            Wallet balance
          </span>
          <span className="text-sm font-bold text-[#1A202C]">
            {walletBalanceLoading
              ? "Loading..."
              : `${walletBalanceFormatted} ${depositDisplaySymbol}`}
          </span>
        </div>
      </div>

      {!walletConnected && (
        <p className="text-[11px] text-[#615E4E]" data-testid="vault-deposit-connect-prompt">
          Connect wallet to deposit.
        </p>
      )}

      {depositsDisabled && (
        <div className="rounded-[10px] border border-[#E8C08C]/40 bg-[#E8C08C]/20 p-3 text-[#8A6231]">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1A202C]">
            <AlertCircle className="h-4 w-4 text-[#8A6231]" />
            {migration?.title ?? vault.migration?.title ?? "Deposits paused"}
          </p>
          <p className="mt-1 text-xs leading-6 text-[#8A6231]">
            {depositDisabledReason ??
              "New deposits are paused, but withdrawals, claims, queue status, and activity remain available."}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="vault-deposit-amount"
            className="flex items-center gap-1.5 text-xs font-medium text-[#615E4E]"
          >
            <Image src="/logo/usdc-logo.svg" alt={depositDisplaySymbol} width={14} height={14} />
            Amount
          </label>
          <button
            type="button"
            onClick={handleMaxAmount}
            disabled={depositsDisabled}
            className="-mr-3 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8A6231] transition-colors hover:bg-[#F6F4F3] hover:text-[#1A202C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/50 disabled:cursor-not-allowed disabled:text-[#AD9D84]"
          >
            Max
          </button>
        </div>
        <Input
          id="vault-deposit-amount"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={actionPending || depositsDisabled}
          className="h-10 rounded-lg border border-[#CCCAC4] bg-[#FAF8F5] px-3 font-mono text-sm text-[#1A202C] placeholder:text-[#615E4E]/70 focus-visible:ring-[#615E4E]/30"
        />
      </div>

      {previewShares !== undefined && parsedAmount && parsedAmount > 0n && !isCustomVault && (
        <p className="text-xs text-[#615E4E]">
          Estimated shares: {Number(formatUnits(previewShares, 6)).toFixed(6)}
        </p>
      )}

      {isCustomVault && hasQueuedDeposit && (
        <div className="rounded-[10px] border border-[#E8C08C]/40 bg-[#E8C08C]/20 p-3 text-[#8A6231]">
          <p className="text-sm font-bold text-[#1A202C]">Deposit is queued</p>
          <p className="mt-1 text-xs leading-6 text-[#8A6231]">
            {queuedFormatted} {depositDisplaySymbol} is queued for processing. Shares are minted
            automatically when processing completes. Estimated shares: {queuedSharesFormatted}.
          </p>
          {estimateBasis && (
            <p className="mt-1 text-xs leading-6 text-[#8A6231]">{estimateBasis}</p>
          )}
          {depositCreatedAt && (
            <p className="mt-1 text-xs leading-6 text-[#8A6231]">
              Queued: {formatDate(depositCreatedAt)}
            </p>
          )}
        </div>
      )}

      {depositQueueLoading && <Skeleton className="h-16 w-full rounded-xl bg-[#E8D9C0]" />}

      {(customQueuePendingClose || cycleStateUnavailable) && (
        <p className="text-xs leading-6 text-[#8A6231]">
          {cycleStateUnavailable
            ? "Loading status, please wait…"
            : "Processing, try again shortly."}
        </p>
      )}

      {!meetsMinDeposit && amount.trim() && (
        <p className="text-xs font-medium text-[#8A6231]">
          Minimum deposit is {formatCurrency(vault.profile.minDeposit)}.
        </p>
      )}

      {needsApproval ? (
        <Button
          type="button"
          onClick={handleApprove}
          disabled={
            !walletConnected ||
            !walletAddress ||
            !userAuthorized ||
            !isValidAmount ||
            actionPending ||
            depositsDisabled
          }
          className="h-12 w-full rounded-full border border-[#CCCAC4] bg-[#F1EEE8] font-bold text-[#615E4E] hover:border-[#D4A574] hover:bg-[#E8C08C] hover:text-[#302B2C]"
        >
          {approvePending || approveConfirming
            ? "Approving..."
            : walletConnected && !sessionKnown
              ? "Checking session..."
              : !userAuthorized
                ? "Sign in to approve"
                : depositsDisabled
                  ? "Deposits paused"
                  : `Approve ${depositDisplaySymbol}`}
        </Button>
      ) : (
        <Button
          type="button"
          onClick={() => {
            void handleDeposit();
          }}
          disabled={
            !walletConnected ||
            !walletAddress ||
            !userAuthorized ||
            !isValidAmount ||
            actionPending ||
            depositsDisabled ||
            cycle?.executionMode === "blocked" ||
            cycleStateUnavailable
          }
          className="h-12 w-full rounded-full border border-[#D4A574] bg-[#E8C08C] font-bold text-[#302B2C] hover:bg-[#D4A574]"
        >
          {navSyncPending || depositPreflightPending
            ? "Loading..."
            : depositPending || depositConfirming || queueDepositPending || queueDepositConfirming
              ? customQueueWindowOpen
                ? "Queuing..."
                : "Depositing..."
              : walletConnected && !sessionKnown
                ? "Checking session..."
                : !userAuthorized
                  ? "Sign in to deposit"
                  : cycleStateUnavailable
                    ? "Loading cycle state"
                    : depositsDisabled
                      ? "Deposits paused"
                      : customQueuePendingClose
                        ? "Checking status..."
                        : customQueueWindowOpen
                          ? "Join next cycle"
                          : cycle?.executionMode === "blocked"
                            ? "Deposit blocked"
                            : "Deposit"}
        </Button>
      )}

      <TxFeedback message={message} error={errorMessage} />
    </div>
  );
}

/* unused legacy WithdrawRail removed */

function VaultOverviewSection({
  vault,
  tags,
  displayedHeroMetrics,
  optimisticDeposit,
}: {
  vault: VaultInstance;
  tags: string[];
  displayedHeroMetrics: HeroMetric[];
  optimisticDeposit: OptimisticDepositState | null;
}) {
  const validAssets = getVaultTradingAssets(vault);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] px-6 py-7 shadow-[0_24px_90px_-60px_rgba(26,32,44,0.5)] sm:px-8 lg:px-10 lg:py-9">
      <div className="relative z-20 grid gap-8">
        <div className="min-w-0 space-y-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#615E4E]">Vault</p>

          <div className="space-y-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <h1 className="min-w-0 max-w-3xl break-words font-serif text-5xl font-bold tracking-tight text-[#1A202C] sm:text-6xl">
                {vault.name}
              </h1>
              <HowVaultWorksDialog vault={vault} />
            </div>
            <p className="max-w-3xl text-base leading-8 text-[#615E4E] sm:text-lg">
              {getHeroSentence(vault)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#CCCAC4] bg-[#F6F4F3] px-3 py-1 text-xs font-medium text-[#615E4E]">
              <Image
                src="/logo/usdc-logo.svg"
                alt={USER_COLLATERAL_SYMBOL}
                width={14}
                height={14}
              />
              {USER_COLLATERAL_SYMBOL}
            </span>
            {validAssets.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#CCCAC4] bg-[#F6F4F3] px-3 py-1 text-xs font-medium text-[#615E4E]">
                <AssetLogoStack assets={validAssets} size="xs" />
                <span>{vault.profile.tradingMetadata?.assets?.[0]?.toUpperCase()} Markets</span>
              </span>
            ) : null}
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="rounded-full border-[#CCCAC4] bg-[#F6F4F3] px-3 py-1 text-xs font-medium text-[#615E4E]"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {displayedHeroMetrics.map((metric) => (
            <SummaryMetric
              key={metric.label}
              label={metric.label}
              value={metric.value}
              hint={metric.hint}
              tooltip={metric.tooltip}
            />
          ))}
        </div>
        {optimisticDeposit ? (
          <div className="rounded-xl border border-[#58A65C]/25 bg-[#58A65C]/10 px-4 py-3 text-sm text-[#2F7A35]">
            {optimisticDeposit.mode === "queued"
              ? `${formatCurrency(optimisticDeposit.amount)} deposit queued. It will appear in TVL after processing mints shares.`
              : `${formatCurrency(optimisticDeposit.amount)} deposit confirmed. Dashboard values are refreshing now.`}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function VaultPerformanceSection({
  performance,
  chartPerformance,
  isLoading,
  tradingAnalytics,
  selectedRange,
  onRangeChange,
}: {
  performance: DerivedVaultPerformanceStats;
  chartPerformance: DerivedVaultPerformanceStats;
  isLoading: boolean;
  tradingAnalytics?: VaultTradingAnalytics;
  selectedRange: NavChartRange;
  onRangeChange: (range: NavChartRange) => void;
}) {
  return (
    <SectionShell title="Performance">
      <div className="space-y-5">
        <NavChart
          stats={chartPerformance}
          isLoading={isLoading}
          selectedRange={selectedRange}
          onRangeChange={onRangeChange}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <PerformanceTile
            label="Since inception"
            value={formatPercent(performance.sinceInception)}
            tone={
              performance.sinceInception !== null && performance.sinceInception >= 0
                ? "good"
                : "warning"
            }
            tooltip="Total return since the vault launched."
          />
          <PerformanceTile
            label="30D return"
            value={formatPercent(performance.thirtyDay)}
            tone={performance.thirtyDay !== null && performance.thirtyDay >= 0 ? "good" : "warning"}
            tooltip="Return over the past 30 days."
          />
          <PerformanceTile
            label="Max drawdown"
            value={formatPercent(performance.maxDrawdown)}
            tone="warning"
            tooltip="Largest decline from peak value."
          />
          <PerformanceTile
            label="Win rate"
            value={tradingAnalytics ? `${(tradingAnalytics.winRate * 100).toFixed(1)}%` : "--"}
            tone="neutral"
            tooltip={
              tradingAnalytics
                ? `Based on ${tradingAnalytics.positionCount} settled positions.`
                : "Percentage of winning trades."
            }
          />
        </div>
      </div>
    </SectionShell>
  );
}

function VaultStrategySection({
  vault,
  status,
}: {
  vault: VaultInstance;
  status: VaultStatusResponse | null;
}) {
  const validAssets = getVaultTradingAssets(vault);
  const assetLabel = vault.profile.tradingMetadata?.assets?.[0]?.toUpperCase() || "";
  const platform = vault.profile.tradingMetadata?.platforms?.[0];
  const platformLabel = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "";

  return (
    <SectionShell title="Strategy">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KeyInfoItem label="Managed by" value={getManagementLabel(vault)} />
          <KeyInfoItem label="Focus" value={vault.profile.strategyLabel} />
          {validAssets.length > 0 ? (
            <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">
                Trading on
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <AssetLogoStack assets={validAssets} size="sm" />
                <p className="text-sm font-bold text-[#1A202C]">
                  {assetLabel} on {platformLabel}
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <TechnicalDetailsDialog vault={vault} status={status} />
      </div>
    </SectionShell>
  );
}

function VaultRiskTermsSection({ vault, cycle }: { vault: VaultInstance; cycle: Cycle | null }) {
  return (
    <SectionShell title="Risk & Terms">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryMetric
          label="Risk score"
          value={getRiskScore(vault.profile.riskLevel)}
          hint={`${toTitleCase(vault.profile.riskLevel)} risk mandate.`}
          tooltip="Overall risk level of this vault."
        />
        <SummaryMetric
          label="Liquidity"
          value={getLiquidityLabel(vault, cycle)}
          hint="How you can withdraw."
          tooltip="Withdrawal availability for this vault."
        />
        <SummaryMetric
          label="Fees"
          value={getFeeLabel(vault)}
          hint="Management and performance fee."
          tooltip="Fees charged by this vault."
        />
      </div>
      <div className="mt-5 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-5 text-sm leading-7 text-[#615E4E]">
        {getRiskSummary(vault, cycle)}
      </div>
    </SectionShell>
  );
}

function VaultActivitySection({
  activeTab,
  onActiveTabChange,
  sessionKnown,
  userAuthorized,
  userActivity,
  userActivityOffset,
  userActivityHasMore,
  userHistoryLoading,
  userHistoryError,
  userHistoryUnauthorized,
  vaultActivity,
  vaultActivityOffset,
  vaultActivityHasMore,
  vaultEventsLoading,
  vaultEventsError,
  positions,
  positionHistoryLoading,
  positionHistoryError,
  tradesOffset,
  dispatchUiState,
  routeVaultId,
  userActivityScope,
  activityLastRefresh,
  openPositionCount,
}: {
  activeTab: ActivityTab;
  onActiveTabChange: (value: ActivityTab) => void;
  sessionKnown: boolean;
  userAuthorized: boolean;
  userActivity: ActivityItem[];
  userActivityOffset: number;
  userActivityHasMore: boolean;
  userHistoryLoading: boolean;
  userHistoryError: string | null;
  userHistoryUnauthorized: boolean;
  vaultActivity: ActivityItem[];
  vaultActivityOffset: number;
  vaultActivityHasMore: boolean;
  vaultEventsLoading: boolean;
  vaultEventsError: string | null;
  positions: VaultPositionHistoryResponse["positions"] | undefined;
  positionHistoryLoading: boolean;
  positionHistoryError: string | null;
  tradesOffset: number;
  dispatchUiState: React.Dispatch<VaultDetailUiAction>;
  routeVaultId: number;
  userActivityScope: string;
  activityLastRefresh: Date | null;
  openPositionCount?: number;
}) {
  const visibleTrades = positions?.slice(tradesOffset, tradesOffset + ACTIVITY_PAGE_SIZE) || [];
  const hasMoreTrades = tradesOffset + ACTIVITY_PAGE_SIZE < (positions?.length || 0);

  return (
    <SectionShell title="Activity">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#615E4E]">
        <div className="flex flex-wrap items-center gap-2">
          <span>Recent updates</span>
          <Badge
            variant="outline"
            className="rounded-full border-[#CCCAC4] bg-[#F6F4F3] px-3 py-1 text-[11px] text-[#615E4E]"
          >
            {openPositionCount ?? "--"} open positions
          </Badge>
        </div>
        <span>
          Updated {activityLastRefresh ? formatDate(activityLastRefresh.toISOString()) : "--"}
        </span>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as ActivityTab)}
        className="space-y-3"
      >
        <div className="block sm:hidden">
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">
            Activity view
          </span>
          <Select
            value={activeTab}
            onValueChange={(value) => onActiveTabChange(value as ActivityTab)}
          >
            <SelectTrigger
              aria-label="Activity view"
              className="h-11 w-full rounded-full border-[#CCCAC4] bg-[#F1EEE8] px-3 text-sm font-bold text-[#1A202C] shadow-none focus:ring-[#615E4E]/20 [&>svg]:text-[#615E4E]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="rounded-xl border-[#CCCAC4] bg-[#F1EEE8] text-[#1A202C] shadow-2xl shadow-black/20"
            >
              {ACTIVITY_TAB_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="rounded-lg text-[#615E4E] focus:bg-[#F6F4F3] focus:text-[#1A202C] data-[state=checked]:text-[#8A6231]"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsList className="hidden h-auto w-full rounded-full border border-[#CCCAC4] bg-[#F1EEE8] p-1 sm:grid sm:grid-cols-3">
          {ACTIVITY_TAB_OPTIONS.map((option) => (
            <TabsTrigger
              key={option.value}
              value={option.value}
              className="rounded-full px-3 py-2 text-sm font-bold text-[#615E4E] hover:text-[#1A202C] data-[state=active]:bg-[#E8C08C]/25 data-[state=active]:text-[#1A202C]"
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="user" className="space-y-3">
          {!sessionKnown ? (
            <Skeleton className="h-40 w-full rounded-xl bg-[#E8D9C0]" />
          ) : userAuthorized ? (
            userHistoryLoading ? (
              <Skeleton className="h-40 w-full rounded-xl bg-[#E8D9C0]" />
            ) : userHistoryError ? (
              <div className="rounded-xl border border-rose-400/20 bg-rose-50 p-5 text-sm text-rose-700">
                {userHistoryError}
              </div>
            ) : userHistoryUnauthorized ? (
              <div className="rounded-xl border border-[#E8C08C]/40 bg-[#E8C08C]/20 p-5 text-sm text-[#8A6231]">
                Your account history is temporarily unavailable.
              </div>
            ) : (
              <div className="space-y-3">
                <ActivityTimeline
                  items={userActivity}
                  emptyState="No account activity yet."
                  pageSize={ACTIVITY_PAGE_SIZE}
                />
                <ActivityPaginationControls
                  offset={userActivityOffset}
                  currentCount={userActivity.length}
                  hasMore={userActivityHasMore}
                  isLoading={userHistoryLoading}
                  onPrevious={() =>
                    dispatchUiState({
                      type: "previous-user-activity-page",
                      scope: userActivityScope,
                    })
                  }
                  onNext={() => {
                    if (userActivityHasMore) {
                      dispatchUiState({
                        type: "next-user-activity-page",
                        scope: userActivityScope,
                      });
                    }
                  }}
                />
              </div>
            )
          ) : (
            <div
              className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-5 text-sm text-[#615E4E]"
              data-testid="vault-history-auth-prompt"
            >
              Sign in to view your deposit, withdrawal, and claim history.
            </div>
          )}
        </TabsContent>

        <TabsContent value="vault" className="space-y-3">
          {vaultEventsLoading ? (
            <Skeleton className="h-40 w-full rounded-xl bg-[#E8D9C0]" />
          ) : vaultEventsError ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-50 p-5 text-sm text-rose-700">
              {vaultEventsError}
            </div>
          ) : (
            <div className="space-y-3">
              <ActivityTimeline
                items={vaultActivity}
                emptyState="No meaningful vault updates yet."
                pageSize={ACTIVITY_PAGE_SIZE}
              />
              <ActivityPaginationControls
                offset={vaultActivityOffset}
                currentCount={vaultActivity.length}
                hasMore={vaultActivityHasMore}
                isLoading={vaultEventsLoading}
                onPrevious={() =>
                  dispatchUiState({ type: "previous-vault-activity-page", routeVaultId })
                }
                onNext={() => {
                  if (vaultActivityHasMore) {
                    dispatchUiState({ type: "next-vault-activity-page", routeVaultId });
                  }
                }}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="trades" className="space-y-3">
          {positionHistoryLoading ? (
            <Skeleton className="h-40 w-full rounded-xl bg-[#E8D9C0]" />
          ) : positionHistoryError ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-50 p-5 text-sm text-rose-700">
              {positionHistoryError}
            </div>
          ) : (
            <div className="space-y-3">
              <TradesList
                positions={visibleTrades}
                emptyState="No trades yet."
                pageSize={ACTIVITY_PAGE_SIZE}
              />
              <ActivityPaginationControls
                offset={tradesOffset}
                currentCount={visibleTrades.length}
                hasMore={hasMoreTrades}
                isLoading={positionHistoryLoading}
                onPrevious={() => dispatchUiState({ type: "previous-trades-page" })}
                onNext={() => {
                  if (hasMoreTrades) {
                    dispatchUiState({ type: "next-trades-page" });
                  }
                }}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </SectionShell>
  );
}

function VaultPositionSidebar({
  className,
  activeTab,
  onActiveTabChange,
  vault,
  cycle,
  nav,
  migration,
  walletConnected,
  sessionKnown,
  userAuthorized,
  handleDepositSuccess,
  pendingRequests,
  claimableRequests,
  requestsLoading,
  cycleLoading,
  redemptionUserShares,
  estimatedExitValueUsd,
}: {
  className?: string;
  activeTab: PositionActionTab;
  onActiveTabChange: (value: PositionActionTab) => void;
  vault: VaultInstance;
  cycle: Cycle | null;
  nav: VaultStatusResponse["nav"] | null;
  migration: VaultStatusResponse["migration"] | null;
  walletConnected: boolean;
  sessionKnown: boolean;
  userAuthorized: boolean;
  handleDepositSuccess: (result?: DepositSuccessResult) => void;
  pendingRequests: Parameters<typeof RedemptionPanel>[0]["pendingRequests"];
  claimableRequests: Parameters<typeof RedemptionPanel>[0]["claimableRequests"];
  requestsLoading: boolean;
  cycleLoading: boolean;
  redemptionUserShares: bigint;
  estimatedExitValueUsd: number | null;
}) {
  return (
    <aside
      className={cn("min-w-0 lg:min-h-0 lg:border-l lg:border-[#CCCAC4] lg:pl-6", className)}
      id="manage-position"
    >
      <section className="vault-pane-scroll space-y-4 lg:h-full lg:overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#615E4E]">
              Manage position
            </p>
            <h2 className="mt-1 font-serif text-2xl font-bold tracking-tight text-[#1A202C]">
              Deposit or withdraw
            </h2>
          </div>
          <div className="rounded-full border border-[#CCCAC4] bg-[#E8C08C]/20 p-1.5 text-[#8A6231]">
            <Wallet className="h-3.5 w-3.5" />
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as PositionActionTab)}
          className="space-y-3"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-full border border-[#CCCAC4] bg-[#F1EEE8] p-0.5">
            <TabsTrigger
              value="deposit"
              className="rounded-full py-1.5 text-sm font-bold text-[#615E4E] hover:text-[#1A202C] data-[state=active]:bg-[#E8C08C]/25 data-[state=active]:text-[#1A202C]"
            >
              Deposit
            </TabsTrigger>
            <TabsTrigger
              value="withdraw"
              className="rounded-full py-1.5 text-sm font-bold text-[#615E4E] hover:text-[#1A202C] data-[state=active]:bg-[#E8C08C]/25 data-[state=active]:text-[#1A202C]"
            >
              Withdraw
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deposit">
            <DepositRail
              vault={vault}
              cycle={cycle}
              nav={nav}
              migration={migration}
              walletConnected={walletConnected}
              sessionKnown={sessionKnown}
              userAuthorized={userAuthorized}
              vaultId={vault.id}
              onSuccess={handleDepositSuccess}
            />
          </TabsContent>

          <TabsContent value="withdraw">
            {vault.type === "custom" ? (
              <RedemptionPanel
                vaultId={vault.id}
                vault={vault}
                cycleInfo={cycle}
                pendingRequests={pendingRequests}
                claimableRequests={claimableRequests}
                isLoading={requestsLoading || cycleLoading}
                estimatedExitValueUsd={estimatedExitValueUsd}
                userShares={redemptionUserShares}
              />
            ) : (
              <div className="space-y-4 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4 text-sm leading-7 text-[#615E4E]">
                <div>For this vault, use the Withdraw section below.</div>
                <Button
                  asChild
                  className="w-full rounded-full bg-[#1A202C] text-[#F6F4F3] hover:bg-[#4A4142]"
                >
                  <a href="#exit-queue">Go to Withdraw</a>
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </aside>
  );
}

function VaultPageChrome({
  migration,
  statusError,
  cycleError,
  onRefresh,
}: {
  migration: VaultStatusResponse["migration"] | null;
  statusError: string | null;
  cycleError: string | null;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/discover"
          className="inline-flex items-center gap-2 text-sm font-bold text-[#615E4E] transition-colors hover:text-[#1A202C]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to vaults
        </Link>
      </div>

      {VAULT_NETWORK === "amoy" && (
        <div className="rounded-xl border border-[#E8C08C]/40 bg-[#E8C08C]/20 p-4 text-[#8A6231]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-[#8A6231]" />
            <div>
              <h3 className="text-sm font-bold text-[#1A202C]">Testnet mode: Amoy</h3>
              <p className="mt-1 text-sm leading-7 text-[#615E4E]">
                You are connected to Polygon Amoy Testnet. Vault testing is supported here, but
                Polymarket trading is disabled.
                {!SUPPORTS_POLYMARKET_TRADING &&
                  " Position and trading features remain read-only on testnet."}
              </p>
            </div>
          </div>
        </div>
      )}

      {migration?.enabled && (
        <div className="rounded-xl border border-[#E8C08C]/40 bg-[#E8C08C]/20 p-4 text-[#8A6231]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-[#8A6231]" />
            <div>
              <h3 className="text-sm font-bold text-[#1A202C]">{migration.title}</h3>
              <p className="mt-1 text-sm leading-7 text-[#615E4E]">{migration.message}</p>
            </div>
          </div>
        </div>
      )}

      {(statusError || cycleError) && (
        <Card className="rounded-xl border-rose-400/20 bg-rose-50 text-rose-700 shadow-none">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">{statusError ?? cycleError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="rounded-full border-[#CCCAC4] bg-[#F1EEE8] text-[#615E4E] hover:border-[#D4A574] hover:bg-[#E8C08C] hover:text-[#302B2C]"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function LegacyWithdrawSection({
  vault,
  cycle,
  pendingRequests,
  claimableRequests,
  isLoading,
  estimatedExitValueUsd,
  userShares,
}: {
  vault: VaultInstance;
  cycle: Cycle | null;
  pendingRequests: Parameters<typeof RedemptionPanel>[0]["pendingRequests"];
  claimableRequests: Parameters<typeof RedemptionPanel>[0]["claimableRequests"];
  isLoading: boolean;
  estimatedExitValueUsd: number | null;
  userShares: bigint;
}) {
  if (vault.type === "custom") {
    return null;
  }

  return (
    <SectionShell
      id="exit-queue"
      eyebrow="Withdrawals"
      title="Withdraw"
      description={`Manage your withdrawal requests and claim ${USER_COLLATERAL_SYMBOL}.`}
    >
      <RedemptionPanel
        vaultId={vault.id}
        vault={vault}
        cycleInfo={cycle}
        pendingRequests={pendingRequests}
        claimableRequests={claimableRequests}
        isLoading={isLoading}
        estimatedExitValueUsd={estimatedExitValueUsd}
        userShares={userShares}
      />
    </SectionShell>
  );
}

function VaultNotFound() {
  return (
    <main
      className="polyvaults-app-shell flex-1 px-4 py-10 sm:px-6 lg:px-20 lg:py-12"
      data-testid="vault-not-found"
    >
      <div className="mx-auto max-w-4xl rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] p-10 text-center shadow-[0_24px_90px_-60px_rgba(26,32,44,0.5)]">
        <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#615E4E]">Vault</p>
        <h1 className="mt-4 font-serif text-5xl font-bold tracking-tight text-[#1A202C]">
          Vault not found
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#615E4E]">
          This vault does not exist, or it is not currently available.
        </p>
        <Button
          asChild
          className="mt-6 rounded-full bg-[#1A202C] text-[#F6F4F3] hover:bg-[#4A4142]"
        >
          <Link href="/discover">Back to vaults</Link>
        </Button>
      </div>
    </main>
  );
}

function VaultDetailLoading() {
  return (
    <main
      className="polyvaults-app-shell flex-1 px-4 py-10 sm:px-6 lg:px-20 lg:py-12"
      data-testid="vault-detail-loading"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-10 w-40 rounded-full bg-[#E8D9C0]" />
        <Skeleton className="h-[220px] w-full rounded-2xl bg-[#E8D9C0]" />
        <Skeleton className="h-[540px] w-full rounded-2xl bg-[#E8D9C0]" />
      </div>
    </main>
  );
}

function useE2eConnectedSeam(
  dispatchUiState: React.Dispatch<VaultDetailUiAction>,
  e2eConnectedSeam: boolean,
) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      const value = new URL(window.location.href).searchParams.get("e2eConnected");
      dispatchUiState({ type: "set-e2e-connected-seam", value: value === "1" });
    }
  }, [dispatchUiState]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__E2E_EFFECTIVE_CONNECTED__ = e2eConnectedSeam;
    }
  }, [e2eConnectedSeam]);
}

function useOptimisticDepositExpiry(
  optimisticDeposit: OptimisticDepositState | null,
  dispatchUiState: React.Dispatch<VaultDetailUiAction>,
) {
  useEffect(() => {
    if (!optimisticDeposit) {
      return;
    }

    const timeout = window.setTimeout(() => {
      dispatchUiState({ type: "set-optimistic-deposit", value: null });
    }, 30_000);

    return () => window.clearTimeout(timeout);
  }, [dispatchUiState, optimisticDeposit]);
}

function buildDisplayedHeroMetrics({
  heroMetrics,
  optimisticDeposit,
  freshestNavSnapshot,
}: {
  heroMetrics: HeroMetric[];
  optimisticDeposit: OptimisticDepositState | null;
  freshestNavSnapshot: { trackedTotalAssets?: number; totalAssets: number } | null;
}): HeroMetric[] {
  if (!optimisticDeposit) {
    return heroMetrics;
  }

  return heroMetrics.map((metric) => {
    if (metric.label !== "TVL") {
      return metric;
    }

    if (optimisticDeposit.mode === "queued") {
      return {
        ...metric,
        hint: `${formatCurrency(optimisticDeposit.amount)} queued — syncing deposit status.`,
        tooltip: "Queued deposits are shown separately until the vault processes them into shares.",
      };
    }

    const currentTvl = freshestNavSnapshot?.trackedTotalAssets ?? freshestNavSnapshot?.totalAssets;
    const optimisticTvl =
      currentTvl !== undefined ? currentTvl + optimisticDeposit.amount : optimisticDeposit.amount;

    return {
      ...metric,
      value: formatCompactCurrency(optimisticTvl),
      hint: `Includes ${formatCurrency(optimisticDeposit.amount)} just deposited.`,
      tooltip: "Showing an optimistic TVL while the latest vault snapshot syncs.",
    };
  });
}

interface VaultDetailPageProps {
  routeSegment: string;
  routeVaultId: number;
  bootstrapVault: VaultInstance | null;
  bootstrapResolved: boolean;
}

export default function VaultDetailPage({
  routeSegment,
  routeVaultId,
  bootstrapVault,
  bootstrapResolved,
}: VaultDetailPageProps) {
  const queryClient = useQueryClient();
  const { address, walletConnected, sessionAuthenticated, sessionKnown } = useAuthSession();
  const [activityTab, setActivityTab] = useState<ActivityTab>("user");
  const [positionActionTab, setPositionActionTab] = useState<PositionActionTab>("deposit");
  const [navChartRange, setNavChartRange] = useState<NavChartRange>("1M");
  const userActivityScope = `${routeVaultId}:${address?.toLowerCase() ?? "anonymous"}:${walletConnected ? "connected" : "disconnected"}:${sessionAuthenticated ? "authenticated" : "guest"}`;
  const [uiState, dispatchUiState] = useReducer(vaultDetailUiReducer, undefined, () =>
    createVaultDetailUiState(routeVaultId, userActivityScope),
  );
  const {
    e2eConnectedSeam,
    tradesOffset,
    optimisticDeposit,
    vaultActivityPagination,
    userActivityPagination,
  } = uiState;
  useE2eConnectedSeam(dispatchUiState, e2eConnectedSeam);

  const routeVaultIdInvalid = !Number.isInteger(routeVaultId) || routeVaultId <= 0;
  const vaultActivityOffset =
    vaultActivityPagination.routeVaultId === routeVaultId ? vaultActivityPagination.offset : 0;
  const userActivityOffset =
    userActivityPagination.scope === userActivityScope ? userActivityPagination.offset : 0;

  const userAuthorized = walletConnected && Boolean(address) && sessionAuthenticated;

  const shouldFetchClientInstances = !bootstrapResolved;
  const { data: instancesData } = useVaultInstances({
    enabled: shouldFetchClientInstances,
    refetchIntervalMs: false,
  });
  const queriedVault = instancesData?.instances
    ? routeVaultId > 0
      ? instancesData.instances.find((instance) => instance.id === routeVaultId)
      : resolveVaultFromRouteSegment(routeSegment, instancesData.instances)
    : undefined;
  const vault = queriedVault ?? bootstrapVault ?? undefined;
  const hasClientInstances = Array.isArray(instancesData?.instances);
  const shouldRenderNotFound =
    (routeVaultIdInvalid && hasClientInstances && !queriedVault) ||
    (bootstrapResolved && bootstrapVault === null && !queriedVault) ||
    (hasClientInstances && !queriedVault);
  const effectiveVaultId = vault?.id;
  const shouldLoadUserActivity = activityTab === "user";
  const shouldLoadVaultActivity = activityTab === "vault";
  const shouldLoadTrades = activityTab === "trades";
  const shouldLoadWithdrawData = vault?.type !== "custom" || positionActionTab === "withdraw";
  const { data: status, isLoading: statusLoading, error: statusError } = useVaultStatus(vault?.id);
  const { data: navHistoryData, isLoading: navHistoryLoading } = useVaultNavHistory(
    undefined,
    effectiveVaultId,
  );
  const {
    data: positionHistoryData,
    isLoading: positionHistoryLoading,
    error: positionHistoryError,
    lastRefresh: positionHistoryLastRefresh,
  } = useVaultPositionHistory(shouldLoadTrades ? effectiveVaultId : undefined);
  const { cycle, isLoading: cycleLoading, error: cycleError } = useCycleStatus(vault?.id);
  const {
    pendingRequests,
    claimableRequests,
    isLoading: requestsLoading,
  } = useRequests(shouldLoadWithdrawData ? effectiveVaultId : undefined, userAuthorized);
  const {
    data: vaultEventsData,
    isLoading: vaultEventsLoading,
    error: vaultEventsError,
    lastRefresh: vaultEventsLastRefresh,
  } = useVaultEvents(shouldLoadVaultActivity ? effectiveVaultId : undefined, ACTIVITY_PAGE_SIZE, {
    offset: vaultActivityOffset,
  });
  const { data: tradingAnalyticsData } = useVaultTradingAnalytics(vault?.id);
  const {
    data: userHistoryData,
    isLoading: userHistoryLoading,
    error: userHistoryError,
    isUnauthorized: userHistoryUnauthorized,
    lastRefresh: userHistoryLastRefresh,
  } = useUserVaultHistory(
    shouldLoadUserActivity ? effectiveVaultId : undefined,
    userAuthorized,
    address,
    ACTIVITY_PAGE_SIZE,
    userActivityOffset,
  );
  const { shares: redemptionUserShares } = useVaultShares(
    shouldLoadWithdrawData ? vault?.config.vaultAddress : undefined,
    shouldLoadWithdrawData ? address : undefined,
    vault?.type === "custom" ? 6 : 18,
  );
  const refreshAll = useCallback(async () => {
    await Promise.all([
      invalidatePublicVaultDetailQueries(queryClient, vault?.id),
      invalidateUserVaultDetailQueries(queryClient, vault?.id),
    ]);
  }, [queryClient, vault?.id]);

  const handleDepositSuccess = useCallback(
    (result?: DepositSuccessResult) => {
      if (result?.amount !== undefined && Number.isFinite(result.amount) && result.amount > 0) {
        dispatchUiState({
          type: "set-optimistic-deposit",
          value: {
            amount: result.amount,
            mode: result.mode,
            createdAt: Date.now(),
          },
        });
      }

      void refreshAll();
    },
    [refreshAll],
  );

  useOptimisticDepositExpiry(optimisticDeposit, dispatchUiState);

  const navHistorySnapshots = useMemo(
    () => navHistoryData?.snapshots ?? [],
    [navHistoryData?.snapshots],
  );
  const navChartRangeConfig = getNavChartRangeConfig(navChartRange);
  const performance = useMemo(
    () => deriveVaultPerformanceStats(navHistorySnapshots),
    [navHistorySnapshots],
  );
  const chartPerformance = useMemo(
    () =>
      deriveVaultChartStats(navHistorySnapshots, {
        maxPoints: navChartRangeConfig.maxPoints,
        rangeDays: navChartRangeConfig.rangeDays,
      }),
    [navHistorySnapshots, navChartRangeConfig.maxPoints, navChartRangeConfig.rangeDays],
  );
  const migration = status?.migration ?? vault?.migration ?? null;
  const { freshestNavSnapshot, tags, heroMetrics, vaultActivity, userActivity } = useMemo(
    () =>
      buildVaultDetailReadModel({
        vault,
        cycle,
        statusNav: status?.nav,
        navHistorySnapshots,
        performance,
        vaultEventItems: vaultEventsData?.items ?? [],
        userActivityItems: userHistoryData?.items ?? [],
        formatPercent,
        formatSharePrice,
        formatDate,
        formatCompactCurrency,
        formatCurrency,
      }),
    [
      vault,
      cycle,
      status?.nav,
      navHistorySnapshots,
      performance,
      vaultEventsData?.items,
      userHistoryData?.items,
    ],
  );

  const displayedHeroMetrics = useMemo(() => {
    return buildDisplayedHeroMetrics({
      heroMetrics,
      optimisticDeposit,
      freshestNavSnapshot,
    });
  }, [freshestNavSnapshot, heroMetrics, optimisticDeposit]);

  const vaultActivityHasMore = vaultEventsData?.pagination?.hasMore ?? false;
  const userActivityHasMore = userHistoryData?.pagination?.hasMore ?? false;
  const activityLastRefresh =
    activityTab === "trades"
      ? positionHistoryLastRefresh
      : activityTab === "user"
        ? userHistoryLastRefresh
        : vaultEventsLastRefresh;

  if (shouldRenderNotFound) {
    return <VaultNotFound />;
  }

  if (!vault) {
    return <VaultDetailLoading />;
  }

  return (
    <main className="polyvaults-app-shell vault-pane-scroll relative min-h-0 flex-1 overflow-hidden overflow-y-auto px-4 py-8 text-[#1A202C] sm:px-8 lg:px-20 lg:py-8">
      <div className="relative z-10 mx-auto min-w-0 max-w-7xl lg:h-full lg:min-h-0">
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:h-full lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-8 lg:gap-y-6">
          <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
            <VaultPageChrome
              migration={migration}
              statusError={statusError}
              cycleError={cycleError}
              onRefresh={() => {
                void refreshAll();
              }}
            />

            <VaultOverviewSection
              vault={vault}
              tags={tags}
              displayedHeroMetrics={displayedHeroMetrics}
              optimisticDeposit={optimisticDeposit}
            />
          </div>

          <VaultPositionSidebar
            className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
            activeTab={positionActionTab}
            onActiveTabChange={setPositionActionTab}
            vault={vault}
            cycle={cycle}
            nav={status?.nav ?? null}
            migration={migration}
            walletConnected={walletConnected}
            sessionKnown={sessionKnown}
            userAuthorized={userAuthorized}
            handleDepositSuccess={handleDepositSuccess}
            pendingRequests={pendingRequests}
            claimableRequests={claimableRequests}
            requestsLoading={requestsLoading}
            cycleLoading={cycleLoading}
            redemptionUserShares={redemptionUserShares}
            estimatedExitValueUsd={freshestNavSnapshot?.sharePrice ?? null}
          />

          <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
            <VaultPerformanceSection
              performance={performance}
              chartPerformance={chartPerformance}
              isLoading={navHistoryLoading || statusLoading}
              tradingAnalytics={tradingAnalyticsData?.analytics}
              selectedRange={navChartRange}
              onRangeChange={setNavChartRange}
            />

            <VaultStrategySection vault={vault} status={status ?? null} />

            <VaultRiskTermsSection vault={vault} cycle={cycle} />

            <VaultActivitySection
              activeTab={activityTab}
              onActiveTabChange={setActivityTab}
              sessionKnown={sessionKnown}
              userAuthorized={userAuthorized}
              userActivity={userActivity}
              userActivityOffset={userActivityOffset}
              userActivityHasMore={userActivityHasMore}
              userHistoryLoading={userHistoryLoading}
              userHistoryError={userHistoryError}
              userHistoryUnauthorized={userHistoryUnauthorized}
              vaultActivity={vaultActivity}
              vaultActivityOffset={vaultActivityOffset}
              vaultActivityHasMore={vaultActivityHasMore}
              vaultEventsLoading={vaultEventsLoading}
              vaultEventsError={vaultEventsError}
              positions={positionHistoryData?.positions}
              positionHistoryLoading={positionHistoryLoading}
              positionHistoryError={positionHistoryError}
              tradesOffset={tradesOffset}
              dispatchUiState={dispatchUiState}
              routeVaultId={routeVaultId}
              userActivityScope={userActivityScope}
              activityLastRefresh={activityLastRefresh}
              openPositionCount={cycle?.openPositionCount}
            />

            <LegacyWithdrawSection
              vault={vault}
              cycle={cycle}
              pendingRequests={pendingRequests}
              claimableRequests={claimableRequests}
              isLoading={requestsLoading || cycleLoading}
              estimatedExitValueUsd={freshestNavSnapshot?.sharePrice ?? null}
              userShares={redemptionUserShares}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
