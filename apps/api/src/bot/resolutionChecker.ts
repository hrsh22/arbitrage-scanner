/**
 * Resolution Checker - Monitors open positions for market resolution
 * 
 * Periodically checks Polymarket API to see if markets have resolved,
 * then updates positions with win/loss status and USD profit/loss.
 */

import { BOT_CONFIG } from "./config.js"
import { getBotRepository, BotRepository } from "./repository.js"
import { PolymarketClient } from "../clients/polymarketClient.js"
import { logger } from "../logger.js"

export class ResolutionChecker {
    private isRunning = false
    private checkInterval: NodeJS.Timeout | null = null
    private repository: BotRepository
    private polyClient: PolymarketClient

    constructor() {
        this.repository = getBotRepository()
        this.polyClient = new PolymarketClient()
    }

    /**
     * Start the resolution checker
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn("ResolutionChecker: Already running")
            return
        }

        logger.info("ResolutionChecker: Starting")
        this.isRunning = true

        // Run initial check
        await this.runCheck()

        // Start periodic checking
        this.checkInterval = setInterval(
            () => void this.runCheck(),
            BOT_CONFIG.RESOLUTION_CHECK_INTERVAL_MS
        )
    }

    /**
     * Stop the resolution checker
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return
        }

        logger.info("ResolutionChecker: Stopping")

        if (this.checkInterval) {
            clearInterval(this.checkInterval)
            this.checkInterval = null
        }

        this.isRunning = false
    }

    /**
     * Main check cycle - check all open positions for resolution.
     * Can be called directly for cron-style execution.
     */
    async runCheck(): Promise<{ checked: number; resolved: number; won: number; lost: number }> {
        const startTime = Date.now()

        try {
            // Get all open positions
            const openPositions = await this.repository.getOpenPositions()

            if (openPositions.length === 0) {
                logger.info("ResolutionChecker: No open positions to check")
                return { checked: 0, resolved: 0, won: 0, lost: 0 }
            }

            logger.info("ResolutionChecker: Checking positions", { count: openPositions.length })

            let resolved = 0
            let won = 0
            let lost = 0

            for (const position of openPositions) {
                try {
                    const result = await this.checkPosition(position)
                    if (result.resolved) {
                        resolved++
                        if (result.status === "won") won++
                        else if (result.status === "lost") lost++
                    }
                } catch (error) {
                    logger.error("ResolutionChecker: Failed to check position", {
                        positionId: position.id,
                        marketId: position.marketId,
                        error: (error as Error).message,
                    })
                }

                // Small delay between API calls to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 200))
            }

            const duration = Date.now() - startTime
            logger.info("ResolutionChecker: Check complete", {
                checked: openPositions.length,
                resolved,
                won,
                lost,
                durationMs: duration,
            })

            return { checked: openPositions.length, resolved, won, lost }
        } catch (error) {
            logger.error("ResolutionChecker: Check failed", { error: (error as Error).message })
            return { checked: 0, resolved: 0, won: 0, lost: 0 }
        }
    }

    /**
     * Check a single position for resolution
     */
    private async checkPosition(position: {
        id: number
        marketId: string
        outcome: string
        entryPrice: number
        cost: number
        isSimulated: boolean
        status: string
    }): Promise<{ resolved: boolean; status?: "won" | "lost" | "expired"; statusChanged?: boolean }> {
        const marketStatus = await this.polyClient.getMarketById(position.marketId)

        if (!marketStatus) {
            // Market not found - might be deleted/invalid
            logger.warn("ResolutionChecker: Market not found", {
                marketId: position.marketId,
                positionId: position.id,
            })
            return { resolved: false }
        }

        logger.debug("ResolutionChecker: Market status from API", {
            positionId: position.id,
            marketId: position.marketId,
            currentPositionStatus: position.status,
            apiStatus: {
                closed: marketStatus.closed,
                active: marketStatus.active,
                acceptingOrders: marketStatus.acceptingOrders,
                resolved: marketStatus.resolved,
                winningOutcome: marketStatus.winningOutcome,
                outcomePrices: marketStatus.outcomePrices,
            },
        })

        // If market is closed but not resolved yet, it's in review
        if (marketStatus.closed && !marketStatus.resolved) {
            // Update position to "in_review" if it's currently "open"
            if (position.status === "open") {
                await this.repository.updatePositionStatus(position.id, "in_review")

                logger.info("ResolutionChecker: Position moved to in_review", {
                    positionId: position.id,
                    marketId: position.marketId,
                })

                await this.repository.logEvent({
                    eventType: "info",
                    eventName: "position_in_review",
                    message: `${position.isSimulated ? "[SIM] " : ""}Position moved to in_review: ${position.outcome}`,
                    metadata: {
                        positionId: position.id,
                        marketId: position.marketId,
                        outcome: position.outcome,
                        outcomePrices: marketStatus.outcomePrices,
                    },
                })

                return { resolved: false, statusChanged: true }
            }
            return { resolved: false }
        }

        // If market is not resolved, nothing to do
        if (!marketStatus.resolved) {
            return { resolved: false }
        }

        // Market resolved - determine if we won or lost
        const winningOutcome = marketStatus.winningOutcome

        let status: "won" | "lost" | "expired"
        let profitLoss: number

        if (!winningOutcome) {
            // Market was cancelled/expired - no winner
            status = "expired"
            profitLoss = 0 // Assuming refund
        } else if (position.outcome === winningOutcome) {
            // We won!
            status = "won"
            // Profit = (shares * $1 payout) - cost
            // shares = cost / entryPrice
            const shares = position.cost / position.entryPrice
            const payout = shares * 1.0
            profitLoss = payout - position.cost
        } else {
            // We lost
            status = "lost"
            profitLoss = -position.cost
        }

        // Round to 4 decimal places
        profitLoss = Math.round(profitLoss * 10000) / 10000

        // Update position in database
        await this.repository.resolvePosition(position.id, {
            status,
            profitLoss,
        })

        // Update daily stats
        if (status === "won") {
            await this.repository.recordWin(profitLoss, position.isSimulated)
        } else if (status === "lost") {
            await this.repository.recordLoss(Math.abs(profitLoss), position.isSimulated)
        }

        // Log the resolution
        await this.repository.logEvent({
            eventType: "trade",
            eventName: "position_resolved",
            message: `${position.isSimulated ? "[SIM] " : ""}Position ${status}: ${position.outcome} → P/L: $${profitLoss.toFixed(4)}`,
            metadata: {
                positionId: position.id,
                marketId: position.marketId,
                outcome: position.outcome,
                winningOutcome,
                status,
                profitLoss,
                entryPrice: position.entryPrice,
                cost: position.cost,
                isSimulated: position.isSimulated,
                outcomePrices: marketStatus.outcomePrices,
            },
        })

        logger.info("ResolutionChecker: Position resolved", {
            positionId: position.id,
            status,
            profitLoss,
            isSimulated: position.isSimulated,
        })

        return { resolved: true, status }
    }
}

// Singleton instance
let checkerInstance: ResolutionChecker | null = null

export function getResolutionChecker(): ResolutionChecker {
    if (!checkerInstance) {
        checkerInstance = new ResolutionChecker()
    }
    return checkerInstance
}
