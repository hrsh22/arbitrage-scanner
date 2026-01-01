/**
 * Trading Bot Configuration
 *
 * This file provides backward compatibility with existing code that imports BOT_CONFIG.
 * For multi-bot support, see botConfigs.ts which defines individual bot configurations.
 *
 * BOT_CONFIG is now derived from the default bot (id: 1) configuration.
 */

// Re-export types and functions from botConfigs
export type { BotInstanceConfig, BotMode } from "./botConfigs.js";
export {
  BOT_CONFIGS,
  DEFAULT_BOT_CONFIG,
  getBotConfig,
  getEnabledBotConfigs,
  getBotConfigByName,
  validateBotEnvVars,
} from "./botConfigs.js";

import { getBotConfig, DEFAULT_BOT_CONFIG } from "./botConfigs.js";

/**
 * Legacy BOT_CONFIG for backward compatibility.
 *
 * This maps to bot ID 1 (default bot) configuration.
 * New code should use getBotConfig(id) or BotInstanceConfig directly.
 *
 * @deprecated Use getBotConfig(id) or access config from TradingBot instance
 */
const defaultConfig = getBotConfig(1);

export const BOT_CONFIG = {
  // Betting
  BET_SIZE: defaultConfig?.betSize ?? DEFAULT_BOT_CONFIG.betSize,
  DAILY_BUDGET: defaultConfig?.dailyBudget ?? DEFAULT_BOT_CONFIG.dailyBudget,

  // Market selection
  MIN_ODDS: defaultConfig?.minOdds ?? DEFAULT_BOT_CONFIG.minOdds,
  MAX_ODDS: defaultConfig?.maxOdds ?? DEFAULT_BOT_CONFIG.maxOdds,
  MAX_HOURS_GENERAL: defaultConfig?.maxHoursGeneral ?? DEFAULT_BOT_CONFIG.maxHoursGeneral,
  MAX_HOURS_FOR_HIGH_ODDS:
    defaultConfig?.maxHoursForHighOdds ?? DEFAULT_BOT_CONFIG.maxHoursForHighOdds,
  HIGH_ODDS_THRESHOLD: defaultConfig?.highOddsThreshold ?? DEFAULT_BOT_CONFIG.highOddsThreshold,
  MIN_LIQUIDITY: defaultConfig?.minLiquidity ?? DEFAULT_BOT_CONFIG.minLiquidity,

  // Category-specific time limits
  CATEGORY_TIME_LIMITS: defaultConfig?.categoryTimeLimits ?? DEFAULT_BOT_CONFIG.categoryTimeLimits,

  // Scanning
  SCAN_INTERVAL_MS: defaultConfig?.scanIntervalMs ?? DEFAULT_BOT_CONFIG.scanIntervalMs,
  RESOLUTION_CHECK_INTERVAL_MS:
    defaultConfig?.resolutionCheckIntervalMs ?? DEFAULT_BOT_CONFIG.resolutionCheckIntervalMs,

  // Safety
  MIN_WALLET_RESERVE: defaultConfig?.minWalletReserve ?? DEFAULT_BOT_CONFIG.minWalletReserve,
  MAX_DAILY_LOSS: defaultConfig?.maxDailyLoss ?? DEFAULT_BOT_CONFIG.maxDailyLoss,

  // Early exit
  ENABLE_EARLY_EXIT: defaultConfig?.enableEarlyExit ?? DEFAULT_BOT_CONFIG.enableEarlyExit,
  EARLY_EXIT_MIN_PRICE: defaultConfig?.earlyExitMinPrice ?? DEFAULT_BOT_CONFIG.earlyExitMinPrice,

  // Wallet tracking
  WALLET_SNAPSHOT_RETENTION_DAYS:
    defaultConfig?.walletSnapshotRetentionDays ?? DEFAULT_BOT_CONFIG.walletSnapshotRetentionDays,

  // Default mode
  DEFAULT_MODE: defaultConfig?.defaultMode ?? DEFAULT_BOT_CONFIG.defaultMode,
} as const;

export type BotConfig = typeof BOT_CONFIG;
