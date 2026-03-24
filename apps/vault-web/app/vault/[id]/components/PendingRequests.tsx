"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Clock, Hash } from "lucide-react";
import type { RedemptionRequest, Cycle } from "../../../../src/types";

interface PendingRequestsProps {
  requests: RedemptionRequest[];
  cycleInfo?: Cycle | null;
  isLoading: boolean;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PendingRequestCard({ request }: { request: RedemptionRequest; cycleInfo?: Cycle | null }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4"
      data-testid={`pending-request-${request.requestId}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-amber-200" aria-hidden="true" />
          <span className="text-sm font-mono font-medium text-amber-50" data-testid="request-id">
            {request.requestKind === "controller_pending"
              ? "current queue"
              : `${request.requestId.slice(0, 8)}...${request.requestId.slice(-4)}`}
          </span>
          <Badge
            variant="outline"
            className="border-amber-400/25 bg-amber-400/15 text-[10px] text-amber-100"
          >
            In progress
          </Badge>
        </div>
        <span className="text-xs text-amber-50/70">
          {request.requestKind === "controller_pending"
            ? "Current cycle"
            : formatDateTime(request.createdAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-amber-50/70">Shares leaving</p>
          <p className="text-sm font-mono font-medium text-amber-50" data-testid="shares-requested">
            {request.sharesFormatted} shares
          </p>
        </div>
        <div>
          <p className="text-xs text-amber-50/70">Queued cycle</p>
          <p className="text-sm font-mono font-medium text-amber-50" data-testid="target-cycle">
            #{request.targetCycle}
          </p>
        </div>
      </div>
      <p className="text-xs leading-6 text-amber-50/90">
        Your withdrawal is pending. The final amount will be confirmed at settlement.
      </p>
    </div>
  );
}

export function PendingRequests({ requests, cycleInfo, isLoading }: PendingRequestsProps) {
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="pending-requests-loading">
        <Skeleton className="h-32 w-full rounded-2xl bg-white/10" />
        <Skeleton className="h-32 w-full rounded-2xl bg-white/10" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] py-12 text-center"
        data-testid="no-pending-requests"
      >
        <Clock className="mb-3 h-8 w-8 text-slate-500" aria-hidden="true" />
        <p className="text-sm font-medium text-white">No pending withdrawals</p>
        <p className="mt-1 max-w-xs text-xs leading-6 text-slate-400">
          Active withdrawal requests will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pending-requests">
      <div className="space-y-3">
        {requests.map((request) => (
          <PendingRequestCard key={request.requestId} request={request} cycleInfo={cycleInfo} />
        ))}
      </div>
    </div>
  );
}
