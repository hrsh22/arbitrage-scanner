import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "../logger.js";
import { userVaultActivityEvents, vaultLifecycleEvents } from "../db/schema.js";

interface VaultLifecycleEventInput {
  vaultId: number;
  vaultAddress: string;
  eventType: string;
  title: string;
  detail: string;
  occurredAt?: Date;
  cycleId?: number;
  requestId?: string;
  txHash?: string;
  status?: string;
  assetAmount?: string;
  shareAmount?: string;
  metadata?: Record<string, unknown>;
}

interface UserVaultActivityEventInput {
  vaultId: number;
  vaultAddress: string;
  userAddress: string;
  eventType: string;
  title: string;
  detail: string;
  occurredAt?: Date;
  cycleId?: number;
  requestId?: string;
  txHash?: string;
  status?: string;
  assetAmount?: string;
  shareAmount?: string;
  metadata?: Record<string, unknown>;
}

async function getDb() {
  const { db } = await import("../db/index.js");
  return db;
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function eqLower(column: { name?: string }, value: string) {
  return sql`lower(${column}) = ${normalizeAddress(value)}`;
}

class ActivityEventRepository {
  async appendVaultLifecycleEvent(input: VaultLifecycleEventInput): Promise<void> {
    try {
      const db = await getDb();
      await db.insert(vaultLifecycleEvents).values({
        vaultId: input.vaultId,
        vaultAddress: input.vaultAddress,
        cycleId: input.cycleId,
        eventType: input.eventType,
        title: input.title,
        detail: input.detail,
        status: input.status,
        requestId: input.requestId,
        txHash: input.txHash,
        assetAmount: input.assetAmount,
        shareAmount: input.shareAmount,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        occurredAt: input.occurredAt ?? new Date(),
      });
    } catch (error) {
      logger.warn("ActivityEventRepository: Failed to append vault lifecycle event", {
        vaultId: input.vaultId,
        eventType: input.eventType,
        error: (error as Error).message,
      });
    }
  }

  async appendUserVaultActivityEvent(input: UserVaultActivityEventInput): Promise<void> {
    try {
      const db = await getDb();
      await db.insert(userVaultActivityEvents).values({
        vaultId: input.vaultId,
        vaultAddress: input.vaultAddress,
        userAddress: input.userAddress,
        cycleId: input.cycleId,
        eventType: input.eventType,
        title: input.title,
        detail: input.detail,
        status: input.status,
        requestId: input.requestId,
        txHash: input.txHash,
        assetAmount: input.assetAmount,
        shareAmount: input.shareAmount,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        occurredAt: input.occurredAt ?? new Date(),
      });
    } catch (error) {
      logger.warn("ActivityEventRepository: Failed to append user activity event", {
        vaultId: input.vaultId,
        userAddress: input.userAddress,
        eventType: input.eventType,
        error: (error as Error).message,
      });
    }
  }

  async listVaultLifecycleEvents(vaultAddress: string, limit = 50, offset = 0) {
    try {
      const db = await getDb();
      return await db
        .select()
        .from(vaultLifecycleEvents)
        .where(eq(vaultLifecycleEvents.vaultAddress, vaultAddress))
        .orderBy(desc(vaultLifecycleEvents.occurredAt))
        .limit(limit)
        .offset(offset);
    } catch (error) {
      logger.warn("ActivityEventRepository: Failed to read vault lifecycle events", {
        vaultAddress,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async listUserVaultActivityEvents(
    vaultAddress: string,
    userAddress: string,
    limit = 100,
    offset = 0,
  ) {
    try {
      const db = await getDb();
      return await db
        .select()
        .from(userVaultActivityEvents)
        .where(
          and(
            eq(userVaultActivityEvents.vaultAddress, vaultAddress),
            eq(userVaultActivityEvents.userAddress, userAddress),
          ),
        )
        .orderBy(desc(userVaultActivityEvents.occurredAt))
        .limit(limit)
        .offset(offset);
    } catch (error) {
      logger.warn("ActivityEventRepository: Failed to read user activity events", {
        vaultAddress,
        userAddress,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async listVaultUserActivityEvents(vaultAddress: string, limit = 500) {
    try {
      const db = await getDb();
      return await db
        .select()
        .from(userVaultActivityEvents)
        .where(eqLower(userVaultActivityEvents.vaultAddress, vaultAddress))
        .orderBy(desc(userVaultActivityEvents.occurredAt))
        .limit(limit);
    } catch (error) {
      logger.warn("ActivityEventRepository: Failed to read vault user activity events", {
        vaultAddress,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async listDepositActivityAddresses(vaultAddress: string): Promise<string[]> {
    try {
      const db = await getDb();
      const rows = await db
        .select({ userAddress: userVaultActivityEvents.userAddress })
        .from(userVaultActivityEvents)
        .where(
          and(
            eqLower(userVaultActivityEvents.vaultAddress, vaultAddress),
            sql`${userVaultActivityEvents.eventType} in ('deposit_queued', 'deposit_processed', 'deposit_minted')`,
          ),
        )
        .orderBy(desc(userVaultActivityEvents.occurredAt));

      return [...new Set(rows.map((row) => row.userAddress.toLowerCase()))];
    } catch (error) {
      logger.warn("ActivityEventRepository: Failed to list deposit activity addresses", {
        vaultAddress,
        error: (error as Error).message,
      });
      return [];
    }
  }
}

export const activityEventRepository = new ActivityEventRepository();
