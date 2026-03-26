"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Info } from "lucide-react";

interface WithdrawalInfoDialogProps {
  isQueuedMode: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
}

export function WithdrawalInfoDialog({
  isQueuedMode,
  triggerLabel = "View process",
  triggerClassName = "",
}: WithdrawalInfoDialogProps) {
  if (!isQueuedMode) return null;

  return (
    <Dialog>
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
      <DialogContent className="w-full max-w-2xl rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-6 text-white shadow-none sm:p-8">
        <DialogHeader className="space-y-3 mb-2 text-left sm:text-center">
          <DialogTitle className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
            Withdrawal Process
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-slate-400">
            For security and efficient liquidity management, withdrawals from this vault are processed in batches.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3 mt-4">
          <div className="rounded-[4px] border border-[#212121] bg-[#121212] p-4 text-left">
            <p className="text-[10px] font-bold tracking-[0.16em] text-white">STEP 1</p>
            <p className="mt-2 text-sm font-semibold text-white">Submit request</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Enter the amount of shares you want to withdraw and confirm.
            </p>
          </div>

          <div className="rounded-[4px] border border-[#212121] bg-[#121212] p-4 text-left">
            <p className="text-[10px] font-bold tracking-[0.16em] text-white">STEP 2</p>
            <p className="mt-2 text-sm font-semibold text-white">Vault processing</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              The vault processes requests periodically based on available liquidity.
            </p>
          </div>

          <div className="rounded-[4px] border border-[#212121] bg-[#121212] p-4 text-left">
            <p className="text-[10px] font-bold tracking-[0.16em] text-white">STEP 3</p>
            <p className="mt-2 text-sm font-semibold text-white">Claim funds</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Once your withdrawal is ready, claim your USDC to your wallet.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
