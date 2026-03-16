/**
 * Liquidity Manager - Vault Liquidity and Settlement Coordination
 *
 * Manages vault liquidity operations including:
 * - Reconciliation between vault and trading safe balances
 * - Settlement readiness checks with flatness gating (T6)
 * - Order cancellation before settlement (T6)
 * - Capital recall/deploy operations
 *
 * CLOSE-ON-FLAT AUTOMATION (T6):
 * - Settlement is gated by flatness verification
 * - All resting orders are cancelled before settlement attempt
 * - Settlement cannot proceed until vault is confirmed flat
 * - Uses TradingOrchestrator for flatness detection and order management
 */

import { createPublicClient, formatUnits, parseUnits, type Address } from "viem";

import type { VaultInstanceConfig } from "../config/types.js";
import { USDC_E_ADDRESS } from "../constants.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { epochRepository } from "../repositories/epochRepository.js";
import {
  WithdrawalRepository,
  withdrawalRepository as defaultWithdrawalRepository,
  type VaultType,
} from "../repositories/withdrawalRepository.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { getNetworkConfigFromEnv } from "../config/network.js";
import type { ReconciliationResult } from "../types.js";
import type { CapitalRebalanceResult, IVaultProvider } from "./vaultProvider.js";
import { getVaultProvider } from "./vaultProviderFactory.js";
import { FlatnessDetector, type FlatnessCheckResult } from "./flatnessDetector.js";
import { getVaultConfig } from "../config/index.js";

const USDC_DECIMALS = 6;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface LiquidityManagerOptions {
  config?: VaultInstanceConfig;
  withdrawalRepo?: WithdrawalRepository;
  vaultType?: VaultType;
  vaultId?: number;
}

type FlatBookRiskState = "flat" | "risk_on" | "unknown";

type FlatBookLifecycleAction = "none" | "close_book" | "process_queue" | "reopen_idle_cycle";

export interface FlatBookLifecycleDecision {
  riskState: FlatBookRiskState;
  action: FlatBookLifecycleAction;
  batchStatus: string;
  hasActionableWork: boolean;
  reason: string;
  flatnessCheck?: FlatnessCheckResult;

  // API-facing lifecycle fields (task 6 substep 1)
  executionMode: "instant" | "queued" | "blocked";
  telemetryFresh: boolean;
  openPositionCount: number | null;
  liquidityMode: "vault_liquid" | "recall_required" | "queued_only";
  reopenReady: boolean;
}

export interface InstantWithdrawPreflightResult {
  ready: boolean;
  mode: "instant" | "queued";
  executionMode: "instant" | "queued" | "blocked";
  telemetryFresh: boolean;
  liquidityMode: "vault_liquid" | "recall_required" | "queued_only";
  triggeredRecall: boolean;
  reason: string;
  requestedAssets: number;
  vaultBalance: number;
  safeBalance: number;
  shortfall: number;
  recallTxHash?: string;
  error?: string;
}

export class LiquidityManager {
  private readonly publicClient;
  private readonly withdrawalRepo: WithdrawalRepository;
  private readonly vaultAddress: Address;
  private readonly safeAddress: Address;
  private readonly vaultId: number;
  private readonly provider: IVaultProvider;
  private readonly vaultConfig?: VaultInstanceConfig;
  private readonly flatnessDetector: FlatnessDetector;

  constructor(options: LiquidityManagerOptions = {}) {
    const config = options.config;
    const vaultAddress = config?.vaultAddress || env.VAULT_ADDRESS;
    const safeAddress = config?.tradingSafeAddress || config?.safeAddress || env.SAFE_ADDRESS;
    const vaultId = options.vaultId ?? config?.id;

    if (!vaultAddress || !safeAddress || vaultId === undefined) {
      throw new Error(
        "LiquidityManager: Missing required vault identity (vaultAddress, safeAddress, vaultId)",
      );
    }

    this.vaultAddress = vaultAddress as Address;
    this.safeAddress = safeAddress as Address;
    this.vaultId = vaultId;
    this.withdrawalRepo = options.withdrawalRepo ?? defaultWithdrawalRepository;
    const networkConfig = getNetworkConfigFromEnv();
    this.publicClient = createPublicClient({
      chain: networkConfig.chain,
      transport: createNetworkTransport(),
    });
    this.provider = getVaultProvider(this.vaultId);
    this.vaultConfig = config ?? getVaultConfig(this.vaultId);
    this.flatnessDetector = new FlatnessDetector();

    logger.info("LiquidityManager: Initialized (custom-only)", {
      vaultId: this.vaultId,
      vaultAddress: this.vaultAddress,
      safeAddress: this.safeAddress,
    });
  }

  async evaluateFlatBookLifecycle(): Promise<FlatBookLifecycleDecision> {
    const vaultInfo = await this.provider.getVaultInfo();
    const batchStatus = vaultInfo.batchInfo?.currentBatchStatus ?? "open";
    const hasActionableWork = await this.provider.hasActionableBatchWork(
      vaultInfo.batchInfo?.currentBatchId,
    );

    const computeFields = async (
      riskState: FlatBookRiskState,
      action: FlatBookLifecycleAction,
      flatnessCheck?: FlatnessCheckResult,
    ) => {
      // extract openPositionCount if available from flatness details
      let openPositionCount: number | null = null;
      if (flatnessCheck?.conditions) {
        const opCond = flatnessCheck.conditions.find((c) => c.name === "zero_open_positions");
        if (opCond && opCond.details) {
          const details = opCond.details as Record<string, unknown>;
          const maybe = details.openPositionCount;
          if (typeof maybe === "number") openPositionCount = maybe;
          else if (typeof maybe === "string") {
            const n = Number(maybe);
            if (!Number.isNaN(n)) openPositionCount = n;
          }
        }
      }

      const telemetryFresh = riskState !== "unknown";

      // execution mode rules
      let executionMode: "instant" | "queued" | "blocked" = "blocked";
      if (riskState === "unknown") {
        executionMode = "blocked";
      } else if (
        riskState === "risk_on" ||
        action === "process_queue" ||
        action === "reopen_idle_cycle"
      ) {
        executionMode = "queued";
      } else if (riskState === "flat" && action === "none") {
        executionMode = "instant";
      }

      let liquidityMode: "vault_liquid" | "recall_required" | "queued_only" = "vault_liquid";
      if (
        riskState === "unknown" ||
        riskState === "risk_on" ||
        action === "process_queue" ||
        action === "reopen_idle_cycle"
      ) {
        liquidityMode = "queued_only";
      } else if (riskState === "flat" && action === "none") {
        const [vaultBalance, safeBalance, pendingWithdrawalLiability] = await Promise.all([
          this.getUsdcBalance(this.vaultAddress),
          this.getUsdcBalance(this.safeAddress),
          this.provider.estimatePendingWithdrawalLiability(vaultInfo.batchInfo?.currentBatchId),
        ]);
        const availableInstantLiquidity =
          vaultBalance > pendingWithdrawalLiability
            ? vaultBalance - pendingWithdrawalLiability
            : 0n;
        if (pendingWithdrawalLiability > vaultBalance) {
          liquidityMode = "recall_required";
        } else if (availableInstantLiquidity === 0n && safeBalance > 0n) {
          liquidityMode = "recall_required";
        }
      }

      // reopen readiness
      const reopenReady = action === "reopen_idle_cycle";

      return {
        executionMode,
        telemetryFresh,
        openPositionCount,
        liquidityMode,
        reopenReady,
      } as const;
    };

    if (!this.vaultConfig) {
      const fields = await computeFields("unknown", "none", undefined);
      return {
        riskState: "unknown",
        action: "none",
        batchStatus,
        hasActionableWork,
        reason: "Vault config unavailable for flatness check",
        flatnessCheck: undefined,
        ...fields,
      } as FlatBookLifecycleDecision;
    }

    const tradingWalletAddress =
      this.vaultConfig.tradingSafeAddress ?? this.vaultConfig.safeAddress;
    const flatnessCheck = await this.flatnessDetector.checkFlatness(
      this.vaultConfig,
      tradingWalletAddress,
    );

    if (this.hasTelemetryErrors(flatnessCheck)) {
      const fields = await computeFields("unknown", "none", flatnessCheck);
      return {
        riskState: "unknown",
        action: "none",
        batchStatus,
        hasActionableWork,
        reason: "Flatness telemetry is stale or unavailable",
        flatnessCheck,
        ...fields,
      };
    }

    if (!flatnessCheck.isFlat) {
      const fields = await computeFields(
        "risk_on",
        batchStatus === "open" ? "close_book" : "none",
        flatnessCheck,
      );
      return {
        riskState: "risk_on",
        action: batchStatus === "open" ? "close_book" : "none",
        batchStatus,
        hasActionableWork,
        reason: "Flatness gate failed",
        flatnessCheck,
        ...fields,
      };
    }

    if (hasActionableWork) {
      const fields = await computeFields("flat", "process_queue", flatnessCheck);
      return {
        riskState: "flat",
        action: "process_queue",
        batchStatus,
        hasActionableWork,
        reason: "Vault is flat with actionable queue work",
        flatnessCheck,
        ...fields,
      };
    }

    if (this.isBatchClosed(batchStatus)) {
      const fields = await computeFields("flat", "reopen_idle_cycle", flatnessCheck);
      return {
        riskState: "flat",
        action: "reopen_idle_cycle",
        batchStatus,
        hasActionableWork,
        reason: "Vault is flat, queue is empty, and cycle remains closed",
        flatnessCheck,
        ...fields,
      };
    }

    const fields = await computeFields("flat", "none", flatnessCheck);
    return {
      riskState: "flat",
      action: "none",
      batchStatus,
      hasActionableWork,
      reason: "Vault is flat and already open",
      flatnessCheck,
      ...fields,
    };
  }

  async closeBook(): Promise<{
    success: boolean;
    txHash?: string;
    skipped?: boolean;
    error?: string;
  }> {
    return this.provider.closeBook();
  }

  async processQueue(): Promise<{
    success: boolean;
    txHash?: string;
    skipped?: boolean;
    error?: string;
  }> {
    return this.provider.processQueue();
  }

  async reopenIdleCycle(): Promise<{
    success: boolean;
    txHash?: string;
    skipped?: boolean;
    error?: string;
  }> {
    return this.provider.reopenIdleCycle();
  }

  async runReconciliation(): Promise<ReconciliationResult> {
    const startTime = Date.now();

    try {
      const vaultInfo = await this.provider.getVaultInfo();
      const batchInfo = vaultInfo.batchInfo;

      const [vaultBalance, safeBalance] = await Promise.all([
        this.getUsdcBalance(this.vaultAddress),
        this.getUsdcBalance(this.safeAddress),
      ]);
      const pendingWithdrawals =
        this.provider.providerType === "custom"
          ? []
          : await this.withdrawalRepo.getPendingRequests(this.vaultAddress);
      const pendingWithdrawalLiability =
        this.provider.providerType === "custom"
          ? await this.provider.estimatePendingWithdrawalLiability(batchInfo?.currentBatchId)
          : pendingWithdrawals.reduce(
              (sum, request) =>
                sum +
                BigInt(
                  Math.max(0, Math.round(Number(request.assetsEstimated) * 10 ** USDC_DECIMALS)),
                ),
              0n,
            );
      const safeBalanceUsdc = Number(safeBalance) / 10 ** USDC_DECIMALS;
      const vaultBalanceUsdc = Number(vaultBalance) / 10 ** USDC_DECIMALS;

      const rebalanceResult = await this.provider.rebalanceCapital({
        vaultUsdcBalance: vaultBalance,
        safeUsdcBalance: safeBalance,
        pendingWithdrawalLiability,
      });

      if (!rebalanceResult.success) {
        return {
          vaultBalance: vaultBalanceUsdc,
          safeBalance: safeBalanceUsdc,
          pendingWithdrawals: pendingWithdrawals.length,
          action: "none",
          details: `Liquidity rebalance failed: ${rebalanceResult.error ?? rebalanceResult.details}`,
        };
      }

      const rebalanceDetails =
        rebalanceResult.action !== "none" ? `${rebalanceResult.details}` : undefined;

      const postRebalanceVaultBalance =
        rebalanceResult.action !== "none"
          ? await this.getUsdcBalance(this.vaultAddress)
          : vaultBalance;

      const readyResult = await this.markPendingWithdrawalsReady({
        vaultInfo,
        vaultBalance: postRebalanceVaultBalance,
        safeBalance,
        pendingWithdrawalsCount: pendingWithdrawals.length,
        rebalanceDetails,
      });
      if (readyResult) {
        return readyResult;
      }

      if (vaultInfo.navIsStale) {
        return {
          vaultBalance: vaultBalanceUsdc,
          safeBalance: safeBalanceUsdc,
          pendingWithdrawals: pendingWithdrawals.length,
          action: rebalanceResult.action,
          amount:
            rebalanceResult.amount > 0n
              ? Number(rebalanceResult.amount) / 10 ** USDC_DECIMALS
              : undefined,
          details: rebalanceDetails
            ? `${rebalanceDetails} Settlement blocked - NAV is stale. Update NAV before settlement.`
            : "Settlement blocked - NAV is stale. Update NAV before settlement.",
        };
      }

      const settlementReady = await this.provider.isSettlementReady();
      if (!settlementReady) {
        return {
          vaultBalance: vaultBalanceUsdc,
          safeBalance: safeBalanceUsdc,
          pendingWithdrawals: pendingWithdrawals.length,
          action: rebalanceResult.action,
          amount:
            rebalanceResult.amount > 0n
              ? Number(rebalanceResult.amount) / 10 ** USDC_DECIMALS
              : undefined,
          details: rebalanceDetails
            ? `${rebalanceDetails} Settlement not ready. Current batch: ${batchInfo?.currentBatchId ?? "unknown"}`
            : `Settlement not ready. Current batch: ${batchInfo?.currentBatchId ?? "unknown"}`,
        };
      }

      const settlementResult = await this.provider.executeSettlement();
      if (!settlementResult.success) {
        return {
          vaultBalance: vaultBalanceUsdc,
          safeBalance: safeBalanceUsdc,
          pendingWithdrawals: settlementResult.requestsSettled,
          action: "none",
          details: `Settlement failed: ${settlementResult.error}`,
        };
      }

      if (settlementResult.requestsSettled > 0) {
        await this.syncSettledRequests(settlementResult.batchId);
      }

      const details =
        settlementResult.requestsSettled > 0
          ? `Cycle ${settlementResult.batchId} settled. ${settlementResult.requestsSettled} requests processed (tx: ${settlementResult.txHash})`
          : `Cycle ${settlementResult.batchId} advanced and deposit queue processed (tx: ${settlementResult.txHash})`;

      const postSettlementVaultBalance = await this.getUsdcBalance(this.vaultAddress);
      const postSettlementSafeBalance = await this.getUsdcBalance(this.safeAddress);
      const postSettlementRebalance = await this.provider.rebalanceCapital({
        vaultUsdcBalance: postSettlementVaultBalance,
        safeUsdcBalance: postSettlementSafeBalance,
        pendingWithdrawalLiability: 0n,
      });
      if (!postSettlementRebalance.success) {
        return {
          vaultBalance: Number(postSettlementVaultBalance) / 10 ** USDC_DECIMALS,
          safeBalance: Number(postSettlementSafeBalance) / 10 ** USDC_DECIMALS,
          pendingWithdrawals: pendingWithdrawals.length,
          action: "settled",
          amount: Number(settlementResult.totalAssets) / 10 ** USDC_DECIMALS,
          details: `${details} Post-settlement liquidity rebalance failed: ${postSettlementRebalance.error ?? postSettlementRebalance.details}`,
        };
      }
      const combinedDetails = [
        rebalanceDetails,
        details,
        postSettlementRebalance.action !== "none" ? postSettlementRebalance.details : undefined,
      ]
        .filter(Boolean)
        .join(" ");

      return {
        vaultBalance: vaultBalanceUsdc,
        safeBalance: safeBalanceUsdc,
        pendingWithdrawals: pendingWithdrawals.length,
        action: "settled",
        amount: Number(settlementResult.totalAssets) / 10 ** USDC_DECIMALS,
        details: combinedDetails,
      };
    } catch (error) {
      logger.error("LiquidityManager: Reconciliation failed", {
        vaultId: this.vaultId,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  async hasActionableBatchWork(): Promise<boolean> {
    return this.provider.hasActionableBatchWork();
  }

  async needsNavRefreshForActionableWork(): Promise<boolean> {
    return this.provider.needsNavRefreshForActionableWork();
  }

  async getSettlementReadiness(): Promise<{
    ready: boolean;
    reason?: string;
    batchId?: number;
    navFresh: boolean;
    actionable: boolean;
  }> {
    try {
      const vaultInfo = await this.provider.getVaultInfo();
      const batchInfo = vaultInfo.batchInfo;
      const providerReady = await this.provider.isSettlementReady();

      const navFresh = !vaultInfo.navIsStale;
      const currentBatchStatus = batchInfo?.currentBatchStatus ?? "open";
      const ready = navFresh && providerReady;

      let reason: string | undefined;
      if (!ready) {
        reason = !navFresh
          ? "NAV is stale"
          : `No actionable settlement work for batch state ${currentBatchStatus}`;
      }

      return {
        ready,
        reason,
        batchId: batchInfo?.currentBatchId,
        navFresh,
        actionable: providerReady,
      };
    } catch (error) {
      return {
        ready: false,
        reason: `Error: ${(error as Error).message}`,
        navFresh: false,
        actionable: false,
      };
    }
  }

  async preflightInstantWithdrawal(
    requestedAssets: bigint,
  ): Promise<InstantWithdrawPreflightResult> {
    const lifecycle = await this.evaluateFlatBookLifecycle();
    const [vaultBalance, safeBalance, pendingWithdrawalLiability] = await Promise.all([
      this.getUsdcBalance(this.vaultAddress),
      this.getUsdcBalance(this.safeAddress),
      this.provider.estimatePendingWithdrawalLiability(),
    ]);

    const otherWithdrawalLiability =
      pendingWithdrawalLiability > requestedAssets
        ? pendingWithdrawalLiability - requestedAssets
        : 0n;
    const totalRequiredVaultBalance = requestedAssets + otherWithdrawalLiability;
    const availableVaultLiquidity =
      vaultBalance > otherWithdrawalLiability ? vaultBalance - otherWithdrawalLiability : 0n;

    const shortfall =
      requestedAssets > availableVaultLiquidity ? requestedAssets - availableVaultLiquidity : 0n;
    const baseResult = {
      executionMode: lifecycle.executionMode,
      telemetryFresh: lifecycle.telemetryFresh,
      liquidityMode: lifecycle.liquidityMode,
      requestedAssets: this.toUsdc(requestedAssets),
      vaultBalance: this.toUsdc(vaultBalance),
      safeBalance: this.toUsdc(safeBalance),
      shortfall: this.toUsdc(shortfall),
    } as const;

    if (requestedAssets <= 0n) {
      return {
        ...baseResult,
        ready: false,
        mode: "queued",
        triggeredRecall: false,
        reason: "Invalid withdrawal amount",
        error: "Requested assets must be greater than zero",
      };
    }

    if (lifecycle.executionMode !== "instant") {
      return {
        ...baseResult,
        ready: false,
        mode: "queued",
        triggeredRecall: false,
        reason:
          lifecycle.executionMode === "blocked"
            ? "Instant withdraw disabled: telemetry stale or unknown"
            : "Instant withdraw disabled: vault is in queued lifecycle mode",
      };
    }

    if (shortfall <= 0n) {
      return {
        ...baseResult,
        ready: true,
        mode: "instant",
        triggeredRecall: false,
        reason: "Vault idle liquidity already covers this withdrawal",
      };
    }

    const providerWithOnDemandRecall = this.provider as IVaultProvider & {
      recallWithdrawalLiquidityOnDemand?: (params: {
        vaultUsdcBalance: bigint;
        safeUsdcBalance: bigint;
        requiredAssets: bigint;
      }) => Promise<CapitalRebalanceResult>;
    };

    if (typeof providerWithOnDemandRecall.recallWithdrawalLiquidityOnDemand !== "function") {
      return {
        ...baseResult,
        ready: false,
        mode: "queued",
        triggeredRecall: false,
        reason: "On-demand recall is unavailable for this vault provider",
      };
    }

    const recallResult = await providerWithOnDemandRecall.recallWithdrawalLiquidityOnDemand({
      vaultUsdcBalance: vaultBalance,
      safeUsdcBalance: safeBalance,
      requiredAssets: totalRequiredVaultBalance,
    });

    if (!recallResult.success) {
      return {
        ...baseResult,
        ready: false,
        mode: "queued",
        triggeredRecall: false,
        reason: "Liquidity recall failed",
        recallTxHash: recallResult.txHash,
        error: recallResult.error,
      };
    }

    const postRecallVaultBalance = await this.waitForVaultBalance(totalRequiredVaultBalance);
    const postRecallAvailableLiquidity =
      postRecallVaultBalance > otherWithdrawalLiability
        ? postRecallVaultBalance - otherWithdrawalLiability
        : 0n;
    const postRecallShortfall =
      requestedAssets > postRecallAvailableLiquidity
        ? requestedAssets - postRecallAvailableLiquidity
        : 0n;

    return {
      executionMode: lifecycle.executionMode,
      telemetryFresh: lifecycle.telemetryFresh,
      liquidityMode: lifecycle.liquidityMode,
      requestedAssets: this.toUsdc(requestedAssets),
      vaultBalance: this.toUsdc(postRecallVaultBalance),
      safeBalance: this.toUsdc(safeBalance),
      shortfall: this.toUsdc(postRecallShortfall),
      ready: postRecallShortfall <= 0n,
      mode: postRecallShortfall <= 0n ? "instant" : "queued",
      triggeredRecall: recallResult.action === "deallocated" && recallResult.amount > 0n,
      recallTxHash: recallResult.txHash,
      reason:
        postRecallShortfall <= 0n
          ? "Trading wallet recall completed and vault liquidity is ready"
          : "Recall submitted but vault liquidity is still short",
    };
  }

  async markPendingWithdrawalsReady(params?: {
    vaultInfo?: Awaited<ReturnType<IVaultProvider["getVaultInfo"]>>;
    vaultBalance?: bigint;
    safeBalance?: bigint;
    pendingWithdrawalsCount?: number;
    rebalanceDetails?: string;
  }): Promise<ReconciliationResult | null> {
    if (this.provider.providerType !== "custom") {
      return null;
    }

    const vaultInfo = params?.vaultInfo ?? (await this.provider.getVaultInfo());
    if (vaultInfo.navIsStale || vaultInfo.batchInfo?.currentBatchStatus !== "open") {
      return null;
    }

    const lifecycle = await this.evaluateFlatBookLifecycle();
    if (lifecycle.riskState !== "flat" || lifecycle.executionMode !== "instant") {
      return null;
    }

    const [pendingRequests, readyRequests, currentNav, vaultBalance, safeBalance] =
      await Promise.all([
        this.withdrawalRepo.getPendingRequests(this.vaultAddress),
        this.withdrawalRepo.getReadyRequests(this.vaultAddress),
        this.provider.getCurrentNav?.(),
        params?.vaultBalance !== undefined
          ? Promise.resolve(params.vaultBalance)
          : this.getUsdcBalance(this.vaultAddress),
        params?.safeBalance !== undefined
          ? Promise.resolve(params.safeBalance)
          : this.getUsdcBalance(this.safeAddress),
      ]);

    const head = pendingRequests[0];
    if (!head) {
      return null;
    }

    let requestedAssets = this.parseUsdcAmount(head.assetsEstimated);
    if (currentNav && currentNav > 0n) {
      const shares = parseUnits(head.shares, USDC_DECIMALS);
      const refreshedAssets = (shares * currentNav) / 10n ** 18n;
      if (refreshedAssets > 0n && refreshedAssets !== requestedAssets) {
        const oldValue = Number.parseFloat(head.assetsEstimated);
        const newValue = Number.parseFloat(formatUnits(refreshedAssets, USDC_DECIMALS));
        await this.withdrawalRepo.updateAssetsEstimated(
          head.requestId,
          formatUnits(refreshedAssets, USDC_DECIMALS),
          {
            timestamp: new Date(),
            oldValue: Number.isFinite(oldValue) ? oldValue : 0,
            newValue,
            reason: "worker_ready_refresh",
            source: "worker_queue",
          },
        );
        requestedAssets = refreshedAssets;
      }
    }

    const reservedReadyAssets = readyRequests.reduce(
      (sum, request) => sum + this.parseUsdcAmount(request.assetsEstimated),
      0n,
    );
    const availableVaultLiquidity =
      vaultBalance > reservedReadyAssets ? vaultBalance - reservedReadyAssets : 0n;

    if (requestedAssets <= 0n || availableVaultLiquidity < requestedAssets) {
      return null;
    }

    const transitionResult = await this.withdrawalRepo.markReadyIdempotent(head.requestId);
    if (!transitionResult.success) {
      return {
        vaultBalance: this.toUsdc(vaultBalance),
        safeBalance: this.toUsdc(safeBalance),
        pendingWithdrawals: params?.pendingWithdrawalsCount ?? pendingRequests.length,
        action: "none",
        details: `Failed to mark withdrawal ${head.requestId} ready: ${transitionResult.error}`,
      };
    }

    const details = [
      params?.rebalanceDetails,
      `Marked withdrawal ${head.requestId} as ready in FIFO order`,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      vaultBalance: this.toUsdc(vaultBalance),
      safeBalance: this.toUsdc(safeBalance),
      pendingWithdrawals: params?.pendingWithdrawalsCount ?? pendingRequests.length,
      action: "marked_ready",
      amount: this.toUsdc(requestedAssets),
      details,
    };
  }

  private hasTelemetryErrors(flatnessCheck: FlatnessCheckResult): boolean {
    const telemetryConditionNames = new Set([
      "zero_open_positions",
      "zero_resting_orders",
      "zero_non_dust_token_balances",
    ]);

    return flatnessCheck.conditions.some((condition) => {
      if (!telemetryConditionNames.has(condition.name)) {
        return false;
      }

      const details = condition.details as Record<string, unknown>;
      return (
        typeof details.error === "string" ||
        details.openPositionCount === null ||
        details.restingOrderCount === null ||
        details.nonDustTokenCount === null
      );
    });
  }

  private isBatchClosed(status: string): boolean {
    return status !== "open";
  }

  private parseUsdcAmount(value: string): bigint {
    return parseUnits(value, USDC_DECIMALS);
  }

  private async syncSettledRequests(epochId: number): Promise<void> {
    try {
      const settledRequests = await epochRepository.getRequestsByEpoch(
        epochId.toString(),
        "claimable",
      );
      for (const request of settledRequests) {
        await this.withdrawalRepo.markSettled(request.requestId, request.claimableAssets ?? "0");
      }
    } catch (error) {
      logger.error("LiquidityManager: Failed to sync settled requests", {
        epochId,
        error: (error as Error).message,
      });
    }
  }

  private async getUsdcBalance(account: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: USDC_E_ADDRESS as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account],
    })) as bigint;
  }

  private toUsdc(amount: bigint): number {
    return Number(amount) / 10 ** USDC_DECIMALS;
  }

  private async waitForVaultBalance(targetAssets: bigint): Promise<bigint> {
    const maxAttempts = 6;
    const delayMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const balance = await this.getUsdcBalance(this.vaultAddress);
      if (balance >= targetAssets) {
        return balance;
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return this.getUsdcBalance(this.vaultAddress);
  }
}

export function createLiquidityManager(
  config: VaultInstanceConfig,
  withdrawalRepo?: WithdrawalRepository,
  _vaultType?: VaultType,
  vaultId?: number,
): LiquidityManager {
  return new LiquidityManager({
    config,
    withdrawalRepo,
    vaultId,
  });
}
