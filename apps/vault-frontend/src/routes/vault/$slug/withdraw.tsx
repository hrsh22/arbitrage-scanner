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
  ExternalLink,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { VAULT_ABI, USDC_DECIMALS } from '../../../lib/contracts'
import { api, type WithdrawalRecord } from '../../../lib/api'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../../../components/ui/card'

export const Route = createFileRoute('/vault/$slug/withdraw')({
  component: WithdrawPage,
})

type WithdrawStep = 'input' | 'request' | 'success'

const stepVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
}

function WithdrawPage() {
  const { slug } = useParams({ from: '/vault/$slug/withdraw' })
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()

  const [shares, setShares] = useState('')
  const [step, setStep] = useState<WithdrawStep>('input')
  const [error, setError] = useState<string | null>(null)
  const [syncWarning, setSyncWarning] = useState<string | null>(null)

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
    if (!isConfirmed) return
    if (!withdrawTxHash) return

    const ingest = async () => {
      try {
        if (vault?.id) {
          // Best-effort; if the backend can't see the receipt yet, a later poll/cron will catch up.
          // We retry a few times to reduce UX flakiness right after confirmation.
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await api.withdrawals.ingestTx({
                vaultId: vault.id,
                txHash: withdrawTxHash,
              })
              break
            } catch (e) {
              if (attempt === 3) throw e
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * attempt),
              )
            }
          }
        }
      } catch (e) {
        // Best-effort; polling/cron will catch up. Surface a user-visible warning.
        const message =
          e instanceof Error && e.message
            ? e.message
            : 'We could not sync your withdrawal yet. It should appear shortly.'
        setSyncWarning(message)
      } finally {
        queryClient.invalidateQueries({ queryKey: ['vault', slug] })
        queryClient.invalidateQueries({ queryKey: ['user', slug] })
        queryClient.invalidateQueries({
          queryKey: ['user', slug, address, 'withdrawals'],
        })
        setStep('success')
      }
    }

    void ingest()
  }, [address, isConfirmed, queryClient, slug, vault?.id, withdrawTxHash])

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
    setSyncWarning(null)
  }

  const allWithdrawals = withdrawalsResponse?.data ?? []

  if (vaultLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-cyan-400 animate-spin" />
      </div>
    )
  }

  if (!vault) {
    return (
      <div className="max-w-lg mx-auto px-6 py-12">
        <Card className="border-red-500/30 bg-red-900/10">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-red-400 mb-2">
              Vault not found
            </h3>
            <Link
              to="/"
              className="text-sm text-red-300 hover:text-red-200 underline"
            >
              Return to Dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-lg mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition-colors group"
        >
          <div className="p-2 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </div>
          <span className="font-medium">Back to Dashboard</span>
        </Link>

        {!isConnected ? (
          <NotConnectedState vaultName={vault.name} />
        ) : (
          <div className="space-y-8">
            <Card className="bg-slate-900/50 backdrop-blur-xl border-white/10 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2" />

              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <ArrowUpFromLine className="w-6 h-6 text-amber-400" />
                  </div>
                  <div>
                    <CardTitle className="text-xl font-bold text-white">
                      Request Withdrawal
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                      {vault.name}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="relative z-10">
                <AnimatePresence mode="wait">
                  {step === 'input' && (
                    <motion.div
                      key="input"
                      variants={stepVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={{ duration: 0.3 }}
                    >
                      <InputStep
                        shares={shares}
                        setShares={setShares}
                        shareBalance={shareBalance}
                        estimatedValue={estimatedValue}
                        error={error}
                        hasEnoughShares={hasEnoughShares}
                        onContinue={handleContinue}
                      />
                    </motion.div>
                  )}

                  {step === 'request' && (
                    <motion.div
                      key="request"
                      variants={stepVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={{ duration: 0.3 }}
                    >
                      <TransactionStep
                        title="Requesting Withdrawal"
                        description="Locking your shares for withdrawal"
                        isPending={isRequesting}
                        isConfirming={isConfirming}
                        error={error}
                        onRetry={handleRetry}
                        onCancel={resetForm}
                      />
                    </motion.div>
                  )}

                  {step === 'success' && (
                    <motion.div
                      key="success"
                      variants={stepVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={{ duration: 0.3 }}
                    >
                      <SuccessStep
                        shares={shares}
                        estimatedValue={estimatedValue}
                        txHash={withdrawTxHash}
                        syncWarning={syncWarning}
                        onDone={resetForm}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>

            {allWithdrawals.length > 0 && vaultAddress && (
              <WithdrawalsList
                withdrawals={allWithdrawals}
                loading={withdrawalsLoading}
                vaultAddress={vaultAddress}
                onClaimSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ['user', slug] })
                }}
              />
            )}
          </div>
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
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <Label className="text-gray-400">Shares to Withdraw</Label>
          <span className="text-xs text-gray-500">
            Available:{' '}
            {parseFloat(formattedBalance).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}
          </span>
        </div>

        <div className="relative">
          <Input
            type="number"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="0.00"
            className="pr-16 text-lg h-14 bg-slate-950/50 border-white/10 focus:border-amber-500/50 transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={setMaxShares}
              className="h-8 text-amber-400 hover:text-amber-300 hover:bg-amber-950/30 text-xs font-bold px-2"
            >
              MAX
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {shares && parseFloat(shares) > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-white/5 rounded-lg border border-white/5 flex justify-between text-sm">
              <span className="text-gray-400">Estimated Value</span>
              <span className="text-white font-mono font-medium">
                ~$
                {estimatedValue.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{' '}
                USDC.e
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3 text-red-400 text-sm"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="text-amber-400 font-medium mb-1">
            Resolution-Based Withdrawals
          </p>
          <p className="text-amber-200/70 text-xs leading-relaxed">
            Funds are released as positions resolve. Your USDC.e will be
            available to claim over time.
          </p>
        </div>
      </div>

      <Button
        onClick={onContinue}
        disabled={!isValid}
        className="w-full h-12 text-lg bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/20"
      >
        Request Withdrawal
      </Button>
    </div>
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
        <div className="space-y-6">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-white/5 border-t-amber-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-amber-400/50" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-white">{title}</h3>
            <p className="text-gray-400 text-sm">{description}</p>
          </div>
          <div className="inline-block px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-medium animate-pulse">
            {isPending ? 'Check your wallet' : 'Waiting for confirmation...'}
          </div>
        </div>
      )}

      {error && (
        <div className="space-y-6">
          <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-white">
              Transaction Failed
            </h3>
            <p className="text-red-400/80 text-sm max-w-xs mx-auto break-words bg-red-950/30 p-2 rounded border border-red-900/50 font-mono">
              {error}
            </p>
          </div>
          <div className="flex gap-3 justify-center pt-2">
            <Button
              variant="outline"
              onClick={onCancel}
              className="border-white/10 hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={onRetry}
              className="bg-amber-600 hover:bg-amber-500"
            >
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

interface SuccessStepProps {
  shares: string
  estimatedValue: number
  txHash: Address | undefined
  syncWarning: string | null
  onDone: () => void
}

function SuccessStep({
  shares,
  estimatedValue,
  txHash,
  syncWarning,
  onDone,
}: SuccessStepProps) {
  const explorerUrl = `https://polygonscan.com/tx/${txHash}`

  return (
    <div className="text-center py-6 space-y-6">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="w-20 h-20 mx-auto bg-green-500/10 rounded-full flex items-center justify-center border border-green-500/20"
      >
        <CheckCircle className="w-10 h-10 text-green-400" />
      </motion.div>

      <div className="space-y-2">
        <h3 className="text-2xl font-bold text-white">Withdrawal Requested!</h3>
        <p className="text-gray-400 text-sm max-w-xs mx-auto">
          Requested withdrawal of{' '}
          <span className="text-white font-medium">{shares} shares</span> (~$
          {estimatedValue.toFixed(2)})
        </p>
      </div>

      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-200/80">
        Funds will be claimable as positions resolve over the next few days.
      </div>

      {syncWarning && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200/80">
          <div className="font-medium text-amber-200 mb-1">Sync pending</div>
          <div className="break-words">{syncWarning}</div>
        </div>
      )}

      {txHash && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs transition-colors"
        >
          View on Polygonscan <ExternalLink className="w-3 h-3" />
        </a>
      )}

      <div className="grid grid-cols-2 gap-3 pt-4">
        <Button
          variant="outline"
          onClick={onDone}
          className="border-white/10 hover:bg-white/5"
        >
          Request More
        </Button>
        <Button asChild className="bg-amber-600 hover:bg-amber-500">
          <Link to="/">Dashboard</Link>
        </Button>
      </div>
    </div>
  )
}

interface WithdrawalsListProps {
  withdrawals: WithdrawalRecord[]
  loading: boolean
  vaultAddress: Address
  onClaimSuccess: () => void
}

function WithdrawalsList({
  withdrawals,
  loading,
  vaultAddress,
  onClaimSuccess,
}: WithdrawalsListProps) {
  if (loading) {
    return (
      <Card className="bg-white/5 border-white/5">
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          <span className="text-gray-400">Loading withdrawals...</span>
        </CardContent>
      </Card>
    )
  }

  const pending = withdrawals.filter(
    (w) => w.status === 'pending' || w.status === 'processing',
  )
  const completed = withdrawals.filter((w) => w.status === 'completed')

  return (
    <div className="space-y-8">
      {pending.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            Pending Withdrawals
          </h3>
          <div className="space-y-4">
            {pending.map((w) => {
              return (
                <Card
                  key={w.id}
                  className="bg-slate-900/30 border-white/10 overflow-hidden"
                >
                  <div className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-mono font-medium text-lg">
                          {parseFloat(w.sharesLocked).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 4 },
                          )}{' '}
                          Shares
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full ${
                            w.status === 'processing'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {w.status}
                        </span>
                      </div>
                      <div className="text-gray-500 text-sm mb-3">
                        Requested {new Date(w.requestedAt).toLocaleDateString()}{' '}
                        • {parseFloat(w.ownershipPct).toFixed(2)}% ownership
                      </div>

                      <div className="inline-flex items-center gap-1.5 text-amber-400 bg-amber-950/30 px-3 py-1.5 rounded-lg text-sm border border-amber-500/20">
                        <Clock className="w-3.5 h-3.5" />
                        Check claims for availability
                      </div>
                    </div>

                    <div className="sm:text-right flex items-end sm:justify-end">
                      <ClaimButton
                        withdrawalId={w.id}
                        vaultAddress={vaultAddress}
                        onSuccess={onClaimSuccess}
                      />
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            Completed Withdrawals
          </h3>
          <div className="space-y-4">
            {completed.map((w) => (
              <Card
                key={w.id}
                className="bg-slate-900/30 border-white/5 opacity-75 hover:opacity-100 transition-opacity"
              >
                <div className="p-4 flex flex-col sm:flex-row justify-between gap-4">
                  <div>
                    <div className="text-white font-medium mb-1">
                      {parseFloat(w.sharesLocked).toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}{' '}
                      Shares
                    </div>
                    <div className="text-gray-500 text-xs">
                      Requested {new Date(w.requestedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-green-400 font-medium flex items-center justify-end gap-1.5">
                      <CheckCircle className="w-4 h-4" />
                      Claimed ${parseFloat(w.totalClaimedUsdc).toFixed(2)}
                    </div>
                    <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full bg-green-500/10 text-green-500/70 inline-block mt-1">
                      Completed
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NotConnectedState({ vaultName }: { vaultName: string }) {
  return (
    <Card className="bg-slate-900/50 backdrop-blur-xl border-white/10 text-center py-12 px-6">
      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
        <Wallet className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
      <p className="text-gray-400 mb-8 max-w-xs mx-auto">
        Connect your wallet to manage withdrawals from{' '}
        <span className="text-cyan-400">{vaultName}</span>.
      </p>
      <div className="flex justify-center">
        <appkit-button />
      </div>
    </Card>
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
  const [isPreparingClaim, setIsPreparingClaim] = useState(false)
  const queryClient = useQueryClient()

  const {
    data: claimData,
    isLoading: isLoadingClaimData,
    isFetching: isFetchingClaimData,
    isError: isClaimDataError,
    error: claimDataError,
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
    if (!isConfirmed || !claimTxHash) return

    const ingestClaim = async () => {
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await api.withdrawals.ingestClaim(withdrawalId, claimTxHash)
            break
          } catch (e) {
            if (attempt === 3) throw e
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
          }
        }
      } catch {
        await api.withdrawals.getClaimData(withdrawalId).catch(() => {})
      } finally {
        queryClient.invalidateQueries({ queryKey: ['claimData', withdrawalId] })
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'user',
        })
        onSuccess()
      }
    }

    void ingestClaim()
  }, [isConfirmed, claimTxHash, queryClient, withdrawalId, onSuccess])

  const handleClaim = async () => {
    setError(null)

    try {
      setIsPreparingClaim(true)

      // Fetch fresh signature/deadline right before claiming.
      const freshClaimData = await api.withdrawals.getClaimData(withdrawalId)
      queryClient.setQueryData(['claimData', withdrawalId], freshClaimData)

      if (freshClaimData.claimMode === 'v1') return

      claimWithdrawal({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'claim',
        args: [
          BigInt(freshClaimData.onChainRequestId),
          BigInt(freshClaimData.cumulativeClaimable),
          BigInt(freshClaimData.deadline),
          freshClaimData.signature as `0x${string}`,
        ],
      })
    } catch (e) {
      setError((e as Error).message || 'Failed to fetch claim data')
    } finally {
      setIsPreparingClaim(false)
    }
  }

  const isLoading = isPreparingClaim || isClaiming || isConfirming
  const isCheckingClaims = isLoadingClaimData || isFetchingClaimData

  if (isCheckingClaims) {
    return (
      <Button disabled variant="outline" size="sm" className="gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading...
      </Button>
    )
  }

  if (!claimData) {
    return (
      <div className="flex flex-col gap-2 items-end">
        <Button
          onClick={() => refetch()}
          variant="outline"
          size="sm"
          className="bg-slate-800 border-white/10 hover:bg-slate-700"
        >
          Check Claims
        </Button>
        {isClaimDataError && (
          <span className="text-amber-300 text-[10px] max-w-[220px] text-right leading-tight">
            {(claimDataError as Error).message}
          </span>
        )}
      </div>
    )
  }

  const pendingAmount = parseFloat(claimData.pendingClaimUsdc)
  const claimedAmount = parseFloat(claimData.alreadyClaimedUsdc)

  if (claimData.claimMode === 'v1') {
    return (
      <div className="flex flex-col gap-2 items-end">
        <div className="text-xs text-gray-300">
          Pending ${pendingAmount.toFixed(2)}
        </div>
        <span className="text-amber-300 text-[10px] max-w-[220px] text-right leading-tight">
          This vault uses Merkle claims (v1). Claiming from the UI isn’t
          supported yet.
        </span>
      </div>
    )
  }

  if (pendingAmount <= 0 && claimedAmount > 0) {
    return (
      <div className="flex items-center gap-2 text-green-400 text-sm font-medium bg-green-950/30 px-3 py-2 rounded-lg border border-green-500/20">
        <CheckCircle className="w-4 h-4" />
        Claimed ${claimedAmount.toFixed(2)}
      </div>
    )
  }

  if (pendingAmount <= 0) {
    return (
      <div className="flex flex-col gap-2 items-end">
        <Button
          onClick={() => refetch()}
          variant="outline"
          size="sm"
          className="bg-slate-800 border-white/10 hover:bg-slate-700"
        >
          Check Claims
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        onClick={handleClaim}
        disabled={isLoading}
        size="sm"
        className="bg-green-600 hover:bg-green-500 text-white gap-2 shadow-lg shadow-green-900/20"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {isClaiming ? 'Confirm...' : 'Processing...'}
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Claim ${parseFloat(claimData.pendingClaimUsdc).toFixed(2)}
          </>
        )}
      </Button>
      {error && (
        <span className="text-red-400 text-[10px] max-w-[150px] text-right leading-tight">
          {error.slice(0, 50)}...
        </span>
      )}
    </div>
  )
}
