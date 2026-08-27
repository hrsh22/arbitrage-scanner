"use client";

import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";

export interface RiskCalloutProps {
  type: "info" | "warning" | "error";
  title: string;
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

const severityConfig = {
  info: {
    icon: Info,
    borderColor: "border-blue-200",
    bgColor: "bg-blue-50",
    iconColor: "text-blue-600",
    titleColor: "text-blue-700",
    messageColor: "text-blue-600",
  },
  warning: {
    icon: AlertTriangle,
    borderColor: "border-amber-200",
    bgColor: "bg-amber-50",
    iconColor: "text-amber-600",
    titleColor: "text-amber-700",
    messageColor: "text-amber-600",
  },
  error: {
    icon: AlertCircle,
    borderColor: "border-rose-200",
    bgColor: "bg-rose-50",
    iconColor: "text-rose-600",
    titleColor: "text-rose-700",
    messageColor: "text-rose-600",
  },
} as const;

export function RiskCallout({
  type,
  title,
  message,
  dismissible = false,
  onDismiss,
}: RiskCalloutProps) {
  const config = severityConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-4`}
      role="alert"
      aria-live={type === "error" ? "assertive" : "polite"}
      data-testid={`risk-callout-${type}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 flex-shrink-0 ${config.iconColor}`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium ${config.titleColor}`}>{title}</h4>
          <p className={`text-sm mt-1 ${config.messageColor}`}>{message}</p>
        </div>
        {dismissible && onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="h-auto p-1 hover:bg-transparent"
            aria-label="Dismiss alert"
          >
            <X className={`h-4 w-4 ${config.iconColor}`} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

// Pre-configured risk callouts for specific lifecycle states

interface StaleNavWarningProps {
  navIsStale: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function StaleNavWarning({ navIsStale, dismissible, onDismiss }: StaleNavWarningProps) {
  if (!navIsStale) return null;

  return (
    <RiskCallout
      type="warning"
      title="Price Update Needed"
      message="Share price is updating. Some actions may be temporarily delayed."
      dismissible={dismissible}
      onDismiss={onDismiss}
    />
  );
}

interface BelowThresholdInfoProps {
  meetsThreshold: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function BelowThresholdInfo({
  meetsThreshold,
  dismissible,
  onDismiss,
}: BelowThresholdInfoProps) {
  if (meetsThreshold) return null;

  return (
    <RiskCallout
      type="info"
      title="Below Minimum"
      message="Your claim amount is below the minimum threshold."
      dismissible={dismissible}
      onDismiss={onDismiss}
    />
  );
}

interface ProRataWarningProps {
  proRataRatio: number;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function ProRataWarning({ proRataRatio, dismissible, onDismiss }: ProRataWarningProps) {
  if (proRataRatio >= 1) return null;

  return (
    <RiskCallout
      type="warning"
      title="Partial Withdrawal Possible"
      message="High demand may result in partial withdrawals."
      dismissible={dismissible}
      onDismiss={onDismiss}
    />
  );
}

interface DustOverrideInfoProps {
  dustOverrideEligible: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export function DustOverrideInfo({
  dustOverrideEligible,
  dismissible,
  onDismiss,
}: DustOverrideInfoProps) {
  if (!dustOverrideEligible) return null;

  return (
    <RiskCallout
      type="info"
      title="Small Balance Available"
      message="You can claim your remaining balance."
      dismissible={dismissible}
      onDismiss={onDismiss}
    />
  );
}
