import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import {
  vaultAnalyticsSyncState,
  vaultDetailedAnalytics,
  vaultResolvedAnalyticsPositions,
  type VaultDetailedAnalytics,
  type VaultResolvedAnalyticsPosition,
  type VaultAnalyticsSyncState,
} from "../db/schema.js";

type DbClient = typeof defaultDb;
type DatabaseTimestamp = Date | string | null;

export type NewVaultResolvedAnalyticsPosition = typeof vaultResolvedAnalyticsPositions.$inferInsert;
export type NewVaultDetailedAnalytics = typeof vaultDetailedAnalytics.$inferInsert;
export type NewVaultAnalyticsSyncState = typeof vaultAnalyticsSyncState.$inferInsert;

export interface VaultResolvedTradingAnalyticsSummary {
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnlPerPosition: number;
  lastResolvedAt: Date | null;
  computedAt: Date;
}

function normalizeDatabaseTimestamp(value: DatabaseTimestamp): Date | null {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export class VaultAnalyticsRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  async findResolvedPositions(
    network: string,
    vaultAddress: string,
    limit?: number,
  ): Promise<VaultResolvedAnalyticsPosition[]> {
    const query = this.database
      .select()
      .from(vaultResolvedAnalyticsPositions)
      .where(
        and(
          eq(vaultResolvedAnalyticsPositions.network, network),
          eq(vaultResolvedAnalyticsPositions.vaultAddress, vaultAddress.toLowerCase()),
        ),
      )
      .orderBy(desc(vaultResolvedAnalyticsPositions.resolvedAt));
    return limit !== undefined ? query.limit(limit) : query;
  }

  async getExistingTokenIds(network: string, vaultAddress: string): Promise<Set<string>> {
    const rows = await this.database
      .select({ tokenId: vaultResolvedAnalyticsPositions.tokenId })
      .from(vaultResolvedAnalyticsPositions)
      .where(
        and(
          eq(vaultResolvedAnalyticsPositions.network, network),
          eq(vaultResolvedAnalyticsPositions.vaultAddress, vaultAddress.toLowerCase()),
        ),
      );
    return new Set(rows.map((row) => row.tokenId));
  }

  async upsertResolvedPositions(records: NewVaultResolvedAnalyticsPosition[]): Promise<number> {
    if (records.length === 0) return 0;

    await this.database
      .insert(vaultResolvedAnalyticsPositions)
      .values(
        records.map((record) => ({
          ...record,
          network: record.network.toLowerCase(),
          vaultAddress: record.vaultAddress.toLowerCase(),
          walletAddress: record.walletAddress.toLowerCase(),
        })),
      )
      .onConflictDoUpdate({
        target: [
          vaultResolvedAnalyticsPositions.network,
          vaultResolvedAnalyticsPositions.vaultAddress,
          vaultResolvedAnalyticsPositions.tokenId,
        ],
        set: {
          profitLoss: sql`excluded.profit_loss`,
          result: sql`excluded.result`,
          finalPrice: sql`excluded.final_price`,
          resolvedAt: sql`excluded.resolved_at`,
          marketEndDate: sql`excluded.market_end_date`,
          maxDrawdownPercent: sql`excluded.max_drawdown_percent`,
          lowestPrice: sql`excluded.lowest_price`,
          highestPrice: sql`excluded.highest_price`,
          priceHistory: sql`excluded.price_history`,
          oppositeOutcomePriceHistory: sql`excluded.opposite_outcome_price_history`,
          stopLossSimulations: sql`excluded.stop_loss_simulations`,
          hedgingSimulations: sql`excluded.hedging_simulations`,
          category: sql`excluded.category`,
          tags: sql`excluded.tags`,
          fidelityMinutes: sql`excluded.fidelity_minutes`,
          updatedAt: sql`now()`,
        },
      });

    return records.length;
  }

  async getDetailedAnalytics(
    network: string,
    vaultAddress: string,
  ): Promise<VaultDetailedAnalytics | null> {
    const rows = await this.database
      .select()
      .from(vaultDetailedAnalytics)
      .where(
        and(
          eq(vaultDetailedAnalytics.network, network),
          eq(vaultDetailedAnalytics.vaultAddress, vaultAddress.toLowerCase()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getResolvedTradingAnalyticsSummary(
    network: string,
    vaultAddress: string,
  ): Promise<VaultResolvedTradingAnalyticsSummary | null> {
    const rows = await this.database
      .select({
        positionCount: sql<number>`count(*)::int`,
        winCount: sql<number>`count(*) filter (where ${vaultResolvedAnalyticsPositions.profitLoss}::numeric >= 0)::int`,
        totalPnl: sql<string>`coalesce(sum(${vaultResolvedAnalyticsPositions.profitLoss}::numeric), 0)::text`,
        lastResolvedAt: sql<DatabaseTimestamp>`max(${vaultResolvedAnalyticsPositions.resolvedAt})`,
        computedAt: sql<DatabaseTimestamp>`max(${vaultResolvedAnalyticsPositions.updatedAt})`,
      })
      .from(vaultResolvedAnalyticsPositions)
      .where(
        and(
          eq(vaultResolvedAnalyticsPositions.network, network.toLowerCase()),
          eq(vaultResolvedAnalyticsPositions.vaultAddress, vaultAddress.toLowerCase()),
        ),
      );

    const row = rows[0];
    const positionCount = Number(row?.positionCount ?? 0);
    if (!row || positionCount === 0) {
      return null;
    }

    const winCount = Number(row.winCount ?? 0);
    const totalPnl = Number(row.totalPnl ?? 0);
    const lossCount = positionCount - winCount;
    const computedAt = normalizeDatabaseTimestamp(row.computedAt) ?? new Date();

    return {
      positionCount,
      winCount,
      lossCount,
      winRate: winCount / positionCount,
      totalPnl,
      avgPnlPerPosition: totalPnl / positionCount,
      lastResolvedAt: normalizeDatabaseTimestamp(row.lastResolvedAt),
      computedAt,
    };
  }

  async upsertDetailedAnalytics(record: NewVaultDetailedAnalytics): Promise<void> {
    await this.database
      .insert(vaultDetailedAnalytics)
      .values({
        ...record,
        network: record.network.toLowerCase(),
        vaultAddress: record.vaultAddress.toLowerCase(),
        walletAddress: record.walletAddress.toLowerCase(),
      })
      .onConflictDoUpdate({
        target: [vaultDetailedAnalytics.network, vaultDetailedAnalytics.vaultAddress],
        set: {
          walletAddress: record.walletAddress.toLowerCase(),
          totalPnl: record.totalPnl,
          totalCost: record.totalCost,
          winCount: record.winCount,
          lossCount: record.lossCount,
          winRate: record.winRate,
          avgEntryPrice: record.avgEntryPrice,
          avgPnlPerPosition: record.avgPnlPerPosition,
          avgHoldingHours: record.avgHoldingHours,
          stopLossAnalysis: record.stopLossAnalysis,
          hedgingAnalysis: record.hedgingAnalysis,
          categoryBreakdown: record.categoryBreakdown,
          dailyPnl: record.dailyPnl,
          entryTimingAnalysis: record.entryTimingAnalysis,
          computedAt: new Date(),
        },
      });
  }

  async getSyncState(
    network: string,
    vaultAddress: string,
  ): Promise<VaultAnalyticsSyncState | null> {
    const rows = await this.database
      .select()
      .from(vaultAnalyticsSyncState)
      .where(
        and(
          eq(vaultAnalyticsSyncState.network, network),
          eq(vaultAnalyticsSyncState.vaultAddress, vaultAddress.toLowerCase()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertSyncState(record: NewVaultAnalyticsSyncState): Promise<void> {
    await this.database
      .insert(vaultAnalyticsSyncState)
      .values({
        ...record,
        network: record.network.toLowerCase(),
        vaultAddress: record.vaultAddress.toLowerCase(),
        walletAddress: record.walletAddress.toLowerCase(),
      })
      .onConflictDoUpdate({
        target: [vaultAnalyticsSyncState.network, vaultAnalyticsSyncState.vaultAddress],
        set: {
          walletAddress: record.walletAddress.toLowerCase(),
          lastActivityTimestamp: record.lastActivityTimestamp ?? null,
          lastSuccessfulSyncAt: record.lastSuccessfulSyncAt ?? null,
          lastAttemptedSyncAt: record.lastAttemptedSyncAt ?? null,
          lastError: record.lastError ?? null,
          updatedAt: new Date(),
        },
      });
  }
}

export const vaultAnalyticsRepository = new VaultAnalyticsRepository();
