import { createAppKit } from '@reown/appkit/react'
import { WagmiProvider } from 'wagmi'
import { polygon } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { env } from './env'
import type { ReactNode } from 'react'

const queryClient = new QueryClient()

const projectId = env.VITE_REOWN_PROJECT_ID

if (!projectId) {
  console.warn(
    'Missing VITE_REOWN_PROJECT_ID - wallet connection will not work',
  )
}

const metadata = {
  name: 'Polymarket Prediction Vault',
  description: 'Tokenized exposure to prediction market strategies',
  url:
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://localhost:3000',
  icons: ['/logo192.png'],
}

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [polygon]

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: projectId || 'placeholder',
  ssr: true,
})

if (projectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks,
    projectId,
    metadata,
    features: {
      analytics: false,
      email: false,
      socials: [],
    },
  })
}

interface Web3ProviderProps {
  children: ReactNode
}

export function Web3Provider({ children }: Web3ProviderProps) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
