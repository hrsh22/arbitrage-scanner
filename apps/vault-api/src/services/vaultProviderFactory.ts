/**
 * Vault Provider Factory
 *
 * Factory pattern for creating and routing to vault providers.
 *
 * Responsibilities:
 * - Maintains registry of provider configurations by vault ID
 * - Lazily instantiates providers on first access
 * - Routes requests to appropriate provider based on vault config
 * - Supports custom (ERC7540) vaults
 *
 * Usage:
 * ```typescript
 * const factory = VaultProviderFactory.getInstance();
 * factory.registerProvider({
 *   vaultId: 1,
 *   vaultAddress: "0x...",
 *   providerType: "custom",
 *   customConfig: { ... }
 * });
 *
 * const provider = factory.getProvider(1);
 * const info = await provider.getVaultInfo();
 * ```
 */

import type { Address } from "viem";
import { logger } from "../logger.js";
import { env } from "../env.js";
import type {
  IVaultProvider,
  VaultMetadata,
  VaultProviderConfig,
  VaultProviderType,
} from "./vaultProvider.js";
import { CustomVaultProvider } from "./customVaultProvider.js";

// Import vault configs for auto-registration
import { getVaultConfig, getAllVaultConfigs } from "../config/index.js";
import type { VaultInstanceConfig } from "../config/types.js";

/**
 * Provider entry with lazy initialization
 */
interface ProviderEntry {
  config: VaultProviderConfig;
  provider?: IVaultProvider;
}

/**
 * Vault Provider Factory
 *
 * Singleton factory for managing vault provider instances.
 * Supports custom vault provider architecture.
 */
export class VaultProviderFactory implements IVaultProviderFactory {
  private static instance: VaultProviderFactory | null = null;
  private providers: Map<number, ProviderEntry> = new Map();
  private rpcUrl: string;

  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl ?? env.POLYGON_RPC_URL;
    logger.info("VaultProviderFactory: Initialized");
  }

  /**
   * Get singleton instance
   */
  static getInstance(rpcUrl?: string): VaultProviderFactory {
    if (!VaultProviderFactory.instance) {
      VaultProviderFactory.instance = new VaultProviderFactory(rpcUrl);
    }
    return VaultProviderFactory.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  static resetInstance(): void {
    VaultProviderFactory.instance = null;
  }

  // ============================================================================
  // Provider Registration
  // ============================================================================

  /**
   * Register a provider configuration
   */
  registerProvider(config: VaultProviderConfig): void {
    if (this.providers.has(config.vaultId)) {
      logger.warn("VaultProviderFactory: Overwriting existing provider config", {
        vaultId: config.vaultId,
        existingType: this.providers.get(config.vaultId)!.config.providerType,
        newType: config.providerType,
      });
    }

    this.providers.set(config.vaultId, { config });

    logger.info("VaultProviderFactory: Provider registered", {
      vaultId: config.vaultId,
      providerType: config.providerType,
      vaultAddress: config.vaultAddress,
    });
  }

  /**
   * Auto-register providers from vault instance configs
   *
   * This is the primary registration method that creates appropriate
   * provider configs from existing VaultInstanceConfig objects.
   */
  registerFromVaultConfigs(): void {
    const configs = getAllVaultConfigs();

    for (const vaultConfig of configs) {
      const providerConfig = this.createProviderConfigFromVault(vaultConfig);
      this.registerProvider(providerConfig);
    }

    logger.info("VaultProviderFactory: Auto-registered providers from vault configs", {
      count: configs.length,
    });
  }

  /**
   * Create provider config from vault instance config
   *
   * Derives custom provider config from vault instance settings.
   */
  private createProviderConfigFromVault(vaultConfig: VaultInstanceConfig): VaultProviderConfig {
    // Fresh rollout: always use custom provider, legacy removed from runtime
    const providerType: VaultProviderType = "custom";
    const customConfig = vaultConfig.customVaultConfig;

    const baseConfig: VaultProviderConfig = {
      vaultId: vaultConfig.id,
      vaultAddress: vaultConfig.vaultAddress as Address,
      providerType,
    };

    return {
      ...baseConfig,
      customConfig: {
        epochDurationSeconds: customConfig?.epochDurationSeconds ?? 604800,
        navStalenessThresholdSeconds: customConfig?.navStalenessThresholdSeconds ?? 21600,
      },
    };
  }

  // ============================================================================
  // Provider Access
  // ============================================================================

  /**
   * Get provider for vault
   * @param vaultId - Vault identifier
   * @returns IVaultProvider instance
   * @throws Error if vault not registered
   */
  getProvider(vaultId: number): IVaultProvider {
    const entry = this.providers.get(vaultId);

    if (!entry) {
      // Try to auto-register from vault config
      const vaultConfig = getVaultConfig(vaultId);
      if (vaultConfig) {
        const providerConfig = this.createProviderConfigFromVault(vaultConfig);
        this.registerProvider(providerConfig);
        return this.getProvider(vaultId); // Retry
      }

      throw new Error(
        `VaultProviderFactory: No provider registered for vault ID ${vaultId}. ` +
          `Call registerProvider() first or ensure vault config exists.`,
      );
    }

    // Lazy initialization
    if (!entry.provider) {
      entry.provider = this.createProvider(entry.config);
      logger.debug("VaultProviderFactory: Provider instantiated", {
        vaultId,
        providerType: entry.config.providerType,
      });
    }

    return entry.provider;
  }

  /**
   * Get provider type for vault without instantiating
   */
  getProviderType(vaultId: number): VaultProviderType | null {
    const entry = this.providers.get(vaultId);
    return entry?.config.providerType ?? null;
  }

  /**
   * Check if provider exists for vault
   */
  hasProvider(vaultId: number): boolean {
    return this.providers.has(vaultId);
  }

  /**
   * Get all registered vault IDs
   */
  getRegisteredVaultIds(): number[] {
    return Array.from(this.providers.keys()).sort((a, b) => a - b);
  }

  /**
   * Clear all providers
   */
  clearProviders(): void {
    this.providers.clear();
    logger.info("VaultProviderFactory: All providers cleared");
  }

  // ============================================================================
  // Provider Creation
  // ============================================================================

  /**
   * Create provider instance from config
   */
  private createProvider(config: VaultProviderConfig): IVaultProvider {
    if (config.providerType === "custom") {
      return new CustomVaultProvider(config);
    }
    throw new Error(`VaultProviderFactory: Unsupported provider type: ${config.providerType}`);
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Get providers for multiple vaults
   */
  getProviders(vaultIds: number[]): Map<number, IVaultProvider> {
    const result = new Map<number, IVaultProvider>();

    for (const vaultId of vaultIds) {
      try {
        result.set(vaultId, this.getProvider(vaultId));
      } catch (error) {
        logger.warn("VaultProviderFactory: Failed to get provider", {
          vaultId,
          error: (error as Error).message,
        });
      }
    }

    return result;
  }

  /**
   * Get all providers
   */
  getAllProviders(): Map<number, IVaultProvider> {
    return this.getProviders(this.getRegisteredVaultIds());
  }

  /**
   * Get vault info for all registered vaults
   */
  async getAllVaultInfo(): Promise<Map<number, VaultMetadata>> {
    const results = new Map<number, VaultMetadata>();
    const providers = this.getAllProviders();

    for (const [vaultId, provider] of providers) {
      try {
        const info = await provider.getVaultInfo();
        results.set(vaultId, info);
      } catch (error) {
        logger.error("VaultProviderFactory: Failed to get vault info", {
          vaultId,
          error: (error as Error).message,
        });
      }
    }

    return results;
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate all registered providers
   */
  async validateAll(): Promise<{
    valid: boolean;
    results: Map<number, { valid: boolean; errors: string[] }>;
  }> {
    const results = new Map<number, { valid: boolean; errors: string[] }>();
    let allValid = true;

    for (const vaultId of this.getRegisteredVaultIds()) {
      try {
        const provider = this.getProvider(vaultId);
        const validation = await provider.validateConfig();
        results.set(vaultId, validation);
        if (!validation.valid) allValid = false;
      } catch (error) {
        results.set(vaultId, {
          valid: false,
          errors: [(error as Error).message],
        });
        allValid = false;
      }
    }

    return { valid: allValid, results };
  }
}

/**
 * Provider Factory Interface
 */
export interface IVaultProviderFactory {
  getProvider(vaultId: number): IVaultProvider;
  registerProvider(config: VaultProviderConfig): void;
  hasProvider(vaultId: number): boolean;
  getRegisteredVaultIds(): number[];
  clearProviders(): void;
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Get singleton factory instance
 */
export function getVaultProviderFactory(): VaultProviderFactory {
  return VaultProviderFactory.getInstance();
}

/**
 * Get provider for vault (convenience function)
 */
export function getVaultProvider(vaultId: number): IVaultProvider {
  return getVaultProviderFactory().getProvider(vaultId);
}

/**
 * Initialize factory with all vault configs
 */
export function initializeVaultProviders(): VaultProviderFactory {
  const factory = VaultProviderFactory.getInstance();
  factory.registerFromVaultConfigs();
  return factory;
}
