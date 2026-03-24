"use client";

import { useState, useEffect } from "react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { CheckCircle2, Wallet, Hash, Clock, Percent, CircleHelp } from "lucide-react";
import { useAppKitAccount } from "@reown/appkit/react";
import { parseUnits } from "viem";
import type { RedemptionRequest } from "../../../../src/types";
import { useVaultRedeem } from "../../../../src/lib/hooks";
import { EXPLORER_BASE_URL } from "../../../../src/constants";

interface ClaimableRequestsProps {
  requests: RedemptionRequest[];
  isLoading: boolean;
  onClaimSuccess: () => void;
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
  vaultAddress: string;
  onClaimSuccess: () => void;
  isProcessing: boolean;
  setProcessing: (id: string | null) => void;
}

function ClaimableRequestCard({
  request,
  vaultAddress,
  onClaimSuccess,
  isProcessing,
  setProcessing,
}: ClaimableRequestCardProps) {
  const { address, isConnected } = useAppKitAccount();
  const [error, setError] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const {
    redeem,
    hash,
    isPending,
    isConfirming,
    isConfirmed,
    error: redeemError,
    reset,
  } = useVaultRedeem();

  // Track processing state
  useEffect(() => {
    if (isPending || isConfirming) {
      setProcessing(request.requestId);
    } else if (isConfirmed || redeemError) {
      setProcessing(null);
    }
  }, [isPending, isConfirming, isConfirmed, redeemError, request.requestId, setProcessing]);

  // Handle success
  useEffect(() => {
    if (isConfirmed && hash) {
      setError(null);
      setSuccessTx(hash);
      setTimeout(() => {
        onClaimSuccess();
      }, 2000);
    }
  }, [isConfirmed, hash, onClaimSuccess]);

  // Handle error
  useEffect(() => {
    if (redeemError) {
      setError(redeemError.message);
    }
  }, [redeemError]);

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

      redeem(
        vaultAddress as `0x${string}`,
        parseUnits(request.sharesFormatted, 6),
        receiverAddress as `0x${string}`,
        (request.ownerAddress || request.controllerAddress || receiverAddress) as `0x${string}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim redemption request");
    }
  };

  // Corrected lifecycle checks per API contract
  const claimableNow = Number(request.claimableAssetsFormatted) || 0;
  const canClaim = request.status === "claimable" && claimableNow > 0;
  const isClaiming = isProcessing || isPending || isConfirming;

  return (
    <div
      className="space-y-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4"
      data-testid={`claimable-request-${request.requestId}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-emerald-200" aria-hidden="true" />
          <span className="text-sm font-mono font-medium text-emerald-50">
            {request.requestKind === "controller_claimable"
              ? "wallet aggregate"
              : `${request.requestId.slice(0, 8)}...${request.requestId.slice(-4)}`}
          </span>
          <Badge
            variant="outline"
            className="border-emerald-400/25 bg-emerald-400/15 text-[10px] text-emerald-100"
          >
            {request.status === "claimed"
              ? "Claimed"
              : request.requestKind === "controller_claimable"
                ? "Claimable balance"
                : "Claimable"}
          </Badge>
        </div>
        <span className="text-xs text-emerald-50/70">
          {request.requestKind === "controller_claimable"
            ? "Across settled cycles"
            : `Requested ${formatDateTime(request.createdAt)}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-emerald-50/70">
            {request.requestKind === "controller_claimable" ? "Shares claimable" : "Shares settled"}
          </p>
          <p className="text-sm font-mono font-medium text-emerald-50">
            {request.sharesFormatted} shares
          </p>
        </div>
        <div>
          <p className="text-xs text-emerald-50/70">USDC ready now</p>
          <p
            className="text-sm font-mono font-medium text-emerald-50"
            data-testid="claimable-amount"
          >
            ${request.claimableAssetsFormatted || "0.00"}
          </p>
        </div>
        {request.requestKind !== "controller_claimable" && (
          <div>
            <p className="text-xs text-emerald-50/70">Settled cycle</p>
            <p className="text-sm font-mono font-medium text-emerald-50">#{request.targetCycle}</p>
          </div>
        )}
      </div>

      {request.requestKind === "controller_claimable" && (
        <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2.5 text-xs text-cyan-50/90">
          <CircleHelp className="h-3.5 w-3.5 text-cyan-200" />
          <p>
            This amount is claimable from the vault contract after processing. It does not require a
            separate safe transfer first.
          </p>
        </div>
      )}

      {/* Settlement indicator */}
      {request.proRataApplied && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-2">
          <div className="flex items-center gap-2">
            <Percent className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
            <span className="text-xs font-medium text-amber-100">Pro-rata settlement applied</span>
          </div>
          <p className="mt-1 text-xs leading-6 text-amber-50/90">
            {request.proRataPercentage && (
              <>
                This withdrawal was partially filled at{" "}
                {(request.proRataPercentage * 100).toFixed(1)}% due to limited liquidity.
              </>
            )}
          </p>
        </div>
      )}
      {request.status === "claimed" ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/35 p-3">
          <CheckCircle2 className="h-4 w-4 text-slate-300" aria-hidden="true" />
          <span className="text-sm text-slate-300">Already claimed</span>
        </div>
      ) : canClaim ? (
        <div className="space-y-2">
          <Button
            type="button"
            onClick={() => {
              void handleClaim();
            }}
            disabled={isClaiming || !canClaim}
            className="w-full bg-emerald-300 text-slate-950 hover:bg-emerald-200 claim-button"
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
              className="block text-center text-xs font-mono text-cyan-200 hover:underline"
            >
              View transaction: {successTx.slice(0, 10)}...{successTx.slice(-4)}
            </a>
          )}

          {error && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-2 text-xs leading-6 text-rose-50/90">
              {error}
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/35 p-3"
          data-testid="claim-disabled"
        >
          <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="text-sm text-slate-300">
            Processing — the worker is preparing your on-chain claimable balance.
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
  vaultAddress,
}: ClaimableRequestsProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Calculate totals
  const totalClaimable = requests
    .filter((r) => r.status === "claimable" && (Number(r.claimableAssetsFormatted) || 0) > 0)
    .reduce((sum, r) => sum + (Number(r.claimableAssetsFormatted) || 0), 0);

  const claimedCount = requests.filter((r) => r.status === "claimed").length;
  const claimableCount = requests.filter(
    (r) => r.status === "claimable" && (Number(r.claimableAssetsFormatted) || 0) > 0,
  ).length;

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="claimable-requests-loading">
        <Skeleton className="h-32 w-full rounded-2xl bg-white/10" />
        <Skeleton className="h-32 w-full rounded-2xl bg-white/10" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] py-12 text-center"
        data-testid="no-claimable-requests"
      >
        <Wallet className="mb-3 h-8 w-8 text-slate-500" aria-hidden="true" />
        <p className="text-sm font-medium text-white">Nothing ready to claim</p>
        <p className="mt-1 max-w-xs text-xs leading-6 text-slate-400">
          Completed withdrawals will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="claimable-requests">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Claimable now: ${totalClaimable.toFixed(2)}</span>
        <div className="flex items-center gap-2">
          {claimableCount > 0 && (
            <Badge
              variant="secondary"
              className="border border-emerald-400/25 bg-emerald-400/12 text-emerald-100"
            >
              {claimableCount} ready
            </Badge>
          )}
          {claimedCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Badge variant="outline" className="border-white/10 text-slate-300">
                    {claimedCount} claimed
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" className="bg-slate-100 text-slate-900">
                Recently claimed — will update shortly.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {totalClaimable > 0 && (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-200" aria-hidden="true" />
              <span className="text-sm font-medium text-emerald-100">Total available now</span>
            </div>
            <span className="text-xl font-mono font-bold text-emerald-50">
              ${totalClaimable.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {requests.map((request) => (
          <ClaimableRequestCard
            key={request.requestId}
            request={request}
            vaultAddress={vaultAddress}
            onClaimSuccess={onClaimSuccess}
            isProcessing={processingId === request.requestId}
            setProcessing={setProcessingId}
          />
        ))}
      </div>
    </div>
  );
}
