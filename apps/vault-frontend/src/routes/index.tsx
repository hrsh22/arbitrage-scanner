import { createFileRoute, Link } from '@tanstack/react-router'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import {
  Vault,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  AlertCircle,
  Clock,
} from 'lucide-react'
import { api, type Vault as VaultType } from '../lib/api'

export const Route = createFileRoute('/')({ component: Dashboard })

function Dashboard() {
  const { address, isConnected } = useAccount()

  const {
    data: vaultsResponse,
    isLoading: vaultsLoading,
    error: vaultsError,
  } = useQuery({
    queryKey: ['vaults', 'public'],
    queryFn: () => api.vaults.list(),
    refetchInterval: 30000,
  })

  const vaults = vaultsResponse?.data ?? []

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Vault className="w-12 h-12 text-cyan-400" />
            <h1 className="text-4xl font-bold text-white">Prediction Vault</h1>
          </div>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Earn yield from automated prediction market trading. Deposit USDC
            and receive shares representing your ownership.
          </p>
        </div>

        {vaultsError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 mb-8 flex items-center gap-4">
            <AlertCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
            <div>
              <h3 className="text-red-400 font-semibold">
                Unable to load vaults
              </h3>
              <p className="text-red-300/70 text-sm">
                {vaultsError instanceof Error
                  ? vaultsError.message
                  : 'Connection error'}
              </p>
            </div>
          </div>
        )}

        {vaultsLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            <span className="ml-3 text-gray-400">Loading vaults...</span>
          </div>
        )}

        {!vaultsLoading && vaults.length === 0 && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center">
            <Vault className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              No Vaults Available
            </h2>
            <p className="text-gray-400 max-w-md mx-auto">
              There are no public vaults available at the moment. Check back
              soon!
            </p>
          </div>
        )}

        {vaults.length > 0 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Available Vaults</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {vaults.map((vault) => (
                <VaultCard
                  key={vault.id}
                  vault={vault}
                  isConnected={isConnected}
                  address={address}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            How It Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="text-cyan-400 font-medium mb-2">1. Deposit</div>
              <p className="text-gray-400">
                Deposit USDC and receive vault shares at the current NAV. Your
                shares represent ownership in the vault's assets.
              </p>
            </div>
            <div>
              <div className="text-cyan-400 font-medium mb-2">2. Earn</div>
              <p className="text-gray-400">
                The vault trades high-confidence prediction markets. Profits
                increase the NAV, meaning your shares gain value.
              </p>
            </div>
            <div>
              <div className="text-cyan-400 font-medium mb-2">3. Withdraw</div>
              <p className="text-gray-400">
                Request withdrawal anytime. Funds are returned as positions
                resolve, proportional to your share of the vault.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function VaultCard({
  vault,
  isConnected,
  address,
}: {
  vault: VaultType
  isConnected: boolean
  address: string | undefined
}) {
  const { data: statusResponse, isLoading: statusLoading } = useQuery({
    queryKey: ['vault', vault.slug, 'status'],
    queryFn: () => api.vaults.getStatus(vault.slug),
    refetchInterval: 30000,
  })

  const { data: userResponse } = useQuery({
    queryKey: ['user', vault.slug, address],
    queryFn: () => api.users.get(vault.slug, address!),
    enabled: isConnected && !!address,
    refetchInterval: 30000,
  })

  const status = statusResponse?.data
  const user = userResponse?.data

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6 hover:border-cyan-500/30 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <Vault className="w-8 h-8 text-cyan-400" />
        <div>
          <h3 className="text-xl font-bold text-white">{vault.name}</h3>
          {vault.description && (
            <p className="text-gray-400 text-sm">{vault.description}</p>
          )}
        </div>
      </div>

      {statusLoading ? (
        <div className="flex items-center gap-2 py-4">
          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
          <span className="text-gray-400 text-sm">Loading stats...</span>
        </div>
      ) : status ? (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-gray-400 text-xs uppercase mb-1">TVL</div>
            <div className="text-white font-semibold">
              {formatUsd(status.totalAssetsUsdc)}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase mb-1">NAV</div>
            <div className="text-green-400 font-semibold">
              ${parseFloat(status.navPerShare).toFixed(4)}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase mb-1">
              Positions
            </div>
            <div className="text-white font-semibold">
              {status.openPositionsCount}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase mb-1">Updated</div>
            <div className="text-white text-sm flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <LastUpdated date={status.lastNavUpdateAt} />
            </div>
          </div>
        </div>
      ) : null}

      {isConnected && user && parseFloat(user.position.shares) > 0 && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 mb-4">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-cyan-400 text-xs uppercase">
                Your Position
              </div>
              <div className="text-white font-semibold">
                {formatUsd(user.position.valueUsdc)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-gray-400 text-xs">
                {parseFloat(user.position.shares).toFixed(4)} shares
              </div>
              <div className="text-gray-400 text-xs">
                {parseFloat(user.position.ownershipPct).toFixed(2)}% ownership
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Link
          to="/vault/$slug/deposit"
          params={{ slug: vault.slug }}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-colors"
        >
          <ArrowDownToLine className="w-4 h-4" />
          Deposit
        </Link>
        <Link
          to="/vault/$slug/withdraw"
          params={{ slug: vault.slug }}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
        >
          <ArrowUpFromLine className="w-4 h-4" />
          Withdraw
        </Link>
      </div>
    </div>
  )
}

function LastUpdated({ date }: { date: string }) {
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMins < 1) return <span>just now</span>
  if (diffMins < 60) return <span>{diffMins}m ago</span>
  if (diffHours < 24) return <span>{diffHours}h ago</span>
  return <span>{d.toLocaleDateString()}</span>
}

function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}
