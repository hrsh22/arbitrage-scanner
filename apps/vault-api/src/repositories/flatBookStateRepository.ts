import { and, desc, eq, sql } from "drizzle-orm";
import { formatUnits, parseUnits } from "viem";
import { logger } from "../logger.js";
import {
  flatBookCycles,
  flatBookProcessingEvents,
  flatBookQueueParticipants,
  flatBookCycleStateEnum,
  flatBookEventTypeEnum,
} from "../db/schema.js";

type FlatBookCycleState = (typeof flatBookCycleStateEnum.enumValues)[number];
type FlatBookEventType = (typeof flatBookEventTypeEnum.enumValues)[number];

interface UpsertCycleInput {
  vaultAddress: string;
  cycleId: number;
  state: FlatBookCycleState;
  lockedNav?: string;
  totalQueuedDepositAssets?: string;
  totalQueuedRedeemShares?: string;
  totalQueuedRedeemAssets?: string;
  queuedDepositParticipants?: number;
  queuedRedeemParticipants?: number;
  openedAt?: Date;
  closedAt?: Date;
  processingStartedAt?: Date;
  processedAt?: Date;
}

interface RecordQueuedDepositInput {
  vaultAddress: string;
  cycleId: number;
  userAddress: string;
  assetAmount: string;
  occurredAt: Date;
}

interface MarkDepositProcessedInput {
  vaultAddress: string;
  cycleId: number;
  userAddress: string;
  queuedDepositAssets?: string;
  processedDepositShares: string;
  processedAt: Date;
}

interface EnsureQueueParticipantInput {
  vaultAddress: string;
  cycleId: number;
  userAddress: string;
  queuedDepositAssets?: string;
  status?: "queued" | "processed" | "cancelled";
  firstQueuedAt?: Date;
  processedDepositShares?: string;
  processedAt?: Date;
}

interface RecordProcessingEventInput {
  vaultAddress: string;
  cycleId: number;
  eventType: FlatBookEventType;
  txHash?: string;
  processedCount?: number;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

async function getDb() {
  const { db } = await import("../db/index.js");
  return db;
}

function addDecimalStrings(left: string, right: string, decimals: number): string {
  return formatUnits(parseUnits(left, decimals) + parseUnits(right, decimals), decimals);
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function eqLower(column: { name?: string }, value: string) {
  return sql`lower(${column}) = ${normalizeAddress(value)}`;
}

class FlatBookStateRepository {
  async upsertCycle(input: UpsertCycleInput): Promise<void> {
    try {
      const db = await getDb();
      const vaultAddress = normalizeAddress(input.vaultAddress);
      const existing = await db
        .select()
        .from(flatBookCycles)
        .where(
          and(
            eqLower(flatBookCycles.vaultAddress, vaultAddress),
            eq(flatBookCycles.cycleId, input.cycleId),
          ),
        )
        .orderBy(desc(flatBookCycles.createdAt))
        .limit(1);

      const values = {
        state: input.state,
        lockedNav: input.lockedNav,
        totalQueuedDepositAssets: input.totalQueuedDepositAssets,
        totalQueuedRedeemShares: input.totalQueuedRedeemShares,
        totalQueuedRedeemAssets: input.totalQueuedRedeemAssets,
        queuedDepositParticipants: input.queuedDepositParticipants,
        queuedRedeemParticipants: input.queuedRedeemParticipants,
        openedAt: input.openedAt,
        closedAt: input.closedAt,
        processingStartedAt: input.processingStartedAt,
        processedAt: input.processedAt,
        updatedAt: new Date(),
      };

      const current = existing[0];
      if (current) {
        await db
          .update(flatBookCycles)
          .set({
            state: values.state,
            lockedNav: values.lockedNav ?? current.lockedNav,
            totalQueuedDepositAssets:
              values.totalQueuedDepositAssets ?? current.totalQueuedDepositAssets,
            totalQueuedRedeemShares:
              values.totalQueuedRedeemShares ?? current.totalQueuedRedeemShares,
            totalQueuedRedeemAssets:
              values.totalQueuedRedeemAssets ?? current.totalQueuedRedeemAssets,
            queuedDepositParticipants:
              values.queuedDepositParticipants ?? current.queuedDepositParticipants,
            queuedRedeemParticipants:
              values.queuedRedeemParticipants ?? current.queuedRedeemParticipants,
            openedAt: values.openedAt ?? current.openedAt,
            closedAt: values.closedAt ?? current.closedAt,
            processingStartedAt: values.processingStartedAt ?? current.processingStartedAt,
            processedAt: values.processedAt ?? current.processedAt,
            updatedAt: values.updatedAt,
          })
          .where(eq(flatBookCycles.id, current.id));
        return;
      }

      await db.insert(flatBookCycles).values({
        vaultAddress,
        cycleId: input.cycleId,
        state: input.state,
        lockedNav: input.lockedNav ?? "0",
        totalQueuedDepositAssets: input.totalQueuedDepositAssets ?? "0",
        totalQueuedRedeemShares: input.totalQueuedRedeemShares ?? "0",
        totalQueuedRedeemAssets: input.totalQueuedRedeemAssets ?? "0",
        queuedDepositParticipants: input.queuedDepositParticipants ?? 0,
        queuedRedeemParticipants: input.queuedRedeemParticipants ?? 0,
        openedAt: input.openedAt ?? new Date(),
        closedAt: input.closedAt,
        processingStartedAt: input.processingStartedAt,
        processedAt: input.processedAt,
      });
    } catch (error) {
      logger.warn("FlatBookStateRepository: Failed to upsert cycle", {
        vaultAddress: input.vaultAddress,
        cycleId: input.cycleId,
        error: (error as Error).message,
      });
    }
  }

  async recordQueuedDeposit(input: RecordQueuedDepositInput): Promise<void> {
    try {
      const db = await getDb();
      const vaultAddress = normalizeAddress(input.vaultAddress);
      const userAddress = normalizeAddress(input.userAddress);
      const existing = await db
        .select()
        .from(flatBookQueueParticipants)
        .where(
          and(
            eqLower(flatBookQueueParticipants.vaultAddress, vaultAddress),
            eq(flatBookQueueParticipants.cycleId, input.cycleId),
            eqLower(flatBookQueueParticipants.userAddress, userAddress),
          ),
        )
        .orderBy(desc(flatBookQueueParticipants.createdAt))
        .limit(1);

      const current = existing[0];
      if (current) {
        await db
          .update(flatBookQueueParticipants)
          .set({
            queuedDepositAssets: addDecimalStrings(
              current.queuedDepositAssets,
              input.assetAmount,
              6,
            ),
            status: current.status === "cancelled" ? "queued" : current.status,
            updatedAt: new Date(),
          })
          .where(eq(flatBookQueueParticipants.id, current.id));
        return;
      }

      await db.insert(flatBookQueueParticipants).values({
        vaultAddress,
        cycleId: input.cycleId,
        userAddress,
        queuedDepositAssets: input.assetAmount,
        status: "queued",
        firstQueuedAt: input.occurredAt,
      });
    } catch (error) {
      logger.warn("FlatBookStateRepository: Failed to record queued deposit", {
        vaultAddress: input.vaultAddress,
        cycleId: input.cycleId,
        userAddress: input.userAddress,
        error: (error as Error).message,
      });
    }
  }

  async markDepositProcessed(input: MarkDepositProcessedInput): Promise<void> {
    try {
      const db = await getDb();
      const vaultAddress = normalizeAddress(input.vaultAddress);
      const userAddress = normalizeAddress(input.userAddress);
      const existing = await db
        .select()
        .from(flatBookQueueParticipants)
        .where(
          and(
            eqLower(flatBookQueueParticipants.vaultAddress, vaultAddress),
            eq(flatBookQueueParticipants.cycleId, input.cycleId),
            eqLower(flatBookQueueParticipants.userAddress, userAddress),
          ),
        )
        .orderBy(desc(flatBookQueueParticipants.createdAt))
        .limit(1);

      const current = existing[0];
      if (!current) {
        await db.insert(flatBookQueueParticipants).values({
          vaultAddress,
          cycleId: input.cycleId,
          userAddress,
          queuedDepositAssets: input.queuedDepositAssets ?? "0",
          processedDepositShares: input.processedDepositShares,
          status: "processed",
          firstQueuedAt: input.processedAt,
          processedAt: input.processedAt,
        });
        return;
      }

      await db
        .update(flatBookQueueParticipants)
        .set({
          queuedDepositAssets: input.queuedDepositAssets ?? current.queuedDepositAssets,
          processedDepositShares: input.processedDepositShares,
          status: "processed",
          processedAt: input.processedAt,
          updatedAt: new Date(),
        })
        .where(eq(flatBookQueueParticipants.id, current.id));
    } catch (error) {
      logger.warn("FlatBookStateRepository: Failed to mark deposit processed", {
        vaultAddress: input.vaultAddress,
        cycleId: input.cycleId,
        userAddress: input.userAddress,
        error: (error as Error).message,
      });
    }
  }

  async ensureQueueParticipant(input: EnsureQueueParticipantInput): Promise<void> {
    try {
      const db = await getDb();
      const vaultAddress = normalizeAddress(input.vaultAddress);
      const userAddress = normalizeAddress(input.userAddress);
      const existing = await db
        .select()
        .from(flatBookQueueParticipants)
        .where(
          and(
            eqLower(flatBookQueueParticipants.vaultAddress, vaultAddress),
            eq(flatBookQueueParticipants.cycleId, input.cycleId),
            eqLower(flatBookQueueParticipants.userAddress, userAddress),
          ),
        )
        .orderBy(desc(flatBookQueueParticipants.createdAt))
        .limit(1);

      const current = existing[0];
      if (current) {
        await db
          .update(flatBookQueueParticipants)
          .set({
            queuedDepositAssets: input.queuedDepositAssets ?? current.queuedDepositAssets,
            processedDepositShares: input.processedDepositShares ?? current.processedDepositShares,
            status: input.status ?? current.status,
            firstQueuedAt: input.firstQueuedAt ?? current.firstQueuedAt,
            processedAt: input.processedAt ?? current.processedAt,
            updatedAt: new Date(),
          })
          .where(eq(flatBookQueueParticipants.id, current.id));
        return;
      }

      await db.insert(flatBookQueueParticipants).values({
        vaultAddress,
        cycleId: input.cycleId,
        userAddress,
        queuedDepositAssets: input.queuedDepositAssets ?? "0",
        processedDepositShares: input.processedDepositShares ?? "0",
        status: input.status ?? "queued",
        firstQueuedAt: input.firstQueuedAt ?? new Date(),
        processedAt: input.processedAt,
      });
    } catch (error) {
      logger.warn("FlatBookStateRepository: Failed to ensure queue participant", {
        vaultAddress: input.vaultAddress,
        cycleId: input.cycleId,
        userAddress: input.userAddress,
        error: (error as Error).message,
      });
    }
  }

  async getQueueParticipant(vaultAddress: string, cycleId: number, userAddress: string) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(flatBookQueueParticipants)
      .where(
        and(
          eqLower(flatBookQueueParticipants.vaultAddress, vaultAddress),
          eq(flatBookQueueParticipants.cycleId, cycleId),
          eqLower(flatBookQueueParticipants.userAddress, userAddress),
        ),
      )
      .orderBy(desc(flatBookQueueParticipants.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  async listDepositParticipantAddresses(vaultAddress: string): Promise<string[]> {
    try {
      const db = await getDb();
      const rows = await db
        .select({ userAddress: flatBookQueueParticipants.userAddress })
        .from(flatBookQueueParticipants)
        .where(eqLower(flatBookQueueParticipants.vaultAddress, vaultAddress));

      return [...new Set(rows.map((row) => row.userAddress.toLowerCase()))];
    } catch (error) {
      logger.warn("FlatBookStateRepository: Failed to list deposit participants", {
        vaultAddress,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async recordProcessingEvent(input: RecordProcessingEventInput): Promise<void> {
    try {
      const db = await getDb();
      await db.insert(flatBookProcessingEvents).values({
        vaultAddress: normalizeAddress(input.vaultAddress),
        cycleId: input.cycleId,
        eventType: input.eventType,
        txHash: input.txHash,
        processedCount: input.processedCount,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: input.createdAt ?? new Date(),
      });
    } catch (error) {
      logger.warn("FlatBookStateRepository: Failed to record processing event", {
        vaultAddress: input.vaultAddress,
        cycleId: input.cycleId,
        eventType: input.eventType,
        error: (error as Error).message,
      });
    }
  }
}

export const flatBookStateRepository = new FlatBookStateRepository();
