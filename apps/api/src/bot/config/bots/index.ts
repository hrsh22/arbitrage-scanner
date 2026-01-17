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
import bot1Default from "./bot1-default.js";
import bot2Bonding from "./bot2-bonding.js";
import bot3Safe from "./bot3-safe.js";

// ============================================
// BOT CONFIGURATIONS
// Add new bots here in order of ID
// ============================================

export const BOT_CONFIGS: BotInstanceConfig[] = [bot1Default, bot2Bonding, bot3Safe];

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
