/**
 * Cron: Check Bot Resolutions
 *
 * Standalone script to check all open positions for resolution.
 * Usage: npm run cron:check-resolutions
 *
 * Logging levels:
 * - info: Flow information, key events
 * - debug: Detailed data dumps for debugging
 */

import "dotenv/config";
import { getResolutionChecker } from "../bot/resolutionChecker.js";
import { getBotRepository } from "../bot/repository.js";
import { logger } from "../logger.js";

async function main() {
  const startTime = Date.now();

  logger.info("=== CRON: Resolution Check Started ===");

  try {
    const repository = getBotRepository();
    const checker = getResolutionChecker();

    // Step 1: Get open positions
    logger.info("Step 1: Fetching open positions");
    const openPositions = await repository.getOpenPositions();

    logger.info("Open positions found", { count: openPositions.length });

    if (openPositions.length === 0) {
      logger.info("No open positions to check, exiting");
      console.log(
        JSON.stringify({
          success: true,
          checked: 0,
          resolved: 0,
          won: 0,
          lost: 0,
          durationMs: Date.now() - startTime,
        }),
      );
      process.exit(0);
    }

    // Debug: Log all open positions
    logger.debug("Open positions details", {
      positions: openPositions.map((p) => ({
        id: p.id,
        market: p.marketQuestion?.substring(0, 50),
        outcome: p.outcome,
        entryPrice: p.entryPrice,
        cost: p.cost,
        closesAt: p.closesAt,
        hoursUntilClose: p.closesAt
          ? ((new Date(p.closesAt).getTime() - Date.now()) / (1000 * 60 * 60)).toFixed(2)
          : "unknown",
        isSimulated: p.isSimulated,
      })),
    });

    // Step 2: Check overall stats before
    logger.info("Step 2: Fetching stats before check");
    const statsBefore = await repository.getOverallStats();
    logger.debug("Stats before resolution check", { ...statsBefore });

    // Step 3: Run resolution check
    logger.info("Step 3: Running resolution check");
    const checkStart = Date.now();
    const result = await checker.runCheck();
    const checkDuration = Date.now() - checkStart;

    logger.info("Resolution check result", {
      checked: result.checked,
      resolved: result.resolved,
      won: result.won,
      lost: result.lost,
      checkDurationMs: checkDuration,
    });

    // Step 4: If any resolved, log details
    if (result.resolved > 0) {
      logger.info("Positions resolved!", {
        won: result.won,
        lost: result.lost,
      });

      // Get updated stats
      const statsAfter = await repository.getOverallStats();
      logger.info("Updated P&L stats", {
        totalBets: statsAfter.totalBetsPlaced,
        totalWon: statsAfter.totalBetsWon,
        totalLost: statsAfter.totalBetsLost,
        netPnL: statsAfter.totalNetPnL,
        winRate: statsAfter.winRate?.toFixed(2) + "%",
      });
      logger.debug("Full stats after resolution", { ...statsAfter });
    }

    // Step 5: Get remaining open positions
    const remainingPositions = await repository.getOpenPositions();
    logger.info("Remaining open positions", { count: remainingPositions.length });

    // Summary
    const totalDuration = Date.now() - startTime;
    logger.info("=== CRON: Resolution Check Completed ===", {
      totalDurationMs: totalDuration,
      positionsChecked: result.checked,
      positionsResolved: result.resolved,
      positionsWon: result.won,
      positionsLost: result.lost,
      remainingOpen: remainingPositions.length,
    });

    // Print summary to stdout for cron logs
    console.log(
      JSON.stringify({
        success: true,
        ...result,
        remainingOpen: remainingPositions.length,
        durationMs: totalDuration,
      }),
    );

    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("=== CRON: Resolution Check FAILED ===", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      durationMs: duration,
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
