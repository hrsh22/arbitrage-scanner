import type { BotInstanceConfig, HedgingConfig } from "./config/index.js";
import { TradingClient } from "./tradingClient.js";
import { BotRepository } from "./repository.js";
import { HedgeEvaluationResult, type HedgeEvaluationResultType } from "./hedgingConstants.js";
import { getSharedPolymarketClient } from "../clients/polymarketClient.js";
import { logger } from "../logger.js";
import { getErrorLogger } from "./errorLogger.js";

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
  oppositeOutcome: string | null;
  tags: string[] | null;
  outcome: string;
  entryPrice: number;
  cost: number;
  closesAt: Date | null;
  createdAt: Date;
  hedgedAt: Date | null;
  isSimulated: boolean;
  marketId: string;
  marketQuestion: string;
  marketSlug: string | null;
}

export class HedgingChecker {
  private config: BotInstanceConfig;
  private hedgingConfig: HedgingConfig;
  private tradingClient: TradingClient;
  private repository: BotRepository;

  constructor(config: BotInstanceConfig, tradingClient: TradingClient, repository: BotRepository) {
    this.config = config;
    this.hedgingConfig = config.hedging;
    this.tradingClient = tradingClient;
    this.repository = repository;
  }

  async checkAndHedgePositions(isSimulated: boolean): Promise<HedgeCheckResult> {
    const result: HedgeCheckResult = { checked: 0, hedged: 0, skipped: 0, errors: 0 };

    if (!this.hedgingConfig.enabled) {
      logger.debug("HedgingChecker: Hedging disabled", { botId: this.config.id });
      return result;
    }

    const positions = await this.getPositionsToCheck(isSimulated);
    if (positions.length === 0) {
      logger.info("HedgingChecker: No positions to check", { botId: this.config.id, isSimulated });
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
        const errorLogger = getErrorLogger(String(this.config.id));
        await errorLogger.logHedgeError(error as Error, {
          positionId: position.dbId,
          marketId: position.marketId,
          reason: "evaluateAndHedge failed",
        });
      }
    }

    logger.info("HedgingChecker: Check complete", {
      botId: this.config.id,
      ...result,
    });

    return result;
  }

  private async getPositionsToCheck(isSimulated: boolean): Promise<PositionToEvaluate[]> {
    const dbPositions = await this.repository.getOpenPositionsForHedging(isSimulated);

    const positions: PositionToEvaluate[] = [];
    for (const pos of dbPositions) {
      if (pos.tokenId && pos.entryPrice) {
        positions.push({
          dbId: pos.id,
          tokenId: pos.tokenId,
          oppositeTokenId: pos.oppositeTokenId,
          oppositeOutcome: pos.oppositeOutcome,
          tags: pos.tags,
          outcome: pos.outcome,
          entryPrice: parseFloat(pos.entryPrice),
          cost: parseFloat(pos.cost),
          closesAt: pos.closesAt,
          createdAt: pos.createdAt,
          hedgedAt: pos.hedgedAt,
          isSimulated: pos.isSimulated,
          marketId: pos.marketId,
          marketQuestion: pos.marketQuestion,
          marketSlug: pos.marketSlug,
        });
      }
    }

    return positions;
  }

  private async evaluateAndHedge(position: PositionToEvaluate): Promise<HedgeEvaluationResultType> {
    if (position.hedgedAt) {
      return HedgeEvaluationResult.SKIPPED;
    }

    if (!position.oppositeTokenId) {
      logger.debug("HedgingChecker: No opposite token ID", {
        positionId: position.dbId,
      });
      return HedgeEvaluationResult.SKIPPED;
    }

    if (this.hedgingConfig.skipCategories.length > 0) {
      const skipResult = this.shouldSkipCategory(position.tags);
      if (skipResult.skip) {
        logger.info("HedgingChecker: Skipping due to category", {
          positionId: position.dbId,
          marketId: position.marketId,
          matchedCategory: skipResult.matchedCategory,
        });
        return HedgeEvaluationResult.SKIPPED;
      }
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

    const priceData = await this.getValidatedCurrentPrice(position.tokenId, position.entryPrice);
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

    const oppositeOutcome =
      position.oppositeOutcome ??
      (await this.getOppositeOutcomeName(position.marketId, position.oppositeTokenId));
    if (!oppositeOutcome) {
      logger.warn("HedgingChecker: Could not determine opposite outcome name", {
        positionId: position.dbId,
        marketId: position.marketId,
      });
      return HedgeEvaluationResult.SKIPPED;
    }

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

      await this.repository.logEvent({
        eventType: "info",
        eventName: "hedge_skipped_expensive",
        message: `Hedge skipped: opposite @ ${(oppositeAskPrice * 100).toFixed(1)}¢ > 99¢, not worthwhile`,
        metadata: {
          positionId: position.dbId,
          marketId: position.marketId,
          oppositeAskPrice,
        },
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

      await this.repository.logEvent({
        eventType: "info",
        eventName: "hedge_skipped_price",
        message: `Hedge skipped: opposite @ ${(oppositeAskPrice * 100).toFixed(1)}¢ exceeds max ${(maxAcceptablePrice * 100).toFixed(1)}¢`,
        metadata: {
          positionId: position.dbId,
          marketId: position.marketId,
          oppositeAskPrice,
          maxAcceptablePrice,
        },
      });

      return HedgeEvaluationResult.SKIPPED;
    }

    const originalShares = position.cost / position.entryPrice;
    const hedgeShares = originalShares * this.hedgingConfig.multiplier;
    const hedgeAmount = hedgeShares * oppositeAskPrice;

    if (position.isSimulated) {
      const hedgePositionId = await this.createHedgePositionRecord(
        position,
        oppositeAskPrice,
        hedgeAmount,
        oppositeOutcome,
      );

      await this.repository.logEvent({
        eventType: "trade",
        eventName: "hedge_placed",
        message: `[SIM] Hedge: ${hedgeShares.toFixed(2)} ${oppositeOutcome} shares @ ${(oppositeAskPrice * 100).toFixed(1)}¢ for $${hedgeAmount.toFixed(2)}`,
        metadata: {
          originalPositionId: position.dbId,
          hedgePositionId,
          marketId: position.marketId,
          hedgePrice: oppositeAskPrice,
          hedgeCost: hedgeAmount,
          hedgeShares,
          dropPercent,
          oppositeOutcome,
          isSimulated: true,
        },
      });

      return HedgeEvaluationResult.HEDGED;
    }

    if (!this.tradingClient.isInitialized()) {
      logger.warn("HedgingChecker: Trading client not initialized for live hedge");
      return HedgeEvaluationResult.SKIPPED;
    }

    const tradeResult = await this.tradingClient.placeBet(
      position.oppositeTokenId,
      hedgeAmount,
      maxAcceptablePrice,
      this.config.useMarketOrders,
    );

    if (tradeResult.success) {
      const hedgePositionId = await this.createHedgePositionRecord(
        position,
        tradeResult.fillPrice ?? oppositeAskPrice,
        hedgeAmount,
        oppositeOutcome,
      );

      await this.repository.logEvent({
        eventType: "trade",
        eventName: "hedge_placed",
        message: `Hedge: ${hedgeShares.toFixed(2)} ${oppositeOutcome} shares @ ${(oppositeAskPrice * 100).toFixed(1)}¢ for $${hedgeAmount.toFixed(2)}`,
        metadata: {
          originalPositionId: position.dbId,
          hedgePositionId,
          marketId: position.marketId,
          hedgePrice: tradeResult.fillPrice ?? oppositeAskPrice,
          hedgeCost: hedgeAmount,
          hedgeShares,
          dropPercent,
          oppositeOutcome,
          isSimulated: false,
        },
      });

      return HedgeEvaluationResult.HEDGED;
    } else {
      logger.error("HedgingChecker: Hedge trade failed", {
        positionId: position.dbId,
        error: tradeResult.error,
      });

      await this.repository.logEvent({
        eventType: "error",
        eventName: "hedge_failed",
        message: `Hedge failed: ${tradeResult.error}`,
        metadata: {
          positionId: position.dbId,
          marketId: position.marketId,
          error: tradeResult.error,
        },
      });

      return HedgeEvaluationResult.SKIPPED;
    }
  }

  private async getCurrentBidPrice(tokenId: string): Promise<number | null> {
    try {
      const orderBook = await this.tradingClient.getOrderBook(tokenId);
      if (orderBook.bids.length > 0) {
        const bidPrices = orderBook.bids.map((b) => b.price);
        return Math.max(...bidPrices);
      }
      return null;
    } catch {
      return null;
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

  private async createHedgePositionRecord(
    position: PositionToEvaluate,
    hedgePrice: number,
    hedgeCost: number,
    oppositeOutcome: string,
  ): Promise<number> {
    return await this.repository.createHedgePosition(
      {
        id: position.dbId,
        marketId: position.marketId,
        marketQuestion: position.marketQuestion,
        marketSlug: position.marketSlug ?? undefined,
        outcome: position.outcome,
        closesAt: position.closesAt,
        isSimulated: position.isSimulated,
      },
      {
        tokenId: position.oppositeTokenId!,
        entryPrice: hedgePrice,
        cost: hedgeCost,
        outcome: oppositeOutcome,
      },
    );
  }

  /**
   * Get the current BUY price (ask) for a token to determine drop from entry.
   *
   * We use ASK price because:
   * - Entry price = what we PAID to buy (the ask at that time)
   * - Current price for drop calculation = what we'd PAY to buy now (the ask now)
   * - This compares apples to apples: buy price vs buy price
   *
   * Example: Bought YES at 99¢ (ask), now ask is 39¢ → 60% drop → trigger hedge
   */
  private async getValidatedCurrentPrice(
    tokenId: string,
    _entryPrice: number,
  ): Promise<{ currentPrice: number; lastTradePrice: number } | null> {
    try {
      const orderBook = await this.tradingClient.getOrderBook(tokenId);

      const lastTradePrice = orderBook.lastTradePrice ?? null;
      const bestAsk =
        orderBook.asks.length > 0 ? Math.min(...orderBook.asks.map((a) => a.price)) : null;

      if (bestAsk === null && lastTradePrice === null) {
        return null;
      }

      if (bestAsk !== null && bestAsk >= 0.01) {
        return { currentPrice: bestAsk, lastTradePrice: lastTradePrice ?? bestAsk };
      }

      if (bestAsk !== null && bestAsk < 0.01) {
        logger.warn("HedgingChecker: Ask is < 1¢, order book unreliable, skipping", {
          tokenId,
          bestAsk,
          lastTradePrice,
        });
        return null;
      }

      if (lastTradePrice !== null && lastTradePrice > 0) {
        return { currentPrice: lastTradePrice, lastTradePrice };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async getOppositeOutcomeName(
    marketId: string,
    oppositeTokenId: string,
  ): Promise<string | null> {
    try {
      const polyClient = getSharedPolymarketClient();
      const marketData = await polyClient.getMarketOutcomes(marketId);

      if (!marketData) {
        return null;
      }

      const matchingOutcome = marketData.outcomes.find((o) => o.tokenId === oppositeTokenId);

      if (matchingOutcome) {
        return matchingOutcome.name;
      }

      logger.warn("HedgingChecker: Could not find opposite token in market outcomes", {
        marketId,
        oppositeTokenId,
        availableTokens: marketData.outcomes.map((o) => o.tokenId),
      });
      return null;
    } catch (error) {
      logger.error("HedgingChecker: Failed to get opposite outcome name", {
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
