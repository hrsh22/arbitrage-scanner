import { env } from "../env.js";

export interface VaultConfig {
  withdrawalLockDays: number;
  minDepositUsdc: number;
  maxPositionPct: number;
  minIdleReservePct: number;
  navUpdateIntervalMinutes: number;
  resolutionCheckIntervalMinutes: number;
  withdrawalPollIntervalMinutes: number;
}

const config: VaultConfig = {
  /**
   * Number of days before ANY withdrawal becomes claimable.
   * Nothing is claimable before this period (neither resolved positions nor idle USDC).
   * After this period, all resolved positions + idle USDC become claimable at once.
   * Default: 7 days
   */
  withdrawalLockDays: Math.max(0, env.WITHDRAWAL_LOCK_DAYS),

  /**
   * Minimum deposit amount in USDC (whole dollars).
   * Default: 10 USDC
   */
  minDepositUsdc: 10,

  /**
   * Maximum percentage of vault assets in a single position.
   * Prevents over-concentration. Default: 10%
   */
  maxPositionPct: 10,

  /**
   * Minimum percentage of vault assets to keep as idle USDC.
   * Ensures liquidity for withdrawals. Default: 20%
   */
  minIdleReservePct: 20,

  /**
   * How often to update NAV (in minutes).
   * Default: 60 minutes
   */
  navUpdateIntervalMinutes: 60,

  /**
   * How often to check for position resolutions (in minutes).
   * Default: 15 minutes
   */
  resolutionCheckIntervalMinutes: 15,

  /**
   * How often to poll for withdrawal events (in minutes).
   * Withdrawals use polling instead of webhooks since they have a 7-day lock anyway.
   * Default: 5 minutes
   */
  withdrawalPollIntervalMinutes: 5,
};

export function getVaultConfig(): VaultConfig {
  return { ...config };
}

export function getWithdrawalLockMs(): number {
  return config.withdrawalLockDays * 24 * 60 * 60 * 1000;
}

export function getClaimableAfter(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + getWithdrawalLockMs());
}

export function isClaimable(requestedAt: Date): boolean {
  return new Date() >= getClaimableAfter(requestedAt);
}

export default config;
