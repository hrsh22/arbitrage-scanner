/**
 * Bot API Routes
 * 
 * Endpoints for monitoring and controlling the trading bot.
 */

import { Router } from "express"
import { getTradingBot } from "./tradingBot.js"
import { getBotRepository } from "./repository.js"
import { getTradingClient } from "./tradingClient.js"
import { getResolutionChecker } from "./resolutionChecker.js"
import { BOT_CONFIG } from "./config.js"
import { logger } from "../logger.js"

export function buildBotRouter(): Router {
    const router = Router()
    const bot = getTradingBot()
    const repository = getBotRepository()
    const tradingClient = getTradingClient()

    // ==========================================
    // STATUS & MONITORING
    // ==========================================

    /**
     * GET /bot/status
     * Get current bot status
     */
    router.get("/status", async (_req, res) => {
        try {
            const status = await bot.getStatus()
            res.json({
                ...status,
                config: {
                    betSize: BOT_CONFIG.BET_SIZE,
                    dailyBudget: BOT_CONFIG.DAILY_BUDGET,
                    minOdds: BOT_CONFIG.MIN_ODDS,
                    maxOdds: BOT_CONFIG.MAX_ODDS,
                    scanIntervalMs: BOT_CONFIG.SCAN_INTERVAL_MS,
                },
            })
        } catch (error) {
            logger.error("Bot API: Failed to get status", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    /**
     * GET /bot/wallet
     * Get wallet status (for live mode)
     */
    router.get("/wallet", async (_req, res) => {
        try {
            if (!tradingClient.isInitialized()) {
                res.json({
                    initialized: false,
                    message: "Trading client not initialized. Set POLYMARKET_PRIVATE_KEY to enable.",
                })
                return
            }

            const walletStatus = await tradingClient.checkReadiness()
            res.json({
                initialized: true,
                ...walletStatus,
            })
        } catch (error) {
            logger.error("Bot API: Failed to get wallet status", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    /**
     * GET /bot/opportunities
     * Get currently detected opportunities
     */
    router.get("/opportunities", async (_req, res) => {
        try {
            const opportunities = await bot.getCurrentOpportunities()

            // Separate bettable from skipped
            const bettable = opportunities.filter(o => o.canBet)
            const skipped = opportunities.filter(o => !o.canBet)

            res.json({
                bettable,
                skipped,
                total: opportunities.length,
                bettableCount: bettable.length,
            })
        } catch (error) {
            logger.error("Bot API: Failed to get opportunities", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // ==========================================
    // POSITIONS
    // ==========================================

    /**
     * GET /bot/positions
     * Get all positions (with optional filter)
     */
    router.get("/positions", async (req, res) => {
        try {
            const limit = Number(req.query.limit) || 100
            const positions = await repository.getPositionHistory(limit)

            res.json({
                positions,
                total: positions.length,
            })
        } catch (error) {
            logger.error("Bot API: Failed to get positions", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    /**
     * GET /bot/positions/open
     * Get only open positions
     * Query params: ?simulated=true|false (optional, returns all if not specified)
     */
    router.get("/positions/open", async (req, res) => {
        try {
            const simulatedParam = req.query.simulated as string | undefined
            let isSimulated: boolean | undefined

            if (simulatedParam === "true") {
                isSimulated = true
            } else if (simulatedParam === "false") {
                isSimulated = false
            }

            const positions = await repository.getOpenPositions(isSimulated)

            res.json({
                positions,
                total: positions.length,
                filter: isSimulated !== undefined ? { simulated: isSimulated } : "all",
            })
        } catch (error) {
            logger.error("Bot API: Failed to get open positions", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // ==========================================
    // STATISTICS
    // ==========================================

    /**
     * GET /bot/stats
     * Get overall statistics
     */
    router.get("/stats", async (req, res) => {
        try {
            const isSimulated = req.query.mode !== "live"
            const overall = await repository.getOverallStats(isSimulated)
            const today = await repository.getTodayStats(isSimulated)

            res.json({
                overall,
                today,
                mode: isSimulated ? "simulation" : "live",
            })
        } catch (error) {
            logger.error("Bot API: Failed to get stats", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    /**
     * GET /bot/stats/daily
     * Get daily stats history
     * Query params: ?mode=simulation|live (optional), ?limit=30 (optional)
     */
    router.get("/stats/daily", async (req, res) => {
        try {
            const limit = Number(req.query.limit) || 30
            const modeParam = req.query.mode as string | undefined
            let isSimulated: boolean | undefined

            if (modeParam === "simulation") {
                isSimulated = true
            } else if (modeParam === "live") {
                isSimulated = false
            }

            const history = await repository.getDailyStatsHistory(limit, isSimulated)

            res.json({
                days: history,
                total: history.length,
                filter: modeParam || "all",
            })
        } catch (error) {
            logger.error("Bot API: Failed to get daily stats", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // ==========================================
    // EVENT LOG
    // ==========================================

    /**
     * GET /bot/events
     * Get event log (circuit breakers, errors, trades)
     */
    router.get("/events", async (req, res) => {
        try {
            const limit = Number(req.query.limit) || 100
            const eventType = req.query.type as string | undefined

            const events = eventType
                ? await repository.getEventsByType(eventType, limit)
                : await repository.getRecentEvents(limit)

            res.json({
                events,
                total: events.length,
            })
        } catch (error) {
            logger.error("Bot API: Failed to get events", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // ==========================================
    // CONTROL
    // ==========================================

    /**
     * POST /bot/start
     * Start the trading bot
     */
    router.post("/start", async (_req, res) => {
        try {
            await bot.start()
            const status = await bot.getStatus()

            res.json({
                success: true,
                message: "Bot started",
                status,
            })
        } catch (error) {
            logger.error("Bot API: Failed to start bot", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    /**
     * POST /bot/stop
     * Stop the trading bot
     */
    router.post("/stop", async (_req, res) => {
        try {
            await bot.stop()
            const status = await bot.getStatus()

            res.json({
                success: true,
                message: "Bot stopped",
                status,
            })
        } catch (error) {
            logger.error("Bot API: Failed to stop bot", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    /**
     * POST /bot/mode
     * Switch between simulation and live mode
     */
    router.post("/mode", async (req, res) => {
        try {
            const { mode } = req.body as { mode?: string }

            if (mode !== "simulation" && mode !== "live") {
                res.status(400).json({ error: "Mode must be 'simulation' or 'live'" })
                return
            }

            await bot.setMode(mode)
            const status = await bot.getStatus()

            res.json({
                success: true,
                message: `Mode switched to ${mode}`,
                status,
            })
        } catch (error) {
            logger.error("Bot API: Failed to switch mode", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    // ==========================================
    // CRON-FRIENDLY ENDPOINTS
    // ==========================================

    /**
     * POST /bot/scan
     * Run a single scan cycle (find opportunities, place bets).
     * Designed to be called by external cron job.
     */
    router.post("/scan", async (_req, res) => {
        try {
            const startTime = Date.now()

            // Ensure bot is initialized
            await bot.initialize()

            // Run one scan cycle
            await bot.runScanCycle()

            const status = await bot.getStatus()
            const duration = Date.now() - startTime

            res.json({
                success: true,
                message: "Scan cycle completed",
                durationMs: duration,
                status,
            })
        } catch (error) {
            logger.error("Bot API: Scan failed", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    /**
     * POST /bot/check-resolutions
     * Check all open positions for resolution.
     * Designed to be called by external cron job.
     */
    router.post("/check-resolutions", async (_req, res) => {
        try {
            const resolutionChecker = getResolutionChecker()
            const result = await resolutionChecker.runCheck()

            res.json({
                success: true,
                message: "Resolution check completed",
                ...result,
            })
        } catch (error) {
            logger.error("Bot API: Resolution check failed", { error: (error as Error).message })
            res.status(500).json({ error: (error as Error).message })
        }
    })

    return router
}
