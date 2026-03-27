import type { VaultInstanceConfig } from "../../types.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

const AMOY_VAULT_1_VAULT_ADDRESS = requireEnv("AMOY_VAULT_1_VAULT_ADDRESS");
const AMOY_VAULT_1_SAFE_ADDRESS = requireEnv("AMOY_VAULT_1_SAFE_ADDRESS");

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
    strategyLabel: "BTC 15m",
    description: "Amoy testnet deployment - External AI agent trading Bitcoin 15-minute markets",
    longDescription:
      "Amoy testnet version of Sisyphus Vault. External AI agent managing the vault's Polymarket Safe account with a high-risk, double-or-nothing strategy on Bitcoin 15-minute markets.",
    riskLevel: "high",
    minDeposit: 1,
    maxDeposit: 1000000000,
    fees: {
      management: 0,
      performance: 0,
      withdrawal: 0,
    },
  },

  vaultContractType: "flatBookVaultV2" as const,

  vaultAddress: AMOY_VAULT_1_VAULT_ADDRESS,
  safeAddress: AMOY_VAULT_1_SAFE_ADDRESS,

  allocatorNavSignerKeyEnv: "AMOY_VAULT_1_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "AMOY_VAULT_1_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "AMOY_VAULT_1_TRADING_SIGNER_KEY",
  settlerKeyEnv: "AMOY_VAULT_1_SETTLER_KEY",
  tradingSignatureType: 2,

  customVaultConfig: {
    epochDurationSeconds: 3600,
    navStalenessThresholdSeconds: 3600,
    minClaimThresholdUsdc: 1000000,
    balancedUpfrontBps: 0,
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
