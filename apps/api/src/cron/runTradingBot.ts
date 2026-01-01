/**
 * Cron: Run Trading Bot Scan Cycle
 *
 * Fetches markets ONCE and runs all enabled bot instances in parallel.
 * This optimizes API usage by sharing market data across all bots.
 *
 * Usage:
 *   pnpm cron:run-trading-bot
 *
 * Note: Individual bot scans are no longer supported via cron.
 * Use the API endpoint POST /bot/:botId/scan for single-bot testing.
 */

import "dotenv/config";
import { getBotManager } from "../bot/botManager.js";
import { getEnabledBotConfigs } from "../bot/config/index.js";
import { logger } from "../logger.js";

async function main() {
  const startTime = Date.now();
  const configs = getEnabledBotConfigs();

  logger.info("=== CRON: Trading Bot Scan Started ===", {
    botCount: configs.length,
    bots: configs.map((c) => ({ id: c.id, name: c.name })),
  });

  try {
    const manager = getBotManager();
    await manager.initialize();

    // Fetch markets ONCE and run all bots in parallel
    const results = await manager.runAllScans();

    const totalDuration = Date.now() - startTime;
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info("=== CRON: Trading Bot Scan Completed ===", {
      totalDurationMs: totalDuration,
      botsProcessed: results.length,
      successful,
      failed,
    });

    if (failed > 0) {
      logger.error("Some bots failed", {
        failures: results.filter((r) => !r.success),
      });
    }

    // Output for cron logs
    console.log(
      JSON.stringify({
        success: failed === 0,
        botsProcessed: results.length,
        successful,
        failed,
        durationMs: totalDuration,
      }),
    );

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Cron script failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      durationMs: duration,
    });
    console.error(JSON.stringify({ success: false, error: (error as Error).message }));
    process.exit(1);
  }
}

void main();
