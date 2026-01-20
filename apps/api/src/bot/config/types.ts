/**
 * Bot Configuration Types
 *
 * Type definitions for bot instance configurations.
 * Each bot must specify ALL fields - no inheritance.
 */

export type BotMode = "simulation" | "live";

/**
 * Hedging configuration for loss protection.
 *
 * When enabled, the bot monitors open positions and buys the opposite outcome
 * if a position's value drops significantly. This limits downside risk.
 *
 * Example: You buy YES at 95¢. Price drops to 38¢ (60% loss).
 * Bot buys 2x cost in NO shares as a hedge. If NO wins, hedge covers original loss.
 */
export interface HedgingConfig {
  /** Master switch - set to true to enable hedging checks */
  enabled: boolean;

  /**
   * Trigger threshold: hedge when position has lost this % of value.
   * Example: 60 means hedge when 95¢ position drops to 38¢ (lost 60% of entry value)
   */
  dropThresholdPercent: number;

  /**
   * How much to hedge relative to original cost.
   * Example: 2 means buy $10 of opposite if original bet was $5
   */
  multiplier: number;

  /**
   * Max overpay for opposite shares above theoretical price.
   * Theoretical = 1 - currentPrice. Spread can make actual ask higher.
   * Example: 0.05 allows paying up to 5¢ above theoretical fair value
   */
  spreadTolerance: number;

  /**
   * Minimum position age before hedging is considered (minutes).
   * Prevents knee-jerk hedging on short-term volatility.
   */
  minPositionAgeMinutes: number;

  /**
   * If true, only hedge positions that are close to resolution.
   * Conservative approach: wait and see, only hedge when time is running out.
   */
  onlyNearResolution: boolean;

  /**
   * When onlyNearResolution=true, how close to resolution to start hedging (minutes).
   * Example: 60 means only hedge in the last hour before market closes.
   */
  nearResolutionMinutes: number;

  /**
   * Categories to skip hedging for (tag slugs from Polymarket API).
   * Markets with ANY of these tags will NOT be hedged.
   * Example: ["sports", "nfl"] skips all sports and NFL markets.
   */
  skipCategories: string[];
}

/**
 * Configuration for a single bot instance.
 * All fields are required - each bot config must be fully explicit.
 */
export interface BotInstanceConfig {
  // Identity
  id: number;
  name: string;
  enabled: boolean;

  // Wallet credentials - env var names, not actual values
  walletPrivateKeyEnv: string;
  walletFunderAddressEnv: string;

  // Betting
  betSize: number;
  dailyBudget: number;

  // Market selection
  minOdds: number;
  maxOdds: number;
  maxHoursGeneral: number;
  maxHoursForHighOdds: number;
  highOddsThreshold: number;
  minLiquidity: number;

  // Category-specific time limits (hours)
  // Key = tag slug from Polymarket API, Value = max hours until resolution
  categoryTimeLimits: Record<string, number>;

  // Categories to skip entirely (tag slugs from Polymarket API)
  // Markets with any of these tags will be excluded from trading
  skipCategories: string[];

  // Safety limits
  minWalletReserve: number;
  maxDailyLoss: number;

  // Early exit
  enableEarlyExit: boolean;
  earlyExitMinPrice: number;

  // Order execution
  useMarketOrders: boolean;

  // Wallet tracking
  walletSnapshotRetentionDays: number;

  // Hedging
  hedging: HedgingConfig;

  // Mode
  defaultMode: BotMode;
}
