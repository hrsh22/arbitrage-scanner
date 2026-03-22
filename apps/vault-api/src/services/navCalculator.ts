import { desc, eq } from "drizzle-orm";
import { db as defaultDb } from "../db/index.js";
import { vaultNavHistory } from "../db/schema.js";
import type { VaultNAV } from "../types.js";

type DbClient = typeof defaultDb;
interface NavSnapshotInput {
  navId: string;
  vaultAddress: string;
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

  async getNavHistory(vaultAddress?: string, limit?: number) {
    const baseQuery = this.database.select().from(vaultNavHistory);
    const query = vaultAddress
      ? baseQuery
          .where(eq(vaultNavHistory.vaultAddress, vaultAddress.toLowerCase()))
          .orderBy(desc(vaultNavHistory.timestamp))
      : baseQuery.orderBy(desc(vaultNavHistory.timestamp));
    return limit !== undefined ? query.limit(limit) : query;
  }

  getSharePrice(totalAssets: number, totalShares: number): number {
    if (totalShares === 0) return 1.0;
    return totalAssets / totalShares;
  }
}

export const navCalculator = new NavCalculator();
