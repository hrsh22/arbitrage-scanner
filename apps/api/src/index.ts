import express from "express"
import { config } from "./config.js"
import { db, pool } from "./db/client.js"
import { OpportunityStore } from "./services/opportunityStore.js"
import { PolymarketClient } from "./clients/polymarketClient.js"
import { KalshiClient } from "./clients/kalshiClient.js"
import { OpportunityRepository } from "./db/repositories/opportunityRepository.js"
import { MarketPoller } from "./services/marketPoller.js"
import { buildOpportunitiesRouter } from "./routes/opportunities.js"
import { detectCrossPlatformArbitrage, type CrossPlatformOpportunity } from "./services/crossPlatformDetector.js"
import { logger } from "./logger.js"

const app = express()

// CORS headers
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.header("Access-Control-Allow-Headers", "Content-Type")
  next()
})

app.use(express.json())

const store = new OpportunityStore()
const repository = new OpportunityRepository()
const polyClient = new PolymarketClient()
const kalshiClient = new KalshiClient()
const poller = new MarketPoller(polyClient, store, repository)

// Cache for cross-platform opportunities
let crossPlatformCache: CrossPlatformOpportunity[] = []
let crossPlatformLastUpdated: string | null = null

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    lastUpdated: store.getLastUpdated(),
  })
})

// Database health check
app.get("/health/db", async (_req, res) => {
  try {
    await db.execute("select 1")
    res.status(200).json({ status: "ok" })
  } catch (error) {
    res.status(500).json({ status: "error", error: (error as Error).message })
  }
})

// Opportunities API (Polymarket single-market)
app.use("/opportunities", buildOpportunitiesRouter(store, repository))

// Cross-platform arbitrage API
app.get("/cross-platform", async (_req, res) => {
  try {
    // Get markets from both platforms
    logger.info("Cross-platform: Starting fetch...")

    const [polyMarkets, kalshiMarkets] = await Promise.all([
      polyClient.getNormalizedMarkets(),
      kalshiClient.getMarkets(),
    ])

    logger.info("Cross-platform: Markets fetched", {
      polymarketCount: polyMarkets.length,
      kalshiCount: kalshiMarkets.length,
    })

    // Detect cross-platform opportunities (includes AI verification)
    const opportunities = await detectCrossPlatformArbitrage(polyMarkets, kalshiMarkets)

    crossPlatformCache = opportunities
    crossPlatformLastUpdated = new Date().toISOString()

    // Filter by confidence if requested
    const minConfidence = Number((_req.query as { minConfidence?: string }).minConfidence) || 0

    const filtered = opportunities.filter((o) => o.matchConfidence >= minConfidence)
    const arbCount = opportunities.filter((o) => o.arbitrage.type !== "none").length

    logger.info("Cross-platform: Complete", {
      totalMatches: opportunities.length,
      withArbitrage: arbCount,
    })

    res.json({
      opportunities: filtered,
      total: opportunities.length,
      withArbitrage: arbCount,
      lastUpdated: crossPlatformLastUpdated,
    })
  } catch (error) {
    logger.error("Cross-platform fetch failed", { error: (error as Error).message })
    res.status(500).json({ error: (error as Error).message })
  }
})

// Get Kalshi markets (for debugging)
app.get("/kalshi/markets", async (_req, res) => {
  try {
    const markets = await kalshiClient.getMarkets()
    res.json({ markets, count: markets.length })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

// Near-resolution high-confidence opportunities
app.get("/opportunities/near-resolution", async (req, res) => {
  try {
    const query = req.query as {
      maxHours?: string
      minOdds?: string
      sort?: string
    }

    // Parse filter options from query params
    // minOdds is in cents (0-100), default 95 cents
    const maxHoursUntilClose = query.maxHours ? Number(query.maxHours) : 24
    const minOdds = query.minOdds ? Number(query.minOdds) : 95
    const sort = (query.sort as "time" | "odds") ?? "time"

    // Get markets from Polymarket
    const markets = await polyClient.getNormalizedMarkets()

    // Detect near-resolution opportunities
    const { detectNearResolution } = await import("./services/detectors.js")
    const opportunities = detectNearResolution(markets, {
      maxHoursUntilClose,
      minOdds,
      sort,
    })

    res.json({
      opportunities,
      total: opportunities.length,
      filters: {
        maxHours: maxHoursUntilClose,
        minOdds,
        sort,
      },
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    logger.error("Near-resolution fetch failed", { error: (error as Error).message })
    res.status(500).json({ error: (error as Error).message })
  }
})


const port = config.port
const host = config.host

const start = async () => {
  await poller.start()
  app.listen(port, host, () => {
    logger.info("API listening", { host, port })
  })
}

void start()

const shutdown = async () => {
  logger.info("shutting down")
  await poller.stop()
  await pool.end()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
