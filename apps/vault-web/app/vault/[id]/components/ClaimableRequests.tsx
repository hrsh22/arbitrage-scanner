"use client";

import { useState, useEffect } from "react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { CheckCircle2, Wallet, Hash, Info, Clock, Percent } from "lucide-react";
import { useAppKitAccount } from "@reown/appkit/react";
import { parseUnits } from "viem";
import type { RedemptionRequest } from "../../../../src/types";
import { useCustomVaultClaimRedeem } from "../../../../src/lib/hooks";
import { EXPLORER_BASE_URL } from "../../../../src/constants";

interface ClaimableRequestsProps {
  requests: RedemptionRequest[];
  isLoading: boolean;
  onClaimSuccess: () => void;
  vaultId: number;
  vaultAddress: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ClaimableRequestCardProps {
  request: RedemptionRequest;
  vaultId: number;
  vaultAddress: string;
  onClaimSuccess: () => void;
  isProcessing: boolean;
  setProcessing: (id: string | null) => void;
}

function ClaimableRequestCard({
  request,
  vaultId,
  vaultAddress,
  onClaimSuccess,
  isProcessing,
  setProcessing,
}: ClaimableRequestCardProps) {
  const { address, isConnected } = useAppKitAccount();
  const [error, setError] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const {
    claimRedeemTx,
    hash,
    isPending,
    isConfirming,
    isConfirmed,
    error: claimError,
    reset,
  } = useCustomVaultClaimRedeem();

  // Track processing state
  useEffect(() => {
    if (isPending || isConfirming) {
      setProcessing(request.requestId);
    } else if (isConfirmed || claimError) {
      setProcessing(null);
    }
  }, [isPending, isConfirming, isConfirmed, claimError, request.requestId, setProcessing]);

  // Handle success
  useEffect(() => {
    if (isConfirmed && hash) {
      setSuccessTx(hash);
      setTimeout(() => {
        onClaimSuccess();
      }, 2000);
    }
  }, [isConfirmed, hash, onClaimSuccess]);

  // Handle error
  useEffect(() => {
    if (claimError) {
      setError(claimError.message);
    }
  }, [claimError]);

  const handleClaim = async () => {
    if (!isConnected) return;

    setError(null);
    setSuccessTx(null);
    reset();

    try {
      const receiverAddress =
        request.ownerAddress || request.controllerAddress || (address as `0x${string}` | undefined);
      if (!receiverAddress) {
        throw new Error("Missing receiver address for claim");
      }

      claimRedeemTx(
        vaultAddress as `0x${string}`,
        BigInt(request.requestId),
        parseUnits(request.sharesFormatted, 6),
        receiverAddress as `0x${string}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim redemption request");
    }
  };

  // Corrected lifecycle checks per API contract
  const claimableNow = Number(request.claimableAssetsFormatted) || 0;
  const meetsThreshold = claimableNow >= 1.0; // 1 USDC threshold
  const dustOverrideEligible = claimableNow > 0 && claimableNow < 1.0;
  const canClaim = request.status === "claimable" && claimableNow > 0;
  const isClaiming = isProcessing || isPending || isConfirming;

  return (
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4 space-y-3"
      data-testid={`claimable-request-${request.requestId}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <span className="text-sm font-mono font-medium">
            {request.requestId.slice(0, 8)}...{request.requestId.slice(-4)}
          </span>
          <Badge
            variant="outline"
            className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]"
          >
            {request.status === "claimed" ? "Claimed" : "Claimable"}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(request.targetEpochEndTime || request.createdAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Shares Redeemed</p>
          <p className="text-sm font-mono font-medium">{request.sharesFormatted} shares</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">USDC to Receive</p>
          <p
            className="text-sm font-mono font-medium text-emerald-700"
            data-testid="claimable-amount"
          >
            ${request.claimableAssetsFormatted || "0.00"}
          </p>
        </div>
      </div>

      {/* Settlement indicator */}
      {request.proRataApplied && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-2">
          <div className="flex items-center gap-2">
            <Percent className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
            <span className="text-xs font-medium text-amber-700">Pro-rata Settlement Applied</span>
          </div>
          <p className="text-xs text-amber-700 mt-1">
            {request.proRataPercentage && (
              <>
                This request was filled at {(request.proRataPercentage * 100).toFixed(1)}% due to
                insufficient liquidity at the settlement boundary. Your claimable amount reflects
                this final settlement. Full entitlement is realized at the boundary only.
              </>
            )}
          </p>
        </div>
      )}
      {/* Status or Action */}
      {/* Status or Action */}
      {request.status === "claimed" ? (
        <div className="flex items-center gap-2 rounded-md bg-slate-100 p-3">
          <CheckCircle2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">Already claimed</span>
        </div>
      ) : canClaim ? (
        <div className="space-y-2">
          {/* Dust override warning */}
          {dustOverrideEligible && !meetsThreshold && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2">
              <p className="text-xs text-amber-700">
                <span className="font-medium">Dust amount:</span> This claim is below the 1 USDC
                minimum threshold.
              </p>
            </div>
          )}
          <Button
            type="button"
            onClick={() => {
              void handleClaim();
            }}
            disabled={isClaiming || !canClaim}
            className="w-full claim-button"
            data-testid="claim-button"
          >
            {isClaiming ? (
              <>
                <Clock className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Claim ${request.claimableAssetsFormatted || "0.00"}
              </>
            )}
          </Button>

          {successTx && (
            <a
              href={`${EXPLORER_BASE_URL}/tx/${successTx}`}
              target="_blank"
              rel="noreferrer"
              className="block text-center text-xs font-mono text-blue-600 hover:underline"
            >
              View transaction: {successTx.slice(0, 10)}...{successTx.slice(-4)}
            </a>
          )}

          {error && <div className="rounded-md bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-md bg-slate-100 p-3"
          data-testid="claim-disabled"
        >
          <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">
            Waiting for settlement to complete...
          </span>
        </div>
      )}
    </div>
  );
}

export function ClaimableRequests({
  requests,
  isLoading,
  onClaimSuccess,
  vaultId,
  vaultAddress,
}: ClaimableRequestsProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Calculate totals
  const totalClaimable = requests
    .filter((r) => r.status === "claimable")
    .reduce((sum, r) => sum + (Number(r.claimableAssetsFormatted) || 0), 0);

  const claimedCount = requests.filter((r) => r.status === "claimed").length;
  const claimableCount = requests.filter((r) => r.status === "claimable").length;

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="claimable-requests-loading">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-dashed border-slate-300 bg-slate-50/50"
        data-testid="no-claimable-requests"
      >
        <Wallet className="h-8 w-8 text-slate-300 mb-3" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">No claimable requests</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          Settled redemption requests will appear here when they&apos;re ready to claim.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="claimable-requests">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Claimable Requests</span>
        <div className="flex items-center gap-2">
          {claimableCount > 0 && (
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
              {claimableCount} claimable
            </Badge>
          )}
          {claimedCount > 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              {claimedCount} claimed
            </Badge>
          )}
        </div>
      </div>

      {/* Total Available */}
      {totalClaimable > 0 && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              <span className="text-sm font-medium text-emerald-700">Total Available to Claim</span>
            </div>
            <span className="text-xl font-mono font-bold text-emerald-700">
              ${totalClaimable.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Request Cards */}
      <div className="space-y-3">
        {requests.map((request) => (
          <ClaimableRequestCard
            key={request.requestId}
            request={request}
            vaultId={vaultId}
            vaultAddress={vaultAddress}
            onClaimSuccess={onClaimSuccess}
            isProcessing={processingId === request.requestId}
            setProcessing={setProcessingId}
          />
        ))}
      </div>

      {/* Info Alert */}
      <Alert className="bg-blue-50/50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" aria-hidden="true" />
        <AlertDescription className="text-xs text-blue-700">
          <span className="font-medium">Boundary Settlement Model:</span> Claims are available
          after epoch settlement completes. Full entitlement is realized at the settlement
          boundary. Partial or gradual realization between settlements is not supported.
        </AlertDescription>
      </Alert>
      <Alert className="bg-blue-50/50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" aria-hidden="true" />
        <AlertDescription className="text-xs text-blue-700">
          <span className="font-medium">Claiming:</span> Click the claim button to receive your
          USDC. Claims are processed immediately and cannot be reversed.
        </AlertDescription>
      </Alert>
    </div>
  );
}
