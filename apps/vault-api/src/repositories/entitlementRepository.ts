/**
 * Entitlement Repository
 * CRUD operations for user redemption entitlements per epoch.
 * Manages immutable entitlement ratios and tracks cumulative realized/claimed amounts.
 * Enforces entitlement caps to prevent over-distribution.
 */

import { eq, and, sql } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { epochRedemptionEntitlements, realizedPayoutDistributions } from "../db/schema.js";
import { logger } from "../logger.js";
import type { entitlementStatusEnum } from "../db/schema.js";

type DbClient = typeof defaultDb;
type EntitlementStatus = (typeof entitlementStatusEnum.enumValues)[number];

/** Input for creating an entitlement */
export interface CreateEntitlementInput {
  epochId: string;
  requestId: string;
  userAddress: string;
  sharesSubmitted: string;
  totalEpochShares: string;
  entitlementRatio: string; // 0.0 to 1.0 as decimal string
}

/** Result of entitlement creation */
export interface EntitlementResult {
  success: boolean;
  entitlement?: typeof epochRedemptionEntitlements.$inferSelect;
  error?: string;
  isDuplicate?: boolean;
}

/** Entitlement with calculated claimable amount */
export type EntitlementWithClaimable = typeof epochRedemptionEntitlements.$inferSelect & {
  remainingEntitlement: string;
  canClaimMore: boolean;
};

/** Cap validation result */
export interface CapValidationResult {
  valid: boolean;
  currentTotal: string;
  requestedAmount: string;
  entitlementCap: string;
  remaining: string;
  error?: string;
}


/** Reason codes for reconciliation mismatches */
export type ReconcileMismatchReason =
  | 'CANONICAL_LEGACY_ACCRUED_MISMATCH'
  | 'CANONICAL_LEGACY_CLAIMED_MISMATCH'
  | 'CARRY_REMAINING_CALCULATION_ERROR'
  | 'NEGATIVE_VALUE_DETECTED'
  | 'LEDGER_INVARIANT_VIOLATION'
  | 'CONTRACT_REPOSITORY_MISMATCH';

/** Single mismatch entry from reconciliation */
export interface ReconcileMismatch {
  entitlementId: number;
  requestId: string;
  userAddress: string;
  epochId: string;
  field: string;
  canonicalValue: string;
  legacyValue: string;
  expectedValue?: string;
  reason: ReconcileMismatchReason;
  details: string;
}

/** Reconciliation result for an entitlement */
export interface EntitlementReconcileResult {
  entitlementId: number;
  requestId: string;
  matches: boolean;
  mismatches: ReconcileMismatch[];
}

/** Full reconciliation report for an epoch */
export interface ReconciliationReport {
  epochId: string;
  timestamp: Date;
  totalEntitlements: number;
  matchingCount: number;
  mismatchCount: number;
  mismatches: ReconcileMismatch[];
  summary: {
    explainedDeltas: number;
    unexplainedDeltas: number;
  };
}

/** Contract state as read from the blockchain */
export interface ContractEntitlementState {
  requestId: string;
  userAddress: string;
  sharesSubmitted: string;
  entitlementRatio: string;
  totalRealizedUsdc: string;
  totalClaimedUsdc: string;
  carryRemaining?: string;
}
export class EntitlementRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  // ============================================================================
  // Create Operations
  // ============================================================================

  /**
   * Create a new entitlement record.
   * Returns existing record if requestId already exists (idempotent).
   */
  async create(input: CreateEntitlementInput): Promise<EntitlementResult> {
    try {
      // Check for existing entitlement first (idempotency)
      const existing = await this.getByRequest(input.requestId);
      if (existing) {
        logger.debug("EntitlementRepository: Entitlement already exists", {
          requestId: input.requestId,
          epochId: input.epochId,
        });
        return {
          success: true,
          entitlement: existing,
          isDuplicate: true,
        };
      }

      const results = await this.database
        .insert(epochRedemptionEntitlements)
        .values({
          epochId: input.epochId,
          requestId: input.requestId,
          userAddress: input.userAddress,
          sharesSubmitted: input.sharesSubmitted,
          totalEpochShares: input.totalEpochShares,
          entitlementRatio: input.entitlementRatio,
          status: "pending",
          totalRealizedUsdc: "0",
          totalClaimedUsdc: "0",
        })
        .returning();

      logger.info("EntitlementRepository: Created entitlement", {
        requestId: input.requestId,
        epochId: input.epochId,
        userAddress: input.userAddress,
        ratio: input.entitlementRatio,
      });

      return {
        success: true,
        entitlement: results[0],
        isDuplicate: false,
      };
    } catch (error) {
      // Handle unique constraint violation (requestId must be unique)
      if ((error as Error).message?.includes("unique")) {
        const existing = await this.getByRequest(input.requestId);
        return {
          success: true,
          entitlement: existing ?? undefined,
          isDuplicate: true,
        };
      }

      logger.error("EntitlementRepository: Create failed", {
        error: (error as Error).message,
        requestId: input.requestId,
      });

      return {
        success: false,
        error: `Failed to create entitlement: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  /** Get entitlement by ID */
  async getById(id: number) {
    const results = await this.database
      .select()
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /** Get entitlement by requestId (unique constraint) */
  async getByRequest(requestId: string) {
    const results = await this.database
      .select()
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.requestId, requestId))
      .limit(1);

    return results[0] ?? null;
  }

  /** Get all entitlements for an epoch */
  async getByEpoch(epochId: string, status?: EntitlementStatus) {
    if (status) {
      return this.database
        .select()
        .from(epochRedemptionEntitlements)
        .where(
          and(
            eq(epochRedemptionEntitlements.epochId, epochId),
            eq(epochRedemptionEntitlements.status, status),
          ),
        )
        .orderBy(epochRedemptionEntitlements.createdAt);
    }

    return this.database
      .select()
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.epochId, epochId))
      .orderBy(epochRedemptionEntitlements.createdAt);
  }

  /** Get all entitlements for a user */
  async getByUser(userAddress: string, epochId?: string) {
    if (epochId) {
      return this.database
        .select()
        .from(epochRedemptionEntitlements)
        .where(
          and(
            eq(epochRedemptionEntitlements.userAddress, userAddress),
            eq(epochRedemptionEntitlements.epochId, epochId),
          ),
        )
        .orderBy(sql`${epochRedemptionEntitlements.createdAt} DESC`);
    }

    return this.database
      .select()
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.userAddress, userAddress))
      .orderBy(sql`${epochRedemptionEntitlements.createdAt} DESC`);
  }

  /** Get entitlement with calculated claimable amount */
  async getWithClaimable(id: number): Promise<EntitlementWithClaimable | null> {
    const entitlement = await this.getById(id);
    if (!entitlement) return null;

    const cumulativePayout = await this.getCumulativePayout(id);
    const remainingEntitlement = BigInt(entitlement.totalRealizedUsdc) - BigInt(cumulativePayout);

    return {
      ...entitlement,
      remainingEntitlement: remainingEntitlement.toString(),
      canClaimMore: remainingEntitlement > 0n,
    };
  }

  // ============================================================================
  // Cumulative Payout Operations
  // ============================================================================

  /**
   * Get cumulative payout for an entitlement (sum of all distributed payouts).
   * This is ACID-safe as it queries the actual payout records.
   */
  async getCumulativePayout(entitlementId: number): Promise<string> {
    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${realizedPayoutDistributions.netAmount}), 0)`,
      })
      .from(realizedPayoutDistributions)
      .where(
        and(
          eq(realizedPayoutDistributions.entitlementId, entitlementId),
          eq(realizedPayoutDistributions.status, "distributed"),
        ),
      );

    return result[0]?.total ?? "0";
  }

  /**
   * Validate that a requested payout amount would not exceed the entitlement cap.
   * Returns validation result with remaining amount.
   */
  async validateCap(entitlementId: number, requestedAmount: string): Promise<CapValidationResult> {
    const entitlement = await this.getById(entitlementId);
    if (!entitlement) {
      return {
        valid: false,
        currentTotal: "0",
        requestedAmount,
        entitlementCap: "0",
        remaining: "0",
        error: "Entitlement not found",
      };
    }

    // Entitlement cap is the total realized USDC for this entitlement
    const entitlementCap = entitlement.totalRealizedUsdc;
    const cumulativePayout = await this.getCumulativePayout(entitlementId);
    const requested = BigInt(requestedAmount);
    const cap = BigInt(entitlementCap);
    const current = BigInt(cumulativePayout);
    const remaining = cap - current;

    const valid = current + requested <= cap;

    return {
      valid,
      currentTotal: cumulativePayout,
      requestedAmount,
      entitlementCap,
      remaining: remaining.toString(),
      error: valid
        ? undefined
        : `Payout would exceed entitlement cap. Current: ${cumulativePayout}, Requested: ${requestedAmount}, Cap: ${entitlementCap}, Remaining: ${remaining}`,
    };
  }

  /**
   * Check if a payout would exceed the entitlement cap.
   * Simpler version of validateCap that just returns boolean.
   */
  async wouldExceedCap(entitlementId: number, requestedAmount: string): Promise<boolean> {
    const validation = await this.validateCap(entitlementId, requestedAmount);
    return !validation.valid;
  }

  // ============================================================================
  // Update Operations
  // ============================================================================

  /**
   * Update the total realized USDC for an entitlement.
   * Called when new realization events occur for the epoch.
   */
  async updateRealized(entitlementId: number, newRealizedAmount: string) {
    try {
      const results = await this.database
        .update(epochRedemptionEntitlements)
        .set({
          totalRealizedUsdc: newRealizedAmount,
          updatedAt: new Date(),
        })
        .where(eq(epochRedemptionEntitlements.id, entitlementId))
        .returning();

      if (results.length === 0) {
        return { success: false, error: "Entitlement not found" };
      }

      // Auto-update status based on realization vs claims
      const entitlement = results[0]!;
      const cumulativePayout = await this.getCumulativePayout(entitlementId);

      let newStatus: EntitlementStatus = entitlement.status;
      if (entitlement.status !== "cancelled") {
        if (cumulativePayout === newRealizedAmount) {
          newStatus = "fully_fulfilled";
        } else if (BigInt(cumulativePayout) > 0n) {
          newStatus = "partially_fulfilled";
        }

        if (newStatus !== entitlement.status) {
          await this.updateStatus(entitlementId, newStatus);
        }
      }

      logger.info("EntitlementRepository: Updated realized amount", {
        entitlementId,
        newRealizedAmount,
        status: newStatus,
      });

      return { success: true, entitlement: results[0] };
    } catch (error) {
      logger.error("EntitlementRepository: Update realized failed", {
        error: (error as Error).message,
        entitlementId,
      });
      return {
        success: false,
        error: `Failed to update realized amount: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Update entitlement status with validation.
   */
  async updateStatus(entitlementId: number, newStatus: EntitlementStatus) {
    const results = await this.database
      .update(epochRedemptionEntitlements)
      .set({
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(epochRedemptionEntitlements.id, entitlementId))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Increment the total claimed USDC for an entitlement.
   * Should be called after successful claim.
   */
  async incrementClaimed(entitlementId: number, claimedAmount: string) {
    const entitlement = await this.getById(entitlementId);
    if (!entitlement) {
      return { success: false, error: "Entitlement not found" };
    }

    // Validate cap before incrementing
    const validation = await this.validateCap(entitlementId, claimedAmount);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    const newClaimed = (BigInt(entitlement.totalClaimedUsdc) + BigInt(claimedAmount)).toString();

    const results = await this.database
      .update(epochRedemptionEntitlements)
      .set({
        totalClaimedUsdc: newClaimed,
        updatedAt: new Date(),
      })
      .where(eq(epochRedemptionEntitlements.id, entitlementId))
      .returning();

    return { success: true, entitlement: results[0] };
  }

  // ============================================================================
  // Ownership Verification
  // ============================================================================

  /**
   * Verify that a user owns an entitlement.
   * Returns the entitlement if owned, null if not found or not owned.
   */
  async verifyOwnership(
    entitlementId: number,
    userAddress: string,
  ): Promise<typeof epochRedemptionEntitlements.$inferSelect | null> {
    const entitlement = await this.getById(entitlementId);
    if (!entitlement) return null;

    if (entitlement.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
      logger.warn("EntitlementRepository: Ownership verification failed", {
        entitlementId,
        expectedOwner: entitlement.userAddress,
        requestingUser: userAddress,
      });
      return null;
    }

    return entitlement;
  }

  /**
   * Verify that a user owns an entitlement by requestId.
   */
  async verifyOwnershipByRequest(
    requestId: string,
    userAddress: string,
  ): Promise<typeof epochRedemptionEntitlements.$inferSelect | null> {
    const entitlement = await this.getByRequest(requestId);
    if (!entitlement) return null;

    if (entitlement.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
      logger.warn("EntitlementRepository: Ownership verification failed", {
        requestId,
        expectedOwner: entitlement.userAddress,
        requestingUser: userAddress,
      });
      return null;
    }

    return entitlement;
  }

  // ============================================================================
  // State Machine Helpers
  // ============================================================================

  /**
   * Check if an entitlement can be claimed (has unclaimed payouts).
   * Returns detailed claim eligibility information.
   */
  async getClaimEligibility(entitlementId: number): Promise<{
    canClaim: boolean;
    currentStatus: string;
    unclaimedAmount: string;
    totalRealized: string;
    totalClaimed: string;
    error?: string;
  }> {
    const entitlement = await this.getById(entitlementId);
    if (!entitlement) {
      return {
        canClaim: false,
        currentStatus: "unknown",
        unclaimedAmount: "0",
        totalRealized: "0",
        totalClaimed: "0",
        error: "Entitlement not found",
      };
    }

    const cumulativePayout = await this.getCumulativePayout(entitlementId);
    const realized = BigInt(entitlement.totalRealizedUsdc);
    const claimed = BigInt(cumulativePayout);
    const unclaimed = realized - claimed;

    // Can claim if there are unclaimed funds and status allows
    const canClaim =
      unclaimed > 0n &&
      (entitlement.status === "pending" || entitlement.status === "partially_fulfilled");

    return {
      canClaim,
      currentStatus: entitlement.status,
      unclaimedAmount: unclaimed.toString(),
      totalRealized: entitlement.totalRealizedUsdc,
      totalClaimed: cumulativePayout,
      error: canClaim ? undefined : "No claimable amount available",
    };
  }

  /**
   * Get full entitlement status with claim state for API responses.
   */
  async getEntitlementStatus(entitlementId: number): Promise<{
    entitlement: typeof epochRedemptionEntitlements.$inferSelect | null;
    claimableAmount: string;
    isClaimable: boolean;
  }> {
    const entitlement = await this.getById(entitlementId);
    if (!entitlement) {
      return { entitlement: null, claimableAmount: "0", isClaimable: false };
    }

    const cumulativePayout = await this.getCumulativePayout(entitlementId);
    const realized = BigInt(entitlement.totalRealizedUsdc);
    const claimed = BigInt(cumulativePayout);
    const claimable = realized - claimed;

    return {
      entitlement,
      claimableAmount: claimable.toString(),
      isClaimable: claimable > 0n,
    };
  }

  // ============================================================================
  // Aggregated Queries
  // ============================================================================

  /** Get total realized USDC for an epoch */
  async getTotalRealizedForEpoch(epochId: string): Promise<string> {
    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${epochRedemptionEntitlements.totalRealizedUsdc}), 0)`,
      })
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.epochId, epochId));

    return result[0]?.total ?? "0";
  }

  /** Get total claimed USDC for an epoch */
  async getTotalClaimedForEpoch(epochId: string): Promise<string> {
    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${epochRedemptionEntitlements.totalClaimedUsdc}), 0)`,
      })
      .from(epochRedemptionEntitlements)
      .where(eq(epochRedemptionEntitlements.epochId, epochId));

    return result[0]?.total ?? "0";
  }

  /** Get entitlement statistics for an epoch */
  async getEpochStats(epochId: string): Promise<{
    totalEntitlements: number;
    pendingCount: number;
    partiallyFulfilledCount: number;
    fullyFulfilledCount: number;
    totalRealized: string;
    totalClaimed: string;
    remainingToClaim: string;
  }> {
    const entitlements = await this.getByEpoch(epochId);

    let totalRealized = 0n;
    let totalClaimed = 0n;
    let pendingCount = 0;
    let partiallyFulfilledCount = 0;
    let fullyFulfilledCount = 0;

    for (const e of entitlements) {
      totalRealized += BigInt(e.totalRealizedUsdc);
      totalClaimed += BigInt(e.totalClaimedUsdc);

      switch (e.status) {
        case "pending":
          pendingCount++;
          break;
        case "partially_fulfilled":
          partiallyFulfilledCount++;
          break;
        case "fully_fulfilled":
          fullyFulfilledCount++;
          break;
      }
    }

    return {
      totalEntitlements: entitlements.length,
      pendingCount,
      partiallyFulfilledCount,
      fullyFulfilledCount,
      totalRealized: totalRealized.toString(),
      totalClaimed: totalClaimed.toString(),
      remainingToClaim: (totalRealized - totalClaimed).toString(),
    };
  }
  // ============================================================================
  // Ledger Invariant Validation - Canonical Semantics with Explicit Field Mapping
  // ============================================================================

  /**
   * Explicit field mapping between legacy and canonical fields.
   * This mapping ensures deterministic reconciliation between dual-ledger systems.
   * 
   * Canonical Schema (single source of truth):
   *   - entitlement: Total entitled amount (immutable after freeze)
   *   - accrued: Amount accrued from realizations
   *   - claimed: Amount claimed by user
   *   - carryRemaining: Remaining to be carried (calculated: entitlement - claimed)
   *
   * Legacy Schema (deprecated, maintained for backward compatibility):
   *   - totalRealizedUsdc: Maps to 'accrued'
   *   - totalClaimedUsdc: Maps to 'claimed'
   */
  static readonly LedgerFieldMapping = {
    // Canonical -> Legacy mapping
    canonical: {
      entitlement: 'entitlement',
      accrued: 'accrued',
      claimed: 'claimed',
      carryRemaining: 'carryRemaining',
    },
    // Legacy -> Canonical mapping (for migration context)
    legacy: {
      totalRealizedUsdc: 'accrued',
      totalClaimedUsdc: 'claimed',
    },
  } as const;

  /**
   * Reason codes for reconciliation mismatches
   */
  static readonly ReconcileMismatchReason = {
    CANONICAL_LEGACY_ACCRUED_MISMATCH: 'CANONICAL_LEGACY_ACCRUED_MISMATCH',
    CANONICAL_LEGACY_CLAIMED_MISMATCH: 'CANONICAL_LEGACY_CLAIMED_MISMATCH',
    CARRY_REMAINING_CALCULATION_ERROR: 'CARRY_REMAINING_CALCULATION_ERROR',
    NEGATIVE_VALUE_DETECTED: 'NEGATIVE_VALUE_DETECTED',
    LEDGER_INVARIANT_VIOLATION: 'LEDGER_INVARIANT_VIOLATION',
    CONTRACT_REPOSITORY_MISMATCH: 'CONTRACT_REPOSITORY_MISMATCH',
  } as const;

  /**
   * Ledger invariant check: 0 <= claimed <= accrued <= entitlement
   * Uses canonical field names from the database schema.
   * Returns detailed information about any invariant violations.
   */
  validateLedgerInvariants(
    entitlement: typeof epochRedemptionEntitlements.$inferSelect,
  ): {
    valid: boolean;
    violatedInvariants: string[];
    details: {
      claimedLteAccrued: boolean;
      accruedLteEntitlement: boolean;
      nonNegative: boolean;
      carryRemainingCorrect: boolean;
    };
  } {
    const violatedInvariants: string[] = [];
    
    // Use canonical field names from the actual database schema
    const claimed = BigInt(entitlement.claimed);
    const accrued = BigInt(entitlement.accrued);
    const entitlementAmount = BigInt(entitlement.entitlement);
    const carryRemaining = BigInt(entitlement.carryRemaining);

    // Invariant 1: All values must be non-negative
    const nonNegative = claimed >= 0n && accrued >= 0n && entitlementAmount >= 0n;
    if (!nonNegative) {
      violatedInvariants.push('Negative values detected');
    }

    // Invariant 2: claimed <= accrued
    const claimedLteAccrued = claimed <= accrued;
    if (!claimedLteAccrued) {
      violatedInvariants.push(`claimed (${claimed.toString()}) > accrued (${accrued.toString()})`);
    }

    // Invariant 3: accrued <= entitlement
    const accruedLteEntitlement = accrued <= entitlementAmount;
    if (!accruedLteEntitlement) {
      violatedInvariants.push(`accrued (${accrued.toString()}) > entitlement (${entitlementAmount.toString()})`);
    }

    // Invariant 4: carryRemaining = entitlement - claimed (loss-aware calculation)
    const expectedCarryRemaining = entitlementAmount - claimed;
    const carryRemainingCorrect = carryRemaining === expectedCarryRemaining;
    if (!carryRemainingCorrect) {
      violatedInvariants.push(`carryRemaining (${carryRemaining.toString()}) != entitlement - claimed (${expectedCarryRemaining.toString()})`);
    }

    const valid = violatedInvariants.length === 0;

    if (!valid) {
      logger.error('EntitlementRepository: Ledger invariant violation', {
        entitlementId: entitlement.id,
        requestId: entitlement.requestId,
        violatedInvariants,
        claimed: claimed.toString(),
        accrued: accrued.toString(),
        entitlement: entitlementAmount.toString(),
        carryRemaining: carryRemaining.toString(),
      });
    }

    return {
      valid,
      violatedInvariants,
      details: {
        claimedLteAccrued,
        accruedLteEntitlement,
        nonNegative,
        carryRemainingCorrect,
      },
    };
  }

  /**
   * Validate ledger invariants for an entitlement by ID.
   * Throws if entitlement not found.
   */
  async validateById(entitlementId: number): Promise<{
    valid: boolean;
    entitlement: typeof epochRedemptionEntitlements.$inferSelect;
    violations: string[];
  }> {
    const entitlement = await this.getById(entitlementId);
    if (!entitlement) {
      throw new Error(`Entitlement ${entitlementId} not found`);
    }

    const validation = this.validateLedgerInvariants(entitlement);
    return {
      valid: validation.valid,
      entitlement,
      violations: validation.violatedInvariants,
    };
  }

  /**
   * Validate all entitlements for an epoch.
   * Returns list of all invariant violations found.
   */
  async validateAllForEpoch(epochId: string): Promise<{
    totalChecked: number;
    validCount: number;
    invalidCount: number;
    violations: Array<{
      entitlementId: number;
      userAddress: string;
      violations: string[];
    }>;
  }> {
    const entitlements = await this.getByEpoch(epochId);
    const violations: Array<{ entitlementId: number; userAddress: string; violations: string[] }> = [];
    let validCount = 0;

    for (const entitlement of entitlements) {
      const validation = this.validateLedgerInvariants(entitlement);
      if (!validation.valid) {
        violations.push({
          entitlementId: entitlement.id,
          userAddress: entitlement.userAddress,
          violations: validation.violatedInvariants,
        });
      } else {
        validCount++;
      }
    }

    logger.info('EntitlementRepository: Validated epoch ledger invariants', {
      epochId,
      totalChecked: entitlements.length,
      validCount,
      invalidCount: violations.length,
    });

    return {
      totalChecked: entitlements.length,
      validCount,
      invalidCount: violations.length,
      violations,
    };
  }

  /**
   * Reconcile carryRemaining calculation deterministically.
   * Ensures: carryRemaining = entitlement - claimed (loss-aware)
   * 
   * NOTE: This does NOT silently auto-correct without logging.
   * Any correction is logged with full context.
   */
  async reconcileCarryRemaining(entitlementId: number): Promise<{
    success: boolean;
    oldCarryRemaining?: string;
    newCarryRemaining?: string;
    corrected?: boolean;
    error?: string;
  }> {
    try {
      const entitlement = await this.getById(entitlementId);
      if (!entitlement) {
        return { success: false, error: 'Entitlement not found' };
      }

      const entitlementAmount = BigInt(entitlement.entitlement);
      const claimed = BigInt(entitlement.claimed);
      
      // Deterministic calculation: carryRemaining = entitlement - claimed
      // This is loss-aware: if claimed > entitlement due to bug, carryRemaining will be negative
      const expectedCarryRemaining = entitlementAmount - claimed;
      const currentCarryRemaining = BigInt(entitlement.carryRemaining);

      if (currentCarryRemaining !== expectedCarryRemaining) {
        // Log the mismatch BEFORE any correction (requirement: no silent auto-correct)
        logger.warn('EntitlementRepository: carryRemaining mismatch detected', {
          entitlementId,
          requestId: entitlement.requestId,
          userAddress: entitlement.userAddress,
          epochId: entitlement.epochId,
          currentCarryRemaining: currentCarryRemaining.toString(),
          expectedCarryRemaining: expectedCarryRemaining.toString(),
          entitlement: entitlementAmount.toString(),
          claimed: claimed.toString(),
          reason: 'CARRY_REMAINING_CALCULATION_ERROR',
        });

        const results = await this.database
          .update(epochRedemptionEntitlements)
          .set({
            carryRemaining: expectedCarryRemaining.toString(),
            updatedAt: new Date(),
          })
          .where(eq(epochRedemptionEntitlements.id, entitlementId))
          .returning();

        logger.info('EntitlementRepository: Reconciled carryRemaining (with audit log)', {
          entitlementId,
          oldCarryRemaining: currentCarryRemaining.toString(),
          newCarryRemaining: expectedCarryRemaining.toString(),
        });

        return {
          success: true,
          oldCarryRemaining: currentCarryRemaining.toString(),
          newCarryRemaining: expectedCarryRemaining.toString(),
          corrected: true,
        };
      }

      return {
        success: true,
        oldCarryRemaining: currentCarryRemaining.toString(),
        newCarryRemaining: currentCarryRemaining.toString(),
        corrected: false,
      };
    } catch (error) {
      logger.error('EntitlementRepository: Reconcile carryRemaining failed', {
        error: (error as Error).message,
        entitlementId,
      });
      return {
        success: false,
        error: `Failed to reconcile: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================================
  // Deterministic Reconciliation - Contract vs Repository State
  // ============================================================================

  /**
   * Compare canonical fields with legacy fields for an entitlement.
   * Detects dual-ledger drift and returns detailed mismatch information.
   * 
   * The reconciliation follows the explicit field mapping:
   * - accrued (canonical) should match totalRealizedUsdc (legacy)
   * - claimed (canonical) should match totalClaimedUsdc (legacy)
   */
  async reconcileEntitlement(entitlementId: number): Promise<EntitlementReconcileResult> {
    const entitlement = await this.getById(entitlementId);
    if (!entitlement) {
      return {
        entitlementId,
        requestId: 'unknown',
        matches: false,
        mismatches: [{
          entitlementId,
          requestId: 'unknown',
          userAddress: 'unknown',
          epochId: 'unknown',
          field: 'entitlement',
          canonicalValue: '0',
          legacyValue: '0',
          reason: 'LEDGER_INVARIANT_VIOLATION',
          details: `Entitlement ${entitlementId} not found in repository`,
        }],
      };
    }

    const mismatches: ReconcileMismatch[] = [];

    // Check 1: accrued (canonical) vs totalRealizedUsdc (legacy)
    const accrued = BigInt(entitlement.accrued);
    const totalRealizedUsdc = BigInt(entitlement.totalRealizedUsdc);
    if (accrued !== totalRealizedUsdc) {
      mismatches.push({
        entitlementId: entitlement.id,
        requestId: entitlement.requestId,
        userAddress: entitlement.userAddress,
        epochId: entitlement.epochId,
        field: 'accrued/totalRealizedUsdc',
        canonicalValue: accrued.toString(),
        legacyValue: totalRealizedUsdc.toString(),
        reason: 'CANONICAL_LEGACY_ACCRUED_MISMATCH',
        details: `Canonical 'accrued' (${accrued.toString()}) does not match legacy 'totalRealizedUsdc' (${totalRealizedUsdc.toString()})`,
      });
    }

    // Check 2: claimed (canonical) vs totalClaimedUsdc (legacy)
    const claimed = BigInt(entitlement.claimed);
    const totalClaimedUsdc = BigInt(entitlement.totalClaimedUsdc);
    if (claimed !== totalClaimedUsdc) {
      mismatches.push({
        entitlementId: entitlement.id,
        requestId: entitlement.requestId,
        userAddress: entitlement.userAddress,
        epochId: entitlement.epochId,
        field: 'claimed/totalClaimedUsdc',
        canonicalValue: claimed.toString(),
        legacyValue: totalClaimedUsdc.toString(),
        reason: 'CANONICAL_LEGACY_CLAIMED_MISMATCH',
        details: `Canonical 'claimed' (${claimed.toString()}) does not match legacy 'totalClaimedUsdc' (${totalClaimedUsdc.toString()})`,
      });
    }

    // Check 3: carryRemaining calculation
    const entitlementAmount = BigInt(entitlement.entitlement);
    const expectedCarryRemaining = entitlementAmount - claimed;
    const actualCarryRemaining = BigInt(entitlement.carryRemaining);
    if (actualCarryRemaining !== expectedCarryRemaining) {
      mismatches.push({
        entitlementId: entitlement.id,
        requestId: entitlement.requestId,
        userAddress: entitlement.userAddress,
        epochId: entitlement.epochId,
        field: 'carryRemaining',
        canonicalValue: actualCarryRemaining.toString(),
        legacyValue: 'N/A',
        expectedValue: expectedCarryRemaining.toString(),
        reason: 'CARRY_REMAINING_CALCULATION_ERROR',
        details: `carryRemaining (${actualCarryRemaining.toString()}) != entitlement (${entitlementAmount.toString()}) - claimed (${claimed.toString()})`,
      });
    }

    const matches = mismatches.length === 0;

    if (!matches) {
      logger.warn('EntitlementRepository: Reconciliation mismatch detected', {
        entitlementId: entitlement.id,
        requestId: entitlement.requestId,
        mismatchCount: mismatches.length,
        mismatches: mismatches.map(m => ({
          field: m.field,
          reason: m.reason,
          canonical: m.canonicalValue,
          legacy: m.legacyValue,
        })),
      });
    }

    return {
      entitlementId: entitlement.id,
      requestId: entitlement.requestId,
      matches,
      mismatches,
    };
  }

  /**
   * Reconcile all entitlements for an epoch against contract state.
   * This is the main reconciliation entry point.
   * 
   * @param epochId - The epoch to reconcile
   * @param contractStates - Optional: Contract states for comparison (if not provided, only validates repository consistency)
   * @returns Full reconciliation report
   */
  async reconcileEpoch(
    epochId: string,
    contractStates?: ContractEntitlementState[],
  ): Promise<ReconciliationReport> {
    const entitlements = await this.getByEpoch(epochId);
    const allMismatches: ReconcileMismatch[] = [];
    let matchingCount = 0;

    logger.info('EntitlementRepository: Starting epoch reconciliation', {
      epochId,
      entitlementCount: entitlements.length,
      hasContractStates: !!contractStates && contractStates.length > 0,
    });

    for (const entitlement of entitlements) {
      // First: reconcile repository internal consistency
      const internalResult = await this.reconcileEntitlement(entitlement.id);
      
      if (!internalResult.matches) {
        allMismatches.push(...internalResult.mismatches);
      }

      // Second: if contract states provided, compare with contract
      if (contractStates) {
        const contractState = contractStates.find(
          cs => cs.requestId.toLowerCase() === entitlement.requestId.toLowerCase()
        );
        
        if (contractState) {
          const contractMismatches = this.compareWithContract(entitlement, contractState);
          if (contractMismatches.length > 0) {
            allMismatches.push(...contractMismatches);
          }
        } else {
          // Contract state not found for this entitlement
          logger.warn('EntitlementRepository: No contract state found for entitlement', {
            entitlementId: entitlement.id,
            requestId: entitlement.requestId,
            epochId,
          });
        }
      }

      if (internalResult.matches && (!contractStates || allMismatches.length === 0)) {
        matchingCount++;
      }
    }

    // Calculate explained vs unexplained deltas
    const explainedReasons = ['CANONICAL_LEGACY_ACCRUED_MISMATCH', 'CANONICAL_LEGACY_CLAIMED_MISMATCH'];
    const explainedDeltas = allMismatches.filter(m => explainedReasons.includes(m.reason)).length;
    const unexplainedDeltas = allMismatches.filter(m => !explainedReasons.includes(m.reason)).length;

    const report: ReconciliationReport = {
      epochId,
      timestamp: new Date(),
      totalEntitlements: entitlements.length,
      matchingCount,
      mismatchCount: entitlements.length - matchingCount,
      mismatches: allMismatches,
      summary: {
        explainedDeltas,
        unexplainedDeltas,
      },
    };

    logger.info('EntitlementRepository: Epoch reconciliation complete', {
      epochId,
      totalEntitlements: report.totalEntitlements,
      matchingCount: report.matchingCount,
      mismatchCount: report.mismatchCount,
      explainedDeltas: report.summary.explainedDeltas,
      unexplainedDeltas: report.summary.unexplainedDeltas,
    });

    return report;
  }

  /**
   * Compare repository entitlement with contract state.
   * Returns list of mismatches found.
   */
  private compareWithContract(
    entitlement: typeof epochRedemptionEntitlements.$inferSelect,
    contractState: ContractEntitlementState,
  ): ReconcileMismatch[] {
    const mismatches: ReconcileMismatch[] = [];

    // Compare accrued/totalRealizedUsdc
    const repoAccrued = BigInt(entitlement.accrued);
    const contractAccrued = BigInt(contractState.totalRealizedUsdc);
    if (repoAccrued !== contractAccrued) {
      mismatches.push({
        entitlementId: entitlement.id,
        requestId: entitlement.requestId,
        userAddress: entitlement.userAddress,
        epochId: entitlement.epochId,
        field: 'accrued (contract)',
        canonicalValue: repoAccrued.toString(),
        legacyValue: contractAccrued.toString(),
        reason: 'CONTRACT_REPOSITORY_MISMATCH',
        details: `Repository accrued (${repoAccrued.toString()}) does not match contract totalRealizedUsdc (${contractAccrued.toString()})`,
      });
    }

    // Compare claimed/totalClaimedUsdc
    const repoClaimed = BigInt(entitlement.claimed);
    const contractClaimed = BigInt(contractState.totalClaimedUsdc);
    if (repoClaimed !== contractClaimed) {
      mismatches.push({
        entitlementId: entitlement.id,
        requestId: entitlement.requestId,
        userAddress: entitlement.userAddress,
        epochId: entitlement.epochId,
        field: 'claimed (contract)',
        canonicalValue: repoClaimed.toString(),
        legacyValue: contractClaimed.toString(),
        reason: 'CONTRACT_REPOSITORY_MISMATCH',
        details: `Repository claimed (${repoClaimed.toString()}) does not match contract totalClaimedUsdc (${contractClaimed.toString()})`,
      });
    }

    return mismatches;
  }

  /**
   * Run full reconciliation and report zero unexplained deltas requirement.
   * This method is used for health checks and monitoring.
   * 
   * @returns true if reconciliation reports zero unexplained deltas
   */
  async isReconciled(epochId: string, contractStates?: ContractEntitlementState[]): Promise<{
    reconciled: boolean;
    report: ReconciliationReport;
  }> {
    const report = await this.reconcileEpoch(epochId, contractStates);
    
    return {
      reconciled: report.summary.unexplainedDeltas === 0,
      report,
    };
  }
}

export const entitlementRepository = new EntitlementRepository();
