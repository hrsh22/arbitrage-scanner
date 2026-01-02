/**
 * Bot 2: Aggressive
 *
 * Lower odds, fast resolution strategy.
 * Targets 90-99.5¢ markets resolving within 3 hours.
 *
 * Higher risk, higher reward per bet.
 */

import { env } from "../../../env.js";
import type { BotInstanceConfig, BotMode } from "../types.js";

const config: BotInstanceConfig = {
  // Identity
  id: 2,
  name: "aggressive",
  enabled: false,

  // Wallet (separate from bot1)
  walletPrivateKeyEnv: "WALLET_2_PRIVATE_KEY",
  walletFunderAddressEnv: "WALLET_2_FUNDER_ADDRESS",

  // Betting
  betSize: 5.0,
  dailyBudget: Infinity,

  // Market selection: Lower odds, fast resolution
  minOdds: 0.9,
  maxOdds: 0.995,
  maxHoursGeneral: 3,
  minLiquidity: 50,

  // Disable high-odds special rule (set threshold above maxOdds)
  highOddsThreshold: 1.0,
  maxHoursForHighOdds: 3,

  // Category-specific time limits
  categoryTimeLimits: {
    crypto: 1, // Crypto: high volatility, 1 hour max for aggressive
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
