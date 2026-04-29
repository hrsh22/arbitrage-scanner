"use client";

import { Card, CardContent } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

// ============================================
// Types
// ============================================

export type SettlementStatusType =
  | "pending"
  | "settling"
  | "settled"
  | "delayed"
  | "stale-nav"
  | "insufficient-liquidity"
  | "ready";

export interface SettlementStatusProps {
  status: SettlementStatusType;
  reason?: string;
  estimatedCompletion?: Date | string | number;
  isLoading?: boolean;
  blockers?: SettlementBlocker[];
  className?: string;
}

export interface SettlementBlocker {
  type: "stale-nav" | "insufficient-liquidity" | "epoch-pending" | "unknown";
  message: string;
  severity: "warning" | "error" | "info";
}

const EMPTY_BLOCKERS: SettlementBlocker[] = [];

// ============================================
// Status Configuration
// ============================================

interface StatusConfig {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  colorClass: string;
  icon: React.ReactNode;
  description: string;
}

const STATUS_CONFIG: Record<SettlementStatusType, StatusConfig> = {
  pending: {
    label: "Pending",
    variant: "outline",
    colorClass: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    description: "Waiting for epoch to end",
  },
  ready: {
    label: "Ready",
    variant: "outline",
    colorClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    description: "Ready to settle",
  },
  settling: {
    label: "Settling",
    variant: "outline",
    colorClass: "border-blue-500/30 bg-blue-500/10 text-blue-700",
    icon: (
      <svg
        className="h-4 w-4 animate-spin"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
    ),
    description: "Settlement is in progress",
  },
  settled: {
    label: "Settled",
    variant: "outline",
    colorClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    description: "Settlement completed",
  },
  delayed: {
    label: "Delayed",
    variant: "outline",
    colorClass: "border-rose-500/30 bg-rose-500/10 text-rose-700",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
    description: "Settlement is delayed",
  },
  "stale-nav": {
    label: "Stale NAV",
    variant: "outline",
    colorClass: "border-rose-500/30 bg-rose-500/10 text-rose-700",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    description: "NAV update required before settlement",
  },
  "insufficient-liquidity": {
    label: "Low Liquidity",
    variant: "outline",
    colorClass: "border-orange-500/30 bg-orange-500/10 text-orange-700",
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    description: "Insufficient liquidity for full settlement",
  },
};

const BLOCKER_SEVERITY_COLORS: Record<
  SettlementBlocker["severity"],
  { bg: string; border: string; text: string; icon: string }
> = {
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    icon: "text-amber-500",
  },
  error: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-700",
    icon: "text-rose-500",
  },
  info: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    icon: "text-blue-500",
  },
};

// ============================================
// Helper Functions
// ============================================

function formatEstimatedTime(time: Date | string | number | undefined): string {
  if (!time) return "";
  const date = new Date(time);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "< 1 min";
    return `${diffMins} min`;
  }
  if (diffHours < 24) return `${diffHours} hours`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} days`;
}

function isDelayedStatus(status: SettlementStatusType): boolean {
  return status === "delayed" || status === "stale-nav" || status === "insufficient-liquidity";
}

// ============================================
// Blocker Component
// ============================================

function BlockerItem({ blocker }: { blocker: SettlementBlocker }) {
  const colors = BLOCKER_SEVERITY_COLORS[blocker.severity];

  return (
    <div className={`rounded-md border ${colors.border} ${colors.bg} p-3 flex items-start gap-2`}>
      <div className={`mt-0.5 ${colors.icon}`}>
        {blocker.severity === "error" ? (
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ) : blocker.severity === "warning" ? (
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        ) : (
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${colors.text}`}>{blocker.message}</p>
      </div>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function SettlementStatus({
  status,
  reason,
  estimatedCompletion,
  isLoading = false,
  blockers = EMPTY_BLOCKERS,
  className = "",
}: SettlementStatusProps) {
  const config = STATUS_CONFIG[status];
  const showBlockers = isDelayedStatus(status) && blockers.length > 0;

  if (isLoading) {
    return (
      <Card className={`border-border/50 ${className}`}>
        <CardContent className="p-4">
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-border/50 ${className}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`p-2 rounded-full ${config.colorClass}`}>{config.icon}</div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{config.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Settlement Status
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className={`${config.colorClass}`}>
                  {config.label}
                </Badge>
              </div>
            </div>
          </div>

          {estimatedCompletion && !isDelayedStatus(status) && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Est. completion</p>
              <p className="text-sm font-medium">{formatEstimatedTime(estimatedCompletion)}</p>
            </div>
          )}
        </div>

        {/* Delay Reason */}
        {(reason || showBlockers) && (
          <div className="pt-2 border-t border-border/50">
            {reason && !showBlockers && <p className="text-sm text-rose-700">{reason}</p>}

            {showBlockers && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Blockers preventing settlement:
                </p>
                {blockers.map((blocker) => (
                  <BlockerItem
                    key={`${blocker.type}-${blocker.severity}-${blocker.message}`}
                    blocker={blocker}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SettlementStatus;
