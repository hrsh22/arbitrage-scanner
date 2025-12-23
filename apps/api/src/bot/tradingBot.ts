/**
 * Trading Bot - Main autonomous trading loop
 * 
 * Scans for opportunities, evaluates them, and places bets
 * based on the PPH (Profit Per Hour) strategy.
 */

import { BOT_CONFIG, type BotMode } from "./config.js"
import { getTradingClient, TradingClient } from "./tradingClient.js"
import { StrategyEngine } from "./strategyEngine.js"
import { getBotRepository, BotRepository } from "./repository.js"
import type { BotStatus, ScoredOpportunity } from "./types.js"
import { PolymarketClient } from "../clients/polymarketClient.js"
import { detectNearResolution } from "../services/detectors.js"
import { logger } from "../logger.js"
import { env } from "../env.js"

export class TradingBot {
    private isRunning = false
    private mode: BotMode = BOT_CONFIG.DEFAULT_MODE
    private scanInterval: NodeJS.Timeout | null = null
    private lastScanAt: Date | null = null

    private tradingClient: TradingClient
    private strategyEngine: StrategyEngine
    private repository: BotRepository
    private polyClient: PolymarketClient

    constructor() {
        this.tradingClient = getTradingClient()
        this.strategyEngine = new StrategyEngine(this.tradingClient)
        this.repository = getBotRepository()
        this.polyClient = new PolymarketClient()
    }

    /**
     * Initialize the bot (load mode from env, init trading client if needed)
     */
    async initialize(): Promise<void> {
        // Load mode from environment variable
        this.mode = env.BOT_MODE

        logger.info("TradingBot: Initialized", { mode: this.mode })

        // Initialize trading client with private key if in live mode
        if (this.mode === "live") {
            await this.initializeTradingClient()
        }
    }

    /**
     * Initialize the trading client with private key
     */
    private async initializeTradingClient(): Promise<void> {
        const privateKey = env.POLYMARKET_PRIVATE_KEY

        if (!privateKey) {
            logger.warn("TradingBot: No private key configured. Live trading disabled.")
            await this.repository.logEvent({
                eventType: "error",
                eventName: "no_private_key",
                message: "POLYMARKET_PRIVATE_KEY not set. Cannot trade in live mode.",
            })
            return
        }

        try {
            await this.tradingClient.initialize(privateKey)
            logger.info("TradingBot: Trading client initialized")
        } catch (error) {
            logger.error("TradingBot: Failed to initialize trading client", {
                error: (error as Error).message,
            })
            await this.repository.logEvent({
                eventType: "error",
                eventName: "trading_client_init_failed",
                message: `Failed to initialize trading client: ${(error as Error).message}`,
            })
        }
    }

    /**
     * Start the bot
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn("TradingBot: Already running")
            return
        }

        logger.info("TradingBot: Starting", { mode: this.mode })

        await this.repository.logEvent({
            eventType: "info",
            eventName: "bot_started",
            message: `Trading bot started in ${this.mode} mode`,
        })

        this.isRunning = true

        // Run initial scan
        await this.runScanCycle()

        // Start periodic scanning
        this.scanInterval = setInterval(
            () => void this.runScanCycle(),
            BOT_CONFIG.SCAN_INTERVAL_MS
        )
    }

    /**
     * Stop the bot
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            logger.warn("TradingBot: Not running")
            return
        }

        logger.info("TradingBot: Stopping")

        if (this.scanInterval) {
            clearInterval(this.scanInterval)
            this.scanInterval = null
        }

        this.isRunning = false

        await this.repository.logEvent({
            eventType: "info",
            eventName: "bot_stopped",
            message: "Trading bot stopped",
        })
    }

    /**
     * Switch between simulation and live mode
     * Note: This only changes the mode for the current process.
     * To persist, update BOT_MODE in .env
     */
    async setMode(newMode: BotMode): Promise<void> {
        if (newMode === this.mode) {
            return
        }

        const oldMode = this.mode
        this.mode = newMode

        // Initialize trading client if switching to live
        if (newMode === "live" && !this.tradingClient.isInitialized()) {
            await this.initializeTradingClient()
        }

        await this.repository.logEvent({
            eventType: "mode_change",
            eventName: "mode_switched",
            message: `Bot mode changed from ${oldMode} to ${newMode}`,
            metadata: { oldMode, newMode },
        })

        logger.info("TradingBot: Mode changed", { oldMode, newMode })
    }

    /**
     * Main scan cycle - find and bet on opportunities.
     * Can be called directly for cron-style execution.
     */
    async runScanCycle(): Promise<void> {
        const scanStart = Date.now()
        logger.info("TradingBot: Starting scan cycle")

        try {
            // 1. Check safety conditions
            const safetyCheck = await this.checkSafetyConditions()
            if (!safetyCheck.canTrade) {
                logger.info("TradingBot: Cannot trade", { reason: safetyCheck.reason })
                return
            }

            // 2. Get near-resolution opportunities from Polymarket
            const markets = await this.polyClient.getNormalizedMarkets()
            const nearResolutionOpps = detectNearResolution(markets, {
                maxHoursUntilClose: BOT_CONFIG.MAX_HOURS_GENERAL,
                minOdds: BOT_CONFIG.MIN_ODDS * 100, // Convert to cents
            })

            logger.info("TradingBot: Found near-resolution opportunities", {
                count: nearResolutionOpps.length,
            })

            if (nearResolutionOpps.length === 0) {
                this.lastScanAt = new Date()
                return
            }

            // 3. Get existing positions to avoid duplicates (only for same mode)
            const isSimulated = this.mode === "simulation"
            const existingMarketIds = await this.repository.getOpenPositionMarketIds(isSimulated)

            // 4. Evaluate opportunities with strategy engine
            const scoredOpps = await this.strategyEngine.evaluateOpportunities(
                nearResolutionOpps,
                existingMarketIds
            )

            // 5. Determine how many bets we can place
            const remainingBudget = await this.repository.getRemainingBudget(
                BOT_CONFIG.DAILY_BUDGET,
                this.mode === "simulation"
            )
            const maxBets = Math.floor(remainingBudget / BOT_CONFIG.BET_SIZE)

            logger.info("TradingBot: Budget status", {
                remainingBudget,
                maxBets,
                bettableOpportunities: scoredOpps.filter(o => o.canBet).length,
            })

            if (maxBets === 0) {
                logger.info("TradingBot: Daily budget exhausted")
                await this.repository.logEvent({
                    eventType: "info",
                    eventName: "budget_exhausted",
                    message: "Daily budget exhausted. No more bets will be placed today.",
                })
                this.lastScanAt = new Date()
                return
            }

            // 6. Get top opportunities and place bets
            const topOpps = this.strategyEngine.getTopOpportunities(scoredOpps, maxBets)

            for (let i = 0; i < topOpps.length; i++) {
                const opp = topOpps[i]!
                await this.placeBet(opp)

                // Add delay between trades to avoid rate limiting (except for last one)
                if (i < topOpps.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500))
                }
            }

            this.lastScanAt = new Date()
            const scanDuration = Date.now() - scanStart

            logger.info("TradingBot: Scan cycle complete", {
                duration: scanDuration,
                betsPlaced: topOpps.length,
            })
        } catch (error) {
            logger.error("TradingBot: Scan cycle failed", {
                error: (error as Error).message,
            })
            await this.repository.logEvent({
                eventType: "error",
                eventName: "scan_cycle_failed",
                message: `Scan cycle failed: ${(error as Error).message}`,
            })
        }
    }

    /**
     * Check safety conditions before trading
     */
    private async checkSafetyConditions(): Promise<{ canTrade: boolean; reason?: string }> {
        // Check daily loss limit
        const todayStats = await this.repository.getTodayStats(this.mode === "simulation")
        if (todayStats.netPnL < -BOT_CONFIG.MAX_DAILY_LOSS) {
            await this.repository.logEvent({
                eventType: "circuit_breaker",
                eventName: "daily_loss_limit",
                message: `Daily loss limit exceeded: $${Math.abs(todayStats.netPnL).toFixed(2)} lost`,
                metadata: { netPnL: todayStats.netPnL, limit: BOT_CONFIG.MAX_DAILY_LOSS },
            })
            return { canTrade: false, reason: "Daily loss limit exceeded" }
        }

        // If in live mode, check wallet balance
        if (this.mode === "live" && this.tradingClient.isInitialized()) {
            try {
                const balance = await this.tradingClient.getBalance()
                if (balance < BOT_CONFIG.MIN_WALLET_RESERVE) {
                    await this.repository.logEvent({
                        eventType: "circuit_breaker",
                        eventName: "low_balance",
                        message: `Wallet balance ($${balance.toFixed(2)}) below reserve ($${BOT_CONFIG.MIN_WALLET_RESERVE})`,
                        metadata: { balance, reserve: BOT_CONFIG.MIN_WALLET_RESERVE },
                    })
                    return { canTrade: false, reason: "Wallet balance below reserve" }
                }
            } catch (error) {
                await this.repository.logEvent({
                    eventType: "error",
                    eventName: "balance_check_failed",
                    message: `Failed to check wallet balance: ${(error as Error).message}`,
                })
                return { canTrade: false, reason: "Failed to check wallet balance" }
            }
        }

        return { canTrade: true }
    }

    /**
     * Place a bet on an opportunity
     */
    private async placeBet(opportunity: ScoredOpportunity): Promise<void> {
        const isSimulation = this.mode === "simulation"

        logger.info("TradingBot: Placing bet", {
            mode: this.mode,
            market: opportunity.marketQuestion.substring(0, 50),
            outcome: opportunity.outcome,
            probability: opportunity.probability,
            pphScore: opportunity.pphScore,
        })

        try {
            if (isSimulation) {
                // Simulation mode - just record the position
                await this.recordPosition(opportunity, isSimulation)
            } else {
                // Live mode - actually place the trade
                if (!opportunity.tokenId) {
                    logger.warn("TradingBot: No token ID for opportunity, skipping", {
                        marketId: opportunity.marketId,
                    })
                    return
                }

                // Calculate max price with slippage, but cap at 0.999 (API limit)
                const maxPrice = Math.min(opportunity.buyPrice * 1.02, 0.999)

                const result = await this.tradingClient.placeBet(
                    opportunity.tokenId,
                    BOT_CONFIG.BET_SIZE,
                    maxPrice
                )

                if (result.success) {
                    await this.recordPosition(opportunity, isSimulation)
                } else {
                    logger.error("TradingBot: Trade failed", {
                        marketId: opportunity.marketId,
                        error: result.error,
                    })
                    await this.repository.logEvent({
                        eventType: "error",
                        eventName: "trade_failed",
                        message: `Trade failed: ${result.error}`,
                        metadata: { marketId: opportunity.marketId, outcome: opportunity.outcome },
                    })
                }
            }
        } catch (error) {
            logger.error("TradingBot: Failed to place bet", {
                error: (error as Error).message,
            })
            await this.repository.logEvent({
                eventType: "error",
                eventName: "bet_error",
                message: `Failed to place bet: ${(error as Error).message}`,
                metadata: { marketId: opportunity.marketId },
            })
        }
    }

    /**
     * Record a position in the database
     */
    private async recordPosition(
        opportunity: ScoredOpportunity,
        isSimulated: boolean
    ): Promise<void> {
        // Create position
        await this.repository.createPosition({
            marketId: opportunity.marketId,
            marketQuestion: opportunity.marketQuestion,
            marketSlug: opportunity.marketSlug,
            tokenId: opportunity.tokenId,
            outcome: opportunity.outcome,
            entryPrice: opportunity.buyPrice,
            cost: BOT_CONFIG.BET_SIZE,
            closesAt: opportunity.closesAt,
            hoursUntilCloseAtEntry: opportunity.hoursUntilClose,
            pphScore: opportunity.pphScore,
            expectedProfit: opportunity.expectedProfit,
            isSimulated,
        })

        // Update daily stats
        await this.repository.recordBet(BOT_CONFIG.BET_SIZE, isSimulated)

        // Log the trade
        await this.repository.logEvent({
            eventType: "trade",
            eventName: "bet_placed",
            message: `${isSimulated ? "[SIM] " : ""}Bet placed: ${opportunity.outcome} @ ${(opportunity.buyPrice * 100).toFixed(1)}¢ on "${opportunity.marketQuestion.substring(0, 50)}..."`,
            metadata: {
                marketId: opportunity.marketId,
                outcome: opportunity.outcome,
                probability: opportunity.probability,
                buyPrice: opportunity.buyPrice,
                pphScore: opportunity.pphScore,
                hoursUntilClose: opportunity.hoursUntilClose,
                isSimulated,
            },
        })
    }

    /**
     * Get current bot status
     */
    async getStatus(): Promise<BotStatus> {
        const isSimulated = this.mode === "simulation"
        const todayStats = await this.repository.getTodayStats(isSimulated)
        const openPositions = await this.repository.getOpenPositions(isSimulated)
        const remainingBudget = await this.repository.getRemainingBudget(
            BOT_CONFIG.DAILY_BUDGET,
            isSimulated
        )

        let walletBalance: number | undefined
        if (this.mode === "live" && this.tradingClient.isInitialized()) {
            try {
                walletBalance = await this.tradingClient.getBalance()
            } catch {
                // Ignore errors
            }
        }

        return {
            isRunning: this.isRunning,
            mode: this.mode,
            lastScanAt: this.lastScanAt ?? undefined,
            todayBets: todayStats.betsPlaced,
            todayDeployed: todayStats.amountDeployed,
            todayPnL: todayStats.netPnL,
            remainingBudget,
            openPositions: openPositions.length,
            walletBalance,
        }
    }

    /**
     * Get current opportunities (for dashboard)
     */
    async getCurrentOpportunities(): Promise<ScoredOpportunity[]> {
        try {
            const markets = await this.polyClient.getNormalizedMarkets()
            const nearResolutionOpps = detectNearResolution(markets, {
                maxHoursUntilClose: BOT_CONFIG.MAX_HOURS_GENERAL,
                minOdds: BOT_CONFIG.MIN_ODDS * 100,
            })

            const isSimulated = this.mode === "simulation"
            const existingMarketIds = await this.repository.getOpenPositionMarketIds(isSimulated)
            return await this.strategyEngine.evaluateOpportunities(nearResolutionOpps, existingMarketIds)
        } catch (error) {
            logger.error("TradingBot: Failed to get opportunities", {
                error: (error as Error).message,
            })
            return []
        }
    }
}

// Singleton instance
let botInstance: TradingBot | null = null

export function getTradingBot(): TradingBot {
    if (!botInstance) {
        botInstance = new TradingBot()
    }
    return botInstance
}
