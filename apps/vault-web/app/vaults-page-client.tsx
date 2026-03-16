"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ArrowUpRight } from "lucide-react";
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
    low: "border-emerald-400/25 bg-emerald-400/12 text-emerald-200",
    medium: "border-amber-400/25 bg-amber-400/12 text-amber-200",
    high: "border-rose-400/25 bg-rose-400/12 text-rose-200",
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
      <Badge className="border border-emerald-400/25 bg-emerald-400/12 text-emerald-200">
        Active
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="border border-white/10 bg-white/6 text-slate-300">
      Disabled
    </Badge>
  );
}

function FeeDisplay({ fees }: { fees: VaultInstance["profile"]["fees"] }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <div className="flex flex-col">
        <span className="text-xs text-slate-400">Management</span>
        <span className="font-medium text-slate-100">{formatFee(fees.management)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-slate-400">Performance</span>
        <span className="font-medium text-slate-100">{formatFee(fees.performance)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-slate-400">Exit</span>
        <span className="font-medium text-slate-100">{formatFee(fees.withdrawal)}</span>
      </div>
    </div>
  );
}

function VaultCard({ vault }: { vault: VaultInstance }) {
  const { data, isLoading } = useVaultStatus(vault.id);

  const tvl = data?.nav?.totalAssets ?? 0;
  const mode = data?.mode ?? "simulation";
  const sharePrice = data?.nav?.sharePrice ?? 1;
  const deployedRatio = data?.deployedRatio ?? 0;

  return (
    <Link href={`/vault/${vault.id}`} className="group block h-full">
      <Card className="relative h-full overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] shadow-[0_30px_90px_-40px_rgba(8,15,36,0.95)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/25 hover:bg-white/[0.06]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_28%),radial-gradient(circle_at_88%_18%,_rgba(244,114,182,0.12),_transparent_18%)] opacity-80" />
        <CardHeader className="relative space-y-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Badge className="w-fit border border-white/10 bg-white/8 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                {vault.type === "custom" ? "Cycle vault" : vault.type}
              </Badge>
              <CardTitle className="text-2xl font-semibold tracking-tight text-white">
                {vault.name}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className="border border-cyan-300/15 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15"
                >
                  {vault.profile.strategyLabel}
                </Badge>
                <RiskBadge level={vault.profile.riskLevel} />
              </div>
            </div>
            <StatusBadge enabled={vault.enabled} />
          </div>
          <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Vault size</p>
              {isLoading ? (
                <Skeleton className="mt-2 h-10 w-40 bg-white/10" />
              ) : (
                <p className="mt-2 text-4xl font-semibold tracking-tight text-white">
                  {formatTVL(tvl)}
                </p>
              )}
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">
                {vault.profile.description}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Live snapshot</p>
              <div className="mt-3 grid gap-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Share price</span>
                  <span className="font-mono text-slate-100">${sharePrice.toFixed(4)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Capital deployed</span>
                  <span className="font-mono text-slate-100">
                    {(deployedRatio * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Mode</span>
                  <span className="font-medium text-slate-100">
                    {mode === "live" ? "Live trading" : "Simulation"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative space-y-5">
          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Fees
            </span>
            <FeeDisplay fees={vault.profile.fees} />
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-4">
            <span className="text-sm text-slate-300">Open the vault workspace</span>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 transition-transform duration-300 group-hover:translate-x-1">
              View vault
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function VaultsPageClient() {
  const { data, isLoading, error } = useVaultInstances();
  const instances = data?.instances ?? [];

  return (
    <main className="vault-pane-scroll flex-1 min-h-0 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12">
      <div className="mx-auto max-w-6xl space-y-10">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.045] px-6 py-8 shadow-[0_40px_100px_-50px_rgba(8,15,36,0.95)] backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_34%),radial-gradient(circle_at_85%_15%,_rgba(244,114,182,0.14),_transparent_18%)]" />
          <div className="relative space-y-3 animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Vault dashboard
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Follow each vault, check current size and share price, and open the detailed workspace
              when you want to review cycle status, deposits, or exits.
            </p>
            <div className="pt-2 text-sm text-slate-400">
              {instances.length} vault{instances.length === 1 ? "" : "s"} available
            </div>
          </div>
        </section>

        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-white">Available vaults</h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              Each vault card shows live size, share price, and how much capital is currently
              deployed.
            </p>
          </div>
        </div>

        {error && (
          <Card className="border-rose-400/25 bg-rose-400/10 text-rose-100">
            <CardContent className="py-4 text-sm">{error}</CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-[420px] w-full rounded-[28px] bg-white/10" />
            <Skeleton className="h-[420px] w-full rounded-[28px] bg-white/10" />
          </div>
        ) : instances.length === 0 ? (
          <Card className="border-white/10 bg-white/[0.04] backdrop-blur-xl">
            <CardContent className="py-10 text-center text-sm text-slate-300">
              No vaults are available right now.
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
