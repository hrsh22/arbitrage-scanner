import { desc } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { vaultNavHistory } from "../db/schema.js";
import type { VaultNAV } from "../types.js";

type DbClient = typeof defaultDb;
interface NavSnapshotInput {
  navId: string;
  totalAssets: string;
  idleAssets: string;
  deployedCostBasis: string;
  sharePrice: string;
  positionCount: number;
}

export class NavCalculator {
  constructor(private readonly database: DbClient = defaultDb) {}

  calculateNav(
    idleAssets: number,
    deployedMarketValue: number,
    deployedCostBasis: number,
    sharePrice: number,
    positionCount: number,
  ): VaultNAV {
    const totalAssets = idleAssets + deployedMarketValue;
    return {
      totalAssets,
      idleAssets,
      deployedCostBasis,
      deployedMarketValue,
      sharePrice,
      positionCount,
      lastUpdated: new Date(),
    };
  }

  async recordNavSnapshot(snapshot: NavSnapshotInput) {
    const results = await this.database.insert(vaultNavHistory).values(snapshot).returning();

    return results[0]!;
  }

  async getNavHistory(limit: number = 24) {
    return this.database
      .select()
      .from(vaultNavHistory)
      .orderBy(desc(vaultNavHistory.timestamp))
      .limit(limit);
  }

  getSharePrice(totalAssets: number, totalShares: number): number {
    if (totalShares === 0) return 1.0;
    return totalAssets / totalShares;
  }
}

export const navCalculator = new NavCalculator();
