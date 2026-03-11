"use client";

import React, { useState, useEffect, useCallback } from "react";
import { encodeFunctionData, formatUnits, getAddress } from "viem";
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
  fetchWithdrawalQueue,
  // Epoch API functions
  postRedemptionRequest,
  postClaimRedemption,
  fetchCurrentEpochStatus,
  fetchEpochHistory,
  fetchEpochStatus,
  fetchUserRedemptions,
  // Tranche-carry lifecycle API
  fetchDepositQueue,
  fetchTrancheStatus,
  fetchCarryEligibility,
} from "./api";
import type {
  VaultInstancesResponse,
  VaultStatusResponse,
  VaultPositionsResponse,
  VaultPositionHistoryResponse,
  VaultNavHistoryResponse,
  VaultAllocationsResponse,
  WithdrawalQueueResponse,
  // Epoch types
  RedemptionRequestCreateResponse,
  ClaimRedemptionResponse,
  EpochStatusResponse,
  EpochHistoryItem,
  EpochHistoryResponse,
  UserRedemptionsResponse,
  Epoch,
  RedemptionRequest,
  // Tranche-carry lifecycle types
  DepositQueueResponse,
  TrancheStatusResponse,
  CarryEligibilityResponse,
} from "../types.js";

interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
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
          const result = await walletProvider.request({
            method: "eth_sendTransaction",
            params: [
              {
                from: fromAddress,
                to: tx.to,
                data: tx.data,
              },
            ],
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

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const result = await fetcher();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
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
  const fetcher = useCallback(() => fetchVaultStatus(vaultId), [vaultId]);
  return usePolledFetch(fetcher);
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
  refetch: () => Promise<unknown>;
}

export function usePreviewRedeem(vaultAddress?: string, shares?: bigint): PreviewRedeemResult {
  // Use share price based calculation instead of previewRedeem
  const { data: totalAssets, refetch: refetchAssets } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "totalAssets",
    query: {
      enabled: Boolean(vaultAddress && shares !== undefined && shares > 0n),
      refetchInterval: 15_000,
    },
  });

  const { data: totalSupply, refetch: refetchSupply } = useReadContract({
    address: vaultAddress as `0x${string}` | undefined,
    abi: VAULT_ABI,
    functionName: "totalSupply",
    query: {
      enabled: Boolean(vaultAddress && shares !== undefined && shares > 0n),
      refetchInterval: 15_000,
    },
  });

  // Calculate assets from share price: assets = shares * (totalAssets / totalSupply)
  const assets = React.useMemo(() => {
    if (!totalAssets || !totalSupply || !shares || totalSupply === 0n) return undefined;
    const sharePrice = Number(totalAssets) / Number(totalSupply);
    return BigInt(Math.floor(Number(shares) * sharePrice));
  }, [totalAssets, totalSupply, shares]);

  const refetch = useCallback(async () => {
    await Promise.all([refetchAssets(), refetchSupply()]);
  }, [refetchAssets, refetchSupply]);

  return { assets, refetch };
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
      functionName: "queueDeposit",
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
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create redemption request";
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [],
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

export function useRequests(vaultId?: number): UseRequestsResult {
  const [data, setData] = useState<UserRedemptionsResponse | null>(null);
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
      const result = await fetchUserRedemptions(vaultId);
      const normalizeRequest = (request: RedemptionRequest): RedemptionRequest => {
        // Normalize legacy status values to new lifecycle
        let normalizedStatus = request.status;
        if (String(request.status) === "ready" || String(request.status) === "settled") {
          normalizedStatus = "claimable";
        }

        const targetEpoch =
          request.targetEpoch ?? (request as RedemptionRequest & { epochId?: number }).epochId ?? 0;
        const targetEpochEndTime = request.targetEpochEndTime ?? request.createdAt;

        return {
          ...request,
          id: request.id || request.requestId,
          status: normalizedStatus,
          targetEpoch,
          targetEpochEndTime,
          claimableAssets: request.claimableAssets ?? null,
          claimableAssetsFormatted: request.claimableAssetsFormatted ?? null,
          claimedAt: request.claimedAt ?? null,
          cancelledAt: request.cancelledAt ?? null,
          proRataApplied: request.proRataApplied ?? false,
          proRataPercentage: request.proRataPercentage ?? null,
          // Controller-aware defaults (owner==controller initially)
          ownerAddress: request.ownerAddress ?? request.controllerAddress ?? "",
          controllerAddress: request.controllerAddress ?? request.ownerAddress ?? "",
          operatorAddress: request.operatorAddress ?? null,
        };
      };

      const pendingRequests = result.pendingRequests.map(normalizeRequest);
      const claimableRequests = result.claimableRequests.map(normalizeRequest);

      setData({
        ...result,
        pendingRequests,
        claimableRequests,
        requests: result.requests?.map(normalizeRequest) ?? [
          ...pendingRequests,
          ...claimableRequests,
        ],
      });
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch requests");
    } finally {
      setIsLoading(false);
    }
  }, [vaultId]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return {
    pendingRequests: data?.pendingRequests ?? [],
    claimableRequests: data?.claimableRequests ?? [],
    totalPendingShares: data?.totalPendingShares ?? "0",
    totalClaimableShares: data?.totalClaimableShares ?? "0",
    estimatedAssetsPendingFormatted: data?.estimatedAssetsPendingFormatted ?? "0.00",
    estimatedAssetsClaimableFormatted: data?.estimatedAssetsClaimableFormatted ?? "0.00",
    isLoading,
    error,
    lastRefresh,
    refetch,
  };
}

export interface UseEpochStatusResult {
  epoch: Epoch | null;
  isActive: boolean;
  timeRemainingFormatted: string;
  canSettle: boolean | undefined;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export interface UseEpochHistoryResult {
  currentEpochId: number | null;
  epochs: EpochHistoryItem[];
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export function useEpochStatus(vaultId?: number, epochId?: number): UseEpochStatusResult {
  const [data, setData] = useState<EpochStatusResponse | null>(null);
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
      const result =
        epochId !== undefined
          ? await fetchEpochStatus(vaultId, epochId)
          : await fetchCurrentEpochStatus(vaultId);
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch epoch status");
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, epochId]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return {
    epoch: data?.epoch ?? null,
    isActive: data?.epoch?.isActive ?? false,
    timeRemainingFormatted: data?.epoch?.timeRemainingFormatted ?? "0s",
    canSettle: data?.canSettle,
    isLoading,
    error,
    lastRefresh,
    refetch,
  };
}

export function useEpochHistory(vaultId?: number, limit = 6): UseEpochHistoryResult {
  const [data, setData] = useState<EpochHistoryResponse | null>(null);
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
      const result = await fetchEpochHistory(vaultId, limit);
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch epoch history");
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    currentEpochId: data?.currentEpochId ?? null,
    epochs: data?.epochs ?? [],
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
  const [data, setData] = useState<ClaimRedemptionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claimRedemption = useCallback(async (vaultId: number, requestId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await postClaimRedemption(vaultId, requestId);
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to claim redemption";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
// Tranche-Carry Lifecycle Hooks
// ============================================================================

export interface UseDepositQueueResult {
  queued: string;
  queuedFormatted: string;
  queuedShares: string;
  queuedSharesFormatted: string;
  estimateNav: string;
  estimateNavFormatted: string;
  estimateBasis: string | null;
  frozen: string;
  frozenFormatted: string;
  frozenShares: string;
  frozenSharesFormatted: string;
  depositRequestId: string | null;
  depositCreatedAt: string | null;
  targetEpochId: number | null;
  currentEpochId: number | null;
  currentEpochStart: string | null;
  currentEpochEnd: string | null;
  nextEpochStart: string | null;
  activationTime: string | null;
  queueStatus: "idle" | "queued" | "processed" | null;
  mintRule: string | null;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
}

export function useDepositQueue(vaultId?: number): UseDepositQueueResult {
  const [data, setData] = useState<DepositQueueResponse | null>(null);
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
      const result = await fetchDepositQueue(vaultId);
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch deposit queue");
    } finally {
      setIsLoading(false);
    }
  }, [vaultId]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return {
    queued: data?.queued ?? "0",
    queuedFormatted: data?.queuedFormatted ?? "0",
    queuedShares: data?.queuedShares ?? "0",
    queuedSharesFormatted: data?.queuedSharesFormatted ?? "0",
    estimateNav: data?.estimateNav ?? "0",
    estimateNavFormatted: data?.estimateNavFormatted ?? "0",
    estimateBasis: data?.estimateBasis ?? null,
    frozen: data?.frozen ?? "0",
    frozenFormatted: data?.frozenFormatted ?? "0",
    frozenShares: data?.frozenShares ?? "0",
    frozenSharesFormatted: data?.frozenSharesFormatted ?? "0",
    depositRequestId: data?.depositRequestId ?? null,
    depositCreatedAt: data?.depositCreatedAt ?? null,
    targetEpochId: data?.targetEpochId ?? null,
    currentEpochId: data?.currentEpochId ?? null,
    currentEpochStart: data?.currentEpochStart ?? null,
    currentEpochEnd: data?.currentEpochEnd ?? null,
    nextEpochStart: data?.nextEpochStart ?? null,
    activationTime: data?.activationTime ?? null,
    queueStatus: data?.queueStatus ?? null,
    mintRule: data?.mintRule ?? null,
    isLoading,
    error,
    lastRefresh,
    refetch,
  };
}

export interface UseTrancheStatusResult {
  epochId: number | null;
  epochStatus: {
    status: "settled" | "pending" | null;
    startTime: string | null;
    endTime: string | null;
    settled: boolean;
    totalShares: string;
    totalSharesFormatted: string;
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

export function useTrancheStatus(vaultId?: number, epochId?: number): UseTrancheStatusResult {
  const [data, setData] = useState<TrancheStatusResponse | null>(null);
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
      const result = await fetchTrancheStatus(vaultId, epochId);
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tranche status");
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, epochId]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return {
    epochId: data?.epochId ?? null,
    epochStatus: {
      status: data?.epochStatus?.status ?? null,
      startTime: data?.epochStatus?.startTime ?? null,
      endTime: data?.epochStatus?.endTime ?? null,
      settled: data?.epochStatus?.settled ?? false,
      totalShares: data?.epochStatus?.totalShares ?? "0",
      totalSharesFormatted: data?.epochStatus?.totalSharesFormatted ?? "0",
    },
    tranchePosition: {
      accrued: data?.tranchePosition?.accrued ?? "0",
      accruedFormatted: data?.tranchePosition?.accruedFormatted ?? "0",
      claimed: data?.tranchePosition?.claimed ?? "0",
      claimedFormatted: data?.tranchePosition?.claimedFormatted ?? "0",
      claimableNow: data?.tranchePosition?.claimableNow ?? "0",
      claimableNowFormatted: data?.tranchePosition?.claimableNowFormatted ?? "0",
      minClaimThreshold: data?.tranchePosition?.minClaimThreshold ?? "1000000",
      minClaimThresholdFormatted: data?.tranchePosition?.minClaimThresholdFormatted ?? "1.0",
      dustOverrideEligible: data?.tranchePosition?.dustOverrideEligible ?? false,
      meetsThreshold: data?.tranchePosition?.meetsThreshold ?? false,
    },
    entitlementCount: data?.entitlementCount ?? 0,
    isLoading,
    error,
    lastRefresh,
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
    epochId: string;
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
  const [data, setData] = useState<CarryEligibilityResponse | null>(null);
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
      const result = await fetchCarryEligibility(vaultId, requestId);
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch carry eligibility");
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, requestId]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return {
    accrued: data?.accrued ?? "0",
    accruedFormatted: data?.accruedFormatted ?? "0",
    claimed: data?.claimed ?? "0",
    claimedFormatted: data?.claimedFormatted ?? "0",
    claimableNow: data?.claimableNow ?? "0",
    claimableNowFormatted: data?.claimableNowFormatted ?? "0",
    minClaimThreshold: data?.minClaimThreshold ?? "1000000",
    minClaimThresholdFormatted: data?.minClaimThresholdFormatted ?? "1.0",
    eligible: data?.eligible ?? false,
    meetsThreshold: data?.meetsThreshold ?? false,
    canClaim: data?.canClaim ?? false,
    dustOverrideEligible: data?.dustOverrideEligible ?? false,
    eligibilityError: data?.eligibilityError ?? null,
    entitlementStatus: data?.entitlementStatus ?? null,
    currentClaimState: data?.currentClaimState ?? null,
    totalEntitlements: data?.totalEntitlements ?? 0,
    eligibleCount: data?.eligibleCount ?? 0,
    hasEligibleClaims: data?.hasEligibleClaims ?? false,
    entitlements:
      data?.entitlements?.map((e) => ({
        entitlementId: e.entitlementId,
        requestId: e.requestId,
        epochId: e.epochId,
        accrued: e.accrued,
        claimableNow: e.claimableNow,
        eligible: e.eligible,
        dustOverrideEligible: e.dustOverrideEligible ?? false,
        status: e.status,
      })) ?? [],
    isLoading,
    error,
    lastRefresh,
    refetch,
  };
}
