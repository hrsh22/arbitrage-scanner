/**
 * Custom Vault Contract Client (ERC-7540 Compliant with Closed-Book Batch Lifecycle)
 *
 * viem-based client for interacting with the ClosedBookBatchVault canonical contract.
 * Implements ERC-7540 async redemption with deposit queue, batch lifecycle, and settlement.
 *
 * Canonical Contract: ClosedBookBatchVault
 *
 * BATCH LIFECYCLE (Closed-Book Model):
 * - OPEN: Batch accepting deposits and redemption requests
 * - CUTOFF: First redemption request seals batch; deposits closed
 * - FLATTENING: NAV snapshot taken, clearing price locked
 * - SETTLING: Settlement in progress (chunked processing)
 * - SETTLED: Settlement complete, claims available
 * - CLOSED: Claims window ended
 * - REOPEN: Ready for next batch cycle
 *
 * KEY DIFFERENCES FROM EpochTrancheVault:
 *   - Uses 'batch' terminology instead of 'epoch'
 *   - No carry/partial-realization accounting
 *   - Shares remain economically live until settlement
 *   - Locked clearing price computed at flatten time
 *   - Cancellation disabled after cutoff
 */

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { createPublicClient, http } from "viem";
import type { Chain } from "viem/chains";
import { logger } from "../logger.js";

// ============================================================================
// Contract ABI for ClosedBookBatchVault (Canonical)
// ============================================================================

export const CLOSED_BOOK_BATCH_VAULT_ABI = [
  // View functions - Configuration
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "DEPLOY_TIME",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "NAV_STALENESS_THRESHOLD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentBatchId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentNAV",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lastNAVUpdate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isNAVFresh",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "fresh", type: "bool" }],
  },
  {
    type: "function",
    name: "emergencyMode",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // View functions - Batch
  {
    type: "function",
    name: "batches",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "batchId", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "cutoffTime", type: "uint256" },
      { name: "snapshotNAV", type: "uint256" },
      { name: "lockedClearingPrice", type: "uint256" },
      { name: "snapshotTimestamp", type: "uint256" },
      { name: "totalSharesPending", type: "uint256" },
      { name: "totalAssetsSnapshot", type: "uint256" },
      { name: "proRataRatio", type: "uint256" },
      { name: "totalQueuedDeposits", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "isPriceLocked", type: "bool" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getCurrentBatch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getBatchEnd",
    stateMutability: "view",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getBatchStatus",
    stateMutability: "view",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getSettlementProgress",
    stateMutability: "view",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [
      { name: "processed", type: "uint256" },
      { name: "total", type: "uint256" },
      { name: "lastIndex", type: "uint256" },
      { name: "reservedAssetsAllocated", type: "uint256" },
      { name: "isComplete", type: "bool" },
    ],
  },

  // View functions - Deposit Queue
  {
    type: "function",
    name: "depositRequests",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "requestId", type: "uint256" },
      { name: "depositor", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "targetBatch", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "depositorBatchRequest",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalQueuedAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "reservedRedemptionAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextDepositRequestId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // View functions - Redemption
  {
    type: "function",
    name: "redemptionRequests",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "requestId", type: "uint256" },
      { name: "controller", type: "address" },
      { name: "owner", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "assetsClaimable", type: "uint256" },
      { name: "batchId", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
      { name: "settledAt", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "controllerToRequestId",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getControllerRequestIds",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ name: "requestIds", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "isOperator",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "totalPendingRedeemShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextRedemptionRequestId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRedeemRequest",
    stateMutability: "view",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "controller", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableRedeemRequest",
    stateMutability: "view",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "controller", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },

  // Write functions - Deposit
  {
    type: "function",
    name: "queueDeposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelDeposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "processDepositQueue",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchId", type: "uint256" },
      { name: "startIndex", type: "uint256" },
      { name: "endIndex", type: "uint256" },
    ],
    outputs: [],
  },

  // Write functions - Redemption (ERC-7540)
  {
    type: "function",
    name: "requestRedeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "controller", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelRedeemRequest",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },

  // Write functions - Batch Lifecycle
  {
    type: "function",
    name: "cutoffBatch",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "flattenBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "snapshotHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settleBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settleBatchChunk",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchId", type: "uint256" },
      { name: "startIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resumeSettlement",
    stateMutability: "nonpayable",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "closeBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "batchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reopenBatch",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },

  // Write functions - Admin
  {
    type: "function",
    name: "updateNAV",
    stateMutability: "nonpayable",
    inputs: [{ name: "_nav", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setEmergencyMode",
    stateMutability: "nonpayable",
    inputs: [{ name: "_active", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "maxRescueableUnderlying",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tradingWallet",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "maxAllocatableAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allocateToTradingWallet",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "rescueERC20",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "receiver", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rescueUnderlyingSurplus",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },

  // Events - Deposit
  {
    type: "event",
    name: "DepositQueued",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "targetBatch", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositProcessed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "sharesMinted", type: "uint256", indexed: false },
      { name: "batchId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositCancelled",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },

  // Events - Redemption
  {
    type: "event",
    name: "RedeemRequest",
    inputs: [
      { name: "controller", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "requestId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SharesEscrowed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "controller", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RedeemRequestCancelled",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "controller", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdraw",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "receiver", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },

  // Events - Batch
  {
    type: "event",
    name: "BatchCutoff",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "cutoffTime", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BatchFlattened",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "snapshotHash", type: "bytes32", indexed: true },
      { name: "nav", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BatchSettled",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "totalShares", type: "uint256", indexed: false },
      { name: "totalAssets", type: "uint256", indexed: false },
      { name: "proRataRatio", type: "uint256", indexed: false },
      { name: "processedCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SettlementChunkProcessed",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "startIndex", type: "uint256", indexed: false },
      { name: "endIndex", type: "uint256", indexed: false },
      { name: "processedInChunk", type: "uint256", indexed: false },
      { name: "totalProcessed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BatchClosed",
    inputs: [{ name: "batchId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "BatchReopened",
    inputs: [
      { name: "newBatchId", type: "uint256", indexed: true },
      { name: "startTime", type: "uint256", indexed: false },
      { name: "endTime", type: "uint256", indexed: false },
    ],
  },

  // Events - Admin
  {
    type: "event",
    name: "EmergencyModeSet",
    inputs: [{ name: "active", type: "bool", indexed: false }],
  },
  {
    type: "event",
    name: "NAVUpdated",
    inputs: [
      { name: "nav", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OperatorSet",
    inputs: [
      { name: "controller", type: "address", indexed: true },
      { name: "operator", type: "address", indexed: true },
      { name: "approved", type: "bool", indexed: false },
    ],
  },
] as const;

// ============================================================================
// Types (ClosedBookBatchVault Canonical)
// ============================================================================

/** Batch Status: 0=Open, 1=Cutoff, 2=Flattening, 3=Settling, 4=Settled, 5=Closed, 6=Reopen */
export type BatchStatus =
  | "open"
  | "cutoff"
  | "flattening"
  | "settling"
  | "settled"
  | "closed"
  | "reopen";

/** Redemption Status: 0=Pending, 1=Escrowed, 2=Claimable, 3=Claimed, 4=Cancelled */
export type RedemptionStatus = "pending" | "escrowed" | "claimable" | "claimed" | "cancelled";

/** Deposit Status: 0=Pending, 1=Processed, 2=Cancelled */
export type DepositStatus = "pending" | "processed" | "cancelled";

/** Redemption Request Data (ClosedBookBatchVault) - NO carry fields */
export interface RedemptionRequestData {
  requestId: bigint;
  controller: Address;
  owner: Address;
  shares: bigint;
  assetsClaimable: bigint;
  batchId: bigint;
  status: RedemptionStatus;
  createdAt: bigint;
  settledAt?: bigint;
}

/** Deposit Request Data */
export interface DepositRequestData {
  requestId: bigint;
  depositor: Address;
  assets: bigint;
  targetBatch: bigint;
  createdAt: bigint;
  status: DepositStatus;
}

/** Batch Data (ClosedBookBatchVault) - NO carry/epoch fields */
export interface BatchData {
  batchId: bigint;
  startTime: bigint;
  endTime: bigint;
  cutoffTime: bigint;
  snapshotNAV: bigint;
  lockedClearingPrice: bigint;
  snapshotTimestamp: bigint;
  totalSharesPending: bigint;
  totalAssetsSnapshot: bigint;
  proRataRatio: bigint;
  totalQueuedDeposits: bigint;
  status: BatchStatus;
  isPriceLocked: boolean;
}

/** Settlement Progress Data */
export interface SettlementProgressData {
  processed: bigint;
  total: bigint;
  lastIndex: bigint;
  reservedAssetsAllocated: bigint;
  isComplete: boolean;
}

/** Result of queueDeposit call */
export interface QueueDepositResult {
  success: boolean;
  requestId?: bigint;
  depositor?: Address;
  assets?: bigint;
  targetBatch?: bigint;
  txHash?: Hex;
  error?: string;
}

/** Result of requestRedeem call */
export interface RequestRedeemResult {
  success: boolean;
  requestId?: bigint;
  controller?: Address;
  owner?: Address;
  shares?: bigint;
  batchId?: bigint;
  txHash?: Hex;
  error?: string;
}

/** Result of redeem/withdraw claim call */
export interface RedeemResult {
  success: boolean;
  assets?: bigint;
  shares?: bigint;
  controller?: Address;
  receiver?: Address;
  txHash?: Hex;
  error?: string;
}

/** Result of cancelRedeemRequest call */
export interface CancelResult {
  success: boolean;
  requestId?: bigint;
  cancelledShares?: bigint;
  txHash?: Hex;
  error?: string;
}

/** Vault Contract Configuration */
export interface VaultContractConfig {
  vaultAddress: Address;
  rpcUrl: string;
  chainId?: number;
  chain: Chain;
}

// ============================================================================
// Error Mapping (ClosedBookBatchVault)
// ============================================================================

const CONTRACT_ERRORS: Record<string, string> = {
  // Authorization
  Unauthorized: "Caller is not authorized",
  NotController: "Caller is not the controller or approved operator",
  NotOwner: "Caller is not the owner or approved operator",
  AccessControlUnauthorizedAccount: "Account does not have the required role",

  // State
  InvalidRequest: "Invalid request ID",
  RequestNotPending: "Request is not in pending status",
  RequestNotEscrowed: "Request is not in escrowed status",
  RequestNotClaimable: "Request is not in claimable status",
  InsufficientShares: "Insufficient shares for operation",
  ZeroAmount: "Amount must be greater than zero",
  InvalidAddress: "Invalid address (zero address)",

  // Batch
  BatchNotOpen: "Batch is not open",
  BatchNotCutoff: "Batch is not in cutoff state",
  BatchNotFlattening: "Batch is not in flattening state",
  BatchNotSettling: "Batch is not in settling state",
  BatchNotSettled: "Batch is not settled",
  BatchAlreadySettled: "Batch has already been settled",
  BatchNotClosed: "Batch is not closed",
  NoPendingRequests: "No pending requests in batch",

  // Settlement
  SettlementIncomplete: "Settlement is incomplete",
  SettlementAlreadyComplete: "Settlement is already complete",
  PriceNotLocked: "Price is not locked for batch",

  // Cancellation
  CannotCancelAfterCutoff: "Cannot cancel after batch cutoff",

  // NAV
  NAVStale: "NAV is stale (older than threshold)",

  // Emergency
  EmergencyModeActive: "Emergency mode is active - requests paused",

  // Math
  Overflow: "Arithmetic overflow",
  Underflow: "Arithmetic underflow",
  SafeERC20FailedOperation: "ERC20 operation failed",
  ReentrancyGuardReentrantCall: "Reentrant call detected",
};

function parseContractError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    for (const [errorName, description] of Object.entries(CONTRACT_ERRORS)) {
      if (message.includes(errorName)) {
        return description;
      }
    }
    return message;
  }
  return "Unknown error";
}

// ============================================================================
// Canonical Vault Client (ClosedBookBatchVault)
// ============================================================================

export class CustomVaultClient {
  private publicClient: PublicClient;
  private vaultAddress: Address;
  private chain: Chain;

  constructor(config: VaultContractConfig) {
    this.vaultAddress = config.vaultAddress;
    this.chain = config.chain;
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    }) as PublicClient;
  }

  // Read Operations - Configuration
  async getAsset(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CLOSED_BOOK_BATCH_VAULT_ABI,
      functionName: "asset",
    }) as Promise<Address>;
  }

  async getVaultConfig(): Promise<{
    deployTime: bigint;
    navStalenessThreshold: bigint;
  }> {
    const [deployTime, navStalenessThreshold] = await Promise.all([
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "DEPLOY_TIME",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "NAV_STALENESS_THRESHOLD",
      }) as Promise<bigint>,
    ]);
    return {
      deployTime,
      navStalenessThreshold,
    };
  }

  // Read Operations - NAV
  async getNAVStatus(): Promise<{ currentNAV: bigint; lastNAVUpdate: bigint; isFresh: boolean }> {
    const [currentNAV, lastNAVUpdate, isFresh] = await Promise.all([
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "currentNAV",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "lastNAVUpdate",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "isNAVFresh",
      }) as Promise<boolean>,
    ]);
    return { currentNAV, lastNAVUpdate, isFresh };
  }

  // Read Operations - Deposit Queue
  async getDepositRequest(requestId: bigint): Promise<DepositRequestData | null> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "depositRequests",
        args: [requestId],
      })) as [bigint, Address, bigint, bigint, bigint, number, boolean];
      if (!result[6]) return null;
      const statusMap: DepositStatus[] = ["pending", "processed", "cancelled"];
      return {
        requestId: result[0],
        depositor: result[1],
        assets: result[2],
        targetBatch: result[3],
        createdAt: result[4],
        status: statusMap[result[5]] ?? "pending",
      };
    } catch (error) {
      logger.error("getDepositRequest failed", {
        requestId: requestId.toString(),
        error: parseContractError(error),
      });
      return null;
    }
  }

  async getDepositorBatchRequest(depositor: Address, batchId: bigint): Promise<bigint> {
    try {
      return (await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "depositorBatchRequest",
        args: [depositor, batchId],
      })) as bigint;
    } catch {
      return 0n;
    }
  }

  async getTotalQueuedAssets(): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "totalQueuedAssets",
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }

  async getReservedRedemptionAssets(): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "reservedRedemptionAssets",
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }

  // Read Operations - Redemption
  async getRedemptionRequest(requestId: bigint): Promise<RedemptionRequestData | null> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "redemptionRequests",
        args: [requestId],
      })) as readonly [
        bigint,
        Address,
        Address,
        bigint,
        bigint,
        bigint,
        number,
        bigint,
        bigint,
        boolean,
      ];
      if (!result[9]) return null;
      const statusMap: RedemptionStatus[] = [
        "pending",
        "escrowed",
        "claimable",
        "claimed",
        "cancelled",
      ];
      return {
        requestId: result[0],
        controller: result[1],
        owner: result[2],
        shares: result[3],
        assetsClaimable: result[4],
        batchId: result[5],
        status: statusMap[result[6]] ?? "pending",
        createdAt: result[7],
        settledAt: result[8] || undefined,
      };
    } catch (error) {
      logger.error("getRedemptionRequest failed", {
        requestId: requestId.toString(),
        error: parseContractError(error),
      });
      return null;
    }
  }

  async getControllerRequestId(controller: Address): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "controllerToRequestId",
        args: [controller],
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }

  async getControllerRequestIds(controller: Address): Promise<bigint[]> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "getControllerRequestIds",
        args: [controller],
      }) as Promise<bigint[]>;
    } catch {
      return [];
    }
  }

  async getTotalPendingRedeemShares(): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "totalPendingRedeemShares",
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }

  async getPendingRedeemRequest(requestId: bigint, controller: Address): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "pendingRedeemRequest",
        args: [requestId, controller],
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }

  async getClaimableRedeemRequest(requestId: bigint, controller: Address): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "claimableRedeemRequest",
        args: [requestId, controller],
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }

  // Read Operations - Batch
  async getBatch(batchId: bigint): Promise<BatchData | null> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "batches",
        args: [batchId],
      })) as readonly [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        number,
        boolean,
        boolean,
      ];
      if (!result[13]) return null;
      const statusMap: BatchStatus[] = [
        "open",
        "cutoff",
        "flattening",
        "settling",
        "settled",
        "closed",
        "reopen",
      ];
      return {
        batchId: result[0],
        startTime: result[1],
        endTime: result[2],
        cutoffTime: result[3],
        snapshotNAV: result[4],
        lockedClearingPrice: result[5],
        snapshotTimestamp: result[6],
        totalSharesPending: result[7],
        totalAssetsSnapshot: result[8],
        proRataRatio: result[9],
        totalQueuedDeposits: result[10],
        status: statusMap[result[11]] ?? "open",
        isPriceLocked: result[12],
      };
    } catch (error) {
      logger.error("getBatch failed", {
        batchId: batchId.toString(),
        error: parseContractError(error),
      });
      return null;
    }
  }

  async getCurrentBatchId(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CLOSED_BOOK_BATCH_VAULT_ABI,
      functionName: "currentBatchId",
    }) as Promise<bigint>;
  }

  async getCurrentBatch(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CLOSED_BOOK_BATCH_VAULT_ABI,
      functionName: "currentBatchId",
    }) as Promise<bigint>;
  }

  async getBatchEnd(batchId: bigint): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "getBatchEnd",
        args: [batchId],
      }) as Promise<bigint>;
    } catch (error) {
      logger.error("getBatchEnd failed", {
        batchId: batchId.toString(),
        error: parseContractError(error),
      });
      return 0n;
    }
  }

  async getBatchStatus(batchId: bigint): Promise<BatchStatus> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "getBatchStatus",
        args: [batchId],
      })) as number;
      const statusMap: BatchStatus[] = [
        "open",
        "cutoff",
        "flattening",
        "settling",
        "settled",
        "closed",
        "reopen",
      ];
      return statusMap[result] ?? "open";
    } catch {
      return "open";
    }
  }

  async getSettlementProgress(batchId: bigint): Promise<SettlementProgressData | null> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "getSettlementProgress",
        args: [batchId],
      })) as [bigint, bigint, bigint, bigint, boolean];
      return {
        processed: result[0],
        total: result[1],
        lastIndex: result[2],
        reservedAssetsAllocated: result[3],
        isComplete: result[4],
      };
    } catch (error) {
      logger.error("getSettlementProgress failed", {
        batchId: batchId.toString(),
        error: parseContractError(error),
      });
      return null;
    }
  }

  async getTotalAssets(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CLOSED_BOOK_BATCH_VAULT_ABI,
      functionName: "totalAssets",
    }) as Promise<bigint>;
  }

  async getTotalSupply(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CLOSED_BOOK_BATCH_VAULT_ABI,
      functionName: "totalSupply",
    }) as Promise<bigint>;
  }

  async getEmergencyMode(): Promise<boolean> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "emergencyMode",
      }) as Promise<boolean>;
    } catch {
      return false;
    }
  }

  async getTradingWallet(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CLOSED_BOOK_BATCH_VAULT_ABI,
      functionName: "tradingWallet",
    }) as Promise<Address>;
  }

  async getMaxAllocatableAssets(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CLOSED_BOOK_BATCH_VAULT_ABI,
      functionName: "maxAllocatableAssets",
    }) as Promise<bigint>;
  }

  async isOperator(controller: Address, operator: Address): Promise<boolean> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "isOperator",
        args: [controller, operator],
      }) as Promise<boolean>;
    } catch {
      return false;
    }
  }

  async setOperator(
    walletClient: WalletClient,
    operator: Address,
    approved: boolean,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "setOperator",
        args: [operator, approved],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("setOperator failed", { operator, approved, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  // Write Operations - Deposit Queue Processing
  async processDepositQueue(
    walletClient: WalletClient,
    batchId: bigint,
    startIndex: bigint,
    endIndex: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Processing deposit queue", {
        vaultAddress: this.vaultAddress,
        batchId: batchId.toString(),
        startIndex: startIndex.toString(),
        endIndex: endIndex.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "processDepositQueue",
        args: [batchId, startIndex, endIndex],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Deposit queue processing transaction submitted", {
        txHash: hash,
        batchId: batchId.toString(),
        startIndex: startIndex.toString(),
        endIndex: endIndex.toString(),
      });

      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to process deposit queue", {
        batchId: batchId.toString(),
        startIndex: startIndex.toString(),
        endIndex: endIndex.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  // Write Operations - Batch Lifecycle
  async cutoffBatch(
    walletClient: WalletClient,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Cutting off batch", {
        vaultAddress: this.vaultAddress,
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "cutoffBatch",
        args: [],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Batch cutoff transaction submitted", { txHash: hash });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to cutoff batch", { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  async flattenBatch(
    walletClient: WalletClient,
    snapshotHash: Hex,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Flattening batch", {
        vaultAddress: this.vaultAddress,
        snapshotHash,
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "flattenBatch",
        args: [snapshotHash],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Batch flatten transaction submitted", { txHash: hash });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to flatten batch", { snapshotHash, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  async settleBatch(
    walletClient: WalletClient,
    batchId: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Settling batch", {
        vaultAddress: this.vaultAddress,
        batchId: batchId.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "settleBatch",
        args: [batchId],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Batch settlement transaction submitted", {
        txHash: hash,
        batchId: batchId.toString(),
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to settle batch", {
        batchId: batchId.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async settleBatchChunk(
    walletClient: WalletClient,
    batchId: bigint,
    startIndex: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Settling batch chunk", {
        vaultAddress: this.vaultAddress,
        batchId: batchId.toString(),
        startIndex: startIndex.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "settleBatchChunk",
        args: [batchId, startIndex],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Batch chunk settlement transaction submitted", {
        txHash: hash,
        batchId: batchId.toString(),
        startIndex: startIndex.toString(),
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to settle batch chunk", {
        batchId: batchId.toString(),
        startIndex: startIndex.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async resumeSettlement(
    walletClient: WalletClient,
    batchId: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Resuming settlement", {
        vaultAddress: this.vaultAddress,
        batchId: batchId.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "resumeSettlement",
        args: [batchId],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Resume settlement transaction submitted", {
        txHash: hash,
        batchId: batchId.toString(),
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to resume settlement", {
        batchId: batchId.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async allocateToTradingWallet(
    walletClient: WalletClient,
    amount: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Allocating capital to trading wallet", {
        vaultAddress: this.vaultAddress,
        amount: amount.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "allocateToTradingWallet",
        args: [amount],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Capital allocation transaction submitted", {
        txHash: hash,
        amount: amount.toString(),
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to allocate capital", {
        amount: amount.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async closeBatch(
    walletClient: WalletClient,
    batchId: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Closing batch", {
        vaultAddress: this.vaultAddress,
        batchId: batchId.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "closeBatch",
        args: [batchId],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Batch close transaction submitted", {
        txHash: hash,
        batchId: batchId.toString(),
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to close batch", {
        batchId: batchId.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async reopenBatch(
    walletClient: WalletClient,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Reopening batch", {
        vaultAddress: this.vaultAddress,
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "reopenBatch",
        args: [],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Batch reopen transaction submitted", { txHash: hash });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to reopen batch", { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  // Write Operations - Admin
  async updateNAV(
    walletClient: WalletClient,
    nav: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "updateNAV",
        args: [nav],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to update NAV", {
        nav: nav.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async setEmergencyMode(
    walletClient: WalletClient,
    active: boolean,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: CLOSED_BOOK_BATCH_VAULT_ABI,
        functionName: "setEmergencyMode",
        args: [active],
        chain: walletClient.chain,
        account: walletClient.account!,
      });
      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to set emergency mode", { active, error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Wait for transaction confirmation with retry logic
   */
  async waitForTransaction(
    txHash: Hex,
    confirmations: number = 1,
    timeoutMs: number = 120000,
  ): Promise<{ success: boolean; receipt?: unknown; error?: string }> {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations,
        timeout: timeoutMs,
      });

      logger.info("CustomVaultClient: Transaction confirmed", {
        txHash,
        blockNumber: (receipt as { blockNumber: bigint }).blockNumber.toString(),
        confirmations,
      });

      return { success: true, receipt };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Transaction confirmation failed", {
        txHash,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  // Factory Function
  static create(vaultAddress: Address, rpcUrl: string, chain: Chain): CustomVaultClient {
    return new CustomVaultClient({ vaultAddress, rpcUrl, chain });
  }
}

export function createCustomVaultClient(
  vaultAddress: Address,
  rpcUrl: string,
  chain: Chain,
): CustomVaultClient {
  return CustomVaultClient.create(vaultAddress, rpcUrl, chain);
}

export { parseContractError };

// Re-export types for backward compatibility during migration
// These exports help existing code gradually migrate to batch terminology
export type {
  BatchData as EpochData,
  BatchStatus as EpochStatus,
  RedemptionStatus as RequestStatus,
};
