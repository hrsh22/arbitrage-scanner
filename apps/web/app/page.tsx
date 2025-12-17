"use client"

import { useEffect, useState } from "react"
import { Filters } from "@/components/filters"
import { OpportunityCard } from "@/components/opportunity-card"
import { NearResolutionCard } from "@/components/near-resolution-card"
import { CrossPlatformCard } from "@/components/cross-platform-card"
import { fetchOpportunities, fetchHistory, fetchStats, fetchNearResolution, fetchCrossPlatform } from "@/lib/api"
import { Opportunity, OpportunityFilter, OpportunityStats, NearResolutionOpportunity, NearResolutionFilter, CrossPlatformOpportunity } from "@/lib/types"

const defaultFilter: OpportunityFilter = {
  minProfitPct: 0,
  minLiquidity: 0,
  sort: "score",
}

const defaultNearResolutionFilter: NearResolutionFilter = {
  maxHours: 24,
  minOdds: 95,
  sort: "time",
}

type TabType = "near-resolution" | "cross-platform" | "live" | "history"

export default function Page() {
  const [tab, setTab] = useState<TabType>("near-resolution")
  const [filter, setFilter] = useState<OpportunityFilter>(defaultFilter)
  const [nearResFilter, setNearResFilter] = useState<NearResolutionFilter>(defaultNearResolutionFilter)
  const [refreshMs, setRefreshMs] = useState<number>(10000)
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [nearResOpportunities, setNearResOpportunities] = useState<NearResolutionOpportunity[]>([])
  const [historyOpportunities, setHistoryOpportunities] = useState<Opportunity[]>([])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<OpportunityStats | null>(null)
  const [historyStats, setHistoryStats] = useState<{ total: number; active: number; expired: number } | null>(null)
  const [crossPlatformOpportunities, setCrossPlatformOpportunities] = useState<CrossPlatformOpportunity[]>([])
  const [polyArbitrageEnabled, setPolyArbitrageEnabled] = useState<boolean>(true)

  // Fetch live opportunities
  useEffect(() => {
    if (tab !== "live") return

    let isMounted = true
    let interval: NodeJS.Timeout | null = null

    const load = async (signal?: AbortSignal) => {
      try {
        setLoading(true)
        const res = await fetchOpportunities(filter, signal)
        if (!isMounted) return

        // Check if feature is enabled
        if (res.enabled === false) {
          setPolyArbitrageEnabled(false)
          setOpportunities([])
          return
        }

        setPolyArbitrageEnabled(true)
        setOpportunities(res.opportunities ?? [])
        setLastUpdated(res.lastUpdated ?? null)
        setError(null)
      } catch (err) {
        if (!isMounted) return
        setError((err as Error).message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    const controller = new AbortController()
    void load(controller.signal)

    interval = setInterval(() => {
      const tickController = new AbortController()
      void load(tickController.signal)
    }, refreshMs)

    return () => {
      isMounted = false
      controller.abort()
      if (interval) clearInterval(interval)
    }
  }, [filter, refreshMs, tab])

  // Fetch near-resolution opportunities
  useEffect(() => {
    if (tab !== "near-resolution") return

    let isMounted = true
    let interval: NodeJS.Timeout | null = null

    const load = async (signal?: AbortSignal) => {
      try {
        setLoading(true)
        const res = await fetchNearResolution(nearResFilter, signal)
        if (!isMounted) return
        setNearResOpportunities(res.opportunities ?? [])
        setLastUpdated(res.lastUpdated ?? null)
        setError(null)
      } catch (err) {
        if (!isMounted) return
        setError((err as Error).message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    const controller = new AbortController()
    void load(controller.signal)

    interval = setInterval(() => {
      const tickController = new AbortController()
      void load(tickController.signal)
    }, refreshMs)

    return () => {
      isMounted = false
      controller.abort()
      if (interval) clearInterval(interval)
    }
  }, [nearResFilter, refreshMs, tab])

  // Fetch history
  useEffect(() => {
    if (tab !== "history") return

    let isMounted = true
    const controller = new AbortController()

    const loadHistory = async () => {
      try {
        setLoading(true)
        const res = await fetchHistory(200, controller.signal)
        if (!isMounted) return
        setHistoryOpportunities(res.opportunities ?? [])
        setHistoryStats({ total: res.total, active: res.active, expired: res.expired })
        setError(null)
      } catch (err) {
        if (!isMounted) return
        setError((err as Error).message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void loadHistory()

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [tab])

  // Fetch cross-platform opportunities
  useEffect(() => {
    if (tab !== "cross-platform") return

    let isMounted = true
    const controller = new AbortController()

    const loadCrossPlatform = async () => {
      try {
        setLoading(true)
        const res = await fetchCrossPlatform(0, controller.signal)
        if (!isMounted) return
        setCrossPlatformOpportunities(res.opportunities ?? [])
        setError(null)
      } catch (err) {
        if (!isMounted) return
        setError((err as Error).message)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    void loadCrossPlatform()

    // Refresh every 30s (slower to avoid Kalshi rate limits)
    const interval = setInterval(() => void loadCrossPlatform(), 30000)

    return () => {
      isMounted = false
      controller.abort()
      clearInterval(interval)
    }
  }, [tab])

  // Fetch stats
  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()
    const loadStats = async () => {
      try {
        const res = await fetchStats(controller.signal)
        if (!isMounted) return
        setStats(res)
      } catch {
        setStats(null)
      }
    }
    void loadStats()
    const interval = setInterval(() => void loadStats(), 30000)
    return () => {
      isMounted = false
      controller.abort()
      clearInterval(interval)
    }
  }, [])

  // Check if Polymarket arbitrage feature is enabled on initial load
  useEffect(() => {
    const checkFeature = async () => {
      try {
        const res = await fetchOpportunities(defaultFilter, undefined)
        setPolyArbitrageEnabled(res.enabled !== false)
      } catch {
        // On error, assume enabled
      }
    }
    void checkFeature()
  }, [])

  const lastUpdatedText = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "—"
  const displayOpportunities = tab === "live" ? opportunities : tab === "history" ? historyOpportunities : []
  const totalProfit = displayOpportunities.reduce((sum, o) => sum + o.profitAbsolute, 0)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Polymarket Arbitrage Scanner
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Find guaranteed profit opportunities where total outcome prices &lt; $1
          </p>
        </div>
        {(tab === "live" || tab === "near-resolution") && (
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Last updated: <span className="font-semibold">{lastUpdatedText}</span>
          </div>
        )}
      </header>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setTab("near-resolution")}
          className={`px-4 py-2 text-sm font-medium transition ${tab === "near-resolution"
            ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
            : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
        >
          ⏰ Near Resolution ({nearResOpportunities.length})
        </button>
        <button
          onClick={() => setTab("cross-platform")}
          className={`px-4 py-2 text-sm font-medium transition ${tab === "cross-platform"
            ? "border-b-2 border-purple-500 text-purple-600 dark:text-purple-400"
            : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
        >
          🔄 Poly↔Kalshi ({crossPlatformOpportunities.length})
        </button>
        {polyArbitrageEnabled && (
          <button
            onClick={() => setTab("live")}
            className={`px-4 py-2 text-sm font-medium transition ${tab === "live"
              ? "border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
          >
            🔴 Arbitrage ({opportunities.length})
          </button>
        )}
        {polyArbitrageEnabled && (
          <button
            onClick={() => setTab("history")}
            className={`px-4 py-2 text-sm font-medium transition ${tab === "history"
              ? "border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
          >
            📜 History ({historyStats?.total ?? 0})
          </button>
        )}
      </div>

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-100 p-4 text-sm dark:bg-slate-800 sm:grid-cols-4">
          <div>
            <div className="font-semibold text-emerald-600 dark:text-emerald-400">
              {stats.opportunities.active}
            </div>
            <div className="text-slate-600 dark:text-slate-400">Active Arb</div>
          </div>
          <div>
            <div className="font-semibold text-blue-600 dark:text-blue-400">
              {nearResOpportunities.length}
            </div>
            <div className="text-slate-600 dark:text-slate-400">Near Resolution</div>
          </div>
          <div>
            <div className="font-semibold text-emerald-600 dark:text-emerald-400">
              {stats.actions.executed}
            </div>
            <div className="text-slate-600 dark:text-slate-400">Executed</div>
          </div>
          <div>
            <div className="font-semibold text-slate-700 dark:text-slate-200">
              ${stats.actions.actualProfit.toFixed(2)}
            </div>
            <div className="text-slate-600 dark:text-slate-400">Total Profit</div>
          </div>
        </div>
      )}

      {/* Filters for Live tab */}
      {tab === "live" && (
        <Filters filter={filter} onChange={setFilter} refreshMs={refreshMs} onRefreshIntervalChange={setRefreshMs} />
      )}

      {/* Filters for Near Resolution tab */}
      {tab === "near-resolution" && (
        <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
          {/* Time Window Presets */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Time Window</div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "6h", hours: 6 },
                { label: "12h", hours: 12 },
                { label: "24h", hours: 24 },
                { label: "48h", hours: 48 },
                { label: "7d", hours: 168 },
              ].map(({ label, hours }) => (
                <button
                  key={hours}
                  onClick={() => setNearResFilter({ ...nearResFilter, maxHours: hours })}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${nearResFilter.maxHours === hours
                    ? "bg-blue-600 text-white dark:bg-blue-500"
                    : "bg-white text-slate-700 hover:bg-blue-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Odds Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Min Odds</span>
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{nearResFilter.minOdds}¢</span>
            </div>
            <input
              type="range"
              min={80}
              max={99}
              value={nearResFilter.minOdds}
              onChange={(e) => setNearResFilter({ ...nearResFilter, minOdds: Number(e.target.value) })}
              className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer dark:bg-blue-900"
            />
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>80¢</span>
              <span>99¢</span>
            </div>
          </div>

          {/* Sort Toggle */}
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Sort by:</span>
            <div className="flex gap-2">
              <button
                onClick={() => setNearResFilter({ ...nearResFilter, sort: "time" })}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${nearResFilter.sort === "time"
                  ? "bg-blue-600 text-white dark:bg-blue-500"
                  : "bg-white text-slate-700 hover:bg-blue-100 dark:bg-slate-800 dark:text-slate-300"
                  }`}
              >
                ⏰ Time Left
              </button>
              <button
                onClick={() => setNearResFilter({ ...nearResFilter, sort: "odds" })}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${nearResFilter.sort === "odds"
                  ? "bg-blue-600 text-white dark:bg-blue-500"
                  : "bg-white text-slate-700 hover:bg-blue-100 dark:bg-slate-800 dark:text-slate-300"
                  }`}
              >
                📈 Highest Odds
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading / Error / Empty states */}
      {loading && (tab === "live" ? opportunities : tab === "near-resolution" ? nearResOpportunities : historyOpportunities).length === 0 && (
        <div className="flex items-center justify-center py-12 text-slate-500 dark:text-slate-400">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
            <span>Loading opportunities...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Live/History Empty State */}
      {!loading && !error && (tab === "live" || tab === "history") && displayOpportunities.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-12 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          <div className="text-4xl">🔍</div>
          <div className="text-lg font-medium">No arbitrage opportunities found</div>
          <div className="text-sm">
            Markets are currently efficient. Scanner runs continuously in the background.
          </div>
        </div>
      )}

      {/* Near Resolution Empty State */}
      {!loading && !error && tab === "near-resolution" && nearResOpportunities.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-12 text-blue-600 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400">
          <div className="text-4xl">⏰</div>
          <div className="text-lg font-medium">No near-resolution opportunities found</div>
          <div className="text-sm text-center max-w-md">
            Try increasing "Max Hours Until Close" or lowering "Min Probability" to find more markets.
          </div>
        </div>
      )}

      {/* Opportunity cards - Live & History */}
      {(tab === "live" || tab === "history") && displayOpportunities.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>{displayOpportunities.length} opportunities</span>
            <span>Total potential: ${totalProfit.toFixed(4)}</span>
          </div>
          {displayOpportunities.map((opportunity) => (
            <OpportunityCard
              key={opportunity.key}
              opportunity={opportunity}
              showExpiredBadge={tab === "history"}
            />
          ))}
        </div>
      )}

      {/* Near Resolution cards */}
      {tab === "near-resolution" && nearResOpportunities.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>{nearResOpportunities.length} high-confidence markets closing soon</span>
          </div>
          {nearResOpportunities.map((opportunity) => (
            <NearResolutionCard
              key={opportunity.key}
              opportunity={opportunity}
            />
          ))}
        </div>
      )}

      {/* Cross-Platform Empty State */}
      {!loading && !error && tab === "cross-platform" && crossPlatformOpportunities.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-purple-200 bg-purple-50 py-12 text-purple-600 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-400">
          <div className="text-4xl">🔄</div>
          <div className="text-lg font-medium">No cross-platform matches found</div>
          <div className="text-sm text-center max-w-md">
            Looking for matching markets between Polymarket and Kalshi. This may take a moment.
          </div>
        </div>
      )}

      {/* Cross-Platform cards */}
      {tab === "cross-platform" && crossPlatformOpportunities.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>
              {crossPlatformOpportunities.length} matched markets
              {crossPlatformOpportunities.filter(o => o.arbitrage.type !== "none").length > 0 && (
                <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                  • {crossPlatformOpportunities.filter(o => o.arbitrage.type !== "none").length} with arbitrage!
                </span>
              )}
            </span>
          </div>
          {crossPlatformOpportunities.map((opportunity) => (
            <CrossPlatformCard
              key={opportunity.id}
              opportunity={opportunity}
            />
          ))}
        </div>
      )}
    </div>
  )
}
