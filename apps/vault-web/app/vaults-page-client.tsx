"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ArrowUpRight } from "lucide-react";
import { useDiscoverVaultCards, useVaultInstances } from "../src/lib/hooks";
import { getVaultHref } from "../src/lib/vaultRouting";
import { AssetBadge, AssetLogoStack, type AssetType } from "../components/asset-logo";
import { EmptyState, ErrorState } from "../components/async-state";
import type { VaultInstance, VaultRiskLevel } from "../src/types";

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function getDepositStatusLabel(
  enabled: boolean,
  depositsDisabled?: boolean,
  executionMode?: string | null,
  telemetryFresh?: boolean | null,
): string {
  if (depositsDisabled) {
    return "Migration Mode";
  }

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

function getVaultCardSummary(vault: VaultInstance): string {
  const managerLabel = vault.profile.tradingMetadata?.assets?.includes("btc")
    ? "Managed by @AWEnetwork_ai"
    : "Managed by vault operator";
  return `${managerLabel} with a focus on ${vault.profile.strategyLabel.toLowerCase()}.`;
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

function VaultCard({
  vault,
  status,
  isLoading,
  executionMode,
  telemetryFresh,
}: {
  vault: VaultInstance;
  status: {
    nav: {
      trackedTotalAssets?: number;
      totalAssets: number;
      deployedCostBasis: number;
      redeemableCostBasis?: number;
      sharePrice: number;
    };
    migration?: VaultInstance["migration"];
  } | null;
  isLoading: boolean;
  executionMode: string | null;
  telemetryFresh: boolean | null;
}) {
  const router = useRouter();

  const tvl = status?.nav?.trackedTotalAssets ?? status?.nav?.totalAssets ?? 0;
  const deployedCapital =
    (status?.nav?.deployedCostBasis ?? 0) + (status?.nav?.redeemableCostBasis ?? 0);

  const hasTradingMetadata = Boolean(
    vault.profile.tradingMetadata?.assets?.length ||
    vault.profile.tradingMetadata?.platforms?.length,
  );
  const showAweCredit = vault.profile.tradingMetadata?.assets?.includes("btc");
  const vaultHref = getVaultHref(vault);

  return (
    <div
      role="link"
      tabIndex={0}
      data-testid={`discover-vault-card-${vault.id}`}
      onClick={() => router.push(vaultHref)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(vaultHref);
        }
      }}
      className="group block h-full cursor-pointer focus:outline-none"
    >
      <Card className="relative h-full overflow-hidden rounded-[2px] border border-[#212121] bg-[#121212] shadow-none transition-all duration-300 hover:scale-[1.02] hover:border-[#656565] hover:bg-[#1A1A1A]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(236,102,0,0.10),_transparent_28%),radial-gradient(circle_at_88%_18%,_rgba(137,145,130,0.12),_transparent_18%)] opacity-80" />
        <CardHeader className="relative space-y-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <AssetBadge asset="usdc" size="sm" variant="default" />
                <Badge className="w-fit border border-white/10 bg-white/8 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                  {vault.type === "custom" ? "Vault" : vault.type}
                </Badge>
                <RiskBadge level={vault.profile.riskLevel} />
              </div>

              <div className="space-y-1">
                <CardTitle className="text-2xl font-semibold tracking-tight text-white">
                  {vault.name}
                </CardTitle>
                <p className="text-sm leading-6 text-slate-300">{getVaultCardSummary(vault)}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge
                  variant="secondary"
                  className="rounded-[2px] border border-[#656565]/40 bg-[#212121] text-white"
                >
                  {vault.profile.strategyLabel}
                </Badge>
                {hasTradingMetadata &&
                  (() => {
                    const validAssets: AssetType[] = [
                      ...(vault.profile.tradingMetadata?.assets || []),
                      ...(vault.profile.tradingMetadata?.platforms || []),
                    ].filter((asset): asset is AssetType =>
                      ["usdc", "btc", "gnosis-safe", "polymarket"].includes(asset),
                    );

                    if (validAssets.length === 0) return null;

                    return (
                      <Badge
                        variant="secondary"
                        className="inline-flex items-center gap-1.5 border border-white/10 bg-white/6 text-slate-200"
                      >
                        <AssetLogoStack assets={validAssets} size="xs" />
                        <span>
                          {vault.profile.tradingMetadata?.assets?.[0]?.toUpperCase() || "Markets"}
                        </span>
                      </Badge>
                    );
                  })()}
                <Badge
                  variant="secondary"
                  className="border border-white/10 bg-white/6 text-slate-200"
                >
                  {getDepositStatusLabel(
                    vault.enabled,
                    status?.migration?.depositsDisabled ?? vault.migration?.depositsDisabled,
                    executionMode,
                    telemetryFresh,
                  )}
                </Badge>
                {showAweCredit ? (
                  <Badge
                    variant="secondary"
                    className="border border-white/10 bg-white/6 text-slate-200"
                  >
                    @AWEnetwork_ai
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative space-y-5">
          <div className="grid grid-cols-3 gap-3 rounded-[2px] border border-[#212121] bg-[#0A0A0A] p-4">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">NAV</span>
              <span className="text-lg font-semibold text-white">
                {isLoading ? "--" : `$${status?.nav.sharePrice.toFixed(4) ?? "--"}`}
              </span>
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
                {isLoading ? "--" : formatCompactCurrency(deployedCapital)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-[#212121] pt-4">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-white transition-transform duration-300 group-hover:translate-x-1">
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
  const discoverCards = useDiscoverVaultCards(instances);

  return (
    <main className="vault-pane-scroll flex-1 min-h-0 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12">
      <div className="mx-auto max-w-6xl space-y-10">
        <section className="relative overflow-hidden rounded-[2px] border border-[#212121] bg-[#121212] px-6 py-8 shadow-none sm:px-8 lg:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(137,145,130,0.16),_transparent_34%),radial-gradient(circle_at_85%_15%,_rgba(236,102,0,0.14),_transparent_18%)]" />
          <div className="relative space-y-3 animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Discover vaults
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Find vaults and strategies run by agents or human operators
            </p>
            <div className="pt-2 text-sm text-slate-400">
              {instances.length} vault{instances.length === 1 ? "" : "s"} available
            </div>
          </div>
        </section>

        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-white">Available vaults</h2>
          </div>
        </div>

        {error && <ErrorState description={error} className="text-left items-start" />}

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2" data-testid="discover-vaults-loading">
            <Skeleton className="h-[420px] w-full rounded-[28px] bg-white/10" />
            <Skeleton className="h-[420px] w-full rounded-[28px] bg-white/10" />
          </div>
        ) : instances.length === 0 ? (
          <EmptyState variant="card" title="No vaults are available right now." />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {discoverCards.map(
              ({ vault, status, isLoading: vaultIsLoading, executionMode, telemetryFresh }) => (
                <VaultCard
                  key={vault.id}
                  vault={vault}
                  status={status}
                  isLoading={vaultIsLoading}
                  executionMode={executionMode}
                  telemetryFresh={telemetryFresh}
                />
              ),
            )}
          </div>
        )}
      </div>
    </main>
  );
}
