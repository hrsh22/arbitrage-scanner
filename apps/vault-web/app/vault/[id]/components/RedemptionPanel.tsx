"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { AlertCircle, Clock, CheckCircle2, Wallet } from "lucide-react";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
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
}: RedemptionPanelProps) {
  const hasPending = pendingRequests.length > 0;
  const hasClaimable = claimableRequests.length > 0;
  const [activeTab, setActiveTab] = useState<string>(
    hasClaimable ? "claim" : hasPending ? "pending" : "request",
  );
  const cyclePresentation = getCyclePresentation(cycleInfo?.batchState);

  return (
    <Card
      className="rounded-[28px] border border-white/10 bg-white/[0.045] shadow-[0_30px_90px_-40px_rgba(8,15,36,0.95)] backdrop-blur-xl"
      data-testid="redemption-panel"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg font-semibold text-white">Exit queue</CardTitle>
            <p className="mt-1 text-sm text-slate-400">
              Start an exit request, track it through the cycle, and claim USDC.e when settlement is
              done.
            </p>
          </div>
          {cycleInfo && (
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Current cycle
              </p>
              <p className="text-sm font-mono font-semibold text-white">#{cycleInfo.cycleId}</p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <Alert
          className="mb-4 border border-cyan-400/20 bg-cyan-400/10 text-cyan-50"
          data-testid="redemption-info-alert"
        >
          <AlertCircle className="h-4 w-4 text-cyan-200" aria-hidden="true" />
          <AlertDescription className="text-xs leading-6 text-cyan-50/90">
            <span className="font-medium">{cyclePresentation.eyebrow}:</span>{" "}
            {cyclePresentation.detail}
          </AlertDescription>
        </Alert>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList
            className="grid w-full grid-cols-3 border border-white/10 bg-white/5"
            aria-label="Redemption tabs"
          >
            <TabsTrigger
              value="request"
              className="text-xs text-slate-400 hover:text-white data-[state=active]:bg-white data-[state=active]:text-slate-950"
              aria-label="Create new redemption request"
            >
              <Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Start exit
            </TabsTrigger>
            <TabsTrigger
              value="pending"
              className="text-xs text-slate-400 hover:text-white data-[state=active]:bg-white data-[state=active]:text-slate-950"
              aria-label={`View pending requests${hasPending ? ` (${pendingRequests.length})` : ""}`}
            >
              <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              In progress
              {hasPending && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-400/20 px-1.5 py-0 text-[10px] font-medium text-amber-100">
                  {pendingRequests.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="claim"
              className="text-xs text-slate-400 hover:text-white data-[state=active]:bg-white data-[state=active]:text-slate-950"
              aria-label={`View claimable requests${hasClaimable ? ` (${claimableRequests.length})` : ""}`}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Ready to claim
              {hasClaimable && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-emerald-400/20 px-1.5 py-0 text-[10px] font-medium text-emerald-100">
                  {claimableRequests.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="space-y-4">
            <RequestForm
              vault={vault}
              cycleInfo={cycleInfo}
              userShares={userShares}
              isLoading={isLoading}
              existingRequest={pendingRequests[0] ?? null}
              onSuccess={() => {
                onRequestCreated();
                setActiveTab("pending");
              }}
            />
          </TabsContent>

          <TabsContent value="pending" className="space-y-4">
            <PendingRequests
              requests={pendingRequests}
              cycleInfo={cycleInfo}
              isLoading={isLoading}
            />
          </TabsContent>

          <TabsContent value="claim" className="space-y-4">
            <ClaimableRequests
              requests={claimableRequests}
              isLoading={isLoading}
              onClaimSuccess={onClaimSuccess}
              vaultAddress={vault.config.vaultAddress}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
