/**
 * Price Service — Fetches live market prices from Polymarket CLOB API
 *
 * Uses bid/sell prices for conservative (mark-to-market) NAV valuation.
 * The sell price = best bid = highest price someone is willing to pay.
 * This represents what the vault could actually realize by selling positions.
 *
 * Endpoints used:
 *   POST /prices  — batch fetch (up to 500 tokens per request)
 *   GET  /price   — single-token fallback
 */

import { logger } from "../logger.js";
import { SUPPORTS_POLYMARKET_TRADING } from "../constants.js";

const CLOB_BASE_URL = "https://clob.polymarket.com";

/** Request timeout for price API calls (ms) */
const PRICE_FETCH_TIMEOUT_MS = 15_000;

/** Maximum tokens per batch request (CLOB limit is 500, we use 100 for safety) */
const MAX_BATCH_SIZE = 100;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class PriceService {
  /**
   * Batch-fetch sell (bid) prices for multiple token IDs.
   * Uses POST /prices with side=SELL for efficiency.
   * Falls back to individual GET /price calls if batch fails.
   *
   * On Amoy testnet, returns 0 prices since Polymarket CLOB is not available.
   *
   * @param tokenIds - Conditional token IDs to price
   * @returns Map of tokenId → bid price (0–1 range). Missing/failed tokens get 0.
   */
  async getBidPrices(tokenIds: string[]): Promise<Map<string, number>> {
    // Return empty prices on unsupported networks
    if (!SUPPORTS_POLYMARKET_TRADING) {
      logger.warn("PriceService: Polymarket CLOB is not available on the current network");
      const emptyPrices = new Map<string, number>();
      for (const tokenId of tokenIds) {
        emptyPrices.set(tokenId, 0);
      }
      return emptyPrices;
    }

    if (tokenIds.length === 0) return new Map();

    const uniqueIds = [...new Set(tokenIds)];
    const allPrices = new Map<string, number>();

    // Process in batches to respect API limits
    for (let i = 0; i < uniqueIds.length; i += MAX_BATCH_SIZE) {
      const batch = uniqueIds.slice(i, i + MAX_BATCH_SIZE);

      try {
        const batchPrices = await this.fetchBatchPrices(batch);
        for (const [id, price] of batchPrices) {
          allPrices.set(id, price);
        }
      } catch (error) {
        logger.warn("PriceService: Batch fetch failed, falling back to individual", {
          batchStart: i,
          batchSize: batch.length,
          error: (error as Error).message,
        });

        const fallbackPrices = await this.fetchIndividualPrices(batch);
        for (const [id, price] of fallbackPrices) {
          allPrices.set(id, price);
        }
      }
    }

    logger.info("PriceService: Fetched bid prices", {
      requested: uniqueIds.length,
      received: allPrices.size,
      withPrice: [...allPrices.values()].filter((p) => p > 0).length,
      zeroPrices: [...allPrices.values()].filter((p) => p === 0).length,
    });

    return allPrices;
  }

  /**
   * Fetch sell prices for a batch of tokens via POST /prices.
   * Response shape: { "tokenId1": { "SELL": 0.95 }, ... }
   */
  private async fetchBatchPrices(tokenIds: string[]): Promise<Map<string, number>> {
    const body = tokenIds.map((id) => ({ token_id: id, side: "SELL" }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PRICE_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(`${CLOB_BASE_URL}/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`CLOB /prices returned ${response.status}`);
      }

      const data = (await response.json()) as Record<
        string,
        Record<string, number | string> | undefined
      >;
      const prices = new Map<string, number>();

      for (const tokenId of tokenIds) {
        const entry = data[tokenId];
        const rawPrice = entry?.SELL ?? entry?.sell ?? 0;
        const price = typeof rawPrice === "string" ? parseFloat(rawPrice) : rawPrice;
        prices.set(tokenId, isNaN(price) ? 0 : price);
      }

      return prices;
    } catch (error) {
      const message = getErrorMessage(error);
      const isTimeout =
        (error instanceof Error && error.name === "AbortError") || message.includes("aborted");

      throw new Error(
        `PriceService: Batch price fetch failed (endpoint=${CLOB_BASE_URL}/prices, tokenCount=${tokenIds.length}, timeoutMs=${PRICE_FETCH_TIMEOUT_MS}, timeout=${isTimeout}): ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fallback: fetch sell prices individually via GET /price.
   * Uses Promise.allSettled so one failure doesn't block others.
   */
  private async fetchIndividualPrices(tokenIds: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    const results = await Promise.allSettled(
      tokenIds.map(async (tokenId) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PRICE_FETCH_TIMEOUT_MS);

        try {
          const url = `${CLOB_BASE_URL}/price?token_id=${tokenId}&side=sell`;
          const response = await fetch(url, { signal: controller.signal });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = (await response.json()) as { price?: string };
          const price = parseFloat(data.price ?? "0");
          return { tokenId, price: isNaN(price) ? 0 : price };
        } catch (error) {
          const message = getErrorMessage(error);
          const isTimeout =
            (error instanceof Error && error.name === "AbortError") || message.includes("aborted");

          throw new Error(
            `PriceService: Single price fetch failed (tokenId=${tokenId}, timeoutMs=${PRICE_FETCH_TIMEOUT_MS}, timeout=${isTimeout}): ${message}`,
          );
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        prices.set(result.value.tokenId, result.value.price);
      } else {
        logger.warn("PriceService: Individual price fetch failed", {
          tokenId: tokenIds[index],
          error: getErrorMessage(result.reason),
        });
      }
    }

    // Set 0 for any token that failed entirely
    for (const tokenId of tokenIds) {
      if (!prices.has(tokenId)) {
        prices.set(tokenId, 0);
        logger.warn("PriceService: Failed to fetch price for token", { tokenId });
      }
    }

    return prices;
  }
}

export const priceService = new PriceService();
