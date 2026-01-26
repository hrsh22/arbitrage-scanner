import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAccount, useSignMessage } from 'wagmi'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  Settings,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Check,
  Vault,
  Eye,
  EyeOff,
  Pause,
  DollarSign,
  Users,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import {
  api,
  getAdminSession,
  setAdminSession,
  type PendingWithdrawal,
} from '../../lib/api'

export const Route = createFileRoute('/admin/$vaultId')({
  component: ManageVault,
})

function ManageVault() {
  const { address, isConnected } = useAccount()
  const { vaultId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { signMessageAsync, isPending: isSigning } = useSignMessage()

  const [adminSession, setAdminSessionState] = useState(
    () => null as ReturnType<typeof getAdminSession>,
  )
  const [authError, setAuthError] = useState<string | null>(null)

  const [navInput, setNavInput] = useState('')
  const [navError, setNavError] = useState<string | null>(null)

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
    data: vaultResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin', 'vault', vaultId, address],
    queryFn: () => api.admin.getVault(address!, parseInt(vaultId)),
    enabled: isConnected && !!address && !!adminSession,
  })

  const { data: withdrawalsResponse, isLoading: withdrawalsLoading } = useQuery(
    {
      queryKey: ['admin', 'vault', vaultId, 'withdrawals', address],
      queryFn: () => api.admin.getWithdrawals(address!, parseInt(vaultId)),
      enabled: isConnected && !!address && !!adminSession,
    },
  )

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) =>
      api.admin.updateVault(address!, parseInt(vaultId), { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vault', vaultId] })
    },
  })

  const updateNavMutation = useMutation({
    mutationFn: (totalAssetsUsdc: string) =>
      api.admin.updateNav(address!, parseInt(vaultId), totalAssetsUsdc),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vault', vaultId] })
      setNavInput('')
      setNavError(null)
    },
    onError: (err) => {
      setNavError(err instanceof Error ? err.message : 'Failed to update NAV')
    },
  })

  const vault = vaultResponse?.data?.vault
  const state = vaultResponse?.data?.state
  const withdrawals = withdrawalsResponse?.data ?? []

  const [claimRootError, setClaimRootError] = useState<string | null>(null)
  const [claimRootSuccess, setClaimRootSuccess] = useState<string | null>(null)

  const submitClaimRootMutation = useMutation({
    mutationFn: () => api.admin.submitClaimRoot(address!, parseInt(vaultId)),
    onSuccess: (response) => {
      if (response.success && response.data) {
        setClaimRootSuccess(
          `Claim root submitted for ${response.data.requestCount} requests. TX: ${response.data.txHashes[0]?.slice(0, 10)}...`,
        )
        setClaimRootError(null)
        queryClient.invalidateQueries({
          queryKey: ['admin', 'vault', vaultId, 'withdrawals'],
        })
      }
    },
    onError: (err) => {
      setClaimRootError(
        err instanceof Error ? err.message : 'Failed to submit claim root',
      )
      setClaimRootSuccess(null)
    },
  })

  const handleNavUpdate = () => {
    setNavError(null)
    const value = parseFloat(navInput)
    if (isNaN(value) || value < 0) {
      setNavError('Please enter a valid positive number')
      return
    }
    updateNavMutation.mutate(value.toFixed(6))
  }

  if (!isConnected || !address) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center">
            <Settings className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-4">Manage Vault</h1>
            <p className="text-gray-400 mb-6">
              Connect your wallet to manage this vault
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
            <h1 className="text-2xl font-bold text-white mb-4">Manage Vault</h1>
            <p className="text-gray-400 mb-6">
              Sign in with your admin wallet to manage this vault
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <span className="ml-3 text-gray-400">Loading vault...</span>
        </div>
      </div>
    )
  }

  if (error || !vault || !state) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 flex items-center gap-4">
            <AlertCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
            <div>
              <h3 className="text-red-400 font-semibold">
                Unable to load vault
              </h3>
              <p className="text-red-300/70 text-sm">
                {error instanceof Error ? error.message : 'Vault not found'}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const statusColors = {
    draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    public: 'bg-green-500/20 text-green-400 border-green-500/30',
    paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <button
          onClick={() => navigate({ to: '/admin' })}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Admin
        </button>

        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Vault className="w-8 h-8 text-cyan-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">{vault.name}</h1>
              <p className="text-gray-400 text-sm">/vault/{vault.slug}</p>
            </div>
          </div>
          <span
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border ${statusColors[vault.status]}`}
          >
            {vault.status === 'public' && <Eye className="w-4 h-4" />}
            {vault.status === 'draft' && <EyeOff className="w-4 h-4" />}
            {vault.status === 'paused' && <Pause className="w-4 h-4" />}
            {vault.status.charAt(0).toUpperCase() + vault.status.slice(1)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Total Assets"
            value={formatUsd(state.totalAssetsUsdc)}
            icon={<DollarSign className="w-5 h-5 text-green-400" />}
          />
          <StatCard
            label="Total Shares"
            value={parseFloat(state.totalShares).toLocaleString()}
            icon={<Users className="w-5 h-5 text-cyan-400" />}
          />
          <StatCard
            label="NAV per Share"
            value={`$${parseFloat(state.navPerShare).toFixed(4)}`}
            icon={<RefreshCw className="w-5 h-5 text-purple-400" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Vault Status
            </h3>
            <div className="space-y-3">
              <button
                onClick={() => updateStatusMutation.mutate('public')}
                disabled={
                  vault.status === 'public' || updateStatusMutation.isPending
                }
                className="w-full flex items-center justify-between px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 hover:bg-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Make Public
                </span>
                {vault.status === 'public' && <Check className="w-4 h-4" />}
              </button>
              <button
                onClick={() => updateStatusMutation.mutate('paused')}
                disabled={
                  vault.status === 'paused' || updateStatusMutation.isPending
                }
                className="w-full flex items-center justify-between px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Pause className="w-4 h-4" />
                  Pause
                </span>
                {vault.status === 'paused' && <Check className="w-4 h-4" />}
              </button>
              <button
                onClick={() => updateStatusMutation.mutate('draft')}
                disabled={
                  vault.status === 'draft' || updateStatusMutation.isPending
                }
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-500/10 border border-gray-500/30 rounded-lg text-gray-400 hover:bg-gray-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span className="flex items-center gap-2">
                  <EyeOff className="w-4 h-4" />
                  Set to Draft
                </span>
                {vault.status === 'draft' && <Check className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Update NAV
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Enter the total current value of all vault assets in USDC.e. This
              submits an on-chain NAV update from the operator wallet.
            </p>
            {navError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
                {navError}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                value={navInput}
                onChange={(e) => setNavInput(e.target.value)}
                placeholder={state.totalAssetsUsdc}
                className="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none"
              />
              <button
                onClick={handleNavUpdate}
                disabled={updateNavMutation.isPending || !navInput}
                className="px-4 py-3 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-500/50 text-white font-semibold rounded-lg transition-colors"
              >
                {updateNavMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Update'
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-4">Addresses</h3>
          <div className="space-y-3">
            <AddressRow label="Contract" address={vault.contractAddress} />
            <AddressRow label="Safe (Treasury)" address={vault.safeAddress} />
            <AddressRow label="Admin" address={vault.adminAddress} />
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Pending Withdrawals ({withdrawals.length})
          </h3>
          <p className="text-gray-500 text-sm mb-4">
            Claims are submitted on-chain via Merkle roots; users claim directly
            from the vault contract.
          </p>

          {withdrawalsLoading && (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading withdrawals...
            </div>
          )}

          {!withdrawalsLoading && withdrawals.length === 0 && (
            <p className="text-gray-400 text-sm">No pending withdrawals</p>
          )}

          {withdrawals.length > 0 && (
            <div className="space-y-4">
              <div className="space-y-3">
                {withdrawals.map((w) => (
                  <WithdrawalRow key={w.id} withdrawal={w} />
                ))}
              </div>

              {(() => {
                const withoutClaimRoot = withdrawals.filter(
                  (w) => !w.lastMerkleRoot,
                )
                const allHaveClaimRoot = withoutClaimRoot.length === 0

                if (allHaveClaimRoot) {
                  return (
                    <div className="border-t border-slate-700 pt-4">
                      <div className="flex items-center gap-2 text-green-400 text-sm">
                        <Check className="w-4 h-4" />
                        All withdrawals have claim roots. Users can now claim.
                      </div>
                    </div>
                  )
                }

                return (
                  <div className="border-t border-slate-700 pt-4">
                    <button
                      onClick={() => submitClaimRootMutation.mutate()}
                      disabled={submitClaimRootMutation.isPending}
                      className="w-full py-3 px-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg flex items-center justify-center gap-2"
                    >
                      {submitClaimRootMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Submitting Claim Root...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Submit Claim Root ({withoutClaimRoot.length} pending)
                        </>
                      )}
                    </button>

                    {claimRootError && (
                      <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        {claimRootError}
                      </div>
                    )}

                    {claimRootSuccess && (
                      <div className="mt-3 flex items-center gap-2 text-green-400 text-sm">
                        <Check className="w-4 h-4" />
                        {claimRootSuccess}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-gray-400 text-sm">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-4 py-3">
      <span className="text-gray-400 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <code className="text-gray-300 text-sm font-mono">
          {address.slice(0, 6)}...{address.slice(-4)}
        </code>
        <a
          href={`https://polygonscan.com/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  )
}

function WithdrawalRow({ withdrawal }: { withdrawal: PendingWithdrawal }) {
  const hasClaimRoot = !!withdrawal.lastMerkleRoot
  const claimableAmount = parseFloat(withdrawal.currentClaimableUsdc || '0')

  return (
    <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-4 py-3">
      <div>
        <div className="text-white font-medium">
          {parseFloat(withdrawal.sharesLocked).toFixed(4)} shares
        </div>
        <div className="text-gray-400 text-sm">
          {parseFloat(withdrawal.ownershipPct).toFixed(2)}% ownership |{' '}
          {formatUsd(withdrawal.idleUsdcClaim)} idle USDC.e
        </div>
        {hasClaimRoot && (
          <div className="text-green-400 text-sm mt-1">
            Claim enabled: ${claimableAmount.toFixed(2)} claimable
          </div>
        )}
      </div>
      <div>
        {hasClaimRoot ? (
          <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
            Ready
          </span>
        ) : (
          <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-full">
            Pending
          </span>
        )}
      </div>
    </div>
  )
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
