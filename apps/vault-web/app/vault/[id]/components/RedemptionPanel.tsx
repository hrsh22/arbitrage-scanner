"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Clock, CheckCircle2, Wallet } from "lucide-react";
import type { VaultInstance, Cycle, RedemptionRequest } from "../../../../src/types";
import { getCyclePresentation } from "../../../../src/lib/cyclePresentation";
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
      className="rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] shadow-[0_22px_80px_-58px_rgba(26,32,44,0.48)]"
      data-testid="redemption-panel"
    >
      <CardHeader className="pb-3">
        <div>
          <CardTitle className="font-serif text-2xl font-bold tracking-tight text-[#1A202C]">
            {title}
          </CardTitle>
          <p className="mt-1 text-sm leading-6 text-[#615E4E]">{subtitle}</p>
        </div>
      </CardHeader>

      <CardContent>
        <div className="mb-4 flex items-center justify-between rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] px-4 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#615E4E]">
              Vault status
            </p>
            <p className="mt-1 text-sm font-bold text-[#1A202C]">{cyclePresentation.label}</p>
          </div>
          {isQueuedMode && (
            <WithdrawalInfoDialog
              isQueuedMode={true}
              displaySymbol={claimDisplaySymbol}
              triggerLabel="How this works"
              triggerClassName="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#CCCAC4] bg-[#F1EEE8] px-3 py-1.5 text-xs font-bold text-[#615E4E] transition-colors hover:border-[#D4A574] hover:bg-[#E8C08C] hover:text-[#302B2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#615E4E]/40"
            />
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#615E4E]">
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
            <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#615E4E]">
                <Clock className="h-3.5 w-3.5" />
                In progress
                {hasPending && (
                  <span className="inline-flex items-center justify-center rounded-full bg-[#E8C08C]/25 px-1.5 py-0 text-[10px] font-bold text-[#8A6231]">
                    {pendingRequests.length}
                  </span>
                )}
              </div>
              {showProtectedSections ? (
                <PendingRequests requests={pendingRequests} isLoading={isLoading} />
              ) : (
                <p className="text-xs leading-6 text-[#615E4E]">Checking session…</p>
              )}
            </div>
          )}

          {(showProtectedSections || sessionChecking) && (hasClaimable || isLoading) && (
            <div className="rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#615E4E]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ready to claim
                {hasClaimable && (
                  <span className="inline-flex items-center justify-center rounded-full bg-[#58A65C]/10 px-1.5 py-0 text-[10px] font-bold text-[#2F7A35]">
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
                <p className="text-xs leading-6 text-[#615E4E]">Checking session…</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
