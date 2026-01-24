import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parseUnits, formatUnits, type Address } from 'viem'
import { useState, useEffect } from 'react'
import {
  ArrowUpFromLine,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle,
  Wallet,
  Info,
  Clock,
  Download,
} from 'lucide-react'
import { VAULT_ABI, USDC_DECIMALS } from '../../../lib/contracts'
import { api, type WithdrawalRecord } from '../../../lib/api'

const LOCK_PERIOD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'Available now'
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  if (days > 0) return `${days}d ${hours}h remaining`
  if (hours > 0) return `${hours}h ${minutes}m remaining`
  return `${minutes}m remaining`
}

function getTimeUntilClaimable(requestedAt: string): number {
  const requestTime = new Date(requestedAt).getTime()
  const claimableTime = requestTime + LOCK_PERIOD_MS
  return claimableTime - Date.now()
}

export const Route = createFileRoute('/vault/$slug/withdraw')({
  component: WithdrawPage,
})

type WithdrawStep = 'input' | 'request' | 'success'

function WithdrawPage() {
  const { slug } = useParams({ from: '/vault/$slug/withdraw' })
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()

  const [shares, setShares] = useState('')
  const [step, setStep] = useState<WithdrawStep>('input')
  const [error, setError] = useState<string | null>(null)

  const { data: vaultResponse, isLoading: vaultLoading } = useQuery({
    queryKey: ['vault', slug],
    queryFn: () => api.vaults.get(slug),
  })

  const vault = vaultResponse?.data
  const vaultAddress = vault?.contractAddress as Address | undefined

  const { data: shareBalance } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address && !!vaultAddress },
  })

  const { data: navPerShare } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'navPerShare',
    query: { enabled: !!vaultAddress },
  })

  const { data: withdrawalsResponse, isLoading: withdrawalsLoading } = useQuery(
    {
      queryKey: ['user', slug, address, 'withdrawals'],
      queryFn: () => api.users.getWithdrawals(slug, address!),
      enabled: isConnected && !!address,
    },
  )

  const {
    writeContract: requestWithdrawal,
    data: withdrawTxHash,
    isPending: isRequesting,
    error: requestError,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: withdrawTxHash })

  useEffect(() => {
    if (isConfirmed) {
      queryClient.invalidateQueries({ queryKey: ['vault', slug] })
      queryClient.invalidateQueries({ queryKey: ['user', slug] })
      setStep('success')
    }
  }, [isConfirmed, queryClient, slug])

  useEffect(() => {
    if (requestError) setError(requestError.message)
  }, [requestError])

  const parsedShares = shares ? parseUnits(shares, USDC_DECIMALS) : BigInt(0)
  const hasEnoughShares =
    shareBalance !== undefined && parsedShares <= shareBalance

  const estimatedValue =
    shares && navPerShare ? (parseFloat(shares) * Number(navPerShare)) / 1e6 : 0

  const handleContinue = () => {
    setError(null)
    if (!vaultAddress) {
      setError('Vault contract not configured')
      return
    }
    if (!hasEnoughShares) {
      setError('Insufficient shares')
      return
    }
    if (parsedShares === BigInt(0)) {
      setError('Enter an amount greater than 0')
      return
    }

    setStep('request')
    executeRequest()
  }

  const executeRequest = () => {
    if (!vaultAddress) return
    requestWithdrawal({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'requestRedeem',
      args: [parsedShares],
    })
  }

  const handleRetry = () => {
    setError(null)
    executeRequest()
  }

  const resetForm = () => {
    setShares('')
    setStep('input')
    setError(null)
  }

  const pendingWithdrawals = withdrawalsResponse?.data?.filter(
    (w) => w.status === 'pending' || w.status === 'processing',
  )

  if (vaultLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <span className="ml-3 text-gray-400">Loading vault...</span>
        </div>
      </div>
    )
  }

  if (!vault) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-lg mx-auto px-6 py-12">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-4" />
            <h3 className="text-red-400 font-semibold text-center">
              Vault not found
            </h3>
          </div>
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-lg mx-auto px-6 py-12">
          <NotConnectedState vaultName={vault.name} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-lg mx-auto px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {vault.name}
        </Link>

        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <ArrowUpFromLine className="w-8 h-8 text-cyan-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">
                Request Withdrawal
              </h1>
              <p className="text-gray-400 text-sm">{vault.name}</p>
            </div>
          </div>

          {step === 'input' && (
            <InputStep
              shares={shares}
              setShares={setShares}
              shareBalance={shareBalance}
              estimatedValue={estimatedValue}
              error={error}
              hasEnoughShares={hasEnoughShares}
              onContinue={handleContinue}
            />
          )}

          {step === 'request' && (
            <TransactionStep
              title="Requesting Withdrawal"
              description="Locking your shares for withdrawal"
              isPending={isRequesting}
              isConfirming={isConfirming}
              error={error}
              onRetry={handleRetry}
              onCancel={resetForm}
            />
          )}

          {step === 'success' && (
            <SuccessStep
              shares={shares}
              estimatedValue={estimatedValue}
              txHash={withdrawTxHash}
              onDone={resetForm}
            />
          )}
        </div>

        {pendingWithdrawals &&
          pendingWithdrawals.length > 0 &&
          vaultAddress && (
            <PendingWithdrawals
              withdrawals={pendingWithdrawals}
              loading={withdrawalsLoading}
              vaultAddress={vaultAddress}
              onClaimSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['user', slug] })
              }}
            />
          )}
      </div>
    </div>
  )
}

interface InputStepProps {
  shares: string
  setShares: (v: string) => void
  shareBalance: bigint | undefined
  estimatedValue: number
  error: string | null
  hasEnoughShares: boolean
  onContinue: () => void
}

function InputStep({
  shares,
  setShares,
  shareBalance,
  estimatedValue,
  error,
  hasEnoughShares,
  onContinue,
}: InputStepProps) {
  const formattedBalance = shareBalance
    ? formatUnits(shareBalance, USDC_DECIMALS)
    : '0'

  const setMaxShares = () => {
    if (shareBalance) {
      setShares(formatUnits(shareBalance, USDC_DECIMALS))
    }
  }

  const isValid = shares && parseFloat(shares) > 0 && hasEnoughShares

  return (
    <>
      <div className="mb-6">
        <label className="block text-gray-400 text-sm mb-2">
          Shares to Withdraw
        </label>
        <div className="relative">
          <input
            type="number"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-cyan-500 transition-colors"
          />
          <button
            onClick={setMaxShares}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 text-sm font-medium hover:text-cyan-300"
          >
            MAX
          </button>
        </div>
        <div className="flex justify-between text-sm mt-2">
          <span className="text-gray-500">
            Available:{' '}
            {parseFloat(formattedBalance).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}{' '}
            shares
          </span>
        </div>
      </div>

      {shares && parseFloat(shares) > 0 && (
        <div className="bg-slate-700/50 rounded-lg p-4 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Estimated value</span>
            <span className="text-white font-medium">
              ~$
              {estimatedValue.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{' '}
              USDC
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span className="text-red-400 text-sm">{error}</span>
        </div>
      )}

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6 flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="text-amber-400 font-medium mb-1">
            Resolution-Based Withdrawals
          </p>
          <p className="text-amber-300/70">
            Withdrawals are processed as positions resolve. Your USDC will be
            released proportionally over time based on your share of the vault.
          </p>
        </div>
      </div>

      <button
        onClick={onContinue}
        disabled={!isValid}
        className="w-full py-4 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
      >
        Request Withdrawal
      </button>
    </>
  )
}

interface TransactionStepProps {
  title: string
  description: string
  isPending: boolean
  isConfirming: boolean
  error: string | null
  onRetry: () => void
  onCancel: () => void
}

function TransactionStep({
  title,
  description,
  isPending,
  isConfirming,
  error,
  onRetry,
  onCancel,
}: TransactionStepProps) {
  const isLoading = isPending || isConfirming

  return (
    <div className="text-center py-8">
      {isLoading && !error && (
        <>
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
          <p className="text-gray-400 mb-2">{description}</p>
          <p className="text-gray-500 text-sm">
            {isPending
              ? 'Confirm in your wallet...'
              : 'Waiting for confirmation...'}
          </p>
        </>
      )}

      {error && (
        <>
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Transaction Failed
          </h3>
          <p className="text-red-400 text-sm mb-6 break-all">{error}</p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onRetry}
              className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-medium rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        </>
      )}
    </div>
  )
}

interface SuccessStepProps {
  shares: string
  estimatedValue: number
  txHash: Address | undefined
  onDone: () => void
}

function SuccessStep({
  shares,
  estimatedValue,
  txHash,
  onDone,
}: SuccessStepProps) {
  const explorerUrl = `https://polygonscan.com/tx/${txHash}`

  return (
    <div className="text-center py-8">
      <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
      <h3 className="text-2xl font-bold text-white mb-2">
        Withdrawal Requested!
      </h3>
      <p className="text-gray-400 mb-6">
        You've requested to withdraw {shares} shares (~$
        {estimatedValue.toFixed(2)} USDC). Funds will be released as positions
        resolve.
      </p>

      {txHash && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-cyan-400 hover:text-cyan-300 text-sm mb-6"
        >
          View transaction on Polygonscan
        </a>
      )}

      <div className="flex gap-4 justify-center">
        <button
          onClick={onDone}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
        >
          Withdraw More
        </button>
        <Link
          to="/"
          className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-medium rounded-lg transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}

interface PendingWithdrawalsProps {
  withdrawals: WithdrawalRecord[]
  loading: boolean
  vaultAddress: Address
  onClaimSuccess: () => void
}

function PendingWithdrawals({
  withdrawals,
  loading,
  vaultAddress,
  onClaimSuccess,
}: PendingWithdrawalsProps) {
  if (loading) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          <span className="text-gray-400">Loading pending withdrawals...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-amber-400" />
        Pending Withdrawals
      </h3>
      <div className="space-y-4">
        {withdrawals.map((w) => {
          const timeRemaining = getTimeUntilClaimable(w.requestedAt)
          const isClaimable = timeRemaining <= 0

          return (
            <div key={w.id} className="bg-slate-700/50 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-white font-medium">
                    {parseFloat(w.sharesLocked).toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })}{' '}
                    shares
                  </div>
                  <div className="text-gray-500 text-sm">
                    {parseFloat(w.ownershipPct).toFixed(2)}% of vault
                  </div>
                </div>
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    w.status === 'processing'
                      ? 'bg-blue-500/20 text-blue-400'
                      : w.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {w.status}
                </span>
              </div>

              <div className="text-gray-500 text-sm">
                Requested {new Date(w.requestedAt).toLocaleDateString()}
              </div>

              {!isClaimable && (
                <div className="text-amber-400 text-sm mt-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatTimeRemaining(timeRemaining)}
                </div>
              )}

              {parseFloat(w.totalClaimedUsdc) > 0 && (
                <div className="text-green-400 text-sm mt-1">
                  ${parseFloat(w.totalClaimedUsdc).toFixed(2)} claimed so far
                </div>
              )}

              {isClaimable && w.status !== 'completed' && (
                <div className="mt-3">
                  <ClaimButton
                    withdrawalId={w.id}
                    vaultAddress={vaultAddress}
                    onSuccess={onClaimSuccess}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NotConnectedState({ vaultName }: { vaultName: string }) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-8 text-center">
      <Wallet className="w-12 h-12 text-gray-500 mx-auto mb-4" />
      <h3 className="text-xl font-semibold text-white mb-2">
        Connect Your Wallet
      </h3>
      <p className="text-gray-400 mb-6">
        Connect your wallet to request a withdrawal from {vaultName}.
      </p>
      <appkit-button />
    </div>
  )
}

interface ClaimButtonProps {
  withdrawalId: number
  vaultAddress: Address
  onSuccess: () => void
}

function ClaimButton({
  withdrawalId,
  vaultAddress,
  onSuccess,
}: ClaimButtonProps) {
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const {
    data: claimData,
    isLoading: isLoadingClaimData,
    refetch,
  } = useQuery({
    queryKey: ['claimData', withdrawalId],
    queryFn: () => api.withdrawals.getClaimData(withdrawalId),
    retry: false,
  })

  const {
    writeContract: claimWithdrawal,
    data: claimTxHash,
    isPending: isClaiming,
    error: claimError,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: claimTxHash })

  useEffect(() => {
    if (claimError) setError(claimError.message)
  }, [claimError])

  useEffect(() => {
    if (isConfirmed) {
      queryClient.invalidateQueries({ queryKey: ['claimData', withdrawalId] })
      queryClient.invalidateQueries({ queryKey: ['user'] })
      onSuccess()
    }
  }, [isConfirmed, queryClient, withdrawalId, onSuccess])

  const handleClaim = () => {
    if (!claimData) return
    setError(null)
    claimWithdrawal({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'claim',
      args: [
        BigInt(claimData.onChainRequestId),
        BigInt(claimData.cumulativeClaimable),
        claimData.merkleProof as `0x${string}`[],
      ],
    })
  }

  const isLoading = isClaiming || isConfirming

  if (isLoadingClaimData) {
    return (
      <button
        disabled
        className="px-3 py-1.5 bg-gray-600 text-gray-400 text-sm rounded-lg flex items-center gap-2"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading...
      </button>
    )
  }

  if (!claimData || parseFloat(claimData.pendingClaimUsdc) <= 0) {
    return (
      <button
        onClick={() => refetch()}
        className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-gray-300 text-sm rounded-lg"
      >
        Check for claims
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClaim}
        disabled={isLoading}
        className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg flex items-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            {isClaiming ? 'Confirm...' : 'Processing...'}
          </>
        ) : (
          <>
            <Download className="w-3 h-3" />
            Claim ${parseFloat(claimData.pendingClaimUsdc).toFixed(2)}
          </>
        )}
      </button>
      {error && (
        <span className="text-red-400 text-xs">{error.slice(0, 50)}...</span>
      )}
    </div>
  )
}
