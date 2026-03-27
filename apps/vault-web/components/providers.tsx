"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { createAppKit } from "@reown/appkit/react";
import { polygon, polygonAmoy } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { WagmiProvider, createStorage, cookieStorage } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  REOWN_PROJECT_ID,
  REOWN_APP_METADATA,
  VAULT_NETWORK,
  type NetworkType,
  type NetworkDisplayInfo,
  getNetworkDisplayInfo,
} from "../src/constants";
import { getQueryClient } from "../src/lib/queryClient";

// Select the appropriate network based on VAULT_NETWORK config
const selectedNetwork = VAULT_NETWORK === "amoy" ? polygonAmoy : polygon;

const wagmiAdapter = new WagmiAdapter({
  networks: [selectedNetwork],
  projectId: REOWN_PROJECT_ID,
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: [selectedNetwork],
  projectId: REOWN_PROJECT_ID,
  metadata: REOWN_APP_METADATA,
  features: {
    analytics: false,
    email: false,
    socials: [],
  },
});

// ============================================
// Network Context
// ============================================

/**
 * Network context type for providing network-scoped metadata
 */
interface NetworkContextType {
  /** Current network type (mainnet | amoy) */
  network: NetworkType;
  /** Network display metadata for UI */
  displayInfo: NetworkDisplayInfo;
  /** Whether current network is a testnet */
  isTestnet: boolean;
}

const NetworkContext = React.createContext<NetworkContextType | null>(null);

/**
 * Hook to access network context
 * @throws Error if used outside of NetworkProvider
 */
export function useNetwork(): NetworkContextType {
  const context = React.useContext(NetworkContext);
  if (!context) {
    throw new Error("useNetwork must be used within NetworkProvider");
  }
  return context;
}

/**
 * Network provider component
 * Provides network-scoped metadata to the app
 */
function NetworkProvider({ children }: { children: React.ReactNode }) {
  const network = VAULT_NETWORK;
  const displayInfo = getNetworkDisplayInfo(network);
  const isTestnet = displayInfo.isTestnet;

  const value = React.useMemo(
    () => ({
      network,
      displayInfo,
      isTestnet,
    }),
    [network, displayInfo, isTestnet],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <NextThemesProvider
            attribute="class"
            defaultTheme="dark"
            forcedTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
            enableColorScheme
          >
            {children}
          </NextThemesProvider>
        </NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
