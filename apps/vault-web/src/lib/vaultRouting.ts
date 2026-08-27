import type { VaultInstance } from "../types";

function normalizeVaultSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripVaultTokens(tokens: string[]): string[] {
  const stripped = tokens.filter(
    (token) => !["vault", "mainnet", "amoy", "testnet", "dev", "staging"].includes(token),
  );
  return stripped.length > 0 ? stripped : tokens;
}

function createFriendlyVaultSlug(value: string): string {
  const normalized = normalizeVaultSegment(value);
  if (!normalized) {
    return "";
  }

  const tokens = normalized.split("-").filter(Boolean);
  return stripVaultTokens(tokens).join("-");
}

function normalizeVaultTitle(name: string): string {
  const normalized = name
    .replace(/\bvault\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || name.trim();
}

function getVaultRouteCandidates(vault: Pick<VaultInstance, "id" | "slug" | "name">): string[] {
  return Array.from(
    new Set(
      [
        String(vault.id),
        normalizeVaultSegment(vault.slug),
        createFriendlyVaultSlug(vault.slug),
        normalizeVaultSegment(vault.name),
        createFriendlyVaultSlug(vault.name),
      ].filter(Boolean),
    ),
  );
}

export function getVaultRouteSegment(vault: Pick<VaultInstance, "id" | "slug" | "name">): string {
  return (
    createFriendlyVaultSlug(vault.name) || createFriendlyVaultSlug(vault.slug) || String(vault.id)
  );
}

export function getVaultHref(vault: Pick<VaultInstance, "id" | "slug" | "name">): string {
  return `/vault/${getVaultRouteSegment(vault)}`;
}

export function getVaultPageTitle(vault: Pick<VaultInstance, "name">): string {
  return normalizeVaultTitle(vault.name);
}

export function resolveVaultFromRouteSegment<T extends Pick<VaultInstance, "id" | "slug" | "name">>(
  segment: string,
  vaults: T[],
): T | null {
  const normalizedSegment = normalizeVaultSegment(segment);
  if (!normalizedSegment) {
    return null;
  }

  return vaults.find((vault) => getVaultRouteCandidates(vault).includes(normalizedSegment)) ?? null;
}
