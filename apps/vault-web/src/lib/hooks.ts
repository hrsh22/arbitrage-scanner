"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData, formatUnits, getAddress, parseUnits, toHex } from "viem";
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
  fetchCurrentCycleStatus,
  fetchVaultPositions,
  fetchVaultPositionHistory,
  fetchVaultAllocations,
  fetchWithdrawalQueue,
  postWithdrawalPreflight,
  // Batch/Cycle API functions
  postRedemptionRequest,
  postClaimRedemption,
  // Closed-book batch lifecycle API
  fetchDepositQueue,
  fetchTrancheStatus,
  fetchCarryEligibility,
  postRecordDepositActivity,
  postVaultNavUpdate,
} from "./api";
import type {
  Cycle,
  VaultPositionsResponse,
  VaultPositionHistoryResponse,
  VaultAllocationsResponse,
  WithdrawalQueueResponse,
  WithdrawalPreflightResponse,
  // Batch/Cycle types
  RedemptionRequestCreateResponse,
  ClaimRedemptionResponse,
  VaultInstance,
} from "../types.js";
import {
  DEFAULT_POLL_INTERVAL_MS,
  getErrorMessage,
  getLastRefresh,
  getUserScope,
  isUnauthorizedError,
  type AsyncState,
} from "./hooks/shared";
import { useAuthSession } from "./hooks/authSession";
import { vaultQueryKeys } from "./hooks/queryKeys";
import { invalidateVaultQueries } from "./hooks/invalidation";
export {
  invalidatePublicVaultDetailQueries,
  invalidateUserVaultDetailQueries,
  invalidateVaultDetailQueries,
  invalidateVaultQueries,
} from "./hooks/invalidation";
export {
  useVaultInstances,
  useVaultStatus,
  useCycleStatus,
  useDiscoverVaultCards,
  type UseCycleStatusResult,
  type DiscoverVaultCardData,
} from "./hooks/discover";
export { useAuthSession, type UseAuthSessionResult } from "./hooks/authSession";
export {
  useVaultNavHistory,
  useVaultTradingAnalytics,
  useVaultEvents,
  useUserVaultHistory,
  useRequests,
  useCycleHistory,
  type VaultEventsQueryOptions,
  type UseRequestsResult,
  type UseCycleHistoryResult,
} from "./hooks/vaultDetailRead";
export { useTransientState } from "./hooks/transientState";
export { vaultQueryKeys };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
              await wait(1200);
              try {
                const retriedEstimate = await walletProvider.request({
                  method: "eth_estimateGas",
                  params: [txRequest],
                });

                if (typeof retriedEstimate === "string" && retriedEstimate.startsWith("0x")) {
                  txRequest.gas = toHex((BigInt(retriedEstimate) * 12n) / 10n);
                }
              } catch (retryError) {
                throw retryError instanceof Error
                  ? retryError
                  : estimateError instanceof Error
                    ? estimateError
                    : new Error("Transaction gas estimation failed.");
              }
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

export function useVaultPositions(vaultId?: number): AsyncState<VaultPositionsResponse> {
  const fetcher = useCallback(async () => {
    if (vaultId === undefined) throw new Error("WAIT_FOR_VAULT_ID");
    return fetchVaultPositions(vaultId);
  }, [vaultId]);
  const result = usePolledFetch(fetcher);
  if (result.error === "WAIT_FOR_VAULT_ID") {
    return { ...result, error: null, isLoading: true };
  }
  return result;
}

export function useVaultPositionHistory(
  vaultId?: number,
): AsyncState<VaultPositionHistoryResponse> {
  const query = useQuery({
    queryKey: vaultQueryKeys.positionHistory(vaultId),
    queryFn: () => fetchVaultPositionHistory(vaultId!),
    enabled: vaultId !== undefined,
    refetchInterval: DEFAULT_POLL_INTERVAL_MS,
  });

  const refetch = useCallback(async (): Promise<VaultPositionHistoryResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: vaultId !== undefined ? query.isLoading : true,
    error: getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
}

export function useVaultAllocations(limit?: number): AsyncState<VaultAllocationsResponse> {
  const fetcher = useCallback(() => fetchVaultAllocations(limit), [limit]);
  return usePolledFetch(fetcher);
}

export function useWithdrawalQueue(vaultAddress?: string): AsyncState<WithdrawalQueueResponse> {
  const { address, sessionAuthenticated, walletConnected } = useAuthSession();
  const userScope = getUserScope(sessionAuthenticated, address);
  const query = useQuery({
    queryKey: vaultQueryKeys.withdrawalQueue(vaultAddress, userScope),
    queryFn: () => fetchWithdrawalQueue(vaultAddress),
    enabled: Boolean(vaultAddress && walletConnected && sessionAuthenticated),
    refetchInterval: 15_000,
  });

  const refetch = useCallback(async (): Promise<WithdrawalQueueResponse | null> => {
    const result = await query.refetch();
    return result.data ?? null;
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: Boolean(vaultAddress && walletConnected && sessionAuthenticated)
      ? query.isLoading
      : false,
    error: isUnauthorizedError(query.error) ? null : getErrorMessage(query.error),
    lastRefresh: getLastRefresh(query.dataUpdatedAt, query.data !== undefined),
    refetch,
  };
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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const effectiveAddress = hydrated ? address : undefined;
  const effectiveIsConnected = hydrated ? isConnected : false;

  const { data: balance, isLoading } = useReadContract({
    address: USDC_E_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: effectiveAddress ? [effectiveAddress as `0x${string}`] : undefined,
    query: {
      enabled: effectiveIsConnected && !!effectiveAddress,
      refetchInterval: 15_000,
    },
  });

  const formatted = hydrated && balance !== undefined ? (Number(balance) / 1e6).toFixed(2) : "0.00";

  return {
    balance,
    formatted,
    isLoading: hydrated && isLoading && effectiveIsConnected,
    isConnected: effectiveIsConnected,
    address: effectiveAddress,
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

interface ClaimProcessedDepositResult {
  claimProcessedDeposit: (
    vaultAddress: `0x${string}`,
    assets: bigint,
    receiver: `0x${string}`,
    controller: `0x${string}`,
  ) => void;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  hash?: `0x${string}`;
  error: Error | null;
  reset: () => void;
}

export function useClaimProcessedDeposit(): ClaimProcessedDepositResult {
  const { write, hash, isPending, error, reset } = useEip155WriteState();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const claimProcessedDeposit = (
    vaultAddress: `0x${string}`,
    assets: bigint,
    receiver: `0x${string}`,
    controller: `0x${string}`,
  ) => {
    const data = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "deposit",
      args: [assets, receiver, controller],
    });

    write({
      to: vaultAddress,
      data,
    });
  };

  return {
    claimProcessedDeposit,
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

interface UseVaultDepositFlowParams {
  vault: VaultInstance;
  vaultId: number;
  cycle: Cycle | null;
  userAuthorized: boolean;
  onSuccess: () => Promise<void> | void;
}

export interface UseVaultDepositFlowResult {
  amount: string;
  setAmount: (value: string) => void;
  clearFeedback: () => void;
  handleMaxAmount: () => void;
  handleApprove: () => void;
  handleDeposit: () => Promise<void>;
  parsedAmount: bigint | undefined;
  previewShares: bigint | undefined;
  meetsMinDeposit: boolean;
  isValidAmount: boolean;
  walletAddress: string | undefined;
  walletBalanceFormatted: string;
  walletBalanceLoading: boolean;
  needsApproval: boolean;
  actionPending: boolean;
  navSyncPending: boolean;
  depositPreflightPending: boolean;
  approvePending: boolean;
  approveConfirming: boolean;
  depositPending: boolean;
  depositConfirming: boolean;
  queueDepositPending: boolean;
  queueDepositConfirming: boolean;
  message: string | null;
  errorMessage: string | null;
  customQueueWindowOpen: boolean;
  customQueuePendingClose: boolean;
  cycleStateUnavailable: boolean;
  queueStatus: "idle" | "queued" | "processed" | null;
  hasQueuedDeposit: boolean;
  queuedFormatted: string;
  queuedSharesFormatted: string;
  depositCreatedAt: string | null;
  estimateBasis: string | null;
  depositQueueLoading: boolean;
}

function parseTokenUnits(value: string, decimals: number): bigint | undefined {
  if (!value.trim()) {
    return undefined;
  }

  try {
    return parseUnits(value, decimals);
  } catch {
    return undefined;
  }
}

export function useVaultDepositFlow({
  vault,
  vaultId,
  cycle,
  userAuthorized,
  onSuccess,
}: UseVaultDepositFlowParams): UseVaultDepositFlowResult {
  const isCustomVault = vault.type === "custom";
  const { formatted, isLoading: balanceLoading, address } = useWalletBalance();
  const [amount, setAmountState] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [navSyncPending, setNavSyncPending] = useState(false);
  const [depositPreflightPending, setDepositPreflightPending] = useState(false);
  const [submittedDepositAmount, setSubmittedDepositAmount] = useState<string | null>(null);
  const [recordedDepositHash, setRecordedDepositHash] = useState<string | null>(null);

  const parsedAmount = parseTokenUnits(amount, 6);
  const meetsMinDeposit = Number.parseFloat(amount || "0") >= vault.profile.minDeposit;
  const isValidAmount = parsedAmount !== undefined && parsedAmount > 0n && meetsMinDeposit;
  const customQueueWindowOpen =
    isCustomVault && cycle?.executionMode === "queued" && cycle.batchState === "closed";
  const customQueuePendingClose =
    isCustomVault && cycle?.executionMode === "queued" && cycle.batchState !== "closed";
  const cycleStateUnavailable = isCustomVault && !cycle;

  const { shares: previewShares } = usePreviewDeposit(
    vault.config.vaultAddress,
    parsedAmount,
    !isCustomVault,
  );
  const { allowance, refetch: refetchAllowance } = useUsdcAllowance(
    address,
    vault.config.vaultAddress,
  );
  const {
    approve,
    isPending: approvePending,
    isConfirming: approveConfirming,
    isConfirmed: approveConfirmed,
    error: approveError,
    reset: resetApprove,
  } = useUsdcApprove();
  const {
    deposit,
    isPending: depositPending,
    isConfirming: depositConfirming,
    isConfirmed: depositConfirmed,
    hash: depositHash,
    error: depositError,
    reset: resetDeposit,
  } = useVaultDeposit();
  const {
    queueDeposit,
    isPending: queueDepositPending,
    isConfirming: queueDepositConfirming,
    isConfirmed: queueDepositConfirmed,
    hash: queueDepositHash,
    error: queueDepositError,
    reset: resetQueueDeposit,
  } = useQueueDeposit();
  const {
    queueStatus,
    hasQueuedDeposit,
    queuedFormatted,
    queuedSharesFormatted,
    depositCreatedAt,
    estimateBasis,
    isLoading: depositQueueLoading,
  } = useDepositQueue(vaultId, userAuthorized);

  const needsApproval = isValidAmount ? allowance < parsedAmount : false;
  const actionPending =
    approvePending ||
    approveConfirming ||
    depositPending ||
    depositConfirming ||
    queueDepositPending ||
    queueDepositConfirming ||
    navSyncPending ||
    depositPreflightPending;

  const clearFeedback = useCallback(() => {
    setErrorMessage(null);
    setMessage(null);
  }, []);

  const resetFlowState = useCallback(() => {
    resetApprove();
    resetDeposit();
    resetQueueDeposit();
  }, [resetApprove, resetDeposit, resetQueueDeposit]);

  const setAmount = useCallback(
    (value: string) => {
      setAmountState(value);
      clearFeedback();
      resetFlowState();
    },
    [clearFeedback, resetFlowState],
  );

  const handleMaxAmount = useCallback(() => {
    setAmountState(formatted);
    clearFeedback();
  }, [clearFeedback, formatted]);

  useEffect(() => {
    if (!approveConfirmed) {
      return;
    }

    void refetchAllowance();
    setErrorMessage(null);
    setMessage("Approval confirmed. You can deposit now.");
  }, [approveConfirmed, refetchAllowance]);

  useEffect(() => {
    if (!depositConfirmed && !queueDepositConfirmed) {
      return;
    }

    const confirmedHash = queueDepositConfirmed ? queueDepositHash : depositHash;
    if (!confirmedHash) {
      return;
    }

    let cancelled = false;

    void (async () => {
      if (userAuthorized && recordedDepositHash !== confirmedHash) {
        await postRecordDepositActivity(vaultId, {
          txHash: confirmedHash,
          assets: submittedDepositAmount ?? undefined,
          mode: queueDepositConfirmed ? "queued" : "minted",
        }).catch(() => undefined);

        if (cancelled) {
          return;
        }

        setRecordedDepositHash(confirmedHash);
      }

      setAmountState("");
      setErrorMessage(null);
      setMessage(
        queueDepositConfirmed ? "Deposit queued — it will process shortly." : "Deposit confirmed!",
      );
      resetFlowState();
      await refetchAllowance().catch(() => undefined);

      if (cancelled) {
        return;
      }

      await Promise.resolve(onSuccess()).catch(() => undefined);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    depositConfirmed,
    depositHash,
    onSuccess,
    queueDepositConfirmed,
    queueDepositHash,
    recordedDepositHash,
    refetchAllowance,
    resetFlowState,
    submittedDepositAmount,
    userAuthorized,
    vaultId,
  ]);

  useEffect(() => {
    if (!approveError && !depositError && !queueDepositError) {
      return;
    }

    setErrorMessage(
      approveError?.message ?? depositError?.message ?? queueDepositError?.message ?? null,
    );
    setMessage(null);
  }, [approveError, depositError, queueDepositError]);

  const ensureFreshNav = useCallback(async () => {
    setNavSyncPending(true);
    clearFeedback();

    try {
      await postVaultNavUpdate();
      return true;
    } catch {
      setErrorMessage("Price refresh failed. Please try again.");
      return false;
    } finally {
      setNavSyncPending(false);
    }
  }, [clearFeedback]);

  const handleApprove = useCallback(() => {
    if (!parsedAmount) {
      return;
    }

    clearFeedback();
    resetApprove();
    approve(vault.config.vaultAddress as `0x${string}`, parsedAmount);
  }, [approve, clearFeedback, parsedAmount, resetApprove, vault.config.vaultAddress]);

  const handleDeposit = useCallback(async () => {
    if (!parsedAmount || !address || actionPending || cycle?.executionMode === "blocked") {
      return;
    }

    setDepositPreflightPending(true);
    clearFeedback();
    resetDeposit();
    resetQueueDeposit();

    try {
      const latestCycleResponse = await fetchCurrentCycleStatus(vaultId, true).catch(() => null);
      const latestCycle = latestCycleResponse?.cycle;

      if (isCustomVault) {
        if (!latestCycle) {
          setErrorMessage("Could not verify vault status. Please try again in a moment.");
          return;
        }

        if (latestCycle.executionMode === "queued" && latestCycle.batchState === "closed") {
          setSubmittedDepositAmount(amount);
          queueDeposit(vault.config.vaultAddress as `0x${string}`, parsedAmount);
          return;
        }

        if (latestCycle.executionMode === "queued") {
          setErrorMessage("Deposits are temporarily queued. Please try again shortly.");
          return;
        }

        if (latestCycle.executionMode === "instant" && latestCycle.telemetryFresh === true) {
          const refreshed = await ensureFreshNav();
          if (!refreshed) {
            return;
          }

          setSubmittedDepositAmount(amount);
          deposit(
            vault.config.vaultAddress as `0x${string}`,
            parsedAmount,
            address as `0x${string}`,
          );
          return;
        }

        if (latestCycle.executionMode === "blocked") {
          return;
        }

        setErrorMessage("Still loading. Please wait a moment and try again.");
        return;
      }

      const refreshed = await ensureFreshNav();
      if (!refreshed) {
        return;
      }

      setSubmittedDepositAmount(amount);
      deposit(vault.config.vaultAddress as `0x${string}`, parsedAmount, address as `0x${string}`);
    } finally {
      setDepositPreflightPending(false);
    }
  }, [
    actionPending,
    address,
    amount,
    clearFeedback,
    cycle?.executionMode,
    deposit,
    ensureFreshNav,
    isCustomVault,
    parsedAmount,
    queueDeposit,
    resetDeposit,
    resetQueueDeposit,
    vault.config.vaultAddress,
    vaultId,
  ]);

  return {
    amount,
    setAmount,
    clearFeedback,
    handleMaxAmount,
    handleApprove,
    handleDeposit,
    parsedAmount,
    previewShares,
    meetsMinDeposit,
    isValidAmount,
    walletAddress: address,
    walletBalanceFormatted: formatted,
    walletBalanceLoading: balanceLoading,
    needsApproval,
    actionPending,
    navSyncPending,
    depositPreflightPending,
    approvePending,
    approveConfirming,
    depositPending,
    depositConfirming,
    queueDepositPending,
    queueDepositConfirming,
    message,
    errorMessage,
    customQueueWindowOpen,
    customQueuePendingClose,
    cycleStateUnavailable,
    queueStatus,
    hasQueuedDeposit,
    queuedFormatted,
    queuedSharesFormatted,
    depositCreatedAt,
    estimateBasis,
    depositQueueLoading,
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
  hasQueuedDeposit: boolean;
  // No current NAV estimate in closed-book; shares minted at cycle-open NAV
  cycleOpenNavEstimate: string | null;
  cycleOpenNavFormatted: string | null;
  estimateBasis: string | null;
  frozen: string;
  frozenFormatted: string;
  frozenShares: string;
  frozenSharesFormatted: string;
  claimableAssets: string;
  claimableAssetsFormatted: string;
  claimableShares: string;
  claimableSharesFormatted: string;
  hasProcessedDeposit: boolean;
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
    hasQueuedDeposit: query.data?.hasQueuedDeposit ?? false,
    cycleOpenNavEstimate: query.data?.cycleOpenNavEstimate ?? null,
    cycleOpenNavFormatted: query.data?.cycleOpenNavFormatted ?? null,
    estimateBasis: query.data?.estimateBasis ?? null,
    frozen: query.data?.frozen ?? "0",
    frozenFormatted: query.data?.frozenFormatted ?? "0",
    frozenShares: query.data?.frozenShares ?? "0",
    frozenSharesFormatted: query.data?.frozenSharesFormatted ?? "0",
    claimableAssets: query.data?.claimableAssets ?? "0",
    claimableAssetsFormatted: query.data?.claimableAssetsFormatted ?? "0",
    claimableShares: query.data?.claimableShares ?? "0",
    claimableSharesFormatted: query.data?.claimableSharesFormatted ?? "0",
    hasProcessedDeposit: query.data?.hasProcessedDeposit ?? false,
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
