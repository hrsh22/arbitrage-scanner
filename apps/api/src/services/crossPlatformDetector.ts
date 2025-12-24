import type { NormalizedMarket } from "../types.js";
import type { KalshiMarket } from "../clients/kalshiClient.js";
import { matchMarkets, type MarketMatch } from "./marketMatcher.js";
import { verifyMatch } from "./aiMatchVerifier.js";
import { logger } from "../logger.js";

export type CrossPlatformOpportunity = {
  id: string;
  matchConfidence: number;
  matchReason: string;
  matchType: "high" | "medium" | "low";
  aiVerified?: boolean;
  aiReason?: string;

  polymarket: {
    id: string;
    question: string;
    slug?: string;
    url: string;
    yesBestBid: number;
    yesBestAsk: number;
    noBestBid: number;
    noBestAsk: number;
    endsAt?: string;
    liquidity?: number;
    volume?: number;
  };

  kalshi: {
    ticker: string;
    eventTicker: string; // Event ticker for URL building
    title: string;
    url: string;
    yesBid: number;
    yesAsk: number;
    noBid: number;
    noAsk: number;
    closeTime?: string;
    volume?: number;
    liquidity?: number;
  };

  arbitrage: {
    type:
      | "poly-yes-kalshi-no"
      | "poly-no-kalshi-yes"
      | "poly-yes-kalshi-yes"
      | "poly-no-kalshi-no"
      | "none";
    totalCost: number;
    profit: number;
    profitPct: number;
    instruction: string;
  };

  detectedAt: string;
};

/**
 * Build Kalshi URL
 * Format: https://kalshi.com/markets/{baseEventTicker}/{slug}/{ticker}
 * Note: Event tickers like "SENATEDE-26" need to become "senatede" (strip numeric suffix)
 */
function buildKalshiUrl(kalshi: KalshiMarket): string {
  // Create slug from title: lowercase, replace spaces with hyphens, remove special chars
  const slug = kalshi.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") // Trim leading/trailing hyphens
    .substring(0, 60);

  // Strip numeric suffix from event ticker (e.g., SENATEDE-26 -> senatede)
  const baseEventTicker = kalshi.eventTicker.toLowerCase().replace(/-\d+$/, "");

  return `https://kalshi.com/markets/${baseEventTicker}/${slug}/${kalshi.ticker.toLowerCase()}`;
}

type ArbitrageResult = CrossPlatformOpportunity["arbitrage"];

/**
 * Calculate potential arbitrage for BOTH Direct and Inverse strategies.
 * We don't know which one is valid until AI confirms the relationship.
 */
function calculateArbitragePotentials(match: MarketMatch): {
  direct: ArbitrageResult;
  inverse: ArbitrageResult;
} {
  const poly = match.polymarket;
  const kalshi = match.kalshi;

  const polyYesAsk = poly.outcomes[0]?.bestAsk ?? null;
  const polyNoAsk = poly.outcomes[1]?.bestAsk ?? null;
  const kalshiYesAsk = kalshi.yesAsk;
  const kalshiNoAsk = kalshi.noAsk;

  // --- DIRECT STRATEGY (Hedge: Yes/No or No/Yes) ---
  // If markets are measuring the SAME outcome, we buy Opposite sides.
  let directArb: ArbitrageResult = {
    type: "none",
    totalCost: 1,
    profit: 0,
    profitPct: 0,
    instruction: "No direct arbitrage",
  };

  // Strategy 1: Buy Yes on Polymarket + Buy No on Kalshi
  if (polyYesAsk !== null && polyYesAsk > 0 && kalshiNoAsk > 0) {
    const cost = polyYesAsk + kalshiNoAsk;
    if (cost < 1 && cost < directArb.totalCost) {
      const profit = 1 - cost;
      directArb = {
        type: "poly-yes-kalshi-no",
        totalCost: cost,
        profit,
        profitPct: (profit / cost) * 100,
        instruction: `Buy YES on Polymarket @ ${(polyYesAsk * 100).toFixed(1)}¢ + Buy NO on Kalshi @ ${(kalshiNoAsk * 100).toFixed(1)}¢`,
      };
    }
  }
  // Strategy 2: Buy No on Polymarket + Buy Yes on Kalshi
  if (polyNoAsk !== null && polyNoAsk > 0 && kalshiYesAsk > 0) {
    const cost = polyNoAsk + kalshiYesAsk;
    if (cost < 1 && cost < directArb.totalCost) {
      const profit = 1 - cost;
      directArb = {
        type: "poly-no-kalshi-yes",
        totalCost: cost,
        profit,
        profitPct: (profit / cost) * 100,
        instruction: `Buy NO on Polymarket @ ${(polyNoAsk * 100).toFixed(1)}¢ + Buy YES on Kalshi @ ${(kalshiYesAsk * 100).toFixed(1)}¢`,
      };
    }
  }

  // --- INVERSE STRATEGY (Hedge: Yes/Yes or No/No) ---
  // If markets are Opposite (Inverse), we buy SAME sides to hedge.
  let inverseArb: ArbitrageResult = {
    type: "none",
    totalCost: 1,
    profit: 0,
    profitPct: 0,
    instruction: "No inverse arbitrage",
  };

  // Strategy 3: Buy Yes on Polymarket + Buy Yes on Kalshi
  if (polyYesAsk !== null && polyYesAsk > 0 && kalshiYesAsk > 0) {
    const cost = polyYesAsk + kalshiYesAsk;
    if (cost < 1 && cost < inverseArb.totalCost) {
      const profit = 1 - cost;
      inverseArb = {
        type: "poly-yes-kalshi-yes",
        totalCost: cost,
        profit,
        profitPct: (profit / cost) * 100,
        instruction: `Buy YES on Polymarket @ ${(polyYesAsk * 100).toFixed(1)}¢ + Buy YES on Kalshi @ ${(kalshiYesAsk * 100).toFixed(1)}¢`,
      };
    }
  }
  // Strategy 4: Buy No on Polymarket + Buy No on Kalshi
  if (polyNoAsk !== null && polyNoAsk > 0 && kalshiNoAsk > 0) {
    const cost = polyNoAsk + kalshiNoAsk;
    if (cost < 1 && cost < inverseArb.totalCost) {
      const profit = 1 - cost;
      inverseArb = {
        type: "poly-no-kalshi-no",
        totalCost: cost,
        profit,
        profitPct: (profit / cost) * 100,
        instruction: `Buy NO on Polymarket @ ${(polyNoAsk * 100).toFixed(1)}¢ + Buy NO on Kalshi @ ${(kalshiNoAsk * 100).toFixed(1)}¢`,
      };
    }
  }

  return { direct: directArb, inverse: inverseArb };
}

/**
 * Build opportunity object from match and arbitrage
 */
function buildOpportunity(
  match: MarketMatch,
  arbitrage: ArbitrageResult,
  aiVerified?: boolean,
  aiReason?: string,
): CrossPlatformOpportunity {
  const poly = match.polymarket;
  const kalshi = match.kalshi;

  return {
    id: `${poly.id}-${kalshi.ticker}`,
    matchConfidence: match.confidence,
    matchReason: aiReason ? `${match.matchReason} (AI: ${aiReason})` : match.matchReason,
    matchType: match.matchType,
    aiVerified,
    aiReason,

    polymarket: {
      id: poly.id,
      question: poly.question,
      slug: poly.eventSlug ?? poly.slug ?? undefined,
      url: `https://polymarket.com/event/${poly.eventSlug ?? poly.slug}`,
      yesBestBid: poly.outcomes[0]?.bestBid ?? 0,
      yesBestAsk: poly.outcomes[0]?.bestAsk ?? 0,
      noBestBid: poly.outcomes[1]?.bestBid ?? 0,
      noBestAsk: poly.outcomes[1]?.bestAsk ?? 0,
      endsAt: poly.endsAt?.toISOString(),
      liquidity: poly.liquidity, // Market-level liquidity from Gamma API
      volume: poly.volume, // Market-level volume from Gamma API
    },

    kalshi: {
      ticker: kalshi.ticker,
      eventTicker: kalshi.eventTicker, // For URL building
      title: kalshi.title,
      url: buildKalshiUrl(kalshi),
      yesBid: kalshi.yesBid,
      yesAsk: kalshi.yesAsk,
      noBid: kalshi.noBid,
      noAsk: kalshi.noAsk,
      closeTime: kalshi.closeTime,
      volume: kalshi.volume,
      liquidity: kalshi.liquidity,
    },

    arbitrage,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Detect cross-platform arbitrage opportunities
 *
 * Flow:
 * 1. Fast text matching (no AI)
 * 2. Calculate potential arbitrage (Direct vs Inverse)
 * 3. AI verify profitable candidates AND determine relationship type
 * 4. Return confirmed arbitrage opportunities
 */
export async function detectCrossPlatformArbitrage(
  polymarkets: NormalizedMarket[],
  kalshiMarkets: KalshiMarket[],
): Promise<CrossPlatformOpportunity[]> {
  // Step 1: Fast text matching
  const matches = matchMarkets(polymarkets, kalshiMarkets);

  logger.info("Cross-platform: Text matching complete", {
    polymarkets: polymarkets.length,
    kalshiMarkets: kalshiMarkets.length,
    matches: matches.length,
  });

  // Step 2: Calculate potentials for all matches
  // We keep matches if EITHER Direct OR Inverse strategy shows potential
  const candidates: Array<{
    match: MarketMatch;
    potentials: { direct: ArbitrageResult; inverse: ArbitrageResult };
  }> = [];
  const noArbMatches: Array<{ match: MarketMatch; arbitrage: ArbitrageResult }> = [];

  for (const match of matches) {
    const potentials = calculateArbitragePotentials(match);
    if (potentials.direct.type !== "none" || potentials.inverse.type !== "none") {
      candidates.push({ match, potentials });
    } else {
      // Just default to direct for display logic of non-arbs
      noArbMatches.push({ match, arbitrage: potentials.direct });
    }
  }

  logger.info("Cross-platform: Arbitrage calculated", {
    withPotentialArbitrage: candidates.length,
    withoutArbitrage: noArbMatches.length,
  });

  // Step 3: AI verify ONLY arbitrage candidates
  const opportunities: CrossPlatformOpportunity[] = [];

  if (candidates.length > 0) {
    logger.info("Cross-platform: AI verifying arbitrage opportunities", {
      count: candidates.length,
    });

    // Parallel AI verification for speed
    const verificationPromises = candidates.map(async ({ match, potentials }) => {
      const polyQuestion = match.polymarket.question || match.polymarket.eventTitle || "";
      const kalshiTitle = match.kalshi.title;

      try {
        const polyEndDate = match.polymarket.endsAt?.toISOString() ?? undefined;
        const kalshiEndDate = match.kalshi.closeTime ?? undefined;
        const polyResolutionRules = match.polymarket.description ?? undefined;
        const kalshiResolutionRules = match.kalshi.rulesPrimary ?? undefined;

        const aiResult = await verifyMatch(
          polyQuestion,
          kalshiTitle,
          polyEndDate,
          kalshiEndDate,
          polyResolutionRules,
          kalshiResolutionRules,
        );

        if (aiResult.isExactMatch) {
          // PARSE MATCH TYPE FROM AI REASON
          // Expected format: "[TYPE:INVERSE] ..." or default to DIRECT if parsing fails but match is true
          let selectedArbitrage = potentials.direct; // Default to direct

          if (aiResult.reason.includes("[TYPE:INVERSE]")) {
            selectedArbitrage = potentials.inverse;
          } else if (aiResult.reason.includes("[TYPE:DIRECT]")) {
            selectedArbitrage = potentials.direct;
          } else {
            // Fallback: If AI says match but didn't specify, assume Direct unless Inverse is the only profitable one?
            // Actually, safer to assume Direct.
            // However, if logic dictates Inverse, AI should have tagged it.
            // We can also try heuristics: if potential.inverse.profit >>> potential.direct.profit, maybe check text?
            // For now, trust the tag.
            // If tag missing, use Direct.
            const isInverseLikely =
              potentials.inverse.type !== "none" && potentials.direct.type === "none";
            if (isInverseLikely) {
              // If ONLY inverse has profit, maybe AI missed the tag? But safer to use Direct (and show no arb) to avoid loss.
              // Wait, if AI verified it as a match, it usually implies Direct unless stated otherwise.
              // So selectedArbitrage = potentials.direct is correct.
            }
          }

          // If the selected strategy has no arbitrage, we still return the verified match, but with type="none"
          // This avoids showing fake "293% profit" (Direct) when it's actually an Inverse match (maybe 2% profit or loss).

          return buildOpportunity(match, selectedArbitrage, true, aiResult.reason);
        } else {
          logger.info("AI rejected arbitrage match", {
            poly: polyQuestion.substring(0, 40),
            kalshi: kalshiTitle.substring(0, 40),
            reason: aiResult.reason,
          });
          return null;
        }
      } catch (error) {
        logger.error("AI verification failed", { error: (error as Error).message });
        return buildOpportunity(match, potentials.direct, false, "AI verification failed");
      }
    });

    const results = await Promise.all(verificationPromises);
    const verified = results.filter((r): r is CrossPlatformOpportunity => r !== null);
    opportunities.push(...verified);

    logger.info("Cross-platform: AI verification complete", {
      verified: verified.length,
      rejected: candidates.length - verified.length,
    });
  }

  // Step 4: Add non-arbitrage high-confidence matches (for display)
  for (const { match, arbitrage } of noArbMatches.slice(0, 10)) {
    opportunities.push(buildOpportunity(match, arbitrage));
  }

  // Sort
  opportunities.sort((a, b) => {
    if (a.arbitrage.type !== "none" && b.arbitrage.type === "none") return -1;
    if (a.arbitrage.type === "none" && b.arbitrage.type !== "none") return 1;
    if (a.arbitrage.profitPct !== b.arbitrage.profitPct) {
      return b.arbitrage.profitPct - a.arbitrage.profitPct;
    }
    return b.matchConfidence - a.matchConfidence;
  });

  return opportunities;
}
