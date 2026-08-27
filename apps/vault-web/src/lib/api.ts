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
  VaultEventsResponse,
  VaultTradingAnalyticsResponse,
  WithdrawalQueueResponse,
  WithdrawalPreflightResponse,
  WithdrawalRequestCreateResponse,
  WithdrawalRequestCompleteResponse,
  WithdrawalRequestCancelResponse,
  WithdrawalRequestPrepareResponse,
  SiweNonceResponse,
  SiweVerifyResponse,
  // Batch/Cycle types
  RedemptionRequestCreateResponse,
  RedemptionRequestStatusResponse,
  ClaimRedemptionResponse,
  CycleStatusResponse,
  CycleHistoryResponse,
  UserRedemptionsResponse,
  // Closed-book batch lifecycle types
  DepositQueueResponse,
  TrancheStatusResponse,
  CarryEligibilityResponse,
  UserVaultHistoryResponse,
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ApiRequestErrorDetails {
  url: string;
  method: string;
  status: number;
  statusText: string;
  body?: unknown;
}

export class ApiRequestError extends Error {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly statusText: string;
  readonly body?: unknown;

  constructor({ url, method, status, statusText, body }: ApiRequestErrorDetails) {
    super(formatApiRequestErrorMessage(status, statusText, body));
    this.name = "ApiRequestError";
    this.url = url;
    this.method = method;
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

const JSON_CONTENT_TYPE_RE = /[/+]json(?:;|$)/i;

const buildRequestHeaders = (headers?: HeadersInit, body?: BodyInit | null) => {
  const mergedHeaders = new Headers(headers);

  if (!mergedHeaders.has("Accept")) {
    mergedHeaders.set("Accept", "application/json");
  }

  if (body != null && !mergedHeaders.has("Content-Type")) {
    mergedHeaders.set("Content-Type", "application/json");
  }

  return mergedHeaders;
};

const isJsonBody = (contentType: string | null, text: string) => {
  if (contentType && JSON_CONTENT_TYPE_RE.test(contentType)) {
    return true;
  }

  const trimmed = text.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith('"') ||
    trimmed === "null" ||
    trimmed === "true" ||
    trimmed === "false" ||
    /^-?\d/.test(trimmed)
  );
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }

  const text = await response.text();

  if (text.trim().length === 0) {
    return undefined;
  }

  const contentType = response.headers.get("content-type");
  if (isJsonBody(contentType, text)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
};

const extractErrorMessage = (body: unknown): string | null => {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  for (const key of ["error", "message", "detail", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
};

const formatApiRequestErrorMessage = (status: number, statusText: string, body?: unknown) => {
  const statusLabel = status === 401 ? "Unauthorized" : statusText || "Request failed";
  const bodyMessage = extractErrorMessage(body);
  const prefix = `${status} ${statusLabel}`;

  return bodyMessage && bodyMessage !== statusLabel ? `${prefix}: ${bodyMessage}` : prefix;
};

const fetchWithAuth = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: buildRequestHeaders(options.headers, options.body),
  });

  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new ApiRequestError({
      url,
      method: options.method ?? "GET",
      status: response.status,
      statusText: response.statusText,
      body,
    });
  }

  return body as T;
};

export const isUnauthorizedApiError = (error: unknown): boolean => {
  if (error instanceof ApiRequestError) {
    return error.status === 401;
  }

  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("401") || message.includes("unauthorized") || message.includes("Unauthorized")
  );
};

// ============================================
// Vault API
// ============================================

export async function fetchVaultInstances(): Promise<VaultInstancesResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/instances`));
}

export async function fetchVaultStatus(vaultId: number): Promise<VaultStatusResponse> {
  const qs = buildQuery({ vaultId });
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/status`, qs));
}

export async function fetchVaultPositions(vaultId: number): Promise<VaultPositionsResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/positions`));
}

export async function fetchVaultPositionHistory(
  vaultId: number,
): Promise<VaultPositionHistoryResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/position-history`));
}

export async function fetchVaultNavHistory(
  limit: number | undefined,
  vaultId: number,
): Promise<VaultNavHistoryResponse> {
  const qs = buildQuery({ limit });
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/nav-history`, qs));
}

export async function fetchVaultAllocations(limit?: number): Promise<VaultAllocationsResponse> {
  const qs = buildQuery({ limit });
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/allocations`, qs));
}

export async function fetchVaultTradingAnalytics(
  vaultId: number,
): Promise<VaultTradingAnalyticsResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/trading-analytics`));
}

export async function fetchVaultEvents(
  vaultId: number,
  limit?: number,
  offset?: number,
): Promise<VaultEventsResponse> {
  const qs = buildQuery({ limit, offset });
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/events`, qs));
}

export async function fetchUserVaultHistory(
  vaultId: number,
  limit?: number,
  offset?: number,
): Promise<UserVaultHistoryResponse> {
  const qs = buildQuery({ limit, offset });
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/history`, qs));
}

export async function postWithdrawalRequest(
  shares: string,
  assetsEstimated?: string,
  vaultId?: number,
): Promise<WithdrawalRequestCreateResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/withdrawal-request`), {
    method: "POST",
    body: JSON.stringify({
      shares,
      ...(assetsEstimated ? { assetsEstimated } : {}),
      ...(vaultId !== undefined ? { vaultId } : {}),
    }),
  });
}

/**
 * Postflight for instant withdrawals on custom vaults.
 * Endpoint: POST /vault/withdrawal-request/:requestId/preflight
 * Returns a payload describing readiness for immediate redemption.
 */
export async function postWithdrawalPreflight(
  requestId: string,
): Promise<WithdrawalPreflightResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/withdrawal-request/${requestId}/preflight`), {
    method: "POST",
  });
}

export async function postInstantWithdrawPreflight(
  vaultId: number,
  shares: string,
): Promise<WithdrawalPreflightResponse> {
  return fetchWithAuth(makeUrl(`${VAULT_API_PREFIX}/${vaultId}/instant-withdraw-preflight`), {
    method: "POST",
    body: JSON.stringify({ shares }),
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
  const maxAttempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchWithAuth(
        makeUrl(`${VAULT_API_PREFIX}/withdrawal-request/${requestId}/complete`),
        {
          method: "POST",
          body: JSON.stringify({ txHash }),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const retryableConcurrentError = message.includes("Concurrent operation in progress");

      if (!retryableConcurrentError || attempt === maxAttempts) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(message);
      await sleep(800 * attempt);
    }
  }

  throw lastError ?? new Error("Withdrawal completion failed");
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
// Custom ERC7540 Closed-Book Batch/Cycle Vault API
// ============================================

/**
 * Create a redemption request (initiates cycle-based withdrawal)
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

export async function postRecordDepositActivity(
  vaultId: number,
  input: {
    txHash?: string;
    assets?: string;
    shares?: string;
    mode: "queued" | "minted";
  },
): Promise<{ success: boolean }> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/activity/deposit`), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function postRecordClaimActivity(
  vaultId: number,
  input: {
    txHash: string;
    assets?: string;
    shares?: string;
    requestId?: string;
  },
): Promise<{ success: boolean; requestId?: string | null }> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/activity/claim`), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Get current cycle status
 * GET /api/vaults/:vaultId/cycles/current
 */
export async function fetchCurrentCycleStatus(
  vaultId: number,
  fresh = false,
): Promise<CycleStatusResponse> {
  const qs = fresh ? buildQuery({ fresh: 1 }) : undefined;
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/cycles/current`, qs));
}

/**
 * Get specific cycle details
 * GET /api/vaults/:vaultId/cycles/:cycleId
 */
export async function fetchCycleStatus(
  vaultId: number,
  cycleId: number,
): Promise<CycleStatusResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/cycles/${cycleId}`));
}

export async function fetchCycleHistory(vaultId: number, limit = 6): Promise<CycleHistoryResponse> {
  const qs = buildQuery({ limit });
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/cycles`, qs));
}

/**
 * Get user's redemption state (all requests)
 * GET /api/vaults/:vaultId/redemptions
 */
export async function fetchUserRedemptions(vaultId: number): Promise<UserRedemptionsResponse> {
  return fetchWithAuth(makeUrl(`${CUSTOM_VAULT_API_PREFIX}/${vaultId}/redemptions`));
}

// ============================================================================
// Closed-Book Batch/Cycle Lifecycle API
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
 * GET /api/vaults/:vaultId/tranche-status?cycleId=
 * Returns tranche progress with realization data
 */
export async function fetchTrancheStatus(
  vaultId: number,
  cycleId?: number,
): Promise<TrancheStatusResponse> {
  const qs = buildQuery({ cycleId });
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
