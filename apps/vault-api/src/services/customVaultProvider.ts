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
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain } from "viem/chains";
import { logger } from "../logger.js";
import { USDC_E_ADDRESS } from "../constants.js";
import type {
  CapitalRebalanceResult,
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
import { createNetworkTransport } from "../rpcTransport.js";
import { getNetworkConfigFromEnv, getRpcUrlForNetwork } from "../config/network.js";
import { getVaultConfig } from "../config/index.js";
import type { VaultInstanceConfig } from "../config/types.js";
import { SUPPORTS_POLYMARKET_TRADING } from "../constants.js";
import { SafeWalletService } from "./safeWallet.js";

// Default epoch duration: 7 days in seconds
const DEFAULT_EPOCH_DURATION_SECONDS = 604800;

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
}

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

  private readonly vaultConfig: VaultInstanceConfig;
  private readonly customConfig: Required<CustomVaultConfig>;
  private readonly client: CustomVaultClient;
  private readonly rpcUrl: string;
  private readonly chain: Chain;
  private readonly adminKey?: string;
  private readonly settlerKey?: string;
  private readonly snapshotterKey?: string;
  private readonly depositProcessorKey?: string;
  private adminWalletClient?: WalletClient;
  private safeWalletService?: SafeWalletService;
  private settlerWalletClient?: WalletClient;
  private snapshotterWalletClient?: WalletClient;
  private depositProcessorWalletClient?: WalletClient;

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
          }
        : {
            adminKey: roleKeys?.adminKey,
            settlerKey: roleKeys?.settlerKey,
            snapshotterKey: roleKeys?.snapshotterKey ?? roleKeys?.settlerKey,
            depositProcessorKey: roleKeys?.depositProcessorKey ?? roleKeys?.settlerKey,
          };
    this.adminKey = resolvedKeys.adminKey;
    this.settlerKey = resolvedKeys.settlerKey;
    this.snapshotterKey = resolvedKeys.snapshotterKey;
    this.depositProcessorKey = resolvedKeys.depositProcessorKey;
    const networkConfig = getNetworkConfigFromEnv();
    this.chain = chain ?? networkConfig.chain;
    this.rpcUrl = getRpcUrlForNetwork(networkConfig.name);
    this.customConfig = {
      epochDurationSeconds: DEFAULT_EPOCH_DURATION_SECONDS,
      navStalenessThresholdSeconds: DEFAULT_NAV_STALENESS_SECONDS,
      ...config.customConfig,
    } as Required<CustomVaultConfig>;

    this.client = createCustomVaultClient(config.vaultAddress, this.rpcUrl, this.chain);

    logger.info("CustomVaultProvider: Initialized", {
      vaultId: config.vaultId,
      vaultAddress: config.vaultAddress,
      chainId: this.chain.id,
      network: networkConfig.name,
      epochDuration: this.customConfig.epochDurationSeconds,
      hasAdminKey: !!this.adminKey,
      hasSettlerKey: !!this.settlerKey,
      hasSnapshotterKey: !!this.snapshotterKey,
      hasDepositProcessorKey: !!this.depositProcessorKey,
    });
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  async getVaultInfo(): Promise<VaultMetadata> {
    logger.debug("CustomVaultProvider.getVaultInfo", { vaultId: this.config.vaultId });

    try {
      const [asset, vaultConfig, navStatus, currentEpoch, totalSupply] = await Promise.all([
        this.client.getAsset(),
        this.client.getVaultConfig(),
        this.client.getNAVStatus(),
        this.client.getCurrentEpoch(),
        this.client.getTotalSupply(),
      ]);

      const navIsStale = !navStatus.isFresh;
      const navLastUpdated = new Date(Number(navStatus.lastNAVUpdate) * 1000);

      const totalAssets = await this.client.getTotalAssets();

      const sharePrice = Number(formatUnits(navStatus.currentNAV, 18));

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

    const estimatedAssetsPending =
      totalSharesPending > 0n ? await this.previewRedeem(totalSharesPending) : 0n;
    const estimatedAssetsClaimable = claimableRequests.reduce(
      (sum, request) => sum + (request.assetsActual ?? request.assetsEstimated),
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

  async previewRedeem(shares: bigint): Promise<bigint> {
    logger.debug("CustomVaultProvider.previewRedeem", {
      vaultId: this.config.vaultId,
      shares: shares.toString(),
    });

    const navStatus = await this.client.getNAVStatus();
    if (navStatus.currentNAV === 0n) return shares;
    return (shares * navStatus.currentNAV) / 10n ** 18n;
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
    logger.warn("CustomVaultProvider.cancelRedemption disabled", {
      vaultId: this.config.vaultId,
      requestId,
      userAddress,
    });
    return {
      success: false,
      error: "Redemption cancellation is disabled. Redeem requests are irreversible.",
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
    const currentEpochId = Number(await this.client.getCurrentEpoch());
    const targetEpochId = epochId ?? currentEpochId;
    logger.debug("CustomVaultProvider.isSettlementReady", {
      vaultId: this.config.vaultId,
      epochId: targetEpochId,
    });

    const navStatus = await this.client.getNAVStatus();
    if (!navStatus.isFresh) {
      return false;
    }

    const now = BigInt(Math.floor(Date.now() / 1000));

    if (epochId !== undefined) {
      const epoch = await this.client.getEpoch(BigInt(targetEpochId));
      if (!epoch) {
        return false;
      }

      const totalQueuedAssets = await this.client.getTotalQueuedAssets();
      const hasPendingWork = epoch.totalSharesPending > 0n || totalQueuedAssets > 0n;

      return (
        now >= epoch.endTime &&
        (epoch.status === "active" ||
          ((epoch.status === "frozen" || epoch.status === "settling") && hasPendingWork))
      );
    }

    const [currentEpoch, previousEpoch, totalQueuedAssets] = await Promise.all([
      this.client.getEpoch(BigInt(currentEpochId)),
      currentEpochId > 0 ? this.client.getEpoch(BigInt(currentEpochId - 1)) : Promise.resolve(null),
      this.client.getTotalQueuedAssets(),
    ]);

    const currentNeedsFreeze =
      currentEpoch !== null && currentEpoch.status === "active" && now >= currentEpoch.endTime;
    const previousNeedsSettlement =
      previousEpoch !== null &&
      (previousEpoch.status === "frozen" || previousEpoch.status === "settling") &&
      now >= previousEpoch.endTime &&
      (previousEpoch.totalSharesPending > 0n || totalQueuedAssets > 0n);

    return currentNeedsFreeze || previousNeedsSettlement;
  }

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

  private getSafeWalletService(): SafeWalletService {
    if (this.safeWalletService) {
      return this.safeWalletService;
    }

    const tradingSafeAddress = this.vaultConfig.tradingSafeAddress ?? this.vaultConfig.safeAddress;
    const safeOperatorKey = process.env[this.vaultConfig.safeOperatorKeyEnv] ?? "";
    this.safeWalletService = new SafeWalletService(
      tradingSafeAddress,
      safeOperatorKey,
      this.rpcUrl,
      this.chain,
    );
    return this.safeWalletService;
  }

  private async ensureRecallAllowance(
    requiredAmount: bigint,
  ): Promise<{ success: boolean; error?: string }> {
    const tradingSafeAddress = (this.vaultConfig.tradingSafeAddress ??
      this.vaultConfig.safeAddress) as Address;
    const publicClient = createPublicClient({
      chain: this.chain,
      transport: createNetworkTransport(this.rpcUrl),
    });
    const code = await publicClient.getCode({ address: tradingSafeAddress });

    if (!code || code === "0x") {
      const safeOperatorKey = process.env[this.vaultConfig.safeOperatorKeyEnv] ?? "";
      if (!safeOperatorKey) {
        return {
          success: false,
          error:
            "Safe operator key is required to approve recall allowance from the trading-safe EOA.",
        };
      }

      const account = privateKeyToAccount(safeOperatorKey as Hex);
      if (account.address.toLowerCase() !== tradingSafeAddress.toLowerCase()) {
        return {
          success: false,
          error:
            `Safe operator key resolves to ${account.address}, but tradingSafeAddress is ${tradingSafeAddress}. ` +
            "Set the safe operator key to the trading-safe EOA private key.",
        };
      }

      const allowance = (await publicClient.readContract({
        address: USDC_E_ADDRESS as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [tradingSafeAddress, this.config.vaultAddress],
      })) as bigint;
      if (allowance >= requiredAmount) {
        return { success: true };
      }

      const walletClient = createWalletClient({
        account,
        chain: this.chain,
        transport: createNetworkTransport(this.rpcUrl),
      });
      const txHash = await walletClient.writeContract({
        address: USDC_E_ADDRESS as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [this.config.vaultAddress, 2n ** 256n - 1n],
        chain: this.chain,
        account,
      });
      const confirmResult = await this.client.waitForTransaction(txHash);
      if (!confirmResult.success) {
        return {
          success: false,
          error: confirmResult.error ?? "Trading-safe EOA approval transaction failed to confirm.",
        };
      }

      return { success: true };
    }

    const safeWallet = this.getSafeWalletService();
    await safeWallet.initialize();
    const allowance = await safeWallet.getAllowance(USDC_E_ADDRESS, this.config.vaultAddress);
    if (allowance >= requiredAmount) {
      return { success: true };
    }

    const approveResult = await safeWallet.approveToken(
      USDC_E_ADDRESS,
      this.config.vaultAddress,
      safeWallet.getMaxUint256().toString(),
    );
    if (!approveResult.success || !approveResult.txHash) {
      return {
        success: false,
        error: approveResult.error ?? "Failed to approve vault recall allowance from trading safe.",
      };
    }

    const confirmResult = await this.client.waitForTransaction(approveResult.txHash as Hex);
    if (!confirmResult.success) {
      return {
        success: false,
        error: confirmResult.error ?? "Trading safe approval transaction failed to confirm.",
      };
    }

    return { success: true };
  }

  private getDepositProcessorWalletClient(): WalletClient {
    this.depositProcessorWalletClient = this.getRoleWalletClient(
      this.depositProcessorKey,
      this.depositProcessorWalletClient,
      "deposit processor",
    );

    return this.depositProcessorWalletClient;
  }

  private async processCurrentDepositQueue(
    epochId: number,
  ): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
    let walletClient: WalletClient;
    try {
      walletClient = this.getDepositProcessorWalletClient();
    } catch (error) {
      return {
        success: false,
        error: `Failed to initialize deposit processor wallet: ${(error as Error).message}`,
      };
    }

    const result = await this.retryWithBackoff(() =>
      this.client.processDepositQueue(walletClient, BigInt(epochId), 0n, DEPOSIT_QUEUE_BATCH_SIZE),
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

  private async resolveMaintenanceEpoch(epochId?: number): Promise<number> {
    if (epochId !== undefined) {
      return epochId;
    }

    const currentEpochId = Number(await this.client.getCurrentEpoch());
    const currentEpoch = await this.client.getEpoch(BigInt(currentEpochId));
    if (!currentEpoch) {
      throw new Error(`Epoch ${currentEpochId} not found`);
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (currentEpoch.status === "active" && now >= currentEpoch.endTime) {
      return currentEpochId;
    }

    if (currentEpochId > 0) {
      const totalQueuedAssets = await this.client.getTotalQueuedAssets();
      const previousEpoch = await this.client.getEpoch(BigInt(currentEpochId - 1));
      if (
        previousEpoch &&
        (previousEpoch.status === "frozen" || previousEpoch.status === "settling") &&
        (previousEpoch.totalSharesPending > 0n || totalQueuedAssets > 0n)
      ) {
        return currentEpochId - 1;
      }
    }

    return currentEpochId;
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
    const targetEpochId = await this.resolveMaintenanceEpoch(epochId);
    logger.info("CustomVaultProvider.executeSettlement", {
      vaultId: this.config.vaultId,
      epochId: targetEpochId,
    });

    if (!this.settlerKey && !this.snapshotterKey && !this.depositProcessorKey) {
      return {
        success: false,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: 0n,
        error: "Epoch maintenance requires settlerKey or equivalent operator keys - not configured",
      };
    }

    // Get epoch data
    let epoch = await this.client.getEpoch(BigInt(targetEpochId));
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

    const now = BigInt(Math.floor(Date.now() / 1000));

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
        totalAssets: epoch.frozenAssets,
      };
    }

    // Check if epoch has ended
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

    // Step 1: Freeze epoch if not frozen
    let freezeTxHash: Hex | undefined;
    let depositProcessingTxHash: Hex | undefined;
    if (epoch.status === "active") {
      logger.info("CustomVaultProvider: Freezing epoch", {
        epochId: targetEpochId,
      });

      // Generate snapshot hash (placeholder - in production this would be a merkle root or similar)
      const snapshotHash = `0x${"0".repeat(64)}` as Hex;

      let snapshotterWalletClient: WalletClient;
      try {
        snapshotterWalletClient = this.getSnapshotterWalletClient();
      } catch (error) {
        return {
          success: false,
          epochId: targetEpochId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Failed to initialize snapshotter wallet: ${(error as Error).message}`,
        };
      }

      const freezeResult = await this.retryWithBackoff(() =>
        this.client.freezeEpoch(snapshotterWalletClient, BigInt(targetEpochId), snapshotHash),
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

      // Wait for freeze transaction confirmation with retry
      const freezeConfirmResult = await this.retryWithBackoff(() =>
        this.client.waitForTransaction(freezeTxHash!),
      );
      if (!freezeConfirmResult.success) {
        return {
          success: false,
          txHash: freezeTxHash,
          epochId: targetEpochId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Freeze transaction failed to confirm: ${freezeConfirmResult.error}`,
        };
      }

      logger.info("CustomVaultProvider: Epoch frozen successfully", {
        txHash: freezeTxHash,
        epochId: targetEpochId,
      });

      const totalQueuedAssets = await this.client.getTotalQueuedAssets();
      if (totalQueuedAssets > 0n) {
        const processResult = await this.processCurrentDepositQueue(targetEpochId + 1);
        if (!processResult.success) {
          return {
            success: false,
            txHash: freezeTxHash,
            epochId: targetEpochId,
            requestsSettled: 0,
            totalShares: 0n,
            totalAssets: 0n,
            error: `Failed to process deposit queue for epoch ${targetEpochId + 1}: ${processResult.error}`,
          };
        }

        depositProcessingTxHash = processResult.txHash;
      }
      epoch = await this.client.getEpoch(BigInt(targetEpochId));
      if (!epoch) {
        return {
          success: false,
          txHash: depositProcessingTxHash ?? freezeTxHash,
          epochId: targetEpochId,
          requestsSettled: 0,
          totalShares: 0n,
          totalAssets: 0n,
          error: `Epoch ${targetEpochId} missing after freeze`,
        };
      }

      logger.info("CustomVaultProvider: Deposit queue processed for new active epoch", {
        epochId: targetEpochId + 1,
        txHash: depositProcessingTxHash,
      });
    }

    if (epoch.totalSharesPending === 0n) {
      if (!depositProcessingTxHash) {
        const totalQueuedAssets = await this.client.getTotalQueuedAssets();
        if (totalQueuedAssets > 0n) {
          const processResult = await this.processCurrentDepositQueue(targetEpochId + 1);
          if (!processResult.success) {
            return {
              success: false,
              txHash: freezeTxHash,
              epochId: targetEpochId,
              requestsSettled: 0,
              totalShares: 0n,
              totalAssets: epoch.frozenAssets,
              error: `Failed to process deposit queue for epoch ${targetEpochId + 1}: ${processResult.error}`,
            };
          }

          depositProcessingTxHash = processResult.txHash;
        }
      }

      logger.info(
        "CustomVaultProvider: Epoch maintenance completed with no redemption settlement required",
        {
          epochId: targetEpochId,
          freezeTxHash,
          depositProcessingTxHash,
        },
      );

      return {
        success: true,
        txHash: depositProcessingTxHash ?? freezeTxHash,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: epoch.frozenAssets,
      };
    }

    let walletClient: WalletClient;
    try {
      walletClient = this.getSettlerWalletClient();
    } catch (error) {
      return {
        success: false,
        txHash: depositProcessingTxHash ?? freezeTxHash,
        epochId: targetEpochId,
        requestsSettled: 0,
        totalShares: 0n,
        totalAssets: epoch.frozenAssets,
        error: `Failed to initialize settler wallet: ${(error as Error).message}`,
      };
    }

    const carryAmount = 0n;

    // Step 3: Settle epoch
    logger.info("CustomVaultProvider: Settling epoch", {
      epochId: targetEpochId,
      carryAmount: carryAmount.toString(),
    });

    const settleResult = await this.retryWithBackoff(() =>
      this.client.settleEpoch(walletClient, BigInt(targetEpochId), carryAmount),
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

    // Wait for settlement transaction confirmation with retry
    const settleConfirmResult = await this.retryWithBackoff(() =>
      this.client.waitForTransaction(settleTxHash),
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
      this.client.finalizeEpoch(walletClient, BigInt(targetEpochId)),
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
      this.client.waitForTransaction(finalizeTxHash),
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
    const totalAssets = settledEpoch?.frozenAssets ?? 0n;
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

  async rebalanceCapital(params: {
    vaultUsdcBalance: bigint;
    safeUsdcBalance: bigint;
    pendingWithdrawalLiability: bigint;
  }): Promise<CapitalRebalanceResult> {
    const queuedAssets = await this.client.getTotalQueuedAssets();
    const reservedRedemptionAssets = await this.client.getReservedRedemptionAssets();
    const deployedCapital = await this.client.getDeployedCapital();
    const totalPendingRedeemShares = await this.client.getTotalPendingRedeemShares();
    const estimatedPendingRedemptionAssets =
      totalPendingRedeemShares > 0n ? await this.previewRedeem(totalPendingRedeemShares) : 0n;
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

    if (shortfall > 0n) {
      if (!this.adminKey) {
        return {
          success: false,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          error: "Admin key not configured for capital recall.",
          details: "Vault cash is below required liabilities but admin recall is unavailable.",
        };
      }

      let recallAmount = shortfall;
      if (params.safeUsdcBalance < recallAmount) {
        recallAmount = params.safeUsdcBalance;
      }
      if (deployedCapital < recallAmount) {
        recallAmount = deployedCapital;
      }

      if (recallAmount < minTransferAmount || recallAmount === 0n) {
        return {
          success: true,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          details:
            "Vault cash is below the liability target, but recallable capital is below the minimum transfer amount or currently unavailable.",
        };
      }

      const walletClient = this.getAdminWalletClient();
      const approvalResult = await this.ensureRecallAllowance(recallAmount);
      if (!approvalResult.success) {
        return {
          success: false,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          error: approvalResult.error,
          details: "Failed to approve the vault to recall USDC from the trading safe.",
        };
      }
      const result = await this.retryWithBackoff(() =>
        this.client.recallCapital(walletClient, recallAmount),
      );
      if (!result.success || !result.txHash) {
        return {
          success: false,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          error: result.error,
          details: "Failed to recall capital from the trading safe.",
        };
      }

      const confirmResult = await this.retryWithBackoff(() =>
        this.client.waitForTransaction(result.txHash!),
      );
      if (!confirmResult.success) {
        return {
          success: false,
          action: "none",
          amount: 0n,
          requiredVaultBalance,
          queuedAssets,
          reservedRedemptionAssets,
          pendingWithdrawalLiability: withdrawalLiability,
          txHash: result.txHash,
          error: confirmResult.error,
          details: "Capital recall transaction failed to confirm.",
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
        txHash: result.txHash,
        details: `Recalled ${formatUnits(recallAmount, USDC_DECIMALS)} USDC to restore withdrawal and queue coverage.`,
      };
    }

    const hasWithdrawalPressure = withdrawalLiability > 0n || reservedRedemptionAssets > 0n;
    const excessVaultBalance =
      params.vaultUsdcBalance > requiredVaultBalance
        ? params.vaultUsdcBalance - requiredVaultBalance
        : 0n;

    if (
      this.vaultConfig.defaultMode !== "live" ||
      !SUPPORTS_POLYMARKET_TRADING ||
      !this.adminKey ||
      hasWithdrawalPressure ||
      excessVaultBalance < minTransferAmount ||
      excessVaultBalance === 0n
    ) {
      return {
        success: true,
        action: "none",
        amount: 0n,
        requiredVaultBalance,
        queuedAssets,
        reservedRedemptionAssets,
        pendingWithdrawalLiability: withdrawalLiability,
        details: hasWithdrawalPressure
          ? "Withdrawal liabilities still exist, so excess vault cash remains in the vault."
          : "No deployable excess vault cash above liabilities and reserve buffer.",
      };
    }

    const walletClient = this.getAdminWalletClient();
    const result = await this.retryWithBackoff(() =>
      this.client.deployCapital(walletClient, excessVaultBalance),
    );
    if (!result.success || !result.txHash) {
      return {
        success: false,
        action: "none",
        amount: 0n,
        requiredVaultBalance,
        queuedAssets,
        reservedRedemptionAssets,
        pendingWithdrawalLiability: withdrawalLiability,
        error: result.error,
        details: "Failed to deploy excess vault cash to the trading safe.",
      };
    }

    const confirmResult = await this.retryWithBackoff(() =>
      this.client.waitForTransaction(result.txHash!),
    );
    if (!confirmResult.success) {
      return {
        success: false,
        action: "none",
        amount: 0n,
        requiredVaultBalance,
        queuedAssets,
        reservedRedemptionAssets,
        pendingWithdrawalLiability: withdrawalLiability,
        txHash: result.txHash,
        error: confirmResult.error,
        details: "Capital deployment transaction failed to confirm.",
      };
    }

    return {
      success: true,
      action: "allocated",
      amount: excessVaultBalance,
      requiredVaultBalance,
      queuedAssets,
      reservedRedemptionAssets,
      pendingWithdrawalLiability: withdrawalLiability,
      txHash: result.txHash,
      details: `Deployed ${formatUnits(excessVaultBalance, USDC_DECIMALS)} USDC of excess vault cash to the trading safe.`,
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
      cancelBeforeSettlement: false,
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
