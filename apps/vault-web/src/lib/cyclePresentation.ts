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
  label: "Cycle update pending",
  eyebrow: "Waiting for sync",
  description: "The latest cycle state is still loading.",
  detail: "Refresh in a few seconds to see the latest vault activity.",
  badgeClassName: "border-white/15 bg-white/8 text-slate-200",
  dotClassName: "bg-slate-300",
  panelClassName: "border-white/10 bg-white/6 text-slate-100",
};

const CYCLE_PRESENTATIONS: Record<CycleState, CyclePresentation> = {
  open: {
    label: "Open",
    eyebrow: "Instant mode",
    description: "Vault is flat and uses live NAV for immediate deposits and withdrawals.",
    detail: "No queue is used in this state.",
    badgeClassName: "border-emerald-400/30 bg-emerald-400/12 text-emerald-200",
    dotClassName: "bg-emerald-300",
    panelClassName: "border-emerald-400/20 bg-emerald-400/10 text-emerald-50",
  },
  closed: {
    label: "Queue only",
    eyebrow: "Trading active",
    description: "Positions are active; deposits and redemptions are queued.",
    detail: "Queued actions are processed together once the vault is flat again.",
    badgeClassName: "border-amber-400/30 bg-amber-400/12 text-amber-200",
    dotClassName: "bg-amber-300",
    panelClassName: "border-amber-400/20 bg-amber-400/10 text-amber-50",
  },
  processing: {
    label: "Processing",
    eyebrow: "Locked NAV",
    description: "Queued deposits and redemptions are being processed at one locked NAV.",
    detail: "Queue is frozen until processing completes.",
    badgeClassName: "border-sky-400/30 bg-sky-400/12 text-sky-200",
    dotClassName: "bg-sky-300",
    panelClassName: "border-sky-400/20 bg-sky-400/10 text-sky-50",
  },
  processed: {
    label: "Processed",
    eyebrow: "Cycle complete",
    description: "Queued actions were settled; vault can reopen for instant actions.",
    detail: "This marks the boundary between invested and flat windows.",
    badgeClassName: "border-cyan-400/30 bg-cyan-400/12 text-cyan-200",
    dotClassName: "bg-cyan-300",
    panelClassName: "border-cyan-400/20 bg-cyan-400/10 text-cyan-50",
  },
  cutoff: {
    label: "Queue only",
    eyebrow: "Legacy state",
    description: "Legacy cutoff state is treated as queue-only mode.",
    detail: "Requests are no longer cancellable after this point.",
    badgeClassName: "border-amber-400/30 bg-amber-400/12 text-amber-200",
    dotClassName: "bg-amber-300",
    panelClassName: "border-amber-400/20 bg-amber-400/10 text-amber-50",
  },
  flattening: {
    label: "Processing",
    eyebrow: "Legacy state",
    description: "Legacy flattening state maps to processing semantics.",
    detail: "Pricing is considered locked for queued actions.",
    badgeClassName: "border-sky-400/30 bg-sky-400/12 text-sky-200",
    dotClassName: "bg-sky-300",
    panelClassName: "border-sky-400/20 bg-sky-400/10 text-sky-50",
  },
  settling: {
    label: "Processing",
    eyebrow: "Legacy state",
    description: "Legacy settling state maps to processing semantics.",
    detail: "Queued redemptions and deposits are being finalized.",
    badgeClassName: "border-violet-400/30 bg-violet-400/12 text-violet-200",
    dotClassName: "bg-violet-300",
    panelClassName: "border-violet-400/20 bg-violet-400/10 text-violet-50",
  },
  settled: {
    label: "Processed",
    eyebrow: "Legacy state",
    description: "Legacy settled state maps to processed lifecycle semantics.",
    detail: "Cycle payout computation has completed.",
    badgeClassName: "border-cyan-400/30 bg-cyan-400/12 text-cyan-200",
    dotClassName: "bg-cyan-300",
    panelClassName: "border-cyan-400/20 bg-cyan-400/10 text-cyan-50",
  },
  reopen: {
    label: "Processed",
    eyebrow: "Legacy state",
    description: "Legacy reopen state maps to processed lifecycle semantics.",
    detail: "Vault is transitioning back to open mode.",
    badgeClassName: "border-fuchsia-400/30 bg-fuchsia-400/12 text-fuchsia-200",
    dotClassName: "bg-fuchsia-300",
    panelClassName: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-50",
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
      label: "Blocked",
      eyebrow: "Blocked",
      description: "Telemetry is unavailable or vault is blocked.",
      detail: "Blocked/Unknown lifecycle; queued actions do not apply.",
      badgeClassName: "border-red-400/30 bg-red-400/12 text-red-200",
      dotClassName: "bg-red-300",
      panelClassName: "border-red-400/20 bg-red-400/10 text-red-50",
    } as CyclePresentation;
  }
  const isInstant = fields.executionMode === "instant";
  // If telemetry is stale/unknown, still render a consistent presentation but with a distinct style
  const label = isInstant ? "Instant" : "Queued";
  const eyebrow = isInstant ? "Instant mode" : "Queued mode";
  const description = isInstant
    ? "Custom vault is currently allowing direct actions."
    : "Custom vault is currently using a queued workflow.";
  const detail = isInstant
    ? "Instant actions execute immediately at current NAV."
    : "Deposits and withdrawals are queued until the vault opens its pricing window.";
  const badgeClassName = isInstant
    ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-200"
    : "border-amber-400/30 bg-amber-400/12 text-amber-200";
  const dotClassName = isInstant ? "bg-emerald-300" : "bg-amber-300";
  const panelClassName = isInstant
    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-50"
    : "border-amber-400/20 bg-amber-400/10 text-amber-50";
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
