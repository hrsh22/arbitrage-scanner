import type { BotInstanceConfig, HedgingConfig } from "./config/index.js";
import { TradingClient } from "./tradingClient.js";
import { BotRepository } from "./repository.js";
import { HedgeEvaluationResult, type HedgeEvaluationResultType } from "./hedgingConstants.js";
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
        logger.error("HedgingChecker: Error processing position", {
          botId: this.config.id,
          positionId: position.dbId,
          error: (error as Error).message,
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

    const currentPrice = await this.getCurrentBidPrice(position.tokenId);
    if (currentPrice === null) {
      logger.warn("HedgingChecker: Could not get current price", {
        positionId: position.dbId,
        tokenId: position.tokenId,
      });
      return HedgeEvaluationResult.SKIPPED;
    }

    const entryPrice = position.entryPrice;
    const dropPercent = ((entryPrice - currentPrice) / entryPrice) * 100;

    if (dropPercent < this.hedgingConfig.dropThresholdPercent) {
      return HedgeEvaluationResult.NOT_NEEDED;
    }

    logger.info("HedgingChecker: Position triggered hedge threshold", {
      positionId: position.dbId,
      entryPrice,
      currentPrice,
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

    const hedgeAmount = position.cost * this.hedgingConfig.multiplier;
    const hedgeShares = hedgeAmount / oppositeAskPrice;

    if (position.isSimulated) {
      const hedgePositionId = await this.createHedgePositionRecord(
        position,
        oppositeAskPrice,
        hedgeAmount,
      );

      await this.repository.logEvent({
        eventType: "trade",
        eventName: "hedge_placed",
        message: `[SIM] Hedge: ${hedgeShares.toFixed(2)} opposite shares @ ${(oppositeAskPrice * 100).toFixed(1)}¢ for $${hedgeAmount.toFixed(2)}`,
        metadata: {
          originalPositionId: position.dbId,
          hedgePositionId,
          marketId: position.marketId,
          hedgePrice: oppositeAskPrice,
          hedgeCost: hedgeAmount,
          hedgeShares,
          dropPercent,
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
      );

      await this.repository.logEvent({
        eventType: "trade",
        eventName: "hedge_placed",
        message: `Hedge: ${hedgeShares.toFixed(2)} opposite shares @ ${(oppositeAskPrice * 100).toFixed(1)}¢ for $${hedgeAmount.toFixed(2)}`,
        metadata: {
          originalPositionId: position.dbId,
          hedgePositionId,
          marketId: position.marketId,
          hedgePrice: tradeResult.fillPrice ?? oppositeAskPrice,
          hedgeCost: hedgeAmount,
          hedgeShares,
          dropPercent,
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
        return orderBook.bids[0]!.price;
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
        return orderBook.asks[0]!.price;
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
      },
    );
  }
}
