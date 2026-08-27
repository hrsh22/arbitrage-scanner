/**
 * Position Snapshot Repository
 * CRUD operations for frozen position snapshots at epoch close.
 * Implements strict idempotency and batch operations for snapshot settlement.
 *
 * State Machine - Snapshot Position Status:
 *   frozen → realized (when position resolves)
 *   frozen → timed_out (when force-closed due to timeout)
 *   frozen → cancelled (when position invalidated)
 *   NO backward transitions allowed
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { epochPositionSnapshots } from "../db/schema.js";
import { logger } from "../logger.js";
import type { snapshotPositionStatusEnum } from "../db/schema.js";

// Extract type from enum
 type SnapshotPositionStatus = typeof snapshotPositionStatusEnum.enumValues[number];

type DbClient = typeof defaultDb;

/** Valid snapshot position status transitions */
export const validSnapshotTransitions: Record<SnapshotPositionStatus, SnapshotPositionStatus[]> = {
  frozen: ["realized", "timed_out", "cancelled"],
  realized: [], // Terminal state
  timed_out: [], // Terminal state
  cancelled: [], // Terminal state
};

/** Check if snapshot status transition is valid */
export function isValidSnapshotTransition(
  fromStatus: SnapshotPositionStatus,
  toStatus: SnapshotPositionStatus,
): boolean {
  if (fromStatus === toStatus) return true;
  return validSnapshotTransitions[fromStatus]?.includes(toStatus) ?? false;
}

/** Input for creating a single position snapshot */
export interface CreatePositionSnapshotInput {
  epochId: string;
  positionId: string;
  tokenId: string;
  conditionId: string;
  marketId: string;
  outcome: "YES" | "NO";
  quantity: string;
  costBasis: string;
  estimatedValue?: string;
}

/** Result of batch snapshot creation */
export interface BatchSnapshotResult {
  success: boolean;
  snapshots?: (typeof epochPositionSnapshots.$inferSelect)[];
  error?: string;
  insertedCount: number;
  failedCount: number;
  failedPositionIds?: string[];
}

/** Result of status transition attempt */
export interface SnapshotTransitionResult {
  success: boolean;
  snapshot?: typeof epochPositionSnapshots.$inferSelect;
  error?: string;
  alreadyInTargetState?: boolean;
}

export class PositionSnapshotRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  // ============================================================================
  // Batch Create Operations
  // ============================================================================

  /**
   * Create multiple position snapshots in a batch.
   * Uses ON CONFLICT DO NOTHING for idempotency - duplicate epochId + positionId
   * combinations are silently skipped without error.
   */
  async createBatch(inputs: CreatePositionSnapshotInput[]): Promise<BatchSnapshotResult> {
    if (inputs.length === 0) {
      return { success: true, insertedCount: 0, failedCount: 0 };
    }

    try {
      // Use insert with onConflictDoNothing for idempotency
      // The unique constraint on (epochId, positionId) prevents duplicates
      const results = await this.database
        .insert(epochPositionSnapshots)
        .values(
          inputs.map((input) => ({
            epochId: input.epochId,
            positionId: input.positionId,
            tokenId: input.tokenId,
            conditionId: input.conditionId,
            marketId: input.marketId,
            outcome: input.outcome,
            quantity: input.quantity,
            costBasis: input.costBasis,
            estimatedValue: input.estimatedValue ?? null,
            statusAtSnapshot: "frozen" as const,
          })),
        )
        .onConflictDoNothing({
          target: [epochPositionSnapshots.epochId, epochPositionSnapshots.positionId],
        })
        .returning();

      const insertedCount = results.length;
      const failedCount = inputs.length - insertedCount;

      // Identify which positions failed (were duplicates)
      const insertedPositionIds = new Set(results.map((r) => r.positionId));
      const failedPositionIds = inputs
        .filter((input) => !insertedPositionIds.has(input.positionId))
        .map((input) => input.positionId);

      if (failedCount > 0) {
        logger.warn("PositionSnapshotRepository: Some snapshots skipped (duplicates)", {
          epochId: inputs[0]?.epochId,
          attemptedCount: inputs.length,
          insertedCount,
          failedCount,
          failedPositionIds: failedPositionIds.slice(0, 10), // Log first 10
        });
      }

      return {
        success: true,
        snapshots: results,
        insertedCount,
        failedCount,
        failedPositionIds: failedCount > 0 ? failedPositionIds : undefined,
      };
    } catch (error) {
      logger.error("PositionSnapshotRepository: Batch create failed", {
        error: (error as Error).message,
        epochId: inputs[0]?.epochId,
        count: inputs.length,
      });

      return {
        success: false,
        error: `Batch create failed: ${(error as Error).message}`,
        insertedCount: 0,
        failedCount: inputs.length,
        failedPositionIds: inputs.map((i) => i.positionId),
      };
    }
  }

  /**
   * Create a single position snapshot.
   * Returns null if duplicate (epochId + positionId already exists).
   */
  async create(input: CreatePositionSnapshotInput) {
    try {
      const results = await this.database
        .insert(epochPositionSnapshots)
        .values({
          epochId: input.epochId,
          positionId: input.positionId,
          tokenId: input.tokenId,
          conditionId: input.conditionId,
          marketId: input.marketId,
          outcome: input.outcome,
          quantity: input.quantity,
          costBasis: input.costBasis,
          estimatedValue: input.estimatedValue ?? null,
          statusAtSnapshot: "frozen",
        })
        .onConflictDoNothing({
          target: [epochPositionSnapshots.epochId, epochPositionSnapshots.positionId],
        })
        .returning();

      // If no rows returned, it was a duplicate
      if (results.length === 0) {
        logger.debug("PositionSnapshotRepository: Duplicate snapshot skipped", {
          epochId: input.epochId,
          positionId: input.positionId,
        });
        return null;
      }

      return results[0];
    } catch (error) {
      logger.error("PositionSnapshotRepository: Create failed", {
        error: (error as Error).message,
        epochId: input.epochId,
        positionId: input.positionId,
      });
      throw error;
    }
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  /** Get snapshot by ID */
  async getById(id: number) {
    const results = await this.database
      .select()
      .from(epochPositionSnapshots)
      .where(eq(epochPositionSnapshots.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /** Get snapshot by epochId and positionId (unique constraint lookup) */
  async getByEpochAndPosition(epochId: string, positionId: string) {
    const results = await this.database
      .select()
      .from(epochPositionSnapshots)
      .where(
        and(
          eq(epochPositionSnapshots.epochId, epochId),
          eq(epochPositionSnapshots.positionId, positionId),
        ),
      )
      .limit(1);

    return results[0] ?? null;
  }

  /** Get all snapshots for an epoch */
  async getByEpoch(epochId: string, status?: SnapshotPositionStatus) {
    if (status) {
      return this.database
        .select()
        .from(epochPositionSnapshots)
        .where(
          and(
            eq(epochPositionSnapshots.epochId, epochId),
            eq(epochPositionSnapshots.statusAtSnapshot, status),
          ),
        )
        .orderBy(epochPositionSnapshots.createdAt);
    }

    return this.database
      .select()
      .from(epochPositionSnapshots)
      .where(eq(epochPositionSnapshots.epochId, epochId))
      .orderBy(epochPositionSnapshots.createdAt);
  }

  /** Get snapshot by original position ID (returns most recent if multiple epochs) */
  async getByPosition(positionId: string, limit = 1) {
    return this.database
      .select()
      .from(epochPositionSnapshots)
      .where(eq(epochPositionSnapshots.positionId, positionId))
      .orderBy(sql`${epochPositionSnapshots.createdAt} DESC`)
      .limit(limit);
  }

  /** Get snapshots by multiple position IDs (for batch lookups) */
  async getByPositionIds(positionIds: string[]) {
    if (positionIds.length === 0) return [];

    return this.database
      .select()
      .from(epochPositionSnapshots)
      .where(inArray(epochPositionSnapshots.positionId, positionIds));
  }

  /** Get all frozen (unrealized) snapshots for an epoch */
  async getFrozenByEpoch(epochId: string) {
    return this.getByEpoch(epochId, "frozen");
  }

  // ============================================================================
  // Status Update Operations
  // ============================================================================

  /**
   * Update snapshot status with state machine validation.
   * Enforces valid transitions: frozen → realized/timed_out/cancelled
   */
  async updateStatus(
    id: number,
    newStatus: SnapshotPositionStatus,
  ): Promise<SnapshotTransitionResult> {
    const snapshot = await this.getById(id);

    if (!snapshot) {
      return { success: false, error: "Snapshot not found" };
    }

    const currentStatus = snapshot.statusAtSnapshot;

    // Idempotency: already in target state
    if (currentStatus === newStatus) {
      return { success: true, snapshot, alreadyInTargetState: true };
    }

    // Validate transition
    if (!isValidSnapshotTransition(currentStatus, newStatus)) {
      return {
        success: false,
        snapshot,
        error: `Invalid status transition: '${currentStatus}' → '${newStatus}'`,
      };
    }

    const results = await this.database
      .update(epochPositionSnapshots)
      .set({
        statusAtSnapshot: newStatus,
      })
      .where(eq(epochPositionSnapshots.id, id))
      .returning();

    return {
      success: true,
      snapshot: results[0],
      alreadyInTargetState: false,
    };
  }

  /**
   * Mark a snapshot as realized (position resolved).
   * Idempotent - returns success if already realized.
   */
  async markRealized(id: number): Promise<SnapshotTransitionResult> {
    return this.updateStatus(id, "realized");
  }

  /**
   * Mark a snapshot as timed_out (force-closed).
   * Idempotent - returns success if already timed_out.
   */
  async markTimedOut(id: number): Promise<SnapshotTransitionResult> {
    return this.updateStatus(id, "timed_out");
  }

  /**
   * Mark a snapshot as cancelled (invalidated).
   * Idempotent - returns success if already cancelled.
   */
  async markCancelled(id: number): Promise<SnapshotTransitionResult> {
    return this.updateStatus(id, "cancelled");
  }

  // ============================================================================
  // Aggregated Queries
  // ============================================================================

  /** Get count of snapshots by status for an epoch */
  async getCountsByStatus(epochId: string): Promise<Record<SnapshotPositionStatus, number>> {
    const results = await this.database
      .select({
        status: epochPositionSnapshots.statusAtSnapshot,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(epochPositionSnapshots)
      .where(eq(epochPositionSnapshots.epochId, epochId))
      .groupBy(epochPositionSnapshots.statusAtSnapshot);

    const counts: Record<SnapshotPositionStatus, number> = {
      frozen: 0,
      realized: 0,
      timed_out: 0,
      cancelled: 0,
    };

    for (const row of results) {
      counts[row.status] = row.count;
    }

    return counts;
  }

  /** Get total cost basis for an epoch's frozen positions */
  async getTotalCostBasis(epochId: string): Promise<string> {
    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${epochPositionSnapshots.costBasis}), 0)`,
      })
      .from(epochPositionSnapshots)
      .where(
        and(
          eq(epochPositionSnapshots.epochId, epochId),
          eq(epochPositionSnapshots.statusAtSnapshot, "frozen"),
        ),
      );

    return result[0]?.total ?? "0";
  }

  /** Check if all positions for an epoch are resolved (none still frozen) */
  async areAllPositionsResolved(epochId: string): Promise<boolean> {
    const result = await this.database
      .select({
        frozenCount: sql<number>`COUNT(*)::int`,
      })
      .from(epochPositionSnapshots)
      .where(
        and(
          eq(epochPositionSnapshots.epochId, epochId),
          eq(epochPositionSnapshots.statusAtSnapshot, "frozen"),
        ),
      );

    return (result[0]?.frozenCount ?? 0) === 0;
  }
}

export const positionSnapshotRepository = new PositionSnapshotRepository();
