import { config } from "../config.js";
import { logger } from "../logger.js";

export type KalshiMarket = {
  ticker: string;
  title: string;
  subtitle: string;
  rulesPrimary: string; // Resolution rules
  status: string;
  eventTicker: string;
  eventTitle?: string;
  category?: string;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  lastPrice: number;
  volume: number;
  liquidity: number;
  closeTime: string;
  expirationTime: string;
};

type KalshiApiMarket = {
  ticker: string;
  title: string;
  subtitle?: string;
  rules_primary?: string; // Resolution rules
  status: string;
  event_ticker: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  liquidity?: number; // In cents
  close_time: string;
  expiration_time: string;
};

type KalshiMarketsResponse = {
  markets: KalshiApiMarket[];
  cursor?: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class KalshiClient {
  private baseUrl = "https://api.elections.kalshi.com/trade-api/v2";
  private cachedMarkets: KalshiMarket[] = [];
  private lastFetchedAt = 0;
  private pollingPromise: Promise<KalshiMarket[]> | null = null;

  private async fetchJson<T>(url: string): Promise<T> {
    for (let attempt = 0; attempt <= config.requestRetries; attempt++) {
      const controller = new AbortController();
      // Use longer timeout for Kalshi API (60 seconds)
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        return (await response.json()) as T;
      } catch (error) {
        if (attempt >= config.requestRetries) {
          throw error;
        }
        await delay(100 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("Request retries exceeded");
  }

  private centsToDecimal(cents: number): number {
    return cents / 100;
  }

  private normalizeMarket(m: KalshiApiMarket): KalshiMarket {
    return {
      ticker: m.ticker,
      title: m.title,
      subtitle: m.subtitle ?? "",
      rulesPrimary: m.rules_primary ?? "", // Resolution rules
      status: m.status,
      eventTicker: m.event_ticker,
      yesBid: this.centsToDecimal(m.yes_bid ?? 0),
      yesAsk: this.centsToDecimal(m.yes_ask ?? 0),
      noBid: this.centsToDecimal(m.no_bid ?? 0),
      noAsk: this.centsToDecimal(m.no_ask ?? 0),
      lastPrice: this.centsToDecimal(m.last_price ?? 0),
      volume: m.volume ?? 0,
      liquidity: (m.liquidity ?? 0) / 100, // Convert cents to dollars
      closeTime: m.close_time,
      expirationTime: m.expiration_time,
    };
  }

  /**
   * Fetch markets directly with pagination
   * Uses limit=1000 (max) and cursor pagination
   */
  private async fetchAllMarkets(maxMarkets = 3000): Promise<KalshiMarket[]> {
    const allMarkets: KalshiMarket[] = [];
    let cursor: string | undefined;
    const pageSize = 1000; // Max allowed by API

    logger.info("Kalshi: Fetching markets directly...");

    while (allMarkets.length < maxMarkets) {
      const params = new URLSearchParams({
        limit: String(pageSize),
        status: "open",
      });
      if (cursor) params.set("cursor", cursor);

      const url = `${this.baseUrl}/markets?${params.toString()}`;

      try {
        const response = await this.fetchJson<KalshiMarketsResponse>(url);

        if (!response.markets || response.markets.length === 0) break;

        // Normalize and filter markets with valid prices
        for (const m of response.markets) {
          const normalized = this.normalizeMarket(m);
          if (
            normalized.yesAsk > 0 ||
            normalized.noAsk > 0 ||
            normalized.yesBid > 0 ||
            normalized.noBid > 0
          ) {
            allMarkets.push(normalized);
          }
        }

        logger.info("Kalshi: Page fetched", {
          pageMarkets: response.markets.length,
          withPrices: allMarkets.length,
          hasCursor: !!response.cursor,
        });

        cursor = response.cursor;
        if (!cursor) break;

        // Small delay between pages
        await delay(50);
      } catch (error) {
        logger.warn("Kalshi markets fetch error", { error: (error as Error).message });
        break;
      }
    }

    return allMarkets.slice(0, maxMarkets);
  }

  /**
   * Main fetch method - now directly fetches markets
   */
  private async fetchMarketsInternal(): Promise<KalshiMarket[]> {
    const startTime = Date.now();

    const allMarkets = await this.fetchAllMarkets(10000);

    this.cachedMarkets = allMarkets;
    this.lastFetchedAt = Date.now();

    const totalMs = Date.now() - startTime;
    logger.info("Kalshi: Fetch complete", {
      markets: allMarkets.length,
      totalMs,
    });

    return allMarkets;
  }

  async getMarkets(): Promise<KalshiMarket[]> {
    const now = Date.now();

    // Use cache if fresh (2 minutes)
    if (this.cachedMarkets.length && now - this.lastFetchedAt < 2 * 60 * 1000) {
      return this.cachedMarkets;
    }

    // If already polling, wait for it
    if (this.pollingPromise) {
      logger.info("Kalshi: Waiting for existing poll...");
      return this.pollingPromise;
    }

    // Start new poll
    this.pollingPromise = this.fetchMarketsInternal()
      .catch((error: Error) => {
        logger.error("Kalshi fetch failed", { error: error.message });
        return this.cachedMarkets;
      })
      .finally(() => {
        this.pollingPromise = null;
      });

    return this.pollingPromise;
  }
}
