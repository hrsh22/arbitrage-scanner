import type { VaultInstanceConfig, VaultMode } from "../../types.js";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const config: VaultInstanceConfig = {
  id: 1,
  slug: "sisyphus-vault",
  name: "Sisyphus Vault",
  enabled: true,
  type: "custom",
  network: "mainnet",
  profile: {
    strategy: "external-ai",
    strategyLabel: "Double or Nothing BTC 15m",
    description: "External AI agent trading high-risk Bitcoin 15-minute markets on Polygon",
    longDescription:
      "Sisyphus is an external AI agent managing the vault's Polymarket Safe account with a high-risk, double-or-nothing strategy on Bitcoin 15-minute markets. The system keeps NAV, position, and allocation tracking continuously updated for transparent monitoring.",
    riskLevel: "high",
    minDeposit: 1,
    maxDeposit: 1000000000,
    fees: {
      management: 0,
      performance: 0,
      withdrawal: 0,
    },
  },

  vaultAddress: "0x066A4678935b78FA4E89e914dBE8F077764F0c74",
  safeAddress: "0xc8447F7d4dF6d717684fC9A3d242ee7713F43927",
  allocatorNavSignerKeyEnv: "VAULT_1_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "VAULT_1_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "VAULT_1_TRADING_SIGNER_KEY",
  settlerKeyEnv: "VAULT_1_SETTLER_KEY",
  tradingSignatureType: 2,
  tradingFunderAddress: "0xc8447F7d4dF6d717684fC9A3d242ee7713F43927",
  singleSafeMode: true,

  customVaultConfig: {
    epochDurationSeconds: parsePositiveInt(process.env.VAULT_1_EPOCH_DURATION_SECONDS, 3600),
    navStalenessThresholdSeconds: 21600,
    minClaimThresholdUsdc: parsePositiveInt(process.env.VAULT_1_MIN_CLAIM_THRESHOLD, 100000000),
    balancedUpfrontBps: parsePositiveInt(process.env.VAULT_1_BALANCED_UPFRONT_BPS, 0),
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

  defaultMode: (process.env.VAULT_MODE || "simulation") as VaultMode,
};

export default config;
