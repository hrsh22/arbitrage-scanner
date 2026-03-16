"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatUnits, parseUnits } from "viem";
import { useAppKitAccount } from "@reown/appkit/react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Dot, Wallet } from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  preflightWithdrawal,
  useCycleStatus,
  useDepositQueue,
  usePreviewDeposit,
  usePreviewRedeem,
  useQueueDeposit,
  useRequests,
  useUsdcAllowance,
  useUsdcApprove,
  useVaultDeposit,
  useVaultInstances,
  useVaultNavHistory,
  useVaultRedeem,
  useVaultShares,
  useVaultStatus,
  useWalletBalance,
  useWithdrawalQueue,
  invalidateVaultQueries,
} from "../../../src/lib/hooks";
import {
  fetchAuthMe,
  postCancelWithdrawalRequest,
  postCompleteWithdrawalRequest,
  postPrepareWithdrawalRequest,
  postVaultNavUpdate,
  postWithdrawalRequest,
} from "../../../src/lib/api";
import { SUPPORTS_POLYMARKET_TRADING, VAULT_NETWORK } from "../../../src/constants";
import { getNetworkDisplayInfo } from "../../../src/lib/network";
import type {
  Cycle,
  RedemptionRequest,
  VaultInstance,
  VaultNavHistoryItem,
  VaultStatusResponse,
} from "../../../src/types";
import { RedemptionPanel } from "./components";

declare global {
  interface Window {
    __E2E_EFFECTIVE_CONNECTED__?: boolean;
  }
}

interface PerformanceStats {
  sinceInception: number | null;
  annualized: number | null;
  thirtyDay: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  daysCovered: number;
  first: number | null;
  latest: number | null;
  points: Array<{ timestamp: string; value: number }>;
}

interface ActivityItem {
  title: string;
  detail: string;
  timestamp: string | null;
  tone: "neutral" | "good" | "warning";
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
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  const percentage = value * 100;
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

function truncateId(value: string, length = 10): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length)}...`;
}

function getParsedUnits(value: string, decimals: number): bigint | undefined {
  if (!value.trim()) {
    return undefined;
  }

  try {
    return parseUnits(value, decimals);
  } catch {
    return undefined;
  }
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

function getDepositStatusLabel(vault: VaultInstance, cycle: Cycle | null): string {
  if (!vault.enabled) {
    return "Paused";
  }

  if (cycle?.executionMode === "blocked") {
    return "Paused";
  }

  return "Open";
}

function getCycleNote(
  vault: VaultInstance,
  cycle: Cycle | null,
): { label: string; detail: string } | null {
  if (!cycle) {
    return null;
  }

  if (!vault.enabled || cycle.executionMode === "blocked") {
    return {
      label: "Blocked",
      detail: "New actions unavailable.",
    };
  }

  if (cycle.batchState === "open" && cycle.executionMode === "instant") {
    return {
      label: "Open",
      detail: "Direct actions enabled.",
    };
  }

  if (
    cycle.batchState === "open" ||
    cycle.batchState === "closed" ||
    cycle.batchState === "cutoff"
  ) {
    return {
      label: "Queue only",
      detail: "Requests enter queue.",
    };
  }

  if (cycle.batchState === "flattening" || cycle.batchState === "settling") {
    return {
      label: "Processing",
      detail: "Queued requests processing.",
    };
  }

  return {
    label: "Cycle active",
    detail: "Lifecycle state available.",
  };
}

function derivePerformanceStats(snapshots: VaultNavHistoryItem[]): PerformanceStats {
  const points = [...snapshots]
    .map((snapshot) => ({
      timestamp: snapshot.timestamp,
      value: Number.parseFloat(snapshot.sharePrice),
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (points.length === 0) {
    return {
      sinceInception: null,
      annualized: null,
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
  const annualized =
    sinceInception !== null && days >= 30
      ? Math.pow((latest ?? 1) / (first ?? 1), 365 / days) - 1
      : null;

  const cutoff = latestTimestamp - 30 * 24 * 60 * 60 * 1000;
  const baseThirtyDay = [...points]
    .reverse()
    .find((point) => new Date(point.timestamp).getTime() <= cutoff);
  const thirtyDay =
    latest !== null && baseThirtyDay && baseThirtyDay.value > 0
      ? latest / baseThirtyDay.value - 1
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
    sinceInception,
    annualized,
    thirtyDay,
    maxDrawdown,
    winRate: null,
    daysCovered: days,
    first,
    latest,
    points,
  };
}

function buildVaultActivity(
  vault: VaultInstance,
  status: VaultStatusResponse | null,
  cycle: Cycle | null,
  queueStatus: string | null,
  activeWithdrawal: RedemptionRequest | null,
  readyWithdrawal: RedemptionRequest | null,
  includeUserItems: boolean,
): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (status?.nav.lastUpdated) {
    items.push({
      title: "NAV updated",
      detail: `Share price moved to ${formatSharePrice(status.nav.sharePrice)} with ${formatCompactCurrency(status.nav.totalAssets)} in vault NAV.`,
      timestamp: status.nav.lastUpdated,
      tone: "good",
    });
  }

  if (includeUserItems && queueStatus === "queued") {
    items.push({
      title: "Deposit queue status",
      detail: `New capital is currently queued in ${vault.name}.`,
      timestamp: status?.nav.lastUpdated ?? null,
      tone: "neutral",
    });
  }

  if (includeUserItems && queueStatus === "processed") {
    items.push({
      title: "Deposit queue status",
      detail: "Queued capital has been minted into vault shares at the locked clearing price.",
      timestamp: status?.nav.lastUpdated ?? null,
      tone: "good",
    });
  }

  if (includeUserItems && readyWithdrawal) {
    items.push({
      title: "Claim readiness",
      detail: `Withdrawal ${readyWithdrawal.requestId} is ready to claim once you sign the redemption transaction.`,
      timestamp: readyWithdrawal.createdAt,
      tone: "good",
    });
  } else if (includeUserItems && activeWithdrawal) {
    items.push({
      title: "Withdrawal queue status",
      detail: `Withdrawal ${activeWithdrawal.requestId} is currently ${activeWithdrawal.status}.`,
      timestamp: activeWithdrawal.createdAt,
      tone: activeWithdrawal.status === "pending" ? "warning" : "neutral",
    });
  }

  items.push({
    title: "Vault access status",
    detail:
      getDepositStatusLabel(vault, cycle) === "Open"
        ? "Deposits are currently open and the vault can accept fresh capital."
        : "New capital intake is paused while the current vault state is blocked.",
    timestamp: cycle?.startTime ?? null,
    tone: getDepositStatusLabel(vault, cycle) === "Open" ? "neutral" : "warning",
  });

  return items.slice(0, 5);
}

function buildStrategyActivity(
  vault: VaultInstance,
  status: VaultStatusResponse | null,
  cycle: Cycle | null,
  performance: PerformanceStats,
): ActivityItem[] {
  void vault;
  void status;
  void cycle;
  void performance;
  return [];
}

function InfoTooltip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition-colors hover:border-cyan-300/30 hover:text-white"
        >
          <AlertCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={8}
        className="max-w-xs rounded-xl bg-slate-950 px-3 py-2 text-slate-100 shadow-2xl"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function SectionShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.045] shadow-[0_30px_90px_-55px_rgba(8,15,36,0.95)] backdrop-blur-xl">
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
    <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
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
    <div className="rounded-[22px] border border-white/10 bg-slate-950/30 p-4">
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

function NavChart({ stats, isLoading }: { stats: PerformanceStats; isLoading: boolean }) {
  if (isLoading) {
    return <Skeleton className="h-[280px] w-full rounded-[26px] bg-white/10" />;
  }

  if (stats.points.length < 2) {
    return (
      <div className="rounded-[26px] border border-dashed border-white/10 bg-slate-950/30 p-6 text-sm text-slate-400">
        Not enough NAV history yet to render a performance curve.
      </div>
    );
  }

  const width = 880;
  const height = 220;
  const values = stats.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.000001);

  const coordinates = stats.points.map((point, index) => {
    const x = (index / Math.max(stats.points.length - 1, 1)) * width;
    const y = height - ((point.value - min) / range) * height;
    return { x, y };
  });

  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,36,0.72),rgba(2,6,23,0.95))] p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">NAV chart</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
            {stats.latest !== null ? formatSharePrice(stats.latest) : "--"}
          </p>
        </div>
        <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2">
          <div>Start: {stats.first !== null ? formatSharePrice(stats.first) : "--"}</div>
          <div>
            Latest snapshot: {formatDate(stats.points[stats.points.length - 1]?.timestamp ?? null)}
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="vault-line" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(103,232,249,0.95)" />
            <stop offset="100%" stopColor="rgba(250,204,21,0.95)" />
          </linearGradient>
          <linearGradient id="vault-area" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(103,232,249,0.28)" />
            <stop offset="100%" stopColor="rgba(103,232,249,0.01)" />
          </linearGradient>
        </defs>
        <polyline fill="url(#vault-area)" stroke="none" points={area} />
        <polyline fill="none" stroke="url(#vault-line)" strokeWidth="3" points={line} />
      </svg>
    </div>
  );
}

function ActivityTimeline({
  items,
  emptyState = "No recent updates yet.",
}: {
  items: ActivityItem[];
  emptyState?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-[22px] border border-dashed border-white/10 bg-slate-950/30 p-5 text-sm text-slate-400">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={`${item.title}-${item.timestamp ?? item.detail}`}
          className="rounded-[22px] border border-white/10 bg-slate-950/30 p-4"
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
            <p className="text-xs text-slate-500">{formatDate(item.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RailStat({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
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
    <div className="rounded-[18px] border border-white/10 bg-slate-950/35 p-3">
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

function AddressField({ label, address, hint }: { label: string; address: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <div className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(address);
                setCopied(true);
              }}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300 transition-colors hover:border-cyan-300/30 hover:text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </TooltipTrigger>
          <TooltipContent
            sideOffset={8}
            className="max-w-sm rounded-xl bg-slate-950 px-3 py-2 text-slate-100 shadow-2xl"
          >
            Click to copy full address
          </TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <p
            className="mt-3 font-mono text-sm text-white cursor-pointer hover:text-cyan-200 transition-colors"
            onClick={() => {
              void navigator.clipboard.writeText(address);
              setCopied(true);
            }}
          >
            {formatAddress(address)}
          </p>
        </TooltipTrigger>
        <TooltipContent
          sideOffset={8}
          className="max-w-sm rounded-xl bg-slate-950 px-3 py-2 text-slate-100 shadow-2xl"
        >
          {address}
        </TooltipContent>
      </Tooltip>
      <p className="mt-2 text-xs leading-6 text-slate-400">{hint}</p>
    </div>
  );
}

function TxFeedback({ message, error }: { message: string | null; error: string | null }) {
  if (!message && !error) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm leading-6",
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
  onSuccess,
  refetchCycleStatus,
  walletConnected,
}: {
  vault: VaultInstance;
  cycle: Cycle | null;
  nav: VaultStatusResponse["nav"] | null;
  onSuccess: () => void;
  refetchCycleStatus: () => Promise<unknown>;
  walletConnected: boolean;
}) {
  const isCustomVault = vault.type === "custom";
  const { formatted, isLoading: balanceLoading, address } = useWalletBalance();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [navSyncPending, setNavSyncPending] = useState(false);

  const parsedAmount = getParsedUnits(amount, 6);
  const meetsMinDeposit = Number.parseFloat(amount || "0") >= vault.profile.minDeposit;
  const isValidAmount = parsedAmount !== undefined && parsedAmount > 0n && meetsMinDeposit;

  const { shares: previewShares } = usePreviewDeposit(
    vault.config.vaultAddress,
    parsedAmount,
    !isCustomVault,
  );
  const { allowance, refetch: refetchAllowance } = useUsdcAllowance(
    address,
    vault.config.vaultAddress,
  );
  const {
    approve,
    isPending: approvePending,
    isConfirming: approveConfirming,
    isConfirmed: approveConfirmed,
    error: approveError,
    reset: resetApprove,
  } = useUsdcApprove();
  const {
    deposit,
    isPending: depositPending,
    isConfirming: depositConfirming,
    isConfirmed: depositConfirmed,
    error: depositError,
    reset: resetDeposit,
  } = useVaultDeposit();
  const {
    queueDeposit,
    isPending: queueDepositPending,
    isConfirming: queueDepositConfirming,
    isConfirmed: queueDepositConfirmed,
    error: queueDepositError,
    reset: resetQueueDeposit,
  } = useQueueDeposit();

  const needsApproval = isValidAmount ? allowance < parsedAmount : false;
  const actionPending =
    approvePending ||
    approveConfirming ||
    depositPending ||
    depositConfirming ||
    queueDepositPending ||
    queueDepositConfirming ||
    navSyncPending;
  useEffect(() => {
    if (approveConfirmed) {
      void refetchAllowance();
      setMessage("Approval confirmed. You can deposit now.");
    }
  }, [approveConfirmed, refetchAllowance]);

  useEffect(() => {
    if (depositConfirmed || queueDepositConfirmed) {
      setAmount("");
      setErrorMessage(null);
      setMessage(
        queueDepositConfirmed
          ? "Deposit queued."
          : "Deposit confirmed and minted at the latest NAV.",
      );
      resetApprove();
      resetDeposit();
      resetQueueDeposit();
      void refetchAllowance();
      onSuccess();
    }
  }, [
    depositConfirmed,
    onSuccess,
    queueDepositConfirmed,
    refetchAllowance,
    resetApprove,
    resetDeposit,
    resetQueueDeposit,
  ]);

  useEffect(() => {
    if (approveError || depositError || queueDepositError) {
      setErrorMessage(
        approveError?.message ?? depositError?.message ?? queueDepositError?.message ?? null,
      );
      setMessage(null);
    }
  }, [approveError, depositError, queueDepositError]);

  async function ensureFreshNav() {
    setNavSyncPending(true);
    setErrorMessage(null);

    try {
      await postVaultNavUpdate();
      return true;
    } catch (error) {
      setErrorMessage(
        `Live NAV refresh failed. Please retry in a few seconds (${error instanceof Error ? error.message : "Unknown error"}).`,
      );
      return false;
    } finally {
      setNavSyncPending(false);
    }
  }

  async function handleDeposit() {
    if (!parsedAmount || !address) {
      return;
    }

    const latestCycleResult = await refetchCycleStatus();
    const latestCycle =
      typeof latestCycleResult === "object" && latestCycleResult && "cycle" in latestCycleResult
        ? ((latestCycleResult as { cycle?: Cycle | null }).cycle ?? cycle)
        : cycle;

    if (isCustomVault) {
      if (latestCycle?.executionMode === "queued") {
        queueDeposit(vault.config.vaultAddress as `0x${string}`, parsedAmount);
        return;
      }

      if (latestCycle?.executionMode === "instant" && latestCycle.telemetryFresh === true) {
        const refreshed = await ensureFreshNav();
        if (!refreshed) {
          return;
        }
        deposit(vault.config.vaultAddress as `0x${string}`, parsedAmount, address as `0x${string}`);
        return;
      }

      if (latestCycle?.executionMode === "blocked") {
        return;
      }

      queueDeposit(vault.config.vaultAddress as `0x${string}`, parsedAmount);
      return;
    }

    const refreshed = await ensureFreshNav();
    if (!refreshed) {
      return;
    }

    deposit(vault.config.vaultAddress as `0x${string}`, parsedAmount, address as `0x${string}`);
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <RailStat label="Status" value={getDepositStatusLabel(vault, cycle)} />
        <RailStat label="NAV" value={nav ? formatSharePrice(nav.sharePrice) : "--"} />
        <RailStat label="Min deposit" value={formatCurrency(vault.profile.minDeposit)} />
        <RailStat
          label="Wallet balance"
          value={balanceLoading ? "Loading..." : `${formatted} USDC.e`}
        />
      </div>

      {!walletConnected && <p className="text-[11px] text-slate-400">Connect wallet to deposit.</p>}

      <div className="rounded-xl border border-white/10 bg-slate-950/40 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="vault-deposit-amount" className="text-xs text-slate-400">
            Amount
          </label>
          <button
            type="button"
            onClick={() => {
              setAmount(formatted);
              setErrorMessage(null);
              setMessage(null);
            }}
            className="text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-200 transition-colors hover:text-white"
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
          onChange={(event) => {
            setAmount(event.target.value);
            setErrorMessage(null);
            setMessage(null);
            resetApprove();
            resetDeposit();
            resetQueueDeposit();
          }}
          disabled={actionPending}
          className="h-10 rounded-lg border-white/10 bg-white/5 px-3 font-mono text-sm text-white placeholder:text-slate-500"
        />
      </div>

      {previewShares !== undefined && parsedAmount && parsedAmount > 0n && !isCustomVault && (
        <p className="text-xs text-slate-400">
          Estimated shares: {Number(formatUnits(previewShares, 6)).toFixed(6)}
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
          onClick={() => {
            if (parsedAmount) {
              approve(vault.config.vaultAddress as `0x${string}`, parsedAmount);
            }
          }}
          disabled={!walletConnected || !address || !isValidAmount || actionPending}
          className="h-12 w-full rounded-2xl bg-white text-slate-950 hover:bg-slate-100"
        >
          Approve USDC.e
        </Button>
      ) : (
        <Button
          type="button"
          onClick={() => {
            void handleDeposit();
          }}
          disabled={
            !walletConnected ||
            !address ||
            !isValidAmount ||
            actionPending ||
            cycle?.executionMode === "blocked"
          }
          className="h-12 w-full rounded-2xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
        >
          {navSyncPending
            ? "Refreshing NAV..."
            : isCustomVault && cycle?.executionMode === "queued"
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

function WithdrawRail({
  vault,
  cycle,
  onSuccess,
  walletConnected,
  walletAddress,
  userAuthorized,
}: {
  vault: VaultInstance;
  cycle: Cycle | null;
  onSuccess: () => void;
  walletConnected: boolean;
  walletAddress: string | undefined;
  userAuthorized: boolean;
}) {
  const e2eOverride =
    typeof window !== "undefined" ? window.__E2E_EFFECTIVE_CONNECTED__ : undefined;
  const effectiveConnectedUI = typeof e2eOverride === "boolean" ? e2eOverride : walletConnected;
  const usingE2eConnectedSeam = effectiveConnectedUI && !walletConnected;
  const effectiveAddress: `0x${string}` | undefined = walletAddress
    ? (walletAddress as `0x${string}`)
    : undefined;
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState(false);
  const [claimingRequestId, setClaimingRequestId] = useState<string | null>(null);
  const [navSyncPending, setNavSyncPending] = useState(false);

  const parsedShares = getParsedUnits(amount, 6);
  const isValidAmount = parsedShares !== undefined && parsedShares > 0n;
  const isCustomVault = vault.type === "custom";
  const currentExecutionMode = cycle?.executionMode ?? undefined;
  const isBlockedMode = isCustomVault && currentExecutionMode === "blocked";

  const {
    shares,
    formatted: formattedShares,
    refetch: refetchShares,
  } = useVaultShares(vault.config.vaultAddress, walletAddress, vault.type === "custom" ? 6 : 18);
  const effectiveShares = shares;
  const effectiveFormattedShares = formattedShares;
  const { assets: previewAssets, refetch: refetchPreviewAssets } = usePreviewRedeem(
    vault.config.vaultAddress,
    parsedShares,
    isCustomVault,
  );
  const effectivePreviewAssets = previewAssets;
  const {
    data: queueData,
    isLoading: queueLoading,
    refetch: refetchQueue,
  } = useWithdrawalQueue(vault.config.vaultAddress);
  const { redeem, isPending, isConfirming, isConfirmed, hash, error, reset } = useVaultRedeem();

  const activeRequest =
    queueData?.requests.find(
      (request) => request.status === "pending" || request.status === "ready",
    ) ?? null;
  const readyRequest = activeRequest?.status === "ready" ? activeRequest : null;
  const readyRequestShares = readyRequest ? getParsedUnits(readyRequest.shares, 6) : undefined;
  const { assets: readyPreviewAssets, refetch: refetchReadyPreviewAssets } = usePreviewRedeem(
    vault.config.vaultAddress,
    readyRequestShares,
    false,
  );

  const readyLiveEstimatedAssets =
    !isCustomVault && readyRequest && readyPreviewAssets !== undefined
      ? Number(formatUnits(readyPreviewAssets, 6))
      : Number.NaN;
  const displayedEstimatedAssets =
    readyRequest && Number.isFinite(readyLiveEstimatedAssets)
      ? readyLiveEstimatedAssets
      : activeRequest
        ? Number.parseFloat(activeRequest.assetsEstimated)
        : effectivePreviewAssets !== undefined
          ? Number(formatUnits(effectivePreviewAssets, 6))
          : 0;

  useEffect(() => {
    if (!effectiveConnectedUI) {
      setErrorMessage(null);
      setMessage(null);
      setClaimingRequestId(null);
    }
  }, [effectiveConnectedUI]);

  useEffect(() => {
    if (!isConfirmed || !hash || !claimingRequestId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const result = await postCompleteWithdrawalRequest(claimingRequestId, hash);
        if (cancelled) {
          return;
        }

        setMessage(result.message);
        setErrorMessage(null);
        setClaimingRequestId(null);
        setAmount("");
        reset();
        await Promise.all([refetchQueue(), refetchShares(), refetchReadyPreviewAssets()]);
        onSuccess();
      } catch (error) {
        if (cancelled) {
          return;
        }

        setErrorMessage(
          `Withdrawal sent (${truncateId(hash, 12)}) but queue update failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        setClaimingRequestId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    claimingRequestId,
    hash,
    isConfirmed,
    onSuccess,
    refetchQueue,
    refetchReadyPreviewAssets,
    refetchShares,
    reset,
  ]);

  useEffect(() => {
    if (error && claimingRequestId) {
      const normalized = error.message.toLowerCase();
      if (
        normalized.includes("rejected") ||
        normalized.includes("denied") ||
        normalized.includes("4001") ||
        normalized.includes("user")
      ) {
        setErrorMessage(
          "Wallet confirmation was cancelled. Your withdrawal request is still ready and can be claimed again or cancelled.",
        );
      } else {
        setErrorMessage(error.message);
      }
      setClaimingRequestId(null);
    }
  }, [claimingRequestId, error]);

  async function ensureFreshNav() {
    if (usingE2eConnectedSeam) {
      return true;
    }

    setNavSyncPending(true);
    setErrorMessage(null);

    try {
      await postVaultNavUpdate();
      return true;
    } catch (error) {
      setErrorMessage(
        `Live NAV refresh failed. Please retry in a few seconds (${error instanceof Error ? error.message : "Unknown error"}).`,
      );
      return false;
    } finally {
      setNavSyncPending(false);
    }
  }

  async function handleRequestWithdrawal() {
    if (!parsedShares || parsedShares > effectiveShares || isBlockedMode) {
      return;
    }

    setQueuePending(true);
    setErrorMessage(null);
    setMessage(null);
    reset();

    try {
      if (isCustomVault) {
        const result = await postWithdrawalRequest(
          formatUnits(parsedShares, 6),
          previewAssets && previewAssets > 0n ? formatUnits(previewAssets, 6) : undefined,
        );
        setMessage(result.message);
        setAmount("");
        await Promise.all([refetchQueue(), refetchShares(), refetchReadyPreviewAssets()]);
        onSuccess();
        return;
      }

      const refreshed = await ensureFreshNav();
      if (!refreshed) {
        return;
      }

      await refetchPreviewAssets();
      const latestPreview = previewAssets;
      if (latestPreview === undefined || latestPreview <= 0n) {
        setErrorMessage("Unable to estimate redeemable assets. Please try again in a few seconds.");
        return;
      }

      const result = await postWithdrawalRequest(
        formatUnits(parsedShares, 6),
        formatUnits(latestPreview, 6),
      );
      setMessage(result.message);
      setAmount("");
      await Promise.all([refetchQueue(), refetchShares()]);
      onSuccess();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to queue withdrawal request",
      );
    } finally {
      setQueuePending(false);
    }
  }

  async function handleClaimReadyWithdrawal() {
    if (!readyRequest || !effectiveAddress || !userAuthorized) {
      return;
    }

    setErrorMessage(null);
    setMessage(null);

    const refreshed = await ensureFreshNav();
    if (!refreshed) {
      return;
    }

    let requestToClaim = readyRequest;

    try {
      if (isCustomVault) {
        const preflight = await preflightWithdrawal(readyRequest.requestId);
        if (!preflight.ready) {
          setErrorMessage(
            preflight.error ?? "Withdrawal liquidity is not ready yet. Please retry.",
          );
          return;
        }
        requestToClaim = preflight.request ?? readyRequest;
      } else {
        const prepared = await postPrepareWithdrawalRequest(readyRequest.requestId);
        requestToClaim = prepared.request ?? readyRequest;
      }

      await Promise.all([refetchQueue(), refetchShares(), refetchReadyPreviewAssets()]);

      if (requestToClaim.status !== "ready") {
        setMessage(
          `Withdrawal ${requestToClaim.requestId} is ${requestToClaim.status}. Please wait for it to become ready again.`,
        );
        return;
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to prepare withdrawal claim. Please retry.",
      );
      return;
    }

    let requestShares: bigint;
    try {
      requestShares = parseUnits(requestToClaim.shares, 6);
    } catch {
      setErrorMessage("Ready withdrawal request has invalid share amount.");
      return;
    }

    setClaimingRequestId(requestToClaim.requestId);

    redeem(
      vault.config.vaultAddress as `0x${string}`,
      requestShares,
      effectiveAddress,
      effectiveAddress,
    );
  }

  async function handleCancelWithdrawalRequest() {
    if (!activeRequest) {
      return;
    }

    setQueuePending(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const result = await postCancelWithdrawalRequest(activeRequest.requestId);
      setMessage(result.message);
      setAmount("");
      setClaimingRequestId(null);
      reset();
      await Promise.all([refetchQueue(), refetchShares(), refetchReadyPreviewAssets()]);
      onSuccess();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to cancel withdrawal request",
      );
    } finally {
      setQueuePending(false);
    }
  }

  const requestDisabled =
    !userAuthorized ||
    !effectiveAddress ||
    !isValidAmount ||
    parsedShares > effectiveShares ||
    queuePending ||
    navSyncPending ||
    isPending ||
    isConfirming ||
    !!activeRequest ||
    effectivePreviewAssets === undefined ||
    effectivePreviewAssets <= 0n;

  const claimDisabled =
    !userAuthorized ||
    !readyRequest ||
    !effectiveAddress ||
    queuePending ||
    navSyncPending ||
    isPending ||
    isConfirming;

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <RailStat
          label="Share balance"
          value={`${Number(effectiveFormattedShares).toFixed(6)} shares`}
          tooltip="Current wallet share balance for this vault."
        />
        <RailStat
          label="Est. value"
          value={formatCurrency(displayedEstimatedAssets || 0)}
          tooltip="Estimated assets based on the latest available preview or request estimate."
        />
      </div>

      {effectiveConnectedUI && !userAuthorized && !usingE2eConnectedSeam && (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          Sign in to request a withdrawal.
        </div>
      )}

      <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <label htmlFor="vault-withdraw-amount" className="text-sm text-slate-300">
            Amount
          </label>
          <button
            type="button"
            onClick={() => {
              setAmount(effectiveFormattedShares);
              setErrorMessage(null);
              setMessage(null);
              reset();
            }}
            disabled={queuePending || isPending || isConfirming || !!activeRequest}
            className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-200 transition-colors hover:text-white disabled:opacity-40"
          >
            Max
          </button>
        </div>
        <Input
          id="vault-withdraw-amount"
          type="number"
          step="0.000001"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setErrorMessage(null);
            setMessage(null);
            reset();
          }}
          disabled={queuePending || isPending || isConfirming || !!activeRequest}
          className="h-14 rounded-2xl border-white/10 bg-white/5 px-4 font-mono text-lg text-white placeholder:text-slate-500"
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>How claims work</span>
        <InfoTooltip
          label="How claims work"
          content="After your exit request is processed and settlement is complete, your redeemed USDC becomes claimable."
        />
      </div>

      {!activeRequest &&
        effectivePreviewAssets !== undefined &&
        parsedShares &&
        parsedShares > 0n && (
          <p className="text-xs text-slate-400">
            Estimated USDC.e out: {Number(formatUnits(effectivePreviewAssets, 6)).toFixed(2)}
          </p>
        )}

      <Button
        type="button"
        onClick={() => {
          void handleRequestWithdrawal();
        }}
        disabled={isBlockedMode || requestDisabled}
        className="h-12 w-full rounded-2xl bg-white text-slate-950 hover:bg-slate-100"
      >
        {queuePending
          ? "Submitting..."
          : navSyncPending
            ? "Refreshing NAV..."
            : isBlockedMode
              ? "Withdrawal blocked"
              : "Request withdrawal"}
      </Button>

      {activeRequest && (
        <div className="space-y-3 rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-50">
          <p className="text-sm font-medium">
            {readyRequest ? "Claim is ready" : `Withdrawal ${activeRequest.requestId} is queued`}
          </p>
          <p className="text-xs leading-6 text-amber-50/90">
            {readyRequest
              ? "Settlement is complete. Sign the claim transaction to receive USDC.e, or cancel the request if you no longer want to exit."
              : "Your exit request is queued. You can leave it in queue or cancel it before claiming."}
          </p>
          <p className="text-xs leading-6 text-amber-50/90">
            Estimated payout: {formatCurrency(displayedEstimatedAssets || 0)}
          </p>
          <p className="text-xs leading-6 text-amber-50/90">
            Requested: {formatDate(activeRequest.createdAt)}
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {readyRequest && (
              <Button
                type="button"
                onClick={() => {
                  void handleClaimReadyWithdrawal();
                }}
                disabled={claimDisabled}
                className="h-11 rounded-2xl bg-emerald-300 text-slate-950 hover:bg-emerald-200"
              >
                Claim withdrawal
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void handleCancelWithdrawalRequest();
              }}
              disabled={queuePending || isPending || isConfirming}
              className="h-11 rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              Cancel request
            </Button>
          </div>
        </div>
      )}

      {queueLoading && <Skeleton className="h-5 w-40 bg-white/10" />}
      <TxFeedback message={message} error={errorMessage} />
    </div>
  );
}

function VaultNotFound() {
  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
      <div className="mx-auto max-w-4xl rounded-[32px] border border-white/10 bg-white/[0.045] p-10 text-center backdrop-blur-xl">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Vault</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Vault not found</h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-400">
          This vault does not exist, or it is not currently available.
        </p>
        <Button asChild className="mt-6 rounded-full bg-white text-slate-950 hover:bg-slate-100">
          <Link href="/">Back to vaults</Link>
        </Button>
      </div>
    </main>
  );
}

export default function VaultDetailPage() {
  const queryClient = useQueryClient();
  const [e2eConnectedSeam, setE2eConnectedSeam] = useState(false);
  const [sessionAuthenticated, setSessionAuthenticated] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const value = new URL(window.location.href).searchParams.get("e2eConnected");
      setE2eConnectedSeam(value === "1");
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__E2E_EFFECTIVE_CONNECTED__ = e2eConnectedSeam;
    }
  }, [e2eConnectedSeam]);

  const params = useParams();
  const { address, isConnected } = useAppKitAccount();
  const routeVaultId = Number.parseInt(params.id as string, 10);
  const walletConnected = Boolean(isConnected);

  useEffect(() => {
    let cancelled = false;

    if (!walletConnected || !address) {
      setSessionAuthenticated(false);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const result = await fetchAuthMe();
        if (!cancelled) {
          const matchesWallet =
            !result.address || result.address.toLowerCase() === address?.toLowerCase();
          setSessionAuthenticated(result.authenticated === true && matchesWallet);
        }
      } catch {
        if (!cancelled) {
          setSessionAuthenticated(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, walletConnected]);

  const userAuthorized = walletConnected && Boolean(address) && sessionAuthenticated;

  const { data: instancesData, isLoading: instancesLoading } = useVaultInstances();
  const vault = instancesData?.instances.find((instance) => instance.id === routeVaultId);
  const { data: status, isLoading: statusLoading, error: statusError } = useVaultStatus(vault?.id);
  const {
    data: navHistoryData,
    isLoading: navHistoryLoading,
    refetch: refetchNavHistory,
  } = useVaultNavHistory(60, vault?.id);
  const {
    cycle,
    isLoading: cycleLoading,
    error: cycleError,
    refetch: refetchCycleStatus,
  } = useCycleStatus(vault?.id);
  const { queueStatus } = useDepositQueue(vault?.id, userAuthorized);
  const {
    pendingRequests,
    claimableRequests,
    isLoading: requestsLoading,
  } = useRequests(vault?.id, userAuthorized);
  const { shares: redemptionUserShares } = useVaultShares(
    vault?.config.vaultAddress,
    address,
    vault?.type === "custom" ? 6 : 18,
  );

  const refreshAll = async () => {
    await Promise.all([invalidateVaultQueries(queryClient, vault?.id), refetchNavHistory()]);
  };

  const performance = useMemo(
    () => derivePerformanceStats(navHistoryData?.snapshots ?? []),
    [navHistoryData?.snapshots],
  );

  const networkInfo = getNetworkDisplayInfo(VAULT_NETWORK);
  const tags = vault
    ? [
        vault.type === "custom" ? "Agent-managed" : "Vault-managed",
        vault.profile.strategyLabel,
        getDepositStatusLabel(vault, cycle),
        `${toTitleCase(vault.profile.riskLevel)} risk`,
      ]
    : [];

  const vaultActivity = useMemo(() => {
    if (!vault) {
      return [];
    }

    const activeWithdrawal =
      pendingRequests.find((request) => request.status === "pending") ??
      claimableRequests.find((request) => request.status === "claimable") ??
      null;
    const readyWithdrawal = claimableRequests[0] ?? null;

    return buildVaultActivity(
      vault,
      status,
      cycle,
      queueStatus,
      activeWithdrawal,
      readyWithdrawal,
      userAuthorized,
    );
  }, [claimableRequests, cycle, pendingRequests, queueStatus, status, userAuthorized, vault]);

  const strategyActivity = useMemo(() => {
    if (!vault) {
      return [];
    }

    return buildStrategyActivity(vault, status, cycle, performance);
  }, [cycle, performance, status, vault]);

  const cycleNote = useMemo(() => {
    if (!vault) {
      return null;
    }

    return getCycleNote(vault, cycle);
  }, [cycle, vault]);

  if (!vault && !instancesLoading) {
    return <VaultNotFound />;
  }

  if (!vault) {
    return (
      <main className="flex-1 px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
        <div className="mx-auto max-w-6xl space-y-6">
          <Skeleton className="h-10 w-40 bg-white/10" />
          <Skeleton className="h-[220px] w-full rounded-[32px] bg-white/10" />
          <Skeleton className="h-[540px] w-full rounded-[32px] bg-white/10" />
        </div>
      </main>
    );
  }

  const heroMetrics = [
    {
      label: "APY / Net return",
      value:
        performance.annualized !== null
          ? formatPercent(performance.annualized)
          : formatPercent(performance.sinceInception),
      hint:
        performance.annualized !== null
          ? `Annualized from ${performance.daysCovered.toFixed(0)} days of NAV history`
          : `Net return ${formatPercent(performance.sinceInception)} since inception`,
      tooltip: "Annualized return appears once enough NAV history exists.",
    },
    {
      label: "NAV",
      value: status ? formatSharePrice(status.nav.sharePrice) : "--",
      hint: status?.nav.lastUpdated
        ? `Updated ${formatDate(status.nav.lastUpdated)}`
        : "Waiting for first NAV snapshot.",
      tooltip: "Latest share price.",
    },
    {
      label: "TVL",
      value: status ? formatCompactCurrency(status.nav.totalAssets) : "--",
      hint: status
        ? "Total assets tracked by the vault right now."
        : "Waiting for first TVL snapshot.",
      tooltip: "Current total assets in the vault.",
    },
  ];

  return (
    <main className="vault-pane-scroll flex-1 min-h-0 overflow-y-auto px-4 py-8 sm:px-6 lg:overflow-hidden lg:px-10 lg:py-6">
      <div className="mx-auto max-w-7xl lg:h-full lg:min-h-0">
        <div className="grid gap-x-8 gap-y-6 lg:h-full lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-y-0">
          <div className="vault-pane-scroll space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/"
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
              <div className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-50">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 text-amber-200" />
                  <div>
                    <h3 className="text-sm font-medium text-amber-100">Testnet mode: Amoy</h3>
                    <p className="mt-1 text-sm leading-7 text-amber-50/85">
                      You are connected to Polygon Amoy Testnet. Vault testing is supported here,
                      but Polymarket trading is disabled.
                      {!SUPPORTS_POLYMARKET_TRADING &&
                        " Position and trading features remain read-only on testnet."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-8">
              {(statusError || cycleError) && (
                <Card className="rounded-[24px] border-rose-400/20 bg-rose-400/10 text-rose-50 backdrop-blur-xl">
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm">{statusError ?? cycleError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void refreshAll();
                      }}
                      className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                    >
                      Retry
                    </Button>
                  </CardContent>
                </Card>
              )}

              <section className="relative overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.045] px-6 py-7 shadow-[0_40px_110px_-55px_rgba(8,15,36,0.95)] backdrop-blur-xl sm:px-8 lg:px-10 lg:py-9">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(103,232,249,0.16),_transparent_32%),radial-gradient(circle_at_85%_18%,_rgba(250,204,21,0.1),_transparent_18%)]" />
                <div className="relative grid gap-8">
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                        Vault
                      </p>
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                        <span>How vaults work</span>
                        <InfoTooltip
                          label="How vaults work"
                          content="Deposit into a strategy, receive vault shares, and track performance through NAV. The agent executes within its mandate and withdrawals are handled through the vault flow."
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                        {vault.name}
                      </h1>
                      <p className="max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
                        {vault.profile.longDescription}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
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
                    {heroMetrics.map((metric) => (
                      <SummaryMetric
                        key={metric.label}
                        label={metric.label}
                        value={metric.value}
                        hint={metric.hint}
                        tooltip={metric.tooltip}
                      />
                    ))}
                  </div>
                </div>
              </section>

              <SectionShell title="Performance">
                <div className="space-y-5">
                  <NavChart stats={performance} isLoading={navHistoryLoading || statusLoading} />
                  <div className="grid gap-3 md:grid-cols-4">
                    <PerformanceTile
                      label="Since inception"
                      value={formatPercent(performance.sinceInception)}
                      tone={
                        performance.sinceInception !== null && performance.sinceInception >= 0
                          ? "good"
                          : "warning"
                      }
                      tooltip="Calculated from the first and latest NAV snapshots available in history."
                    />
                    <PerformanceTile
                      label="30D return"
                      value={formatPercent(performance.thirtyDay)}
                      tone={
                        performance.thirtyDay !== null && performance.thirtyDay >= 0
                          ? "good"
                          : "warning"
                      }
                      tooltip="Shown only when the available NAV history covers a full 30-day lookback."
                    />
                    <PerformanceTile
                      label="Max drawdown"
                      value={formatPercent(performance.maxDrawdown)}
                      tone="warning"
                      tooltip="Largest peak-to-trough decline across the available NAV history."
                    />
                    <PerformanceTile
                      label="Win rate"
                      value={
                        performance.winRate !== null
                          ? `${(performance.winRate * 100).toFixed(1)}%`
                          : "--"
                      }
                      tone="neutral"
                      tooltip="Win rate will appear when realized outcome reporting is available."
                    />
                  </div>
                </div>
              </SectionShell>

              <SectionShell title="Strategy & Operator">
                <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-4">
                    <p className="text-sm leading-7 text-slate-300">
                      {vault.name.replace(/\s*\(.*\)$/, "")} is an autonomous agent running via
                      OpenClaw. The vault gives users exposure to an agent-managed strategy through
                      vault shares, while execution happens within a defined mandate rather than
                      through manual trading. PM Vaults are built around mandates, transparent
                      limits, agent identity, share accounting, and NAV-driven settlement.
                    </p>
                    <div className="grid gap-3">
                      <AddressField
                        label="Operator address"
                        address={vault.config.safeAddress}
                        hint="Primary safe used for vault execution."
                      />
                      <AddressField
                        label="Vault address"
                        address={vault.config.vaultAddress}
                        hint="Vault contract address for deposits, shares, and redemptions."
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SummaryMetric
                        label="Mode"
                        value={status ? (status.mode === "live" ? "Live" : "Simulation") : "--"}
                        hint={status ? "Current execution mode." : "Waiting for live status data."}
                        tooltip="Current execution mode for this vault."
                      />
                      <SummaryMetric
                        label="Focus"
                        value={vault.profile.strategyLabel}
                        hint="Primary strategy focus."
                      />
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-white/10 bg-slate-950/30 p-5">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Key info
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <KeyInfoItem label="Management" value="Agent-managed" />
                      <KeyInfoItem label="Infra" value="OpenClaw" />
                      <KeyInfoItem label="Focus" value={vault.profile.strategyLabel} />
                      <KeyInfoItem label="Style" value="Short-horizon, event-driven" />
                      <KeyInfoItem
                        label="Hot wallet"
                        value={status ? formatCurrency(status.nav.vaultUsdc) : "--"}
                        tooltip="USDC currently sitting in the vault wallet."
                      />
                      <KeyInfoItem
                        label="Safe wallet"
                        value={status ? formatCurrency(status.nav.safeUsdc) : "--"}
                        tooltip="USDC currently sitting in the trading safe."
                      />
                    </div>

                    {cycleNote ? (
                      <div className="mt-4 rounded-[18px] border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                            Current cycle
                          </p>
                          <InfoTooltip
                            label="Current cycle"
                            content="Current lifecycle state for deposits, queued requests, and claims."
                          />
                        </div>
                        <p className="mt-2 text-sm font-medium text-white">{cycleNote.label}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-400">{cycleNote.detail}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </SectionShell>

              <SectionShell title="Risk & Terms">
                <div className="grid gap-4 md:grid-cols-3">
                  <SummaryMetric
                    label="Risk score"
                    value="8.2 / 10"
                    hint="Current vault risk assessment."
                    tooltip="Overall vault risk assessment."
                  />
                  <SummaryMetric
                    label="Liquidity"
                    value={getLiquidityLabel(vault, cycle)}
                    hint="Withdrawal access relies on vault cycles."
                    tooltip="This is derived from the current vault mode and cycle execution state."
                  />
                  <SummaryMetric
                    label="Fees"
                    value={getFeeLabel(vault)}
                    hint="Management and performance fee."
                    tooltip="Fees come from the configured vault profile."
                  />
                </div>
                <div className="mt-5 rounded-[24px] border border-white/10 bg-slate-950/30 p-5 text-sm leading-7 text-slate-400">
                  Depositing into this vault exposes you to strategy, execution, market, and
                  settlement risk. NAV updates, batch state changes, and vault share accounting
                  determine when funds enter and exit the strategy, and there is no guarantee of
                  principal protection.
                </div>
                <div className="mt-5 rounded-[24px] border border-white/10 bg-slate-950/30 p-5">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Lifecycle
                    </p>
                    <InfoTooltip
                      label="Lifecycle"
                      content="Vault lifecycle is driven by current conditions, not fixed timers. Deposits and withdrawal requests move between direct actions, queue, processing, and claim states depending on whether the vault can act immediately or must batch requests."
                    />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <KeyInfoItem
                      label="Open"
                      value="Used when the vault can act directly. Deposits complete immediately, and ready withdrawal requests can be claimed."
                    />
                    <KeyInfoItem
                      label="Queue only"
                      value="Used when direct actions are unavailable, such as while trading is active. New deposits and withdrawal requests enter queue."
                    />
                    <KeyInfoItem
                      label="Processing"
                      value="Used while queued deposits are minted and queued withdrawals are settled."
                    />
                    <KeyInfoItem
                      label="Claim"
                      value="Shown after a queued withdrawal has been processed and the request is marked ready for claim."
                    />
                  </div>
                </div>
              </SectionShell>

              <SectionShell title="Activity">
                <Tabs defaultValue="vault" className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl border border-white/10 bg-white/5 p-1">
                    <TabsTrigger
                      value="vault"
                      className="rounded-xl py-2.5 text-slate-400 hover:text-white data-[state=active]:bg-white data-[state=active]:text-slate-950"
                    >
                      Vault
                    </TabsTrigger>
                    <TabsTrigger
                      value="strategy"
                      className="rounded-xl py-2.5 text-slate-400 hover:text-white data-[state=active]:bg-white data-[state=active]:text-slate-950"
                    >
                      Strategy
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="vault">
                    <ActivityTimeline items={vaultActivity} />
                  </TabsContent>
                  <TabsContent value="strategy">
                    <ActivityTimeline
                      items={strategyActivity}
                      emptyState="No strategy updates yet."
                    />
                  </TabsContent>
                </Tabs>
              </SectionShell>

              {vault.type !== "custom" && (
                <SectionShell
                  eyebrow="Redemptions"
                  title="Exit Queue"
                  description="Manage your vault exit requests and claim settled USDC.e."
                >
                  <RedemptionPanel
                    vault={vault}
                    cycleInfo={cycle}
                    pendingRequests={pendingRequests}
                    claimableRequests={claimableRequests}
                    isLoading={requestsLoading || cycleLoading}
                    onRequestCreated={() => {
                      void refreshAll();
                    }}
                    onClaimSuccess={() => {
                      void refreshAll();
                    }}
                    userShares={redemptionUserShares}
                  />
                </SectionShell>
              )}
            </div>
          </div>

          <aside className="lg:col-start-2 lg:row-start-1 lg:min-h-0 lg:border-l lg:border-white/10 lg:pl-6">
            <section className="vault-pane-scroll space-y-4 lg:h-full lg:overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    Manage position
                  </p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">
                    Deposit or withdraw
                  </h2>
                </div>
                <div className="rounded-full border border-cyan-300/15 bg-cyan-300/10 p-1.5 text-cyan-200">
                  <Wallet className="h-3.5 w-3.5" />
                </div>
              </div>

              <Tabs defaultValue="deposit" className="space-y-3">
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-white/10 bg-white/5 p-0.5">
                  <TabsTrigger
                    value="deposit"
                    className="rounded-lg py-1.5 text-sm text-slate-400 hover:text-white data-[state=active]:bg-white data-[state=active]:text-slate-950"
                  >
                    Deposit
                  </TabsTrigger>
                  <TabsTrigger
                    value="withdraw"
                    className="rounded-lg py-1.5 text-sm text-slate-400 hover:text-white data-[state=active]:bg-white data-[state=active]:text-slate-950"
                  >
                    Withdraw
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="deposit">
                  <DepositRail
                    vault={vault}
                    cycle={cycle}
                    nav={status?.nav ?? null}
                    walletConnected={walletConnected}
                    onSuccess={() => {
                      void refreshAll();
                    }}
                    refetchCycleStatus={refetchCycleStatus}
                  />
                </TabsContent>

                <TabsContent value="withdraw">
                  {vault.type === "custom" ? (
                    <WithdrawRail
                      vault={vault}
                      cycle={cycle}
                      walletConnected={walletConnected}
                      walletAddress={address}
                      userAuthorized={userAuthorized}
                      onSuccess={() => {
                        void refreshAll();
                      }}
                    />
                  ) : (
                    <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
                      Non-custom vault exits keep their full request, pending, and claim flow in the
                      Exit Queue section on the left so the claim path stays accurate.
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
