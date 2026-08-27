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
 * The network is selected via the VAULT_NETWORK environment variable.
 */

import { createPublicClient, http } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import type { Chain } from "viem/chains";
import { env } from "../env.js";

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
  /** viem Chain object for provider configuration */
  readonly chain: Chain;
  /** Base URL for block explorer */
  readonly explorerBaseUrl: string;
  /** Environment variable key for RPC URL */
  readonly rpcEnvKey: string;
  /** Default RPC URL if env not set */
  readonly defaultRpcUrl: string;
  /** Whether Polymarket trading is supported on this network */
  readonly supportsPolymarketTrading: boolean;
  /** Network-specific contract addresses */
  readonly addresses: {
    /** Active Polymarket collateral token for this network */
    readonly collateral: string;
    /** Active collateral display symbol */
    readonly collateralSymbol: string;
    /** Active collateral decimals */
    readonly collateralDecimals: number;
    /** Legacy Polygon USDC.e retained for migration/onramp flows */
    readonly legacyUsdcE: string;
    /** Collateral onramp used to convert legacy USDC.e into pUSD */
    readonly collateralOnramp: string;
    /** Collateral offramp used to convert pUSD back into legacy USDC.e */
    readonly collateralOfframp: string;
    /** Conditional Token Framework (CTF) contract */
    readonly ctf: string;
    /** Active CLOB exchange for market order execution */
    readonly ctfExchange: string;
    /** Active negative-risk CLOB exchange */
    readonly negRiskCtfExchange: string;
    /** NegRisk adapter for outcome token conversion */
    readonly negRiskAdapter: string;
    /** CLOB V2 exchange for market order execution */
    readonly exchangeV2: string;
    /** CLOB V2 negative-risk exchange */
    readonly negRiskExchangeV2: string;
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
  chain: polygon,
  explorerBaseUrl: "https://polygonscan.com",
  rpcEnvKey: "POLYGON_RPC_URL",
  defaultRpcUrl: "https://polygon-bor-rpc.publicnode.com",
  supportsPolymarketTrading: true,
  addresses: {
    collateral: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
    collateralSymbol: "pUSD",
    collateralDecimals: 6,
    legacyUsdcE: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    collateralOnramp: "0x93070a847efEf7F70739046A929D47a521F5B8ee",
    collateralOfframp: "0x2957922Eb93258b93368531d39fAcCA3B4dC5854",
    ctf: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
    ctfExchange: "0xE111180000d2663C0091e4f400237545B87B996B",
    negRiskCtfExchange: "0xe2222d279d744050d28e00520010520000310F59",
    negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
    exchangeV2: "0xE111180000d2663C0091e4f400237545B87B996B",
    negRiskExchangeV2: "0xe2222d279d744050d28e00520010520000310F59",
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
  chain: polygonAmoy,
  explorerBaseUrl: "https://amoy.polygonscan.com",
  rpcEnvKey: "AMOY_RPC_URL",
  defaultRpcUrl: "https://rpc-amoy.polygon.technology",
  supportsPolymarketTrading: false,
  addresses: {
    // NOTE: Amoy testnet collateral address is set; other contracts use placeholders if not deployed
    // These are placeholder addresses - update with actual deployed contracts
    collateral: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    collateralSymbol: "USDC",
    collateralDecimals: 6,
    legacyUsdcE: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    collateralOnramp: "0x0000000000000000000000000000000000000000",
    collateralOfframp: "0x0000000000000000000000000000000000000000",
    ctf: "0x0000000000000000000000000000000000000000",
    ctfExchange: "0x0000000000000000000000000000000000000000",
    negRiskCtfExchange: "0x0000000000000000000000000000000000000000",
    negRiskAdapter: "0x0000000000000000000000000000000000000000",
    exchangeV2: "0x0000000000000000000000000000000000000000",
    negRiskExchangeV2: "0x0000000000000000000000000000000000000000",
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
    throw new Error(`VAULT_NETWORK must be either "mainnet" or "amoy". Received: ${network}`);
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
 * Defaults to "mainnet" if VAULT_NETWORK is not set
 * @throws Error if VAULT_NETWORK is set to an invalid value
 */
export function getNetworkConfigFromEnv(): NetworkConfig {
  const network = process.env.VAULT_NETWORK ?? "mainnet";
  const networkType = resolveNetworkType(network);
  return getNetworkConfig(networkType);
}

/**
 * Check if a chain ID matches the expected network
 */
export function isValidChainIdForNetwork(chainId: number, network: NetworkType): boolean {
  return NETWORK_CONFIGS[network].chainId === chainId;
}

export function getRpcUrlsForNetwork(network: NetworkType): string[] {
  const config = NETWORK_CONFIGS[network];
  const configuredUrls = network === "mainnet" ? env.POLYGON_RPC_URLS : env.AMOY_RPC_URLS;
  return configuredUrls.length > 0 ? configuredUrls : [config.defaultRpcUrl];
}

export function getRpcUrlForNetwork(network: NetworkType): string {
  return getRpcUrlsForNetwork(network)[0]!;
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
 * Re-export chain objects for direct use
 */
export { polygon, polygonAmoy };

/**
 * Chain ID constants
 */
export const POLYGON_MAINNET_CHAIN_ID = 137;
export const POLYGON_AMOY_CHAIN_ID = 80002;

/**
 * Validate that the RPC URL for a network returns the expected chain ID
 * This prevents misconfiguration where VAULT_NETWORK=amoy but RPC points to mainnet
 *
 * @param network - The network type to validate
 * @throws Error if RPC chain ID does not match expected chain ID
 */
export async function validateRpcChainId(network: NetworkType): Promise<void> {
  const config = NETWORK_CONFIGS[network];
  const rpcUrls = getRpcUrlsForNetwork(network);
  let successCount = 0;
  const accessErrors: string[] = [];

  for (const rpcUrl of rpcUrls) {
    try {
      const client = createPublicClient({
        chain: config.chain,
        transport: http(rpcUrl, { timeout: 10_000 }),
      });

      const chainId = await client.getChainId();

      if (chainId !== config.chainId) {
        throw new Error(
          `Chain ID mismatch for VAULT_NETWORK=${network}: ` +
            `RPC at ${rpcUrl} reports chain ID ${chainId}, ` +
            `but expected ${config.chainId} (${network}). ` +
            `Ensure your ${config.rpcEnvKey} environment variable points to the correct network.`,
        );
      }
      successCount += 1;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Chain ID mismatch")) {
        throw error;
      }

      accessErrors.push(`${rpcUrl}: ${(error as Error).message}`);
    }
  }

  if (successCount > 0) {
    return;
  }

  throw new Error(
    `Failed to validate RPC chain ID for VAULT_NETWORK=${network}: ` +
      `${accessErrors.join("; ")}. ` +
      `Ensure ${config.rpcEnvKey} is set correctly and at least one RPC endpoint is accessible.`,
  );
}

/**
 * Run startup validation for the configured network
 * Validates that RPC chain ID matches VAULT_NETWORK configuration
 * This should be called early in the boot process
 *
 * @throws Error if validation fails (startup should abort)
 */
export async function validateNetworkConfiguration(): Promise<void> {
  const network = process.env.VAULT_NETWORK ?? "mainnet";
  const networkType = resolveNetworkType(network);

  await validateRpcChainId(networkType);
}
