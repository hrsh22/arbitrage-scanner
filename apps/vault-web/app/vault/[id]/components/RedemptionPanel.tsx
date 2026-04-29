"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Clock, CheckCircle2, Wallet } from "lucide-react";
import type { VaultInstance, Cycle, RedemptionRequest } from "../../../../src/types";
import { getCyclePresentation } from "../../../../src/lib/cyclePresentation";
import { AuthGatedState } from "../../../../components/async-state";
import { useAuthSession } from "../../../../src/lib/hooks";
import { RequestForm } from "./RequestForm";
import { PendingRequests } from "./PendingRequests";
import { ClaimableRequests } from "./ClaimableRequests";
import { WithdrawalInfoDialog } from "./WithdrawalInfoDialog";
import { COLLATERAL_SYMBOL, USER_COLLATERAL_SYMBOL } from "../../../../src/constants";

interface RedemptionPanelProps {
  vaultId: number;
  vault: VaultInstance;
  cycleInfo?: Cycle | null;
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  isLoading: boolean;
  userShares: bigint;
  estimatedExitValueUsd?: number | null;
}

export function RedemptionPanel({
  vaultId,
  vault,
  cycleInfo,
  pendingRequests,
  claimableRequests,
  isLoading,
  userShares,
  estimatedExitValueUsd,
}: RedemptionPanelProps) {
  const { walletConnected, sessionAuthenticated, sessionKnown } = useAuthSession();
  const hasPending = pendingRequests.length > 0;
  const hasClaimable = claimableRequests.length > 0;
  const claimDisplaySymbol = vault.type === "custom" ? USER_COLLATERAL_SYMBOL : COLLATERAL_SYMBOL;

  const showProtectedSections = walletConnected && sessionAuthenticated;
  const sessionChecking = walletConnected && !sessionKnown;
  const sessionUnauthenticated = walletConnected && sessionKnown && !sessionAuthenticated;

  const cyclePresentation = getCyclePresentation(cycleInfo?.batchState);
  const executionMode =
    vault.type === "custom"
      ? cycleInfo?.telemetryFresh === false
        ? "blocked"
        : !cycleInfo?.batchState || cycleInfo.batchState === "processing"
          ? "blocked"
          : "queued"
      : cycleInfo?.telemetryFresh === false
        ? "blocked"
        : cycleInfo?.executionMode
          ? cycleInfo.executionMode
          : cycleInfo?.batchState === "open"
            ? "instant"
            : cycleInfo?.batchState === "closed" || cycleInfo?.batchState === "cutoff"
              ? "queued"
              : "blocked";
  const title = executionMode === "instant" ? "Withdraw" : "Withdraw";
  const subtitle =
    executionMode === "instant"
      ? "Withdraw instantly at the current price."
      : executionMode === "queued"
        ? vault.type === "custom"
          ? "Submit a withdrawal request. You'll be notified when it's ready to claim."
          : "Request a withdrawal. You can claim once it's processed."
        : "Withdrawals are temporarily paused.";

  const isQueuedMode = executionMode === "queued";

  return (
    <Card
      className="rounded-[28px] border border-white/10 bg-white/[0.045] shadow-[0_30px_90px_-40px_rgba(8,15,36,0.95)] backdrop-blur-xl"
      data-testid="redemption-panel"
    >
      <CardHeader className="pb-3">
        <div>
          <CardTitle className="text-lg font-semibold text-white">{title}</CardTitle>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
      </CardHeader>

      <CardContent>
        <div className="mb-4 flex items-center justify-between rounded-[8px] border border-[#212121] bg-[#0A0A0A] px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Vault status</p>
            <p className="mt-1 text-sm font-medium text-white">{cyclePresentation.label}</p>
          </div>
          {isQueuedMode && (
            <WithdrawalInfoDialog
              isQueuedMode={true}
              displaySymbol={claimDisplaySymbol}
              triggerLabel="How this works"
              triggerClassName="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] bg-[#121212] px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-[#212121] transition-all hover:bg-[#212121] hover:text-white"
            />
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              <Wallet className="h-3.5 w-3.5" />
              New withdrawal
            </div>
            <RequestForm
              vaultId={vaultId}
              vault={vault}
              cycleInfo={cycleInfo}
              userShares={userShares}
              isLoading={isLoading}
              existingRequest={pendingRequests[0] ?? null}
              estimatedExitValueUsd={estimatedExitValueUsd}
            />
          </div>

          {(showProtectedSections || sessionChecking) && (hasPending || isLoading) && (
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                In progress
                {hasPending && (
                  <span className="inline-flex items-center justify-center rounded-full bg-amber-400/20 px-1.5 py-0 text-[10px] font-medium text-amber-100">
                    {pendingRequests.length}
                  </span>
                )}
              </div>
              {showProtectedSections ? (
                <PendingRequests requests={pendingRequests} isLoading={isLoading} />
              ) : (
                <p className="text-xs leading-6 text-slate-400">Checking session…</p>
              )}
            </div>
          )}

          {(showProtectedSections || sessionChecking) && (hasClaimable || isLoading) && (
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ready to claim
                {hasClaimable && (
                  <span className="inline-flex items-center justify-center rounded-full bg-emerald-400/20 px-1.5 py-0 text-[10px] font-medium text-emerald-100">
                    {claimableRequests.length}
                  </span>
                )}
              </div>
              {showProtectedSections ? (
                <ClaimableRequests
                  vaultId={vaultId}
                  requests={claimableRequests}
                  isLoading={isLoading}
                  vaultAddress={vault.config.vaultAddress}
                  vaultType={vault.type}
                  displaySymbol={claimDisplaySymbol}
                />
              ) : (
                <p className="text-xs leading-6 text-slate-400">Checking session…</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
