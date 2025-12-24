import { env } from "./env.js";

/**
 * Application configuration derived from environment variables.
 * Use this for computed/structured config values.
 */
export const config = {
  // Server
  host: env.HOST,
  port: env.PORT,

  // Polymarket API
  gammaBaseUrl: env.POLYMARKET_GAMMA_BASE,
  clobBaseUrl: env.POLYMARKET_CLOB_BASE,

  // Market fetching - top N most liquid events
  maxEvents: env.MAX_EVENTS,

  // Polling
  pollIntervalMs: env.POLL_INTERVAL_MS,
  requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  requestRetries: env.REQUEST_RETRIES,

  // Arbitrage detection thresholds
  minLiquidityUsd: env.MIN_LIQUIDITY_USD,
  minProfitPct: env.MIN_PROFIT_PCT,
} as const;

export type AppConfig = typeof config;
