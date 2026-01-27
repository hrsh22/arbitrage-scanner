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

const ADMIN_SESSION_KEY = 'vault_admin_session'

interface AdminSession {
  token: string
  address: string
}

export function getAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem(ADMIN_SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AdminSession
  } catch {
    return null
  }
}

export function setAdminSession(session: AdminSession | null): void {
  if (typeof window === 'undefined') return
  if (!session) {
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    return
  }
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session))
}

async function fetchAdminApi<T>(
  path: string,
  options?: RequestInit,
  adminAddress?: string,
): Promise<T> {
  const session = getAdminSession()
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(adminAddress ? { 'x-admin-address': adminAddress } : {}),
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...options?.headers,
    },
  })

  if (!response.ok) {
    // If we get a 401, clear the session so user can re-authenticate
    if (response.status === 401) {
      setAdminSession(null)
      // Force page reload to show login screen
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    }
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
  lastMerkleRoot: string | null
  currentClaimableUsdc: string | null
}

interface ClaimDataBase {
  claimMode: 'v1' | 'v2'
  onChainRequestId: number
  cumulativeClaimable: string
  pendingClaimUsdc: string
  alreadyClaimedUsdc: string
}

export interface ClaimDataV1 extends ClaimDataBase {
  claimMode: 'v1'
  merkleProof: string[]
  merkleRoot: string
}

export interface ClaimDataV2 extends ClaimDataBase {
  claimMode: 'v2'
  deadline: string
  signature: string
}

export type ClaimData = ClaimDataV1 | ClaimDataV2

export interface AdminNonceResponse {
  nonce: string
  message: string
  expiresAt: number
}

export interface AdminVerifyResponse {
  token: string
  expiresAt: number
}

export interface SetupStatus {
  treasuryAddress: string
  isTestnet: boolean
  vaultApproved: boolean
  polymarketApproved: boolean
  polymarketDetails?: {
    usdcForCtf: boolean
    usdcForCtfExchange: boolean
    usdcForNegRiskExchange: boolean
    usdcForNegRiskAdapter: boolean
    ctfForCtfExchange: boolean
    ctfForNegRiskExchange: boolean
    ctfForNegRiskAdapter: boolean
  }
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
      fetchAdminApi<ApiResponse<Vault[]>>('/admin/vaults', {
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
      fetchAdminApi<ApiResponse<Vault>>(
        '/admin/vaults',
        {
          method: 'POST',
          headers: { 'x-admin-address': adminAddress },
          body: JSON.stringify(data),
        },
        adminAddress,
      ),

    getVault: (adminAddress: string, vaultId: number) =>
      fetchAdminApi<ApiResponse<{ vault: Vault; state: VaultState }>>(
        `/admin/vaults/${vaultId}`,
        {
          headers: { 'x-admin-address': adminAddress },
        },
        adminAddress,
      ),

    updateVault: (
      adminAddress: string,
      vaultId: number,
      data: { name?: string; description?: string; status?: string },
    ) =>
      fetchAdminApi<ApiResponse<Vault>>(
        `/admin/vaults/${vaultId}`,
        {
          method: 'PATCH',
          headers: { 'x-admin-address': adminAddress },
          body: JSON.stringify(data),
        },
        adminAddress,
      ),

    updateNav: (
      adminAddress: string,
      vaultId: number,
      totalAssetsUsdc: string,
    ) =>
      fetchAdminApi<ApiResponse<{ navPerShare: string; txHash: string }>>(
        `/admin/vaults/${vaultId}/nav`,
        {
          method: 'POST',
          headers: { 'x-admin-address': adminAddress },
          body: JSON.stringify({ totalAssetsUsdc }),
        },
        adminAddress,
      ),

    getWithdrawals: (adminAddress: string, vaultId: number) =>
      fetchAdminApi<ApiResponse<PendingWithdrawal[]>>(
        `/admin/vaults/${vaultId}/withdrawals`,
        {
          headers: { 'x-admin-address': adminAddress },
        },
        adminAddress,
      ),

    getSetupStatus: (adminAddress: string, vaultId: number) =>
      fetchAdminApi<ApiResponse<SetupStatus>>(
        `/admin/vaults/${vaultId}/setup-status`,
        {
          headers: { 'x-admin-address': adminAddress },
        },
        adminAddress,
      ),

    approveVault: (adminAddress: string, vaultId: number) =>
      fetchAdminApi<ApiResponse<{ txHash: string }>>(
        `/admin/vaults/${vaultId}/approve-vault`,
        {
          method: 'POST',
          headers: { 'x-admin-address': adminAddress },
        },
        adminAddress,
      ),

    approvePolymarket: (adminAddress: string, vaultId: number) =>
      fetchAdminApi<ApiResponse<{ txHash: string }>>(
        `/admin/vaults/${vaultId}/approve-polymarket`,
        {
          method: 'POST',
          headers: { 'x-admin-address': adminAddress },
        },
        adminAddress,
      ),
  },

  adminAuth: {
    requestNonce: (address: string) =>
      fetchApi<ApiResponse<AdminNonceResponse>>('/admin/auth/nonce', {
        method: 'POST',
        body: JSON.stringify({ address }),
      }),
    verifySignature: (address: string, signature: string) =>
      fetchApi<ApiResponse<AdminVerifyResponse>>('/admin/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ address, signature }),
      }),
  },

  withdrawals: {
    getClaimData: (requestId: number) =>
      fetchApi<ClaimData>(`/withdrawals/${requestId}/claim-data`),

    ingestTx: (data: { vaultId: number; txHash: string }) =>
      fetchApi<{
        success: boolean
        results: Array<{
          recorded: boolean
          reason?: string
          onChainRequestId?: number
        }>
        blockNumber: number
      }>('/withdrawals/ingest-tx', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    ingestClaim: (requestId: number, txHash: string) =>
      fetchApi<{
        success: boolean
        results: Array<{
          recorded: boolean
          reason?: string
          onChainRequestId?: number
          claimedUsdc?: number
        }>
        blockNumber: number
      }>(`/withdrawals/${requestId}/ingest-claim`, {
        method: 'POST',
        body: JSON.stringify({ txHash }),
      }),
  },

  deposits: {
    ingest: (data: { vaultSlug: string; txHash: string }) =>
      fetchApi<{
        success: boolean
        alreadyProcessed?: boolean
        depositId?: number
        results?: Array<{
          recorded: boolean
          reason?: string
          userAddress?: string
          amountUsdc?: string
          sharesReceived?: string
        }>
        blockNumber?: number
      }>('/deposits/ingest', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
}
