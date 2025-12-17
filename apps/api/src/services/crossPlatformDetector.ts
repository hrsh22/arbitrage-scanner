import type { NormalizedMarket } from "../types.js"
import type { KalshiMarket } from "../clients/kalshiClient.js"
import { matchMarkets, type MarketMatch } from "./marketMatcher.js"
import { verifyMatch } from "./aiMatchVerifier.js"
import { logger } from "../logger.js"

export type CrossPlatformOpportunity = {
    id: string
    matchConfidence: number
    matchReason: string
    matchType: "high" | "medium" | "low"
    aiVerified?: boolean

    polymarket: {
        id: string
        question: string
        url: string
        yesBestAsk: number
        noBestAsk: number
    }

    kalshi: {
        ticker: string
        title: string
        url: string
        yesAsk: number
        noAsk: number
    }

    arbitrage: {
        type: "poly-yes-kalshi-no" | "poly-no-kalshi-yes" | "none"
        totalCost: number
        profit: number
        profitPct: number
        instruction: string
    }

    detectedAt: string
}

/**
 * Build Kalshi URL
 * Since market URLs require an event slug we don't have from the API,
 * we link to the event page where the user can find the specific market.
 */
function buildKalshiUrl(kalshi: KalshiMarket): string {
    // Link to the event page - the specific market will be visible there
    return `https://kalshi.com/events/${kalshi.eventTicker}`
}

type ArbitrageResult = CrossPlatformOpportunity["arbitrage"]

/**
 * Calculate cross-platform arbitrage
 */
function calculateArbitrage(match: MarketMatch): ArbitrageResult {
    const poly = match.polymarket
    const kalshi = match.kalshi

    const polyYesAsk = poly.outcomes[0]?.bestAsk ?? null
    const polyNoAsk = poly.outcomes[1]?.bestAsk ?? null
    const kalshiYesAsk = kalshi.yesAsk
    const kalshiNoAsk = kalshi.noAsk

    let bestArbitrage: ArbitrageResult = {
        type: "none",
        totalCost: 1,
        profit: 0,
        profitPct: 0,
        instruction: "No arbitrage available",
    }

    // Strategy 1: Buy Yes on Polymarket + Buy No on Kalshi
    if (polyYesAsk !== null && polyYesAsk > 0 && kalshiNoAsk > 0) {
        const cost1 = polyYesAsk + kalshiNoAsk
        if (cost1 < 1 && cost1 < bestArbitrage.totalCost) {
            const profit = 1 - cost1
            bestArbitrage = {
                type: "poly-yes-kalshi-no",
                totalCost: cost1,
                profit,
                profitPct: (profit / cost1) * 100,
                instruction: `Buy YES on Polymarket @ ${(polyYesAsk * 100).toFixed(1)}¢ + Buy NO on Kalshi @ ${(kalshiNoAsk * 100).toFixed(1)}¢`,
            }
        }
    }

    // Strategy 2: Buy No on Polymarket + Buy Yes on Kalshi
    if (polyNoAsk !== null && polyNoAsk > 0 && kalshiYesAsk > 0) {
        const cost2 = polyNoAsk + kalshiYesAsk
        if (cost2 < 1 && cost2 < bestArbitrage.totalCost) {
            const profit = 1 - cost2
            bestArbitrage = {
                type: "poly-no-kalshi-yes",
                totalCost: cost2,
                profit,
                profitPct: (profit / cost2) * 100,
                instruction: `Buy NO on Polymarket @ ${(polyNoAsk * 100).toFixed(1)}¢ + Buy YES on Kalshi @ ${(kalshiYesAsk * 100).toFixed(1)}¢`,
            }
        }
    }

    return bestArbitrage
}

/**
 * Build opportunity object from match and arbitrage
 */
function buildOpportunity(
    match: MarketMatch,
    arbitrage: ArbitrageResult,
    aiVerified?: boolean,
    aiReason?: string
): CrossPlatformOpportunity {
    const poly = match.polymarket
    const kalshi = match.kalshi

    return {
        id: `${poly.id}-${kalshi.ticker}`,
        matchConfidence: match.confidence,
        matchReason: aiReason
            ? `${match.matchReason} (AI: ${aiReason})`
            : match.matchReason,
        matchType: match.matchType,
        aiVerified,

        polymarket: {
            id: poly.id,
            question: poly.question,
            url: `https://polymarket.com/event/${poly.eventSlug ?? poly.slug}`,
            yesBestAsk: poly.outcomes[0]?.bestAsk ?? 0,
            noBestAsk: poly.outcomes[1]?.bestAsk ?? 0,
        },

        kalshi: {
            ticker: kalshi.ticker,
            title: kalshi.title,
            url: buildKalshiUrl(kalshi),
            yesAsk: kalshi.yesAsk,
            noAsk: kalshi.noAsk,
        },

        arbitrage,
        detectedAt: new Date().toISOString(),
    }
}

/**
 * Detect cross-platform arbitrage opportunities
 * 
 * Flow:
 * 1. Fast text matching (no AI)
 * 2. Calculate arbitrage for all matches
 * 3. AI verify ONLY those with arbitrage (5-10 typically)
 * 4. Return verified arbitrage + unverified high-confidence matches
 */
export async function detectCrossPlatformArbitrage(
    polymarkets: NormalizedMarket[],
    kalshiMarkets: KalshiMarket[]
): Promise<CrossPlatformOpportunity[]> {
    // Step 1: Fast text matching
    const matches = matchMarkets(polymarkets, kalshiMarkets)

    logger.info("Cross-platform: Text matching complete", {
        polymarkets: polymarkets.length,
        kalshiMarkets: kalshiMarkets.length,
        matches: matches.length,
    })

    // Step 2: Calculate arbitrage for all matches
    const matchesWithArbitrage: Array<{ match: MarketMatch; arbitrage: ArbitrageResult }> = []
    const matchesWithoutArbitrage: Array<{ match: MarketMatch; arbitrage: ArbitrageResult }> = []

    for (const match of matches) {
        const arbitrage = calculateArbitrage(match)
        if (arbitrage.type !== "none") {
            matchesWithArbitrage.push({ match, arbitrage })
        } else {
            matchesWithoutArbitrage.push({ match, arbitrage })
        }
    }

    logger.info("Cross-platform: Arbitrage calculated", {
        withArbitrage: matchesWithArbitrage.length,
        withoutArbitrage: matchesWithoutArbitrage.length,
    })

    // Step 3: AI verify ONLY arbitrage opportunities (parallel for speed)
    const opportunities: CrossPlatformOpportunity[] = []

    if (matchesWithArbitrage.length > 0) {
        logger.info("Cross-platform: AI verifying arbitrage opportunities", {
            count: matchesWithArbitrage.length,
        })

        // Parallel AI verification for speed
        const verificationPromises = matchesWithArbitrage.map(async ({ match, arbitrage }) => {
            const polyQuestion = match.polymarket.question || match.polymarket.eventTitle || ""
            const kalshiTitle = match.kalshi.title

            try {
                const aiResult = await verifyMatch(polyQuestion, kalshiTitle)

                if (aiResult.isExactMatch) {
                    return buildOpportunity(match, arbitrage, true, aiResult.reason)
                } else {
                    logger.info("AI rejected arbitrage match", {
                        poly: polyQuestion.substring(0, 40),
                        kalshi: kalshiTitle.substring(0, 40),
                        reason: aiResult.reason,
                    })
                    return null
                }
            } catch (error) {
                logger.error("AI verification failed", { error: (error as Error).message })
                // On error, include with warning
                return buildOpportunity(match, arbitrage, false, "AI verification failed")
            }
        })

        const results = await Promise.all(verificationPromises)
        const verified = results.filter((r): r is CrossPlatformOpportunity => r !== null)
        opportunities.push(...verified)

        logger.info("Cross-platform: AI verification complete", {
            verified: verified.length,
            rejected: matchesWithArbitrage.length - verified.length,
        })
    }

    // Step 4: Add non-arbitrage high-confidence matches (no AI needed)
    // These are just for display, not actionable
    for (const { match, arbitrage } of matchesWithoutArbitrage.slice(0, 10)) {
        opportunities.push(buildOpportunity(match, arbitrage))
    }

    // Sort: arbitrage first (by profit), then by confidence
    opportunities.sort((a, b) => {
        if (a.arbitrage.type !== "none" && b.arbitrage.type === "none") return -1
        if (a.arbitrage.type === "none" && b.arbitrage.type !== "none") return 1

        if (a.arbitrage.profitPct !== b.arbitrage.profitPct) {
            return b.arbitrage.profitPct - a.arbitrage.profitPct
        }

        return b.matchConfidence - a.matchConfidence
    })

    return opportunities
}
