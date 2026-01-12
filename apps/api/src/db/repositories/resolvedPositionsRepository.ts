import { eq, sql, and, desc } from "drizzle-orm";
import { db as defaultDb } from "../client.js";
import {
  resolvedPositions,
  type NewResolvedPosition,
  type ResolvedPosition,
} from "../analyticsSchema.js";

type DbClient = typeof defaultDb;

export class ResolvedPositionsRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  async findByWallet(walletAddress: string): Promise<ResolvedPosition[]> {
    return this.database
      .select()
      .from(resolvedPositions)
      .where(eq(resolvedPositions.walletAddress, walletAddress.toLowerCase()))
      .orderBy(desc(resolvedPositions.resolvedAt));
  }

  async findByWalletLightweight(
    walletAddress: string,
  ): Promise<Omit<ResolvedPosition, "priceHistory" | "oppositeOutcomePriceHistory">[]> {
    return this.database
      .select({
        id: resolvedPositions.id,
        walletAddress: resolvedPositions.walletAddress,
        tokenId: resolvedPositions.tokenId,
        conditionId: resolvedPositions.conditionId,
        eventSlug: resolvedPositions.eventSlug,
        marketSlug: resolvedPositions.marketSlug,
        marketQuestion: resolvedPositions.marketQuestion,
        outcome: resolvedPositions.outcome,
        entryPrice: resolvedPositions.entryPrice,
        cost: resolvedPositions.cost,
        size: resolvedPositions.size,
        createdAt: resolvedPositions.createdAt,
        resolvedAt: resolvedPositions.resolvedAt,
        finalPrice: resolvedPositions.finalPrice,
        profitLoss: resolvedPositions.profitLoss,
        result: resolvedPositions.result,
        maxDrawdownPercent: resolvedPositions.maxDrawdownPercent,
        lowestPrice: resolvedPositions.lowestPrice,
        highestPrice: resolvedPositions.highestPrice,
        stopLossSimulations: resolvedPositions.stopLossSimulations,
        hedgingSimulations: resolvedPositions.hedgingSimulations,
        category: resolvedPositions.category,
        tags: resolvedPositions.tags,
        fidelityMinutes: resolvedPositions.fidelityMinutes,
        capturedAt: resolvedPositions.capturedAt,
        updatedAt: resolvedPositions.updatedAt,
      })
      .from(resolvedPositions)
      .where(eq(resolvedPositions.walletAddress, walletAddress.toLowerCase()))
      .orderBy(desc(resolvedPositions.resolvedAt));
  }

  async findByTokenId(walletAddress: string, tokenId: string): Promise<ResolvedPosition | null> {
    const results = await this.database
      .select()
      .from(resolvedPositions)
      .where(
        and(
          eq(resolvedPositions.walletAddress, walletAddress.toLowerCase()),
          eq(resolvedPositions.tokenId, tokenId),
        ),
      )
      .limit(1);
    return results[0] ?? null;
  }

  async getExistingTokenIds(walletAddress: string): Promise<Set<string>> {
    const results = await this.database
      .select({ tokenId: resolvedPositions.tokenId })
      .from(resolvedPositions)
      .where(eq(resolvedPositions.walletAddress, walletAddress.toLowerCase()));
    return new Set(results.map((r) => r.tokenId));
  }

  async upsert(data: NewResolvedPosition): Promise<ResolvedPosition> {
    const normalized = {
      ...data,
      walletAddress: data.walletAddress.toLowerCase(),
    };

    const results = await this.database
      .insert(resolvedPositions)
      .values(normalized)
      .onConflictDoUpdate({
        target: [resolvedPositions.walletAddress, resolvedPositions.tokenId],
        set: {
          profitLoss: sql`excluded.profit_loss`,
          result: sql`excluded.result`,
          finalPrice: sql`excluded.final_price`,
          resolvedAt: sql`excluded.resolved_at`,
          maxDrawdownPercent: sql`excluded.max_drawdown_percent`,
          lowestPrice: sql`excluded.lowest_price`,
          highestPrice: sql`excluded.highest_price`,
          priceHistory: sql`excluded.price_history`,
          oppositeOutcomePriceHistory: sql`excluded.opposite_outcome_price_history`,
          stopLossSimulations: sql`excluded.stop_loss_simulations`,
          hedgingSimulations: sql`excluded.hedging_simulations`,
          category: sql`excluded.category`,
          tags: sql`excluded.tags`,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    return results[0]!;
  }

  async upsertMany(records: NewResolvedPosition[]): Promise<number> {
    if (records.length === 0) return 0;

    const normalized = records.map((r) => ({
      ...r,
      walletAddress: r.walletAddress.toLowerCase(),
    }));

    const batchSize = 50;
    let inserted = 0;

    for (let i = 0; i < normalized.length; i += batchSize) {
      const batch = normalized.slice(i, i + batchSize);
      await this.database
        .insert(resolvedPositions)
        .values(batch)
        .onConflictDoUpdate({
          target: [resolvedPositions.walletAddress, resolvedPositions.tokenId],
          set: {
            profitLoss: sql`excluded.profit_loss`,
            result: sql`excluded.result`,
            finalPrice: sql`excluded.final_price`,
            resolvedAt: sql`excluded.resolved_at`,
            maxDrawdownPercent: sql`excluded.max_drawdown_percent`,
            lowestPrice: sql`excluded.lowest_price`,
            highestPrice: sql`excluded.highest_price`,
            priceHistory: sql`excluded.price_history`,
            oppositeOutcomePriceHistory: sql`excluded.opposite_outcome_price_history`,
            stopLossSimulations: sql`excluded.stop_loss_simulations`,
            hedgingSimulations: sql`excluded.hedging_simulations`,
            category: sql`excluded.category`,
            tags: sql`excluded.tags`,
            updatedAt: sql`now()`,
          },
        });
      inserted += batch.length;
    }

    return inserted;
  }

  async getStats(walletAddress: string): Promise<{
    total: number;
    won: number;
    lost: number;
    totalPnL: number;
  }> {
    const results = await this.database
      .select({
        total: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where result = 'won')::int`,
        lost: sql<number>`count(*) filter (where result = 'lost')::int`,
        totalPnL: sql<number>`coalesce(sum(profit_loss::numeric), 0)::float`,
      })
      .from(resolvedPositions)
      .where(eq(resolvedPositions.walletAddress, walletAddress.toLowerCase()));

    return results[0] ?? { total: 0, won: 0, lost: 0, totalPnL: 0 };
  }

  async getLastSyncTime(walletAddress: string): Promise<Date | null> {
    const results = await this.database
      .select({
        lastUpdated: sql<Date>`max(updated_at)`,
      })
      .from(resolvedPositions)
      .where(eq(resolvedPositions.walletAddress, walletAddress.toLowerCase()));

    return results[0]?.lastUpdated ?? null;
  }
}

export const resolvedPositionsRepository = new ResolvedPositionsRepository();
