"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { AlertCircle, Clock, CheckCircle2, Wallet } from "lucide-react";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import type { VaultInstance } from "../../../../src/types";
import type { Epoch, RedemptionRequest } from "../../../../src/types";
import { RequestForm } from "./RequestForm";
import { PendingRequests } from "./PendingRequests";
import { ClaimableRequests } from "./ClaimableRequests";

interface RedemptionPanelProps {
  vault: VaultInstance;
  epochInfo?: Epoch | null;
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  isLoading: boolean;
  onRequestCreated: () => void;
  onClaimSuccess: () => void;
  userShares: bigint;
}

export function RedemptionPanel({
  vault,
  epochInfo,
  pendingRequests,
  claimableRequests,
  isLoading,
  onRequestCreated,
  onClaimSuccess,
  userShares,
}: RedemptionPanelProps) {
  const [activeTab, setActiveTab] = useState<string>("request");

  // Determine which tab should be highlighted based on user state
  const hasPending = pendingRequests.length > 0;
  const hasClaimable = claimableRequests.length > 0;

  return (
    <Card className="border-border/50" data-testid="redemption-panel">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Redemption</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Request shares to be redeemed at the next weekly settlement
            </p>
          </div>
          {epochInfo && (
            <div className="text-right">
              <p className="text-xs font-medium text-muted-foreground">Current Epoch</p>
              <p className="text-sm font-mono font-semibold">#{epochInfo.epochId}</p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Educational Alert */}
        <Alert className="mb-4 bg-blue-50 border-blue-200" data-testid="redemption-info-alert">
          <AlertCircle className="h-4 w-4 text-blue-600" aria-hidden="true" />
          <AlertDescription className="text-xs text-blue-700">
            <span className="font-medium">Weekly Settlement:</span> Redemption requests are
            processed at the end of each weekly epoch. Claims become available after settlement is
            complete.
          </AlertDescription>
        </Alert>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-3" aria-label="Redemption tabs">
            <TabsTrigger
              value="request"
              className="text-xs"
              aria-label="Create new redemption request"
            >
              <Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Request
            </TabsTrigger>
            <TabsTrigger
              value="pending"
              className="text-xs"
              aria-label={`View pending requests${hasPending ? ` (${pendingRequests.length})` : ""}`}
            >
              <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Pending
              {hasPending && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 px-1.5 py-0 text-[10px] font-medium text-amber-700">
                  {pendingRequests.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="claim"
              className="text-xs"
              aria-label={`View claimable requests${hasClaimable ? ` (${claimableRequests.length})` : ""}`}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Claim
              {hasClaimable && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-emerald-100 px-1.5 py-0 text-[10px] font-medium text-emerald-700">
                  {claimableRequests.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="space-y-4">
            <RequestForm
              vault={vault}
              epochInfo={epochInfo}
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
              epochInfo={epochInfo}
              isLoading={isLoading}
            />
          </TabsContent>

          <TabsContent value="claim" className="space-y-4">
            <ClaimableRequests
              requests={claimableRequests}
              isLoading={isLoading}
              onClaimSuccess={onClaimSuccess}
              vaultId={vault.id}
              vaultAddress={vault.config.vaultAddress}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
