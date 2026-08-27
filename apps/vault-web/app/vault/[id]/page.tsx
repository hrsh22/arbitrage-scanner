import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

import { API_BASE_URL } from "../../../src/constants";
import type { VaultInstance, VaultInstancesResponse } from "../../../src/types";
import {
  getVaultHref,
  getVaultPageTitle,
  getVaultRouteSegment,
  resolveVaultFromRouteSegment,
} from "../../../src/lib/vaultRouting";
import VaultDetailPage from "./vault-detail";

interface VaultInstancesStaticResponse {
  instances?: VaultInstance[];
}

function buildSearchParamsString(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      params.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    }
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

async function fetchVaultInstancesForBootstrap(): Promise<VaultInstance[] | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/vault/instances`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as VaultInstancesResponse;
    return payload.instances;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const vaults = await fetchVaultInstancesForBootstrap();
  const matchedVault = vaults ? resolveVaultFromRouteSegment(id, vaults) : null;

  return {
    title: matchedVault
      ? `${getVaultPageTitle(matchedVault)} | Polymarket Vault`
      : "Polymarket Vault",
    description: "Vaults Executing Prediction Market Strategies.",
  };
}

export async function generateStaticParams() {
  try {
    const response = await fetch(`${API_BASE_URL}/vault/instances`);
    if (!response.ok) {
      return [{ id: "1" }];
    }

    const payload = (await response.json()) as VaultInstancesStaticResponse;
    const instances = payload.instances ?? [];

    if (instances.length === 0) {
      return [{ id: "1" }];
    }

    return instances.map((vault) => ({ id: getVaultHref(vault).replace("/vault/", "") }));
  } catch {
    return [{ id: "1" }];
  }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, resolvedSearchParams, bootstrapInstances] = await Promise.all([
    params,
    searchParams,
    fetchVaultInstancesForBootstrap(),
  ]);
  const bootstrapVault = bootstrapInstances
    ? resolveVaultFromRouteSegment(id, bootstrapInstances)
    : null;

  if (bootstrapVault && id !== getVaultRouteSegment(bootstrapVault)) {
    permanentRedirect(
      `${getVaultHref(bootstrapVault)}${buildSearchParamsString(resolvedSearchParams)}`,
    );
  }

  const routeVaultId = bootstrapVault?.id ?? -1;

  return (
    <VaultDetailPage
      routeSegment={id}
      routeVaultId={routeVaultId}
      bootstrapResolved={bootstrapInstances !== null}
      bootstrapVault={bootstrapVault}
    />
  );
}
