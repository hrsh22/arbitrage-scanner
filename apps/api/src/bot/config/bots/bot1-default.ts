/**
 * Bot 1: Default
 *
 * Primary trading bot with standard configuration.
 * All values are explicitly specified - no inheritance.
 */

import { env } from "../../../env.js";
import type { BotInstanceConfig, BotMode } from "../types.js";

const config: BotInstanceConfig = {
  // Identity
  id: 1,
  name: "default",
  enabled: true,

  // Wallet
  walletPrivateKeyEnv: "POLYMARKET_PRIVATE_KEY",
  walletFunderAddressEnv: "POLYMARKET_FUNDER_ADDRESS",

  // Betting
  betSize: 25.0,
  dailyBudget: Infinity,

  // Market selection
  minOdds: 0.95,
  maxOdds: 0.995,
  maxHoursGeneral: 2,
  maxHoursForHighOdds: 2,
  highOddsThreshold: 0.99,
  minLiquidity: 250,

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
    enabled: false,
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
