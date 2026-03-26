import type { VaultInstanceConfig } from "../../types.js";

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
    strategyLabel: "BTC 15m",
    description: "External AI agent trading high-risk Bitcoin 15-minute markets on Polygon",
    longDescription:
      "Sisyphus is an external AI agent managing the vault's Polymarket Safe account with a high-risk, double-or-nothing strategy on Bitcoin 15-minute markets. The system keeps NAV, position, and allocation tracking continuously updated for transparent monitoring.",
    riskLevel: "high",
    minDeposit: 1,
    maxDeposit: 100000,
    fees: {
      management: 0,
      performance: 0,
      withdrawal: 0,
    },
    tradingMetadata: {
      assets: ["btc"],
      platforms: ["polymarket"],
      marketType: "15min",
    },
  },

  vaultContractType: "flatBookVaultV2" as const,

  vaultAddress: "0xfE5F6D149148aD5F31f6868152698E19A0F73a58",
  safeAddress: "0xc8447F7d4dF6d717684fC9A3d242ee7713F43927",
  allocatorNavSignerKeyEnv: "VAULT_1_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "VAULT_1_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "VAULT_1_TRADING_SIGNER_KEY",
  settlerKeyEnv: "VAULT_1_SETTLER_KEY",
  tradingSignatureType: 2,

  customVaultConfig: {
    epochDurationSeconds: parsePositiveInt(process.env.VAULT_1_EPOCH_DURATION_SECONDS, 3600),
    navStalenessThresholdSeconds: 3600,
    minClaimThresholdUsdc: parsePositiveInt(process.env.VAULT_1_MIN_CLAIM_THRESHOLD, 100000000),
    balancedUpfrontBps: parsePositiveInt(process.env.VAULT_1_BALANCED_UPFRONT_BPS, 0),
  },

  vaultReserveUsdc: 0,
  minAllocationAmountUsdc: 1,
  maxDeployedRatio: 1.0,
  autoLiquidityManagement: true,
  enforceEpochBoundarySafety: true,
  epochBoundarySafetyBufferMinutes: 5,

  navRefreshIntervalMin: 2,
  reconciliationIntervalMin: 2,
  resolutionCheckIntervalMin: 5,
};

export default config;
