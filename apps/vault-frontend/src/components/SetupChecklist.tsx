import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Loader2, AlertCircle, Shield } from 'lucide-react'
import { api, type SetupStatus } from '../lib/api'

interface SetupChecklistProps {
  vaultId: number
  adminAddress: string
}

export function SetupChecklist({ vaultId, adminAddress }: SetupChecklistProps) {
  const queryClient = useQueryClient()

  const {
    data: statusResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin', 'vault', vaultId, 'setup-status', adminAddress],
    queryFn: () => api.admin.getSetupStatus(adminAddress, vaultId),
  })

  const approveVaultMutation = useMutation({
    mutationFn: () => api.admin.approveVault(adminAddress, vaultId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'vault', vaultId, 'setup-status'],
      })
    },
  })

  const approvePolymarketMutation = useMutation({
    mutationFn: () => api.admin.approvePolymarket(adminAddress, vaultId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'vault', vaultId, 'setup-status'],
      })
    },
  })

  if (isLoading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading setup status...
        </div>
      </div>
    )
  }

  if (error || !statusResponse?.data) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>Failed to load setup status</span>
        </div>
      </div>
    )
  }

  const status: SetupStatus = statusResponse.data

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8">
      <div className="flex items-center gap-3 mb-4">
        <Shield className="w-5 h-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Treasury Setup</h3>
        {status.isTestnet && (
          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded-full">
            Testnet
          </span>
        )}
      </div>

      <div className="mb-4 bg-slate-900/50 rounded-lg px-4 py-3">
        <span className="text-gray-400 text-sm">Treasury Address: </span>
        <code className="text-gray-300 text-sm font-mono">
          {status.treasuryAddress.slice(0, 6)}...
          {status.treasuryAddress.slice(-4)}
        </code>
      </div>

      <div className="space-y-4">
        <ChecklistItem
          label="USDC approved for Vault Contract"
          description="Required for processing user withdrawals"
          approved={status.vaultApproved}
          onApprove={() => approveVaultMutation.mutate()}
          isApproving={approveVaultMutation.isPending}
          approveError={
            approveVaultMutation.error instanceof Error
              ? approveVaultMutation.error.message
              : null
          }
        />

        {!status.isTestnet && (
          <ChecklistItem
            label="Polymarket Contracts"
            description="USDC and CTF token approvals for trading"
            approved={status.polymarketApproved}
            onApprove={() => approvePolymarketMutation.mutate()}
            isApproving={approvePolymarketMutation.isPending}
            approveError={
              approvePolymarketMutation.error instanceof Error
                ? approvePolymarketMutation.error.message
                : null
            }
            details={status.polymarketDetails}
          />
        )}
      </div>
    </div>
  )
}

function ChecklistItem({
  label,
  description,
  approved,
  onApprove,
  isApproving,
  approveError,
  details,
}: {
  label: string
  description: string
  approved: boolean
  onApprove: () => void
  isApproving: boolean
  approveError: string | null
  details?: SetupStatus['polymarketDetails']
}) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          {approved ? (
            <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-4 h-4 text-green-400" />
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <X className="w-4 h-4 text-red-400" />
            </div>
          )}
          <div>
            <span className="text-white font-medium">{label}</span>
            <p className="text-gray-500 text-sm">{description}</p>
          </div>
        </div>

        {!approved && (
          <button
            onClick={onApprove}
            disabled={isApproving}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-500/50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            {isApproving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Approving...
              </>
            ) : (
              'Approve'
            )}
          </button>
        )}
      </div>

      {approveError && (
        <div className="mt-2 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {approveError}
        </div>
      )}

      {details && !approved && (
        <div className="mt-3 pl-9 space-y-1 text-sm">
          <DetailRow label="USDC → CTF" approved={details.usdcForCtf} />
          <DetailRow
            label="USDC → CTF Exchange"
            approved={details.usdcForCtfExchange}
          />
          <DetailRow
            label="USDC → Neg Risk Exchange"
            approved={details.usdcForNegRiskExchange}
          />
          <DetailRow
            label="USDC → Neg Risk Adapter"
            approved={details.usdcForNegRiskAdapter}
          />
          <DetailRow
            label="CTF → CTF Exchange"
            approved={details.ctfForCtfExchange}
          />
          <DetailRow
            label="CTF → Neg Risk Exchange"
            approved={details.ctfForNegRiskExchange}
          />
          <DetailRow
            label="CTF → Neg Risk Adapter"
            approved={details.ctfForNegRiskAdapter}
          />
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, approved }: { label: string; approved: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {approved ? (
        <Check className="w-3 h-3 text-green-400" />
      ) : (
        <X className="w-3 h-3 text-red-400" />
      )}
      <span className={approved ? 'text-gray-400' : 'text-gray-500'}>
        {label}
      </span>
    </div>
  )
}
