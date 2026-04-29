"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Dot,
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
import { getNetworkDisplayInfo, type NetworkDisplayInfo } from "../../../src/lib/network";
import type {
  Cycle,
  VaultInstance,
  VaultPositionHistoryResponse,
  VaultStatusResponse,
  VaultTradingAnalytics,
} from "../../../src/types";
import { RedemptionPanel } from "./components";
import { AssetLogoStack, type AssetType } from "../../../components/asset-logo";
import { buildVaultDetailReadModel, type ActivityItem, type HeroMetric } from "./vaultDetailReadModel";

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

function createVaultDetailUiState(routeVaultId: number, userActivityScope: string): VaultDetailUiState {
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

const NAV_CHART_RANGES = [
  {
    value: "1M",
    label: "1M",
    rangeDays: 30,
    maxPoints: 80,
    smooth: false,
    description: "Last 30 days",
  },
  {
    value: "3M",
    label: "3M",
    rangeDays: 90,
    maxPoints: 96,
    smooth: false,
    description: "Last 3 months",
  },
  {
    value: "6M",
    label: "6M",
    rangeDays: 183,
    maxPoints: 120,
    smooth: true,
    description: "Last 6 months",
  },
  {
    value: "1Y",
    label: "1Y",
    rangeDays: 365,
    maxPoints: 140,
    smooth: true,
    description: "Last year",
  },
  {
    value: "ALL",
    label: "All",
    rangeDays: undefined,
    maxPoints: 160,
    smooth: true,
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
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/5 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
        >
          <AlertCircle className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={8}
        className="max-w-xs rounded-[2px] border-white/10 bg-slate-950 px-3 py-2 text-slate-100 shadow-2xl"
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
      className="min-w-0 overflow-hidden rounded-[2px] border border-[#212121] bg-[#121212] shadow-none"
    >
      <CardHeader className="border-b border-white/10 pb-5">
        {eyebrow ? (
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-200/80">
            {eyebrow}
          </p>
        ) : null}
        <CardTitle className="text-2xl tracking-tight text-white">{title}</CardTitle>
        {description ? (
          <CardDescription className="max-w-2xl text-sm leading-6 text-slate-400">
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
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4">
      <div className="flex items-center gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs leading-6 text-slate-400">{hint}</p>
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
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4">
      <div className="flex items-center gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-xl font-semibold tracking-tight",
          tone === "good" && "text-emerald-200",
          tone === "warning" && "text-amber-200",
          tone === "neutral" && "text-white",
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
    return <Skeleton className="h-[320px] w-full rounded-[2px] bg-white/10" />;
  }

  if (stats.points.length < 2) {
    return (
      <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-6 text-sm text-[#828B8D]">
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
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">NAV chart</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
            {stats.latest !== null ? formatSharePrice(stats.latest) : "--"}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div
            className="inline-flex w-fit rounded-[2px] border border-[#212121] bg-[#121212] p-1"
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
                  "rounded-[2px] px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50",
                  selectedRange === option.value
                    ? "bg-cyan-300/12 text-cyan-100 ring-1 ring-inset ring-cyan-300/20"
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-200",
                )}
                aria-pressed={selectedRange === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2 sm:text-right">
            <div>Start: {stats.first !== null ? formatSharePrice(stats.first) : "--"}</div>
            <div>
              Latest snapshot: {formatDate(stats.points[stats.points.length - 1]?.timestamp ?? null)}
            </div>
            <div className="sm:col-span-2 text-slate-500">
              {rangeConfig.description}
              {rangeConfig.smooth ? " · smoothed" : ""}
            </div>
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
              <stop offset="0%" stopColor="rgba(103,232,249,0.95)" />
              <stop offset="100%" stopColor="rgba(125,211,252,0.95)" />
            </linearGradient>
            <linearGradient id="vault-area" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(103,232,249,0.28)" />
              <stop offset="100%" stopColor="rgba(103,232,249,0.01)" />
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
                stroke="rgba(148,163,184,0.38)"
                strokeDasharray="5 5"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r="6"
                fill="#0A0A0A"
                stroke="rgba(125,211,252,0.95)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ) : null}
        </svg>
        {hoveredPoint ? (
          <div
            className="pointer-events-none absolute top-3 w-max min-w-0 max-w-[calc(100vw-3rem)] rounded-[2px] border border-white/10 bg-[#121212]/95 px-3 py-2 text-xs shadow-2xl shadow-black/40 backdrop-blur"
            style={{
              left: `${Math.min(Math.max((hoveredPoint.x / width) * 100, 8), 92)}%`,
              transform: (hoveredPoint.x / width) > 0.75 ? "translateX(-100%)" : "translateX(-8%)",
            }}
          >
            <p className="font-medium text-white">{formatSharePrice(hoveredPoint.value)}</p>
            <p className="mt-1 text-slate-400">{formatDate(hoveredPoint.timestamp)}</p>
            <p className="mt-1 text-slate-500">
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
      <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-5 text-sm text-[#828B8D]">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="min-h-[92px] rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    item.tone === "good" && "bg-emerald-300",
                    item.tone === "warning" && "bg-amber-300",
                    item.tone === "neutral" && "bg-cyan-300",
                  )}
                />
                <p className="text-sm font-medium text-white">{item.title}</p>
              </div>
              <p className="text-sm leading-6 text-slate-400">{item.detail}</p>
            </div>
            <p className="whitespace-nowrap text-xs font-medium text-slate-500 mt-0.5">
              {formatDate(item.timestamp)}
            </p>
          </div>
        </div>
      ))}

      {Array.from({ length: Math.max(pageSize - items.length, 0) }).map((_, index) => (
        <div
          key={`activity-placeholder-${index}`}
          className="invisible min-h-[92px] rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4"
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
    <div className="flex flex-col gap-3 rounded-[2px] border border-[#212121] bg-[#0A0A0A] px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <span>{currentCount > 0 ? `Showing ${start}-${end}` : "No activity on this page"}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={offset === 0 || isLoading}
          className="h-8 rounded-[2px] border-[#656565]/40 bg-transparent px-3 text-xs text-white hover:bg-[#212121] disabled:opacity-40"
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!hasMore || isLoading}
          className="h-8 rounded-[2px] border-[#656565]/40 bg-transparent px-3 text-xs text-white hover:bg-[#212121] disabled:opacity-40"
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
      <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-5 text-sm text-[#828B8D]">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] overflow-hidden">
      {positions.map((pos) => {
        const isClosed = pos.status === "closed";
        const pnl = pos.realizedPnl ?? pos.cashPnl ?? 0;
        const isWin = pnl >= 0;
        const pnlFormatted = `${isWin ? "+" : ""}${formatCurrency(pnl)}`;

        return (
          <div
            key={`${pos.tokenId}-${pos.conditionId}-${pos.outcome}-${pos.endDate}`}
            className="group flex flex-col gap-3 border-b border-[#212121] p-4 transition-colors hover:bg-[#121212] last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-1 flex-col min-w-0 pr-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-[2px] bg-white/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    pos.outcome === "Yes"
                      ? "text-emerald-400"
                      : pos.outcome === "No"
                        ? "text-rose-400"
                        : "text-cyan-400",
                  )}
                >
                  {pos.outcome}
                </span>
                <span className="whitespace-nowrap text-xs font-medium text-slate-500">
                  {formatDate(pos.endDate)}
                </span>
                {!isClosed && (
                  <span className="rounded-[2px] bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                    Open
                  </span>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="cursor-default truncate text-sm font-medium text-white transition-colors group-hover:text-cyan-50">
                    {pos.title}
                  </p>
                </TooltipTrigger>
                <TooltipContent
                  sideOffset={8}
                  className="max-w-[320px] rounded-xl bg-slate-950 px-3 py-2 text-slate-100 shadow-2xl"
                >
                  <p className="text-sm font-medium leading-relaxed">{pos.title}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex flex-wrap gap-4 sm:shrink-0 sm:flex-nowrap sm:items-center sm:gap-8">
              <div className="flex flex-col text-left sm:text-right">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Invested
                </span>
                <span className="font-mono text-sm text-white">
                  {Number.isFinite(pos.size) && Number.isFinite(pos.avgPrice)
                    ? formatCurrency(pos.size * pos.avgPrice)
                    : "--"}
                </span>
                {Number.isFinite(pos.size) && (
                  <span className="mt-0.5 font-mono text-[9px] text-slate-500">
                    {pos.size.toFixed(2)} shares
                  </span>
                )}
              </div>
              <div className="flex flex-col text-left sm:text-right">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Avg Price
                </span>
                <span className="font-mono text-sm text-white">
                  {Number.isFinite(pos.avgPrice) ? `$${pos.avgPrice.toFixed(2)}` : "--"}
                </span>
              </div>
              <div className="flex flex-col text-left sm:text-right">
                {!isClosed ? (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">
                      Value
                    </span>
                    <span className="font-mono text-sm font-medium text-white">
                      {typeof pos.currentValue === "number"
                        ? formatCurrency(pos.currentValue)
                        : "--"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">
                      Return
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold",
                        isWin ? "text-emerald-400" : "text-slate-400",
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
          className="invisible min-h-[96px] border-b border-[#212121] last:border-b-0"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function RailStat({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[2px] border border-[#212121] bg-[#0A0A0A] px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-slate-400">
        {label}
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </span>
      <span className="text-sm font-medium text-white">{value}</span>
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
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-3">
      <div className="flex items-center gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
        {tooltip ? <InfoTooltip label={label} content={tooltip} /> : null}
      </div>
      <p className="mt-1.5 text-sm font-medium text-white">{value}</p>
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
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
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
              className="rounded-[2px] border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300 transition-colors hover:border-cyan-300/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </TooltipTrigger>
          <TooltipContent
            sideOffset={8}
            className="max-w-sm rounded-[4px] bg-[#212121] px-3 py-2 text-xs text-white shadow-xl"
          >
            Click to copy full address
          </TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="mt-3 block min-h-8 rounded-[2px] py-1 text-left font-mono text-sm text-white transition-colors hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
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
          className="max-w-sm rounded-[4px] bg-[#212121] px-3 py-2 font-mono text-xs text-white shadow-xl"
        >
          {address}
        </TooltipContent>
      </Tooltip>

      {balance !== undefined && (
        <div className="mt-4 flex flex-col items-start gap-1 border-t border-[#212121] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
            {balanceLabel}
          </span>
          <span className="font-mono text-sm font-medium text-white">{balance}</span>
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
  const tradingWalletCollateral = status
    ? (status.nav.safeCollateral ?? 0) + (status.nav.redeemableMarketValue ?? 0)
    : null;
  const vaultCollateral = status ? (status.nav.vaultCollateral ?? 0) : null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="rounded-[10px] border border-[#656565]/40 bg-[#121212] text-white hover:bg-[#212121]"
        >
          Addresses
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl rounded-[2px] border border-[#212121] bg-[#0A0A0A] text-white shadow-none">
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight text-white">Addresses</DialogTitle>
          <DialogDescription className="text-sm leading-6 text-slate-400">
            Contract addresses and wallet balances.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <AddressField
            label="Operator safe"
            address={vault.config.safeAddress}
            balanceLabel="Trading Wallet Balance"
            balance={tradingWalletCollateral !== null ? formatCurrency(tradingWalletCollateral) : "--"}
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
      bg: "from-slate-500/15 to-slate-600/5",
      border: "border-slate-400/30",
      glow: "shadow-[0_0_20px_rgba(148,163,184,0.1)]",
      icon: "text-slate-400",
      ring: "ring-slate-400/30",
      line: "from-slate-400",
    },
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 self-start items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] bg-[#121212] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 ring-1 ring-inset ring-[#212121] transition-all hover:bg-[#212121] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span>How Vaults Work</span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[min(1120px,96vw)] !max-w-none overflow-hidden rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-0 text-white shadow-[0_35px_120px_-45px_rgba(0,0,0,0.95)] max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">How Vaults Work Flowchart</DialogTitle>
        <DialogDescription className="sr-only">
          Explains the lifecycle of a vault deposit.
        </DialogDescription>

        <div className="grid lg:grid-cols-[1fr_1.4fr]">
          <div className="relative border-b border-[#212121] bg-[#0A0A0A] p-8 lg:border-b-0 lg:border-r lg:p-10">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
                backgroundSize: "24px 24px",
              }}
            />

            <h3 className="mb-8 text-center text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
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
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] bg-[#121212] ring-1",
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
                        <span className="text-sm font-semibold text-white">{step.label}</span>
                        <span className="text-[11px] text-slate-500">{step.sublabel}</span>
                      </div>

                      <div
                        className={cn(
                          "absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full",
                          step.color === "orange" && "bg-orange-400",
                          step.color === "amber" && "bg-amber-400",
                          step.color === "slate" && "bg-slate-400",
                          step.color === "emerald" && "bg-emerald-400",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute inset-0 animate-ping rounded-full opacity-75",
                            step.color === "orange" && "bg-orange-400",
                            step.color === "amber" && "bg-amber-400",
                            step.color === "slate" && "bg-slate-400",
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
            <h2 className="mb-10 text-xl font-medium tracking-tight text-white lg:text-3xl">
              How Vaults Work
            </h2>

            <div className="space-y-8">
              <div className="group flex gap-5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] bg-orange-500/10 text-sm font-bold text-orange-400 ring-1 ring-orange-500/20">
                  1
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">
                    Deposit and receive shares
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#828B8D]">
                    Your {USER_COLLATERAL_SYMBOL} deposit is converted atomically into vault
                    collateral and mints vault shares, giving you proportional exposure to the
                    vault&apos;s pooled strategy and returns.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] bg-emerald-500/10 text-sm font-bold text-emerald-400 ring-1 ring-emerald-500/20">
                  2
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">
                    Trading safe executes strategy
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#828B8D]">
                    The trading safe deploys capital under{" "}
                    {vault.profile.strategyLabel?.toLowerCase() || "the defined strategy"} rules
                    with built-in risk controls and active position management.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] bg-slate-500/10 text-sm font-bold text-slate-400 ring-1 ring-slate-500/20">
                  3
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">
                    Withdraw and claim proceeds
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#828B8D]">
                    Withdrawal requests enter queue processing, then become claimable as{" "}
                    {USER_COLLATERAL_SYMBOL} by default once settlement completes.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 rounded-[2px] border border-[#212121] bg-[#121212] p-4">
              <p className="text-[12px] leading-relaxed text-[#828B8D]">
                <span className="font-semibold text-white">Risk notice:</span> Strategy performance
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
          ? "border-rose-400/25 bg-rose-400/10 text-rose-100"
          : "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
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
  const depositsDisabled = migration?.depositsDisabled ?? vault.migration?.depositsDisabled ?? false;
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
        <div className="flex items-center justify-between gap-3 rounded-[2px] border border-[#212121] bg-[#0A0A0A] px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-slate-400">
            <Image src="/logo/usdc-logo.svg" alt={depositDisplaySymbol} width={16} height={16} />
            Wallet balance
          </span>
          <span className="text-sm font-medium text-white">
            {walletBalanceLoading ? "Loading..." : `${walletBalanceFormatted} ${depositDisplaySymbol}`}
          </span>
        </div>
      </div>

      {!walletConnected && (
        <p className="text-[11px] text-slate-400" data-testid="vault-deposit-connect-prompt">
          Connect wallet to deposit.
        </p>
      )}

      {depositsDisabled && (
        <div className="rounded-[10px] border border-amber-400/20 bg-amber-400/10 p-3 text-amber-50">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="h-4 w-4 text-amber-200" />
            {migration?.title ?? vault.migration?.title ?? "Deposits paused"}
          </p>
          <p className="mt-1 text-xs leading-6 text-amber-50/90">
            {depositDisabledReason ??
              "New deposits are paused, but withdrawals, claims, queue status, and activity remain available."}
          </p>
        </div>
      )}

      <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="vault-deposit-amount"
            className="flex items-center gap-1.5 text-xs text-slate-400"
          >
            <Image src="/logo/usdc-logo.svg" alt={depositDisplaySymbol} width={14} height={14} />
            Amount
          </label>
          <button
            type="button"
            onClick={handleMaxAmount}
            disabled={depositsDisabled}
            className="-mr-3 rounded-[2px] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-200 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 disabled:cursor-not-allowed disabled:text-slate-600"
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
          className="h-10 rounded-[2px] border border-[#212121] bg-transparent px-3 font-mono text-sm text-white placeholder:text-slate-500"
        />
      </div>

      {previewShares !== undefined && parsedAmount && parsedAmount > 0n && !isCustomVault && (
        <p className="text-xs text-slate-400">
          Estimated shares: {Number(formatUnits(previewShares, 6)).toFixed(6)}
        </p>
      )}

      {isCustomVault && hasQueuedDeposit && (
        <div className="rounded-[10px] border border-amber-400/20 bg-amber-400/10 p-3 text-amber-50">
          <p className="text-sm font-medium">Deposit is queued</p>
          <p className="mt-1 text-xs leading-6 text-amber-50/90">
            {queuedFormatted} {depositDisplaySymbol} is queued for processing. Shares are minted
            automatically when processing completes. Estimated shares: {queuedSharesFormatted}.
          </p>
          {estimateBasis && (
            <p className="mt-1 text-xs leading-6 text-amber-50/90">{estimateBasis}</p>
          )}
          {depositCreatedAt && (
            <p className="mt-1 text-xs leading-6 text-amber-50/90">
              Queued: {formatDate(depositCreatedAt)}
            </p>
          )}
        </div>
      )}

      {depositQueueLoading && <Skeleton className="h-16 w-full bg-white/10" />}

      {(customQueuePendingClose || cycleStateUnavailable) && (
        <p className="text-xs leading-6 text-amber-200/90">
          {cycleStateUnavailable
            ? "Loading status, please wait…"
            : "Processing, try again shortly."}
        </p>
      )}

      {!meetsMinDeposit && amount.trim() && (
        <p className="text-xs text-amber-200">
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
          className="h-12 w-full rounded-[10px] bg-white text-black hover:bg-white/90"
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
          className="h-12 w-full rounded-[10px] bg-white text-black hover:bg-white/90"
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
    <section className="relative overflow-hidden rounded-[2px] border border-[#212121] bg-[#121212] px-6 py-7 shadow-none sm:px-8 lg:px-10 lg:py-9">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,_rgba(217,70,239,0.07),_transparent_18%),radial-gradient(circle_at_86%_16%,_rgba(34,211,238,0.06),_transparent_16%)]" />
      <div className="relative grid gap-8">
        <div className="min-w-0 space-y-5">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Vault</p>

          <div className="space-y-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <h1 className="min-w-0 max-w-3xl break-words text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                {vault.name}
              </h1>
              <HowVaultWorksDialog vault={vault} />
            </div>
            <p className="max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
              {getHeroSentence(vault)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-200">
              <Image src="/logo/usdc-logo.svg" alt={USER_COLLATERAL_SYMBOL} width={14} height={14} />
              {USER_COLLATERAL_SYMBOL}
            </span>
            {validAssets.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-200">
                <AssetLogoStack assets={validAssets} size="xs" />
                <span>{vault.profile.tradingMetadata?.assets?.[0]?.toUpperCase()} Markets</span>
              </span>
            ) : null}
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="rounded-full border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-200"
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
          <div className="rounded-[2px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50">
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

function VaultStrategySection({ vault, status }: { vault: VaultInstance; status: VaultStatusResponse | null }) {
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
            <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Trading on</p>
              <div className="mt-1.5 flex items-center gap-2">
                <AssetLogoStack assets={validAssets} size="sm" />
                <p className="text-sm font-medium text-white">
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
      <div className="mt-5 rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-5 text-sm leading-7 text-slate-400">
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span>Recent updates</span>
          <Badge
            variant="outline"
            className="rounded-full border-white/10 bg-white/6 px-3 py-1 text-[11px] text-slate-200"
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
          <span className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Activity view
          </span>
          <Select
            value={activeTab}
            onValueChange={(value) => onActiveTabChange(value as ActivityTab)}
          >
            <SelectTrigger
              aria-label="Activity view"
              className="h-11 w-full rounded-[2px] border-[#212121] bg-[#0A0A0A] px-3 text-sm font-medium text-white shadow-none focus:ring-cyan-300/20 [&>svg]:text-slate-500"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="rounded-[2px] border-[#212121] bg-[#0A0A0A] text-white shadow-2xl shadow-black/40"
            >
              {ACTIVITY_TAB_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="rounded-[2px] text-slate-300 focus:bg-[#212121] focus:text-white data-[state=checked]:text-cyan-100"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsList className="hidden h-auto w-full rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-1 sm:grid sm:grid-cols-3">
          {ACTIVITY_TAB_OPTIONS.map((option) => (
            <TabsTrigger
              key={option.value}
              value={option.value}
              className="rounded-[2px] px-3 py-2 text-sm text-slate-400 hover:text-white data-[state=active]:border-b data-[state=active]:border-[#656565]/40 data-[state=active]:bg-[#212121] data-[state=active]:text-white"
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="user" className="space-y-3">
          {!sessionKnown ? (
            <Skeleton className="h-40 w-full rounded-[2px] bg-white/10" />
          ) : userAuthorized ? (
            userHistoryLoading ? (
              <Skeleton className="h-40 w-full rounded-[2px] bg-white/10" />
            ) : userHistoryError ? (
              <div className="rounded-[2px] border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-100">
                {userHistoryError}
              </div>
            ) : userHistoryUnauthorized ? (
              <div className="rounded-[2px] border border-amber-400/20 bg-amber-400/10 p-5 text-sm text-amber-50">
                Your account history is temporarily unavailable.
              </div>
            ) : (
              <div className="space-y-3">
                <ActivityTimeline items={userActivity} emptyState="No account activity yet." pageSize={ACTIVITY_PAGE_SIZE} />
                <ActivityPaginationControls
                  offset={userActivityOffset}
                  currentCount={userActivity.length}
                  hasMore={userActivityHasMore}
                  isLoading={userHistoryLoading}
                  onPrevious={() => dispatchUiState({ type: "previous-user-activity-page", scope: userActivityScope })}
                  onNext={() => {
                    if (userActivityHasMore) {
                      dispatchUiState({ type: "next-user-activity-page", scope: userActivityScope });
                    }
                  }}
                />
              </div>
            )
          ) : (
            <div
              className="rounded-[2px] border border-white/10 bg-slate-950/30 p-5 text-sm text-slate-400"
              data-testid="vault-history-auth-prompt"
            >
              Sign in to view your deposit, withdrawal, and claim history.
            </div>
          )}
        </TabsContent>

        <TabsContent value="vault" className="space-y-3">
          {vaultEventsLoading ? (
            <Skeleton className="h-40 w-full rounded-[2px] bg-white/10" />
          ) : vaultEventsError ? (
            <div className="rounded-[2px] border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-100">
              {vaultEventsError}
            </div>
          ) : (
            <div className="space-y-3">
              <ActivityTimeline items={vaultActivity} emptyState="No meaningful vault updates yet." pageSize={ACTIVITY_PAGE_SIZE} />
              <ActivityPaginationControls
                offset={vaultActivityOffset}
                currentCount={vaultActivity.length}
                hasMore={vaultActivityHasMore}
                isLoading={vaultEventsLoading}
                onPrevious={() => dispatchUiState({ type: "previous-vault-activity-page", routeVaultId })}
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
            <Skeleton className="h-40 w-full rounded-[2px] bg-white/10" />
          ) : positionHistoryError ? (
            <div className="rounded-[2px] border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-100">
              {positionHistoryError}
            </div>
          ) : (
            <div className="space-y-3">
              <TradesList positions={visibleTrades} emptyState="No trades yet." pageSize={ACTIVITY_PAGE_SIZE} />
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
    <aside className={cn("min-w-0 lg:min-h-0 lg:border-l lg:border-white/10 lg:pl-6", className)} id="manage-position">
      <section className="vault-pane-scroll space-y-4 lg:h-full lg:overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Manage position</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">Deposit or withdraw</h2>
          </div>
          <div className="rounded-full border border-cyan-300/15 bg-cyan-300/10 p-1.5 text-cyan-200">
            <Wallet className="h-3.5 w-3.5" />
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as PositionActionTab)}
          className="space-y-3"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-0.5">
            <TabsTrigger value="deposit" className="rounded-[2px] py-1.5 text-sm text-slate-400 hover:text-white data-[state=active]:border data-[state=active]:border-[#656565]/40 data-[state=active]:bg-[#212121] data-[state=active]:text-white">
              Deposit
            </TabsTrigger>
            <TabsTrigger value="withdraw" className="rounded-[2px] py-1.5 text-sm text-slate-400 hover:text-white data-[state=active]:border data-[state=active]:border-[#656565]/40 data-[state=active]:bg-[#212121] data-[state=active]:text-white">
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
              <div className="space-y-4 rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4 text-sm leading-7 text-slate-300">
                <div>For this vault, use the Withdraw section below.</div>
                <Button asChild className="w-full rounded-[2px] bg-white text-slate-950 hover:bg-slate-100">
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
  networkInfo,
  migration,
  statusError,
  cycleError,
  onRefresh,
}: {
  networkInfo: NetworkDisplayInfo;
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
          className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to vaults
        </Link>
        {!networkInfo.isTestnet ? (
          <Badge
            variant="outline"
            className="gap-2 border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-emerald-200"
          >
            <Dot className="h-5 w-5" />
            {networkInfo.name}
          </Badge>
        ) : null}
      </div>

      {VAULT_NETWORK === "amoy" && (
        <div className="rounded-[2px] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-200" />
            <div>
              <h3 className="text-sm font-medium text-amber-100">Testnet mode: Amoy</h3>
              <p className="mt-1 text-sm leading-7 text-amber-50/85">
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
        <div className="rounded-[2px] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-200" />
            <div>
              <h3 className="text-sm font-medium text-amber-100">{migration.title}</h3>
              <p className="mt-1 text-sm leading-7 text-amber-50/85">{migration.message}</p>
            </div>
          </div>
        </div>
      )}

      {(statusError || cycleError) && (
        <Card className="rounded-[2px] border-rose-400/20 bg-rose-400/10 text-rose-50 shadow-none">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">{statusError ?? cycleError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
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
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-10 lg:py-12" data-testid="vault-not-found">
      <div className="mx-auto max-w-4xl rounded-[2px] border border-[#212121] bg-[#121212] p-10 text-center shadow-none">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Vault</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Vault not found</h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-400">
          This vault does not exist, or it is not currently available.
        </p>
        <Button asChild className="mt-6 rounded-[10px] bg-white text-black hover:bg-white/90">
          <Link href="/discover">Back to vaults</Link>
        </Button>
      </div>
    </main>
  );
}

function VaultDetailLoading() {
  return (
    <main
      className="flex-1 px-4 py-10 sm:px-6 lg:px-10 lg:py-12"
      data-testid="vault-detail-loading"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-10 w-40 bg-white/10" />
        <Skeleton className="h-[220px] w-full rounded-[2px] bg-[#212121]" />
        <Skeleton className="h-[540px] w-full rounded-[2px] bg-[#212121]" />
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
  const {
    data: navHistoryData,
    isLoading: navHistoryLoading,
  } = useVaultNavHistory(undefined, effectiveVaultId);
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

  const navHistorySnapshots = useMemo(() => navHistoryData?.snapshots ?? [], [navHistoryData?.snapshots]);
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
        smooth: navChartRangeConfig.smooth,
      }),
    [navHistorySnapshots, navChartRangeConfig.maxPoints, navChartRangeConfig.rangeDays, navChartRangeConfig.smooth],
  );
  const networkInfo = getNetworkDisplayInfo(VAULT_NETWORK);
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
    <main className="vault-pane-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-6 sm:px-6 lg:overflow-hidden lg:px-10 lg:py-6">
      <div className="mx-auto min-w-0 max-w-7xl lg:h-full lg:min-h-0">
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:h-full lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-8 lg:gap-y-6">
          <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
            <VaultPageChrome
              networkInfo={networkInfo}
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
