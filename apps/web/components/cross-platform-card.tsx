"use client"

import { CrossPlatformOpportunity } from "@/lib/types"

type Props = {
    opportunity: CrossPlatformOpportunity
}

function getMatchBadgeColor(matchType: CrossPlatformOpportunity["matchType"]): string {
    switch (matchType) {
        case "high": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
        case "medium": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
        case "low": return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
    }
}

function formatNumber(num: number | undefined | null): string {
    if (num == null) return "-"
    if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`
    return `$${num.toFixed(0)}`
}

function getTimeUntil(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    if (diffMs < 0) return "Ended"
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    if (diffDays > 30) return date.toLocaleDateString()
    if (diffDays > 0) return `${diffDays}d ${diffHours}h`
    return `${diffHours}h`
}

export function CrossPlatformCard({ opportunity }: Props) {
    const hasArbitrage = opportunity.arbitrage.type !== "none"
    const profitPct = opportunity.arbitrage.profitPct

    // Use earliest end date between the two platforms
    const polyEndDate = opportunity.polymarket.endsAt
    const kalshiEndDate = opportunity.kalshi.closeTime
    const earliestEndDate = polyEndDate && kalshiEndDate
        ? new Date(polyEndDate) < new Date(kalshiEndDate) ? polyEndDate : kalshiEndDate
        : polyEndDate || kalshiEndDate
    const timeUntil = getTimeUntil(earliestEndDate)

    return (
        <div className={`flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition hover:shadow-md ${hasArbitrage
            ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/40"
            : "border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40"
            }`}>
            {/* Header with common info */}
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold uppercase tracking-wide ${hasArbitrage ? "text-emerald-700 dark:text-emerald-300" : "text-slate-600 dark:text-slate-400"
                            }`}>
                            {hasArbitrage ? "🔥 Arbitrage Found" : "🔗 Matched Markets"}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getMatchBadgeColor(opportunity.matchType)}`}>
                            {opportunity.matchType} ({(opportunity.matchConfidence * 100).toFixed(0)}%)
                        </span>
                        {timeUntil && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                                ⏰ {timeUntil}
                            </span>
                        )}
                    </div>
                    {hasArbitrage && (
                        <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                            +{profitPct.toFixed(2)}% profit
                        </div>
                    )}
                </div>
            </div>

            {/* Markets comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Polymarket */}
                <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 dark:border-purple-900/50 dark:bg-purple-950/30">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🟣</span>
                            <span className="font-semibold text-purple-700 dark:text-purple-300">Polymarket</span>
                        </div>
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2 mb-2">
                        {opportunity.polymarket.question}
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm">
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">YES: </span>
                            <span className="font-medium">{(opportunity.polymarket.yesBestAsk * 100).toFixed(1)}¢</span>
                        </div>
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">NO: </span>
                            <span className="font-medium">{(opportunity.polymarket.noBestAsk * 100).toFixed(1)}¢</span>
                        </div>
                    </div>
                    <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-purple-200/50 dark:border-purple-800/50 pt-2">
                        <div title="Liquidity">💰 {formatNumber(opportunity.polymarket.liquidity)}</div>
                        <div title="Volume">📊 {formatNumber(opportunity.polymarket.volume)}</div>
                    </div>
                </div>

                {/* Kalshi */}
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🔵</span>
                            <span className="font-semibold text-blue-700 dark:text-blue-300">Kalshi</span>
                        </div>
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2 mb-2">
                        {opportunity.kalshi.title}
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm">
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">YES: </span>
                            <span className="font-medium">{(opportunity.kalshi.yesAsk * 100).toFixed(1)}¢</span>
                        </div>
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">NO: </span>
                            <span className="font-medium">{(opportunity.kalshi.noAsk * 100).toFixed(1)}¢</span>
                        </div>
                    </div>
                    <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-blue-200/50 dark:border-blue-800/50 pt-2">
                        <div title="Liquidity">💰 {formatNumber(opportunity.kalshi.liquidity)}</div>
                        <div title="Volume">📊 {formatNumber(opportunity.kalshi.volume)}</div>
                    </div>
                </div>
            </div>

            {/* Arbitrage instruction */}
            {hasArbitrage && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-100/50 p-3 dark:border-emerald-800 dark:bg-emerald-900/30">
                    <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-1">
                        💡 Strategy
                    </div>
                    <div className="text-sm text-emerald-700 dark:text-emerald-300">
                        {opportunity.arbitrage.instruction}
                    </div>
                    <div className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                        Total cost: {(opportunity.arbitrage.totalCost * 100).toFixed(1)}¢ →
                        Guaranteed payout: 100¢ →
                        <span className="font-semibold"> Profit: {(opportunity.arbitrage.profit * 100).toFixed(1)}¢</span>
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
                <a
                    href={opportunity.polymarket.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-purple-700"
                >
                    Polymarket →
                </a>
                <a
                    href={opportunity.kalshi.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                    Kalshi →
                </a>
            </div>
        </div>
    )
}
