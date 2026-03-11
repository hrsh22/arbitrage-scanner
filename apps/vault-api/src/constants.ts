/**
 * Vault Constants
 * Polygon contract addresses and vault configuration parameters
 */

// ===== Polygon Mainnet Contract Addresses =====

/** USDC.e (USDC from Ethereum, NOT native USDC) on Polygon */
export const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

/** Conditional Token Framework (CTF) contract */
export const CTF_ADDRESS = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";

/** CTF Exchange for market order execution */
export const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

/** NegRisk CTF Exchange for negative risk markets */
export const NEGRISK_CTF_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

/** NegRisk adapter for outcome token conversion */
export const NEGRISK_ADAPTER_ADDRESS = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

/** VaultV2 factory for vault creation */
export const VAULT_V2_FACTORY_ADDRESS = "0xA1D94F746dEfa1928926b84fB2596c06926C0405";

// ===== Vault Configuration Parameters =====

/** Maximum ratio of assets that can be deployed (25%) */
export const MAX_DEPLOYED_RATIO = 0.25;

/** Withdrawal fee in basis points (0.5% = 50 bps) */
export const WITHDRAWAL_FEE_BPS = 50;

/** NAV staleness threshold in seconds (1 hour) */
export const NAV_STALENESS_THRESHOLD = 3600;

// ===== Polygon Chain Configuration =====

/** Polygon chain ID */
export const POLYGON_CHAIN_ID = 137;

/** Polygon mainnet RPC endpoint */
export const POLYGON_RPC_URL = "https://polygon-rpc.com";
