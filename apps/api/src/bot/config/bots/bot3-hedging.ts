/**
 * Bot 3: Hedging
 *
 * Hedging strategy.
 * Targets 98-99.5¢ markets resolving within 1 hour.
 *
 * Hedging strategy.
 */

import { env } from "../../../env.js";
import type { BotInstanceConfig, BotMode } from "../types.js";

const config: BotInstanceConfig = {
  // Identity
  id: 3,
  name: "hedging",
  enabled: true,

  // Wallet
  walletPrivateKeyEnv: "WALLET_3_PRIVATE_KEY",
  walletFunderAddressEnv: "WALLET_3_FUNDER_ADDRESS",

  // Betting
  betSize: 5.0,
  dailyBudget: Infinity,

  // Market selection
  minOdds: 0.95,
  maxOdds: 0.995,
  maxHoursGeneral: 4,
  maxHoursForHighOdds: 2,
  highOddsThreshold: 0.99,
  minLiquidity: 50,

  // Category-specific time limits
  categoryTimeLimits: {
    crypto: 1, // Crypto markets: high volatility, 1 hours max,
    sports: 1, // Sports markets: high volatility, 1 hours max,
    esports: 0.5, // Esports markets: high volatility, 0.5 hours max,
  },

  // Categories to skip entirely
  skipCategories: ["weather"],

  // Safety limits
  minWalletReserve: 0,
  maxDailyLoss: Infinity,

  // Early exit
  enableEarlyExit: true,
  earlyExitMinPrice: 0.9995,

  // Order execution
  useMarketOrders: true,

  // Wallet tracking
  walletSnapshotRetentionDays: 30,

  // Hedging
  hedging: {
    enabled: true,
    dropThresholdPercent: 60,
    multiplier: 2,
    spreadTolerance: 0.1,
    minPositionAgeMinutes: 0,
    onlyNearResolution: false,
    nearResolutionMinutes: 60,
    skipCategories: ["sports", "nfl", "nba"],
  },

  // Mode - reads from environment
  defaultMode: (env.BOT_MODE || "simulation") as BotMode,
};

export default config;
