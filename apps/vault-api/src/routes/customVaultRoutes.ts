/**
 * Custom Vault Routes (ERC7540-style Weekly Epoch with Boundary Settlement)
 *
 * API endpoints for redemption request, status, settlement, and claim operations
 * for the custom vault with weekly epochs.
 *
 * SUPPORTED ECONOMIC MODEL: Boundary Settlement Only
 * - Redemption requests are processed at epoch settlement boundary
 * - Full entitlement realization at settlement (no gradual realization)
 * - Cancellation is disabled - requests are irreversible once submitted
 * - Cross-epoch open positions are unsupported
 *
 * New Lifecycle Fields:
 * - queued: Assets waiting in deposit queue
 * - frozen: Assets frozen in pending epochs
 * - accrued: Total realized USDC accrued for user (settlement boundary only)
 * - claimed: Total USDC already claimed by user
 * - claimableNow: USDC available to claim right now
 * - minClaimThreshold: Minimum claim amount required
 *
 * Routes:
 * - POST /api/vaults/:vaultId/redeem - Create redemption request (irreversible)
 * - GET /api/vaults/:vaultId/requests/:requestId - Get request status
 * - GET /api/vaults/:vaultId/deposit-queue - Get deposit queue status (NEW)
 * - GET /api/vaults/:vaultId/tranche-status - Get tranche progress (NEW)
 * - GET /api/vaults/:vaultId/carry-eligibility - Get carry claim eligibility (NEW)
 * - POST /api/vaults/:vaultId/requests/:requestId/claim - Claim settled request
 * - GET /api/vaults/:vaultId/epochs/current - Current epoch status
 * - GET /api/vaults/:vaultId/epochs/:epochId - Specific epoch details
 * - GET /api/vaults/:vaultId/redemptions - User's redemption state
 * - GET /api/vaults/:vaultId/info - Vault metadata and capabilities
 *
 * UNSUPPORTED OPERATIONS (not implemented):
 * - Cancellation of pending requests (disabled at contract level)
 * - Gradual/partial realization between settlement boundaries
 * - Cross-epoch position accounting without settlement
 */

import { Router } from "express";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";
import { logger } from "../logger.js";
import { requireAuth } from "../middleware/auth.js";
import { getVaultProviderFactory } from "../services/vaultProviderFactory.js";
import type { IVaultProvider } from "../services/vaultProvider.js";
import { CustomVaultProvider } from "../services/customVaultProvider.js";
import { entitlementRepository } from "../repositories/entitlementRepository.js";
import { payoutRepository } from "../repositories/payoutRepository.js";
import {
  ClaimState,
  guardClaimOperation,
  mapRequestStatusToClaimState,
  ClaimOperation,
} from "../services/claimStateMachine.js";

// ============================================================================
// Validation Helpers
// ============================================================================

function isValidDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
}

function isValidEthereumAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

interface RedeemRequestValidation {
  shares: string;
  assetsEstimated?: string;
  controller?: string;
  owner?: string;
  operator?: string;
}

function validateRedeemRequest(body: unknown): RedeemRequestValidation | null {
  if (typeof body !== "object" || body === null) return null;
  const { shares, assetsEstimated, controller, owner, operator } = body as Record<string, unknown>;
  if (!isValidDecimalString(shares)) return null;
  if (assetsEstimated !== undefined && !isValidDecimalString(assetsEstimated)) return null;

  // ERC-7540: Validate address fields if provided
  if (controller !== undefined && !isValidEthereumAddress(controller)) return null;
  if (owner !== undefined && !isValidEthereumAddress(owner)) return null;
  if (operator !== undefined && !isValidEthereumAddress(operator)) return null;

  return { shares, assetsEstimated, controller, owner, operator };
}

function validateClaimRequest(body: unknown): { signature?: string } {
  if (typeof body !== "object" || body === null) return {};
  const { signature } = body as Record<string, unknown>;
  return { signature: typeof signature === "string" ? signature : undefined };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getCustomVaultProvider(vaultId: number): Promise<CustomVaultProvider | null> {
  const factory = getVaultProviderFactory();

  let provider: IVaultProvider;
  try {
    provider = factory.getProvider(vaultId);
  } catch {
    return null;
  }

  if (provider.providerType !== "custom") {
    return null;
  }

  return provider as CustomVaultProvider;
}

/**
 * Format redemption request with corrected lifecycle fields
 * Includes: entitlement, accrued, claimed, carryRemaining, claimableNow, minClaimThreshold, dustOverrideEligible
 */
async function formatRedemptionRequest(
  request: {
    requestId: string;
    vaultId: number;
    userAddress: Address;
    controller?: Address;
    owner?: Address;
    operator?: Address;
    epochId: number;
    shares: bigint;
    assetsEstimated: bigint;
    assetsActual?: bigint;
    status: string;
    createdAt: Date;
    settledAt?: Date;
    claimedAt?: Date;
    cancelledAt?: Date;
  },
  includeLifecycleFields = true,
): Promise<Record<string, unknown>> {
  const VAULT_SHARE_DECIMALS = 6;
  const USDC_DECIMALS = 6;

  const baseResponse = {
    id: request.requestId,
    requestId: request.requestId,
    vaultId: request.vaultId,
    userAddress: request.userAddress,
    controller: request.controller ?? request.userAddress,
    owner: request.owner ?? request.userAddress,
    operator: request.operator ?? null,
    epochId: request.epochId,
    targetEpoch: request.epochId,
    targetEpochEndTime: request.settledAt?.toISOString() ?? request.createdAt.toISOString(),
    settlementTime: request.settledAt?.toISOString() ?? null,
    shares: request.shares.toString(),
    sharesFormatted: formatUnits(request.shares, VAULT_SHARE_DECIMALS),
    assetsEstimated: request.assetsEstimated.toString(),
    assetsEstimatedFormatted: formatUnits(request.assetsEstimated, USDC_DECIMALS),
    claimableAssets: request.assetsActual?.toString() ?? null,
    claimableAssetsFormatted: request.assetsActual
      ? formatUnits(request.assetsActual, USDC_DECIMALS)
      : null,
    assetsActual: request.assetsActual?.toString(),
    assetsActualFormatted: request.assetsActual
      ? formatUnits(request.assetsActual, USDC_DECIMALS)
      : undefined,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    settledAt: request.settledAt?.toISOString(),
    claimedAt: request.claimedAt?.toISOString(),
    cancelledAt: request.cancelledAt?.toISOString(),
  };

  // Skip lifecycle fields if not requested
  if (!includeLifecycleFields) {
    return baseResponse;
  }

  // Fetch entitlement data for lifecycle fields
  try {
    const entitlement = await entitlementRepository.getByRequest(request.requestId);

    if (!entitlement) {
      return {
        ...baseResponse,
        // Lifecycle fields - default values when no entitlement exists
        queued: request.status === "pending" ? request.assetsEstimated.toString() : "0",
        queuedFormatted:
          request.status === "pending" ? formatUnits(request.assetsEstimated, USDC_DECIMALS) : "0",
        frozen: request.status === "claimable" ? request.shares.toString() : "0",
        frozenFormatted:
          request.status === "claimable" ? formatUnits(request.shares, VAULT_SHARE_DECIMALS) : "0",
        // Corrected lifecycle fields per T1 gap matrix
        entitlement: "0",
        entitlementFormatted: "0",
        accrued: "0",
        accruedFormatted: "0",
        claimed: "0",
        claimedFormatted: "0",
        carryRemaining: "0",
        carryRemainingFormatted: "0",
        claimableNow: "0",
        claimableNowFormatted: "0",
        minClaimThreshold: "1000000", // 1 USDC in 6 decimals
        minClaimThresholdFormatted: "1.0",
        dustOverrideEligible: false,
        lifecycleError: "No entitlement record found",
      };
    }

    // Calculate lifecycle fields from entitlement using CORRECTED schema fields
    // Schema: entitlement (total entitled), accrued (from realizations), claimed (by user), carryRemaining
    const entitlementAmount = BigInt(entitlement.entitlement);
    const accrued = BigInt(entitlement.accrued);
    const claimed = BigInt(entitlement.claimed);
    const carryRemaining = BigInt(entitlement.carryRemaining);
    const claimableNow = accrued - claimed;

    // Minimum claim threshold (1 USDC = 1000000 in 6 decimals)
    const minClaimThreshold = 1000000n;

    // Check if dust override is eligible (when claimable is below threshold but user wants to claim anyway)
    const dustOverrideEligible = claimableNow > 0n && claimableNow < minClaimThreshold;

    // Check if meets threshold for normal claim
    const meetsThreshold = claimableNow >= minClaimThreshold;

    // Determine queued vs frozen based on status
    const isPending = request.status === "pending";
    const isClaimable = request.status === "claimable";

    return {
      ...baseResponse,
      // Queued: assets waiting in queue (pending status)
      queued: isPending ? request.assetsEstimated.toString() : "0",
      queuedFormatted: isPending ? formatUnits(request.assetsEstimated, USDC_DECIMALS) : "0",
      // Frozen: shares frozen in epoch (claimable status)
      frozen: isClaimable ? request.shares.toString() : "0",
      frozenFormatted: isClaimable ? formatUnits(request.shares, VAULT_SHARE_DECIMALS) : "0",
      // Corrected lifecycle fields per T1 gap matrix
      entitlement: entitlementAmount.toString(),
      entitlementFormatted: formatUnits(entitlementAmount, USDC_DECIMALS),
      accrued: accrued.toString(),
      accruedFormatted: formatUnits(accrued, USDC_DECIMALS),
      claimed: claimed.toString(),
      claimedFormatted: formatUnits(claimed, USDC_DECIMALS),
      carryRemaining: carryRemaining.toString(),
      carryRemainingFormatted: formatUnits(carryRemaining, USDC_DECIMALS),
      claimableNow: claimableNow.toString(),
      claimableNowFormatted: formatUnits(claimableNow > 0n ? claimableNow : 0n, USDC_DECIMALS),
      minClaimThreshold: "1000000",
      minClaimThresholdFormatted: "1.0",
      dustOverrideEligible,
      meetsThreshold,
      // Additional metadata
      entitlementStatus: entitlement.status,
      sharesSubmitted: entitlement.sharesSubmitted,
      entitlementRatio: entitlement.entitlementRatio,
    };
  } catch (error) {
    logger.warn("CustomVault API: Failed to fetch lifecycle fields", {
      requestId: request.requestId,
      error: (error as Error).message,
    });

    // Return base response with default lifecycle fields on error
    return {
      ...baseResponse,
      queued: "0",
      queuedFormatted: "0",
      frozen: "0",
      frozenFormatted: "0",
      entitlement: "0",
      entitlementFormatted: "0",
      accrued: "0",
      accruedFormatted: "0",
      claimed: "0",
      claimedFormatted: "0",
      carryRemaining: "0",
      carryRemainingFormatted: "0",
      claimableNow: "0",
      claimableNowFormatted: "0",
      minClaimThreshold: "1000000",
      minClaimThresholdFormatted: "1.0",
      dustOverrideEligible: false,
      lifecycleError: (error as Error).message,
    };
  }
}

function formatEpochStatus(epochStatus: {
  epochId: number;
  startTime: Date;
  endTime: Date;
  settlementTime: Date;
  totalRequests: number;
  totalShares: bigint;
  settled: boolean;
  proRataRatio?: bigint;
  availableAssets?: bigint;
}) {
  const VAULT_SHARE_DECIMALS = 6;
  const USDC_DECIMALS = 6;

  const now = new Date();
  const isActive = now >= epochStatus.startTime && now < epochStatus.endTime;
  const isPast = now >= epochStatus.endTime;
  const timeRemainingMs = isPast ? 0 : epochStatus.endTime.getTime() - now.getTime();

  return {
    epochId: epochStatus.epochId,
    startTime: epochStatus.startTime.toISOString(),
    endTime: epochStatus.endTime.toISOString(),
    settlementTime: epochStatus.settlementTime.toISOString(),
    isActive,
    isPast,
    timeRemainingMs,
    timeRemainingFormatted: formatDuration(timeRemainingMs),
    totalRequests: epochStatus.totalRequests,
    totalShares: epochStatus.totalShares.toString(),
    totalSharesFormatted: formatUnits(epochStatus.totalShares, VAULT_SHARE_DECIMALS),
    settled: epochStatus.settled,
    proRataRatio: epochStatus.proRataRatio?.toString(),
    availableAssets: epochStatus.availableAssets?.toString(),
    availableAssetsFormatted: epochStatus.availableAssets
      ? formatUnits(epochStatus.availableAssets, USDC_DECIMALS)
      : undefined,
  };
}

function formatEpochHistoryItem(epoch: {
  epochId: bigint;
  startTime: bigint;
  endTime: bigint;
  epochOpenNAV: bigint;
  snapshotNAV: bigint;
  snapshotTimestamp: bigint;
  totalSharesPending: bigint;
  frozenShares: bigint;
  frozenAssets: bigint;
  proRataRatio: bigint;
  carryAccrued: bigint;
  cohortTotalEntitlement: bigint;
  cohortTotalAccrued: bigint;
  cohortTotalClaimed: bigint;
  cohortCarryRemaining: bigint;
  status: string;
}): Record<string, unknown> {
  return {
    epochId: Number(epoch.epochId),
    startTime: new Date(Number(epoch.startTime) * 1000).toISOString(),
    endTime: new Date(Number(epoch.endTime) * 1000).toISOString(),
    epochOpenNAV: epoch.epochOpenNAV.toString(),
    epochOpenNAVFormatted: formatUnits(epoch.epochOpenNAV, 18),
    snapshotNAV: epoch.snapshotNAV.toString(),
    snapshotNAVFormatted: formatUnits(epoch.snapshotNAV, 18),
    snapshotTimestamp:
      epoch.snapshotTimestamp > 0n
        ? new Date(Number(epoch.snapshotTimestamp) * 1000).toISOString()
        : null,
    totalSharesPending: epoch.totalSharesPending.toString(),
    totalSharesPendingFormatted: formatUnits(epoch.totalSharesPending, 6),
    frozenShares: epoch.frozenShares.toString(),
    frozenSharesFormatted: formatUnits(epoch.frozenShares, 6),
    frozenAssets: epoch.frozenAssets.toString(),
    frozenAssetsFormatted: formatUnits(epoch.frozenAssets, 6),
    proRataRatio: epoch.proRataRatio.toString(),
    proRataRatioFormatted: (Number(epoch.proRataRatio) / 1e18).toFixed(6),
    carryAccrued: epoch.carryAccrued.toString(),
    carryAccruedFormatted: formatUnits(epoch.carryAccrued, 6),
    cohortTotalEntitlement: epoch.cohortTotalEntitlement.toString(),
    cohortTotalEntitlementFormatted: formatUnits(epoch.cohortTotalEntitlement, 6),
    cohortTotalAccrued: epoch.cohortTotalAccrued.toString(),
    cohortTotalAccruedFormatted: formatUnits(epoch.cohortTotalAccrued, 6),
    cohortTotalClaimed: epoch.cohortTotalClaimed.toString(),
    cohortTotalClaimedFormatted: formatUnits(epoch.cohortTotalClaimed, 6),
    cohortCarryRemaining: epoch.cohortCarryRemaining.toString(),
    cohortCarryRemainingFormatted: formatUnits(epoch.cohortCarryRemaining, 6),
    status: epoch.status,
  };
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ============================================================================
// Route Handlers
// ============================================================================

export function buildCustomVaultRouter(): Router {
  const router = Router();

  router.post("/:vaultId/redeem", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const validation = validateRedeemRequest(req.body);
      if (!validation) {
        res.status(400).json({
          error: "Invalid request body",
          message:
            "shares must be a valid decimal string. controller, owner, operator must be valid Ethereum addresses if provided.",
        });
        return;
      }

      const {
        shares,
        assetsEstimated: clientAssetsEstimated,
        controller,
        owner,
        operator,
      } = validation;
      const userAddress = req.session!.address as Address;

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
          message: "Vault does not exist or is not configured for custom epoch-based redemption",
        });
        return;
      }

      const sharesUnits = parseUnits(shares, 6);
      if (sharesUnits <= 0n) {
        res.status(400).json({ error: "Shares must be greater than zero" });
        return;
      }

      const effectiveController = controller || userAddress;
      const effectiveOwner = owner || userAddress;

      if (operator && operator.toLowerCase() !== userAddress.toLowerCase()) {
        logger.info("CustomVault API: Redemption request with operator specified", {
          vaultId,
          userAddress,
          operator,
          controller: effectiveController,
          owner: effectiveOwner,
        });
      }

      const [vaultInfo, assetsEstimated] = await Promise.all([
        provider.getVaultInfo(),
        provider.previewRedeem(sharesUnits),
      ]);
      const sharesFloat = Number(formatUnits(sharesUnits, 6));
      const assetsEstimatedFloat = Number(formatUnits(assetsEstimated, 6));

      if (clientAssetsEstimated) {
        const clientEstimateUnits = parseUnits(clientAssetsEstimated, 6);
        const difference =
          assetsEstimated > clientEstimateUnits
            ? assetsEstimated - clientEstimateUnits
            : clientEstimateUnits - assetsEstimated;
        const slippagePercent =
          clientEstimateUnits > 0n ? Number(difference) / Number(clientEstimateUnits) : 0;

        if (slippagePercent > 0.01) {
          logger.info("CustomVault API: Redeem estimate differs from client", {
            vaultId,
            userAddress,
            clientEstimate: clientAssetsEstimated,
            serverEstimate: formatUnits(assetsEstimated, 6),
            slippagePercent,
          });
        }
      }

      const result = await provider.requestRedeem(userAddress, sharesUnits);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
          vaultId,
          shares,
        });
        return;
      }

      const estimatedSettlementTime = vaultInfo.epochInfo?.currentEpochEnd;

      logger.info("CustomVault API: Redemption request created", {
        vaultId,
        userAddress,
        controller: effectiveController,
        owner: effectiveOwner,
        operator,
        shares: sharesUnits.toString(),
        epochId: result.epochId,
      });

      res.status(201).json({
        success: true,
        requestId: result.requestId,
        epochId: result.epochId,
        vaultId,
        userAddress,
        controller: effectiveController,
        owner: effectiveOwner,
        operator: operator || null,
        shares: sharesUnits.toString(),
        sharesFormatted: shares,
        assetsEstimated: assetsEstimated.toString(),
        assetsEstimatedFormatted: formatUnits(assetsEstimated, 6),
        status: "pending",
        estimatedSettlementTime: estimatedSettlementTime?.toISOString(),
        message: "Redemption request created. Shares will be locked until epoch settlement.",
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to create redemption request", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to create redemption request",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/requests/:requestId", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const requestId = req.params.requestId;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      if (!requestId) {
        res.status(400).json({ error: "Request ID is required" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const statusResult = await provider.getRequestStatus(requestId);
      const formattedRequest = await formatRedemptionRequest(statusResult.request);

      res.json({
        success: true,
        request: formattedRequest,
        claimable: statusResult.claimable,
        estimatedSettlementTime: statusResult.estimatedSettlementTime?.toISOString(),
      });
    } catch (error) {
      if ((error as Error).message.includes("Request not found")) {
        res.status(404).json({
          error: "Request not found",
          requestId: req.params.requestId,
        });
        return;
      }

      logger.error("CustomVault API: Failed to get request status", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
        requestId: req.params.requestId,
      });
      res.status(500).json({
        error: "Failed to get request status",
        message: (error as Error).message,
      });
    }
  });

  router.post("/:vaultId/requests/:requestId/claim", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      const requestId = req.params.requestId!;
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      if (!requestId) {
        res.status(400).json({ error: "Request ID is required" });
        return;
      }

      validateClaimRequest(req.body);

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const statusResult = await provider.getRequestStatus(requestId);
      const request = statusResult.request;

      const isOwner = request.userAddress.toLowerCase() === userAddress.toLowerCase();
      const isController = request.controller?.toLowerCase() === userAddress.toLowerCase();
      const isOperator = request.operator?.toLowerCase() === userAddress.toLowerCase();

      const isAuthorized = isOwner || isController || isOperator;

      if (!isAuthorized) {
        logger.warn("CustomVault API: Unauthorized claim attempt blocked", {
          vaultId,
          requestId,
          requestOwner: request.userAddress,
          requestController: request.controller,
          requestOperator: request.operator,
          attemptingUser: userAddress,
        });
        res.status(403).json({
          success: false,
          error:
            "Not authorized: You are not the owner, controller, or authorized operator for this claim",
          requestId,
          vaultId,
        });
        return;
      }

      const currentState = mapRequestStatusToClaimState(request.status);

      const guard = guardClaimOperation({
        claimOwner: request.userAddress,
        requestingUser: userAddress,
        currentState,
        operation: ClaimOperation.CLAIM,
      });

      if (!guard.allowed) {
        logger.warn("CustomVault API: Claim operation blocked by state machine", {
          vaultId,
          requestId,
          userAddress,
          currentState,
          error: guard.error,
        });
        res.status(guard.code || 409).json({
          success: false,
          error: guard.error,
          requestId,
          vaultId,
          currentState,
        });
        return;
      }

      const entitlement = await entitlementRepository.getByRequest(requestId);
      if (entitlement) {
        const eligibility = await entitlementRepository.getClaimEligibility(entitlement.id);

        if (!eligibility.canClaim) {
          res.status(409).json({
            success: false,
            error: eligibility.error || "No claimable amount available",
            requestId,
            vaultId,
            entitlementStatus: eligibility.currentStatus,
            unclaimedAmount: eligibility.unclaimedAmount,
          });
          return;
        }

        // Check minimum claim threshold (1 USDC = 1000000 in 6 decimals)
        const minClaimThreshold = 1000000n;
        const claimableAmount = BigInt(eligibility.unclaimedAmount);
        if (claimableAmount < minClaimThreshold) {
          res.status(409).json({
            success: false,
            error: `Claim amount ${formatUnits(claimableAmount, 6)} USDC is below minimum threshold of 1.0 USDC. Micro partial claims are not supported.`,
            requestId,
            vaultId,
            claimableAmount: eligibility.unclaimedAmount,
            minClaimThreshold: "1000000",
            minClaimThresholdFormatted: "1.0",
          });
          return;
        }

        const capCheck = await payoutRepository.checkClaimCap(
          entitlement.id,
          eligibility.unclaimedAmount,
        );

        if (!capCheck.canProceed) {
          logger.error("CustomVault API: Claim would exceed entitlement cap", {
            requestId,
            entitlementId: entitlement.id,
            error: capCheck.error,
          });
          res.status(409).json({
            success: false,
            error: capCheck.error,
            requestId,
            vaultId,
            entitlementCap: capCheck.entitlementCap,
            currentClaimed: capCheck.currentCumulative,
          });
          return;
        }
      }

      const result = await provider.claimRedemption(requestId, userAddress);

      if (!result.success) {
        const statusCode = result.error?.includes("not yet settled")
          ? 409
          : result.error?.includes("Not authorized")
            ? 403
            : 400;

        res.status(statusCode).json({
          success: false,
          error: result.error,
          requestId,
          vaultId,
        });
        return;
      }

      if (entitlement) {
        const claimResult = await payoutRepository.claimAllForEntitlement(
          entitlement.id,
          result.txHash,
        );

        if (!claimResult.success) {
          logger.error("CustomVault API: Failed to record claim in entitlement ledger", {
            requestId,
            entitlementId: entitlement.id,
            error: claimResult.error,
          });
        }

        await entitlementRepository.incrementClaimed(
          entitlement.id,
          result.assetsReceived.toString(),
        );
      }

      logger.info("CustomVault API: Redemption claimed", {
        vaultId,
        requestId,
        userAddress,
        assetsReceived: result.assetsReceived.toString(),
        entitlementId: entitlement?.id,
      });

      res.json({
        success: true,
        requestId,
        vaultId,
        userAddress,
        assetsReceived: result.assetsReceived.toString(),
        assetsReceivedFormatted: formatUnits(result.assetsReceived, 6),
        txHash: result.txHash,
        currentState: ClaimState.CLOSED,
        message: "Redemption claimed successfully. Assets have been transferred to your wallet.",
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to claim redemption", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
        requestId: req.params.requestId,
      });
      res.status(500).json({
        error: "Failed to claim redemption",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/epochs/current", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const client = provider.getClient();
      const currentEpoch = await client.getCurrentEpoch();
      const epochStatus = await provider.getEpochStatus(Number(currentEpoch));

      if (!epochStatus) {
        res.status(500).json({
          error: "Failed to get current epoch status",
        });
        return;
      }

      res.json({
        success: true,
        epoch: formatEpochStatus(epochStatus),
        vaultId,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get current epoch", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get current epoch",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/epochs", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 6;
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 6;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({ error: `Custom vault ${vaultId} not found` });
        return;
      }

      const client = provider.getClient();
      const currentEpoch = Number(await client.getCurrentEpoch());
      const minEpoch = Math.max(0, currentEpoch - limit + 1);
      const epochIds: number[] = [];

      for (let epochId = currentEpoch; epochId >= minEpoch; epochId -= 1) {
        epochIds.push(epochId);
      }

      const epochs = await Promise.all(
        epochIds.map(async (epochId) => {
          const epoch = await client.getEpoch(BigInt(epochId));
          return epoch ? formatEpochHistoryItem(epoch) : null;
        }),
      );

      res.json({
        success: true,
        vaultId,
        currentEpochId: currentEpoch,
        epochs: epochs.filter((epoch): epoch is Record<string, unknown> => epoch !== null),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get epoch history", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get epoch history",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/epochs/:epochId", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const epochId = parseInt(req.params.epochId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      if (isNaN(epochId)) {
        res.status(400).json({ error: "Invalid epoch ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const epochStatus = await provider.getEpochStatus(epochId);

      if (!epochStatus) {
        res.status(404).json({
          error: `Epoch ${epochId} not found`,
        });
        return;
      }

      const canSettle = await provider.isSettlementReady(epochId);

      res.json({
        success: true,
        epoch: formatEpochStatus(epochStatus),
        canSettle,
        vaultId,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get epoch details", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
        epochId: req.params.epochId,
      });
      res.status(500).json({
        error: "Failed to get epoch details",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/redemptions", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const state = await provider.getUserRedemptionState(userAddress);

      const formattedPending = await Promise.all(
        state.pendingRequests.map((req) => formatRedemptionRequest(req)),
      );
      const formattedClaimable = await Promise.all(
        state.claimableRequests.map((req) => formatRedemptionRequest(req)),
      );

      res.json({
        success: true,
        vaultId,
        userAddress,
        pendingRequests: formattedPending,
        claimableRequests: formattedClaimable,
        totalSharesPending: state.totalSharesPending.toString(),
        totalSharesClaimable: state.totalSharesClaimable.toString(),
        estimatedAssetsPending: state.estimatedAssetsPending.toString(),
        estimatedAssetsPendingFormatted: formatUnits(state.estimatedAssetsPending, 6),
        estimatedAssetsClaimable: state.estimatedAssetsClaimable.toString(),
        estimatedAssetsClaimableFormatted: formatUnits(state.estimatedAssetsClaimable, 6),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get user redemption state", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get redemption state",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/info", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const [vaultInfo, capabilities] = await Promise.all([
        provider.getVaultInfo(),
        Promise.resolve(provider.getCapabilities()),
      ]);

      res.json({
        success: true,
        vault: {
          vaultId: vaultInfo.vaultId,
          vaultAddress: vaultInfo.vaultAddress,
          asset: vaultInfo.asset,
          assetDecimals: vaultInfo.assetDecimals,
          shareDecimals: vaultInfo.shareDecimals,
          totalAssets: vaultInfo.totalAssets.toString(),
          totalSupply: vaultInfo.totalSupply.toString(),
          sharePrice: vaultInfo.sharePrice,
          epochInfo: vaultInfo.epochInfo
            ? {
                currentEpochId: vaultInfo.epochInfo.currentEpochId,
                currentEpochStart: vaultInfo.epochInfo.currentEpochStart.toISOString(),
                currentEpochEnd: vaultInfo.epochInfo.currentEpochEnd.toISOString(),
                nextSettlementTime: vaultInfo.epochInfo.nextSettlementTime.toISOString(),
                epochDurationSeconds: vaultInfo.epochInfo.epochDurationSeconds,
              }
            : null,
          navLastUpdated: vaultInfo.navLastUpdated.toISOString(),
          navIsStale: vaultInfo.navIsStale,
        },
        capabilities,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get vault info", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get vault info",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // NEW: Deposit Queue Status Endpoint
  // Returns queued and frozen assets for the user
  // ============================================================================

  router.get("/:vaultId/deposit-queue", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const client = provider.getClient();
      const currentEpochId = await client.getCurrentEpoch();
      const targetEpochId = currentEpochId + 1n;
      const depositRequestId = await client.getDepositorEpochRequest(userAddress, targetEpochId);
      const depositRequest =
        depositRequestId > 0n ? await client.getDepositRequest(depositRequestId) : null;

      const [navStatus, epoch, targetEpoch, requestId] = await Promise.all([
        client.getNAVStatus(),
        client.getEpoch(currentEpochId),
        client.getEpoch(targetEpochId),
        client.getControllerRequestId(userAddress),
      ]);

      const queuedAssets = depositRequest && !depositRequest.processed ? depositRequest.assets : 0n;
      const estimateNav =
        targetEpoch?.epochOpenNAV && targetEpoch.epochOpenNAV > 0n
          ? targetEpoch.epochOpenNAV
          : navStatus.currentNAV;
      const estimatedQueuedShares =
        queuedAssets > 0n
          ? estimateNav > 0n
            ? (queuedAssets * 10n ** 18n) / estimateNav
            : queuedAssets
          : queuedAssets;

      const redemptionRequest =
        requestId > 0n ? await client.getRedemptionRequest(requestId) : null;
      const frozenShares =
        redemptionRequest?.status === "claimable" ? redemptionRequest.shares : 0n;
      const frozenAssets =
        redemptionRequest?.status === "claimable" ? redemptionRequest.assetsClaimable : 0n;

      const currentEpochStart = epoch
        ? new Date(Number(epoch.startTime) * 1000).toISOString()
        : null;
      const currentEpochEnd = epoch ? new Date(Number(epoch.endTime) * 1000).toISOString() : null;

      res.json({
        success: true,
        vaultId,
        userAddress,
        queued: queuedAssets.toString(),
        queuedFormatted: formatUnits(queuedAssets, 6),
        queuedShares: estimatedQueuedShares.toString(),
        queuedSharesFormatted: formatUnits(estimatedQueuedShares, 6),
        estimateNav: estimateNav.toString(),
        estimateNavFormatted: formatUnits(estimateNav, 18),
        estimateBasis:
          targetEpoch?.epochOpenNAV && targetEpoch.epochOpenNAV > 0n
            ? "Estimated from the target epoch open NAV."
            : "Estimated from current NAV. Final minted shares use the target epoch open NAV when the epoch activates.",
        frozen: frozenAssets.toString(),
        frozenFormatted: formatUnits(frozenAssets, 6),
        frozenShares: frozenShares.toString(),
        frozenSharesFormatted: formatUnits(frozenShares, 6),
        depositRequestId: depositRequestId > 0n ? depositRequestId.toString() : null,
        depositCreatedAt:
          depositRequest?.createdAt && depositRequest.createdAt > 0n
            ? new Date(Number(depositRequest.createdAt) * 1000).toISOString()
            : null,
        targetEpochId: Number(depositRequest?.targetEpoch ?? targetEpochId),
        currentEpochId: Number(currentEpochId),
        currentEpochStart,
        currentEpochEnd,
        nextEpochStart: currentEpochEnd,
        activationTime: currentEpochEnd,
        queueStatus: depositRequest ? (depositRequest.processed ? "processed" : "queued") : "idle",
        mintRule:
          "Deposits queue for the next epoch and shares mint when that epoch opens using the epoch-open NAV.",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get deposit queue status", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get deposit queue status",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // NEW: Tranche Status Endpoint
  // Returns tranche progress including realized positions
  // ============================================================================

  router.get("/:vaultId/tranche-status", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      const epochIdParam = req.query.epochId as string | undefined;

      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }

      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      // Get current epoch or specified epoch
      let epochId: number;
      if (epochIdParam) {
        epochId = parseInt(epochIdParam, 10);
        if (isNaN(epochId)) {
          res.status(400).json({ error: "Invalid epoch ID" });
          return;
        }
      } else {
        const client = provider.getClient();
        epochId = Number(await client.getCurrentEpoch());
      }

      // Get epoch status
      const epochStatus = await provider.getEpochStatus(epochId);

      // Get user's entitlements for this epoch
      const userEntitlements = await entitlementRepository.getByUser(
        userAddress,
        `epoch-${epochId}`,
      );

      // Aggregate entitlement data using CORRECTED lifecycle fields
      let totalEntitlement = 0n;
      let totalAccrued = 0n;
      let totalClaimed = 0n;
      let totalCarryRemaining = 0n;
      let totalClaimable = 0n;

      for (const entitlement of userEntitlements) {
        const entitlementAmount = BigInt(entitlement.entitlement);
        const accrued = BigInt(entitlement.accrued);
        const claimed = BigInt(entitlement.claimed);
        const carryRemaining = BigInt(entitlement.carryRemaining);
        totalEntitlement += entitlementAmount;
        totalAccrued += accrued;
        totalClaimed += claimed;
        totalCarryRemaining += carryRemaining;
        totalClaimable += accrued - claimed;
      }

      // Minimum claim threshold
      const minClaimThreshold = 1000000n;
      const dustOverrideEligible = totalClaimable > 0n && totalClaimable < minClaimThreshold;

      res.json({
        success: true,
        vaultId,
        userAddress,
        epochId,
        // Epoch status
        epochStatus: {
          status: epochStatus.settled ? "settled" : "pending",
          startTime: epochStatus.startTime.toISOString(),
          endTime: epochStatus.endTime.toISOString(),
          settled: epochStatus.settled,
          totalShares: epochStatus.totalShares.toString(),
          totalSharesFormatted: formatUnits(epochStatus.totalShares, 6),
        },
        // User's tranche position with corrected lifecycle fields
        tranchePosition: {
          // Total entitlement: total USDC entitled
          entitlement: totalEntitlement.toString(),
          entitlementFormatted: formatUnits(totalEntitlement, 6),
          // Accrued: total realized USDC
          accrued: totalAccrued.toString(),
          accruedFormatted: formatUnits(totalAccrued, 6),
          // Claimed: total USDC already claimed
          claimed: totalClaimed.toString(),
          claimedFormatted: formatUnits(totalClaimed, 6),
          // CarryRemaining: remaining to be carried
          carryRemaining: totalCarryRemaining.toString(),
          carryRemainingFormatted: formatUnits(totalCarryRemaining, 6),
          // ClaimableNow: USDC available to claim
          claimableNow: totalClaimable.toString(),
          claimableNowFormatted: formatUnits(totalClaimable > 0n ? totalClaimable : 0n, 6),
          // Minimum claim threshold
          minClaimThreshold: "1000000",
          minClaimThresholdFormatted: "1.0",
          dustOverrideEligible,
          meetsThreshold: totalClaimable >= minClaimThreshold,
        },
        // Entitlement count
        entitlementCount: userEntitlements.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get tranche status", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get tranche status",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // NEW: Carry Claim Eligibility Endpoint
  // Returns detailed eligibility for carry claims with lifecycle fields
  // ============================================================================

  router.get("/:vaultId/carry-eligibility", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      const requestIdParam = req.query.requestId as string | undefined;

      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }

      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      // If requestId provided, get specific eligibility
      if (requestIdParam) {
        const entitlement = await entitlementRepository.getByRequest(requestIdParam);

        if (!entitlement) {
          res.status(404).json({
            error: "Entitlement not found for request",
            requestId: requestIdParam,
          });
          return;
        }

        // Verify ownership
        if (entitlement.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
          res.status(403).json({
            error: "Not authorized to view this entitlement",
          });
          return;
        }

        // Get detailed eligibility using CORRECTED lifecycle fields
        const eligibility = await entitlementRepository.getClaimEligibility(entitlement.id);

        const entitlementAmount = BigInt(entitlement.entitlement);
        const accrued = BigInt(entitlement.accrued);
        const claimed = BigInt(entitlement.claimed);
        const carryRemaining = BigInt(entitlement.carryRemaining);
        const claimableNow = accrued - claimed;

        // Check against minimum threshold (1 USDC)
        const minThreshold = 1000000n;
        const meetsThreshold = claimableNow >= minThreshold;
        const dustOverrideEligible = claimableNow > 0n && claimableNow < minThreshold;

        res.json({
          success: true,
          vaultId,
          userAddress,
          requestId: requestIdParam,
          entitlementId: entitlement.id,
          // Corrected lifecycle fields per T1 gap matrix
          entitlement: entitlementAmount.toString(),
          entitlementFormatted: formatUnits(entitlementAmount, 6),
          accrued: accrued.toString(),
          accruedFormatted: formatUnits(accrued, 6),
          claimed: claimed.toString(),
          claimedFormatted: formatUnits(claimed, 6),
          carryRemaining: carryRemaining.toString(),
          carryRemainingFormatted: formatUnits(carryRemaining, 6),
          claimableNow: claimableNow.toString(),
          claimableNowFormatted: formatUnits(claimableNow > 0n ? claimableNow : 0n, 6),
          minClaimThreshold: "1000000",
          minClaimThresholdFormatted: "1.0",
          dustOverrideEligible,
          // Eligibility status
          eligible: eligibility.canClaim && meetsThreshold,
          meetsThreshold,
          canClaim: eligibility.canClaim,
          eligibilityError: eligibility.error,
          // Status info
          entitlementStatus: entitlement.status,
          currentClaimState: mapRequestStatusToClaimState(entitlement.status),
          timestamp: new Date().toISOString(),
        });
      } else {
        // Get all entitlements for user across all epochs
        const allEntitlements = await entitlementRepository.getByUser(userAddress);

        let totalEntitlement = 0n;
        let totalAccrued = 0n;
        let totalClaimed = 0n;
        let totalCarryRemaining = 0n;
        let totalClaimable = 0n;
        let eligibleCount = 0;

        const entitlementDetails = [];

        for (const entitlement of allEntitlements) {
          const eligibility = await entitlementRepository.getClaimEligibility(entitlement.id);
          const entitlementAmount = BigInt(entitlement.entitlement);
          const accrued = BigInt(entitlement.accrued);
          const claimed = BigInt(entitlement.claimed);
          const carryRemaining = BigInt(entitlement.carryRemaining);
          const claimable = accrued - claimed;
          const minThreshold = 1000000n;
          const meetsThreshold = claimable >= minThreshold;
          const dustOverrideEligible = claimable > 0n && claimable < minThreshold;
          const isEligible = eligibility.canClaim && meetsThreshold;

          if (isEligible) eligibleCount++;

          totalEntitlement += entitlementAmount;
          totalAccrued += accrued;
          totalClaimed += claimed;
          totalCarryRemaining += carryRemaining;
          totalClaimable += claimable;

          entitlementDetails.push({
            entitlementId: entitlement.id,
            requestId: entitlement.requestId,
            epochId: entitlement.epochId,
            entitlement: entitlementAmount.toString(),
            accrued: accrued.toString(),
            claimed: claimed.toString(),
            carryRemaining: carryRemaining.toString(),
            claimableNow: claimable.toString(),
            dustOverrideEligible,
            eligible: isEligible,
            status: entitlement.status,
          });
        }

        // Aggregate dust override eligibility
        const minThreshold = 1000000n;
        const dustOverrideEligible = totalClaimable > 0n && totalClaimable < minThreshold;

        res.json({
          success: true,
          vaultId,
          userAddress,
          // Aggregated lifecycle fields with corrected semantics
          entitlement: totalEntitlement.toString(),
          entitlementFormatted: formatUnits(totalEntitlement, 6),
          accrued: totalAccrued.toString(),
          accruedFormatted: formatUnits(totalAccrued, 6),
          claimed: totalClaimed.toString(),
          claimedFormatted: formatUnits(totalClaimed, 6),
          carryRemaining: totalCarryRemaining.toString(),
          carryRemainingFormatted: formatUnits(totalCarryRemaining, 6),
          claimableNow: totalClaimable.toString(),
          claimableNowFormatted: formatUnits(totalClaimable > 0n ? totalClaimable : 0n, 6),
          minClaimThreshold: "1000000",
          minClaimThresholdFormatted: "1.0",
          dustOverrideEligible,
          meetsThreshold: totalClaimable >= minThreshold,
          // Eligibility summary
          totalEntitlements: allEntitlements.length,
          eligibleCount,
          hasEligibleClaims: eligibleCount > 0,
          // Individual entitlement details
          entitlements: entitlementDetails,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error("CustomVault API: Failed to get carry eligibility", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get carry eligibility",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // LEGACY DEPRECATION: Explicit error for deprecated endpoints
  // ============================================================================

  router.post("/:vaultId/legacy-claim", requireAuth, async (req, res) => {
    res.status(410).json({
      error: "Gone",
      message:
        "This endpoint has been deprecated. Use POST /api/vaults/:vaultId/requests/:requestId/claim instead.",
      deprecated: true,
      replacementEndpoint: "/api/vaults/:vaultId/requests/:requestId/claim",
      documentation: "See API docs for new claim flow with lifecycle fields",
    });
  });

  router.get("/:vaultId/legacy-status", async (req, res) => {
    res.status(410).json({
      error: "Gone",
      message:
        "This endpoint has been deprecated. Use GET /api/vaults/:vaultId/redemptions instead.",
      deprecated: true,
      replacementEndpoint: "/api/vaults/:vaultId/redemptions",
      documentation: "See API docs for new redemption state with lifecycle fields",
    });
  });

  return router;
}
