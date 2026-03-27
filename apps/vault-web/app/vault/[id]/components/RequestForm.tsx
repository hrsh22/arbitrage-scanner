"use client";

import { useCallback, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Info, AlertTriangle, CircleHelp, ArrowUpRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useAppKitAccount } from "@reown/appkit/react";
import type { VaultInstance, RedemptionRequest, Cycle } from "../../../../src/types";
import { AuthGatedState } from "../../../../components/async-state";
import { useQueuedRedemptionRequest } from "../../../../src/lib/hooks/redemptionLifecycle";
import { useAuthSession } from "../../../../src/lib/hooks";

const CUSTOM_VAULT_SHARE_DECIMALS = 6;

interface RequestFormProps {
  vaultId: number;
  vault: VaultInstance;
  cycleInfo?: Cycle | null;
  userShares: bigint;
  isLoading: boolean;
  existingRequest?: RedemptionRequest | null;
  estimatedExitValueUsd?: number | null;
}

export function RequestForm({
  vaultId,
  vault,
  cycleInfo,
  userShares,
  isLoading,
  existingRequest,
  estimatedExitValueUsd,
}: RequestFormProps) {
  const { address, isConnected } = useAppKitAccount();
  const { sessionKnown, sessionAuthenticated } = useAuthSession();
  const userAuthorized = isConnected && sessionAuthenticated;
  const [amount, setAmount] = useState("");
  const handleRequestConfirmed = useCallback(() => {
    setAmount("");
  }, []);
  const {
    shareAllowance,
    approveShares,
    submitRequest,
    resetApprovalState,
    showSuccessMessage,
    isBusy,
    queuePending,
    queueConfirming,
    approvePending,
    approveConfirming,
    visibleError,
  } = useQueuedRedemptionRequest({
    vaultId,
    vaultAddress: vault.config.vaultAddress,
    onConfirmed: handleRequestConfirmed,
  });
  const formattedShares = formatUnits(userShares, CUSTOM_VAULT_SHARE_DECIMALS);
  const isBrokenZeroEntitlementRequest =
    !!existingRequest &&
    existingRequest.requestKind === "request" &&
    existingRequest.lifecycleError === "No entitlement record found" &&
    Number(existingRequest.claimableAssetsFormatted ?? "0") === 0;
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
    resetApprovalState();
  };

  const handleApproveShares = () => {
    if (!parsedShares) return;
    approveShares(parsedShares);
  };

  const handleSubmit = () => {
    if (!isValidAmount || !address || !parsedShares) return;
    submitRequest(parsedShares);
  };

  if (!isConnected) {
    return (
      <AuthGatedState
        variant="transparent"
        description="Connect your wallet to start an exit request."
      />
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

      <div className="space-y-4">
        <div className="rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label
                htmlFor="shares-input"
                className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400"
              >
                Shares
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
                  >
                    <CircleHelp className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={8}
                  className="max-w-64 bg-slate-100 text-slate-900"
                >
                  {isQueuedMode
                    ? "Your request is submitted instantly. You'll be able to claim once it's processed."
                    : "Withdrawals are temporarily paused."}
                </TooltipContent>
              </Tooltip>
            </div>
            <button
              type="button"
              onClick={handleMax}
              disabled={isBusy || hasExistingRequest || executionMode === "blocked"}
              className="text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-200 transition-colors hover:text-white disabled:opacity-50"
              aria-label="Use maximum available shares"
            >
              MAX
            </button>
          </div>
          <Input
            id="shares-input"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "" || /^[0-9]*[.,]?[0-9]*$/.test(val)) {
                setAmount(val.replace(",", "."));
                resetApprovalState();
              }
            }}
            disabled={isBusy || hasExistingRequest || executionMode === "blocked"}
            className="h-10 rounded-[2px] border border-[#212121] bg-transparent px-3 font-mono text-sm text-white placeholder:text-slate-500"
            aria-describedby="shares-input-help"
            data-testid="shares-input"
          />
        </div>

        {needsShareApproval ? (
          <Button
            type="button"
            onClick={handleApproveShares}
            disabled={
              !isValidAmount ||
              !userAuthorized ||
              isBusy ||
              hasExistingRequest ||
              executionMode === "blocked"
            }
            className="h-12 w-full rounded-[10px] bg-white text-slate-950 hover:bg-white/90"
          >
            {approvePending
              ? "Approve in Wallet..."
              : approveConfirming
                ? "Approving..."
                : isConnected && !sessionKnown
                  ? "Checking session..."
                  : !userAuthorized
                    ? "Sign in to approve"
                    : "Approve Shares"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              !isValidAmount ||
              !userAuthorized ||
              isBusy ||
              hasExistingRequest ||
              executionMode === "blocked"
            }
            className="h-12 w-full rounded-[10px] bg-cyan-300 text-slate-950 hover:bg-cyan-200 request-redeem-button"
            data-testid="request-redeem-button"
          >
            {queuePending
              ? "Confirm in wallet..."
              : queueConfirming
                ? "Submitting..."
                : isConnected && !sessionKnown
                  ? "Checking session..."
                  : !userAuthorized
                    ? "Sign in to withdraw"
                    : "Withdraw"}
          </Button>
        )}

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
            You have an active withdrawal request. Start a new one after the current request
            finishes.
          </AlertDescription>
        </Alert>
      )}

      {isBrokenZeroEntitlementRequest && (
        <Alert className="border-amber-400/20 bg-amber-400/10" data-testid="broken-request-warning">
          <AlertTriangle className="h-4 w-4 text-amber-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-amber-50/90">
            A previous request encountered an issue. Please contact support.
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

      {visibleError && (
        <Alert className="border-rose-400/20 bg-rose-400/10" data-testid="request-error">
          <AlertTriangle className="h-4 w-4 text-rose-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-rose-50/90">
            {visibleError}
          </AlertDescription>
        </Alert>
      )}

      {showSuccessMessage && (
        <Alert className="border-emerald-400/20 bg-emerald-400/10" data-testid="request-success">
          <Info className="h-4 w-4 text-emerald-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-emerald-50/90">
            Withdrawal request submitted. You'll be notified when it's ready.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
