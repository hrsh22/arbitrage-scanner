/**
 * Bot Configurations Registry
 *
 * Import all bot configs here and add to BOT_CONFIGS array.
 * Validation runs at module load time.
 *
 * To add a new bot:
 * 1. Create a new file: bot{N}-{name}.ts
 * 2. Import it below
 * 3. Add to BOT_CONFIGS array
 */

import type { BotInstanceConfig } from "../types.js";
// import bot1Default from "./v1/bot1-default.js";
// import bot2Bonding from "./v1/bot2-bonding.js";
// import bot3Hedging from "./v1/bot3-hedging.js";
import bot4BondingV2 from "./v2/bot4-bonding-v2.js";
import bot5MidriskV2 from "./v2/bot5-midrisk-v2.js";
import bot6HighriskV2 from "./v2/bot6-highrisk-v2.js";

// ============================================
// BOT CONFIGURATIONS
// Add new bots here in order of ID
// ============================================

export const BOT_CONFIGS: BotInstanceConfig[] = [bot4BondingV2, bot5MidriskV2, bot6HighriskV2];

// ============================================
// VALIDATION (runs at startup)
// ============================================

function validateConfigs(configs: BotInstanceConfig[]): void {
  if (configs.length === 0) {
    throw new Error("No bot configurations defined. Add at least one bot to BOT_CONFIGS.");
  }

  // Check for duplicate IDs
  const ids = new Set<number>();
  for (const config of configs) {
    if (ids.has(config.id)) {
      throw new Error(`Duplicate bot ID: ${config.id}. Each bot must have a unique ID.`);
    }
    ids.add(config.id);
  }

  // Check for duplicate names
  const names = new Set<string>();
  for (const config of configs) {
    if (names.has(config.name)) {
      throw new Error(`Duplicate bot name: "${config.name}". Each bot must have a unique name.`);
    }
    names.add(config.name);
  }

  // Validate required environment variables exist
  for (const config of configs) {
    if (!config.enabled) continue;

    const privateKey = process.env[config.walletPrivateKeyEnv];
    if (!privateKey) {
      throw new Error(
        `Bot "${config.name}" (ID: ${config.id}): Missing required env var ${config.walletPrivateKeyEnv}`,
      );
    }

    // Funder address is technically optional for some setups, but warn if missing
    const funderAddress = process.env[config.walletFunderAddressEnv];
    if (!funderAddress) {
      console.warn(
        `[WARN] Bot "${config.name}" (ID: ${config.id}): Missing env var ${config.walletFunderAddressEnv}. Some features may not work.`,
      );
    }
  }
}

// Run validation immediately on import
validateConfigs(BOT_CONFIGS);
