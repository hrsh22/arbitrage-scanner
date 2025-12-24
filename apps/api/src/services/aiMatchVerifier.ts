import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { db } from "../db/client.js";
import { aiMatchCache, aiCallLog } from "../db/schema.js";
import { env } from "../env.js";
import { logger } from "../logger.js";

/**
 * Result of AI match verification
 */
export type AIMatchResult = {
  isExactMatch: boolean;
  reason: string;
  fromCache: boolean;
};

/**
 * Generate a hash for the match pair (for cache lookup)
 */
function generateMatchHash(polyQuestion: string, kalshiTitle: string): string {
  const combined = `${polyQuestion.trim().toLowerCase()}|${kalshiTitle.trim().toLowerCase()}`;
  return createHash("md5").update(combined).digest("hex");
}

/**
 * Get today's date in UTC as YYYY-MM-DD
 */
function getTodayUTC(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Check if we're within the daily AI call limit
 */
async function checkDailyLimit(): Promise<{ allowed: boolean; current: number; limit: number }> {
  const today = getTodayUTC();
  const limit = env.AI_MATCH_DAILY_LIMIT;

  const [row] = await db
    .select({ callCount: aiCallLog.callCount })
    .from(aiCallLog)
    .where(eq(aiCallLog.callDate, today))
    .limit(1);

  const current = row?.callCount ?? 0;
  return { allowed: current < limit, current, limit };
}

/**
 * Increment the daily call count
 */
async function incrementDailyCount(): Promise<void> {
  const today = getTodayUTC();

  await db
    .insert(aiCallLog)
    .values({ callDate: today, callCount: 1 })
    .onConflictDoUpdate({
      target: aiCallLog.callDate,
      set: {
        callCount: sql`${aiCallLog.callCount} + 1`,
        updatedAt: sql`now()`,
      },
    });
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
    .limit(1);

  if (cached) {
    return {
      isExactMatch: cached.isExactMatch,
      reason: cached.reason ?? "",
      fromCache: true,
    };
  }

  return null;
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
    polyEndDate?: string;
    kalshiEndDate?: string;
    polyResolutionRules?: string;
    kalshiResolutionRules?: string;
  },
): Promise<void> {
  const values: Record<string, unknown> = {
    matchHash,
    polyQuestion,
    kalshiTitle,
    isExactMatch,
    reason,
  };

  // Conditionally add context fields if enabled
  if (env.STORE_AI_MATCH_CONTEXT && context) {
    if (context.polyEndDate) {
      values.polyEndDate = new Date(context.polyEndDate);
    }
    if (context.kalshiEndDate) {
      values.kalshiEndDate = new Date(context.kalshiEndDate);
    }
    if (context.polyResolutionRules) {
      values.polyResolutionRules = context.polyResolutionRules;
    }
    if (context.kalshiResolutionRules) {
      values.kalshiResolutionRules = context.kalshiResolutionRules;
    }
  }

  await db
    .insert(aiMatchCache)
    .values(values as typeof aiMatchCache.$inferInsert)
    .onConflictDoNothing();
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
  kalshiResolutionRules?: string,
): Promise<{ isExactMatch: boolean; reason: string }> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  // Format dates for display
  const polyDateStr = polyEndDate ? new Date(polyEndDate).toLocaleDateString() : "Not specified";
  const kalshiDateStr = kalshiEndDate
    ? new Date(kalshiEndDate).toLocaleDateString()
    : "Not specified";

  // Format resolution rules
  const polyRulesStr = polyResolutionRules?.trim() || "Not provided";
  const kalshiRulesStr = kalshiResolutionRules?.trim() || "Not provided";

  logger.info("aiMatchVerifier::callAI::AI Prompt => ", {
    polyQuestion,
    kalshiTitle,
    polyDateStr,
    kalshiDateStr,
    polyRulesStr,
    kalshiRulesStr,
  });

  const { object } = await generateObject({
    model: openai("gpt-5-nano"),
    schema: z.object({
      isExactMatch: z
        .boolean()
        .describe(
          "Whether the two questions are asking about the exact same event/outcome (either directly or inversely)",
        ),
      matchType: z
        .enum(["DIRECT", "INVERSE", "NONE"])
        .describe(
          "DIRECT = Same question. INVERSE = Opposite questions (Yes=No). NONE = Not a match.",
        ),
      reason: z.string().describe("Brief explanation of the match type and why it qualifies"),
    }),
    prompt: `You are evaluating if two prediction markets are asking about THE SAME EVENT.

CURRENT DATE: ${new Date().toISOString()} (Use this to understand relative timeframes)

YOUR ONLY JOB: Determine if these markets refer to the same real-world outcome.
- Do NOT consider prices, liquidity, or profitability - we handle that separately.
- Focus ONLY on: Are these the same event? Same timeframe? Same subject?

MARKET 1 (Polymarket):
- Question: "${polyQuestion}"
- Resolution Date: ${polyDateStr}
- Resolution Rules: ${polyRulesStr}

MARKET 2 (Kalshi):
- Question: "${kalshiTitle}"
- Resolution Date: ${kalshiDateStr}
- Resolution Rules: ${kalshiRulesStr}

=== STEP 0: SUBJECT EXTRACTION (Critical for multi-outcome markets) ===

Extract the TRUE SUBJECT from each market:
- Polymarket: Subject is usually in the question ("Will Connor Hellebuyck win?" → Subject = Connor Hellebuyck)
- Kalshi: If title is generic ("Who will win X?"), check RESOLUTION RULES for the subject

⚠️ A generic Kalshi title + resolution rules mentioning a specific person IS A MATCH for Polymarket asking about that person!

=== STEP 1: EVENT CHECK ===
- Are they asking about the EXACT SAME real-world outcome for the SAME SUBJECT?
- Compare EXTRACTED subjects, not just titles!
- "Musk announces run" ≠ "Musk becomes trillionaire" (DIFFERENT events)
→ If subjects or events differ, return false.

=== STEP 2: TIMEFRAME CHECK ===
- Do they resolve at effectively the same time?
- "by Dec 31, 2026" = "before Jan 1, 2027" (SAME)
- "2025" vs "2029" (DIFFERENT - reject!)
→ If timeframes differ significantly, return false.

=== STEP 3: MATCH TYPE ===
- DIRECT: Same question, both resolve YES/NO together
- INVERSE: Opposite questions - one resolves YES exactly when other resolves NO
  Example: "Will NO ONE leave?" vs "Will ANYONE leave?" = INVERSE (perfectly opposite)
- "Win election" ≠ "Be on ballot" (implication, not equivalence)

=== MATCH TYPES ===

**DIRECT MATCH**: Same question, same timeframe, same resolution logic.
Example 1: "Will aliens be confirmed before 2027?" on both platforms.
Example 2: "Will Connor Hellebuyck win Hart?" + Kalshi's "Who will win Hart?" with rules "if Hellebuyck wins..."

**INVERSE MATCH**: Opposite questions with same timeframe.
Example: "Will NO ONE leave Cabinet before 2027?" vs "Will ANYONE leave Cabinet before 2027?"
- Delta-neutral hedge: Buy YES on BOTH markets
- If no one leaves: Poly YES=$1, Kalshi YES=$0 → Total $1
- If someone leaves: Poly YES=$0, Kalshi YES=$1 → Total $1
- This IS delta-neutral: guaranteed $1 payout regardless of outcome!

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
- isExactMatch = true if DIRECT match (same question) OR INVERSE match (opposite questions)
- isExactMatch = false ONLY if they are NOT about the same event/subject/timeframe
- matchType = "DIRECT", "INVERSE", or "NONE"
- reason = brief explanation with [TYPE:DIRECT] or [TYPE:INVERSE] prefix for matches
`,
  });

  // Prepend match type to reason for downstream parsing
  const finalReason = object.isExactMatch
    ? `[TYPE:${object.matchType}] ${object.reason}`
    : object.reason;

  return { isExactMatch: object.isExactMatch, reason: finalReason };
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
  kalshiResolutionRules?: string,
): Promise<AIMatchResult> {
  const matchHash = generateMatchHash(polyQuestion, kalshiTitle);

  // Check cache first
  const cached = await checkCache(matchHash);
  if (cached) {
    logger.info("AI match cache hit", { matchHash, isExactMatch: cached.isExactMatch });
    return cached;
  }

  // Check daily limit
  const { allowed, current, limit } = await checkDailyLimit();
  if (!allowed) {
    logger.warn("AI match daily limit reached", { current, limit });
    // Return CONSERVATIVE rejection when limit reached - don't show untested pairs
    return {
      isExactMatch: false,
      reason: "Daily AI limit reached - rejected for safety",
      fromCache: false,
    };
  }

  // Call AI
  try {
    logger.info("Calling AI for match verification", {
      poly: polyQuestion.substring(0, 50),
      kalshi: kalshiTitle.substring(0, 50),
    });

    const result = await callAI(
      polyQuestion,
      kalshiTitle,
      polyEndDate,
      kalshiEndDate,
      polyResolutionRules,
      kalshiResolutionRules,
    );

    // Increment counter
    await incrementDailyCount();

    // Cache result with context
    await cacheResult(matchHash, polyQuestion, kalshiTitle, result.isExactMatch, result.reason, {
      polyEndDate,
      kalshiEndDate,
      polyResolutionRules,
      kalshiResolutionRules,
    });

    logger.info("AI match result", {
      isExactMatch: result.isExactMatch,
      reason: result.reason.substring(0, 100),
    });

    return { ...result, fromCache: false };
  } catch (error) {
    logger.error("AI match verification failed", { error: (error as Error).message });
    // On error, return optimistic match
    return {
      isExactMatch: true,
      reason: "AI verification failed, using text similarity",
      fromCache: false,
    };
  }
}

/**
 * Get current daily usage stats
 */
export async function getAIUsageStats(): Promise<{ today: number; limit: number }> {
  const { current, limit } = await checkDailyLimit();
  return { today: current, limit };
}
