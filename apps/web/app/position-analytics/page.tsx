"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Header } from "@/components/ui/header";
import {
  getPositionAnalyticsHybrid,
  calculateCategoryAnalysis,
  fetchLastSyncTime,
} from "@/lib/position-analytics-service";
import { DEFAULT_WALLET, WALLET_OPTIONS } from "@/lib/polymarket-api";
import {
  PositionAnalytics,
  AnalyticsSummary,
  HedgingSimulation,
  CategoryAnalysis,
} from "@/lib/types";
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
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
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

type StatusFilter = "all" | "open" | "won" | "lost";
type ResolvedFilter = "all" | "won" | "lost";

function SectionFilter({
  value,
  onChange,
  includeOpen = false,
}: {
  value: StatusFilter | ResolvedFilter;
  onChange: (v: ResolvedFilter) => void;
  includeOpen?: boolean;
}) {
  const options = includeOpen
    ? (["all", "open", "won", "lost"] as const)
    : (["all", "won", "lost"] as const);

  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt as ResolvedFilter)}
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

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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

function StopLossTable({ simulations }: { simulations: AnalyticsSummary["stopLossImpact"] }) {
  if (!simulations || simulations.length === 0)
    return <p className="text-sm text-muted-foreground">No data available</p>;

  return (
    <div className="rounded-md border">
      <div className="w-full overflow-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                <div className="flex items-center gap-1">
                  Threshold
                  <InfoTooltip text="Stop-loss trigger level as a percentage drop from entry price." />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                <div className="flex items-center justify-end gap-1">
                  Triggered
                  <InfoTooltip text="Number of positions that would have hit this stop-loss level." />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                <div className="flex items-center justify-end gap-1">
                  Recovered
                  <InfoTooltip text="Of triggered positions, how many later recovered above entry price." />
                </div>
              </th>
              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">
                <div className="flex items-center justify-end gap-1">
                  Net Impact
                  <InfoTooltip text="Total P/L difference: (P/L if sold at stop-loss) - (P/L from holding). Negative = stop-loss would have cost you money." />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {simulations.map((sim) => (
              <tr
                key={sim.threshold}
                className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
              >
                <td className="p-4 align-middle font-medium">{sim.threshold}%</td>
                <td className="p-4 align-middle text-right">{sim.wouldHaveTriggered}</td>
                <td className="p-4 align-middle text-right text-muted-foreground">
                  {sim.wouldHaveRecovered}
                </td>
                <td
                  className={cn(
                    "p-4 align-middle text-right font-bold",
                    sim.netImpactIfUsed > 0
                      ? "text-emerald-500"
                      : sim.netImpactIfUsed < 0
                        ? "text-rose-500"
                        : "text-muted-foreground",
                  )}
                >
                  {sim.netImpactIfUsed > 0 ? "+" : ""}${sim.netImpactIfUsed.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type StrategyMetrics = {
  hedgeCost: number;
  totalInvestment: number;
  pnlWithHedge: number;
  netImpact: number;
};

type HedgingSummaryRow = {
  threshold: number;
  triggered: number;
  originalInvestment: number;
  actualPnlNoHedge: number;
  fullLock: StrategyMetrics;
  doubleOpposite: StrategyMetrics;
  bestStrategy: string;
  bestNetImpact: number;
};

function computeHedgingSummary(positions: PositionAnalytics[]): HedgingSummaryRow[] {
  if (!positions || positions.length === 0) return [];

  const thresholdMap = new Map<
    number,
    {
      triggered: number;
      originalInvestment: number;
      actualPnlNoHedge: number;
      fullLock: { hedgeCost: number; totalInvestment: number; pnlWithHedge: number };
      doubleOpposite: { hedgeCost: number; totalInvestment: number; pnlWithHedge: number };
    }
  >();

  for (const pos of positions) {
    if (!pos.hedgingSimulations) continue;
    const positionCost = pos.position.cost;
    const positionActualPnl = pos.position.profitLoss ?? 0;

    for (const sim of pos.hedgingSimulations) {
      if (!thresholdMap.has(sim.threshold)) {
        thresholdMap.set(sim.threshold, {
          triggered: 0,
          originalInvestment: 0,
          actualPnlNoHedge: 0,
          fullLock: { hedgeCost: 0, totalInvestment: 0, pnlWithHedge: 0 },
          doubleOpposite: { hedgeCost: 0, totalInvestment: 0, pnlWithHedge: 0 },
        });
      }

      const data = thresholdMap.get(sim.threshold)!;

      if (sim.triggered && sim.strategies.length > 0) {
        data.triggered++;
        data.originalInvestment += positionCost;
        data.actualPnlNoHedge += positionActualPnl;

        for (const strat of sim.strategies) {
          if (strat.actualPnl !== null) {
            if (strat.name === "fullLockIn") {
              data.fullLock.hedgeCost += strat.hedgeCost;
              data.fullLock.totalInvestment += strat.totalInvestment;
              data.fullLock.pnlWithHedge += strat.actualPnl;
            } else if (strat.name === "doubleOpposite") {
              data.doubleOpposite.hedgeCost += strat.hedgeCost;
              data.doubleOpposite.totalInvestment += strat.totalInvestment;
              data.doubleOpposite.pnlWithHedge += strat.actualPnl;
            }
          }
        }
      }
    }
  }

  const rows: HedgingSummaryRow[] = [];
  for (const [threshold, data] of thresholdMap) {
    const fullLockNet = data.fullLock.pnlWithHedge - data.actualPnlNoHedge;
    const doubleNet = data.doubleOpposite.pnlWithHedge - data.actualPnlNoHedge;

    let bestStrategy = "None";
    let bestNetImpact = 0;
    const maxNet = Math.max(fullLockNet, doubleNet);
    if (maxNet > 0) {
      bestNetImpact = maxNet;
      if (fullLockNet === maxNet) bestStrategy = "Full Lock";
      else bestStrategy = "2x Opposite";
    }

    rows.push({
      threshold,
      triggered: data.triggered,
      originalInvestment: data.originalInvestment,
      actualPnlNoHedge: data.actualPnlNoHedge,
      fullLock: { ...data.fullLock, netImpact: fullLockNet },
      doubleOpposite: { ...data.doubleOpposite, netImpact: doubleNet },
      bestStrategy,
      bestNetImpact,
    });
  }

  return rows.sort((a, b) => a.threshold - b.threshold);
}

function HedgingSimulationTable({ rows }: { rows: HedgingSummaryRow[] }) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  if (!rows || rows.length === 0)
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
                <div className="flex items-center gap-1">
                  Drop
                  <InfoTooltip text="Price drop threshold (cumulative: 5% includes all positions that dropped 5% or more)." />
                </div>
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Hit
                  <InfoTooltip text="Number of positions that dropped at least this much from entry." />
                </div>
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Invested
                  <InfoTooltip text="Total original investment for positions that hit this threshold." />
                </div>
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  No Hedge P/L
                  <InfoTooltip text="Actual P/L from holding without hedging for all positions that hit this threshold." />
                </div>
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Best Strategy
                  <InfoTooltip text="Strategy with the best net impact (hedged P/L minus no-hedge P/L)." />
                </div>
              </th>
              <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                <div className="flex items-center justify-end gap-1">
                  Net Impact
                  <InfoTooltip text="Difference: (P/L with best hedge) - (P/L without hedge). Positive = hedging would have helped." />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {rows.map((row) => {
              const isExpanded = expandedRows.has(row.threshold);
              return (
                <React.Fragment key={row.threshold}>
                  <tr
                    className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggleRow(row.threshold)}
                  >
                    <td className="p-2 align-middle text-center">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="p-3 align-middle font-medium">{row.threshold}%</td>
                    <td className="p-3 align-middle text-right">{row.triggered}</td>
                    <td className="p-3 align-middle text-right font-mono">
                      ${row.originalInvestment.toFixed(2)}
                    </td>
                    <td
                      className={cn(
                        "p-3 align-middle text-right font-mono",
                        row.actualPnlNoHedge >= 0 ? "text-emerald-500" : "text-rose-500",
                      )}
                    >
                      {formatMoney(row.actualPnlNoHedge)}
                    </td>
                    <td className="p-3 align-middle text-right text-xs font-semibold">
                      {row.bestStrategy}
                    </td>
                    <td
                      className={cn(
                        "p-3 align-middle text-right font-mono font-bold",
                        row.bestNetImpact > 0
                          ? "text-emerald-500"
                          : row.bestNetImpact < 0
                            ? "text-rose-500"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatMoney(row.bestNetImpact)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/20">
                      <td colSpan={7} className="p-4">
                        <div className="rounded-md border bg-background p-4 shadow-sm">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="text-left py-1 font-medium">Strategy</th>
                                <th className="text-right py-1 font-medium">Hedge Cost</th>
                                <th className="text-right py-1 font-medium">Total Invested</th>
                                <th className="text-right py-1 font-medium">P/L With Hedge</th>
                                <th className="text-right py-1 font-medium">Net Impact</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                {
                                  name: "Full Lock-in",
                                  data: row.fullLock,
                                  desc: "Buy equal shares of opposite outcome. Guarantees a fixed return regardless of winner.",
                                },
                                {
                                  name: "2x Opposite",
                                  data: row.doubleOpposite,
                                  desc: "Buy 2x shares of opposite outcome. Aggressive reversal bet - profits if original loses.",
                                },
                              ].map((s) => (
                                <tr key={s.name} className="border-t border-muted">
                                  <td className="py-2">
                                    <div className="font-medium">{s.name}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                      {s.desc}
                                    </div>
                                  </td>
                                  <td className="py-2 text-right font-mono align-top pt-2">
                                    ${s.data.hedgeCost.toFixed(2)}
                                  </td>
                                  <td className="py-2 text-right font-mono align-top pt-2">
                                    ${s.data.totalInvestment.toFixed(2)}
                                  </td>
                                  <td
                                    className={cn(
                                      "py-2 text-right font-mono align-top pt-2",
                                      s.data.pnlWithHedge >= 0
                                        ? "text-emerald-500"
                                        : "text-rose-500",
                                    )}
                                  >
                                    {formatMoney(s.data.pnlWithHedge)}
                                  </td>
                                  <td
                                    className={cn(
                                      "py-2 text-right font-mono font-semibold align-top pt-2",
                                      s.data.netImpact > 0
                                        ? "text-emerald-500"
                                        : s.data.netImpact < 0
                                          ? "text-rose-500"
                                          : "text-muted-foreground",
                                    )}
                                  >
                                    {formatMoney(s.data.netImpact)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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

function CategoryAnalysisSection({ categories }: { categories: CategoryAnalysis[] }) {
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

  const getStrategyLabel = (type: string) => {
    switch (type) {
      case "stop-loss":
        return "Stop-Loss";
      case "hedge-full":
        return "Hedge (Full)";
      case "hedge-double":
        return "Hedge (2x)";
      default:
        return "None";
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <div className="w-full overflow-auto">
          <table className="w-full caption-bottom text-sm">
            <thead className="[&_tr]:border-b">
              <tr className="border-b transition-colors bg-muted/30">
                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground w-8"></th>
                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                  <div className="flex items-center gap-1">
                    Category
                    <InfoTooltip text="Market category based on tags. Click row to see detailed strategy analysis." />
                  </div>
                </th>
                <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                  Positions
                </th>
                <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                  <div className="flex items-center justify-end gap-1">
                    Win Rate
                    <InfoTooltip text="Percentage of resolved positions that won." />
                  </div>
                </th>
                <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                  <div className="flex items-center justify-end gap-1">
                    Total P/L
                    <InfoTooltip text="Sum of profit/loss for all positions in this category." />
                  </div>
                </th>
                <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                  <div className="flex items-center justify-end gap-1">
                    Avg Drawdown
                    <InfoTooltip text="Average maximum price drop experienced." />
                  </div>
                </th>
                <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                  <div className="flex items-center justify-end gap-1">
                    Best Strategy
                    <InfoTooltip text="Strategy that would have produced the best improvement. Ties favor hedging." />
                  </div>
                </th>
                <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                  <div className="flex items-center justify-end gap-1">
                    Improvement
                    <InfoTooltip text="Expected P/L improvement if best strategy was used." />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {categories.map((cat) => {
                const isExpanded = expandedCategory === cat.name;
                return (
                  <React.Fragment key={cat.name}>
                    <tr
                      className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                      onClick={() => setExpandedCategory(isExpanded ? null : cat.name)}
                    >
                      <td className="p-2 align-middle text-center">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </td>
                      <td className="p-3 align-middle font-medium">{cat.name}</td>
                      <td className="p-3 align-middle text-right">
                        <span className="text-muted-foreground text-xs">
                          {cat.wonCount}W / {cat.lostCount}L / {cat.openCount}O
                        </span>
                        <span className="ml-2 font-medium">{cat.positions}</span>
                      </td>
                      <td className="p-3 align-middle text-right">
                        <span
                          className={cn(
                            "font-medium",
                            cat.winRate >= 50 ? "text-emerald-500" : "text-rose-500",
                          )}
                        >
                          {cat.winRate.toFixed(1)}%
                        </span>
                      </td>
                      <td
                        className={cn(
                          "p-3 align-middle text-right font-mono",
                          cat.totalPnL >= 0 ? "text-emerald-500" : "text-rose-500",
                        )}
                      >
                        {formatMoney(cat.totalPnL)}
                      </td>
                      <td className="p-3 align-middle text-right text-rose-500">
                        {cat.avgDrawdown.toFixed(1)}%
                      </td>
                      <td className="p-3 align-middle text-right">
                        <Badge variant="secondary" className={getBadgeColor(cat.bestStrategy.type)}>
                          {getStrategyLabel(cat.bestStrategy.type)}
                          {cat.bestStrategy.threshold !== null &&
                            ` @${cat.bestStrategy.threshold}%`}
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
    </div>
  );
}

function CategoryDetailCard({ category }: { category: CategoryAnalysis }) {
  const chartData = category.stopLossAnalysis.map((sl, idx) => ({
    threshold: `${sl.threshold}%`,
    stopLoss: sl.netImpact,
    hedgeFull: category.hedgingAnalysis[idx]?.fullLockNetImpact ?? 0,
    hedgeDouble: category.hedgingAnalysis[idx]?.doubleOppositeNetImpact ?? 0,
  }));

  return (
    <div className="rounded-md border bg-background p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold">{category.name} - Strategy Comparison</h4>
          <p className="text-xs text-muted-foreground">{category.bestStrategy.reason}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Avg P/L per position</p>
          <p
            className={cn(
              "font-mono font-bold",
              category.avgPnL >= 0 ? "text-emerald-500" : "text-rose-500",
            )}
          >
            {category.avgPnL >= 0 ? "+" : ""}${category.avgPnL.toFixed(2)}
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
          {(() => {
            const best = category.stopLossAnalysis.reduce(
              (max, sl) => (sl.netImpact > max.netImpact ? sl : max),
              category.stopLossAnalysis[0]!,
            );
            return (
              <>
                <p className="font-mono">{best.threshold}% threshold</p>
                <p className="text-muted-foreground">
                  {best.triggered} triggered, {best.recovered} recovered
                </p>
                <p
                  className={cn(
                    "font-bold",
                    best.netImpact > 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {best.netImpact > 0 ? "+" : ""}${best.netImpact.toFixed(2)} net impact
                </p>
              </>
            );
          })()}
        </div>
        <div className="bg-blue-500/10 rounded-md p-3">
          <p className="text-blue-500 font-medium mb-1">Best Hedge (Full Lock)</p>
          {(() => {
            const best = category.hedgingAnalysis.reduce(
              (max, h) => (h.fullLockNetImpact > max.fullLockNetImpact ? h : max),
              category.hedgingAnalysis[0]!,
            );
            return (
              <>
                <p className="font-mono">{best.threshold}% trigger</p>
                <p className="text-muted-foreground">{best.triggered} positions hedged</p>
                <p
                  className={cn(
                    "font-bold",
                    best.fullLockNetImpact > 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {best.fullLockNetImpact > 0 ? "+" : ""}${best.fullLockNetImpact.toFixed(2)} net
                  impact
                </p>
              </>
            );
          })()}
        </div>
        <div className="bg-purple-500/10 rounded-md p-3">
          <p className="text-purple-500 font-medium mb-1">Best Hedge (2x Opposite)</p>
          {(() => {
            const best = category.hedgingAnalysis.reduce(
              (max, h) => (h.doubleOppositeNetImpact > max.doubleOppositeNetImpact ? h : max),
              category.hedgingAnalysis[0]!,
            );
            return (
              <>
                <p className="font-mono">{best.threshold}% trigger</p>
                <p className="text-muted-foreground">{best.triggered} positions hedged</p>
                <p
                  className={cn(
                    "font-bold",
                    best.doubleOppositeNetImpact > 0 ? "text-emerald-500" : "text-rose-500",
                  )}
                >
                  {best.doubleOppositeNetImpact > 0 ? "+" : ""}$
                  {best.doubleOppositeNetImpact.toFixed(2)} net impact
                </p>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function PositionRow({ positionData }: { positionData: PositionAnalytics }) {
  const [expanded, setExpanded] = useState(false);
  const { position, priceHistory, oppositeOutcomePriceHistory, maxDrawdownPercent, category } =
    positionData;

  const pnl = position.profitLoss ?? 0;
  const isProfit = pnl >= 0;
  const outcomeStatus = category.outcome;
  const statusColor =
    outcomeStatus === "won"
      ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
      : outcomeStatus === "lost"
        ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
        : "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20";

  const chartData = useMemo(() => {
    if (!priceHistory || priceHistory.length === 0) return [];

    const oppositePoints = oppositeOutcomePriceHistory || [];

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

    return priceHistory.map((p) => {
      const ts = typeof p.timestamp === "number" ? p.timestamp * 1000 : p.timestamp;
      const oppPrice = findClosestOppositePrice(p.timestamp);
      return {
        time: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ourPrice: p.price * 100,
        oppositePrice: oppPrice !== null ? oppPrice * 100 : null,
        timestamp: ts,
      };
    });
  }, [priceHistory, oppositeOutcomePriceHistory]);

  const entryPriceCents = position.entryPrice * 100;
  const allPrices = chartData.flatMap((d) =>
    [d.ourPrice, d.oppositePrice].filter((p): p is number => p !== null),
  );
  const minPrice =
    allPrices.length > 0 ? Math.min(...allPrices, entryPriceCents) * 0.95 : entryPriceCents * 0.9;
  const maxPrice =
    allPrices.length > 0 ? Math.max(...allPrices, entryPriceCents) * 1.05 : entryPriceCents * 1.1;

  const chartColor =
    outcomeStatus === "won" ? "#10b981" : outcomeStatus === "lost" ? "#f43f5e" : "#3b82f6";

  return (
    <>
      <tr
        className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-4 align-middle w-[30px]">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </td>
        <td className="p-4 align-middle">
          <div className="flex flex-col">
            <span className="font-medium line-clamp-1" title={position.marketQuestion}>
              {position.marketQuestion}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                {position.outcome}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(position.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </td>
        <td className="p-4 align-middle text-right">{entryPriceCents.toFixed(1)}¢</td>
        <td className="p-4 align-middle text-right">
          {(positionData.currentOrFinalPrice * 100).toFixed(1)}¢
        </td>
        <td className="p-4 align-middle text-right font-mono">
          <span className={isProfit ? "text-emerald-500" : "text-rose-500"}>
            {isProfit ? "+" : ""}${pnl.toFixed(2)}
          </span>
        </td>
        <td className="p-4 align-middle">
          <Badge variant="secondary" className={cn("capitalize", statusColor)}>
            {outcomeStatus}
          </Badge>
        </td>
        <td className="p-4 align-middle text-right text-rose-500 font-medium">
          {maxDrawdownPercent > 0 ? `-${maxDrawdownPercent.toFixed(1)}%` : "0%"}
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
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(val: number | undefined, name?: string) => [
                        typeof val === "number" ? `${val.toFixed(1)}¢` : "N/A",
                        name === "ourPrice" ? "Our Outcome" : "Opposite Outcome",
                      ]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                      formatter={(value) =>
                        value === "ourPrice" ? "Our Outcome (Sell)" : "Opposite (Hedge Buy)"
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
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No price history available for this position
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 italic">
              Chart shows mid-market prices. Actual bid (sell) prices are typically lower, ask (buy)
              prices higher.
            </p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
              <div className="bg-background p-3 rounded-md border shadow-sm">
                <div className="flex items-center gap-1 mb-1">
                  <span className="font-semibold text-foreground">Entry Details</span>
                  <InfoTooltip text="Cost is the total amount invested. Token ID is the unique identifier for this outcome on Polymarket." />
                </div>
                <div className="flex justify-between">
                  <span>Cost:</span>
                  <span className="font-mono text-foreground">${position.cost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Token ID:</span>
                  <span
                    className="font-mono text-foreground truncate max-w-[120px]"
                    title={position.tokenId}
                  >
                    {position.tokenId.slice(0, 8)}...
                  </span>
                </div>
              </div>
              <div className="bg-background p-3 rounded-md border shadow-sm">
                <div className="flex items-center gap-1 mb-1">
                  <span className="font-semibold text-foreground">Performance</span>
                  <InfoTooltip text="Lowest and highest mid-market prices observed after entry. Note: These are mid-prices, not bid/ask. Actual execution prices may differ due to spread." />
                </div>
                <div className="flex justify-between">
                  <span>Lowest Price:</span>
                  <span className="font-mono text-foreground">
                    {(positionData.lowestPriceAfterEntry * 100).toFixed(1)}¢
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Highest Price:</span>
                  <span className="font-mono text-foreground">
                    {(positionData.highestPriceAfterEntry * 100).toFixed(1)}¢
                  </span>
                </div>
              </div>
              <div className="bg-background p-3 rounded-md border shadow-sm">
                <div className="flex items-center gap-1 mb-1">
                  <span className="font-semibold text-foreground">Time Analysis</span>
                  <InfoTooltip text="Duration is the time from entry to resolution. Hedge Cost shows what it would have cost to buy opposite outcome shares at the lowest point (using mid-price, actual cost may be higher)." />
                </div>
                <div className="flex justify-between">
                  <span>Duration:</span>
                  <span className="text-foreground">
                    {position.resolvedAt
                      ? (
                          (new Date(position.resolvedAt).getTime() -
                            new Date(position.createdAt).getTime()) /
                          (1000 * 60 * 60)
                        ).toFixed(1) + "h"
                      : "Active"}
                  </span>
                </div>
                {positionData.oppositeOutcome && (
                  <div className="flex justify-between">
                    <span>Hedge Cost:</span>
                    <span className="font-mono text-foreground">
                      ${positionData.oppositeOutcome.hedgeCost.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PositionAnalyticsPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [allPositions, setAllPositions] = useState<PositionAnalytics[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const [stopLossFilter, setStopLossFilter] = useState<ResolvedFilter>("all");
  const [hedgingFilter, setHedgingFilter] = useState<ResolvedFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<ResolvedFilter>("all");
  const [positionsFilter, setPositionsFilter] = useState<StatusFilter>("all");

  const [fidelity, setFidelity] = useState<1 | 5 | 15>(5);
  const [selectedWallet, setSelectedWallet] = useState(DEFAULT_WALLET);

  const resolvedPositions = useMemo(
    () => allPositions.filter((p) => p.category.outcome !== "open"),
    [allPositions],
  );

  const filterResolved = useCallback(
    (filter: ResolvedFilter): PositionAnalytics[] => {
      if (filter === "all") return resolvedPositions;
      return resolvedPositions.filter((p) => p.category.outcome === filter);
    },
    [resolvedPositions],
  );

  const positionsForTable = useMemo(() => {
    if (positionsFilter === "all") return allPositions;
    return allPositions.filter((p) => p.category.outcome === positionsFilter);
  }, [allPositions, positionsFilter]);

  const stopLossPositions = useMemo(
    () => filterResolved(stopLossFilter),
    [filterResolved, stopLossFilter],
  );

  const hedgingPositions = useMemo(
    () => filterResolved(hedgingFilter),
    [filterResolved, hedgingFilter],
  );

  const categoryPositions = useMemo(
    () => filterResolved(categoryFilter),
    [filterResolved, categoryFilter],
  );

  const computeStopLossImpact = useCallback(
    (positions: PositionAnalytics[]): AnalyticsSummary["stopLossImpact"] => {
      if (!summary) return [];
      const thresholds = summary.stopLossImpact.map((s) => s.threshold);
      return thresholds.map((threshold) => {
        let triggered = 0;
        let recovered = 0;
        let netImpact = 0;
        for (const pos of positions) {
          const sim = pos.stopLossSimulations.find((s) => s.threshold === threshold);
          if (sim?.triggered) {
            triggered++;
            if (sim.recoveredAfterTrigger) recovered++;
            netImpact += (sim.profitLossIfSold ?? 0) - (sim.profitLossIfHeld ?? 0);
          }
        }
        return {
          threshold,
          wouldHaveTriggered: triggered,
          wouldHaveRecovered: recovered,
          netImpactIfUsed: netImpact,
        };
      });
    },
    [summary],
  );

  const stopLossSummary = useMemo(
    () => computeStopLossImpact(stopLossPositions),
    [computeStopLossImpact, stopLossPositions],
  );

  const hedgingSummary = useMemo(() => computeHedgingSummary(hedgingPositions), [hedgingPositions]);

  const displaySummary = summary;

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        if (isRefresh) setRefreshing(true);
        else setInitialLoading(true);

        const [res, syncTime] = await Promise.all([
          getPositionAnalyticsHybrid(
            selectedWallet,
            {
              fidelityMinutes: fidelity,
              status: "all",
              limit: 1000,
            },
            abortControllerRef.current.signal,
          ),
          fetchLastSyncTime(selectedWallet, abortControllerRef.current.signal),
        ]);

        setAllPositions(res.positions);
        setSummary(res.summary);
        setLastSyncTime(syncTime);
        setError(null);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [fidelity, selectedWallet],
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

  const handleFidelityChange = (val: string) => {
    setFidelity(Number(val) as 1 | 5 | 15);
  };

  const categoryData = useMemo(() => {
    if (categoryPositions.length === 0) return [];
    const thresholds = summary?.stopLossImpact.map((s) => s.threshold) || [
      5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90,
    ];
    return calculateCategoryAnalysis(categoryPositions, thresholds);
  }, [categoryPositions, summary]);

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
                {allPositions.length} positions
                {lastSyncTime && (
                  <span className="ml-2 text-xs">
                    · Last synced {formatRelativeTime(lastSyncTime)}
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

              <Select value={fidelity.toString()} onValueChange={handleFidelityChange}>
                <SelectTrigger className="w-[120px] cursor-pointer">
                  <SelectValue placeholder="Fidelity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1" className="cursor-pointer">
                    1 Minute
                  </SelectItem>
                  <SelectItem value="5" className="cursor-pointer">
                    5 Minutes
                  </SelectItem>
                  <SelectItem value="15" className="cursor-pointer">
                    15 Minutes
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing || initialLoading}
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

          {initialLoading ? (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-32 w-full rounded-xl" />
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <Skeleton className="h-[400px] rounded-xl" />
                <Skeleton className="lg:col-span-2 h-[400px] rounded-xl" />
              </div>
            </div>
          ) : displaySummary ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  title="Total Positions"
                  value={displaySummary.totalPositions}
                  subtext={`${displaySummary.wonCount} won · ${displaySummary.lostCount} lost · ${displaySummary.openCount} open`}
                  icon={Activity}
                  colorClass="text-blue-500"
                  info="Total number of live (non-simulated) positions analyzed. Positions are categorized as won (profit ≥ 0), lost (profit < 0), or open (not yet resolved)."
                />
                <SummaryCard
                  title="Win Rate"
                  value={
                    displaySummary.wonCount + displaySummary.lostCount > 0
                      ? `${((displaySummary.wonCount / (displaySummary.wonCount + displaySummary.lostCount)) * 100).toFixed(1)}%`
                      : "N/A"
                  }
                  subtext="Based on resolved positions"
                  icon={Percent}
                  trend={displaySummary.wonCount > displaySummary.lostCount ? "up" : "neutral"}
                  trendValue={
                    displaySummary.wonCount > displaySummary.lostCount ? "Profitable" : ""
                  }
                  colorClass="text-purple-500"
                  info="Percentage of resolved positions that ended with profit. Calculated as: won / (won + lost). Open positions are excluded from this calculation."
                />
                <SummaryCard
                  title="Avg Max Drawdown"
                  value={`${displaySummary.avgMaxDrawdownPercent.toFixed(1)}%`}
                  subtext={`${displaySummary.positionsWithDrawdownOver10Percent} positions > 10% DD`}
                  icon={TrendingDown}
                  colorClass="text-rose-500"
                  info="Average of the maximum price drop experienced by each position after entry. Drawdown = (entry price - lowest price) / entry price × 100. Higher values indicate more volatile positions."
                />
                <SummaryCard
                  title="Total PnL"
                  value={`${displaySummary.byOutcome.reduce((acc, curr) => acc + curr.totalPnL, 0) >= 0 ? "+" : ""}$${displaySummary.byOutcome.reduce((acc, curr) => acc + curr.totalPnL, 0).toFixed(2)}`}
                  subtext="Realized Profit/Loss"
                  icon={DollarSign}
                  trend={
                    displaySummary.byOutcome.reduce((acc, curr) => acc + curr.totalPnL, 0) >= 0
                      ? "up"
                      : "down"
                  }
                  trendValue="Net Result"
                  colorClass="text-emerald-500"
                  info="Sum of all realized profits and losses from resolved positions. Does not include unrealized P/L from open positions."
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />
                          Stop Loss Simulation
                          <InfoTooltip text="Simulates what would have happened if you had set stop-loss orders at different thresholds. 'Recovered' means holding was more profitable than selling at stop-loss." />
                        </CardTitle>
                        <CardDescription>
                          Impact of stop-loss thresholds on past trades
                        </CardDescription>
                      </div>
                      <SectionFilter
                        value={stopLossFilter}
                        onChange={(v) => setStopLossFilter(v)}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <StopLossTable simulations={stopLossSummary} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Shield className="h-5 w-5 text-primary" />
                          Hedging Simulation
                          <InfoTooltip text="Simulates hedging by buying opposite outcome shares when price dropped. Click rows to see strategy details." />
                        </CardTitle>
                        <CardDescription>
                          Compare hedging strategies at different trigger points
                        </CardDescription>
                      </div>
                      <SectionFilter value={hedgingFilter} onChange={(v) => setHedgingFilter(v)} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <HedgingSimulationTable rows={hedgingSummary} />
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <Card className="lg:col-span-1">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-primary" />
                      Outcome Analysis
                      <InfoTooltip text="Breakdown by outcome. Won = profit ≥ 0, Lost = profit < 0, Open = pending." />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(displaySummary?.byOutcome || []).map((outcome) => (
                      <div key={outcome.outcome} className="space-y-2">
                        <div className="flex justify-between text-sm font-medium">
                          <span className="capitalize">{outcome.outcome}</span>
                          <span
                            className={outcome.totalPnL >= 0 ? "text-emerald-500" : "text-rose-500"}
                          >
                            {outcome.totalPnL >= 0 ? "+" : ""}${outcome.totalPnL.toFixed(2)}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all",
                              outcome.outcome === "won"
                                ? "bg-emerald-500"
                                : outcome.outcome === "lost"
                                  ? "bg-rose-500"
                                  : "bg-blue-500",
                            )}
                            style={{
                              width: `${Math.max(5, (outcome.count / (displaySummary?.totalPositions || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{outcome.count} positions</span>
                          <span>Avg DD: {outcome.avgDrawdown.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="lg:col-span-3">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">Positions</CardTitle>
                        <CardDescription>
                          {positionsForTable.length} positions
                          {positionsFilter !== "all" && ` (${positionsFilter})`}
                        </CardDescription>
                      </div>
                      <SectionFilter
                        value={positionsFilter}
                        onChange={(v) => setPositionsFilter(v as StatusFilter)}
                        includeOpen
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
                                <div className="flex items-center justify-end gap-1">
                                  Entry
                                  <InfoTooltip text="Price you paid to enter this position." />
                                </div>
                              </th>
                              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                                <div className="flex items-center justify-end gap-1">
                                  Last
                                  <InfoTooltip text="Most recent mid-market price." />
                                </div>
                              </th>
                              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                                <div className="flex items-center justify-end gap-1">
                                  P/L
                                  <InfoTooltip text="Realized profit or loss." />
                                </div>
                              </th>
                              <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  Status
                                  <InfoTooltip text="Won = profit ≥ 0. Lost = loss. Open = pending." />
                                </div>
                              </th>
                              <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                                <div className="flex items-center justify-end gap-1">
                                  Max DD
                                  <InfoTooltip text="Maximum drawdown percentage." />
                                </div>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="[&_tr:last-child]:border-0">
                            {positionsForTable.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="p-4 align-middle text-center h-24 text-muted-foreground"
                                >
                                  No positions found matching filter.
                                </td>
                              </tr>
                            ) : (
                              positionsForTable.map((pos) => (
                                <PositionRow key={pos.position.id} positionData={pos} />
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Tag className="h-5 w-5 text-primary" />
                        Category Analysis
                        <InfoTooltip text="Strategy performance breakdown by market category. Shows which strategies work best for different types of markets." />
                      </CardTitle>
                      <CardDescription>
                        Compare stop-loss and hedging effectiveness across different market
                        categories
                      </CardDescription>
                    </div>
                    <SectionFilter value={categoryFilter} onChange={(v) => setCategoryFilter(v)} />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <CategoryAnalysisSection categories={categoryData} />
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
                  Could not fetch position analytics. Please check your connection or try again
                  later.
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
