/**
 * Bot Configuration Module
 *
 * Main entry point for bot configurations.
 * Re-exports all types and helper functions.
 *
 * DEFAULT_BOT_CONFIG is derived from bot1-default.ts (the source of truth).
 */

// Re-export types
export type { BotInstanceConfig, BotConfigInput, BotMode } from "./types.js";

// Re-export bot configs
export { BOT_CONFIGS } from "./bots/index.js";

// ============================================
// DEFAULTS (derived from bot1)
// ============================================

import type { BotInstanceConfig, BotConfigInput } from "./types.js";
import { BOT_CONFIGS } from "./bots/index.js";
import bot1Default from "./bots/bot1-default.js";

/**
 * Default configuration values derived from bot1-default.
 * Used by defineBotConfig() to provide defaults for new bots.
 */
const { id: _id, name: _name, ...defaults } = bot1Default;
export const DEFAULT_BOT_CONFIG: Omit<BotInstanceConfig, "id" | "name"> = defaults;

/**
 * Define a bot configuration with defaults.
 *
 * Merges provided config with defaults from bot1-default.
 * Validates required fields at definition time.
 *
 * @example
 * ```ts
 * import { defineBotConfig } from "../index.js";
 *
 * export default defineBotConfig({
 *   id: 2,
 *   name: "aggressive",
 *   walletPrivateKeyEnv: "WALLET_2_PRIVATE_KEY",
 *   walletFunderAddressEnv: "WALLET_2_FUNDER_ADDRESS",
 *   minOdds: 0.90,
 *   betSize: 10.0,
 * });
 * ```
 */
export function defineBotConfig(input: BotConfigInput): BotInstanceConfig {
  // Validate required fields
  if (typeof input.id !== "number" || input.id < 1) {
    throw new Error(`Bot config error: 'id' must be a positive number, got: ${input.id}`);
  }

  if (typeof input.name !== "string" || input.name.trim() === "") {
    throw new Error(`Bot config error: 'name' must be a non-empty string, got: ${input.name}`);
  }

  if (typeof input.walletPrivateKeyEnv !== "string" || input.walletPrivateKeyEnv.trim() === "") {
    throw new Error(
      `Bot config error [${input.name}]: 'walletPrivateKeyEnv' must be a non-empty string`,
    );
  }

  if (
    typeof input.walletFunderAddressEnv !== "string" ||
    input.walletFunderAddressEnv.trim() === ""
  ) {
    throw new Error(
      `Bot config error [${input.name}]: 'walletFunderAddressEnv' must be a non-empty string`,
    );
  }

  // Merge with defaults from bot1
  return {
    ...DEFAULT_BOT_CONFIG,
    ...input,
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a bot configuration by ID.
 */
export function getBotConfig(id: number): BotInstanceConfig | undefined {
  return BOT_CONFIGS.find((c) => c.id === id);
}

/**
 * Get all enabled bot configurations.
 */
export function getEnabledBotConfigs(): BotInstanceConfig[] {
  return BOT_CONFIGS.filter((c) => c.enabled);
}

/**
 * Get a bot configuration by name.
 */
export function getBotConfigByName(name: string): BotInstanceConfig | undefined {
  return BOT_CONFIGS.find((c) => c.name === name);
}

/**
 * Get all bot configurations (including disabled).
 */
export function getAllBotConfigs(): BotInstanceConfig[] {
  return BOT_CONFIGS;
}
