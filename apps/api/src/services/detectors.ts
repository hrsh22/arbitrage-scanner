import { config } from "../config.js"
import { logger } from "../logger.js"
import type { NormalizedMarket, Opportunity, OutcomePrice, NearResolutionOpportunity, NearResolutionFilter } from "../types.js"

type DetectionResult = {
    opportunities: Opportunity[]
}

/**
 * Delta-neutral single-market arbitrage detection.
 * 
 * Arbitrage exists when: Best Ask (Yes) + Best Ask (No) < $1.00
 * 
 * Strategy:
 * - Buy Yes at best ask price
 * - Buy No at best ask price  
 * - One of them will pay out $1.00
 * - Profit = $1.00 - (Yes Ask + No Ask)
 * 
 * This is delta-neutral because we're hedged on both outcomes.
 */
const detectDeltaNeutralArbitrage = (market: NormalizedMarket): Opportunity | null => {
    // Must have exactly 2 outcomes (Yes/No)
    if (market.outcomes.length !== 2) return null

    const yesOutcome = market.outcomes[0]
    const noOutcome = market.outcomes[1]
    if (!yesOutcome || !noOutcome) return null

    // Both must have valid ask prices (price to buy at)
    const yesAsk = yesOutcome.bestAsk
    const noAsk = noOutcome.bestAsk

    if (yesAsk === null || yesAsk === undefined || yesAsk <= 0) return null
    if (noAsk === null || noAsk === undefined || noAsk <= 0) return null

    // Total cost to buy both outcomes
    const totalCost = yesAsk + noAsk

    // Arbitrage exists only if total cost < $1.00
    if (totalCost >= 1) return null

    // Calculate profit
    const profitAbsolute = 1 - totalCost
    const profitPercentage = (profitAbsolute / totalCost) * 100

    // Skip if below minimum profit threshold
    if (profitPercentage < config.minProfitPct) return null

    // Minimum liquidity is the smaller of the two sides
    const yesLiquidity = yesOutcome.availableLiquidity ?? 0
    const noLiquidity = noOutcome.availableLiquidity ?? 0
    const minLiquidity = Math.min(yesLiquidity, noLiquidity)

    // Skip if liquidity too low
    if (minLiquidity < config.minLiquidityUsd) return null

    // Build outcome breakdown
    const outcomes: OutcomePrice[] = [
        {
            name: yesOutcome.name || "Yes",
            askPrice: yesAsk,
            liquidity: yesLiquidity,
        },
        {
            name: noOutcome.name || "No",
            askPrice: noAsk,
            liquidity: noLiquidity,
        },
    ]

    // Score: profit % weighted by log of liquidity
    const score = profitPercentage * Math.log10(minLiquidity + 1)

    logger.info("Arbitrage found", {
        market: market.question,
        yesAsk,
        noAsk,
        totalCost,
        profitPercentage: profitPercentage.toFixed(2),
    })

    return {
        key: `arb:${market.id}`,
        type: "arbitrage",
        marketId: market.id,
        marketSlug: market.slug,
        eventId: market.eventId,
        eventSlug: market.eventSlug,
        eventTitle: market.eventTitle,
        question: market.question,
        outcomes,
        totalCost,
        profitAbsolute,
        profitPercentage,
        availableLiquidity: minLiquidity,
        score,
        closesAt: market.endsAt,
        detectedAt: new Date(),
    }
}

/**
 * Run delta-neutral arbitrage detection on all markets
 */
export const runDetectors = async (markets: NormalizedMarket[]): Promise<DetectionResult> => {
    const opportunities: Opportunity[] = []

    for (const market of markets) {
        const arbitrage = detectDeltaNeutralArbitrage(market)
        if (arbitrage) {
            opportunities.push(arbitrage)
        }
    }

    // Sort by score descending (best opportunities first)
    opportunities.sort((a, b) => b.score - a.score)

    return { opportunities }
}

/**
 * Detect near-resolution opportunities.
 * 
 * Near-resolution = market closing soon + one outcome has high odds (> 95 cents).
 * These are high-conviction bets that resolve quickly.
 */
export const detectNearResolution = (
    markets: NormalizedMarket[],
    options?: NearResolutionFilter
): NearResolutionOpportunity[] => {
    const maxHours = options?.maxHoursUntilClose ?? 24
    const minOdds = (options?.minOdds ?? 95) / 100  // Convert cents to decimal
    const sortBy = options?.sort ?? "time"

    const now = new Date()
    const opportunities: NearResolutionOpportunity[] = []

    for (const market of markets) {
        // Must have close date
        if (!market.endsAt) continue

        const closeDate = new Date(market.endsAt)
        const hoursUntilClose = (closeDate.getTime() - now.getTime()) / (1000 * 60 * 60)

        // Skip if not closing soon (or already closed)
        if (hoursUntilClose <= 0 || hoursUntilClose > maxHours) continue

        // Must have exactly 2 outcomes
        if (market.outcomes.length !== 2) continue

        const yes = market.outcomes[0]
        const no = market.outcomes[1]
        if (!yes || !no) continue

        // Get prices - prefer midPrice (Gamma API), fallback to CLOB prices
        const yesPrice = yes.midPrice ?? yes.bestAsk ?? yes.bestBid ?? 0
        const noPrice = no.midPrice ?? no.bestAsk ?? no.bestBid ?? 0

        // Skip if no valid prices
        if (yesPrice <= 0 && noPrice <= 0) continue

        // Find the likely outcome (highest odds)
        const likelyIsYes = yesPrice >= noPrice
        const likelyOutcome = likelyIsYes ? yes : no
        const likelyName = likelyIsYes ? (yes.name || "Yes") : (no.name || "No")
        const likelyOdds = likelyIsYes ? yesPrice : noPrice

        // Skip if odds below threshold
        if (likelyOdds < minOdds) continue

        // Skip if odds are essentially 100% (no profit possible)
        // Using 0.995 (99.5 cents) to catch values that would round to 100 in display
        if (likelyOdds >= 0.995) continue

        // Calculate buy price (what you'd pay)
        const buyPrice = likelyOutcome.bestAsk ?? likelyOutcome.midPrice ?? likelyOdds
        if (buyPrice <= 0) continue

        // Skip if buy price is essentially $1 (no profit)
        if (buyPrice >= 0.995) continue

        // Liquidity (for display only, no filtering)
        const liquidity = likelyOutcome.availableLiquidity ?? 0

        // Calculate potential profit/loss
        // If you buy at ask and win: Profit = $1 - buyPrice
        // If you buy at ask and lose: Loss = buyPrice
        const potentialProfit = 1 - buyPrice
        const potentialLoss = buyPrice

        // Expected value = P(win) * profit - P(lose) * loss
        const expectedValue = likelyOdds * potentialProfit - (1 - likelyOdds) * potentialLoss

        // Score for sorting: prioritize by time or odds
        const score = sortBy === "time"
            ? (maxHours - hoursUntilClose) * 100 + likelyOdds * 10
            : likelyOdds * 100 + (maxHours - hoursUntilClose)

        opportunities.push({
            key: `near:${market.id}`,
            type: "near-resolution",
            marketId: market.id,
            marketSlug: market.slug,
            eventId: market.eventId,
            eventSlug: market.eventSlug,
            eventTitle: market.eventTitle,
            question: market.question,
            likelyOutcome: {
                name: likelyName,
                probability: likelyOdds,
                bestBid: likelyOutcome.bestBid ?? 0,
                bestAsk: buyPrice,
                liquidity,
            },
            closesAt: closeDate,
            hoursUntilClose,
            potentialProfit,
            potentialLoss,
            expectedValue,
            score,
            detectedAt: new Date(),
        })
    }

    // Sort based on preference
    if (sortBy === "odds") {
        opportunities.sort((a, b) => b.likelyOutcome.probability - a.likelyOutcome.probability)
    } else {
        // Default: sort by time (closest first)
        opportunities.sort((a, b) => a.hoursUntilClose - b.hoursUntilClose)
    }

    return opportunities
}
