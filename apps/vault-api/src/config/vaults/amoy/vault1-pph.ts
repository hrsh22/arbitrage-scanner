import type { VaultInstanceConfig, VaultMode } from "../../types.js";

/**
 * Amoy Testnet Vault Configuration
 *
 * Deployed vault on Amoy (Polygon testnet).
 *
 * Amoy USDC: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
 * Vault: 0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D
 * Safe/Trading Funder: 0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214
 */
const config: VaultInstanceConfig = {
  id: 1,
  slug: "sisyphus-vault-amoy",
  name: "Sisyphus Vault (Amoy)",
  enabled: true, // Enabled after successful deployment
  type: "custom",
  network: "amoy",
  profile: {
    strategy: "external-ai",
    strategyLabel: "Double or Nothing BTC 15m",
    description: "Amoy testnet deployment - External AI agent trading Bitcoin 15-minute markets",
    longDescription:
      "Amoy testnet version of Sisyphus Vault. External AI agent managing the vault's Polymarket Safe account with a high-risk, double-or-nothing strategy on Bitcoin 15-minute markets.",
    riskLevel: "high",
    minDeposit: 1,
    maxDeposit: 1000000000,
    fees: {
      management: 0,
      performance: 0,
      withdrawal: 50,
    },
  },

  // Deployed contract addresses
  vaultAddress: "0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D",
  safeAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",

  allocatorNavSignerKeyEnv: "AMOY_VAULT_1_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "AMOY_VAULT_1_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "AMOY_VAULT_1_TRADING_SIGNER_KEY",
  settlerKeyEnv: "AMOY_VAULT_1_SETTLER_KEY",
  tradingSignatureType: 2,
  tradingFunderAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",
  singleSafeMode: false,
  tradingSafeAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",

  customVaultConfig: {
    epochDurationSeconds: 3600,
    navStalenessThresholdSeconds: 3600,
    minClaimThresholdUsdc: 1000000,
    balancedUpfrontBps: 0,
  },

  betSize: 1.0,
  dailyBudget: Infinity,
  minOdds: 0.9,
  maxOdds: 0.995,
  maxHoursGeneral: 1,
  maxHoursForHighOdds: 1,
  highOddsThreshold: 0.99,
  marketFetchMaxEvents: 2000,
  categoryTimeLimits: {
    crypto: 1,
    sports: 1,
    esports: 0.5,
  },
  skipCategories: ["crypto", "up-or-down", "weather"],
  minWalletReserve: 0,
  maxDailyLoss: Infinity,
  enableEarlyExit: true,
  earlyExitMinPrice: 0.9995,
  useMarketOrders: true,
  vaultReserveUsdc: 0,
  minAllocationAmountUsdc: 1,
  maxDeployedRatio: 1.0,
  autoLiquidityManagement: true,
  enforceEpochBoundarySafety: true,
  epochBoundarySafetyBufferMinutes: 5,

  hedging: {
    enabled: false,
    dropThresholdPercent: 60,
    multiplier: 2,
    spreadTolerance: 0.1,
    minPositionAgeMinutes: 0,
    onlyNearResolution: false,
    nearResolutionMinutes: 60,
    skipCategories: ["sports", "nfl", "nba"],
  },

  navRefreshIntervalMin: 2,
  reconciliationIntervalMin: 2,
  tradingScanIntervalMin: 1,
  resolutionCheckIntervalMin: 5,

  defaultMode: "live" as VaultMode,
};

export default config;
