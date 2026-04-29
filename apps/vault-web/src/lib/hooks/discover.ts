import { useCallback } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchCurrentCycleStatus,
  fetchCycleStatus,
  fetchVaultInstances,
  fetchVaultStatus,
} from "../api";
import type {
  Cycle,
  CycleStatusResponse,
  VaultInstance,
  VaultInstancesResponse,
  VaultStatusResponse,
} from "../../types";
import {
  DEFAULT_POLL_INTERVAL_MS,
  getErrorMessage,
  getLastRefresh,
  type AsyncState,
} from "./shared";
import { vaultQueryKeys } from "./queryKeys";

export function useVaultStatus(vaultId?: number): AsyncState<VaultStatusResponse> {
  const query = useQuery({
    queryKey: vaultQueryKeys.publicDetail.status(vaultId),
    queryFn: () => fetchVaultStatus(vaultId!),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(async (): Promise<VaultStatusResponse | null> => {
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

export interface VaultInstancesQueryOptions {
  enabled?: boolean;
  refetchIntervalMs?: number | false;
}

export function useVaultInstances(
  options?: VaultInstancesQueryOptions,
): AsyncState<VaultInstancesResponse> {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: vaultQueryKeys.discover.instances(),
    queryFn: fetchVaultInstances,
    enabled,
    refetchInterval: options?.refetchIntervalMs ?? 60_000,
  });

  const refetch = useCallback(async (): Promise<VaultInstancesResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: enabled ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export interface DiscoverVaultCardData {
  vault: VaultInstance;
  status: VaultStatusResponse | null;
  isLoading: boolean;
  executionMode: string | null;
  telemetryFresh: boolean | null;
}

export function useDiscoverVaultCards(instances: VaultInstance[]): DiscoverVaultCardData[] {
  const statusQueries = useQueries({
    queries: instances.map((vault) => ({
      queryKey: vaultQueryKeys.publicDetail.status(vault.id),
      queryFn: () => fetchVaultStatus(vault.id),
      refetchInterval: DEFAULT_POLL_INTERVAL_MS,
      placeholderData: keepPreviousData,
    })),
  });

  const cycleQueries = useQueries({
    queries: instances.map((vault) => ({
      queryKey: vaultQueryKeys.publicDetail.cycleStatus(vault.id),
      queryFn: () => fetchCurrentCycleStatus(vault.id, true),
      refetchInterval: DEFAULT_POLL_INTERVAL_MS,
      placeholderData: keepPreviousData,
    })),
  });

  return instances.map((vault, index) => {
    const statusQuery = statusQueries[index];
    const cycleQuery = cycleQueries[index];

    return {
      vault,
      status: statusQuery?.data ?? null,
      isLoading: statusQuery?.isLoading ?? false,
      executionMode: cycleQuery?.data?.cycle?.executionMode ?? null,
      telemetryFresh: cycleQuery?.data?.cycle?.telemetryFresh ?? null,
    };
  });
}

export interface UseCycleStatusResult {
  cycle: Cycle | null;
  isActive: boolean;
  timeRemainingFormatted: string;
  canSettle: boolean | undefined;
  batchState:
    | "open"
    | "processing"
    | "processed"
    | "cutoff"
    | "flattening"
    | "settling"
    | "settled"
    | "closed"
    | "reopen"
    | null;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<CycleStatusResponse | null>;
  riskState?: string | null;
  executionMode?: string | null;
  telemetryFresh?: boolean | null;
  liquidityMode?: string | null;
  reopenReady?: boolean | null;
  openPositionCount?: number | null;
}

export function useCycleStatus(vaultId?: number, cycleId?: number): UseCycleStatusResult {
  const query = useQuery({
    queryKey: vaultQueryKeys.publicDetail.cycleStatus(vaultId, cycleId),
    queryFn: () =>
      cycleId !== undefined
        ? fetchCycleStatus(vaultId!, cycleId)
        : fetchCurrentCycleStatus(vaultId!, true),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const refetch = useCallback(async (): Promise<CycleStatusResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    cycle: query.data?.cycle ?? null,
    isActive: query.data?.cycle?.isActive ?? false,
    timeRemainingFormatted: query.data?.cycle?.timeRemainingFormatted ?? "0s",
    canSettle: query.data?.canSettle,
    batchState: query.data?.cycle?.batchState ?? null,
    isLoading: vaultId !== undefined ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
    riskState: query.data?.cycle?.riskState ?? null,
    executionMode: query.data?.cycle?.executionMode ?? null,
    telemetryFresh: query.data?.cycle?.telemetryFresh ?? null,
    liquidityMode: query.data?.cycle?.liquidityMode ?? null,
    reopenReady: query.data?.cycle?.reopenReady ?? null,
    openPositionCount: query.data?.cycle?.openPositionCount ?? null,
  };
}
