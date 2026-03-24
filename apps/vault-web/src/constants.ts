/**
 * Vault Web Constants
 * Static configuration for vault-web frontend
 *
 * NOTE: Network-specific configuration (chain ID, RPC URLs, explorer URLs) has moved to
 * lib/network.ts. This file now exports network-aware values derived from the
 * NEXT_PUBLIC_VAULT_NETWORK environment variable.
 *
 * For direct network configuration access, import from lib/network.ts:
 * import { getNetworkConfig, getNetworkConfigFromEnv } from "@/lib/network";
 */

import { getNetworkConfigFromEnv, getRpcUrlForNetwork } from "./lib/network";

// Load network configuration based on NEXT_PUBLIC_VAULT_NETWORK env var
const networkConfig = getNetworkConfigFromEnv();

// ===== Network Configuration (from lib/network.ts) =====

/** Current network chain ID (137 for mainnet, 80002 for Amoy) */
export const POLYGON_CHAIN_ID = networkConfig.chainId;

/** Current network RPC endpoint */
export const POLYGON_RPC_URL = getRpcUrlForNetwork(networkConfig.name);

/** Current network name ("mainnet" | "amoy") */
export const VAULT_NETWORK = networkConfig.name;

/** Block explorer base URL for the current network */
export const EXPLORER_BASE_URL = networkConfig.explorerBaseUrl;

/** Whether Polymarket trading is supported on the current network */
export const SUPPORTS_POLYMARKET_TRADING = networkConfig.supportsPolymarketTrading;

// ===== Contract Addresses (from network config) =====
// These addresses are network-specific and loaded from lib/network.ts
// based on the NEXT_PUBLIC_VAULT_NETWORK environment variable.

/** USDC.e (USDC from Ethereum, NOT native USDC) on Polygon */
export const USDC_E_ADDRESS = networkConfig.addresses.usdcE as `0x${string}`;

/** Conditional Token Framework (CTF) contract */
export const CTF_ADDRESS = networkConfig.addresses.ctf as `0x${string}`;

/** CTF Exchange for market order execution */
export const CTF_EXCHANGE_ADDRESS = networkConfig.addresses.ctfExchange as `0x${string}`;

/** NegRisk CTF Exchange for negative risk markets */
export const NEGRISK_CTF_EXCHANGE_ADDRESS = networkConfig.addresses
  .negRiskCtfExchange as `0x${string}`;

/** NegRisk adapter for outcome token conversion */
export const NEGRISK_ADAPTER_ADDRESS = networkConfig.addresses.negRiskAdapter as `0x${string}`;

/** VaultV2 factory for vault creation */
export const VAULT_V2_FACTORY_ADDRESS = networkConfig.addresses.vaultV2Factory as `0x${string}`;

// Vault config
export const MAX_DEPLOYED_RATIO = 0.25;
export const WITHDRAWAL_FEE_BPS = 0;
export const NAV_STALENESS_THRESHOLD = 3600; // 1 hour in seconds

// API Config
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
export const VAULT_API_PREFIX = "/vault";
export const CUSTOM_VAULT_API_PREFIX = "/api/vaults";

// Convenience: explicit deposit endpoint for custom vaults (frontend API routing)
export const CUSTOM_VAULT_DEPOSIT_ENDPOINT = `${CUSTOM_VAULT_API_PREFIX}/deposit` as const;

// Reown Kit Config
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "vault-web-project-id";

export const REOWN_APP_METADATA = {
  name: "Vault Platform",
  description: "Vault trading dashboard",
  url: "http://localhost:3001",
  icons: ["http://localhost:3001/icon.png"],
};

// ============================================
// Contract ABIs
// ============================================

// USDC.e decimals
export const USDC_DECIMALS = 6;

// ERC-20 ABI (balance, allowance, approve, decimals)
export const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
// Backwards compat alias
export const ERC20_BALANCE_ABI = ERC20_ABI;

// Vault ABI (deposit, withdraw, redeem, previews, accounting)
export const VAULT_ABI = [
  {
    inputs: [{ name: "assets", type: "uint256" }],
    name: "requestDeposit",
    outputs: [{ name: "requestId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "assets", type: "uint256" }],
    name: "queueDeposit",
    outputs: [{ name: "requestId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "controller", type: "address" },
      { name: "owner", type: "address" },
    ],
    name: "requestRedeem",
    outputs: [{ name: "requestId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "requestId", type: "uint256" }],
    name: "cancelRedeemRequest",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Deposit: transfer assets from caller, mint shares to onBehalf
  {
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "onBehalf", type: "address" },
    ],
    name: "deposit",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "controller", type: "address" },
    ],
    name: "deposit",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Withdraw: burn shares, send assets to receiver
  {
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "onBehalf", type: "address" },
    ],
    name: "withdraw",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Redeem: burn exact shares, send assets to receiver
  {
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "onBehalf", type: "address" },
    ],
    name: "redeem",
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    name: "redeem",
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Preview how many shares you'd get for depositing assets
  {
    inputs: [{ name: "assets", type: "uint256" }],
    name: "previewDeposit",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Preview how many assets you'd get for redeeming shares
  {
    inputs: [{ name: "shares", type: "uint256" }],
    name: "previewRedeem",
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Preview how many shares to burn for withdrawing assets
  {
    inputs: [{ name: "assets", type: "uint256" }],
    name: "previewWithdraw",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Convert assets to shares (rounded down)
  {
    inputs: [{ name: "assets", type: "uint256" }],
    name: "convertToShares",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Convert shares to assets (rounded down)
  {
    inputs: [{ name: "shares", type: "uint256" }],
    name: "convertToAssets",
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Total assets managed by the vault
  {
    inputs: [],
    name: "totalAssets",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Total supply of vault shares
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "currentNAV",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Share balance of an account
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Vault asset address
  {
    inputs: [],
    name: "asset",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  // Vault decimals (for shares)
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  // Vault name
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  // Vault symbol
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ===== Re-exports from network config for convenience =====

export {
  type NetworkType,
  type NetworkConfig,
  type NetworkDisplayInfo,
  MAINNET_CONFIG,
  AMOY_CONFIG,
  NETWORK_CONFIGS,
  NETWORK_DISPLAY,
  MAINNET_DISPLAY,
  AMOY_DISPLAY,
  CURRENT_VAULT_NETWORK,
  resolveNetworkType,
  getNetworkConfig,
  getNetworkConfigFromEnv,
  getRpcUrlForNetwork,
  getExplorerTxUrl,
  getExplorerAddressUrl,
  isValidChainIdForNetwork,
  getNetworkDisplayInfo,
  getCurrentNetworkDisplayInfo,
  isCurrentNetworkTestnet,
  getNetworkBadgeClasses,
  getNetworkDotClasses,
  getNetworkTooltip,
  POLYGON_MAINNET_CHAIN_ID,
  POLYGON_AMOY_CHAIN_ID,
  polygon,
  polygonAmoy,
} from "./lib/network";
