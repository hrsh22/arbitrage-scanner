"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Clock, CheckCircle2, Wallet } from "lucide-react";
import type { VaultInstance, Cycle, RedemptionRequest } from "../../../../src/types";
import { getCyclePresentation } from "../../../../src/lib/cyclePresentation";
import { RequestForm } from "./RequestForm";
import { PendingRequests } from "./PendingRequests";
import { ClaimableRequests } from "./ClaimableRequests";

interface RedemptionPanelProps {
  vault: VaultInstance;
  cycleInfo?: Cycle | null;
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  isLoading: boolean;
  onRequestCreated: () => void;
  onClaimSuccess: () => void;
  userShares: bigint;
  estimatedExitValueUsd?: number | null;
}

export function RedemptionPanel({
  vault,
  cycleInfo,
  pendingRequests,
  claimableRequests,
  isLoading,
  onRequestCreated,
  onClaimSuccess,
  userShares,
  estimatedExitValueUsd,
}: RedemptionPanelProps) {
  const hasPending = pendingRequests.length > 0;
  const hasClaimable = claimableRequests.length > 0;
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
  const title = executionMode === "instant" ? "Withdraw now" : "Exit queue";
  const subtitle =
    executionMode === "instant"
      ? "Withdraw your shares instantly at the current price."
      : executionMode === "queued"
        ? vault.type === "custom"
          ? "Submit a withdrawal request now. The worker will process it and make it claimable once settlement runs."
          : "Request a queued exit. You'll be able to claim once the cycle completes."
        : vault.type === "custom"
          ? "Withdrawals use the queue-first flow for this vault. Requests resume after processing finishes."
          : "Withdrawals are temporarily paused.";

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
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Mode</p>
            <p className="mt-1 text-sm text-white">{cyclePresentation.label}</p>
          </div>
          <p className="max-w-[240px] text-right text-xs leading-5 text-slate-400">
            {cyclePresentation.detail}
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              <Wallet className="h-3.5 w-3.5" />
              Start exit
            </div>
            <RequestForm
              vault={vault}
              cycleInfo={cycleInfo}
              userShares={userShares}
              isLoading={isLoading}
              existingRequest={pendingRequests[0] ?? null}
              estimatedExitValueUsd={estimatedExitValueUsd}
              onSuccess={() => {
                onRequestCreated();
              }}
            />
          </div>

          {hasPending && (
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                In progress
                <span className="inline-flex items-center justify-center rounded-full bg-amber-400/20 px-1.5 py-0 text-[10px] font-medium text-amber-100">
                  {pendingRequests.length}
                </span>
              </div>
              <PendingRequests
                requests={pendingRequests}
                cycleInfo={cycleInfo}
                isLoading={isLoading}
              />
            </div>
          )}

          {hasClaimable && (
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Ready to claim
                <span className="inline-flex items-center justify-center rounded-full bg-emerald-400/20 px-1.5 py-0 text-[10px] font-medium text-emerald-100">
                  {claimableRequests.length}
                </span>
              </div>
              <ClaimableRequests
                requests={claimableRequests}
                isLoading={isLoading}
                onClaimSuccess={onClaimSuccess}
                vaultAddress={vault.config.vaultAddress}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
