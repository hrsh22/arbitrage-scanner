import type { NormalizedMarket } from "../types.js"
import type { KalshiMarket } from "../clients/kalshiClient.js"
import { logger } from "../logger.js"

export type MarketMatch = {
    polymarket: NormalizedMarket
    kalshi: KalshiMarket
    confidence: number           // 0.0 to 1.0
    matchReason: string          // Why we think they match
    matchType: "high" | "medium" | "low"
}

/**
 * Normalize a market title for comparison
 */
function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[?!.,'\"]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/federal reserve/g, "fed")
        .replace(/interest rate/g, "rate")
        .replace(/basis points?/g, "bps")
        .replace(/percentage points?/g, "bps")
}

/**
 * Extract date clues from text
 */
function extractDateClues(text: string): { month?: string; year?: string; quarter?: string } {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    const monthsFull = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

    const lower = text.toLowerCase()

    let month: string | undefined
    for (let i = 0; i < months.length; i++) {
        const m = months[i]
        const mf = monthsFull[i]
        if (m && mf && (lower.includes(m) || lower.includes(mf))) {
            month = m
            break
        }
    }

    const yearMatch = text.match(/20(2[4-9]|30)/)
    const year = yearMatch ? yearMatch[0] : undefined

    const quarterMatch = text.match(/q[1-4]/i)
    const quarter = quarterMatch ? quarterMatch[0].toLowerCase() : undefined

    return { month, year, quarter }
}

/**
 * Extract key terms for matching
 */
function extractKeyTerms(text: string): Set<string> {
    const normalized = normalizeTitle(text)
    const terms = new Set<string>()

    if (normalized.includes("fed") || normalized.includes("fomc") || normalized.includes("federal")) {
        terms.add("fed")
    }

    if (normalized.includes("rate") || normalized.includes("bps") || normalized.includes("cut") || normalized.includes("hike")) {
        terms.add("rate")
    }

    const bpsMatch = normalized.match(/(\d+)\s*bps/)
    if (bpsMatch) {
        terms.add(`${bpsMatch[1]}bps`)
    }

    const rateMatch = normalized.match(/(\d+\.?\d*)\s*%/)
    if (rateMatch) {
        terms.add(`${rateMatch[1]}%`)
    }

    if (normalized.includes("decrease") || normalized.includes("cut") || normalized.includes("lower")) {
        terms.add("cut")
    }
    if (normalized.includes("increase") || normalized.includes("hike") || normalized.includes("raise")) {
        terms.add("hike")
    }
    if (normalized.includes("no change") || normalized.includes("unchanged") || normalized.includes("hold")) {
        terms.add("hold")
    }

    return terms
}

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 0

    const intersection = new Set([...set1].filter((x) => set2.has(x)))
    const union = new Set([...set1, ...set2])

    return intersection.size / union.size
}

/**
 * Simple word overlap similarity
 */
function wordOverlapSimilarity(text1: string, text2: string): number {
    const words1 = new Set(normalizeTitle(text1).split(" ").filter((w) => w.length > 2))
    const words2 = new Set(normalizeTitle(text2).split(" ").filter((w) => w.length > 2))

    return jaccardSimilarity(words1, words2)
}

/**
 * Match markets between Polymarket and Kalshi
 * Fast text-only matching - no AI calls
 * Returns all matches >= 70% confidence for further processing
 */
export function matchMarkets(
    polymarkets: NormalizedMarket[],
    kalshiMarkets: KalshiMarket[]
): MarketMatch[] {
    const matches: MarketMatch[] = []

    for (const poly of polymarkets) {
        const polyTitle = poly.question || poly.eventTitle || ""
        const polyTerms = extractKeyTerms(polyTitle)
        const polyDates = extractDateClues(polyTitle)

        if (polyTerms.size === 0) continue

        for (const kalshi of kalshiMarkets) {
            const kalshiTitle = kalshi.title
            const kalshiTerms = extractKeyTerms(kalshiTitle)
            const kalshiDates = extractDateClues(kalshiTitle)

            if (kalshiTerms.size === 0) continue

            // Calculate term similarity
            const termSimilarity = jaccardSimilarity(polyTerms, kalshiTerms)
            const wordSimilarity = wordOverlapSimilarity(polyTitle, kalshiTitle)

            // FILTER: If both have years but they're different, skip (e.g., 2026 vs 2027)
            if (polyDates.year && kalshiDates.year && polyDates.year !== kalshiDates.year) {
                continue
            }

            // FILTER: If both have months but they're different (and no year to disambiguate)
            if (polyDates.month && kalshiDates.month && polyDates.month !== kalshiDates.month) {
                // Only skip if no years specified (can't tell if same occurrence)
                if (!polyDates.year && !kalshiDates.year) {
                    continue
                }
            }

            // Date match bonus (after filter)
            let dateBonus = 0
            if (polyDates.year && polyDates.year === kalshiDates.year) {
                dateBonus += 0.15
            }
            if (polyDates.month && polyDates.month === kalshiDates.month) {
                dateBonus += 0.15
            }
            if (polyDates.quarter && polyDates.quarter === kalshiDates.quarter) {
                dateBonus += 0.1
            }

            // Both must be Fed-related for bonus
            const bothFed = polyTerms.has("fed") && kalshiTerms.has("fed")
            const fedBonus = bothFed ? 0.2 : 0

            // Calculate final confidence
            const rawConfidence = (termSimilarity * 0.4) + (wordSimilarity * 0.3) + dateBonus + fedBonus
            const confidence = Math.min(1, Math.max(0, rawConfidence))

            // Only include if confidence >= 70%
            if (confidence >= 0.7) {
                const reasons: string[] = []
                if (bothFed) reasons.push("Both Fed-related")
                if (polyDates.year === kalshiDates.year && polyDates.year) reasons.push(`Same year (${polyDates.year})`)
                if (polyDates.month === kalshiDates.month && polyDates.month) reasons.push(`Same month (${polyDates.month})`)
                if (termSimilarity > 0.5) reasons.push("Similar terms")

                matches.push({
                    polymarket: poly,
                    kalshi,
                    confidence,
                    matchReason: reasons.join(", ") || "Word similarity",
                    matchType: "high",
                })
            }
        }
    }

    // Sort by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence)

    // Deduplicate - keep best match per market
    const seenPoly = new Set<string>()
    const seenKalshi = new Set<string>()
    const deduped: MarketMatch[] = []

    for (const match of matches) {
        if (!seenPoly.has(match.polymarket.id) && !seenKalshi.has(match.kalshi.ticker)) {
            seenPoly.add(match.polymarket.id)
            seenKalshi.add(match.kalshi.ticker)
            deduped.push(match)
        }
    }

    logger.info("Text similarity matching complete", {
        total: matches.length,
        deduplicated: deduped.length
    })

    return deduped
}
