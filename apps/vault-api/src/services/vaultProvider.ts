/**
 * Vault Provider Interface
 *
 * Abstracts vault operations for custom ERC7540-style vaults.
 */

import type { Address, Hex } from "viem";

// ============================================================================
// Provider Types
// ============================================================================

export type VaultProviderType = "custom";

export interface VaultProviderConfig {
  vaultId: number;
  vaultAddress: Address;
  providerType: VaultProviderType;
  /** Optional: Custom provider-specific configuration */
  customConfig?: CustomVaultConfig;
}

export interface CustomVaultConfig {
  /** Epoch duration in seconds (default: 604800 = 7 days) */
  epochDurationSeconds: number;
  /** NAV staleness threshold in seconds (default: 21600 = 6 hours) */
  navStalenessThresholdSeconds: number;
  /** Contract ABI for custom vault */
  contractAbi?: unknown;
}

// ============================================================================
// Domain Types
// ============================================================================

export interface VaultMetadata {
  vaultId: number;
  vaultAddress: Address;
  providerType: VaultProviderType;
  asset: Address;
  assetDecimals: number;
  shareDecimals: number;
  totalAssets: bigint;
  totalSupply: bigint;
  sharePrice: number;
  epochInfo?: EpochInfo;
  /** NAV freshness indicator */
  navLastUpdated: Date;
  /** Whether NAV is considered stale for settlement */
  navIsStale: boolean;
}

export interface EpochInfo {
  currentEpochId: number;
  currentEpochStart: Date;
  currentEpochEnd: Date;
  nextSettlementTime: Date;
  epochDurationSeconds: number;
}

export type RequestStatus =
  | "pending" // Awaiting epoch freeze
  | "frozen" // Epoch frozen, awaiting settlement
  | "claimable" // Ready for claim (settled, assets computed)
  | "claimed" // Successfully claimed
  | "cancelled"; // Cancelled by user

export interface RedemptionRequest {
  requestId: string;
  vaultId: number;
  userAddress: Address;
  // ERC-7540 controller/owner/operator fields
  controller?: Address; // Controller address (defaults to userAddress)
  owner?: Address; // Owner address (defaults to userAddress)
  operator?: Address; // Address authorized to act on behalf of owner
  epochId: number;
  shares: bigint;
  assetsEstimated: bigint;
  assetsActual?: bigint;
  status: RequestStatus;
  createdAt: Date;
  // settledAt kept for backward compatibility, represents when became claimable
  settledAt?: Date;
  claimableAt?: Date; // When request became claimable
  claimedAt?: Date;
  cancelledAt?: Date;
}

export interface RequestResult {
  success: boolean;
  requestId?: string;
  epochId?: number;
  shares: bigint;
  assetsEstimated: bigint;
  controller?: Address; // Controller address used for request
  owner?: Address; // Owner address used for request
  error?: string;
}

export interface ClaimResult {
  success: boolean;
  requestId: string;
  assetsReceived: bigint;
  carryDeducted?: bigint; // Carry fee deducted from claim
  txHash?: Hex;
  error?: string;
}

export interface RequestStatusResult {
  request: RedemptionRequest;
  claimable: boolean;
  estimatedSettlementTime?: Date;
}

export interface EpochStatus {
  epochId: number;
  startTime: Date;
  endTime: Date;
  settlementTime: Date;
  totalRequests: number;
  totalShares: bigint;
  settled: boolean;
  settlementTxHash?: Hex;
  /** Pro-rata factor if applicable (0-1) */
  proRataFactor?: number;
}

export interface UserRedemptionState {
  userAddress: Address;
  vaultId: number;
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  totalSharesPending: bigint;
  totalSharesClaimable: bigint;
  estimatedAssetsPending: bigint;
  estimatedAssetsClaimable: bigint;
}

export interface CapitalRebalanceResult {
  success: boolean;
  action: "none" | "allocated" | "deallocated";
  amount: bigint;
  requiredVaultBalance: bigint;
  queuedAssets: bigint;
  reservedRedemptionAssets: bigint;
  pendingWithdrawalLiability: bigint;
  details: string;
  txHash?: Hex;
  error?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class VaultProviderError extends Error {
  constructor(
    message: string,
    public readonly code: VaultErrorCode,
    public readonly vaultId?: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "VaultProviderError";
  }
}

export type VaultErrorCode =
  | "VAULT_NOT_FOUND"
  | "REQUEST_NOT_FOUND"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_SHARES"
  | "REQUEST_NOT_CLAIMABLE"
  | "REQUEST_ALREADY_CLAIMED"
  | "REQUEST_CANCELLED"
  | "CANCEL_NOT_ALLOWED"
  | "STALE_NAV"
  | "SETTLEMENT_PENDING"
  | "EPOCH_NOT_SETTLED"
  | "CONTRACT_ERROR"
  | "CONFIG_ERROR"
  | "UNSUPPORTED_OPERATION";

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * IVaultProvider - Abstract interface for vault operations
 *
 * Implementation:
 * - CustomVaultProvider: Implements ERC7540-style weekly epoch vault
 */
export interface IVaultProvider {
  /** Provider type identifier */
  readonly providerType: VaultProviderType;

  /** Vault configuration */
  readonly config: VaultProviderConfig;

  // --------------------------------------------------------------------------
  // Read Operations
  // --------------------------------------------------------------------------

  /**
   * Get vault metadata and current state
   * @returns VaultMetadata including NAV, share price, epoch info
   */
  getVaultInfo(): Promise<VaultMetadata>;

  /**
   * Get current epoch status
   * @param epochId - Optional specific epoch, defaults to current
   */
  getEpochStatus(epochId?: number): Promise<EpochStatus>;

  /**
   * Get redemption request status
   * @param requestId - Unique request identifier
   */
  getRequestStatus(requestId: string): Promise<RequestStatusResult>;

  /**
   * Get all requests for a user
   * @param userAddress - User wallet address
   */
  getUserRequests(userAddress: Address): Promise<RedemptionRequest[]>;

  /**
   * Get comprehensive user redemption state
   * @param userAddress - User wallet address
   */
  getUserRedemptionState(userAddress: Address): Promise<UserRedemptionState>;

  previewRedeem(shares: bigint): Promise<bigint>;

  // --------------------------------------------------------------------------
  // Write Operations
  // --------------------------------------------------------------------------

  /**
   * Request redemption (initiates async redemption flow)
   * @param userAddress - User requesting redemption
   * @param shares - Amount of shares to redeem
   * @returns RequestResult with requestId and status
   */
  requestRedeem(userAddress: Address, shares: bigint): Promise<RequestResult>;

  /**
   * Cancel a pending redemption request
   * @param requestId - Request to cancel
   * @param userAddress - User cancelling (for authorization)
   * @returns Success indicator
   */
  cancelRedemption(
    requestId: string,
    userAddress: Address,
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * Claim matured redemption
   * @param requestId - Request to claim
   * @param userAddress - User claiming (for authorization)
   * @returns ClaimResult with assets received
   */
  claimRedemption(requestId: string, userAddress: Address): Promise<ClaimResult>;

  // --------------------------------------------------------------------------
  // Settlement Operations (typically admin/keeper)
  // --------------------------------------------------------------------------

  /**
   * Check if epoch is ready for settlement (NAV fresh, epoch ended)
   * @param epochId - Epoch to check
   */
  isSettlementReady(epochId?: number): Promise<boolean>;

  /**
   * Execute epoch settlement (pro-rata distribution)
   * @param epochId - Epoch to settle
   * @returns Transaction hash and settlement details
   */
  executeSettlement(epochId?: number): Promise<{
    success: boolean;
    txHash?: Hex;
    epochId: number;
    requestsSettled: number;
    totalShares: bigint;
    totalAssets: bigint;
    error?: string;
  }>;

  rebalanceCapital(params: {
    vaultUsdcBalance: bigint;
    safeUsdcBalance: bigint;
    pendingWithdrawalLiability: bigint;
  }): Promise<CapitalRebalanceResult>;

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Validate provider configuration
   * @returns Validation result with any errors
   */
  validateConfig(): Promise<{ valid: boolean; errors: string[] }>;

  /**
   * Get provider capabilities (for feature detection)
   * @returns Capabilities supported by this provider
   */
  getCapabilities(): VaultCapabilities;
}

/**
 * Provider capability flags
 */
export interface VaultCapabilities {
  /** Supports async redemption with epochs */
  asyncRedemption: boolean;
  instantRedemption: boolean;
  /** Supports request cancellation before settlement */
  cancelBeforeSettlement: boolean;
  /** Supports pro-rata settlement */
  proRataSettlement: boolean;
  /** Requires NAV for settlement */
  requiresNavForSettlement: boolean;
  /** Supports rollover of unsettled requests */
  supportsRollover: boolean;
  /** Epoch-based (vs instant) */
  epochBased: boolean;
}

// ============================================================================
// Factory Types
// ============================================================================

export interface IVaultProviderFactory {
  /**
   * Get or create provider for vault
   * @param vaultId - Vault identifier
   * @returns IVaultProvider instance
   * @throws VaultProviderError if vault not found
   */
  getProvider(vaultId: number): IVaultProvider;

  /**
   * Register provider configuration
   * @param config - Provider configuration
   */
  registerProvider(config: VaultProviderConfig): void;

  /**
   * Check if provider exists for vault
   * @param vaultId - Vault identifier
   */
  hasProvider(vaultId: number): boolean;

  /**
   * Get all registered provider vault IDs
   */
  getRegisteredVaultIds(): number[];

  /**
   * Clear all providers (useful for testing)
   */
  clearProviders(): void;
}
