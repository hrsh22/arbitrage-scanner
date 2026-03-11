"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Clock, Calendar, Info, Hash } from "lucide-react";
import type { RedemptionRequest, Epoch } from "../../../../src/types";

interface PendingRequestsProps {
  requests: RedemptionRequest[];
  epochInfo?: Epoch | null;
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

function formatDuration(ms: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  return { days, hours, minutes, seconds };
}

function CountdownTimer({ targetTime, label }: { targetTime: string; label: string }) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  const updateTimer = useCallback(() => {
    const target = new Date(targetTime).getTime();
    const now = Date.now();
    const diff = target - now;

    if (diff <= 0) {
      setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      return;
    }

    setTimeLeft(formatDuration(diff));
  }, [targetTime]);

  useEffect(() => {
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [updateTimer]);

  if (!timeLeft) return null;

  return (
    <div className="space-y-1" data-testid="epoch-countdown">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1 text-sm font-mono">
        {timeLeft.days > 0 && (
          <>
            <span className="bg-slate-100 px-1.5 py-0.5 rounded">
              {String(timeLeft.days).padStart(2, "0")}
            </span>
            <span className="text-muted-foreground">:</span>
          </>
        )}
        <span className="bg-slate-100 px-1.5 py-0.5 rounded">
          {String(timeLeft.hours).padStart(2, "0")}
        </span>
        <span className="text-muted-foreground">:</span>
        <span className="bg-slate-100 px-1.5 py-0.5 rounded">
          {String(timeLeft.minutes).padStart(2, "0")}
        </span>
        <span className="text-muted-foreground">:</span>
        <span className="bg-slate-100 px-1.5 py-0.5 rounded">
          {String(timeLeft.seconds).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

function PendingRequestCard({
  request,
  epochInfo,
}: {
  request: RedemptionRequest;
  epochInfo?: Epoch | null;
}) {
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50/30 p-4 space-y-3"
      data-testid={`pending-request-${request.requestId}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-amber-600" aria-hidden="true" />
          <span className="text-sm font-mono font-medium" data-testid="request-id">
            {request.requestId.slice(0, 8)}...{request.requestId.slice(-4)}
          </span>
          <Badge
            variant="outline"
            className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]"
          >
            Pending
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{formatDateTime(request.createdAt)}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Shares Requested</p>
          <p className="text-sm font-mono font-medium" data-testid="shares-requested">
            {request.sharesFormatted} shares
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Target Epoch</p>
          <p className="text-sm font-mono font-medium" data-testid="target-epoch">
            #{request.targetEpoch}
          </p>
        </div>
      </div>

      {epochInfo?.endTime && (
        <div className="rounded-md bg-white p-3 border border-amber-100">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
            <span className="text-xs font-medium text-amber-700">Time Until Settlement</span>
          </div>
          <CountdownTimer targetTime={epochInfo.endTime} label="Settlement occurs at epoch end" />
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-amber-700">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p>
          Your request will be processed at the end of epoch #{request.targetEpoch}. Claims will be
          available after settlement completes at the epoch boundary. Requests cannot be cancelled
          once submitted.
        </p>
      </div>


      <div className="rounded-md bg-slate-100 p-2 text-center">
        <p className="text-xs text-muted-foreground">
          Redemption requests are irreversible once submitted.
        </p>
      </div>
    </div>
  );
}

export function PendingRequests({ requests, epochInfo, isLoading }: PendingRequestsProps) {
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="pending-requests-loading">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-dashed border-slate-300 bg-slate-50/50"
        data-testid="no-pending-requests"
      >
        <Clock className="h-8 w-8 text-slate-300 mb-3" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">No pending requests</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          You don&apos;t have any redemption requests waiting for settlement.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pending-requests">
      {/* Summary */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Pending Requests</span>
        <Badge variant="secondary" className="bg-amber-100 text-amber-700">
          {requests.length} pending
        </Badge>
      </div>

      {/* Request Cards */}
      <div className="space-y-3">
        {requests.map((request) => (
          <PendingRequestCard key={request.requestId} request={request} epochInfo={epochInfo} />
        ))}
      </div>

      {/* Settlement Info */}
      <Alert className="bg-blue-50/50 border-blue-200">
        <Calendar className="h-4 w-4 text-blue-600" aria-hidden="true" />
        <AlertDescription className="text-xs text-blue-700">
          <span className="font-medium">Boundary Settlement Model:</span> All pending requests are
          processed together at epoch settlement boundaries. NAV at epoch start is used to calculate
          share pricing. Requests cannot be cancelled after submission.
        </AlertDescription>
      </Alert>
      <Alert className="bg-blue-50/50 border-blue-200">
        <Calendar className="h-4 w-4 text-blue-600" aria-hidden="true" />
        <AlertDescription className="text-xs text-blue-700">
          <span className="font-medium">Settlement Process:</span> All pending requests are
          processed together at the end of each epoch. Requests cannot be cancelled after
          submission.
        </AlertDescription>
      </Alert>
    </div>
  );
}
