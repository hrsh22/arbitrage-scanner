/**
 * Cron: Run Trading Bot Scan Cycle
 * 
 * Standalone script to run one trading bot scan cycle.
 * Usage: npm run cron:scan
 * 
 * Logging levels:
 * - info: Flow information, key events
 * - debug: Detailed data dumps for debugging
 */

import "dotenv/config"
import { getTradingBot } from "../bot/tradingBot.js"
import { BOT_CONFIG } from "../bot/config.js"
import { logger } from "../logger.js"

async function main() {
    const startTime = Date.now()

    logger.info("=== CRON: Trading Bot Scan Started ===")
    logger.debug("Bot configuration", {
        betSize: BOT_CONFIG.BET_SIZE,
        dailyBudget: BOT_CONFIG.DAILY_BUDGET,
        minOdds: BOT_CONFIG.MIN_ODDS,
        maxOdds: BOT_CONFIG.MAX_ODDS,
        maxHoursGeneral: BOT_CONFIG.MAX_HOURS_GENERAL,
        maxHoursHighOdds: BOT_CONFIG.MAX_HOURS_FOR_HIGH_ODDS,
        minLiquidity: BOT_CONFIG.MIN_LIQUIDITY,
    })

    try {
        const bot = getTradingBot()

        // Step 1: Initialize bot
        logger.info("Step 1: Initializing trading bot")
        await bot.initialize()

        const status = await bot.getStatus()
        logger.info("Bot initialized", {
            mode: status.mode,
            isRunning: status.isRunning
        })
        logger.debug("Full bot status", { ...status })

        // Step 2: Get current opportunities before scan
        logger.info("Step 2: Fetching current opportunities")
        const opportunitiesBefore = await bot.getCurrentOpportunities()
        const bettableBefore = opportunitiesBefore.filter(o => o.canBet)

        logger.info("Opportunities found", {
            total: opportunitiesBefore.length,
            bettable: bettableBefore.length,
            skipped: opportunitiesBefore.length - bettableBefore.length,
        })

        // Debug: Log bettable opportunities
        if (bettableBefore.length > 0) {
            logger.debug("Bettable opportunities", {
                opportunities: bettableBefore.map(o => ({
                    market: o.marketQuestion?.substring(0, 50),
                    outcome: o.outcome,
                    probability: o.probability,
                    buyPrice: o.buyPrice,
                    hoursUntilClose: o.hoursUntilClose,
                    pphScore: o.pphScore,
                    maxInvestment: o.maxInvestment,
                    maxProfitPercent: o.maxProfitPercent,
                }))
            })
        }

        // Debug: Log skip reasons summary
        const skipReasons = opportunitiesBefore
            .filter(o => !o.canBet && o.skipReason)
            .reduce((acc, o) => {
                const reason = o.skipReason?.split(",")[0] || "unknown"
                acc[reason] = (acc[reason] || 0) + 1
                return acc
            }, {} as Record<string, number>)

        if (Object.keys(skipReasons).length > 0) {
            logger.debug("Skip reasons breakdown", skipReasons)
        }

        // Step 3: Run scan cycle
        logger.info("Step 3: Running scan cycle")
        const scanStart = Date.now()
        await bot.runScanCycle()
        const scanDuration = Date.now() - scanStart

        logger.info("Scan cycle executed", { scanDurationMs: scanDuration })

        // Step 4: Get updated status
        logger.info("Step 4: Fetching updated status")
        const finalStatus = await bot.getStatus()
        logger.debug("Final bot status", { ...finalStatus })

        // Summary
        const totalDuration = Date.now() - startTime
        logger.info("=== CRON: Trading Bot Scan Completed ===", {
            totalDurationMs: totalDuration,
            scanDurationMs: scanDuration,
            opportunitiesFound: opportunitiesBefore.length,
            bettableOpportunities: bettableBefore.length,
            mode: finalStatus.mode,
        })

        process.exit(0)
    } catch (error) {
        const duration = Date.now() - startTime
        logger.error("=== CRON: Trading Bot Scan FAILED ===", {
            error: (error as Error).message,
            stack: (error as Error).stack,
            durationMs: duration,
        })
        process.exit(1)
    }
}

void main()
