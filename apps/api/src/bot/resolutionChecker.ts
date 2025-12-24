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
   * Check a single position for resolution (market closed/resolved).
   * Early exit is now handled by sellEligibleFromAPI() instead.
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
   * Sell eligible positions using Polymarket API as source of truth.
   * This is the primary method for early exits - queries actual positions from API.
   */
  async sellEligibleFromAPI(): Promise<{
    checked: number;
    sold: number;
    totalProfit: number;
    errors: number;
  }> {
    if (!BOT_CONFIG.ENABLE_EARLY_EXIT) {
      logger.info("ResolutionChecker: Early exit disabled");
      return { checked: 0, sold: 0, totalProfit: 0, errors: 0 };
    }

    if (!this.tradingClient.isInitialized()) {
      logger.warn("ResolutionChecker: Trading client not initialized, skipping API-based sells");
      return { checked: 0, sold: 0, totalProfit: 0, errors: 0 };
    }

    try {
      // Get all positions from Polymarket API (source of truth)
      const positions = await this.tradingClient.getAllPositions();

      if (positions.length === 0) {
        logger.info("ResolutionChecker: No positions found from API");
        return { checked: 0, sold: 0, totalProfit: 0, errors: 0 };
      }

      logger.info("ResolutionChecker: Checking positions from API", {
        count: positions.length,
      });

      let sold = 0;
      let totalProfit = 0;
      let errors = 0;

      for (const pos of positions) {
        try {
          // Get current sell price
          const sellPrice = await this.tradingClient.getSellPrice(pos.tokenId);

          // Skip if below threshold
          if (sellPrice < BOT_CONFIG.EARLY_EXIT_MIN_PRICE) {
            logger.debug("ResolutionChecker: Sell price below threshold", {
              tokenId: pos.tokenId.slice(0, 16) + "...",
              outcome: pos.outcome,
              sellPrice: sellPrice.toFixed(4),
              threshold: BOT_CONFIG.EARLY_EXIT_MIN_PRICE,
            });
            continue;
          }

          // Calculate P/L using API's avgPrice as entry price
          const proceeds = pos.size * sellPrice;
          const cost = pos.size * pos.avgPrice;
          const profitLoss = Math.round((proceeds - cost) * 10000) / 10000;

          logger.info("ResolutionChecker: Selling position from API", {
            tokenId: pos.tokenId.slice(0, 16) + "...",
            outcome: pos.outcome,
            shares: pos.size.toFixed(4),
            avgPrice: pos.avgPrice.toFixed(4),
            sellPrice: sellPrice.toFixed(4),
            profitLoss: profitLoss.toFixed(4),
          });

          // Sell it
          const result = await this.tradingClient.sellPosition(
            pos.tokenId,
            pos.size,
            BOT_CONFIG.EARLY_EXIT_MIN_PRICE,
          );

          if (!result.success) {
            logger.error("ResolutionChecker: Sell failed", {
              tokenId: pos.tokenId.slice(0, 16) + "...",
              error: result.error,
            });
            errors++;
            continue;
          }

          // Sync to DB
          await this.syncPositionToDb(pos, sellPrice, profitLoss);

          sold++;
          totalProfit += profitLoss;

          logger.info("ResolutionChecker: Position sold via API", {
            tokenId: pos.tokenId.slice(0, 16) + "...",
            outcome: pos.outcome,
            profitLoss: profitLoss.toFixed(4),
          });

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (error) {
          logger.error("ResolutionChecker: Error processing position", {
            tokenId: pos.tokenId.slice(0, 16) + "...",
            error: (error as Error).message,
          });
          errors++;
        }
      }

      logger.info("ResolutionChecker: API-based sell complete", {
        checked: positions.length,
        sold,
        totalProfit: totalProfit.toFixed(4),
        errors,
      });

      return { checked: positions.length, sold, totalProfit, errors };
    } catch (error) {
      logger.error("ResolutionChecker: sellEligibleFromAPI failed", {
        error: (error as Error).message,
      });
      return { checked: 0, sold: 0, totalProfit: 0, errors: 1 };
    }
  }

  /**
   * Sync a sold position to the database.
   * Finds existing record by tokenId or creates a new one.
   */
  private async syncPositionToDb(
    apiPosition: {
      tokenId: string;
      size: number;
      avgPrice: number;
      outcome: string;
      marketSlug?: string;
    },
    sellPrice: number,
    profitLoss: number,
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
        await this.repository.recordWin(profitLoss, existing.isSimulated);

        logger.debug("ResolutionChecker: Updated existing DB position", {
          positionId: existing.id,
          tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        });
      } else {
        // Create new position record
        const cost = apiPosition.size * apiPosition.avgPrice;
        const positionId = await this.repository.createSoldPosition({
          tokenId: apiPosition.tokenId,
          outcome: apiPosition.outcome,
          entryPrice: apiPosition.avgPrice,
          cost,
          profitLoss,
          marketSlug: apiPosition.marketSlug,
        });
        await this.repository.recordWin(profitLoss, false);

        logger.debug("ResolutionChecker: Created new DB position", {
          positionId,
          tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        });
      }

      // Log the event
      await this.repository.logEvent({
        eventType: "trade",
        eventName: "position_sold_early",
        message: `Position sold via API: ${apiPosition.outcome} @ ${(sellPrice * 100).toFixed(2)}¢ → P/L: $${profitLoss.toFixed(4)}`,
        metadata: {
          tokenId: apiPosition.tokenId,
          outcome: apiPosition.outcome,
          entryPrice: apiPosition.avgPrice,
          sellPrice,
          profitLoss,
          shares: apiPosition.size,
        },
      });
    } catch (error) {
      logger.error("ResolutionChecker: Failed to sync position to DB", {
        tokenId: apiPosition.tokenId.slice(0, 16) + "...",
        error: (error as Error).message,
      });
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
