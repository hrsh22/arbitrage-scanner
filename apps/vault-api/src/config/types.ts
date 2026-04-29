/**
 * Vault configuration type system for vault instances.
 */

export type VaultMode = "simulation" | "live";
export type VaultType = "bot" | "agent" | "custom";
export type VaultRiskLevel = "low" | "medium" | "high";
export type VaultNetwork = "mainnet" | "amoy";

export interface VaultFeeConfig {
  management: number;
  performance: number;
  withdrawal: number;
}

export interface VaultMigrationConfig {
  enabled: boolean;
  phase: "usdc_e_to_pusd";
  depositsDisabled: boolean;
  title: string;
  message: string;
  startedAt?: string;
  targetAssetSymbol?: string;
  targetAssetAddress?: string;
}

export interface VaultProfile {
  strategy: string;
  strategyLabel: string;
  description: string;
  longDescription: string;
  riskLevel: VaultRiskLevel;
  minDeposit: number;
  maxDeposit: number;
  fees: VaultFeeConfig;
  tradingMetadata?: {
    assets: string[]; // e.g., ["btc"]
    platforms: string[]; // e.g., ["polymarket"]
    marketType?: string; // e.g., "15min"
  };
}

export interface HedgingConfig {
  enabled: boolean;
  dropThresholdPercent: number;
  multiplier: number;
  spreadTolerance: number;
  minPositionAgeMinutes: number;
  onlyNearResolution: boolean;
  nearResolutionMinutes: number;
  skipCategories: string[];
}

export interface VaultInstanceConfig {
  /**
   * Identity
   */
  id: number;
  slug?: string;
  name: string;
  enabled: boolean;
  type: VaultType;
  profile?: VaultProfile;
  migration?: VaultMigrationConfig;

  vaultContractType: "flatBookVaultV2";

  /**
   * Contracts (network-specific based on VAULT_NETWORK env var)
   */
  vaultAddress: string;
  safeAddress: string;
  network?: VaultNetwork; // Defaults to mainnet if not specified

  /**
   * Custom vault configuration (for type = "custom")
   */
  customVaultConfig?: {
    /** NavSnapshot contract address */
    navSnapshotAddress?: string;
    /** Epoch duration in seconds */
    epochDurationSeconds?: number;
    /** NAV staleness threshold in seconds */
    navStalenessThresholdSeconds?: number;
    /** Minimum claim threshold in USDC units (6 decimals). Default: 100 USDC */
    minClaimThresholdUsdc?: number;
    /** Balanced upfront fee in basis points. Default: 0 */
    balancedUpfrontBps?: number;
  };

  /**
   * Identity (Role-based keys)
   */
  allocatorNavSignerKeyEnv: string;
  safeOperatorKeyEnv: string;
  tradingSignerKeyEnv?: string;
  settlerKeyEnv?: string;
  tradingSignatureType?: 0 | 1 | 2 | 3;

  /**
   * Trading
   */
  betSize?: number;
  vaultReserveUsdc: number;
  minAllocationAmountUsdc: number;
  maxDeployedRatio: number; // 0.0 to 1.0 (100%)
  marketFetchMaxEvents?: number;
  autoLiquidityManagement?: boolean;
  enforceEpochBoundarySafety?: boolean;
  epochBoundarySafetyBufferMinutes?: number;

  /**
   * Hedging
   */
  hedging?: HedgingConfig;

  /**
   * Crons
   */
  navRefreshIntervalMin: number;
  reconciliationIntervalMin: number;
  tradingScanIntervalMin?: number;

  resolutionCheckIntervalMin: number;

  /**
   * Bot strategy parameters (for bot-type vaults)
   */
  minOdds?: number;
  maxOdds?: number;
  highOddsThreshold?: number;
  maxHoursForHighOdds?: number;
  maxHoursGeneral?: number;
  categoryTimeLimits?: Record<string, number>;
  skipCategories?: string[];
  maxDailyLoss?: number;
  dailyBudget?: number;
  minWalletReserve?: number;
  enableEarlyExit?: boolean;
  earlyExitMinPrice?: number;
  useMarketOrders?: boolean;

  /**
   * Mode
   */
  defaultMode?: VaultMode;

  /**
   * Starvation policy & emergency pause configuration (T5)
   */
  maxFlatteningWindowMs?: number; // Default: 1 hour (3600000ms)
  forceUnwindSlippageCap?: number; // Default: 5% (0.05)
  maxSlippageBreachCount?: number; // Default: 3
  allowOperatorOverride?: boolean; // Default: false
}
