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
      className="space-y-3 rounded-xl border border-[#E8C08C]/40 bg-[#E8C08C]/20 p-4"
      data-testid={`pending-request-${request.requestId}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-[#8A6231]" aria-hidden="true" />
          <span className="font-mono text-sm font-bold text-[#1A202C]" data-testid="request-id">
            Pending withdrawal
          </span>
          <Badge
            variant="outline"
            className="border-[#D4A574]/35 bg-[#E8C08C]/25 text-[10px] font-bold text-[#8A6231]"
          >
            In progress
          </Badge>
        </div>
        <span className="text-xs text-[#615E4E]">
          {request.requestKind === "controller_pending" ? "" : formatDateTime(request.createdAt)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-[#615E4E]">Amount</p>
          <p
            className="font-mono text-sm font-semibold text-[#1A202C]"
            data-testid="shares-requested"
          >
            {request.sharesFormatted} shares
          </p>
        </div>
      </div>
      <p className="text-xs leading-6 text-[#8A6231]">Your withdrawal is being processed.</p>
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
        <Skeleton className="h-32 w-full rounded-xl bg-[#E8D9C0]" />
        <Skeleton className="h-32 w-full rounded-xl bg-[#E8D9C0]" />
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
