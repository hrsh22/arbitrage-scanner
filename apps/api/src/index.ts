import express from "express"
import { config } from "./config.js"
import { db, pool } from "./db/client.js"
import { OpportunityStore } from "./services/opportunityStore.js"
import { PolymarketClient } from "./clients/polymarketClient.js"
import { KalshiClient } from "./clients/kalshiClient.js"
import { OpportunityRepository } from "./db/repositories/opportunityRepository.js"
import { CrossPlatformRepository } from "./db/repositories/crossPlatformRepository.js"
import { MarketPoller } from "./services/marketPoller.js"
import { CrossPlatformPoller } from "./services/crossPlatformPoller.js"
import { buildOpportunitiesRouter } from "./routes/opportunities.js"
import { buildBotRouter } from "./bot/index.js"
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
const crossPlatformRepository = new CrossPlatformRepository()
const polyClient = new PolymarketClient()
const kalshiClient = new KalshiClient()
const poller = new MarketPoller(polyClient, store, repository)
const crossPlatformPoller = new CrossPlatformPoller(polyClient, kalshiClient, crossPlatformRepository)

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

// Trading Bot API
app.use("/bot", buildBotRouter())

// Cross-platform arbitrage API (reads from DB, populated by background poller)
app.get("/cross-platform", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100

    // Read from database (fast)
    const nearResolutionHours = Number((req.query as { nearResolutionHours?: string }).nearResolutionHours) || undefined
    const sortBy = ((req.query as { sortBy?: string }).sortBy === "endDate" ? "endDate" : "profit") as "profit" | "endDate"
    const opportunities = await crossPlatformRepository.getActive(limit, nearResolutionHours, sortBy)
    const stats = await crossPlatformRepository.getStats()

    // Filter by confidence if requested
    const minConfidence = Number((req.query as { minConfidence?: string }).minConfidence) || 0
    const filtered = opportunities.filter((o) => (o.matchConfidence ?? 0) >= minConfidence)
    const arbCount = opportunities.filter((o) => (o.arbitrage?.profit ?? 0) > 0).length

    res.json({
      opportunities: filtered,
      total: stats.active,
      withArbitrage: arbCount,
      lastUpdated: stats.lastUpdatedAt,
      pagination: {
        offset: 0,
        limit,
        total: stats.active,
        hasMore: false,
      },
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


// ============================================
// Cross-Platform History & Stats API
// ============================================

// Get history of all opportunities (including expired)
app.get("/cross-platform/history", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100
    const includeExpired = req.query.includeExpired !== "false"

    const history = await crossPlatformRepository.getHistory(limit, includeExpired)

    res.json({
      opportunities: history,
      total: history.length,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    logger.error("Cross-platform history fetch failed", { error: (error as Error).message })
    res.status(500).json({ error: (error as Error).message })
  }
})

// Get aggregate statistics for dashboard
app.get("/cross-platform/stats", async (_req, res) => {
  try {
    const stats = await crossPlatformRepository.getHistoryStats()

    res.json({
      ...stats,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    logger.error("Cross-platform stats fetch failed", { error: (error as Error).message })
    res.status(500).json({ error: (error as Error).message })
  }
})

// Get opportunity detail by ID
app.get("/cross-platform/:id", async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" })
      return
    }

    const opportunity = await crossPlatformRepository.getById(id)
    if (!opportunity) {
      res.status(404).json({ error: "Opportunity not found" })
      return
    }

    res.json({ opportunity })
  } catch (error) {
    logger.error("Cross-platform detail fetch failed", { error: (error as Error).message })
    res.status(500).json({ error: (error as Error).message })
  }
})

// Get profit snapshots for a specific opportunity (for charts)
app.get("/cross-platform/:id/snapshots", async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" })
      return
    }

    const snapshots = await crossPlatformRepository.getSnapshots(id)
    const opportunity = await crossPlatformRepository.getById(id)

    res.json({
      opportunity,
      snapshots,
      count: snapshots.length,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    logger.error("Cross-platform snapshots fetch failed", { error: (error as Error).message })
    res.status(500).json({ error: (error as Error).message })
  }
})

const port = config.port
const host = config.host

const start = async () => {
  // Start API server first so it's immediately responsive
  app.listen(port, host, () => {
    logger.info("API listening", { host, port })
  })

  // Note: Trading bot and resolution checker are now run via cron jobs:
  // - pnpm cron:scan (trading bot scan cycle)
  // - pnpm cron:check-resolutions (resolution checker)

  // Start background pollers for market data
  await poller.start()
  await crossPlatformPoller.start()
}

void start()

const shutdown = async () => {
  logger.info("shutting down")

  await poller.stop()
  await crossPlatformPoller.stop()
  await pool.end()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
