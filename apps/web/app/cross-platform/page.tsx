"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Header } from "@/components/ui/header";
import { CrossPlatformCard } from "@/components/cross-platform-card";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchCrossPlatform } from "@/lib/api";
import { CrossPlatformOpportunity } from "@/lib/types";
import { Repeat2, ArrowUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Badge } from "@workspace/ui/components/badge";
import Link from "next/link";

export default function CrossPlatformPage() {
  const [opportunities, setOpportunities] = useState<CrossPlatformOpportunity[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"profit" | "endDate">("profit");
  const isFetching = useRef(false);

  const loadData = useCallback(
    async (isRefresh = false) => {
      if (isFetching.current) return;
      isFetching.current = true;

      try {
        if (!isRefresh) setLoading(true);
        const res = await fetchCrossPlatform(0, undefined, sort);
        setOpportunities(res.opportunities ?? []);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        isFetching.current = false;
        if (!isRefresh) setLoading(false);
      }
    },
    [sort],
  );

  useEffect(() => {
    void loadData(false);
    const interval = setInterval(() => void loadData(true), 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Sort: arbitrage opportunities first, then by selected criteria
  const sortedOpportunities = [...opportunities].sort((a, b) => {
    const aHasArb = a.arbitrage.type !== "none" ? 1 : 0;
    const bHasArb = b.arbitrage.type !== "none" ? 1 : 0;
    if (aHasArb !== bHasArb) return bHasArb - aHasArb;

    if (sort === "endDate") {
      const aEnd = a.polymarket.endsAt ? new Date(a.polymarket.endsAt).getTime() : Infinity;
      const bEnd = b.polymarket.endsAt ? new Date(b.polymarket.endsAt).getTime() : Infinity;
      return aEnd - bEnd;
    }
    return b.arbitrage.profitPct - a.arbitrage.profitPct;
  });

  const arbCount = opportunities.filter((o) => o.arbitrage.type !== "none").length;

  return (
    <>
      <Header activeOpportunities={arbCount} />

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          {/* Page Header */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Cross-Platform Arbitrage</h1>
              <p className="text-muted-foreground">
                Find price differences between Polymarket and Kalshi
              </p>
            </div>

            <div className="flex items-center gap-3">
              {arbCount > 0 && (
                <Badge variant="default" className="bg-profit text-profit-foreground">
                  {arbCount} arbitrage {arbCount === 1 ? "opportunity" : "opportunities"}
                </Badge>
              )}

              <Select value={sort} onValueChange={(v) => setSort(v as "profit" | "endDate")}>
                <SelectTrigger className="w-[180px]">
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profit">Highest Profit</SelectItem>
                  <SelectItem value="endDate">Ending Soon</SelectItem>
                </SelectContent>
              </Select>

              <Link
                href="/cross-platform/history"
                className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                📊 History
              </Link>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 w-full rounded-lg bg-muted/20 animate-pulse" />
              <div className="h-24 w-full rounded-lg bg-muted/20 animate-pulse" />
              <div className="h-24 w-full rounded-lg bg-muted/20 animate-pulse" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
              {error}
            </div>
          ) : opportunities.length === 0 ? (
            <EmptyState
              icon={Repeat2}
              title="No cross-platform matches found"
              description="Looking for matching markets between Polymarket and Kalshi. Check back soon."
              variant="polymarket"
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {opportunities.length} matched markets
                {arbCount > 0 && (
                  <span className="ml-2 text-profit font-medium">• {arbCount} with arbitrage</span>
                )}
              </p>
              {sortedOpportunities.map((opportunity) => (
                <CrossPlatformCard key={opportunity.id} opportunity={opportunity} />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
