/**
 * Position Repository
 * Database operations for vault positions, trades, and allocations.
 * Follows the repository pattern from apps/api.
 */

import { eq, sql, desc } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { and, gte, isNotNull } from "drizzle-orm";
import {
  vaultPositions,
  vaultTrades,
  vaultAllocations,
  vaultTradingAnalytics,
} from "../db/schema.js";

type DbClient = typeof defaultDb;

export interface NewPosition {
  positionId: string;
  vaultAddress: string;
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

export interface VaultTradingAnalyticsRow {
  vaultAddress: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: string;
  totalPnl: string;
  avgPnlPerPosition: string;
  lastResolvedAt: Date | null;
  computedAt: Date;
}

export class PositionRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  async createPosition(position: NewPosition) {
    const results = await this.database.insert(vaultPositions).values(position).returning();

    return results[0]!;
  }

  async getOpenPositions(vaultAddress?: string) {
    const query = this.database
      .select()
      .from(vaultPositions)
      .where(
        vaultAddress
          ? and(eq(vaultPositions.status, "open"), eq(vaultPositions.vaultAddress, vaultAddress))
          : eq(vaultPositions.status, "open"),
      );

    return query.orderBy(desc(vaultPositions.openedAt));
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

  async getPositionsByMarket(marketId: string, vaultAddress?: string) {
    return this.database
      .select()
      .from(vaultPositions)
      .where(
        vaultAddress
          ? and(
              eq(vaultPositions.marketId, marketId),
              eq(vaultPositions.vaultAddress, vaultAddress),
            )
          : eq(vaultPositions.marketId, marketId),
      )
      .orderBy(desc(vaultPositions.openedAt));
  }

  async getTotalCostBasis(vaultAddress?: string): Promise<number> {
    const results = await this.database
      .select({
        total: sql<string>`coalesce(sum(${vaultPositions.costBasis}::numeric), 0)`,
      })
      .from(vaultPositions)
      .where(
        vaultAddress
          ? and(eq(vaultPositions.status, "open"), eq(vaultPositions.vaultAddress, vaultAddress))
          : eq(vaultPositions.status, "open"),
      );

    return parseFloat(results[0]?.total ?? "0");
  }

  async getResolvedStats(vaultAddress: string): Promise<{
    positionCount: number;
    winCount: number;
    lossCount: number;
    totalPnl: number;
    avgPnlPerPosition: number;
    winRate: number;
    lastResolvedAt: Date | null;
  }> {
    const rows = await this.database
      .select({
        status: vaultPositions.status,
        resolvedPnl: vaultPositions.resolvedPnl,
        resolvedAt: vaultPositions.resolvedAt,
      })
      .from(vaultPositions)
      .where(
        and(eq(vaultPositions.vaultAddress, vaultAddress), isNotNull(vaultPositions.resolvedAt)),
      )
      .orderBy(desc(vaultPositions.resolvedAt));

    let winCount = 0;
    let lossCount = 0;
    let totalPnl = 0;
    for (const row of rows) {
      const pnl = parseFloat(row.resolvedPnl ?? "0");
      if (row.status === "resolved_win") winCount += 1;
      if (row.status === "resolved_loss") lossCount += 1;
      totalPnl += pnl;
    }

    const positionCount = winCount + lossCount;
    return {
      positionCount,
      winCount,
      lossCount,
      totalPnl,
      avgPnlPerPosition: positionCount > 0 ? totalPnl / positionCount : 0,
      winRate: positionCount > 0 ? winCount / positionCount : 0,
      lastResolvedAt: rows[0]?.resolvedAt ?? null,
    };
  }

  async upsertTradingAnalytics(
    vaultAddress: string,
    analytics: Omit<VaultTradingAnalyticsRow, "vaultAddress" | "computedAt">,
  ) {
    const results = await this.database
      .insert(vaultTradingAnalytics)
      .values({
        vaultAddress,
        ...analytics,
        computedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [vaultTradingAnalytics.vaultAddress],
        set: {
          positionCount: analytics.positionCount,
          winCount: analytics.winCount,
          lossCount: analytics.lossCount,
          winRate: analytics.winRate,
          totalPnl: analytics.totalPnl,
          avgPnlPerPosition: analytics.avgPnlPerPosition,
          lastResolvedAt: analytics.lastResolvedAt,
          computedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    return results[0] ?? null;
  }

  async getTradingAnalytics(vaultAddress: string) {
    const results = await this.database
      .select()
      .from(vaultTradingAnalytics)
      .where(eq(vaultTradingAnalytics.vaultAddress, vaultAddress))
      .limit(1);
    return results[0] ?? null;
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
