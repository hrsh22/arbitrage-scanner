import { createTransport, type Transport } from "viem";
import { env } from "./env.js";
import { getNetworkConfigFromEnv, getRpcUrlsForNetwork } from "./config/network.js";

interface RpcPoolState {
  nextIndex: number;
  cooldownUntil: Map<string, number>;
}

const RATE_LIMIT_COOLDOWN_MS = 30_000;
const FAILURE_COOLDOWN_MS = 10_000;
const poolStates = new Map<string, RpcPoolState>();
let requestIdCounter = 0;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function splitRpcUrls(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeRpcUrls(values: string[]): string[] {
  return unique(values.map((value) => value.trim()).filter((value) => value.length > 0));
}

function resolveExplicitRpcUrls(primaryRpcUrl?: string | string[]): string[] {
  if (!primaryRpcUrl) return [];
  return Array.isArray(primaryRpcUrl)
    ? normalizeRpcUrls(primaryRpcUrl)
    : splitRpcUrls(primaryRpcUrl);
}

function getPoolState(urls: string[]): RpcPoolState {
  const key = urls.join("|");
  const existing = poolStates.get(key);
  if (existing) return existing;

  const state: RpcPoolState = {
    nextIndex: 0,
    cooldownUntil: new Map<string, number>(),
  };
  poolStates.set(key, state);
  return state;
}

function getOrderedRpcUrls(urls: string[], state: RpcPoolState): string[] {
  if (urls.length <= 1) return urls;

  const now = Date.now();
  const startIndex = state.nextIndex % urls.length;
  state.nextIndex = (startIndex + 1) % urls.length;

  const rotated = urls.map((_, index) => urls[(startIndex + index) % urls.length]!);
  const active = rotated.filter((url) => (state.cooldownUntil.get(url) ?? 0) <= now);

  return active.length > 0 ? active : rotated;
}

function classifyRpcFailure(error: unknown): { retryable: boolean; cooldownMs: number } {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("-32005")
  ) {
    return { retryable: true, cooldownMs: RATE_LIMIT_COOLDOWN_MS };
  }

  if (
    message.includes("400") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("econn") ||
    message.includes("socket") ||
    message.includes("unexpected end of json") ||
    message.includes("unexpected token") ||
    message.includes("invalid json") ||
    message.includes("unknown json-rpc error") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return { retryable: true, cooldownMs: FAILURE_COOLDOWN_MS };
  }

  return { retryable: false, cooldownMs: 0 };
}

async function sendRpcRequest(url: string, body: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    const payload = (await response.json()) as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };

    if (!Object.prototype.hasOwnProperty.call(payload, "result") && !payload.error) {
      throw new Error(`Invalid JSON-RPC payload from ${url}`);
    }

    if (payload.error) {
      const prefix = payload.error.code !== undefined ? `${payload.error.code}: ` : "";
      throw new Error(`${prefix}${payload.error.message ?? "Unknown JSON-RPC error"}`);
    }

    return payload.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getPolygonRpcUrls(primaryRpcUrl?: string | string[]): string[] {
  const explicitUrls = resolveExplicitRpcUrls(primaryRpcUrl);
  if (explicitUrls.length > 0) {
    return explicitUrls;
  }

  const networkConfig = getNetworkConfigFromEnv();
  return normalizeRpcUrls(getRpcUrlsForNetwork(networkConfig.name));
}

export function getNextRpcUrl(primaryRpcUrl?: string | string[]): string {
  const urls = getPolygonRpcUrls(primaryRpcUrl);
  const state = getPoolState(urls);
  return getOrderedRpcUrls(urls, state)[0]!;
}

function createRoundRobinTransport(urls: string[]): Transport {
  const normalizedUrls = normalizeRpcUrls(urls);

  return ({ retryCount, timeout }) => {
    const state = getPoolState(normalizedUrls);
    const timeoutMs = timeout ?? env.POLYGON_RPC_TIMEOUT_MS;

    return createTransport(
      {
        key: "round-robin-http",
        name: "Round Robin HTTP",
        type: "round-robin-http",
        retryCount: retryCount ?? env.POLYGON_RPC_RETRY_COUNT,
        retryDelay: env.POLYGON_RPC_RETRY_DELAY_MS,
        timeout: timeoutMs,
        async request({ method, params }) {
          const orderedUrls = getOrderedRpcUrls(normalizedUrls, state);
          let lastError: Error | undefined;

          for (const url of orderedUrls) {
            try {
              const result = await sendRpcRequest(
                url,
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: ++requestIdCounter,
                  method,
                  params: params ?? [],
                }),
                timeoutMs,
              );

              state.cooldownUntil.delete(url);
              return result as never;
            } catch (error) {
              const failure = classifyRpcFailure(error);
              lastError = error instanceof Error ? error : new Error(String(error));

              if (!failure.retryable) {
                throw lastError;
              }

              state.cooldownUntil.set(url, Date.now() + failure.cooldownMs);
            }
          }

          throw lastError ?? new Error("No RPC URLs configured");
        },
      },
      { urls: normalizedUrls },
    );
  };
}

export function createNetworkTransport(rpcUrl?: string | string[]): Transport {
  return createRoundRobinTransport(getPolygonRpcUrls(rpcUrl));
}

export function createPolygonTransport(primaryRpcUrl?: string | string[]): Transport {
  return createRoundRobinTransport(getPolygonRpcUrls(primaryRpcUrl));
}
