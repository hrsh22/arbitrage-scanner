/**
 * Realization Repository
 * CRUD operations for position realization events.
 * Enforces strict idempotency - duplicate realization attempts are rejected.
 * Records gross proceeds, fees, and net proceeds from resolved positions.
 */

import { eq, and, sql } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import {
  positionRealizationEvents,
  epochPositionSnapshots,
  epochRedemptionEntitlements,
  realizedPayoutDistributions,
} from "../db/schema.js";
import { logger } from "../logger.js";
import type { realizationOutcomeEnum } from "../db/schema.js";

type DbClient = typeof defaultDb;
type RealizationOutcome = (typeof realizationOutcomeEnum.enumValues)[number];

export interface CreateRealizationInput {
  epochId: string;
  positionSnapshotId: number;
  tokenId: string;
  realizedOutcome: RealizationOutcome;
  grossProceeds: string;
  feeDeducted?: string;
  netProceeds: string;
  realizedAt: Date;
  txHash?: string;
}

export interface RealizationResult {
  success: boolean;
  realization?: typeof positionRealizationEvents.$inferSelect;
  error?: string;
  isDuplicate?: boolean;
}

export interface ProcessRealizationResult {
  success: boolean;
  realization?: typeof positionRealizationEvents.$inferSelect;
  distributions?: (typeof realizedPayoutDistributions.$inferSelect)[];
  error?: string;
  totalDistributed: string;
  entitlementUpdates: number;
}

export type RealizationWithDetails = typeof positionRealizationEvents.$inferSelect & {
  positionSnapshot?: typeof epochPositionSnapshots.$inferSelect;
};

export class RealizationRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  async create(input: CreateRealizationInput): Promise<RealizationResult> {
    try {
      const existing = await this.getByEpochAndPosition(input.epochId, input.positionSnapshotId);
      if (existing) {
        logger.warn("RealizationRepository: Duplicate realization attempt rejected", {
          epochId: input.epochId,
          positionSnapshotId: input.positionSnapshotId,
          existingRealizationId: existing.id,
        });
        return {
          success: false,
          realization: existing,
          error: `Realization already exists for epoch ${input.epochId} and position snapshot ${input.positionSnapshotId}`,
          isDuplicate: true,
        };
      }

      const results = await this.database
        .insert(positionRealizationEvents)
        .values({
          epochId: input.epochId,
          positionSnapshotId: input.positionSnapshotId,
          tokenId: input.tokenId,
          realizedOutcome: input.realizedOutcome,
          grossProceeds: input.grossProceeds,
          feeDeducted: input.feeDeducted ?? "0",
          netProceeds: input.netProceeds,
          realizedAt: input.realizedAt,
          txHash: input.txHash ?? null,
        })
        .returning();

      logger.info("RealizationRepository: Created realization event", {
        realizationId: results[0]!.id,
        epochId: input.epochId,
        positionSnapshotId: input.positionSnapshotId,
        outcome: input.realizedOutcome,
        netProceeds: input.netProceeds,
      });

      return {
        success: true,
        realization: results[0],
        isDuplicate: false,
      };
    } catch (error) {
      if ((error as Error).message?.includes("unique")) {
        const existing = await this.getByEpochAndPosition(input.epochId, input.positionSnapshotId);
        return {
          success: false,
          realization: existing ?? undefined,
          error: `Duplicate realization rejected: ${(error as Error).message}`,
          isDuplicate: true,
        };
      }

      logger.error("RealizationRepository: Create failed", {
        error: (error as Error).message,
        epochId: input.epochId,
        positionSnapshotId: input.positionSnapshotId,
      });

      return {
        success: false,
        error: `Failed to create realization: ${(error as Error).message}`,
      };
    }
  }

  async processRealization(input: CreateRealizationInput): Promise<ProcessRealizationResult> {
    const realizationResult = await this.create(input);

    if (!realizationResult.success) {
      return {
        success: false,
        error: realizationResult.error,
        totalDistributed: "0",
        entitlementUpdates: 0,
      };
    }

    const realization = realizationResult.realization!;
    const distributions: (typeof realizedPayoutDistributions.$inferSelect)[] = [];
    let totalDistributed = 0n;
    let entitlementUpdates = 0;

    try {
      await this.database
        .update(epochPositionSnapshots)
        .set({
          statusAtSnapshot: input.realizedOutcome === "force_close" ? "timed_out" : "realized",
        })
        .where(eq(epochPositionSnapshots.id, input.positionSnapshotId));

      const entitlements = await this.database
        .select()
        .from(epochRedemptionEntitlements)
        .where(eq(epochRedemptionEntitlements.epochId, input.epochId));

      const netProceeds = BigInt(input.netProceeds);

      for (const entitlement of entitlements) {
        const ratio = BigInt(entitlement.entitlementRatio);
        const SCALE = 10n ** 18n;
        const payoutAmount = (netProceeds * ratio) / SCALE;

        if (payoutAmount > 0n) {
          const payoutValues = {
            userAddress: entitlement.userAddress,
            epochId: input.epochId,
            entitlementId: entitlement.id,
            realizationEventId: realization.id,
            grossAmount: ((payoutAmount * BigInt(input.grossProceeds)) / netProceeds).toString(),
            feeDeduction: ((payoutAmount * BigInt(input.feeDeducted ?? "0")) / netProceeds).toString(),
            netAmount: payoutAmount.toString(),
            status: "distributed" as const,
          };
          
          const distributionResult = await this.database
            .insert(realizedPayoutDistributions)
            .values(payoutValues)
            .returning();

          distributions.push(distributionResult[0]!);
          totalDistributed += payoutAmount;
        }

        const currentRealized = BigInt(entitlement.totalRealizedUsdc);
        const newRealized = currentRealized + payoutAmount;

        await this.database
          .update(epochRedemptionEntitlements)
          .set({
            totalRealizedUsdc: newRealized.toString(),
            updatedAt: new Date(),
            status:
              newRealized > 0n
                ? entitlement.status === "pending"
                  ? "partially_fulfilled"
                  : entitlement.status
                : entitlement.status,
          })
          .where(eq(epochRedemptionEntitlements.id, entitlement.id));

        entitlementUpdates++;
      }

      logger.info("RealizationRepository: Processed realization with distributions", {
        realizationId: realization.id,
        epochId: input.epochId,
        totalEntitlements: entitlements.length,
        distributionsCreated: distributions.length,
        totalDistributed: totalDistributed.toString(),
      });

      return {
        success: true,
        realization,
        distributions,
        totalDistributed: totalDistributed.toString(),
        entitlementUpdates,
      };
    } catch (error) {
      logger.error("RealizationRepository: Process realization failed", {
        error: (error as Error).message,
        realizationId: realization.id,
        epochId: input.epochId,
      });

      return {
        success: false,
        realization,
        error: `Processing failed after realization creation: ${(error as Error).message}`,
        totalDistributed: totalDistributed.toString(),
        entitlementUpdates,
      };
    }
  }

  async getById(id: number) {
    const results = await this.database
      .select()
      .from(positionRealizationEvents)
      .where(eq(positionRealizationEvents.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  async getByEpochAndPosition(epochId: string, positionSnapshotId: number) {
    const results = await this.database
      .select()
      .from(positionRealizationEvents)
      .where(
        and(
          eq(positionRealizationEvents.epochId, epochId),
          eq(positionRealizationEvents.positionSnapshotId, positionSnapshotId),
        ),
      )
      .limit(1);

    return results[0] ?? null;
  }

  async getByEpoch(epochId: string, outcome?: RealizationOutcome) {
    if (outcome) {
      return this.database
        .select()
        .from(positionRealizationEvents)
        .where(
          and(
            eq(positionRealizationEvents.epochId, epochId),
            eq(positionRealizationEvents.realizedOutcome, outcome),
          ),
        )
        .orderBy(sql`${positionRealizationEvents.realizedAt} DESC`);
    }

    return this.database
      .select()
      .from(positionRealizationEvents)
      .where(eq(positionRealizationEvents.epochId, epochId))
      .orderBy(sql`${positionRealizationEvents.realizedAt} DESC`);
  }

  async getByPositionSnapshot(positionSnapshotId: number) {
    const results = await this.database
      .select()
      .from(positionRealizationEvents)
      .where(eq(positionRealizationEvents.positionSnapshotId, positionSnapshotId))
      .limit(1);

    return results[0] ?? null;
  }

  async getWithDetails(id: number): Promise<RealizationWithDetails | null> {
    const realization = await this.getById(id);
    if (!realization) return null;

    const snapshots = await this.database
      .select()
      .from(epochPositionSnapshots)
      .where(eq(epochPositionSnapshots.id, realization.positionSnapshotId))
      .limit(1);

    return {
      ...realization,
      positionSnapshot: snapshots[0],
    };
  }

  async getTotalNetProceeds(epochId: string): Promise<string> {
    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${positionRealizationEvents.netProceeds}), 0)`,
      })
      .from(positionRealizationEvents)
      .where(eq(positionRealizationEvents.epochId, epochId));

    return result[0]?.total ?? "0";
  }

  async getTotalFees(epochId: string): Promise<string> {
    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${positionRealizationEvents.feeDeducted}), 0)`,
      })
      .from(positionRealizationEvents)
      .where(eq(positionRealizationEvents.epochId, epochId));

    return result[0]?.total ?? "0";
  }

  async getCountsByOutcome(epochId: string): Promise<Record<RealizationOutcome, number>> {
    const results = await this.database
      .select({
        outcome: positionRealizationEvents.realizedOutcome,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(positionRealizationEvents)
      .where(eq(positionRealizationEvents.epochId, epochId))
      .groupBy(positionRealizationEvents.realizedOutcome);

    const counts: Record<RealizationOutcome, number> = {
      win: 0,
      loss: 0,
      force_close: 0,
    };

    for (const row of results) {
      counts[row.outcome] = row.count;
    }

    return counts;
  }

  async isPositionRealized(positionSnapshotId: number): Promise<boolean> {
    const result = await this.database
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(positionRealizationEvents)
      .where(eq(positionRealizationEvents.positionSnapshotId, positionSnapshotId));

    return (result[0]?.count ?? 0) > 0;
  }

  async validateRealization(
    epochId: string,
    positionSnapshotId: number,
  ): Promise<{ valid: boolean; error?: string }> {
    const snapshot = await this.database
      .select()
      .from(epochPositionSnapshots)
      .where(eq(epochPositionSnapshots.id, positionSnapshotId))
      .limit(1);

    if (snapshot.length === 0) {
      return { valid: false, error: "Position snapshot not found" };
    }

    const snapshotData = snapshot[0]!;
    if (snapshotData.statusAtSnapshot !== "frozen") {
      return {
        valid: false,
        error: `Position snapshot status is '${snapshotData.statusAtSnapshot}', expected 'frozen'`,
      };
    }

    const existing = await this.getByPositionSnapshot(positionSnapshotId);
    if (existing) {
      return {
        valid: false,
        error: `Position already realized (realization ID: ${existing.id})`,
      };
    }

    if (snapshotData.epochId !== epochId) {
      return {
        valid: false,
        error: `Epoch mismatch: snapshot belongs to epoch ${snapshotData.epochId}, not ${epochId}`,
      };
    }

    return { valid: true };
  }
  // ============================================================================
  // Ledger Invariant Validation - Canonical Semantics
  // ============================================================================

  /**
   * Validate ledger invariants for all realizations in an epoch.
   * Ensures accrued amounts never exceed entitlements.
   */
  async validateLedgerInvariants(epochId: string): Promise<{
    valid: boolean;
    violations: Array<{
      entitlementId: number;
      userAddress: string;
      accrued: string;
      entitlement: string;
      excess: string;
    }>;
  }> {
    const entitlements = await this.database
      .select()
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.epochId, epochId));

    const violations: Array<{
      entitlementId: number;
      userAddress: string;
      accrued: string;
      entitlement: string;
      excess: string;
    }> = [];

    for (const entitlement of entitlements) {
      const accrued = BigInt(entitlement.accrued);
      const entitlementCap = BigInt(entitlement.entitlement);

      if (accrued > entitlementCap) {
        violations.push({
          entitlementId: entitlement.id,
          userAddress: entitlement.userAddress,
          accrued: accrued.toString(),
          entitlement: entitlementCap.toString(),
          excess: (accrued - entitlementCap).toString(),
        });
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}

export const realizationRepository = new RealizationRepository();
