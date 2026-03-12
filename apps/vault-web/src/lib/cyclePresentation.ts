export type CycleState =
  | "open"
  | "cutoff"
  | "flattening"
  | "settling"
  | "settled"
  | "closed"
  | "reopen";

interface CyclePresentation {
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
  description: "The latest cycle state is still loading from the vault API.",
  detail: "Refresh in a few seconds to see the latest vault activity.",
  badgeClassName: "border-white/15 bg-white/8 text-slate-200",
  dotClassName: "bg-slate-300",
  panelClassName: "border-white/10 bg-white/6 text-slate-100",
};

const CYCLE_PRESENTATIONS: Record<CycleState, CyclePresentation> = {
  open: {
    label: "Accepting requests",
    eyebrow: "Open cycle",
    description: "Deposits and exit requests are open for this cycle.",
    detail: "You can still join the next batch or ask to exit before the queue locks.",
    badgeClassName: "border-emerald-400/30 bg-emerald-400/12 text-emerald-200",
    dotClassName: "bg-emerald-300",
    panelClassName: "border-emerald-400/20 bg-emerald-400/10 text-emerald-50",
  },
  cutoff: {
    label: "Queue locked",
    eyebrow: "Requests locked",
    description: "This cycle is sealed. New deposits now roll into the next cycle.",
    detail: "Existing exit requests are locked in and can no longer be cancelled.",
    badgeClassName: "border-amber-400/30 bg-amber-400/12 text-amber-200",
    dotClassName: "bg-amber-300",
    panelClassName: "border-amber-400/20 bg-amber-400/10 text-amber-50",
  },
  flattening: {
    label: "Pricing locked",
    eyebrow: "Finalizing positions",
    description: "The vault is flattening positions and locking the cycle clearing price.",
    detail:
      "No live estimate changes after this point; queued deposits and exits use the locked price.",
    badgeClassName: "border-sky-400/30 bg-sky-400/12 text-sky-200",
    dotClassName: "bg-sky-300",
    panelClassName: "border-sky-400/20 bg-sky-400/10 text-sky-50",
  },
  settling: {
    label: "Settlement running",
    eyebrow: "Calculating payouts",
    description: "The vault is processing redemptions and assigning final claim amounts.",
    detail: "Requests are locked while the vault converts the cycle into final balances.",
    badgeClassName: "border-violet-400/30 bg-violet-400/12 text-violet-200",
    dotClassName: "bg-violet-300",
    panelClassName: "border-violet-400/20 bg-violet-400/10 text-violet-50",
  },
  settled: {
    label: "Claims ready",
    eyebrow: "Cycle complete",
    description: "Settlement finished and claimable USDC is available now.",
    detail: "If you redeemed in this cycle, you can claim your proceeds from the claim panel.",
    badgeClassName: "border-cyan-400/30 bg-cyan-400/12 text-cyan-200",
    dotClassName: "bg-cyan-300",
    panelClassName: "border-cyan-400/20 bg-cyan-400/10 text-cyan-50",
  },
  closed: {
    label: "Archived",
    eyebrow: "Claims window closed",
    description: "This cycle is now part of the vault record and no longer active.",
    detail: "The vault has already moved on to the next operating window.",
    badgeClassName: "border-slate-400/30 bg-slate-400/12 text-slate-200",
    dotClassName: "bg-slate-300",
    panelClassName: "border-white/10 bg-white/6 text-slate-100",
  },
  reopen: {
    label: "Next cycle ready",
    eyebrow: "Rolled forward",
    description: "The last cycle is done and the vault has already opened the next one.",
    detail: "Think of this as a fresh intake window, not a literal reopen of the old batch.",
    badgeClassName: "border-fuchsia-400/30 bg-fuchsia-400/12 text-fuchsia-200",
    dotClassName: "bg-fuchsia-300",
    panelClassName: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-50",
  },
};

export const CYCLE_STEPS: Array<{ state: CycleState; label: string }> = [
  { state: "open", label: "Open" },
  { state: "cutoff", label: "Locked" },
  { state: "flattening", label: "Price lock" },
  { state: "settling", label: "Settlement" },
  { state: "settled", label: "Claims" },
];

export function getCyclePresentation(state?: string | null): CyclePresentation {
  if (!state) {
    return DEFAULT_PRESENTATION;
  }

  return CYCLE_PRESENTATIONS[state as CycleState] ?? DEFAULT_PRESENTATION;
}

export function getCycleStepIndex(state?: string | null): number {
  if (state === "closed" || state === "reopen") {
    return CYCLE_STEPS.length - 1;
  }

  const index = CYCLE_STEPS.findIndex((step) => step.state === state);
  return index === -1 ? 0 : index;
}
