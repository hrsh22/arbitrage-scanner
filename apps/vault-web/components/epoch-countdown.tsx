"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";

// ============================================
// Types
// ============================================

export interface EpochCountdownProps {
  targetTime: Date | string | number;
  onComplete?: () => void;
  isSettling?: boolean;
  isLoading?: boolean;
  timezone?: "UTC" | "local";
  showSeconds?: boolean;
  className?: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isComplete: boolean;
  totalMs: number;
}

// ============================================
// Time Calculation
// ============================================

function calculateTimeLeft(targetTime: Date | string | number): TimeLeft {
  const target = new Date(targetTime).getTime();
  const now = Date.now();
  const diff = target - now;

  if (diff <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isComplete: true,
      totalMs: 0,
    };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return {
    days,
    hours,
    minutes,
    seconds,
    isComplete: false,
    totalMs: diff,
  };
}

function formatTimeValue(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatTargetTime(targetTime: Date | string | number, timezone: "UTC" | "local"): string {
  const date = new Date(targetTime);
  if (timezone === "UTC") {
    return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// ============================================
// Time Unit Component
// ============================================

function TimeUnit({
  value,
  label,
  isUrgent,
}: {
  value: number;
  label: string;
  isUrgent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`rounded-lg bg-slate-100 px-3 py-2 min-w-[3rem] text-center ${
          isUrgent ? "bg-rose-100 text-rose-700" : "text-slate-700"
        }`}
      >
        <span className="text-xl font-bold tabular-nums">{formatTimeValue(value)}</span>
      </div>
      <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <div className="flex flex-col justify-center pb-5">
      <span className="text-xl font-bold text-slate-400">:</span>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function EpochCountdown({
  targetTime,
  onComplete,
  isSettling = false,
  isLoading = false,
  timezone = "local",
  showSeconds = true,
  className = "",
}: EpochCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => calculateTimeLeft(targetTime));
  const [serverOffset, setServerOffset] = useState<number>(0);

  // Sync timer every second
  useEffect(() => {
    // Initial calculation
    setTimeLeft(calculateTimeLeft(targetTime));

    // Update every second
    const interval = setInterval(() => {
      const newTimeLeft = calculateTimeLeft(targetTime);
      setTimeLeft(newTimeLeft);

      if (newTimeLeft.isComplete) {
        onComplete?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTime, onComplete]);

  // Periodic sync with server time (every 30 seconds)
  useEffect(() => {
    const syncInterval = setInterval(() => {
      // In a real implementation, this would fetch server time
      // For now, we use the browser time as baseline
      const now = Date.now();
      // Server time sync would adjust serverOffset here
      // setServerOffset(serverTime - now);
    }, 30000);

    return () => clearInterval(syncInterval);
  }, []);

  // Adjust target time by server offset
  const adjustedTargetTime =
    typeof targetTime === "number" ? targetTime - serverOffset : targetTime;

  if (isLoading) {
    return (
      <Card className={`border-border/50 ${className}`}>
        <CardContent className="p-4">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Settlement in progress state
  if (isSettling || timeLeft.isComplete) {
    return (
      <Card className={`border-border/50 ${className}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="h-3 w-3 rounded-full bg-blue-500 animate-pulse" />
              <div className="absolute inset-0 h-3 w-3 rounded-full bg-blue-500 animate-ping opacity-75" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-700">Settlement in Progress</p>
              <p className="text-xs text-muted-foreground">Redemptions are being processed</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isUrgent = timeLeft.totalMs < 3600000; // Less than 1 hour
  const showDays = timeLeft.days > 0;

  return (
    <Card className={`border-border/50 ${className}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Next Settlement
          </p>
          <p className="text-[10px] text-muted-foreground">
            {formatTargetTime(adjustedTargetTime, timezone)}
          </p>
        </div>

        <div className="flex items-center justify-center gap-1 sm:gap-2">
          {showDays && (
            <>
              <TimeUnit value={timeLeft.days} label="Days" isUrgent={isUrgent} />
              <Separator />
            </>
          )}
          <TimeUnit value={timeLeft.hours} label="Hours" isUrgent={isUrgent} />
          <Separator />
          <TimeUnit value={timeLeft.minutes} label="Mins" isUrgent={isUrgent} />
          {showSeconds && (
            <>
              <Separator />
              <TimeUnit value={timeLeft.seconds} label="Secs" isUrgent={isUrgent} />
            </>
          )}
        </div>

        {isUrgent && (
          <p className="mt-3 text-center text-xs text-rose-600">Less than 1 hour remaining</p>
        )}
      </CardContent>
    </Card>
  );
}

export default EpochCountdown;
