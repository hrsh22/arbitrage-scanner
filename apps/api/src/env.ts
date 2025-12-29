import "dotenv/config";

/**
 * Centralized environment variable management.
 * All env vars should be read through this module.
 */

const numberFromEnv = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringFromEnv = (key: string, fallback: string): string => {
  return process.env[key] ?? fallback;
};

const boolFromEnv = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === "true" || value === "1";
};

export const env = {
  // Server
  HOST: stringFromEnv("HOST", "0.0.0.0"),
  PORT: numberFromEnv("PORT", 8080),

  // Database
  DATABASE_URL: stringFromEnv("DATABASE_URL", ""),

  // Polymarket API
  POLYMARKET_GAMMA_BASE: stringFromEnv("POLYMARKET_GAMMA_BASE", "https://gamma-api.polymarket.com"),
  POLYMARKET_CLOB_BASE: stringFromEnv("POLYMARKET_CLOB_BASE", "https://clob.polymarket.com"),

  // Market fetching
  MAX_EVENTS: numberFromEnv("MAX_EVENTS", 500), // Top N most liquid events to fetch

  // Polling
  POLL_INTERVAL_MS: numberFromEnv("POLL_INTERVAL_MS", 60000), // 60 seconds (processing takes ~50s)
  REQUEST_TIMEOUT_MS: numberFromEnv("REQUEST_TIMEOUT_MS", 10000),
  REQUEST_RETRIES: numberFromEnv("REQUEST_RETRIES", 2),

  // Arbitrage detection
  MIN_LIQUIDITY_USD: numberFromEnv("MIN_LIQUIDITY_USD", 50),
  MIN_PROFIT_PCT: numberFromEnv("MIN_PROFIT_PCT", 0), // Minimum profit % to show (0 = all)
  ENABLE_POLYMARKET_ARBITRAGE: boolFromEnv("ENABLE_POLYMARKET_ARBITRAGE", false), // Toggle Polymarket-only arbitrage
  ENABLE_CROSS_PLATFORM_ARBITRAGE: boolFromEnv("ENABLE_CROSS_PLATFORM_ARBITRAGE", false), // Toggle cross-platform arbitrage

  // AI for exclusivity checking (optional)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null,

  // AI match verification
  AI_MATCH_DAILY_LIMIT: numberFromEnv("AI_MATCH_DAILY_LIMIT", 1000),
  STORE_AI_MATCH_CONTEXT: boolFromEnv("STORE_AI_MATCH_CONTEXT", true), // Store resolution rules in cache

  // Trading Bot
  POLYMARKET_PRIVATE_KEY: process.env.POLYMARKET_PRIVATE_KEY ?? null,
  BOT_MODE: stringFromEnv("BOT_MODE", "simulation") as "simulation" | "live",
} as const;

export type Env = typeof env;
