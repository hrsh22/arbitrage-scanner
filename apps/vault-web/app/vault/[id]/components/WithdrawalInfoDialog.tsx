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
import { COLLATERAL_SYMBOL } from "../../../../src/constants";

interface WithdrawalInfoDialogProps {
  isQueuedMode: boolean;
  displaySymbol?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}

export function WithdrawalInfoDialog({
  isQueuedMode,
  displaySymbol = COLLATERAL_SYMBOL,
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
      color: "orange",
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
      sublabel: `Receive ${displaySymbol}`,
      color: "emerald",
    },
  ];

  const colorMap = {
    orange: {
      bg: "from-[#E8C08C]/25 to-[#E8C08C]/5",
      border: "border-[#D4A574]/35",
      glow: "shadow-[0_12px_30px_-24px_rgba(48,43,44,0.35)]",
      icon: "text-[#8A6231]",
      ring: "ring-[#D4A574]/35",
      line: "from-[#D4A574]",
      badge: "bg-[#E8C08C]/25 text-[#8A6231] ring-[#D4A574]/35",
    },
    amber: {
      bg: "from-[#E8D9C0]/60 to-[#F1EEE8]/70",
      border: "border-[#CCCAC4]",
      glow: "shadow-[0_12px_30px_-24px_rgba(48,43,44,0.28)]",
      icon: "text-[#8A6231]",
      ring: "ring-[#CCCAC4]",
      line: "from-[#B8915B]",
      badge: "bg-[#E8D9C0] text-[#8A6231] ring-[#CCCAC4]",
    },
    emerald: {
      bg: "from-[#58A65C]/12 to-[#58A65C]/5",
      border: "border-[#58A65C]/25",
      glow: "shadow-[0_12px_30px_-24px_rgba(48,43,44,0.25)]",
      icon: "text-[#2F7A35]",
      ring: "ring-[#58A65C]/25",
      line: "from-[#58A65C]",
      badge: "bg-[#58A65C]/10 text-[#2F7A35] ring-[#58A65C]/25",
    },
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ||
            "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#CCCAC4] bg-[#F1EEE8] px-3 py-1.5 text-xs font-bold text-[#615E4E] transition-colors hover:border-[#D4A574] hover:bg-[#E8C08C] hover:text-[#302B2C]"
          }
        >
          <Info className="h-3.5 w-3.5" />
          <span>{triggerLabel}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[min(900px,96vw)] !max-w-none overflow-y-auto overscroll-contain rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] p-0 text-[#1A202C] shadow-[0_35px_120px_-55px_rgba(26,32,44,0.65)] [&_[data-slot=dialog-close]]:text-[#615E4E] [&_[data-slot=dialog-close]]:hover:text-[#302B2C]">
        <DialogTitle className="sr-only">Withdrawal Process</DialogTitle>
        <DialogDescription className="sr-only">
          Explains how the withdrawal queue works.
        </DialogDescription>

        <div className="grid min-h-0 lg:grid-cols-[1fr_1.4fr]">
          <div className="relative border-b border-[#CCCAC4] bg-[#F0EDE8] p-4 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, rgba(184,145,91,0.42) 1px, transparent 0)`,
                backgroundSize: "24px 24px",
              }}
            />

            <h3 className="mb-8 text-center text-xs font-bold uppercase tracking-[0.2em] text-[#615E4E]">
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
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F1EEE8] ring-1",
                          colors.ring,
                        )}
                      >
                        <Icon className={cn("h-5 w-5", colors.icon)} />
                      </div>

                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-[#1A202C]">{step.label}</span>
                        <span className="text-[11px] text-[#615E4E]">{step.sublabel}</span>
                      </div>

                      <div
                        className={cn(
                          "absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full",
                          step.color === "orange" && "bg-orange-400",
                          step.color === "amber" && "bg-amber-400",
                          step.color === "emerald" && "bg-emerald-400",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute inset-0 animate-ping rounded-full opacity-75",
                            step.color === "orange" && "bg-orange-400",
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

          <div className="p-4 sm:p-8 lg:p-12">
            <h2 className="mb-10 font-serif text-2xl font-bold tracking-tight text-[#1A202C] lg:text-4xl">
              Withdrawal Process
            </h2>

            <div className="space-y-8">
              <div className="group flex gap-5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1",
                    colorMap.orange.badge,
                  )}
                >
                  1
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#1A202C]">Submit your request</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#615E4E]">
                    Enter the amount of shares you want to withdraw and confirm the transaction.
                    Your request enters the withdrawal queue.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1",
                    colorMap.amber.badge,
                  )}
                >
                  2
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#1A202C]">
                    Vault processes the queue
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#615E4E]">
                    The vault batches withdrawal requests and processes them periodically based on
                    available liquidity and settlement cycles.
                  </p>
                </div>
              </div>

              <div className="group flex gap-5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1",
                    colorMap.emerald.badge,
                  )}
                >
                  3
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#1A202C]">Claim your funds</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#615E4E]">
                    Once your withdrawal is processed, claim your {displaySymbol} to your connected
                    wallet. You&apos;ll see the claimable amount in the redemption panel.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-4">
              <p className="text-[12px] leading-relaxed text-[#615E4E]">
                <span className="font-bold text-[#1A202C]">Note:</span> Processing time depends on
                vault liquidity and market conditions. Check back periodically to claim your funds
                once ready.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
