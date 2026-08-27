import "dotenv/config";

/**
 * Vault environment variable management.
 * All env vars should be read through this module.
 */

const stringFromEnv = (key: string, fallback: string): string => {
  return process.env[key] ?? fallback;
};

const numberFromEnv = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === "true";
};

const csvFromEnv = (key: string): string[] => {
  const value = process.env[key];
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const resolveVaultMode = (value: string): "simulation" | "live" => {
  if (value !== "simulation" && value !== "live") {
    throw new Error(`VAULT_MODE must be either "simulation" or "live". Received: ${value}`);
  }
  return value;
};

const resolveVaultNetwork = (value: string): "mainnet" | "amoy" => {
  if (value !== "mainnet" && value !== "amoy") {
    throw new Error(`VAULT_NETWORK must be either "mainnet" or "amoy". Received: ${value}`);
  }
  return value;
};

const resolveClobSignatureType = (value: string): 0 | 1 | 2 | 3 => {
  if (value !== "0" && value !== "1" && value !== "2" && value !== "3") {
    throw new Error(`VAULT_CLOB_SIGNATURE_TYPE must be one of 0, 1, 2, 3. Received: ${value}`);
  }
  return Number(value) as 0 | 1 | 2 | 3;
};

const vaultMode = resolveVaultMode(stringFromEnv("VAULT_MODE", "simulation"));
const vaultNetwork = resolveVaultNetwork(stringFromEnv("VAULT_NETWORK", "mainnet"));
const vaultClobSignatureType = resolveClobSignatureType(
  stringFromEnv("VAULT_CLOB_SIGNATURE_TYPE", "2"),
);

// ===== Amoy Network Enforcement =====
// Amoy vaults ALWAYS run in live mode (no simulation)
// Polymarket trading is explicitly disabled on Amoy (testnet unsafe)
const isAmoyNetwork = vaultNetwork === "amoy";
const enforcedVaultMode: "simulation" | "live" = isAmoyNetwork ? "live" : vaultMode;

if (isAmoyNetwork && vaultMode !== "live") {
  // eslint-disable-next-line no-console
  console.warn(
    "[env.ts] Amoy vault: VAULT_MODE override - forcing live mode (simulation not supported on testnet)",
  );
}

/**
 * Check if Polymarket trading is enabled for the current network.
 * Trading is always disabled on Amoy testnet for security.
 */
export function isTradingEnabled(): boolean {
  return !isAmoyNetwork;
}

export const env = {
  // Server
  PORT: numberFromEnv("VAULT_PORT", 8081),

  // Database
  VAULT_DATABASE_URL: stringFromEnv("VAULT_DATABASE_URL", ""),

  // Network
  VAULT_NETWORK: vaultNetwork,

  // Polygon RPC
  POLYGON_RPC_URLS: csvFromEnv("POLYGON_RPC_URL"),
  AMOY_RPC_URLS: csvFromEnv("AMOY_RPC_URL"),
  POLYGON_RPC_TIMEOUT_MS: numberFromEnv("POLYGON_RPC_TIMEOUT_MS", 10_000),
  POLYGON_RPC_RETRY_COUNT: numberFromEnv("POLYGON_RPC_RETRY_COUNT", 2),
  POLYGON_RPC_RETRY_DELAY_MS: numberFromEnv("POLYGON_RPC_RETRY_DELAY_MS", 300),

  // Polymarket Builder attribution
  POLYMARKET_BUILDER_CODE: process.env.POLYMARKET_BUILDER_CODE ?? null,
  VAULT_BUILDER_ENABLED: booleanFromEnv("VAULT_BUILDER_ENABLED", false),

  // Session
  VAULT_SESSION_SECRET: stringFromEnv("VAULT_SESSION_SECRET", "vault-dev-secret-change-me"),

  // Mode - enforced to "live" on Amoy regardless of VAULT_MODE env var
  VAULT_MODE: enforcedVaultMode,
  VAULT_CLOB_SIGNATURE_TYPE: vaultClobSignatureType,

  // Liquidity Manager Circuit Breakers
  LIQUIDITY_PAUSE: booleanFromEnv("LIQUIDITY_PAUSE", false),
  LIQUIDITY_DRY_RUN: booleanFromEnv("LIQUIDITY_DRY_RUN", false),
  LIQUIDITY_EMERGENCY_STOP: booleanFromEnv("LIQUIDITY_EMERGENCY_STOP", false),

  // Invariant Check Configuration
  LIQUIDITY_INVARIANT_TOLERANCE_USDC: numberFromEnv("LIQUIDITY_INVARIANT_TOLERANCE_USDC", 1.0),
  LIQUIDITY_NAV_MAX_STALENESS_SECONDS: numberFromEnv("LIQUIDITY_NAV_MAX_STALENESS_SECONDS", 3600),
} as const;

export type Env = typeof env;
