import { createHash } from "crypto"
import { eq, sql } from "drizzle-orm"
import { openai } from "@ai-sdk/openai"
import { generateObject } from "ai"
import { z } from "zod"
import { db } from "../db/client.js"
import { aiMatchCache, aiCallLog } from "../db/schema.js"
import { env } from "../env.js"
import { logger } from "../logger.js"

/**
 * Result of AI match verification
 */
export type AIMatchResult = {
    isExactMatch: boolean
    reason: string
    fromCache: boolean
}

/**
 * Generate a hash for the match pair (for cache lookup)
 */
function generateMatchHash(polyQuestion: string, kalshiTitle: string): string {
    const combined = `${polyQuestion.trim().toLowerCase()}|${kalshiTitle.trim().toLowerCase()}`
    return createHash("md5").update(combined).digest("hex")
}

/**
 * Get today's date in UTC as YYYY-MM-DD
 */
function getTodayUTC(): string {
    return new Date().toISOString().split("T")[0]!
}

/**
 * Check if we're within the daily AI call limit
 */
async function checkDailyLimit(): Promise<{ allowed: boolean; current: number; limit: number }> {
    const today = getTodayUTC()
    const limit = env.AI_MATCH_DAILY_LIMIT

    const [row] = await db
        .select({ callCount: aiCallLog.callCount })
        .from(aiCallLog)
        .where(eq(aiCallLog.callDate, today))
        .limit(1)

    const current = row?.callCount ?? 0
    return { allowed: current < limit, current, limit }
}

/**
 * Increment the daily call count
 */
async function incrementDailyCount(): Promise<void> {
    const today = getTodayUTC()

    await db
        .insert(aiCallLog)
        .values({ callDate: today, callCount: 1 })
        .onConflictDoUpdate({
            target: aiCallLog.callDate,
            set: {
                callCount: sql`${aiCallLog.callCount} + 1`,
                updatedAt: sql`now()`,
            },
        })
}

/**
 * Check cache for existing match result
 */
async function checkCache(matchHash: string): Promise<AIMatchResult | null> {
    const [cached] = await db
        .select({
            isExactMatch: aiMatchCache.isExactMatch,
            reason: aiMatchCache.reason,
        })
        .from(aiMatchCache)
        .where(eq(aiMatchCache.matchHash, matchHash))
        .limit(1)

    if (cached) {
        return {
            isExactMatch: cached.isExactMatch,
            reason: cached.reason ?? "",
            fromCache: true,
        }
    }

    return null
}

/**
 * Store result in cache
 */
async function cacheResult(
    matchHash: string,
    polyQuestion: string,
    kalshiTitle: string,
    isExactMatch: boolean,
    reason: string,
    context?: {
        polyEndDate?: string
        kalshiEndDate?: string
        polyResolutionRules?: string
        kalshiResolutionRules?: string
    }
): Promise<void> {
    const values: Record<string, unknown> = {
        matchHash,
        polyQuestion,
        kalshiTitle,
        isExactMatch,
        reason,
    }

    // Conditionally add context fields if enabled
    if (env.STORE_AI_MATCH_CONTEXT && context) {
        if (context.polyEndDate) {
            values.polyEndDate = new Date(context.polyEndDate)
        }
        if (context.kalshiEndDate) {
            values.kalshiEndDate = new Date(context.kalshiEndDate)
        }
        if (context.polyResolutionRules) {
            values.polyResolutionRules = context.polyResolutionRules
        }
        if (context.kalshiResolutionRules) {
            values.kalshiResolutionRules = context.kalshiResolutionRules
        }
    }

    await db
        .insert(aiMatchCache)
        .values(values as typeof aiMatchCache.$inferInsert)
        .onConflictDoNothing()
}

/**
 * Call GPT-4o-mini to verify if two market questions are asking the exact same thing
 */
async function callAI(
    polyQuestion: string,
    kalshiTitle: string,
    polyEndDate?: string,
    kalshiEndDate?: string,
    polyResolutionRules?: string,
    kalshiResolutionRules?: string
): Promise<{ isExactMatch: boolean; reason: string }> {
    if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured")
    }

    // Format dates for display
    const polyDateStr = polyEndDate ? new Date(polyEndDate).toLocaleDateString() : "Not specified"
    const kalshiDateStr = kalshiEndDate ? new Date(kalshiEndDate).toLocaleDateString() : "Not specified"

    // Format resolution rules
    const polyRulesStr = polyResolutionRules?.trim() || "Not provided"
    const kalshiRulesStr = kalshiResolutionRules?.trim() || "Not provided"

    logger.info("aiMatchVerifier::callAI::AI Prompt => ", {
        polyQuestion,
        kalshiTitle,
        polyDateStr,
        kalshiDateStr,
        polyRulesStr,
        kalshiRulesStr,
    })

    const { object } = await generateObject({
        model: openai("gpt-5-nano"),
        schema: z.object({
            isExactMatch: z.boolean().describe("Whether the two questions are asking about the exact same event/outcome (either directly or inversely)"),
            matchType: z.enum(["DIRECT", "INVERSE", "NONE"]).describe("DIRECT = Same question. INVERSE = Opposite questions (Yes=No). NONE = Not a match."),
            reason: z.string().describe("Brief explanation of the match type and why it qualifies"),
        }),
        prompt: `You are evaluating two prediction markets for DELTA-NEUTRAL ARBITRAGE.

DELTA-NEUTRAL means: For ANY possible real-world outcome, the combined position always results in the same guaranteed profit (or zero loss). There must be NO scenario where positions diverge.

MARKET 1 (Polymarket):
- Question: "${polyQuestion}"
- Resolution Date: ${polyDateStr}
- Resolution Rules: ${polyRulesStr}

MARKET 2 (Kalshi):
- Question: "${kalshiTitle}"
- Resolution Date: ${kalshiDateStr}
- Resolution Rules: ${kalshiRulesStr}

=== STEP 0: SUBJECT EXTRACTION (Critical for multi-outcome markets) ===

BEFORE comparing, extract the TRUE SUBJECT from each market:

For Polymarket: The subject is usually in the question itself.
- "Will Connor Hellebuyck win Hart Trophy?" → Subject = "Connor Hellebuyck"

For Kalshi: If the title is generic (e.g., "Who will win X?"), check the RESOLUTION RULES for the specific subject.
- Title: "Who will win Hart Memorial Trophy?"
- Rules: "Resolves YES if Connor Hellebuyck wins..." → Subject = "Connor Hellebuyck"

⚠️ IMPORTANT: A generic Kalshi title like "Who will win X?" paired with resolution rules mentioning a specific person IS A MATCH for a Polymarket question asking about that same person!

=== CRITICAL REQUIREMENTS (Must pass ALL steps) ===

STEP 1: EVENT CHECK (Using EXTRACTED subjects)
- Are they asking about the EXACT SAME real-world outcome for the SAME SUBJECT?
- Compare the EXTRACTED subjects, not just the titles!
- If Poly asks "Will Connor Hellebuyck win Hart?" and Kalshi rules say "Resolves if Connor Hellebuyck wins" → SAME SUBJECT, likely a MATCH
- "Musk announces run" != "Musk becomes trillionaire" (REJECT - different events)
-> If subjects differ, STOP and return false.

STEP 2: TIMEFRAME CHECK
- Do they resolve at effectively the same moment?
- "by Dec 31, 2026" = "before Jan 1, 2027" (PASS)
- "2025" vs "2029" (FAIL - one ends early, creating risk)
-> If timeframes differ, STOP and return false.

STEP 3: RESOLUTION & DELTA NEUTRALITY
- Can you construct a guaranteed profit/no-loss hedge?
- DIRECT: Yes/Yes match. Both resolve YES together.
- INVERSE: Yes/No match. One resolves YES exactly when the other resolves NO.
- IMPLICATION FAILURES: "Win election" matches "Win election", NOT "Be on ballot"

=== MATCH TYPES ===

**DIRECT MATCH**: Same question, same timeframe, same resolution logic.
Example 1: "Will aliens be confirmed before 2027?" on both platforms.
Example 2: "Will Connor Hellebuyck win Hart?" + Kalshi's "Who will win Hart?" with rules "if Hellebuyck wins..."

**INVERSE MATCH**: Opposite questions with same timeframe.
Example: "Will NO ONE leave Cabinet before 2027?" vs "Will ANYONE leave Cabinet before 2027?"

=== REJECTION CRITERIA ===

REJECT if ANY of these apply:

1. **DIFFERENT TIMEFRAMES**: One market ends in 2025, other in 2029

2. **DIFFERENT EVENTS**: Same person but different actions (e.g., "announce run" vs "be arrested")

3. **IMPLICATION ≠ EQUIVALENCE**: "Win election" implies "on ballot" but NOT vice versa

4. **DIFFERENT THRESHOLDS**: "$700M at 4PM" vs "$500M at 10AM" - different triggers

5. **DIFFERENT SUBJECTS**: "Nylander wins trophy" vs "McDavid wins trophy" - different players
   ⚠️ BUT: If Kalshi title is "Who will win trophy?" and rules say "if Nylander wins" → Subject IS Nylander!

=== EXAMPLES ===

✅ MATCH: "Will Connor Hellebuyck win Hart Trophy?" (Poly) vs "Who will win Hart?" (Kalshi, rules: "if Hellebuyck wins")
   → Same subject extracted from rules, same event, DIRECT match.

✅ MATCH: "US confirms aliens by Dec 31, 2026" vs "US confirms aliens before Jan 1, 2027"
   → Same event, same deadline, direct match.

✅ MATCH (INVERSE): "Will no one leave Cabinet before 2027?" vs "Will anyone leave before 2027?"
   → Perfect inverse with same timeframe.

❌ REJECT: "Will Nylander win Hart?" (Poly) vs "Who will win Hart?" (Kalshi, rules: "if McDavid wins")
   → Different subjects (Nylander vs McDavid from rules).

❌ REJECT: "Win election?" vs "On ballot?"
   → Implication, not equivalence.

Return:
- isExactMatch = true ONLY if delta-neutral arbitrage is guaranteed safe
- reason = which requirement fails, or which match type applies
`,
    })

    // Prepend match type to reason for downstream parsing
    const finalReason = object.isExactMatch
        ? `[TYPE:${object.matchType}] ${object.reason}`
        : object.reason

    return { isExactMatch: object.isExactMatch, reason: finalReason }
}

/**
 * Verify if two market questions are an exact match using AI
 * - First checks cache
 * - Then checks daily limit
 * - Finally calls AI if needed
 */
export async function verifyMatch(
    polyQuestion: string,
    kalshiTitle: string,
    polyEndDate?: string,
    kalshiEndDate?: string,
    polyResolutionRules?: string,
    kalshiResolutionRules?: string
): Promise<AIMatchResult> {
    const matchHash = generateMatchHash(polyQuestion, kalshiTitle)

    // Check cache first
    const cached = await checkCache(matchHash)
    if (cached) {
        logger.info("AI match cache hit", { matchHash, isExactMatch: cached.isExactMatch })
        return cached
    }

    // Check daily limit
    const { allowed, current, limit } = await checkDailyLimit()
    if (!allowed) {
        logger.warn("AI match daily limit reached", { current, limit })
        // Return CONSERVATIVE rejection when limit reached - don't show untested pairs
        return { isExactMatch: false, reason: "Daily AI limit reached - rejected for safety", fromCache: false }
    }

    // Call AI
    try {
        logger.info("Calling AI for match verification", {
            poly: polyQuestion.substring(0, 50),
            kalshi: kalshiTitle.substring(0, 50)
        })

        const result = await callAI(polyQuestion, kalshiTitle, polyEndDate, kalshiEndDate, polyResolutionRules, kalshiResolutionRules)

        // Increment counter
        await incrementDailyCount()

        // Cache result with context
        await cacheResult(matchHash, polyQuestion, kalshiTitle, result.isExactMatch, result.reason, {
            polyEndDate,
            kalshiEndDate,
            polyResolutionRules,
            kalshiResolutionRules,
        })

        logger.info("AI match result", {
            isExactMatch: result.isExactMatch,
            reason: result.reason.substring(0, 100)
        })

        return { ...result, fromCache: false }
    } catch (error) {
        logger.error("AI match verification failed", { error: (error as Error).message })
        // On error, return optimistic match
        return { isExactMatch: true, reason: "AI verification failed, using text similarity", fromCache: false }
    }
}

/**
 * Get current daily usage stats
 */
export async function getAIUsageStats(): Promise<{ today: number; limit: number }> {
    const { current, limit } = await checkDailyLimit()
    return { today: current, limit }
}
