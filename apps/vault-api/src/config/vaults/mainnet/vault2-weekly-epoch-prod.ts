import type { VaultInstanceConfig, VaultMode } from "../../types.js";

/**
 * Weekly Epoch Vault - Production Profile
 *
 * Custom ERC7540-style async vault with 7-day redemption epochs.
 * This is the production deployment on Polygon mainnet.
 *
 * Epoch duration: 7 days (604800 seconds)
 * Asset: USDC.e
 * Type: custom vault with weekly settlement
 */
const config: VaultInstanceConfig = {
  id: 2,
  slug: "weekly-epoch-vault",
  name: "Weekly Epoch Vault",
  enabled: false, // Enable after deployment
  type: "custom",
  network: "mainnet",
  profile: {
    strategy: "weekly-epoch",
    strategyLabel: "Weekly Epoch Redemptions",
    description:
      "Custom async vault with fixed 7-day redemption epochs for deterministic settlement",
    longDescription:
      "A custom ERC7540-style vault that processes redemption requests in fixed weekly epochs. " +
      "Users request redemptions which settle at epoch boundaries, with pro-rata distribution " +
      "if liquid assets are insufficient. Settlement requires fresh NAV and provides full " +
      "transparency on claim timing and amounts.",
    riskLevel: "medium",
    minDeposit: 1,
    maxDeposit: 10000000,
    fees: {
      management: 0,
      performance: 0,
      withdrawal: 0,
    },
  },

  // Contract addresses - populated after deployment
  vaultAddress: "0x0000000000000000000000000000000000000001",

  // Custom vault configuration
  customVaultConfig: {
    navSnapshotAddress: "0x0000000000000000000000000000000000000000",
    epochDurationSeconds: 604800, // 7 days
    navStalenessThresholdSeconds: 21600, // 6 hours
  },

  safeAddress: "0x0000000000000000000000000000000000000000",

  // Role-based identity
  allocatorNavSignerKeyEnv: "WEEKLY_EPOCH_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "WEEKLY_EPOCH_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "WEEKLY_EPOCH_TRADING_SIGNER_KEY",
  tradingFunderAddressEnv: "WEEKLY_EPOCH_TRADING_FUNDER_ADDRESS",
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

  // Intervals - epoch-focused
  navRefreshIntervalMin: 5,
  reconciliationIntervalMin: 10,
  tradingScanIntervalMin: 0, // No trading
  resolutionCheckIntervalMin: 0, // No resolutions

  defaultMode: (process.env.WEEKLY_EPOCH_VAULT_MODE || "simulation") as VaultMode,
};

export default config;
