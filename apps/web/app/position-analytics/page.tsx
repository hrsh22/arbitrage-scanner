"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Header } from "@/components/ui/header";
import {
  fetchWalletAnalytics,
  fetchResolvedPositionsFromDB,
  fetchSinglePosition,
  fetchMissedOpportunities,
  type WalletAnalytics,
  type ResolvedPositionFromDB,
  type StopLossAnalysisItem,
  type HedgingAnalysisItem,
  type CategoryBreakdownItem,
  type MissedOpportunityEvent,
} from "@/lib/polymarket-api";
import { DEFAULT_WALLET, WALLET_OPTIONS } from "@/lib/polymarket-api";
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
  AreaChart,
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
              tickFormatter={(val) => `$${val.toFixed(0)}`}
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
              formatter={(value) =>
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
          {totalMissed} missed · ${totalPotentialProfit.toFixed(2)} potential profit lost
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2">
          {byDate.map((d) => (
            <div key={d.date} className="bg-muted/50 rounded px-2 py-1 text-xs">
              <span className="font-medium">{d.date}</span>
              <span className="text-muted-foreground ml-1">
                {d.count} missed · ${d.potentialProfit.toFixed(2)}
              </span>
            </div>
          ))}
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
              <span className="text-xs text-muted-foreground">
                {position.resolvedAt ? new Date(position.resolvedAt).toLocaleDateString() : ""}
              </span>
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
          <td colSpan={7} className="p-4 align-middle">
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
                      tickFormatter={(val) => `${val.toFixed(0)}¢`}
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
                      formatter={(value) =>
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

  const filteredPositions = useMemo(() => {
    if (positionsFilter === "all") return positions;
    return positions.filter((p) => p.result === positionsFilter);
  }, [positions, positionsFilter]);

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
          fetchMissedOpportunities(1, 500, abortControllerRef.current.signal),
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

  const totalPnl = parseFloat(analytics?.totalPnl || "0");
  const winCount = parseInt(analytics?.winCount || "0", 10);
  const lossCount = parseInt(analytics?.lossCount || "0", 10);
  const winRate = parseFloat(analytics?.winRate || "0");
  const avgHoldingHours = parseFloat(analytics?.avgHoldingHours || "0");

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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
              </div>

              <MissedOpportunitiesCard events={missedOpportunities} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Stop Loss Simulation
                      <InfoTooltip text="Simulates what would have happened with stop-loss orders at different thresholds." />
                    </CardTitle>
                    <CardDescription>Impact of stop-loss thresholds on past trades</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <StopLossTable analysis={analytics.stopLossAnalysis} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Shield className="h-5 w-5 text-primary" />
                      Hedging Simulation
                      <InfoTooltip text="Simulates hedging by buying opposite outcome shares when price dropped." />
                    </CardTitle>
                    <CardDescription>
                      Compare hedging strategies at different trigger points
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <HedgingTable analysis={analytics.hedgingAnalysis} />
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Tag className="h-5 w-5 text-primary" />
                    Category Analysis
                    <InfoTooltip text="Performance breakdown by market category." />
                  </CardTitle>
                  <CardDescription>
                    Compare performance across different market categories
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <CategoryBreakdownSection categories={analytics.categoryBreakdown} />
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
                      </CardDescription>
                    </div>
                    <SectionFilter
                      value={positionsFilter}
                      onChange={(v) => setPositionsFilter(v)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="border-t">
                    <div className="w-full overflow-auto max-h-[600px]">
                      <table className="w-full caption-bottom text-sm">
                        <thead className="[&_tr]:border-b sticky top-0 bg-background z-10">
                          <tr className="border-b transition-colors hover:bg-muted/50">
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[30px]"></th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                              Market
                            </th>
                            <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                              Entry
                            </th>
                            <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                              Final
                            </th>
                            <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                              P/L
                            </th>
                            <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                              Status
                            </th>
                            <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                              Max DD
                            </th>
                          </tr>
                        </thead>
                        <tbody className="[&_tr:last-child]:border-0">
                          {filteredPositions.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
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
