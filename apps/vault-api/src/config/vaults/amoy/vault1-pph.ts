import type { VaultInstanceConfig, VaultMode } from "../../types.js";

/**
 * Vault Contract Selection
 *
 * This configuration supports TWO vault contract implementations:
 *
 * 1. LEGACY: EpochTrancheVault
 *    - Deployed at: 0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D
 *    - Status: retained for rollback/reference only
 *    - Features: Dual-safe architecture, tranche-based epochs
 *    - Deployment script: contracts/scripts/deployEpochTrancheVault.js
 *
 * 2. NEW: ClosedBookBatchVault (CURRENT STAGING ACTIVE)
 *    - Deployed at: 0x5B4db660d63FE0fcA4E345Aa0714699C2F274554
 *    - Status: deployed on Amoy and manually rehearsed end-to-end
 *    - Features: Closed-book batch processing, escrowed redemptions
 *    - Deployment script: contracts/scripts/deployClosedBookBatchVault.js
 *    - Differences from EpochTrancheVault:
 *      - No fee recipient constructor field
 *      - No minClaimThreshold parameter
 *      - No balancedUpfrontBps parameter
 *      - Simplified constructor (8 params vs 11 params)
 *
 * To switch to ClosedBookBatchVault:
 * 1. Deploy using: node contracts/scripts/deployClosedBookBatchVault.js --profile staging
 * 2. Update vaultAddress below with new deployment address
 * 3. Update vaultContractType to "closedBookBatchVault"
 * 4. Verify deployment with: ./contracts/scripts/verify-amoy-deployment.sh
 *
 * CURRENT STATE: ClosedBookBatchVault is the active Amoy staging flow.
 * Legacy EpochTrancheVault remains documented for rollback/reference.
 */

/**
 * Amoy Testnet Vault Configuration
 *
 * Deployed vault on Amoy (Polygon testnet).
 *
 * Amoy USDC: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
 * Vault: 0x5B4db660d63FE0fcA4E345Aa0714699C2F274554
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

  // Contract selection - explicit legacy vs new vault
  // Options: "epochTrancheVault" (legacy, rollback) | "closedBookBatchVault" (active staging flow)
  vaultContractType: "closedBookBatchVault" as const,

  // Deployed contract addresses - CURRENTLY USING ClosedBookBatchVault on Amoy staging
  // See vaultContractType above for selection mechanism
  //
  // ClosedBookBatchVault (ACTIVE STAGING):
  vaultAddress: "0x5B4db660d63FE0fcA4E345Aa0714699C2F274554",
  safeAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",
  tradingSafeAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",
  //
  // EpochTrancheVault (LEGACY ROLLBACK REFERENCE):
  // vaultAddress: "0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D",
  // safeAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",

  allocatorNavSignerKeyEnv: "AMOY_VAULT_1_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "AMOY_VAULT_1_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "AMOY_VAULT_1_TRADING_SIGNER_KEY",
  settlerKeyEnv: "AMOY_VAULT_1_SETTLER_KEY",
  tradingSignatureType: 2,
  tradingFunderAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",
  singleSafeMode: false,

  customVaultConfig: {
    epochDurationSeconds: 3600,
    navStalenessThresholdSeconds: 3600,
    // NOTE: minClaimThresholdUsdc and balancedUpfrontBps only apply to EpochTrancheVault
    // ClosedBookBatchVault does not use these parameters
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
