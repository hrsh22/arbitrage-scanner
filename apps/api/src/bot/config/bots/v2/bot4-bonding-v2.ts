/**
 * Bot 4: Bonding V2
 *
 * Bonds to long-term markets with high volume.
 * Targets 99.1-99.8¢ markets resolving within 10 minutes.
 * Increased bet size for volume accumulation.
 *
 * Skips crypto up/down markets (too volatile).
 */

import { env } from "../../../../env.js";
import type { BotInstanceConfig, BotMode } from "../../types.js";

const config: BotInstanceConfig = {
  // Identity
  id: 4,
  name: "bonding-v2",
  enabled: true,

  // Wallet (separate from other bots)
  walletPrivateKeyEnv: "WALLET_4_PRIVATE_KEY",
  walletFunderAddressEnv: "WALLET_4_FUNDER_ADDRESS",

  // Betting - High volume for accumulation
  betSize: 275.0,
  dailyBudget: Infinity,

  // Market selection: Lower odds, fast resolution
  minOdds: 0.991,
  maxOdds: 0.998,
  maxHoursGeneral: 10 / 60, // 10 minutes
  minLiquidity: 2750,

  // Disable high-odds special rule (set threshold above maxOdds)
  highOddsThreshold: 1.0,
  maxHoursForHighOdds: 24,

  // Category-specific time limits
  categoryTimeLimits: {
    // crypto: 1, // Crypto: high volatility, 1 hour max for aggressive
  },

  // Categories to skip entirely
  skipCategories: ["crypto", "up-or-down"],

  // Safety limits
  minWalletReserve: 0,
  maxDailyLoss: Infinity,

  // Early exit
  enableEarlyExit: false,
  earlyExitMinPrice: 0.9995,

  // Order execution
  useMarketOrders: true,

  // Wallet tracking
  walletSnapshotRetentionDays: 30,

  // Hedging
  hedging: {
    enabled: false,
    dropThresholdPercent: 60,
    multiplier: 2,
    spreadTolerance: 0.05,
    minPositionAgeMinutes: 30,
    onlyNearResolution: false,
    nearResolutionMinutes: 60,
    skipCategories: ["sports"],
  },

  // Mode - reads from environment
  defaultMode: (env.BOT_MODE || "simulation") as BotMode,
};

export default config;
