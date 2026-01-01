/**
 * Cron: Check Bot Resolutions
 *
 * Standalone script to check all open positions for resolution.
 *
 * Usage:
 *   pnpm cron:check-resolutions -b 1    # Check specific bot by ID
 *   pnpm cron:check-resolutions --all   # Check all enabled bots
 *   pnpm cron:check-resolutions         # Check all (default)
 *
 * Logging levels:
 * - info: Flow information, key events
 * - debug: Detailed data dumps for debugging
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { getBotConfig, getEnabledBotConfigs } from "../bot/botConfigs.js";
import { getResolutionChecker } from "../bot/resolutionChecker.js";
import { getBotRepository } from "../bot/repository.js";
import { getTradingClient } from "../bot/tradingClient.js";
import { logger } from "../logger.js";

async function checkSingleBot(botId: number): Promise<{
  checked: number;
  resolved: number;
  won: number;
  lost: number;
}> {
  const startTime = Date.now();
  const config = getBotConfig(botId);

  if (!config) {
    logger.error(`Bot ${botId} not found in configuration`);
    throw new Error(`Bot ${botId} not found`);
  }

  logger.info(`=== CRON: Resolution Check Started for Bot ${config.name} (ID: ${botId}) ===`);

  const repository = getBotRepository(String(botId));
  const checker = getResolutionChecker(config);

  // Initialize trading client for early exits (if private key is set)
  const privateKey = process.env[config.walletPrivateKeyEnv];
  let tradingClientReady = false;

  if (privateKey) {
    try {
      const tradingClient = getTradingClient(
        config.walletPrivateKeyEnv,
        config.walletFunderAddressEnv,
        config.minWalletReserve,
      );
      await tradingClient.initialize();
      tradingClientReady = true;
      logger.info("Trading client initialized for early exits", { botId });
    } catch (error) {
      logger.warn("Failed to initialize trading client, early exits disabled", {
        botId,
        error: (error as Error).message,
      });
    }
  } else {
    logger.info("No private key configured, early exits disabled", {
      botId,
      envVar: config.walletPrivateKeyEnv,
    });
  }

  // Step 0: API-first early exit - sell any positions at threshold directly from Polymarket
  if (tradingClientReady && config.enableEarlyExit) {
    logger.info("Step 0: Running API-based early exit scan", { botId });
    try {
      const earlyExitResult = await checker.sellEligibleFromAPI();
      logger.info("API-based early exit complete", {
        botId,
        checked: earlyExitResult.checked,
        sold: earlyExitResult.sold,
        totalProfit: earlyExitResult.totalProfit.toFixed(4),
        errors: earlyExitResult.errors,
      });
    } catch (error) {
      logger.warn("API-based early exit failed", {
        botId,
        error: (error as Error).message,
      });
    }
  }

  // Step 1: Get open positions
  logger.info("Step 1: Fetching open positions", { botId });
  const openPositions = await repository.getOpenPositions();

  logger.info("Open positions found", { botId, count: openPositions.length });

  if (openPositions.length === 0) {
    logger.info("No open positions to check", { botId });
    return { checked: 0, resolved: 0, won: 0, lost: 0 };
  }

  // Debug: Log all open positions
  logger.debug("Open positions details", {
    botId,
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
  logger.info("Step 2: Fetching stats before check", { botId });
  const statsBefore = await repository.getOverallStats();
  logger.debug("Stats before resolution check", { botId, ...statsBefore });

  // Step 3: Run resolution check
  logger.info("Step 3: Running resolution check", { botId });
  const checkStart = Date.now();
  const result = await checker.runCheck();
  const checkDuration = Date.now() - checkStart;

  logger.info("Resolution check result", {
    botId,
    checked: result.checked,
    resolved: result.resolved,
    won: result.won,
    lost: result.lost,
    checkDurationMs: checkDuration,
  });

  // Step 4: If any resolved, log details
  if (result.resolved > 0) {
    logger.info("Positions resolved!", {
      botId,
      won: result.won,
      lost: result.lost,
    });

    // Get updated stats
    const statsAfter = await repository.getOverallStats();
    logger.info("Updated P&L stats", {
      botId,
      totalBets: statsAfter.totalBetsPlaced,
      totalWon: statsAfter.totalBetsWon,
      totalLost: statsAfter.totalBetsLost,
      netPnL: statsAfter.totalNetPnL,
      winRate: statsAfter.winRate?.toFixed(2) + "%",
    });
    logger.debug("Full stats after resolution", { botId, ...statsAfter });
  }

  // Step 5: Get remaining open positions
  const remainingPositions = await repository.getOpenPositions();
  logger.info("Remaining open positions", { botId, count: remainingPositions.length });

  // Summary
  const totalDuration = Date.now() - startTime;
  logger.info(`=== CRON: Resolution Check Completed for Bot ${config.name} ===`, {
    botId,
    totalDurationMs: totalDuration,
    positionsChecked: result.checked,
    positionsResolved: result.resolved,
    positionsWon: result.won,
    positionsLost: result.lost,
    remainingOpen: remainingPositions.length,
  });

  return result;
}

async function checkAllBots(): Promise<void> {
  const startTime = Date.now();
  const configs = getEnabledBotConfigs();

  logger.info("=== CRON: Resolution Check Started (All Bots) ===", {
    botCount: configs.length,
    bots: configs.map((c) => ({ id: c.id, name: c.name })),
  });

  const results: {
    botId: number;
    name: string;
    result: { checked: number; resolved: number; won: number; lost: number };
    success: boolean;
    error?: string;
  }[] = [];

  for (const config of configs) {
    try {
      const result = await checkSingleBot(config.id);
      results.push({ botId: config.id, name: config.name, result, success: true });
    } catch (error) {
      results.push({
        botId: config.id,
        name: config.name,
        result: { checked: 0, resolved: 0, won: 0, lost: 0 },
        success: false,
        error: (error as Error).message,
      });
    }
  }

  // Aggregate totals
  const totals = results.reduce(
    (acc, r) => ({
      checked: acc.checked + r.result.checked,
      resolved: acc.resolved + r.result.resolved,
      won: acc.won + r.result.won,
      lost: acc.lost + r.result.lost,
    }),
    { checked: 0, resolved: 0, won: 0, lost: 0 },
  );

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  logger.info("=== CRON: Resolution Check Completed (All Bots) ===", {
    totalDurationMs: totalDuration,
    botsProcessed: configs.length,
    successful: successCount,
    failed: failCount,
    totals,
  });

  if (failCount > 0) {
    logger.error("Some bots failed", {
      failures: results.filter((r) => !r.success),
    });
  }

  // Print summary to stdout for cron logs
  console.log(
    JSON.stringify({
      success: failCount === 0,
      ...totals,
      botsProcessed: configs.length,
      durationMs: totalDuration,
    }),
  );
}

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        bot: { type: "string", short: "b" },
        all: { type: "boolean" },
      },
      strict: false,
    });

    if (values.bot) {
      const botId = parseInt(String(values.bot), 10);
      if (isNaN(botId)) {
        logger.error("Invalid bot ID", { provided: values.bot });
        process.exit(1);
      }
      const result = await checkSingleBot(botId);
      console.log(JSON.stringify({ success: true, ...result }));
    } else {
      // Default to checking all bots
      await checkAllBots();
    }

    process.exit(0);
  } catch (error) {
    logger.error("Cron script failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    console.error(JSON.stringify({ success: false, error: (error as Error).message }));
    process.exit(1);
  }
}

void main();
