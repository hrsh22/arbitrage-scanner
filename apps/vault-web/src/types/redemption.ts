/**
 * Epoch-based Redemption Types
 * Types for the ERC7540-style weekly epoch redemption system
 */

export type RedemptionRequestStatus = "pending" | "claimable" | "claimed" | "cancelled";

export interface RedemptionRequest {
  id: string;
  requestId: string;
  shares: string;
  sharesFormatted: string;
  targetEpoch: number;
  targetEpochEndTime: string; // ISO date string
  claimableAssets: string | null;
  claimableAssetsFormatted: string | null;
  status: RedemptionRequestStatus;
  createdAt: string;
  claimedAt: string | null;
  cancelledAt: string | null;
  proRataApplied: boolean;
  proRataPercentage: number | null;
  // Controller-aware lifecycle fields (ERC7540-style)
  ownerAddress: string; // The address that owns the shares being redeemed
  controllerAddress: string; // The address that initiated the request (may be operator)
  operatorAddress?: string | null; // The operator who initiated on behalf of owner (if applicable)
}

export interface EpochInfo {
  currentEpoch: number;
  currentEpochStartTime: string;
  currentEpochEndTime: string;
  nextEpochStartTime: string;
  isSettlementWindow: boolean;
  settlementWindowStart: string | null;
  settlementWindowEnd: string | null;
  totalPendingShares: string;
  estimatedSettlementAssets: string | null;
  navFresh: boolean;
  navLastUpdated: string | null;
}

export interface RedemptionQueueResponse {
  requests: RedemptionRequest[];
  pending: RedemptionRequest[];
  claimable: RedemptionRequest[];
  total: number;
}

export interface RedemptionRequestCreateResponse {
  success: boolean;
  requestId: string;
  epochId: number;
  status: RedemptionRequestStatus;
  message: string;
  targetSettlement: string;
}

export interface RedemptionClaimResponse {
  success: boolean;
  requestId: string;
  txHash: string;
  claimedAssets: string;
  message: string;
}

// ============================================================================
// Tranche-Carry Lifecycle Types
// ============================================================================

export interface DepositQueueResponse {
  success: boolean;
  vaultId: number;
  userAddress: string;
  /** Queued: assets waiting in deposit queue (pending state) */
  queued: string;
  queuedFormatted: string;
  queuedShares: string;
  queuedSharesFormatted: string;
  /** Frozen: assets frozen in epoch (claimable state) */
  frozen: string;
  frozenFormatted: string;
  frozenShares: string;
  frozenSharesFormatted: string;
  currentEpochId: number;
  currentEpochEnd: string;
  timestamp: string;
}

export interface TrancheStatusResponse {
  success: boolean;
  vaultId: number;
  userAddress: string;
  epochId: number;
  epochStatus: {
    status: "settled" | "pending";
    startTime: string;
    endTime: string;
    settled: boolean;
    totalShares: string;
    totalSharesFormatted: string;
  };
  tranchePosition: {
    /** Accrued: total realized USDC */
    accrued: string;
    accruedFormatted: string;
    /** Claimed: total USDC already claimed */
    claimed: string;
    claimedFormatted: string;
    /** ClaimableNow: USDC available to claim */
    claimableNow: string;
    claimableNowFormatted: string;
    /** Minimum claim threshold */
    minClaimThreshold: string;
    minClaimThresholdFormatted: string;
  };
  entitlementCount: number;
  timestamp: string;
}

export interface EntitlementDetail {
  entitlementId: number;
  requestId: string;
  epochId: string;
  accrued: string;
  claimableNow: string;
  eligible: boolean;
  status: string;
}

export interface CarryEligibilityResponse {
  success: boolean;
  vaultId: number;
  userAddress: string;
  requestId?: string;
  entitlementId?: number;
  /** Lifecycle fields */
  accrued: string;
  accruedFormatted: string;
  claimed: string;
  claimedFormatted: string;
  claimableNow: string;
  claimableNowFormatted: string;
  minClaimThreshold: string;
  minClaimThresholdFormatted: string;
  /** Eligibility status */
  eligible: boolean;
  meetsThreshold: boolean;
  canClaim: boolean;
  eligibilityError?: string | null;
  /** Status info */
  entitlementStatus?: string;
  currentClaimState?: string;
  /** Aggregated fields (when no requestId specified) */
  totalEntitlements?: number;
  eligibleCount?: number;
  hasEligibleClaims?: boolean;
  entitlements?: EntitlementDetail[];
  timestamp: string;
}

// Extended RedemptionRequest with lifecycle fields
export interface RedemptionRequestWithLifecycle extends RedemptionRequest {
  /** Queued: assets waiting in deposit queue */
  queued: string;
  queuedFormatted: string;
  /** Frozen: shares frozen in epoch */
  frozen: string;
  frozenFormatted: string;
  /** Accrued: total realized USDC for this entitlement */
  accrued: string;
  accruedFormatted: string;
  /** Claimed: total USDC already claimed */
  claimed: string;
  claimedFormatted: string;
  /** ClaimableNow: USDC available to claim right now */
  claimableNow: string;
  claimableNowFormatted: string;
  /** Minimum claim threshold (1 USDC) */
  minClaimThreshold: string;
  minClaimThresholdFormatted: string;
  /** Additional metadata */
  entitlementStatus?: string;
  sharesSubmitted?: string;
  entitlementRatio?: string;
}

