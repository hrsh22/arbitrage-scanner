/**
 * Vault Types
 * Runtime type definitions for the Polymarket Vault system
 * Cohort-Carry Lifecycle: Pending -> Frozen -> Claimable -> Claimed/Closed
 */

/**
 * Vault configuration with blockchain and adapter addresses
 */
export interface VaultConfig {
  /** Vault contract address on Polygon */
  vaultAddress: string;
  /** NegRisk adapter contract address */
  adapterAddress: string;
  /** Safe (multisig) contract address for asset custody */
  safeAddress: string;
  /** Asset token address (USDC.e on Polygon) */
  assetAddress: string;
  /** Chain configuration (chainId, RPC endpoint) */
  chainConfig: {
    chainId: number;
    rpcUrl: string;
  };
}

/**
 * Vault position representing a market prediction share
 * Mirrors database representation but as runtime type
 */
export interface VaultPosition {
  /** Polymarket market ID */
  marketId: string;
  /** Conditional token framework condition ID */
  conditionId: string;
  /** Conditional token ID for this outcome */
  tokenId: string;
  /** Market outcome (e.g., "Yes", "No") */
  outcome: string;
  /** Cost basis per share in USDC */
  costBasis: number;
  /** Current share quantity held */
  quantity: number;
  /** Position status */
  status: "open" | "closing" | "closed";
}

/**
 * Vault Net Asset Value snapshot
 */
export interface VaultNAV {
  /** Total assets under management in USDC (idle + deployed market value) */
  totalAssets: number;
  /** Idle USDC not yet deployed (vault balance + safe balance) */
  idleAssets: number;
  /** Cost basis of deployed positions in USDC */
  deployedCostBasis: number;
  /** Mark-to-market value of deployed positions (Σ quantity × bidPrice) */
  deployedMarketValue: number;
  /** Share price in USDC (totalAssets / totalSupply) */
  sharePrice: number;
  /** Number of active positions */
  positionCount: number;
  /** Timestamp of NAV calculation */
  lastUpdated: Date;
}

/**
 * Allocation request for deploying or withdrawing capital
 */
export interface AllocationRequest {
  /** Operation type */
  direction: "allocate" | "deallocate";
  /** Amount in USDC */
  amount: number;
  /** Reason for allocation (audit trail) */
  reason: string;
}

/**
 * Trade request for buying/selling market shares
 */
export interface TradeRequest {
  /** Polymarket market ID */
  marketId: string;
  /** Conditional token ID */
  tokenId: string;
  /** Trade direction */
  side: "buy" | "sell";
  /** Limit price in USDC */
  price: number;
  /** Share quantity */
  size: number;
}

/**
 * Result of a trade execution
 */
export interface TradeResult {
  /** Trade execution success */
  success: boolean;
  /** Order ID from exchange (if successful) */
  orderId?: string;
  /** Actual shares filled */
  filledSize?: number;
  /** Average fill price in USDC */
  avgPrice?: number;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Vault operational status
 */
export interface VaultStatus {
  /** Current NAV */
  nav: VaultNAV;
  /** Active position count */
  positionCount: number;
  /** Ratio of deployed assets to total assets */
  deployedRatio: number;
  /** Safe contract USDC balance */
  safeBalance: number;
  /** Timestamp of last market scan */
  lastScanAt?: Date;
  /** Operational mode */
  mode: "simulation" | "live";
}

/**
 * Estimate update entry for audit trail
 */
export interface EstimateUpdate {
  /** Timestamp of the update */
  timestamp: Date;
  /** Previous estimated value */
  oldValue: number;
  /** New estimated value */
  newValue: number;
  /** Reason for the update */
  reason: "initial" | "queue_refresh" | "prepare_claim" | "slippage_adjustment" | "mark_ready";
  /** Source of the update (contract or API) */
  source: string;
}

/**
 * Withdrawal request in the FIFO queue
 */
export interface WithdrawalRequest {
  /** Unique request identifier */
  requestId: string;
  /** Vault contract address (multi-vault support) */
  vaultAddress: string;
  /** Depositor wallet address */
  userAddress: string;
  /** Vault shares to withdraw (18 decimal string) */
  shares: string;
  /** Estimated USDC.e value at request time */
  assetsEstimated: number;
  /** Queue status */
  status: "pending" | "ready" | "completed" | "cancelled" | "expired";
  /** When the request was created (FIFO ordering) */
  requestedAt: Date;
  /** When enough liquidity became available */
  readyAt?: Date;
  /** When user completed on-chain redemption */
  completedAt?: Date;
  /** On-chain redemption tx hash */
  txHash?: string;
  /** Audit trail of all estimate updates */
  estimateHistory?: EstimateUpdate[];
}

/**
 * Result of a reconciliation cycle
 */
export interface ReconciliationResult {
  /** Vault contract USDC.e balance */
  vaultBalance: number;
  /** Safe contract USDC.e balance */
  safeBalance: number;
  /** Number of pending withdrawal requests */
  pendingWithdrawals: number;
  /** Action taken during reconciliation */
  action: "none" | "deallocated" | "allocated" | "marked_ready" | "settled";
  /** Amount involved in the action (USDC.e) */
  /** Amount involved in the action (USDC.e) */
  amount?: number;
  /** Human-readable description */
  details: string;
}

// ===== Trading Strategy Types (ported from apps/api/src/bot) =====

/**
 * Near-resolution high-confidence opportunity from Gamma API.
 * Represents a market nearing its close date with high-probability outcomes.
 */
export interface NearResolutionOpportunity {
  key: string;
  type: "near-resolution";
  marketId: string;
  marketSlug?: string;
  eventId?: string;
  eventSlug?: string;
  eventTitle?: string;
  question: string;
  tags?: string[];

  /** The likely outcome (Yes or No with highest odds) */
  likelyOutcome: {
    name: string;
    tokenId: string;
    probability: number;
    bestBid: number;
    bestAsk: number;
    liquidity: number;
  };

  /** The opposite outcome (for hedging) */
  oppositeOutcome: {
    name: string;
    tokenId: string;
    bestBid: number;
    bestAsk: number;
  };

  /** Time until resolution */
  closesAt: Date;
  hoursUntilClose: number;

  /** Profit metrics */
  potentialProfit: number;
  potentialLoss: number;
  expectedValue: number;

  score: number;
  detectedAt: Date;
}

/**
 * Scored opportunity from strategy engine evaluation.
 * Includes PPH score and max investment stats.
 */
export interface ScoredOpportunity {
  marketId: string;
  marketQuestion: string;
  marketSlug?: string;
  tokenId: string;
  oppositeTokenId?: string;
  oppositeOutcome?: string;
  tags?: string[];
  outcome: string;
  probability: number;
  buyPrice: number;
  hoursUntilClose: number;
  closesAt: Date;
  liquidity: number;
  pphScore: number;
  expectedProfit: number;
  canBet: boolean;
  skipReason?: string;
  maxInvestment: number;
  maxProfitPercent: number;
  maxProfitAbsolute: number;
}

/**
 * Hedge evaluation result constants.
 */
export const HedgeEvaluationResult = {
  HEDGED: "hedged",
  SKIPPED: "skipped",
  NOT_NEEDED: "not_needed",
} as const;

export type HedgeEvaluationResultType =
  (typeof HedgeEvaluationResult)[keyof typeof HedgeEvaluationResult];

/**
 * Limiter reasons for allocation headroom
 */
export type HeadroomLimiterReason = "policy_cap" | "no_headroom" | "nav_stale";

/**
 * Allocation headroom result with limiter metadata
 */
export interface HeadroomResult {
  /** Available headroom in USDC */
  headroomUsdc: number;
  /** The limiting factor for this headroom */
  limiter: HeadroomLimiterReason;
  /** Human-readable explanation */
  details: string;
}

// ============================================================================
// Cohort-Carry (Tranche-Based) Epoch Vault Types
// ============================================================================

/**
 * Epoch status in the cohort-carry redemption lifecycle
 * Pending -> Frozen -> Claimable -> Closed
 */
export type EpochStatus = "pending" | "frozen" | "claimable" | "closed" | "cancelled";

/**
 * Epoch redemption request status - Cohort-Carry Lifecycle
 * - "pending": Request created, awaiting epoch freeze
 * - "frozen": Epoch frozen, entitlement locked
 * - "claimable": Realizations complete, ready to claim
 * - "claimed": User has claimed assets
 * - "closed": All claims settled, request complete
 * - "cancelled": Request cancelled before settlement
 */
export type EpochRequestStatus =
  | "pending"
  | "frozen"
  | "claimable"
  | "claimed"
  | "closed"
  | "cancelled";

/**
 * Epoch definition - represents a weekly redemption window with cohort-carry lifecycle
 */
export interface Epoch {
  id: number;
  epochId: string;
  vaultAddress: string;
  startTime: Date;
  endTime: Date;
  status: EpochStatus;
  navSnapshotId: number | null;
  frozenAt: Date | null; // When epoch was frozen
  claimableAt: Date | null; // When became claimable
  closedAt: Date | null; // When all claims settled
  totalSharesRequested: string; // BigNumber string (18 decimals)
  totalAssetsToClaim: string; // BigNumber string (6 decimals)
  proRataRatio: string | null; // BigNumber string (18 decimals)
  settlementTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Epoch redemption request - user's redemption request within an epoch
 * Aligned with Cohort-Carry async redemption semantics
 */
export interface EpochRequest {
  id: number;
  requestId: string;
  userAddress: string;
  // ERC-7540 controller/owner/operator fields
  controller?: string;
  owner?: string;
  operator?: string;
  vaultAddress: string;
  shares: string; // BigNumber string (18 decimals)
  epochId: string;
  status: EpochRequestStatus;
  claimableAssets: string | null; // BigNumber string (6 decimals), set at settlement
  claimedAssets: string | null; // BigNumber string (6 decimals)
  claimTxHash: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
  frozenAt: Date | null; // When request was frozen
  claimableAt: Date | null; // When became claimable
  claimedAt: Date | null;
  closedAt: Date | null; // When all claims settled
  updatedAt: Date;
}

/**
 * NAV snapshot at epoch settlement
 */
export interface NavSnapshot {
  id: number;
  snapshotId: string;
  epochId: string;
  vaultAddress: string;
  totalAssets: string; // BigNumber string (6 decimals)
  totalShares: string; // BigNumber string (18 decimals)
  sharePrice: string; // BigNumber string (8 decimals)
  timestamp: Date;
  recordedBy: string;
  txHash: string | null;
  isFresh: boolean;
  staleReason: string | null;
  createdAt: Date;
}

/**
 * Valid epoch state transitions - Cohort-Carry Lifecycle
 */
export const validEpochTransitions: Record<EpochStatus, EpochStatus[]> = {
  pending: ["frozen", "cancelled"],
  frozen: ["claimable", "cancelled"],
  claimable: ["closed", "cancelled"],
  closed: [], // Terminal state
  cancelled: [], // Terminal state
};

/**
 * Valid epoch request state transitions - Cohort-Carry Lifecycle
 */
export const validEpochRequestTransitions: Record<EpochRequestStatus, EpochRequestStatus[]> = {
  pending: ["frozen", "cancelled"],
  frozen: ["claimable", "cancelled"],
  claimable: ["claimed", "closed"],
  claimed: ["closed"],
  closed: [], // Terminal state
  cancelled: [], // Terminal state
};

/**
 * Check if an epoch state transition is valid
 */
export function isValidEpochTransition(fromStatus: EpochStatus, toStatus: EpochStatus): boolean {
  if (fromStatus === toStatus) return true;
  return validEpochTransitions[fromStatus]?.includes(toStatus) ?? false;
}

/**
 * Check if an epoch request state transition is valid
 */
export function isValidEpochRequestTransition(
  fromStatus: EpochRequestStatus,
  toStatus: EpochRequestStatus,
): boolean {
  if (fromStatus === toStatus) return true;
  return validEpochRequestTransitions[fromStatus]?.includes(toStatus) ?? false;
}

/**
 * Result of a state transition attempt
 */
export interface EpochStateTransitionResult<T = Epoch | EpochRequest> {
  success: boolean;
  entity?: T;
  error?: string;
  alreadyInTargetState?: boolean;
}

/**
 * Create epoch request input (Cohort-Carry aligned)
 */
export interface CreateEpochRequestInput {
  requestId: string;
  userAddress: string;
  controller?: string;
  owner?: string;
  operator?: string;
  vaultAddress: string;
  shares: string;
  epochId: string;
}

/**
 * Create epoch input
 */
export interface CreateEpochInput {
  epochId: string;
  vaultAddress: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Create NAV snapshot input
 */
export interface CreateNavSnapshotInput {
  snapshotId: string;
  epochId: string;
  vaultAddress: string;
  totalAssets: string;
  totalShares: string;
  sharePrice: string;
  timestamp: Date;
  recordedBy: string;
  txHash?: string;
}

/**
 * Epoch with aggregated request data
 */
export interface EpochWithStats extends Epoch {
  requestCount: number;
  pendingRequestCount: number;
  claimedCount: number;
  cancelledCount: number;
}

/**
 * User's epoch request with epoch metadata
 */
export interface UserEpochRequest extends EpochRequest {
  epochStartTime: Date;
  epochEndTime: Date;
  epochStatus: EpochStatus;
  isClaimable: boolean;
  isCancellable: boolean;
}

// ============================================================================
// Cohort-Carry Entitlement and Payout Types
// ============================================================================

/**
 * Entitlement status in the cohort-carry lifecycle
 */
export type EntitlementStatus =
  | "pending"
  | "frozen"
  | "claimable"
  | "partially_fulfilled"
  | "fully_fulfilled"
  | "closed"
  | "cancelled";

/**
 * Payout distribution status
 */
export type PayoutStatus = "pending" | "distributed" | "claimed" | "failed";

/**
 * Realization outcome for position resolution
 */
export type RealizationOutcome = "win" | "loss" | "force_close";

/**
 * Epoch redemption entitlement with cohort-carry tracking
 */
export interface EpochRedemptionEntitlement {
  id: number;
  epochId: string;
  trancheId: string | null; // Cohort tranche identifier for progressive payout
  requestId: string;
  userAddress: string;
  sharesSubmitted: string; // BigNumber string (18 decimals)
  totalEpochShares: string; // BigNumber string (18 decimals)
  entitlementRatio: string; // BigNumber string (38 decimals), 0.0 to 1.0
  // Cohort-carry lifecycle fields
  entitlement: string; // BigNumber string (6 decimals) - Total entitled amount
  accrued: string; // BigNumber string (6 decimals) - Amount accrued from realizations
  claimed: string; // BigNumber string (6 decimals) - Amount claimed by user
  carryRemaining: string; // BigNumber string (6 decimals) - Remaining to be carried
  status: EntitlementStatus;
  // Legacy fields
  totalRealizedUsdc: string;
  totalClaimedUsdc: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Position realization event
 */
export interface PositionRealizationEvent {
  id: number;
  epochId: string;
  trancheId: string | null;
  positionSnapshotId: number;
  tokenId: string;
  realizedOutcome: RealizationOutcome;
  grossProceeds: string; // BigNumber string (6 decimals)
  feeDeducted: string; // BigNumber string (6 decimals)
  netProceeds: string; // BigNumber string (6 decimals)
  realizedAt: Date;
  txHash: string | null;
  createdAt: Date;
}

/**
 * Realized payout distribution with cohort-carry tracking
 */
export interface RealizedPayoutDistribution {
  id: number;
  epochId: string;
  trancheId: string | null;
  entitlementId: number;
  realizationEventId: number;
  userAddress: string;
  grossAmount: string; // BigNumber string (6 decimals)
  feeDeduction: string; // BigNumber string (6 decimals)
  netAmount: string; // BigNumber string (6 decimals)
  // Cohort-carry fields
  entitlementAmount: string; // BigNumber string (6 decimals)
  carryForward: string; // BigNumber string (6 decimals)
  status: PayoutStatus;
  distributedAt: Date;
  claimedAt: Date | null;
  txHash: string | null;
  createdAt: Date;
}

/**
 * Valid entitlement state transitions - Cohort-Carry Lifecycle
 */
export const validEntitlementTransitions: Record<EntitlementStatus, EntitlementStatus[]> = {
  pending: ["frozen", "cancelled"],
  frozen: ["claimable", "partially_fulfilled", "fully_fulfilled", "cancelled"],
  claimable: ["partially_fulfilled", "fully_fulfilled", "closed", "cancelled"],
  partially_fulfilled: ["fully_fulfilled", "closed", "cancelled"],
  fully_fulfilled: ["closed", "cancelled"],
  closed: [], // Terminal state
  cancelled: [], // Terminal state
};

/**
 * Check if an entitlement state transition is valid
 */
export function isValidEntitlementTransition(
  fromStatus: EntitlementStatus,
  toStatus: EntitlementStatus,
): boolean {
  if (fromStatus === toStatus) return true;
  return validEntitlementTransitions[fromStatus]?.includes(toStatus) ?? false;
}
