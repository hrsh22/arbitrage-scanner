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
  const pathname = usePathname();
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore auth session on mount
  useEffect(() => {
    if (isConnected && address && !isAuthenticated) {
      fetchAuthMe()
        .then((result) => {
          if (result.authenticated) {
            setIsAuthenticated(true);
          }
        })
        .catch(() => {
          // Session expired or not found — user will need to sign in again
        });
    }
  }, [isConnected, address, isAuthenticated]);

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

  const isVaultsActive = pathname === "/";

  // Network indicator configuration
  const isTestnet = VAULT_NETWORK === "amoy";
  const networkDisplayName = isTestnet ? "Amoy Testnet" : "Polygon Mainnet";
  const networkBadgeClass = isTestnet
    ? "border-amber-500/30 bg-amber-50 text-amber-700"
    : "border-emerald-500/30 bg-emerald-50 text-emerald-700";

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 ${className ?? ""}`}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center gap-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/15">
              {/* Vault icon - CSS-based */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                  <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                </div>
                <div className="h-3 w-4 rounded-sm border border-primary/80" />
              </div>
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground">Vault</span>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isVaultsActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              Vaults
            </Link>
          </nav>
        </div>

        {/* Right: Auth + Wallet + Network */}
        <div className="flex items-center gap-3">
          {/* Network Indicator */}
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

          {/* Error display */}
          {error && <span className="text-xs text-destructive animate-pulse">{error}</span>}

          {/* Auth State Machine */}
          {isAuthenticated ? (
            /* Authenticated: Green indicator + Address + Disconnect */
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 gap-1.5 font-normal"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Authenticated
                </Badge>
                <Separator orientation="vertical" className="h-5" />
                <span className="font-mono text-sm text-muted-foreground">
                  {truncateAddress(address)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="text-muted-foreground hover:text-foreground"
              >
                Disconnect
              </Button>
            </div>
          ) : isConnected ? (
            /* Connected but not authenticated: Sign In + Address */
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-muted-foreground">
                {truncateAddress(address)}
              </span>
              <Separator orientation="vertical" className="h-5" />
              <Button
                onClick={handleSignIn}
                disabled={isLoading}
                size="sm"
                className="min-w-[120px]"
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
                className="text-muted-foreground hover:text-foreground"
              >
                Disconnect
              </Button>
            </div>
          ) : (
            /* Disconnected: Connect Wallet */
            <Button onClick={() => open()} size="sm">
              Connect Wallet
            </Button>
          )}
        </div>
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
