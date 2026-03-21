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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  deriveVaultPerformanceStats,
  type DerivedVaultPerformanceStats,
} from "../../../src/lib/performance";
import {
  preflightWithdrawal,
  useCycleStatus,
  usePreviewDeposit,
  usePreviewRedeem,
  useQueueDeposit,
  useRequests,
  useUsdcAllowance,
  useUsdcApprove,
  useVaultDeposit,
  useVaultEvents,
  useVaultInstances,
  useVaultNavHistory,
  useVaultRedeem,
  useVaultShares,
  useVaultStatus,
  useVaultTradingAnalytics,
  useUserVaultHistory,
  useWalletBalance,
  useWithdrawalQueue,
  invalidateVaultQueries,
} from "../../../src/lib/hooks";
import {
  fetchAuthMe,
  postCancelWithdrawalRequest,
  postRecordClaimActivity,
  postCompleteWithdrawalRequest,
  postPrepareWithdrawalRequest,
  postRecordDepositActivity,
  postVaultNavUpdate,
  postWithdrawalRequest,
} from "../../../src/lib/api";
import { SUPPORTS_POLYMARKET_TRADING, VAULT_NETWORK } from "../../../src/constants";
import { getNetworkDisplayInfo } from "../../../src/lib/network";
import type {
  Cycle,
  RedemptionRequest,
  VaultActivityFeedItem,
  VaultInstance,
  VaultStatusResponse,
} from "../../../src/types";
import { RedemptionPanel } from "./components";

declare global {
  interface Window {
    __E2E_EFFECTIVE_CONNECTED__?: boolean;
  }
}

interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  timestamp: string | null;
  tone: "neutral" | "good" | "warning";
}

function formatActivityAmount(value?: string, suffix = "USDC.e"): string | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return `${formatCurrency(parsed)} ${suffix}`;
}

function mapFeedItemsToTimeline(items: VaultActivityFeedItem[]): ActivityItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    detail: [
      item.detail,
      formatActivityAmount(item.amounts?.assets),
      formatActivityAmount(item.amounts?.shares, "shares"),
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

function getDepositActionLabel(vault: VaultInstance, cycle: Cycle | null): string {
  if (!vault.enabled || cycle?.executionMode === "blocked") {
    return "Paused";
  }

  if (vault.type === "custom" && cycle?.executionMode === "queued") {
    return "Join next cycle";
  }

  return "Open now";
}

function getHeroStateLabel(vault: VaultInstance, cycle: Cycle | null): string {
  if (!vault.enabled || cycle?.executionMode === "blocked") {
    return "Paused";
  }

  if (cycle?.batchState === "flattening" || cycle?.batchState === "settling") {
    return "Processing";
  }

  if (vault.type === "custom" && cycle?.executionMode === "queued") {
    return "Queue only";
  }

  return "Open";
}

function getHeroSentence(vault: VaultInstance): string {
  const managementLabel = vault.type === "custom" ? "Agent-managed" : "Vault-managed";
  return `${managementLabel} ${vault.profile.strategyLabel} vault running a ${vault.profile.riskLevel}-risk strategy on Polymarket.`;
}

function getManagementLabel(vault: VaultInstance): string {
  return vault.type === "custom" ? "Agent mandate" : "Vault mandate";
}

function getInfraLabel(vault: VaultInstance): string {
  return vault.type === "custom" ? "Custom vault rails" : "Standard vault rails";
}

function getStyleLabel(vault: VaultInstance): string {
  return vault.type === "custom" ? "Cycle-based execution" : "Share-based execution";
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
  return `${toTitleCase(vault.profile.riskLevel)}-risk strategy with ${getLiquidityLabel(vault, cycle).toLowerCase()} and no principal protection.`;
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

const ACTIVITY_PAGE_SIZE = 10;

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

function getWithdrawActionLabel(args: {
  isBlockedMode: boolean;
  hasQueuedRequest: boolean;
  hasClaimReady: boolean;
}): string {
  if (args.isBlockedMode) {
    return "Paused";
  }

  if (args.hasClaimReady) {
    return "Claim ready";
  }

  if (args.hasQueuedRequest) {
    return "Queued";
  }

  return "Open";
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
      className="overflow-hidden rounded-[2px] border border-[#212121] bg-[#121212] shadow-none"
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
}: {
  stats: DerivedVaultPerformanceStats;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-[280px] w-full rounded-[26px] bg-white/10" />;
  }

  if (stats.points.length < 2) {
    return (
      <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-6 text-sm text-[#828B8D]">
        Not enough NAV history yet to render a performance curve.
      </div>
    );
  }

  const width = 880;
  const height = 220;
  const values = stats.points.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const padding = min === 0 ? 0.01 : min * 0.01;
    min -= padding;
    max += padding;
  }
  const range = Math.max(max - min, 0.000001);

  const coordinates = stats.points.map((point, index) => {
    const x = (index / Math.max(stats.points.length - 1, 1)) * width;
    const y = height - ((point.value - min) / range) * height;
    return { x, y };
  });

  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-5">
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
            <p className="text-xs text-slate-500">{formatDate(item.timestamp)}</p>
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
  pageSize,
  currentCount,
  hasMore,
  isLoading,
  onPrevious,
  onNext,
}: {
  offset: number;
  pageSize: number;
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
    <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4">
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

function TechnicalDetailsDialog({
  vault,
  status,
}: {
  vault: VaultInstance;
  status: VaultStatusResponse | null;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="rounded-[10px] border border-[#656565]/40 bg-[#121212] text-white hover:bg-[#212121]"
        >
          Technical details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl rounded-[2px] border border-[#212121] bg-[#0A0A0A] text-white shadow-none">
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight text-white">
            Technical details
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-slate-400">
            Contract addresses and cash-location context for power users monitoring execution and
            liquidity routing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <AddressField
            label="Operator safe"
            address={vault.config.safeAddress}
            hint="Primary execution safe that controls trading and batch processing."
          />
          <AddressField
            label="Vault contract"
            address={vault.config.vaultAddress}
            hint="On-chain vault contract for deposits, shares, and redemptions."
          />
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
  onSuccess,
  refetchCycleStatus,
  walletConnected,
  userAuthorized,
  vaultId,
}: {
  vault: VaultInstance;
  cycle: Cycle | null;
  nav: VaultStatusResponse["nav"] | null;
  onSuccess: () => void;
  refetchCycleStatus: () => Promise<unknown>;
  walletConnected: boolean;
  userAuthorized: boolean;
  vaultId: number;
}) {
  const isCustomVault = vault.type === "custom";
  const { formatted, isLoading: balanceLoading, address } = useWalletBalance();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [navSyncPending, setNavSyncPending] = useState(false);
  const [depositPreflightPending, setDepositPreflightPending] = useState(false);

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
    hash: depositHash,
    error: depositError,
    reset: resetDeposit,
  } = useVaultDeposit();
  const {
    queueDeposit,
    isPending: queueDepositPending,
    isConfirming: queueDepositConfirming,
    isConfirmed: queueDepositConfirmed,
    hash: queueDepositHash,
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
    navSyncPending ||
    depositPreflightPending;
  const [submittedDepositAmount, setSubmittedDepositAmount] = useState<string | null>(null);
  const [recordedDepositHash, setRecordedDepositHash] = useState<string | null>(null);

  function clearDepositFeedback() {
    setErrorMessage(null);
    setMessage(null);
  }

  useEffect(() => {
    if (approveConfirmed) {
      void refetchAllowance();
      setErrorMessage(null);
      setMessage("Approval confirmed. You can deposit now.");
    }
  }, [approveConfirmed, refetchAllowance]);

  useEffect(() => {
    if (depositConfirmed || queueDepositConfirmed) {
      const confirmedHash = queueDepositConfirmed ? queueDepositHash : depositHash;
      if (userAuthorized && confirmedHash && recordedDepositHash !== confirmedHash) {
        void postRecordDepositActivity(vaultId, {
          txHash: confirmedHash,
          assets: submittedDepositAmount ?? undefined,
          mode: queueDepositConfirmed ? "queued" : "minted",
        }).catch(() => undefined);
        setRecordedDepositHash(confirmedHash);
      }

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
    depositHash,
    onSuccess,
    queueDepositConfirmed,
    queueDepositHash,
    recordedDepositHash,
    refetchAllowance,
    resetApprove,
    resetDeposit,
    resetQueueDeposit,
    submittedDepositAmount,
    userAuthorized,
    vaultId,
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
    clearDepositFeedback();

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
    if (!parsedAmount || !address || actionPending || cycle?.executionMode === "blocked") {
      return;
    }

    setDepositPreflightPending(true);
    clearDepositFeedback();
    resetDeposit();
    resetQueueDeposit();

    try {
      const latestCycleResult = await refetchCycleStatus();
      const latestCycle =
        typeof latestCycleResult === "object" && latestCycleResult && "cycle" in latestCycleResult
          ? ((latestCycleResult as { cycle?: Cycle | null }).cycle ?? cycle)
          : cycle;

      if (isCustomVault) {
        if (latestCycle?.executionMode === "queued") {
          setSubmittedDepositAmount(amount);
          queueDeposit(vault.config.vaultAddress as `0x${string}`, parsedAmount);
          return;
        }

        if (latestCycle?.executionMode === "instant" && latestCycle.telemetryFresh === true) {
          const refreshed = await ensureFreshNav();
          if (!refreshed) {
            return;
          }
          setSubmittedDepositAmount(amount);
          deposit(
            vault.config.vaultAddress as `0x${string}`,
            parsedAmount,
            address as `0x${string}`,
          );
          return;
        }

        if (latestCycle?.executionMode === "blocked") {
          return;
        }

        setSubmittedDepositAmount(amount);
        queueDeposit(vault.config.vaultAddress as `0x${string}`, parsedAmount);
        return;
      }

      const refreshed = await ensureFreshNav();
      if (!refreshed) {
        return;
      }

      setSubmittedDepositAmount(amount);
      deposit(vault.config.vaultAddress as `0x${string}`, parsedAmount, address as `0x${string}`);
    } finally {
      setDepositPreflightPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <RailStat label="Deposit state" value={getDepositActionLabel(vault, cycle)} />
        <RailStat label="NAV" value={nav ? formatSharePrice(nav.sharePrice) : "--"} />
        <RailStat label="Min deposit" value={formatCurrency(vault.profile.minDeposit)} />
        <RailStat
          label="Wallet balance"
          value={balanceLoading ? "Loading..." : `${formatted} USDC.e`}
        />
      </div>

      {!walletConnected && <p className="text-[11px] text-slate-400">Connect wallet to deposit.</p>}

      <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="vault-deposit-amount" className="text-xs text-slate-400">
            Amount
          </label>
          <button
            type="button"
            onClick={() => {
              setAmount(formatted);
              clearDepositFeedback();
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
            clearDepositFeedback();
            resetApprove();
            resetDeposit();
            resetQueueDeposit();
          }}
          disabled={actionPending}
          className="h-10 rounded-[2px] border border-[#212121] bg-transparent px-3 font-mono text-sm text-white placeholder:text-slate-500"
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
              clearDepositFeedback();
              resetApprove();
              approve(vault.config.vaultAddress as `0x${string}`, parsedAmount);
            }
          }}
          disabled={!walletConnected || !address || !isValidAmount || actionPending}
          className="h-12 w-full rounded-[10px] bg-white text-black hover:bg-white/90"
        >
          {approvePending || approveConfirming ? "Approving..." : "Approve USDC.e"}
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
          className="h-12 w-full rounded-[10px] bg-white text-black hover:bg-white/90"
        >
          {navSyncPending || depositPreflightPending
            ? "Loading..."
            : depositPending || depositConfirming || queueDepositPending || queueDepositConfirming
              ? isCustomVault && cycle?.executionMode === "queued"
                ? "Queuing..."
                : "Depositing..."
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
  vaultId,
  cycle,
  onSuccess,
  walletConnected,
  walletAddress,
  userAuthorized,
  customPendingRequests,
  customClaimableRequests,
}: {
  vault: VaultInstance;
  vaultId: number;
  cycle: Cycle | null;
  onSuccess: () => void;
  walletConnected: boolean;
  walletAddress: string | undefined;
  userAuthorized: boolean;
  customPendingRequests: RedemptionRequest[];
  customClaimableRequests: RedemptionRequest[];
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
  const [claimSubmissionInFlight, setClaimSubmissionInFlight] = useState(false);
  const [claimingCustomRequestId, setClaimingCustomRequestId] = useState<string | null>(null);
  const [claimingCustomSnapshot, setClaimingCustomSnapshot] = useState<{
    requestId: string;
    shares: string;
    assets?: string;
  } | null>(null);
  const [navSyncPending, setNavSyncPending] = useState(false);
  const [claimPreflightPending, setClaimPreflightPending] = useState(false);

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

  const rawQueueActiveRequest =
    queueData?.requests.find(
      (request) => request.status === "pending" || request.status === "ready",
    ) ?? null;
  const customClaimableRequest = customClaimableRequests[0] ?? null;
  const customPendingRequest = customPendingRequests[0] ?? null;
  const queueActiveRequest =
    isCustomVault && rawQueueActiveRequest?.status === "ready" && customClaimableRequest
      ? null
      : rawQueueActiveRequest;
  const readyQueueRequest = queueActiveRequest?.status === "ready" ? queueActiveRequest : null;
  const readyRequestShares = readyQueueRequest
    ? getParsedUnits(readyQueueRequest.shares, 6)
    : undefined;
  const { assets: readyPreviewAssets, refetch: refetchReadyPreviewAssets } = usePreviewRedeem(
    vault.config.vaultAddress,
    readyRequestShares,
    isCustomVault,
  );

  const readyLiveEstimatedAssets =
    readyQueueRequest && readyPreviewAssets !== undefined
      ? Number(formatUnits(readyPreviewAssets, 6))
      : Number.NaN;
  const displayedEstimatedAssets =
    readyQueueRequest && Number.isFinite(readyLiveEstimatedAssets)
      ? readyLiveEstimatedAssets
      : queueActiveRequest
        ? Number.parseFloat(
            (queueActiveRequest as { assetsEstimated?: string; claimableAssets?: string | null })
              .assetsEstimated ??
              (queueActiveRequest as { claimableAssets?: string | null }).claimableAssets ??
              "0",
          )
        : customClaimableRequest?.claimableAssetsFormatted
          ? Number.parseFloat(customClaimableRequest.claimableAssetsFormatted)
          : effectivePreviewAssets !== undefined
            ? Number(formatUnits(effectivePreviewAssets, 6))
            : 0;
  const hasBlockingRequest = Boolean(
    queueActiveRequest || customClaimableRequest || customPendingRequest,
  );
  const withdrawActionLabel = getWithdrawActionLabel({
    isBlockedMode,
    hasQueuedRequest: Boolean(queueActiveRequest || customPendingRequest),
    hasClaimReady: Boolean(readyQueueRequest || customClaimableRequest),
  });

  useEffect(() => {
    if (!effectiveConnectedUI) {
      setErrorMessage(null);
      setMessage(null);
      setClaimingRequestId(null);
      setClaimSubmissionInFlight(false);
      setClaimPreflightPending(false);
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
        setClaimSubmissionInFlight(false);
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
        setClaimSubmissionInFlight(false);
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
    if (!isConfirmed || !hash || !claimingCustomRequestId || !claimingCustomSnapshot) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await postRecordClaimActivity(vaultId, {
          txHash: hash,
          requestId: claimingCustomSnapshot.requestId,
          shares: claimingCustomSnapshot.shares,
          assets: claimingCustomSnapshot.assets,
        });

        if (cancelled) {
          return;
        }

        setMessage("Withdrawal claim submitted.");
        setErrorMessage(null);
      } catch (recordError) {
        if (cancelled) {
          return;
        }

        setMessage("Withdrawal claim submitted.");
        setErrorMessage(
          `Claim succeeded (${truncateId(hash, 12)}) but activity sync failed: ${
            recordError instanceof Error ? recordError.message : "Unknown error"
          }`,
        );
      } finally {
        if (!cancelled) {
          setClaimSubmissionInFlight(false);
          setClaimingCustomRequestId(null);
          setClaimingCustomSnapshot(null);
          setAmount("");
          reset();
          void Promise.all([refetchShares(), refetchQueue(), onSuccess()]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    claimingCustomRequestId,
    claimingCustomSnapshot,
    hash,
    isConfirmed,
    onSuccess,
    refetchQueue,
    refetchShares,
    reset,
    vaultId,
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
      setClaimSubmissionInFlight(false);
      setClaimPreflightPending(false);
    }
  }, [claimingRequestId, error]);

  useEffect(() => {
    if (!error || !claimingCustomRequestId) {
      return;
    }

    setErrorMessage(error.message);
    setMessage(null);
    setClaimingCustomRequestId(null);
    setClaimingCustomSnapshot(null);
  }, [claimingCustomRequestId, error]);

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
    if (!parsedShares || parsedShares > effectiveShares || isBlockedMode || queuePending) {
      return;
    }

    setQueuePending(true);
    setErrorMessage(null);
    setMessage(null);
    reset();

    try {
      const refreshed = await ensureFreshNav();
      if (!refreshed) {
        return;
      }

      const latestPreview = await refetchPreviewAssets();
      if (latestPreview === undefined || latestPreview <= 0n) {
        setErrorMessage("Unable to estimate redeemable assets. Please try again in a few seconds.");
        return;
      }

      const result = await postWithdrawalRequest(
        formatUnits(parsedShares, 6),
        formatUnits(latestPreview, 6),
        vaultId,
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
    if (
      !readyQueueRequest ||
      !effectiveAddress ||
      !userAuthorized ||
      claimSubmissionInFlight ||
      claimPreflightPending ||
      isPending ||
      isConfirming
    ) {
      return;
    }

    setClaimPreflightPending(true);
    reset();
    setClaimingRequestId(null);
    setErrorMessage(null);
    setMessage(null);

    try {
      const refreshed = await ensureFreshNav();
      if (!refreshed) {
        return;
      }

      let requestToClaim = readyQueueRequest;

      try {
        if (isCustomVault) {
          const preflight = await preflightWithdrawal(readyQueueRequest.requestId);
          if (!preflight.ready) {
            setErrorMessage(
              preflight.error ?? "Withdrawal liquidity is not ready yet. Please retry.",
            );
            return;
          }
          requestToClaim = preflight.request ?? readyQueueRequest;
        } else {
          const prepared = await postPrepareWithdrawalRequest(readyQueueRequest.requestId);
          requestToClaim = prepared.request ?? readyQueueRequest;
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
      setClaimSubmissionInFlight(true);

      redeem(
        vault.config.vaultAddress as `0x${string}`,
        requestShares,
        effectiveAddress,
        effectiveAddress,
      );
    } finally {
      setClaimPreflightPending(false);
    }
  }

  function handleClaimCustomRequest() {
    if (
      !customClaimableRequest ||
      !effectiveAddress ||
      claimSubmissionInFlight ||
      isPending ||
      isConfirming
    ) {
      return;
    }

    setClaimSubmissionInFlight(true);
    setClaimingCustomRequestId(customClaimableRequest.requestId);
    setClaimingCustomSnapshot({
      requestId: customClaimableRequest.requestId,
      shares: customClaimableRequest.sharesFormatted,
      assets: customClaimableRequest.claimableAssetsFormatted ?? undefined,
    });
    setErrorMessage(null);
    setMessage(null);
    reset();

    try {
      redeem(
        vault.config.vaultAddress as `0x${string}`,
        parseUnits(customClaimableRequest.sharesFormatted, 6),
        effectiveAddress,
        (customClaimableRequest.ownerAddress ||
          customClaimableRequest.controllerAddress ||
          effectiveAddress) as `0x${string}`,
      );
    } catch (claimError) {
      setClaimingCustomRequestId(null);
      setClaimingCustomSnapshot(null);
      setClaimSubmissionInFlight(false);
      setErrorMessage(
        claimError instanceof Error ? claimError.message : "Failed to claim withdrawal.",
      );
    }
  }

  async function handleCancelWithdrawalRequest() {
    if (!queueActiveRequest || queuePending) {
      return;
    }

    setQueuePending(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const result = await postCancelWithdrawalRequest(queueActiveRequest.requestId);
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
    !effectiveAddress ||
    !userAuthorized ||
    !isValidAmount ||
    parsedShares > effectiveShares ||
    queuePending ||
    navSyncPending ||
    isPending ||
    isConfirming ||
    hasBlockingRequest ||
    effectivePreviewAssets === undefined ||
    effectivePreviewAssets <= 0n;

  const claimDisabled =
    !userAuthorized ||
    !readyQueueRequest ||
    !effectiveAddress ||
    queuePending ||
    navSyncPending ||
    claimSubmissionInFlight ||
    claimPreflightPending ||
    isPending ||
    isConfirming;
  const customClaimDisabled =
    !userAuthorized ||
    !customClaimableRequest ||
    !effectiveAddress ||
    queuePending ||
    claimSubmissionInFlight ||
    isPending ||
    isConfirming;

  function clearWithdrawalFeedback() {
    setErrorMessage(null);
    setMessage(null);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <RailStat label="Exit state" value={withdrawActionLabel} />
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

      {effectiveConnectedUI && !userAuthorized && !usingE2eConnectedSeam && !isCustomVault && (
        <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] px-4 py-3 text-sm text-slate-300">
          Sign in to request a withdrawal.
        </div>
      )}

      <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4">
        <div className="mb-3 flex items-center justify-between">
          <label htmlFor="vault-withdraw-amount" className="text-sm text-slate-300">
            Amount
          </label>
          <button
            type="button"
            onClick={() => {
              setAmount(effectiveFormattedShares);
              clearWithdrawalFeedback();
              reset();
            }}
            disabled={queuePending || isPending || isConfirming || hasBlockingRequest}
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
            clearWithdrawalFeedback();
            reset();
          }}
          disabled={queuePending || isPending || isConfirming || hasBlockingRequest}
          className="h-14 rounded-[2px] border-[#212121] bg-transparent px-4 font-mono text-lg text-white placeholder:text-slate-500"
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>How claims work</span>
        <InfoTooltip
          label="How claims work"
          content="After your exit request is processed and settlement is complete, your redeemed USDC becomes claimable."
        />
      </div>

      {!hasBlockingRequest &&
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
        className="h-12 w-full rounded-[10px] bg-white text-black hover:bg-white/90"
      >
        {queuePending
          ? "Submitting..."
          : !userAuthorized
            ? "Sign in to request"
            : navSyncPending
              ? "Refreshing NAV..."
              : isBlockedMode
                ? "Withdrawal blocked"
                : "Request withdrawal"}
      </Button>

      {walletConnected && !userAuthorized && (
        <p className="text-xs leading-6 text-amber-200/90">
          Sign in with Ethereum first so the withdrawal request can be recorded and tracked.
        </p>
      )}

      {queueActiveRequest && (
        <div className="space-y-3 rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-50">
          <p className="text-sm font-medium">
            {readyQueueRequest
              ? "Claim is ready"
              : `Withdrawal ${queueActiveRequest.requestId} is queued`}
          </p>
          <p className="text-xs leading-6 text-amber-50/90">
            {readyQueueRequest
              ? "Settlement is complete. Sign the claim transaction to receive USDC.e."
              : "Your exit request is queued. You can leave it in queue or cancel it before claiming."}
          </p>
          <p className="text-xs leading-6 text-amber-50/90">
            Estimated payout: {formatCurrency(displayedEstimatedAssets || 0)}
          </p>
          <p className="text-xs leading-6 text-amber-50/90">
            Requested: {formatDate(queueActiveRequest.requestedAt)}
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {readyQueueRequest && (
              <Button
                type="button"
                onClick={() => {
                  void handleClaimReadyWithdrawal();
                }}
                disabled={claimDisabled}
                className="h-11 rounded-[10px] bg-white text-black hover:bg-white/90"
              >
                {claimSubmissionInFlight || claimPreflightPending || isPending || isConfirming
                  ? "Claiming..."
                  : "Claim withdrawal"}
              </Button>
            )}
            {!readyQueueRequest && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void handleCancelWithdrawalRequest();
                }}
                disabled={queuePending || isPending || isConfirming}
                className="h-11 rounded-[10px] border-[#656565]/40 bg-transparent text-white hover:bg-[#212121]"
              >
                Cancel request
              </Button>
            )}
          </div>
        </div>
      )}

      {customClaimableRequest && (
        <div className="space-y-3 rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-50">
          <p className="text-sm font-medium">
            {customClaimableRequest.requestKind === "controller_claimable"
              ? "Claimable balance is ready"
              : "Claim is ready"}
          </p>
          <p className="text-xs leading-6 text-emerald-50/90">
            {customClaimableRequest.requestKind === "controller_claimable"
              ? "Flat-book vaults keep one aggregated claimable balance per wallet. This amount can include older settled withdrawals, so it is not tied to a single request row."
              : "This withdrawal was already settled on-chain. Claiming it is a separate action and does not happen automatically."}
          </p>
          <p className="text-xs leading-6 text-emerald-50/90">
            Claimable now:{" "}
            {formatCurrency(Number(customClaimableRequest.claimableAssetsFormatted ?? "0"))}
          </p>
          {customClaimableRequest.requestKind !== "controller_claimable" && (
            <p className="text-xs leading-6 text-emerald-50/90">
              Requested: {formatDate(customClaimableRequest.createdAt)}
            </p>
          )}
          <Button
            type="button"
            onClick={handleClaimCustomRequest}
            disabled={customClaimDisabled || !customClaimableRequest.claimableAssetsFormatted}
            className="h-11 rounded-[10px] bg-white text-black hover:bg-white/90"
          >
            {isPending || isConfirming ? "Claiming..." : "Claim withdrawal"}
          </Button>
        </div>
      )}

      {!queueActiveRequest && !customClaimableRequest && customPendingRequest && (
        <div className="space-y-3 rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-50">
          <p className="text-sm font-medium">Withdrawal is queued</p>
          <p className="text-xs leading-6 text-amber-50/90">
            An older on-chain withdrawal request is already pending settlement. It will remain
            visible here and in activity until it becomes claimable.
          </p>
          <p className="text-xs leading-6 text-amber-50/90">
            Requested: {formatDate(customPendingRequest.createdAt)}
          </p>
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

export default function VaultDetailPage() {
  const queryClient = useQueryClient();
  const [e2eConnectedSeam, setE2eConnectedSeam] = useState(false);
  const [sessionAuthenticated, setSessionAuthenticated] = useState(false);
  const [vaultActivityOffset, setVaultActivityOffset] = useState(0);
  const [userActivityOffset, setUserActivityOffset] = useState(0);

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
    setVaultActivityOffset(0);
    setUserActivityOffset(0);
  }, [routeVaultId]);

  useEffect(() => {
    setUserActivityOffset(0);
  }, [address, walletConnected, sessionAuthenticated]);

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
  } = useVaultNavHistory(undefined, vault?.id);
  const {
    cycle,
    isLoading: cycleLoading,
    error: cycleError,
    refetch: refetchCycleStatus,
  } = useCycleStatus(vault?.id);
  const {
    pendingRequests,
    claimableRequests,
    isLoading: requestsLoading,
  } = useRequests(vault?.id, userAuthorized);
  const {
    data: vaultEventsData,
    isLoading: vaultEventsLoading,
    error: vaultEventsError,
    lastRefresh: vaultEventsLastRefresh,
  } = useVaultEvents(vault?.id, ACTIVITY_PAGE_SIZE, {
    offset: vaultActivityOffset,
  });
  const { data: tradingAnalyticsData } = useVaultTradingAnalytics(vault?.id);
  const {
    data: userHistoryData,
    isLoading: userHistoryLoading,
    error: userHistoryError,
  } = useUserVaultHistory(
    vault?.id,
    userAuthorized,
    address,
    ACTIVITY_PAGE_SIZE,
    userActivityOffset,
  );
  const { shares: redemptionUserShares } = useVaultShares(
    vault?.config.vaultAddress,
    address,
    vault?.type === "custom" ? 6 : 18,
  );

  const refreshAll = async () => {
    await Promise.all([invalidateVaultQueries(queryClient, vault?.id), refetchNavHistory()]);
  };

  const performance = useMemo(
    () => deriveVaultPerformanceStats(navHistoryData?.snapshots ?? []),
    [navHistoryData?.snapshots],
  );

  const networkInfo = getNetworkDisplayInfo(VAULT_NETWORK);
  const tags = vault
    ? [
        vault.profile.strategyLabel,
        getHeroStateLabel(vault, cycle),
        `${toTitleCase(vault.profile.riskLevel)} risk`,
      ]
    : [];

  const vaultActivity = useMemo(
    () => mapFeedItemsToTimeline((vaultEventsData?.items ?? []).filter(isMeaningfulActivity)),
    [vaultEventsData?.items],
  );

  const userActivity = useMemo(
    () => mapFeedItemsToTimeline(userHistoryData?.items ?? []),
    [userHistoryData?.items],
  );

  const vaultActivityHasMore = vaultEventsData?.pagination?.hasMore ?? false;
  const userActivityHasMore = userHistoryData?.pagination?.hasMore ?? false;

  useEffect(() => {
    if (vaultEventsLoading || vaultEventsError || vaultActivityOffset === 0) {
      return;
    }

    if (vaultActivity.length === 0) {
      setVaultActivityOffset((previous) => Math.max(previous - ACTIVITY_PAGE_SIZE, 0));
    }
  }, [vaultActivity.length, vaultActivityOffset, vaultEventsError, vaultEventsLoading]);

  useEffect(() => {
    if (!userAuthorized || userHistoryLoading || userHistoryError || userActivityOffset === 0) {
      return;
    }

    if (userActivity.length === 0) {
      setUserActivityOffset((previous) => Math.max(previous - ACTIVITY_PAGE_SIZE, 0));
    }
  }, [
    userActivity.length,
    userActivityOffset,
    userAuthorized,
    userHistoryError,
    userHistoryLoading,
  ]);

  if (!vault && !instancesLoading) {
    return <VaultNotFound />;
  }

  if (!vault) {
    return (
      <main className="flex-1 px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
        <div className="mx-auto max-w-6xl space-y-6">
          <Skeleton className="h-10 w-40 bg-white/10" />
          <Skeleton className="h-[220px] w-full rounded-[2px] bg-[#212121]" />
          <Skeleton className="h-[540px] w-full rounded-[2px] bg-[#212121]" />
        </div>
      </main>
    );
  }

  const heroMetrics = [
    {
      label: "APY",
      value: "--",
      hint: "Exact APY is not published yet.",
      tooltip: "APY will appear once a canonical vault APY source is available.",
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

              <section className="relative overflow-hidden rounded-[2px] border border-[#212121] bg-[#121212] px-6 py-7 shadow-none sm:px-8 lg:px-10 lg:py-9">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(137,145,130,0.16),_transparent_32%),radial-gradient(circle_at_85%_18%,_rgba(236,102,0,0.15),_transparent_18%)]" />
                <div className="relative grid gap-8">
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                        Vault
                      </p>
                      <div className="inline-flex items-center gap-2 rounded-[2px] border border-[#656565]/40 bg-[#0A0A0A] px-3 py-1 text-xs text-slate-300">
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
                        {getHeroSentence(vault)}
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
                        tradingAnalyticsData?.analytics
                          ? `${(tradingAnalyticsData.analytics.winRate * 100).toFixed(1)}%`
                          : "--"
                      }
                      tone="neutral"
                      tooltip={
                        tradingAnalyticsData?.analytics
                          ? `Resolved-position win rate based on ${tradingAnalyticsData.analytics.positionCount} settled positions. Last refreshed ${formatDate(tradingAnalyticsData.analytics.computedAt)}.`
                          : "Resolved-position win rate for this vault."
                      }
                    />
                  </div>
                </div>
              </SectionShell>

              <SectionShell title="Strategy & Operator">
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <KeyInfoItem label="Managed by" value={getManagementLabel(vault)} />
                    <KeyInfoItem label="Infra" value={getInfraLabel(vault)} />
                    <KeyInfoItem label="Focus" value={vault.profile.strategyLabel} />
                    <KeyInfoItem label="Style" value={getStyleLabel(vault)} />
                  </div>
                  <div className="flex flex-col gap-4 rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-sm font-medium text-white">
                        Technical details are available on demand.
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-400">
                        Keep the main surface focused on mandate and operator context, then open the
                        drawer for contract addresses and live wallet balances.
                      </p>
                    </div>
                    <TechnicalDetailsDialog vault={vault} status={status} />
                  </div>
                </div>
              </SectionShell>

              <SectionShell title="Risk & Terms">
                <div className="grid gap-4 md:grid-cols-3">
                  <SummaryMetric
                    label="Risk score"
                    value={getRiskScore(vault.profile.riskLevel)}
                    hint={`${toTitleCase(vault.profile.riskLevel)} risk mandate.`}
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
                <div className="mt-5 rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-5 text-sm leading-7 text-slate-400">
                  {getRiskSummary(vault, cycle)}
                </div>
              </SectionShell>

              <SectionShell title="Activity">
                <div className="mb-4 flex items-center justify-between text-xs text-slate-400">
                  <span>Meaningful vault updates only</span>
                  <span>
                    Updated{" "}
                    {vaultEventsLastRefresh
                      ? formatDate(vaultEventsLastRefresh.toISOString())
                      : "--"}
                  </span>
                </div>
                {vaultEventsLoading ? (
                  <Skeleton className="h-40 w-full rounded-[22px] bg-white/10" />
                ) : vaultEventsError ? (
                  <div className="rounded-[22px] border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-100">
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
                      pageSize={ACTIVITY_PAGE_SIZE}
                      currentCount={vaultActivity.length}
                      hasMore={vaultActivityHasMore}
                      isLoading={vaultEventsLoading}
                      onPrevious={() => {
                        setVaultActivityOffset((previous) =>
                          Math.max(previous - ACTIVITY_PAGE_SIZE, 0),
                        );
                      }}
                      onNext={() => {
                        if (vaultActivityHasMore) {
                          setVaultActivityOffset((previous) => previous + ACTIVITY_PAGE_SIZE);
                        }
                      }}
                    />
                  </div>
                )}
              </SectionShell>

              <SectionShell title="Your activity">
                {userAuthorized ? (
                  userHistoryLoading ? (
                    <Skeleton className="h-40 w-full rounded-[22px] bg-white/10" />
                  ) : userHistoryError ? (
                    <div className="rounded-[22px] border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-100">
                      {userHistoryError}
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
                        pageSize={ACTIVITY_PAGE_SIZE}
                        currentCount={userActivity.length}
                        hasMore={userActivityHasMore}
                        isLoading={userHistoryLoading}
                        onPrevious={() => {
                          setUserActivityOffset((previous) =>
                            Math.max(previous - ACTIVITY_PAGE_SIZE, 0),
                          );
                        }}
                        onNext={() => {
                          if (userActivityHasMore) {
                            setUserActivityOffset((previous) => previous + ACTIVITY_PAGE_SIZE);
                          }
                        }}
                      />
                    </div>
                  )
                ) : (
                  <div className="rounded-[22px] border border-white/10 bg-slate-950/30 p-5 text-sm text-slate-400">
                    Sign in to view your deposit, withdrawal, and claim history.
                  </div>
                )}
              </SectionShell>

              {vault.type !== "custom" && (
                <SectionShell
                  id="exit-queue"
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
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-0.5">
                  <TabsTrigger
                    value="deposit"
                    className="rounded-[2px] py-1.5 text-sm text-slate-400 hover:text-white data-[state=active]:border data-[state=active]:border-[#656565]/40 data-[state=active]:bg-[#212121] data-[state=active]:text-white"
                  >
                    Deposit
                  </TabsTrigger>
                  <TabsTrigger
                    value="withdraw"
                    className="rounded-[2px] py-1.5 text-sm text-slate-400 hover:text-white data-[state=active]:border data-[state=active]:border-[#656565]/40 data-[state=active]:bg-[#212121] data-[state=active]:text-white"
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
                    userAuthorized={userAuthorized}
                    vaultId={vault.id}
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
                      vaultId={vault.id}
                      cycle={cycle}
                      walletConnected={walletConnected}
                      walletAddress={address}
                      userAuthorized={userAuthorized}
                      customPendingRequests={pendingRequests}
                      customClaimableRequests={claimableRequests}
                      onSuccess={() => {
                        void refreshAll();
                      }}
                    />
                  ) : (
                    <div className="space-y-4 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 text-sm leading-7 text-slate-300">
                      <div>
                        Standard vault exits use the full request, pending, and claim flow in Exit
                        Queue so you can track readiness and claim from one place.
                      </div>
                      <Button
                        asChild
                        className="w-full rounded-full bg-white text-slate-950 hover:bg-slate-100"
                      >
                        <a href="#exit-queue">Open Exit Queue</a>
                      </Button>
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
