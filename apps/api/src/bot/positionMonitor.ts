/**
 * Position Monitor - Monitors open positions for stop-loss and early exit
 *
 * Handles selling positions based on price thresholds:
 * - Stop-loss: Sell when price drops below threshold (e.g., 80¢)
 * - Early exit: Sell when price reaches near-certainty (e.g., 99.95¢)
 */

import { BOT_CONFIG } from "./config.js";
import { getBotRepository, BotRepository } from "./repository.js";
import { getTradingClient, TradingClient } from "./tradingClient.js";
import { logger } from "../logger.js";

interface PositionCheckResult {
  checked: number;
  stopLosses: number;
  earlyExits: number;
  totalPnL: number;
  errors: number;
}

interface ApiPosition {
  tokenId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  outcome: string;
  marketSlug?: string;
  conditionId?: string;
}

export class PositionMonitor {
  private repository: BotRepository;
  private tradingClient: TradingClient;

  constructor() {
    this.repository = getBotRepository();
    this.tradingClient = getTradingClient();
  }

  /**
   * Check all positions for stop-loss and early exit conditions.
   * This is the main method called by the cron job.
   */
  async checkPositions(): Promise<PositionCheckResult> {
    const result: PositionCheckResult = {
      checked: 0,
      stopLosses: 0,
      earlyExits: 0,
      totalPnL: 0,
      errors: 0,
    };

    if (!this.tradingClient.isInitialized()) {
      logger.warn("PositionMonitor: Trading client not initialized");
      return result;
    }

    try {
      // Get all positions from Polymarket API (source of truth)
      const positions = await this.tradingClient.getAllPositions();

      if (positions.length === 0) {
        logger.info("PositionMonitor: No positions found from API");
        return result;
      }

      result.checked = positions.length;
      logger.info("PositionMonitor: Checking positions", { count: positions.length });

      for (const pos of positions) {
        try {
          const action = await this.evaluatePosition(pos);

          if (action.type === "stop_loss") {
            const sellResult = await this.executeStopLoss(
              pos,
              action.reason ?? "Stop-loss triggered",
            );
            if (sellResult.success) {
              result.stopLosses++;
              result.totalPnL += sellResult.profitLoss;
            } else {
              result.errors++;
            }
          } else if (action.type === "early_exit") {
            const sellResult = await this.executeEarlyExit(pos);
            if (sellResult.success) {
              result.earlyExits++;
              result.totalPnL += sellResult.profitLoss;
            } else {
              result.errors++;
            }
          }

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          logger.error("PositionMonitor: Error processing position", {
            tokenId: pos.tokenId.slice(0, 16) + "...",
            error: (error as Error).message,
          });
          result.errors++;
        }
      }

      logger.info("PositionMonitor: Check complete", {
        checked: result.checked,
        stopLosses: result.stopLosses,
        earlyExits: result.earlyExits,
        totalPnL: result.totalPnL.toFixed(4),
        errors: result.errors,
      });

      return result;
    } catch (error) {
      logger.error("PositionMonitor: Check failed", {
        error: (error as Error).message,
      });
      return result;
    }
  }

  /**
   * Evaluate a position and determine what action to take.
   */
  private evaluatePosition(pos: ApiPosition): {
    type: "hold" | "stop_loss" | "early_exit";
    reason?: string;
  } {
    const curPrice = pos.curPrice;

    // Check stop-loss first (higher priority - protect capital)
    if (BOT_CONFIG.ENABLE_STOP_LOSS && curPrice <= BOT_CONFIG.STOP_LOSS_THRESHOLD) {
      return {
        type: "stop_loss",
        reason: `Price ${(curPrice * 100).toFixed(1)}¢ <= stop-loss threshold ${(BOT_CONFIG.STOP_LOSS_THRESHOLD * 100).toFixed(0)}¢`,
      };
    }

    // Check early exit (take profits near certainty)
    if (BOT_CONFIG.ENABLE_EARLY_EXIT && curPrice >= BOT_CONFIG.EARLY_EXIT_MIN_PRICE) {
      return {
        type: "early_exit",
        reason: `Price ${(curPrice * 100).toFixed(2)}¢ >= early exit threshold ${(BOT_CONFIG.EARLY_EXIT_MIN_PRICE * 100).toFixed(2)}¢`,
      };
    }

    return { type: "hold" };
  }

  /**
   * Execute a stop-loss sell.
   */
  private async executeStopLoss(
    pos: ApiPosition,
    reason: string,
  ): Promise<{ success: boolean; profitLoss: number }> {
    const entryPrice = pos.avgPrice;
    const curPrice = pos.curPrice;

    // Calculate P&L
    const proceeds = pos.size * curPrice;
    const cost = pos.size * entryPrice;
    const profitLoss = Math.round((proceeds - cost) * 10000) / 10000;

    logger.warn("PositionMonitor: STOP-LOSS triggered", {
      tokenId: pos.tokenId.slice(0, 16) + "...",
      outcome: pos.outcome,
      entryPrice: (entryPrice * 100).toFixed(1) + "¢",
      curPrice: (curPrice * 100).toFixed(1) + "¢",
      shares: pos.size.toFixed(4),
      profitLoss: profitLoss.toFixed(4),
      reason,
    });

    // Check if this is simulation mode (no private key or simulation positions)
    const dbPosition = await this.repository.findPositionByTokenId(pos.tokenId);
    const isSimulated = dbPosition?.isSimulated ?? false;

    if (isSimulated) {
      // Simulation mode - don't actually sell, just update DB
      logger.info("PositionMonitor: [SIM] Stop-loss simulated", {
        tokenId: pos.tokenId.slice(0, 16) + "...",
        profitLoss: profitLoss.toFixed(4),
      });
    } else {
      // Live mode - execute FOK market sell to exit immediately
      const sellResult = await this.tradingClient.marketSell(pos.tokenId, pos.size);

      if (!sellResult.success) {
        logger.error("PositionMonitor: Stop-loss sell failed", {
          tokenId: pos.tokenId.slice(0, 16) + "...",
          error: sellResult.error,
        });
        return { success: false, profitLoss: 0 };
      }
    }

    // Update DB
    await this.syncStopLossToDb(pos, curPrice, profitLoss, isSimulated);

    return { success: true, profitLoss };
  }

  /**
   * Execute an early exit sell.
   */
  private async executeEarlyExit(
    pos: ApiPosition,
  ): Promise<{ success: boolean; profitLoss: number }> {
    const entryPrice = pos.avgPrice;

    // Get actual sell price
    const sellPrice = await this.tradingClient.getSellPrice(pos.tokenId);

    if (sellPrice < BOT_CONFIG.EARLY_EXIT_MIN_PRICE) {
      logger.debug("PositionMonitor: Early exit price dropped below threshold", {
        tokenId: pos.tokenId.slice(0, 16) + "...",
        sellPrice: (sellPrice * 100).toFixed(2) + "¢",
        threshold: (BOT_CONFIG.EARLY_EXIT_MIN_PRICE * 100).toFixed(2) + "¢",
      });
      return { success: false, profitLoss: 0 };
    }

    // Calculate P&L
    const proceeds = pos.size * sellPrice;
    const cost = pos.size * entryPrice;
    const profitLoss = Math.round((proceeds - cost) * 10000) / 10000;

    logger.info("PositionMonitor: Early exit triggered", {
      tokenId: pos.tokenId.slice(0, 16) + "...",
      outcome: pos.outcome,
      entryPrice: (entryPrice * 100).toFixed(1) + "¢",
      sellPrice: (sellPrice * 100).toFixed(2) + "¢",
      shares: pos.size.toFixed(4),
      profitLoss: profitLoss.toFixed(4),
    });

    // Check if this is simulation mode
    const dbPosition = await this.repository.findPositionByTokenId(pos.tokenId);
    const isSimulated = dbPosition?.isSimulated ?? false;

    if (isSimulated) {
      // Simulation mode - don't actually sell
      logger.info("PositionMonitor: [SIM] Early exit simulated", {
        tokenId: pos.tokenId.slice(0, 16) + "...",
        profitLoss: profitLoss.toFixed(4),
      });
    } else {
      // Live mode - execute actual sell
      const sellResult = await this.tradingClient.sellPosition(
        pos.tokenId,
        pos.size,
        BOT_CONFIG.EARLY_EXIT_MIN_PRICE,
      );

      if (!sellResult.success) {
        logger.error("PositionMonitor: Early exit sell failed", {
          tokenId: pos.tokenId.slice(0, 16) + "...",
          error: sellResult.error,
        });
        return { success: false, profitLoss: 0 };
      }
    }

    // Update DB
    await this.syncEarlyExitToDb(pos, sellPrice, profitLoss, isSimulated);

    return { success: true, profitLoss };
  }

  /**
   * Sync a stop-loss exit to the database.
   */
  private async syncStopLossToDb(
    apiPosition: ApiPosition,
    exitPrice: number,
    profitLoss: number,
    isSimulated: boolean,
  ): Promise<void> {
    try {
      // Try to find existing position
      const existing = await this.repository.findPositionByTokenId(apiPosition.tokenId);

      if (existing) {
        // Update existing position with stop-loss status
        await this.repository.stopPosition(existing.id, {
          exitPrice,
          profitLoss,
        });

        // Record as loss in daily stats
        await this.repository.recordLoss(Math.abs(profitLoss), isSimulated);

        logger.debug("PositionMonitor: Updated DB position (stop-loss)", {
          positionId: existing.id,
          tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        });
      } else {
        // Create new position record (shouldn't happen often, but handle it)
        const cost = apiPosition.size * apiPosition.avgPrice;
        await this.repository.createSoldPosition({
          tokenId: apiPosition.tokenId,
          outcome: apiPosition.outcome,
          entryPrice: apiPosition.avgPrice,
          cost,
          profitLoss,
          marketSlug: apiPosition.marketSlug,
          status: "stopped",
        });
        await this.repository.recordLoss(Math.abs(profitLoss), false);

        logger.debug("PositionMonitor: Created new DB position (stop-loss)", {
          tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        });
      }

      // Log the event
      await this.repository.logEvent({
        eventType: "trade",
        eventName: "stop_loss_triggered",
        message: `${isSimulated ? "[SIM] " : ""}Stop-loss: ${apiPosition.outcome} @ ${(exitPrice * 100).toFixed(1)}¢ → P/L: $${profitLoss.toFixed(4)}`,
        metadata: {
          tokenId: apiPosition.tokenId,
          outcome: apiPosition.outcome,
          entryPrice: apiPosition.avgPrice,
          exitPrice,
          profitLoss,
          shares: apiPosition.size,
          threshold: BOT_CONFIG.STOP_LOSS_THRESHOLD,
          isSimulated,
        },
      });
    } catch (error) {
      logger.error("PositionMonitor: Failed to sync stop-loss to DB", {
        tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        error: (error as Error).message,
      });
    }
  }

  /**
   * Sync an early exit to the database.
   */
  private async syncEarlyExitToDb(
    apiPosition: ApiPosition,
    sellPrice: number,
    profitLoss: number,
    isSimulated: boolean,
  ): Promise<void> {
    try {
      // Try to find existing position
      const existing = await this.repository.findPositionByTokenId(apiPosition.tokenId);

      if (existing) {
        // Update existing position
        await this.repository.resolvePosition(existing.id, {
          status: "won",
          profitLoss,
        });
        await this.repository.recordWin(profitLoss, isSimulated);

        logger.debug("PositionMonitor: Updated DB position (early exit)", {
          positionId: existing.id,
          tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        });
      } else {
        // Create new position record
        const cost = apiPosition.size * apiPosition.avgPrice;
        await this.repository.createSoldPosition({
          tokenId: apiPosition.tokenId,
          outcome: apiPosition.outcome,
          entryPrice: apiPosition.avgPrice,
          cost,
          profitLoss,
          marketSlug: apiPosition.marketSlug,
        });
        await this.repository.recordWin(profitLoss, false);

        logger.debug("PositionMonitor: Created new DB position (early exit)", {
          tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        });
      }

      // Log the event
      await this.repository.logEvent({
        eventType: "trade",
        eventName: "early_exit",
        message: `${isSimulated ? "[SIM] " : ""}Early exit: ${apiPosition.outcome} @ ${(sellPrice * 100).toFixed(2)}¢ → P/L: $${profitLoss.toFixed(4)}`,
        metadata: {
          tokenId: apiPosition.tokenId,
          outcome: apiPosition.outcome,
          entryPrice: apiPosition.avgPrice,
          sellPrice,
          profitLoss,
          shares: apiPosition.size,
          isSimulated,
        },
      });
    } catch (error) {
      logger.error("PositionMonitor: Failed to sync early exit to DB", {
        tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        error: (error as Error).message,
      });
    }
  }
}

// Singleton instance
let monitorInstance: PositionMonitor | null = null;

export function getPositionMonitor(): PositionMonitor {
  if (!monitorInstance) {
    monitorInstance = new PositionMonitor();
  }
  return monitorInstance;
}
