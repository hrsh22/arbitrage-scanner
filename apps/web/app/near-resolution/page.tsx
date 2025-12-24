"use client";

import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/ui/header";
import { NearResolutionCard } from "@/components/near-resolution-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton-card";
import { fetchNearResolution } from "@/lib/api";
import { NearResolutionOpportunity, NearResolutionFilter } from "@/lib/types";
import { Clock, RefreshCw } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";

const defaultFilter: NearResolutionFilter = {
  maxHours: 24,
  minOdds: 95,
  sort: "time",
};

const timePresets = [
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
  { label: "7d", hours: 168 },
];

export default function NearResolutionPage() {
  const [opportunities, setOpportunities] = useState<NearResolutionOpportunity[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NearResolutionFilter>(defaultFilter);

  const loadData = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) setLoading(true);
        else setRefreshing(true);

        const res = await fetchNearResolution(filter);
        setOpportunities(res.opportunities ?? []);
        setLastUpdated(res.lastUpdated ?? null);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter],
  );

  // Initial load
  useEffect(() => {
    void loadData(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh on filter change (without showing full loading state)
  useEffect(() => {
    if (!loading) {
      void loadData(false);
    }
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    void loadData(false);
  };

  return (
    <>
      <Header activeOpportunities={opportunities.length} />

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Near Resolution</h1>
            <p className="text-muted-foreground">
              High-confidence markets closing soon with favorable odds
            </p>
          </div>

          {/* Filters */}
          <div className="mb-6 rounded-xl border bg-card p-4 space-y-4">
            {/* Time Window Presets */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Time Window</label>
              <div className="flex flex-wrap gap-2">
                {timePresets.map(({ label, hours }) => (
                  <Button
                    key={hours}
                    variant={filter.maxHours === hours ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter({ ...filter, maxHours: hours })}
                    className={cn(filter.maxHours === hours && "bg-kalshi hover:bg-kalshi/90")}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Min Odds Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Minimum Odds</label>
                <Badge variant="secondary" className="text-kalshi">
                  {filter.minOdds}¢
                </Badge>
              </div>
              <Slider
                value={[filter.minOdds]}
                onValueChange={(values) =>
                  setFilter({ ...filter, minOdds: values[0] ?? filter.minOdds })
                }
                min={80}
                max={99}
                step={1}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>80¢</span>
                <span>99¢</span>
              </div>
            </div>

            {/* Sort & Refresh */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Sort by:</span>
                <div className="flex gap-2">
                  <Button
                    variant={filter.sort === "time" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter({ ...filter, sort: "time" })}
                    className={cn(filter.sort === "time" && "bg-kalshi hover:bg-kalshi/90")}
                  >
                    ⏰ Time Left
                  </Button>
                  <Button
                    variant={filter.sort === "odds" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter({ ...filter, sort: "odds" })}
                    className={cn(filter.sort === "odds" && "bg-kalshi hover:bg-kalshi/90")}
                  >
                    📈 Highest Odds
                  </Button>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
                {refreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
              {error}
            </div>
          ) : opportunities.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No near-resolution opportunities found"
              description="Try increasing the time window or lowering the minimum odds to find more markets."
              variant="kalshi"
              action={{
                label: "Reset Filters",
                onClick: () => setFilter(defaultFilter),
              }}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {opportunities.length} high-confidence market{opportunities.length !== 1 ? "s" : ""}{" "}
                closing soon
              </p>
              {opportunities.map((opportunity) => (
                <NearResolutionCard key={opportunity.key} opportunity={opportunity} />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
