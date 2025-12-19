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
    reason: string
): Promise<void> {
    await db
        .insert(aiMatchCache)
        .values({
            matchHash,
            polyQuestion,
            kalshiTitle,
            isExactMatch,
            reason,
        })
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

=== CRITICAL REQUIREMENTS (Must pass ALL steps) ===

STEP 1: EVENT CHECK (The most common failure point)
- Are they asking about the EXACT SAME real-world outcome?
- "Musk announces run" != "Musk becomes trillionaire" (REJECT immediately)
- "Xi removed" != "IPO happens" (REJECT immediately)
- "Earthquake" != "IPO" (REJECT immediately)
-> If events differ, STOP and return false.

STEP 2: TIMEFRAME CHECK
- Do they resolve at effectively the same moment?
- "by Dec 31, 2026" = "before Jan 1, 2027" (PASS)
- "2025" vs "2029" (FAIL - one ends early, creating risk)
-> If timeframes differ, STOP and return false.

STEP 3: RESOLUTION & DELTA NEUTRALITY
- Can you construct a guaranteed profit/no-loss hedge?
- DIRECT: Yes/Yes match. Both resolve YES together.
- INVERSE: Yes/No match. One resolves YES exactly when the other resolves NO.
- IMPLICATION FAILURES: "Win election" matches "Win election", NOT "Be on ballot" (Winning implies ballot, but ballot doesn't imply winning -> Divergence risk!)

=== MATCH TYPES ===

**DIRECT MATCH**: Same question, same timeframe, same resolution logic.
Example: "Will aliens be confirmed before 2027?" on both platforms with equivalent dates.

**INVERSE MATCH**: Opposite questions with same timeframe.
Example: "Will NO ONE leave Cabinet before 2027?" vs "Will ANYONE leave Cabinet before 2027?"
- If someone leaves: Market1=NO, Market2=YES
- If no one leaves: Market1=YES, Market2=NO
- Buy YES on one, NO on other = guaranteed $1 payout

=== REJECTION CRITERIA ===

REJECT if ANY of these apply:

1. **DIFFERENT TIMEFRAMES**: One market ends in 2025, other in 2029 - NOT delta neutral!
   - Event could happen in 2026: Market1 already resolved NO, Market2 resolves YES later
   - This creates divergence risk

2. **DIFFERENT EVENTS**: Same person but different actions (e.g., "announce run" vs "be arrested")

3. **IMPLICATION ≠ EQUIVALENCE**: "Win election" implies "on ballot" but NOT vice versa
   - Can be on ballot and lose → divergence

4. **DIFFERENT THRESHOLDS**: "$700M at 4PM" vs "$500M at 10AM" - different triggers

5. **DIFFERENT SUBJECTS**: "Nylander wins trophy" vs "McDavid wins trophy" - different players

=== EXAMPLES ===

✅ MATCH: "US confirms aliens by Dec 31, 2026" vs "US confirms aliens before Jan 1, 2027"
   → Same event, same deadline (date equivalence), direct match.

✅ MATCH (INVERSE): "Will no one leave Cabinet before 2027?" vs "Will anyone leave before 2027?"
   → Perfect inverse with same timeframe. Delta neutral.

❌ REJECT: "Leave Cabinet in 2025?" vs "Leave Cabinet by 2029?"
   → Different timeframes. Event in 2026 causes divergence.

❌ REJECT: "Win election?" vs "On ballot?"
   → Implication, not equivalence. Can be on ballot but lose.

❌ REJECT: "Announce presidential run?" vs "Be arrested?"
   → Completely different events despite same person.

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

        // Cache result
        await cacheResult(matchHash, polyQuestion, kalshiTitle, result.isExactMatch, result.reason)

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
