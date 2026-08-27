/**
 * Vault Constants
 * Polygon contract addresses and vault configuration parameters
 *
 * NOTE: Network-specific configuration (chain ID, RPC URLs, explorer URLs) has moved to
 * config/network.ts. This file now exports network-aware values derived from the
 * VAULT_NETWORK environment variable.
 *
 * For direct network configuration access, import from config/network.ts:
 * import { getNetworkConfig, getNetworkConfigFromEnv } from "./config/network.js";
 */

import { getNetworkConfigFromEnv, getRpcUrlForNetwork } from "./config/network.js";

// Load network configuration based on VAULT_NETWORK env var
const networkConfig = getNetworkConfigFromEnv();

// ===== Network Configuration (from config/network.ts) =====

/** Current network chain ID (137 for mainnet, 80002 for Amoy) */
export const POLYGON_CHAIN_ID = networkConfig.chainId;

/** Current network RPC endpoint */
export const POLYGON_RPC_URL = getRpcUrlForNetwork(networkConfig.name);

/** Block explorer base URL for the current network */
export const EXPLORER_BASE_URL = networkConfig.explorerBaseUrl;

/** Current network name ("mainnet" | "amoy") */
export const VAULT_NETWORK = networkConfig.name;

/** Whether Polymarket trading is supported on the current network */
export const SUPPORTS_POLYMARKET_TRADING = networkConfig.supportsPolymarketTrading;

// ===== Contract Addresses (from network config) =====
// These addresses are network-specific and loaded from config/network.ts
// based on the VAULT_NETWORK environment variable.

/** Active Polymarket collateral token for the current network (pUSD on Polygon mainnet) */
export const COLLATERAL_ADDRESS = networkConfig.addresses.collateral;

/** Active Polymarket collateral display symbol */
export const COLLATERAL_SYMBOL = networkConfig.addresses.collateralSymbol;

/** Active Polymarket collateral decimals */
export const COLLATERAL_DECIMALS = networkConfig.addresses.collateralDecimals;

/** Legacy Polygon USDC.e address retained for migration/onramp flows only */
export const LEGACY_USDC_E_ADDRESS = networkConfig.addresses.legacyUsdcE;

/** User-facing vault deposit/withdraw token used by USDC.e helper entrypoints. */
export const USER_COLLATERAL_ADDRESS = LEGACY_USDC_E_ADDRESS;
export const USER_COLLATERAL_SYMBOL = "USDC.e";
export const USER_COLLATERAL_DECIMALS = 6;

/** Polymarket collateral onramp for legacy USDC.e -> pUSD conversion */
export const COLLATERAL_ONRAMP_ADDRESS = networkConfig.addresses.collateralOnramp;

/** Polymarket collateral offramp for pUSD -> legacy USDC.e conversion */
export const COLLATERAL_OFFRAMP_ADDRESS = networkConfig.addresses.collateralOfframp;

/** User-facing USDC.e token used by vault helper entrypoints. */
export const USDC_E_ADDRESS = USER_COLLATERAL_ADDRESS;

/** Conditional Token Framework (CTF) contract */
export const CTF_ADDRESS = networkConfig.addresses.ctf;

/** CTF Exchange for market order execution */
export const CTF_EXCHANGE_ADDRESS = networkConfig.addresses.ctfExchange;

/** NegRisk CTF Exchange for negative risk markets */
export const NEGRISK_CTF_EXCHANGE_ADDRESS = networkConfig.addresses.negRiskCtfExchange;

/** CLOB V2 exchange for market order execution */
export const EXCHANGE_V2_ADDRESS = networkConfig.addresses.exchangeV2;

/** CLOB V2 negative-risk exchange */
export const NEGRISK_EXCHANGE_V2_ADDRESS = networkConfig.addresses.negRiskExchangeV2;

/** NegRisk adapter for outcome token conversion */
export const NEGRISK_ADAPTER_ADDRESS = networkConfig.addresses.negRiskAdapter;

/** VaultV2 factory for vault creation */
export const VAULT_V2_FACTORY_ADDRESS = networkConfig.addresses.vaultV2Factory;

// ===== Vault Configuration Parameters =====

/** Maximum ratio of assets that can be deployed (25%) */
export const MAX_DEPLOYED_RATIO = 0.25;

export const WITHDRAWAL_FEE_BPS = 0;

/** NAV staleness threshold in seconds (1 hour) */
export const NAV_STALENESS_THRESHOLD = 3600;

// ===== Re-exports from network config for convenience =====

export {
  type NetworkType,
  type NetworkConfig,
  MAINNET_CONFIG,
  AMOY_CONFIG,
  NETWORK_CONFIGS,
  resolveNetworkType,
  getNetworkConfig,
  getRpcUrlForNetwork,
  getExplorerTxUrl,
  getExplorerAddressUrl,
  isValidChainIdForNetwork,
  validateRpcChainId,
  validateNetworkConfiguration,
  POLYGON_MAINNET_CHAIN_ID,
  POLYGON_AMOY_CHAIN_ID,
  polygon,
  polygonAmoy,
} from "./config/network.js";
