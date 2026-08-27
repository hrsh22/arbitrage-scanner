"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ArrowUpRight } from "lucide-react";
import { useDiscoverVaultCards, useVaultInstances } from "../src/lib/hooks";
import { getVaultHref } from "../src/lib/vaultRouting";
import { AssetBadge, AssetLogoStack, type AssetType } from "../components/asset-logo";
import { EmptyState, ErrorState } from "../components/async-state";
import { USER_COLLATERAL_SYMBOL } from "../src/constants";
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
    low: "border-[#58A65C]/30 bg-[#58A65C]/10 text-[#2F7A35]",
    medium: "border-[#E8C08C]/50 bg-[#E8C08C]/20 text-[#8A6231]",
    high: "border-[#DC2626]/25 bg-[#DC2626]/10 text-[#B91C1C]",
  };

  return (
    <Badge variant="outline" className={`rounded-full border font-bold ${colors[level]}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)} Risk
    </Badge>
  );
}

function VaultMetricValue({ isLoading, value }: { isLoading: boolean; value: string }) {
  if (isLoading) {
    return <Skeleton className="mt-1 h-6 w-20 rounded-md bg-[#E8D9C0]" />;
  }

  return <span className="text-lg font-bold text-[#1A202C]">{value}</span>;
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
    <Link
      href={vaultHref}
      data-testid={`discover-vault-card-${vault.id}`}
      className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CCCAC4]"
    >
      <Card className="relative h-full overflow-hidden rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-300 hover:-translate-y-1 hover:border-[#CCCAC4] hover:shadow-[0_10px_30px_-24px_rgba(26,32,44,0.35)]">
        <CardHeader className="relative space-y-4 px-4 pb-3 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <AssetBadge
                  asset="usdc"
                  size="sm"
                  variant="default"
                  label={USER_COLLATERAL_SYMBOL}
                />
                <Badge className="w-fit rounded-full border border-[#CCCAC4] bg-[#F6F4F3] text-[10px] uppercase tracking-[0.22em] text-[#615E4E]">
                  {vault.type === "custom" ? "Vault" : vault.type}
                </Badge>
                <RiskBadge level={vault.profile.riskLevel} />
              </div>

              <div className="space-y-1">
                <CardTitle className="font-serif text-3xl font-bold tracking-tight text-[#1A202C]">
                  {vault.name}
                </CardTitle>
                <p className="text-sm leading-6 text-[#615E4E]">{getVaultCardSummary(vault)}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge
                  variant="secondary"
                  className="rounded-full border border-[#CCCAC4] bg-[#F6F4F3] text-[#1A202C]"
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
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#CCCAC4] bg-[#F6F4F3] text-[#615E4E]"
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
                  className="rounded-full border border-[#CCCAC4] bg-[#F6F4F3] text-[#615E4E]"
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
                    className="rounded-full border border-[#CCCAC4] bg-[#F6F4F3] text-[#615E4E]"
                  >
                    @AWEnetwork_ai
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative space-y-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#CCCAC4] bg-[#F0EDE8] p-3 sm:grid-cols-3 sm:gap-3 sm:p-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#615E4E] sm:text-[11px] sm:tracking-[0.18em]">
                NAV
              </span>
              <VaultMetricValue
                isLoading={isLoading}
                value={status ? `$${status.nav.sharePrice.toFixed(4)}` : "--"}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#615E4E] sm:text-[11px] sm:tracking-[0.18em]">
                TVL
              </span>
              <VaultMetricValue isLoading={isLoading} value={formatCompactCurrency(tvl)} />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#615E4E] sm:text-[11px] sm:tracking-[0.18em]">
                Capital deployed
              </span>
              <VaultMetricValue
                isLoading={isLoading}
                value={formatCompactCurrency(deployedCapital)}
              />
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-[#CCCAC4] pt-4">
            <span className="inline-flex items-center gap-2 text-sm font-bold text-[#1A202C] transition-transform duration-300 group-hover:translate-x-1">
              Open vault
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
  const discoverCards = useDiscoverVaultCards(instances);

  return (
    <main className="polyvaults-app-shell vault-pane-scroll relative min-h-0 flex-1 overflow-hidden overflow-y-auto px-4 py-8 text-[#1A202C] sm:px-8 sm:py-10 lg:px-20 lg:py-12">
      <div className="relative z-10 mx-auto max-w-7xl space-y-8 sm:space-y-10">
        <section className="relative overflow-hidden rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] px-5 py-8 shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:px-8 sm:py-10 lg:px-10">
          <div className="relative z-20 space-y-3 animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#615E4E]">
              Strategies
            </p>
            <h1 className="max-w-3xl font-serif text-5xl font-bold tracking-tight text-[#1A202C] sm:text-6xl">
              Discover Vaults
            </h1>
            <p className="max-w-2xl text-base leading-7 text-[#615E4E] sm:text-lg">
              Find vaults and strategies run by agents or human operators
            </p>
            <div className="pt-2 text-sm font-medium text-[#615E4E]">
              {instances.length} vault{instances.length === 1 ? "" : "s"} available
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl px-1 py-1">
          <div className="relative z-10 space-y-8 sm:space-y-10">
            <div className="flex items-end justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#615E4E]">
                  Available
                </p>
                <h2 className="font-serif text-3xl font-bold tracking-tight text-[#1A202C]">
                  Vault strategies
                </h2>
              </div>
            </div>

            {error && <ErrorState description={error} className="text-left items-start" />}

            {isLoading ? (
              <div className="grid gap-6 md:grid-cols-2" data-testid="discover-vaults-loading">
                <Skeleton className="h-[420px] w-full rounded-2xl bg-[#E8D9C0]" />
                <Skeleton className="h-[420px] w-full rounded-2xl bg-[#E8D9C0]" />
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
        </section>
      </div>
    </main>
  );
}
