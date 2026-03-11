/**
 * Withdrawal Repository
 * FIFO queue CRUD for withdrawal requests with strict state machine validation.
 * Supports both legacy Morpho vaults and custom ERC7540 epoch vaults.
 *
 * State Machine - Legacy (Morpho):
 *   pending → ready (via prepare-claim)
 *   pending → cancelled (via cancel)
 *   ready → completed (via claim)
 *   NO backward transitions allowed
 *
 * State Machine - Custom (ERC7540 Epoch):
 *   pending → settled (via epoch settlement)
 *   pending → cancelled (via cancel, before cutoff)
 *   settled → claimed (via claim)
 *   NO backward transitions allowed
 *
 * Dual-vault support during migration:
 * - Legacy vaults use Morpho previewRedeem and instant redemption flow
 * - Custom vaults use epoch-based settlement with pro-rata distribution
 * - Provider abstraction determines vault type at runtime
 */

import { eq, and, asc, desc } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { withdrawalRequests } from "../db/schema.js";
import { logger } from "../logger.js";

type DbClient = typeof defaultDb;

/** Vault type for withdrawal routing */
export type VaultType = "legacy" | "custom";

/** Withdrawal request type */
export type WithdrawalType = "instant" | "epoch";

/** Valid withdrawal request statuses */
export type WithdrawalStatus =
  | "pending"
  | "ready"
  | "settled"
  | "claimed"
  | "cancelled"
  | "completed";

/** Valid state transitions for legacy Morpho vaults */
export const validLegacyTransitions: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  pending: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  settled: [], // Terminal state - no transitions out
  claimed: [], // Terminal state - no transitions out
  cancelled: [], // Terminal state - no transitions out
  completed: [], // Terminal state - no transitions out
};

/** Valid state transitions for custom ERC7540 epoch vaults */
export const validCustomTransitions: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  pending: ["settled", "cancelled"],
  settled: ["claimed"],
  claimed: [], // Terminal state
  cancelled: [], // Terminal state - no transitions out
  ready: [], // Not used in custom vaults
  completed: [], // Not used in custom vaults
};

/** Result of a state transition attempt */
export interface StateTransitionResult {
  success: boolean;
  request?: typeof withdrawalRequests.$inferSelect | null;
  error?: string;
  /** True if the request was already in the target state (idempotent) */
  alreadyInTargetState?: boolean;
}

/** Check if a state transition is valid for vault type */
export function isValidTransition(
  fromStatus: WithdrawalStatus,
  toStatus: WithdrawalStatus,
  vaultType: VaultType = "legacy",
): boolean {
  // Same state is always "valid" for idempotency (caller decides handling)
  if (fromStatus === toStatus) return true;

  const transitions = vaultType === "custom" ? validCustomTransitions : validLegacyTransitions;
  return transitions[fromStatus]?.includes(toStatus) ?? false;
}

/** Get valid transitions for vault type */
export function getValidTransitions(
  vaultType: VaultType = "legacy",
): Record<WithdrawalStatus, WithdrawalStatus[]> {
  return vaultType === "custom" ? validCustomTransitions : validLegacyTransitions;
}

export interface NewWithdrawalRequest {
  requestId: string;
  vaultAddress: string;
  userAddress: string;
  shares: string;
  assetsEstimated: string;
  estimateHistory?: string; // JSON string of EstimateUpdate[]
  /**
   * Withdrawal type determines state machine:
   * - "instant": Legacy Morpho vault, uses ready/completed states
   * - "epoch": Custom vault, uses settled/claimed states
   */
  withdrawalType?: WithdrawalType;
  /** Epoch ID for epoch-based withdrawals (custom vault only) */
  epochId?: string;
  /** On-chain request ID for custom vaults */
  onchainRequestId?: string;
}

export class WithdrawalRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  async createRequest(request: NewWithdrawalRequest) {
    const results = await this.database.insert(withdrawalRequests).values(request).returning();
    return results[0]!;
  }

  /** Get all pending requests for a vault, ordered FIFO (oldest first) */
  async getPendingRequests(vaultAddress?: string, _vaultType?: VaultType) {
    if (vaultAddress) {
      return this.database
        .select()
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.status, "pending"),
            eq(withdrawalRequests.vaultAddress, vaultAddress),
          ),
        )
        .orderBy(asc(withdrawalRequests.requestedAt));
    }

    return this.database
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.status, "pending"))
      .orderBy(asc(withdrawalRequests.requestedAt));
  }

  /** Get the head of the FIFO queue for a vault */
  async getQueueHead(vaultAddress: string) {
    const results = await this.database
      .select()
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.status, "pending"),
          eq(withdrawalRequests.vaultAddress, vaultAddress),
        ),
      )
      .orderBy(asc(withdrawalRequests.requestedAt))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Mark request as ready (legacy vault only).
   * For custom vaults, use markSettled() instead.
   */
  async markReady(requestId: string) {
    const results = await this.database
      .update(withdrawalRequests)
      .set({
        status: "ready" as const,
        readyAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Mark request as settled (custom vault only).
   * Called after epoch settlement completes.
   * NOTE: Requires DB schema migration to add 'settled' status
   */
  async markSettled(requestId: string, claimableAssets: string) {
    // For now, mark as 'ready' since 'settled' is not in the schema enum
    // Full implementation requires schema migration
    const results = await this.database
      .update(withdrawalRequests)
      .set({
        status: "ready" as const, // Using 'ready' as proxy for 'settled'
        assetsEstimated: claimableAssets,
        updatedAt: new Date(),
      })
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Mark request as claimed (custom vault only).
   * Called after user claims their assets.
   * NOTE: Requires DB schema migration to add 'claimed' status
   */
  async markClaimed(requestId: string, txHash?: string, claimedAssets?: string) {
    const updateData: Record<string, unknown> = {
      status: "completed" as const, // Using 'completed' as proxy for 'claimed'
      updatedAt: new Date(),
    };

    if (txHash) {
      updateData.txHash = txHash;
    }
    if (claimedAssets) {
      updateData.assetsEstimated = claimedAssets;
    }

    const results = await this.database
      .update(withdrawalRequests)
      .set(updateData)
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return results[0] ?? null;
  }

  async updateAssetsEstimated(
    requestId: string,
    assetsEstimated: string,
    updateMeta?: {
      timestamp: Date;
      oldValue: number;
      newValue: number;
      reason: string;
      source: string;
    },
  ) {
    // Build update data
    const updateData: Record<string, unknown> = {
      assetsEstimated,
      updatedAt: new Date(),
    };

    // If metadata provided, update estimateHistory
    if (updateMeta) {
      const request = await this.getRequestById(requestId);
      if (request) {
        const historyEntry = {
          timestamp: updateMeta.timestamp.toISOString(),
          oldValue: updateMeta.oldValue,
          newValue: updateMeta.newValue,
          reason: updateMeta.reason,
          source: updateMeta.source,
        };

        // Parse existing history or create new array
        let history: Array<Record<string, unknown>> = [];
        if (request.estimateHistory) {
          try {
            const parsed = JSON.parse(request.estimateHistory as string);
            if (Array.isArray(parsed)) {
              history = parsed;
            }
          } catch {
            // Invalid JSON, start fresh
            history = [];
          }
        }

        history.push(historyEntry);
        updateData.estimateHistory = JSON.stringify(history);
      }
    }

    const results = await this.database
      .update(withdrawalRequests)
      .set(updateData)
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return results[0] ?? null;
  }

  async markCompleted(requestId: string, txHash?: string) {
    const results = await this.database
      .update(withdrawalRequests)
      .set({
        status: "completed" as const,
        completedAt: new Date(),
        txHash: txHash ?? null,
        updatedAt: new Date(),
      })
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Transition a request to a new state with strict validation.
   * This is the core state machine method - all state changes go through here.
   *
   * @param requestId - The withdrawal request ID
   * @param targetStatus - The desired target status
   * @param vaultType - The vault type (determines valid transitions)
   * @returns StateTransitionResult with success flag and metadata
   */
  async transitionState(
    requestId: string,
    targetStatus: WithdrawalStatus,
    vaultType: VaultType = "legacy",
  ): Promise<StateTransitionResult> {
    const request = await this.getRequestById(requestId);

    if (!request) {
      return {
        success: false,
        error: "Withdrawal request not found",
      };
    }

    const currentStatus = request.status as WithdrawalStatus;

    // Idempotency: already in target state
    if (currentStatus === targetStatus) {
      return {
        success: true,
        request,
        alreadyInTargetState: true,
      };
    }

    // Validate transition
    if (!isValidTransition(currentStatus, targetStatus, vaultType)) {
      return {
        success: false,
        request,
        error: `Invalid state transition: '${currentStatus}' → '${targetStatus}' for ${vaultType} vault`,
      };
    }

    // Build update data based on target status
    const updateData: Record<string, unknown> = {
      status: targetStatus,
      updatedAt: new Date(),
    };

    // Set timestamp fields based on target status
    if (targetStatus === "ready") {
      updateData.readyAt = new Date();
    } else if (targetStatus === "completed") {
      updateData.completedAt = new Date();
    } else if (targetStatus === "settled") {
      // Custom vault: record settlement timestamp
      updateData.readyAt = new Date();
    } else if (targetStatus === "claimed") {
      // Custom vault: record claim timestamp
      updateData.completedAt = new Date();
    }
    // cancelled doesn't have a timestamp field

    const results = await this.database
      .update(withdrawalRequests)
      .set(updateData)
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return {
      success: true,
      request: results[0] ?? null,
      alreadyInTargetState: false,
    };
  }

  /**
   * Idempotent cancel operation.
   * Returns success if already cancelled (no side effects).
   * Returns error if transitioning from invalid state (e.g., completed).
   */
  async markCancelledIdempotent(
    requestId: string,
    vaultType: VaultType = "legacy",
  ): Promise<StateTransitionResult> {
    return this.transitionState(requestId, "cancelled", vaultType);
  }

  /**
   * Idempotent mark-ready operation (legacy vault only).
   */
  async markReadyIdempotent(requestId: string): Promise<StateTransitionResult> {
    return this.transitionState(requestId, "ready", "legacy");
  }

  /**
   * Idempotent mark-settled operation (custom vault only).
   * Called after epoch settlement.
   */
  async markSettledIdempotent(requestId: string): Promise<StateTransitionResult> {
    return this.transitionState(requestId, "settled", "custom");
  }

  /**
   * Idempotent mark-claimed operation (custom vault only).
   * Called after user claims.
   */
  async markClaimedIdempotent(requestId: string, txHash?: string): Promise<StateTransitionResult> {
    const result = await this.transitionState(requestId, "claimed", "custom");

    // If successful and txHash provided, update it
    if (result.success && txHash && result.request) {
      const results = await this.database
        .update(withdrawalRequests)
        .set({ txHash })
        .where(eq(withdrawalRequests.requestId, requestId))
        .returning();

      return {
        ...result,
        request: results[0] ?? result.request,
      };
    }

    return result;
  }

  /**
   * Idempotent mark-completed operation (legacy vault only).
   */
  async markCompletedIdempotent(
    requestId: string,
    txHash?: string,
  ): Promise<StateTransitionResult> {
    const result = await this.transitionState(requestId, "completed", "legacy");

    // If successful and txHash provided, update it
    if (result.success && txHash && result.request) {
      const results = await this.database
        .update(withdrawalRequests)
        .set({ txHash })
        .where(eq(withdrawalRequests.requestId, requestId))
        .returning();

      return {
        ...result,
        request: results[0] ?? result.request,
      };
    }

    return result;
  }

  /** Legacy method: Use markCancelledIdempotent for new code */
  async markCancelled(requestId: string) {
    const results = await this.database
      .update(withdrawalRequests)
      .set({
        status: "cancelled" as const,
        updatedAt: new Date(),
      })
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return results[0] ?? null;
  }

  /** Get all requests for a user, newest first */
  async getRequestsByUser(userAddress: string, vaultAddress?: string) {
    if (vaultAddress) {
      return this.database
        .select()
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.userAddress, userAddress),
            eq(withdrawalRequests.vaultAddress, vaultAddress),
          ),
        )
        .orderBy(desc(withdrawalRequests.requestedAt));
    }

    return this.database
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.userAddress, userAddress))
      .orderBy(desc(withdrawalRequests.requestedAt));
  }

  async getRequestById(requestId: string) {
    const results = await this.database
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.requestId, requestId))
      .limit(1);

    return results[0] ?? null;
  }

  /** Get all "ready" requests (legacy vault users can redeem) */
  async getReadyRequests(vaultAddress?: string) {
    if (vaultAddress) {
      return this.database
        .select()
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.status, "ready"),
            eq(withdrawalRequests.vaultAddress, vaultAddress),
          ),
        )
        .orderBy(asc(withdrawalRequests.requestedAt));
    }

    return this.database
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.status, "ready"))
      .orderBy(asc(withdrawalRequests.requestedAt));
  }

  /**
   * Get all "settled" requests (custom vault users can claim)
   * NOTE: Returns 'ready' requests as proxy since 'settled' not in schema yet
   */
  async getSettledRequests(vaultAddress?: string) {
    if (vaultAddress) {
      return this.database
        .select()
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.status, "ready"), // Using 'ready' as proxy for 'settled'
            eq(withdrawalRequests.vaultAddress, vaultAddress),
          ),
        )
        .orderBy(asc(withdrawalRequests.requestedAt));
    }

    return this.database
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.status, "ready")) // Using 'ready' as proxy for 'settled'
      .orderBy(asc(withdrawalRequests.requestedAt));
  }

  /**
   * Reconcile withdrawal state with epoch request state.
   * Syncs legacy withdrawalRequests with custom vault epoch_requests.
   *
   * NOTE: This is a stub implementation. Full implementation requires:
   * - DB migration to add withdrawalType and onchainRequestId columns
   * - Update to withdrawalRequests schema to support 'settled' and 'claimed' statuses
   *
   * @param vaultAddress - The vault address to reconcile
   * @returns Reconciliation result summary
   */
  async reconcileWithEpochRequests(vaultAddress: string): Promise<{
    synced: number;
    mismatches: Array<{
      requestId: string;
      withdrawalStatus: string;
      epochStatus: string;
    }>;
    errors: string[];
  }> {
    const mismatches: Array<{
      requestId: string;
      withdrawalStatus: string;
      epochStatus: string;
    }> = [];
    const errors: string[] = [];
    let synced = 0;

    logger.debug("WithdrawalRepository: reconcileWithEpochRequests called (stub)", {
      vaultAddress,
      note: "Full implementation requires DB schema migration",
    });

    // Stub implementation - return empty results
    // Full implementation requires:
    // 1. Add withdrawalType enum column to withdrawal_requests table
    // 2. Add onchainRequestId string column to withdrawal_requests table
    // 3. Add 'settled' and 'claimed' to withdrawal_requests status enum
    // 4. Query withdrawalRequests by withdrawalType = 'epoch'
    // 5. Join with epoch_requests table via onchainRequestId
    // 6. Sync status between tables

    return { synced, mismatches, errors };
  }
}

export const withdrawalRepository = new WithdrawalRepository();
