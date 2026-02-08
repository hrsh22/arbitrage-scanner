import type { NetworkType } from '@workspace/network-config'
import {
  getDefaultRpcUrl,
  getChainId,
  getUsdcAddress,
  getBlockExplorerUrl,
  USDC_DECIMALS,
} from '@workspace/network-config'

const parseNetwork = (value: string | undefined): NetworkType => {
  if (value === 'testnet') return 'testnet'
  return 'mainnet'
}

export const NETWORK: NetworkType = parseNetwork(import.meta.env.VITE_NETWORK)

export const env = {
  VITE_REOWN_PROJECT_ID: import.meta.env.VITE_REOWN_PROJECT_ID as string,

  VITE_API_URL: (import.meta.env.VITE_API_URL ||
    'http://localhost:8081') as string,

  VITE_WITHDRAWAL_LOCK_DAYS: (() => {
    const value = Number(import.meta.env.VITE_WITHDRAWAL_LOCK_DAYS)
    if (Number.isFinite(value)) {
      return Math.max(0, value)
    }
    return 7
  })(),

  NETWORK,
} as const

export type Env = typeof env

export const getNetwork = (): NetworkType => NETWORK

export const getChainIdForNetwork = (): number => getChainId(NETWORK)

export const getUsdcAddressForNetwork = (): `0x${string}` =>
  getUsdcAddress(NETWORK)

export const getBlockExplorerUrlForNetwork = (): string =>
  getBlockExplorerUrl(NETWORK)

export const getRpcUrlForNetwork = (): string => getDefaultRpcUrl(NETWORK)

export const isTestnet = (): boolean => NETWORK === 'testnet'

export { USDC_DECIMALS }
