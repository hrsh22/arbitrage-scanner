export type CycleState =
  | "open"
  | "closed"
  | "processing"
  | "processed"
  | "cutoff"
  | "flattening"
  | "settling"
  | "settled"
  | "reopen";

export interface CyclePresentation {
  label: string;
  eyebrow: string;
  description: string;
  detail: string;
  badgeClassName: string;
  dotClassName: string;
  panelClassName: string;
}

const DEFAULT_PRESENTATION: CyclePresentation = {
  label: "Loading",
  eyebrow: "Loading",
  description: "Loading vault status...",
  detail: "Refresh in a few seconds to see the latest status.",
  badgeClassName: "border-[#CCCAC4] bg-[#F1EEE8] text-[#615E4E]",
  dotClassName: "bg-[#A09E96]",
  panelClassName: "border-[#CCCAC4] bg-[#F0EDE8] text-[#615E4E]",
};

const CYCLE_PRESENTATIONS: Record<CycleState, CyclePresentation> = {
  open: {
    label: "Open",
    eyebrow: "Open",
    description: "Instant deposits and withdrawals at the current price.",
    detail: "Deposits and withdrawals are available now.",
    badgeClassName: "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]",
    dotClassName: "bg-[#58A65C]",
    panelClassName: "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]",
  },
  closed: {
    label: "Queue only",
    eyebrow: "Trading",
    description: "Trading is active. Deposits and withdrawals are queued.",
    detail: "Requests are processed together.",
    badgeClassName: "border-[#E8C08C]/40 bg-[#E8C08C]/20 text-[#8A6231]",
    dotClassName: "bg-[#E8C08C]",
    panelClassName: "border-[#E8C08C]/40 bg-[#E8C08C]/20 text-[#8A6231]",
  },
  processing: {
    label: "Processing",
    eyebrow: "Processing",
    description: "Queued deposits and withdrawals are being processed.",
    detail: "Processing in progress. Please wait.",
    badgeClassName: "border-[#CCCAC4] bg-[#F1EEE8] text-[#615E4E]",
    dotClassName: "bg-[#A09E96]",
    panelClassName: "border-[#CCCAC4] bg-[#F0EDE8] text-[#615E4E]",
  },
  processed: {
    label: "Processed",
    eyebrow: "Complete",
    description: "Processing complete. The vault is ready for the next round.",
    detail: "Processing complete. Vault is ready.",
    badgeClassName: "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]",
    dotClassName: "bg-[#58A65C]",
    panelClassName: "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]",
  },
  cutoff: {
    label: "Cutoff",
    eyebrow: "Transitioning",
    description: "The cycle is transitioning out of open mode.",
    detail: "Wait for the vault to enter the closed queue window or begin processing.",
    badgeClassName: "border-[#E8C08C]/40 bg-[#E8C08C]/20 text-[#8A6231]",
    dotClassName: "bg-[#E8C08C]",
    panelClassName: "border-[#E8C08C]/40 bg-[#E8C08C]/20 text-[#8A6231]",
  },
  flattening: {
    label: "Processing",
    eyebrow: "Processing",
    description: "Queued deposits and withdrawals are being processed.",
    detail: "Processing in progress. Please wait.",
    badgeClassName: "border-[#CCCAC4] bg-[#F1EEE8] text-[#615E4E]",
    dotClassName: "bg-[#A09E96]",
    panelClassName: "border-[#CCCAC4] bg-[#F0EDE8] text-[#615E4E]",
  },
  settling: {
    label: "Processing",
    eyebrow: "Processing",
    description: "Queued deposits and withdrawals are being finalized.",
    detail: "Processing in progress. Please wait.",
    badgeClassName: "border-[#CCCAC4] bg-[#F1EEE8] text-[#615E4E]",
    dotClassName: "bg-[#A09E96]",
    panelClassName: "border-[#CCCAC4] bg-[#F0EDE8] text-[#615E4E]",
  },
  settled: {
    label: "Processed",
    eyebrow: "Complete",
    description: "Processing complete. The vault is ready for the next round.",
    detail: "Processing complete. Vault is ready.",
    badgeClassName: "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]",
    dotClassName: "bg-[#58A65C]",
    panelClassName: "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]",
  },
  reopen: {
    label: "Processed",
    eyebrow: "Complete",
    description: "Processing complete. The vault is transitioning back to open mode.",
    detail: "The vault will reopen shortly.",
    badgeClassName: "border-[#CCCAC4] bg-[#F1EEE8] text-[#615E4E]",
    dotClassName: "bg-[#A09E96]",
    panelClassName: "border-[#CCCAC4] bg-[#F0EDE8] text-[#615E4E]",
  },
};

// Custom vault lifecycle presentation derived from explicit API fields
// Exposed for UI code paths that rely on per-field lifecycle data
export function getCustomCyclePresentationFromFields(fields: {
  riskState?: string;
  executionMode?: string;
  telemetryFresh?: boolean;
  liquidityMode?: string;
  reopenReady?: boolean;
  batchState?: string | null;
}): CyclePresentation {
  // Distinguish blocked/unknown from queued
  if (fields.executionMode === "blocked" || fields.telemetryFresh !== true) {
    return {
      label: "Paused",
      eyebrow: "Paused",
      description: "Temporarily paused.",
      detail: "Deposits and withdrawals are paused.",
      badgeClassName: "border-rose-400/25 bg-rose-50 text-rose-700",
      dotClassName: "bg-rose-500",
      panelClassName: "border-rose-400/25 bg-rose-50 text-rose-700",
    } as CyclePresentation;
  }
  const isInstant = fields.executionMode === "instant";
  // If telemetry is stale/unknown, still render a consistent presentation but with a distinct style
  const label = isInstant ? "Instant" : "Queued";
  const eyebrow = isInstant ? "Instant mode" : "Queued mode";
  const description = isInstant
    ? "Instant deposits and withdrawals available."
    : "Deposits and withdrawals are queued for the current cycle.";
  const detail = isInstant
    ? "Transactions process instantly at the current price."
    : "Requests will process at the end of the current cycle.";
  const badgeClassName = isInstant
    ? "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]"
    : "border-[#E8C08C]/40 bg-[#E8C08C]/20 text-[#8A6231]";
  const dotClassName = isInstant ? "bg-[#58A65C]" : "bg-[#E8C08C]";
  const panelClassName = isInstant
    ? "border-[#58A65C]/25 bg-[#58A65C]/10 text-[#2F7A35]"
    : "border-[#E8C08C]/40 bg-[#E8C08C]/20 text-[#8A6231]";
  return {
    label,
    eyebrow,
    description,
    detail,
    badgeClassName,
    dotClassName,
    panelClassName,
  };
}

export const CYCLE_STEPS: Array<{ state: CycleState; label: string }> = [
  { state: "open", label: "Open" },
  { state: "closed", label: "Queue" },
  { state: "processing", label: "Processing" },
  { state: "processed", label: "Processed" },
];

export function getCyclePresentation(state?: string | null): CyclePresentation {
  if (!state) {
    return DEFAULT_PRESENTATION;
  }

  return CYCLE_PRESENTATIONS[state as CycleState] ?? DEFAULT_PRESENTATION;
}

export function getCycleStepIndex(state?: string | null): number {
  if (!state) {
    return 0;
  }

  if (state === "cutoff") return 1;
  if (state === "flattening" || state === "settling") return 2;
  if (state === "settled" || state === "reopen") return 3;
  if (state === "closed") {
    return 1;
  }

  const index = CYCLE_STEPS.findIndex((step) => step.state === state);
  return index === -1 ? 0 : index;
}
