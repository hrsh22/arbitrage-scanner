/**
 * Cron: Check Positions for Stop-Loss and Early Exit
 *
 * Standalone script that monitors positions and sells when:
 * - Stop-loss: Price drops below threshold (e.g., 80¢)
 * - Early exit: Price reaches near-certainty (e.g., 99.95¢)
 *
 * Should run frequently (every 2 minutes) for responsive stop-loss protection.
 * Usage: npm run cron:check-positions
 */

import "dotenv/config";
import { getPositionMonitor } from "../bot/positionMonitor.js";
import { getTradingClient } from "../bot/tradingClient.js";
import { BOT_CONFIG } from "../bot/config.js";
import { logger } from "../logger.js";
import { env } from "../env.js";

async function main() {
  const startTime = Date.now();

  logger.info("=== CRON: Position Check Started ===");

  try {
    // Initialize trading client (required for checking positions)
    const privateKey = env.POLYMARKET_PRIVATE_KEY;

    if (!privateKey) {
      logger.warn("No private key configured, position monitoring disabled");
      console.log(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: "No private key configured",
          durationMs: Date.now() - startTime,
        }),
      );
      process.exit(0);
    }

    const tradingClient = getTradingClient();
    await tradingClient.initialize(privateKey);
    logger.info("Trading client initialized");

    // Log current config
    logger.info("Position monitor config", {
      stopLossEnabled: BOT_CONFIG.ENABLE_STOP_LOSS,
      stopLossThreshold: BOT_CONFIG.STOP_LOSS_THRESHOLD,
      earlyExitEnabled: BOT_CONFIG.ENABLE_EARLY_EXIT,
      earlyExitMinPrice: BOT_CONFIG.EARLY_EXIT_MIN_PRICE,
    });

    // Run position check
    const monitor = getPositionMonitor();
    const result = await monitor.checkPositions();

    const duration = Date.now() - startTime;

    logger.info("=== CRON: Position Check Completed ===", {
      checked: result.checked,
      stopLosses: result.stopLosses,
      earlyExits: result.earlyExits,
      totalPnL: result.totalPnL.toFixed(4),
      errors: result.errors,
      durationMs: duration,
    });

    // Print summary to stdout for cron logs
    console.log(
      JSON.stringify({
        success: true,
        ...result,
        durationMs: duration,
      }),
    );

    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("=== CRON: Position Check FAILED ===", {
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
