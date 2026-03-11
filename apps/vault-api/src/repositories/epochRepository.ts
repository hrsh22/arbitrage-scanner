/**
 * Epoch Repository
 * CRUD operations for epochs, epoch requests, and NAV snapshots
 * with strict state machine validation for cohort-carry lifecycle.
 *
 * Cohort-Carry Lifecycle:
 *   Epochs: pending -> frozen -> claimable -> closed
 *   Requests: pending -> frozen -> claimable -> claimed -> closed
 *   NO backward transitions allowed
 */

import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { epochs, epochRequests, navSnapshots } from "../db/schema.js";
import type {
  Epoch,
  EpochRequest,
  EpochStatus,
  EpochRequestStatus,
  EpochStateTransitionResult,
  CreateEpochRequestInput,
  CreateEpochInput,
  CreateNavSnapshotInput,
} from "../types.js";

type DbClient = typeof defaultDb;

/** Valid epoch status transitions - Cohort-Carry Lifecycle */
export const validEpochTransitions: Record<EpochStatus, EpochStatus[]> = {
  pending: ["frozen", "cancelled"],
  frozen: ["claimable", "cancelled"],
  claimable: ["closed", "cancelled"],
  closed: [], // Terminal state
  cancelled: [], // Terminal state
};

/** Valid epoch request status transitions - Cohort-Carry Lifecycle */
export const validEpochRequestTransitions: Record<EpochRequestStatus, EpochRequestStatus[]> = {
  pending: ["frozen", "cancelled"],
  frozen: ["claimable", "cancelled"],
  claimable: ["claimed", "closed"],
  claimed: ["closed"],
  closed: [], // Terminal state
  cancelled: [], // Terminal state
};

/** Check if epoch transition is valid */
export function isValidEpochTransition(fromStatus: EpochStatus, toStatus: EpochStatus): boolean {
  if (fromStatus === toStatus) return true;
  return validEpochTransitions[fromStatus]?.includes(toStatus) ?? false;
}

/** Check if epoch request transition is valid */
export function isValidEpochRequestTransition(
  fromStatus: EpochRequestStatus,
  toStatus: EpochRequestStatus,
): boolean {
  if (fromStatus === toStatus) return true;
  return validEpochRequestTransitions[fromStatus]?.includes(toStatus) ?? false;
}

export class EpochRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  // ============================================================================
  // Epoch Operations
  // ============================================================================

  /** Create a new epoch */
  async createEpoch(input: CreateEpochInput) {
    const results = await this.database
      .insert(epochs)
      .values({
        epochId: input.epochId,
        vaultAddress: input.vaultAddress,
        startTime: input.startTime,
        endTime: input.endTime,
        status: "pending",
        totalSharesRequested: "0",
        totalAssetsToClaim: "0",
      })
      .returning();
    return results[0]!;
  }

  /** Get epoch by ID */
  async getEpochById(epochId: string) {
    const results = await this.database
      .select()
      .from(epochs)
      .where(eq(epochs.epochId, epochId))
      .limit(1);
    return results[0] ?? null;
  }

  /** Get epochs by vault address */
  async getEpochsByVault(vaultAddress: string, status?: EpochStatus) {
    if (status) {
      return this.database
        .select()
        .from(epochs)
        .where(and(eq(epochs.vaultAddress, vaultAddress), eq(epochs.status, status)))
        .orderBy(desc(epochs.startTime));
    }
    return this.database
      .select()
      .from(epochs)
      .where(eq(epochs.vaultAddress, vaultAddress))
      .orderBy(desc(epochs.startTime));
  }

  /** Get all claimable epochs across all vaults */
  async getAllClaimableEpochs() {
    return this.database
      .select()
      .from(epochs)
      .where(eq(epochs.status, "claimable"))
      .orderBy(desc(epochs.claimableAt));
  }

  /** Get all closed epochs across all vaults */
  async getAllClosedEpochs() {
    return this.database
      .select()
      .from(epochs)
      .where(eq(epochs.status, "closed"))
      .orderBy(desc(epochs.closedAt));
  }

  /** Alias for getAllClosedEpochs for backward compatibility */
  async getAllSettledEpochs() {
    return this.getAllClosedEpochs();
  }

  /** Get current pending epoch for vault */
  async getCurrentEpoch(vaultAddress: string) {
    const results = await this.database
      .select()
      .from(epochs)
      .where(and(eq(epochs.vaultAddress, vaultAddress), eq(epochs.status, "pending")))
      .orderBy(desc(epochs.startTime))
      .limit(1);
    return results[0] ?? null;
  }

  /** Get current frozen epoch for vault */
  async getFrozenEpoch(vaultAddress: string) {
    const results = await this.database
      .select()
      .from(epochs)
      .where(and(eq(epochs.vaultAddress, vaultAddress), eq(epochs.status, "frozen")))
      .orderBy(desc(epochs.startTime))
      .limit(1);
    return results[0] ?? null;
  }

  /** Transition epoch status with validation - Cohort-Carry Lifecycle */
  async transitionEpochStatus(
    epochId: string,
    targetStatus: EpochStatus,
  ): Promise<EpochStateTransitionResult> {
    const epoch = await this.getEpochById(epochId);

    if (!epoch) {
      return { success: false, error: "Epoch not found" };
    }

    const currentStatus = epoch.status as EpochStatus;

    // Idempotency: already in target state
    if (currentStatus === targetStatus) {
      return { success: true, entity: epoch as Epoch, alreadyInTargetState: true };
    }

    // Validate transition
    if (!isValidEpochTransition(currentStatus, targetStatus)) {
      return {
        success: false,
        entity: epoch as Epoch,
        error: `Invalid epoch transition: '${currentStatus}' → '${targetStatus}'`,
      };
    }

    // Build update data with cohort-carry timestamps
    const updateData: Record<string, unknown> = {
      status: targetStatus,
      updatedAt: new Date(),
    };

    if (targetStatus === "frozen") {
      updateData.frozenAt = new Date();
    } else if (targetStatus === "claimable") {
      updateData.claimableAt = new Date();
    } else if (targetStatus === "closed") {
      updateData.closedAt = new Date();
    }

    const results = await this.database
      .update(epochs)
      .set(updateData)
      .where(eq(epochs.epochId, epochId))
      .returning();
    return { success: true, entity: results[0] as Epoch, alreadyInTargetState: false };
  }

  /** Freeze epoch (transition from pending to frozen) */
  async freezeEpoch(epochId: string): Promise<EpochStateTransitionResult> {
    return this.transitionEpochStatus(epochId, "frozen");
  }

  /** Make epoch claimable (transition from frozen to claimable) */
  async makeEpochClaimable(epochId: string): Promise<EpochStateTransitionResult> {
    return this.transitionEpochStatus(epochId, "claimable");
  }

  /** Close epoch (transition to closed) */
  async closeEpoch(epochId: string): Promise<EpochStateTransitionResult> {
    return this.transitionEpochStatus(epochId, "closed");
  }

  /** Update epoch with settlement data - Cohort-Carry Model */
  async setEpochSettlement(
    epochId: string,
    settlementData: {
      navSnapshotId: number;
      totalSharesRequested: string;
      totalAssetsToClaim: string;
      proRataRatio: string;
      settlementTxHash?: string;
    },
  ) {
    const results = await this.database
      .update(epochs)
      .set({
        ...settlementData,
        status: "frozen", // After settlement, epoch is frozen
        frozenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(epochs.epochId, epochId))
      .returning();
    return results[0] ?? null;
  }

  // ============================================================================
  // Epoch Request Operations - Cohort-Carry Lifecycle
  // ============================================================================

  /** Create a new redemption request */
  async createRequest(input: CreateEpochRequestInput) {
    const results = await this.database
      .insert(epochRequests)
      .values({
        requestId: input.requestId,
        userAddress: input.userAddress,
        vaultAddress: input.vaultAddress,
        shares: input.shares,
        epochId: input.epochId,
        status: "pending",
        claimedAssets: "0",
      })
      .returning();
    return results[0]!;
  }

  /** Get request by ID */
  async getRequestById(requestId: string) {
    const results = await this.database
      .select()
      .from(epochRequests)
      .where(eq(epochRequests.requestId, requestId))
      .limit(1);
    return results[0] ?? null;
  }

  /** Get all requests for a user */
  async getRequestsByUser(userAddress: string, vaultAddress?: string) {
    if (vaultAddress) {
      return this.database
        .select()
        .from(epochRequests)
        .where(
          and(
            eq(epochRequests.userAddress, userAddress),
            eq(epochRequests.vaultAddress, vaultAddress),
          ),
        )
        .orderBy(desc(epochRequests.createdAt));
    }
    return this.database
      .select()
      .from(epochRequests)
      .where(eq(epochRequests.userAddress, userAddress))
      .orderBy(desc(epochRequests.createdAt));
  }

  /** Get requests by epoch */
  async getRequestsByEpoch(epochId: string, status?: EpochRequestStatus) {
    if (status) {
      return this.database
        .select()
        .from(epochRequests)
        .where(and(eq(epochRequests.epochId, epochId), eq(epochRequests.status, status)))
        .orderBy(asc(epochRequests.createdAt));
    }
    return this.database
      .select()
      .from(epochRequests)
      .where(eq(epochRequests.epochId, epochId))
      .orderBy(asc(epochRequests.createdAt));
  }

  /** Get pending requests for an epoch */
  async getPendingRequestsForEpoch(epochId: string) {
    return this.database
      .select()
      .from(epochRequests)
      .where(and(eq(epochRequests.epochId, epochId), eq(epochRequests.status, "pending")))
      .orderBy(asc(epochRequests.createdAt));
  }

  /** Get frozen requests for an epoch */
  async getFrozenRequestsForEpoch(epochId: string) {
    return this.database
      .select()
      .from(epochRequests)
      .where(and(eq(epochRequests.epochId, epochId), eq(epochRequests.status, "frozen")))
      .orderBy(asc(epochRequests.createdAt));
  }

  /** Transition request status with validation - Cohort-Carry Lifecycle */
  async transitionRequestStatus(
    requestId: string,
    targetStatus: EpochRequestStatus,
    metadata?: {
      claimableAssets?: string;
      claimTxHash?: string;
      cancelledAt?: Date;
      frozenAt?: Date;
      claimableAt?: Date;
      claimedAt?: Date;
      closedAt?: Date;
    },
  ): Promise<EpochStateTransitionResult> {
    const request = await this.getRequestById(requestId);

    if (!request) {
      return { success: false, error: "Request not found" };
    }

    const currentStatus = request.status as EpochRequestStatus;

    // Idempotency: already in target state
    if (currentStatus === targetStatus) {
      return { success: true, entity: request as EpochRequest, alreadyInTargetState: true };
    }

    // Validate transition
    if (!isValidEpochRequestTransition(currentStatus, targetStatus)) {
      return {
        success: false,
        entity: request as EpochRequest,
        error: `Invalid request transition: '${currentStatus}' → '${targetStatus}'`,
      };
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      status: targetStatus,
      updatedAt: new Date(),
    };

    // Add status-specific timestamps and metadata
    if (targetStatus === "cancelled") {
      updateData.cancelledAt = metadata?.cancelledAt ?? new Date();
    } else if (targetStatus === "frozen") {
      updateData.frozenAt = metadata?.frozenAt ?? new Date();
    } else if (targetStatus === "claimable") {
      updateData.claimableAt = metadata?.claimableAt ?? new Date();
      if (metadata?.claimableAssets) {
        updateData.claimableAssets = metadata.claimableAssets;
      }
    } else if (targetStatus === "claimed") {
      updateData.claimedAt = metadata?.claimedAt ?? new Date();
      if (metadata?.claimTxHash) {
        updateData.claimTxHash = metadata.claimTxHash;
      }
      if (metadata?.claimableAssets) {
        updateData.claimedAssets = metadata.claimableAssets;
      }
    } else if (targetStatus === "closed") {
      updateData.closedAt = metadata?.closedAt ?? new Date();
    }

    const results = await this.database
      .update(epochRequests)
      .set(updateData)
      .where(eq(epochRequests.requestId, requestId))
      .returning();
    return { success: true, entity: results[0] as EpochRequest, alreadyInTargetState: false };
  }

  /** Freeze a pending request (transition to frozen) */
  async freezeRequest(requestId: string): Promise<EpochStateTransitionResult> {
    return this.transitionRequestStatus(requestId, "frozen", { frozenAt: new Date() });
  }

  /** Cancel a pending or frozen request (idempotent) */
  async cancelRequest(requestId: string): Promise<EpochStateTransitionResult> {
    return this.transitionRequestStatus(requestId, "cancelled", { cancelledAt: new Date() });
  }

  /** Mark request as claimable with claimable amount */
  async makeRequestClaimable(
    requestId: string,
    claimableAssets: string,
  ): Promise<EpochStateTransitionResult> {
    return this.transitionRequestStatus(requestId, "claimable", {
      claimableAssets,
      claimableAt: new Date(),
    });
  }

  /** Mark request as claimed */
  async claimRequest(requestId: string, claimTxHash: string): Promise<EpochStateTransitionResult> {
    const request = await this.getRequestById(requestId);
    if (!request) {
      return { success: false, error: "Request not found" };
    }

    return this.transitionRequestStatus(requestId, "claimed", {
      claimTxHash,
      claimableAssets: request.claimableAssets ?? "0",
      claimedAt: new Date(),
    });
  }

  /** Close a request (terminal state) */
  async closeRequest(requestId: string): Promise<EpochStateTransitionResult> {
    return this.transitionRequestStatus(requestId, "closed", { closedAt: new Date() });
  }

  /** Get claimable requests for a user (claimable status) */
  async getClaimableRequests(userAddress: string, vaultAddress?: string) {
    const conditions = [
      eq(epochRequests.userAddress, userAddress),
      eq(epochRequests.status, "claimable"),
    ];

    if (vaultAddress) {
      conditions.push(eq(epochRequests.vaultAddress, vaultAddress));
    }

    return this.database
      .select()
      .from(epochRequests)
      .where(and(...conditions))
      .orderBy(desc(epochRequests.claimableAt));
  }

  // ============================================================================
  // NAV Snapshot Operations
  // ============================================================================

  /** Create a NAV snapshot */
  async createNavSnapshot(input: CreateNavSnapshotInput) {
    const results = await this.database
      .insert(navSnapshots)
      .values({
        snapshotId: input.snapshotId,
        epochId: input.epochId,
        vaultAddress: input.vaultAddress,
        totalAssets: input.totalAssets,
        totalShares: input.totalShares,
        sharePrice: input.sharePrice,
        timestamp: input.timestamp,
        recordedBy: input.recordedBy,
        txHash: input.txHash,
        isFresh: true,
      })
      .returning();
    return results[0]!;
  }

  /** Get NAV snapshot by ID */
  async getNavSnapshotById(snapshotId: string) {
    const results = await this.database
      .select()
      .from(navSnapshots)
      .where(eq(navSnapshots.snapshotId, snapshotId))
      .limit(1);
    return results[0] ?? null;
  }

  /** Get NAV snapshot for an epoch */
  async getNavSnapshotForEpoch(epochId: string) {
    const results = await this.database
      .select()
      .from(navSnapshots)
      .where(eq(navSnapshots.epochId, epochId))
      .limit(1);
    return results[0] ?? null;
  }

  /** Mark snapshot as stale */
  async markSnapshotStale(snapshotId: string, reason: string) {
    const results = await this.database
      .update(navSnapshots)
      .set({
        isFresh: false,
        staleReason: reason,
      })
      .where(eq(navSnapshots.snapshotId, snapshotId))
      .returning();
    return results[0] ?? null;
  }

  // ============================================================================
  // Aggregated Queries
  // ============================================================================

  /** Get epoch with request statistics */
  async getEpochWithStats(epochId: string) {
    const epoch = await this.getEpochById(epochId);
    if (!epoch) return null;

    const requests = await this.getRequestsByEpoch(epochId);

    return {
      ...epoch,
      requestCount: requests.length,
      pendingRequestCount: requests.filter((r) => r.status === "pending").length,
      frozenRequestCount: requests.filter((r) => r.status === "frozen").length,
      claimableRequestCount: requests.filter((r) => r.status === "claimable").length,
      claimedCount: requests.filter((r) => r.status === "claimed").length,
      closedCount: requests.filter((r) => r.status === "closed").length,
      cancelledCount: requests.filter((r) => r.status === "cancelled").length,
    };
  }

  /** Get user's requests with epoch metadata */
  async getUserRequestsWithEpochInfo(userAddress: string, vaultAddress?: string) {
    const requests = await this.getRequestsByUser(userAddress, vaultAddress);

    const requestsWithEpochInfo = await Promise.all(
      requests.map(async (request) => {
        const epoch = await this.getEpochById(request.epochId);
        return {
          ...request,
          epochStartTime: epoch?.startTime,
          epochEndTime: epoch?.endTime,
          epochStatus: epoch?.status,
          isClaimable: request.status === "claimable",
          isCancellable: request.status === "pending",
          isFrozen: request.status === "frozen",
        };
      }),
    );

    return requestsWithEpochInfo;
  }

  /** Get total shares requested for an epoch */
  async getTotalSharesRequested(epochId: string): Promise<string> {
    const result = await this.database
      .select({
        total: sql<string>`COALESCE(SUM(${epochRequests.shares}), 0)`,
      })
      .from(epochRequests)
      .where(and(eq(epochRequests.epochId, epochId), eq(epochRequests.status, "pending")));

    return result[0]?.total ?? "0";
  }
}

export const epochRepository = new EpochRepository();
