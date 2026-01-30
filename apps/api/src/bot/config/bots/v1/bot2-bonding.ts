/**
 * Bot 2: Bonding
 *
 * Bonds to long-term markets.
 * Targets 99.5¢ markets resolving within 10 minutes.
 *
 * Skips crypto up/down markets (too volatile).
 */

import { env } from "../../../../env.js";
import type { BotInstanceConfig, BotMode } from "../../types.js";

const config: BotInstanceConfig = {
  // Identity
  id: 2,
  name: "bonding",
  enabled: false,

  // Wallet (separate from bot1)
  walletPrivateKeyEnv: "WALLET_2_PRIVATE_KEY",
  walletFunderAddressEnv: "WALLET_2_FUNDER_ADDRESS",

  // Betting
  betSize: 5.0,
  dailyBudget: Infinity,

  // Market selection: Lower odds, fast resolution
  minOdds: 0.991,
  maxOdds: 0.998,
  maxHoursGeneral: 10 / 60, // 10 minutes
  minLiquidity: 50,

  // Disable high-odds special rule (set threshold above maxOdds)
  highOddsThreshold: 1.0,
  maxHoursForHighOdds: 24,

  // Category-specific time limits
  categoryTimeLimits: {
    // crypto: 1, // Crypto: high volatility, 1 hour max for aggressive
  },

  // Categories to skip entirely
  skipCategories: ["up-or-down"],

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
