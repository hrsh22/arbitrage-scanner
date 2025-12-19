import { logger } from "../logger.js"
import { PolymarketClient } from "../clients/polymarketClient.js"
import { KalshiClient } from "../clients/kalshiClient.js"
import { CrossPlatformRepository } from "../db/repositories/crossPlatformRepository.js"
import { detectCrossPlatformArbitrage } from "./crossPlatformDetector.js"

const POLL_INTERVAL_MS = 30 * 1000 // 30 seconds

/**
 * Backend poller for cross-platform arbitrage detection
 * Runs every 2 minutes and stores results in database
 */
export class CrossPlatformPoller {
    private timer: NodeJS.Timeout | null = null
    private isRunning = false // Lock to prevent concurrent runs

    constructor(
        private readonly polymarketClient: PolymarketClient,
        private readonly kalshiClient: KalshiClient,
        private readonly repository: CrossPlatformRepository,
    ) { }

    /**
     * Start the poller
     */
    async start(): Promise<void> {
        logger.info("CrossPlatformPoller: Starting...")

        // Run immediately on start
        await this.runCycle()

        // Then poll every 2 minutes
        this.timer = setInterval(() => {
            void this.runCycle()
        }, POLL_INTERVAL_MS)

        logger.info("CrossPlatformPoller: Started, polling every 2 minutes")
    }

    /**
     * Stop the poller
     */
    async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        logger.info("CrossPlatformPoller: Stopped")
    }

    /**
     * Run a single detection cycle
     * 
     * Optimized flow:
     * 1. Fetch markets from both platforms (basic pricing, no order books)
     * 2. Text match to find ~35 candidates
     * 3. Fetch order books ONLY for matched Polymarket markets
     * 4. Calculate arbitrage and store
     */
    private async runCycle(): Promise<void> {
        // Skip if already running (lock mechanism)
        if (this.isRunning) {
            logger.info("CrossPlatformPoller: Skipping cycle, previous run still in progress")
            return
        }

        this.isRunning = true
        const cycleStartTime = new Date()
        const startMs = Date.now()

        try {
            logger.info("CrossPlatformPoller: Starting cycle...")

            // Step 1: Fetch markets (fast - no order books for Polymarket)
            const [polymarkets, kalshiMarkets] = await Promise.all([
                this.polymarketClient.getMarketsBasic(),
                this.kalshiClient.getMarkets(),
            ])

            logger.info("CrossPlatformPoller: Fetched markets (basic)", {
                polymarkets: polymarkets.length,
                kalshi: kalshiMarkets.length,
            })

            // Step 2: Run cross-platform detection with basic pricing
            // This will match and calculate arbitrage using mid-prices
            const opportunities = await detectCrossPlatformArbitrage(
                polymarkets,
                kalshiMarkets
            )

            logger.info("CrossPlatformPoller: Detection complete", {
                opportunities: opportunities.length,
            })

            // Step 3: Enrich matched Polymarket markets with order books for accuracy
            // Extract the matched Polymarket IDs
            const matchedPolyIds = new Set(opportunities.map(o => o.polymarket.id))
            const matchedPolyMarkets = polymarkets.filter(m => matchedPolyIds.has(m.id))

            if (matchedPolyMarkets.length > 0) {
                logger.info("CrossPlatformPoller: Enriching matched markets with order books", {
                    count: matchedPolyMarkets.length,
                })
                const enriched = await this.polymarketClient.enrichMarketsWithOrderBooks(matchedPolyMarkets)

                // Update opportunities with accurate order book prices
                const enrichedById = new Map(enriched.map(m => [m.id, m]))
                for (const opp of opportunities) {
                    const enrichedMarket = enrichedById.get(opp.polymarket.id)
                    if (enrichedMarket) {
                        const yesOutcome = enrichedMarket.outcomes[0]
                        const noOutcome = enrichedMarket.outcomes[1]
                        if (yesOutcome) {
                            opp.polymarket.yesBestBid = yesOutcome.bestBid ?? opp.polymarket.yesBestBid
                            opp.polymarket.yesBestAsk = yesOutcome.bestAsk ?? opp.polymarket.yesBestAsk
                        }
                        if (noOutcome) {
                            opp.polymarket.noBestBid = noOutcome.bestBid ?? opp.polymarket.noBestBid
                            opp.polymarket.noBestAsk = noOutcome.bestAsk ?? opp.polymarket.noBestAsk
                        }
                    }
                }
            }

            // Step 4: Store opportunities in database
            if (opportunities.length > 0) {
                await this.repository.upsertOpportunities(opportunities)
            }

            // Mark old opportunities as inactive
            const staleCount = await this.repository.markStaleAsInactive(cycleStartTime)

            // Step 5: Record snapshots for profit history tracking
            // Get current active opportunities from DB with their IDs
            const activeOpps = await this.repository.getActiveWithIds()
            if (activeOpps.length > 0) {
                const snapshotData = activeOpps.map(opp => ({
                    id: opp.id,
                    profitPct: opp.profitPct,
                    spread: opp.spread,
                    polyYesAsk: opp.polyYesAsk,
                    polyNoAsk: opp.polyNoAsk,
                    kalshiYesAsk: opp.kalshiYesAsk,
                    kalshiNoAsk: opp.kalshiNoAsk,
                }))
                await this.repository.recordSnapshots(snapshotData)
                logger.info("CrossPlatformPoller: Recorded snapshots", {
                    count: snapshotData.length,
                })
            }

            const durationMs = Date.now() - startMs

            logger.info("CrossPlatformPoller: Cycle complete", {
                opportunities: opportunities.length,
                staleMarked: staleCount,
                durationMs,
            })

        } catch (error) {
            logger.error("CrossPlatformPoller: Cycle failed", {
                error: (error as Error).message,
                stack: (error as Error).stack,
            })
        } finally {
            this.isRunning = false
        }
    }
}

