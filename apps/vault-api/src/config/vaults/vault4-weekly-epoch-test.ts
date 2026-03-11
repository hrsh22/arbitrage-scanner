import type { VaultInstanceConfig, VaultMode } from "../types.js";

/**
 * Weekly Epoch Vault - Test Profile
 *
 * Custom ERC7540-style async vault with 15-minute redemption epochs.
 * This is the local test deployment for development on Anvil.
 *
 * Epoch duration: 15 minutes (900 seconds)
 * Asset: USDC.e (local/mock)
 * Type: custom vault with rapid settlement for dev/testing
 */
const config: VaultInstanceConfig = {
  id: 4,
  slug: "weekly-epoch-vault-test",
  name: "Weekly Epoch Vault (Test)",
  enabled: false, // Enable after deployment
  type: "custom",
  profile: {
    strategy: "weekly-epoch",
    strategyLabel: "15min Epoch Redemptions (Test)",
    description: "Local test deployment with 15-minute epochs for development",
    longDescription:
      "Local development environment for the Weekly Epoch Vault with 15-minute epochs. " +
      "Designed for rapid iteration and testing on local Anvil. " +
      "All state resets on chain restart.",
    riskLevel: "medium",
    minDeposit: 0.001,
    maxDeposit: 10000,
    fees: {
      management: 0,
      performance: 0,
      withdrawal: 0,
    },
  },

  // Contract addresses - populated after deployment
  vaultAddress:
    process.env.WEEKLY_EPOCH_TEST_VAULT_ADDRESS || "0x0000000000000000000000000000000000000003",

  // Custom vault configuration
  customVaultConfig: {
    navSnapshotAddress: process.env.WEEKLY_EPOCH_TEST_NAV_SNAPSHOT_ADDRESS,
    epochDurationSeconds: 900, // 15 minutes
    navStalenessThresholdSeconds: 60, // 1 minute
  },

  safeAddress:
    process.env.WEEKLY_EPOCH_TEST_SAFE_ADDRESS || "0x0000000000000000000000000000000000000000",

  // Role-based identity
  allocatorNavSignerKeyEnv: "WEEKLY_EPOCH_TEST_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "WEEKLY_EPOCH_TEST_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "WEEKLY_EPOCH_TEST_TRADING_SIGNER_KEY",
  tradingFunderAddressEnv: "WEEKLY_EPOCH_TEST_TRADING_FUNDER_ADDRESS",
  tradingSignatureType: 0, // EOA for local testing
  singleSafeMode: false,

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

  // Intervals - epoch-focused (accelerated for testing)
  navRefreshIntervalMin: 0.5, // 30 seconds
  reconciliationIntervalMin: 1,
  tradingScanIntervalMin: 0, // No trading
  resolutionCheckIntervalMin: 0, // No resolutions

  defaultMode: (process.env.WEEKLY_EPOCH_TEST_VAULT_MODE || "simulation") as VaultMode,
};

export default config;
