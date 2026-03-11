import { fallback, http, type Transport } from "viem";
import { env } from "./env.js";

const DEFAULT_BACKUP_RPC = "https://polygon-rpc.com";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function getPolygonRpcUrls(primaryRpcUrl?: string): string[] {
  const hasExplicitPrimary =
    (typeof primaryRpcUrl === "string" && primaryRpcUrl.length > 0) ||
    Boolean(process.env.POLYGON_RPC_URL);
  const primary = primaryRpcUrl ?? env.POLYGON_RPC_URL ?? DEFAULT_BACKUP_RPC;
  const fallbackUrls = env.POLYGON_RPC_FALLBACK_URLS ?? [];
  const urls = [primary, ...fallbackUrls].filter((url) => url.length > 0);

  if (!hasExplicitPrimary && fallbackUrls.length === 0 && primary !== DEFAULT_BACKUP_RPC) {
    urls.push(DEFAULT_BACKUP_RPC);
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

export function createPolygonTransport(primaryRpcUrl?: string): Transport {
  const urls = getPolygonRpcUrls(primaryRpcUrl);
  const effectiveUrls = urls.length > 0 ? urls : [DEFAULT_BACKUP_RPC];
  const transports = effectiveUrls.map(createHttpTransport);

  if (transports.length === 1) {
    return transports[0] as Transport;
  }

  return fallback(transports, { rank: true }) as Transport;
}
