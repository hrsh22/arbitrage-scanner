import "dotenv/config";
import type { NetworkType } from "@workspace/network-config";
import {
  getDefaultRpcUrl,
  getChainId,
  getUsdcAddress,
  getFallbackRpcUrls,
  getBlockExplorerUrl,
} from "@workspace/network-config";

const requiredString = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optionalString = (key: string, fallback: string): string => {
  return process.env[key] ?? fallback;
};

const optionalNumber = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const optionalBool = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === "true" || value === "1";
};

const parseNetwork = (value: string | undefined): NetworkType => {
  if (value === "testnet") return "testnet";
  return "mainnet";
};

const NETWORK: NetworkType = parseNetwork(process.env.NETWORK);

export const env = {
  NETWORK,

  HOST: optionalString("HOST", "0.0.0.0"),
  PORT: optionalNumber("PORT", 8081),

  VAULT_DATABASE_URL: requiredString("VAULT_DATABASE_URL"),

  POLYGON_RPC_URL: optionalString("POLYGON_RPC_URL", getDefaultRpcUrl(NETWORK)),

  TRADING_WALLET_PRIVATE_KEY: optionalString("TRADING_WALLET_PRIVATE_KEY", ""),

  MIN_DEPOSIT_USDC: optionalNumber("MIN_DEPOSIT_USDC", 10),
  WITHDRAWAL_LOCK_DAYS: optionalNumber("WITHDRAWAL_LOCK_DAYS", 7),

  CLAIM_SIG_TTL_SECONDS: optionalNumber("CLAIM_SIG_TTL_SECONDS", 10 * 60),

  DEPOSITS_ENABLED: optionalBool("DEPOSITS_ENABLED", true),
  WITHDRAWALS_ENABLED: optionalBool("WITHDRAWALS_ENABLED", true),

  ALCHEMY_WEBHOOK_SECRET: optionalString("ALCHEMY_WEBHOOK_SECRET", ""),

  ADMIN_WALLET_ALLOWLIST: optionalString("ADMIN_WALLET_ALLOWLIST", ""),
} as const;

export type Env = typeof env;

export const getRpcUrl = (): string => env.POLYGON_RPC_URL;

export const hasTradingWallet = (): boolean => env.TRADING_WALLET_PRIVATE_KEY !== "";

export const hasAlchemyWebhook = (): boolean => env.ALCHEMY_WEBHOOK_SECRET !== "";

export const getNetwork = (): NetworkType => env.NETWORK;

export const getChainIdForNetwork = (): number => getChainId(env.NETWORK);

export const getUsdcAddressForNetwork = (): `0x${string}` => getUsdcAddress(env.NETWORK);

export const getFallbackRpcUrlsForNetwork = (): string[] => getFallbackRpcUrls(env.NETWORK);

export const getBlockExplorerUrlForNetwork = (): string => getBlockExplorerUrl(env.NETWORK);

export const isTestnet = (): boolean => env.NETWORK === "testnet";
