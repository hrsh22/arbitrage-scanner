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
async function callAI(polyQuestion: string, kalshiTitle: string): Promise<{ isExactMatch: boolean; reason: string }> {
    if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured")
    }

    const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: z.object({
            isExactMatch: z.boolean().describe("Whether the two questions are asking about the exact same event/outcome"),
            reason: z.string().describe("Brief explanation of why they match or don't match"),
        }),
        prompt: `You are comparing two prediction market questions to determine if they are asking about the EXACT same thing.

Question 1 (Polymarket): "${polyQuestion}"
Question 2 (Kalshi): "${kalshiTitle}"

Two questions are an EXACT match only if:
1. They are about the same event/person/topic
2. They ask about the same outcome (e.g., "announce" vs "nominate" are DIFFERENT actions)
3. They have the same time frame (if specified)
4. They have the same conditions

Questions that are merely "related" or "similar" are NOT exact matches.

Examples of NON-exact matches:
- "Will Trump announce X" vs "Will Trump nominate X" (different verbs)
- "Will Fed cut rates in January" vs "Will Fed cut-pause-pause over 3 meetings" (different scope)
- "Will X happen" vs "Will X not happen" (opposite outcomes)

Determine if these two questions are asking about the EXACT same thing.`,
    })

    return object
}

/**
 * Verify if two market questions are an exact match using AI
 * - First checks cache
 * - Then checks daily limit
 * - Finally calls AI if needed
 */
export async function verifyMatch(
    polyQuestion: string,
    kalshiTitle: string
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
        // Return optimistic match when limit reached (let text similarity decide)
        return { isExactMatch: true, reason: "Daily AI limit reached, using text similarity", fromCache: false }
    }

    // Call AI
    try {
        logger.info("Calling AI for match verification", {
            poly: polyQuestion.substring(0, 50),
            kalshi: kalshiTitle.substring(0, 50)
        })

        const result = await callAI(polyQuestion, kalshiTitle)

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
