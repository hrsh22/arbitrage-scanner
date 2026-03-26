"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Info, FileText, Clock, Wallet, ChevronDown } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

interface WithdrawalInfoDialogProps {
  isQueuedMode: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
}

export function WithdrawalInfoDialog({
  isQueuedMode,
  triggerLabel = "How this works",
  triggerClassName = "",
}: WithdrawalInfoDialogProps) {
  const [open, setOpen] = useState(false);

  if (!isQueuedMode) return null;

  const flowSteps = [
    {
      key: "request",
      icon: FileText,
      label: "Submit Request",
      sublabel: "Enter amount",
      color: "cyan",
    },
    {
      key: "queue",
      icon: Clock,
      label: "Queue Processing",
      sublabel: "Vault batches",
      color: "amber",
    },
    {
      key: "claim",
      icon: Wallet,
      label: "Claim Funds",
      sublabel: "Receive USDC.e",
      color: "emerald",
    },
  ];

  const colorMap = {
    cyan: {
      bg: "from-cyan-500/20 to-cyan-600/5",
      border: "border-cyan-400/40",
      glow: "shadow-[0_0_30px_rgba(34,211,238,0.25)]",
      icon: "text-cyan-400",
      ring: "ring-cyan-400/30",
      line: "from-cyan-400",
      badge: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/20",
    },
    amber: {
      bg: "from-amber-500/20 to-amber-600/5",
      border: "border-amber-400/40",
      glow: "shadow-[0_0_30px_rgba(245,158,11,0.25)]",
      icon: "text-amber-400",
      ring: "ring-amber-400/30",
      line: "from-amber-400",
      badge: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
    },
    emerald: {
      bg: "from-emerald-500/20 to-emerald-600/5",
      border: "border-emerald-400/40",
      glow: "shadow-[0_0_30px_rgba(52,211,153,0.25)]",
      icon: "text-emerald-400",
      ring: "ring-emerald-400/30",
      line: "from-emerald-400",
      badge: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
    },
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ||
            "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] bg-[#121212] px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-inset ring-[#212121] transition-all hover:bg-[#212121] hover:text-white"
          }
        >
          <Info className="h-3.5 w-3.5" />
          <span>{triggerLabel}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[min(900px,96vw)] !max-w-none overflow-hidden rounded-[16px] border border-[#2A2F3A] bg-[#06080D] p-0 text-white shadow-[0_35px_120px_-45px_rgba(0,0,0,0.95)] max-h-[90vh] overflow-y-auto sm:rounded-[24px]">
        <DialogTitle className="sr-only">Withdrawal Process</DialogTitle>
        <DialogDescription className="sr-only">
          Explains how the withdrawal queue works.
        </DialogDescription>

        <div className="grid lg:grid-cols-[1fr_1.4fr]">
          <div className="relative border-b border-[#1C2533] bg-gradient-to-b from-[#0A0E17] to-[#060810] p-8 lg:border-b-0 lg:border-r lg:p-10">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
                backgroundSize: "24px 24px",
              }}
            />

            <h3 className="mb-8 text-center text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Withdrawal Flow
            </h3>

            <div className="relative mx-auto flex max-w-[200px] flex-col items-center gap-3">
              {flowSteps.map((step, index) => {
                const colors = colorMap[step.color as keyof typeof colorMap];
                const Icon = step.icon;
                const isLast = index === flowSteps.length - 1;

                return (
                  <div key={step.key} className="relative flex w-full flex-col items-center">
                    <div
                      className={cn(
                        "group relative flex h-[72px] w-full items-center gap-4 rounded-xl border bg-gradient-to-br px-4 transition-all duration-300 hover:scale-[1.02]",
                        colors.border,
                        colors.bg,
                        colors.glow,
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0D1117] ring-1",
                          colors.ring,
                        )}
                      >
                        <Icon className={cn("h-5 w-5", colors.icon)} />
                      </div>

                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-white">{step.label}</span>
                        <span className="text-[11px] text-slate-500">{step.sublabel}</span>
                      </div>

                      <div
                        className={cn(
                          "absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full",
                          step.color === "cyan" && "bg-cyan-400",
                          step.color === "amber" && "bg-amber-400",
                          step.color === "emerald" && "bg-emerald-400",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute inset-0 animate-ping rounded-full opacity-75",
                            step.color === "cyan" && "bg-cyan-400",
                            step.color === "amber" && "bg-amber-400",
                            step.color === "emerald" && "bg-emerald-400",
                          )}
                        />
                      </div>
                    </div>

                    {!isLast && (
                      <div className="flex h-8 flex-col items-center justify-center">
                        <div
                          className={cn("h-4 w-px bg-gradient-to-b to-transparent", colors.line)}
                        />
                        <ChevronDown className={cn("h-4 w-4 -mt-1", colors.icon, "opacity-60")} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-8 lg:p-12">
            <h2 className="mb-10 text-xl font-medium tracking-tight text-white lg:text-3xl">
              Withdrawal Process
            </h2>

            <div className="space-y-8">
              <div className="group flex gap-5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ring-1",
                    colorMap.cyan.badge,
                  )}
                >
                  1
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">Submit your request</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    Enter the amount of shares you want to withdraw and confirm the transaction.
                    Your request enters the withdrawal queue.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ring-1",
                    colorMap.amber.badge,
                  )}
                >
                  2
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">
                    Vault processes the queue
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    The vault batches withdrawal requests and processes them periodically based on
                    available liquidity and settlement cycles.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ring-1",
                    colorMap.emerald.badge,
                  )}
                >
                  3
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">Claim your funds</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    Once your withdrawal is processed, claim your USDC.e to your connected wallet.
                    You'll see the claimable amount in the redemption panel.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 rounded-xl border border-slate-500/20 bg-slate-500/5 p-4">
              <p className="text-[12px] leading-relaxed text-slate-400">
                <span className="font-semibold text-slate-300">Note:</span> Processing time depends
                on vault liquidity and market conditions. Check back periodically to claim your
                funds once ready.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
