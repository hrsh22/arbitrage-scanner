/**
 * Bot 6: HighRisk V2
 *
 * Hedging strategy with minimal bet size for high-risk exploration.
 * Targets 95-99.5¢ markets resolving within 4 hours.
 *
 * Hedging enabled for loss protection.
 */

import { env } from "../../../../env.js";
import type { BotInstanceConfig, BotMode } from "../../types.js";

const config: BotInstanceConfig = {
  // Identity
  id: 6,
  name: "highrisk-v2",
  enabled: true,

  // Wallet
  walletPrivateKeyEnv: "WALLET_6_PRIVATE_KEY",
  walletFunderAddressEnv: "WALLET_6_FUNDER_ADDRESS",

  // Betting - Minimal size for high-risk exploration
  betSize: 2.5,
  dailyBudget: Infinity,

  // Market selection
  minOdds: 0.9,
  maxOdds: 0.995,
  maxHoursGeneral: 24,
  maxHoursForHighOdds: 3,
  highOddsThreshold: 0.99,

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
