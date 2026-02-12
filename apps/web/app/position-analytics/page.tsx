"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Header } from "@/components/ui/header";
import {
  fetchWalletAnalytics,
  fetchResolvedPositionsFromDB,
  fetchSinglePosition,
  fetchMissedOpportunities,
  fetchComputedAnalytics,
  type WalletAnalytics,
  type ResolvedPositionFromDB,
  type StopLossAnalysisItem,
  type HedgingAnalysisItem,
  type CategoryBreakdownItem,
  type MissedOpportunityEvent,
  type EntryTimingItem,
  type ComputedAnalytics,
} from "@/lib/polymarket-api";
import {
  DEFAULT_WALLET,
  WALLET_OPTIONS,
  getBotIdForWallet,
  getCapitalDeposited,
} from "@/lib/polymarket-api";
import {
  RefreshCw,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Percent,
  BarChart3,
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Filter,
  Target,
  Loader2,
  Info,
  Shield,
  Tag,
  Ban,
  Clock,
  ArrowUpDown,
  ExternalLink,
  Check,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  ComposedChart,
} from "recharts";

type ResolvedFilter = "all" | "won" | "lost";
type SortKey = "date" | "entry" | "final" | "pnl" | "roi" | "maxdd";
type SortDirection = "asc" | "desc";

const SCALE_UP_TIMESTAMP = new Date("2026-01-14T12:30:00Z").getTime();

function SectionFilter({
  value,
  onChange,
}: {
  value: ResolvedFilter;
  onChange: (v: ResolvedFilter) => void;
}) {
  const options = ["all", "won", "lost"] as const;

  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "px-2 py-0.5 text-xs rounded capitalize font-medium transition-colors cursor-pointer",
            value === opt
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <UITooltip>
      <TooltipTrigger asChild>
        <button className="inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-left">
        <p>{text}</p>
      </TooltipContent>
    </UITooltip>
  );
}

function SummaryCard({
  title,
  value,
  subtext,
  icon: Icon,
  trend,
  trendValue,
  colorClass = "text-primary",
  info,
}: {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  colorClass?: string;
  info?: string;
}) {
  return (
    <Card className="overflow-hidden transition-all hover:shadow-md hover:border-primary/20">
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {info && <InfoTooltip text={info} />}
          </div>
          <div className={cn("p-2 rounded-full bg-muted", colorClass)}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="flex items-baseline space-x-2">
          <div className="text-2xl font-bold">{value}</div>
          {trend && trendValue && (
            <div
              className={cn(
                "flex items-center text-xs font-medium",
                trend === "up"
                  ? "text-emerald-500"
                  : trend === "down"
                    ? "text-rose-500"
                    : "text-muted-foreground",
              )}
            >
              {trend === "up" ? (
                <TrendingUp className="mr-1 h-3 w-3" />
              ) : (
                <TrendingDown className="mr-1 h-3 w-3" />
              )}
              {trendValue}
            </div>
          )}
        </div>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </CardContent>
    </Card>
  );
}

function StopLossTable({ analysis }: { analysis: StopLossAnalysisItem[] }) {
  if (!analysis || analysis.length === 0)
    return <p className="text-sm text-muted-foreground">No data available</p>;

  return (
    <div className="rounded-md border">
      <div className="w-full overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors hover:bg-muted/50">
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                <div className="flex items-center gap-1">
                  Threshold
                  <InfoTooltip text="Stop-loss trigger level as a percentage drop from entry price." />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Triggered
                  <InfoTooltip text="Number of positions that would have hit this stop-loss level." />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Recovered
                  <InfoTooltip text="Of triggered positions, how many later recovered above entry price." />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Net Impact
                  <InfoTooltip text="Total P/L difference: (P/L if sold at stop-loss) - (P/L from holding). Negative = stop-loss would have cost you money." />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {analysis.map((item) => (
              <tr key={item.threshold} className="border-b transition-colors hover:bg-muted/50">
                <td className="p-4 align-middle font-medium">{item.threshold}%</td>
                <td className="p-4 align-middle text-right">{item.triggeredCount}</td>
                <td className="p-4 align-middle text-right text-muted-foreground">
                  {item.recoveredCount}
                </td>
                <td
                  className={cn(
                    "p-4 align-middle text-right font-bold",
                    item.netImpact > 0
                      ? "text-emerald-500"
                      : item.netImpact < 0
                        ? "text-rose-500"
                        : "text-muted-foreground",
                  )}
                >
                  {item.netImpact > 0 ? "+" : ""}${item.netImpact.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HedgingTable({ analysis }: { analysis: HedgingAnalysisItem[] }) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  if (!analysis || analysis.length === 0)
    return <p className="text-sm text-muted-foreground">No hedging data available</p>;

  const toggleRow = (threshold: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(threshold)) next.delete(threshold);
      else next.add(threshold);
      return next;
    });
  };

  const formatMoney = (val: number) => {
    const prefix = val >= 0 ? (val > 0 ? "+" : "") : "";
    return `${prefix}$${val.toFixed(2)}`;
  };

  return (
    <div className="rounded-md border">
      <div className="w-full overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors bg-muted/30">
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground w-8"></th>
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                Drop %
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Triggered
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Full Lock Net
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                2x Opposite Net
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {analysis.map((item) => {
              const isExpanded = expandedRows.has(item.threshold);
              const bestNet = Math.max(item.fullLockNetImpact, item.doubleOppositeNetImpact);
              return (
                <React.Fragment key={item.threshold}>
                  <tr
                    className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggleRow(item.threshold)}
                  >
                    <td className="p-2 align-middle text-center">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="p-3 align-middle font-medium">{item.threshold}%</td>
                    <td className="p-3 align-middle text-right">{item.triggeredCount}</td>
                    <td
                      className={cn(
                        "p-3 align-middle text-right font-mono",
                        item.fullLockNetImpact > 0
                          ? "text-emerald-500"
                          : item.fullLockNetImpact < 0
                            ? "text-rose-500"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatMoney(item.fullLockNetImpact)}
                    </td>
                    <td
                      className={cn(
                        "p-3 align-middle text-right font-mono",
                        item.doubleOppositeNetImpact > 0
                          ? "text-emerald-500"
                          : item.doubleOppositeNetImpact < 0
                            ? "text-rose-500"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatMoney(item.doubleOppositeNetImpact)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/20">
                      <td colSpan={5} className="p-4">
                        <div className="rounded-md border bg-background p-4 shadow-sm text-xs">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-blue-500/10 rounded-md p-3">
                              <p className="text-blue-500 font-medium mb-1">Full Lock-in</p>
                              <p className="text-muted-foreground">
                                Buy equal shares of opposite outcome. Guarantees fixed return.
                              </p>
                              <p
                                className={cn(
                                  "font-bold mt-1",
                                  item.fullLockNetImpact > 0 ? "text-emerald-500" : "text-rose-500",
                                )}
                              >
                                {formatMoney(item.fullLockNetImpact)} net impact
                              </p>
                            </div>
                            <div className="bg-purple-500/10 rounded-md p-3">
                              <p className="text-purple-500 font-medium mb-1">2x Opposite</p>
                              <p className="text-muted-foreground">
                                Buy 2x shares of opposite. Aggressive reversal bet.
                              </p>
                              <p
                                className={cn(
                                  "font-bold mt-1",
                                  item.doubleOppositeNetImpact > 0
                                    ? "text-emerald-500"
                                    : "text-rose-500",
                                )}
                              >
                                {formatMoney(item.doubleOppositeNetImpact)} net impact
                              </p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntryTimingTable({ analysis }: { analysis: EntryTimingItem[] }) {
  if (!analysis || analysis.length === 0)
    return <p className="text-sm text-muted-foreground">No entry timing data available</p>;

  const sortedAnalysis = [...analysis].sort(
    (a, b) => b.hoursBeforeResolution - a.hoursBeforeResolution,
  );

  return (
    <div className="rounded-md border">
      <div className="w-full overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors hover:bg-muted/50">
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                <div className="flex items-center gap-1">
                  Time Window
                  <InfoTooltip text="Hours before resolution when price was between 95¢-99.5¢" />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Eligible
                  <InfoTooltip text="Positions that had enterable price (95¢-99.5¢) within this time window" />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                Won
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                Lost
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Win Rate
                  <InfoTooltip text="Percentage of eligible positions that won" />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Avg Entry
                  <InfoTooltip text="Average entry price for positions in this window" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {sortedAnalysis.map((item) => (
              <tr
                key={item.hoursBeforeResolution}
                className="border-b transition-colors hover:bg-muted/50"
              >
                <td className="p-4 align-middle font-medium">
                  {item.hoursBeforeResolution >= 1
                    ? `${item.hoursBeforeResolution}h`
                    : `${item.hoursBeforeResolution * 60}min`}
                </td>
                <td className="p-4 align-middle text-right">{item.positionsEligible}</td>
                <td className="p-4 align-middle text-right text-emerald-500">
                  {item.positionsWon}
                </td>
                <td className="p-4 align-middle text-right text-rose-500">{item.positionsLost}</td>
                <td
                  className={cn(
                    "p-4 align-middle text-right font-bold",
                    item.winRate >= 1
                      ? "text-emerald-500"
                      : item.winRate >= 0.99
                        ? "text-emerald-400"
                        : "text-foreground",
                  )}
                >
                  {(item.winRate * 100).toFixed(1)}%
                </td>
                <td className="p-4 align-middle text-right text-muted-foreground">
                  {(item.avgEntryPrice * 100).toFixed(1)}¢
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryDetailCard({ category }: { category: CategoryBreakdownItem }) {
  const chartData = category.stopLossAnalysis.map((sl, idx) => ({
    threshold: `${sl.threshold}%`,
    stopLoss: sl.netImpact,
    hedgeFull: category.hedgingAnalysis[idx]?.fullLockNetImpact ?? 0,
    hedgeDouble: category.hedgingAnalysis[idx]?.doubleOppositeNetImpact ?? 0,
  }));

  const formatMoney = (val: number) => {
    const prefix = val >= 0 ? (val > 0 ? "+" : "") : "";
    return `${prefix}$${val.toFixed(2)}`;
  };

  const bestStopLoss = category.stopLossAnalysis.reduce(
    (max, sl) => (sl.netImpact > max.netImpact ? sl : max),
    category.stopLossAnalysis[0]!,
  );

  const bestHedgeFull = category.hedgingAnalysis.reduce(
    (max, h) => (h.fullLockNetImpact > max.fullLockNetImpact ? h : max),
    category.hedgingAnalysis[0]!,
  );

  const bestHedgeDouble = category.hedgingAnalysis.reduce(
    (max, h) => (h.doubleOppositeNetImpact > max.doubleOppositeNetImpact ? h : max),
    category.hedgingAnalysis[0]!,
  );

  return (
    <div className="rounded-md border bg-background p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold">{category.category} - Strategy Comparison</h4>
          <p className="text-xs text-muted-foreground">{category.bestStrategy.reason}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Avg P/L per position</p>
          <p
            className={cn(
              "font-mono font-bold",
              category.avgPnl >= 0 ? "text-emerald-500" : "text-rose-500",
            )}
          >
            {formatMoney(category.avgPnl)}
          </p>
        </div>
      </div>

      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
              opacity={0.4}
            />
            <XAxis
              dataKey="threshold"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val: number) => `$${val.toFixed(0)}`}
              width={50}
            />
            <ChartTooltip
              contentStyle={{
                backgroundColor: "hsl(var(--background))",
                borderColor: "hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: "12px",
              }}
              formatter={(val: number | undefined, name?: string) => [
                typeof val === "number" ? `$${val.toFixed(2)}` : "N/A",
                name === "stopLoss"
                  ? "Stop-Loss"
                  : name === "hedgeFull"
                    ? "Hedge (Full)"
                    : "Hedge (2x)",
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              formatter={(value: string) =>
                value === "stopLoss"
                  ? "Stop-Loss"
                  : value === "hedgeFull"
                    ? "Hedge (Full)"
                    : "Hedge (2x)"
              }
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="stopLoss"
              stroke="#f97316"
              fill="#f97316"
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="hedgeFull"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="hedgeDouble"
              stroke="#a855f7"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-4 text-xs">
        <div className="bg-orange-500/10 rounded-md p-3">
          <p className="text-orange-500 font-medium mb-1">Best Stop-Loss</p>
          <p className="font-mono">{bestStopLoss.threshold}% threshold</p>
          <p className="text-muted-foreground">
            {bestStopLoss.triggeredCount} triggered, {bestStopLoss.recoveredCount} recovered
          </p>
          <p
            className={cn(
              "font-bold",
              bestStopLoss.netImpact > 0 ? "text-emerald-500" : "text-rose-500",
            )}
          >
            {formatMoney(bestStopLoss.netImpact)} net impact
          </p>
        </div>
        <div className="bg-blue-500/10 rounded-md p-3">
          <p className="text-blue-500 font-medium mb-1">Best Hedge (Full Lock)</p>
          <p className="font-mono">{bestHedgeFull.threshold}% trigger</p>
          <p className="text-muted-foreground">
            {bestHedgeFull.triggeredCount} triggered, {bestHedgeFull.recoveredCount} recovered
          </p>
          <div className="mt-1 space-y-0.5">
            <p className="text-emerald-500">
              +${bestHedgeFull.fullLockGrossSavings.toFixed(2)} saved on losers
            </p>
            <p className="text-rose-500">
              -${bestHedgeFull.fullLockCostOnWinners.toFixed(2)} cost on winners
            </p>
            <p
              className={cn(
                "font-bold",
                bestHedgeFull.fullLockNetImpact > 0 ? "text-emerald-500" : "text-rose-500",
              )}
            >
              {formatMoney(bestHedgeFull.fullLockNetImpact)} net
            </p>
          </div>
        </div>
        <div className="bg-purple-500/10 rounded-md p-3">
          <p className="text-purple-500 font-medium mb-1">Best Hedge (2x Opposite)</p>
          <p className="font-mono">{bestHedgeDouble.threshold}% trigger</p>
          <p className="text-muted-foreground">
            {bestHedgeDouble.triggeredCount} triggered, {bestHedgeDouble.recoveredCount} recovered
          </p>
          <div className="mt-1 space-y-0.5">
            <p className="text-emerald-500">
              +${bestHedgeDouble.doubleOppositeGrossSavings.toFixed(2)} saved on losers
            </p>
            <p className="text-rose-500">
              -${bestHedgeDouble.doubleOppositeCostOnWinners.toFixed(2)} cost on winners
            </p>
            <p
              className={cn(
                "font-bold",
                bestHedgeDouble.doubleOppositeNetImpact > 0 ? "text-emerald-500" : "text-rose-500",
              )}
            >
              {formatMoney(bestHedgeDouble.doubleOppositeNetImpact)} net
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleCategoryTable({ categories }: { categories: SimpleCategoryBreakdown[] }) {
  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No positions in this period</p>;
  }

  const formatMoney = (val: number) => {
    const prefix = val >= 0 ? (val > 0 ? "+" : "") : "";
    return `${prefix}$${val.toFixed(2)}`;
  };

  return (
    <div className="rounded-md border">
      <div className="w-full overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors bg-muted/30">
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                Category
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Positions
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Win Rate
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Total P/L
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Avg P/L
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                ROI
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Avg Drawdown
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {categories.map((cat) => (
              <tr key={cat.category} className="border-b transition-colors hover:bg-muted/50">
                <td className="p-3 align-middle font-medium">{cat.category}</td>
                <td className="p-3 align-middle text-right">
                  <span className="text-muted-foreground text-xs">
                    {cat.winCount}W / {cat.lossCount}L
                  </span>
                  <span className="ml-2">{cat.positionCount}</span>
                </td>
                <td
                  className={cn(
                    "p-3 align-middle text-right font-medium",
                    cat.winRate >= 0.5 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {(cat.winRate * 100).toFixed(1)}%
                </td>
                <td
                  className={cn(
                    "p-3 align-middle text-right font-mono",
                    cat.totalPnl >= 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {formatMoney(cat.totalPnl)}
                </td>
                <td
                  className={cn(
                    "p-3 align-middle text-right font-mono",
                    cat.avgPnl >= 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {formatMoney(cat.avgPnl)}
                </td>
                <td
                  className={cn(
                    "p-3 align-middle text-right font-mono",
                    cat.roi >= 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {cat.roi >= 0 ? "+" : ""}
                  {cat.roi.toFixed(1)}%
                </td>
                <td className="p-3 align-middle text-right text-rose-500">
                  {cat.avgDrawdown.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryBreakdownSection({ categories }: { categories: CategoryBreakdownItem[] }) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No category data available</p>;
  }

  const formatMoney = (val: number) => {
    const prefix = val >= 0 ? (val > 0 ? "+" : "") : "";
    return `${prefix}$${val.toFixed(2)}`;
  };

  const getBadgeColor = (type: string) => {
    switch (type) {
      case "stop-loss":
        return "bg-orange-500/10 text-orange-500";
      case "hedge-full":
        return "bg-blue-500/10 text-blue-500";
      case "hedge-double":
        return "bg-purple-500/10 text-purple-500";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStrategyLabel = (type: string, threshold: number | null) => {
    const labels: Record<string, string> = {
      "stop-loss": "Stop-Loss",
      "hedge-full": "Hedge (Full)",
      "hedge-double": "Hedge (2x)",
      none: "None",
    };
    const label = labels[type] || "None";
    return threshold !== null ? `${label} @${threshold}%` : label;
  };

  return (
    <div className="rounded-md border">
      <div className="w-full overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors bg-muted/30">
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground w-8"></th>
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                Category
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Positions
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Win Rate
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Total P/L
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Avg Drawdown
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Best Strategy
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                Improvement
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {categories.map((cat) => {
              const isExpanded = expandedCategory === cat.category;
              return (
                <React.Fragment key={cat.category}>
                  <tr
                    className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                    onClick={() => setExpandedCategory(isExpanded ? null : cat.category)}
                  >
                    <td className="p-2 align-middle text-center">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="p-3 align-middle font-medium">{cat.category}</td>
                    <td className="p-3 align-middle text-right">
                      <span className="text-muted-foreground text-xs">
                        {cat.winCount}W / {cat.lossCount}L
                      </span>
                      <span className="ml-2">{cat.positionCount}</span>
                    </td>
                    <td
                      className={cn(
                        "p-3 align-middle text-right font-medium",
                        cat.winRate >= 0.5 ? "text-emerald-500" : "text-rose-500",
                      )}
                    >
                      {(cat.winRate * 100).toFixed(1)}%
                    </td>
                    <td
                      className={cn(
                        "p-3 align-middle text-right font-mono",
                        cat.totalPnl >= 0 ? "text-emerald-500" : "text-rose-500",
                      )}
                    >
                      {formatMoney(cat.totalPnl)}
                    </td>
                    <td className="p-3 align-middle text-right text-rose-500">
                      {cat.avgDrawdown.toFixed(1)}%
                    </td>
                    <td className="p-3 align-middle text-right">
                      <Badge variant="secondary" className={getBadgeColor(cat.bestStrategy.type)}>
                        {getStrategyLabel(cat.bestStrategy.type, cat.bestStrategy.threshold)}
                      </Badge>
                    </td>
                    <td
                      className={cn(
                        "p-3 align-middle text-right font-mono font-bold",
                        cat.bestStrategy.expectedImprovement > 0
                          ? "text-emerald-500"
                          : "text-muted-foreground",
                      )}
                    >
                      {formatMoney(cat.bestStrategy.expectedImprovement)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/20">
                      <td colSpan={8} className="p-4">
                        <CategoryDetailCard category={cat} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MissedByDate = { date: string; count: number; potentialProfit: number };

interface PeriodStats {
  positions: number;
  won: number;
  lost: number;
  winRate: number;
  totalPnl: number;
  totalCost: number;
  roi: number;
  avgPnl: number;
  avgHoldingHours: number;
}

function computePeriodStats(positions: PositionLightweight[]): PeriodStats {
  const won = positions.filter((p) => p.result === "won").length;
  const lost = positions.filter((p) => p.result === "lost").length;
  const totalPnl = positions.reduce((sum, p) => sum + parseFloat(p.profitLoss || "0"), 0);
  const totalCost = positions.reduce((sum, p) => sum + parseFloat(p.cost || "0"), 0);
  const roi = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  let totalHours = 0;
  let hoursCount = 0;
  for (const p of positions) {
    if (p.createdAt) {
      const endTime = p.marketEndDate
        ? new Date(p.marketEndDate).getTime()
        : p.resolvedAt
          ? new Date(p.resolvedAt).getTime()
          : null;
      if (endTime) {
        const hours = (endTime - new Date(p.createdAt).getTime()) / (1000 * 60 * 60);
        const MAX_HOURS_THRESHOLD = 168;
        if (hours > 0 && hours < MAX_HOURS_THRESHOLD) {
          totalHours += hours;
          hoursCount++;
        }
      }
    }
  }

  return {
    positions: positions.length,
    won,
    lost,
    winRate: positions.length > 0 ? won / positions.length : 0,
    totalPnl,
    totalCost,
    roi,
    avgPnl: positions.length > 0 ? totalPnl / positions.length : 0,
    avgHoldingHours: hoursCount > 0 ? totalHours / hoursCount : 0,
  };
}

function filterPositionsByPeriod(
  positions: PositionLightweight[],
  period: "all" | "before" | "after",
): PositionLightweight[] {
  if (period === "all") return positions;
  if (period === "before") {
    return positions.filter((p) => new Date(p.createdAt || 0).getTime() < SCALE_UP_TIMESTAMP);
  }
  return positions.filter((p) => new Date(p.createdAt || 0).getTime() >= SCALE_UP_TIMESTAMP);
}

type SimpleCategoryBreakdown = {
  category: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  totalCost: number;
  roi: number;
  avgPnl: number;
  avgDrawdown: number;
};

function computeCategoryBreakdown(positions: PositionLightweight[]): SimpleCategoryBreakdown[] {
  const byCategory = new Map<string, PositionLightweight[]>();

  for (const p of positions) {
    const cat = p.category || "Uncategorized";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(p);
  }

  return Array.from(byCategory.entries())
    .map(([category, catPositions]) => {
      const winCount = catPositions.filter((p) => p.result === "won").length;
      const lossCount = catPositions.filter((p) => p.result === "lost").length;
      const totalPnl = catPositions.reduce((s, p) => s + parseFloat(p.profitLoss || "0"), 0);
      const totalCost = catPositions.reduce((s, p) => s + parseFloat(p.cost || "0"), 0);
      const roi = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
      const avgDrawdown =
        catPositions.reduce((s, p) => s + parseFloat(p.maxDrawdownPercent || "0"), 0) /
        catPositions.length;

      return {
        category,
        positionCount: catPositions.length,
        winCount,
        lossCount,
        winRate: catPositions.length > 0 ? winCount / catPositions.length : 0,
        totalPnl,
        totalCost,
        roi,
        avgPnl: catPositions.length > 0 ? totalPnl / catPositions.length : 0,
        avgDrawdown,
      };
    })
    .sort((a, b) => b.positionCount - a.positionCount);
}

function PeriodComparisonCard({ positions }: { positions: PositionLightweight[] }) {
  const periodStats = useMemo(() => {
    const before = positions.filter(
      (p) => new Date(p.createdAt || 0).getTime() < SCALE_UP_TIMESTAMP,
    );
    const after = positions.filter(
      (p) => new Date(p.createdAt || 0).getTime() >= SCALE_UP_TIMESTAMP,
    );

    return {
      before: computePeriodStats(before),
      after: computePeriodStats(after),
    };
  }, [positions]);

  const { before, after } = periodStats;

  const winRateDelta = after.winRate - before.winRate;
  const avgPnlDelta = after.avgPnl - before.avgPnl;
  const avgHoldDelta = after.avgHoldingHours - before.avgHoldingHours;
  const roiDelta = after.roi - before.roi;

  const formatMoney = (val: number) => {
    const prefix = val >= 0 ? (val > 0 ? "+" : "") : "";
    return `${prefix}$${val.toFixed(2)}`;
  };

  const formatPercent = (val: number) => {
    const prefix = val >= 0 ? (val > 0 ? "+" : "") : "";
    return `${prefix}${(val * 100).toFixed(1)}%`;
  };

  if (before.positions === 0 || after.positions === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Period Comparison
          <InfoTooltip text="Compares performance before and after Jan 14, 2026 scale-up point." />
        </CardTitle>
        <CardDescription>Performance comparison across time periods</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">Pre-Scale</h4>
              <Badge variant="outline" className="text-xs">
                {before.positions} trades
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Win Rate</p>
                <p className="font-mono font-medium">{(before.winRate * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">W / L</p>
                <p className="font-mono font-medium">
                  <span className="text-emerald-500">{before.won}</span>
                  {" / "}
                  <span className="text-rose-500">{before.lost}</span>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total P/L</p>
                <p
                  className={cn(
                    "font-mono font-medium",
                    before.totalPnl >= 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {formatMoney(before.totalPnl)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Avg P/L</p>
                <p
                  className={cn(
                    "font-mono font-medium",
                    before.avgPnl >= 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {formatMoney(before.avgPnl)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">ROI</p>
                <p
                  className={cn(
                    "font-mono font-medium",
                    before.roi >= 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {before.roi >= 0 ? "+" : ""}
                  {before.roi.toFixed(1)}%
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">Avg Hold Time</p>
                <p className="font-mono font-medium">{before.avgHoldingHours.toFixed(1)}h</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-primary/5 border-primary/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">Post-Scale</h4>
              <Badge variant="default" className="text-xs">
                {after.positions} trades
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Win Rate</p>
                <p className="font-mono font-medium flex items-center gap-1">
                  {(after.winRate * 100).toFixed(1)}%
                  <span
                    className={cn(
                      "text-[10px]",
                      winRateDelta >= 0 ? "text-emerald-500" : "text-rose-500",
                    )}
                  >
                    ({formatPercent(winRateDelta)})
                  </span>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">W / L</p>
                <p className="font-mono font-medium">
                  <span className="text-emerald-500">{after.won}</span>
                  {" / "}
                  <span className="text-rose-500">{after.lost}</span>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total P/L</p>
                <p
                  className={cn(
                    "font-mono font-medium",
                    after.totalPnl >= 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {formatMoney(after.totalPnl)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Avg P/L</p>
                <p className="font-mono font-medium flex items-center gap-1">
                  <span className={after.avgPnl >= 0 ? "text-emerald-500" : "text-rose-500"}>
                    {formatMoney(after.avgPnl)}
                  </span>
                  <span
                    className={cn(
                      "text-[10px]",
                      avgPnlDelta >= 0 ? "text-emerald-500" : "text-rose-500",
                    )}
                  >
                    ({formatMoney(avgPnlDelta)})
                  </span>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">ROI</p>
                <p className="font-mono font-medium flex items-center gap-1">
                  <span className={after.roi >= 0 ? "text-emerald-500" : "text-rose-500"}>
                    {after.roi >= 0 ? "+" : ""}
                    {after.roi.toFixed(1)}%
                  </span>
                  <span
                    className={cn(
                      "text-[10px]",
                      roiDelta >= 0 ? "text-emerald-500" : "text-rose-500",
                    )}
                  >
                    ({roiDelta >= 0 ? "+" : ""}
                    {roiDelta.toFixed(1)}%)
                  </span>
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">Avg Hold Time</p>
                <p className="font-mono font-medium flex items-center gap-1">
                  {after.avgHoldingHours.toFixed(1)}h
                  <span
                    className={cn(
                      "text-[10px]",
                      avgHoldDelta <= 0 ? "text-emerald-500" : "text-rose-500",
                    )}
                  >
                    ({avgHoldDelta > 0 ? "+" : ""}
                    {avgHoldDelta.toFixed(1)}h)
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-md bg-muted/30 text-xs text-muted-foreground">
          <strong className="text-foreground">Summary:</strong>{" "}
          {winRateDelta >= 0 ? (
            <>Win rate improved by {formatPercent(winRateDelta)} post-scale.</>
          ) : (
            <>Win rate decreased by {formatPercent(Math.abs(winRateDelta))} post-scale.</>
          )}{" "}
          Average P/L per trade changed by {formatMoney(avgPnlDelta)}.
          {avgHoldDelta < 0 && (
            <> Trades are closing {Math.abs(avgHoldDelta).toFixed(1)}h faster on average.</>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MissedOpportunitiesCard({ events }: { events: MissedOpportunityEvent[] }) {
  const byDate = useMemo(() => {
    const map = new Map<string, { count: number; profit: number }>();
    for (const e of events) {
      const date = new Date(e.createdAt).toLocaleDateString();
      const existing = map.get(date) || { count: 0, profit: 0 };
      existing.count += 1;
      existing.profit += e.metadata?.expectedProfit || 0;
      map.set(date, existing);
    }
    return Array.from(map.entries())
      .map(([date, data]) => ({ date, count: data.count, potentialProfit: data.profit }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 7);
  }, [events]);

  const totalMissed = events.length;
  const totalPotentialProfit = events.reduce((s, e) => s + (e.metadata?.expectedProfit || 0), 0);

  if (totalMissed === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Ban className="h-4 w-4 text-rose-500" />
          Missed Opportunities
        </CardTitle>
        <CardDescription>
          {totalMissed} unique markets · ${totalPotentialProfit.toFixed(2)} potential profit lost
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xs text-muted-foreground">
          Last 7 days:{" "}
          {byDate.length === 0 ? (
            <span>No recent missed opportunities</span>
          ) : (
            byDate.map((d, i) => (
              <span key={d.date}>
                {i > 0 && " · "}
                <span className="text-foreground">
                  {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>{" "}
                ({d.count})
              </span>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type PositionLightweight = Omit<
  ResolvedPositionFromDB,
  "priceHistory" | "oppositeOutcomePriceHistory"
>;

function PositionRow({ position, wallet }: { position: PositionLightweight; wallet: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fullPosition, setFullPosition] = useState<ResolvedPositionFromDB | null>(null);

  const pnl = parseFloat(position.profitLoss || "0");
  const cost = parseFloat(position.cost || "0");
  const roi = cost > 0 ? (pnl / cost) * 100 : 0;
  const isProfit = pnl >= 0;
  const status = position.result as "won" | "lost";
  const statusColor =
    status === "won" ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500";

  const entryPriceCents = parseFloat(position.entryPrice || "0") * 100;
  const finalPriceCents = parseFloat(position.finalPrice || "0") * 100;
  const maxDrawdown = parseFloat(position.maxDrawdownPercent || "0");

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    if (!fullPosition) {
      setLoading(true);
      try {
        const res = await fetchSinglePosition(wallet, position.tokenId);
        setFullPosition(res.position);
      } catch (err) {
        console.error("Failed to fetch position details", err);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  };

  const chartData = useMemo(() => {
    if (!fullPosition?.priceHistory || fullPosition.priceHistory.length === 0) return [];

    const oppositePoints = fullPosition.oppositeOutcomePriceHistory || [];

    const findClosestOppositePrice = (targetTs: number): number | null => {
      if (oppositePoints.length === 0) return null;
      let closest = oppositePoints[0]!;
      let minDiff = Math.abs(closest.timestamp - targetTs);
      for (const p of oppositePoints) {
        const diff = Math.abs(p.timestamp - targetTs);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }
      return minDiff <= 300 ? closest.price : null;
    };

    return fullPosition.priceHistory.map((p) => {
      const ts = typeof p.timestamp === "number" ? p.timestamp * 1000 : p.timestamp;
      const oppPrice = findClosestOppositePrice(p.timestamp);
      return {
        time: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ourPrice: p.price * 100,
        oppositePrice: oppPrice !== null ? oppPrice * 100 : null,
        timestamp: ts,
      };
    });
  }, [fullPosition]);

  const allPrices = chartData.flatMap((d) =>
    [d.ourPrice, d.oppositePrice].filter((p): p is number => p !== null),
  );
  const minPrice =
    allPrices.length > 0 ? Math.min(...allPrices, entryPriceCents) * 0.95 : entryPriceCents * 0.9;
  const maxPrice =
    allPrices.length > 0 ? Math.max(...allPrices, entryPriceCents) * 1.05 : entryPriceCents * 1.1;

  const chartColor = status === "won" ? "#10b981" : "#f43f5e";
  const isAfterScaleUp = new Date(position.createdAt || 0).getTime() >= SCALE_UP_TIMESTAMP;

  return (
    <>
      <tr
        className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
        onClick={handleExpand}
      >
        <td className="p-4 align-middle w-[30px]">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </td>
        <td className="p-4 align-middle">
          <div className="flex flex-col">
            <span className="font-medium line-clamp-1" title={position.marketQuestion || ""}>
              {position.marketQuestion}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                {position.outcome}
              </Badge>

              {position.category && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 bg-blue-500/10 text-blue-500 border-blue-500/30"
                >
                  {position.category}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {position.resolvedAt ? new Date(position.resolvedAt).toLocaleDateString() : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 text-[10px] px-2 ml-1"
                asChild
              >
                <a
                  href={`https://polymarket.com/event/${position.eventSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="View on Polymarket"
                >
                  Polymarket
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>
        </td>
        <td className="p-4 align-middle text-right">{entryPriceCents.toFixed(1)}¢</td>
        <td className="p-4 align-middle text-right">{finalPriceCents.toFixed(1)}¢</td>
        <td className="p-4 align-middle text-right font-mono">
          <span className={isProfit ? "text-emerald-500" : "text-rose-500"}>
            {isProfit ? "+" : ""}${pnl.toFixed(2)}
          </span>
        </td>
        <td className="p-4 align-middle text-right font-mono">
          <span className={roi >= 0 ? "text-emerald-500" : "text-rose-500"}>
            {roi >= 0 ? "+" : ""}
            {roi.toFixed(1)}%
          </span>
        </td>
        <td className="p-4 align-middle">
          <Badge variant="secondary" className={cn("capitalize", statusColor)}>
            {status}
          </Badge>
        </td>
        <td className="p-4 align-middle text-right text-rose-500 font-medium">
          {maxDrawdown > 0 ? `-${maxDrawdown.toFixed(1)}%` : "0%"}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/30 hover:bg-muted/30">
          <td colSpan={8} className="p-4 align-middle">
            <div className="h-[250px] w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <defs>
                      <linearGradient id={`colorPrice-${position.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--border))"
                      opacity={0.4}
                    />
                    <XAxis
                      dataKey="time"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      domain={[minPrice, maxPrice]}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val: number) => `${val.toFixed(0)}¢`}
                      width={45}
                    />
                    <ChartTooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--background))",
                        borderColor: "hsl(var(--border))",
                        borderRadius: "var(--radius)",
                        fontSize: "12px",
                      }}
                      formatter={(val: number | undefined, name?: string) => [
                        typeof val === "number" ? `${val.toFixed(1)}¢` : "N/A",
                        name === "ourPrice" ? "Our Outcome" : "Opposite Outcome",
                      ]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                      formatter={(value: string) =>
                        value === "ourPrice" ? "Our Outcome" : "Opposite (Hedge)"
                      }
                    />
                    <ReferenceLine
                      y={entryPriceCents}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="3 3"
                      label={{
                        position: "right",
                        value: `Entry ${entryPriceCents.toFixed(0)}¢`,
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 10,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="ourPrice"
                      stroke={chartColor}
                      fillOpacity={1}
                      fill={`url(#colorPrice-${position.id})`}
                      strokeWidth={2}
                      name="ourPrice"
                    />
                    <Line
                      type="monotone"
                      dataKey="oppositePrice"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      dot={false}
                      name="oppositePrice"
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No price history available
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MultiSelectCategory({
  categories,
  selected,
  onChange,
}: {
  categories: string[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleCategory = (cat: string) => {
    const next = new Set(selected);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    onChange(next);
  };

  const selectAll = () => onChange(new Set(categories));
  const clearAll = () => onChange(new Set());

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="outline"
        className="w-[160px] justify-between text-xs h-8 px-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate">
          {selected.size === 0
            ? "No Categories"
            : selected.size === categories.length
              ? "All Categories"
              : `Categories (${selected.size})`}
        </span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </Button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-[220px] rounded-md border bg-popover text-popover-foreground shadow-md z-50 overflow-hidden bg-background">
          <div className="p-2 border-b flex items-center justify-between bg-muted/30">
            <button
              onClick={selectAll}
              className="text-[10px] text-primary hover:underline cursor-pointer"
            >
              Select All
            </button>
            <button
              onClick={clearAll}
              className="text-[10px] text-muted-foreground hover:text-primary hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="max-h-[300px] overflow-auto p-1">
            {categories.map((cat) => {
              const isSelected = selected.has(cat);
              return (
                <div
                  key={cat}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  onClick={() => toggleCategory(cat)}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "opacity-50 [&_svg]:invisible",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </div>
                  <span>{cat}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PeriodFilter({
  value,
  onChange,
}: {
  value: "all" | "before" | "after";
  onChange: (v: "all" | "before" | "after") => void;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5 h-8">
      <button
        onClick={() => onChange("all")}
        className={cn(
          "px-3 py-0.5 text-xs rounded-md font-medium transition-colors cursor-pointer",
          value === "all"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        All Time
      </button>
      <button
        onClick={() => onChange("before")}
        className={cn(
          "px-3 py-0.5 text-xs rounded-md font-medium transition-colors cursor-pointer",
          value === "before"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Pre-Scale
      </button>
      <button
        onClick={() => onChange("after")}
        className={cn(
          "px-3 py-0.5 text-xs rounded-md font-medium transition-colors cursor-pointer",
          value === "after"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Post-Scale
      </button>
    </div>
  );
}

export default function PositionAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [analytics, setAnalytics] = useState<WalletAnalytics | null>(null);
  const [positions, setPositions] = useState<PositionLightweight[]>([]);
  const [missedOpportunities, setMissedOpportunities] = useState<MissedOpportunityEvent[]>([]);
  const [selectedWallet, setSelectedWallet] = useState(DEFAULT_WALLET);

  const [positionsFilter, setPositionsFilter] = useState<ResolvedFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [periodFilter, setPeriodFilter] = useState<"all" | "before" | "after">("all");
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "date",
    direction: "desc",
  });

  const [stopLossPeriod, setStopLossPeriod] = useState<"all" | "before" | "after">("all");
  const [hedgingPeriod, setHedgingPeriod] = useState<"all" | "before" | "after">("all");
  const [entryTimingPeriod, setEntryTimingPeriod] = useState<"all" | "before" | "after">("all");
  const [categoryPeriod, setCategoryPeriod] = useState<"all" | "before" | "after">("all");

  const [periodAnalyticsCache, setPeriodAnalyticsCache] = useState<
    Record<"before" | "after", ComputedAnalytics | null>
  >({
    before: null,
    after: null,
  });
  const [periodAnalyticsLoading, setPeriodAnalyticsLoading] = useState<
    Record<"before" | "after", boolean>
  >({
    before: false,
    after: false,
  });

  const categories = useMemo(() => {
    const cats = new Set(positions.map((p) => p.category).filter(Boolean) as string[]);
    return Array.from(cats).sort();
  }, [positions]);

  const filteredPositions = useMemo(() => {
    let result = positions;

    if (positionsFilter !== "all") {
      result = result.filter((p) => p.result === positionsFilter);
    }

    if (categoryFilter.size > 0) {
      result = result.filter((p) => p.category && categoryFilter.has(p.category));
    }

    if (periodFilter === "before") {
      result = result.filter((p) => new Date(p.createdAt || 0).getTime() < SCALE_UP_TIMESTAMP);
    } else if (periodFilter === "after") {
      result = result.filter((p) => new Date(p.createdAt || 0).getTime() >= SCALE_UP_TIMESTAMP);
    }

    return [...result].sort((a, b) => {
      const dir = sortConfig.direction === "asc" ? 1 : -1;

      switch (sortConfig.key) {
        case "date":
          return (
            (new Date(a.resolvedAt || 0).getTime() - new Date(b.resolvedAt || 0).getTime()) * dir
          );
        case "entry":
          return (parseFloat(a.entryPrice || "0") - parseFloat(b.entryPrice || "0")) * dir;
        case "final":
          return (parseFloat(a.finalPrice || "0") - parseFloat(b.finalPrice || "0")) * dir;
        case "pnl":
          return (parseFloat(a.profitLoss || "0") - parseFloat(b.profitLoss || "0")) * dir;
        case "roi": {
          const roiA =
            parseFloat(a.cost || "0") > 0
              ? parseFloat(a.profitLoss || "0") / parseFloat(a.cost || "1")
              : 0;
          const roiB =
            parseFloat(b.cost || "0") > 0
              ? parseFloat(b.profitLoss || "0") / parseFloat(b.cost || "1")
              : 0;
          return (roiA - roiB) * dir;
        }
        case "maxdd":
          return (
            (parseFloat(a.maxDrawdownPercent || "0") - parseFloat(b.maxDrawdownPercent || "0")) *
            dir
          );
        default:
          return 0;
      }
    });
  }, [positions, positionsFilter, categoryFilter, periodFilter, sortConfig]);

  const handleSort = (key: SortKey) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortConfig.key !== column)
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/30" />;
    return sortConfig.direction === "asc" ? (
      <ChevronUp className="ml-1 h-3 w-3" />
    ) : (
      <ChevronDown className="ml-1 h-3 w-3" />
    );
  };

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        const [analyticsRes, positionsRes, missedRes] = await Promise.all([
          fetchWalletAnalytics(selectedWallet, abortControllerRef.current.signal),
          fetchResolvedPositionsFromDB(selectedWallet, abortControllerRef.current.signal),
          fetchMissedOpportunities(
            getBotIdForWallet(selectedWallet),
            500,
            abortControllerRef.current.signal,
          ),
        ]);

        setAnalytics(analyticsRes.analytics);
        setPositions(positionsRes.positions as PositionLightweight[]);
        setMissedOpportunities(missedRes.events);
        setError(null);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedWallet],
  );

  useEffect(() => {
    loadData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadData]);

  const handleRefresh = () => loadData(true);

  const fetchPeriodAnalytics = useCallback(
    async (period: "before" | "after") => {
      if (periodAnalyticsCache[period] || periodAnalyticsLoading[period]) return;

      setPeriodAnalyticsLoading((prev) => ({ ...prev, [period]: true }));
      try {
        const res = await fetchComputedAnalytics(selectedWallet, period);
        setPeriodAnalyticsCache((prev) => ({ ...prev, [period]: res.analytics }));
      } catch (err) {
        console.error(`Failed to fetch ${period} analytics:`, err);
      } finally {
        setPeriodAnalyticsLoading((prev) => ({ ...prev, [period]: false }));
      }
    },
    [selectedWallet, periodAnalyticsCache, periodAnalyticsLoading],
  );

  useEffect(() => {
    const periodsNeeded = new Set<"before" | "after">();
    if (stopLossPeriod !== "all") periodsNeeded.add(stopLossPeriod);
    if (hedgingPeriod !== "all") periodsNeeded.add(hedgingPeriod);
    if (entryTimingPeriod !== "all") periodsNeeded.add(entryTimingPeriod);
    if (categoryPeriod !== "all") periodsNeeded.add(categoryPeriod);

    for (const period of periodsNeeded) {
      fetchPeriodAnalytics(period);
    }
  }, [stopLossPeriod, hedgingPeriod, entryTimingPeriod, categoryPeriod, fetchPeriodAnalytics]);

  useEffect(() => {
    setPeriodAnalyticsCache({ before: null, after: null });
  }, [selectedWallet]);

  const totalPnl = parseFloat(analytics?.totalPnl || "0");
  const winCount = parseInt(analytics?.winCount || "0", 10);
  const lossCount = parseInt(analytics?.lossCount || "0", 10);
  const winRate = parseFloat(analytics?.winRate || "0");
  const avgHoldingHours = parseFloat(analytics?.avgHoldingHours || "0");
  const capitalDeposited = getCapitalDeposited(selectedWallet);
  const capitalRoi =
    capitalDeposited !== null && capitalDeposited > 0 ? (totalPnl / capitalDeposited) * 100 : null;

  return (
    <>
      <Header activeOpportunities={0} />

      <main className="flex-1 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Position Analytics
              </h1>
              <p className="text-muted-foreground mt-1">
                {positions.length} positions
                {analytics?.computedAt && (
                  <span className="ml-2 text-xs">
                    · Analytics computed {new Date(analytics.computedAt).toLocaleString()}
                  </span>
                )}
                {refreshing && <span className="ml-2 text-primary">(updating...)</span>}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Select value={selectedWallet} onValueChange={setSelectedWallet}>
                <SelectTrigger className="w-[130px] cursor-pointer">
                  <SelectValue placeholder="Wallet" />
                </SelectTrigger>
                <SelectContent>
                  {WALLET_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="cursor-pointer">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing || loading}
                className="gap-2 cursor-pointer"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {refreshing ? "Loading..." : "Refresh"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-rose-500 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-32 w-full rounded-xl" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Skeleton className="h-[400px] rounded-xl" />
                <Skeleton className="h-[400px] rounded-xl" />
              </div>
            </div>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <SummaryCard
                  title="Total Positions"
                  value={winCount + lossCount}
                  subtext={`${winCount} won · ${lossCount} lost`}
                  icon={Activity}
                  colorClass="text-blue-500"
                  info="Total number of resolved positions analyzed."
                />
                <SummaryCard
                  title="Win Rate"
                  value={`${(winRate * 100).toFixed(1)}%`}
                  subtext="Based on resolved positions"
                  icon={Percent}
                  trend={winRate >= 0.5 ? "up" : "down"}
                  trendValue={winRate >= 0.5 ? "Profitable" : ""}
                  colorClass="text-purple-500"
                  info="Percentage of positions that ended with profit."
                />
                <SummaryCard
                  title="Avg Hold Time"
                  value={`${avgHoldingHours.toFixed(1)}h`}
                  subtext="Average position duration"
                  icon={TrendingDown}
                  colorClass="text-orange-500"
                  info="Average time from entry to resolution."
                />
                <SummaryCard
                  title="Total PnL"
                  value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
                  subtext="Realized Profit/Loss"
                  icon={DollarSign}
                  trend={totalPnl >= 0 ? "up" : "down"}
                  trendValue="Net Result"
                  colorClass="text-emerald-500"
                  info="Sum of all realized profits and losses."
                />
                <SummaryCard
                  title="Capital ROI"
                  value={
                    capitalRoi !== null
                      ? `${capitalRoi >= 0 ? "+" : ""}${capitalRoi.toFixed(1)}%`
                      : "N/A"
                  }
                  subtext={
                    capitalDeposited !== null
                      ? `On $${capitalDeposited.toFixed(2)} deposited`
                      : "No deposit data"
                  }
                  icon={TrendingUp}
                  trend={capitalRoi !== null ? (capitalRoi >= 0 ? "up" : "down") : undefined}
                  trendValue={capitalRoi !== null ? "Return on Capital" : undefined}
                  colorClass={
                    capitalRoi !== null
                      ? capitalRoi >= 0
                        ? "text-emerald-500"
                        : "text-rose-500"
                      : "text-muted-foreground"
                  }
                  info="Capital ROI: (Total P/L ÷ Total Deposited) × 100. Shows return on the actual capital you deposited into this wallet."
                />
              </div>

              <MissedOpportunitiesCard events={missedOpportunities} />

              {/* Period comparison only for v1 (archived) bots */}
              {selectedWallet === "0xabe50375A4064C5d5E0BE39063082e8eeF144097" ||
              selectedWallet === "0x4884D7cFD4cDaf76C183D974f41D05381DE006DD" ||
              selectedWallet === "0x3bb59DdB9043d40AeF6a38bb4DF85F74a5Ac899b" ? (
                <PeriodComparisonCard positions={positions} />
              ) : null}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />
                          Stop Loss Simulation
                          <InfoTooltip text="Simulates what would have happened with stop-loss orders at different thresholds." />
                        </CardTitle>
                        <CardDescription>
                          Impact of stop-loss thresholds on past trades
                        </CardDescription>
                      </div>
                      <PeriodFilter value={stopLossPeriod} onChange={setStopLossPeriod} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {stopLossPeriod === "all" ? (
                      <StopLossTable analysis={analytics.stopLossAnalysis} />
                    ) : periodAnalyticsLoading[stopLossPeriod] ? (
                      <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                      </div>
                    ) : periodAnalyticsCache[stopLossPeriod] ? (
                      <StopLossTable
                        analysis={periodAnalyticsCache[stopLossPeriod]!.stopLossAnalysis}
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground p-4 border rounded-md bg-muted/20">
                        <p>
                          Failed to load {stopLossPeriod === "before" ? "Pre-Scale" : "Post-Scale"}{" "}
                          period data
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Shield className="h-5 w-5 text-primary" />
                          Hedging Simulation
                          <InfoTooltip text="Simulates hedging by buying opposite outcome shares when price dropped." />
                        </CardTitle>
                        <CardDescription>
                          Compare hedging strategies at different trigger points
                        </CardDescription>
                      </div>
                      <PeriodFilter value={hedgingPeriod} onChange={setHedgingPeriod} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {hedgingPeriod === "all" ? (
                      <HedgingTable analysis={analytics.hedgingAnalysis} />
                    ) : periodAnalyticsLoading[hedgingPeriod] ? (
                      <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                      </div>
                    ) : periodAnalyticsCache[hedgingPeriod] ? (
                      <HedgingTable
                        analysis={periodAnalyticsCache[hedgingPeriod]!.hedgingAnalysis}
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground p-4 border rounded-md bg-muted/20">
                        <p>
                          Failed to load {hedgingPeriod === "before" ? "Pre-Scale" : "Post-Scale"}{" "}
                          period data
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Clock className="h-5 w-5 text-primary" />
                        Entry Timing Analysis
                        <InfoTooltip text="Shows how win rate changes based on how close to resolution you enter (price between 95¢-99.5¢)." />
                      </CardTitle>
                      <CardDescription>Win rate by time window before resolution</CardDescription>
                    </div>
                    <PeriodFilter value={entryTimingPeriod} onChange={setEntryTimingPeriod} />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {entryTimingPeriod === "all" ? (
                    <EntryTimingTable analysis={analytics.entryTimingAnalysis} />
                  ) : periodAnalyticsLoading[entryTimingPeriod] ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                    </div>
                  ) : periodAnalyticsCache[entryTimingPeriod] ? (
                    <EntryTimingTable
                      analysis={periodAnalyticsCache[entryTimingPeriod]!.entryTimingAnalysis}
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground p-4 border rounded-md bg-muted/20">
                      <p>
                        Failed to load {entryTimingPeriod === "before" ? "Pre-Scale" : "Post-Scale"}{" "}
                        period data
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Tag className="h-5 w-5 text-primary" />
                        Category Analysis
                        <InfoTooltip text="Performance breakdown by market category." />
                      </CardTitle>
                      <CardDescription>
                        Compare performance across different market categories
                      </CardDescription>
                    </div>
                    <PeriodFilter value={categoryPeriod} onChange={setCategoryPeriod} />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {categoryPeriod === "all" ? (
                    <CategoryBreakdownSection categories={analytics.categoryBreakdown} />
                  ) : periodAnalyticsLoading[categoryPeriod] ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                    </div>
                  ) : periodAnalyticsCache[categoryPeriod] ? (
                    <CategoryBreakdownSection
                      categories={periodAnalyticsCache[categoryPeriod]!.categoryBreakdown}
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground p-4 border rounded-md bg-muted/20">
                      <p>
                        Failed to load {categoryPeriod === "before" ? "Pre-Scale" : "Post-Scale"}{" "}
                        period data
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary" />
                        Positions
                      </CardTitle>
                      <CardDescription>
                        {filteredPositions.length} positions
                        {positionsFilter !== "all" && ` (${positionsFilter})`}
                        {periodFilter === "before" && " · Pre-Scale"}
                        {periodFilter === "after" && " · Post-Scale"}
                        {categoryFilter.size > 0 && ` · ${categoryFilter.size} Categories`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <MultiSelectCategory
                        categories={categories}
                        selected={categoryFilter}
                        onChange={setCategoryFilter}
                      />
                      <PeriodFilter value={periodFilter} onChange={setPeriodFilter} />
                      <SectionFilter
                        value={positionsFilter}
                        onChange={(v) => setPositionsFilter(v)}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="border-t">
                    <div className="w-full overflow-auto max-h-[600px]">
                      <table className="w-full caption-bottom text-sm">
                        <thead className="[&_tr]:border-b sticky top-0 bg-background z-10">
                          <tr className="border-b transition-colors hover:bg-muted/50">
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[30px]"></th>
                            <th
                              className="h-12 px-4 text-left align-middle font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => handleSort("date")}
                            >
                              <div className="flex items-center">
                                Market / Date
                                <SortIcon column="date" />
                              </div>
                            </th>
                            <th
                              className="h-12 px-4 text-right align-middle font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => handleSort("entry")}
                            >
                              <div className="flex items-center justify-end">
                                Entry
                                <SortIcon column="entry" />
                              </div>
                            </th>
                            <th
                              className="h-12 px-4 text-right align-middle font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => handleSort("final")}
                            >
                              <div className="flex items-center justify-end">
                                Final
                                <SortIcon column="final" />
                              </div>
                            </th>
                            <th
                              className="h-12 px-4 text-right align-middle font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => handleSort("pnl")}
                            >
                              <div className="flex items-center justify-end">
                                P/L
                                <SortIcon column="pnl" />
                              </div>
                            </th>
                            <th
                              className="h-12 px-4 text-right align-middle font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => handleSort("roi")}
                            >
                              <div className="flex items-center justify-end">
                                ROI
                                <SortIcon column="roi" />
                              </div>
                            </th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                              Status
                            </th>
                            <th
                              className="h-12 px-4 text-right align-middle font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                              onClick={() => handleSort("maxdd")}
                            >
                              <div className="flex items-center justify-end">
                                Max DD
                                <SortIcon column="maxdd" />
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="[&_tr:last-child]:border-0">
                          {filteredPositions.length === 0 ? (
                            <tr>
                              <td
                                colSpan={8}
                                className="p-4 align-middle text-center h-24 text-muted-foreground"
                              >
                                No positions found matching filter.
                              </td>
                            </tr>
                          ) : (
                            filteredPositions.map((pos) => (
                              <PositionRow key={pos.id} position={pos} wallet={selectedWallet} />
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <div className="p-4 rounded-full bg-secondary">
                <Filter className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-medium">No Data Available</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  Could not fetch analytics. Please run the sync cron job first.
                </p>
              </div>
              <Button onClick={handleRefresh}>Try Again</Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
