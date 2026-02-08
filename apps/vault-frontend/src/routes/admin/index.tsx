import { createFileRoute, Link } from '@tanstack/react-router'
import { useAccount, useSignMessage } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  Settings,
  Plus,
  Loader2,
  AlertCircle,
  Vault,
  Eye,
  EyeOff,
  Pause,
} from 'lucide-react'
import {
  api,
  getAdminSession,
  setAdminSession,
  type Vault as VaultType,
} from '../../lib/api'

export const Route = createFileRoute('/admin/')({ component: AdminDashboard })

function AdminDashboard() {
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()
  const { signMessageAsync, isPending: isSigning } = useSignMessage()

  const [adminSession, setAdminSessionState] = useState(
    () => null as ReturnType<typeof getAdminSession>,
  )
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    setAdminSessionState(getAdminSession())
  }, [])

  useEffect(() => {
    if (!adminSession || !address) return
    if (adminSession.address.toLowerCase() !== address.toLowerCase()) {
      setAdminSession(null)
      setAdminSessionState(null)
    }
  }, [address, adminSession])

  const {
    data: vaultsResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin', 'vaults', address],
    queryFn: () => api.admin.getVaults(address!),
    enabled: isConnected && !!address && !!adminSession,
  })

  const vaults = vaultsResponse?.data ?? []

  if (!isConnected || !address) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center">
            <Settings className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-4">
              Admin Dashboard
            </h1>
            <p className="text-gray-400 mb-6">
              Connect your wallet to manage vaults
            </p>
            <appkit-button />
          </div>
        </div>
      </div>
    )
  }

  if (!adminSession) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center">
            <Settings className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-4">
              Admin Dashboard
            </h1>
            <p className="text-gray-400 mb-6">
              Sign in with your admin wallet to manage vaults
            </p>
            {authError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-sm">{authError}</p>
              </div>
            )}
            <button
              onClick={async () => {
                if (!address) return
                setAuthError(null)
                try {
                  const nonceResponse = await api.adminAuth.requestNonce(address)
                  if (!nonceResponse.data) {
                    throw new Error(
                      nonceResponse.error || 'Failed to request admin nonce',
                    )
                  }
                  const signature = await signMessageAsync({
                    message: nonceResponse.data.message,
                  })
                  const verifyResponse = await api.adminAuth.verifySignature(
                    address,
                    signature,
                  )
                  if (!verifyResponse.data) {
                    throw new Error(
                      verifyResponse.error || 'Failed to verify signature',
                    )
                  }
                  const session = {
                    token: verifyResponse.data.token,
                    address: address.toLowerCase(),
                  }
                  setAdminSession(session)
                  setAdminSessionState(session)
                  queryClient.invalidateQueries({ queryKey: ['admin'] })
                } catch (error) {
                  setAuthError(
                    error instanceof Error
                      ? error.message
                      : 'Failed to sign in',
                  )
                }
              }}
              disabled={isSigning}
              className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-500/50 text-white font-semibold rounded-lg transition-colors"
            >
              {isSigning ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Waiting for signature...
                </>
              ) : (
                'Sign in as Admin'
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Settings className="w-8 h-8 text-cyan-400" />
            <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          </div>
          <Link
            to="/admin/new"
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Vault
          </Link>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 mb-8 flex items-center gap-4">
            <AlertCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
            <div>
              <h3 className="text-red-400 font-semibold">
                Unable to load vaults
              </h3>
              <p className="text-red-300/70 text-sm">
                {error instanceof Error ? error.message : 'Connection error'}
              </p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            <span className="ml-3 text-gray-400">Loading your vaults...</span>
          </div>
        )}

        {!isLoading && vaults.length === 0 && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center">
            <Vault className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              No Vaults Yet
            </h2>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              You haven't created any vaults. Create your first vault to start
              managing prediction market investments.
            </p>
            <Link
              to="/admin/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              Create Your First Vault
            </Link>
          </div>
        )}

        {vaults.length > 0 && (
          <div className="space-y-4">
            {vaults.map((vault) => (
              <VaultCard key={vault.id} vault={vault} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function VaultCard({ vault }: { vault: VaultType }) {
  const statusColors = {
    draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    public: 'bg-green-500/20 text-green-400 border-green-500/30',
    paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  }

  const StatusIcon =
    vault.status === 'public' ? Eye : vault.status === 'paused' ? Pause : EyeOff

  return (
    <Link
      to="/admin/$vaultId"
      params={{ vaultId: String(vault.id) }}
      className="block bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-cyan-500/50 transition-colors"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Vault className="w-6 h-6 text-cyan-400" />
          <h3 className="text-lg font-semibold text-white">{vault.name}</h3>
        </div>
        <span
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${statusColors[vault.status]}`}
        >
          <StatusIcon className="w-4 h-4" />
          {vault.status.charAt(0).toUpperCase() + vault.status.slice(1)}
        </span>
      </div>

      {vault.description && (
        <p className="text-gray-400 text-sm mb-4">{vault.description}</p>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500">Slug:</span>
          <span className="ml-2 text-gray-300">{vault.slug}</span>
        </div>
        <div>
          <span className="text-gray-500">Created:</span>
          <span className="ml-2 text-gray-300">
            {new Date(vault.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </Link>
  )
}
