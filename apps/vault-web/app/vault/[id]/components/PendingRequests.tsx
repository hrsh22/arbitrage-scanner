"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Clock, Calendar, Info, Hash } from "lucide-react";
import type { RedemptionRequest, Cycle } from "../../../../src/types";
import { getCyclePresentation } from "../../../../src/lib/cyclePresentation";

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
    <div className="space-y-1" data-testid="cycle-countdown">
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
  cycleInfo,
}: {
  request: RedemptionRequest;
  cycleInfo?: Cycle | null;
}) {
  const cyclePresentation = getCyclePresentation(cycleInfo?.batchState);

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
          <p className="text-xs text-amber-50/70">Assigned cycle</p>
          <p className="text-sm font-mono font-medium text-amber-50" data-testid="target-cycle">
            #{request.targetCycle}
          </p>
        </div>
      </div>

      {cycleInfo?.batchState === "cutoff" && cycleInfo?.cutoffTime && (
        <div className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
            <span className="text-xs font-medium text-amber-100">Queue locked</span>
          </div>
          <CountdownTimer
            targetTime={cycleInfo.cutoffTime}
            label="The current cycle is locked and moving toward pricing."
          />
        </div>
      )}

      {cycleInfo?.batchState === "open" && (
        <div className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
            <span className="text-xs font-medium text-amber-100">Waiting for lock</span>
          </div>
          <p className="text-xs leading-6 text-amber-50/90">
            Your request stays open until the cycle locks. After that, the vault finalizes pricing
            and settles payouts.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 text-xs leading-6 text-amber-50/90">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-200" aria-hidden="true" />
        <p>
          This request is tied to cycle #{request.targetCycle}. Current vault state:{" "}
          <span className="font-medium">{cyclePresentation.label.toLowerCase()}</span>. Claims
          unlock after settlement completes.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-950/35 p-2 text-center">
        <p className="text-xs text-slate-300">
          Exit requests cannot be cancelled after the queue locks.
        </p>
      </div>
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
        <p className="text-sm font-medium text-white">No exit requests in flight</p>
        <p className="mt-1 max-w-xs text-xs leading-6 text-slate-400">
          Once you start an exit, it will appear here until the vault finishes settlement.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pending-requests">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Exit requests in progress</span>
        <Badge
          variant="secondary"
          className="border border-amber-400/25 bg-amber-400/12 text-amber-100"
        >
          {requests.length} active
        </Badge>
      </div>

      <div className="space-y-3">
        {requests.map((request) => (
          <PendingRequestCard key={request.requestId} request={request} cycleInfo={cycleInfo} />
        ))}
      </div>

      <Alert className="border-cyan-400/20 bg-cyan-400/10">
        <Calendar className="h-4 w-4 text-cyan-200" aria-hidden="true" />
        <AlertDescription className="text-xs leading-6 text-cyan-50/90">
          <span className="font-medium">What happens next:</span> the vault locks the queue,
          finalizes pricing, then releases claimable USDC once settlement is complete.
        </AlertDescription>
      </Alert>
    </div>
  );
}
