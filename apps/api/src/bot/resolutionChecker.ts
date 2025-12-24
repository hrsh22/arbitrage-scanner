/**
 * Resolution Checker - Monitors open positions for market resolution
 *
 * Periodically checks Polymarket API to see if markets have resolved,
 * then updates positions with win/loss status and USD profit/loss.
 *
 * Also handles early exit (selling) when positions reach target price.
 */

import { BOT_CONFIG } from "./config.js";
import { getBotRepository, BotRepository } from "./repository.js";
import { getTradingClient, TradingClient } from "./tradingClient.js";
import { PolymarketClient } from "../clients/polymarketClient.js";
import { logger } from "../logger.js";

export class ResolutionChecker {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private repository: BotRepository;
  private polyClient: PolymarketClient;
  private tradingClient: TradingClient;

  constructor() {
    this.repository = getBotRepository();
    this.polyClient = new PolymarketClient();
    this.tradingClient = getTradingClient();
  }

  /**
   * Start the resolution checker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("ResolutionChecker: Already running");
      return;
    }

    logger.info("ResolutionChecker: Starting");
    this.isRunning = true;

    // Run initial check
    await this.runCheck();

    // Start periodic checking
    this.checkInterval = setInterval(
      () => void this.runCheck(),
      BOT_CONFIG.RESOLUTION_CHECK_INTERVAL_MS,
    );
  }

  /**
   * Stop the resolution checker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info("ResolutionChecker: Stopping");

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
  }

  /**
   * Main check cycle - check all open positions for resolution.
   * Can be called directly for cron-style execution.
   */
  async runCheck(): Promise<{ checked: number; resolved: number; won: number; lost: number }> {
    const startTime = Date.now();

    try {
      // Get all open positions
      const openPositions = await this.repository.getOpenPositions();

      if (openPositions.length === 0) {
        logger.info("ResolutionChecker: No open positions to check");
        return { checked: 0, resolved: 0, won: 0, lost: 0 };
      }

      logger.info("ResolutionChecker: Checking positions", { count: openPositions.length });

      let resolved = 0;
      let won = 0;
      let lost = 0;

      for (const position of openPositions) {
        try {
          const result = await this.checkPosition(position);
          if (result.resolved) {
            resolved++;
            if (result.status === "won") won++;
            else if (result.status === "lost") lost++;
          }
        } catch (error) {
          logger.error("ResolutionChecker: Failed to check position", {
            positionId: position.id,
            marketId: position.marketId,
            error: (error as Error).message,
          });
        }

        // Small delay between API calls to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const duration = Date.now() - startTime;
      logger.info("ResolutionChecker: Check complete", {
        checked: openPositions.length,
        resolved,
        won,
        lost,
        durationMs: duration,
      });

      return { checked: openPositions.length, resolved, won, lost };
    } catch (error) {
      logger.error("ResolutionChecker: Check failed", { error: (error as Error).message });
      return { checked: 0, resolved: 0, won: 0, lost: 0 };
    }
  }

  /**
   * Check a single position for resolution or early exit opportunity
   */
  private async checkPosition(position: {
    id: number;
    marketId: string;
    tokenId: string;
    outcome: string;
    entryPrice: number;
    cost: number;
    isSimulated: boolean;
    status: string;
  }): Promise<{ resolved: boolean; status?: "won" | "lost" | "expired"; statusChanged?: boolean }> {
    // First, check if we can exit early (sell at >= 99.95¢)
    if (BOT_CONFIG.ENABLE_EARLY_EXIT && position.tokenId) {
      const earlyExitResult = await this.tryEarlyExit(position);
      if (earlyExitResult.sold) {
        return { resolved: true, status: "won" };
      }
    }

    const marketStatus = await this.polyClient.getMarketById(position.marketId);

    if (!marketStatus) {
      // Market not found - might be deleted/invalid
      logger.warn("ResolutionChecker: Market not found", {
        marketId: position.marketId,
        positionId: position.id,
      });
      return { resolved: false };
    }

    logger.debug("ResolutionChecker: Market status from API", {
      positionId: position.id,
      marketId: position.marketId,
      currentPositionStatus: position.status,
      apiStatus: {
        closed: marketStatus.closed,
        active: marketStatus.active,
        acceptingOrders: marketStatus.acceptingOrders,
        resolved: marketStatus.resolved,
        winningOutcome: marketStatus.winningOutcome,
        outcomePrices: marketStatus.outcomePrices,
      },
    });

    // If market is closed but not resolved yet, it's in review
    if (marketStatus.closed && !marketStatus.resolved) {
      // Update position to "in_review" if it's currently "open"
      if (position.status === "open") {
        await this.repository.updatePositionStatus(position.id, "in_review");

        logger.info("ResolutionChecker: Position moved to in_review", {
          positionId: position.id,
          marketId: position.marketId,
        });

        await this.repository.logEvent({
          eventType: "info",
          eventName: "position_in_review",
          message: `${position.isSimulated ? "[SIM] " : ""}Position moved to in_review: ${position.outcome}`,
          metadata: {
            positionId: position.id,
            marketId: position.marketId,
            outcome: position.outcome,
            outcomePrices: marketStatus.outcomePrices,
          },
        });

        return { resolved: false, statusChanged: true };
      }
      return { resolved: false };
    }

    // If market is not resolved, nothing to do
    if (!marketStatus.resolved) {
      return { resolved: false };
    }

    // Market resolved - determine if we won or lost
    const winningOutcome = marketStatus.winningOutcome;

    let status: "won" | "lost" | "expired";
    let profitLoss: number;

    if (!winningOutcome) {
      // Market was cancelled/expired - no winner
      status = "expired";
      profitLoss = 0; // Assuming refund
    } else if (position.outcome === winningOutcome) {
      // We won!
      status = "won";
      // Profit = (shares * $1 payout) - cost
      // shares = cost / entryPrice
      const shares = position.cost / position.entryPrice;
      const payout = shares * 1.0;
      profitLoss = payout - position.cost;
    } else {
      // We lost
      status = "lost";
      profitLoss = -position.cost;
    }

    // Round to 4 decimal places
    profitLoss = Math.round(profitLoss * 10000) / 10000;

    // Update position in database
    await this.repository.resolvePosition(position.id, {
      status,
      profitLoss,
    });

    // Update daily stats
    if (status === "won") {
      await this.repository.recordWin(profitLoss, position.isSimulated);
    } else if (status === "lost") {
      await this.repository.recordLoss(Math.abs(profitLoss), position.isSimulated);
    }

    // Log the resolution
    await this.repository.logEvent({
      eventType: "trade",
      eventName: "position_resolved",
      message: `${position.isSimulated ? "[SIM] " : ""}Position ${status}: ${position.outcome} → P/L: $${profitLoss.toFixed(4)}`,
      metadata: {
        positionId: position.id,
        marketId: position.marketId,
        outcome: position.outcome,
        winningOutcome,
        status,
        profitLoss,
        entryPrice: position.entryPrice,
        cost: position.cost,
        isSimulated: position.isSimulated,
        outcomePrices: marketStatus.outcomePrices,
      },
    });

    logger.info("ResolutionChecker: Position resolved", {
      positionId: position.id,
      status,
      profitLoss,
      isSimulated: position.isSimulated,
    });

    return { resolved: true, status };
  }

  /**
   * Try to exit a position early by selling when price hits threshold.
   * Works for both simulated and live positions.
   */
  private async tryEarlyExit(position: {
    id: number;
    tokenId: string;
    outcome: string;
    entryPrice: number;
    cost: number;
    isSimulated: boolean;
  }): Promise<{ sold: boolean; sellPrice?: number; profitLoss?: number }> {
    try {
      // Get current sell price from CLOB API
      const sellPrice = await this.tradingClient.getSellPrice(position.tokenId);

      // Only exit if price meets our threshold (99.95¢)
      if (sellPrice < BOT_CONFIG.EARLY_EXIT_MIN_PRICE) {
        logger.debug("ResolutionChecker: Sell price below threshold", {
          positionId: position.id,
          sellPrice: sellPrice.toFixed(4),
          threshold: BOT_CONFIG.EARLY_EXIT_MIN_PRICE,
        });
        return { sold: false };
      }

      // Get actual share balance from Polymarket (not calculated, to avoid rounding issues)
      // Only query for live positions - simulated positions don't exist on-chain
      let shares: number;
      const rawShares = position.cost / position.entryPrice;

      if (!position.isSimulated && this.tradingClient.isInitialized()) {
        const actualShares = await this.tradingClient.getTokenBalance(position.tokenId);
        // Use actual balance if available, otherwise fall back to calculated (rounded down)
        shares = actualShares > 0 ? actualShares : Math.floor(rawShares * 100) / 100;
      } else {
        // For simulated positions, use calculated shares
        shares = rawShares;
      }

      if (shares <= 0) {
        logger.warn("ResolutionChecker: No shares to sell", {
          positionId: position.id,
          shares,
          calculatedShares: rawShares,
        });
        return { sold: false };
      }

      const proceeds = shares * sellPrice;
      const profitLoss = Math.round((proceeds - position.cost) * 10000) / 10000;

      logger.info("ResolutionChecker: Early exit opportunity found", {
        positionId: position.id,
        outcome: position.outcome,
        entryPrice: position.entryPrice,
        sellPrice,
        shares: shares.toFixed(4),
        proceeds: proceeds.toFixed(4),
        profitLoss: profitLoss.toFixed(4),
        isSimulated: position.isSimulated,
      });

      // For live positions, actually sell
      if (!position.isSimulated) {
        if (!this.tradingClient.isInitialized()) {
          // Trading client not initialized - can't sell live positions
          logger.debug("ResolutionChecker: Skipping early exit - trading client not initialized", {
            positionId: position.id,
          });
          return { sold: false };
        }

        const result = await this.tradingClient.sellPosition(
          position.tokenId,
          shares,
          BOT_CONFIG.EARLY_EXIT_MIN_PRICE,
        );

        if (!result.success) {
          logger.error("ResolutionChecker: Early exit sell failed", {
            positionId: position.id,
            error: result.error,
          });
          return { sold: false };
        }
      }

      // Update position as won/sold
      await this.repository.resolvePosition(position.id, {
        status: "won",
        profitLoss,
      });

      // Update daily stats
      await this.repository.recordWin(profitLoss, position.isSimulated);

      // Log the early exit
      await this.repository.logEvent({
        eventType: "trade",
        eventName: "position_sold_early",
        message: `${position.isSimulated ? "[SIM] " : ""}Position sold early: ${position.outcome} @ ${(sellPrice * 100).toFixed(2)}¢ → P/L: $${profitLoss.toFixed(4)}`,
        metadata: {
          positionId: position.id,
          outcome: position.outcome,
          entryPrice: position.entryPrice,
          sellPrice,
          profitLoss,
          isSimulated: position.isSimulated,
        },
      });

      logger.info("ResolutionChecker: Position sold early", {
        positionId: position.id,
        sellPrice,
        profitLoss,
        isSimulated: position.isSimulated,
      });

      return { sold: true, sellPrice, profitLoss };
    } catch (error) {
      logger.error("ResolutionChecker: Early exit check failed", {
        positionId: position.id,
        error: (error as Error).message,
      });
      return { sold: false };
    }
  }
}

// Singleton instance
let checkerInstance: ResolutionChecker | null = null;

export function getResolutionChecker(): ResolutionChecker {
  if (!checkerInstance) {
    checkerInstance = new ResolutionChecker();
  }
  return checkerInstance;
}
