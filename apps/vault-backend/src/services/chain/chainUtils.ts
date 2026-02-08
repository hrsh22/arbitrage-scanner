import { polygon, polygonAmoy } from "viem/chains";
import type { Chain } from "viem/chains";
import { getNetwork, getFallbackRpcUrlsForNetwork, getChainIdForNetwork } from "../../env.js";

export function getViemChain(): Chain {
  return getNetwork() === "testnet" ? polygonAmoy : polygon;
}

export function getChainIdNumber(): number {
  return getChainIdForNetwork();
}

export function getRpcUrlsWithFallback(primaryRpcUrl: string): string[] {
  const fallbacks = getFallbackRpcUrlsForNetwork();
  const urls = [primaryRpcUrl, ...fallbacks];
  return [...new Set(urls)].filter((url) => url && url.trim().length > 0);
}
