"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import {
    ArrowLeft,
    TrendingUp,
    Clock,
    Activity,
    BarChart3,
    ChevronDown,
    ChevronUp,
    ExternalLink,
} from "lucide-react"
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from "recharts"
import {
    fetchCrossPlatformHistory,
    fetchCrossPlatformStats,
    fetchCrossPlatformSnapshots,
} from "@/lib/api"
import type {
    CrossPlatformHistoryItem,
    CrossPlatformStats,
    CrossPlatformSnapshot,
} from "@/lib/types"

// Format duration in human readable format
function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

// Format percentage (API returns values like 2.56 for 2.56%)
function formatPct(pct: number): string {
    return `${pct.toFixed(2)}%`
}

// Format date/time
function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

// Stats Card component
function StatCard({
    title,
    value,
    subtitle,
    icon: Icon,
    color,
}: {
    title: string
    value: string | number
    subtitle?: string
    icon: React.ElementType
    color: string
}) {
    return (
        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-5 backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-lg ${color}`}>
                    <Icon className="w-5 h-5" />
                </div>
                <span className="text-sm text-white/60">{title}</span>
            </div>
            <div className="text-2xl font-bold text-white">{value}</div>
            {subtitle && <div className="text-sm text-white/40 mt-1">{subtitle}</div>}
        </div>
    )
}

// Profit Chart component
function ProfitChart({
    snapshots,
    isLoading,
}: {
    snapshots: CrossPlatformSnapshot[]
    isLoading: boolean
}) {
    if (isLoading) {
        return (
            <div className="h-[300px] flex items-center justify-center text-white/40">
                Loading chart...
            </div>
        )
    }

    if (snapshots.length === 0) {
        return (
            <div className="h-[300px] flex items-center justify-center text-white/40">
                No snapshot data available yet. Check back after a few poll cycles.
            </div>
        )
    }

    // Transform data for chart (API returns values like 2.56 for 2.56%)
    const chartData = snapshots.map((s) => ({
        time: new Date(s.snapshotAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
        }),
        profitPct: s.profitPct,  // Already in percentage format
        fullTime: s.snapshotAt,
    }))

    const maxProfit = Math.max(...chartData.map((d) => d.profitPct))
    const minProfit = Math.min(...chartData.map((d) => d.profitPct))
    const avgProfit =
        chartData.reduce((sum, d) => sum + d.profitPct, 0) / chartData.length

    return (
        <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                        dataKey="time"
                        stroke="#666"
                        tick={{ fontSize: 12 }}
                        interval="preserveStartEnd"
                    />
                    <YAxis
                        stroke="#666"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => `${v.toFixed(1)}%`}
                        domain={[
                            Math.max(0, minProfit - 1),
                            Math.min(100, maxProfit + 1),
                        ]}
                    />
                    <Tooltip
                        contentStyle={{
                            background: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: "8px",
                        }}
                        labelStyle={{ color: "#fff" }}
                        formatter={(value: number) => [`${value.toFixed(2)}%`, "Profit"]}
                    />
                    <ReferenceLine
                        y={avgProfit}
                        stroke="#22d3ee"
                        strokeDasharray="5 5"
                        label={{
                            value: `Avg: ${avgProfit.toFixed(2)}%`,
                            fill: "#22d3ee",
                            fontSize: 11,
                        }}
                    />
                    <Line
                        type="monotone"
                        dataKey="profitPct"
                        stroke="#4ade80"
                        strokeWidth={2}
                        dot={snapshots.length < 30}
                        activeDot={{ r: 6, fill: "#4ade80" }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    )
}

// History Row component with expandable chart
function HistoryRow({
    item,
    isExpanded,
    onToggle,
}: {
    item: CrossPlatformHistoryItem
    isExpanded: boolean
    onToggle: () => void
}) {
    const [snapshots, setSnapshots] = useState<CrossPlatformSnapshot[]>([])
    const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false)

    useEffect(() => {
        if (isExpanded && snapshots.length === 0) {
            setIsLoadingSnapshots(true)
            fetchCrossPlatformSnapshots(item.id)
                .then((res) => setSnapshots(res.snapshots))
                .catch(console.error)
                .finally(() => setIsLoadingSnapshots(false))
        }
    }, [isExpanded, item.id, snapshots.length])

    return (
        <div className="border-b border-white/10 last:border-b-0">
            {/* Main row */}
            <div
                className="p-4 hover:bg-white/5 cursor-pointer flex items-center gap-4"
                onClick={onToggle}
            >
                {/* Expand button */}
                <button className="text-white/40 hover:text-white/60">
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>

                {/* Status badge */}
                <span
                    className={`px-2 py-1 text-xs rounded ${item.isActive
                        ? "bg-green-500/20 text-green-400"
                        : "bg-white/10 text-white/50"
                        }`}
                >
                    {item.isActive ? "Active" : "Expired"}
                </span>

                {/* Market info */}
                <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">
                        {item.polymarketQuestion}
                    </div>
                    <div className="text-xs text-white/50 truncate mt-0.5">
                        ↔ {item.kalshiTitle}
                    </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                        <div className="text-green-400 font-semibold">
                            {formatPct(item.peakProfitPct)}
                        </div>
                        <div className="text-[10px] text-white/40">Peak</div>
                    </div>
                    <div className="text-center">
                        <div className="text-cyan-400 font-medium">
                            {formatPct(item.avgProfitPct)}
                        </div>
                        <div className="text-[10px] text-white/40">Avg</div>
                    </div>
                    <div className="text-center">
                        <div className="text-white/80">{formatDuration(item.durationMinutes)}</div>
                        <div className="text-[10px] text-white/40">Duration</div>
                    </div>
                    <div className="text-center">
                        <div className="text-white/60">{item.snapshotCount}</div>
                        <div className="text-[10px] text-white/40">Snapshots</div>
                    </div>
                </div>
            </div>

            {/* Expanded chart section */}
            {isExpanded && (
                <div className="px-4 pb-4 pt-2 bg-white/[0.02]">
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium text-white/70">
                            Profit History
                        </h4>
                        <div className="text-xs text-white/40">
                            {formatTime(item.detectedAt)} -{" "}
                            {item.expiredAt ? formatTime(item.expiredAt) : "Now"}
                        </div>
                    </div>
                    <ProfitChart snapshots={snapshots} isLoading={isLoadingSnapshots} />

                    {/* Min/Max labels */}
                    {snapshots.length > 0 && (
                        <div className="flex justify-center gap-6 mt-3 text-xs">
                            <span className="text-red-400">
                                Min: {formatPct(Math.min(...snapshots.map((s) => s.profitPct)))}
                            </span>
                            <span className="text-green-400">
                                Max: {formatPct(Math.max(...snapshots.map((s) => s.profitPct)))}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default function CrossPlatformHistoryPage() {
    const [stats, setStats] = useState<CrossPlatformStats | null>(null)
    const [history, setHistory] = useState<CrossPlatformHistoryItem[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<number | null>(null)
    const [showExpired, setShowExpired] = useState(true)

    const loadData = useCallback(async () => {
        setIsLoading(true)
        try {
            const [statsRes, historyRes] = await Promise.all([
                fetchCrossPlatformStats(),
                fetchCrossPlatformHistory(100, showExpired),
            ])
            setStats(statsRes)
            setHistory(historyRes.opportunities)
        } catch (error) {
            console.error("Failed to load history data:", error)
        } finally {
            setIsLoading(false)
        }
    }, [showExpired])

    useEffect(() => {
        loadData()
        // Refresh every 30 seconds
        const interval = setInterval(loadData, 30000)
        return () => clearInterval(interval)
    }, [loadData])

    return (
        <main className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link
                        href="/"
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">Arbitrage History & Stats</h1>
                        <p className="text-white/50 text-sm mt-1">
                            Cross-platform opportunity analytics and profit tracking
                        </p>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <StatCard
                        title="Total Opportunities"
                        value={stats?.totalOpportunities ?? "-"}
                        icon={BarChart3}
                        color="bg-purple-500/20 text-purple-400"
                    />
                    <StatCard
                        title="Currently Active"
                        value={stats?.activeCount ?? "-"}
                        icon={Activity}
                        color="bg-green-500/20 text-green-400"
                    />
                    <StatCard
                        title="Max Profit Seen"
                        value={stats ? formatPct(stats.maxProfitPct) : "-"}
                        subtitle={stats ? `Avg: ${formatPct(stats.avgProfitPct)}` : undefined}
                        icon={TrendingUp}
                        color="bg-cyan-500/20 text-cyan-400"
                    />
                    <StatCard
                        title="Avg Duration"
                        value={stats ? formatDuration(stats.avgDurationMinutes) : "-"}
                        subtitle={stats ? `${stats.totalSnapshots} snapshots` : undefined}
                        icon={Clock}
                        color="bg-orange-500/20 text-orange-400"
                    />
                </div>

                {/* History Table */}
                <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] backdrop-blur-sm overflow-hidden">
                    {/* Table header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                        <h2 className="font-semibold">Opportunity History</h2>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showExpired}
                                onChange={(e) => setShowExpired(e.target.checked)}
                                className="rounded border-white/20 bg-white/10"
                            />
                            <span className="text-white/60">Show Expired</span>
                        </label>
                    </div>

                    {/* Table body */}
                    {isLoading ? (
                        <div className="p-8 text-center text-white/40">Loading history...</div>
                    ) : history.length === 0 ? (
                        <div className="p-8 text-center text-white/40">
                            No opportunities found. Check back later after the poller runs.
                        </div>
                    ) : (
                        <div>
                            {history.map((item) => (
                                <HistoryRow
                                    key={item.id}
                                    item={item}
                                    isExpanded={expandedId === item.id}
                                    onToggle={() =>
                                        setExpandedId(expandedId === item.id ? null : item.id)
                                    }
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="mt-4 text-center text-xs text-white/30">
                    Data refreshes every 30 seconds. Snapshots are recorded every poll cycle (~30s).
                </div>
            </div>
        </main>
    )
}
