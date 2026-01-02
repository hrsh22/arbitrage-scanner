/**
 * Bot Configuration Types
 *
 * Type definitions for bot instance configurations.
 * Each bot must specify ALL fields - no inheritance.
 */

export type BotMode = "simulation" | "live";

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
