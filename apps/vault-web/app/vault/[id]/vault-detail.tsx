"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatUnits, parseUnits } from "viem";
import { useAppKitAccount } from "@reown/appkit/react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Separator } from "@workspace/ui/components/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  useVaultInstances,
  useVaultStatus,
  useVaultPositions,
  useVaultNavHistory,
  useVaultPositionHistory,
  useVaultAllocations,
  useWithdrawalQueue,
  useWalletBalance,
  useUsdcAllowance,
  useVaultShares,
  useVaultOnChainStats,
  usePreviewDeposit,
  usePreviewRedeem,
  useQueueDeposit,
  useUsdcApprove,
  useVaultDeposit,
  useVaultRedeem,
  useRequests,
  useEpochStatus,
  useDepositQueue,
  useEpochHistory,
} from "../../../src/lib/hooks";
import {
  postCancelWithdrawalRequest,
  postCompleteWithdrawalRequest,
  postPrepareWithdrawalRequest,
  postVaultNavUpdate,
  postWithdrawalRequest,
} from "../../../src/lib/api";
import type {
  Epoch,
  VaultAllocation,
  VaultInstance,
  VaultNavHistoryItem,
  VaultPosition,
} from "../../../src/types";
import { RedemptionPanel } from "./components";
import {
  EXPLORER_BASE_URL,
  VAULT_NETWORK,
  SUPPORTS_POLYMARKET_TRADING,
} from "../../../src/constants";
import { getNetworkDisplayInfo } from "../../../src/lib/network";

// ============================================
// Formatters
// ============================================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSharePrice(value: number): string {
  return `$${value.toFixed(4)}`;
}

function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// ============================================
// Stat Card
// ============================================

function StatCard({
  title,
  value,
  subtitle,
  tooltip,
  isLoading,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tooltip?: string;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-white p-4">
      <p
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        title={tooltip}
      >
        {title}
      </p>
      {isLoading ? (
        <div className="mt-2 space-y-1">
          <Skeleton className="h-7 w-24" />
          {subtitle && <Skeleton className="h-3 w-16" />}
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      )}
    </div>
  );
}

function NavSparkline({ snapshots }: { snapshots: VaultNavHistoryItem[] }) {
  if (snapshots.length < 2) {
    return (
      <div className="rounded-lg border border-border/50 bg-white p-4 text-xs text-muted-foreground">
        Not enough NAV history yet to render chart.
      </div>
    );
  }

  const series = [...snapshots].reverse();
  const values = series.map((item) => Number.parseFloat(item.totalAssets));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.000001);

  const width = 640;
  const height = 140;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const latest = values[values.length - 1] ?? 0;
  const first = values[0] ?? latest;
  const delta = latest - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : 0;

  return (
    <div className="rounded-lg border border-border/50 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          NAV Trend
        </p>
        <p className="text-xs text-muted-foreground">
          {formatCurrency(first)} {"->"} {formatCurrency(latest)} ({delta >= 0 ? "+" : ""}
          {deltaPct.toFixed(2)}%)
        </p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="3"
          points={points}
        />
      </svg>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Last {series.length} snapshots (newest:{" "}
        {formatDate(series[series.length - 1]?.timestamp ?? "")})
      </p>
    </div>
  );
}

// ============================================
// Network Badge
// ============================================

function NetworkBadge({ network }: { network: "mainnet" | "amoy" }) {
  const displayInfo = getNetworkDisplayInfo(network);
  const { badgeClasses } = displayInfo;

  return (
    <Badge
      variant="outline"
      className={`gap-1.5 font-normal ${badgeClasses.border} ${badgeClasses.bg} ${badgeClasses.text}`}
      title={displayInfo.isTestnet ? "Testnet - Polymarket trading disabled" : "Mainnet"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${badgeClasses.dot}`} />
      {displayInfo.name}
    </Badge>
  );
}

// ============================================
// Mode Badge
// ============================================
// Mode Badge
// ============================================

function ModeBadge({ mode }: { mode: "simulation" | "live" }) {
  return (
    <Badge
      variant="outline"
      className={`text-xs font-medium ${
        mode === "live"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
          : "border-amber-500/30 bg-amber-500/10 text-amber-600"
      }`}
    >
      {mode === "live" ? "Live Trading" : "Simulation"}
    </Badge>
  );
}

function EpochLifecycleCard({
  epoch,
  queuedFormatted,
  targetEpochId,
  activationTime,
  isLoading,
}: {
  epoch: Epoch | null;
  queuedFormatted: string;
  targetEpochId: number | null;
  activationTime: string | null;
  isLoading: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Epoch Schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {isLoading || !epoch ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/50 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current Epoch
                </p>
                <p className="mt-1 text-lg font-semibold">#{epoch.epochId}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(epoch.startTime)} {"->"} {formatDateTime(epoch.endTime)}
                </p>
              </div>
              <div className="rounded-lg border border-border/50 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Next Boundary
                </p>
                <p className="mt-1 text-lg font-semibold">{epoch.timeRemainingFormatted}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Current epoch ends at {formatDateTime(epoch.endTime)}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-900">
              <p className="text-sm font-medium">How deposits work</p>
              <p className="mt-1 text-sm">
                Deposits made now queue for epoch #{targetEpochId ?? epoch.epochId + 1}. They start
                earning only after current epoch #{epoch.epochId} ends and the next epoch opens.
              </p>
              <p className="mt-2 text-xs text-sky-800">
                {Number(queuedFormatted) > 0
                  ? `You currently have ${queuedFormatted} USDC queued. Activation is expected around ${activationTime ? formatDateTime(activationTime) : formatDateTime(epoch.endTime)}.`
                  : `If you deposit now, it should activate around ${activationTime ? formatDateTime(activationTime) : formatDateTime(epoch.endTime)}.`}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DepositQueueCard({
  queuedFormatted,
  queuedSharesFormatted,
  estimateNavFormatted,
  estimateBasis,
  depositRequestId,
  depositCreatedAt,
  targetEpochId,
  activationTime,
  queueStatus,
  mintRule,
  isLoading,
}: {
  queuedFormatted: string;
  queuedSharesFormatted: string;
  estimateNavFormatted: string;
  estimateBasis: string | null;
  depositRequestId: string | null;
  depositCreatedAt: string | null;
  targetEpochId: number | null;
  activationTime: string | null;
  queueStatus: string | null;
  mintRule: string | null;
  isLoading: boolean;
}) {
  const hasQueuedDeposit = Number(queuedFormatted) > 0;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Your Deposit Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-52" />
          </div>
        ) : hasQueuedDeposit ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs uppercase tracking-wide text-amber-700">Queued Deposit</p>
                <p className="mt-1 text-lg font-semibold text-amber-950">${queuedFormatted}</p>
                <p className="mt-1 text-xs text-amber-800">
                  Estimated shares at NAV ${Number(estimateNavFormatted || "0").toFixed(6)}:{" "}
                  {queuedSharesFormatted}
                </p>
                {estimateBasis && <p className="mt-1 text-xs text-amber-700">{estimateBasis}</p>}
              </div>
              <div className="rounded-lg border border-border/50 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Target Epoch
                </p>
                <p className="mt-1 text-lg font-semibold">#{targetEpochId ?? "-"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activationTime
                    ? `Expected activation: ${formatDateTime(activationTime)}`
                    : "Activation time pending"}
                </p>
              </div>
            </div>

            <div className="space-y-1 rounded-lg border border-border/50 bg-white p-3 text-xs text-muted-foreground">
              <p>Status: {queueStatus}</p>
              {depositRequestId && <p>Deposit request ID: {depositRequestId}</p>}
              {depositCreatedAt && <p>Queued at: {formatDateTime(depositCreatedAt)}</p>}
              <p>{mintRule}</p>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-border/50 bg-white p-3 text-sm text-muted-foreground">
            You have no queued deposit right now. Once you queue a deposit, this card will show the
            amount, target epoch, and when shares should activate.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EpochHistoryCard({
  epochs,
  isLoading,
}: {
  epochs: Array<{
    epochId: number;
    startTime: string;
    endTime: string;
    status: string;
    totalSharesPendingFormatted: string;
    frozenAssetsFormatted: string;
    snapshotNAVFormatted: string;
  }>;
  isLoading: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Recent Epochs</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : epochs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No epoch history yet. Once epochs freeze and settle, you will see what happened here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Epoch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Queued Shares</TableHead>
                <TableHead>Frozen Assets</TableHead>
                <TableHead>Snapshot NAV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {epochs.map((epoch) => (
                <TableRow key={epoch.epochId}>
                  <TableCell className="font-mono">#{epoch.epochId}</TableCell>
                  <TableCell>{epoch.status}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(epoch.startTime)} {"->"} {formatDateTime(epoch.endTime)}
                  </TableCell>
                  <TableCell>{epoch.totalSharesPendingFormatted}</TableCell>
                  <TableCell>{epoch.frozenAssetsFormatted}</TableCell>
                  <TableCell>{epoch.snapshotNAVFormatted}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// Deposit Form
// ============================================

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...`;
}

function getParsedUnits(value: string, decimals: number): bigint | undefined {
  if (!value) return undefined;
  try {
    return parseUnits(value, decimals);
  } catch {
    return undefined;
  }
}

function TxStatus({
  isPending,
  isConfirming,
  isConfirmed,
  hash,
  error,
}: {
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash?: string;
  error?: Error | null;
}) {
  const explorerUrl = hash ? `${EXPLORER_BASE_URL}/tx/${hash}` : undefined;

  if (error) {
    return <p className="text-xs text-rose-600">{error.message}</p>;
  }

  if (isPending) {
    return <p className="text-xs text-amber-600 animate-pulse">Confirm in wallet...</p>;
  }

  if (isConfirming && hash && explorerUrl) {
    return (
      <p className="text-xs text-amber-600">
        Transaction confirming...{" "}
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="font-mono underline">
          {truncateHash(hash)}
        </a>
      </p>
    );
  }

  if (isConfirmed && hash && explorerUrl) {
    return (
      <p className="text-xs text-emerald-600">
        Transaction confirmed!{" "}
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="font-mono underline">
          {truncateHash(hash)}
        </a>
      </p>
    );
  }

  return null;
}

function DepositForm({ vault, onSuccess }: { vault: VaultInstance; onSuccess?: () => void }) {
  const isCustomVault = vault.type === "custom";
  const { formatted, isConnected, isLoading: balanceLoading, address } = useWalletBalance();
  const [amount, setAmount] = useState("");
  const [navSyncPending, setNavSyncPending] = useState(false);
  const [navSyncError, setNavSyncError] = useState<string | null>(null);

  const parsedAmount = getParsedUnits(amount, 6);
  const isValidAmount = parsedAmount !== undefined && parsedAmount > 0n;
  const isAddressReady = Boolean(address && isConnected);

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
    hash: approveHash,
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

  useEffect(() => {
    if (approveConfirmed) {
      void refetchAllowance();
    }
  }, [approveConfirmed, refetchAllowance]);

  useEffect(() => {
    if (depositConfirmed || queueDepositConfirmed) {
      setAmount("");
      resetDeposit();
      resetQueueDeposit();
      resetApprove();
      void refetchAllowance();
      onSuccess?.();
    }
  }, [
    depositConfirmed,
    queueDepositConfirmed,
    onSuccess,
    refetchAllowance,
    resetApprove,
    resetDeposit,
    resetQueueDeposit,
  ]);

  const handleMax = () => {
    setAmount(formatted);
    resetApprove();
    resetDeposit();
  };

  const handleApprove = () => {
    if (!parsedAmount) return;
    setNavSyncError(null);
    approve(vault.config.vaultAddress as `0x${string}`, parsedAmount);
  };

  const ensureFreshNav = async (): Promise<boolean> => {
    setNavSyncPending(true);
    setNavSyncError(null);

    try {
      await postVaultNavUpdate();
      return true;
    } catch (error) {
      setNavSyncError(
        `Live NAV refresh failed. Please retry in a few seconds (${error instanceof Error ? error.message : "Unknown error"}).`,
      );
      return false;
    } finally {
      setNavSyncPending(false);
    }
  };

  const handleDeposit = async () => {
    if (!parsedAmount || !address) return;

    if (isCustomVault) {
      queueDeposit(vault.config.vaultAddress as `0x${string}`, parsedAmount);
      return;
    }

    const refreshed = await ensureFreshNav();
    if (!refreshed) return;

    deposit(vault.config.vaultAddress as `0x${string}`, parsedAmount, address as `0x${string}`);
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Deposit</CardTitle>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <p className="text-sm text-muted-foreground">Connect wallet to deposit</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="space-y-4"
          >
            {/* Wallet balance */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Wallet Balance</span>
              {balanceLoading ? (
                <Skeleton className="h-4 w-20" />
              ) : (
                <span className="font-medium font-mono">${formatted} USDC.e</span>
              )}
            </div>

            {/* Input with MAX */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    resetApprove();
                    resetDeposit();
                  }}
                  disabled={
                    approvePending ||
                    approveConfirming ||
                    depositPending ||
                    depositConfirming ||
                    queueDepositPending ||
                    queueDepositConfirming
                  }
                  className="pr-16 font-mono"
                />
                <button
                  type="button"
                  onClick={handleMax}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
                >
                  MAX
                </button>
              </div>
              {needsApproval ? (
                <Button
                  type="button"
                  onClick={handleApprove}
                  disabled={
                    !isAddressReady || !isValidAmount || approvePending || approveConfirming
                  }
                  className="min-w-[140px]"
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
                    !isAddressReady ||
                    !isValidAmount ||
                    depositPending ||
                    depositConfirming ||
                    queueDepositPending ||
                    queueDepositConfirming ||
                    approvePending ||
                    approveConfirming ||
                    navSyncPending
                  }
                  className="min-w-[100px]"
                >
                  {navSyncPending
                    ? "Refreshing NAV..."
                    : isCustomVault
                      ? "Queue Deposit"
                      : "Deposit"}
                </Button>
              )}
            </div>

            {/* Share conversion preview */}
            {!isCustomVault && previewShares !== undefined && parsedAmount && parsedAmount > 0n && (
              <p className="text-xs text-muted-foreground">
                You will receive ~
                <span className="font-mono">
                  {Number(formatUnits(previewShares, 6)).toFixed(6)}
                </span>{" "}
                shares
              </p>
            )}
            {isCustomVault && parsedAmount && parsedAmount > 0n && (
              <p className="text-xs text-muted-foreground">
                Deposit is queued for the next epoch. Shares mint when that epoch is processed using
                the epoch-open NAV.
              </p>
            )}

            {navSyncError && <p className="text-xs text-rose-600">{navSyncError}</p>}

            {/* Limits */}
            <p className="text-xs text-muted-foreground">
              Min: ${vault.profile.minDeposit} &middot; Max: ${vault.profile.maxDeposit}
            </p>

            <TxStatus
              isPending={depositPending || queueDepositPending || approvePending}
              isConfirming={depositConfirming || queueDepositConfirming || approveConfirming}
              isConfirmed={depositConfirmed || queueDepositConfirmed || approveConfirmed}
              hash={queueDepositHash ?? depositHash ?? approveHash}
              error={queueDepositError ?? depositError ?? approveError}
            />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// Withdraw Form
// ============================================

function WithdrawForm({ vault }: { vault: VaultInstance }) {
  const { isConnected, address } = useWalletBalance();
  const [amount, setAmount] = useState("");
  const [queuePending, setQueuePending] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [claimingRequestId, setClaimingRequestId] = useState<string | null>(null);
  const [navSyncPending, setNavSyncPending] = useState(false);

  const parsedShares = getParsedUnits(amount, 6);
  const isValidAmount = parsedShares !== undefined && parsedShares > 0n;

  const {
    shares,
    formatted: formattedShares,
    refetch: refetchShares,
  } = useVaultShares(vault.config.vaultAddress, address, vault.type === "custom" ? 6 : 18);
  const { assets: previewAssets, refetch: refetchPreviewAssets } = usePreviewRedeem(
    vault.config.vaultAddress,
    parsedShares,
  );
  const {
    data: queueData,
    isLoading: queueLoading,
    refetch: refetchQueue,
  } = useWithdrawalQueue(vault.config.vaultAddress);
  const { redeem, isPending, isConfirming, isConfirmed, hash, error, reset } = useVaultRedeem();

  const activeRequest = queueData?.requests.find(
    (request) => request.status === "pending" || request.status === "ready",
  );
  const readyRequest = activeRequest?.status === "ready" ? activeRequest : null;
  const readyRequestShares = readyRequest ? getParsedUnits(readyRequest.shares, 6) : undefined;
  const { assets: readyPreviewAssets, refetch: refetchReadyPreviewAssets } = usePreviewRedeem(
    vault.config.vaultAddress,
    readyRequestShares,
  );

  const activeEstimatedAssets = activeRequest
    ? Number.parseFloat(activeRequest.assetsEstimated)
    : Number.NaN;
  const readyLiveEstimatedAssets =
    readyRequest && readyPreviewAssets !== undefined
      ? Number(formatUnits(readyPreviewAssets, 6))
      : Number.NaN;
  const displayedEstimatedAssets =
    readyRequest && Number.isFinite(readyLiveEstimatedAssets)
      ? readyLiveEstimatedAssets
      : activeEstimatedAssets;

  useEffect(() => {
    if (!isConnected) {
      setQueueError(null);
      setQueueMessage(null);
      setClaimingRequestId(null);
    }
  }, [isConnected]);

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

        setQueueMessage(result.message);
        setQueueError(null);
        setClaimingRequestId(null);
        setAmount("");
        reset();
        await Promise.all([refetchQueue(), refetchShares()]);
      } catch (err) {
        if (cancelled) {
          return;
        }

        setQueueError(
          `Withdrawal sent (${truncateHash(hash)}) but queue update failed: ${
            err instanceof Error ? err.message : "Unknown error"
          }`,
        );
        setClaimingRequestId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [claimingRequestId, hash, isConfirmed, refetchQueue, refetchShares, reset]);

  useEffect(() => {
    if (error && claimingRequestId) {
      setClaimingRequestId(null);
    }
  }, [claimingRequestId, error]);

  const ensureFreshNav = async (): Promise<boolean> => {
    setNavSyncPending(true);
    setQueueError(null);

    try {
      await postVaultNavUpdate();
      return true;
    } catch (error) {
      setQueueError(
        `Live NAV refresh failed. Please retry in a few seconds (${error instanceof Error ? error.message : "Unknown error"}).`,
      );
      return false;
    } finally {
      setNavSyncPending(false);
    }
  };

  const handleRequestWithdrawal = async () => {
    if (!parsedShares || parsedShares > shares) return;

    setQueuePending(true);
    setQueueError(null);
    setQueueMessage(null);
    reset();

    try {
      const refreshed = await ensureFreshNav();
      if (!refreshed) return;

      const refreshedPreview = (await refetchPreviewAssets()) as { data?: bigint };
      const latestPreviewAssets = refreshedPreview.data ?? previewAssets;

      if (latestPreviewAssets === undefined || latestPreviewAssets <= 0n) {
        setQueueError("Unable to estimate redeemable assets. Please try again in a few seconds.");
        return;
      }

      const result = await postWithdrawalRequest(
        formatUnits(parsedShares, 6),
        formatUnits(latestPreviewAssets, 6),
      );

      setQueueMessage(result.message);
      setAmount("");
      await Promise.all([refetchQueue(), refetchShares()]);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Failed to queue withdrawal request");
    } finally {
      setQueuePending(false);
    }
  };

  const handleClaimReadyWithdrawal = async () => {
    if (!readyRequest || !address) return;

    setQueueError(null);
    setQueueMessage(null);

    const refreshed = await ensureFreshNav();
    if (!refreshed) return;

    let requestToClaim = readyRequest;
    try {
      const prepared = await postPrepareWithdrawalRequest(readyRequest.requestId);
      requestToClaim = prepared.request ?? readyRequest;

      await Promise.all([refetchQueue(), refetchShares(), refetchReadyPreviewAssets()]);

      if (requestToClaim.status !== "ready") {
        setQueueMessage(
          `Withdrawal ${requestToClaim.requestId} is ${requestToClaim.status}. Please wait for it to become ready again.`,
        );
        return;
      }
    } catch (err) {
      setQueueError(
        err instanceof Error ? err.message : "Failed to prepare withdrawal claim. Please retry.",
      );
      return;
    }

    let requestShares: bigint;
    try {
      requestShares = parseUnits(requestToClaim.shares, 6);
    } catch {
      setQueueError("Ready withdrawal request has invalid share amount.");
      return;
    }

    setClaimingRequestId(requestToClaim.requestId);

    redeem(
      vault.config.vaultAddress as `0x${string}`,
      requestShares,
      address as `0x${string}`,
      address as `0x${string}`,
    );
  };

  const handleCancelWithdrawalRequest = async () => {
    if (!activeRequest) return;

    setQueuePending(true);
    setQueueError(null);
    setQueueMessage(null);

    try {
      const result = await postCancelWithdrawalRequest(activeRequest.requestId);
      setQueueMessage(result.message);
      setAmount("");
      setClaimingRequestId(null);
      reset();
      await Promise.all([refetchQueue(), refetchShares(), refetchReadyPreviewAssets()]);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Failed to cancel withdrawal request");
    } finally {
      setQueuePending(false);
    }
  };

  const requestDisabled =
    !address ||
    !isValidAmount ||
    parsedShares > shares ||
    queuePending ||
    navSyncPending ||
    isPending ||
    isConfirming ||
    !!activeRequest ||
    previewAssets === undefined ||
    previewAssets <= 0n;

  const claimDisabled =
    !readyRequest || !address || queuePending || navSyncPending || isPending || isConfirming;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Withdraw</CardTitle>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <p className="text-sm text-muted-foreground">Connect wallet to withdraw</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Vault Share Balance</span>
              <span className="font-medium font-mono">
                {Number(formattedShares).toFixed(6)} shares
              </span>
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="number"
                  step="0.000001"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setQueueError(null);
                    setQueueMessage(null);
                    reset();
                  }}
                  disabled={isPending || isConfirming || queuePending || !!activeRequest}
                  className="pr-16 font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAmount(formattedShares);
                    setQueueError(null);
                    setQueueMessage(null);
                    reset();
                  }}
                  disabled={isPending || isConfirming || queuePending || !!activeRequest}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
                >
                  MAX
                </button>
              </div>
              <Button
                type="button"
                onClick={() => {
                  void handleRequestWithdrawal();
                }}
                disabled={requestDisabled}
                className="min-w-[100px]"
              >
                {queuePending
                  ? "Submitting..."
                  : navSyncPending
                    ? "Refreshing NAV..."
                    : "Request Withdrawal"}
              </Button>
            </div>

            {activeRequest && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-xs text-amber-700">
                  {activeRequest.status === "pending"
                    ? `Withdrawal ${activeRequest.requestId} is queued. Worker will move funds Safe -> Vault in FIFO order.`
                    : `Withdrawal ${activeRequest.requestId} is ready to claim.`}
                </p>
                <p className="text-xs text-amber-700">
                  Estimated payout: $
                  {Number.isFinite(displayedEstimatedAssets)
                    ? displayedEstimatedAssets.toFixed(2)
                    : activeRequest.assetsEstimated}{" "}
                  USDC.e
                </p>
                <p className="text-xs text-amber-700">
                  Requested: {formatDate(activeRequest.requestedAt)}
                </p>

                {readyRequest && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        void handleClaimReadyWithdrawal();
                      }}
                      disabled={claimDisabled}
                      className="w-full"
                    >
                      Claim Withdrawal
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void handleCancelWithdrawalRequest();
                      }}
                      disabled={queuePending || isPending || isConfirming}
                      className="w-full"
                    >
                      Cancel Request
                    </Button>
                  </div>
                )}

                {!readyRequest && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void handleCancelWithdrawalRequest();
                    }}
                    disabled={queuePending || isPending || isConfirming}
                    className="w-full"
                  >
                    Cancel Request
                  </Button>
                )}
              </div>
            )}

            {previewAssets !== undefined && parsedShares && parsedShares > 0n && (
              <p className="text-xs text-muted-foreground">
                You will receive ~
                <span className="font-mono">
                  {Number(formatUnits(previewAssets, 6)).toFixed(2)}
                </span>{" "}
                USDC.e
              </p>
            )}

            {queueLoading && <Skeleton className="h-4 w-56" />}
            {queueMessage && <p className="text-xs text-emerald-600">{queueMessage}</p>}
            {queueError && <p className="text-xs text-rose-600">{queueError}</p>}

            <TxStatus
              isPending={isPending}
              isConfirming={isConfirming}
              isConfirmed={isConfirmed}
              hash={hash}
              error={error}
            />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// Position Badges
// ============================================

function OutcomeBadge({ outcome }: { outcome: VaultPosition["outcome"] }) {
  const normalized = outcome.toUpperCase();
  const className =
    normalized === "YES"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
      : normalized === "NO"
        ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
        : "bg-slate-200/40 text-slate-700 border-slate-300";

  return (
    <Badge variant="outline" className={`px-2 py-0.5 text-xs font-semibold ${className}`}>
      {outcome}
    </Badge>
  );
}

function PositionStatusBadge({ status }: { status: VaultPosition["status"] }) {
  const label = status === "open" ? "Open" : "Redeemable";
  const className =
    status === "open"
      ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
      : "bg-amber-500/10 text-amber-700 border-amber-500/20";

  return (
    <Badge variant="outline" className={`px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </Badge>
  );
}

// ============================================
// Positions Table
// ============================================

function PositionsTable({
  positions,
  isLoading,
}: {
  positions: VaultPosition[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">No positions found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Positions will appear here once the vault starts trading
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50/50">
          <TableHead className="font-semibold">Market</TableHead>
          <TableHead className="font-semibold">Token</TableHead>
          <TableHead className="font-semibold">Outcome</TableHead>
          <TableHead className="font-semibold text-right">Size</TableHead>
          <TableHead className="font-semibold text-right">Avg Price</TableHead>
          <TableHead className="font-semibold text-right">Cost Basis</TableHead>
          <TableHead className="font-semibold">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((pos) => (
          <TableRow key={`${pos.tokenId}-${pos.conditionId}`}>
            <TableCell className="max-w-[320px] text-sm">
              <a
                href={`https://polymarket.com/event/${pos.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {pos.title}
              </a>
            </TableCell>
            <TableCell className="font-mono text-sm text-muted-foreground">
              {truncateId(pos.tokenId)}
            </TableCell>
            <TableCell>
              <OutcomeBadge outcome={pos.outcome} />
            </TableCell>
            <TableCell className="text-right text-muted-foreground font-mono">
              {pos.size.toFixed(2)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground font-mono">
              {formatCurrency(pos.avgPrice)}
            </TableCell>
            <TableCell className="text-right font-medium font-mono">
              {formatCurrency(pos.costBasis)}
            </TableCell>
            <TableCell>
              <PositionStatusBadge status={pos.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ============================================
// Allocations History
// ============================================

function PositionHistoryTable({
  positions,
  isLoading,
}: {
  positions: VaultPosition[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">No position history yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Redeemable and closed positions appear here
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50/50">
          <TableHead className="font-semibold">Market</TableHead>
          <TableHead className="font-semibold">Outcome</TableHead>
          <TableHead className="font-semibold">Status</TableHead>
          <TableHead className="font-semibold text-right">Size</TableHead>
          <TableHead className="font-semibold text-right">Cost Basis</TableHead>
          <TableHead className="font-semibold text-right">Current Value</TableHead>
          <TableHead className="font-semibold text-right">P/L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => (
          <TableRow key={`${position.tokenId}-${position.status}`}>
            <TableCell className="max-w-[320px] text-sm">
              <a
                href={`https://polymarket.com/event/${position.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {position.title}
              </a>
            </TableCell>
            <TableCell>
              <OutcomeBadge outcome={position.outcome} />
            </TableCell>
            <TableCell>
              <PositionStatusBadge status={position.status} />
            </TableCell>
            <TableCell className="text-right text-muted-foreground font-mono">
              {position.size.toFixed(2)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground font-mono">
              {formatCurrency(position.costBasis)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground font-mono">
              {formatCurrency(position.currentValue ?? 0)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground font-mono">
              {formatCurrency((position.realizedPnl ?? 0) + (position.cashPnl ?? 0))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FlowHistoryTable({
  allocations,
  isLoading,
}: {
  allocations: VaultAllocation[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (allocations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">No vault-safe flow events</p>
        <p className="mt-1 text-xs text-muted-foreground">Allocate/deallocate events appear here</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50/50">
          <TableHead className="font-semibold">Direction</TableHead>
          <TableHead className="font-semibold text-right">Amount</TableHead>
          <TableHead className="font-semibold">Tx Hash</TableHead>
          <TableHead className="font-semibold">Timestamp</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {allocations.map((alloc) => (
          <TableRow key={alloc.id}>
            <TableCell>
              <Badge
                variant="outline"
                className={`px-2 py-0.5 text-xs font-medium ${
                  alloc.direction === "allocate"
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                }`}
              >
                {alloc.direction === "allocate" ? "Vault -> Safe" : "Safe -> Vault"}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-medium font-mono">
              {formatCurrency(parseFloat(alloc.amount))}
            </TableCell>
            <TableCell className="font-mono text-sm text-muted-foreground">
              {truncateId(alloc.txHash, 10)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(alloc.timestamp)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ============================================
// Not Found State
// ============================================

function VaultNotFound() {
  return (
    <main className="flex-1 p-6 md:p-8 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h1 className="text-2xl font-bold text-foreground">Vault Not Found</h1>
          <p className="mt-2 text-muted-foreground">
            The vault you are looking for does not exist.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Back to Vaults
          </Link>
        </div>
      </div>
    </main>
  );
}

// ============================================
// Main Page
// ============================================

export default function VaultDetailPage() {
  const params = useParams();
  const { address } = useAppKitAccount();
  const routeVaultId = Number.parseInt(params.id as string, 10);
  const { data: instancesData, isLoading: instancesLoading } = useVaultInstances();
  const vault = instancesData?.instances.find((instance) => instance.id === routeVaultId);

  const {
    data: status,
    isLoading: statusLoading,
    error: statusError,
    refetch: refetchStatus,
  } = useVaultStatus(vault?.id);
  const { data: positionsData, isLoading: positionsLoading } = useVaultPositions(vault?.id);
  const { data: navHistoryData, isLoading: navHistoryLoading } = useVaultNavHistory(60, vault?.id);
  const { data: positionHistoryData, isLoading: positionHistoryLoading } = useVaultPositionHistory(
    vault?.id,
  );
  const { data: allocationsData, isLoading: allocationsLoading } = useVaultAllocations(50);
  const { totalAssets, totalSupply } = useVaultOnChainStats(vault?.config.vaultAddress);
  const {
    pendingRequests,
    claimableRequests,
    isLoading: redemptionRequestsLoading,
    refetch: refetchRedemptionRequests,
  } = useRequests(vault?.id);
  const { epoch, isLoading: epochLoading, refetch: refetchEpochStatus } = useEpochStatus(vault?.id);
  const {
    queuedFormatted,
    queuedSharesFormatted,
    estimateNavFormatted,
    estimateBasis,
    depositRequestId,
    depositCreatedAt,
    targetEpochId,
    activationTime,
    queueStatus,
    mintRule,
    isLoading: depositQueueLoading,
    refetch: refetchDepositQueue,
  } = useDepositQueue(vault?.id);
  const {
    epochs: epochHistory,
    isLoading: epochHistoryLoading,
    refetch: refetchEpochHistory,
  } = useEpochHistory(vault?.id);
  const { shares: redemptionUserShares } = useVaultShares(
    vault?.config.vaultAddress,
    address,
    vault?.type === "custom" ? 6 : 18,
  );

  if (!vault && !instancesLoading) {
    return <VaultNotFound />;
  }

  if (!vault) {
    return (
      <main className="flex-1 p-6 md:p-8 lg:p-10">
        <div className="mx-auto max-w-5xl py-24">
          <Skeleton className="h-12 w-2/3" />
        </div>
      </main>
    );
  }

  const hasOnChainStats = totalAssets > 0n || totalSupply > 0n;
  const onChainTotalAssets = Number(formatUnits(totalAssets, 6));
  const shareDisplayDecimals = vault.type === "custom" ? 6 : 18;
  const onChainTotalSupply = Number(formatUnits(totalSupply, shareDisplayDecimals));
  const apiTotalSupply =
    status && status.nav.sharePrice > 0 ? status.nav.totalAssets / status.nav.sharePrice : 0;
  const sharePrice =
    totalSupply > 0n
      ? Number(formatUnits(totalAssets, 6)) / Number(formatUnits(totalSupply, shareDisplayDecimals))
      : 1;

  const refreshRedemptionData = async () => {
    await Promise.all([
      refetchRedemptionRequests(),
      refetchEpochStatus(),
      refetchDepositQueue(),
      refetchEpochHistory(),
    ]);
  };

  return (
    <main className="flex-1 p-6 md:p-8 lg:p-10">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to Vaults
        </Link>

        {/* Testnet Warning Banner */}
        {VAULT_NETWORK === "amoy" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 text-amber-600 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-amber-800">Testnet Mode: Amoy</h3>
                <p className="mt-1 text-sm text-amber-700">
                  You are connected to Polygon Amoy Testnet. Vault testing is supported, but
                  Polymarket trading is disabled.
                  {!SUPPORTS_POLYMARKET_TRADING &&
                    " Positions and trading features are not available on testnet."}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{vault.name}</h1>
              {!statusLoading && status && <ModeBadge mode={status.mode} />}
              <NetworkBadge network={VAULT_NETWORK} />
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                {vault.profile.strategyLabel}
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs ${
                  vault.profile.riskLevel === "low"
                    ? "border-emerald-500/30 text-emerald-600"
                    : vault.profile.riskLevel === "medium"
                      ? "border-amber-500/30 text-amber-600"
                      : "border-rose-500/30 text-rose-600"
                }`}
              >
                {vault.profile.riskLevel.charAt(0).toUpperCase() + vault.profile.riskLevel.slice(1)}{" "}
                Risk
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {vault.profile.longDescription}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status?.nav?.lastUpdated && (
              <span className="text-xs text-muted-foreground">
                NAV updated {formatDate(status.nav.lastUpdated)}
              </span>
            )}
          </div>
        </div>

        {/* Error state */}
        {statusError && (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm text-rose-600">{statusError}</p>
              <Button variant="outline" size="sm" onClick={refetchStatus}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            title="Total Assets"
            value={
              status
                ? formatCurrency(status.nav.totalAssets)
                : hasOnChainStats
                  ? formatCurrency(onChainTotalAssets)
                  : "$0.00"
            }
            subtitle="Vault TVL"
            isLoading={statusLoading}
          />
          <StatCard
            title="Idle Assets"
            value={status ? formatCurrency(status.nav.idleAssets) : "$0.00"}
            subtitle="Available to deploy"
            isLoading={statusLoading}
          />
          <StatCard
            title="Cold (Vault)"
            value={status ? formatCurrency(status.nav.vaultUsdc) : "$0.00"}
            subtitle="USDC in vault"
            isLoading={statusLoading}
          />
          <StatCard
            title="Hot (Safe)"
            value={status ? formatCurrency(status.nav.safeUsdc) : "$0.00"}
            subtitle="USDC in safe"
            isLoading={statusLoading}
          />
          <StatCard
            title="Share Price"
            value={
              status
                ? formatSharePrice(status.nav.sharePrice)
                : hasOnChainStats
                  ? formatSharePrice(sharePrice)
                  : "$1.0000"
            }
            subtitle="Per vault share"
            isLoading={statusLoading}
          />
          <StatCard
            title="Deployed Ratio"
            value={status ? formatPercent(status.deployedRatio) : "0.0%"}
            subtitle="Capital utilization"
            tooltip="Open-position exposure ratio = open position cost basis / total assets"
            isLoading={statusLoading}
          />
          <StatCard
            title="Committed Exposure"
            value={
              status ? formatPercent(status.committedExposureRatio ?? status.deployedRatio) : "0.0%"
            }
            subtitle="Open + redeemable"
            tooltip="Includes open and redeemable positions that can still impact settlement outcomes"
            isLoading={statusLoading}
          />
          <StatCard
            title="Positions"
            value={status ? String(status.positionCount) : "0"}
            subtitle="Active positions"
            tooltip="Active positions are currently open markets (redeemables move to History)"
            isLoading={statusLoading}
          />
          <StatCard
            title="Total Supply"
            value={
              hasOnChainStats
                ? onChainTotalSupply.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : apiTotalSupply.toLocaleString(undefined, { maximumFractionDigits: 2 })
            }
            subtitle="Vault shares"
            isLoading={statusLoading}
          />
        </div>

        {navHistoryLoading ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <NavSparkline snapshots={navHistoryData?.snapshots ?? []} />
        )}

        {vault.type === "custom" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <EpochLifecycleCard
              epoch={epoch}
              queuedFormatted={queuedFormatted}
              targetEpochId={targetEpochId ?? (epoch ? epoch.epochId + 1 : null)}
              activationTime={activationTime ?? epoch?.endTime ?? null}
              isLoading={epochLoading || depositQueueLoading}
            />
            <DepositQueueCard
              queuedFormatted={queuedFormatted}
              queuedSharesFormatted={queuedSharesFormatted}
              estimateNavFormatted={estimateNavFormatted}
              estimateBasis={estimateBasis}
              depositRequestId={depositRequestId}
              depositCreatedAt={depositCreatedAt}
              targetEpochId={targetEpochId}
              activationTime={activationTime ?? epoch?.endTime ?? null}
              queueStatus={queueStatus}
              mintRule={mintRule}
              isLoading={depositQueueLoading}
            />
          </div>
        )}

        {/* Deposit / Withdraw / Redemption */}
        <div
          className={`grid gap-6 md:grid-cols-2 ${vault.type === "custom" ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}
        >
          <DepositForm vault={vault} onSuccess={() => void refreshRedemptionData()} />
          {vault.type !== "custom" && <WithdrawForm vault={vault} />}
          <RedemptionPanel
            vault={vault}
            epochInfo={epoch}
            pendingRequests={pendingRequests}
            claimableRequests={claimableRequests}
            isLoading={redemptionRequestsLoading || epochLoading}
            onRequestCreated={() => {
              void refreshRedemptionData();
            }}
            onClaimSuccess={() => {
              void refreshRedemptionData();
            }}
            userShares={redemptionUserShares}
          />
        </div>

        {vault.type === "custom" && (
          <EpochHistoryCard epochs={epochHistory} isLoading={epochHistoryLoading} />
        )}

        <Tabs defaultValue="positions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="positions">
              Positions
              {positionsData && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {positionsData.total}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">
              History
              {positionHistoryData && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {positionHistoryData.total}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="flows">
              Flows
              {allocationsData && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {allocationsData.total}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions">
            <Card className="border-border/50">
              <CardContent className="p-0">
                <PositionsTable
                  positions={positionsData?.positions ?? []}
                  isLoading={positionsLoading}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="border-border/50">
              <CardContent className="p-0">
                <PositionHistoryTable
                  positions={positionHistoryData?.positions ?? []}
                  isLoading={positionHistoryLoading}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="flows">
            <Card className="border-border/50">
              <CardContent className="p-0">
                <FlowHistoryTable
                  allocations={allocationsData?.allocations ?? []}
                  isLoading={allocationsLoading}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer info */}
        {!statusLoading && status && (
          <Card className="border-border/30 bg-slate-50/50">
            <CardContent className="flex items-center justify-between py-3">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Vault: {truncateId(vault.config.vaultAddress, 12)}</span>
                <Separator orientation="vertical" className="h-3" />
                <span>Safe: {truncateId(vault.config.safeAddress, 12)}</span>
              </div>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Auto-refresh: 30s
              </Badge>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
