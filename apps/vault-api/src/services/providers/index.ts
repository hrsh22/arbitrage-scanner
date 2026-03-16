/**
 * Vault Provider Exports
 *
 * Centralized exports for vault provider abstraction layer.
 */

// Main interface and types
export type {
  IVaultProvider,
  IVaultProviderFactory,
  VaultProviderConfig,
  VaultProviderType,
  CustomVaultConfig,
  VaultMetadata,
  BatchInfo,
  RedemptionRequest,
  RequestResult,
  ClaimResult,
  RequestStatusResult,
  UserRedemptionState,
  BatchStatus,
  VaultCapabilities,
  VaultErrorCode,
  RequestStatus,
} from "../vaultProvider.js";

export { VaultProviderError } from "../vaultProvider.js";

// Provider implementations
export { CustomVaultProvider } from "../customVaultProvider.js";

// Factory
export {
  VaultProviderFactory,
  getVaultProviderFactory,
  getVaultProvider,
  initializeVaultProviders,
} from "../vaultProviderFactory.js";
