import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAccount, useSignMessage } from 'wagmi'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  Settings,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Check,
  Vault,
  Link as LinkIcon,
  Shield,
} from 'lucide-react'
import { api, getAdminSession, setAdminSession } from '../../lib/api'

export const Route = createFileRoute('/admin/new')({ component: CreateVault })

function CreateVault() {
  const { address, isConnected } = useAccount()
  const navigate = useNavigate()
  const { signMessageAsync, isPending: isSigning } = useSignMessage()

  const [adminSession, setAdminSessionState] = useState(
    () => null as ReturnType<typeof getAdminSession>,
  )
  const [authError, setAuthError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [contractAddress, setContractAddress] = useState('')
  const [safeAddress, setSafeAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

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

  const createMutation = useMutation({
    mutationFn: () =>
      api.admin.createVault(address!, {
        name,
        slug,
        description: description || undefined,
        contractAddress,
        safeAddress,
      }),
    onSuccess: (response) => {
      if (response.data) {
        navigate({
          to: '/admin/$vaultId',
          params: { vaultId: String(response.data.id) },
        })
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create vault')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Vault name is required')
      return
    }
    if (!slug.trim()) {
      setError('Vault slug is required')
      return
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug must be lowercase letters, numbers, and hyphens only')
      return
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      setError('Invalid contract address')
      return
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(safeAddress)) {
      setError('Invalid Safe address')
      return
    }

    createMutation.mutate()
  }

  const generateSlug = () => {
    const generated = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    setSlug(generated)
  }

  if (!isConnected || !address) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center">
            <Settings className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-4">Create Vault</h1>
            <p className="text-gray-400 mb-6">
              Connect your wallet to create a vault
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
            <h1 className="text-2xl font-bold text-white mb-4">Create Vault</h1>
            <p className="text-gray-400 mb-6">
              Sign in with your admin wallet to create a vault
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
      <div className="max-w-2xl mx-auto px-6 py-12">
        <button
          onClick={() => navigate({ to: '/admin' })}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Admin
        </button>

        <div className="flex items-center gap-3 mb-8">
          <Vault className="w-8 h-8 text-cyan-400" />
          <h1 className="text-3xl font-bold text-white">Create New Vault</h1>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Before You Start
          </h3>
          <div className="space-y-3 text-sm text-gray-400">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                1
              </div>
              <div>
                <p className="text-gray-300 font-medium">
                  Deploy the PredictionVault contract
                </p>
                <p>
                  Use Remix or your preferred tool to deploy PredictionVault.sol
                  to the target network. Copy the deployed contract address.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                2
              </div>
              <div>
                <p className="text-gray-300 font-medium">
                  Create a Gnosis Safe
                </p>
                <p>
                  Go to app.safe.global and create a new Safe. This will be the
                  treasury that holds funds and trades on Polymarket. Copy the
                  Safe address.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                3
              </div>
              <div>
                <p className="text-gray-300 font-medium">
                  Register the vault here
                </p>
                <p>
                  Enter the addresses below to register your vault in the
                  system. The vault will start as a draft.
                </p>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Vault className="w-5 h-5 text-cyan-400" />
              Vault Details
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Vault Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => !slug && generateSlug()}
                placeholder="e.g., Conservative Strategy"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                URL Slug *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="e.g., conservative-strategy"
                  className="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={generateSlug}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-lg text-sm transition-colors"
                >
                  Generate
                </button>
              </div>
              <p className="text-gray-500 text-xs mt-1">
                Users will access at /vault/{slug || 'your-slug'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your vault's strategy..."
                rows={3}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none resize-none"
              />
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <LinkIcon className="w-5 h-5 text-cyan-400" />
              Addresses
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Vault Contract Address *
              </label>
              <input
                type="text"
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 font-mono text-sm focus:border-cyan-500 focus:outline-none"
              />
              <p className="text-gray-500 text-xs mt-1">
                The deployed PredictionVault contract address
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <span className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Gnosis Safe Address *
                </span>
              </label>
              <input
                type="text"
                value={safeAddress}
                onChange={(e) => setSafeAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-gray-500 font-mono text-sm focus:border-cyan-500 focus:outline-none"
              />
              <p className="text-gray-500 text-xs mt-1">
                The Gnosis Safe that will hold funds and trade on Polymarket
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-500/50 text-white font-semibold rounded-xl transition-colors"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating Vault...
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                Create Vault
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
