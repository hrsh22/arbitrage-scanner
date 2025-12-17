import { config } from "../config.js"
import { logger } from "../logger.js"
import type { NormalizedMarket, NormalizedOutcome } from "../types.js"

type GammaMarket = {
  id?: string
  slug?: string
  question?: string
  endDate?: string
  outcomes?: string
  outcomePrices?: string
  clobTokenIds?: string
}

type GammaEvent = {
  id?: string
  slug?: string
  title?: string
  startDate?: string
  endDate?: string
  markets?: GammaMarket[]
}

type ClobBook = {
  market: string
  asset_id: string
  bids: { price: string; size: string }[]
  asks: { price: string; size: string }[]
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const parseJsonArray = (value: string | undefined): string[] => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export class PolymarketClient {
  private gammaBase = config.gammaBaseUrl.replace(/\/$/, "")
  private clobBase = config.clobBaseUrl.replace(/\/$/, "")
  private cachedMarkets: NormalizedMarket[] = []
  private lastFetchedAt = 0
  private isPolling = false
  private pollingPromise: Promise<NormalizedMarket[]> | null = null

  private async fetchJson<T>(url: string): Promise<T> {
    for (let attempt = 0; attempt <= config.requestRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`)
        }
        return (await response.json()) as T
      } catch (error) {
        if (attempt >= config.requestRetries) {
          throw error
        }
        const backoffMs = 200 * (attempt + 1)
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      } finally {
        clearTimeout(timeout)
      }
    }
    throw new Error("Request retries exceeded")
  }

  /**
   * Fetch order book for a specific token from CLOB API
   */
  private async fetchOrderBook(tokenId: string): Promise<{ bestBid: number | null; bestAsk: number | null; liquidity: number }> {
    try {
      const url = `${this.clobBase}/book?token_id=${tokenId}`
      const book = await this.fetchJson<ClobBook>(url)

      let bestBid: number | null = null
      if (book.bids && book.bids.length > 0) {
        const bidPrices = book.bids.map((b) => Number(b.price)).filter((p) => Number.isFinite(p))
        bestBid = bidPrices.length > 0 ? Math.max(...bidPrices) : null
      }

      let bestAsk: number | null = null
      let liquidity = 0
      if (book.asks && book.asks.length > 0) {
        const askPrices = book.asks.map((a) => Number(a.price)).filter((p) => Number.isFinite(p))
        bestAsk = askPrices.length > 0 ? Math.min(...askPrices) : null

        if (bestAsk !== null) {
          const bestAskEntry = book.asks.find((a) => Number(a.price) === bestAsk)
          if (bestAskEntry) {
            liquidity = Number(bestAskEntry.size) * bestAsk
          }
        }
      }

      return { bestBid, bestAsk, liquidity }
    } catch {
      return { bestBid: null, bestAsk: null, liquidity: 0 }
    }
  }

  /**
   * Fetch a batch of events (100 per request)
   */
  private async fetchEventsBatch(offset: number): Promise<GammaEvent[]> {
    const url = `${this.gammaBase}/events?` +
      `closed=false&active=true&` +
      `order=liquidity&ascending=false&` +
      `limit=100&offset=${offset}`

    try {
      const events = await this.fetchJson<GammaEvent[]>(url)
      return events || []
    } catch (error) {
      logger.error("Failed to fetch events batch", { offset, error: (error as Error).message })
      return []
    }
  }

  /**
   * Fetch 500 events in parallel (5 batches of 100) sorted by liquidity
   * PLUS fetch 100 events closing soon to ensure near-resolution coverage
   */
  private async fetchTopEvents(): Promise<GammaEvent[]> {
    const batchOffsets = [0, 100, 200, 300, 400]

    // Fetch top liquidity batches
    const liquidityPromise = Promise.all(
      batchOffsets.map((offset) => this.fetchEventsBatch(offset))
    )

    // Fetch events closing soon (sort by endDate ascending)
    // Filter for active events closing in the future
    const now = new Date().toISOString()
    const soonUrl = `${this.gammaBase}/events?` +
      `closed=false&active=true&` +
      `order=endDate&ascending=true&` +
      `end_date_min=${now}&` +
      `limit=100`

    const soonPromise = this.fetchJson<GammaEvent[]>(soonUrl).catch(err => {
      logger.error("Failed to fetch failing-soon events", { error: (err as Error).message })
      return []
    })

    const [liquidityBatches, soonEvents] = await Promise.all([
      liquidityPromise,
      soonPromise
    ])

    // Combine results
    const allEvents: GammaEvent[] = []

    // Add liquidity events
    for (const batch of liquidityBatches) {
      allEvents.push(...batch)
    }

    // Add soon events (avoiding duplicates)
    const existingIds = new Set(allEvents.map(e => e.id))
    if (soonEvents) {
      for (const event of soonEvents) {
        if (!existingIds.has(event.id)) {
          allEvents.push(event)
          existingIds.add(event.id)
        }
      }
    }

    return allEvents.slice(0, config.maxEvents + 100) // Allow slightly more events
  }

  /**
   * Check if a market is interesting for arbitrage or near-resolution detection.
   * 
   * Includes markets where:
   * - Any outcome has extreme price (< 10% or > 90%) - good for arbitrage
   * - Any outcome has high probability (> 80%) - good for near-resolution
   */
  private mightBeInteresting(market: GammaMarket): boolean {
    const outcomeNames = parseJsonArray(market.outcomes)
    const outcomePrices = parseJsonArray(market.outcomePrices)

    if (outcomeNames.length !== 2 || outcomePrices.length !== 2) return false

    const price1 = toNumber(outcomePrices[0])
    const price2 = toNumber(outcomePrices[1])

    if (price1 === null || price2 === null) return false

    const minPrice = Math.min(price1, price2)
    const maxPrice = Math.max(price1, price2)

    // Include if:
    // - Extreme prices (arbitrage candidates): minPrice < 0.10 or > 0.90
    // - High probability (near-resolution candidates): maxPrice > 0.80
    return minPrice < 0.10 || maxPrice > 0.80
  }

  /**
   * Normalize a market with order book data
   */
  private async enrichWithOrderBook(event: GammaEvent, market: GammaMarket): Promise<NormalizedMarket | null> {
    if (!market.id) return null

    const outcomeNames = parseJsonArray(market.outcomes)
    const tokenIds = parseJsonArray(market.clobTokenIds)
    const outcomePrices = parseJsonArray(market.outcomePrices)

    if (outcomeNames.length !== 2 || tokenIds.length !== 2) return null

    const yesTokenId = tokenIds[0]
    const noTokenId = tokenIds[1]
    if (!yesTokenId || !noTokenId) return null

    // Get mid-prices from Gamma API
    const yesMidPrice = toNumber(outcomePrices[0])
    const noMidPrice = toNumber(outcomePrices[1])

    const [yesBook, noBook] = await Promise.all([
      this.fetchOrderBook(yesTokenId),
      this.fetchOrderBook(noTokenId),
    ])

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
    ]

    return {
      id: market.id,
      slug: market.slug ?? event.slug,
      question: market.question ?? event.title ?? "",
      status: "active",
      eventId: event.id,
      eventSlug: event.slug,
      eventTitle: event.title,
      eventStartDate: event.startDate ? new Date(event.startDate) : null,
      eventEndDate: event.endDate ? new Date(event.endDate) : null,
      endsAt: market.endDate ? new Date(market.endDate) : null,
      outcomes,
    }
  }

  /**
   * Get normalized markets with order book data
   * Fetches top 500 events in parallel (5 batches of 100)
   */
  async getNormalizedMarkets(): Promise<NormalizedMarket[]> {
    const now = Date.now()

    // Use cache if still fresh
    if (this.cachedMarkets.length && now - this.lastFetchedAt < config.pollIntervalMs) {
      return this.cachedMarkets
    }

    // If already polling, wait for existing poll to complete (don't return empty cache)
    if (this.pollingPromise) {
      logger.info("Polymarket: Waiting for existing poll to complete...")
      return this.pollingPromise
    }

    // Start new poll
    this.pollingPromise = this.fetchMarketsInternal()
      .catch((error: Error) => {
        logger.error("Failed to fetch markets", { error: error.message })
        return this.cachedMarkets
      })
      .finally(() => {
        this.pollingPromise = null
        this.isPolling = false
      })

    this.isPolling = true
    return this.pollingPromise
  }

  private async fetchMarketsInternal(): Promise<NormalizedMarket[]> {
    const startTime = Date.now()

    // Step 1: Fetch 500 events in parallel (5 batches)
    const eventsStart = Date.now()
    const events = await this.fetchTopEvents()
    const eventsTime = Date.now() - eventsStart

    // Collect candidate markets
    const candidateMarkets: { event: GammaEvent; market: GammaMarket }[] = []
    let totalMarkets = 0

    for (const event of events) {
      if (!event.markets) continue
      for (const market of event.markets) {
        totalMarkets++
        if (this.mightBeInteresting(market)) {
          candidateMarkets.push({ event, market })
        }
      }
    }

    logger.info("Fetched events", {
      events: events.length,
      totalMarkets,
      candidates: candidateMarkets.length,
      eventsTimeMs: eventsTime,
    })

    // Step 2: Fetch order books in parallel batches
    const orderBooksStart = Date.now()
    const batchSize = 50
    const allMarkets: NormalizedMarket[] = []

    for (let i = 0; i < candidateMarkets.length; i += batchSize) {
      const batch = candidateMarkets.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map(({ event, market }) => this.enrichWithOrderBook(event, market))
      )

      for (const m of results) {
        if (m) allMarkets.push(m)
      }
    }

    const orderBooksTime = Date.now() - orderBooksStart
    const totalTime = Date.now() - startTime

    this.cachedMarkets = allMarkets
    this.lastFetchedAt = Date.now()

    logger.info("Fetched markets with order books", {
      markets: allMarkets.length,
      orderBooksTimeMs: orderBooksTime,
      totalTimeMs: totalTime,
    })

    return allMarkets
  }
}
