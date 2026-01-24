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
} from 'lucide-react'
import {
  VAULT_ABI,
  ERC20_ABI,
  getUsdcAddress,
  USDC_DECIMALS,
} from '../../../lib/contracts'
import { api } from '../../../lib/api'

export const Route = createFileRoute('/vault/$slug/deposit')({
  component: DepositPage,
})

type DepositStep = 'input' | 'approve' | 'deposit' | 'success'

function DepositPage() {
  const { slug } = useParams({ from: '/vault/$slug/deposit' })
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<DepositStep>('input')
  const [error, setError] = useState<string | null>(null)

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
    if (isApproveConfirmed) {
      refetchAllowance()
      setStep('deposit')
    }
  }, [isApproveConfirmed, refetchAllowance])

  useEffect(() => {
    if (isDepositConfirmed) {
      queryClient.invalidateQueries({ queryKey: ['vault', slug] })
      queryClient.invalidateQueries({ queryKey: ['user', slug] })
      setStep('success')
    }
  }, [isDepositConfirmed, queryClient, slug])

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
    if (!vaultAddress) {
      setError('Vault contract not configured')
      return
    }
    if (!hasEnoughBalance) {
      setError('Insufficient USDC balance')
      return
    }
    if (!meetsMinDeposit) {
      setError(
        `Minimum deposit is ${formatUnits(minDeposit!, USDC_DECIMALS)} USDC`,
      )
      return
    }

    if (hasAllowance) {
      setStep('deposit')
      executeDeposit()
    } else {
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
  }

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

        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <ArrowDownToLine className="w-8 h-8 text-cyan-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Deposit USDC</h1>
              <p className="text-gray-400 text-sm">{vault.name}</p>
            </div>
          </div>

          {step === 'input' && (
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
          )}

          {step === 'approve' && (
            <TransactionStep
              title="Approve USDC"
              description="Allow the vault contract to use your USDC"
              isPending={isApproving}
              isConfirming={isApproveConfirming}
              error={error}
              onRetry={handleRetry}
              onCancel={resetForm}
            />
          )}

          {step === 'deposit' && (
            <TransactionStep
              title="Deposit to Vault"
              description="Depositing USDC and receiving vault shares"
              isPending={isDepositing}
              isConfirming={isDepositConfirming}
              error={error}
              onRetry={handleRetry}
              onCancel={resetForm}
            />
          )}

          {step === 'success' && (
            <SuccessStep
              amount={amount}
              shares={previewShares}
              txHash={depositTxHash}
              onDone={resetForm}
            />
          )}
        </div>
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
    <>
      <div className="mb-6">
        <label className="block text-gray-400 text-sm mb-2">
          Amount (USDC)
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-cyan-500 transition-colors"
          />
          <button
            onClick={setMaxAmount}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 text-sm font-medium hover:text-cyan-300"
          >
            MAX
          </button>
        </div>
        <div className="flex justify-between text-sm mt-2">
          <span className="text-gray-500">
            Balance: {parseFloat(formattedBalance).toLocaleString()} USDC
          </span>
          <span className="text-gray-500">Min: {formattedMin} USDC</span>
        </div>
      </div>

      {amount && parseFloat(amount) > 0 && (
        <div className="bg-slate-700/50 rounded-lg p-4 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">You will receive</span>
            <span className="text-white font-medium">
              ~
              {parseFloat(formattedShares).toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}{' '}
              shares
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

      <div className="bg-slate-700/30 rounded-lg p-4 mb-6 flex items-start gap-3">
        <Info className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
        <p className="text-gray-400 text-sm">
          Deposits are converted to vault shares at the current NAV. Your shares
          represent ownership in the vault's total assets.
        </p>
      </div>

      <button
        onClick={onContinue}
        disabled={!isValid}
        className="w-full py-4 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
      >
        Continue
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
  amount: string
  shares: bigint | undefined
  txHash: Address | undefined
  onDone: () => void
}

function SuccessStep({ amount, shares, txHash, onDone }: SuccessStepProps) {
  const formattedShares = shares ? formatUnits(shares, USDC_DECIMALS) : '0'
  const explorerUrl = `https://polygonscan.com/tx/${txHash}`

  return (
    <div className="text-center py-8">
      <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
      <h3 className="text-2xl font-bold text-white mb-2">
        Deposit Successful!
      </h3>
      <p className="text-gray-400 mb-6">
        You deposited {amount} USDC and received{' '}
        {parseFloat(formattedShares).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })}{' '}
        vault shares.
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
          Deposit More
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

function NotConnectedState({ vaultName }: { vaultName: string }) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-8 text-center">
      <Wallet className="w-12 h-12 text-gray-500 mx-auto mb-4" />
      <h3 className="text-xl font-semibold text-white mb-2">
        Connect Your Wallet
      </h3>
      <p className="text-gray-400 mb-6">
        Connect your wallet to deposit USDC into {vaultName}.
      </p>
      <appkit-button />
    </div>
  )
}
