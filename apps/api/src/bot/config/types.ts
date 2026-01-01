/**
 * Bot Configuration Types
 *
 * Type definitions for bot instance configurations.
 */

export type BotMode = "simulation" | "live";

/**
 * Configuration for a single bot instance.
 */
export interface BotInstanceConfig {
  // Identity (required)
  id: number;
  name: string;
  enabled: boolean;

  // Wallet credentials - env var names, not actual values (required)
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

  // Safety limits
  minWalletReserve: number;
  maxDailyLoss: number;

  // Early exit
  enableEarlyExit: boolean;
  earlyExitMinPrice: number;

  // Wallet tracking
  walletSnapshotRetentionDays: number;

  // Mode
  defaultMode: BotMode;
}

/**
 * Partial config for defining a bot.
 * Only id, name, and wallet env vars are required.
 */
export type BotConfigInput = {
  id: number;
  name: string;
  walletPrivateKeyEnv: string;
  walletFunderAddressEnv: string;
} & Partial<
  Omit<BotInstanceConfig, "id" | "name" | "walletPrivateKeyEnv" | "walletFunderAddressEnv">
>;
