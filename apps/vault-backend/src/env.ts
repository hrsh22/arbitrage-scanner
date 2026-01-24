import "dotenv/config";

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

export const env = {
  HOST: optionalString("HOST", "0.0.0.0"),
  PORT: optionalNumber("PORT", 8081),

  VAULT_DATABASE_URL: requiredString("VAULT_DATABASE_URL"),

  POLYGON_RPC_URL: optionalString("POLYGON_RPC_URL", "https://polygon-rpc.com"),

  TRADING_WALLET_PRIVATE_KEY: optionalString("TRADING_WALLET_PRIVATE_KEY", ""),

  MIN_DEPOSIT_USDC: optionalNumber("MIN_DEPOSIT_USDC", 10),

  DEPOSITS_ENABLED: optionalBool("DEPOSITS_ENABLED", true),
  WITHDRAWALS_ENABLED: optionalBool("WITHDRAWALS_ENABLED", true),

  ALCHEMY_WEBHOOK_SECRET: optionalString("ALCHEMY_WEBHOOK_SECRET", ""),
} as const;

export type Env = typeof env;

export const getRpcUrl = (): string => env.POLYGON_RPC_URL;

export const hasTradingWallet = (): boolean => env.TRADING_WALLET_PRIVATE_KEY !== "";

export const hasAlchemyWebhook = (): boolean => env.ALCHEMY_WEBHOOK_SECRET !== "";
