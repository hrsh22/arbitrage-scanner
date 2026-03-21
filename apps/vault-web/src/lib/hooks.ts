"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { encodeFunctionData, formatUnits, getAddress, toHex } from "viem";
import type { Address } from "viem";
import { useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import {
  USDC_E_ADDRESS,
  ERC20_ABI,
  VAULT_ABI,
  USDC_DECIMALS,
  ERC20_BALANCE_ABI,
} from "../constants";
import {
  fetchVaultInstances,
  fetchVaultStatus,
  fetchVaultPositions,
  fetchVaultPositionHistory,
  fetchVaultNavHistory,
  fetchVaultAllocations,
  fetchVaultEvents,
  fetchVaultTradingAnalytics,
  fetchWithdrawalQueue,
  postWithdrawalPreflight,
  // Batch/Cycle API functions
  postRedemptionRequest,
  postClaimRedemption,
  fetchCurrentCycleStatus,
  fetchCycleHistory,
  fetchCycleStatus,
  fetchUserRedemptions,
  // Closed-book batch lifecycle API
  fetchDepositQueue,
  fetchTrancheStatus,
  fetchCarryEligibility,
  fetchUserVaultHistory,
} from "./api";
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
  // Batch/Cycle types
  RedemptionRequestCreateResponse,
  ClaimRedemptionResponse,
  CycleStatusResponse,
  CycleHistoryItem,
  CycleHistoryResponse,
  UserRedemptionsResponse,
  Cycle,
  RedemptionRequest,
  UserVaultHistoryResponse,
} from "../types.js";

interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<T | null>;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

function getErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : "Unknown error";
}

function isUnauthorizedError(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (!message) {
    return false;
  }

  return (
    message.includes("401") || message.includes("unauthorized") || message.includes("Unauthorized")
  );
}

function getLastRefresh(dataUpdatedAt: number, hasData: boolean): Date | null {
  if (!hasData || dataUpdatedAt <= 0) {
    return null;
  }

  return new Date(dataUpdatedAt);
}

function getVaultScope(vaultId?: number): number | "default" {
  return vaultId ?? "default";
}

function getUserScope(isAuthenticated: boolean, address?: string): string {
  if (!isAuthenticated || !address) {
    return "anonymous";
  }

  return address.toLowerCase();
}

export const vaultQueryKeys = {
  scope: (vaultId?: number) => ["vault", getVaultScope(vaultId)] as const,
  status: (vaultId?: number) => [...vaultQueryKeys.scope(vaultId), "status"] as const,
  tradingAnalytics: (vaultId?: number) =>
    [...vaultQueryKeys.scope(vaultId), "trading-analytics"] as const,
  events: (vaultId?: number) => [...vaultQueryKeys.scope(vaultId), "events"] as const,
  history: (vaultId: number | undefined, userScope: string) =>
    [...vaultQueryKeys.scope(vaultId), "history", userScope] as const,
  cycleStatus: (vaultId?: number, cycleId?: number) =>
    [...vaultQueryKeys.scope(vaultId), "cycle", cycleId ?? "current"] as const,
  requests: (vaultId: number | undefined, userScope: string) =>
    [...vaultQueryKeys.scope(vaultId), "requests", userScope] as const,
  depositQueue: (vaultId: number | undefined, userScope: string) =>
    [...vaultQueryKeys.scope(vaultId), "deposit-queue", userScope] as const,
  trancheStatus: (vaultId?: number, cycleId?: number, userScope = "global") =>
    [...vaultQueryKeys.scope(vaultId), "tranche-status", cycleId ?? "current", userScope] as const,
  carryEligibility: (vaultId?: number, requestId?: string, userScope = "global") =>
    [...vaultQueryKeys.scope(vaultId), "carry-eligibility", requestId ?? "all", userScope] as const,
};

export interface VaultEventsQueryOptions {
  refetchIntervalMs?: number;
  refetchIntervalInBackgroundMs?: number | false;
  offset?: number;
}

export async function invalidateVaultQueries(
  queryClient: QueryClient,
  vaultId?: number,
): Promise<void> {
  if (vaultId === undefined) {
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: vaultQueryKeys.scope(vaultId),
  });
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

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

interface Eip155TransactionRequest {
  from: Address;
  to: Address;
  data: `0x${string}`;
  gas?: `0x${string}`;
}

interface Eip155WriteState {
  write: (tx: { to: Address; data: `0x${string}` }) => void;
  isPending: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

function useEip155WriteState(): Eip155WriteState {
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");

  const [isPending, setIsPending] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  const write = useCallback(
    (tx: { to: Address; data: `0x${string}` }) => {
      setIsPending(true);
      setError(null);
      setHash(undefined);

      if (!isConnected || !address) {
        setError(new Error("Wallet not connected. Please reconnect and try again."));
        setIsPending(false);
        return;
      }

      if (!walletProvider) {
        setError(new Error("Wallet provider unavailable. Please reconnect and try again."));
        setIsPending(false);
        return;
      }

      let fromAddress: Address;
      try {
        fromAddress = getAddress(address);
      } catch {
        setError(new Error("Invalid wallet address. Please reconnect and try again."));
        setIsPending(false);
        return;
      }

      void (async () => {
        try {
          const txRequest: Eip155TransactionRequest = {
            from: fromAddress,
            to: tx.to,
            data: tx.data,
          };

          try {
            const estimatedGas = await walletProvider.request({
              method: "eth_estimateGas",
              params: [txRequest],
            });

            if (typeof estimatedGas === "string" && estimatedGas.startsWith("0x")) {
              txRequest.gas = toHex((BigInt(estimatedGas) * 12n) / 10n);
            }
          } catch (estimateError) {
            const estimateMessage = getErrorMessage(estimateError)?.toLowerCase() ?? "";
            const walletCanEstimateLater =
              estimateMessage.includes("method not found") ||
              estimateMessage.includes("unsupported") ||
              estimateMessage.includes("not available") ||
              estimateMessage.includes("does not exist");

            if (!walletCanEstimateLater) {
              throw estimateError instanceof Error
                ? estimateError
                : new Error("Transaction gas estimation failed.");
            }
          }

          const result = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [txRequest],
          });

          if (typeof result !== "string" || !result.startsWith("0x")) {
            throw new Error("Wallet did not return a transaction hash.");
          }

          setHash(result as `0x${string}`);
        } catch (err) {
          setError(err instanceof Error ? err : new Error("Transaction failed"));
        } finally {
          setIsPending(false);
        }
      })();
    },
    [address, isConnected, walletProvider],
  );

  const reset = useCallback(() => {
    setIsPending(false);
    setHash(undefined);
    setError(null);
  }, []);

  return {
    write,
    isPending,
    hash,
    error,
    reset,
  };
}

function usePolledFetch<T>(fetcher: () => Promise<T>, intervalMs = 30_000): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refetch = useCallback(async (): Promise<T | null> => {
    try {
      setError(null);
      const result = await fetcher();
      setData(result);
      setLastRefresh(new Date());
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, intervalMs);
    return () => clearInterval(interval);
  }, [refetch, intervalMs]);

  return { data, isLoading, error, lastRefresh, refetch };
}

export function useVaultStatus(vaultId?: number): AsyncState<VaultStatusResponse> {
  const query = useQuery({
    queryKey: vaultQueryKeys.status(vaultId),
    queryFn: () => fetchVaultStatus(vaultId),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
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

export function useVaultInstances(): AsyncState<VaultInstancesResponse> {
  return usePolledFetch(fetchVaultInstances, 60_000);
}

export function useVaultPositions(vaultId?: number): AsyncState<VaultPositionsResponse> {
  const fetcher = useCallback(() => fetchVaultPositions(vaultId), [vaultId]);
  return usePolledFetch(fetcher);
}

export function useVaultPositionHistory(
  vaultId?: number,
): AsyncState<VaultPositionHistoryResponse> {
  const fetcher = useCallback(() => fetchVaultPositionHistory(vaultId), [vaultId]);
  return usePolledFetch(fetcher);
}

export function useVaultNavHistory(
  limit?: number,
  vaultId?: number,
): AsyncState<VaultNavHistoryResponse> {
  const fetcher = useCallback(() => fetchVaultNavHistory(limit, vaultId), [limit, vaultId]);
  return usePolledFetch(fetcher);
}

export function useVaultAllocations(limit?: number): AsyncState<VaultAllocationsResponse> {
  const fetcher = useCallback(() => fetchVaultAllocations(limit), [limit]);
  return usePolledFetch(fetcher);
}

export function useVaultTradingAnalytics(
  vaultId?: number,
): AsyncState<VaultTradingAnalyticsResponse> {
  const query = useQuery({
    queryKey: vaultQueryKeys.tradingAnalytics(vaultId),
    queryFn: () => fetchVaultTradingAnalytics(vaultId!),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
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
    queryKey: [...vaultQueryKeys.events(vaultId), limit, offset],
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
): AsyncState<UserVaultHistoryResponse> {
  const userScope = getUserScope(isAuthenticated, address);
  const query = useQuery({
    queryKey: [...vaultQueryKeys.history(vaultId, userScope), limit, offset],
    queryFn: () => fetchUserVaultHistory(vaultId!, limit, offset),
    enabled: vaultId !== undefined && isAuthenticated,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
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
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export function useWithdrawalQueue(vaultAddress?: string): AsyncState<WithdrawalQueueResponse> {
  const fetcher = useCallback(() => fetchWithdrawalQueue(vaultAddress), [vaultAddress]);
  return usePolledFetch(fetcher, 15_000);
}

interface WalletBalanceResult {
  balance: bigint | undefined;
  formatted: string;
  isLoading: boolean;
  isConnected: boolean;
  address: string | undefined;
}

export function useWalletBalance(): WalletBalanceResult {
  const { address, isConnected } = useAppKitAccount();

  const { data: balance, isLoading } = useReadContract({
    address: USDC_E_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 15_000,
    },
  });

  const formatted = balance !== undefined ? (Number(balance) / 1e6).toFixed(2) : "0.00";

  return {
    balance,
    formatted,
    isLoading: isLoading && isConnected,
    isConnected,
    address,
  };
}

interface UsdcAllowanceResult {
  allowance: bigint;
  refetch: () => Promise<unknown>;
}

interface TokenAllowanceResult {
  allowance: bigint;
  refetch: () => Promise<unknown>;
}

export function useUsdcAllowance(owner?: string, spender?: string): UsdcAllowanceResult {
  const { data: allowance, refetch } = useReadContract({
    address: USDC_E_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner && spender ? [owner as `0x${string}`, spender as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(owner && spender),
      refetchInterval: 10_000,
    },
  });

  return {
    allowance: allowance ?? 0n,
    refetch,
  };
}

export function useTokenAllowance(
  tokenAddress?: string,
  owner?: string,
  spender?: string,
): TokenAllowanceResult {
  const { data: allowance, refetch } = useReadContract({
    address: tokenAddress as `0x${string}` | undefined,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner && spender ? [owner as `0x${string}`, spender as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(tokenAddress && owner && spender),
      refetchInterval: 10_000,
    },
  });

  return {
    allowance: allowance ?? 0n,
    refetch,
  };
}

interface VaultSharesResult {
  shares: bigint;
  formatted: string;
  refetch: () => Promise<unknown>;
}

export function useVaultShares(
  vaultAddress?: string,
  userAddress?: string,
  shareDecimals = 6,
): VaultSharesResult {
  const { data: shares, refetch } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(vaultAddress && userAddress),
      refetchInterval: 15_000,
    },
  });

  const safeShares = shares ?? 0n;

  return {
    shares: safeShares,
    formatted: formatUnits(safeShares, shareDecimals),
    refetch,
  };
}

interface VaultOnChainStatsResult {
  totalAssets: bigint;
  totalSupply: bigint;
  formattedTotalAssets: string;
}

export function useVaultOnChainStats(vaultAddress?: string): VaultOnChainStatsResult {
  const { data: totalAssets } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "totalAssets",
    query: {
      enabled: Boolean(vaultAddress),
      refetchInterval: 15_000,
    },
  });

  const { data: totalSupply } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "totalSupply",
    query: {
      enabled: Boolean(vaultAddress),
      refetchInterval: 15_000,
    },
  });

  const safeTotalAssets = totalAssets ?? 0n;
  const safeTotalSupply = totalSupply ?? 0n;

  return {
    totalAssets: safeTotalAssets,
    totalSupply: safeTotalSupply,
    formattedTotalAssets: formatUnits(safeTotalAssets, USDC_DECIMALS),
  };
}

interface PreviewDepositResult {
  shares: bigint | undefined;
}

export function usePreviewDeposit(
  vaultAddress?: string,
  assets?: bigint,
  enabled = true,
): PreviewDepositResult {
  const { data: shares } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "previewDeposit",
    args: assets !== undefined ? [assets] : undefined,
    query: {
      enabled: Boolean(enabled && vaultAddress && assets !== undefined && assets > 0n),
    },
  });

  return { shares };
}

interface PreviewRedeemResult {
  assets: bigint | undefined;
  refetch: () => Promise<bigint | undefined>;
}

export function usePreviewRedeem(
  vaultAddress?: string,
  shares?: bigint,
  useCurrentNav = false,
): PreviewRedeemResult {
  const { data: currentNAV, refetch: refetchNav } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "currentNAV",
    query: {
      enabled: Boolean(useCurrentNav && vaultAddress && shares !== undefined && shares > 0n),
      refetchInterval: 15_000,
    },
  });

  const { data: totalAssets, refetch: refetchAssets } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "totalAssets",
    query: {
      enabled: Boolean(!useCurrentNav && vaultAddress && shares !== undefined && shares > 0n),
      refetchInterval: 15_000,
    },
  });

  const { data: totalSupply, refetch: refetchSupply } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "totalSupply",
    query: {
      enabled: Boolean(!useCurrentNav && vaultAddress && shares !== undefined && shares > 0n),
      refetchInterval: 15_000,
    },
  });

  const assets = React.useMemo(() => {
    if (useCurrentNav && currentNAV && shares) {
      return (shares * currentNAV) / 10n ** 18n;
    }
    if (!totalAssets || !totalSupply || !shares || totalSupply === 0n) return undefined;
    return (shares * totalAssets) / totalSupply;
  }, [currentNAV, shares, totalAssets, totalSupply, useCurrentNav]);

  const refetch = useCallback(async () => {
    if (useCurrentNav) {
      const result = await refetchNav();
      const nextNav = result.data;
      if (!nextNav || !shares) {
        return undefined;
      }
      return (shares * nextNav) / 10n ** 18n;
    }
    const [assetsResult, supplyResult] = await Promise.all([refetchAssets(), refetchSupply()]);
    const nextAssets = assetsResult.data;
    const nextSupply = supplyResult.data;
    if (!nextAssets || !nextSupply || !shares || nextSupply === 0n) {
      return undefined;
    }
    return (shares * nextAssets) / nextSupply;
  }, [refetchAssets, refetchNav, refetchSupply, shares, useCurrentNav]);

  return { assets, refetch };
}

// Helper: determine if instant deposit is allowed for a custom vault
// Instant deposits are allowed only when executionMode is "instant" and
// telemetryFresh is true. This mirrors frontend routing semantics used in deposits.
export function isInstantCustomVaultDepositAvailable(
  executionMode?: string,
  telemetryFresh?: boolean,
): boolean {
  return executionMode === "instant" && telemetryFresh === true;
}

// Wrapper to expose preflight functionality for custom vault withdrawals
export async function preflightWithdrawal(requestId: string): Promise<WithdrawalPreflightResponse> {
  return postWithdrawalPreflight(requestId);
}

interface UsdcApproveResult {
  approve: (spender: `0x${string}`, amount: bigint) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

interface TokenApproveResult {
  approve: (spender: `0x${string}`, amount: bigint) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

export function useUsdcApprove(): UsdcApproveResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const approve = (spender: `0x${string}`, amount: bigint) => {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });

    write({
      to: USDC_E_ADDRESS as Address,
      data,
    });
  };

  return {
    approve,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
    reset,
  };
}

export function useTokenApprove(tokenAddress?: string): TokenApproveResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const approve = (spender: `0x${string}`, amount: bigint) => {
    if (!tokenAddress) {
      throw new Error("Token address is required for approval");
    }

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });

    write({
      to: tokenAddress as Address,
      data,
    });
  };

  return {
    approve,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
    reset,
  };
}

interface VaultDepositResult {
  deposit: (vaultAddress: `0x${string}`, assets: bigint, onBehalf: `0x${string}`) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

interface QueueDepositResult {
  queueDeposit: (vaultAddress: `0x${string}`, assets: bigint) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

interface CustomVaultRequestRedeemResult {
  requestRedeemTx: (
    vaultAddress: `0x${string}`,
    shares: bigint,
    controller: `0x${string}`,
    owner: `0x${string}`,
  ) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

interface CustomVaultClaimRedeemResult {
  claimRedeemTx: (
    vaultAddress: `0x${string}`,
    requestId: bigint,
    shares: bigint,
    receiver: `0x${string}`,
  ) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

const CUSTOM_VAULT_REDEEM_ABI = [
  {
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    name: "redeem",
    outputs: [{ name: "assets", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export function useVaultDeposit(): VaultDepositResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const deposit = (vaultAddress: `0x${string}`, assets: bigint, onBehalf: `0x${string}`) => {
    const data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "deposit",
      args: [assets, onBehalf],
    });

    write({
      to: vaultAddress,
      data,
    });
  };

  return {
    deposit,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
    reset,
  };
}

export function useQueueDeposit(): QueueDepositResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const queueDeposit = (vaultAddress: `0x${string}`, assets: bigint) => {
    const data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "requestDeposit",
      args: [assets],
    });

    write({
      to: vaultAddress,
      data,
    });
  };

  return {
    queueDeposit,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
    reset,
  };
}

export function useCustomVaultRequestRedeem(): CustomVaultRequestRedeemResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const requestRedeemTx = (
    vaultAddress: `0x${string}`,
    shares: bigint,
    controller: `0x${string}`,
    owner: `0x${string}`,
  ) => {
    const data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "requestRedeem",
      args: [shares, controller, owner],
    });

    write({ to: vaultAddress, data });
  };

  return { requestRedeemTx, isPending, isConfirming, isConfirmed, hash, error, reset };
}

export function useCustomVaultClaimRedeem(): CustomVaultClaimRedeemResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const claimRedeemTx = (
    vaultAddress: `0x${string}`,
    requestId: bigint,
    shares: bigint,
    receiver: `0x${string}`,
  ) => {
    const data = encodeFunctionData({
      abi: CUSTOM_VAULT_REDEEM_ABI,
      functionName: "redeem",
      args: [requestId, shares, receiver],
    });

    write({ to: vaultAddress, data });
  };

  return { claimRedeemTx, isPending, isConfirming, isConfirmed, hash, error, reset };
}

interface VaultRedeemResult {
  redeem: (
    vaultAddress: `0x${string}`,
    shares: bigint,
    receiver: `0x${string}`,
    onBehalf: `0x${string}`,
  ) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash: `0x${string}` | undefined;
  error: Error | null;
  reset: () => void;
}

export function useVaultRedeem(): VaultRedeemResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const redeem = (
    vaultAddress: `0x${string}`,
    shares: bigint,
    receiver: `0x${string}`,
    onBehalf: `0x${string}`,
  ) => {
    const data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "redeem",
      args: [shares, receiver, onBehalf],
    });

    write({
      to: vaultAddress,
      data,
    });
  };

  return {
    redeem,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
    reset,
  };
}

// ============================================================================
// Custom ERC7540 Closed-Book Batch/Cycle Vault Hooks
// ============================================================================
// Custom ERC7540 Epoch Vault Hooks
// ============================================================================

export interface UseRequestRedeemResult {
  requestRedeem: (
    vaultId: number,
    shares: string,
    assetsEstimated?: string,
    operator?: string,
  ) => Promise<void>;
  data: RedemptionRequestCreateResponse | null;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
}

export function useRequestRedeem(): UseRequestRedeemResult {
  const queryClient = useQueryClient();
  const [data, setData] = useState<RedemptionRequestCreateResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestRedeem = useCallback(
    async (vaultId: number, shares: string, assetsEstimated?: string, operator?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await postRedemptionRequest(vaultId, shares, assetsEstimated, operator);
        setData(result);
        await invalidateVaultQueries(queryClient, vaultId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create redemption request";
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [queryClient],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    requestRedeem,
    data,
    isLoading,
    error,
    reset,
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
    queryKey: vaultQueryKeys.requests(vaultId, userScope),
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

export interface UseCycleHistoryResult {
  currentCycleId: number | null;
  cycles: CycleHistoryItem[];
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export function useCycleStatus(vaultId?: number, cycleId?: number): UseCycleStatusResult {
  const query = useQuery({
    queryKey: vaultQueryKeys.cycleStatus(vaultId, cycleId),
    queryFn: () =>
      cycleId !== undefined
        ? fetchCycleStatus(vaultId!, cycleId)
        : fetchCurrentCycleStatus(vaultId!),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
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

export function useCycleHistory(vaultId?: number, limit = 6): UseCycleHistoryResult {
  const [data, setData] = useState<CycleHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refetch = useCallback(async () => {
    if (vaultId === undefined) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchCycleHistory(vaultId, limit);
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch cycle history");
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    currentCycleId: data?.currentCycleId ?? null,
    cycles: data?.cycles ?? [],
    isLoading,
    error,
    lastRefresh,
    refetch,
  };
}

export interface UseClaimRedemptionResult {
  claimRedemption: (vaultId: number, requestId: string) => Promise<void>;
  data: ClaimRedemptionResponse | null;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
}

export function useClaimRedemption(): UseClaimRedemptionResult {
  const queryClient = useQueryClient();
  const [data, setData] = useState<ClaimRedemptionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claimRedemption = useCallback(
    async (vaultId: number, requestId: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await postClaimRedemption(vaultId, requestId);
        setData(result);
        await invalidateVaultQueries(queryClient, vaultId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to claim redemption";
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [queryClient],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    claimRedemption,
    data,
    isLoading,
    error,
    reset,
  };
}

// ============================================================================
// ============================================================================
// Closed-Book Batch/Cycle Lifecycle Hooks
// ============================================================================
// ============================================================================

export interface UseDepositQueueResult {
  queued: string;
  queuedFormatted: string;
  queuedShares: string;
  queuedSharesFormatted: string;
  // No current NAV estimate in closed-book; shares minted at cycle-open NAV
  cycleOpenNavEstimate: string | null;
  cycleOpenNavFormatted: string | null;
  estimateBasis: string | null;
  frozen: string;
  frozenFormatted: string;
  frozenShares: string;
  frozenSharesFormatted: string;
  depositRequestId: string | null;
  depositCreatedAt: string | null;
  targetCycleId: number | null;
  currentCycleId: number | null;
  currentCycleStart: string | null;
  currentCycleEnd: string | null;
  nextCycleStart: string | null;
  activationTime: string | null;
  queueStatus: "idle" | "queued" | "processed" | null;
  mintRule: string | null;
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
  refetch: () => Promise<void>;
  // Lifecycle fields surfaced from backend API
  riskState?: string | null;
  executionMode?: string | null;
  telemetryFresh?: boolean | null;
  liquidityMode?: string | null;
  reopenReady?: boolean | null;
  openPositionCount?: number | null;
}
export function useDepositQueue(vaultId?: number, isAuthenticated = false): UseDepositQueueResult {
  const { address } = useAppKitAccount();
  const userScope = getUserScope(isAuthenticated, address);
  const query = useQuery({
    queryKey: vaultQueryKeys.depositQueue(vaultId, userScope),
    queryFn: () => fetchDepositQueue(vaultId!),
    enabled: vaultId !== undefined && isAuthenticated && Boolean(address),
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    queued: query.data?.queued ?? "0",
    queuedFormatted: query.data?.queuedFormatted ?? "0",
    queuedShares: query.data?.queuedShares ?? "0",
    queuedSharesFormatted: query.data?.queuedSharesFormatted ?? "0",
    cycleOpenNavEstimate: query.data?.cycleOpenNavEstimate ?? null,
    cycleOpenNavFormatted: query.data?.cycleOpenNavFormatted ?? null,
    estimateBasis: query.data?.estimateBasis ?? null,
    frozen: query.data?.frozen ?? "0",
    frozenFormatted: query.data?.frozenFormatted ?? "0",
    frozenShares: query.data?.frozenShares ?? "0",
    frozenSharesFormatted: query.data?.frozenSharesFormatted ?? "0",
    depositRequestId: query.data?.depositRequestId ?? null,
    depositCreatedAt: query.data?.depositCreatedAt ?? null,
    targetCycleId: query.data?.targetCycleId ?? null,
    currentCycleId: query.data?.currentCycleId ?? null,
    currentCycleStart: query.data?.currentCycleStart ?? null,
    currentCycleEnd: query.data?.currentCycleEnd ?? null,
    nextCycleStart: query.data?.nextCycleStart ?? null,
    activationTime: query.data?.activationTime ?? null,
    queueStatus: query.data?.queueStatus ?? null,
    mintRule: query.data?.mintRule ?? null,
    batchState: query.data?.batchState ?? null,
    isLoading: vaultId !== undefined && isAuthenticated ? query.isLoading : false,
    error: isUnauthorizedError(query.error) ? null : getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
    riskState: query.data?.riskState ?? null,
    executionMode: query.data?.executionMode ?? null,
    telemetryFresh: query.data?.telemetryFresh ?? null,
    liquidityMode: query.data?.liquidityMode ?? null,
    reopenReady: query.data?.reopenReady ?? null,
    openPositionCount: query.data?.openPositionCount ?? null,
  };
}

export interface UseTrancheStatusResult {
  cycleId: number | null;
  cycleStatus: {
    status: "settled" | "pending" | null;
    startTime: string | null;
    endTime: string | null;
    settled: boolean;
    totalShares: string;
    totalSharesFormatted: string;
    // Batch lifecycle
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
  };
  tranchePosition: {
    accrued: string;
    accruedFormatted: string;
    claimed: string;
    claimedFormatted: string;
    claimableNow: string;
    claimableNowFormatted: string;
    minClaimThreshold: string;
    minClaimThresholdFormatted: string;
    dustOverrideEligible: boolean;
    meetsThreshold: boolean;
  };
  entitlementCount: number;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export function useTrancheStatus(vaultId?: number, cycleId?: number): UseTrancheStatusResult {
  const { address, isConnected } = useAppKitAccount();
  const userScope = getUserScope(isConnected, address);
  const query = useQuery({
    queryKey: vaultQueryKeys.trancheStatus(vaultId, cycleId, userScope),
    queryFn: () => fetchTrancheStatus(vaultId!, cycleId),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    cycleId: query.data?.cycleId ?? null,
    cycleStatus: {
      status: query.data?.cycleStatus?.status ?? null,
      startTime: query.data?.cycleStatus?.startTime ?? null,
      endTime: query.data?.cycleStatus?.endTime ?? null,
      settled: query.data?.cycleStatus?.settled ?? false,
      totalShares: query.data?.cycleStatus?.totalShares ?? "0",
      totalSharesFormatted: query.data?.cycleStatus?.totalSharesFormatted ?? "0",
      batchState: query.data?.cycleStatus?.batchState ?? null,
    },
    tranchePosition: {
      accrued: query.data?.tranchePosition?.accrued ?? "0",
      accruedFormatted: query.data?.tranchePosition?.accruedFormatted ?? "0",
      claimed: query.data?.tranchePosition?.claimed ?? "0",
      claimedFormatted: query.data?.tranchePosition?.claimedFormatted ?? "0",
      claimableNow: query.data?.tranchePosition?.claimableNow ?? "0",
      claimableNowFormatted: query.data?.tranchePosition?.claimableNowFormatted ?? "0",
      minClaimThreshold: query.data?.tranchePosition?.minClaimThreshold ?? "1000000",
      minClaimThresholdFormatted: query.data?.tranchePosition?.minClaimThresholdFormatted ?? "1.0",
      dustOverrideEligible: query.data?.tranchePosition?.dustOverrideEligible ?? false,
      meetsThreshold: query.data?.tranchePosition?.meetsThreshold ?? false,
    },
    entitlementCount: query.data?.entitlementCount ?? 0,
    isLoading: vaultId !== undefined ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export interface UseCarryEligibilityResult {
  /** Lifecycle fields */
  accrued: string;
  accruedFormatted: string;
  claimed: string;
  claimedFormatted: string;
  claimableNow: string;
  claimableNowFormatted: string;
  minClaimThreshold: string;
  minClaimThresholdFormatted: string;
  /** Eligibility status */
  eligible: boolean;
  meetsThreshold: boolean;
  canClaim: boolean;
  dustOverrideEligible: boolean;
  eligibilityError: string | null;
  /** Status info */
  entitlementStatus: string | null;
  currentClaimState: string | null;
  /** Aggregated fields */
  totalEntitlements: number;
  eligibleCount: number;
  hasEligibleClaims: boolean;
  entitlements: Array<{
    entitlementId: number;
    requestId: string;
    cycleId: string;
    accrued: string;
    claimableNow: string;
    eligible: boolean;
    dustOverrideEligible: boolean;
    status: string;
  }>;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export function useCarryEligibility(
  vaultId?: number,
  requestId?: string,
): UseCarryEligibilityResult {
  const { address, isConnected } = useAppKitAccount();
  const userScope = getUserScope(isConnected, address);
  const query = useQuery({
    queryKey: vaultQueryKeys.carryEligibility(vaultId, requestId, userScope),
    queryFn: () => fetchCarryEligibility(vaultId!, requestId),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    accrued: query.data?.accrued ?? "0",
    accruedFormatted: query.data?.accruedFormatted ?? "0",
    claimed: query.data?.claimed ?? "0",
    claimedFormatted: query.data?.claimedFormatted ?? "0",
    claimableNow: query.data?.claimableNow ?? "0",
    claimableNowFormatted: query.data?.claimableNowFormatted ?? "0",
    minClaimThreshold: query.data?.minClaimThreshold ?? "1000000",
    minClaimThresholdFormatted: query.data?.minClaimThresholdFormatted ?? "1.0",
    eligible: query.data?.eligible ?? false,
    meetsThreshold: query.data?.meetsThreshold ?? false,
    canClaim: query.data?.canClaim ?? false,
    dustOverrideEligible: query.data?.dustOverrideEligible ?? false,
    eligibilityError: query.data?.eligibilityError ?? null,
    entitlementStatus: query.data?.entitlementStatus ?? null,
    currentClaimState: query.data?.currentClaimState ?? null,
    totalEntitlements: query.data?.totalEntitlements ?? 0,
    eligibleCount: query.data?.eligibleCount ?? 0,
    hasEligibleClaims: query.data?.hasEligibleClaims ?? false,
    entitlements:
      query.data?.entitlements?.map((e) => ({
        entitlementId: e.entitlementId,
        requestId: e.requestId,
        cycleId: e.cycleId,
        accrued: e.accrued,
        claimableNow: e.claimableNow,
        eligible: e.eligible,
        dustOverrideEligible: e.dustOverrideEligible ?? false,
        status: e.status,
      })) ?? [],
    isLoading: vaultId !== undefined ? query.isLoading : false,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}
