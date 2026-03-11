/**
 * Hedging Checker — Loss Protection for Vault Positions
 *
 * Monitors open positions for price drops and places opposite-outcome
 * hedge bets to limit downside risk.
 *
 * Ported from apps/api/src/bot/hedgingChecker.ts
 * Adapted: BotInstanceConfig → VaultInstanceConfig,
 *          BotRepository → PositionRepository,
 *          TradingClient → VaultTradingClient
 */

import type { VaultInstanceConfig, HedgingConfig } from "../config/types.js";
import type { VaultTradingClient } from "./tradingClient.js";
import type { PositionRepository } from "../repositories/positionRepository.js";
import { HedgeEvaluationResult, type HedgeEvaluationResultType } from "../types.js";
import { env } from "../env.js";
import { logger } from "../logger.js";

export interface HedgeCheckResult {
  checked: number;
  hedged: number;
  skipped: number;
  errors: number;
}

interface PositionToEvaluate {
  dbId: number;
  tokenId: string;
  oppositeTokenId: string | null;
  outcome: string;
  entryPrice: number;
  cost: number;
  closesAt: Date | null;
  createdAt: Date;
  marketId: string;
  marketQuestion: string;
  conditionId: string;
}

const GAMMA_MARKET_URL = "https://gamma-api.polymarket.com/markets";

export class HedgingChecker {
  private config: VaultInstanceConfig;
  private hedgingConfig: HedgingConfig;
  private tradingClient: VaultTradingClient;
  private repository: PositionRepository;

  constructor(
    config: VaultInstanceConfig,
    tradingClient: VaultTradingClient,
    repository: PositionRepository,
  ) {
    this.config = config;
    this.hedgingConfig = config.hedging;
    this.tradingClient = tradingClient;
    this.repository = repository;
  }

  async checkAndHedgePositions(): Promise<HedgeCheckResult> {
    const result: HedgeCheckResult = { checked: 0, hedged: 0, skipped: 0, errors: 0 };

    if (!this.hedgingConfig.enabled) {
      logger.debug("HedgingChecker: Hedging disabled", { vaultId: this.config.id });
      return result;
    }

    const positions = await this.getPositionsToCheck();
    if (positions.length === 0) {
      logger.info("HedgingChecker: No positions to check", { vaultId: this.config.id });
      return result;
    }

    result.checked = positions.length;

    for (const position of positions) {
      try {
        const hedgeResult = await this.evaluateAndHedge(position);
        if (hedgeResult === HedgeEvaluationResult.HEDGED) {
          result.hedged++;
        } else if (hedgeResult === HedgeEvaluationResult.SKIPPED) {
          result.skipped++;
        }
      } catch (error) {
        result.errors++;
        logger.error("HedgingChecker: evaluateAndHedge failed", {
          vaultId: this.config.id,
          positionId: position.dbId,
          marketId: position.marketId,
          error: (error as Error).message,
        });
      }
    }

    logger.info("HedgingChecker: Check complete", {
      vaultId: this.config.id,
      ...result,
    });

    return result;
  }

  private async getPositionsToCheck(): Promise<PositionToEvaluate[]> {
    const dbPositions = await this.repository.getOpenPositions();

    const positions: PositionToEvaluate[] = [];
    for (const pos of dbPositions) {
      if (pos.tokenId && pos.costBasis && pos.quantity) {
        const quantity = parseFloat(pos.quantity);
        const costBasis = parseFloat(pos.costBasis);
        const entryPrice = quantity > 0 ? costBasis / quantity : 0;

        positions.push({
          dbId: pos.id,
          tokenId: pos.tokenId,
          oppositeTokenId: null, // Vault DB doesn't track opposite token yet
          outcome: pos.outcome,
          entryPrice,
          cost: costBasis,
          closesAt: null, // Could be enriched from Gamma API if needed
          createdAt: pos.openedAt,
          marketId: pos.marketId,
          marketQuestion: pos.marketId, // Vault DB doesn't store question
          conditionId: pos.conditionId,
        });
      }
    }

    return positions;
  }

  private async evaluateAndHedge(position: PositionToEvaluate): Promise<HedgeEvaluationResultType> {
    if (!position.oppositeTokenId) {
      // Try to look up the opposite token from Gamma API
      const oppositeInfo = await this.getOppositeTokenInfo(position.marketId, position.tokenId);
      if (!oppositeInfo) {
        logger.debug("HedgingChecker: Could not determine opposite token", {
          positionId: position.dbId,
          marketId: position.marketId,
        });
        return HedgeEvaluationResult.SKIPPED;
      }
      position.oppositeTokenId = oppositeInfo.tokenId;
    }

    if (this.hedgingConfig.skipCategories.length > 0) {
      // Category check would require fetching tags from Gamma API
      // For now, skip this check — vault config already filters categories at scan time
    }

    const now = new Date();
    const positionAgeMinutes = (now.getTime() - position.createdAt.getTime()) / (1000 * 60);
    if (positionAgeMinutes < this.hedgingConfig.minPositionAgeMinutes) {
      return HedgeEvaluationResult.NOT_NEEDED;
    }

    if (this.hedgingConfig.onlyNearResolution && position.closesAt) {
      const minutesUntilClose = (position.closesAt.getTime() - now.getTime()) / (1000 * 60);
      if (minutesUntilClose > this.hedgingConfig.nearResolutionMinutes) {
        return HedgeEvaluationResult.NOT_NEEDED;
      }
    }

    const priceData = await this.getValidatedCurrentPrice(position.tokenId);
    if (priceData === null) {
      logger.warn("HedgingChecker: Could not get valid current price", {
        positionId: position.dbId,
        tokenId: position.tokenId,
      });
      return HedgeEvaluationResult.SKIPPED;
    }

    const { currentPrice, lastTradePrice } = priceData;
    const entryPrice = position.entryPrice;
    const dropPercent = ((entryPrice - currentPrice) / entryPrice) * 100;

    if (dropPercent < this.hedgingConfig.dropThresholdPercent) {
      return HedgeEvaluationResult.NOT_NEEDED;
    }

    logger.info("HedgingChecker: Position triggered hedge threshold", {
      positionId: position.dbId,
      entryPrice,
      currentPrice,
      lastTradePrice,
      dropPercent: dropPercent.toFixed(1),
      threshold: this.hedgingConfig.dropThresholdPercent,
    });

    const oppositeAskPrice = await this.getAskPrice(position.oppositeTokenId);
    if (oppositeAskPrice === null) {
      logger.warn("HedgingChecker: Could not get opposite price", {
        positionId: position.dbId,
      });
      return HedgeEvaluationResult.SKIPPED;
    }

    if (oppositeAskPrice > 0.99) {
      logger.info("HedgingChecker: Opposite price > 99¢, hedging not worthwhile", {
        positionId: position.dbId,
        oppositeAskPrice,
      });
      return HedgeEvaluationResult.SKIPPED;
    }

    const theoreticalOpposite = 1 - currentPrice;
    const maxAcceptablePrice = theoreticalOpposite + this.hedgingConfig.spreadTolerance;

    if (oppositeAskPrice > maxAcceptablePrice) {
      logger.info("HedgingChecker: Opposite price too high, skipping", {
        positionId: position.dbId,
        oppositeAskPrice,
        maxAcceptable: maxAcceptablePrice,
        theoreticalOpposite,
      });
      return HedgeEvaluationResult.SKIPPED;
    }

    const originalShares = position.cost / position.entryPrice;
    const hedgeShares = originalShares * this.hedgingConfig.multiplier;
    const hedgeAmount = hedgeShares * oppositeAskPrice;

    if (env.VAULT_MODE === "simulation") {
      logger.info("HedgingChecker: [SIM] Would place hedge", {
        vaultId: this.config.id,
        positionId: position.dbId,
        marketId: position.marketId,
        oppositeTokenId: position.oppositeTokenId,
        hedgePrice: oppositeAskPrice,
        hedgeCost: hedgeAmount,
        hedgeShares,
        dropPercent,
      });
      return HedgeEvaluationResult.HEDGED;
    }

    if (!this.tradingClient.isInitialized()) {
      logger.warn("HedgingChecker: Trading client not initialized for live hedge");
      return HedgeEvaluationResult.SKIPPED;
    }

    const tradeResult = await this.tradingClient.createOrder(
      position.oppositeTokenId,
      "buy",
      maxAcceptablePrice,
      hedgeShares,
    );

    if (tradeResult.success) {
      logger.info("HedgingChecker: Hedge placed", {
        vaultId: this.config.id,
        positionId: position.dbId,
        marketId: position.marketId,
        orderId: tradeResult.orderId,
        hedgePrice: tradeResult.avgPrice ?? oppositeAskPrice,
        hedgeCost: hedgeAmount,
        hedgeShares,
        dropPercent,
      });

      // Record hedge as a new position in the repository
      const oppositeOutcome = position.outcome === "YES" ? "NO" : "YES";
      await this.repository.createPosition({
        positionId: `hedge-${Date.now()}-${position.dbId}`,
        marketId: position.marketId,
        conditionId: position.conditionId,
        tokenId: position.oppositeTokenId,
        outcome: oppositeOutcome as "YES" | "NO",
        costBasis: hedgeAmount.toFixed(6),
        quantity: hedgeShares.toFixed(6),
      });

      return HedgeEvaluationResult.HEDGED;
    } else {
      logger.error("HedgingChecker: Hedge trade failed", {
        positionId: position.dbId,
        error: tradeResult.error,
      });
      return HedgeEvaluationResult.SKIPPED;
    }
  }

  private async getAskPrice(tokenId: string): Promise<number | null> {
    try {
      const orderBook = await this.tradingClient.getOrderBook(tokenId);
      if (orderBook.asks.length > 0) {
        const askPrices = orderBook.asks.map((a) => a.price);
        return Math.min(...askPrices);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get the current BUY price (ask) for a token to determine drop from entry.
   *
   * We use ASK price because:
   * - Entry price = what we PAID to buy (the ask at that time)
   * - Current price for drop calculation = what we'd PAY to buy now (the ask now)
   * - This compares apples to apples: buy price vs buy price
   */
  private async getValidatedCurrentPrice(
    tokenId: string,
  ): Promise<{ currentPrice: number; lastTradePrice: number } | null> {
    try {
      const orderBook = await this.tradingClient.getOrderBook(tokenId);

      const bestAsk =
        orderBook.asks.length > 0 ? Math.min(...orderBook.asks.map((a) => a.price)) : null;

      if (bestAsk === null) {
        return null;
      }

      if (bestAsk >= 0.01) {
        return { currentPrice: bestAsk, lastTradePrice: bestAsk };
      }

      if (bestAsk < 0.01) {
        logger.warn("HedgingChecker: Ask is < 1¢, order book unreliable, skipping", {
          tokenId,
          bestAsk,
        });
        return null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Look up the opposite token for a market from the Gamma API.
   */
  private async getOppositeTokenInfo(
    marketId: string,
    currentTokenId: string,
  ): Promise<{ tokenId: string; name: string } | null> {
    try {
      const response = await fetch(`${GAMMA_MARKET_URL}/${marketId}`);
      if (!response.ok) return null;

      const market = (await response.json()) as {
        tokens?: Array<{
          token_id?: string;
          tokenId?: string;
          outcome?: string;
        }>;
      };

      if (!market.tokens || !Array.isArray(market.tokens)) return null;

      for (const token of market.tokens) {
        const tokenId = token.token_id ?? token.tokenId;
        if (tokenId && tokenId !== currentTokenId) {
          return { tokenId, name: token.outcome ?? "Unknown" };
        }
      }

      return null;
    } catch (error) {
      logger.error("HedgingChecker: Failed to get opposite token info", {
        marketId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private shouldSkipCategory(tags: string[] | null): { skip: boolean; matchedCategory?: string } {
    if (this.hedgingConfig.skipCategories.length === 0 || !tags || tags.length === 0) {
      return { skip: false };
    }

    const skipSet = new Set(this.hedgingConfig.skipCategories.map((s) => s.toLowerCase()));

    for (const tag of tags) {
      if (skipSet.has(tag.toLowerCase())) {
        return { skip: true, matchedCategory: tag };
      }
    }

    return { skip: false };
  }
}
