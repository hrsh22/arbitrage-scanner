/**
 * Bot Instance Configurations
 *
 * Define multiple trading bot configurations here.
 * Each bot can have different strategy parameters and wallet credentials.
 *
 * To add a new bot:
 * 1. Add a new entry to BOT_CONFIGS array
 * 2. Set unique id (numeric) and name (string)
 * 3. Configure wallet env var names (can share with other bots)
 * 4. Set strategy parameters
 * 5. Add corresponding env vars for wallet credentials
 */

export type BotMode = "simulation" | "live";

/**
 * Configuration for a single bot instance
 */
export interface BotInstanceConfig {
  // Identity
  id: number; // Unique numeric ID (1, 2, 3, etc.)
  name: string; // Human-readable name ("default", "aggressive", etc.)
  enabled: boolean; // Enable/disable without removing

  // Wallet credentials (env var names, not actual values)
  walletPrivateKeyEnv: string; // e.g., "POLYMARKET_PRIVATE_KEY"
  walletFunderAddressEnv?: string; // e.g., "POLYMARKET_FUNDER_ADDRESS"

  // Betting
  betSize: number; // Fixed $ per bet (Polymarket min is $1)
  dailyBudget: number; // Max $ to deploy per day (Infinity for no limit)

  // Market selection
  minOdds: number; // Minimum probability (e.g., 0.95 = 95¢)
  maxOdds: number; // Maximum probability (e.g., 0.995 = 99.5¢)
  maxHoursGeneral: number; // Default max hours until resolution
  maxHoursForHighOdds: number; // Max hours for high-odds bets (>= highOddsThreshold)
  highOddsThreshold: number; // Above this, use maxHoursForHighOdds (e.g., 0.99)
  minLiquidity: number; // Minimum liquidity in $

  // Category-specific time limits (hours)
  // Key = tag slug from Polymarket API, Value = max hours until resolution
  categoryTimeLimits: Record<string, number>;

  // Scanning intervals
  scanIntervalMs: number; // How often to scan for opportunities
  resolutionCheckIntervalMs: number; // How often to check for resolutions

  // Safety limits
  minWalletReserve: number; // Minimum $ to keep in wallet
  maxDailyLoss: number; // Pause if daily loss exceeds this (Infinity for no limit)

  // Early exit (sell at market when price hits threshold)
  enableEarlyExit: boolean; // Enable selling positions at target price
  earlyExitMinPrice: number; // Sell when price >= this (e.g., 0.9995 = 99.95¢)

  // Wallet tracking
  walletSnapshotRetentionDays: number; // Days to keep wallet snapshots

  // Mode
  defaultMode: BotMode; // "simulation" or "live"
}

/**
 * Default bot configuration values.
 * Used as base for all bots unless overridden.
 */
export const DEFAULT_BOT_CONFIG: Omit<BotInstanceConfig, "id" | "name" | "walletPrivateKeyEnv"> = {
  enabled: true,
  walletFunderAddressEnv: undefined,
  betSize: 5.0,
  dailyBudget: Infinity,
  minOdds: 0.95,
  maxOdds: 0.995,
  maxHoursGeneral: 24,
  maxHoursForHighOdds: 2,
  highOddsThreshold: 0.99,
  minLiquidity: 50,
  categoryTimeLimits: {
    crypto: 3, // Crypto markets: high volatility, 3 hours max
  },
  scanIntervalMs: 5 * 60 * 1000, // 5 minutes
  resolutionCheckIntervalMs: 10 * 60 * 1000, // 10 minutes
  minWalletReserve: 10,
  maxDailyLoss: Infinity,
  enableEarlyExit: true,
  earlyExitMinPrice: 0.9995,
  walletSnapshotRetentionDays: 30,
  defaultMode: "simulation",
};

/**
 * All configured bot instances.
 *
 * Add new bots here. Each bot should have:
 * - Unique numeric id
 * - Unique name
 * - Strategy parameters (can use spread ...DEFAULT_BOT_CONFIG for defaults)
 *
 * Example additional bots:
 *
 * {
 *   id: 2,
 *   name: "aggressive",
 *   ...DEFAULT_BOT_CONFIG,
 *   walletPrivateKeyEnv: "WALLET_2_PRIVATE_KEY",
 *   walletFunderAddressEnv: "WALLET_2_FUNDER_ADDRESS",
 *   minOdds: 0.90,
 *   maxOdds: 0.95,
 *   maxHoursGeneral: 3,
 *   betSize: 10.0,
 * },
 *
 * {
 *   id: 3,
 *   name: "conservative",
 *   ...DEFAULT_BOT_CONFIG,
 *   // Shares wallet with bot 1
 *   walletPrivateKeyEnv: "POLYMARKET_PRIVATE_KEY",
 *   walletFunderAddressEnv: "POLYMARKET_FUNDER_ADDRESS",
 *   minOdds: 0.98,
 *   maxOdds: 0.995,
 *   maxHoursGeneral: 6,
 *   betSize: 2.0,
 * },
 */
export const BOT_CONFIGS: BotInstanceConfig[] = [
  {
    id: 1,
    name: "default",
    ...DEFAULT_BOT_CONFIG,
    walletPrivateKeyEnv: "POLYMARKET_PRIVATE_KEY",
    walletFunderAddressEnv: "POLYMARKET_FUNDER_ADDRESS",
  },
];

/**
 * Get a bot configuration by ID.
 */
export function getBotConfig(id: number): BotInstanceConfig | undefined {
  return BOT_CONFIGS.find((c) => c.id === id);
}

/**
 * Get all enabled bot configurations.
 */
export function getEnabledBotConfigs(): BotInstanceConfig[] {
  return BOT_CONFIGS.filter((c) => c.enabled);
}

/**
 * Get a bot configuration by name.
 */
export function getBotConfigByName(name: string): BotInstanceConfig | undefined {
  return BOT_CONFIGS.find((c) => c.name === name);
}

/**
 * Validate that all required env vars are set for a bot config.
 * Returns list of missing env var names.
 */
export function validateBotEnvVars(config: BotInstanceConfig): string[] {
  const missing: string[] = [];

  if (!process.env[config.walletPrivateKeyEnv]) {
    missing.push(config.walletPrivateKeyEnv);
  }

  // Funder address is optional but warn if env var name is set but value is missing
  if (config.walletFunderAddressEnv && !process.env[config.walletFunderAddressEnv]) {
    // This is a warning, not an error - funder address is optional
  }

  return missing;
}
