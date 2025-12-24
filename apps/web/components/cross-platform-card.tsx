"use client";

import { CrossPlatformOpportunity } from "@/lib/types";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { ExternalLink, Clock, TrendingUp, DollarSign, BarChart3 } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

type Props = {
  opportunity: CrossPlatformOpportunity;
};

function formatNumber(num: number | undefined | null): string {
  if (num == null) return "-";
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
  return `$${num.toFixed(0)}`;
}

function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return "Ended";

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  // For dates more than 7 days away, show "Jan 15, 2025" format
  if (diffDays > 7) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  // For dates within a week, show "5d 12h" format
  if (diffDays > 0) return `${diffDays}d ${diffHours}h`;
  // For same day, show hours
  if (diffHours > 0) return `${diffHours}h`;
  // Less than an hour
  const diffMins = Math.floor(diffMs / (1000 * 60));
  return `${diffMins}m`;
}

export function CrossPlatformCard({ opportunity }: Props) {
  const hasArbitrage = opportunity.arbitrage.type !== "none";
  const profitPct = opportunity.arbitrage.profitPct;

  const polyEndDate = opportunity.polymarket.endsAt;
  const kalshiEndDate = opportunity.kalshi.closeTime;
  const earliestEndDate =
    polyEndDate && kalshiEndDate
      ? new Date(polyEndDate) < new Date(kalshiEndDate)
        ? polyEndDate
        : kalshiEndDate
      : polyEndDate || kalshiEndDate;
  const timeUntil = formatDate(earliestEndDate);

  return (
    <Card
      className={cn(
        "overflow-hidden transition-shadow hover:shadow-md",
        hasArbitrage && "border-profit/50 bg-gradient-to-r from-profit/5 to-transparent",
      )}
    >
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            {hasArbitrage ? (
              <Badge className="bg-profit text-profit-foreground">
                <TrendingUp className="mr-1 h-3 w-3" />+{profitPct.toFixed(2)}% Profit
              </Badge>
            ) : (
              <Badge variant="secondary">Matched Markets</Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {opportunity.matchType} ({(opportunity.matchConfidence * 100).toFixed(0)}%)
            </Badge>
            {timeUntil && (
              <Badge variant="outline" className="text-warning border-warning/50">
                <Clock className="mr-1 h-3 w-3" />
                {timeUntil}
              </Badge>
            )}
          </div>
        </div>

        {/* Markets Comparison - Compact */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {/* Polymarket */}
          <div className="rounded-lg border border-polymarket/20 bg-polymarket/5 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-polymarket" />
                <span className="text-sm font-medium text-polymarket">Polymarket</span>
              </div>
              {opportunity.polymarket.endsAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(opportunity.polymarket.endsAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground line-clamp-2 mb-3">
              {opportunity.polymarket.question}
            </p>
            {/* Prices */}
            <div className="flex items-center gap-4 text-xs mb-2">
              <span>
                YES:{" "}
                <span className="font-semibold text-profit">
                  {(opportunity.polymarket.yesBestAsk * 100).toFixed(1)}¢
                </span>
              </span>
              <span>
                NO:{" "}
                <span className="font-semibold text-destructive">
                  {(opportunity.polymarket.noBestAsk * 100).toFixed(1)}¢
                </span>
              </span>
            </div>
            {/* Volume & Liquidity */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                Vol: {formatNumber(opportunity.polymarket.volume)}
              </span>
              <Separator orientation="vertical" className="h-3" />
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Liq: {formatNumber(opportunity.polymarket.liquidity)}
              </span>
            </div>
          </div>

          {/* Kalshi */}
          <div className="rounded-lg border border-kalshi/20 bg-kalshi/5 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-kalshi" />
                <span className="text-sm font-medium text-kalshi">Kalshi</span>
              </div>
              {opportunity.kalshi.closeTime && (
                <span className="text-xs text-muted-foreground">
                  {new Date(opportunity.kalshi.closeTime).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground line-clamp-2 mb-3">{opportunity.kalshi.title}</p>
            {/* Prices */}
            <div className="flex items-center gap-4 text-xs mb-2">
              <span>
                YES:{" "}
                <span className="font-semibold text-profit">
                  {(opportunity.kalshi.yesAsk * 100).toFixed(1)}¢
                </span>
              </span>
              <span>
                NO:{" "}
                <span className="font-semibold text-destructive">
                  {(opportunity.kalshi.noAsk * 100).toFixed(1)}¢
                </span>
              </span>
            </div>
            {/* Volume & Liquidity */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                Vol: {formatNumber(opportunity.kalshi.volume)}
              </span>
              <Separator orientation="vertical" className="h-3" />
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Liq: {formatNumber(opportunity.kalshi.liquidity)}
              </span>
            </div>
          </div>
        </div>

        {/* Arbitrage Strategy - Only show if arbitrage exists */}
        {hasArbitrage && (
          <div className="rounded-lg bg-profit/10 border border-profit/20 p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-profit">💡 Strategy</span>
              <span className="text-sm font-bold text-profit">
                {(opportunity.arbitrage.profit * 100).toFixed(1)}¢ profit
              </span>
            </div>
            <p className="text-sm text-profit/80">{opportunity.arbitrage.instruction}</p>
            <p className="mt-1 text-xs text-profit/60">
              Cost: {(opportunity.arbitrage.totalCost * 100).toFixed(1)}¢ → Payout: 100¢
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button asChild size="sm" className="bg-polymarket hover:bg-polymarket/90">
            <a href={opportunity.polymarket.url} target="_blank" rel="noreferrer">
              Polymarket
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
          <Button asChild size="sm" className="bg-kalshi hover:bg-kalshi/90">
            <a href={opportunity.kalshi.url} target="_blank" rel="noreferrer">
              Kalshi
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
