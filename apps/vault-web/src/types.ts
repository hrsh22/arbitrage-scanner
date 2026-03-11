/**
 * Vault Web Types
 * Frontend type definitions matching backend API responses
 * Note: Dates are ISO strings in API responses
 */

// NAV snapshot from /vault/status
export interface VaultNAV {
  totalAssets: number;
  idleAssets: number;
  vaultUsdc: number;
  safeUsdc: number;
  deployedCostBasis: number;
  redeemableCostBasis?: number;
  sharePrice: number;
  positionCount: number;
  redeemableCount?: number;
  lastUpdated: string; // ISO date string
}

export type VaultRiskLevel = "low" | "medium" | "high";

export interface VaultProfile {
  strategy: string;
  strategyLabel: string;
  description: string;
  longDescription: string;
  riskLevel: VaultRiskLevel;
  minDeposit: number;
  maxDeposit: number;
  fees: {
    management: number;
    performance: number;
    withdrawal: number;
  };
}

export interface VaultInstance {
  id: number;
  slug: string;
  name: string;
  enabled: boolean;
  type: "bot" | "agent" | "custom";
  mode: "simulation" | "live";
  profile: VaultProfile;
  config: {
    vaultAddress: string;
    safeAddress: string;
    betSize: number;
    dailyBudget: number;
    minOdds: number;
    maxOdds: number;
    maxHoursGeneral: number;
    hedgingEnabled: boolean;
  };
  intervals: {
    navRefreshMin: number;
    reconciliationMin: number;
    tradingScanMin: number;
    resolutionCheckMin: number;
  };
}

export interface VaultInstancesResponse {
  instances: VaultInstance[];
  total: number;
}

// /vault/status response
export interface VaultStatusResponse {
  vaultId?: number;
  vaultName?: string;
  vaultSlug?: string;
  profile?: VaultProfile;
  nav: VaultNAV;
  positionCount: number;
  deployedRatio: number;
  committedExposureRatio?: number;
  totalCostBasis: number;
  mode: "simulation" | "live";
  capState?: {
    maxAllowedDeployed: number;
    currentDeployed: number;
    headroom: number;
    constraintSource: "policy_cap" | "no_headroom" | "nav_stale";
  } | null;
}

// Position from /vault/positions
export interface VaultPosition {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  costBasis: number;
  curPrice: number;
  currentValue?: number;
  realizedPnl?: number;
  cashPnl?: number;
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
  endDate: string;
  redeemable: boolean;
  status: "open" | "redeemable" | "closed";
}

export interface VaultPositionsResponse {
  positions: VaultPosition[];
  total: number;
}

export interface VaultPositionHistoryResponse {
  positions: VaultPosition[];
  total: number;
}

// NAV history from /vault/nav-history
export interface VaultNavHistoryItem {
  id: number;
  navId: string;
  totalAssets: string;
  idleAssets: string;
  deployedCostBasis: string;
  sharePrice: string;
  positionCount: number;
  timestamp: string;
  createdAt: string;
}

export interface VaultNavHistoryResponse {
  snapshots: VaultNavHistoryItem[];
  total: number;
}

// Allocation from /vault/allocations
export interface VaultAllocation {
  id: number;
  allocationId: string;
  txHash: string;
  direction: "allocate" | "deallocate";
  amount: string;
  timestamp: string;
  createdAt: string;
}

export interface VaultAllocationsResponse {
  allocations: VaultAllocation[];
  total: number;
}

export type WithdrawalRequestStatus = "pending" | "ready" | "completed" | "cancelled";

export interface WithdrawalRequest {
  id: number;
  requestId: string;
  vaultAddress: string;
  userAddress: string;
  shares: string;
  assetsEstimated: string;
  status: WithdrawalRequestStatus;
  requestedAt: string;
  readyAt: string | null;
  completedAt: string | null;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalQueueResponse {
  requests: WithdrawalRequest[];
  total: number;
}

export interface WithdrawalRequestCreateResponse {
  success: boolean;
  requestId: string;
  status: WithdrawalRequestStatus;
  message: string;
}

export interface WithdrawalRequestCompleteResponse {
  success: boolean;
  request: WithdrawalRequest;
  message: string;
}

export interface WithdrawalRequestPrepareResponse {
  success: boolean;
  request: WithdrawalRequest;
  requestId?: string;
  assetsEstimated?: string;
  previousEstimate?: string;
  slippageWarning?: boolean;
  slippagePercent?: number;
  threshold?: number;
  idempotent?: boolean;
  estimateStale?: boolean;
  message?: string;
  reconciliation?: {
    vaultBalance: number;
    safeBalance: number;
    pendingWithdrawals: number;
    action: "none" | "deallocated" | "allocated" | "marked_ready";
    amount?: number;
    details: string;
  };
}

export interface WithdrawalRequestCancelResponse {
  success: boolean;
  request: WithdrawalRequest;
  message: string;
}

// Generic API response wrapper
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success?: boolean;
}

// SIWE types
export interface SiweNonceResponse {
  nonce: string;
}

export interface SiweVerifyRequest {
  message: string;
  signature: string;
}

export interface SiweVerifyResponse {
  ok: boolean;
  address: string;
}

// ============================================
// Epoch-based Redemption Types (ERC7540-style)
// ============================================

export type RedemptionRequestStatus = "pending" | "claimable" | "claimed" | "cancelled";

export interface RedemptionRequest {
  id: string;
  requestId: string;
  epochId?: number;
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

/** Redemption request status response */
export interface RedemptionRequestStatusResponse {
  success: boolean;
  request: RedemptionRequest;
  claimable: boolean;
  estimatedSettlementTime?: string;
}

/** Claim redemption response */
export interface ClaimRedemptionResponse {
  success: boolean;
  requestId: string;
  vaultId: number;
  userAddress: string;
  assetsReceived: string;
  assetsReceivedFormatted: string;
  txHash: string;
  message: string;
}

/** Cancel redemption response */
export interface CancelRedemptionResponse {
  success: boolean;
  requestId: string;
  vaultId: number;
  userAddress: string;
  message: string;
}

export interface EpochStatusResponse {
  success: boolean;
  epoch: Epoch;
  vaultId: number;
  canSettle?: boolean;
}

export interface UserRedemptionsResponse {
  success: boolean;
  requests: RedemptionRequest[];
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  totalPendingShares: string;
  totalClaimableShares: string;
  estimatedAssetsPendingFormatted: string;
  estimatedAssetsClaimableFormatted: string;
}
/** Epoch metadata */
export interface Epoch {
  epochId: number;
  startTime: string;
  endTime: string;
  settlementTime: string;
  isActive: boolean;
  isPast: boolean;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  totalRequests: number;
  totalShares: string;
  totalSharesFormatted: string;
  settled: boolean;
  proRataRatio?: string;
  availableAssets?: string;
  availableAssetsFormatted?: string;
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
    /** Total entitlement: total USDC entitled */
    entitlement: string;
    entitlementFormatted: string;
    /** Accrued: total realized USDC */
    accrued: string;
    accruedFormatted: string;
    /** Claimed: total USDC already claimed */
    claimed: string;
    claimedFormatted: string;
    /** CarryRemaining: remaining to be carried */
    carryRemaining: string;
    carryRemainingFormatted: string;
    /** ClaimableNow: USDC available to claim */
    claimableNow: string;
    claimableNowFormatted: string;
    /** Minimum claim threshold */
    minClaimThreshold: string;
    minClaimThresholdFormatted: string;
    /** Dust override eligibility */
    dustOverrideEligible: boolean;
    meetsThreshold: boolean;
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
  dustOverrideEligible?: boolean;
  eligibilityError?: string | null;
  /** Status info */
  entitlementStatus?: string;
  currentClaimState?: string;
  /** Aggregated fields */
  totalEntitlements?: number;
  eligibleCount?: number;
  hasEligibleClaims?: boolean;
  entitlements?: Array<{
    entitlementId: number;
    requestId: string;
    epochId: string;
    accrued: string;
    claimableNow: string;
    eligible: boolean;
    dustOverrideEligible?: boolean;
    status: string;
  }>;
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
