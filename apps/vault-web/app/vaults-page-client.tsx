"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ArrowUpRight } from "lucide-react";
import {
  useCycleStatus,
  useVaultInstances,
  useVaultNavHistory,
  useVaultPositions,
  useVaultStatus,
} from "../src/lib/hooks";
import { deriveVaultPerformanceStats } from "../src/lib/performance";
import type { VaultInstance, VaultRiskLevel } from "../src/types";

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function getDepositStatusLabel(
  enabled: boolean,
  executionMode?: string | null,
  telemetryFresh?: boolean | null,
): string {
  if (!enabled) {
    return "Deposits Paused";
  }
  if (!executionMode || telemetryFresh !== true) {
    return "Status Unavailable";
  }
  if (executionMode === "blocked") {
    return "Deposits Paused";
  }
  return "Deposits Open";
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

function VaultCard({ vault }: { vault: VaultInstance }) {
  const router = useRouter();
  const { data, isLoading } = useVaultStatus(vault.id);
  const { executionMode, telemetryFresh } = useCycleStatus(vault.id);
  const navHistory = useVaultNavHistory(undefined, vault.id);
  const positions = useVaultPositions(vault.id);

  const tvl = data?.nav?.totalAssets ?? 0;
  const deployedCostBasis = positions.data?.positions.reduce(
    (sum, position) => sum + position.costBasis,
    0,
  );

  const performance = deriveVaultPerformanceStats(navHistory.data?.snapshots ?? []);

  const showAweCredit = /sisyphus/i.test(vault.name);
  const vaultHref = `/vault/${vault.id}`;

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(vaultHref)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(vaultHref);
        }
      }}
      className="group block h-full cursor-pointer focus:outline-none"
    >
      <Card className="relative h-full overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] shadow-[0_30px_90px_-40px_rgba(8,15,36,0.95)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-cyan-300/25 hover:bg-white/[0.06] focus-within:border-cyan-300/25">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_28%),radial-gradient(circle_at_88%_18%,_rgba(244,114,182,0.12),_transparent_18%)] opacity-80" />
        <CardHeader className="relative space-y-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="w-fit border border-white/10 bg-white/8 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                  {vault.type === "custom" ? "Cycle Vault" : vault.type}
                </Badge>
                <Badge
                  variant="secondary"
                  className="border border-white/10 bg-white/6 text-slate-300"
                >
                  {getDepositStatusLabel(vault.enabled, executionMode, telemetryFresh)}
                </Badge>
              </div>

              <div className="space-y-1">
                <CardTitle className="text-2xl font-semibold tracking-tight text-white">
                  {vault.name}
                </CardTitle>

                {showAweCredit ? (
                  <p className="text-[13px] text-slate-400 mt-0.5">
                    by{" "}
                    <a
                      href="https://x.com/awenetwork_ai"
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 transition-colors hover:text-white"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      @AWEnetwork_ai
                    </a>
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge
                  variant="secondary"
                  className="border border-cyan-300/15 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/15"
                >
                  {vault.profile.strategyLabel}
                </Badge>
                <Badge
                  variant="secondary"
                  className="border border-white/10 bg-white/6 text-slate-200"
                >
                  Agent-managed
                </Badge>
                <RiskBadge level={vault.profile.riskLevel} />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative space-y-5">
          <div className="grid grid-cols-3 gap-3 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">APY</span>
              <span className="text-lg font-semibold text-white">--</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">TVL</span>
              <span className="text-lg font-semibold text-white">
                {isLoading ? "--" : formatCompactCurrency(tvl)}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Capital deployed
              </span>
              <span className="text-lg font-semibold text-white">
                {positions.isLoading || deployedCostBasis === undefined
                  ? "--"
                  : formatCompactCurrency(deployedCostBasis)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-white/10 pt-4">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 transition-transform duration-300 group-hover:translate-x-1">
              Open vault
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
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
              Follow each vault, check current size and capital deployment, and open the detailed
              workspace when you want to review cycle status, deposits, or exits.
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
