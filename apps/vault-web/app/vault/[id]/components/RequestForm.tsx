"use client";

import { useState, useEffect } from "react";
import { formatUnits, parseUnits } from "viem";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Info, AlertTriangle } from "lucide-react";
import { useAppKitAccount } from "@reown/appkit/react";
import type { VaultInstance, RedemptionRequest, Epoch } from "../../../../src/types";
import {
  useCustomVaultRequestRedeem,
  usePreviewRedeem,
  useTokenAllowance,
  useTokenApprove,
} from "../../../../src/lib/hooks";

const CUSTOM_VAULT_SHARE_DECIMALS = 6;

interface RequestFormProps {
  vault: VaultInstance;
  epochInfo?: Epoch | null;
  userShares: bigint;
  isLoading: boolean;
  existingRequest?: RedemptionRequest | null;
  onSuccess: () => void;
}

export function RequestForm({
  vault,
  epochInfo: _epochInfo,
  userShares,
  isLoading,
  existingRequest,
  onSuccess,
}: RequestFormProps) {
  const { address, isConnected } = useAppKitAccount();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    requestRedeemTx,
    isPending,
    isConfirming,
    isConfirmed,
    error: txError,
    reset,
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

  const parsedShares = (() => {
    if (!amount) return undefined;
    try {
      return parseUnits(amount, CUSTOM_VAULT_SHARE_DECIMALS);
    } catch {
      return undefined;
    }
  })();

  const { assets: previewAssets } = usePreviewRedeem(vault.config.vaultAddress, parsedShares);

  const isValidAmount =
    parsedShares !== undefined && parsedShares > 0n && parsedShares <= userShares;
  const needsShareApproval = parsedShares !== undefined ? shareAllowance < parsedShares : false;

  const hasExistingRequest = !!existingRequest;

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
    reset();

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
    if (txError) {
      setError(txError.message);
    }
  }, [txError]);

  useEffect(() => {
    if (!isConfirmed) return;
    setSuccessMessage("Redemption request submitted successfully!");
    setAmount("");
    onSuccess();
  }, [isConfirmed, onSuccess]);

  useEffect(() => {
    if (approveConfirmed) {
      void refetchShareAllowance();
    }
  }, [approveConfirmed, refetchShareAllowance]);

  useEffect(() => {
    if (approveError) {
      setError(approveError.message);
    }
  }, [approveError]);

  const isBusy = isPending || isConfirming || approvePending || approveConfirming;

  // Clear success message after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
        <p className="text-sm text-muted-foreground">Connect your wallet to request redemption</p>
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
        <span className="text-muted-foreground">Available Shares</span>
        <span className="font-medium font-mono" data-testid="share-balance">
          {Number(formattedShares).toFixed(6)} shares
        </span>
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <Label htmlFor="shares-input" className="text-xs font-medium">
          Shares to Redeem
        </Label>
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
              disabled={isBusy || hasExistingRequest}
              className="pr-16 font-mono"
              aria-describedby="shares-input-help"
              data-testid="shares-input"
            />
            <button
              type="button"
              onClick={handleMax}
              disabled={isBusy || hasExistingRequest}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50"
              aria-label="Use maximum available shares"
            >
              MAX
            </button>
          </div>
          {needsShareApproval ? (
            <Button
              type="button"
              onClick={handleApproveShares}
              disabled={!isValidAmount || isBusy || hasExistingRequest}
              className="min-w-[140px]"
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
              disabled={!isValidAmount || isBusy || hasExistingRequest}
              className="min-w-[120px] request-redeem-button"
              data-testid="request-redeem-button"
            >
              {isPending ? "Confirm in Wallet..." : isConfirming ? "Confirming..." : "Request"}
            </Button>
          )}
        </div>
        <p id="shares-input-help" className="text-xs text-muted-foreground">
          Enter the number of shares you want to redeem
        </p>
      </div>

      {/* Preview */}
      {previewAssets !== undefined && parsedShares && parsedShares > 0n && (
        <div className="rounded-lg bg-slate-50 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Estimated USDC</span>
            <span className="font-mono font-medium" data-testid="estimated-usdc">
              ${Number(formatUnits(previewAssets, 6)).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Shares to Burn</span>
            <span className="font-mono">{amount} shares</span>
          </div>
        </div>
      )}

      {/* Existing Request Warning */}
      {hasExistingRequest && (
        <Alert className="bg-amber-50 border-amber-200" data-testid="existing-request-warning">
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
          <AlertDescription className="text-xs text-amber-700">
            You have an active redemption request (#{existingRequest?.requestId.slice(0, 8)}).
            Submit a new request after the current one is fully realized or closed.
          </AlertDescription>
        </Alert>
      )}

      {/* Progressive Payout Info */}
      <Alert className="bg-blue-50/50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" aria-hidden="true" />
        <AlertDescription className="text-xs text-blue-700">
          <span className="font-medium">Progressive Payouts:</span> Redemptions are processed at
          epoch close with frozen position snapshots. Your payout will be distributed progressively
          as frozen positions resolve over time, not all at once.
        </AlertDescription>
      </Alert>

      {/* Error */}
      {error && (
        <Alert className="bg-rose-50 border-rose-200" data-testid="request-error">
          <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden="true" />
          <AlertDescription className="text-xs text-rose-700">{error}</AlertDescription>
        </Alert>
      )}

      {/* Success */}
      {successMessage && (
        <Alert className="bg-emerald-50 border-emerald-200" data-testid="request-success">
          <Info className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <AlertDescription className="text-xs text-emerald-700">{successMessage}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
