"use client";

import { useEffect, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Separator } from "@workspace/ui/components/separator";
import { fetchSiweNonce, postSiweVerify } from "../src/lib/api";
import { useAuthSession } from "../src/lib/hooks";
import { useAppKit, useAppKitNetwork, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { getAddress } from "viem";
import { VAULT_NETWORK } from "../src/constants";

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

function normalizeChainId(chainId: string | number | undefined): number | null {
  if (typeof chainId === "number" && Number.isInteger(chainId) && chainId > 0) {
    return chainId;
  }

  if (typeof chainId === "string") {
    const maybeCaip = chainId.includes(":") ? chainId.split(":").at(-1) : chainId;
    const parsed = Number(maybeCaip);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function truncateAddress(address?: string): string {
  if (!address) {
    return "";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// SIWE Message construction
interface SiweMessageParams {
  address: string;
  nonce: string;
  chainId: number;
  uri: string;
  domain: string;
}

function createSiweMessage(params: SiweMessageParams): string {
  const { address, nonce, chainId, uri, domain } = params;
  const issuedAt = new Date().toISOString();

  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in with Ethereum to the Vault platform.

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}`;
}

export function HeaderAuth() {
  const {
    address,
    walletConnected,
    sessionAuthenticated: isAuthenticated,
    sessionKnown,
    markSessionAuthenticated,
    resetSession,
  } = useAuthSession();
  const { chainId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCheckingSession = walletConnected && !sessionKnown;

  useEffect(() => {
    if (!walletConnected) {
      setError(null);
    }
  }, [walletConnected]);

  const handleSignIn = async () => {
    if (!address) return;

    setIsLoading(true);
    setError(null);

    try {
      const { nonce } = await fetchSiweNonce();
      const resolvedChainId = normalizeChainId(chainId);

      if (!resolvedChainId) {
        throw new Error("No active chain found. Please connect a Polygon wallet.");
      }

      if (!walletProvider) {
        throw new Error("Wallet provider unavailable. Please reconnect your wallet.");
      }

      const message = createSiweMessage({
        address: getAddress(address),
        nonce,
        chainId: resolvedChainId,
        uri: window.location.origin,
        domain: window.location.host,
      });

      const rawSignature = await walletProvider.request({
        method: "personal_sign",
        params: [message, getAddress(address)],
      });

      if (typeof rawSignature !== "string") {
        throw new Error("Wallet did not return a signature.");
      }

      const signature = rawSignature;
      const result = await postSiweVerify(message, signature);

      if (result.ok) {
        markSessionAuthenticated();
      } else {
        setError("Authentication failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Sign-in failed";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = () => {
    resetSession();
    disconnect();
    setError(null);
  };

  const isTestnet = VAULT_NETWORK === "amoy";
  const networkDisplayName = isTestnet ? "Amoy Testnet" : "Polygon Mainnet";
  const networkBadgeClass = isTestnet
    ? "border-amber-400/25 bg-amber-400/12 text-amber-200"
    : "border-emerald-400/25 bg-emerald-400/12 text-emerald-200";

  return (
    <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
      <Badge
        variant="outline"
        className={`hidden gap-1.5 font-normal sm:inline-flex ${networkBadgeClass}`}
        title={
          isTestnet ? "Polymarket trading is disabled on testnet" : "Connected to Polygon Mainnet"
        }
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${isTestnet ? "bg-amber-500" : "bg-emerald-500"}`}
        />
        {networkDisplayName}
      </Badge>

      {error && <span className="animate-pulse text-xs text-rose-300">{error}</span>}

      {isAuthenticated ? (
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-[2px] border border-[#212121] bg-[#121212] px-3 py-2 sm:flex">
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-400/25 bg-emerald-400/5 font-normal text-emerald-200"
            >
              <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-500" />
              Signed in
            </Badge>
            <Separator orientation="vertical" className="h-5 bg-white/10" />
            <span className="font-mono text-sm text-[#E4E4E7]">{truncateAddress(address)}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="rounded-[2px] px-2 text-slate-300 hover:bg-[#212121] hover:text-white sm:px-3"
          >
            <span className="sm:hidden">Exit</span>
            <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      ) : isCheckingSession ? (
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden rounded-[2px] border border-[#212121] bg-[#121212] px-3 py-2 sm:block">
            <span className="font-mono text-sm text-[#E4E4E7]">{truncateAddress(address)}</span>
          </div>
          <Button
            disabled
            size="sm"
            className="min-w-[92px] rounded-[2px] bg-white px-3 text-black hover:bg-white sm:min-w-[120px]"
          >
            <span className="flex items-center gap-2">
              <svg
                className="h-3.5 w-3.5 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Checking...
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="rounded-[2px] px-2 text-slate-300 hover:bg-[#212121] hover:text-white sm:px-3"
          >
            <span className="sm:hidden">Exit</span>
            <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      ) : walletConnected ? (
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden rounded-[2px] border border-[#212121] bg-[#121212] px-3 py-2 sm:block">
            <span className="font-mono text-sm text-[#E4E4E7]">{truncateAddress(address)}</span>
          </div>
          <Button
            onClick={handleSignIn}
            disabled={isLoading}
            size="sm"
            className="min-w-[88px] rounded-[2px] bg-white px-3 text-black hover:bg-white/90 sm:min-w-[120px]"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin h-3.5 w-3.5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Signing...
              </span>
            ) : (
              "Sign In"
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="rounded-[2px] px-2 text-slate-300 hover:bg-[#212121] hover:text-white sm:px-3"
          >
            <span className="sm:hidden">Exit</span>
            <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      ) : (
        <Button
          onClick={() => open()}
          size="sm"
          className="rounded-[2px] bg-white px-3 text-black hover:bg-white/90 sm:px-4"
        >
          <span className="sm:hidden">Connect</span>
          <span className="hidden sm:inline">Connect Wallet</span>
        </Button>
      )}
    </div>
  );
}
