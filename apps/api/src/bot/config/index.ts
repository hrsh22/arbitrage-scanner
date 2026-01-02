/**
 * Bot Configuration Module
 *
 * Main entry point for bot configurations.
 * Re-exports all types and helper functions.
 *
 * Each bot config is fully explicit with no inheritance between bots.
 */

// Re-export types
export type { BotInstanceConfig, BotMode } from "./types.js";

// Re-export bot configs
export { BOT_CONFIGS } from "./bots/index.js";

// ============================================
// DEFAULT_BOT_CONFIG (for backward compatibility)
// ============================================

import type { BotInstanceConfig } from "./types.js";
import { BOT_CONFIGS } from "./bots/index.js";
import bot1Default from "./bots/bot1-default.js";

/**
 * Default configuration values from bot1.
 * Used by legacy code for backward compatibility.
 *
 * @deprecated Access config via getBotConfig(id) instead
 */
const { ...defaults } = bot1Default;
export const DEFAULT_BOT_CONFIG: Omit<BotInstanceConfig, "id" | "name"> = defaults;

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
