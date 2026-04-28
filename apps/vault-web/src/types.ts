/**
 * Vault Web Types
 * Frontend type definitions matching backend API responses
 * Note: Dates are ISO strings in API responses
 */

// NAV snapshot from /vault/status
export interface VaultNAV {
  totalAssets: number;
  trackedTotalAssets?: number;
  idleAssets: number;
  vaultUsdc: number;
  safeUsdc: number;
  deployedCostBasis: number;
  redeemableCostBasis?: number;
  redeemableMarketValue?: number;
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
  tradingMetadata?: {
    assets: string[];
    platforms: string[];
    marketType?: string;
  };
}

export interface VaultMigration {
  enabled: boolean;
  phase: "usdc_e_to_pusd";
  depositsDisabled: boolean;
  title: string;
  message: string;
  startedAt?: string;
  targetAssetSymbol?: string;
  targetAssetAddress?: string;
}

export interface VaultInstance {
  id: number;
  slug: string;
  name: string;
  enabled: boolean;
  type: "bot" | "agent" | "custom";
  mode: "simulation" | "live";
  migration?: VaultMigration | null;
  profile: VaultProfile;
  config: {
    vaultAddress: string;
    safeAddress: string;
  };
  intervals: {
    navRefreshMin: number;
    reconciliationMin: number;
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
  migration?: VaultMigration | null;
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

export interface VaultTradingAnalytics {
  vaultAddress: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnlPerPosition: number;
  lastResolvedAt: string | null;
  computedAt: string;
}

export interface VaultTradingAnalyticsResponse {
  vaultId: number;
  vaultSlug: string;
  vaultName: string;
  analytics: VaultTradingAnalytics;
}

export interface VaultActivityFeedItem {
  id: string;
  type: string;
  scope: "vault" | "user";
  title: string;
  detail: string;
  occurredAt: string;
  status?: string;
  cycleId?: number;
  requestId?: string;
  txHash?: string | null;
  amounts?: {
    assets?: string;
    shares?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ActivityPagination {
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface VaultEventsResponse {
  success: boolean;
  vaultId: number;
  items: VaultActivityFeedItem[];
  pagination?: ActivityPagination;
}

export interface UserVaultHistoryResponse {
  success: boolean;
  vaultId: number;
  userAddress: string;
  items: VaultActivityFeedItem[];
  pagination?: ActivityPagination;
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

export interface WithdrawalPreflightResponse {
  success?: boolean;
  requestId?: string;
  status?: WithdrawalRequestStatus;
  request?: WithdrawalRequest;
  ready: boolean;
  mode: "instant" | "queued";
  executionMode: "instant" | "queued" | "blocked";
  telemetryFresh: boolean;
  liquidityMode: "vault_liquid" | "recall_required" | "queued_only";
  triggeredRecall: boolean;
  requestedAssets: number;
  vaultBalance: number;
  safeBalance: number;
  shortfall: number;
  reason: string;
  recallTxHash?: string;
  error?: string;
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

export type RedemptionRequestStatus = "pending" | "frozen" | "claimable" | "claimed" | "cancelled";

export type BatchLifecycleState =
  | "open"
  | "closed"
  | "processing"
  | "processed"
  | "cutoff"
  | "flattening"
  | "settling"
  | "settled"
  | "reopen";

export interface RedemptionRequest {
  id: string;
  requestId: string;
  requestKind?: "request" | "controller_pending" | "controller_claimable";
  batchId?: number;
  cycleId?: number;
  shares: string;
  sharesFormatted: string;
  targetCycle: number;
  targetCycleEndTime: string;
  claimableAssets: string | null;
  claimableAssetsFormatted: string | null;
  status: RedemptionRequestStatus;
  createdAt: string;
  claimedAt: string | null;
  cancelledAt: string | null;
  proRataApplied?: boolean;
  proRataPercentage?: number | null;
  ownerAddress?: string;
  controllerAddress?: string;
  operatorAddress?: string | null;
  batchState?: BatchLifecycleState | null;
  estimatedSettlementTime?: string | null;
  flatteningProgress?: number | null;
  settlementProgress?: number | null;
  lifecycleError?: string | null;
}

export interface RedemptionRequestCreateResponse {
  success: boolean;
  requestId: string;
  batchId?: number | null;
  cycleId?: number | null;
  status: RedemptionRequestStatus;
  message: string;
  targetSettlement?: string;
}

export interface RedemptionRequestStatusResponse {
  success: boolean;
  request: RedemptionRequest;
  claimable: boolean;
  estimatedSettlementTime?: string;
}

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

export interface Cycle {
  cycleId: number;
  batchId: number;
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
  batchState: BatchLifecycleState;
  proRataRatio?: string;
  availableAssets?: string;
  availableAssetsFormatted?: string;
  flatteningProgress?: number;
  settlementProgress?: number;
  isCutoff: boolean;
  cutoffTime?: string | null;
  // Lifecycle fields threaded from backend API (slice 1)
  riskState?: string;
  executionMode?: string;
  telemetryFresh?: boolean;
  liquidityMode?: string;
  reopenReady?: boolean;
  openPositionCount?: number;
  hasActionableWork?: boolean;
  reason?: string;
  flatnessCheck?: {
    blockingConditions: string[];
    conditions?: Array<{
      name: string;
      passed: boolean;
      details?: Record<string, unknown>;
    }>;
  };
}

export interface CycleStatusResponse {
  success: boolean;
  cycle: Cycle;
  vaultId: number;
  canSettle?: boolean;
}

export interface UserRedemptionsResponse {
  success: boolean;
  requests?: RedemptionRequest[];
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  totalPendingShares: string;
  totalClaimableShares: string;
  estimatedAssetsPendingFormatted: string;
  estimatedAssetsClaimableFormatted: string;
}

export interface DepositQueueResponse {
  success: boolean;
  vaultId: number;
  userAddress: string;
  queued: string;
  queuedFormatted: string;
  queuedShares: string;
  queuedSharesFormatted: string;
  hasQueuedDeposit: boolean;
  cycleOpenNavEstimate: string | null;
  cycleOpenNavFormatted: string | null;
  estimateBasis: string;
  frozen: string;
  frozenFormatted: string;
  frozenShares: string;
  frozenSharesFormatted: string;
  claimableAssets: string;
  claimableAssetsFormatted: string;
  claimableShares: string;
  claimableSharesFormatted: string;
  hasProcessedDeposit: boolean;
  depositRequestId: string | null;
  depositCreatedAt: string | null;
  targetCycleId: number;
  currentCycleId: number;
  currentCycleStart?: string | null;
  currentCycleEnd: string | null;
  nextCycleStart?: string | null;
  activationTime?: string | null;
  queueStatus: "idle" | "queued" | "processed";
  mintRule: string;
  batchState: BatchLifecycleState;
  timestamp: string;
  // Lifecycle fields threaded from backend API (slice 1)
  riskState?: string;
  executionMode?: string;
  telemetryFresh?: boolean;
  liquidityMode?: string;
  reopenReady?: boolean;
  openPositionCount?: number;
}

export interface CycleHistoryItem {
  cycleId: number;
  batchId: number;
  startTime: string;
  endTime: string;
  cycleOpenNAV: string;
  cycleOpenNAVFormatted: string;
  snapshotNAV: string;
  snapshotNAVFormatted: string;
  snapshotTimestamp: string | null;
  totalSharesPending: string;
  totalSharesPendingFormatted: string;
  frozenShares: string;
  frozenSharesFormatted: string;
  frozenAssets: string;
  frozenAssetsFormatted: string;
  proRataRatio: string;
  proRataRatioFormatted: string;
  carryAccrued: string;
  carryAccruedFormatted: string;
  cohortTotalEntitlement: string;
  cohortTotalEntitlementFormatted: string;
  cohortTotalAccrued: string;
  cohortTotalAccruedFormatted: string;
  cohortTotalClaimed: string;
  cohortTotalClaimedFormatted: string;
  cohortCarryRemaining: string;
  cohortCarryRemainingFormatted: string;
  batchState: BatchLifecycleState;
  status: string;
}

export interface CycleHistoryResponse {
  success: boolean;
  vaultId: number;
  currentCycleId: number;
  cycles: CycleHistoryItem[];
}

export interface TrancheStatusResponse {
  success: boolean;
  vaultId: number;
  userAddress: string;
  cycleId: number;
  cycleStatus: {
    status: "settled" | "pending";
    startTime: string;
    endTime: string;
    settled: boolean;
    totalShares: string;
    totalSharesFormatted: string;
    batchState: BatchLifecycleState;
  };
  tranchePosition: {
    entitlement: string;
    entitlementFormatted: string;
    accrued: string;
    accruedFormatted: string;
    claimed: string;
    claimedFormatted: string;
    carryRemaining: string;
    carryRemainingFormatted: string;
    claimableNow: string;
    claimableNowFormatted: string;
    minClaimThreshold: string;
    minClaimThresholdFormatted: string;
    dustOverrideEligible: boolean;
    meetsThreshold: boolean;
  };
  entitlementCount: number;
  timestamp: string;
}

export interface EntitlementDetail {
  entitlementId: number;
  requestId: string;
  cycleId: string;
  entitlement?: string;
  accrued: string;
  claimed?: string;
  carryRemaining?: string;
  claimableNow: string;
  eligible: boolean;
  dustOverrideEligible?: boolean;
  status: string;
}

export interface CarryEligibilityResponse {
  success: boolean;
  vaultId: number;
  userAddress: string;
  requestId?: string;
  entitlementId?: number;
  cycleId?: string;
  entitlement?: string;
  entitlementFormatted?: string;
  accrued: string;
  accruedFormatted: string;
  claimed: string;
  claimedFormatted: string;
  carryRemaining?: string;
  carryRemainingFormatted?: string;
  claimableNow: string;
  claimableNowFormatted: string;
  minClaimThreshold: string;
  minClaimThresholdFormatted: string;
  eligible: boolean;
  meetsThreshold: boolean;
  canClaim: boolean;
  dustOverrideEligible?: boolean;
  eligibilityError?: string | null;
  entitlementStatus?: string;
  currentClaimState?: string;
  totalEntitlements?: number;
  eligibleCount?: number;
  hasEligibleClaims?: boolean;
  entitlements?: EntitlementDetail[];
  timestamp: string;
}
