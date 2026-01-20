import { eq } from "drizzle-orm";
import { db as defaultDb } from "../client.js";
import {
  walletAnalytics,
  type NewWalletAnalytics,
  type WalletAnalytics,
} from "../analyticsSchema.js";

type DbClient = typeof defaultDb;

export class WalletAnalyticsRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  async findByWallet(walletAddress: string): Promise<WalletAnalytics | null> {
    const results = await this.database
      .select()
      .from(walletAnalytics)
      .where(eq(walletAnalytics.walletAddress, walletAddress.toLowerCase()))
      .limit(1);
    return results[0] ?? null;
  }

  async upsert(data: NewWalletAnalytics): Promise<void> {
    await this.database
      .insert(walletAnalytics)
      .values({
        ...data,
        walletAddress: data.walletAddress.toLowerCase(),
      })
      .onConflictDoUpdate({
        target: walletAnalytics.walletAddress,
        set: {
          totalPnl: data.totalPnl,
          totalCost: data.totalCost,
          winCount: data.winCount,
          lossCount: data.lossCount,
          winRate: data.winRate,
          avgEntryPrice: data.avgEntryPrice,
          avgPnlPerPosition: data.avgPnlPerPosition,
          avgHoldingHours: data.avgHoldingHours,
          stopLossAnalysis: data.stopLossAnalysis,
          hedgingAnalysis: data.hedgingAnalysis,
          categoryBreakdown: data.categoryBreakdown,
          dailyPnl: data.dailyPnl,
          entryTimingAnalysis: data.entryTimingAnalysis,
          computedAt: new Date(),
        },
      });
  }
}

export const walletAnalyticsRepository = new WalletAnalyticsRepository();
