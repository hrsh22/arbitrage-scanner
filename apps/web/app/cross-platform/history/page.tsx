"use client";

import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/ui/header";
import { StatCard } from "@/components/ui/stat-card";
import { SkeletonStatCard, SkeletonCard } from "@/components/ui/skeleton-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  TrendingUp,
  Clock,
  Activity,
  BarChart3,
  ChevronDown,
  ChevronUp,
  History,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  fetchCrossPlatformHistory,
  fetchCrossPlatformStats,
  fetchCrossPlatformSnapshots,
} from "@/lib/api";
import type {
  CrossPlatformHistoryItem,
  CrossPlatformStats,
  CrossPlatformSnapshot,
} from "@/lib/types";
import { cn } from "@workspace/ui/lib/utils";

// Format duration in human readable format
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

// Format percentage
function formatPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

// Format date/time
function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Profit Chart component
function ProfitChart({
  snapshots,
  isLoading,
}: {
  snapshots: CrossPlatformSnapshot[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-profit border-t-transparent" />
          <span>Loading chart...</span>
        </div>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground">
        No snapshot data available yet.
      </div>
    );
  }

  const chartData = snapshots.map((s) => ({
    time: new Date(s.snapshotAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    profitPct: s.profitPct,
    fullTime: s.snapshotAt,
  }));

  const maxProfit = Math.max(...chartData.map((d) => d.profitPct));
  const minProfit = Math.min(...chartData.map((d) => d.profitPct));
  const avgProfit = chartData.reduce((sum, d) => sum + d.profitPct, 0) / chartData.length;

  return (
    <div className="h-[250px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
          <XAxis
            dataKey="time"
            stroke="#9ca3af"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="#9ca3af"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            domain={[Math.max(0, minProfit - 1), Math.min(100, maxProfit + 1)]}
          />
          <Tooltip
            contentStyle={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
            }}
            labelStyle={{ color: "#111827" }}
            formatter={(value) => {
              const num = typeof value === "number" ? value : 0;
              return [`${num.toFixed(2)}%`, "Profit"];
            }}
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
            stroke="#10b981"
            strokeWidth={2}
            dot={snapshots.length < 30}
            activeDot={{ r: 6, fill: "#10b981" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// History Row component with expandable chart
function HistoryRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: CrossPlatformHistoryItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [snapshots, setSnapshots] = useState<CrossPlatformSnapshot[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);

  useEffect(() => {
    if (isExpanded && snapshots.length === 0) {
      setIsLoadingSnapshots(true);
      fetchCrossPlatformSnapshots(item.id)
        .then((res) => setSnapshots(res.snapshots))
        .catch(console.error)
        .finally(() => setIsLoadingSnapshots(false));
    }
  }, [isExpanded, item.id, snapshots.length]);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Main row */}
      <div
        className="p-4 hover:bg-accent/50 cursor-pointer flex items-center gap-4 transition-colors"
        onClick={onToggle}
      >
        {/* Expand button */}
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {/* Status badge */}
        <Badge
          variant={item.isActive ? "default" : "secondary"}
          className={cn(item.isActive && "bg-profit text-profit-foreground")}
        >
          {item.isActive ? "Active" : "Expired"}
        </Badge>

        {/* Market info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{item.polymarketQuestion}</div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">↔ {item.kalshiTitle}</div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-6 text-sm">
          <div className="text-center">
            <div className="text-profit font-semibold">{formatPct(item.peakProfitPct)}</div>
            <div className="text-[10px] text-muted-foreground">Peak</div>
          </div>
          <div className="text-center">
            <div className="text-kalshi font-medium">{formatPct(item.avgProfitPct)}</div>
            <div className="text-[10px] text-muted-foreground">Avg</div>
          </div>
          <div className="text-center">
            <div className="text-foreground/80">{formatDuration(item.durationMinutes)}</div>
            <div className="text-[10px] text-muted-foreground">Duration</div>
          </div>
          <div className="text-center">
            <div className="text-foreground/60">{item.snapshotCount}</div>
            <div className="text-[10px] text-muted-foreground">Snapshots</div>
          </div>
        </div>
      </div>

      {/* Expanded chart section */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 bg-muted/30">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">Profit History</h4>
            <div className="text-xs text-muted-foreground">
              {formatTime(item.detectedAt)} — {item.expiredAt ? formatTime(item.expiredAt) : "Now"}
            </div>
          </div>
          <ProfitChart snapshots={snapshots} isLoading={isLoadingSnapshots} />

          {/* Min/Max labels */}
          {snapshots.length > 0 && (
            <div className="flex justify-center gap-6 mt-3 text-xs">
              <span className="text-destructive">
                Min: {formatPct(Math.min(...snapshots.map((s) => s.profitPct)))}
              </span>
              <span className="text-profit">
                Max: {formatPct(Math.max(...snapshots.map((s) => s.profitPct)))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CrossPlatformHistoryPage() {
  const [stats, setStats] = useState<CrossPlatformStats | null>(null);
  const [history, setHistory] = useState<CrossPlatformHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showExpired, setShowExpired] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, historyRes] = await Promise.all([
        fetchCrossPlatformStats(),
        fetchCrossPlatformHistory(100, showExpired),
      ]);
      setStats(statsRes);
      setHistory(historyRes.opportunities);
    } catch (error) {
      console.error("Failed to load history data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [showExpired]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <>
      <Header activeOpportunities={stats?.activeCount} />

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Arbitrage History & Stats</h1>
            <p className="text-muted-foreground">
              Cross-platform opportunity analytics and profit tracking
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {isLoading ? (
              <>
                <SkeletonStatCard />
                <SkeletonStatCard />
                <SkeletonStatCard />
                <SkeletonStatCard />
              </>
            ) : (
              <>
                <StatCard
                  title="Total Opportunities"
                  value={stats?.totalOpportunities ?? 0}
                  icon={BarChart3}
                  variant="polymarket"
                />
                <StatCard
                  title="Currently Active"
                  value={stats?.activeCount ?? 0}
                  icon={Activity}
                  variant="profit"
                />
                <StatCard
                  title="Max Profit Seen"
                  value={stats ? formatPct(stats.maxProfitPct) : "-"}
                  subtitle={stats ? `Avg: ${formatPct(stats.avgProfitPct)}` : undefined}
                  icon={TrendingUp}
                  variant="kalshi"
                />
                <StatCard
                  title="Avg Duration"
                  value={stats ? formatDuration(stats.avgDurationMinutes) : "-"}
                  subtitle={stats ? `${stats.totalSnapshots} snapshots` : undefined}
                  icon={Clock}
                  variant="warning"
                />
              </>
            )}
          </div>

          {/* History Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Opportunity History</CardTitle>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExpired}
                  onChange={(e) => setShowExpired(e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-muted-foreground">Show Expired</span>
              </label>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span>Loading history...</span>
                  </div>
                </div>
              ) : history.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={History}
                    title="No opportunities found"
                    description="Check back later after the poller runs and detects arbitrage opportunities."
                    variant="default"
                  />
                </div>
              ) : (
                <div>
                  {history.map((item) => (
                    <HistoryRow
                      key={item.id}
                      item={item}
                      isExpanded={expandedId === item.id}
                      onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="mt-4 text-center text-xs text-muted-foreground">
            Data refreshes every 30 seconds. Snapshots are recorded every poll cycle (~30s).
          </div>
        </div>
      </main>
    </>
  );
}
