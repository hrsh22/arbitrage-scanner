import { env } from './env'

const API_BASE = env.VITE_API_URL

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `API error: ${response.status}`)
  }

  return response.json()
}

export interface Vault {
  id: number
  name: string
  slug: string
  description: string | null
  contractAddress: string
  safeAddress: string
  adminAddress: string
  status: 'draft' | 'public' | 'paused'
  createdAt: string
  updatedAt: string
}

export interface VaultStatus {
  totalShares: string
  totalAssetsUsdc: string
  idleUsdc: string
  navPerShare: string
  lastNavUpdateAt: string
  depositsEnabled: boolean
  withdrawalsEnabled: boolean
  openPositionsCount: number
  contractAddress: string
  treasuryAddress: string
}

export interface VaultState {
  id: number
  vaultId: number
  totalShares: string
  totalAssetsUsdc: string
  idleUsdc: string
  navPerShare: string
  lastNavUpdateAt: string
  depositsEnabled: boolean
  withdrawalsEnabled: boolean
  updatedAt: string
}

export interface UserPosition {
  shares: string
  valueUsdc: string
  ownershipPct: string
  pendingWithdrawal: boolean
}

export interface UserData {
  user: {
    id: number
    walletAddress: string
  }
  position: UserPosition
}

export interface DepositRecord {
  id: number
  txHash: string
  amountUsdc: string
  sharesReceived: string
  navAtDeposit: string
  createdAt: string
}

export interface ClaimRecord {
  id: number
  positionId: number
  marketQuestion: string
  sharesClaimed: string
  status: 'pending' | 'resolved_win' | 'resolved_loss' | 'claimed'
  resolutionValueUsdc: string | null
  claimedAt: string | null
}

export interface WithdrawalRecord {
  id: number
  sharesLocked: string
  ownershipPct: string
  idleUsdcClaim: string
  status: 'pending' | 'processing' | 'completed' | 'cancelled'
  requestedAt: string
  completedAt: string | null
  totalClaimedUsdc: string
  claims: ClaimRecord[]
}

export interface PendingWithdrawal {
  id: number
  vaultId: number
  userId: number
  sharesLocked: string
  ownershipPct: string
  idleUsdcClaim: string
  status: string
  requestedAt: string
}

export interface ClaimData {
  onChainRequestId: number
  cumulativeClaimable: string
  merkleProof: string[]
  merkleRoot: string
  pendingClaimUsdc: string
  alreadyClaimedUsdc: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export const api = {
  vaults: {
    list: () => fetchApi<ApiResponse<Vault[]>>('/vaults'),
    get: (slug: string) => fetchApi<ApiResponse<Vault>>(`/vaults/${slug}`),
    getStatus: (slug: string) =>
      fetchApi<ApiResponse<VaultStatus>>(`/vaults/${slug}/status`),
  },

  users: {
    get: (vaultSlug: string, walletAddress: string) =>
      fetchApi<ApiResponse<UserData>>(`/users/${vaultSlug}/${walletAddress}`),

    getDeposits: (vaultSlug: string, walletAddress: string) =>
      fetchApi<ApiResponse<DepositRecord[]>>(
        `/users/${vaultSlug}/${walletAddress}/deposits`,
      ),

    getWithdrawals: (vaultSlug: string, walletAddress: string) =>
      fetchApi<ApiResponse<WithdrawalRecord[]>>(
        `/users/${vaultSlug}/${walletAddress}/withdrawals`,
      ),
  },

  admin: {
    getVaults: (adminAddress: string) =>
      fetchApi<ApiResponse<Vault[]>>('/admin/vaults', {
        headers: { 'x-admin-address': adminAddress },
      }),

    createVault: (
      adminAddress: string,
      data: {
        name: string
        slug: string
        description?: string
        contractAddress: string
        safeAddress: string
      },
    ) =>
      fetchApi<ApiResponse<Vault>>('/admin/vaults', {
        method: 'POST',
        headers: { 'x-admin-address': adminAddress },
        body: JSON.stringify(data),
      }),

    getVault: (adminAddress: string, vaultId: number) =>
      fetchApi<ApiResponse<{ vault: Vault; state: VaultState }>>(
        `/admin/vaults/${vaultId}`,
        {
          headers: { 'x-admin-address': adminAddress },
        },
      ),

    updateVault: (
      adminAddress: string,
      vaultId: number,
      data: { name?: string; description?: string; status?: string },
    ) =>
      fetchApi<ApiResponse<Vault>>(`/admin/vaults/${vaultId}`, {
        method: 'PATCH',
        headers: { 'x-admin-address': adminAddress },
        body: JSON.stringify(data),
      }),

    updateNav: (
      adminAddress: string,
      vaultId: number,
      totalAssetsUsdc: string,
    ) =>
      fetchApi<ApiResponse<{ navPerShare: string }>>(
        `/admin/vaults/${vaultId}/nav`,
        {
          method: 'POST',
          headers: { 'x-admin-address': adminAddress },
          body: JSON.stringify({ totalAssetsUsdc }),
        },
      ),

    getWithdrawals: (adminAddress: string, vaultId: number) =>
      fetchApi<ApiResponse<PendingWithdrawal[]>>(
        `/admin/vaults/${vaultId}/withdrawals`,
        {
          headers: { 'x-admin-address': adminAddress },
        },
      ),

    fulfillWithdrawal: (
      adminAddress: string,
      vaultId: number,
      withdrawalId: number,
    ) =>
      fetchApi<ApiResponse<WithdrawalRecord>>(
        `/admin/vaults/${vaultId}/withdrawals/${withdrawalId}/fulfill`,
        {
          method: 'POST',
          headers: { 'x-admin-address': adminAddress },
        },
      ),
  },

  withdrawals: {
    getClaimData: (requestId: number) =>
      fetchApi<ClaimData>(`/withdrawals/${requestId}/claim-data`),
  },
}
