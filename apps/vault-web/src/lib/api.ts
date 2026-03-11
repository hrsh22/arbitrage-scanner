/**
 * Vault Web API Client
 * Fetch utilities for vault backend API
 * All requests include credentials for SIWE cookie session
 */

import { API_BASE_URL, VAULT_API_PREFIX, CUSTOM_VAULT_API_PREFIX } from "../constants";
import type {
  VaultInstancesResponse,
  VaultStatusResponse,
  VaultPositionsResponse,
  VaultPositionHistoryResponse,
  VaultNavHistoryResponse,
  VaultAllocationsResponse,
  WithdrawalQueueResponse,
  WithdrawalRequestCreateResponse,
  WithdrawalRequestCompleteResponse,
  WithdrawalRequestCancelResponse,
  WithdrawalRequestPrepareResponse,
  SiweNonceResponse,
  SiweVerifyResponse,
  // Epoch types
  RedemptionRequestCreateResponse,
  RedemptionRequestStatusResponse,
  ClaimRedemptionResponse,
  CancelRedemptionResponse,
  EpochStatusResponse,
  UserRedemptionsResponse,
  // Tranche-carry lifecycle types
  DepositQueueResponse,
  TrancheStatusResponse,
  CarryEligibilityResponse,
} from "../types.js";

const makeUrl = (path: string, qs?: string) => `${API_BASE_URL}${path}${qs ? `?${qs}` : ""}`;

const buildQuery = (params: Record<string, string | number | undefined>) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  });
  return searchParams.toString();
};

// Helper for fetch with credentials
const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
};

// ============================================
// Vault API
// ============================================

export async function fetchVaultInstances(): Promise<VaultInstancesResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/instances`));
}

export async function fetchVaultStatus(vaultId?: number): Promise<VaultStatusResponse> {
  const qs = buildQuery({ vaultId });
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/status`, qs));
}

export async function fetchVaultPositions(vaultId?: number): Promise<VaultPositionsResponse> {
  if (vaultId !== undefined) {
    return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/positions`));
  }
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/positions`));
}

export async function fetchVaultPositionHistory(
  vaultId?: number,
): Promise<VaultPositionHistoryResponse> {
  if (vaultId !== undefined) {
    return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/position-history`));
  }
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/position-history`));
}

export async function fetchVaultNavHistory(
  limit?: number,
  vaultId?: number,
): Promise<VaultNavHistoryResponse> {
  const qs = buildQuery({ limit });
  if (vaultId !== undefined) {
    return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/nav-history`, qs));
  }
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/nav-history`, qs));
}

export async function fetchVaultAllocations(limit?: number): Promise<VaultAllocationsResponse> {
  const qs = buildQuery({ limit });
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/allocations`, qs));
}

export async function postWithdrawalRequest(
  shares: string,
  assetsEstimated: string,
): Promise<WithdrawalRequestCreateResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/withdrawal-request`), {
    method: "POST",
    body: JSON.stringify({ shares, assetsEstimated }),
  });
}

export async function fetchWithdrawalQueue(
  vaultAddress?: string,
): Promise<WithdrawalQueueResponse> {
  const qs = buildQuery({ vault: vaultAddress });
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/withdrawal-queue`, qs));
}

export async function postCompleteWithdrawalRequest(
  requestId: string,
  txHash?: string,
): Promise<WithdrawalRequestCompleteResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/withdrawal-request/${requestId}/complete`), {
    method: "POST",
    body: JSON.stringify({ txHash }),
  });
}

export async function postPrepareWithdrawalRequest(
  requestId: string,
): Promise<WithdrawalRequestPrepareResponse> {
  return fetchWithAuth(
    makeUrl(`${VAULT_API_PREFIX}/withdrawal-request/${requestId}/prepare-claim`),
    {
      method: "POST",
    },
  );
}

export async function postCancelWithdrawalRequest(
  requestId: string,
): Promise<WithdrawalRequestCancelResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/withdrawal-request/${requestId}/cancel`), {
    method: "POST",
  });
}

export async function postVaultNavUpdate(): Promise<{
  success: boolean;
  message: string;
  mode: string;
  nav?: {
    totalAssets: number;
    idleAssets: number;
    deployedCostBasis: number;
    positionCount: number;
    lastUpdated: string;
  };
}> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/nav-update`), {
    method: "POST",
  });
}

export async function postVaultMode(mode: "simulation" | "live"): Promise<{
  success: boolean;
  message: string;
  previousMode: string;
  mode: string;
}> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/mode`), {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

// ============================================
// SIWE Auth
// ============================================

export async function fetchSiweNonce(): Promise<SiweNonceResponse> {
  return fetchWithAuth(makeUrl("/auth/siwe/nonce"));
}

export async function postSiweVerify(
  message: string,
  signature: string,
): Promise<SiweVerifyResponse> {
  return fetchWithAuth(makeUrl("/auth/siwe/verify"), {
    method: "POST",
    body: JSON.stringify({ message, signature }),
  });
}

// ============================================
// Auth Session Check
// ============================================

export async function fetchAuthMe(): Promise<{ authenticated: boolean; address?: string }> {
  return fetchWithAuth(makeUrl("/auth/siwe/me"));
}

// ============================================
// Health Check
// ============================================

export async function fetchHealth(): Promise<{
  status: string;
  service: string;
  uptime: number;
}> {
  return fetchWithAuth(makeUrl("/health"));
}

// ============================================
// Custom ERC7540 Epoch Vault API
// ============================================

/**
 * Create a redemption request (initiates epoch-based withdrawal)
 * POST /api/vaults/:vaultId/redeem
 */
export async function postRedemptionRequest(
  vaultId: number,
  shares: string,
  assetsEstimated?: string,
  operator?: string,
): Promise<RedemptionRequestCreateResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/redeem`), {
    method: "POST",
    body: JSON.stringify({ shares, assetsEstimated, operator }),
  });
}

/**
 * Get redemption request status
 * GET /api/vaults/:vaultId/requests/:requestId
 */
export async function fetchRedemptionRequestStatus(
  vaultId: number,
  requestId: string,
): Promise<RedemptionRequestStatusResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/requests/${requestId}`));
}

/**
 * Claim a settled redemption request
 * POST /api/vaults/:vaultId/requests/:requestId/claim
 */
export async function postClaimRedemption(
  vaultId: number,
  requestId: string,
): Promise<ClaimRedemptionResponse> {
  return fetchWithAuth(
    makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/requests/${requestId}/claim`),
    {
      method: "POST",
    },
  );
}

/**
 * Cancel a pending redemption request
 * POST /api/vaults/:vaultId/requests/:requestId/cancel
 */
export async function postCancelRedemptionRequest(
  vaultId: number,
  requestId: string,
): Promise<CancelRedemptionResponse> {
  return fetchWithAuth(
    makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/requests/${requestId}/cancel`),
    {
      method: "POST",
    },
  );
}

/**
 * Get current epoch status
 * GET /api/vaults/:vaultId/epochs/current
 */
export async function fetchCurrentEpochStatus(vaultId: number): Promise<EpochStatusResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/epochs/current`));
}

/**
 * Get specific epoch details
 * GET /api/vaults/:vaultId/epochs/:epochId
 */
export async function fetchEpochStatus(
  vaultId: number,
  epochId: number,
): Promise<EpochStatusResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/epochs/${epochId}`));
}

/**
 * Get user's redemption state (all requests)
 * GET /api/vaults/:vaultId/redemptions
 */
export async function fetchUserRedemptions(vaultId: number): Promise<UserRedemptionsResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/redemptions`));
}

// ============================================================================
// Tranche-Carry Lifecycle API
// ============================================================================

/**
 * Get deposit queue status for user
 * GET /api/vaults/:vaultId/deposit-queue
 * Returns queued and frozen assets/shares
 */
export async function fetchDepositQueue(vaultId: number): Promise<DepositQueueResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/deposit-queue`));
}

/**
 * Get tranche status including accrued carry
 * GET /api/vaults/:vaultId/tranche-status?epochId=
 * Returns tranche progress with realization data
 */
export async function fetchTrancheStatus(
  vaultId: number,
  epochId?: number,
): Promise<TrancheStatusResponse> {
  const qs = buildQuery({ epochId });
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/tranche-status`, qs));
}

/**
 * Get carry claim eligibility
 * GET /api/vaults/:vaultId/carry-eligibility?requestId=
 * Returns detailed eligibility with lifecycle fields
 */
export async function fetchCarryEligibility(
  vaultId: number,
  requestId?: string,
): Promise<CarryEligibilityResponse> {
  const qs = requestId ? buildQuery({ requestId }) : "";
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/carry-eligibility`, qs));
}
