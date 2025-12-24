"use client";

import { useState } from "react";
import { Opportunity } from "@/lib/types";
import { postAction } from "@/lib/api";

type Props = {
  opportunity: Opportunity;
  showExpiredBadge?: boolean;
  onActionComplete?: () => void;
};

export function OpportunityCard({ opportunity, showExpiredBadge, onActionComplete }: Props) {
  const [submitting, setSubmitting] = useState<null | "executed" | "missed">(null);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: "executed" | "missed") => {
    setSubmitting(action);
    setError(null);
    try {
      await postAction(opportunity.key, action);
      onActionComplete?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(null);
    }
  };

  const isExpired = opportunity.expiredAt !== null && opportunity.expiredAt !== undefined;
  const cardStyle = isExpired
    ? "border-slate-300 bg-slate-50/60 opacity-75 dark:border-slate-700 dark:bg-slate-900/40"
    : "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/40";

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition hover:shadow-md ${cardStyle}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${
                isExpired
                  ? "text-slate-500 dark:text-slate-400"
                  : "text-emerald-700 dark:text-emerald-300"
              }`}
            >
              {isExpired ? "Expired" : "Delta-Neutral Arbitrage"}
            </span>
            {showExpiredBadge && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  isExpired
                    ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                }`}
              >
                {isExpired ? "Gone" : "Active"}
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {opportunity.question}
          </h3>
          {opportunity.detectedAt && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Detected: {new Date(opportunity.detectedAt).toLocaleString()}
              {isExpired && opportunity.expiredAt && (
                <> • Expired: {new Date(opportunity.expiredAt).toLocaleString()}</>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div
            className={`text-2xl font-bold ${
              isExpired
                ? "text-slate-600 dark:text-slate-400"
                : "text-emerald-600 dark:text-emerald-300"
            }`}
          >
            +{opportunity.profitPercentage.toFixed(2)}%
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            ${opportunity.profitAbsolute.toFixed(4)} profit per $1
          </div>
        </div>
      </div>

      {/* Outcome breakdown - Buy Yes AND No */}
      {opportunity.outcomes && opportunity.outcomes.length === 2 && (
        <div className="rounded-lg border border-slate-200 bg-white/80 overflow-hidden dark:border-slate-700 dark:bg-slate-800/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                  Action
                </th>
                <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">
                  Ask Price
                </th>
                <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">
                  Liquidity
                </th>
              </tr>
            </thead>
            <tbody>
              {opportunity.outcomes.map((outcome, index) => (
                <tr key={index} className="border-b border-slate-100 dark:border-slate-700">
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                    Buy {outcome.name}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                    ${outcome.askPrice.toFixed(4)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">
                    ${outcome.liquidity.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr
                className={`font-semibold ${isExpired ? "bg-slate-100 dark:bg-slate-800" : "bg-emerald-50 dark:bg-emerald-900/30"}`}
              >
                <td className="px-3 py-2 text-slate-800 dark:text-slate-200">Total Cost</td>
                <td
                  className={`px-3 py-2 text-right ${isExpired ? "text-slate-700 dark:text-slate-300" : "text-emerald-700 dark:text-emerald-300"}`}
                >
                  ${opportunity.totalCost.toFixed(4)}
                </td>
                <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">
                  ${opportunity.availableLiquidity.toFixed(2)}
                </td>
              </tr>
              <tr
                className={`font-bold ${isExpired ? "bg-slate-200 dark:bg-slate-700" : "bg-emerald-100 dark:bg-emerald-900/50"}`}
              >
                <td
                  className={`px-3 py-2 ${isExpired ? "text-slate-800 dark:text-slate-200" : "text-emerald-800 dark:text-emerald-200"}`}
                >
                  Guaranteed Payout
                </td>
                <td
                  className={`px-3 py-2 text-right ${isExpired ? "text-slate-800 dark:text-slate-200" : "text-emerald-800 dark:text-emerald-200"}`}
                >
                  $1.0000
                </td>
                <td className="px-3 py-2"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-3">
        <div>
          <div className="font-semibold">{opportunity.score.toFixed(2)}</div>
          <div className="text-slate-500 dark:text-slate-400">Score</div>
        </div>
        <div>
          <div className="font-semibold">
            {opportunity.closesAt
              ? new Date(opportunity.closesAt).toLocaleDateString()
              : "No expiry"}
          </div>
          <div className="text-slate-500 dark:text-slate-400">Market Closes</div>
        </div>
        <div>
          <div className="font-semibold">${opportunity.availableLiquidity.toFixed(2)}</div>
          <div className="text-slate-500 dark:text-slate-400">Max Trade</div>
        </div>
      </div>

      {/* Actions */}
      {!isExpired && (
        <div className="flex flex-wrap items-center gap-3">
          {opportunity.marketUrl ? (
            <a
              href={opportunity.marketUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Execute on Polymarket →
            </a>
          ) : null}
          <button
            disabled={submitting !== null}
            onClick={() => handleAction("executed")}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting === "executed" ? "Saving..." : "Mark Executed ✓"}
          </button>
          <button
            disabled={submitting !== null}
            onClick={() => handleAction("missed")}
            className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {submitting === "missed" ? "Saving..." : "Mark Missed"}
          </button>
          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
        </div>
      )}
    </div>
  );
}
