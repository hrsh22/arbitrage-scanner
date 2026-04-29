import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppKitAccount } from "@reown/appkit/react";
import { parseUnits } from "viem";
import type { RedemptionRequest, VaultInstance } from "../../types";
import {
  COLLATERAL_OFFRAMP_ADDRESS,
  COLLATERAL_ONRAMP_ADDRESS,
  USER_COLLATERAL_DECIMALS,
} from "../../constants";
import { postRecordClaimActivity } from "../api";
import {
  useCustomVaultRequestRedeem,
  useTokenAllowance,
  useTokenApprove,
  useVaultRedeem,
} from "../hooks";
import { invalidateVaultDetailQueries } from "./invalidation";
import { useTransientState } from "./transientState";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function hasConfiguredCollateralHelpers(): boolean {
  return COLLATERAL_ONRAMP_ADDRESS !== ZERO_ADDRESS && COLLATERAL_OFFRAMP_ADDRESS !== ZERO_ADDRESS;
}

function normalizeWalletErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("rejected") ||
    normalized.includes("denied") ||
    normalized.includes("4001") ||
    normalized.includes("user")
  ) {
    return "Transaction cancelled. You can try again.";
  }

  return message;
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-4)}`;
}

interface UseQueuedRedemptionRequestOptions {
  vaultId?: number;
  vaultAddress: string;
  onConfirmed?: () => void;
}

interface UseQueuedRedemptionRequestResult {
  shareAllowance: bigint;
  approveShares: (shares: bigint) => void;
  submitRequest: (shares: bigint) => void;
  resetApprovalState: () => void;
  showSuccessMessage: boolean;
  isBusy: boolean;
  queuePending: boolean;
  queueConfirming: boolean;
  approvePending: boolean;
  approveConfirming: boolean;
  visibleError: string | null;
}

export function useQueuedRedemptionRequest({
  vaultId,
  vaultAddress,
  onConfirmed,
}: UseQueuedRedemptionRequestOptions): UseQueuedRedemptionRequestResult {
  const queryClient = useQueryClient();
  const { address } = useAppKitAccount();
  const [error, setError] = useState<string | null>(null);
  const {
    value: showSuccessMessage,
    activate: showSuccess,
    deactivate: hideSuccess,
  } = useTransientState({ durationMs: 5000 });
  const {
    requestRedeemTx,
    isPending: queuePending,
    isConfirming: queueConfirming,
    isConfirmed: queueConfirmed,
    error: queueError,
    reset: resetQueue,
  } = useCustomVaultRequestRedeem();
  const { allowance: shareAllowance, refetch: refetchShareAllowance } = useTokenAllowance(
    vaultAddress,
    address,
    vaultAddress,
  );
  const {
    approve: approveSharesTx,
    isPending: approvePending,
    isConfirming: approveConfirming,
    isConfirmed: approveConfirmed,
    error: approveError,
    reset: resetApprove,
  } = useTokenApprove(vaultAddress);

  const approveShares = useCallback(
    (shares: bigint) => {
      setError(null);
      hideSuccess();
      resetApprove();
      approveSharesTx(vaultAddress as `0x${string}`, shares);
    },
    [approveSharesTx, hideSuccess, resetApprove, vaultAddress],
  );

  const submitRequest = useCallback(
    (shares: bigint) => {
      if (!address) {
        return;
      }

      setError(null);
      hideSuccess();
      resetQueue();

      try {
        requestRedeemTx(
          vaultAddress as `0x${string}`,
          shares,
          address as `0x${string}`,
          address as `0x${string}`,
        );
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Failed to submit request");
      }
    },
    [address, hideSuccess, requestRedeemTx, resetQueue, vaultAddress],
  );

  const resetApprovalState = useCallback(() => {
    setError(null);
    resetQueue();
    resetApprove();
  }, [resetApprove, resetQueue]);

  useEffect(() => {
    if (!queueConfirmed) {
      return;
    }

    setError(null);
    showSuccess();
    onConfirmed?.();
    void invalidateVaultDetailQueries(queryClient, vaultId);
  }, [onConfirmed, queryClient, queueConfirmed, showSuccess, vaultId]);

  useEffect(() => {
    if (!approveConfirmed) {
      return;
    }

    setError(null);
    void refetchShareAllowance();
  }, [approveConfirmed, refetchShareAllowance]);

  return {
    shareAllowance,
    approveShares,
    submitRequest,
    resetApprovalState,
    showSuccessMessage,
    isBusy: queuePending || queueConfirming || approvePending || approveConfirming,
    queuePending,
    queueConfirming,
    approvePending,
    approveConfirming,
    visibleError: error ?? queueError?.message ?? approveError?.message ?? null,
  };
}

interface ClaimRequestSnapshot {
  requestId: string;
  shares: string;
  assets?: string;
  receiver: `0x${string}`;
  owner: `0x${string}`;
}

interface UseRedemptionClaimLifecycleOptions {
  vaultId?: number;
  vaultAddress: string;
  vaultType: VaultInstance["type"];
}

interface UseRedemptionClaimLifecycleResult {
  activeRequestId: string | null;
  feedbackRequestId: string | null;
  feedbackError: string | null;
  successTx: string | null;
  isBusy: boolean;
  claim: (request: RedemptionRequest) => void;
}

export function useRedemptionClaimLifecycle({
  vaultId,
  vaultAddress,
  vaultType,
}: UseRedemptionClaimLifecycleOptions): UseRedemptionClaimLifecycleResult {
  const queryClient = useQueryClient();
  const { address, isConnected } = useAppKitAccount();
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [claimSnapshot, setClaimSnapshot] = useState<ClaimRequestSnapshot | null>(null);
  const [feedbackRequestId, setFeedbackRequestId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const {
    redeem,
    claimUSDCe,
    hash,
    isPending,
    isConfirming,
    isConfirmed,
    error: redeemError,
    reset,
  } = useVaultRedeem();

  const claim = useCallback(
    (request: RedemptionRequest) => {
      if (!isConnected) {
        return;
      }

      setFeedbackRequestId(null);
      setFeedbackError(null);
      setSuccessTx(null);
      reset();

      try {
        const receiverAddress =
          request.ownerAddress ||
          request.controllerAddress ||
          (address as `0x${string}` | undefined);
        if (!receiverAddress) {
          throw new Error("Missing receiver address for claim");
        }

        setActiveRequestId(request.requestId);
        setClaimSnapshot({
          requestId: request.requestId,
          shares: request.sharesFormatted,
          assets: request.claimableAssetsFormatted ?? undefined,
          receiver: receiverAddress as `0x${string}`,
          owner: (request.ownerAddress ||
            request.controllerAddress ||
            receiverAddress) as `0x${string}`,
        });

        const shares = parseUnits(request.sharesFormatted, 6);
        const owner = (request.ownerAddress || request.controllerAddress || receiverAddress) as `0x${string}`;

        if (vaultType === "custom" && hasConfiguredCollateralHelpers()) {
          const claimableAssets = parseUnits(
            request.claimableAssetsFormatted ?? "0",
            USER_COLLATERAL_DECIMALS,
          );

          claimUSDCe(vaultAddress as `0x${string}`, shares, receiverAddress as `0x${string}`, owner, claimableAssets);
        } else {
          redeem(vaultAddress as `0x${string}`, shares, receiverAddress as `0x${string}`, owner);
        }
      } catch (claimError) {
        setActiveRequestId(null);
        setClaimSnapshot(null);
        setFeedbackRequestId(request.requestId);
        setFeedbackError(
          claimError instanceof Error ? claimError.message : "Failed to claim redemption request",
        );
      }
    },
    [address, claimUSDCe, isConnected, redeem, reset, vaultAddress, vaultType],
  );

  useEffect(() => {
    if (!isConfirmed || !hash || !claimSnapshot) {
      return;
    }

    let cancelled = false;
    let refreshTimeout: number | undefined;

    void (async () => {
      try {
        if (vaultType === "custom" && vaultId !== undefined) {
          await postRecordClaimActivity(vaultId, {
            txHash: hash,
            requestId: claimSnapshot.requestId,
            shares: claimSnapshot.shares,
            assets: claimSnapshot.assets,
          });
        }

        if (cancelled) {
          return;
        }

        setFeedbackRequestId(claimSnapshot.requestId);
        setFeedbackError(null);
        setSuccessTx(hash);
      } catch (recordError) {
        if (cancelled) {
          return;
        }

        setFeedbackRequestId(claimSnapshot.requestId);
        setSuccessTx(hash);
        setFeedbackError(
          `Claim succeeded (${truncateHash(hash)}) but activity sync failed: ${
            recordError instanceof Error ? recordError.message : "Unknown error"
          }`,
        );
      } finally {
        if (cancelled) {
          return;
        }

        setActiveRequestId(null);
        setClaimSnapshot(null);
        reset();
        refreshTimeout = window.setTimeout(() => {
          void invalidateVaultDetailQueries(queryClient, vaultId);
        }, 2000);
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimeout !== undefined) {
        window.clearTimeout(refreshTimeout);
      }
    };
  }, [claimSnapshot, hash, isConfirmed, queryClient, reset, vaultId, vaultType]);

  useEffect(() => {
    if (!redeemError || !activeRequestId) {
      return;
    }

    setFeedbackRequestId(activeRequestId);
    setFeedbackError(normalizeWalletErrorMessage(redeemError.message));
    setSuccessTx(null);
    setActiveRequestId(null);
    setClaimSnapshot(null);
  }, [activeRequestId, redeemError]);

  return {
    activeRequestId,
    feedbackRequestId,
    feedbackError,
    successTx,
    isBusy: isPending || isConfirming,
    claim,
  };
}
