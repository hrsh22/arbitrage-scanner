/**
 * Payout Repository
 * CRUD operations for realized payout distributions to users.
 * Manages individual payout records and enforces cumulative entitlement caps.
 * Ensures claimed amounts never exceed entitlement.
 *
 * DUAL-MODE SUPPORT:
 * - Legacy (cohort-carry): Progressive payout with carry-forward tracking
 * - Closed-book (sealed): Deterministic settlement with batch processing
 *
 * CLOSED-BOOK BATCH SEMANTICS (Sealed Processing):
 * - Payouts calculated once at batch settlement
 * - No carry-forward - all entitled amounts available after settlement
 * - Uses truthful 'claimed' status (no proxy mapping to 'completed')
 * - Entitlement cap enforced at batch level
 *
 * LEGACY COHORT-CARRY SEMANTICS:
 * - Progressive payout as positions realize value
 * - Carry-forward tracks unclaimed amounts across tranches
 * - Per-realization distribution tracking
 */


import { eq, and, sql } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { realizedPayoutDistributions, epochRedemptionEntitlements } from "../db/schema.js";
import { logger } from "../logger.js";
import type { payoutStatusEnum } from "../db/schema.js";

type DbClient = typeof defaultDb;
type PayoutStatus = (typeof payoutStatusEnum.enumValues)[number];

export interface CreatePayoutInput {
  epochId: string;
  entitlementId: number;
  realizationEventId: number;
  userAddress: string;
  grossAmount: string;
  feeDeduction?: string;
  netAmount: string;
  status?: PayoutStatus;
}

export interface PayoutResult {
  success: boolean;
  payout?: typeof realizedPayoutDistributions.$inferSelect;
  error?: string;
  isDuplicate?: boolean;
}

export interface CumulativePayoutResult {
  entitlementId: number;
  totalDistributed: string;
  totalClaimed: string;
  remaining: string;
  payoutCount: number;
}

export interface CapCheckResult {
  canProceed: boolean;
  currentCumulative: string;
  requestedAmount: string;
  entitlementCap: string;
  wouldExceedBy: string;
  error?: string;
}

export class PayoutRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  /**
   * Create a payout distribution record.
   * Uses unique constraint on (entitlementId, realizationEventId) for idempotency.
   */
  async create(input: CreatePayoutInput): Promise<PayoutResult> {
    try {
      const existing = await this.getByEntitlementAndRealization(
        input.entitlementId,
        input.realizationEventId,
      );
      if (existing) {
        logger.warn("PayoutRepository: Duplicate payout attempt rejected", {
          entitlementId: input.entitlementId,
          realizationEventId: input.realizationEventId,
          existingPayoutId: existing.id,
        });
        return {
          success: false,
          payout: existing,
          error: "Payout already exists for this entitlement and realization event",
          isDuplicate: true,
        };
      }

      const results = await this.database
        .insert(realizedPayoutDistributions)
        .values({
          epochId: input.epochId,
          entitlementId: input.entitlementId,
          realizationEventId: input.realizationEventId,
          userAddress: input.userAddress,
          grossAmount: input.grossAmount,
          feeDeduction: input.feeDeduction ?? "0",
          netAmount: input.netAmount,
          status: input.status ?? "pending",
        })
        .returning();

      logger.info("PayoutRepository: Created payout distribution", {
        payoutId: results[0]!.id,
        entitlementId: input.entitlementId,
        userAddress: input.userAddress,
        netAmount: input.netAmount,
      });

      return {
        success: true,
        payout: results[0],
        isDuplicate: false,
      };
    } catch (error) {
      if ((error as Error).message?.includes("unique")) {
        const existing = await this.getByEntitlementAndRealization(
          input.entitlementId,
          input.realizationEventId,
        );
        return {
          success: false,
          payout: existing ?? undefined,
          error: `Duplicate payout rejected: ${(error as Error).message}`,
          isDuplicate: true,
        };
      }

      logger.error("PayoutRepository: Create failed", {
        error: (error as Error).message,
        entitlementId: input.entitlementId,
        realizationEventId: input.realizationEventId,
      });

      return {
        success: false,
        error: `Failed to create payout: ${(error as Error).message}`,
      };
    }
  }

  async getById(id: number) {
    const results = await this.database
      .select()
      .from(realizedPayoutDistributions)
      .where(eq(realizedPayoutDistributions.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  async getByEntitlement(entitlementId: number, status?: PayoutStatus) {
    if (status) {
      return this.database
        .select()
        .from(realizedPayoutDistributions)
        .where(
          and(
            eq(realizedPayoutDistributions.entitlementId, entitlementId),
            eq(realizedPayoutDistributions.status, status),
          ),
        )
        .orderBy(sql`${realizedPayoutDistributions.distributedAt} DESC`);
    }

    return this.database
      .select()
      .from(realizedPayoutDistributions)
      .where(eq(realizedPayoutDistributions.entitlementId, entitlementId))
      .orderBy(sql`${realizedPayoutDistributions.distributedAt} DESC`);
  }

  async getByEntitlementAndRealization(entitlementId: number, realizationEventId: number) {
    const results = await this.database
      .select()
      .from(realizedPayoutDistributions)
      .where(
        and(
          eq(realizedPayoutDistributions.entitlementId, entitlementId),
          eq(realizedPayoutDistributions.realizationEventId, realizationEventId),
        ),
      )
      .limit(1);

    return results[0] ?? null;
  }

  async getByUser(userAddress: string, epochId?: string, status?: PayoutStatus) {
    const conditions: (ReturnType<typeof eq> | ReturnType<typeof and>)[] = [
      eq(realizedPayoutDistributions.userAddress, userAddress),
    ];

    if (epochId) {
      conditions.push(eq(realizedPayoutDistributions.epochId, epochId));
    }

    if (status) {
      conditions.push(eq(realizedPayoutDistributions.status, status));
    }

    return this.database
      .select()
      .from(realizedPayoutDistributions)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(sql`${realizedPayoutDistributions.distributedAt} DESC`);
  }

  /**
   * Get cumulative payout statistics for an entitlement.
   * This is the authoritative source for entitlement cap validation.
   */
  async getCumulative(entitlementId: number): Promise<CumulativePayoutResult> {
    const [distributed, claimed] = await Promise.all([
      this.database
        .select({
          total: sql<string>`COALESCE(SUM(${realizedPayoutDistributions.netAmount}), 0)`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(realizedPayoutDistributions)
        .where(
          and(
            eq(realizedPayoutDistributions.entitlementId, entitlementId),
            eq(realizedPayoutDistributions.status, "distributed"),
          ),
        ),
      this.database
        .select({
          total: sql<string>`COALESCE(SUM(${realizedPayoutDistributions.netAmount}), 0)`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(realizedPayoutDistributions)
        .where(
          and(
            eq(realizedPayoutDistributions.entitlementId, entitlementId),
            eq(realizedPayoutDistributions.status, "claimed"),
          ),
        ),
    ]);

    const totalDistributed = BigInt(distributed[0]?.total ?? "0");
    const totalClaimed = BigInt(claimed[0]?.total ?? "0");

    return {
      entitlementId,
      totalDistributed: totalDistributed.toString(),
      totalClaimed: totalClaimed.toString(),
      remaining: (totalDistributed - totalClaimed).toString(),
      payoutCount: (distributed[0]?.count ?? 0) + (claimed[0]?.count ?? 0),
    };
  }

  /**
   * Check if a claim would exceed the entitlement cap.
   * This is a critical safety check to prevent over-claims.
   */
  async checkClaimCap(entitlementId: number, claimAmount: string): Promise<CapCheckResult> {
    const entitlement = await this.database
      .select({
        totalRealizedUsdc: epochRedemptionEntitlements.totalRealizedUsdc,
      })
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.id, entitlementId))
      .limit(1);

    if (entitlement.length === 0) {
      return {
        canProceed: false,
        currentCumulative: "0",
        requestedAmount: claimAmount,
        entitlementCap: "0",
        wouldExceedBy: claimAmount,
        error: "Entitlement not found",
      };
    }

    const entitlementCap = BigInt(entitlement[0]!.totalRealizedUsdc);
    const cumulative = await this.getCumulative(entitlementId);
    const currentClaimed = BigInt(cumulative.totalClaimed);
    const requested = BigInt(claimAmount);

    const wouldBeTotal = currentClaimed + requested;

    if (wouldBeTotal > entitlementCap) {
      return {
        canProceed: false,
        currentCumulative: cumulative.totalClaimed,
        requestedAmount: claimAmount,
        entitlementCap: entitlementCap.toString(),
        wouldExceedBy: (wouldBeTotal - entitlementCap).toString(),
        error: `Claim would exceed entitlement cap. Current claimed: ${cumulative.totalClaimed}, Requested: ${claimAmount}, Cap: ${entitlementCap}`,
      };
    }

    return {
      canProceed: true,
      currentCumulative: cumulative.totalClaimed,
      requestedAmount: claimAmount,
      entitlementCap: entitlementCap.toString(),
      wouldExceedBy: "0",
    };
  }

  /**
   * Mark a payout as claimed.
   * Validates that the claim would not exceed entitlement cap.
   */
  async markClaimed(
    payoutId: number,
    txHash?: string,
  ): Promise<{
    success: boolean;
    payout?: typeof realizedPayoutDistributions.$inferSelect;
    error?: string;
  }> {
    const payout = await this.getById(payoutId);
    if (!payout) {
      return { success: false, error: "Payout not found" };
    }

    if (payout.status === "claimed") {
      return { success: true, payout, error: "Payout already claimed" };
    }

    const capCheck = await this.checkClaimCap(payout.entitlementId, payout.netAmount);
    if (!capCheck.canProceed) {
      logger.error("PayoutRepository: Claim rejected - would exceed entitlement cap", {
        payoutId,
        entitlementId: payout.entitlementId,
        error: capCheck.error,
      });
      return { success: false, error: capCheck.error };
    }

    const updateData: Record<string, unknown> = {
      status: "claimed",
      claimedAt: new Date(),
    };

    if (txHash) {
      updateData.txHash = txHash;
    }

    const results = await this.database
      .update(realizedPayoutDistributions)
      .set(updateData)
      .where(eq(realizedPayoutDistributions.id, payoutId))
      .returning();

    logger.info("PayoutRepository: Marked payout as claimed", {
      payoutId,
      entitlementId: payout.entitlementId,
      txHash,
    });

    return { success: true, payout: results[0] };
  }

  /**
   * Mark all pending payouts for an entitlement as claimed.
   * Validates cumulative cap across all payouts.
   */
  async claimAllForEntitlement(
    entitlementId: number,
    txHash?: string,
  ): Promise<{
    success: boolean;
    claimedCount: number;
    totalClaimed: string;
    error?: string;
  }> {
    const pendingPayouts = await this.getByEntitlement(entitlementId, "distributed");

    if (pendingPayouts.length === 0) {
      return { success: true, claimedCount: 0, totalClaimed: "0" };
    }

    let totalToClaim = 0n;
    for (const payout of pendingPayouts) {
      totalToClaim += BigInt(payout.netAmount);
    }

    const capCheck = await this.checkClaimCap(entitlementId, totalToClaim.toString());
    if (!capCheck.canProceed) {
      return {
        success: false,
        claimedCount: 0,
        totalClaimed: "0",
        error: capCheck.error,
      };
    }

    let claimedCount = 0;
    let totalClaimed = 0n;

    for (const payout of pendingPayouts) {
      const result = await this.markClaimed(payout.id, txHash);
      if (result.success) {
        claimedCount++;
        totalClaimed += BigInt(payout.netAmount);
      }
    }

    logger.info("PayoutRepository: Claimed all payouts for entitlement", {
      entitlementId,
      claimedCount,
      totalClaimed: totalClaimed.toString(),
    });

    return {
      success: true,
      claimedCount,
      totalClaimed: totalClaimed.toString(),
    };
  }

  async getTotalByEpoch(epochId: string, status?: PayoutStatus): Promise<string> {
    const conditions = [eq(realizedPayoutDistributions.epochId, epochId)];

    if (status) {
      conditions.push(eq(realizedPayoutDistributions.status, status));
    }

    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${realizedPayoutDistributions.netAmount}), 0)`,
      })
      .from(realizedPayoutDistributions)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

    return result[0]?.total ?? "0";
  }

  async getUnclaimedCount(entitlementId: number): Promise<number> {
    const result = await this.database
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(realizedPayoutDistributions)
      .where(
        and(
          eq(realizedPayoutDistributions.entitlementId, entitlementId),
          eq(realizedPayoutDistributions.status, "distributed"),
        ),
      );

    return result[0]?.count ?? 0;
  }
}

export const payoutRepository = new PayoutRepository();
