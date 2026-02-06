/**
 * Strategy Engine - PPH (Profit Per Hour) Scoring
 *
 * Implements the "Fast Money" strategy that prioritizes
 * capital velocity over raw profit percentage.
 *
 * All entry/exit decisions are based on buyPrice (actual order book price),
 * NOT the displayed probability from Polymarket API.
 *
 * Supports multiple bot instances with different configurations.
 */

import type { BotInstanceConfig } from "./config/index.js";
import type { ScoredOpportunity } from "./types.js";
import type { NearResolutionOpportunity } from "../types.js";
import { logger } from "../logger.js";
import { PolymarketClient } from "../clients/polymarketClient.js";
import { checkEffectivePrice, parseOrderBookEntries } from "./orderBookUtils.js";

/**
 * Get the max hours until resolution for a market based on its tags.
 * Uses the lowest matching limit if multiple tags apply.
 */
function getMaxHoursForTags(
  tags: string[] | undefined,
  defaultMaxHours: number,
  categoryTimeLimits: Record<string, number>,
): number {
  if (!tags || tags.length === 0) return defaultMaxHours;

  let minLimit = defaultMaxHours;
  for (const tag of tags) {
    const categoryLimit = categoryTimeLimits[tag];
    if (categoryLimit !== undefined && categoryLimit < minLimit) {
      minLimit = categoryLimit;
    }
  }
  return minLimit;
}

/**
 * Check if an opportunity meets the strategy criteria for a given config.
 *
 * Uses buyPrice (actual order book price) for all checks, NOT probability.
 *
 * Rules:
 * - Below minOdds: Skip
 * - Above maxOdds: Skip (too close to $1, no profit)
 * - Between highOddsThreshold and maxOdds: Only if resolving within maxHoursForHighOdds
 * - Category-specific time limits apply
 */
export function isValidOpportunity(
  buyPrice: number,
  hoursUntilClose: number,
  config: BotInstanceConfig,
  tags?: string[],
): { valid: boolean; reason?: string } {
  // Market already closed
  if (hoursUntilClose <= 0) {
    return { valid: false, reason: "Market already closed" };
  }

  // Skip blacklisted categories
  if (tags && config.skipCategories.length > 0) {
    const skipLower = config.skipCategories.map((s) => s.toLowerCase());
    const matchedTag = tags.find((tag) => skipLower.includes(tag.toLowerCase()));
    if (matchedTag) {
      return {
        valid: false,
        reason: `Category "${matchedTag}" is in skipCategories blocklist`,
      };
    }
  }

  // Skip above maxOdds (too little profit)
  if (buyPrice >= config.maxOdds) {
    return {
      valid: false,
      reason: `Buy price ${(buyPrice * 100).toFixed(1)}¢ above max ${(config.maxOdds * 100).toFixed(1)}¢`,
    };
  }

  // Skip below minOdds
  if (buyPrice < config.minOdds) {
    return {
      valid: false,
      reason: `Buy price ${(buyPrice * 100).toFixed(1)}¢ below min ${(config.minOdds * 100).toFixed(0)}¢`,
    };
  }

  // High odds require faster resolution
  if (buyPrice >= config.highOddsThreshold) {
    if (hoursUntilClose > config.maxHoursForHighOdds) {
      return {
        valid: false,
        reason: `Buy price ${(buyPrice * 100).toFixed(1)}¢ ≥ ${(config.highOddsThreshold * 100).toFixed(0)}¢ threshold, must resolve within ${config.maxHoursForHighOdds}h (resolves in ${hoursUntilClose.toFixed(1)}h)`,
      };
    }
  }

  // Category-specific time limit (e.g., crypto = 3 hours max)
  const effectiveMaxHours = getMaxHoursForTags(
    tags,
    config.maxHoursGeneral,
    config.categoryTimeLimits,
  );
  if (hoursUntilClose > effectiveMaxHours) {
    return {
      valid: false,
      reason: `Category limit: resolves in ${hoursUntilClose.toFixed(1)}h, max ${effectiveMaxHours}h for tags [${tags?.join(", ") ?? "none"}]`,
    };
  }

  return { valid: true };
}

/**
 * Calculate Profit Per Hour (PPH) score.
 *
 * PPH = Profit if Win / Hours Until Close
 *
 * Higher PPH = faster capital turnover = more profit over time
 */
export function calculatePPH(buyPrice: number, hoursUntilClose: number): number {
  if (hoursUntilClose <= 0) return 0;

  // Profit if we win = $1 - buyPrice
  const profitIfWin = 1 - buyPrice;

  // PPH = how much profit per hour of capital locked
  return profitIfWin / hoursUntilClose;
}

/**
 * Calculate expected profit for a $1 bet.
 * For near-certainty bets, this is simply the profit if we win.
 */
export function calculateExpectedProfit(buyPrice: number): number {
  // Profit if win = $1 payout - buy price
  return 1 - buyPrice;
}

/**
 * Calculate max investment stats for best-case scenario analysis.
 *
 * - maxInvestment: How much $ can be deployed based on available liquidity
 * - maxProfitPercent: Return on investment if we win
 * - maxProfitAbsolute: Total profit at max investment
 */
export function calculateMaxInvestmentStats(
  buyPrice: number,
  liquidity: number,
): { maxInvestment: number; maxProfitPercent: number; maxProfitAbsolute: number } {
  // Max investment is limited by available liquidity at the ask price
  const maxInvestment = liquidity;

  // Profit % = (payout - cost) / cost * 100
  const maxProfitPercent = buyPrice > 0 ? ((1 - buyPrice) / buyPrice) * 100 : 0;

  // Absolute profit = (maxInvestment / buyPrice) - maxInvestment
  const maxProfitAbsolute = buyPrice > 0 ? maxInvestment / buyPrice - maxInvestment : 0;

  return {
    maxInvestment: Math.round(maxInvestment * 100) / 100,
    maxProfitPercent: Math.round(maxProfitPercent * 100) / 100,
    maxProfitAbsolute: Math.round(maxProfitAbsolute * 100) / 100,
  };
}

export class StrategyEngine {
  private config: BotInstanceConfig;
  private polyClient: PolymarketClient;

  constructor(config: BotInstanceConfig, polyClient?: PolymarketClient) {
    this.config = config;
    this.polyClient = polyClient ?? new PolymarketClient();
  }

  /**
   * Get the configuration this engine uses.
   */
  getConfig(): BotInstanceConfig {
    return this.config;
  }

  /**
   * Evaluate a list of near-resolution opportunities.
   * Uses buyPrice for all validation checks.
   */
  async evaluateOpportunities(
    opportunities: NearResolutionOpportunity[],
    existingPositionMarketIds: Set<string>,
  ): Promise<ScoredOpportunity[]> {
    const scored: ScoredOpportunity[] = [];

    for (const opp of opportunities) {
      try {
        const result = await this.evaluateSingleOpportunity(opp, existingPositionMarketIds);
        if (result) {
          scored.push(result);
        }
      } catch (error) {
        logger.error("StrategyEngine: Failed to evaluate opportunity", {
          marketId: opp.marketId,
          error: (error as Error).message,
        });
      }
    }

    // Sort by PPH score (highest first)
    scored.sort((a, b) => b.pphScore - a.pphScore);

    logger.info("StrategyEngine: Evaluated opportunities", {
      botId: this.config.id,
      botName: this.config.name,
      total: opportunities.length,
      valid: scored.filter((s) => s.canBet).length,
      invalid: scored.filter((s) => !s.canBet).length,
    });

    return scored;
  }

  /**
   * Evaluate a single opportunity.
   * All validation is based on buyPrice (order book), not probability.
   */
  private async evaluateSingleOpportunity(
    opp: NearResolutionOpportunity,
    existingPositionMarketIds: Set<string>,
  ): Promise<ScoredOpportunity | null> {
    const { likelyOutcome, oppositeOutcome, hoursUntilClose, closesAt, marketId, question } = opp;
    const probability = likelyOutcome.probability; // Keep for informational purposes only
    const buyPrice = likelyOutcome.bestAsk;
    const oppositeTokenId = oppositeOutcome?.tokenId;

    // Check if we already have a position (for THIS bot instance only)
    if (existingPositionMarketIds.has(marketId)) {
      const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        oppositeTokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice,
        hoursUntilClose,
        closesAt,
        liquidity: likelyOutcome.liquidity,
        pphScore: 0,
        expectedProfit: 0,
        canBet: false,
        skipReason: "Already have position in this market",
        ...maxStats,
      };
    }

    // Validate against strategy rules using buyPrice
    const validation = isValidOpportunity(buyPrice, hoursUntilClose, this.config, opp.tags);
    if (!validation.valid) {
      const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        oppositeTokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice,
        hoursUntilClose,
        closesAt,
        liquidity: likelyOutcome.liquidity,
        pphScore: 0,
        expectedProfit: 0,
        canBet: false,
        skipReason: validation.reason,
        ...maxStats,
      };
    }

    // Calculate scores
    const pphScore = calculatePPH(buyPrice, hoursUntilClose);
    const expectedProfit = calculateExpectedProfit(buyPrice);

    // Skip if expected value is negative (shouldn't happen if buyPrice < 1, but safety check)
    if (expectedProfit < 0) {
      const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        oppositeTokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice,
        hoursUntilClose,
        closesAt,
        liquidity: likelyOutcome.liquidity,
        pphScore,
        expectedProfit,
        canBet: false,
        skipReason: `Negative expected value: $${expectedProfit.toFixed(4)}`,
        ...maxStats,
      };
    }

    if (likelyOutcome.tokenId) {
      const priceCheckResult = await this.checkOrderBookPrice(
        likelyOutcome.tokenId,
        this.config.betSize,
        this.config.maxOdds,
      );

      if (!priceCheckResult.acceptable) {
        const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
        return {
          marketId,
          marketQuestion: question,
          marketSlug: opp.marketSlug,
          tokenId: likelyOutcome.tokenId,
          oppositeTokenId,
          outcome: likelyOutcome.name,
          probability,
          buyPrice,
          hoursUntilClose,
          closesAt,
          liquidity: likelyOutcome.liquidity,
          pphScore,
          expectedProfit,
          canBet: false,
          skipReason: priceCheckResult.reason ?? "Effective price check failed",
          ...maxStats,
        };
      }
    }

    const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
    return {
      marketId,
      marketQuestion: question,
      marketSlug: opp.marketSlug,
      tokenId: likelyOutcome.tokenId,
      oppositeTokenId,
      oppositeOutcome: oppositeOutcome?.name,
      tags: opp.tags,
      outcome: likelyOutcome.name,
      probability,
      buyPrice,
      hoursUntilClose,
      closesAt,
      liquidity: likelyOutcome.liquidity,
      pphScore,
      expectedProfit,
      canBet: true,
      ...maxStats,
    };
  }

  /**
   * Get the top opportunities to bet on, given budget constraints.
   * Ensures we never bet on the same market twice.
   */
  getTopOpportunities(
    scoredOpportunities: ScoredOpportunity[],
    maxBets: number,
  ): ScoredOpportunity[] {
    const bettable = scoredOpportunities.filter((opp) => opp.canBet);

    // Deduplicate by marketId - keep only the first (highest PPH) opportunity per market
    const seenMarkets = new Set<string>();
    const deduplicated = bettable.filter((opp) => {
      if (seenMarkets.has(opp.marketId)) {
        return false;
      }
      seenMarkets.add(opp.marketId);
      return true;
    });

    return deduplicated.slice(0, maxBets);
  }

  private async checkOrderBookPrice(
    tokenId: string,
    betSize: number,
    maxOdds: number,
  ): Promise<{ acceptable: boolean; reason?: string }> {
    try {
      const orderBook = await this.polyClient.getOrderBook(tokenId);
      if (!orderBook.asks || orderBook.asks.length === 0) {
        return { acceptable: false, reason: "No asks in order book" };
      }

      const asks = parseOrderBookEntries(orderBook.asks);
      const result = checkEffectivePrice(asks, betSize, maxOdds);

      if (!result.acceptable) {
        logger.debug("StrategyEngine: Effective price check failed", {
          tokenId,
          betSize,
          maxOdds,
          effectivePrice: result.effectivePrice,
          bestAsk: result.bestAsk,
          profitIfWin: result.profitIfWin,
          reason: result.reason,
        });
      }

      return { acceptable: result.acceptable, reason: result.reason };
    } catch (error) {
      logger.warn("StrategyEngine: Failed to check order book price", {
        tokenId,
        error: (error as Error).message,
      });
      return { acceptable: false, reason: `Order book fetch failed: ${(error as Error).message}` };
    }
  }
}
