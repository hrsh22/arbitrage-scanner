"use client"

import { NearResolutionOpportunity } from "@/lib/types"

type Props = {
    opportunity: NearResolutionOpportunity
}

function formatTimeLeft(hours: number): string {
    if (hours < 1) {
        const minutes = Math.floor(hours * 60)
        return `${minutes}m`
    }
    if (hours < 24) {
        return `${Math.floor(hours)}h`
    }
    const days = Math.floor(hours / 24)
    const remainingHours = Math.floor(hours % 24)
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

function getUrgencyColor(hours: number): string {
    if (hours < 6) return "text-red-600 dark:text-red-400"
    if (hours < 24) return "text-orange-600 dark:text-orange-400"
    return "text-yellow-600 dark:text-yellow-400"
}

export function NearResolutionCard({ opportunity }: Props) {
    const probability = opportunity.likelyOutcome.probability * 100
    const potentialProfit = opportunity.potentialProfit * 100
    const expectedValue = opportunity.expectedValue * 100
    const buyPrice = opportunity.likelyOutcome.bestAsk * 100

    const marketUrl = opportunity.eventSlug
        ? `https://polymarket.com/event/${opportunity.eventSlug}`
        : opportunity.marketSlug
            ? `https://polymarket.com/event/${opportunity.marketSlug}`
            : null

    return (
        <div className="flex flex-col gap-3 rounded-xl border border-blue-300 bg-blue-50/60 p-4 shadow-sm transition hover:shadow-md dark:border-blue-900/50 dark:bg-blue-950/40">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                            Near Resolution
                        </span>
                        <span className={`text-xs font-bold ${getUrgencyColor(opportunity.hoursUntilClose)}`}>
                            ⏰ {formatTimeLeft(opportunity.hoursUntilClose)} left
                        </span>
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                        {opportunity.question}
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        Closes: {new Date(opportunity.closesAt).toLocaleString()}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-300">
                        {probability.toFixed(1)}%
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                        Likely: {opportunity.likelyOutcome.name}
                    </div>
                </div>
            </div>

            {/* Strategy breakdown */}
            <div className="rounded-lg border border-slate-200 bg-white/80 overflow-hidden dark:border-slate-700 dark:bg-slate-800/50">
                <table className="w-full text-sm">
                    <tbody>
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">Buy "{opportunity.likelyOutcome.name}" at</td>
                            <td className="px-3 py-2 text-right font-medium text-slate-800 dark:text-slate-200">
                                {buyPrice.toFixed(1)}¢
                            </td>
                        </tr>
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">If correct, profit</td>
                            <td className="px-3 py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">
                                +{potentialProfit.toFixed(1)}¢
                            </td>
                        </tr>
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">If wrong, loss</td>
                            <td className="px-3 py-2 text-right font-medium text-red-600 dark:text-red-400">
                                -{buyPrice.toFixed(1)}¢
                            </td>
                        </tr>
                        <tr className="bg-blue-50 dark:bg-blue-900/30">
                            <td className="px-3 py-2 font-semibold text-blue-800 dark:text-blue-200">Expected Value</td>
                            <td className={`px-3 py-2 text-right font-bold ${expectedValue > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                {expectedValue > 0 ? "+" : ""}{expectedValue.toFixed(2)}¢
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 text-sm text-slate-700 dark:text-slate-200">
                <div>
                    <div className="font-semibold">{probability.toFixed(1)}%</div>
                    <div className="text-slate-500 dark:text-slate-400">Probability</div>
                </div>
                <div>
                    <div className={`font-semibold ${getUrgencyColor(opportunity.hoursUntilClose)}`}>
                        {formatTimeLeft(opportunity.hoursUntilClose)}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">Time Left</div>
                </div>
                <div>
                    <div className="font-semibold">
                        ${opportunity.likelyOutcome.liquidity > 0
                            ? opportunity.likelyOutcome.liquidity.toFixed(0)
                            : "N/A"}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">Liquidity</div>
                </div>
            </div>

            {/* Action */}
            {marketUrl && (
                <a
                    href={marketUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                    Trade on Polymarket →
                </a>
            )}
        </div>
    )
}
