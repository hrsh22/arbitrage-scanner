import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppKitAccount } from "@reown/appkit/react";
import {
  fetchCycleHistory,
  fetchUserRedemptions,
  fetchUserVaultHistory,
  fetchVaultEvents,
  fetchVaultNavHistory,
  fetchVaultTradingAnalytics,
} from "../api";
import type {
  CycleHistoryItem,
  CycleHistoryResponse,
  RedemptionRequest,
  UserRedemptionsResponse,
  UserVaultHistoryResponse,
  VaultEventsResponse,
  VaultNavHistoryResponse,
  VaultTradingAnalyticsResponse,
} from "../../types";
import {
  DEFAULT_POLL_INTERVAL_MS,
  getErrorMessage,
  getLastRefresh,
  getUserScope,
  isUnauthorizedError,
  type AsyncState,
} from "./shared";
import { vaultQueryKeys } from "./queryKeys";

export interface VaultEventsQueryOptions {
  refetchIntervalMs?: number;
  refetchIntervalInBackgroundMs?: number | false;
  offset?: number;
}

export function useVaultNavHistory(
  limit?: number,
  vaultId?: number,
): AsyncState<VaultNavHistoryResponse> {
  const query = useQuery({
    queryKey: vaultQueryKeys.publicDetail.navHistory(vaultId, limit),
    queryFn: () => fetchVaultNavHistory(limit, vaultId!),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(async (): Promise<VaultNavHistoryResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: vaultId !== undefined ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export function useVaultTradingAnalytics(
  vaultId?: number,
): AsyncState<VaultTradingAnalyticsResponse> {
  const query = useQuery({
    queryKey: vaultQueryKeys.publicDetail.tradingAnalytics(vaultId),
    queryFn: () => fetchVaultTradingAnalytics(vaultId!),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(async (): Promise<VaultTradingAnalyticsResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: vaultId !== undefined ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export function useVaultEvents(
  vaultId?: number,
  limit = 50,
  options?: VaultEventsQueryOptions,
): AsyncState<VaultEventsResponse> {
  const visibleInterval = options?.refetchIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const hiddenInterval = options?.refetchIntervalInBackgroundMs ?? 60_000;
  const offset = options?.offset ?? 0;

  const query = useQuery({
    queryKey: vaultQueryKeys.publicDetail.events(vaultId, limit, offset),
    queryFn: () => fetchVaultEvents(vaultId!, limit, offset),
    enabled: vaultId !== undefined,
    refetchInterval: () => {
      const isHidden = typeof document !== "undefined" && document.visibilityState !== "visible";
      if (!isHidden) {
        return visibleInterval;
      }

      return hiddenInterval;
    },
    refetchIntervalInBackground: hiddenInterval !== false,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(async (): Promise<VaultEventsResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: vaultId !== undefined ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export function useUserVaultHistory(
  vaultId: number | undefined,
  isAuthenticated: boolean,
  address?: string,
  limit = 100,
  offset = 0,
): AsyncState<UserVaultHistoryResponse> & { isUnauthorized: boolean } {
  const userScope = getUserScope(isAuthenticated, address);
  const query = useQuery({
    queryKey: vaultQueryKeys.userDetail.history(vaultId, userScope, limit, offset),
    queryFn: () => fetchUserVaultHistory(vaultId!, limit, offset),
    enabled: vaultId !== undefined && isAuthenticated,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      if (isUnauthorizedError(error)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const refetch = useCallback(async (): Promise<UserVaultHistoryResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: vaultId !== undefined && isAuthenticated ? query.isLoading : false,
    error: isUnauthorizedError(query.error) ? null : getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
    isUnauthorized: isUnauthorizedError(query.error),
  };
}

function normalizeRedemptionRequest(request: RedemptionRequest): RedemptionRequest {
  let normalizedStatus = request.status;
  if (String(request.status) === "ready" || String(request.status) === "settled") {
    normalizedStatus = "claimable";
  }

  const targetCycle =
    request.targetCycle ??
    request.batchId ??
    (request as RedemptionRequest & { cycleId?: number }).cycleId ??
    0;
  const targetCycleEndTime = request.targetCycleEndTime ?? request.createdAt;

  const ownerAddress =
    request.ownerAddress ?? (request as RedemptionRequest & { owner?: string }).owner ?? "";
  const controllerAddress =
    request.controllerAddress ??
    (request as RedemptionRequest & { controller?: string }).controller ??
    ownerAddress;
  const operatorAddress =
    request.operatorAddress ??
    (request as RedemptionRequest & { operator?: string | null }).operator ??
    null;

  return {
    ...request,
    id: request.id || request.requestId,
    status: normalizedStatus,
    targetCycle,
    targetCycleEndTime,
    claimableAssets: request.claimableAssets ?? null,
    claimableAssetsFormatted: request.claimableAssetsFormatted ?? null,
    claimedAt: request.claimedAt ?? null,
    cancelledAt: request.cancelledAt ?? null,
    proRataApplied: request.proRataApplied ?? false,
    proRataPercentage: request.proRataPercentage ?? null,
    ownerAddress,
    controllerAddress,
    operatorAddress,
    lifecycleError: request.lifecycleError ?? null,
  };
}

export interface UseRequestsResult {
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  totalPendingShares: string;
  totalClaimableShares: string;
  estimatedAssetsPendingFormatted: string;
  estimatedAssetsClaimableFormatted: string;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export function useRequests(vaultId?: number, isAuthenticated = false): UseRequestsResult {
  const { address } = useAppKitAccount();
  const userScope = getUserScope(isAuthenticated, address);
  const query = useQuery({
    queryKey: vaultQueryKeys.userDetail.requests(vaultId, userScope),
    queryFn: async () => {
      const result = await fetchUserRedemptions(vaultId!);
      const pendingRequests = result.pendingRequests.map(normalizeRedemptionRequest);
      const claimableRequests = result.claimableRequests.map(normalizeRedemptionRequest);

      return {
        ...result,
        pendingRequests,
        claimableRequests,
        requests: result.requests?.map(normalizeRedemptionRequest) ?? [
          ...pendingRequests,
          ...claimableRequests,
        ],
      } satisfies UserRedemptionsResponse;
    },
    enabled: vaultId !== undefined && isAuthenticated && Boolean(address),
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  return {
    pendingRequests: query.data?.pendingRequests ?? [],
    claimableRequests: query.data?.claimableRequests ?? [],
    totalPendingShares: query.data?.totalPendingShares ?? "0",
    totalClaimableShares: query.data?.totalClaimableShares ?? "0",
    estimatedAssetsPendingFormatted: query.data?.estimatedAssetsPendingFormatted ?? "0.00",
    estimatedAssetsClaimableFormatted: query.data?.estimatedAssetsClaimableFormatted ?? "0.00",
    isLoading: vaultId !== undefined && isAuthenticated ? query.isLoading : false,
    error: isUnauthorizedError(query.error) ? null : getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export interface UseCycleHistoryResult {
  currentCycleId: number | null;
  cycles: CycleHistoryItem[];
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export function useCycleHistory(vaultId?: number, limit = 6): UseCycleHistoryResult {
  const query = useQuery({
    queryKey: vaultQueryKeys.publicDetail.cycleHistory(vaultId, limit),
    queryFn: () => fetchCycleHistory(vaultId!, limit),
    enabled: vaultId !== undefined,
    refetchOnWindowFocus: false,
  });

  const refetch = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  const data: CycleHistoryResponse | null = query.data ?? null;

  return {
    currentCycleId: data?.currentCycleId ?? null,
    cycles: data?.cycles ?? [],
    isLoading: vaultId !== undefined ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}
