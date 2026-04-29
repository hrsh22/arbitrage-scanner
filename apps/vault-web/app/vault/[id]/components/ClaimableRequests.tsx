"use client";

import { useMemo } from "react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { CheckCircle2, Wallet, Hash, Clock, Percent } from "lucide-react";
import { useAppKitAccount } from "@reown/appkit/react";
import type { RedemptionRequest, VaultInstance } from "../../../../src/types";
import { COLLATERAL_SYMBOL, EXPLORER_BASE_URL } from "../../../../src/constants";
import { EmptyState, AuthGatedState } from "../../../../components/async-state";
import { useRedemptionClaimLifecycle } from "../../../../src/lib/hooks/redemptionLifecycle";

interface ClaimableRequestsProps {
  vaultId: number;
  requests: RedemptionRequest[];
  isLoading: boolean;
  vaultAddress: string;
  vaultType: VaultInstance["type"];
  displaySymbol?: string;
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
  isBusy: boolean;
  isProcessing: boolean;
  isClaimedLocally: boolean;
  onClaim: (request: RedemptionRequest) => void;
  successTx: string | null;
  visibleError: string | null;
  displaySymbol: string;
}

function ClaimableRequestCard({
  request,
  isBusy,
  isProcessing,
  isClaimedLocally,
  onClaim,
  successTx,
  visibleError,
  displaySymbol,
}: ClaimableRequestCardProps) {
  const claimableNow = Number(request.claimableAssetsFormatted) || 0;
  const canClaim = request.status === "claimable" && claimableNow > 0 && !isClaimedLocally;

  return (
    <div
      className="space-y-3 rounded-[2px] border border-emerald-400/20 bg-emerald-400/10 p-4"
      data-testid={`claimable-request-${request.requestId}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-emerald-200" aria-hidden="true" />
          <span className="text-sm font-mono font-medium text-emerald-50">Withdrawal</span>
          <Badge
            variant="outline"
            className="border-emerald-400/25 bg-emerald-400/15 text-[10px] text-emerald-100"
          >
            {request.status === "claimed" || isClaimedLocally ? "Claimed" : "Ready to claim"}
          </Badge>
        </div>
        <span className="text-xs text-emerald-50/70">
          {request.requestKind === "controller_claimable"
            ? ""
            : `Requested ${formatDateTime(request.createdAt)}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-emerald-50/70">Amount</p>
          <p className="text-sm font-mono font-medium text-emerald-50">
            ${request.claimableAssetsFormatted || "0.00"}
          </p>
        </div>
        <div>
          <p className="text-xs text-emerald-50/70">Available</p>
          <p
            className="text-sm font-mono font-medium text-emerald-50"
            data-testid="claimable-amount"
          >
            ${request.claimableAssetsFormatted || "0.00"}
          </p>
        </div>
      </div>

      {/* Settlement indicator */}
      {request.proRataApplied && (
        <div className="rounded-[2px] border border-amber-400/20 bg-amber-400/10 p-2">
          <div className="flex items-center gap-2">
            <Percent className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
            <span className="text-xs font-medium text-amber-100">Partial withdrawal</span>
          </div>
          <p className="mt-1 text-xs leading-6 text-amber-50/90">
            {request.proRataPercentage && (
              <>
                This withdrawal was partially filled at{" "}
                {(request.proRataPercentage * 100).toFixed(1)}% due to limited availability.
              </>
            )}
          </p>
        </div>
      )}
      {request.status === "claimed" || isClaimedLocally ? (
        <div className="flex items-center gap-2 rounded-[2px] border border-white/10 bg-slate-950/35 p-3">
          <CheckCircle2 className="h-4 w-4 text-slate-300" aria-hidden="true" />
          <span className="text-sm text-slate-300">
            {isClaimedLocally ? "Claim confirmed — syncing status" : "Already claimed"}
          </span>
        </div>
      ) : canClaim ? (
        <div className="space-y-2">
          <Button
            type="button"
            onClick={() => {
              onClaim(request);
            }}
            disabled={isBusy || !canClaim}
            className="w-full rounded-[2px] bg-emerald-300 text-emerald-950 hover:bg-emerald-200 claim-button"
            data-testid="claim-button"
          >
            {isProcessing ? (
              <>
                <Clock className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Claim {displaySymbol} ${request.claimableAssetsFormatted || "0.00"}
              </>
            )}
          </Button>

          {successTx && !visibleError && (
            <a
              href={`${EXPLORER_BASE_URL}/tx/${successTx}`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-[2px] text-center text-xs font-mono text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
            >
              View transaction: {successTx.slice(0, 10)}...{successTx.slice(-4)}
            </a>
          )}

          {visibleError && (
            <div className="rounded-[2px] border border-rose-400/20 bg-rose-400/10 p-2 text-xs leading-6 text-rose-50/90">
              {visibleError}
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-[2px] border border-white/10 bg-slate-950/35 p-3"
          data-testid="claim-disabled"
        >
          <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="text-sm text-slate-300">
            Processing — your withdrawal will be ready shortly.
          </span>
        </div>
      )}
    </div>
  );
}

export function ClaimableRequests({
  vaultId,
  requests,
  isLoading,
  vaultAddress,
  vaultType,
  displaySymbol = COLLATERAL_SYMBOL,
}: ClaimableRequestsProps) {
  const { isConnected } = useAppKitAccount();
  const { activeRequestId, feedbackRequestId, feedbackError, successTx, isBusy, claim } =
    useRedemptionClaimLifecycle({
      vaultId,
      vaultAddress,
      vaultType,
    });

  const locallyClaimedRequestId = successTx && feedbackRequestId ? feedbackRequestId : null;

  const { totalClaimable, claimedCount, claimableCount } = useMemo(
    () =>
      requests.reduce(
        (summary, request) => {
          const isClaimedLocally = request.requestId === locallyClaimedRequestId;
          if (request.status === "claimed" || isClaimedLocally) {
            summary.claimedCount += 1;
            return summary;
          }

          const claimableAssets = Number(request.claimableAssetsFormatted) || 0;
          if (request.status === "claimable" && claimableAssets > 0) {
            summary.totalClaimable += claimableAssets;
            summary.claimableCount += 1;
          }

          return summary;
        },
        { totalClaimable: 0, claimedCount: 0, claimableCount: 0 },
      ),
    [locallyClaimedRequestId, requests],
  );

  if (!isConnected) {
    return <AuthGatedState variant="transparent" />;
  }

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="claimable-requests-loading">
        <Skeleton className="h-32 w-full rounded-[2px] bg-white/10" />
        <Skeleton className="h-32 w-full rounded-[2px] bg-white/10" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        variant="transparent"
        icon={<Wallet className="h-8 w-8" />}
        title="Nothing ready to claim"
        description="Completed withdrawals will appear here."
        data-testid="no-claimable-requests"
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="claimable-requests">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          Claimable now: ${totalClaimable.toFixed(2)} {displaySymbol}
        </span>
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
              <TooltipContent side="left" className="border-white/10 bg-slate-950 text-slate-100">
                Recently claimed — will update shortly.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {totalClaimable > 0 && (
        <div className="rounded-[2px] border border-emerald-400/20 bg-emerald-400/10 p-4">
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
            isBusy={isBusy}
            isProcessing={activeRequestId === request.requestId && isBusy}
            isClaimedLocally={request.requestId === locallyClaimedRequestId}
            onClaim={claim}
            successTx={feedbackRequestId === request.requestId ? successTx : null}
            visibleError={feedbackRequestId === request.requestId ? feedbackError : null}
            displaySymbol={displaySymbol}
          />
        ))}
      </div>
    </div>
  );
}
