"use client";

import { useState, useEffect } from "react";
import { formatUnits, parseUnits } from "viem";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Info, AlertTriangle, CircleHelp, ArrowUpRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useAppKitAccount } from "@reown/appkit/react";
import type { VaultInstance, RedemptionRequest, Cycle } from "../../../../src/types";
import { getCyclePresentation } from "../../../../src/lib/cyclePresentation";
import {
  useCustomVaultRequestRedeem,
  useTokenAllowance,
  useTokenApprove,
} from "../../../../src/lib/hooks";

const CUSTOM_VAULT_SHARE_DECIMALS = 6;

interface RequestFormProps {
  vault: VaultInstance;
  cycleInfo?: Cycle | null;
  userShares: bigint;
  isLoading: boolean;
  existingRequest?: RedemptionRequest | null;
  estimatedExitValueUsd?: number | null;
  onSuccess: (mode: "instant" | "queued") => void;
}

export function RequestForm({
  vault,
  cycleInfo,
  userShares,
  isLoading,
  existingRequest,
  estimatedExitValueUsd,
  onSuccess,
}: RequestFormProps) {
  const { address, isConnected } = useAppKitAccount();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    requestRedeemTx,
    isPending: queuePending,
    isConfirming: queueConfirming,
    isConfirmed: queueConfirmed,
    error: queueError,
    reset: resetQueue,
  } = useCustomVaultRequestRedeem();
  const { allowance: shareAllowance, refetch: refetchShareAllowance } = useTokenAllowance(
    vault.config.vaultAddress,
    address,
    vault.config.vaultAddress,
  );
  const {
    approve: approveShares,
    isPending: approvePending,
    isConfirming: approveConfirming,
    isConfirmed: approveConfirmed,
    error: approveError,
    reset: resetApprove,
  } = useTokenApprove(vault.config.vaultAddress);
  const formattedShares = formatUnits(userShares, CUSTOM_VAULT_SHARE_DECIMALS);
  const isBrokenZeroEntitlementRequest =
    !!existingRequest &&
    existingRequest.requestKind === "request" &&
    existingRequest.lifecycleError === "No entitlement record found" &&
    Number(existingRequest.claimableAssetsFormatted ?? "0") === 0;
  const cyclePresentation = getCyclePresentation(cycleInfo?.batchState);
  const isCustomVault = vault.type === "custom";
  const executionMode =
    cycleInfo?.telemetryFresh === false
      ? "blocked"
      : isCustomVault
        ? !cycleInfo?.batchState || cycleInfo.batchState === "processing"
          ? "blocked"
          : "queued"
        : cycleInfo?.executionMode
          ? cycleInfo.executionMode
          : cycleInfo?.batchState === "open"
            ? "instant"
            : cycleInfo?.batchState === "closed" || cycleInfo?.batchState === "cutoff"
              ? "queued"
              : "blocked";
  const isQueuedMode = executionMode === "queued";

  const parsedShares = (() => {
    if (!amount) return undefined;
    try {
      return parseUnits(amount, CUSTOM_VAULT_SHARE_DECIMALS);
    } catch {
      return undefined;
    }
  })();

  const isValidAmount =
    parsedShares !== undefined && parsedShares > 0n && parsedShares <= userShares;
  const needsShareApproval =
    isQueuedMode && parsedShares !== undefined ? shareAllowance < parsedShares : false;

  const hasExistingRequest = !!existingRequest && !isBrokenZeroEntitlementRequest;
  const exitDisabledReason = hasExistingRequest
    ? "You already have an active withdrawal request."
    : executionMode === "blocked"
      ? isCustomVault
        ? cycleInfo?.telemetryFresh === false
           ? "Loading, please wait…"
           : "Withdrawals are temporarily unavailable while the vault finishes processing."
        : "Withdrawals are temporarily paused."
      : null;
  const indicativePayoutUsd =
    parsedShares !== undefined &&
    estimatedExitValueUsd !== null &&
    estimatedExitValueUsd !== undefined
      ? Number(formatUnits(parsedShares, CUSTOM_VAULT_SHARE_DECIMALS)) * estimatedExitValueUsd
      : null;

  const handleMax = () => {
    setAmount(formattedShares);
    setError(null);
    resetApprove();
  };

  const handleApproveShares = () => {
    if (!parsedShares) return;
    setError(null);
    setSuccessMessage(null);
    resetApprove();
    approveShares(vault.config.vaultAddress as `0x${string}`, parsedShares);
  };

  const handleSubmit = async () => {
    if (!isValidAmount || !address || !parsedShares) return;

    setError(null);
    setSuccessMessage(null);
    resetQueue();

    try {
      requestRedeemTx(
        vault.config.vaultAddress as `0x${string}`,
        parsedShares,
        address as `0x${string}`,
        address as `0x${string}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    }
  };

  useEffect(() => {
    if (queueError) {
      setError(queueError.message);
    }
  }, [queueError]);

  useEffect(() => {
    if (!queueConfirmed) return;
    setError(null);
    setSuccessMessage(
      "Withdrawal request submitted. You'll be notified when it's ready.",
    );
    setAmount("");
    onSuccess("queued");
  }, [onSuccess, queueConfirmed]);

  useEffect(() => {
    if (approveConfirmed) {
      setError(null);
      void refetchShareAllowance();
    }
  }, [approveConfirmed, refetchShareAllowance]);

  useEffect(() => {
    if (approveError) {
      setError(approveError.message);
    }
  }, [approveError]);

  const isBusy = queuePending || queueConfirming || approvePending || approveConfirming;

  // Clear success message after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center">
        <p className="text-sm text-slate-300">Connect your wallet to start an exit request.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="request-form">
      {/* Shares Balance */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Your balance</span>
        <span className="font-medium font-mono text-slate-100" data-testid="share-balance">
          {Number(formattedShares).toFixed(6)} shares
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="shares-input"
            className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400"
          >
            Shares to withdraw
          </Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
              >
                <CircleHelp className="h-3.5 w-3.5" />
                How this works
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              sideOffset={8}
              className="max-w-64 bg-slate-100 text-slate-900"
            >
              {isQueuedMode
                ? "Your request is submitted instantly. You'll be able to claim once it's processed."
                : "Withdrawals are temporarily paused."}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="shares-input"
              type="number"
              step="0.000001"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
                resetApprove();
              }}
              disabled={isBusy || hasExistingRequest || executionMode === "blocked"}
              className="border-white/10 bg-white/5 pr-16 font-mono text-white placeholder:text-slate-500"
              aria-describedby="shares-input-help"
              data-testid="shares-input"
            />
            <button
              type="button"
              onClick={handleMax}
              disabled={isBusy || hasExistingRequest || executionMode === "blocked"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-white/10 px-2 py-0.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/15 disabled:opacity-50"
              aria-label="Use maximum available shares"
            >
              MAX
            </button>
          </div>
          {needsShareApproval ? (
            <Button
              type="button"
              onClick={handleApproveShares}
              disabled={
                !isValidAmount || isBusy || hasExistingRequest || executionMode === "blocked"
              }
              className="min-w-[140px] bg-white text-slate-950 hover:bg-slate-100"
            >
              {approvePending
                ? "Approve in Wallet..."
                : approveConfirming
                  ? "Approving..."
                  : "Approve Shares"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={
                !isValidAmount || isBusy || hasExistingRequest || executionMode === "blocked"
              }
              className="min-w-[140px] bg-cyan-300 text-slate-950 hover:bg-cyan-200 request-redeem-button"
              data-testid="request-redeem-button"
            >
              {queuePending
                ? "Confirm in wallet..."
                : queueConfirming
                  ? "Submitting..."
                  : "Withdraw"}
            </Button>
          )}
        </div>
        <p id="shares-input-help" className="text-xs leading-6 text-slate-400">
          {isQueuedMode
            ? "Your request will be processed shortly."
            : "Withdrawals are temporarily paused."}
        </p>
      </div>

      {parsedShares !== undefined && parsedShares > 0n && (
        <div className="space-y-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
          <div className="flex items-center justify-between text-sm">
            <div>
              <p className="text-cyan-50/70">Estimated payout</p>
              <p className="mt-1 text-lg font-semibold text-cyan-50">
                {indicativePayoutUsd !== null ? `$${indicativePayoutUsd.toFixed(2)}` : "--"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-cyan-50/70">Shares</p>
              <p className="mt-1 font-mono font-medium text-cyan-50">{amount}</p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-cyan-400/15 bg-black/10 p-2.5">
            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 text-cyan-200" />
            <p className="text-xs leading-6 text-cyan-50/90">
              Estimated. Final amount confirmed after processing.
            </p>
          </div>
        </div>
      )}

      {hasExistingRequest && (
        <Alert
          className="border-amber-400/20 bg-amber-400/10"
          data-testid="existing-request-warning"
        >
          <AlertTriangle className="h-4 w-4 text-amber-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-amber-50/90">
            You have an active withdrawal request. Start
            a new one after the current request finishes.
          </AlertDescription>
        </Alert>
      )}

      {isBrokenZeroEntitlementRequest && (
        <Alert className="border-amber-400/20 bg-amber-400/10" data-testid="broken-request-warning">
          <AlertTriangle className="h-4 w-4 text-amber-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-amber-50/90">
            A previous request encountered an issue. Please contact
            support.
          </AlertDescription>
        </Alert>
      )}

      {exitDisabledReason && !hasExistingRequest && (
        <Alert className="border-amber-400/20 bg-amber-400/10">
          <AlertTriangle className="h-4 w-4 text-amber-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-amber-50/90">
            {exitDisabledReason}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-rose-400/20 bg-rose-400/10" data-testid="request-error">
          <AlertTriangle className="h-4 w-4 text-rose-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-rose-50/90">{error}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert className="border-emerald-400/20 bg-emerald-400/10" data-testid="request-success">
          <Info className="h-4 w-4 text-emerald-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-emerald-50/90">
            {successMessage}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
