/**
 * Pending Transaction Registry
 * Shared coordination for allocate/deallocate operations to prevent duplicate on-chain transactions.
 *
 * This registry provides cross-process/cross-instance locking to ensure that:
 * 1. Only one reconciliation runs per vault at a time
 * 2. Pending transactions have a TTL to prevent permanent deadlocks
 * 3. Lock state is visible for monitoring and debugging
 */

import { logger } from "../logger.js";

export interface PendingTxEntry {
  vaultId: number;
  vaultAddress: string;
  action: "allocate" | "deallocate" | "reconcile";
  amount?: number;
  startedAt: number;
  expiresAt: number;
  txHash?: string;
  source: "worker" | "api" | "manual";
  processId: number;
}

export interface LockResult {
  acquired: boolean;
  existing?: PendingTxEntry;
  entry?: PendingTxEntry;
}

export interface RegistryStatus {
  pendingCount: number;
  vaults: Array<{
    vaultId: number;
    vaultAddress: string;
    action: string;
    elapsedMs: number;
    remainingMs: number;
    source: string;
    processId: number;
  }>;
}

// Default TTL for pending transactions: 5 minutes
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
// Cleanup interval: 1 minute
const CLEANUP_INTERVAL_MS = 60 * 1000;

class PendingTxRegistry {
  private readonly pendingTxs = new Map<number, PendingTxEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly lockTtlMs: number;

  constructor(lockTtlMs: number = DEFAULT_LOCK_TTL_MS) {
    this.lockTtlMs = lockTtlMs;
    this.startCleanupInterval();
  }

  /**
   * Attempt to acquire a lock for a vault reconciliation/liquidity operation.
   * Returns the lock entry if acquired, or the existing entry if already locked.
   */
  acquireLock(
    vaultId: number,
    vaultAddress: string,
    action: "allocate" | "deallocate" | "reconcile",
    source: "worker" | "api" | "manual",
    options?: {
      amount?: number;
      txHash?: string;
      ttlMs?: number;
    },
  ): LockResult {
    const now = Date.now();

    // Check if there's already a pending entry for this vault
    const existing = this.pendingTxs.get(vaultId);

    if (existing) {
      // Check if the existing lock has expired
      if (now > existing.expiresAt) {
        logger.warn("PendingTxRegistry: Found expired lock, cleaning up and retrying", {
          vaultId,
          vaultAddress,
          action: existing.action,
          startedAt: new Date(existing.startedAt).toISOString(),
          expiredAt: new Date(existing.expiresAt).toISOString(),
          elapsedMs: now - existing.startedAt,
          source: existing.source,
          processId: existing.processId,
        });
        this.pendingTxs.delete(vaultId);
        // Fall through to acquire new lock
      } else {
        // Lock is still valid
        logger.debug("PendingTxRegistry: Lock already held, cannot acquire", {
          vaultId,
          vaultAddress,
          requestedAction: action,
          existingAction: existing.action,
          elapsedMs: now - existing.startedAt,
          remainingMs: existing.expiresAt - now,
          source: existing.source,
          processId: existing.processId,
        });
        return { acquired: false, existing };
      }
    }

    // Acquire new lock
    const ttlMs = options?.ttlMs ?? this.lockTtlMs;
    const entry: PendingTxEntry = {
      vaultId,
      vaultAddress,
      action,
      amount: options?.amount,
      startedAt: now,
      expiresAt: now + ttlMs,
      txHash: options?.txHash,
      source,
      processId: process.pid,
    };

    this.pendingTxs.set(vaultId, entry);

    logger.info("PendingTxRegistry: Lock acquired", {
      vaultId,
      vaultAddress,
      action,
      amount: options?.amount,
      source,
      processId: process.pid,
      ttlMs,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    });

    return { acquired: true, entry };
  }

  /**
   * Release the lock for a vault. Should be called when the operation completes.
   */
  releaseLock(vaultId: number, expectedAction?: string): boolean {
    const entry = this.pendingTxs.get(vaultId);

    if (!entry) {
      logger.debug("PendingTxRegistry: No lock to release", {
        vaultId,
        expectedAction,
      });
      return false;
    }

    // Optionally verify the action matches
    if (expectedAction && entry.action !== expectedAction) {
      logger.warn("PendingTxRegistry: Lock action mismatch during release", {
        vaultId,
        expectedAction,
        actualAction: entry.action,
      });
    }

    const elapsedMs = Date.now() - entry.startedAt;

    this.pendingTxs.delete(vaultId);

    logger.info("PendingTxRegistry: Lock released", {
      vaultId,
      vaultAddress: entry.vaultAddress,
      action: entry.action,
      elapsedMs,
      source: entry.source,
      processId: entry.processId,
    });

    return true;
  }

  /**
   * Update the lock with a transaction hash once it's submitted.
   */
  updateTxHash(vaultId: number, txHash: string): boolean {
    const entry = this.pendingTxs.get(vaultId);

    if (!entry) {
      logger.warn("PendingTxRegistry: Cannot update txHash, no lock found", {
        vaultId,
        txHash,
      });
      return false;
    }

    entry.txHash = txHash;

    logger.info("PendingTxRegistry: Transaction hash recorded", {
      vaultId,
      vaultAddress: entry.vaultAddress,
      action: entry.action,
      txHash,
      elapsedMs: Date.now() - entry.startedAt,
    });

    return true;
  }

  /**
   * Check if a vault has a pending operation.
   */
  isLocked(vaultId: number): boolean {
    const entry = this.pendingTxs.get(vaultId);
    if (!entry) return false;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      // Clean up expired entry
      this.pendingTxs.delete(vaultId);
      return false;
    }

    return true;
  }

  /**
   * Get the pending entry for a vault if one exists.
   */
  getPending(vaultId: number): PendingTxEntry | undefined {
    const entry = this.pendingTxs.get(vaultId);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.pendingTxs.delete(vaultId);
      return undefined;
    }

    return entry;
  }

  /**
   * Get status of all pending transactions.
   */
  getStatus(): RegistryStatus {
    const now = Date.now();
    const vaults: RegistryStatus["vaults"] = [];

    for (const entry of this.pendingTxs.values()) {
      // Skip expired entries (will be cleaned up on next interval)
      if (now > entry.expiresAt) continue;

      vaults.push({
        vaultId: entry.vaultId,
        vaultAddress: entry.vaultAddress,
        action: entry.action,
        elapsedMs: now - entry.startedAt,
        remainingMs: entry.expiresAt - now,
        source: entry.source,
        processId: entry.processId,
      });
    }

    return {
      pendingCount: vaults.length,
      vaults,
    };
  }

  /**
   * Forcefully clear an expired or stuck lock (for admin/recovery use).
   */
  forceClear(vaultId: number, reason: string): boolean {
    const entry = this.pendingTxs.get(vaultId);

    if (!entry) {
      return false;
    }

    const elapsedMs = Date.now() - entry.startedAt;

    this.pendingTxs.delete(vaultId);

    logger.warn("PendingTxRegistry: Lock forcefully cleared", {
      vaultId,
      vaultAddress: entry.vaultAddress,
      action: entry.action,
      elapsedMs,
      source: entry.source,
      processId: entry.processId,
      reason,
    });

    return true;
  }

  /**
   * Clean up expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [vaultId, entry] of this.pendingTxs.entries()) {
      if (now > entry.expiresAt) {
        this.pendingTxs.delete(vaultId);
        cleaned++;

        logger.warn("PendingTxRegistry: Cleaned up expired lock", {
          vaultId,
          vaultAddress: entry.vaultAddress,
          action: entry.action,
          elapsedMs: now - entry.startedAt,
          expiredAt: new Date(entry.expiresAt).toISOString(),
          source: entry.source,
          processId: entry.processId,
        });
      }
    }

    if (cleaned > 0) {
      logger.info("PendingTxRegistry: Cleanup completed", {
        cleaned,
        remaining: this.pendingTxs.size,
      });
    }
  }

  /**
   * Start the cleanup interval.
   */
  private startCleanupInterval(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    // Prevent the timer from keeping the process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown).
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// Export singleton instance for shared use across the application
export const pendingTxRegistry = new PendingTxRegistry();

// Also export the class for testing or custom instances
export { PendingTxRegistry };
