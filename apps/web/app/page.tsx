"use client"

import Link from "next/link"
import { Header } from "@/components/ui/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  Clock,
  Repeat2,
  ArrowRight,
  Zap,
  Target,
  BarChart3,
} from "lucide-react"

export default function HomePage() {
  return (
    <>
      <Header />

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
