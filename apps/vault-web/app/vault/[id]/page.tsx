import VaultDetailPage from "./vault-detail";

interface VaultInstancesStaticResponse {
  instances?: Array<{ id: number }>;
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

export default function Page() {
  return <VaultDetailPage />;
}
