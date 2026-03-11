/**
 * Custom Vault Contract Client (ERC-7540 Compliant)
 *
 * viem-based client for interacting with the EpochTrancheVault canonical contract.
 * Implements ERC-7540 async redemption with deposit queue, epoch mint, and carry accrual.
 *
 * Canonical Contract: EpochTrancheVault (supersedes WeeklyEpochVault)
 * Breaking Changes from WeeklyEpochVault:
 *   - requestRedeem returns actual requestId (not always 0)
 *   - Added deposit queue support
 *   - Settlement requires freezeEpoch before settleEpoch
 *   - Carry accrual applied on claim
 */

import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { polygon } from "viem/chains";
import { logger } from "../logger.js";

// ============================================================================
// Contract ABI for EpochTrancheVault (Canonical)
// ============================================================================

export const EPOCH_TRANCHE_VAULT_ABI = [
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
    name: "EPOCH_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "MIN_CLAIM_THRESHOLD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "BALANCED_UPFRONT_BPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentEpochId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // View functions - NAV
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
      { name: "targetEpoch", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "processed", type: "bool" },
      { name: "exists", type: "bool" },
    ],
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
      { name: "carryDeducted", type: "uint256" },
      { name: "epochId", type: "uint256" },
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
    name: "totalPendingRedeemShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // View functions - Epoch
  {
    type: "function",
    name: "epochs",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "epochId", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "snapshotNAV", type: "uint256" },
      { name: "snapshotTimestamp", type: "uint256" },
      { name: "totalSharesPending", type: "uint256" },
      { name: "totalAssetsAvailable", type: "uint256" },
      { name: "proRataRatio", type: "uint256" },
      { name: "carryAccrued", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getCurrentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getEpochEnd",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "processDepositQueue",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "uint256" },
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
    outputs: [{ name: "cancelledShares", type: "uint256" }],
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

  // Write functions - Epoch Management
  {
    type: "function",
    name: "freezeEpoch",
    stateMutability: "nonpayable",
    inputs: [{ name: "snapshotHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settleEpoch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochId", type: "uint256" },
      { name: "availableAssets", type: "uint256" },
      { name: "carryAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeEpoch",
    stateMutability: "nonpayable",
    inputs: [{ name: "epochId", type: "uint256" }],
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

  // Events - Deposit
  {
    type: "event",
    name: "DepositQueued",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "targetEpoch", type: "uint256", indexed: false },
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
      { name: "epochId", type: "uint256", indexed: false },
    ],
  },

  // Events - Redemption (ERC-7540)
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

  // Events - Epoch
  {
    type: "event",
    name: "EpochFrozen",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "snapshotHash", type: "bytes32", indexed: true },
      { name: "nav", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EpochSettled",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "totalShares", type: "uint256", indexed: false },
      { name: "totalAssets", type: "uint256", indexed: false },
      { name: "carryAccrued", type: "uint256", indexed: false },
      { name: "proRataRatio", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EpochFinalized",
    inputs: [{ name: "epochId", type: "uint256", indexed: true }],
  },

  // Events - Carry
  {
    type: "event",
    name: "CarryAccrued",
    inputs: [
      { name: "epochId", type: "uint256", indexed: true },
      { name: "totalCarry", type: "uint256", indexed: false },
      { name: "distributionRate", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CarryClaimed",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "controller", type: "address", indexed: true },
      { name: "carryAmount", type: "uint256", indexed: false },
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
    name: "NAVUpdated",
    inputs: [
      { name: "nav", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
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
    name: "isOperator",
    stateMutability: "view",
    inputs: [
      { name: "controller", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

// ============================================================================
// Types (EpochTrancheVault Canonical)
// ============================================================================

/** Request Status: 0=Pending, 1=Frozen, 2=Claimable, 3=Claimed, 4=Cancelled */
export type RequestStatus = "pending" | "frozen" | "claimable" | "claimed" | "cancelled";

/** Epoch Status: 0=Active, 1=Frozen, 2=Settling, 3=Settled, 4=Finalized */
export type EpochStatus = "active" | "frozen" | "settling" | "settled" | "finalized";

/** Redemption Request Data (with requestId) */
export interface RedemptionRequestData {
  requestId: bigint;
  controller: Address;
  owner: Address;
  shares: bigint;
  assetsClaimable: bigint;
  carryDeducted: bigint;
  epochId: bigint;
  status: RequestStatus;
  createdAt: bigint;
  settledAt?: bigint;
}

/** Deposit Request Data */
export interface DepositRequestData {
  requestId: bigint;
  depositor: Address;
  assets: bigint;
  targetEpoch: bigint;
  createdAt: bigint;
  processed: boolean;
}

/** Epoch Data */
export interface EpochData {
  epochId: bigint;
  startTime: bigint;
  endTime: bigint;
  snapshotNAV: bigint;
  snapshotTimestamp: bigint;
  totalSharesPending: bigint;
  totalAssetsAvailable: bigint;
  proRataRatio: bigint;
  carryAccrued: bigint;
  status: EpochStatus;
}

/** Result of queueDeposit call */
export interface QueueDepositResult {
  success: boolean;
  requestId?: bigint;
  depositor?: Address;
  assets?: bigint;
  targetEpoch?: bigint;
  txHash?: Hex;
  error?: string;
}

/** Result of requestRedeem call (now with actual requestId) */
export interface RequestRedeemResult {
  success: boolean;
  requestId?: bigint;
  controller?: Address;
  owner?: Address;
  shares?: bigint;
  epochId?: bigint;
  txHash?: Hex;
  error?: string;
}

/** Result of redeem/withdraw claim call */
export interface RedeemResult {
  success: boolean;
  assets?: bigint;
  shares?: bigint;
  carryDeducted?: bigint;
  controller?: Address;
  receiver?: Address;
  txHash?: Hex;
  error?: string;
}

/** Result of cancelRedeemRequest call (now requires requestId) */
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
}

// ============================================================================
// Error Mapping (EpochTrancheVault)
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
  RequestNotClaimable: "Request is not in claimable status",
  InsufficientShares: "Insufficient shares for operation",
  ZeroAmount: "Amount must be greater than zero",
  InvalidAddress: "Invalid address (zero address)",

  // Epoch
  EpochNotActive: "Epoch is not active",
  EpochNotFrozen: "Epoch is not frozen",
  EpochNotEnded: "Epoch has not ended yet",
  EpochAlreadySettled: "Epoch has already been settled",
  EpochNotSettled: "Epoch has not been settled",
  NoPendingRequests: "No pending requests in epoch",

  // Deposit/Cancellation
  CannotCancelAfterFreeze: "Cannot cancel after epoch freeze",
  BelowClaimThreshold: "Claim amount below minimum threshold",

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
// Canonical Vault Client (EpochTrancheVault)
// ============================================================================

export class CustomVaultClient {
  private publicClient: PublicClient;
  private vaultAddress: Address;

  constructor(config: VaultContractConfig) {
    this.vaultAddress = config.vaultAddress;
    this.publicClient = createPublicClient({
      chain: polygon,
      transport: http(config.rpcUrl),
    }) as PublicClient;
  }

  // Read Operations - Configuration
  async getAsset(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: EPOCH_TRANCHE_VAULT_ABI,
      functionName: "asset",
    }) as Promise<Address>;
  }

  async getVaultConfig(): Promise<{
    epochDuration: bigint;
    deployTime: bigint;
    navStalenessThreshold: bigint;
    minClaimThreshold: bigint;
    balancedUpfrontBps: bigint;
  }> {
    const [
      epochDuration,
      deployTime,
      navStalenessThreshold,
      minClaimThreshold,
      balancedUpfrontBps,
    ] = await Promise.all([
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "EPOCH_DURATION",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "DEPLOY_TIME",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "NAV_STALENESS_THRESHOLD",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "MIN_CLAIM_THRESHOLD",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "BALANCED_UPFRONT_BPS",
      }) as Promise<bigint>,
    ]);
    return {
      epochDuration,
      deployTime,
      navStalenessThreshold,
      minClaimThreshold,
      balancedUpfrontBps,
    };
  }

  // Read Operations - NAV
  async getNAVStatus(): Promise<{ currentNAV: bigint; lastNAVUpdate: bigint; isFresh: boolean }> {
    const [currentNAV, lastNAVUpdate, isFresh] = await Promise.all([
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "currentNAV",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "lastNAVUpdate",
      }) as Promise<bigint>,
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
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
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "depositRequests",
        args: [requestId],
      })) as [bigint, Address, bigint, bigint, bigint, boolean, boolean];
      if (!result[6]) return null;
      return {
        requestId: result[0],
        depositor: result[1],
        assets: result[2],
        targetEpoch: result[3],
        createdAt: result[4],
        processed: result[5],
      };
    } catch (error) {
      logger.error("getDepositRequest failed", {
        requestId: requestId.toString(),
        error: parseContractError(error),
      });
      return null;
    }
  }

  async getTotalQueuedAssets(): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "totalQueuedAssets",
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
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "redemptionRequests",
        args: [requestId],
      })) as [
        bigint,
        Address,
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        number,
        bigint,
        bigint,
        boolean,
      ];
      if (!result[10]) return null;
      const statusMap: RequestStatus[] = ["pending", "frozen", "claimable", "claimed", "cancelled"];
      return {
        requestId: result[0],
        controller: result[1],
        owner: result[2],
        shares: result[3],
        assetsClaimable: result[4],
        carryDeducted: result[5],
        epochId: result[6],
        status: statusMap[result[7]] ?? "pending",
        createdAt: result[8],
        settledAt: result[9] || undefined,
        // Properties already set above
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
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "controllerToRequestId",
        args: [controller],
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }

  // Read Operations - Epoch
  async getEpoch(epochId: bigint): Promise<EpochData | null> {
    try {
      const result = (await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "epochs",
        args: [epochId],
      })) as [
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
      ];
      if (!result[10]) return null;
      const statusMap: EpochStatus[] = ["active", "frozen", "settling", "settled", "finalized"];
      return {
        epochId: result[0],
        startTime: result[1],
        endTime: result[2],
        snapshotNAV: result[3],
        snapshotTimestamp: result[4],
        totalSharesPending: result[5],
        totalAssetsAvailable: result[6],
        proRataRatio: result[7],
        carryAccrued: result[8],
        status: statusMap[result[9]] ?? "active",
      };
    } catch (error) {
      logger.error("getEpoch failed", {
        epochId: epochId.toString(),
        error: parseContractError(error),
      });
      return null;
    }
  }



  async getCurrentEpochId(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: EPOCH_TRANCHE_VAULT_ABI,
      functionName: "currentEpochId",
    }) as Promise<bigint>;
  }

  async getCurrentEpoch(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: EPOCH_TRANCHE_VAULT_ABI,
      functionName: "getCurrentEpoch",
    }) as Promise<bigint>;
  }

  async getEpochEnd(epochId: bigint): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "getEpochEnd",
        args: [epochId],
      }) as Promise<bigint>;
    } catch (error) {
      logger.error("getEpochEnd failed", {
        epochId: epochId.toString(),
        error: parseContractError(error),
      });
      return 0n;
    }
  }

  async getEmergencyMode(): Promise<boolean> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "emergencyMode",
      }) as Promise<boolean>;
    } catch {
      return false;
    }
  }

  async isOperator(controller: Address, operator: Address): Promise<boolean> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
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
        abi: EPOCH_TRANCHE_VAULT_ABI,
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

  async getTotalPendingRedeemShares(): Promise<bigint> {
    try {
      return this.publicClient.readContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "totalPendingRedeemShares",
      }) as Promise<bigint>;
    } catch {
      return 0n;
    }
  }
  async canSettleEpoch(epochId: bigint): Promise<boolean> {
    const epoch = await this.getEpoch(epochId);
    if (!epoch) return false;
    const now = BigInt(Math.floor(Date.now() / 1000));
    return epoch.status === "frozen" && now >= epoch.endTime;
  }

  /**
   * Freeze an epoch in preparation for settlement
   * Requires settler role
   */
  async freezeEpoch(
    walletClient: WalletClient,
    epochId: bigint,
    snapshotHash: Hex,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Freezing epoch", {
        vaultAddress: this.vaultAddress,
        epochId: epochId.toString(),
        snapshotHash,
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "freezeEpoch",
        args: [snapshotHash],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Epoch freeze transaction submitted", {
        txHash: hash,
        epochId: epochId.toString(),
      });

      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to freeze epoch", {
        epochId: epochId.toString(),
        snapshotHash,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Settle an epoch after it has been frozen
   * Requires settler role
   */
  async settleEpoch(
    walletClient: WalletClient,
    epochId: bigint,
    availableAssets: bigint,
    carryAmount: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Settling epoch", {
        vaultAddress: this.vaultAddress,
        epochId: epochId.toString(),
        availableAssets: availableAssets.toString(),
        carryAmount: carryAmount.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "settleEpoch",
        args: [epochId, availableAssets, carryAmount],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Epoch settlement transaction submitted", {
        txHash: hash,
        epochId: epochId.toString(),
      });

      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to settle epoch", {
        epochId: epochId.toString(),
        availableAssets: availableAssets.toString(),
        carryAmount: carryAmount.toString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Finalize an epoch after settlement
   * Requires settler role
   */
  async finalizeEpoch(
    walletClient: WalletClient,
    epochId: bigint,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    try {
      logger.info("CustomVaultClient: Finalizing epoch", {
        vaultAddress: this.vaultAddress,
        epochId: epochId.toString(),
      });

      const hash = await walletClient.writeContract({
        address: this.vaultAddress,
        abi: EPOCH_TRANCHE_VAULT_ABI,
        functionName: "finalizeEpoch",
        args: [epochId],
        chain: walletClient.chain,
        account: walletClient.account!,
      });

      logger.info("CustomVaultClient: Epoch finalize transaction submitted", {
        txHash: hash,
        epochId: epochId.toString(),
      });

      return { success: true, txHash: hash };
    } catch (error) {
      const errorMsg = parseContractError(error);
      logger.error("CustomVaultClient: Failed to finalize epoch", {
        epochId: epochId.toString(),
        error: errorMsg,
      });
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
  static create(vaultAddress: Address, rpcUrl: string): CustomVaultClient {
    return new CustomVaultClient({ vaultAddress, rpcUrl });
  }
}



export function createCustomVaultClient(vaultAddress: Address, rpcUrl: string): CustomVaultClient {
  return CustomVaultClient.create(vaultAddress, rpcUrl);
}

export { parseContractError };
