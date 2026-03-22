/**
 * Flatness Detector Service
 *
 * Implements the five-condition flatness check that serves as the gate
 * for settlement execution in the closed-book batch vault.
 *
 * Flatness Definition (per T2 spec):
 * 1. Zero open Polymarket positions for the trading wallet
 * 2. Zero resting orders on the CLOB
 * 3. deployedCapital == 0 (from vault contract)
 * 4. Zero non-dust CTF/outcome-token balances
 * 5. Successful reconciliation pass
 *
 * The flatness check is mechanical - no operator override allowed.
 * Exact blocking conditions are returned in machine-readable form.
 */

import type { Address, Hex, PublicClient } from "viem";
import { createPublicClient, erc20Abi, formatUnits } from "viem";
import { logger } from "../logger.js";
import type { VaultInstanceConfig } from "../config/types.js";
import { positionFetcher, type OpenPosition } from "./positionFetcher.js";
import {
  createVaultTradingClient,
  getVaultTradingClient,
  VaultTradingClient,
} from "./tradingClient.js";
import { createNetworkTransport } from "../rpcTransport.js";
import { getNetworkConfigFromEnv, getRpcUrlForNetwork } from "../config/network.js";
import { USDC_E_ADDRESS, SUPPORTS_POLYMARKET_TRADING } from "../constants.js";
import { getVaultProvider } from "./vaultProviderFactory.js";

// ============================================================================
// Types
// ============================================================================

/** Individual flatness condition check result */
export interface FlatnessCondition {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
}

/** Complete flatness check result with machine-readable reasons */
export interface FlatnessCheckResult {
  isFlat: boolean;
  allConditionsPassed: boolean;
  conditions: FlatnessCondition[];
  blockingConditions: string[];
  timestamp: Date;
  vaultId: number;
  tradingWalletAddress?: string;
}

/** Flatness detector configuration */
export interface FlatnessDetectorConfig {
  /** Dust threshold for CTF token balances (in token units) */
  dustThresholdUsdc: number;
  /** Enable detailed logging */
  verboseLogging: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: FlatnessDetectorConfig = {
  dustThresholdUsdc: 0.01, // $0.01 USDC equivalent
  verboseLogging: true,
};

const USDC_DECIMALS = 6;

// ============================================================================
// Flatness Detector Service
// ============================================================================

export class FlatnessDetector {
  private readonly config: FlatnessDetectorConfig;
  private readonly tradingClient?: VaultTradingClient;

  constructor(config: Partial<FlatnessDetectorConfig> = {}, tradingClient?: VaultTradingClient) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tradingClient = tradingClient;
  }

  /**
   * Perform the five-condition flatness check.
   *
   * This is the main entry point for determining if the vault is "flat"
   * and ready for settlement. All five conditions must pass for flatness.
   *
   * @param vaultConfig - The vault instance configuration
   * @param tradingWalletAddress - The trading wallet/Safe address to check
   * @returns Complete flatness check result with machine-readable details
   */
  async checkFlatness(
    vaultConfig: VaultInstanceConfig,
    tradingWalletAddress?: string,
  ): Promise<FlatnessCheckResult> {
    const resolvedAddress = tradingWalletAddress ?? vaultConfig.safeAddress;
    const timestamp = new Date();

    logger.info("FlatnessDetector: Starting flatness check", {
      vaultId: vaultConfig.id,
      tradingWallet: resolvedAddress,
    });

    // Run all five condition checks in parallel where possible
    const [
      openPositionsCheck,
      restingOrdersCheck,
      deployedCapitalCheck,
      tokenBalancesCheck,
      reconciliationCheck,
    ] = await Promise.all([
      this.checkZeroOpenPositions(resolvedAddress),
      this.checkZeroRestingOrders(vaultConfig),
      this.checkZeroDeployedCapital(vaultConfig),
      this.checkZeroNonDustTokenBalances(resolvedAddress),
      this.checkSuccessfulReconciliation(vaultConfig),
    ]);

    const conditions: FlatnessCondition[] = [
      openPositionsCheck,
      restingOrdersCheck,
      deployedCapitalCheck,
      tokenBalancesCheck,
      reconciliationCheck,
    ];

    const blockingConditions = conditions.filter((c) => !c.passed).map((c) => c.name);

    const allConditionsPassed = blockingConditions.length === 0;

    // Log detailed results
    if (this.config.verboseLogging) {
      logger.info("FlatnessDetector: Check complete", {
        vaultId: vaultConfig.id,
        isFlat: allConditionsPassed,
        blockingConditions,
        conditions: conditions.map((c) => ({
          name: c.name,
          passed: c.passed,
          ...c.details,
        })),
      });
    }

    return {
      isFlat: allConditionsPassed,
      allConditionsPassed,
      conditions,
      blockingConditions,
      timestamp,
      vaultId: vaultConfig.id,
      tradingWalletAddress: resolvedAddress,
    };
  }

  /**
   * Condition 1: Zero open Polymarket positions for the trading wallet
   *
   * Uses the PositionFetcher to query the Polymarket Data API for any
   * positions with size > 0 that are not yet redeemable.
   */
  private async checkZeroOpenPositions(
    tradingWalletAddress: string | undefined,
  ): Promise<FlatnessCondition> {
    const conditionName = "zero_open_positions";

    if (!tradingWalletAddress) {
      return {
        name: conditionName,
        passed: false,
        details: {
          error: "No trading wallet address provided",
          openPositionCount: null,
        },
      };
    }

    // Skip if Polymarket trading is not supported on this network
    if (!SUPPORTS_POLYMARKET_TRADING) {
      logger.debug("FlatnessDetector: Skipping open positions check - unsupported network");
      return {
        name: conditionName,
        passed: true,
        details: {
          skipped: true,
          reason: "Polymarket trading not supported on current network",
          openPositionCount: 0,
        },
      };
    }

    try {
      const openPositions: OpenPosition[] =
        await positionFetcher.fetchOpenPositions(tradingWalletAddress);

      const passed = openPositions.length === 0;

      return {
        name: conditionName,
        passed,
        details: {
          openPositionCount: openPositions.length,
          positions: openPositions.map((p) => ({
            tokenId: p.tokenId,
            conditionId: p.conditionId,
            size: p.size,
            title: p.title,
          })),
        },
      };
    } catch (error) {
      logger.error("FlatnessDetector: Failed to check open positions", {
        tradingWalletAddress,
        error: (error as Error).message,
      });

      return {
        name: conditionName,
        passed: false,
        details: {
          error: (error as Error).message,
          openPositionCount: null,
        },
      };
    }
  }

  /**
   * Condition 2: Zero resting orders on the CLOB
   *
   * Uses the VaultTradingClient to check for any open/active orders
   * on the Polymarket CLOB.
   */
  private async checkZeroRestingOrders(
    vaultConfig: VaultInstanceConfig,
  ): Promise<FlatnessCondition> {
    const conditionName = "zero_resting_orders";

    // Skip if Polymarket trading is not supported on this network
    if (!SUPPORTS_POLYMARKET_TRADING) {
      logger.debug("FlatnessDetector: Skipping resting orders check - unsupported network");
      return {
        name: conditionName,
        passed: true,
        details: {
          skipped: true,
          reason: "Polymarket trading not supported on current network",
          restingOrderCount: 0,
        },
      };
    }

    try {
      const tradingClient = this.tradingClient ?? createVaultTradingClient(vaultConfig);

      // Ensure client is initialized before checking orders
      if (!tradingClient.isInitialized()) {
        await tradingClient.initialize();
      }

      const activeOrders = await tradingClient.getActiveOrders();
      const passed = activeOrders.length === 0;

      return {
        name: conditionName,
        passed,
        details: {
          restingOrderCount: activeOrders.length,
          orders: activeOrders.map((o) => ({
            orderId: o.id,
            tokenId:
              (o as unknown as { token_id?: string }).token_id ??
              (o as unknown as { tokenId?: string }).tokenId ??
              "unknown",
            side: o.side,
            price: o.price,
            size: (o as unknown as { original_size?: string }).original_size ?? "unknown",
          })),
        },
      };
    } catch (error) {
      logger.error("FlatnessDetector: Failed to check resting orders", {
        error: (error as Error).message,
      });

      return {
        name: conditionName,
        passed: false,
        details: {
          error: (error as Error).message,
          restingOrderCount: null,
        },
      };
    }
  }

  /**
   * Condition 3: deployedCapital == 0
   *
   * Queries the vault contract to verify that deployedCapital is zero,
   * indicating no capital is currently deployed to trading.
   */
  private async checkZeroDeployedCapital(
    vaultConfig: VaultInstanceConfig,
  ): Promise<FlatnessCondition> {
    const conditionName = "zero_deployed_capital";

    try {
      const provider = getVaultProvider(vaultConfig.id);
      const client = (
        provider as unknown as {
          getClient(): { getDeployedCapital?: () => Promise<bigint> };
        }
      ).getClient();
      const deployedCapital = client.getDeployedCapital ? await client.getDeployedCapital() : 0n;
      const deployedCapitalNum = Number(formatUnits(deployedCapital, USDC_DECIMALS));
      const passed = deployedCapital === 0n;

      return {
        name: conditionName,
        passed,
        details: {
          deployedCapital: deployedCapital.toString(),
          deployedCapitalUsdc: deployedCapitalNum,
        },
      };
    } catch (error) {
      logger.error("FlatnessDetector: Failed to check deployed capital", {
        vaultId: vaultConfig.id,
        error: (error as Error).message,
      });

      return {
        name: conditionName,
        passed: false,
        details: {
          error: (error as Error).message,
          deployedCapital: null,
        },
      };
    }
  }

  /**
   * Condition 4: Zero non-dust CTF/outcome-token balances
   *
   * Checks the trading wallet for any CTF (Conditional Tokens Framework)
   * token balances above the dust threshold.
   */
  private async checkZeroNonDustTokenBalances(
    tradingWalletAddress: string | undefined,
  ): Promise<FlatnessCondition> {
    const conditionName = "zero_non_dust_token_balances";

    if (!tradingWalletAddress) {
      return {
        name: conditionName,
        passed: false,
        details: {
          error: "No trading wallet address provided",
          nonDustTokenCount: null,
        },
      };
    }

    // Skip if Polymarket trading is not supported on this network
    if (!SUPPORTS_POLYMARKET_TRADING) {
      logger.debug("FlatnessDetector: Skipping token balances check - unsupported network");
      return {
        name: conditionName,
        passed: true,
        details: {
          skipped: true,
          reason: "Polymarket trading not supported on current network",
          nonDustTokenCount: 0,
        },
      };
    }

    try {
      // Get all positions (includes token balances)
      const allPositions = await positionFetcher.fetchAllPositions(tradingWalletAddress);

      // Filter for non-dust balances (size > dust threshold)
      const nonDustPositions = allPositions.filter((p) => p.size > this.config.dustThresholdUsdc);

      const passed = nonDustPositions.length === 0;

      return {
        name: conditionName,
        passed,
        details: {
          nonDustTokenCount: nonDustPositions.length,
          dustThresholdUsdc: this.config.dustThresholdUsdc,
          tokens: nonDustPositions.map((p) => ({
            tokenId: p.asset,
            conditionId: p.conditionId,
            size: p.size,
            title: p.title,
          })),
        },
      };
    } catch (error) {
      logger.error("FlatnessDetector: Failed to check token balances", {
        tradingWalletAddress,
        error: (error as Error).message,
      });

      return {
        name: conditionName,
        passed: false,
        details: {
          error: (error as Error).message,
          nonDustTokenCount: null,
        },
      };
    }
  }

  /**
   * Condition 5: Successful reconciliation pass
   *
   * Runs the entitlement repository reconciliation to verify
   * that the ledger is in a clean state with zero unexplained deltas.
   */
  private async checkSuccessfulReconciliation(
    vaultConfig: VaultInstanceConfig,
  ): Promise<FlatnessCondition> {
    const conditionName = "successful_reconciliation";

    try {
      // Import dynamically to avoid circular dependencies
      const { EntitlementRepository } = await import("../repositories/entitlementRepository.js");
      const repo = new EntitlementRepository();

      const provider = getVaultProvider(vaultConfig.id);
      const vaultInfo = await provider.getVaultInfo();
      const currentEpochId = vaultInfo.batchInfo?.currentBatchId;

      if (currentEpochId === undefined) {
        return {
          name: conditionName,
          passed: false,
          details: {
            error: "Could not determine current epoch ID",
          },
        };
      }

      const { reconciled, report } = await repo.isReconciled(currentEpochId.toString());

      return {
        name: conditionName,
        passed: reconciled,
        details: {
          reconciled,
          epochId: currentEpochId,
          totalEntitlements: report.totalEntitlements,
          matchingCount: report.matchingCount,
          mismatchCount: report.mismatchCount,
          unexplainedDeltas: report.summary.unexplainedDeltas,
          explainedDeltas: report.summary.explainedDeltas,
        },
      };
    } catch (error) {
      logger.error("FlatnessDetector: Failed to check reconciliation", {
        vaultId: vaultConfig.id,
        error: (error as Error).message,
      });

      return {
        name: conditionName,
        passed: false,
        details: {
          error: (error as Error).message,
        },
      };
    }
  }

  /**
   * Convenience method to check if flatness conditions are met
   * without returning full details.
   */
  async isFlat(vaultConfig: VaultInstanceConfig, tradingWalletAddress?: string): Promise<boolean> {
    const result = await this.checkFlatness(vaultConfig, tradingWalletAddress);
    return result.isFlat;
  }

  /**
   * Format flatness check result for logging/monitoring.
   */
  formatResultForLogging(result: FlatnessCheckResult): Record<string, unknown> {
    return {
      vaultId: result.vaultId,
      isFlat: result.isFlat,
      blockingConditions: result.blockingConditions,
      timestamp: result.timestamp.toISOString(),
      conditions: result.conditions.map((c) => ({
        name: c.name,
        passed: c.passed,
        ...c.details,
      })),
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let flatnessDetectorInstance: FlatnessDetector | null = null;

export function getFlatnessDetector(): FlatnessDetector {
  if (!flatnessDetectorInstance) {
    flatnessDetectorInstance = new FlatnessDetector();
  }
  return flatnessDetectorInstance;
}

export function createFlatnessDetector(
  config?: Partial<FlatnessDetectorConfig>,
  tradingClient?: VaultTradingClient,
): FlatnessDetector {
  return new FlatnessDetector(config, tradingClient);
}

// Types are already exported above
