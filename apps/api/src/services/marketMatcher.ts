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

// Common stopwords to exclude from matching
const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "shall", "can", "need",
    "this", "that", "these", "those", "it", "its", "they", "them", "their",
    "who", "what", "which", "when", "where", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such",
    "than", "too", "very", "just", "also", "any", "no", "not", "only", "yes"
])

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[?!.,;:'"()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

/**
 * Extract significant words (excluding stopwords)
 */
function extractWords(text: string): Set<string> {
    const normalized = normalizeText(text)
    const words = normalized.split(" ").filter(w =>
        w.length >= 3 && !STOPWORDS.has(w)
    )
    return new Set(words)
}

/**
 * Extract key matching words for indexing (most informative words)
 * Returns words that are likely to be unique identifiers
 */
function extractKeyWords(text: string): Set<string> {
    const normalized = normalizeText(text)
    const words = normalized.split(" ").filter(w =>
        w.length >= 4 && !STOPWORDS.has(w)
    )
    return new Set(words)
}


/**
 * Parse close date from market (handles both Date objects and date strings)
 */
function parseCloseDate(dateInput: Date | string | null | undefined): Date | null {
    if (!dateInput) return null

    // If already a Date, return it (or null if invalid)
    if (dateInput instanceof Date) {
        return isNaN(dateInput.getTime()) ? null : dateInput
    }

    // Parse string to Date
    try {
        const date = new Date(dateInput)
        return isNaN(date.getTime()) ? null : date
    } catch {
        return null
    }
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
    const msPerDay = 1000 * 60 * 60 * 24
    return Math.abs(date1.getTime() - date2.getTime()) / msPerDay
}

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 || set2.size === 0) return 0

    let intersection = 0
    for (const item of set1) {
        if (set2.has(item)) intersection++
    }

    const union = set1.size + set2.size - intersection
    return intersection / union
}

/**
 * Match markets between Polymarket and Kalshi
 * 
 * OPTIMIZATION: Uses inverted index to avoid O(n*m) full comparison
 * 1. Build index: keyword -> list of kalshi markets
 * 2. For each polymarket, only compare with kalshi markets that share keywords
 */
export function matchMarkets(
    polymarkets: NormalizedMarket[],
    kalshiMarkets: KalshiMarket[]
): MarketMatch[] {
    const startTime = Date.now()

    // Limit markets to top by liquidity (already sorted by API)
    const maxMarkets = 10000
    const polyToMatch = polymarkets.slice(0, maxMarkets)
    const kalshiToMatch = kalshiMarkets.slice(0, maxMarkets)

    // Build inverted index: keyword -> kalshi market indices
    const kalshiIndex = new Map<string, number[]>()
    const kalshiData: { words: Set<string>; closeDate: Date | null }[] = []

    for (let i = 0; i < kalshiToMatch.length; i++) {
        const kalshi = kalshiToMatch[i]!
        const words = extractKeyWords(kalshi.title)
        const closeDate = parseCloseDate(kalshi.closeTime)
        kalshiData.push({ words, closeDate })

        // Add to index
        for (const word of words) {
            if (!kalshiIndex.has(word)) {
                kalshiIndex.set(word, [])
            }
            kalshiIndex.get(word)!.push(i)
        }
    }

    logger.info("Market matcher: Index built", {
        polyCount: polyToMatch.length,
        kalshiCount: kalshiToMatch.length,
        indexSize: kalshiIndex.size,
    })

    const matches: MarketMatch[] = []
    let comparisons = 0

    for (const poly of polyToMatch) {
        const polyTitle = poly.question || poly.eventTitle || ""
        if (polyTitle.length < 10) continue

        const polyWords = extractWords(polyTitle)
        const polyKeyWords = extractKeyWords(polyTitle)
        const polyCloseDate = parseCloseDate(poly.endsAt)

        // Find candidate kalshi markets that share at least one keyword
        const candidateIndices = new Set<number>()
        for (const word of polyKeyWords) {
            const indices = kalshiIndex.get(word)
            if (indices) {
                for (const idx of indices) {
                    candidateIndices.add(idx)
                }
            }
        }

        // Only compare with candidates (not all markets)
        for (const idx of candidateIndices) {
            comparisons++
            const kalshi = kalshiToMatch[idx]!
            const { words: kalshiWords, closeDate: kalshiCloseDate } = kalshiData[idx]!

            // Date filtering and bonus
            // Only skip if BOTH have dates and they differ by more than 7 days
            let dateBonus = 0
            if (polyCloseDate && kalshiCloseDate) {
                const days = daysBetween(polyCloseDate, kalshiCloseDate)
                if (days > 7) continue // Skip - different resolution dates

                // Date bonus for close dates
                if (days <= 1) dateBonus = 0.2
                else if (days <= 7) dateBonus = 0.1
            }
            // Note: If one has date and other doesn't, we still allow the match
            // but give no date bonus - let the AI decide if they're the same

            // Calculate word similarity
            const wordSimilarity = jaccardSimilarity(polyWords, kalshiWords)

            // Calculate final confidence
            const confidence = Math.min(1, (wordSimilarity * 0.8) + dateBonus)

            // Include if confidence >= 50% (let AI verify borderline cases)
            if (confidence >= 0.5) {
                const reasons: string[] = []
                reasons.push(`Words: ${(wordSimilarity * 100).toFixed(0)}%`)
                if (dateBonus > 0 && polyCloseDate && kalshiCloseDate) {
                    const days = Math.round(daysBetween(polyCloseDate, kalshiCloseDate))
                    reasons.push(`Dates: ${days}d apart`)
                }

                const matchType = confidence >= 0.75 ? "high" :
                    confidence >= 0.65 ? "medium" : "low"

                matches.push({
                    polymarket: poly,
                    kalshi,
                    confidence,
                    matchReason: reasons.join(", "),
                    matchType,
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

    const elapsed = Date.now() - startTime
    logger.info("Text similarity matching complete", {
        comparisons,
        total: matches.length,
        deduplicated: deduped.length,
        ms: elapsed
    })

    return deduped
}
