/**
 * Vault Web Constants
 * Static configuration for vault-web frontend
 */

// Polygon Mainnet
export const POLYGON_CHAIN_ID = 137;
export const POLYGON_RPC_URL = "https://polygon-rpc.com";

// Contract addresses
export const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
export const CTF_ADDRESS = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
export const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
export const NEGRISK_CTF_EXCHANGE_ADDRESS = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
export const NEGRISK_ADAPTER_ADDRESS = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
export const VAULT_V2_FACTORY_ADDRESS = "0xA1D94F746dEfa1928926b84fB2596c06926C0405";

// Vault config
export const MAX_DEPLOYED_RATIO = 0.25;
export const WITHDRAWAL_FEE_BPS = 50;
export const NAV_STALENESS_THRESHOLD = 3600; // 1 hour in seconds

// API Config
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
export const VAULT_API_PREFIX = "/vault";
export const CUSTOM_VAULT_API_PREFIX = "/api/vaults";

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
