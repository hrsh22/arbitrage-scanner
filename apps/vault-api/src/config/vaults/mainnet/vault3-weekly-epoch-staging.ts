import type { VaultInstanceConfig, VaultMode } from "../../types.js";

/**
 * Weekly Epoch Vault - Staging Profile
 *
 * Custom ERC7540-style async vault with 1-hour redemption epochs.
 * This is the staging deployment for testing on testnet.
 *
 * Epoch duration: 1 hour (3600 seconds)
 * Asset: USDC.e (testnet)
 * Type: custom vault with hourly settlement for rapid testing
 */
const config: VaultInstanceConfig = {
  id: 3,
  slug: "weekly-epoch-vault-staging",
  name: "Weekly Epoch Vault (Staging)",
  enabled: false, // Enable after deployment
  type: "custom",
  network: "mainnet",
  profile: {
    strategy: "weekly-epoch",
    strategyLabel: "Hourly Epoch Redemptions (Staging)",
    description: "Staging deployment with 1-hour epochs for rapid testing",
    longDescription:
      "Staging environment for the Weekly Epoch Vault with accelerated 1-hour epochs. " +
      "Allows rapid testing of request, settlement, and claim flows. " +
      "Use this for integration testing before production deployment.",
    riskLevel: "medium",
    minDeposit: 0.01,
    maxDeposit: 100000,
    fees: {
      management: 0,
      performance: 0,
      withdrawal: 0,
    },
  },

  // Contract addresses - populated after deployment
  vaultAddress: "0x0000000000000000000000000000000000000002",

  // Custom vault configuration
  customVaultConfig: {
    navSnapshotAddress: "0x0000000000000000000000000000000000000000",
    epochDurationSeconds: 3600, // 1 hour
    navStalenessThresholdSeconds: 300, // 5 minutes
  },

  safeAddress: "0x0000000000000000000000000000000000000000",

  // Role-based identity
  allocatorNavSignerKeyEnv: "WEEKLY_EPOCH_STAGING_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "WEEKLY_EPOCH_STAGING_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "WEEKLY_EPOCH_STAGING_TRADING_SIGNER_KEY",
  tradingFunderAddressEnv: "WEEKLY_EPOCH_STAGING_TRADING_FUNDER_ADDRESS",
  tradingSignatureType: 2, // Safe
  singleSafeMode: true,
  tradingFunderAddress: "0x0000000000000000000000000000000000000000",

  // Trading configuration - minimal for custom vault
  betSize: 0,
  dailyBudget: Infinity,
  minOdds: 0,
  maxOdds: 0,
  maxHoursGeneral: 0,
  maxHoursForHighOdds: 0,
  highOddsThreshold: 0,
  marketFetchMaxEvents: 100,
  categoryTimeLimits: {},
  skipCategories: [],
  minWalletReserve: 0,
  maxDailyLoss: Infinity,
  enableEarlyExit: false,
  earlyExitMinPrice: 0,
  useMarketOrders: false,
  vaultReserveUsdc: 0,
  minAllocationAmountUsdc: 0,
  maxDeployedRatio: 0,

  hedging: {
    enabled: false,
    dropThresholdPercent: 0,
    multiplier: 0,
    spreadTolerance: 0,
    minPositionAgeMinutes: 0,
    onlyNearResolution: false,
    nearResolutionMinutes: 0,
    skipCategories: [],
  },

  // Intervals - epoch-focused (accelerated for staging)
  navRefreshIntervalMin: 1,
  reconciliationIntervalMin: 2,
  tradingScanIntervalMin: 0, // No trading
  resolutionCheckIntervalMin: 0, // No resolutions

  defaultMode: (process.env.WEEKLY_EPOCH_STAGING_VAULT_MODE || "simulation") as VaultMode,
};

export default config;
