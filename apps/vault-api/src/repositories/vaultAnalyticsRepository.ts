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

export type NewVaultResolvedAnalyticsPosition = typeof vaultResolvedAnalyticsPositions.$inferInsert;
export type NewVaultDetailedAnalytics = typeof vaultDetailedAnalytics.$inferInsert;
export type NewVaultAnalyticsSyncState = typeof vaultAnalyticsSyncState.$inferInsert;

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
