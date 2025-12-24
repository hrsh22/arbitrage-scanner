/**
 * Trading Bot Configuration
 *
 * Hard-coded safety limits and strategy parameters.
 * These cannot be changed at runtime for safety.
 */

export const BOT_CONFIG = {
  // Betting
  BET_SIZE: 5.0, // Fixed $5 per bet (Polymarket min order is $1)
  DAILY_BUDGET: 200, // $200/day max deployment

  // Market selection
  MIN_ODDS: 0.95, // 95¢ minimum probability
  MAX_ODDS: 0.995, // 99.5¢ maximum (skip above)
  MAX_HOURS_GENERAL: 24, // Default: <24 hours to resolution
  MAX_HOURS_FOR_HIGH_ODDS: 2, // 99-99.5¢ only if resolving within 2 hours
  HIGH_ODDS_THRESHOLD: 0.99, // Above this, use MAX_HOURS_FOR_HIGH_ODDS
  MIN_LIQUIDITY: 50, // $50 minimum liquidity

  // Scanning
  SCAN_INTERVAL_MS: 5 * 60 * 1000, // Every 5 minutes
  RESOLUTION_CHECK_INTERVAL_MS: 10 * 60 * 1000, // Check resolutions every 10 minutes

  // Safety (disabled - no limits)
  MIN_WALLET_RESERVE: 10, // $10 minimum wallet reserve
  MAX_DAILY_LOSS: Infinity, // No daily loss limit

  // Default mode (always simulation until explicitly switched)
  DEFAULT_MODE: "simulation" as const,
} as const;

export type BotMode = "simulation" | "live";

export type BotConfig = typeof BOT_CONFIG;
