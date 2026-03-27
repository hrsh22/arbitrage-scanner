"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Clock, Hash } from "lucide-react";
import type { RedemptionRequest } from "../../../../src/types";
import { EmptyState, AuthGatedState } from "../../../../components/async-state";

interface PendingRequestsProps {
  requests: RedemptionRequest[];
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

function PendingRequestCard({ request }: { request: RedemptionRequest }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4"
      data-testid={`pending-request-${request.requestId}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-amber-200" aria-hidden="true" />
          <span className="text-sm font-mono font-medium text-amber-50" data-testid="request-id">
            Pending withdrawal
          </span>
          <Badge
            variant="outline"
            className="border-amber-400/25 bg-amber-400/15 text-[10px] text-amber-100"
          >
            In progress
          </Badge>
        </div>
        <span className="text-xs text-amber-50/70">
          {request.requestKind === "controller_pending" ? "" : formatDateTime(request.createdAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-amber-50/70">Amount</p>
          <p className="text-sm font-mono font-medium text-amber-50" data-testid="shares-requested">
            {request.sharesFormatted} shares
          </p>
        </div>
      </div>
      <p className="text-xs leading-6 text-amber-50/90">Your withdrawal is being processed.</p>
    </div>
  );
}

export function PendingRequests({ requests, isLoading }: PendingRequestsProps) {
  const { isConnected } = useAppKitAccount();

  if (!isConnected) {
    return <AuthGatedState variant="transparent" />;
  }

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
      <EmptyState
        variant="transparent"
        icon={<Clock className="h-8 w-8" />}
        title="No pending withdrawals"
        description="Active withdrawal requests will appear here."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="pending-requests">
      <div className="space-y-3">
        {requests.map((request) => (
          <PendingRequestCard key={request.requestId} request={request} />
        ))}
      </div>
    </div>
  );
}
