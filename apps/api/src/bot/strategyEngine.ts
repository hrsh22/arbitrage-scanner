/**
 * Strategy Engine - PPH (Profit Per Hour) Scoring
 *
 * Implements the "Fast Money" strategy that prioritizes
 * capital velocity over raw profit percentage.
 */

import { BOT_CONFIG } from "./config.js";
import type { ScoredOpportunity, OrderBook } from "./types.js";
import type { NearResolutionOpportunity } from "../types.js";
import { logger } from "../logger.js";
import { TradingClient } from "./tradingClient.js";

/**
 * Check if an opportunity meets our dynamic odds threshold.
 *
 * Rules:
 * - 95-99¢: Allowed if resolving within 24 hours
 * - 99-99.5¢: Allowed only if resolving within 3 hours
 * - Above 99.5¢: Skip (too close to $1, no profit)
 */
export function isValidOpportunity(
  probability: number,
  hoursUntilClose: number,
): { valid: boolean; reason?: string } {
  // Skip above 99.5¢
  if (probability >= BOT_CONFIG.MAX_ODDS) {
    return {
      valid: false,
      reason: `Odds ${(probability * 100).toFixed(1)}¢ above max ${(BOT_CONFIG.MAX_ODDS * 100).toFixed(1)}¢`,
    };
  }

  // Skip below 95¢
  if (probability < BOT_CONFIG.MIN_ODDS) {
    return {
      valid: false,
      reason: `Odds ${(probability * 100).toFixed(1)}¢ below min ${(BOT_CONFIG.MIN_ODDS * 100).toFixed(0)}¢`,
    };
  }

  // 99-99.5¢ requires resolving within 3 hours
  if (probability >= BOT_CONFIG.HIGH_ODDS_THRESHOLD) {
    if (hoursUntilClose > BOT_CONFIG.MAX_HOURS_FOR_HIGH_ODDS) {
      return {
        valid: false,
        reason: `99¢+ market needs to resolve within ${BOT_CONFIG.MAX_HOURS_FOR_HIGH_ODDS}h, but resolves in ${hoursUntilClose.toFixed(1)}h`,
      };
    }
  }

  // General time limit
  if (hoursUntilClose > BOT_CONFIG.MAX_HOURS_GENERAL) {
    return {
      valid: false,
      reason: `Resolves in ${hoursUntilClose.toFixed(1)}h, max ${BOT_CONFIG.MAX_HOURS_GENERAL}h`,
    };
  }

  if (hoursUntilClose <= 0) {
    return { valid: false, reason: "Market already closed" };
  }

  return { valid: true };
}

/**
 * Calculate Profit Per Hour (PPH) score.
 *
 * For near-certainty bets (95%+), we assume we win.
 * PPH = Profit if Win / Hours Until Close
 *
 * Higher PPH = faster capital turnover = more profit over time
 */
export function calculatePPH(
  probability: number,
  buyPrice: number,
  hoursUntilClose: number,
): number {
  if (hoursUntilClose <= 0) return 0;

  // Profit if we win = $1 - buyPrice
  const profitIfWin = 1 - buyPrice;

  // For high-confidence bets, we assume we win
  // PPH = how much profit per hour of capital locked
  const pph = profitIfWin / hoursUntilClose;

  return pph;
}

/**
 * Calculate expected profit for a $1 bet.
 * For near-certainty bets, this is simply the profit if we win.
 */
export function calculateExpectedProfit(probability: number, buyPrice: number): number {
  // Simple: profit if win = $1 payout - buy price
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
  // Liquidity represents the $ value available at this price level
  const maxInvestment = liquidity;

  // Profit % = (payout - cost) / cost * 100
  // If buyPrice = 0.96, we pay $0.96 to get $1.00 → profit = $0.04 → 4.17%
  const maxProfitPercent = buyPrice > 0 ? ((1 - buyPrice) / buyPrice) * 100 : 0;

  // Absolute profit = maxInvestment * profit margin
  // Number of shares we can buy = maxInvestment / buyPrice
  // Payout if we win = shares * $1 = maxInvestment / buyPrice
  // Profit = payout - cost = (maxInvestment / buyPrice) - maxInvestment
  const maxProfitAbsolute = buyPrice > 0 ? maxInvestment / buyPrice - maxInvestment : 0;

  return {
    maxInvestment: Math.round(maxInvestment * 100) / 100,
    maxProfitPercent: Math.round(maxProfitPercent * 100) / 100,
    maxProfitAbsolute: Math.round(maxProfitAbsolute * 100) / 100,
  };
}

export class StrategyEngine {
  private tradingClient: TradingClient;

  constructor(tradingClient: TradingClient) {
    this.tradingClient = tradingClient;
  }

  /**
   * Evaluate a list of near-resolution opportunities.
   * Fetches order books and calculates PPH scores.
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
      total: opportunities.length,
      valid: scored.filter((s) => s.canBet).length,
      invalid: scored.filter((s) => !s.canBet).length,
    });

    return scored;
  }

  /**
   * Evaluate a single opportunity.
   */
  private async evaluateSingleOpportunity(
    opp: NearResolutionOpportunity,
    existingPositionMarketIds: Set<string>,
  ): Promise<ScoredOpportunity | null> {
    const { likelyOutcome, hoursUntilClose, closesAt, marketId, question } = opp;
    const probability = likelyOutcome.probability;

    // Check if we already have a position
    if (existingPositionMarketIds.has(marketId)) {
      const maxStats = calculateMaxInvestmentStats(likelyOutcome.bestAsk, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice: likelyOutcome.bestAsk,
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

    // Validate against strategy rules
    const validation = isValidOpportunity(probability, hoursUntilClose);
    if (!validation.valid) {
      const maxStats = calculateMaxInvestmentStats(likelyOutcome.bestAsk, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice: likelyOutcome.bestAsk,
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

    // Check liquidity
    if (likelyOutcome.liquidity < BOT_CONFIG.MIN_LIQUIDITY) {
      const maxStats = calculateMaxInvestmentStats(likelyOutcome.bestAsk, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice: likelyOutcome.bestAsk,
        hoursUntilClose,
        closesAt,
        liquidity: likelyOutcome.liquidity,
        pphScore: 0,
        expectedProfit: 0,
        canBet: false,
        skipReason: `Liquidity $${likelyOutcome.liquidity.toFixed(0)} below min $${BOT_CONFIG.MIN_LIQUIDITY}`,
        ...maxStats,
      };
    }

    // Use the best ask price from the opportunity data
    // In a full implementation, we'd fetch the actual order book here
    // to calculate slippage for our $1 bet
    const buyPrice = likelyOutcome.bestAsk;

    // Skip if buy price is below minimum (95c)
    if (buyPrice < BOT_CONFIG.MIN_ODDS) {
      const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice,
        hoursUntilClose,
        closesAt,
        liquidity: likelyOutcome.liquidity,
        pphScore: 0,
        expectedProfit: 0,
        canBet: false,
        skipReason: `Buy price ${(buyPrice * 100).toFixed(1)}¢ below min ${(BOT_CONFIG.MIN_ODDS * 100).toFixed(0)}¢`,
        ...maxStats,
      };
    }

    // Skip if buy price would give no profit (above 99.5c)
    if (buyPrice >= BOT_CONFIG.MAX_ODDS) {
      const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice,
        hoursUntilClose,
        closesAt,
        liquidity: likelyOutcome.liquidity,
        pphScore: 0,
        expectedProfit: 0,
        canBet: false,
        skipReason: `Buy price ${(buyPrice * 100).toFixed(1)}¢ above max ${(BOT_CONFIG.MAX_ODDS * 100).toFixed(1)}¢`,
        ...maxStats,
      };
    }

    // Additional check: if buyPrice is >= 99c, must close within MAX_HOURS_FOR_HIGH_ODDS
    if (
      buyPrice >= BOT_CONFIG.HIGH_ODDS_THRESHOLD &&
      hoursUntilClose > BOT_CONFIG.MAX_HOURS_FOR_HIGH_ODDS
    ) {
      const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
        outcome: likelyOutcome.name,
        probability,
        buyPrice,
        hoursUntilClose,
        closesAt,
        liquidity: likelyOutcome.liquidity,
        pphScore: 0,
        expectedProfit: 0,
        canBet: false,
        skipReason: `Buy price ${(buyPrice * 100).toFixed(1)}¢ ≥99¢ needs to close within ${BOT_CONFIG.MAX_HOURS_FOR_HIGH_ODDS}h`,
        ...maxStats,
      };
    }

    // Calculate scores
    const pphScore = calculatePPH(probability, buyPrice, hoursUntilClose);
    const expectedProfit = calculateExpectedProfit(probability, buyPrice);

    // Skip if expected value is negative
    if (expectedProfit < 0) {
      const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
      return {
        marketId,
        marketQuestion: question,
        marketSlug: opp.marketSlug,
        tokenId: likelyOutcome.tokenId,
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

    const maxStats = calculateMaxInvestmentStats(buyPrice, likelyOutcome.liquidity);
    return {
      marketId,
      marketQuestion: question,
      marketSlug: opp.marketSlug,
      tokenId: likelyOutcome.tokenId,
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
}
