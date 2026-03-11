"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { createAppKit } from "@reown/appkit/react";
import { polygon } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { WagmiProvider, createStorage, cookieStorage } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { REOWN_PROJECT_ID, REOWN_APP_METADATA } from "../src/constants";

const queryClient = new QueryClient();

const wagmiAdapter = new WagmiAdapter({
  networks: [polygon],
  projectId: REOWN_PROJECT_ID,
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: [polygon],
  projectId: REOWN_PROJECT_ID,
  metadata: REOWN_APP_METADATA,
  features: {
    analytics: false,
    email: false,
    socials: [],
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NextThemesProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          enableSystem={false}
          disableTransitionOnChange
          enableColorScheme
        >
          {children}
        </NextThemesProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
