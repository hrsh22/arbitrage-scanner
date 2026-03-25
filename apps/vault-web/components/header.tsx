"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Separator } from "@workspace/ui/components/separator";
import { fetchSiweNonce, postSiweVerify, fetchAuthMe } from "../src/lib/api";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
  useAppKitProvider,
  useDisconnect,
} from "@reown/appkit/react";
import { getAddress } from "viem";
import { VAULT_NETWORK } from "../src/constants";

interface HeaderProps {
  className?: string;
}

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

export function Header({ className }: HeaderProps) {
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();
  const pathname = usePathname();
  const isHomePage = pathname === '/';

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore auth session on mount
  useEffect(() => {
    if (isConnected && address) {
      fetchAuthMe()
        .then((result) => {
          const matchesWallet =
            !result.address || result.address.toLowerCase() === address.toLowerCase();
          setIsAuthenticated(result.authenticated && matchesWallet);
        })
        .catch(() => {
          setIsAuthenticated(false);
        });
      return;
    }

    setIsAuthenticated(false);
  }, [isConnected, address]);

  // Clear auth state on disconnect
  useEffect(() => {
    if (!isConnected) {
      setIsAuthenticated(false);
      setError(null);
    }
  }, [isConnected]);

  const handleSignIn = async () => {
    if (!address) return;

    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch nonce from backend
      const { nonce } = await fetchSiweNonce();
      const resolvedChainId = normalizeChainId(chainId);

      if (!resolvedChainId) {
        throw new Error("No active chain found. Please connect a Polygon wallet.");
      }

      if (!walletProvider) {
        throw new Error("Wallet provider unavailable. Please reconnect your wallet.");
      }

      // 2. Construct SIWE message
      const message = createSiweMessage({
        address: getAddress(address),
        nonce,
        chainId: resolvedChainId,
        uri: window.location.origin,
        domain: window.location.host,
      });

      // 3. Sign message with wallet
      const rawSignature = await walletProvider.request({
        method: "personal_sign",
        params: [message, getAddress(address)],
      });

      if (typeof rawSignature !== "string") {
        throw new Error("Wallet did not return a signature.");
      }

      const signature = rawSignature;

      // 4. Verify with backend
      const result = await postSiweVerify(message, signature);

      if (result.ok) {
        setIsAuthenticated(true);
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
    disconnect();
    setIsAuthenticated(false);
    setError(null);
  };

  // Network indicator configuration
  const isTestnet = VAULT_NETWORK === "amoy";
  const networkDisplayName = isTestnet ? "Amoy Testnet" : "Polygon Mainnet";
  const networkBadgeClass = isTestnet
    ? "border-amber-400/25 bg-amber-400/12 text-amber-200"
    : "border-emerald-400/25 bg-emerald-400/12 text-emerald-200";

  return (
    <header
      className={`z-50 w-full shrink-0 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl supports-[backdrop-filter]:bg-slate-950/80 ${className ?? ""}`}
    >
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="group flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-[2px] border border-[#656565] bg-[#121212] shadow-[0_0_15px_rgba(255,255,255,0.05)] transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.08)]">
              <div className="absolute inset-1 rounded-[1px] bg-gradient-to-br from-white/10 to-transparent" />
              <div className="z-10 flex flex-col items-center gap-0.5">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-[1px] bg-white" />
                  <div className="h-1.5 w-1.5 rounded-[1px] bg-white" />
                </div>
                <div className="h-3 w-4 rounded-[1px] border border-white/80" />
              </div>
            </div>
            <div className="space-y-0.5">
              <span className="block text-sm font-semibold uppercase tracking-[0.24em] text-white">
                Polymarket Vault
              </span>
              <span className="block text-xs text-slate-400">
                Prediction Market Vaults
              </span>
            </div>
          </Link>

          <div className="ml-4 mr-2 hidden h-8 w-[1px] bg-white/10 md:block" />

          <nav className="hidden md:flex items-center">
            <Link
              href="/discover"
              className="rounded-[2px] border border-[#212121] bg-transparent px-4 py-1.5 text-sm font-medium text-[#828B8D] transition-colors hover:bg-[#121212] hover:text-white"
            >
              Discover Vaults
            </Link>
          </nav>
        </div>

        {!isHomePage && (
          <div className="flex items-center gap-2 sm:gap-3">
            <Badge
              variant="outline"
              className={`gap-1.5 font-normal ${networkBadgeClass}`}
              title={
                isTestnet
                  ? "Polymarket trading is disabled on testnet"
                  : "Connected to Polygon Mainnet"
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isTestnet ? "bg-amber-500" : "bg-emerald-500"}`}
              />
              {networkDisplayName}
            </Badge>

            {error && <span className="animate-pulse text-xs text-rose-300">{error}</span>}

            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-[2px] border border-[#212121] bg-[#121212] px-3 py-2">
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
                  className="rounded-[10px] text-slate-300 hover:bg-[#212121] hover:text-white"
                >
                  Disconnect
                </Button>
              </div>
            ) : isConnected ? (
              <div className="flex items-center gap-3">
                <div className="hidden rounded-[2px] border border-[#212121] bg-[#121212] px-3 py-2 sm:block">
                  <span className="font-mono text-sm text-[#E4E4E7]">{truncateAddress(address)}</span>
                </div>
                <Button
                  onClick={handleSignIn}
                  disabled={isLoading}
                  size="sm"
                  className="min-w-[120px] rounded-[10px] bg-white text-black hover:bg-white/90"
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
                  className="rounded-[10px] text-slate-300 hover:bg-[#212121] hover:text-white"
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => open()}
                size="sm"
                className="rounded-[10px] bg-white text-black hover:bg-white/90"
              >
                Connect Wallet
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
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
