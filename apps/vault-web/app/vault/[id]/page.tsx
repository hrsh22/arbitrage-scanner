import type { Metadata } from "next";

import type { VaultInstance, VaultInstancesResponse } from "../../../src/types";
import VaultDetailPage from "./vault-detail";

interface VaultInstancesStaticResponse {
  instances?: Array<{ id: number }>;
}

function parseRouteVaultId(id: string): number | null {
  if (!/^\d+$/.test(id)) {
    return null;
  }

  const parsed = Number.parseInt(id, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function fetchVaultInstancesForBootstrap(): Promise<VaultInstance[] | null> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8081";

  try {
    const response = await fetch(`${apiBaseUrl}/vault/instances`, { cache: "no-store" });
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

  return {
    title: `Vault ${id} | Polymarket Vault`,
    description:
      "Review the mandate, action panel, performance, operator context, and meaningful updates for this vault.",
  };
}

export async function generateStaticParams() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8081";

  try {
    const response = await fetch(`${apiBaseUrl}/vault/instances`);
    if (!response.ok) {
      return [{ id: "1" }];
    }

    const payload = (await response.json()) as VaultInstancesStaticResponse;
    const instances = payload.instances ?? [];

    if (instances.length === 0) {
      return [{ id: "1" }];
    }

    return instances.map((vault) => ({ id: String(vault.id) }));
  } catch {
    return [{ id: "1" }];
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const routeVaultId = parseRouteVaultId(id);

  if (routeVaultId === null) {
    return <VaultDetailPage routeVaultId={-1} bootstrapResolved bootstrapVault={null} />;
  }

  const bootstrapInstances = await fetchVaultInstancesForBootstrap();
  const bootstrapVault = bootstrapInstances?.find((vault) => vault.id === routeVaultId) ?? null;

  return (
    <VaultDetailPage
      routeVaultId={routeVaultId}
      bootstrapResolved={bootstrapInstances !== null}
      bootstrapVault={bootstrapVault}
    />
  );
}
