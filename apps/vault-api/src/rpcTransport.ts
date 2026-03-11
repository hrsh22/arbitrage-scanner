import { fallback, http, type Transport } from "viem";
import { env } from "./env.js";
import { getNetworkConfigFromEnv, getRpcUrlForNetwork } from "./config/network.js";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Get RPC URLs for the configured network.
 * Uses VAULT_NETWORK to determine which network to use.
 */
export function getPolygonRpcUrls(primaryRpcUrl?: string): string[] {
  const networkConfig = getNetworkConfigFromEnv();

  // Get the appropriate RPC URL based on network
  const networkRpcUrl = getRpcUrlForNetwork(networkConfig.name);

  const hasExplicitPrimary =
    (typeof primaryRpcUrl === "string" && primaryRpcUrl.length > 0) ||
    Boolean(process.env[networkConfig.rpcEnvKey]);

  const primary = primaryRpcUrl ?? networkRpcUrl;
  const fallbackUrls = env.POLYGON_RPC_FALLBACK_URLS ?? [];
  const urls = [primary, ...fallbackUrls].filter((url) => url.length > 0);

  // Add default backup only for mainnet if no explicit primary or fallbacks
  if (networkConfig.name === "mainnet" && !hasExplicitPrimary && fallbackUrls.length === 0) {
    urls.push("https://polygon-rpc.com");
  }

  return unique(urls);
}

function createHttpTransport(url: string): Transport {
  const transport = http(url, {
    timeout: env.POLYGON_RPC_TIMEOUT_MS ?? 10_000,
    retryCount: env.POLYGON_RPC_RETRY_COUNT ?? 2,
    retryDelay: env.POLYGON_RPC_RETRY_DELAY_MS ?? 300,
  });
  return transport as Transport;
}

export function createNetworkTransport(rpcUrl?: string): Transport {
  const networkConfig = getNetworkConfigFromEnv();
  const effectiveUrl = rpcUrl ?? getRpcUrlForNetwork(networkConfig.name);
  return createHttpTransport(effectiveUrl);
}

/**
 * Create a viem transport for the configured network.
 * Uses VAULT_NETWORK to determine which network to connect to.
 */
export function createPolygonTransport(primaryRpcUrl?: string): Transport {
  const urls = getPolygonRpcUrls(primaryRpcUrl);
  const networkConfig = getNetworkConfigFromEnv();
  const effectiveUrls = urls.length > 0 ? urls : [networkConfig.defaultRpcUrl];
  const transports = effectiveUrls.map(createHttpTransport);

  if (transports.length === 1) {
    return transports[0] as Transport;
  }

  return fallback(transports, { rank: true }) as Transport;
}
