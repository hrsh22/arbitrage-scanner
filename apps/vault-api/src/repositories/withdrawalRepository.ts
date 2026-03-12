/**
 * Withdrawal Repository
 * FIFO queue CRUD for withdrawal requests with strict state machine validation.
 * Supports both legacy Morpho vaults and closed-book batch vaults.
 *
 * State Machine - Legacy (Morpho):
 *   pending → ready (via prepare-claim)
 *   pending → cancelled (via cancel)
 *   ready → completed (via claim)
 *   NO backward transitions allowed
 *
 * State Machine - Closed-Book Batch (Custom ERC7540):
 *   open → cutoff (first request seals the batch)
 *   cutoff → flattening → settling → settled → closed → reopen
 *   Cancellation IMPOSSIBLE after cutoff
 *   NO backward transitions allowed
 *
 * CANCELLATION RULE (Closed-Book Batch):
 *   - Cancellation ONLY possible in OPEN state (before batch is sealed)
 *   - Once CUTOFF is reached, cancellation is IMPOSSIBLE
 *   - Requests are irreversible once the batch is sealed
 *
 * Dual-vault support during migration:
 * - Legacy vaults use Morpho previewRedeem and instant redemption flow
 * - Closed-book batch vaults use event-driven settlement (flat-then-process)
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
export type WithdrawalType = "instant" | "batch";

/** Valid withdrawal request statuses */
export type WithdrawalStatus =
  | "pending"
  | "ready"
  | "settled"
  | "claimed"
  | "cancelled"
  | "completed"
  // Closed-book batch states
  | "open"
  | "cutoff"
  | "flattening"
  | "settling"
  | "closed"
  | "reopen";

/** Valid state transitions for legacy Morpho vaults */
export const validLegacyTransitions: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  pending: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  settled: [], // Terminal state - no transitions out
  claimed: [], // Terminal state - no transitions out
  cancelled: [], // Terminal state - no transitions out
  completed: [], // Terminal state - no transitions out
  // Closed-book batch states not used in legacy vaults
  open: [],
  cutoff: [],
  flattening: [],
  settling: [],
  closed: [],
  reopen: [],
};

/** Valid state transitions for closed-book batch vaults (sealed processing) */
export const validCustomTransitions: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  // OPEN: Accepting requests, cancellation allowed (sealed processing entry point)
  open: ["cutoff", "cancelled"],
  // CUTOFF: Batch sealed, no cancellation possible (sealed)
  cutoff: ["flattening"],
  // FLATTENING: Positions being flattened (sealed)
  flattening: ["settling"],
  // SETTLING: Calculating entitlements (sealed)
  settling: ["settled"],
  // SETTLED: Ready for claims (sealed, claimable)
  settled: ["claimed"],
  // CLAIMED: Terminal state (sealed, completed)
  claimed: [],
  // CANCELLED: Terminal state (only from OPEN)
  cancelled: [],
  // CLOSED: All claims processed
  closed: ["reopen"],
  // REOPEN: Ready for next batch (terminal for previous batch)
  reopen: [],
  // Legacy states not used in closed-book batch vaults
  pending: [],
  ready: [],
  completed: [],
};


/** Result of a state transition attempt */
export interface StateTransitionResult {
  success: boolean;
  request?: typeof withdrawalRequests.$inferSelect | null;
  error?: string;
  /** True if the request was already in the target state (idempotent) */
  alreadyInTargetState?: boolean;
  /** True if cancellation was rejected due to batch already being sealed */
  cancellationRejected?: boolean;
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
   * - "batch": Closed-book batch vault, uses open/cutoff/settled/claimed states
   */
  withdrawalType?: WithdrawalType;
  /** Epoch/batch ID for closed-book batch withdrawals (custom vault only) */
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


  async markSettled(requestId: string, claimableAssets: string) {
    const results = await this.database
      .update(withdrawalRequests)
      .set({
        status: "settled" as const, // Truthful status for sealed processing
        assetsEstimated: claimableAssets,
        updatedAt: new Date(),
      })
      .where(eq(withdrawalRequests.requestId, requestId))
      .returning();

    return results[0] ?? null;
  }


  /**
   * Mark request as claimed (closed-book batch vault only).
   * Called after user claims their assets.
   */
  async markClaimed(requestId: string, txHash?: string, claimedAssets?: string) {
    const updateData: Record<string, unknown> = {
      status: "claimed" as const, // Truthful status for sealed processing
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
   * CLOSED-BOOK BATCH SEMANTICS (Sealed Processing):
   * - Cancellation IMPOSSIBLE after batch is sealed (cutoff)
   * - State flow: open → cutoff → flattening → settling → settled → claimed
   * - Uses truthful 'settled' and 'claimed' statuses (no proxy mapping)
   *
   * LEGACY MORPHO SEMANTICS:
   * - State flow: pending → ready → completed
   *
   * CANCELLATION RULE (Closed-Book Batch):
   * - Cancellation only allowed from OPEN state
   * - Once batch is sealed (CUTOFF or later), cancellation is REJECTED
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

    // CLOSED-BOOK BATCH: Enforce cancellation rule
    // Cancellation is IMPOSSIBLE after CUTOFF
    if (targetStatus === "cancelled" && vaultType === "custom") {
      const cancellableStates: WithdrawalStatus[] = ["open"];
      if (!cancellableStates.includes(currentStatus)) {
        return {
          success: false,
          request,
          error:
            `Cancellation IMPOSSIBLE: Batch is already sealed (current state: ${currentStatus}). ` +
            `Cancellation is only allowed in OPEN state before the first request seals the batch.`,
          cancellationRejected: true,
        };
      }
    }

    // Validate transition
    if (!isValidTransition(currentStatus, targetStatus, vaultType)) {
      return {
        success: false,
        request,
        error: `Invalid state transition: '${currentStatus}' → '${targetStatus}' for ${vaultType} vault`,
      };
    }

    // Build update data based on target status (truthful sealed processing)
    const updateData: Record<string, unknown> = {
      status: targetStatus,
      updatedAt: new Date(),
    };

    // Set timestamp fields based on target status
    // CLOSED-BOOK BATCH: Uses truthful 'settled' and 'claimed' statuses
    if (targetStatus === "ready" || targetStatus === "settled") {
      updateData.readyAt = new Date(); // Settlement complete, ready for claim
    } else if (targetStatus === "completed" || targetStatus === "claimed") {
      updateData.completedAt = new Date(); // User has claimed assets
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
   *
   * CLOSED-BOOK BATCH CANCELLATION RULE:
   * - Cancellation only possible in OPEN state (before batch is sealed)
   * - Returns error if batch is already sealed (CUTOFF or later states)
   *
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
   * Idempotent mark-settled operation (closed-book batch vault only).
   * Called after batch settlement completes.
   */
  async markSettledIdempotent(requestId: string): Promise<StateTransitionResult> {
    return this.transitionState(requestId, "settled", "custom");
  }

  /**
   * Idempotent mark-claimed operation (closed-book batch vault only).
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
   * Get all "settled" requests (closed-book batch vault users can claim)
   * Uses truthful 'settled' status for sealed processing.
   */
  async getSettledRequests(vaultAddress?: string) {
    if (vaultAddress) {
      return this.database
        .select()
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.status, "settled"), // Truthful status
            eq(withdrawalRequests.vaultAddress, vaultAddress),
          ),
        )
        .orderBy(asc(withdrawalRequests.requestedAt));
    }

    return this.database
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.status, "settled")) // Truthful status
      .orderBy(asc(withdrawalRequests.requestedAt));
  }

  /**
   * Reconcile withdrawal state with batch request state.
   * Syncs withdrawalRequests with custom vault batch state for closed-book processing.
   *
   * CLOSED-BOOK BATCH SEMANTICS:
   * - Uses truthful 'settled' and 'claimed' statuses (no proxy mapping)
   * - Links via batchId and onchainRequestId for sealed processing
   *
   * NOTE: This is a stub implementation. Full implementation requires:
   * - Query withdrawalRequests by withdrawalType = 'batch'
   * - Join with batch_requests table via batchId/onchainRequestId
   * - Sync status between tables for sealed batch processing
   *
   * @param vaultAddress - The vault address to reconcile
   * @returns Reconciliation result summary
   */

  async reconcileWithBatchRequests(vaultAddress: string): Promise<{
    synced: number;
    mismatches: Array<{
      requestId: string;
      withdrawalStatus: string;
      batchStatus: string;
    }>;
    errors: string[];
  }> {
    const mismatches: Array<{
      requestId: string;
      withdrawalStatus: string;
      batchStatus: string;
    }> = [];
    const errors: string[] = [];
    let synced = 0;

    logger.debug("WithdrawalRepository: reconcileWithBatchRequests called (stub)", {
      vaultAddress,
      note: "Full implementation requires DB schema migration",
    });

    // Stub implementation - return empty results
    // Full implementation requires:
    // 1. Add withdrawalType enum column to withdrawal_requests table
    // 2. Add onchainRequestId string column to withdrawal_requests table
    // 3. Add 'settled' and 'claimed' to withdrawal_requests status enum
    // 4. Query withdrawalRequests by withdrawalType = 'batch'
    // 5. Join with batch_requests table via onchainRequestId
    // 6. Sync status between tables

    return { synced, mismatches, errors };
  }
}

export const withdrawalRepository = new WithdrawalRepository();
