"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/ui/header"
import { StatCard } from "@/components/ui/stat-card"
import { SkeletonStatCard } from "@/components/ui/skeleton-card"
import { fetchCrossPlatform, fetchNearResolution, fetchStats } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import {
  TrendingUp,
  Clock,
  Repeat2,
  ArrowRight,
  Zap,
  Target,
  BarChart3,
} from "lucide-react"

export default function HomePage() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    crossPlatformTotal: 0,
    crossPlatformArbs: 0,
    nearResolution: 0,
    polyArbitrage: 0,
  })
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [crossRes, nearRes, polyStats] = await Promise.all([
          fetchCrossPlatform(0, undefined, "profit"),
          fetchNearResolution({ maxHours: 24, minOdds: 95, sort: "time" }),
          fetchStats().catch(() => null),
        ])

        setStats({
          crossPlatformTotal: crossRes.opportunities?.length ?? 0,
          crossPlatformArbs: crossRes.opportunities?.filter(o => o.arbitrage.type !== "none").length ?? 0,
          nearResolution: nearRes.opportunities?.length ?? 0,
          polyArbitrage: polyStats?.opportunities?.active ?? 0,
        })
        setLastUpdated(crossRes.lastUpdated ?? nearRes.lastUpdated ?? null)
      } catch {
        // Ignore errors
      } finally {
        setLoading(false)
      }
    }

    void loadStats()
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const totalOpportunities = stats.crossPlatformArbs + stats.nearResolution + stats.polyArbitrage

  return (
    <>
      <Header activeOpportunities={totalOpportunities} />

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
          {/* Hero Section */}
          <div className="mb-10 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-profit/10 px-4 py-1.5 text-sm font-medium text-profit">
              <Zap className="h-4 w-4" />
              Live Arbitrage Scanner
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Find Guaranteed Profits
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              Scan Polymarket and Kalshi for price discrepancies and high-confidence
              opportunities to execute risk-free trades.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {loading ? (
              <>
                <SkeletonStatCard />
                <SkeletonStatCard />
                <SkeletonStatCard />
                <SkeletonStatCard />
              </>
            ) : (
              <>
                <StatCard
                  title="Cross-Platform Arbs"
                  value={stats.crossPlatformArbs}
                  icon={TrendingUp}
                  variant="profit"
                  subtitle={stats.crossPlatformArbs > 0 ? "Active now" : undefined}
                />
                <StatCard
                  title="Near Resolution"
                  value={stats.nearResolution}
                  icon={Clock}
                  variant="kalshi"
                  subtitle="High confidence"
                />
                <StatCard
                  title="Market Matches"
                  value={stats.crossPlatformTotal}
                  icon={Repeat2}
                  variant="polymarket"
                  subtitle="Poly ↔ Kalshi"
                />
                <StatCard
                  title="Poly Arbitrage"
                  value={stats.polyArbitrage}
                  icon={Target}
                  variant="default"
                  subtitle="Same-market"
                />
              </>
            )}
          </div>

          {/* Quick Actions */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Cross-Platform Card */}
            <Link href="/cross-platform" className="group">
              <Card className="h-full transition-all hover:border-polymarket/50 hover:shadow-lg hover:shadow-polymarket/5">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="rounded-lg bg-polymarket/10 p-2 text-polymarket">
                      <Repeat2 className="h-6 w-6" />
                    </div>
                    {stats.crossPlatformArbs > 0 && (
                      <Badge className="bg-profit text-profit-foreground">
                        {stats.crossPlatformArbs} arb{stats.crossPlatformArbs !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    Cross-Platform Arbitrage
                    <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </CardTitle>
                  <CardDescription>
                    Compare prices between Polymarket and Kalshi to find guaranteed profit
                    opportunities from market inefficiencies.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <div className="h-2 w-2 rounded-full bg-polymarket" />
                      <span>Polymarket</span>
                    </div>
                    <span>↔</span>
                    <div className="flex items-center gap-1">
                      <div className="h-2 w-2 rounded-full bg-kalshi" />
                      <span>Kalshi</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>

            {/* Near Resolution Card */}
            <Link href="/near-resolution" className="group">
              <Card className="h-full transition-all hover:border-kalshi/50 hover:shadow-lg hover:shadow-kalshi/5">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="rounded-lg bg-kalshi/10 p-2 text-kalshi">
                      <Clock className="h-6 w-6" />
                    </div>
                    {stats.nearResolution > 0 && (
                      <Badge variant="secondary">
                        {stats.nearResolution} market{stats.nearResolution !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    Near Resolution
                    <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  </CardTitle>
                  <CardDescription>
                    Find high-confidence markets where the outcome is nearly certain but
                    hasn't resolved yet. Lower risk, steady returns.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Closing soon</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Target className="h-3.5 w-3.5" />
                      <span>High probability</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>

            {/* History Card */}
            <Link href="/cross-platform/history" className="group md:col-span-2">
              <Card className="transition-all hover:border-border hover:shadow-lg">
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-muted p-2">
                      <BarChart3 className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        History & Analytics
                        <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                      </CardTitle>
                      <CardDescription>
                        View historical arbitrage opportunities, track profit trends, and analyze
                        market patterns over time.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </main>
    </>
  )
}
