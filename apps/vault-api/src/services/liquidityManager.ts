import { createPublicClient, type Address } from "viem";
import { polygon } from "viem/chains";

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
import { createPolygonTransport } from "../rpcTransport.js";
import type { ReconciliationResult } from "../types.js";
import type { IVaultProvider } from "./vaultProvider.js";
import { getVaultProvider } from "./vaultProviderFactory.js";

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

export class LiquidityManager {
  private readonly publicClient;
  private readonly withdrawalRepo: WithdrawalRepository;
  private readonly vaultAddress: Address;
  private readonly safeAddress: Address;
  private readonly vaultId: number;
  private readonly provider: IVaultProvider;

  constructor(options: LiquidityManagerOptions = {}) {
    const config = options.config;
    const vaultAddress = config?.vaultAddress || env.VAULT_ADDRESS;
    const safeAddress = config?.safeAddress || env.SAFE_ADDRESS;
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
    this.publicClient = createPublicClient({
      chain: polygon,
      transport: createPolygonTransport(env.POLYGON_RPC_URL),
    });
    this.provider = getVaultProvider(this.vaultId);

    logger.info("LiquidityManager: Initialized (custom-only)", {
      vaultId: this.vaultId,
      vaultAddress: this.vaultAddress,
      safeAddress: this.safeAddress,
    });
  }

  async runReconciliation(): Promise<ReconciliationResult> {
    const startTime = Date.now();

    try {
      const vaultInfo = await this.provider.getVaultInfo();
      const epochInfo = vaultInfo.epochInfo;

      if (!epochInfo) {
        throw new Error("Custom vault missing epoch info");
      }

      const safeBalance = await this.getUsdcBalance(this.safeAddress);
      const safeBalanceUsdc = Number(safeBalance) / 10 ** USDC_DECIMALS;
      const vaultBalanceUsdc = Number(vaultInfo.totalAssets) / 10 ** USDC_DECIMALS;

      if (vaultInfo.navIsStale) {
        return {
          vaultBalance: vaultBalanceUsdc,
          safeBalance: safeBalanceUsdc,
          pendingWithdrawals: 0,
          action: "none",
          details: "Settlement blocked - NAV is stale. Update NAV before settlement.",
        };
      }

      const settlementReady = await this.provider.isSettlementReady();
      if (!settlementReady) {
        return {
          vaultBalance: vaultBalanceUsdc,
          safeBalance: safeBalanceUsdc,
          pendingWithdrawals: 0,
          action: "none",
          details: `Settlement not ready. Next settlement: ${epochInfo.nextSettlementTime.toISOString()}`,
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

      await this.syncSettledRequests(settlementResult.epochId);

      return {
        vaultBalance: vaultBalanceUsdc,
        safeBalance: safeBalanceUsdc,
        pendingWithdrawals: 0,
        action: "settled",
        amount: Number(settlementResult.totalAssets) / 10 ** USDC_DECIMALS,
        details: `Epoch ${settlementResult.epochId} settled. ${settlementResult.requestsSettled} requests processed (tx: ${settlementResult.txHash})`,
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


  async getSettlementReadiness(): Promise<{
    ready: boolean;
    reason?: string;
    epochId?: number;
    navFresh: boolean;
    epochEnded: boolean;
  }> {
    try {
      const vaultInfo = await this.provider.getVaultInfo();
      const epochInfo = vaultInfo.epochInfo;

      if (!epochInfo) {
        return {
          ready: false,
          reason: "No epoch info available",
          navFresh: !vaultInfo.navIsStale,
          epochEnded: false,
        };
      }

      const navFresh = !vaultInfo.navIsStale;
      const epochEnded = new Date() >= epochInfo.currentEpochEnd;
      const ready = navFresh && epochEnded;

      let reason: string | undefined;
      if (!ready) {
        reason = !navFresh
          ? "NAV is stale"
          : `Epoch ends at ${epochInfo.currentEpochEnd.toISOString()}`;
      }

      return {
        ready,
        reason,
        epochId: epochInfo.currentEpochId,
        navFresh,
        epochEnded,
      };
    } catch (error) {
      return {
        ready: false,
        reason: `Error: ${(error as Error).message}`,
        navFresh: false,
        epochEnded: false,
      };
    }
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
