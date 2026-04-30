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

function SharesAmountField({
  amount,
  isQueuedMode,
  isBusy,
  hasExistingRequest,
  isBlocked,
  onAmountChange,
  onMax,
}: {
  amount: string;
  isQueuedMode: boolean;
  isBusy: boolean;
  hasExistingRequest: boolean;
  isBlocked: boolean;
  onAmountChange: (value: string) => void;
  onMax: () => void;
}) {
  const disabled = isBusy || hasExistingRequest || isBlocked;

  return (
    <div className="rounded-xl border border-[#CCCAC4] bg-[#F1EEE8] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label
            htmlFor="shares-input"
            className="text-xs font-bold uppercase tracking-[0.16em] text-[#615E4E]"
          >
            Shares
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Explain withdrawal share entry"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#615E4E] transition-colors hover:bg-[#E8C08C]/20 hover:text-[#8A6231] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/40"
              >
                <CircleHelp className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={8}
              className="max-w-64 rounded-xl border-[#CCCAC4] bg-[#FAF8F5] text-[#302B2C] shadow-xl"
            >
              {isQueuedMode
                ? "Your request is submitted instantly. You'll be able to claim once it's processed."
                : "Withdrawals are temporarily paused."}
            </TooltipContent>
          </Tooltip>
        </div>
        <button
          type="button"
          onClick={onMax}
          disabled={disabled}
          className="-mr-3 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8A6231] transition-colors hover:bg-[#E8C08C]/20 hover:text-[#302B2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/40 disabled:opacity-50"
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
        onChange={(event) => onAmountChange(event.target.value)}
        disabled={disabled}
        className="h-10 rounded-lg border border-[#CCCAC4] bg-[#FAF8F5] px-3 font-mono text-sm text-[#1A202C] placeholder:text-[#615E4E]/70 focus-visible:ring-[#615E4E]/30"
        aria-describedby="shares-input-help"
        data-testid="shares-input"
      />
    </div>
  );
}

function RequestActionButton({
  needsShareApproval,
  isValidAmount,
  userAuthorized,
  sessionKnown,
  isConnected,
  isBusy,
  hasExistingRequest,
  isBlocked,
  approvePending,
  approveConfirming,
  queuePending,
  queueConfirming,
  onApprove,
  onSubmit,
}: {
  needsShareApproval: boolean;
  isValidAmount: boolean;
  userAuthorized: boolean;
  sessionKnown: boolean;
  isConnected: boolean;
  isBusy: boolean;
  hasExistingRequest: boolean;
  isBlocked: boolean;
  approvePending: boolean;
  approveConfirming: boolean;
  queuePending: boolean;
  queueConfirming: boolean;
  onApprove: () => void;
  onSubmit: () => void;
}) {
  const disabled = !isValidAmount || !userAuthorized || isBusy || hasExistingRequest || isBlocked;

  if (needsShareApproval) {
    return (
      <Button
        type="button"
        onClick={onApprove}
        disabled={disabled}
        className="h-12 w-full rounded-full border border-[#CCCAC4] bg-[#F1EEE8] font-bold text-[#615E4E] hover:border-[#D4A574] hover:bg-[#E8C08C] hover:text-[#302B2C]"
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
    );
  }

  return (
    <Button
      type="button"
      onClick={onSubmit}
      disabled={disabled}
      className="request-redeem-button h-12 w-full rounded-full border border-[#D4A574] bg-[#E8C08C] font-bold text-[#302B2C] hover:bg-[#D4A574]"
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
  );
}

function EstimatedPayoutPreview({
  amount,
  parsedShares,
  indicativePayoutUsd,
}: {
  amount: string;
  parsedShares?: bigint;
  indicativePayoutUsd: number | null;
}) {
  if (parsedShares === undefined || parsedShares <= 0n) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-xl border border-[#D4A574]/35 bg-[#E8C08C]/20 p-4">
      <div className="flex items-center justify-between text-sm">
        <div>
          <p className="text-[#615E4E]">Estimated payout</p>
          <p className="mt-1 text-lg font-bold text-[#1A202C]">
            {indicativePayoutUsd !== null ? `$${indicativePayoutUsd.toFixed(2)}` : "--"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[#615E4E]">Shares</p>
          <p className="mt-1 font-mono font-semibold text-[#1A202C]">{amount}</p>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-[#CCCAC4] bg-[#F1EEE8] p-2.5">
        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 text-[#8A6231]" />
        <p className="text-xs leading-6 text-[#615E4E]">
          Estimated. Final amount confirmed after processing.
        </p>
      </div>
    </div>
  );
}

function RequestStatusAlerts({
  hasExistingRequest,
  isBrokenZeroEntitlementRequest,
  exitDisabledReason,
  visibleError,
  showSuccessMessage,
}: {
  hasExistingRequest: boolean;
  isBrokenZeroEntitlementRequest: boolean;
  exitDisabledReason: string | null;
  visibleError: string | null;
  showSuccessMessage: boolean;
}) {
  return (
    <>
      {hasExistingRequest && (
        <Alert
          className="border-amber-400/20 bg-amber-400/10"
          data-testid="existing-request-warning"
        >
          <AlertTriangle className="h-4 w-4 text-[#8A6231]" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-[#8A6231]">
            You have an active withdrawal request. Start a new one after the current request
            finishes.
          </AlertDescription>
        </Alert>
      )}

      {isBrokenZeroEntitlementRequest && (
        <Alert className="border-amber-400/20 bg-amber-400/10" data-testid="broken-request-warning">
          <AlertTriangle className="h-4 w-4 text-[#8A6231]" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-[#8A6231]">
            A previous request encountered an issue. Please contact support.
          </AlertDescription>
        </Alert>
      )}

      {exitDisabledReason && !hasExistingRequest && (
        <Alert className="border-amber-400/20 bg-amber-400/10">
          <AlertTriangle className="h-4 w-4 text-[#8A6231]" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-[#8A6231]">
            {exitDisabledReason}
          </AlertDescription>
        </Alert>
      )}

      {visibleError && (
        <Alert className="border-rose-400/20 bg-rose-400/10" data-testid="request-error">
          <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-rose-700">
            {visibleError}
          </AlertDescription>
        </Alert>
      )}

      {showSuccessMessage && (
        <Alert className="border-emerald-400/20 bg-emerald-400/10" data-testid="request-success">
          <Info className="h-4 w-4 text-[#2F7A35]" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-[#2F7A35]">
            Withdrawal request submitted. You&apos;ll be notified when it&apos;s ready.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
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

  const handleAmountChange = (value: string) => {
    if (value === "" || /^[0-9]*[.,]?[0-9]*$/.test(value)) {
      setAmount(value.replace(",", "."));
      resetApprovalState();
    }
  };

  const handleApproveShares = () => {
    if (!parsedShares) return;
    approveShares(parsedShares);
  };

  const handleSubmit = () => {
    if (!isValidAmount || !address || !parsedShares) return;
    submitRequest(parsedShares);
  };
  const isBlocked = executionMode === "blocked";

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
        <span className="text-[#615E4E]">Your balance</span>
        <span className="font-mono font-semibold text-[#1A202C]" data-testid="share-balance">
          {Number(formattedShares).toFixed(6)} shares
        </span>
      </div>

      <div className="space-y-4">
        <SharesAmountField
          amount={amount}
          isQueuedMode={isQueuedMode}
          isBusy={isBusy}
          hasExistingRequest={hasExistingRequest}
          isBlocked={isBlocked}
          onAmountChange={handleAmountChange}
          onMax={handleMax}
        />

        <RequestActionButton
          needsShareApproval={needsShareApproval}
          isValidAmount={isValidAmount}
          userAuthorized={userAuthorized}
          sessionKnown={sessionKnown}
          isConnected={isConnected}
          isBusy={isBusy}
          hasExistingRequest={hasExistingRequest}
          isBlocked={isBlocked}
          approvePending={approvePending}
          approveConfirming={approveConfirming}
          queuePending={queuePending}
          queueConfirming={queueConfirming}
          onApprove={handleApproveShares}
          onSubmit={handleSubmit}
        />

        <p id="shares-input-help" className="text-xs leading-6 text-[#615E4E]">
          {isQueuedMode
            ? "Your request will be processed shortly."
            : "Withdrawals are temporarily paused."}
        </p>
      </div>

      <EstimatedPayoutPreview
        amount={amount}
        parsedShares={parsedShares}
        indicativePayoutUsd={indicativePayoutUsd}
      />

      <RequestStatusAlerts
        hasExistingRequest={hasExistingRequest}
        isBrokenZeroEntitlementRequest={isBrokenZeroEntitlementRequest}
        exitDisabledReason={exitDisabledReason}
        visibleError={visibleError}
        showSuccessMessage={showSuccessMessage}
      />
    </div>
  );
}
