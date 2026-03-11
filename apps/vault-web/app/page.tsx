"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useVaultInstances, useVaultStatus } from "../src/lib/hooks";
import type { VaultInstance, VaultRiskLevel } from "../src/types";

function formatFee(bps: number): string {
  if (bps === 0) return "Free";
  return `${(bps / 100).toFixed(1)}%`;
}

function formatTVL(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function RiskBadge({ level }: { level: VaultRiskLevel }) {
  const colors = {
    low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    high: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  };

  return (
    <Badge variant="outline" className={`border ${colors[level]}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)} Risk
    </Badge>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Active</Badge>
    );
  }

  return (
    <Badge variant="secondary" className="bg-slate-100 text-slate-500">
      Disabled
    </Badge>
  );
}

function FeeDisplay({ fees }: { fees: VaultInstance["profile"]["fees"] }) {
  return (
    <div className="flex gap-4 text-sm">
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">Management</span>
        <span className="font-medium">{formatFee(fees.management)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">Performance</span>
        <span className="font-medium">{formatFee(fees.performance)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">Withdrawal</span>
        <span className="font-medium">{formatFee(fees.withdrawal)}</span>
      </div>
    </div>
  );
}

function VaultCard({ vault }: { vault: VaultInstance }) {
  const { data, isLoading } = useVaultStatus(vault.id);

  const tvl = data?.nav?.totalAssets ?? 0;
  const mode = data?.mode ?? "simulation";

  return (
    <Link href={`/vault/${vault.id}`} className="block">
      <Card className="h-full cursor-pointer border-border/50 bg-white transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-xl font-bold tracking-tight">{vault.name}</CardTitle>
              <div className="flex items-center gap-2 pt-1">
                <Badge
                  variant="secondary"
                  className="bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  {vault.profile.strategyLabel}
                </Badge>
                <RiskBadge level={vault.profile.riskLevel} />
              </div>
            </div>
            <StatusBadge enabled={vault.enabled} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{vault.profile.description}</p>

          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Value Locked</span>
              {isLoading ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <span className="font-semibold">{formatTVL(tvl)}</span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Fees
            </span>
            <FeeDisplay fees={vault.profile.fees} />
          </div>

          <div className="flex items-center justify-between pt-2">
            <Badge
              variant="outline"
              className={`text-xs ${
                mode === "live"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600"
              }`}
            >
              {mode === "live" ? "Live Trading" : "Simulation Mode"}
            </Badge>
            <span className="text-sm font-medium text-primary">View Details</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function VaultsPage() {
  const { data, isLoading, error } = useVaultInstances();
  const instances = data?.instances ?? [];

  return (
    <main className="flex-1 p-6 md:p-8 lg:p-10">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Vaults</h1>
          <p className="text-muted-foreground">Vaults are loaded from backend configuration</p>
        </div>

        {error && (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="py-4 text-sm text-rose-700">{error}</CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : instances.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No vault instances returned by backend
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {instances.map((vault: VaultInstance) => (
              <VaultCard key={vault.id} vault={vault} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
