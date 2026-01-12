import "dotenv/config";
import { parseArgs } from "node:util";
import { getBotConfig, getEnabledBotConfigs } from "../bot/config/index.js";
import { HedgingChecker, type HedgeCheckResult } from "../bot/hedgingChecker.js";
import { getBotRepository } from "../bot/repository.js";
import { getTradingClient } from "../bot/tradingClient.js";
import { logger } from "../logger.js";

async function checkSingleBot(botId: number, isSimulated: boolean): Promise<HedgeCheckResult> {
  const startTime = Date.now();
  const config = getBotConfig(botId);

  if (!config) {
    logger.error(`Bot ${botId} not found in configuration`);
    throw new Error(`Bot ${botId} not found`);
  }

  if (!config.hedging.enabled) {
    logger.info(`Hedging disabled for Bot ${config.name} (ID: ${botId})`);
    return { checked: 0, hedged: 0, skipped: 0, errors: 0 };
  }

  logger.info(`=== CRON: Hedging Check Started for Bot ${config.name} (ID: ${botId}) ===`, {
    mode: isSimulated ? "simulation" : "live",
  });

  const repository = getBotRepository(String(botId));
  const tradingClient = getTradingClient(
    config.walletPrivateKeyEnv,
    config.walletFunderAddressEnv,
    config.minWalletReserve,
  );

  if (!isSimulated) {
    try {
      await tradingClient.initialize();
      logger.info("Trading client initialized for live hedging", { botId });
    } catch (error) {
      logger.error("Failed to initialize trading client for live hedging", {
        botId,
        error: (error as Error).message,
      });
      return { checked: 0, hedged: 0, skipped: 0, errors: 1 };
    }
  }

  const checker = new HedgingChecker(config, tradingClient, repository);
  const result = await checker.checkAndHedgePositions(isSimulated);

  const totalDuration = Date.now() - startTime;
  logger.info(`=== CRON: Hedging Check Completed for Bot ${config.name} ===`, {
    botId,
    totalDurationMs: totalDuration,
    ...result,
  });

  return result;
}

async function checkAllBots(isSimulated: boolean): Promise<void> {
  const startTime = Date.now();
  const configs = getEnabledBotConfigs();

  logger.info("=== CRON: Hedging Check Started (All Bots) ===", {
    mode: isSimulated ? "simulation" : "live",
    botCount: configs.length,
    bots: configs.map((c) => ({ id: c.id, name: c.name, hedgingEnabled: c.hedging.enabled })),
  });

  const results: {
    botId: number;
    name: string;
    result: HedgeCheckResult;
    success: boolean;
    error?: string;
  }[] = [];

  for (const config of configs) {
    try {
      const result = await checkSingleBot(config.id, isSimulated);
      results.push({ botId: config.id, name: config.name, result, success: true });
    } catch (error) {
      results.push({
        botId: config.id,
        name: config.name,
        result: { checked: 0, hedged: 0, skipped: 0, errors: 1 },
        success: false,
        error: (error as Error).message,
      });
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      checked: acc.checked + r.result.checked,
      hedged: acc.hedged + r.result.hedged,
      skipped: acc.skipped + r.result.skipped,
      errors: acc.errors + r.result.errors,
    }),
    { checked: 0, hedged: 0, skipped: 0, errors: 0 },
  );

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  logger.info("=== CRON: Hedging Check Completed (All Bots) ===", {
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

  console.log(
    JSON.stringify({
      success: failCount === 0,
      mode: isSimulated ? "simulation" : "live",
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
        live: { type: "boolean" },
      },
      strict: false,
    });

    const isSimulated = !values.live;

    if (values.bot) {
      const botId = parseInt(String(values.bot), 10);
      if (isNaN(botId)) {
        logger.error("Invalid bot ID", { provided: values.bot });
        process.exit(1);
      }
      const result = await checkSingleBot(botId, isSimulated);
      console.log(
        JSON.stringify({ success: true, mode: isSimulated ? "simulation" : "live", ...result }),
      );
    } else {
      await checkAllBots(isSimulated);
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
