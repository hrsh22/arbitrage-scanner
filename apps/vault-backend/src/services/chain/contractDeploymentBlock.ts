import type { Address } from "viem";
import { env, getFallbackRpcUrlsForNetwork } from "../../env.js";
import { logger } from "../../logger.js";

const REQUEST_TIMEOUT_MS = 8000;

// In-memory cache: address -> deployment block
const deploymentBlockCache = new Map<string, bigint>();

function getRpcUrls(): string[] {
  const fallbacks = getFallbackRpcUrlsForNetwork();
  const urls = [env.POLYGON_RPC_URL, ...fallbacks];
  return [...new Set(urls)].filter((url) => url && url.trim().length > 0);
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as { result?: unknown; error?: { message: string } };
    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function rpcWithFallback(method: string, params: unknown[]): Promise<unknown> {
  const urls = getRpcUrls();
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      return await rpcCall(url, method, params);
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError || new Error("All RPCs failed");
}

async function getLatestBlockNumber(): Promise<bigint> {
  const result = await rpcWithFallback("eth_blockNumber", []);
  return BigInt(result as string);
}

async function getCodeAtBlock(address: Address, blockNumber: bigint): Promise<string> {
  const result = await rpcWithFallback("eth_getCode", [
    address.toLowerCase(),
    `0x${blockNumber.toString(16)}`,
  ]);
  return String(result);
}

function isEmptyCode(code: string): boolean {
  const normalized = code.toLowerCase();
  return normalized === "0x" || normalized === "0x0";
}

/**
 * Finds the first block where contract bytecode exists at `address`.
 * Uses binary search over [0, latest].
 */
export async function getContractDeploymentBlock(address: Address): Promise<bigint> {
  const cacheKey = address.toLowerCase();
  const cached = deploymentBlockCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const latest = await getLatestBlockNumber();

  const latestCode = await getCodeAtBlock(address, latest);
  if (isEmptyCode(latestCode)) {
    throw new Error(`No contract code at address ${address} on latest block ${latest}`);
  }

  let low = 0n;
  let high = latest;
  let iterations = 0;

  while (low < high && iterations < 40) {
    iterations++;
    const mid = (low + high) / 2n;
    const code = await getCodeAtBlock(address, mid);
    if (isEmptyCode(code)) {
      low = mid + 1n;
    } else {
      high = mid;
    }
  }

  logger.info("Resolved contract deployment block", {
    address: cacheKey,
    deploymentBlock: Number(low),
    latestBlock: Number(latest),
    iterations,
  });

  deploymentBlockCache.set(cacheKey, low);
  return low;
}
