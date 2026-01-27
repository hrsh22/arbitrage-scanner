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
  ArrowDownToLine,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle,
  Wallet,
  Info,
  ExternalLink,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  VAULT_ABI,
  ERC20_ABI,
  getUsdcAddress,
  USDC_DECIMALS,
} from '../../../lib/contracts'
import { api } from '../../../lib/api'
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

export const Route = createFileRoute('/vault/$slug/deposit')({
  component: DepositPage,
})

type DepositStep = 'input' | 'approve' | 'deposit' | 'success'

const stepVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
}

function DepositPage() {
  const { slug } = useParams({ from: '/vault/$slug/deposit' })
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<DepositStep>('input')
  const [error, setError] = useState<string | null>(null)
  const [shouldAutoDeposit, setShouldAutoDeposit] = useState(false)

  const { data: vaultResponse, isLoading: vaultLoading } = useQuery({
    queryKey: ['vault', slug],
    queryFn: () => api.vaults.get(slug),
  })

  const vault = vaultResponse?.data
  const vaultAddress = vault?.contractAddress as Address | undefined
  const usdcAddress = getUsdcAddress()

  const { data: usdcBalance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address },
  })

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && vaultAddress ? [address, vaultAddress] : undefined,
    query: { enabled: isConnected && !!address && !!vaultAddress },
  })

  const { data: minDeposit } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'minDeposit',
    query: { enabled: !!vaultAddress },
  })

  const { data: previewShares } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'previewDeposit',
    args: amount ? [parseUnits(amount || '0', USDC_DECIMALS)] : undefined,
    query: { enabled: !!vaultAddress && !!amount && parseFloat(amount) > 0 },
  })

  const {
    writeContract: approveUsdc,
    data: approveTxHash,
    isPending: isApproving,
    error: approveError,
  } = useWriteContract()

  const {
    writeContract: depositToVault,
    data: depositTxHash,
    isPending: isDepositing,
    error: depositError,
  } = useWriteContract()

  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({ hash: approveTxHash })

  const { isLoading: isDepositConfirming, isSuccess: isDepositConfirmed } =
    useWaitForTransactionReceipt({ hash: depositTxHash })

  useEffect(() => {
    if (!isApproveConfirmed) return
    refetchAllowance()
    setStep('deposit')
    if (shouldAutoDeposit) {
      setShouldAutoDeposit(false)
      executeDeposit()
    }
  }, [isApproveConfirmed, refetchAllowance, shouldAutoDeposit])

  useEffect(() => {
    if (isDepositConfirmed && depositTxHash) {
      // Ingest the deposit transaction to sync backend DB immediately
      api.deposits
        .ingest({ vaultSlug: slug, txHash: depositTxHash })
        .catch((err) => {
          // Non-blocking: self-healing will catch it if this fails
          console.warn('Deposit ingest failed (will self-heal):', err)
        })
        .finally(() => {
          queryClient.invalidateQueries({ queryKey: ['vault', slug] })
          queryClient.invalidateQueries({ queryKey: ['user', slug] })
          setStep('success')
        })
    }
  }, [isDepositConfirmed, depositTxHash, queryClient, slug])

  useEffect(() => {
    if (approveError) setError(approveError.message)
    if (depositError) setError(depositError.message)
  }, [approveError, depositError])

  const parsedAmount = amount ? parseUnits(amount, USDC_DECIMALS) : BigInt(0)
  const hasEnoughBalance =
    usdcBalance !== undefined && parsedAmount <= usdcBalance
  const hasAllowance = allowance !== undefined && parsedAmount <= allowance
  const meetsMinDeposit = minDeposit === undefined || parsedAmount >= minDeposit

  const handleContinue = () => {
    setError(null)
    setShouldAutoDeposit(false)
    if (!vaultAddress) {
      setError('Vault contract not configured')
      return
    }
    if (!hasEnoughBalance) {
      setError('Insufficient USDC.e balance')
      return
    }
    if (!meetsMinDeposit) {
      setError(
        `Minimum deposit is ${formatUnits(minDeposit!, USDC_DECIMALS)} USDC.e`,
      )
      return
    }

    if (hasAllowance) {
      setStep('deposit')
      executeDeposit()
    } else {
      setShouldAutoDeposit(true)
      setStep('approve')
      executeApprove()
    }
  }

  const executeApprove = () => {
    if (!vaultAddress) return
    approveUsdc({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, parsedAmount],
    })
  }

  const executeDeposit = () => {
    if (!vaultAddress || !address) return
    depositToVault({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [parsedAmount, address],
    })
  }

  const handleRetry = () => {
    setError(null)
    if (step === 'approve') {
      executeApprove()
    } else if (step === 'deposit') {
      executeDeposit()
    }
  }

  const resetForm = () => {
    setAmount('')
    setStep('input')
    setError(null)
    setShouldAutoDeposit(false)
  }

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
          <Card className="bg-slate-900/50 backdrop-blur-xl border-white/10 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2" />

            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/20">
                  <ArrowDownToLine className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                  <CardTitle className="text-xl font-bold text-white">
                    Deposit USDC.e
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
                      amount={amount}
                      setAmount={setAmount}
                      usdcBalance={usdcBalance}
                      minDeposit={minDeposit}
                      previewShares={previewShares}
                      error={error}
                      hasEnoughBalance={hasEnoughBalance}
                      meetsMinDeposit={meetsMinDeposit}
                      onContinue={handleContinue}
                    />
                  </motion.div>
                )}

                {step === 'approve' && (
                  <motion.div
                    key="approve"
                    variants={stepVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={{ duration: 0.3 }}
                  >
                    <TransactionStep
                      title="Approve USDC.e"
                      description="Allow the vault contract to use your USDC.e"
                      isPending={isApproving}
                      isConfirming={isApproveConfirming}
                      error={error}
                      onRetry={handleRetry}
                      onCancel={resetForm}
                    />
                  </motion.div>
                )}

                {step === 'deposit' && (
                  <motion.div
                    key="deposit"
                    variants={stepVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={{ duration: 0.3 }}
                  >
                    <TransactionStep
                      title="Deposit to Vault"
                      description="Depositing USDC.e and receiving vault shares"
                      isPending={isDepositing}
                      isConfirming={isDepositConfirming}
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
                      amount={amount}
                      shares={previewShares}
                      txHash={depositTxHash}
                      onDone={resetForm}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

interface InputStepProps {
  amount: string
  setAmount: (v: string) => void
  usdcBalance: bigint | undefined
  minDeposit: bigint | undefined
  previewShares: bigint | undefined
  error: string | null
  hasEnoughBalance: boolean
  meetsMinDeposit: boolean
  onContinue: () => void
}

function InputStep({
  amount,
  setAmount,
  usdcBalance,
  minDeposit,
  previewShares,
  error,
  hasEnoughBalance,
  meetsMinDeposit,
  onContinue,
}: InputStepProps) {
  const formattedBalance = usdcBalance
    ? formatUnits(usdcBalance, USDC_DECIMALS)
    : '0'
  const formattedMin = minDeposit
    ? formatUnits(minDeposit, USDC_DECIMALS)
    : '10'
  const formattedShares = previewShares
    ? formatUnits(previewShares, USDC_DECIMALS)
    : '0'

  const setMaxAmount = () => {
    if (usdcBalance) {
      setAmount(formatUnits(usdcBalance, USDC_DECIMALS))
    }
  }

  const isValid =
    amount && parseFloat(amount) > 0 && hasEnoughBalance && meetsMinDeposit

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <Label className="text-gray-400">Amount (USDC.e)</Label>
          <div className="flex gap-2 text-xs">
            <span className="text-gray-500">Min: {formattedMin}</span>
            <span className="text-gray-500">
              Bal: {parseFloat(formattedBalance).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="relative">
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="pr-16 text-lg h-14 bg-slate-950/50 border-white/10 focus:border-cyan-500/50 transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={setMaxAmount}
              className="h-8 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/30 text-xs font-bold px-2"
            >
              MAX
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {amount && parseFloat(amount) > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-white/5 rounded-lg border border-white/5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Receive Amount</span>
                <span className="text-white font-mono font-medium flex items-center gap-1">
                  {parseFloat(formattedShares).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}
                  <span className="text-xs text-gray-500 uppercase">
                    Shares
                  </span>
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Rate</span>
                <span className="text-gray-500 font-mono">
                  1 Share = ~$
                  {(
                    parseFloat(amount) / parseFloat(formattedShares || '1')
                  ).toFixed(4)}{' '}
                  USDC
                </span>
              </div>
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

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-blue-200/80 text-xs leading-relaxed">
          Deposits are converted to vault shares at the current NAV. Your shares
          represent proportional ownership of the vault's assets and future
          yield.
        </p>
      </div>

      <Button
        onClick={onContinue}
        disabled={!isValid}
        className="w-full h-12 text-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/20"
      >
        Continue
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
            <div className="absolute inset-0 rounded-full border-4 border-white/5 border-t-cyan-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-cyan-400/50" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-white">{title}</h3>
            <p className="text-gray-400 text-sm">{description}</p>
          </div>
          <div className="inline-block px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-medium animate-pulse">
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
            <Button onClick={onRetry} className="bg-cyan-600 hover:bg-cyan-500">
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

interface SuccessStepProps {
  amount: string
  shares: bigint | undefined
  txHash: Address | undefined
  onDone: () => void
}

function SuccessStep({ amount, shares, txHash, onDone }: SuccessStepProps) {
  const formattedShares = shares ? formatUnits(shares, USDC_DECIMALS) : '0'
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
        <h3 className="text-2xl font-bold text-white">Deposit Successful!</h3>
        <p className="text-gray-400 text-sm max-w-xs mx-auto">
          You have successfully deposited{' '}
          <span className="text-white font-medium">{amount} USDC.e</span>
        </p>
      </div>

      <div className="p-4 bg-white/5 rounded-xl border border-white/5">
        <div className="text-sm text-gray-500 mb-1">You Received</div>
        <div className="text-2xl font-mono font-bold text-green-400">
          {parseFloat(formattedShares).toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })}
          <span className="text-sm text-gray-500 ml-2 font-sans font-normal">
            Shares
          </span>
        </div>
      </div>

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
          Deposit More
        </Button>
        <Button asChild className="bg-cyan-600 hover:bg-cyan-500">
          <Link to="/">Dashboard</Link>
        </Button>
      </div>
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
        Connect your wallet to deposit USDC.e into{' '}
        <span className="text-cyan-400">{vaultName}</span>.
      </p>
      <div className="flex justify-center">
        <appkit-button />
      </div>
    </Card>
  )
}
