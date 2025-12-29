/**
 * Cron: Sync Positions with Polymarket
 *
 * Syncs all trading activity from Polymarket to keep our database accurate.
 * - Fetches all historical trades from Activity API
 * - Creates trade records (deduplicated by transactionHash)
 * - Creates/updates positions from trade aggregates
 * - Updates current prices from Data API
 * - Checks for market resolutions
 *
 * Usage: pnpm run cron:sync-positions
 */

import "dotenv/config";
import { getBotRepository } from "../bot/repository.js";
import { getTradingClient } from "../bot/tradingClient.js";
import { PolymarketClient } from "../clients/polymarketClient.js";
import { logger } from "../logger.js";
import { env } from "../env.js";
import type { ActivityRecord } from "../bot/types.js";

interface SyncResult {
  success: boolean;
  activitiesFromAPI: number;
  newTradesSynced: number;
  positionsCreated: number;
  positionsUpdated: number;
  positionsResolved: number;
  errors: number;
  durationMs: number;
}

async function main(): Promise<void> {
  const startTime = Date.now();

  logger.info("=== CRON: Position Sync Started ===");

  const result: SyncResult = {
    success: true,
    activitiesFromAPI: 0,
    newTradesSynced: 0,
    positionsCreated: 0,
    positionsUpdated: 0,
    positionsResolved: 0,
    errors: 0,
    durationMs: 0,
  };

  try {
    const repository = getBotRepository();
    const tradingClient = getTradingClient();
    const polyClient = new PolymarketClient();

    // Initialize trading client to access Polymarket Data API
    const privateKey = env.POLYMARKET_PRIVATE_KEY;
    if (!privateKey) {
      logger.error("POLYMARKET_PRIVATE_KEY not set, cannot sync positions");
      console.log(JSON.stringify({ success: false, error: "No private key configured" }));
      process.exit(1);
    }

    try {
      await tradingClient.initialize(privateKey);
      logger.info("Trading client initialized");
    } catch (error) {
      logger.error("Failed to initialize trading client", {
        error: (error as Error).message,
      });
      console.log(JSON.stringify({ success: false, error: "Trading client init failed" }));
      process.exit(1);
    }

    // ==========================================
    // Step 1: Fetch all activities from Polymarket
    // ==========================================
    logger.info("Step 1: Fetching all activities from Polymarket API");
    const activities = await tradingClient.getAllActivity();
    result.activitiesFromAPI = activities.length;

    if (activities.length === 0) {
      logger.info("No activities found from Polymarket API");
      result.durationMs = Date.now() - startTime;
      console.log(JSON.stringify(result));
      process.exit(0);
    }

    logger.info("Activities fetched from Polymarket", {
      total: activities.length,
      trades: activities.filter((a) => a.type === "TRADE").length,
      redeems: activities.filter((a) => a.type === "REDEEM").length,
    });

    // ==========================================
    // Step 2: Filter out already-synced trades
    // ==========================================
    logger.info("Step 2: Checking for already-synced trades");
    const allHashes = activities.map((a) => a.transactionHash);
    const syncedTrades = await repository.getSyncedTransactionHashes(allHashes);

    // Filter out already-synced activities
    const newActivities = activities.filter((a) => {
      const key = a.conditionId ? `${a.transactionHash}|${a.conditionId}` : a.transactionHash;
      return !syncedTrades.has(key);
    });

    logger.info("Activities to sync", {
      total: activities.length,
      alreadySynced: syncedTrades.size,
      newToSync: newActivities.length,
    });

    // ==========================================
    // Step 3: Process TRADE activities (buys/sells)
    // ==========================================
    const tradeActivities = newActivities.filter((a) => a.type === "TRADE");
    if (tradeActivities.length > 0) {
      logger.info("Step 3: Processing TRADE activities");

      // Group activities by tokenId to process positions efficiently
      const activitiesByToken = new Map<string, ActivityRecord[]>();
      for (const activity of tradeActivities) {
        const existing = activitiesByToken.get(activity.asset) || [];
        existing.push(activity);
        activitiesByToken.set(activity.asset, existing);
      }

      // Track positions we've created/updated
      const processedTokens = new Set<string>();

      for (const [tokenId, tokenActivities] of activitiesByToken) {
        try {
          // Sort by timestamp (oldest first)
          tokenActivities.sort((a, b) => a.timestamp - b.timestamp);

          // Get first activity for position metadata
          const firstActivity = tokenActivities[0]!;

          // Create or get position
          const positionId = await repository.upsertPositionFromTrade({
            tokenId,
            conditionId: firstActivity.conditionId,
            title: firstActivity.title,
            slug: firstActivity.slug,
            outcome: firstActivity.outcome,
            eventSlug: firstActivity.eventSlug,
          });

          if (!processedTokens.has(tokenId)) {
            // Check if this is a new position
            const existingTrades = await repository.getTradesForToken(tokenId);
            if (existingTrades.length === 0) {
              result.positionsCreated++;
            }
            processedTokens.add(tokenId);
          }

          // Create trade records
          for (const activity of tokenActivities) {
            try {
              await repository.createTrade({
                transactionHash: activity.transactionHash,
                positionId,
                tokenId: activity.asset,
                tradeType:
                  activity.side === "BUY" || activity.side === "SELL" ? activity.side : "BUY",
                side:
                  activity.side === "BUY" || activity.side === "SELL" ? activity.side : undefined,
                shares: activity.size,
                price: activity.price,
                usdcSize: activity.usdcSize,
                conditionId: activity.conditionId,
                title: activity.title,
                slug: activity.slug,
                outcome: activity.outcome,
                eventSlug: activity.eventSlug,
                tradeTimestamp: new Date(activity.timestamp * 1000),
              });

              result.newTradesSynced++;

              logger.debug("Trade synced", {
                transactionHash: activity.transactionHash.slice(0, 16) + "...",
                side: activity.side,
                shares: activity.size.toFixed(4),
                price: activity.price.toFixed(4),
              });
            } catch (error) {
              // Likely duplicate key error - skip
              logger.debug("Trade already exists or failed", {
                transactionHash: activity.transactionHash.slice(0, 16) + "...",
                error: (error as Error).message,
              });
            }
          }

          // Link trades to position
          await repository.linkTradesToPosition(tokenId, positionId);
        } catch (error) {
          logger.error("Failed to process token activities", {
            tokenId: tokenId.slice(0, 16) + "...",
            error: (error as Error).message,
          });
          result.errors++;
        }
      }
    }

    // ==========================================
    // Step 3b: Process REDEEM activities (winning redemptions)
    // ==========================================
    const redeemActivities = newActivities.filter((a) => a.type === "REDEEM");
    if (redeemActivities.length > 0) {
      logger.info(`Step 3b: Processing ${redeemActivities.length} REDEEM activities`);

      // Group REDEEM activities by conditionId (since tokenId is empty)
      const activitiesByCondition = new Map<string, ActivityRecord[]>();
      for (const activity of redeemActivities) {
        const existing = activitiesByCondition.get(activity.conditionId) || [];
        existing.push(activity);
        activitiesByCondition.set(activity.conditionId, existing);
      }

      for (const [conditionId, conditionActivities] of activitiesByCondition) {
        try {
          // Find position by conditionId
          const position = await repository.findPositionByConditionId(conditionId);
          if (!position) {
            logger.warn("Position not found for REDEEM, skipping", {
              conditionId: conditionId.slice(0, 16) + "...",
            });
            continue;
          }

          // Create REDEEM trade records (price = $1.00)
          for (const activity of conditionActivities) {
            try {
              await repository.createTrade({
                transactionHash: activity.transactionHash,
                positionId: position.id,
                tokenId: undefined, // REDEEM has no tokenId
                tradeType: "REDEEM",
                side: undefined, // REDEEM has no side
                shares: activity.size,
                price: 1.0, // REDEEM always at $1
                usdcSize: activity.usdcSize,
                conditionId: activity.conditionId,
                title: activity.title,
                slug: activity.slug,
                outcome: position.outcome, // Use position outcome since activity has empty
                eventSlug: activity.eventSlug,
                tradeTimestamp: new Date(activity.timestamp * 1000),
              });

              result.newTradesSynced++;

              logger.debug("REDEEM synced", {
                transactionHash: activity.transactionHash.slice(0, 16) + "...",
                shares: activity.size.toFixed(4),
                usdcSize: activity.usdcSize.toFixed(4),
                tokenId: position.tokenId,
              });
            } catch (error) {
              logger.debug("REDEEM already exists or failed", {
                transactionHash: activity.transactionHash.slice(0, 16) + "...",
                error: (error as Error).message,
              });
            }
          }

          // Link REDEEM trades to position by conditionId
          await repository.linkTradesToPositionByConditionId(conditionId, position.id);
        } catch (error) {
          logger.error("Failed to process REDEEM activities", {
            conditionId: conditionId.slice(0, 16) + "...",
            error: (error as Error).message,
          });
          result.errors++;
        }
      }
    }

    // ==========================================
    // Step 4: Update positions from aggregates
    // ==========================================
    logger.info("Step 4: Updating positions from trade aggregates");

    // Get all unique tokenIds from all TRADE activities (REDEEM has no tokenId)
    const allTokenIds = [
      ...new Set(activities.filter((a) => a.type === "TRADE").map((a) => a.asset)),
    ];

    // Fetch current prices for open positions
    const currentPositions = await tradingClient.getAllPositions();
    const currentPriceMap = new Map(currentPositions.map((p) => [p.tokenId, p.curPrice]));

    for (const tokenId of allTokenIds) {
      try {
        const position = await repository.findPositionByTokenId(tokenId);
        if (!position) continue;

        // Calculate aggregates from all trades
        const currentPrice = currentPriceMap.get(tokenId);
        const aggregates = await repository.calculatePositionAggregates(tokenId, currentPrice);

        // Update position
        await repository.updatePositionFromAggregates(position.id, aggregates, currentPrice);
        result.positionsUpdated++;

        logger.debug("Position updated from aggregates", {
          positionId: position.id,
          tokenId: tokenId.slice(0, 16) + "...",
          netShares: aggregates.netShares.toFixed(4),
          realizedPnL: aggregates.realizedPnL.toFixed(4),
          unrealizedPnL: aggregates.unrealizedPnL.toFixed(4),
        });
      } catch (error) {
        logger.error("Failed to update position from aggregates", {
          tokenId: tokenId.slice(0, 16) + "...",
          error: (error as Error).message,
        });
        result.errors++;
      }
    }

    // ==========================================
    // Step 5: Check for resolved markets
    // ==========================================
    logger.info("Step 5: Checking for resolved markets");

    // Get all positions that are still "open" but have 0 shares (fully sold)
    // and positions that might have resolved
    const openPositions = await repository.getAllOpenPositionsWithTokens();

    for (const position of openPositions) {
      // Skip if position still has shares in Polymarket
      if (currentPriceMap.has(position.tokenId)) {
        continue;
      }

      try {
        // Position not in current holdings - check if market resolved
        // Use slug if available (more reliable), otherwise try marketId
        let marketStatus = null;
        if (position.marketSlug) {
          marketStatus = await polyClient.getMarketBySlug(position.marketSlug);
        }
        if (!marketStatus && position.marketId) {
          marketStatus = await polyClient.getMarketById(position.marketId);
        }

        if (marketStatus?.resolved) {
          const winningOutcome = marketStatus.winningOutcome;
          let status: "won" | "lost" | "expired";
          let profitLoss: number;

          // Get aggregates to calculate final P/L
          const aggregates = await repository.calculatePositionAggregates(position.tokenId);

          if (!winningOutcome) {
            status = "expired";
            profitLoss = 0;
          } else if (position.outcome === winningOutcome) {
            status = "won";
            // If we still had shares when it resolved, they paid out $1 each
            const remainingValue = aggregates.netShares * 1.0;
            const remainingCost = aggregates.netShares * aggregates.avgEntryPrice;
            profitLoss = aggregates.realizedPnL + (remainingValue - remainingCost);
          } else {
            status = "lost";
            // Lost shares are worth $0
            const remainingCost = aggregates.netShares * aggregates.avgEntryPrice;
            profitLoss = aggregates.realizedPnL - remainingCost;
          }

          profitLoss = Math.round(profitLoss * 10000) / 10000;

          await repository.resolvePosition(position.id, { status, profitLoss });

          logger.info("Position resolved", {
            positionId: position.id,
            tokenId: position.tokenId.slice(0, 16) + "...",
            status,
            profitLoss,
          });

          await repository.logEvent({
            eventType: "trade",
            eventName: "position_resolved",
            message: `Position ${status}: ${position.outcome} → P/L: $${profitLoss.toFixed(4)}`,
            metadata: {
              positionId: position.id,
              tokenId: position.tokenId,
              status,
              profitLoss,
              winningOutcome,
            },
          });

          result.positionsResolved++;
        }
      } catch (error) {
        logger.error("Failed to check market resolution", {
          positionId: position.id,
          marketId: position.marketId,
          error: (error as Error).message,
        });
        result.errors++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // ==========================================
    // Summary
    // ==========================================
    result.durationMs = Date.now() - startTime;
    result.success = result.errors === 0;

    logger.info("=== CRON: Position Sync Completed ===", {
      activitiesFromAPI: result.activitiesFromAPI,
      newTradesSynced: result.newTradesSynced,
      positionsCreated: result.positionsCreated,
      positionsUpdated: result.positionsUpdated,
      positionsResolved: result.positionsResolved,
      errors: result.errors,
      durationMs: result.durationMs,
    });

    console.log(JSON.stringify(result));
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (error) {
    result.durationMs = Date.now() - startTime;
    result.success = false;

    logger.error("=== CRON: Position Sync FAILED ===", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      durationMs: result.durationMs,
    });

    console.error(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
    );
    process.exit(1);
  }
}

void main();
