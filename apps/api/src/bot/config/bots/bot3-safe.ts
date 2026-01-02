/**
 * Bot 3: Safe
 *
 * High odds, very fast resolution strategy.
 * Targets 98-99.5¢ markets resolving within 1 hour.
 *
 * Lower risk, lower reward per bet, but high confidence.
 */

import { env } from "../../../env.js";
import type { BotInstanceConfig, BotMode } from "../types.js";

const config: BotInstanceConfig = {
  // Identity
  id: 3,
  name: "safe",
  enabled: false,

  // Wallet (separate from bot1 and bot2)
  walletPrivateKeyEnv: "WALLET_3_PRIVATE_KEY",
  walletFunderAddressEnv: "WALLET_3_FUNDER_ADDRESS",

  // Betting
  betSize: 5.0,
  dailyBudget: Infinity,

  // Market selection: High odds, very fast resolution
  minOdds: 0.98,
  maxOdds: 0.995,
  maxHoursGeneral: 1,
  minLiquidity: 50,

  // Disable high-odds special rule (set threshold above maxOdds)
  highOddsThreshold: 1.0,
  maxHoursForHighOdds: 1,

  // Category-specific time limits
  categoryTimeLimits: {
    crypto: 0.5, // Crypto: high volatility, 30 min max for safe
  },

  // Safety limits
  minWalletReserve: 0,
  maxDailyLoss: Infinity,

  // Early exit
  enableEarlyExit: true,
  earlyExitMinPrice: 0.9995,

  // Wallet tracking
  walletSnapshotRetentionDays: 30,

  // Mode - reads from environment
  defaultMode: (env.BOT_MODE || "simulation") as BotMode,
};

export default config;
