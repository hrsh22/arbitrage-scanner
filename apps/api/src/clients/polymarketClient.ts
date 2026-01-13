import { config } from "../config.js";
import { logger } from "../logger.js";
import type { NormalizedMarket, NormalizedOutcome } from "../types.js";

type GammaMarket = {
  id?: string;
  slug?: string;
  question?: string;
  description?: string; // Resolution rules
  endDate?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  liquidity?: string;
  volume?: string;
};

type GammaTag = {
  slug: string;
  label: string;
};

type GammaEvent = {
  id?: string;
  slug?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  markets?: GammaMarket[];
  tags?: GammaTag[];
};

type ClobBook = {
  market: string;
  asset_id: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
};

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseJsonArray = (value: string | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export class PolymarketClient {
  private gammaBase = config.gammaBaseUrl.replace(/\/$/, "");
  private clobBase = config.clobBaseUrl.replace(/\/$/, "");
  private cachedMarkets: NormalizedMarket[] = [];
  private lastFetchedAt = 0;
  private isPolling = false;
  private pollingPromise: Promise<NormalizedMarket[]> | null = null;

  private async fetchJson<T>(url: string): Promise<T> {
    for (let attempt = 0; attempt <= config.requestRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        return (await response.json()) as T;
      } catch (error) {
        if (attempt >= config.requestRetries) {
          throw error;
        }
        const backoffMs = 200 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("Request retries exceeded");
  }

  /**
   * Fetch order book for a specific token from CLOB API
   */
  private async fetchOrderBook(tokenId: string): Promise<{
    bestBid: number | null;
    bestAsk: number | null;
    liquidity: number;
  }> {
    try {
      const url = `${this.clobBase}/book?token_id=${tokenId}`;
      const book = await this.fetchJson<ClobBook>(url);

      let bestBid: number | null = null;
      if (book.bids && book.bids.length > 0) {
        const bidPrices = book.bids.map((b) => Number(b.price)).filter((p) => Number.isFinite(p));
        bestBid = bidPrices.length > 0 ? Math.max(...bidPrices) : null;
      }

      let bestAsk: number | null = null;
      let liquidity = 0;
      if (book.asks && book.asks.length > 0) {
        const askPrices = book.asks.map((a) => Number(a.price)).filter((p) => Number.isFinite(p));
        bestAsk = askPrices.length > 0 ? Math.min(...askPrices) : null;

        if (bestAsk !== null) {
          const bestAskEntry = book.asks.find((a) => Number(a.price) === bestAsk);
          if (bestAskEntry) {
            liquidity = Number(bestAskEntry.size) * bestAsk;
          }
        }
      }

      return { bestBid, bestAsk, liquidity };
    } catch {
      return { bestBid: null, bestAsk: null, liquidity: 0 };
    }
  }

  /**
   * Fetch a batch of events (100 per request)
   */
  private async fetchEventsBatch(offset: number): Promise<GammaEvent[]> {
    const url =
      `${this.gammaBase}/events?` +
      `closed=false&active=true&` +
      `order=liquidity&ascending=false&` +
      `limit=100&offset=${offset}`;

    try {
      const events = await this.fetchJson<GammaEvent[]>(url);
      return events || [];
    } catch (error) {
      logger.error("Failed to fetch events batch", {
        offset,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Fetch 2000 events in parallel (20 batches of 100) sorted by liquidity
   * PLUS fetch 100 events closing soon to ensure near-resolution coverage
   */
  private async fetchTopEvents(): Promise<GammaEvent[]> {
    const batchOffsets = [
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600,
      1700, 1800, 1900,
    ];

    // Fetch top liquidity batches
    const liquidityPromise = Promise.all(
      batchOffsets.map((offset) => this.fetchEventsBatch(offset)),
    );

    // Fetch events closing soon (sort by endDate ascending)
    // Filter for active events closing in the future
    const now = new Date().toISOString();
    const soonUrl =
      `${this.gammaBase}/events?` +
      `closed=false&active=true&` +
      `order=endDate&ascending=true&` +
      `end_date_min=${now}&` +
      `limit=100`;

    const soonPromise = this.fetchJson<GammaEvent[]>(soonUrl).catch((err) => {
      logger.error("Failed to fetch failing-soon events", {
        error: (err as Error).message,
      });
      return [];
    });

    const [liquidityBatches, soonEvents] = await Promise.all([liquidityPromise, soonPromise]);

    // Combine results
    const allEvents: GammaEvent[] = [];

    // Add liquidity events
    for (const batch of liquidityBatches) {
      allEvents.push(...batch);
    }

    // Add soon events (avoiding duplicates)
    const existingIds = new Set(allEvents.map((e) => e.id));
    if (soonEvents) {
      for (const event of soonEvents) {
        if (!existingIds.has(event.id)) {
          allEvents.push(event);
          existingIds.add(event.id);
        }
      }
    }

    return allEvents.slice(0, config.maxEvents); // Allow slightly more events
  }

  /**
   * Check if a market is interesting for arbitrage or near-resolution detection.
   *
   * Includes markets where:
   * - Any outcome has extreme price (< 10% or > 90%) - good for arbitrage
   * - Any outcome has high probability (> 80%) - good for near-resolution
   */
  private mightBeInteresting(market: GammaMarket): boolean {
    const outcomeNames = parseJsonArray(market.outcomes);
    const outcomePrices = parseJsonArray(market.outcomePrices);

    if (outcomeNames.length !== 2 || outcomePrices.length !== 2) return false;

    const price1 = toNumber(outcomePrices[0]);
    const price2 = toNumber(outcomePrices[1]);

    if (price1 === null || price2 === null) return false;

    const minPrice = Math.min(price1, price2);
    const maxPrice = Math.max(price1, price2);

    // Include if:
    // - Extreme prices (arbitrage candidates): minPrice < 0.10 or > 0.90
    // - High probability (near-resolution candidates): maxPrice > 0.80
    return minPrice < 0.1 || maxPrice > 0.8;
  }

  /**
   * Normalize a market with order book data
   */
  private async enrichWithOrderBook(
    event: GammaEvent,
    market: GammaMarket,
  ): Promise<NormalizedMarket | null> {
    if (!market.id) return null;

    const outcomeNames = parseJsonArray(market.outcomes);
    const tokenIds = parseJsonArray(market.clobTokenIds);
    const outcomePrices = parseJsonArray(market.outcomePrices);

    if (outcomeNames.length !== 2 || tokenIds.length !== 2) return null;

    const yesTokenId = tokenIds[0];
    const noTokenId = tokenIds[1];
    if (!yesTokenId || !noTokenId) return null;

    // Get mid-prices from Gamma API
    const yesMidPrice = toNumber(outcomePrices[0]);
    const noMidPrice = toNumber(outcomePrices[1]);

    const [yesBook, noBook] = await Promise.all([
      this.fetchOrderBook(yesTokenId),
      this.fetchOrderBook(noTokenId),
    ]);

    const outcomes: NormalizedOutcome[] = [
      {
        id: yesTokenId,
        name: outcomeNames[0] || "Yes",
        midPrice: yesMidPrice,
        bestBid: yesBook.bestBid,
        bestAsk: yesBook.bestAsk,
        availableLiquidity: yesBook.liquidity,
      },
      {
        id: noTokenId,
        name: outcomeNames[1] || "No",
        midPrice: noMidPrice,
        bestBid: noBook.bestBid,
        bestAsk: noBook.bestAsk,
        availableLiquidity: noBook.liquidity,
      },
    ];

    return {
      id: market.id,
      slug: market.slug ?? event.slug,
      question: market.question ?? event.title ?? "",
      description: market.description, // Resolution rules
      status: "active",
      eventId: event.id,
      eventSlug: event.slug,
      eventTitle: event.title,
      eventStartDate: event.startDate ? new Date(event.startDate) : null,
      eventEndDate: event.endDate ? new Date(event.endDate) : null,
      endsAt: market.endDate ? new Date(market.endDate) : null,
      outcomes,
      tags: event.tags?.map((t) => t.slug) ?? [],
    };
  }

  /**
   * Get normalized markets with order book data
   * Fetches top 500 events in parallel (5 batches of 100)
   */
  async getNormalizedMarkets(): Promise<NormalizedMarket[]> {
    const now = Date.now();

    // Use cache if still fresh
    if (this.cachedMarkets.length && now - this.lastFetchedAt < config.pollIntervalMs) {
      return this.cachedMarkets;
    }

    // If already polling, wait for existing poll to complete (don't return empty cache)
    if (this.pollingPromise) {
      logger.info("Polymarket: Waiting for existing poll to complete...");
      return this.pollingPromise;
    }

    // Start new poll
    this.pollingPromise = this.fetchMarketsInternal()
      .catch((error: Error) => {
        logger.error("Failed to fetch markets", { error: error.message });
        return this.cachedMarkets;
      })
      .finally(() => {
        this.pollingPromise = null;
        this.isPolling = false;
      });

    this.isPolling = true;
    return this.pollingPromise;
  }

  private async fetchMarketsInternal(): Promise<NormalizedMarket[]> {
    const startTime = Date.now();

    // Step 1: Fetch 500 events in parallel (5 batches)
    const eventsStart = Date.now();
    const events = await this.fetchTopEvents();
    const eventsTime = Date.now() - eventsStart;

    // Collect candidate markets
    const candidateMarkets: { event: GammaEvent; market: GammaMarket }[] = [];
    let totalMarkets = 0;

    for (const event of events) {
      if (!event.markets) continue;
      for (const market of event.markets) {
        totalMarkets++;
        if (this.mightBeInteresting(market)) {
          candidateMarkets.push({ event, market });
        }
      }
    }

    logger.info("Fetched events", {
      events: events.length,
      totalMarkets,
      candidates: candidateMarkets.length,
      eventsTimeMs: eventsTime,
    });

    // Step 2: Fetch order books in parallel batches
    const orderBooksStart = Date.now();
    const batchSize = 50;
    const allMarkets: NormalizedMarket[] = [];

    for (let i = 0; i < candidateMarkets.length; i += batchSize) {
      const batch = candidateMarkets.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(({ event, market }) => this.enrichWithOrderBook(event, market)),
      );

      for (const m of results) {
        if (m) allMarkets.push(m);
      }
    }

    const orderBooksTime = Date.now() - orderBooksStart;
    const totalTime = Date.now() - startTime;

    this.cachedMarkets = allMarkets;
    this.lastFetchedAt = Date.now();

    logger.info("Fetched markets with order books", {
      markets: allMarkets.length,
      orderBooksTimeMs: orderBooksTime,
      totalTimeMs: totalTime,
    });

    return allMarkets;
  }

  /**
   * Get markets with basic pricing (mid-prices only, no order books)
   * This is fast and suitable for initial text matching.
   * Use enrichMarketsWithOrderBooks() after matching to get order book data.
   */
  async getMarketsBasic(): Promise<NormalizedMarket[]> {
    const startTime = Date.now();

    // Fetch events
    const events = await this.fetchTopEvents();

    // Collect all binary markets with basic pricing
    const markets: NormalizedMarket[] = [];

    for (const event of events) {
      if (!event.markets) continue;

      for (const market of event.markets) {
        if (!market.id) continue;

        const outcomeNames = parseJsonArray(market.outcomes);
        const tokenIds = parseJsonArray(market.clobTokenIds);
        const outcomePrices = parseJsonArray(market.outcomePrices);

        // Only binary markets
        if (outcomeNames.length !== 2 || tokenIds.length !== 2) continue;

        const yesMidPrice = toNumber(outcomePrices[0]);
        const noMidPrice = toNumber(outcomePrices[1]);

        // Skip markets with no pricing
        if (yesMidPrice === null && noMidPrice === null) continue;

        const outcomes: NormalizedOutcome[] = [
          {
            id: tokenIds[0] || "yes",
            name: outcomeNames[0] || "Yes",
            midPrice: yesMidPrice,
            bestBid: yesMidPrice ? yesMidPrice - 0.01 : null, // Estimate
            bestAsk: yesMidPrice ? yesMidPrice + 0.01 : null,
            availableLiquidity: 0,
          },
          {
            id: tokenIds[1] || "no",
            name: outcomeNames[1] || "No",
            midPrice: noMidPrice,
            bestBid: noMidPrice ? noMidPrice - 0.01 : null,
            bestAsk: noMidPrice ? noMidPrice + 0.01 : null,
            availableLiquidity: 0,
          },
        ];

        markets.push({
          id: market.id,
          slug: market.slug ?? event.slug,
          question: market.question ?? event.title ?? "",
          description: market.description,
          status: "active",
          eventId: event.id,
          eventSlug: event.slug,
          eventTitle: event.title,
          eventStartDate: event.startDate ? new Date(event.startDate) : null,
          eventEndDate: event.endDate ? new Date(event.endDate) : null,
          endsAt: market.endDate ? new Date(market.endDate) : null,
          outcomes,
          liquidity: toNumber(market.liquidity) ?? undefined,
          volume: toNumber(market.volume) ?? undefined,
          tags: event.tags?.map((t) => t.slug) ?? [],
          _tokenIds: tokenIds, // Keep for later order book fetch
        });
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info("Fetched markets (basic pricing)", {
      markets: markets.length,
      totalTimeMs: totalTime,
    });

    return markets;
  }

  /**
   * Enrich specific markets with order book data.
   * Call this after matching to get accurate bid/ask prices.
   */
  async enrichMarketsWithOrderBooks(markets: NormalizedMarket[]): Promise<NormalizedMarket[]> {
    const startTime = Date.now();
    const enriched: NormalizedMarket[] = [];

    // Batch fetch order books
    const batchSize = 20;
    for (let i = 0; i < markets.length; i += batchSize) {
      const batch = markets.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(async (market) => {
          const tokenIds = (market as NormalizedMarket & { _tokenIds?: string[] })._tokenIds;
          if (!tokenIds || tokenIds.length !== 2) return market;

          const [yesBook, noBook] = await Promise.all([
            this.fetchOrderBook(tokenIds[0]!),
            this.fetchOrderBook(tokenIds[1]!),
          ]);

          return {
            ...market,
            outcomes: [
              {
                ...market.outcomes[0]!,
                bestBid: yesBook.bestBid,
                bestAsk: yesBook.bestAsk,
                availableLiquidity: yesBook.liquidity,
              },
              {
                ...market.outcomes[1]!,
                bestBid: noBook.bestBid,
                bestAsk: noBook.bestAsk,
                availableLiquidity: noBook.liquidity,
              },
            ],
          };
        }),
      );

      enriched.push(...results);
    }

    const totalTime = Date.now() - startTime;
    logger.info("Enriched markets with order books", {
      markets: enriched.length,
      totalTimeMs: totalTime,
    });

    return enriched;
  }

  /**
   * Fetch a single market by ID to check resolution status.
   * Returns the actual API fields for market status.
   */
  async getMarketById(marketId: string): Promise<{
    closed: boolean; // Market trading is closed
    active: boolean; // Market is active (not archived)
    acceptingOrders: boolean | null; // Order book accepting orders
    resolved: boolean; // Market is closed AND one outcome price = 1 (winner determined)
    winningOutcome?: string; // "Yes" | "No" | undefined
    resolvedAt?: Date;
    outcomePrices: [number, number] | null; // Raw outcome prices from API
  } | null> {
    try {
      const url = `${this.gammaBase}/markets/${marketId}`;
      const market = await this.fetchJson<{
        id: string;
        closed?: boolean;
        active?: boolean;
        acceptingOrders?: boolean | null;
        resolutionSource?: string;
        resolution?: string;
        outcomes?: string;
        outcomePrices?: string;
        endDate?: string;
        updatedAt?: string;
      }>(url);

      if (!market || !market.id) {
        return null;
      }

      const closed = market.closed ?? false;
      const active = market.active ?? true;
      const acceptingOrders = market.acceptingOrders ?? null;
      const outcomePricesArr = parseJsonArray(market.outcomePrices);
      const outcomes = parseJsonArray(market.outcomes);

      const price0 = toNumber(outcomePricesArr[0]);
      const price1 = toNumber(outcomePricesArr[1]);

      // Market is resolved when:
      // 1. Market is closed AND
      // 2. One outcome has price = 1 (winner pays out $1)
      // Note: The API's `resolution` field is often null even for resolved markets,
      // so we rely on price = 1 to determine the winner (only when market is closed)
      let resolved = false;
      let winningOutcome: string | undefined;

      if (closed && price0 !== null && price1 !== null) {
        if (price0 === 1) {
          resolved = true;
          winningOutcome = outcomes[0] || "Yes";
        } else if (price1 === 1) {
          resolved = true;
          winningOutcome = outcomes[1] || "No";
        }
        // If closed but no price = 1, market is in review (not yet resolved)
      }

      return {
        closed,
        active,
        acceptingOrders,
        resolved,
        winningOutcome,
        resolvedAt: resolved && market.updatedAt ? new Date(market.updatedAt) : undefined,
        outcomePrices: price0 !== null && price1 !== null ? [price0, price1] : null,
      };
    } catch (error) {
      logger.error("Failed to fetch market by ID", {
        marketId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Fetch market outcomes with token IDs.
   * Returns array of {name, tokenId} for each outcome.
   */
  async getMarketOutcomes(
    marketId: string,
  ): Promise<{ outcomes: Array<{ name: string; tokenId: string }> } | null> {
    try {
      const url = `${this.gammaBase}/markets/${marketId}`;
      const market = await this.fetchJson<{
        id: string;
        outcomes?: string;
        clobTokenIds?: string;
      }>(url);

      if (!market || !market.id) {
        return null;
      }

      const outcomeNames = parseJsonArray(market.outcomes);
      const tokenIds = parseJsonArray(market.clobTokenIds);

      if (outcomeNames.length !== tokenIds.length) {
        return null;
      }

      const outcomes = outcomeNames.map((name, index) => ({
        name: name || (index === 0 ? "Yes" : "No"),
        tokenId: tokenIds[index] || "",
      }));

      return { outcomes };
    } catch (error) {
      logger.error("Failed to fetch market outcomes", {
        marketId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getMarketTags(marketId: string): Promise<string[]> {
    try {
      const marketUrl = `${this.gammaBase}/markets/${marketId}`;
      const market = await this.fetchJson<{ slug?: string }>(marketUrl);

      if (!market?.slug) {
        return [];
      }

      const eventUrl = `${this.gammaBase}/events?slug=${market.slug}`;
      const events = await this.fetchJson<GammaEvent[]>(eventUrl);

      if (!events || events.length === 0 || !events[0]?.tags) {
        return [];
      }

      return events[0].tags.map((t) => t.slug);
    } catch (error) {
      logger.warn("Failed to fetch market tags", {
        marketId,
        error: (error as Error).message,
      });
      return [];
    }
  }
}

// Singleton instance for shared market fetching across all bot instances
let sharedInstance: PolymarketClient | null = null;

/**
 * Get a shared PolymarketClient instance.
 * Use this when multiple bots need to fetch the same market data
 * to avoid duplicate API calls.
 */
export function getSharedPolymarketClient(): PolymarketClient {
  if (!sharedInstance) {
    sharedInstance = new PolymarketClient();
  }
  return sharedInstance;
}
