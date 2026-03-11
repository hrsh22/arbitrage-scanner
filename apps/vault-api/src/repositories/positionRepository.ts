/**
 * Position Repository
 * Database operations for vault positions, trades, and allocations.
 * Follows the repository pattern from apps/api.
 */

import { eq, sql, desc } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { vaultPositions, vaultTrades, vaultAllocations } from "../db/schema.js";

type DbClient = typeof defaultDb;

export interface NewPosition {
  positionId: string;
  marketId: string;
  conditionId: string;
  tokenId: string;
  outcome: "YES" | "NO";
  costBasis: string;
  quantity: string;
}

export interface NewTrade {
  tradeId: string;
  positionId: number;
  orderId: string;
  side: "buy" | "sell";
  price: string;
  size: string;
  filledSize: string;
  status?: "pending" | "filled" | "partially_filled" | "cancelled" | "failed";
  txHash?: string;
}

export interface NewAllocation {
  allocationId: string;
  txHash: string;
  direction: "allocate" | "deallocate";
  amount: string;
}

export class PositionRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  async createPosition(position: NewPosition) {
    const results = await this.database.insert(vaultPositions).values(position).returning();

    return results[0]!;
  }

  async getOpenPositions() {
    return this.database
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.status, "open"))
      .orderBy(desc(vaultPositions.openedAt));
  }

  async getPositionById(id: number) {
    const results = await this.database
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  async updatePositionStatus(
    id: number,
    status: "resolved_win" | "resolved_loss",
    resolvedPnl?: string,
  ) {
    const results = await this.database
      .update(vaultPositions)
      .set({
        status,
        resolvedPnl: resolvedPnl ?? null,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vaultPositions.id, id))
      .returning();

    return results[0] ?? null;
  }

  async getPositionsByMarket(marketId: string) {
    return this.database
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.marketId, marketId))
      .orderBy(desc(vaultPositions.openedAt));
  }

  async getTotalCostBasis(): Promise<number> {
    const results = await this.database
      .select({
        total: sql<string>`coalesce(sum(${vaultPositions.costBasis}::numeric), 0)`,
      })
      .from(vaultPositions)
      .where(eq(vaultPositions.status, "open"));

    return parseFloat(results[0]?.total ?? "0");
  }

  async recordTrade(trade: NewTrade) {
    const results = await this.database.insert(vaultTrades).values(trade).returning();

    return results[0]!;
  }

  async recordAllocation(allocation: NewAllocation) {
    const results = await this.database.insert(vaultAllocations).values(allocation).returning();

    return results[0]!;
  }
}

export const positionRepository = new PositionRepository();
