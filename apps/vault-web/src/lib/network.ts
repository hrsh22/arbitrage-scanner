/**
 * Network Configuration Module
 *
 * First-class network configuration layer supporting Polygon mainnet and Amoy testnet.
 * This module provides a single source of truth for network metadata including:
 * - Chain ID
 * - RPC endpoint configuration
 * - Explorer base URLs
 * - Network-specific contract addresses
 *
 * The network is selected via the NEXT_PUBLIC_VAULT_NETWORK environment variable.
 */

import { polygon, polygonAmoy } from "@reown/appkit/networks";

/**
 * Supported network types
 */
export type NetworkType = "mainnet" | "amoy";

/**
 * Network configuration metadata
 */
export interface NetworkConfig {
  /** Network identifier */
  readonly name: NetworkType;
  /** Human-readable display name */
  readonly displayName: string;
  /** Chain ID */
  readonly chainId: number;
  /** Base URL for block explorer */
  readonly explorerBaseUrl: string;
  /** Environment variable key for RPC URL */
  readonly rpcEnvKey: string;
  /** Default RPC URL if env not set */
  readonly defaultRpcUrl: string;
  /** Whether Polymarket trading is supported on this network */
  readonly supportsPolymarketTrading: boolean;
  /** Active collateral metadata */
    readonly collateral: {
    /** Active vault and Polymarket CLOB V2 collateral token */
    readonly address: string;
    /** Display symbol for the active collateral token */
    readonly symbol: string;
    /** ERC-20 decimals for the active collateral token */
    readonly decimals: number;
  };
  /** User-facing deposit/withdraw token metadata. */
  readonly userCollateral: {
    readonly address: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  /** Network-specific contract addresses */
  readonly addresses: {
    /** Active collateral token address */
    readonly collateral: string;
    /** Legacy USDC.e address retained for historical migration views */
    readonly legacyUsdcE: string;
    /** Collateral onramp used to convert legacy USDC.e into pUSD */
    readonly collateralOnramp: string;
    /** Collateral offramp used to convert pUSD back into legacy USDC.e */
    readonly collateralOfframp: string;
    /** @deprecated Use collateral or legacyUsdcE depending on intent. */
    readonly usdcE: string;
    /** Conditional Token Framework (CTF) contract */
    readonly ctf: string;
    /** CLOB V2 Exchange for market order execution */
    readonly ctfExchange: string;
    /** NegRisk CLOB V2 Exchange for negative risk markets */
    readonly negRiskCtfExchange: string;
    /** NegRisk adapter for outcome token conversion */
    readonly negRiskAdapter: string;
    /** VaultV2 factory for vault creation */
    readonly vaultV2Factory: string;
  };
}

/**
 * Mainnet configuration (Polygon PoS)
 */
const MAINNET_CONFIG: NetworkConfig = {
  name: "mainnet",
  displayName: "Polygon Mainnet",
  chainId: 137,
  explorerBaseUrl: "https://polygonscan.com",
  rpcEnvKey: "NEXT_PUBLIC_POLYGON_RPC_URL",
  defaultRpcUrl: "https://polygon-bor-rpc.publicnode.com",
  supportsPolymarketTrading: true,
  collateral: {
    address: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
    symbol: "pUSD",
    decimals: 6,
  },
  userCollateral: {
    address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    symbol: "USDC.e",
    decimals: 6,
  },
  addresses: {
    collateral: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
    legacyUsdcE: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    collateralOnramp: "0x93070a847efEf7F70739046A929D47a521F5B8ee",
    collateralOfframp: "0x2957922Eb93258b93368531d39fAcCA3B4dC5854",
    usdcE: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    ctf: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
    ctfExchange: "0xE111180000d2663C0091e4f400237545B87B996B",
    negRiskCtfExchange: "0xe2222d279d744050d28e00520010520000310F59",
    negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
    vaultV2Factory: "0xA1D94F746dEfa1928926b84fB2596c06926C0405",
  },
} as const;

/**
 * Amoy testnet configuration
 */
const AMOY_CONFIG: NetworkConfig = {
  name: "amoy",
  displayName: "Polygon Amoy Testnet",
  chainId: 80002,
  explorerBaseUrl: "https://amoy.polygonscan.com",
  rpcEnvKey: "NEXT_PUBLIC_AMOY_RPC_URL",
  defaultRpcUrl: "https://rpc-amoy.polygon.technology",
  supportsPolymarketTrading: false,
  collateral: {
    address: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    symbol: "pUSD",
    decimals: 6,
  },
  userCollateral: {
    address: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    symbol: "USDC.e",
    decimals: 6,
  },
  addresses: {
    // NOTE: Amoy testnet requires manual contract deployment
    // These are placeholder addresses - update with actual deployed contracts
    collateral: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    legacyUsdcE: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    collateralOnramp: "0x0000000000000000000000000000000000000000",
    collateralOfframp: "0x0000000000000000000000000000000000000000",
    usdcE: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    ctf: "0x0000000000000000000000000000000000000000",
    ctfExchange: "0x0000000000000000000000000000000000000000",
    negRiskCtfExchange: "0x0000000000000000000000000000000000000000",
    negRiskAdapter: "0x0000000000000000000000000000000000000000",
    vaultV2Factory: "0x0000000000000000000000000000000000000000",
  },
} as const;

/**
 * Network configuration registry
 */
export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  mainnet: MAINNET_CONFIG,
  amoy: AMOY_CONFIG,
} as const;

/**
 * Validate and resolve network type from string
 * @throws Error if network is not supported
 */
export function resolveNetworkType(network: string): NetworkType {
  if (network !== "mainnet" && network !== "amoy") {
    throw new Error(
      `NEXT_PUBLIC_VAULT_NETWORK must be either "mainnet" or "amoy". Received: ${network}`,
    );
  }
  return network;
}

/**
 * Get network configuration for a specific network type
 */
export function getNetworkConfig(network: NetworkType): NetworkConfig {
  return NETWORK_CONFIGS[network];
}

/**
 * Get network configuration from environment variable
 * Defaults to "mainnet" if NEXT_PUBLIC_VAULT_NETWORK is not set
 * @throws Error if NEXT_PUBLIC_VAULT_NETWORK is set to an invalid value
 */
export function getNetworkConfigFromEnv(): NetworkConfig {
  const network = process.env.NEXT_PUBLIC_VAULT_NETWORK ?? "mainnet";
  const networkType = resolveNetworkType(network);
  return getNetworkConfig(networkType);
}

/**
 * Check if a chain ID matches the expected network
 */
export function isValidChainIdForNetwork(chainId: number, network: NetworkType): boolean {
  return NETWORK_CONFIGS[network].chainId === chainId;
}

/**
 * Build explorer URL for a transaction hash
 */
export function getExplorerTxUrl(network: NetworkType, txHash: string): string {
  const config = NETWORK_CONFIGS[network];
  return `${config.explorerBaseUrl}/tx/${txHash}`;
}

/**
 * Build explorer URL for an address
 */
export function getExplorerAddressUrl(network: NetworkType, address: string): string {
  const config = NETWORK_CONFIGS[network];
  return `${config.explorerBaseUrl}/address/${address}`;
}

/**
 * Export individual configs for convenience
 */
export { MAINNET_CONFIG, AMOY_CONFIG };

/**
 * Re-export network objects for direct use
 */
export { polygon, polygonAmoy };

/**
 * Chain ID constants
 */
export const POLYGON_MAINNET_CHAIN_ID = 137;
export const POLYGON_AMOY_CHAIN_ID = 80002;

/**
 * Get RPC URL for the configured network
 * Uses static process.env references so Next.js can inline them correctly
 */
export function getRpcUrlForNetwork(network: NetworkType): string {
  // Use explicit env var names so Next.js can inline them at build time
  if (network === "mainnet") {
    return process.env.NEXT_PUBLIC_POLYGON_RPC_URL || MAINNET_CONFIG.defaultRpcUrl;
  }
  return process.env.NEXT_PUBLIC_AMOY_RPC_URL || AMOY_CONFIG.defaultRpcUrl;
}

// ============================================
// Network Display Helpers
// ============================================

/**
 * Network display metadata for UI components
 */
export interface NetworkDisplayInfo {
  /** Network identifier */
  readonly id: NetworkType;
  /** Human-readable short name */
  readonly name: string;
  /** Full display name with network type */
  readonly fullName: string;
  /** Badge variant for styling */
  readonly badgeVariant: "mainnet" | "testnet";
  /** Tailwind color classes for badges */
  readonly badgeClasses: {
    readonly border: string;
    readonly bg: string;
    readonly text: string;
    readonly dot: string;
  };
  /** Whether this is a testnet */
  readonly isTestnet: boolean;
  /** Warning text for testnet */
  readonly warningText?: string;
}

/**
 * Mainnet display configuration
 */
export const MAINNET_DISPLAY: NetworkDisplayInfo = {
  id: "mainnet",
  name: "Mainnet",
  fullName: "Polygon Mainnet",
  badgeVariant: "mainnet",
  badgeClasses: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  isTestnet: false,
} as const;

/**
 * Amoy testnet display configuration
 */
export const AMOY_DISPLAY: NetworkDisplayInfo = {
  id: "amoy",
  name: "Amoy Testnet",
  fullName: "Polygon Amoy Testnet",
  badgeVariant: "testnet",
  badgeClasses: {
    border: "border-amber-500/30",
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-500",
  },
  isTestnet: true,
  warningText:
    "You are connected to Polygon Amoy Testnet. Vault testing is supported, but Polymarket trading is disabled.",
} as const;

/**
 * Network display registry
 */
export const NETWORK_DISPLAY: Record<NetworkType, NetworkDisplayInfo> = {
  mainnet: MAINNET_DISPLAY,
  amoy: AMOY_DISPLAY,
} as const;

/**
 * Get display info for a network type
 */
export function getNetworkDisplayInfo(network: NetworkType): NetworkDisplayInfo {
  return NETWORK_DISPLAY[network];
}

/**
 * Get current network display info from environment
 * Defaults to mainnet if NEXT_PUBLIC_VAULT_NETWORK is not set
 */
export function getCurrentNetworkDisplayInfo(): NetworkDisplayInfo {
  const network = process.env.NEXT_PUBLIC_VAULT_NETWORK ?? "mainnet";
  const networkType = resolveNetworkType(network);
  return getNetworkDisplayInfo(networkType);
}

/**
 * Current vault network type from environment
 * Use this for consistent network detection across the app
 */
export const CURRENT_VAULT_NETWORK: NetworkType = (process.env.NEXT_PUBLIC_VAULT_NETWORK ??
  "mainnet") as NetworkType;

/**
 * Check if currently configured network is a testnet
 */
export function isCurrentNetworkTestnet(): boolean {
  return CURRENT_VAULT_NETWORK === "amoy";
}

/**
 * Get the appropriate network badge classes for a network type
 * @returns Tailwind CSS class string for badge styling
 */
export function getNetworkBadgeClasses(network: NetworkType): string {
  const display = NETWORK_DISPLAY[network];
  return `${display.badgeClasses.border} ${display.badgeClasses.bg} ${display.badgeClasses.text}`;
}

/**
 * Get network indicator dot classes
 * @returns Tailwind CSS class string for the status dot
 */
export function getNetworkDotClasses(network: NetworkType): string {
  return NETWORK_DISPLAY[network].badgeClasses.dot;
}

/**
 * Get network tooltip text
 */
export function getNetworkTooltip(network: NetworkType): string {
  const display = NETWORK_DISPLAY[network];
  if (display.isTestnet) {
    return "Polymarket trading is disabled on testnet";
  }
  return "Connected to Polygon Mainnet";
}
