/**
 * Vault Configuration Module
 *
 * Main entry point for vault configurations.
 * Re-exports all types and helper functions.
 *
 * Each vault config is fully explicit with no inheritance between vaults.
 */

// Re-export types
export type {
  VaultInstanceConfig,
  VaultMode,
  VaultType,
  HedgingConfig,
  VaultProfile,
  VaultFeeConfig,
  VaultRiskLevel,
} from "./types.js";

// Re-export vault configs
export { VAULT_CONFIGS } from "./vaults/index.js";

export type { ResolvedVaultIdentity } from "./identityResolver.js";
export { resolveVaultIdentity } from "./identityResolver.js";
// ============================================
// HELPER FUNCTIONS
// ============================================

import type { VaultInstanceConfig } from "./types.js";
import { VAULT_CONFIGS } from "./vaults/index.js";

export function getVaultConfig(id: number): VaultInstanceConfig | undefined {
  return VAULT_CONFIGS.find((c) => c.id === id);
}

/**
 * Get all enabled vault configurations.
 */
export function getEnabledVaultConfigs(): VaultInstanceConfig[] {
  return VAULT_CONFIGS.filter((c) => c.enabled);
}

/**
 * Get a vault configuration by name.
 */
export function getVaultConfigByName(name: string): VaultInstanceConfig | undefined {
  return VAULT_CONFIGS.find((c) => c.name === name);
}

/**
 * Get all vault configurations (including disabled).
 */
export function getAllVaultConfigs(): VaultInstanceConfig[] {
  return VAULT_CONFIGS;
}
