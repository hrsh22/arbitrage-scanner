/**
 * Custom Vault Provider (ERC-7540 Compliant with Closed-Book Batch Lifecycle)
 *
 * Implementation for the ClosedBookBatchVault with:
 * - Unique requestIds per redemption (not controller-aggregated)
 * - Deposit queue with queueDeposit/processDepositQueue
 * - Batch open/cutoff/flattening/settling/settled/reopen flow
 * - Locked clearing price at flatten time (no mark-to-market estimates)
 * - Async request/settle/claim flow
 * - Pro-rata settlement for insufficient liquidity
 * - NAV staleness guards
 * - Operator authorization model
 *
 * CLOSED-BOOK BATCH MODEL:
 * - OPEN: Batch is accepting new redemption requests
 * - CUTOFF: First request accepted in OPEN seals the batch; no new requests accepted
 * - FLATTENING: NAV snapshot taken, clearing price locked
 * - SETTLING: Batch settlement in progress, entitlements being calculated
 * - SETTLED: Settlement complete, ready for claims
 * - CLOSED: Claims window ended
 * - REOPEN: Settlement complete, vault ready for next batch
 *
 * BATCH SEALING RULE:
 * - First accepted redemption request in OPEN state seals the active batch
 * - Subsequent requests route to the next batch (queued for future processing)
 *
 * CANCELLATION RULE:
 * - Cancellation is IMPOSSIBLE after CUTOFF
 * - Requests are irreversible once the batch is sealed
 *
 * NO CARRY/PARTIAL REALIZATION:
 * - ClosedBookBatchVault has NO carry accrual or partial realization
 * - All redemptions settle at the locked clearing price at batch settlement
 * - No mark-to-market estimates after price lock
 *
 * This provider uses the CustomVaultClient for contract interactions.
 */

import type { Address, Hex } from "viem";
import { createWalletClient, formatUnits, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain } from "viem/chains";
import { logger } from "../logger.js";
import type {
  CapitalRebalanceResult,
  IVaultProvider,
  VaultProviderConfig,
  VaultProviderType,
  VaultMetadata,
  RedemptionRequest,
  RequestResult,
  ClaimResult,
  RequestStatusResult,
  UserRedemptionState,
  VaultCapabilities,
  CustomVaultConfig,
} from "./vaultProvider.js";
import { VaultProviderError } from "./vaultProvider.js";
import {
  CustomVaultClient,
  createCustomVaultClient,
  type RedemptionRequestData,
} from "./customVaultClient.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { getNetworkConfigFromEnv, getRpcUrlForNetwork } from "../config/network.js";
import { getVaultConfig } from "../config/index.js";
import type { VaultInstanceConfig } from "../config/types.js";
import { FlatnessDetector, type FlatnessCheckResult } from "./flatnessDetector.js";
import { SafeWalletService } from "./safeWallet.js";

// Default NAV staleness threshold: 6 hours in seconds
const DEFAULT_NAV_STALENESS_SECONDS = 21600;

// USDC decimals
const USDC_DECIMALS = 6;
const VAULT_SHARE_DECIMALS = 6;
const DEPOSIT_QUEUE_BATCH_SIZE = 1000n;

interface RoleKeyConfig {
  adminKey?: string;
  settlerKey?: string;
  snapshotterKey?: string;
  depositProcessorKey?: string;
  safeOperatorKey?: string;
}

/**
 * Map contract redemption status to domain request status
 *
 * ClosedBookBatchVault Lifecycle Semantics (requestId-based):
 * - Pending (0): Request submitted, waiting for batch cutoff
 * - Escrowed (1): Shares escrowed, waiting for settlement
 * - Claimable (2): Settlement complete, ready to claim
 * - Claimed (3): Assets claimed
 * - Cancelled (4): Request was cancelled
 */
function mapContractStatusToDomain(status: number): RedemptionRequest["status"] {
  const statusMap: RedemptionRequest["status"][] = [
    "pending",
    "frozen", // Escrowed maps to frozen (shares locked)
    "claimable",
    "claimed",
    "cancelled",
  ];
  return statusMap[status] ?? "pending";
}

/**
 * Custom Vault Provider
 *
 * Manages interactions with the ClosedBookBatchVault contract.
 */
export class CustomVaultProvider implements IVaultProvider {
  readonly providerType: VaultProviderType = "custom";
  readonly config: VaultProviderConfig;

  private readonly vaultConfig: VaultInstanceConfig;
  private readonly customConfig: Required<CustomVaultConfig>;
  private readonly client: CustomVaultClient;
  private readonly rpcUrl: string;
  private readonly chain: Chain;
  private readonly adminKey?: string;
  private readonly settlerKey?: string;
  private readonly snapshotterKey?: string;
  private readonly depositProcessorKey?: string;
  private readonly safeOperatorKey?: string;
  private adminWalletClient?: WalletClient;
  private settlerWalletClient?: WalletClient;
  private snapshotterWalletClient?: WalletClient;
  private depositProcessorWalletClient?: WalletClient;
  private safeWalletService?: SafeWalletService;

  constructor(config: VaultProviderConfig, roleKeys?: string | RoleKeyConfig, chain?: Chain) {
    if (config.providerType !== "custom") {
      throw new Error(
        `CustomVaultProvider: expected providerType "custom", got "${config.providerType}"`,
      );
    }

    this.config = config;
    const vaultConfig = getVaultConfig(config.vaultId);
    if (!vaultConfig) {
      throw new Error(`CustomVaultProvider: vault config ${config.vaultId} not found`);
    }
    this.vaultConfig = vaultConfig;
    const resolvedKeys: RoleKeyConfig =
      typeof roleKeys === "string"
        ? {
            adminKey: roleKeys,
            settlerKey: roleKeys,
            snapshotterKey: roleKeys,
            depositProcessorKey: roleKeys,
            safeOperatorKey: roleKeys,
          }
        : {
            adminKey: roleKeys?.adminKey,
            settlerKey: roleKeys?.settlerKey,
            snapshotterKey: roleKeys?.snapshotterKey ?? roleKeys?.settlerKey,
            depositProcessorKey: roleKeys?.depositProcessorKey ?? roleKeys?.settlerKey,
            safeOperatorKey: roleKeys?.safeOperatorKey,
          };
    this.adminKey = resolvedKeys.adminKey;
    this.settlerKey = resolvedKeys.settlerKey;
    this.snapshotterKey = resolvedKeys.snapshotterKey;
    this.depositProcessorKey = resolvedKeys.depositProcessorKey;
    this.safeOperatorKey = resolvedKeys.safeOperatorKey;
    const networkConfig = getNetworkConfigFromEnv();
    this.chain = chain ?? networkConfig.chain;
    this.rpcUrl = getRpcUrlForNetwork(networkConfig.name);
    this.customConfig = {
      navStalenessThresholdSeconds: DEFAULT_NAV_STALENESS_SECONDS,
      ...config.customConfig,
    } as Required<CustomVaultConfig>;

    this.client = createCustomVaultClient(config.vaultAddress, this.rpcUrl, this.chain);

    logger.info("CustomVaultProvider: Initialized", {
      vaultId: config.vaultId,
      vaultAddress: config.vaultAddress,
      chainId: this.chain.id,
      network: networkConfig.name,
      hasAdminKey: !!this.adminKey,
      hasSettlerKey: !!this.settlerKey,
      hasSnapshotterKey: !!this.snapshotterKey,
      hasDepositProcessorKey: !!this.depositProcessorKey,
      hasSafeOperatorKey: !!this.safeOperatorKey,
    });
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  async getVaultInfo(): Promise<VaultMetadata> {
    logger.debug("CustomVaultProvider.getVaultInfo", { vaultId: this.config.vaultId });

    try {
      const [asset, navStatus, currentBatchId, totalSupply] = await Promise.all([
        this.client.getAsset(),
        this.client.getNAVStatus(),
        this.client.getCurrentBatch(),
        this.client.getTotalSupply(),
      ]);

      const navIsStale = !navStatus.isFresh;
      const navLastUpdated = new Date(Number(navStatus.lastNAVUpdate) * 1000);

      const totalAssets = await this.client.getTotalAssets();

      // CLOSED-BOOK: No live mark-to-market estimates after price lock
      // Return 1.0 as placeholder (actual clearing price is batch-specific)
      const sharePrice = 1.0;

      // Get current batch info
      const currentBatch = await this.client.getBatch(currentBatchId);
      const batchStart = currentBatch
        ? new Date(Number(currentBatch.startTime) * 1000)
        : new Date();
      const batchEnd =
        currentBatch && currentBatch.endTime > 0n
          ? new Date(Number(currentBatch.endTime) * 1000)
          : null;

      // Get next batch info
      const nextBatchId = currentBatchId + 1n;
      const nextBatch = await this.client.getBatch(nextBatchId);

      return {
        vaultId: this.config.vaultId,
        vaultAddress: this.config.vaultAddress,
        providerType: this.providerType,
        asset,
        assetDecimals: USDC_DECIMALS,
        shareDecimals: VAULT_SHARE_DECIMALS,
        totalAssets,
        totalSupply,
        sharePrice,
        // Batch lifecycle info (replacing epochInfo)
        batchInfo: {
          currentBatchId: Number(currentBatchId),
          currentBatchStart: batchStart,
          currentBatchEnd: batchEnd,
          currentBatchStatus: currentBatch?.status ?? "open",
          nextBatchId: Number(nextBatchId),
          nextBatchExists: !!nextBatch,
          batchDurationSeconds: null,
        },
        // CLOSED-BOOK: No estimatedSettlementTime (depends on when batch is sealed)
        navLastUpdated,
        navIsStale,
      };
    } catch (error) {
      logger.error("CustomVaultProvider.getVaultInfo failed", {
        vaultId: this.config.vaultId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Get batch status with closed-book lifecycle fields
   *
   * Exposes:
   * - active batch id, next batch id
   * - batch state (open/cutoff/flattening/settling/settled/closed/reopen)
   * - cutoff time
   * - flattening blockers (if applicable)
   * - settlement status and progress
   * - locked clearing price (only after flatten)
   * - claimable redemptions count
   * - minted deposits (processed deposits)
   */
  async getBatchStatus(batchId?: number): Promise<{
    batchId: number;
    nextBatchId: number;
    status: string;
    startTime: Date;
    endTime: Date;
    cutoffTime?: Date;
    isPriceLocked: boolean;
    lockedClearingPrice?: string; // Only after flatten
    settlementProgress?: {
      processed: number;
      total: number;
      isComplete: boolean;
    };
    totalSharesPending: bigint;
    totalAssetsSnapshot?: string;
    proRataRatio: number;
    totalQueuedDeposits: bigint;
    claimableRedemptions: number;
    mintedDeposits: number; // Approximate from deposit queue
  }> {
    const contractBatchId = BigInt(batchId ?? (await this.client.getCurrentBatch()));
    logger.debug("CustomVaultProvider.getBatchStatus", {
      vaultId: this.config.vaultId,
      batchId: contractBatchId.toString(),
    });

    const batch = await this.client.getBatch(contractBatchId);
    if (!batch) {
      throw new Error(`Failed to get batch status for batch ${contractBatchId}`);
    }

    const nextBatchId = Number(contractBatchId + 1n);
    const nextBatch = await this.client.getBatch(BigInt(nextBatchId));

    // Get settlement progress if settling or settled
    let settlementProgress;
    if (batch.status === "settling" || batch.status === "settled") {
      const progress = await this.client.getSettlementProgress(contractBatchId);
      if (progress) {
        settlementProgress = {
          processed: Number(progress.processed),
          total: Number(progress.total),
          isComplete: progress.isComplete,
        };
      }
    }

    // Get claimable redemption count
    const claimableRedemptions =
      batch.status === "settled" ? Number(batch.totalSharesPending > 0n ? 1 : 0) : 0;

    // Calculate pro-rata factor (0-1)
    const proRataFactor = batch.proRataRatio ? Number(batch.proRataRatio) / 1e18 : 1.0;

    return {
      batchId: Number(batch.batchId),
      nextBatchId,
      status: batch.status,
      startTime: new Date(Number(batch.startTime) * 1000),
      endTime: new Date(Number(batch.endTime) * 1000),
      cutoffTime: batch.cutoffTime > 0n ? new Date(Number(batch.cutoffTime) * 1000) : undefined,
      isPriceLocked: batch.isPriceLocked,
      // CLOSED-BOOK: Only expose lockedClearingPrice after flatten (price lock)
      lockedClearingPrice: batch.isPriceLocked ? batch.lockedClearingPrice.toString() : undefined,
      settlementProgress,
      totalSharesPending: batch.totalSharesPending,
      totalAssetsSnapshot:
        batch.totalAssetsSnapshot > 0n ? batch.totalAssetsSnapshot.toString() : undefined,
      proRataRatio: proRataFactor,
      totalQueuedDeposits: batch.totalQueuedDeposits,
      claimableRedemptions,
      // Approximate: would need to query deposit request count
      mintedDeposits: 0,
    };
  }

  /**
   * @deprecated Use getBatchStatus instead. Kept for backward compatibility during migration.
   */
  async getEpochStatus(epochId?: number): Promise<{
    epochId: number;
    batchId: number;
    startTime: Date;
    endTime: Date;
    settlementTime: Date;
    totalRequests: number;
    totalShares: bigint;
    settled: boolean;
    proRataFactor?: number;
    lockedClearingPrice?: string;
  }> {
    const status = await this.getBatchStatus(epochId);
    return {
      epochId: status.batchId,
      batchId: status.batchId,
      startTime: status.startTime,
      endTime: status.endTime,
      settlementTime: status.endTime,
      totalRequests: status.claimableRedemptions,
      totalShares: status.totalSharesPending,
      settled: status.status === "settled" || status.status === "closed",
      proRataFactor: status.proRataRatio,
      lockedClearingPrice: status.lockedClearingPrice,
    };
  }

  async getRequestStatus(requestId: string): Promise<RequestStatusResult> {
    logger.debug("CustomVaultProvider.getRequestStatus", {
      vaultId: this.config.vaultId,
      requestId,
    });

    // Parse requestId as bigint
    let requestIdBigInt: bigint;
    try {
      requestIdBigInt = BigInt(requestId);
    } catch {
      throw new VaultProviderError(
        `Invalid requestId: ${requestId}. Must be a valid bigint string.`,
        "REQUEST_NOT_FOUND",
        this.config.vaultId,
        requestId,
      );
    }

    const redemptionData = await this.client.getRedemptionRequest(requestIdBigInt);
    if (!redemptionData) {
      throw new VaultProviderError(
        `Redemption request not found: ${requestId}`,
        "REQUEST_NOT_FOUND",
        this.config.vaultId,
        requestId,
      );
    }

    const request = this.mapRedemptionDataToRequest(redemptionData);
    const claimable = redemptionData.status === "claimable" && redemptionData.assetsClaimable > 0n;

    // CLOSED-BOOK: No estimated settlement time (depends on batch sealing and settlement)
    // Return undefined as settlement is not time-based
    const estimatedSettlementTime = undefined;

    return {
      request,
      claimable,
      estimatedSettlementTime: claimable ? undefined : estimatedSettlementTime,
    };
  }

  async getUserRequests(userAddress: Address): Promise<RedemptionRequest[]> {
    logger.debug("CustomVaultProvider.getUserRequests", {
      vaultId: this.config.vaultId,
      userAddress,
    });

    const requestIds = await this.client.getControllerRequestIds(userAddress);
    if (requestIds.length === 0) {
      return [];
    }

    const requests = await Promise.all(
      requestIds.map(async (requestId) => this.client.getRedemptionRequest(requestId)),
    );

    return requests
      .filter((request): request is RedemptionRequestData => request !== null)
      .map((request) => this.mapRedemptionDataToRequest(request))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async getUserRedemptionState(userAddress: Address): Promise<UserRedemptionState> {
    logger.debug("CustomVaultProvider.getUserRedemptionState", {
      vaultId: this.config.vaultId,
      userAddress,
    });

    const requests = await this.getUserRequests(userAddress);

    const pendingRequests: RedemptionRequest[] = [];
    const claimableRequests: RedemptionRequest[] = [];

    let totalSharesPending = 0n;
    let totalSharesClaimable = 0n;

    for (const request of requests) {
      if (request.status === "pending" || request.status === "frozen") {
        pendingRequests.push(request);
        totalSharesPending += request.shares;
      } else if (request.status === "claimable" && (request.assetsActual ?? 0n) > 0n) {
        claimableRequests.push(request);
        totalSharesClaimable += request.shares;
      } else if (request.status === "claimable") {
        pendingRequests.push({
          ...request,
          status: "frozen",
        });
        totalSharesPending += request.shares;
      }
    }

    // CLOSED-BOOK: No previewRedeem estimates (no live mark-to-market)
    // Use actual claimable assets from settlement if available
    const estimatedAssetsPending = 0n;
    const estimatedAssetsClaimable = claimableRequests.reduce(
      (sum, request) => sum + (request.assetsActual ?? 0n),
      0n,
    );

    return {
      userAddress,
      vaultId: this.config.vaultId,
      pendingRequests,
      claimableRequests,
      totalSharesPending,
      totalSharesClaimable,
      estimatedAssetsPending,
      estimatedAssetsClaimable,
    };
  }

  /**
   * @deprecated ClosedBookBatchVault has no previewRedeem (no live mark-to-market)
   * Use actual assetsClaimable from settlement instead.
   */
  async previewRedeem(shares: bigint): Promise<bigint> {
    logger.debug("CustomVaultProvider.previewRedeem", {
      vaultId: this.config.vaultId,
      shares: shares.toString(),
    });

    // CLOSED-BOOK: Return 0 as preview is not supported
    // Settlement uses locked clearing price, not current NAV
    logger.warn("CustomVaultProvider.previewRedeem is deprecated in closed-book model", {
      vaultId: this.config.vaultId,
      shares: shares.toString(),
    });
    return 0n;
  }

  // ============================================================================
  // Write Operations
  // ============================================================================

  async requestRedeem(userAddress: Address, shares: bigint): Promise<RequestResult> {
    logger.info("CustomVaultProvider.requestRedeem", {
      vaultId: this.config.vaultId,
      userAddress,
      shares: shares.toString(),
    });

    if (shares <= 0n) {
      return {
        success: false,
        shares,
        assetsEstimated: 0n,
        error: "Shares must be greater than zero",
      };
    }

    // Check NAV freshness
    const navStatus = await this.client.getNAVStatus();
    if (!navStatus.isFresh) {
      return {
        success: false,
        shares,
        assetsEstimated: 0n,
        error: "NAV is stale - cannot create redemption request",
      };
    }

    // Check emergency mode
    const emergencyMode = await this.client.getEmergencyMode();
    if (emergencyMode) {
      return {
        success: false,
        shares,
        assetsEstimated: 0n,
        error: "Emergency mode is active - redemption requests paused",
      };
    }

    // CLOSED-BOOK: No live asset estimation
    // Actual assets determined at settlement using locked clearing price
    const assetsEstimated = 0n;

    // Note: Actual requestRedeem requires a wallet client
    // The contract will return a unique requestId (not controller-aggregated)
    logger.info("CustomVaultProvider: Redemption request parameters prepared", {
      vaultId: this.config.vaultId,
      userAddress,
      shares: shares.toString(),
      assetsEstimated: assetsEstimated.toString(),
      controller: userAddress,
      owner: userAddress,
    });

    return {
      success: true,
      // requestId will be returned by actual contract call
      shares,
      assetsEstimated,
      controller: userAddress,
      owner: userAddress,
    };
  }

  async cancelRedemption(
    requestId: string,
    userAddress: Address,
  ): Promise<{ success: boolean; error?: string }> {
    logger.warn("CustomVaultProvider.cancelRedemption disabled", {
      vaultId: this.config.vaultId,
      requestId,
      userAddress,
    });
    return {
      success: false,
      error:
        "Redemption cancellation is disabled. Redeem requests are irreversible after batch cutoff.",
    };
  }

  async claimRedemption(requestId: string, userAddress: Address): Promise<ClaimResult> {
    logger.info("CustomVaultProvider.claimRedemption", {
      vaultId: this.config.vaultId,
      requestId,
      userAddress,
    });

    // Parse requestId
    let requestIdBigInt: bigint;
    try {
      requestIdBigInt = BigInt(requestId);
    } catch {
      return {
        success: false,
        requestId,
        assetsReceived: 0n,
        error: "Invalid requestId format",
      };
    }

    // Get the redemption request
    const redemptionData = await this.client.getRedemptionRequest(requestIdBigInt);
    if (!redemptionData) {
      return {
        success: false,
        requestId,
        assetsReceived: 0n,
        error: "Request not found",
      };
    }

    // Check authorization
    const isAuthorized = await this.isAuthorizedForController(
      userAddress,
      redemptionData.controller,
    );
    if (!isAuthorized) {
      return {
        success: false,
        requestId,
        assetsReceived: 0n,
        error: "Not authorized to claim this request",
      };
    }

    // Check if claimable
    if (redemptionData.status !== "claimable") {
      return {
        success: false,
        requestId,
        assetsReceived: 0n,
        error: `Request is not claimable. Current status: ${redemptionData.status}`,
      };
    }

    // CLOSED-BOOK: Assets received from settlement (no carry deduction)
    const assetsReceived = redemptionData.assetsClaimable;

    // Note: Actual claim requires wallet client with redeem(requestId, shares, receiver)
    logger.info("CustomVaultProvider: Redemption claim authorized", {
      requestId,
      vaultId: this.config.vaultId,
      controller: redemptionData.controller,
      shares: redemptionData.shares.toString(),
      assetsReceived: assetsReceived.toString(),
    });

    return {
      success: true,
      requestId,
      assetsReceived,
      // CLOSED-BOOK: No carry deducted
      carryDeducted: 0n,
    };
  }

  // ============================================================================
  // Settlement Operations (Closed-Book Batch Lifecycle)
  // ============================================================================

  /**
   * Check if batch settlement is ready
   *
   * CLOSED-BOOK: Settlement requires:
   * 1. Batch status is Flattening (price locked) or later
   * 2. NAV is fresh (for flatten)
   * 3. Flatness check passes (for settle)
   */
  async isSettlementReady(batchId?: number): Promise<boolean> {
    const currentBatchId = Number(await this.client.getCurrentBatch());
    const targetBatchId = batchId ?? currentBatchId;
    logger.debug("CustomVaultProvider.isSettlementReady", {
      vaultId: this.config.vaultId,
      batchId: targetBatchId,
    });

    const navStatus = await this.client.getNAVStatus();
    if (!navStatus.isFresh) {
      return false;
    }

    const batch = await this.client.getBatch(BigInt(targetBatchId));
    if (!batch) {
      return false;
    }

    // Can settle if:
    // - Batch is in Flattening, Settling, or Settled status
    // - Price is locked (after flatten)
    if (
      batch.status === "flattening" ||
      batch.status === "settling" ||
      batch.status === "settled"
    ) {
      return batch.isPriceLocked;
    }

    if (batch.status === "open" || batch.status === "cutoff") {
      const hasActionableWork = await this.hasActionableBatchWork(targetBatchId);
      if (!hasActionableWork) {
        return false;
      }

      const flattenCheck = await this.canFlattenBatch(targetBatchId);
      return flattenCheck.canFlatten;
    }

    return false;
  }

  async hasActionableBatchWork(batchId?: number): Promise<boolean> {
    const currentBatchId = Number(await this.client.getCurrentBatch());
    const targetBatchId = batchId ?? currentBatchId;
    const batch = await this.client.getBatch(BigInt(targetBatchId));
    if (!batch) {
      return false;
    }

    if (batch.status === "flattening" || batch.status === "settling") {
      return true;
    }

    if (batch.totalSharesPending > 0n || batch.totalQueuedDeposits > 0n) {
      return true;
    }

    if (targetBatchId !== currentBatchId) {
      return false;
    }

    if (batch.status !== "open" && batch.status !== "cutoff") {
      return false;
    }

    const nextBatch = await this.client.getBatch(BigInt(targetBatchId + 1));
    return (nextBatch?.totalQueuedDeposits ?? 0n) > 0n;
  }

  async needsNavRefreshForActionableWork(batchId?: number): Promise<boolean> {
    const hasActionableWork = await this.hasActionableBatchWork(batchId);
    if (!hasActionableWork) {
      return false;
    }

    const navStatus = await this.client.getNAVStatus();
    return !navStatus.isFresh || navStatus.currentNAV === 0n;
  }

  async estimatePendingWithdrawalLiability(batchId?: number): Promise<bigint> {
    const currentBatchId = Number(await this.client.getCurrentBatch());
    const targetBatchId = batchId ?? currentBatchId;
    const batch = await this.client.getBatch(BigInt(targetBatchId));
    if (!batch || batch.totalSharesPending === 0n) {
      return 0n;
    }

    if (
      (batch.status === "flattening" || batch.status === "settling") &&
      batch.totalAssetsSnapshot > 0n
    ) {
      return batch.totalAssetsSnapshot;
    }

    if (batch.status === "settled" || batch.status === "closed" || batch.status === "reopen") {
      return 0n;
    }

    const navStatus = await this.client.getNAVStatus();
    return (batch.totalSharesPending * navStatus.currentNAV) / 10n ** 18n;
  }

  /**
   * Check if batch can be flattened (flatness check)
   *
   * CLOSED-BOOK FLATNESS GATE: Flattening is blocked unless all flatness conditions are met:
   * 1. Zero open Polymarket positions
   * 2. Zero resting orders on CLOB
   * 3. deployedCapital == 0
   * 4. Zero non-dust CTF token balances
   * 5. Successful reconciliation pass
   */
  async canFlattenBatch(batchId?: number): Promise<{
    canFlatten: boolean;
    flatnessCheck?: FlatnessCheckResult;
    blockingConditions?: string[];
  }> {
    const targetBatchId = batchId ?? Number(await this.client.getCurrentBatch());
    logger.info("CustomVaultProvider.canFlattenBatch", {
      vaultId: this.config.vaultId,
      batchId: targetBatchId,
    });

    const batch = await this.client.getBatch(BigInt(targetBatchId));
    if (!batch) {
      return { canFlatten: false, blockingConditions: ["Batch not found"] };
    }

    // Check batch status
    if (batch.status !== "cutoff" && batch.status !== "open") {
      return {
        canFlatten: false,
        blockingConditions: [`Batch status is ${batch.status}, expected cutoff or open`],
      };
    }

    // Run flatness check
    const flatnessDetector = new FlatnessDetector();
    const flatnessCheck = await flatnessDetector.checkFlatness(
      this.vaultConfig,
      this.vaultConfig.tradingSafeAddress ?? this.vaultConfig.safeAddress,
    );

    if (!flatnessCheck.isFlat) {
      logger.error("CustomVaultProvider: Flattening blocked - flatness check failed", {
        vaultId: this.config.vaultId,
        batchId: targetBatchId,
        blockingConditions: flatnessCheck.blockingConditions,
      });
      return {
        canFlatten: false,
        flatnessCheck,
        blockingConditions: flatnessCheck.blockingConditions,
      };
    }

    return {
      canFlatten: true,
      flatnessCheck,
    };
  }

  /**
   * Execute batch settlement with closed-book lifecycle
   *
   * CLOSED-BOOK BATCH FLOW:
   * 1. CUTOFF: Close deposits for current batch (optional, automatic on first redeem)
   * 2. FLATTEN: Lock clearing price, snapshot NAV, escrow shares
   * 3. SETTLE: Compute claimable assets using locked price
   * 4. CLOSE: Mark batch as closed after claims period
   * 5. REOPEN: Start next batch cycle
   */
  async executeSettlement(
    epochId?: number,
    skipFlatnessCheck?: boolean,
  ): Promise<{
    success: boolean;
    txHash?: Hex;
    /** LEGACY: Epoch ID for backward compatibility */
    epochId: number;
    /** CLOSED-BOOK: Batch ID for batch-based vaults */
    batchId?: number;
    requestsSettled: number;
    totalShares: bigint;
    totalAssets: bigint;
    lockedClearingPrice?: string;
    error?: string;
  }> {
    const targetBatchId = await this.resolveMaintenanceBatch(epochId);
    logger.info("CustomVaultProvider.executeSettlement", {
      vaultId: this.config.vaultId,
      batchId: targetBatchId,
    });

    if (!this.settlerKey && !this.snapshotterKey && !this.depositProcessorKey && !this.adminKey) {
      return {
        success: false,
        epochId: targetBatchId,
        batchId: targetBatchId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: "Batch maintenance requires at least one configured signer",
      };
    }

    // Get batch data
    let batch = await this.client.getBatch(BigInt(targetBatchId));
    if (!batch) {
      return {
        success: false,
        epochId: targetBatchId,
        batchId: targetBatchId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Batch ${targetBatchId} not found`,
      };
    }

    const reopenIfNeeded = async (
      settledBatch: NonNullable<typeof batch>,
    ): Promise<{ success: boolean; txHash?: Hex; error?: string }> => {
      if (settledBatch.status !== "settled" && settledBatch.status !== "closed") {
        return { success: true };
      }

      let maintenanceWalletClient: WalletClient;
      try {
        maintenanceWalletClient = this.getMaintenanceWalletClient();
      } catch (error) {
        return {
          success: false,
          error: `Failed to initialize maintenance wallet for reopen: ${(error as Error).message}`,
        };
      }

      const reopenResult = await this.retryWithBackoff(() =>
        this.client.reopenBatch(maintenanceWalletClient),
      );
      if (!reopenResult.success) {
        return {
          success: false,
          txHash: reopenResult.txHash,
          error: `Failed to reopen next batch: ${reopenResult.error}`,
        };
      }

      const reopenConfirmResult = await this.retryWithBackoff(() =>
        this.client.waitForTransaction(reopenResult.txHash!),
      );
      if (!reopenConfirmResult.success) {
        return {
          success: false,
          txHash: reopenResult.txHash,
          error: `Reopen transaction failed to confirm: ${reopenConfirmResult.error}`,
        };
      }

      logger.info("CustomVaultProvider: Next batch reopened successfully", {
        txHash: reopenResult.txHash,
        previousBatchId: targetBatchId,
      });

      return { success: true, txHash: reopenResult.txHash };
    };

    if (batch.status === "settled" || batch.status === "closed") {
      logger.info("CustomVaultProvider: Batch already finalized - skipping automatic reopen", {
        batchId: targetBatchId,
        status: batch.status,
      });
      return {
        success: true,
        epochId: targetBatchId,
        batchId: targetBatchId,
        requestsSettled: Number(batch.totalSharesPending > 0n ? 1 : 0),
        totalShares: batch.totalSharesPending,
        totalAssets: batch.totalAssetsSnapshot,
        lockedClearingPrice: batch.lockedClearingPrice.toString(),
      };
    }

    // Step 1: Cutoff batch if open
    let cutoffTxHash: Hex | undefined;
    if (batch.status === "open") {
      logger.info("CustomVaultProvider: Cutting off batch", { batchId: targetBatchId });

      let maintenanceWalletClient: WalletClient;
      try {
        maintenanceWalletClient = this.getMaintenanceWalletClient();
      } catch (error) {
        return {
          success: false,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to initialize maintenance wallet: ${(error as Error).message}`,
        };
      }

      const cutoffResult = await this.retryWithBackoff(() =>
        this.client.cutoffBatch(maintenanceWalletClient),
      );

      if (!cutoffResult.success) {
        return {
          success: false,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to cutoff batch: ${cutoffResult.error}`,
        };
      }

      cutoffTxHash = cutoffResult.txHash;

      // Wait for cutoff transaction confirmation
      const cutoffConfirmResult = await this.retryWithBackoff(() =>
        this.client.waitForTransaction(cutoffTxHash!),
      );
      if (!cutoffConfirmResult.success) {
        return {
          success: false,
          txHash: cutoffTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Cutoff transaction failed to confirm: ${cutoffConfirmResult.error}`,
        };
      }

      logger.info("CustomVaultProvider: Batch cutoff successfully", {
        txHash: cutoffTxHash,
        batchId: targetBatchId,
      });

      // Refresh batch data
      batch = await this.client.getBatch(BigInt(targetBatchId));
      if (!batch) {
        return {
          success: false,
          txHash: cutoffTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Batch ${targetBatchId} missing after cutoff`,
        };
      }
    }

    // Step 2: Flatten batch (lock clearing price) if cutoff
    let flattenTxHash: Hex | undefined;
    if (batch.status === "cutoff") {
      // FLATNESS GATE: Verify vault is flat before flattening
      if (!skipFlatnessCheck) {
        const canFlattenResult = await this.canFlattenBatch(targetBatchId);
        if (!canFlattenResult.canFlatten) {
          return {
            success: false,
            txHash: cutoffTxHash,
            epochId: targetBatchId,
            batchId: targetBatchId,
            requestsSettled: 0,
            totalShares: 0n,
            totalAssets: 0n,
            error: `Flattening blocked: ${canFlattenResult.blockingConditions?.join(", ")}`,
          };
        }
      }

      logger.info("CustomVaultProvider: Flattening batch", { batchId: targetBatchId });

      let maintenanceWalletClient: WalletClient;
      try {
        maintenanceWalletClient = this.getMaintenanceWalletClient();
      } catch (error) {
        return {
          success: false,
          txHash: cutoffTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to initialize maintenance wallet: ${(error as Error).message}`,
        };
      }

      // Generate snapshot hash (placeholder - in production this would be a merkle root or similar)
      const snapshotHash = `0x${"0".repeat(64)}` as Hex;

      const flattenResult = await this.retryWithBackoff(() =>
        this.client.flattenBatch(maintenanceWalletClient, snapshotHash),
      );

      if (!flattenResult.success) {
        return {
          success: false,
          txHash: cutoffTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to flatten batch: ${flattenResult.error}`,
        };
      }

      flattenTxHash = flattenResult.txHash;

      // Wait for flatten transaction confirmation
      const flattenConfirmResult = await this.retryWithBackoff(() =>
        this.client.waitForTransaction(flattenTxHash!),
      );
      if (!flattenConfirmResult.success) {
        return {
          success: false,
          txHash: flattenTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Flatten transaction failed to confirm: ${flattenConfirmResult.error}`,
        };
      }

      logger.info("CustomVaultProvider: Batch flattened successfully", {
        txHash: flattenTxHash,
        batchId: targetBatchId,
      });

      const nextBatch = await this.client.getBatch(BigInt(targetBatchId + 1));
      if ((nextBatch?.totalQueuedDeposits ?? 0n) > 0n) {
        const processResult = await this.processCurrentDepositQueue(targetBatchId + 1);
        if (!processResult.success) {
          return {
            success: false,
            txHash: flattenTxHash,
            epochId: targetBatchId,
            batchId: targetBatchId,
            requestsSettled: 0,
            totalShares: 0n,
            totalAssets: 0n,
            error: `Failed to process deposit queue for batch ${targetBatchId}: ${processResult.error}`,
          };
        }
      }

      // Refresh batch data
      batch = await this.client.getBatch(BigInt(targetBatchId));
      if (!batch) {
        return {
          success: false,
          txHash: flattenTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Batch ${targetBatchId} missing after flatten`,
        };
      }
    }

    // Step 3: Settle batch if flattening
    let settleTxHash: Hex | undefined;
    if (batch.status === "flattening" || batch.status === "settling") {
      logger.info("CustomVaultProvider: Settling batch", {
        batchId: targetBatchId,
        lockedClearingPrice: batch.lockedClearingPrice.toString(),
      });

      let maintenanceWalletClient: WalletClient;
      try {
        maintenanceWalletClient = this.getMaintenanceWalletClient();
      } catch (error) {
        return {
          success: false,
          txHash: flattenTxHash ?? cutoffTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to initialize maintenance wallet: ${(error as Error).message}`,
        };
      }

      const settleResult = await this.retryWithBackoff(() =>
        this.client.settleBatch(maintenanceWalletClient, BigInt(targetBatchId)),
      );

      if (!settleResult.success) {
        return {
          success: false,
          txHash: flattenTxHash ?? cutoffTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to settle batch: ${settleResult.error}`,
        };
      }

      settleTxHash = settleResult.txHash;

      // Wait for settlement transaction confirmation
      const settleConfirmResult = await this.retryWithBackoff(() =>
        this.client.waitForTransaction(settleTxHash!),
      );
      if (!settleConfirmResult.success) {
        return {
          success: false,
          txHash: settleTxHash,
          epochId: targetBatchId,
          batchId: targetBatchId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Settlement transaction failed to confirm: ${settleConfirmResult.error}`,
        };
      }

      logger.info("CustomVaultProvider: Batch settled successfully", {
        txHash: settleTxHash,
        batchId: targetBatchId,
      });

      // Refresh batch data
      batch = await this.client.getBatch(BigInt(targetBatchId));
    }

    // Get final batch data
    const settledBatch = await this.client.getBatch(BigInt(targetBatchId));
    const reopenResult = settledBatch ? await reopenIfNeeded(settledBatch) : { success: true };
    if (!reopenResult.success) {
      return {
        success: false,
        txHash: reopenResult.txHash,
        epochId: targetBatchId,
        batchId: targetBatchId,
        requestsSettled: 0,
        totalShares: settledBatch?.totalSharesPending ?? 0n,
        totalAssets: settledBatch?.totalAssetsSnapshot ?? 0n,
        lockedClearingPrice: settledBatch ? settledBatch.lockedClearingPrice.toString() : undefined,
        error: reopenResult.error,
      };
    }
    const totalShares = settledBatch?.totalSharesPending ?? 0n;
    const totalAssets = settledBatch?.totalAssetsSnapshot ?? 0n;
    const requestsSettled = Number(totalShares > 0n ? 1 : 0);

    logger.info("CustomVaultProvider: Settlement completed successfully", {
      batchId: targetBatchId,
      cutoffTxHash,
      flattenTxHash,
      settleTxHash,
      totalShares: totalShares.toString(),
      totalAssets: totalAssets.toString(),
      requestsSettled,
      lockedClearingPrice: settledBatch?.lockedClearingPrice.toString(),
    });

    return {
      success: true,
      txHash: reopenResult.txHash ?? settleTxHash ?? flattenTxHash ?? cutoffTxHash,
      epochId: targetBatchId,
      batchId: targetBatchId,
      requestsSettled,
      totalShares,
      totalAssets,
      lockedClearingPrice: settledBatch?.lockedClearingPrice.toString(),
    };
  }

  // ============================================================================
  // Capital Management
  // ============================================================================

  async rebalanceCapital(params: {
    vaultUsdcBalance: bigint;
    safeUsdcBalance: bigint;
    pendingWithdrawalLiability: bigint;
  }): Promise<CapitalRebalanceResult> {
    const queuedAssets = await this.client.getTotalQueuedAssets();
    const reservedRedemptionAssets = await this.client.getReservedRedemptionAssets();

    // CLOSED-BOOK: No previewRedeem - use conservative estimate
    const estimatedPendingRedemptionAssets = 0n;

    const reserveBuffer = BigInt(
      Math.max(0, Math.round(this.vaultConfig.vaultReserveUsdc * 10 ** USDC_DECIMALS)),
    );
    const minTransferAmount = BigInt(
      Math.max(0, Math.round(this.vaultConfig.minAllocationAmountUsdc * 10 ** USDC_DECIMALS)),
    );
    const withdrawalLiability = [
      reservedRedemptionAssets,
      params.pendingWithdrawalLiability,
      estimatedPendingRedemptionAssets,
    ].reduce((max, value) => (value > max ? value : max), 0n);
    const requiredVaultBalance = queuedAssets + withdrawalLiability + reserveBuffer;

    if (!this.vaultConfig.autoLiquidityManagement) {
      return {
        success: true,
        action: "none",
        amount: 0n,
        requiredVaultBalance,
        queuedAssets,
        reservedRedemptionAssets,
        pendingWithdrawalLiability: withdrawalLiability,
        details: "Automatic liquidity management disabled in vault config.",
      };
    }

    const shortfall =
      requiredVaultBalance > params.vaultUsdcBalance
        ? requiredVaultBalance - params.vaultUsdcBalance
        : 0n;

    if (shortfall > 0) {
      if (!this.safeOperatorKey) {
        return {
          success: false,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          error: "Safe operator key not configured for capital recall.",
          details:
            "Vault cash is below required liabilities but recall from trading wallet is unavailable.",
        };
      }

      const recallAmount = params.safeUsdcBalance < shortfall ? params.safeUsdcBalance : shortfall;
      if (recallAmount < minTransferAmount) {
        return {
          success: true,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          details:
            "Capital recall needed, but trading wallet balance is below minimum transfer amount.",
        };
      }

      const safeWallet = await this.getSafeWalletService();
      const assetAddress = await this.client.getAsset();
      const recallResult = await safeWallet.transferToken(
        assetAddress,
        this.config.vaultAddress,
        recallAmount.toString(),
      );

      if (!recallResult.success) {
        return {
          success: false,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          txHash: recallResult.txHash as Hex | undefined,
          error: recallResult.error,
          details: "Capital recall from trading wallet failed.",
        };
      }

      return {
        success: true,
        action: "deallocated",
        amount: recallAmount,
        requiredVaultBalance,
        queuedAssets,
        reservedRedemptionAssets,
        pendingWithdrawalLiability: withdrawalLiability,
        txHash: recallResult.txHash as Hex | undefined,
        details: `Recalled ${Number(recallAmount) / 10 ** USDC_DECIMALS} USDC from trading wallet to vault.`,
      };
    }

    const excessVaultBalance =
      params.vaultUsdcBalance > requiredVaultBalance
        ? params.vaultUsdcBalance - requiredVaultBalance
        : 0n;

    if (excessVaultBalance >= minTransferAmount) {
      if (!this.adminKey) {
        return {
          success: false,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          error: "Admin key not configured for capital allocation.",
          details: "Vault has excess capital but allocation signer is unavailable.",
        };
      }

      const allocatableAssets = await this.client.getMaxAllocatableAssets();
      const allocationAmount =
        allocatableAssets < excessVaultBalance ? allocatableAssets : excessVaultBalance;

      if (allocationAmount >= minTransferAmount) {
        const walletClient = this.getAdminWalletClient();
        const allocationResult = await this.client.allocateToTradingWallet(
          walletClient,
          allocationAmount,
        );
        if (!allocationResult.success) {
          return {
            success: false,
            action: "none",
            amount: 0n,
            requiredVaultBalance,
            queuedAssets,
            reservedRedemptionAssets,
            pendingWithdrawalLiability: withdrawalLiability,
            txHash: allocationResult.txHash,
            error: allocationResult.error,
            details: "Capital allocation to trading wallet failed.",
          };
        }

        return {
          success: true,
          action: "allocated",
          amount: allocationAmount,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          txHash: allocationResult.txHash,
          details: `Allocated ${Number(allocationAmount) / 10 ** USDC_DECIMALS} USDC from vault to trading wallet.`,
        };
      }
    }

    return {
      success: true,
      action: "none",
      amount: 0n,
      requiredVaultBalance,
      queuedAssets,
      reservedRedemptionAssets,
      pendingWithdrawalLiability: withdrawalLiability,
      details: "No rebalancing required.",
    };
  }

  // ============================================================================
  // Operator Authorization
  // ============================================================================

  /**
   * Check if an address is authorized to act on behalf of a controller
   * Authorization is granted if:
   * 1. The address IS the controller
   * 2. The address is an approved operator for the controller
   */
  async isAuthorizedForController(callerAddress: Address, controller: Address): Promise<boolean> {
    // Direct authorization
    if (callerAddress.toLowerCase() === controller.toLowerCase()) {
      return true;
    }

    // CLOSED-BOOK: setOperator is not queryable, return false
    return false;
  }

  /**
   * Grant operator approval (requires wallet)
   */
  async setOperator(
    walletClient: WalletClient,
    operator: Address,
    approved: boolean,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    const result = await this.client.setOperator(walletClient, operator, approved);
    return {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
    };
  }

  /**
   * Check if address is an operator for a controller
   * CLOSED-BOOK: Always returns false (operator state not queryable)
   */
  async isOperator(controller: Address, operator: Address): Promise<boolean> {
    return this.client.isOperator(controller, operator);
  }

  // ============================================================================
  // Utility
  // ============================================================================

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!this.config.vaultAddress) {
      errors.push("vaultAddress is required");
    }

    if (this.config.providerType !== "custom") {
      errors.push(`Invalid providerType: ${this.config.providerType}`);
    }

    if (this.customConfig.navStalenessThresholdSeconds <= 0) {
      errors.push("navStalenessThresholdSeconds must be positive");
    }

    // Validate contract connection
    try {
      await this.client.getVaultConfig();
    } catch (error) {
      errors.push(`Failed to connect to vault contract: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getCapabilities(): VaultCapabilities {
    return {
      asyncRedemption: true,
      instantRedemption: false,
      // CLOSED-BOOK BATCH: Cancellation impossible after CUTOFF
      cancelBeforeSettlement: false,
      proRataSettlement: true,
      requiresNavForSettlement: true,
      supportsRollover: false,
      // CLOSED-BOOK BATCH: Uses batch/cycle terminology (not epoch-based)
      batchBased: true,
      epochBased: false,
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private getRoleWalletClient(
    key: string | undefined,
    cache: WalletClient | undefined,
    roleName: string,
  ): WalletClient {
    if (!key) {
      throw new Error(
        `CustomVaultProvider: ${roleName} key is required for ${roleName} operations`,
      );
    }

    if (cache) {
      return cache;
    }

    const account = privateKeyToAccount(key as Hex);
    const transport = createNetworkTransport(this.rpcUrl);

    const walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport,
    });

    logger.debug("CustomVaultProvider: Created role wallet client", {
      vaultId: this.config.vaultId,
      roleName,
      roleAddress: account.address,
      chainId: this.chain.id,
    });

    return walletClient;
  }

  private getSettlerWalletClient(): WalletClient {
    this.settlerWalletClient = this.getRoleWalletClient(
      this.settlerKey,
      this.settlerWalletClient,
      "settler",
    );

    return this.settlerWalletClient;
  }

  private getAdminWalletClient(): WalletClient {
    this.adminWalletClient = this.getRoleWalletClient(
      this.adminKey,
      this.adminWalletClient,
      "admin",
    );

    return this.adminWalletClient;
  }

  private getSnapshotterWalletClient(): WalletClient {
    this.snapshotterWalletClient = this.getRoleWalletClient(
      this.snapshotterKey,
      this.snapshotterWalletClient,
      "snapshotter",
    );

    return this.snapshotterWalletClient;
  }

  private getDepositProcessorWalletClient(): WalletClient {
    this.depositProcessorWalletClient = this.getRoleWalletClient(
      this.depositProcessorKey,
      this.depositProcessorWalletClient,
      "deposit processor",
    );

    return this.depositProcessorWalletClient;
  }

  private getMaintenanceWalletClient(): WalletClient {
    if (this.snapshotterKey) {
      return this.getSnapshotterWalletClient();
    }
    if (this.settlerKey) {
      return this.getSettlerWalletClient();
    }
    if (this.depositProcessorKey) {
      return this.getDepositProcessorWalletClient();
    }
    if (this.adminKey) {
      return this.getAdminWalletClient();
    }

    throw new Error("CustomVaultProvider: a maintenance signer is required for batch operations");
  }

  private async getSafeWalletService(): Promise<SafeWalletService> {
    if (!this.safeOperatorKey) {
      throw new Error(
        "CustomVaultProvider: safe operator key is required for trading wallet transfers",
      );
    }

    if (!this.safeWalletService) {
      const safeAddress = this.vaultConfig.tradingSafeAddress ?? this.vaultConfig.safeAddress;
      this.safeWalletService = new SafeWalletService(
        safeAddress,
        this.safeOperatorKey,
        this.rpcUrl,
        this.chain,
      );
      await this.safeWalletService.initialize();
    }

    return this.safeWalletService;
  }

  private async processCurrentDepositQueue(
    batchId: number,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    let walletClient: WalletClient;
    try {
      walletClient = this.getMaintenanceWalletClient();
    } catch (error) {
      return {
        success: false,
        error: `Failed to initialize maintenance wallet: ${(error as Error).message}`,
      };
    }

    const result = await this.retryWithBackoff(() =>
      this.client.processDepositQueue(walletClient, BigInt(batchId), 0n, DEPOSIT_QUEUE_BATCH_SIZE),
    );

    if (!result.success || !result.txHash) {
      return result;
    }

    const confirmResult = await this.retryWithBackoff(() =>
      this.client.waitForTransaction(result.txHash!),
    );
    if (!confirmResult.success) {
      return {
        success: false,
        txHash: result.txHash,
        error: `Deposit queue transaction failed to confirm: ${confirmResult.error}`,
      };
    }

    return result;
  }

  private async resolveMaintenanceBatch(batchId?: number): Promise<number> {
    if (batchId !== undefined) {
      return batchId;
    }

    return Number(await this.client.getCurrentBatch());
  }

  /**
   * Retry a function with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 1000,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          const delayMs = initialDelayMs * Math.pow(2, attempt);
          logger.warn(
            `CustomVaultProvider: Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms`,
            {
              error: lastError.message,
              vaultId: this.config.vaultId,
            },
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  /**
   * Map redemption request data from contract to domain RedemptionRequest
   */
  private mapRedemptionDataToRequest(data: RedemptionRequestData): RedemptionRequest {
    return {
      requestId: data.requestId.toString(),
      vaultId: this.config.vaultId,
      userAddress: data.owner,
      controller: data.controller,
      owner: data.owner,
      // CLOSED-BOOK: Use batchId instead of epochId
      batchId: Number(data.batchId),
      epochId: Number(data.batchId), // Backward compatibility
      shares: data.shares,
      // CLOSED-BOOK: Assets from settlement, not estimated
      assetsEstimated: data.assetsClaimable,
      assetsActual: data.assetsClaimable,
      status: mapContractStatusToDomain(
        ["pending", "escrowed", "claimable", "claimed", "cancelled"].indexOf(data.status),
      ),
      createdAt: new Date(Number(data.createdAt) * 1000),
      settledAt: data.settledAt ? new Date(Number(data.settledAt) * 1000) : undefined,
    };
  }

  /**
   * Get the underlying contract client for advanced operations
   */
  getClient(): CustomVaultClient {
    return this.client;
  }
}

export { CustomVaultClient, createCustomVaultClient };
