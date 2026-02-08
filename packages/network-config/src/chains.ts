/**
 * Network configuration for Polygon Mainnet and Amoy Testnet
 *
 * Switch networks via:
 * - Backend: NETWORK=mainnet|testnet env var
 * - Frontend: VITE_NETWORK=mainnet|testnet env var (build-time)
 */

export type NetworkType = "mainnet" | "testnet";

export interface ChainConfig {
  id: number;
  name: string;
  network: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    default: string[];
    public: string[];
  };
  blockExplorers: {
    default: {
      name: string;
      url: string;
    };
  };
  testnet: boolean;
}

/**
 * Polygon Mainnet chain configuration
 */
export const polygonMainnet: ChainConfig = {
  id: 137,
  name: "Polygon",
  network: "polygon",
  nativeCurrency: {
    name: "POL",
    symbol: "POL",
    decimals: 18,
  },
  rpcUrls: {
    default: [
      "https://polygon-rpc.com",
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon.llamarpc.com",
    ],
    public: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"],
  },
  blockExplorers: {
    default: {
      name: "PolygonScan",
      url: "https://polygonscan.com",
    },
  },
  testnet: false,
};

/**
 * Polygon Amoy Testnet chain configuration
 */
export const polygonAmoy: ChainConfig = {
  id: 80002,
  name: "Polygon Amoy",
  network: "polygon-amoy",
  nativeCurrency: {
    name: "POL",
    symbol: "POL",
    decimals: 18,
  },
  rpcUrls: {
    default: ["https://rpc-amoy.polygon.technology", "https://polygon-amoy-bor-rpc.publicnode.com"],
    public: ["https://rpc-amoy.polygon.technology", "https://polygon-amoy-bor-rpc.publicnode.com"],
  },
  blockExplorers: {
    default: {
      name: "PolygonScan Amoy",
      url: "https://amoy.polygonscan.com",
    },
  },
  testnet: true,
};

/**
 * Get chain config by network type
 */
export function getChainConfig(network: NetworkType): ChainConfig {
  return network === "mainnet" ? polygonMainnet : polygonAmoy;
}

/**
 * Get chain ID by network type
 */
export function getChainId(network: NetworkType): number {
  return getChainConfig(network).id;
}

/**
 * Get default RPC URL by network type
 */
export function getDefaultRpcUrl(network: NetworkType): string {
  return getChainConfig(network).rpcUrls.default[0] ?? "https://polygon-rpc.com";
}

/**
 * Get all fallback RPC URLs by network type
 */
export function getFallbackRpcUrls(network: NetworkType): string[] {
  return getChainConfig(network).rpcUrls.default;
}

/**
 * Get block explorer URL by network type
 */
export function getBlockExplorerUrl(network: NetworkType): string {
  return getChainConfig(network).blockExplorers.default.url;
}
