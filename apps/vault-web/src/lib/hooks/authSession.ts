"use client";

import { useAppKitAccount } from "@reown/appkit/react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { fetchAuthMe } from "../api";

type AuthSessionStatus = "idle" | "checking" | "authenticated" | "unauthenticated";

interface AuthSessionStoreState {
  status: AuthSessionStatus;
  walletAddress: string | null;
  error: string | null;
}

export interface UseAuthSessionResult {
  address: string | undefined;
  walletConnected: boolean;
  sessionAuthenticated: boolean;
  sessionChecking: boolean;
  sessionKnown: boolean;
  sessionError: string | null;
  refreshSession: () => Promise<boolean>;
  resetSession: () => void;
  markSessionAuthenticated: () => void;
}

const INITIAL_STATE: AuthSessionStoreState = {
  status: "idle",
  walletAddress: null,
  error: null,
};

let storeState: AuthSessionStoreState = INITIAL_STATE;
let activeRequestId = 0;
let activeRequest: Promise<boolean> | null = null;
let activeRequestAddress: string | null = null;

const listeners = new Set<() => void>();

function normalizeAddress(address?: string | null): string | null {
  if (!address) {
    return null;
  }

  const normalized = address.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function emitStoreChange() {
  listeners.forEach((listener) => listener());
}

function setStoreState(nextState: AuthSessionStoreState) {
  if (
    storeState.status === nextState.status &&
    storeState.walletAddress === nextState.walletAddress &&
    storeState.error === nextState.error
  ) {
    return;
  }

  storeState = nextState;
  emitStoreChange();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return storeState;
}

function clearActiveRequest() {
  activeRequestId += 1;
  activeRequest = null;
  activeRequestAddress = null;
}

function resetAuthSessionState(walletAddress?: string | null) {
  const normalizedAddress = normalizeAddress(walletAddress);
  clearActiveRequest();

  if (!normalizedAddress) {
    setStoreState(INITIAL_STATE);
    return;
  }

  setStoreState({
    status: "unauthenticated",
    walletAddress: normalizedAddress,
    error: null,
  });
}

function markAuthSessionAuthenticated(walletAddress?: string | null) {
  const normalizedAddress = normalizeAddress(walletAddress);

  if (!normalizedAddress) {
    resetAuthSessionState();
    return;
  }

  clearActiveRequest();
  setStoreState({
    status: "authenticated",
    walletAddress: normalizedAddress,
    error: null,
  });
}

function resolveSessionAuthenticated(
  result: { authenticated: boolean; address?: string },
  walletAddress: string,
) {
  const sessionAddress = normalizeAddress(result.address);
  return result.authenticated === true && (!sessionAddress || sessionAddress === walletAddress);
}

async function refreshAuthSessionState(
  walletAddress: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const normalizedAddress = normalizeAddress(walletAddress);

  if (!normalizedAddress) {
    resetAuthSessionState();
    return false;
  }

  if (!options.force && storeState.walletAddress === normalizedAddress) {
    if (storeState.status === "authenticated") {
      return true;
    }

    if (storeState.status === "unauthenticated") {
      return false;
    }

    if (
      storeState.status === "checking" &&
      activeRequest &&
      activeRequestAddress === normalizedAddress
    ) {
      return activeRequest;
    }
  }

  const requestId = activeRequestId + 1;
  activeRequestId = requestId;
  activeRequestAddress = normalizedAddress;

  setStoreState({
    status: "checking",
    walletAddress: normalizedAddress,
    error: null,
  });

  const request = (async () => {
    try {
      const result = await fetchAuthMe();
      const authenticated = resolveSessionAuthenticated(result, normalizedAddress);

      if (activeRequestId === requestId) {
        setStoreState({
          status: authenticated ? "authenticated" : "unauthenticated",
          walletAddress: normalizedAddress,
          error: null,
        });
      }

      return authenticated;
    } catch {
      if (activeRequestId === requestId) {
        setStoreState({
          status: "unauthenticated",
          walletAddress: normalizedAddress,
          error: null,
        });
      }

      return false;
    } finally {
      if (activeRequestId === requestId) {
        activeRequest = null;
        activeRequestAddress = null;
      }
    }
  })();

  activeRequest = request;
  return request;
}

export function useAuthSession(): UseAuthSessionResult {
  const { address, isConnected } = useAppKitAccount();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const normalizedAddress = normalizeAddress(address);
  const walletConnected = Boolean(isConnected && normalizedAddress);

  useEffect(() => {
    if (!walletConnected || !normalizedAddress) {
      resetAuthSessionState();
      return;
    }

    void refreshAuthSessionState(normalizedAddress);
  }, [normalizedAddress, walletConnected]);

  const refreshSession = useCallback(() => {
    if (!walletConnected || !normalizedAddress) {
      resetAuthSessionState();
      return Promise.resolve(false);
    }

    return refreshAuthSessionState(normalizedAddress, { force: true });
  }, [normalizedAddress, walletConnected]);

  const resetSession = useCallback(() => {
    resetAuthSessionState(normalizedAddress);
  }, [normalizedAddress]);

  const markSessionAuthenticated = useCallback(() => {
    markAuthSessionAuthenticated(normalizedAddress);
  }, [normalizedAddress]);

  const sessionOwnedByCurrentWallet =
    walletConnected && snapshot.walletAddress === normalizedAddress;
  const sessionAuthenticated = sessionOwnedByCurrentWallet && snapshot.status === "authenticated";
  const sessionChecking = sessionOwnedByCurrentWallet && snapshot.status === "checking";
  const sessionKnown = !walletConnected || (sessionOwnedByCurrentWallet && !sessionChecking);
  const sessionError = sessionOwnedByCurrentWallet ? snapshot.error : null;

  return {
    address,
    walletConnected,
    sessionAuthenticated,
    sessionChecking,
    sessionKnown,
    sessionError,
    refreshSession,
    resetSession,
    markSessionAuthenticated,
  };
}
