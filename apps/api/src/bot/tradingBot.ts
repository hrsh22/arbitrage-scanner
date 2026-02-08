/**
 * Trading Bot - Main autonomous trading loop
 *
 * Scans for opportunities, evaluates them, and places bets
 * based on the PPH (Profit Per Hour) strategy.
 *
 * Supports multiple bot instances with different configurations.
 */

import type { BotInstanceConfig, BotMode } from "./config/index.js";
import { TradingClient, getTradingClient } from "./tradingClient.js";
import { StrategyEngine } from "./strategyEngine.js";
import { BotRepository, getBotRepository } from "./repository.js";
import type { BotStatus, ScoredOpportunity } from "./types.js";
import { PolymarketClient } from "../clients/polymarketClient.js";
import type { NormalizedMarket } from "../types.js";
import { detectNearResolution } from "../services/detectors.js";
import { logger } from "../logger.js";

export class TradingBot {
  private config: BotInstanceConfig;
  private mode: BotMode;
  private lastScanAt: Date | null = null;
  private circuitBreakerTripped = false;

  private tradingClient: TradingClient;
  private strategyEngine: StrategyEngine;
  private repository: BotRepository;
  private polyClient: PolymarketClient;

  constructor(config: BotInstanceConfig) {
    this.config = config;
    this.mode = config.defaultMode;

    // Create trading client for this bot's wallet
    this.tradingClient = getTradingClient(
      config.walletPrivateKeyEnv,
      config.walletFunderAddressEnv,
      config.minWalletReserve,
    );

    this.repository = getBotRepository(String(config.id));

    this.polyClient = new PolymarketClient();
    this.strategyEngine = new StrategyEngine(config, this.polyClient);
  }

  /**
   * Get bot instance ID.
   */
  get id(): number {
    return this.config.id;
  }

  /**
   * Get bot instance name.
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Get the configuration for this bot.
   */
  getConfig(): BotInstanceConfig {
    return this.config;
  }

  /**
   * Initialize the bot (init trading client if in live mode)
   */
  async initialize(): Promise<void> {
    logger.info("TradingBot: Initialized", {
      botId: this.config.id,
      botName: this.config.name,
      mode: this.mode,
    });

    // Initialize trading client with private key if in live mode
    if (this.mode === "live") {
      await this.initializeTradingClient();
    }
  }

  /**
   * Initialize the trading client
   */
  private async initializeTradingClient(): Promise<void> {
    const hasPrivateKey = !!process.env[this.config.walletPrivateKeyEnv];

    if (!hasPrivateKey) {
      logger.warn("TradingBot: No private key configured. Live trading disabled.", {
        botId: this.config.id,
        envVar: this.config.walletPrivateKeyEnv,
      });
      await this.repository.logEvent({
        eventType: "error",
        eventName: "no_private_key",
        message: `${this.config.walletPrivateKeyEnv} not set. Cannot trade in live mode.`,
      });
      return;
    }

    try {
      await this.tradingClient.initialize();
      logger.info("TradingBot: Trading client initialized", {
        botId: this.config.id,
        walletAddress: this.tradingClient.getWalletAddress(),
      });
    } catch (error) {
      logger.error("TradingBot: Failed to initialize trading client", {
        botId: this.config.id,
        error: (error as Error).message,
      });
      await this.repository.logEvent({
        eventType: "error",
        eventName: "trading_client_init_failed",
        message: `Failed to initialize trading client: ${(error as Error).message}`,
      });
    }
  }

  /**
   * Switch between simulation and live mode
   */
  async setMode(newMode: BotMode): Promise<void> {
    if (newMode === this.mode) {
      return;
    }

    const oldMode = this.mode;
    this.mode = newMode;

    // Initialize trading client if switching to live
    if (newMode === "live" && !this.tradingClient.isInitialized()) {
      await this.initializeTradingClient();
    }

    await this.repository.logEvent({
      eventType: "mode_change",
      eventName: "mode_switched",
      message: `Bot "${this.config.name}" mode changed from ${oldMode} to ${newMode}`,
      metadata: { oldMode, newMode },
    });

    logger.info("TradingBot: Mode changed", {
      botId: this.config.id,
      oldMode,
      newMode,
    });
  }

  /**
   * Main scan cycle - find and bet on opportunities.
   * Can be called directly for cron-style execution.
   *
   * @param preloadedMarkets - Optional pre-fetched markets to avoid duplicate API calls
   *                           when running multiple bots together.
   */
  async runScanCycle(preloadedMarkets?: NormalizedMarket[]): Promise<void> {
    const scanStart = Date.now();
    logger.info("TradingBot: Starting scan cycle", {
      botId: this.config.id,
      botName: this.config.name,
      usingPreloadedMarkets: !!preloadedMarkets,
    });

    try {
      // 1. Check safety conditions
      const safetyCheck = await this.checkSafetyConditions();
      if (!safetyCheck.canTrade) {
        logger.info("TradingBot: Cannot trade", {
          botId: this.config.id,
          reason: safetyCheck.reason,
        });

        await this.logMissedOpportunitiesForReason(
          preloadedMarkets,
          safetyCheck.reason || "safety_check_failed",
        );
        return;
      }

      // 2. Get markets - use preloaded or fetch fresh
      const markets = preloadedMarkets ?? (await this.polyClient.getNormalizedMarkets());

      // 3. Detect near-resolution opportunities using this bot's config
      const nearResolutionOpps = detectNearResolution(markets, {
        maxHoursUntilClose: this.config.maxHoursGeneral,
        minOdds: this.config.minOdds * 100, // Convert to cents
      });

      logger.info("TradingBot: Found near-resolution opportunities", {
        botId: this.config.id,
        count: nearResolutionOpps.length,
      });

      if (nearResolutionOpps.length === 0) {
        this.lastScanAt = new Date();
        return;
      }

      // 3. Get existing positions to avoid duplicates (only for this bot instance)
      const isSimulated = this.mode === "simulation";
      const existingMarketIds = await this.repository.getOpenPositionMarketIds(isSimulated);

      // 4. Evaluate opportunities with strategy engine
      const scoredOpps = await this.strategyEngine.evaluateOpportunities(
        nearResolutionOpps,
        existingMarketIds,
      );

      // 5. Determine how many bets we can place
      const remainingBudget = await this.repository.getRemainingBudget(
        this.config.dailyBudget,
        this.mode === "simulation",
      );
      const maxBets = Math.floor(remainingBudget / this.config.betSize);

      logger.info("TradingBot: Budget status", {
        botId: this.config.id,
        remainingBudget,
        maxBets,
        bettableOpportunities: scoredOpps.filter((o) => o.canBet).length,
      });

      if (maxBets === 0) {
        logger.info("TradingBot: Daily budget exhausted", {
          botId: this.config.id,
          bettableOpportunities: scoredOpps.filter((o) => o.canBet).length,
        });
        await this.repository.logEvent({
          eventType: "info",
          eventName: "budget_exhausted",
          message: `Daily budget exhausted.`,
        });

        this.lastScanAt = new Date();
        return;
      }

      // 6. Get top opportunities and place bets
      const topOpps = this.strategyEngine.getTopOpportunities(scoredOpps, maxBets);

      for (let i = 0; i < topOpps.length; i++) {
        const opp = topOpps[i]!;
        const result = await this.placeBet(opp);

        if (result === "insufficient_balance") {
          // Stop trying to place more bets - wallet is empty
          break;
        }
      }

      this.lastScanAt = new Date();
      const scanDuration = Date.now() - scanStart;

      logger.info("TradingBot: Scan cycle complete", {
        botId: this.config.id,
        duration: scanDuration,
        betsPlaced: topOpps.length,
      });
    } catch (error) {
      logger.error("TradingBot: Scan cycle failed", {
        botId: this.config.id,
        error: (error as Error).message,
      });
      await this.repository.logEvent({
        eventType: "error",
        eventName: "scan_cycle_failed",
        message: `Scan cycle failed: ${(error as Error).message}`,
      });
      throw error;
    }
  }

  /**
   * Check safety conditions before trading
   */
  private async checkSafetyConditions(): Promise<{ canTrade: boolean; reason?: string }> {
    if (this.circuitBreakerTripped) {
      return {
        canTrade: false,
        reason: "Circuit breaker tripped - manual restart required",
      };
    }

    // Check daily loss limit
    const todayStats = await this.repository.getTodayStats(this.mode === "simulation");
    if (todayStats.netPnL < -this.config.maxDailyLoss) {
      await this.repository.logEvent({
        eventType: "circuit_breaker",
        eventName: "daily_loss_limit",
        message: `Daily loss limit exceeded: $${Math.abs(todayStats.netPnL).toFixed(2)} lost`,
        metadata: { netPnL: todayStats.netPnL, limit: this.config.maxDailyLoss },
      });
      return { canTrade: false, reason: "Daily loss limit exceeded" };
    }

    // If in live mode, check wallet balance
    if (this.mode === "live" && this.tradingClient.isInitialized()) {
      try {
        const balance = await this.tradingClient.getBalance();
        if (balance < this.config.minWalletReserve) {
          await this.repository.logEvent({
            eventType: "circuit_breaker",
            eventName: "low_balance",
            message: `Wallet balance ($${balance.toFixed(2)}) below reserve ($${this.config.minWalletReserve})`,
            metadata: { balance, reserve: this.config.minWalletReserve },
          });
          return { canTrade: false, reason: "Wallet balance below reserve" };
        }
      } catch (error) {
        await this.repository.logEvent({
          eventType: "error",
          eventName: "balance_check_failed",
          message: `Failed to check wallet balance: ${(error as Error).message}`,
        });
        return { canTrade: false, reason: "Failed to check wallet balance" };
      }
    }

    return { canTrade: true };
  }

  /**
   * Place a bet on an opportunity
   */
  private async placeBet(
    opportunity: ScoredOpportunity,
  ): Promise<"success" | "failed" | "insufficient_balance"> {
    const isSimulation = this.mode === "simulation";

    logger.info("TradingBot: Placing bet", {
      botId: this.config.id,
      mode: this.mode,
      market: opportunity.marketQuestion.substring(0, 50),
      outcome: opportunity.outcome,
      probability: opportunity.probability,
      pphScore: opportunity.pphScore,
    });

    try {
      if (isSimulation) {
        // Simulation mode - just record the position
        await this.recordPosition(opportunity, isSimulation);
        return "success";
      } else {
        // Live mode - actually place the trade
        if (!opportunity.tokenId) {
          logger.warn("TradingBot: No token ID for opportunity, skipping", {
            botId: this.config.id,
            marketId: opportunity.marketId,
          });
          return "failed";
        }

        // Calculate max price with slippage, but cap at maxOdds
        const maxPrice = Math.min(opportunity.buyPrice * 1.02, this.config.maxOdds);

        const result = await this.tradingClient.placeBet(
          opportunity.tokenId,
          this.config.betSize,
          maxPrice,
          this.config.useMarketOrders,
        );

        if (result.success) {
          await this.recordPosition(opportunity, isSimulation);
          return "success";
        } else if (result.insufficientBalance) {
          logger.warn("TradingBot: Insufficient balance from Polymarket API", {
            botId: this.config.id,
            marketId: opportunity.marketId,
            error: result.error,
          });

          await this.repository.logMissedOpportunity(
            {
              marketId: opportunity.marketId,
              marketQuestion: opportunity.marketQuestion,
              outcome: opportunity.outcome,
              buyPrice: opportunity.buyPrice,
              pphScore: opportunity.pphScore,
              expectedProfit: opportunity.expectedProfit,
              hoursUntilClose: opportunity.hoursUntilClose,
            },
            "insufficient_wallet_balance",
          );

          return "insufficient_balance";
        } else {
          logger.error("TradingBot: Trade failed", {
            botId: this.config.id,
            marketId: opportunity.marketId,
            error: result.error,
          });
          await this.repository.logEvent({
            eventType: "error",
            eventName: "trade_failed",
            message: `Trade failed: ${result.error}`,
            metadata: { marketId: opportunity.marketId, outcome: opportunity.outcome },
          });
          return "failed";
        }
      }
    } catch (error) {
      logger.error("TradingBot: Failed to place bet", {
        botId: this.config.id,
        error: (error as Error).message,
      });
      await this.repository.logEvent({
        eventType: "error",
        eventName: "bet_error",
        message: `Failed to place bet: ${(error as Error).message}`,
        metadata: { marketId: opportunity.marketId },
      });
      return "failed";
    }
  }

  /**
   * Record a position in the database
   */
  private async recordPosition(
    opportunity: ScoredOpportunity,
    isSimulated: boolean,
  ): Promise<void> {
    // Create position
    await this.repository.createPosition({
      marketId: opportunity.marketId,
      marketQuestion: opportunity.marketQuestion,
      marketSlug: opportunity.marketSlug,
      tokenId: opportunity.tokenId,
      oppositeTokenId: opportunity.oppositeTokenId,
      oppositeOutcome: opportunity.oppositeOutcome,
      tags: opportunity.tags,
      outcome: opportunity.outcome,
      entryPrice: opportunity.buyPrice,
      cost: this.config.betSize,
      closesAt: opportunity.closesAt,
      hoursUntilCloseAtEntry: opportunity.hoursUntilClose,
      pphScore: opportunity.pphScore,
      expectedProfit: opportunity.expectedProfit,
      isSimulated,
    });

    // Update daily stats
    await this.repository.recordBet(this.config.betSize, isSimulated);

    // Log the trade
    await this.repository.logEvent({
      eventType: "trade",
      eventName: "bet_placed",
      message: `${isSimulated ? "[SIM] " : ""}Bet placed: ${opportunity.outcome} @ ${(opportunity.buyPrice * 100).toFixed(1)}¢ on "${opportunity.marketQuestion.substring(0, 50)}..."`,
      metadata: {
        marketId: opportunity.marketId,
        outcome: opportunity.outcome,
        probability: opportunity.probability,
        buyPrice: opportunity.buyPrice,
        pphScore: opportunity.pphScore,
        hoursUntilClose: opportunity.hoursUntilClose,
        isSimulated,
        betSize: this.config.betSize,
      },
    });
  }

  /**
   * Get current bot status
   */
  async getStatus(): Promise<BotStatus & { botId: number; botName: string }> {
    const isSimulated = this.mode === "simulation";
    const todayStats = await this.repository.getTodayStats(isSimulated);
    const openPositions = await this.repository.getOpenPositions(isSimulated);
    const remainingBudget = await this.repository.getRemainingBudget(
      this.config.dailyBudget,
      isSimulated,
    );

    let walletBalance: number | undefined;
    if (this.mode === "live" && this.tradingClient.isInitialized()) {
      try {
        walletBalance = await this.tradingClient.getBalance();
      } catch {
        // Ignore errors
      }
    }

    return {
      botId: this.config.id,
      botName: this.config.name,
      mode: this.mode,
      lastScanAt: this.lastScanAt ?? undefined,
      todayBets: todayStats.betsPlaced,
      todayDeployed: todayStats.amountDeployed,
      todayPnL: todayStats.netPnL,
      remainingBudget,
      openPositions: openPositions.length,
      walletBalance,
    };
  }

  private async logMissedOpportunitiesForReason(
    preloadedMarkets: NormalizedMarket[] | undefined,
    reason: string,
  ): Promise<void> {
    try {
      const markets = preloadedMarkets ?? (await this.polyClient.getNormalizedMarkets());
      const nearResolutionOpps = detectNearResolution(markets, {
        maxHoursUntilClose: this.config.maxHoursGeneral,
        minOdds: this.config.minOdds * 100,
      });

      if (nearResolutionOpps.length === 0) return;

      const isSimulated = this.mode === "simulation";
      const existingMarketIds = await this.repository.getOpenPositionMarketIds(isSimulated);
      const scoredOpps = await this.strategyEngine.evaluateOpportunities(
        nearResolutionOpps,
        existingMarketIds,
      );

      const bettableOpps = scoredOpps.filter((o) => o.canBet);
      for (const opp of bettableOpps) {
        await this.repository.logMissedOpportunity(
          {
            marketId: opp.marketId,
            marketQuestion: opp.marketQuestion,
            outcome: opp.outcome,
            buyPrice: opp.buyPrice,
            pphScore: opp.pphScore,
            expectedProfit: opp.expectedProfit,
            hoursUntilClose: opp.hoursUntilClose,
          },
          reason,
        );
      }

      if (bettableOpps.length > 0) {
        logger.info("TradingBot: Logged missed opportunities", {
          botId: this.config.id,
          count: bettableOpps.length,
          reason,
        });
      }
    } catch (error) {
      logger.error("TradingBot: Failed to log missed opportunities", {
        botId: this.config.id,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get current opportunities (for dashboard).
   *
   * @param preloadedMarkets - Optional pre-fetched markets to avoid duplicate API calls.
   */
  async getCurrentOpportunities(
    preloadedMarkets?: NormalizedMarket[],
  ): Promise<ScoredOpportunity[]> {
    try {
      const markets = preloadedMarkets ?? (await this.polyClient.getNormalizedMarkets());
      const nearResolutionOpps = detectNearResolution(markets, {
        maxHoursUntilClose: this.config.maxHoursGeneral,
        minOdds: this.config.minOdds * 100,
      });

      const isSimulated = this.mode === "simulation";
      const existingMarketIds = await this.repository.getOpenPositionMarketIds(isSimulated);
      return await this.strategyEngine.evaluateOpportunities(nearResolutionOpps, existingMarketIds);
    } catch (error) {
      logger.error("TradingBot: Failed to get opportunities", {
        botId: this.config.id,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Get the trading client for this bot.
   */
  getTradingClient(): TradingClient {
    return this.tradingClient;
  }

  /**
   * Get the repository for this bot.
   */
  getRepository(): BotRepository {
    return this.repository;
  }
}

// Cache of bot instances by ID
const botInstances: Map<number, TradingBot> = new Map();

/**
 * Get a trading bot instance for a specific configuration.
 * Uses caching to return the same instance for the same config ID.
 */
export function getTradingBot(config: BotInstanceConfig): TradingBot {
  let instance = botInstances.get(config.id);
  if (!instance) {
    instance = new TradingBot(config);
    botInstances.set(config.id, instance);
  }
  return instance;
}

/**
 * Get an existing trading bot instance by ID.
 */
export function getTradingBotById(id: number): TradingBot | undefined {
  return botInstances.get(id);
}

/**
 * Clear all cached bot instances (useful for testing).
 */
export function clearBotInstances(): void {
  botInstances.clear();
}
