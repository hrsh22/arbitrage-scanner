import { getEnabledBotConfigs, getBotConfig, type BotInstanceConfig } from "./config/index.js";
import { TradingBot, getTradingBot } from "./tradingBot.js";
import { ResolutionChecker, getResolutionChecker } from "./resolutionChecker.js";
import { HedgingChecker, type HedgeCheckResult } from "./hedgingChecker.js";
export type { HedgeCheckResult };
import { getBotRepository } from "./repository.js";
import { getTradingClient } from "./tradingClient.js";
import type { BotStatus, OverallStats } from "./types.js";
import { getSharedPolymarketClient } from "../clients/polymarketClient.js";
import { logger } from "../logger.js";

const hedgingCheckerCache: Map<number, HedgingChecker> = new Map();

function createHedgingChecker(config: BotInstanceConfig): HedgingChecker {
  let checker = hedgingCheckerCache.get(config.id);
  if (!checker) {
    const tradingClient = getTradingClient(
      config.walletPrivateKeyEnv,
      config.walletFunderAddressEnv,
      config.minWalletReserve,
    );
    const repository = getBotRepository(String(config.id));
    checker = new HedgingChecker(config, tradingClient, repository);
    hedgingCheckerCache.set(config.id, checker);
  }
  return checker;
}

export class BotManager {
  private initialized = false;

  /**
   * Initialize all enabled bots.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const configs = getEnabledBotConfigs();
    logger.info("BotManager: Initializing bots", { count: configs.length });

    for (const config of configs) {
      try {
        const bot = getTradingBot(config);
        await bot.initialize();
        logger.info("BotManager: Bot initialized", {
          botId: config.id,
          botName: config.name,
        });
      } catch (error) {
        logger.error("BotManager: Failed to initialize bot", {
          botId: config.id,
          botName: config.name,
          error: (error as Error).message,
        });
      }
    }

    this.initialized = true;
  }

  /**
   * Get a specific bot by ID.
   */
  getBot(id: number): TradingBot | undefined {
    const config = getBotConfig(id);
    if (!config) {
      return undefined;
    }
    return getTradingBot(config);
  }

  /**
   * Get all configured bots.
   */
  getAllBots(): TradingBot[] {
    return getEnabledBotConfigs().map((config) => getTradingBot(config));
  }

  /**
   * Get a resolution checker for a specific bot.
   */
  getResolutionChecker(id: number): ResolutionChecker | undefined {
    const config = getBotConfig(id);
    if (!config) {
      return undefined;
    }
    return getResolutionChecker(config);
  }

  /**
   * Get all resolution checkers.
   */
  getAllResolutionCheckers(): ResolutionChecker[] {
    return getEnabledBotConfigs().map((config) => getResolutionChecker(config));
  }

  /**
   * Run a scan cycle for a specific bot.
   */
  async runScan(botId: number): Promise<void> {
    const config = getBotConfig(botId);
    if (!config) {
      throw new Error(`Bot ${botId} not found`);
    }

    const bot = getTradingBot(config);
    if (!this.initialized) {
      await bot.initialize();
    }
    await bot.runScanCycle();
  }

  /**
   * Run scan cycles for all enabled bots with shared market data.
   * Fetches markets ONCE and passes to all bots, running them in parallel.
   */
  async runAllScans(): Promise<
    { botId: number; botName: string; success: boolean; error?: string }[]
  > {
    const startTime = Date.now();
    const configs = getEnabledBotConfigs();

    // 1. Fetch markets ONCE for all bots
    logger.info("BotManager: Fetching shared market data...", {
      botCount: configs.length,
    });

    const polyClient = getSharedPolymarketClient();
    const markets = await polyClient.getNormalizedMarkets();

    logger.info("BotManager: Fetched markets for all bots", {
      marketCount: markets.length,
      fetchTimeMs: Date.now() - startTime,
    });

    // 2. Run all bots in parallel with shared market data
    const scanStart = Date.now();
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          const bot = getTradingBot(config);
          if (!this.initialized) {
            await bot.initialize();
          }
          await bot.runScanCycle(markets); // Pass pre-fetched markets
          return {
            botId: config.id,
            botName: config.name,
            success: true,
          };
        } catch (error) {
          logger.error("BotManager: Scan failed for bot", {
            botId: config.id,
            error: (error as Error).message,
          });
          return {
            botId: config.id,
            botName: config.name,
            success: false,
            error: (error as Error).message,
          };
        }
      }),
    );

    const totalDuration = Date.now() - startTime;
    const scanDuration = Date.now() - scanStart;
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info("BotManager: All scans complete", {
      totalDurationMs: totalDuration,
      scanDurationMs: scanDuration,
      botsProcessed: configs.length,
      successful,
      failed,
    });

    return results;
  }

  /**
   * Run resolution check for a specific bot.
   */
  async runResolutionCheck(
    botId: number,
  ): Promise<{ checked: number; resolved: number; won: number; lost: number }> {
    const config = getBotConfig(botId);
    if (!config) {
      throw new Error(`Bot ${botId} not found`);
    }

    const checker = getResolutionChecker(config);
    return checker.runCheck();
  }

  /**
   * Run resolution checks for all enabled bots.
   */
  async runAllResolutionChecks(): Promise<
    {
      botId: number;
      botName: string;
      result: { checked: number; resolved: number; won: number; lost: number };
    }[]
  > {
    const results: {
      botId: number;
      botName: string;
      result: { checked: number; resolved: number; won: number; lost: number };
    }[] = [];

    for (const config of getEnabledBotConfigs()) {
      try {
        const checker = getResolutionChecker(config);
        const result = await checker.runCheck();
        results.push({
          botId: config.id,
          botName: config.name,
          result,
        });
      } catch (error) {
        logger.error("BotManager: Resolution check failed for bot", {
          botId: config.id,
          error: (error as Error).message,
        });
        results.push({
          botId: config.id,
          botName: config.name,
          result: { checked: 0, resolved: 0, won: 0, lost: 0 },
        });
      }
    }

    return results;
  }

  /**
   * Get status for all bots.
   */
  async getAllStatuses(): Promise<(BotStatus & { botId: number; botName: string })[]> {
    const statuses: (BotStatus & { botId: number; botName: string })[] = [];

    for (const config of getEnabledBotConfigs()) {
      try {
        const bot = getTradingBot(config);
        const status = await bot.getStatus();
        statuses.push(status);
      } catch (error) {
        logger.error("BotManager: Failed to get status for bot", {
          botId: config.id,
          error: (error as Error).message,
        });
      }
    }

    return statuses;
  }

  /**
   * Get aggregate stats across all bots.
   */
  async getAggregateStats(isSimulated?: boolean): Promise<OverallStats> {
    // Use any repository to get aggregate stats (they all have access to the full table)
    const repository = getBotRepository("1");
    return repository.getAggregateStats(isSimulated);
  }

  /**
   * Get list of all bot configurations.
   */
  getBotConfigs(): BotInstanceConfig[] {
    return getEnabledBotConfigs();
  }

  async runHedgingCheck(botId: number, isSimulated: boolean = true): Promise<HedgeCheckResult> {
    const config = getBotConfig(botId);
    if (!config) {
      throw new Error(`Bot ${botId} not found`);
    }

    const checker = createHedgingChecker(config);
    return checker.checkAndHedgePositions(isSimulated);
  }

  async runAllHedgingChecks(
    isSimulated: boolean = true,
  ): Promise<{ botId: number; botName: string; result: HedgeCheckResult }[]> {
    const results: { botId: number; botName: string; result: HedgeCheckResult }[] = [];

    for (const config of getEnabledBotConfigs()) {
      try {
        const checker = createHedgingChecker(config);
        const result = await checker.checkAndHedgePositions(isSimulated);
        results.push({
          botId: config.id,
          botName: config.name,
          result,
        });
      } catch (error) {
        logger.error("BotManager: Hedging check failed for bot", {
          botId: config.id,
          error: (error as Error).message,
        });
        results.push({
          botId: config.id,
          botName: config.name,
          result: { checked: 0, hedged: 0, skipped: 0, errors: 1 },
        });
      }
    }

    return results;
  }
}

// Singleton manager instance
let managerInstance: BotManager | null = null;

/**
 * Get the bot manager instance.
 */
export function getBotManager(): BotManager {
  if (!managerInstance) {
    managerInstance = new BotManager();
  }
  return managerInstance;
}
