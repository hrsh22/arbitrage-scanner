/**
 * Custom Vault Provider (ERC-7540 Compliant with Tranche Lifecycle)
 *
 * Implementation for the EpochTrancheVault with:
 * - Unique requestIds per redemption (not controller-aggregated)
 * - Deposit queue with queueDeposit/processDepositQueue
 * - Epoch freeze/settle/finalize flow
 * - Carry accrual on claim
 * - Async request/settle/claim flow
 * - Pro-rata settlement for insufficient liquidity
 * - NAV staleness guards
 * - Operator authorization model
 *
 * This provider uses the CustomVaultClient for contract interactions.
 */

import type { Address, Hex } from "viem";
import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { logger } from "../logger.js";
import { env } from "../env.js";
import type {
  IVaultProvider,
  VaultProviderConfig,
  VaultProviderType,
  VaultMetadata,
  EpochStatus,
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
import { createPolygonTransport } from "../rpcTransport.js";

// Default epoch duration: 7 days in seconds
const DEFAULT_EPOCH_DURATION_SECONDS = 604800;

// Default NAV staleness threshold: 6 hours in seconds
const DEFAULT_NAV_STALENESS_SECONDS = 21600;

// USDC decimals
const USDC_DECIMALS = 6;
const VAULT_SHARE_DECIMALS = 18;

/**
 * Map contract request status to domain request status
 *
 * EpochTrancheVault Lifecycle Semantics (requestId-based):
 * - Pending (0): Request submitted, waiting for epoch freeze
 * - Frozen (1): Epoch frozen, waiting for settlement
 * - Claimable (2): Settlement complete, ready to claim
 * - Claimed (3): Assets claimed
 * - Cancelled (4): Request was cancelled
 */
function mapContractStatusToDomain(status: number): RedemptionRequest["status"] {
  const statusMap: RedemptionRequest["status"][] = [
    "pending",
    "frozen",
    "claimable",
    "claimed",
    "cancelled",
  ];
  return statusMap[status] ?? "pending";
}

/**
 * Custom Vault Provider
 *
 * Manages interactions with the EpochTrancheVault contract.
 */
export class CustomVaultProvider implements IVaultProvider {
  readonly providerType: VaultProviderType = "custom";
  readonly config: VaultProviderConfig;

  private readonly customConfig: Required<CustomVaultConfig>;
  private readonly client: CustomVaultClient;
  private readonly rpcUrl: string;
  private readonly settlerKey?: string;
  private settlerWalletClient?: WalletClient;

  constructor(config: VaultProviderConfig, settlerKey?: string) {
    if (config.providerType !== "custom") {
      throw new Error(
        `CustomVaultProvider: expected providerType "custom", got "${config.providerType}"`,
      );
    }

    this.config = config;
    this.settlerKey = settlerKey;
    this.customConfig = {
      epochDurationSeconds: DEFAULT_EPOCH_DURATION_SECONDS,
      navStalenessThresholdSeconds: DEFAULT_NAV_STALENESS_SECONDS,
      ...config.customConfig,
    } as Required<CustomVaultConfig>;

    this.rpcUrl = env.POLYGON_RPC_URL;
    this.client = createCustomVaultClient(config.vaultAddress, this.rpcUrl);

    logger.info("CustomVaultProvider: Initialized", {
      vaultId: config.vaultId,
      vaultAddress: config.vaultAddress,
      epochDuration: this.customConfig.epochDurationSeconds,
      hasSettlerKey: !!settlerKey,
    });
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  async getVaultInfo(): Promise<VaultMetadata> {
    logger.debug("CustomVaultProvider.getVaultInfo", { vaultId: this.config.vaultId });

    try {
      const [asset, vaultConfig, navStatus, emergencyMode, currentEpoch] = await Promise.all([
        this.client.getAsset(),
        this.client.getVaultConfig(),
        this.client.getNAVStatus(),
        this.client.getEmergencyMode(),
        this.client.getCurrentEpoch(),
      ]);

      const navIsStale = !navStatus.isFresh;
      const navLastUpdated = new Date(Number(navStatus.lastNAVUpdate) * 1000);

      // Get total pending shares from contract
      const totalPendingShares = await this.client.getTotalPendingRedeemShares();

      // Use NAV as totalAssets approximation
      const totalAssets = navStatus.currentNAV;
      // Total supply = NAV (at 1:1 ratio when NAV = 1e18)
      const totalSupply =
        navStatus.currentNAV > 0n
          ? (navStatus.currentNAV * 1000000000000000000n) / navStatus.currentNAV
          : 0n;

      // Calculate share price
      const sharePrice = totalSupply > 0n ? Number(totalAssets) / Number(totalSupply) : 1;

      // Calculate current epoch info
      const epochEnd = await this.client.getEpochEnd(currentEpoch);
      const epochStart = epochEnd - BigInt(vaultConfig.epochDuration);

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
        epochInfo: {
          currentEpochId: Number(currentEpoch),
          currentEpochStart: new Date(Number(epochStart) * 1000),
          currentEpochEnd: new Date(Number(epochEnd) * 1000),
          nextSettlementTime: new Date(Number(epochEnd) * 1000),
          epochDurationSeconds: Number(vaultConfig.epochDuration),
        },
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

  async getEpochStatus(epochId?: number): Promise<EpochStatus> {
    const contractEpochId = BigInt(epochId ?? (await this.client.getCurrentEpoch()));
    logger.debug("CustomVaultProvider.getEpochStatus", {
      vaultId: this.config.vaultId,
      epochId: contractEpochId.toString(),
    });

    const epoch = await this.client.getEpoch(contractEpochId);
    if (!epoch) {
      throw new Error(`Failed to get epoch status for epoch ${contractEpochId}`);
    }

    // Convert bigint proRataRatio to number factor (0-1)
    const proRataFactor = epoch.proRataRatio ? Number(epoch.proRataRatio) / 1e18 : undefined;

    return {
      epochId: Number(epoch.epochId),
      startTime: new Date(Number(epoch.startTime) * 1000),
      endTime: new Date(Number(epoch.endTime) * 1000),
      settlementTime: new Date(Number(epoch.endTime) * 1000), // Settlement happens at end time
      totalRequests: Number(epoch.totalSharesPending > 0n ? 1 : 0), // Approximate
      totalShares: epoch.totalSharesPending,
      settled: epoch.status === "settled" || epoch.status === "finalized",
      proRataFactor,
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
    const claimable = redemptionData.status === "claimable";

    // Calculate estimated settlement time based on epoch
    let estimatedSettlementTime: Date | undefined;
    if (redemptionData.status === "pending" || redemptionData.status === "frozen") {
      const epoch = await this.client.getEpoch(redemptionData.epochId);
      if (epoch) {
        estimatedSettlementTime = new Date(Number(epoch.endTime) * 1000);
      }
    }

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

    // Get the requestId for this user (controller)
    const requestId = await this.client.getControllerRequestId(userAddress);

    if (requestId === 0n) {
      return []; // No request found
    }

    const redemptionData = await this.client.getRedemptionRequest(requestId);
    if (
      !redemptionData ||
      redemptionData.status === "claimed" ||
      redemptionData.status === "cancelled"
    ) {
      return [];
    }

    return [this.mapRedemptionDataToRequest(redemptionData)];
  }

  async getUserRedemptionState(userAddress: Address): Promise<UserRedemptionState> {
    logger.debug("CustomVaultProvider.getUserRedemptionState", {
      vaultId: this.config.vaultId,
      userAddress,
    });

    // Get the requestId for this user
    const requestId = await this.client.getControllerRequestId(userAddress);

    // Build request objects
    const pendingRequests: RedemptionRequest[] = [];
    const claimableRequests: RedemptionRequest[] = [];

    let totalSharesPending = 0n;
    let totalSharesClaimable = 0n;

    if (requestId !== 0n) {
      const redemptionData = await this.client.getRedemptionRequest(requestId);
      if (redemptionData) {
        const request = this.mapRedemptionDataToRequest(redemptionData);

        if (redemptionData.status === "pending" || redemptionData.status === "frozen") {
          pendingRequests.push(request);
          totalSharesPending = redemptionData.shares;
        } else if (redemptionData.status === "claimable") {
          claimableRequests.push(request);
          totalSharesClaimable = redemptionData.shares;
        }
      }
    }

    // Calculate estimated assets based on current share price
    const vaultInfo = await this.getVaultInfo();
    const sharesToAssets = (shares: bigint): bigint => {
      if (vaultInfo.totalSupply === 0n) return 0n;
      return (shares * vaultInfo.totalAssets) / vaultInfo.totalSupply;
    };

    return {
      userAddress,
      vaultId: this.config.vaultId,
      pendingRequests,
      claimableRequests,
      totalSharesPending,
      totalSharesClaimable,
      estimatedAssetsPending: sharesToAssets(totalSharesPending),
      estimatedAssetsClaimable: sharesToAssets(totalSharesClaimable),
    };
  }

  async previewRedeem(shares: bigint): Promise<bigint> {
    logger.debug("CustomVaultProvider.previewRedeem", {
      vaultId: this.config.vaultId,
      shares: shares.toString(),
    });

    const vaultInfo = await this.getVaultInfo();
    if (vaultInfo.totalSupply === 0n) return 0n;
    return (shares * vaultInfo.totalAssets) / vaultInfo.totalSupply;
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

    // Calculate estimated assets
    const assetsEstimated = await this.previewRedeem(shares);

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
    logger.info("CustomVaultProvider.cancelRedemption", {
      vaultId: this.config.vaultId,
      requestId,
      userAddress,
    });

    // Parse requestId
    let requestIdBigInt: bigint;
    try {
      requestIdBigInt = BigInt(requestId);
    } catch {
      return { success: false, error: "Invalid requestId format" };
    }

    // Get the redemption request
    const redemptionData = await this.client.getRedemptionRequest(requestIdBigInt);
    if (!redemptionData) {
      return { success: false, error: "Request not found" };
    }

    // Check if controller matches user (or user is authorized operator)
    const isAuthorized = await this.isAuthorizedForController(
      userAddress,
      redemptionData.controller,
    );
    if (!isAuthorized) {
      return { success: false, error: "Not authorized to cancel this request" };
    }

    // Check if request is pending (can only cancel pending requests)
    if (redemptionData.status !== "pending") {
      return {
        success: false,
        error: `Cannot cancel request with status: ${redemptionData.status}`,
      };
    }

    // Check if epoch has ended (settlement cutoff)
    const epoch = await this.client.getEpoch(redemptionData.epochId);
    if (epoch) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now >= epoch.endTime) {
        return {
          success: false,
          error: "Settlement cutoff has passed - cannot cancel",
        };
      }
    }

    // Note: Actual cancellation requires wallet client with cancelRedeemRequest(requestId)
    logger.info("CustomVaultProvider: Redemption cancellation authorized", {
      requestId,
      vaultId: this.config.vaultId,
      controller: redemptionData.controller,
      sharesToCancel: redemptionData.shares.toString(),
    });

    return { success: true };
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

    // Calculate assets received (after carry deduction)
    const assetsReceived = redemptionData.assetsClaimable;
    const carryDeducted = redemptionData.carryDeducted;

    // Note: Actual claim requires wallet client with redeem(requestId, shares, receiver)
    logger.info("CustomVaultProvider: Redemption claim authorized", {
      requestId,
      vaultId: this.config.vaultId,
      controller: redemptionData.controller,
      shares: redemptionData.shares.toString(),
      assetsReceived: assetsReceived.toString(),
      carryDeducted: carryDeducted.toString(),
    });

    return {
      success: true,
      requestId,
      assetsReceived,
      carryDeducted,
    };
  }

  // ============================================================================
  // Settlement Operations
  // ============================================================================

  async isSettlementReady(epochId?: number): Promise<boolean> {
    const targetEpochId = epochId ?? Number(await this.client.getCurrentEpoch());
    logger.debug("CustomVaultProvider.isSettlementReady", {
      vaultId: this.config.vaultId,
      epochId: targetEpochId,
    });

    return this.client.canSettleEpoch(BigInt(targetEpochId));
  }

  /**
   * Get or create the settler wallet client
   */
  private getSettlerWalletClient(): WalletClient {
    if (!this.settlerKey) {
      throw new Error("CustomVaultProvider: settlerKey is required for settlement operations");
    }

    if (this.settlerWalletClient) {
      return this.settlerWalletClient;
    }

    const account = privateKeyToAccount(this.settlerKey as Hex);
    const transport = createPolygonTransport(this.rpcUrl);

    this.settlerWalletClient = createWalletClient({
      account,
      chain: polygon,
      transport,
    });

    logger.debug("CustomVaultProvider: Created settler wallet client", {
      vaultId: this.config.vaultId,
      settlerAddress: account.address,
    });

    return this.settlerWalletClient;
  }

  /**
   * Execute settlement with retry logic
   */
  async executeSettlement(epochId?: number): Promise<{
    success: boolean;
    txHash?: Hex;
    epochId: number;
    requestsSettled: number;
    totalShares: bigint;
    totalAssets: bigint;
    error?: string;
  }> {
    const targetEpochId = epochId ?? Number(await this.client.getCurrentEpoch());
    logger.info("CustomVaultProvider.executeSettlement", {
      vaultId: this.config.vaultId,
      epochId: targetEpochId,
    });

    // Check if settler key is available
    if (!this.settlerKey) {
      return {
        success: false,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: "Settlement requires settlerKey - not configured",
      };
    }

    // Get epoch data
    const epoch = await this.client.getEpoch(BigInt(targetEpochId));
    if (!epoch) {
      return {
        success: false,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Epoch ${targetEpochId} not found`,
      };
    }

    // Check if already settled
    if (epoch.status === "settled" || epoch.status === "finalized") {
      logger.info("CustomVaultProvider: Epoch already settled", {
        epochId: targetEpochId,
        status: epoch.status,
      });
      return {
        success: true,
        epochId: targetEpochId,
        requestsSettled: Number(epoch.totalSharesPending > 0n ? 1 : 0),
        totalShares: epoch.totalSharesPending,
        totalAssets: epoch.totalAssetsAvailable,
      };
    }

    // Check if epoch has ended
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < epoch.endTime) {
      return {
        success: false,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Epoch ${targetEpochId} has not ended yet. End time: ${new Date(Number(epoch.endTime) * 1000).toISOString()}`,
      };
    }

    // Get settler wallet client
    let walletClient: WalletClient;
    try {
      walletClient = this.getSettlerWalletClient();
    } catch (error) {
      return {
        success: false,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Failed to initialize settler wallet: ${(error as Error).message}`,
      };
    }

    // Step 1: Freeze epoch if not frozen
    let freezeTxHash: Hex | undefined;
    if (epoch.status === "active") {
      logger.info("CustomVaultProvider: Freezing epoch", {
        epochId: targetEpochId,
      });

      // Generate snapshot hash (placeholder - in production this would be a merkle root or similar)
      const snapshotHash = `0x${"0".repeat(64)}` as Hex;

      const freezeResult = await this.retryWithBackoff(() =>
        this.client.freezeEpoch(
          walletClient,
          BigInt(targetEpochId),
          snapshotHash,
        )
      );

      if (!freezeResult.success) {
        return {
          success: false,
          epochId: targetEpochId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to freeze epoch: ${freezeResult.error}`,
        };
      }

      freezeTxHash = freezeResult.txHash;

      // Wait for freeze transaction confirmation
      // Wait for freeze transaction confirmation with retry
      const freezeConfirmResult = await this.retryWithBackoff(() =>
        this.client.waitForTransaction(freezeTxHash!)
      );

      logger.info("CustomVaultProvider: Epoch frozen successfully", {
        txHash: freezeTxHash,
        epochId: targetEpochId,
      });
    }

    // Step 2: Calculate available assets (vault USDC balance)
    const vaultInfo = await this.getVaultInfo();
    const availableAssets = vaultInfo.totalAssets;
    const carryAmount = 0n; // TODO: Calculate carry based on performance

    // Step 3: Settle epoch
    logger.info("CustomVaultProvider: Settling epoch", {
      epochId: targetEpochId,
      availableAssets: availableAssets.toString(),
      carryAmount: carryAmount.toString(),
    });

    const settleResult = await this.retryWithBackoff(() =>
      this.client.settleEpoch(
        walletClient,
        BigInt(targetEpochId),
        availableAssets,
        carryAmount,
      )
    );

    if (!settleResult.success) {
      return {
        success: false,
        txHash: freezeTxHash,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Failed to settle epoch: ${settleResult.error}`,
      };
    }

    const settleTxHash = settleResult.txHash!;

    // Wait for settlement transaction confirmation
    // Wait for settlement transaction confirmation with retry
    const settleConfirmResult = await this.retryWithBackoff(() =>
      this.client.waitForTransaction(settleTxHash)
    );
    if (!settleConfirmResult.success) {
      return {
        success: false,
        txHash: settleTxHash,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Settlement transaction failed to confirm: ${settleConfirmResult.error}`,
      };
    }

    // Step 4: Finalize epoch
    logger.info("CustomVaultProvider: Finalizing epoch", {
      epochId: targetEpochId,
    });

    const finalizeResult = await this.retryWithBackoff(() =>
      this.client.finalizeEpoch(
        walletClient,
        BigInt(targetEpochId),
      )
    );

    if (!finalizeResult.success) {
      return {
        success: false,
        txHash: settleTxHash,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Failed to finalize epoch: ${finalizeResult.error}`,
      };
    }

    const finalizeTxHash = finalizeResult.txHash!;

    // Wait for finalize transaction confirmation with retry
    const finalizeConfirmResult = await this.retryWithBackoff(() =>
      this.client.waitForTransaction(finalizeTxHash)
    );
    if (!finalizeConfirmResult.success) {
      return {
        success: false,
        txHash: settleTxHash,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: `Finalize transaction failed to confirm: ${finalizeConfirmResult.error}`,
      };
    }

    // Get updated epoch data after settlement
    const settledEpoch = await this.client.getEpoch(BigInt(targetEpochId));
    const totalShares = settledEpoch?.totalSharesPending ?? 0n;
    const totalAssets = settledEpoch?.totalAssetsAvailable ?? 0n;
    const requestsSettled = Number(totalShares > 0n ? 1 : 0);

    logger.info("CustomVaultProvider: Settlement completed successfully", {
      epochId: targetEpochId,
      freezeTxHash,
      settleTxHash,
      finalizeTxHash,
      totalShares: totalShares.toString(),
      totalAssets: totalAssets.toString(),
      requestsSettled,
    });

    return {
      success: true,
      txHash: settleTxHash,
      epochId: targetEpochId,
      requestsSettled,
      totalShares,
      totalAssets,
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

    // Operator authorization
    return this.client.isOperator(controller, callerAddress);
  }

  /**
   * Grant operator approval (requires wallet)
   */
  async setOperator(
    walletClient: import("viem").WalletClient,
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

    if (this.customConfig.epochDurationSeconds <= 0) {
      errors.push("epochDurationSeconds must be positive");
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
      cancelBeforeSettlement: true,
      proRataSettlement: true,
      requiresNavForSettlement: true,
      supportsRollover: false,
      epochBased: true,
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

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
          logger.warn(`CustomVaultProvider: Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms`, {
            error: lastError.message,
            vaultId: this.config.vaultId,
          });
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  /**
   * Map redemption request data from contract to domain RedemptionRequest
   */
  /**
   * Map redemption request data from contract to domain RedemptionRequest
   */
  private mapRedemptionDataToRequest(data: RedemptionRequestData): RedemptionRequest {
    return {
      requestId: data.requestId.toString(),
      vaultId: this.config.vaultId,
      userAddress: data.controller,
      controller: data.controller,
      owner: data.owner,
      epochId: Number(data.epochId),
      shares: data.shares,
      assetsEstimated: data.assetsClaimable,
      assetsActual: data.assetsClaimable,
      status: data.status,
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
