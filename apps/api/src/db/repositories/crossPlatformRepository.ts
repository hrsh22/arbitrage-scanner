import { eq, sql, and, desc, asc } from "drizzle-orm";
import { db as defaultDb } from "../client.js";
import { crossPlatformOpportunities, crossPlatformSnapshots } from "../schema.js";
import type { CrossPlatformOpportunity } from "../../services/crossPlatformDetector.js";
import { logger } from "../../logger.js";

type DbClient = typeof defaultDb;

/**
 * Build Kalshi URL from DB row data
 * Format: https://kalshi.com/markets/{baseEventTicker}/{slug}/{ticker}
 * Note: Event tickers like "SENATEDE-26" need to become "senatede" (strip numeric suffix)
 */
function buildKalshiUrlFromRow(eventTicker: string | null, title: string, ticker: string): string {
  // Create slug from title
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);

  // Extract base event ticker by removing numeric suffix (e.g., SENATEDE-26 -> senatede)
  // Also handle tickers like KXPRESNOMD-28 -> kxpresnomd
  const rawEvent = (eventTicker ?? ticker).toLowerCase();
  const baseEvent = rawEvent.replace(/-\d+$/, ""); // Remove trailing -## suffix

  return `https://kalshi.com/markets/${baseEvent}/${slug}/${ticker.toLowerCase()}`;
}

/**
 * Repository for cross-platform arbitrage opportunities
 */
export class CrossPlatformRepository {
  constructor(private readonly database: DbClient = defaultDb) {}

  /**
   * Upsert opportunities - insert new ones, update existing ones
   * Uses polymarketId + kalshiTicker as unique key
   */
  async upsertOpportunities(opportunities: CrossPlatformOpportunity[]): Promise<void> {
    if (opportunities.length === 0) return;

    const now = new Date();

    for (const opp of opportunities) {
      try {
        // Try to find existing record
        const existing = await this.database
          .select({ id: crossPlatformOpportunities.id })
          .from(crossPlatformOpportunities)
          .where(
            and(
              eq(crossPlatformOpportunities.polymarketId, opp.polymarket.id),
              eq(crossPlatformOpportunities.kalshiTicker, opp.kalshi.ticker),
            ),
          )
          .limit(1);

        const record = {
          polymarketId: opp.polymarket.id,
          polymarketQuestion: opp.polymarket.question,
          polymarketSlug: opp.polymarket.slug ?? null,
          polyYesBid: opp.polymarket.yesBestBid?.toString() ?? null,
          polyYesAsk: opp.polymarket.yesBestAsk?.toString() ?? null,
          polyNoBid: opp.polymarket.noBestBid?.toString() ?? null,
          polyNoAsk: opp.polymarket.noBestAsk?.toString() ?? null,
          polyEndsAt: opp.polymarket.endsAt ? new Date(opp.polymarket.endsAt) : null,
          polyLiquidity: opp.polymarket.liquidity?.toString() ?? null,
          polyVolume: opp.polymarket.volume?.toString() ?? null,
          kalshiTicker: opp.kalshi.ticker,
          kalshiEventTicker: opp.kalshi.eventTicker,
          kalshiTitle: opp.kalshi.title,
          kalshiYesBid: opp.kalshi.yesBid?.toString() ?? null,
          kalshiYesAsk: opp.kalshi.yesAsk?.toString() ?? null,
          kalshiNoBid: opp.kalshi.noBid?.toString() ?? null,
          kalshiNoAsk: opp.kalshi.noAsk?.toString() ?? null,
          kalshiEndsAt: opp.kalshi.closeTime ? new Date(opp.kalshi.closeTime) : null,
          kalshiVolume: opp.kalshi.volume?.toString() ?? null,
          kalshiLiquidity: opp.kalshi.liquidity?.toString() ?? null,
          arbitrageType: opp.arbitrage.type,
          arbitrageInstruction: opp.arbitrage.instruction,
          spread: opp.arbitrage.profit?.toString() ?? "0",
          potentialProfit: opp.arbitrage.profitPct?.toString() ?? "0",
          matchConfidence: opp.matchConfidence?.toString() ?? null,
          matchReason: opp.matchReason ?? null,
          aiVerified: opp.aiVerified ?? false,
          aiReason: opp.aiReason ?? null,
          isActive: true,
          lastSeenAt: now,
          updatedAt: now,
        };

        if (existing.length > 0) {
          // Update existing
          await this.database
            .update(crossPlatformOpportunities)
            .set(record)
            .where(eq(crossPlatformOpportunities.id, existing[0]!.id));
        } else {
          // Insert new
          await this.database.insert(crossPlatformOpportunities).values({
            ...record,
            detectedAt: now,
            createdAt: now,
          });
        }
      } catch (error) {
        logger.error("Failed to upsert cross-platform opportunity", {
          polyId: opp.polymarket.id,
          kalshiTicker: opp.kalshi.ticker,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Mark opportunities as inactive if not seen in latest poll
   * Called after upsertOpportunities to deactivate stale records
   */
  async markStaleAsInactive(cutoffTime: Date): Promise<number> {
    const now = new Date();
    const result = await this.database
      .update(crossPlatformOpportunities)
      .set({
        isActive: false,
        expiredAt: now, // Track when opportunity expired
        updatedAt: now,
      })
      .where(
        and(
          eq(crossPlatformOpportunities.isActive, true),
          sql`${crossPlatformOpportunities.lastSeenAt} < ${cutoffTime}`,
        ),
      );

    return result.rowCount ?? 0;
  }

  /**
   * Get active opportunities for API
   * @param limit Max number of results
   * @param nearResolutionHours If set, only return markets closing within this many hours
   * @param sortBy Sort by "profit" (default) or "endDate" (earliest first)
   */
  async getActive(
    limit = 100,
    nearResolutionHours?: number,
    sortBy: "profit" | "endDate" = "profit",
  ): Promise<CrossPlatformOpportunity[]> {
    const conditions = [eq(crossPlatformOpportunities.isActive, true)];

    // Add near-resolution filter if specified
    if (nearResolutionHours) {
      const cutoffTime = new Date(Date.now() + nearResolutionHours * 60 * 60 * 1000);
      conditions.push(
        sql`(${crossPlatformOpportunities.polyEndsAt} IS NOT NULL AND ${crossPlatformOpportunities.polyEndsAt} <= ${cutoffTime})`,
      );
    }

    // Determine sort order
    const orderBy =
      sortBy === "endDate"
        ? asc(crossPlatformOpportunities.polyEndsAt)
        : desc(crossPlatformOpportunities.potentialProfit);

    const rows = await this.database
      .select()
      .from(crossPlatformOpportunities)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit);

    return rows.map((row) => ({
      id: `${row.polymarketId}-${row.kalshiTicker}`,
      matchConfidence: row.matchConfidence ? parseFloat(row.matchConfidence) : 0,
      matchReason: row.matchReason ?? "",
      matchType: "high" as const,
      aiVerified: row.aiVerified ?? false,
      aiReason: row.aiReason ?? undefined,

      polymarket: {
        id: row.polymarketId,
        question: row.polymarketQuestion,
        slug: row.polymarketSlug ?? undefined,
        url: `https://polymarket.com/event/${row.polymarketSlug ?? row.polymarketId}`,
        yesBestBid: row.polyYesBid ? parseFloat(row.polyYesBid) : 0,
        yesBestAsk: row.polyYesAsk ? parseFloat(row.polyYesAsk) : 0,
        noBestBid: row.polyNoBid ? parseFloat(row.polyNoBid) : 0,
        noBestAsk: row.polyNoAsk ? parseFloat(row.polyNoAsk) : 0,
        endsAt: row.polyEndsAt?.toISOString(),
        liquidity: row.polyLiquidity ? parseFloat(row.polyLiquidity) : undefined,
        volume: row.polyVolume ? parseFloat(row.polyVolume) : undefined,
      },

      kalshi: {
        ticker: row.kalshiTicker,
        eventTicker: row.kalshiEventTicker ?? row.kalshiTicker.split("-")[0] ?? row.kalshiTicker,
        title: row.kalshiTitle,
        url: buildKalshiUrlFromRow(row.kalshiEventTicker, row.kalshiTitle, row.kalshiTicker),
        yesBid: row.kalshiYesBid ? parseFloat(row.kalshiYesBid) : 0,
        yesAsk: row.kalshiYesAsk ? parseFloat(row.kalshiYesAsk) : 0,
        noBid: row.kalshiNoBid ? parseFloat(row.kalshiNoBid) : 0,
        noAsk: row.kalshiNoAsk ? parseFloat(row.kalshiNoAsk) : 0,
        closeTime: row.kalshiEndsAt?.toISOString(),
        volume: row.kalshiVolume ? parseFloat(row.kalshiVolume) : undefined,
        liquidity: row.kalshiLiquidity ? parseFloat(row.kalshiLiquidity) : undefined,
      },

      arbitrage: {
        type: (row.arbitrageType as "poly-yes-kalshi-no" | "poly-no-kalshi-yes" | "none") ?? "none",
        totalCost: 1 - (row.spread ? parseFloat(row.spread) : 0),
        profit: row.spread ? parseFloat(row.spread) : 0,
        profitPct: row.potentialProfit ? parseFloat(row.potentialProfit) : 0,
        instruction: row.arbitrageInstruction ?? "No arbitrage",
      },

      detectedAt: row.detectedAt.toISOString(),
    }));
  }

  /**
   * Get active opportunities with IDs for snapshot recording
   * Returns minimal data needed for snapshots
   */
  async getActiveWithIds(): Promise<
    {
      id: number;
      profitPct: number;
      spread: number;
      polyYesAsk: number;
      polyNoAsk: number;
      kalshiYesAsk: number;
      kalshiNoAsk: number;
    }[]
  > {
    const rows = await this.database
      .select({
        id: crossPlatformOpportunities.id,
        potentialProfit: crossPlatformOpportunities.potentialProfit,
        spread: crossPlatformOpportunities.spread,
        polyYesAsk: crossPlatformOpportunities.polyYesAsk,
        polyNoAsk: crossPlatformOpportunities.polyNoAsk,
        kalshiYesAsk: crossPlatformOpportunities.kalshiYesAsk,
        kalshiNoAsk: crossPlatformOpportunities.kalshiNoAsk,
      })
      .from(crossPlatformOpportunities)
      .where(eq(crossPlatformOpportunities.isActive, true));

    return rows.map((row) => ({
      id: row.id,
      profitPct: row.potentialProfit ? parseFloat(row.potentialProfit) : 0,
      spread: row.spread ? parseFloat(row.spread) : 0,
      polyYesAsk: row.polyYesAsk ? parseFloat(row.polyYesAsk) : 0,
      polyNoAsk: row.polyNoAsk ? parseFloat(row.polyNoAsk) : 0,
      kalshiYesAsk: row.kalshiYesAsk ? parseFloat(row.kalshiYesAsk) : 0,
      kalshiNoAsk: row.kalshiNoAsk ? parseFloat(row.kalshiNoAsk) : 0,
    }));
  }

  /**
   * Get stats for dashboard
   */
  async getStats(): Promise<{ active: number; total: number; lastUpdatedAt: string | null }> {
    const result = await this.database
      .select({
        active: sql<number>`count(*) filter (where ${crossPlatformOpportunities.isActive} = true)`,
        total: sql<number>`count(*)`,
        lastUpdatedAt: sql<string>`max(${crossPlatformOpportunities.updatedAt})`,
      })
      .from(crossPlatformOpportunities);

    return {
      active: Number(result[0]?.active ?? 0),
      total: Number(result[0]?.total ?? 0),
      lastUpdatedAt: result[0]?.lastUpdatedAt ?? null,
    };
  }

  /**
   * Record snapshots for active opportunities
   * Called after each poll cycle to track profit history
   */
  async recordSnapshots(
    opportunities: {
      id: number;
      profitPct: number;
      spread: number;
      polyYesAsk: number;
      polyNoAsk: number;
      kalshiYesAsk: number;
      kalshiNoAsk: number;
    }[],
  ): Promise<void> {
    if (opportunities.length === 0) return;

    const now = new Date();

    try {
      await this.database.insert(crossPlatformSnapshots).values(
        opportunities.map((opp) => ({
          opportunityId: opp.id,
          profitPct: opp.profitPct.toString(),
          spread: opp.spread.toString(),
          polyYesAsk: opp.polyYesAsk.toString(),
          polyNoAsk: opp.polyNoAsk.toString(),
          kalshiYesAsk: opp.kalshiYesAsk.toString(),
          kalshiNoAsk: opp.kalshiNoAsk.toString(),
          snapshotAt: now,
        })),
      );
    } catch (error) {
      logger.error("Failed to record snapshots", { error: (error as Error).message });
    }
  }

  /**
   * Get opportunity history with duration and peak profit info
   */
  async getHistory(
    limit = 100,
    includeExpired = true,
  ): Promise<
    {
      id: number;
      polymarketQuestion: string;
      kalshiTitle: string;
      peakProfitPct: number;
      minProfitPct: number;
      avgProfitPct: number;
      durationMinutes: number;
      snapshotCount: number;
      detectedAt: string;
      expiredAt?: string;
      isActive: boolean;
    }[]
  > {
    // Get opportunities with aggregated snapshot data
    const rows = await this.database
      .select({
        id: crossPlatformOpportunities.id,
        polymarketQuestion: crossPlatformOpportunities.polymarketQuestion,
        kalshiTitle: crossPlatformOpportunities.kalshiTitle,
        isActive: crossPlatformOpportunities.isActive,
        detectedAt: crossPlatformOpportunities.detectedAt,
        expiredAt: crossPlatformOpportunities.expiredAt,
        lastSeenAt: crossPlatformOpportunities.lastSeenAt,
        currentProfitPct: crossPlatformOpportunities.potentialProfit,
      })
      .from(crossPlatformOpportunities)
      .where(
        and(
          includeExpired ? undefined : eq(crossPlatformOpportunities.isActive, true),
          // Only include opportunities that have/had arbitrage potential
          sql`${crossPlatformOpportunities.potentialProfit}::numeric > 0`,
        ),
      )
      // Sort: Active first, then by detected date (newest first)
      .orderBy(
        desc(crossPlatformOpportunities.isActive),
        desc(crossPlatformOpportunities.detectedAt),
      )
      .limit(limit);

    // Get snapshot stats for each opportunity
    const results = await Promise.all(
      rows.map(async (row) => {
        const snapshotStats = await this.database
          .select({
            count: sql<number>`count(*)`,
            maxProfit: sql<number>`max(${crossPlatformSnapshots.profitPct}::numeric)`,
            minProfit: sql<number>`min(${crossPlatformSnapshots.profitPct}::numeric)`,
            avgProfit: sql<number>`avg(${crossPlatformSnapshots.profitPct}::numeric)`,
          })
          .from(crossPlatformSnapshots)
          .where(eq(crossPlatformSnapshots.opportunityId, row.id));

        const stats = snapshotStats[0];
        const endTime = row.expiredAt ?? row.lastSeenAt;
        const durationMinutes = Math.round(
          (endTime.getTime() - row.detectedAt.getTime()) / (1000 * 60),
        );

        // Use current profit if no snapshots yet
        const currentProfit = row.currentProfitPct ? parseFloat(row.currentProfitPct) : 0;

        return {
          id: row.id,
          polymarketQuestion: row.polymarketQuestion,
          kalshiTitle: row.kalshiTitle,
          peakProfitPct: Number(stats?.maxProfit ?? currentProfit) || currentProfit,
          minProfitPct: Number(stats?.minProfit ?? currentProfit) || currentProfit,
          avgProfitPct: Number(stats?.avgProfit ?? currentProfit) || currentProfit,
          durationMinutes,
          snapshotCount: Number(stats?.count ?? 0),
          detectedAt: row.detectedAt.toISOString(),
          expiredAt: row.expiredAt?.toISOString(),
          isActive: row.isActive ?? false,
        };
      }),
    );

    return results;
  }

  /**
   * Get snapshots for a specific opportunity (for charts)
   */
  async getSnapshots(opportunityId: number): Promise<
    {
      snapshotAt: string;
      profitPct: number;
      spread: number;
      polyYesAsk: number;
      polyNoAsk: number;
      kalshiYesAsk: number;
      kalshiNoAsk: number;
    }[]
  > {
    const rows = await this.database
      .select()
      .from(crossPlatformSnapshots)
      .where(eq(crossPlatformSnapshots.opportunityId, opportunityId))
      .orderBy(asc(crossPlatformSnapshots.snapshotAt));

    return rows.map((row) => ({
      snapshotAt: row.snapshotAt.toISOString(),
      profitPct: row.profitPct ? parseFloat(row.profitPct) : 0,
      spread: row.spread ? parseFloat(row.spread) : 0,
      polyYesAsk: row.polyYesAsk ? parseFloat(row.polyYesAsk) : 0,
      polyNoAsk: row.polyNoAsk ? parseFloat(row.polyNoAsk) : 0,
      kalshiYesAsk: row.kalshiYesAsk ? parseFloat(row.kalshiYesAsk) : 0,
      kalshiNoAsk: row.kalshiNoAsk ? parseFloat(row.kalshiNoAsk) : 0,
    }));
  }

  /**
   * Get aggregate statistics for the history dashboard
   */
  async getHistoryStats(): Promise<{
    totalOpportunities: number;
    activeCount: number;
    expiredCount: number;
    avgDurationMinutes: number;
    maxProfitPct: number;
    avgProfitPct: number;
    totalSnapshots: number;
  }> {
    // Get basic counts
    const opportunityStats = await this.database
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${crossPlatformOpportunities.isActive} = true)`,
        expired: sql<number>`count(*) filter (where ${crossPlatformOpportunities.isActive} = false)`,
        avgDuration: sql<number>`avg(
                    extract(epoch from (
                        coalesce(${crossPlatformOpportunities.expiredAt}, ${crossPlatformOpportunities.lastSeenAt}) - 
                        ${crossPlatformOpportunities.detectedAt}
                    )) / 60
                )`,
      })
      .from(crossPlatformOpportunities)
      .where(sql`${crossPlatformOpportunities.potentialProfit}::numeric > 0`);

    // Get snapshot aggregate stats (only for opportunities with arbitrage)
    const snapshotStats = await this.database
      .select({
        count: sql<number>`count(*)`,
        maxProfit: sql<number>`max(${crossPlatformSnapshots.profitPct}::numeric)`,
        avgProfit: sql<number>`avg(${crossPlatformSnapshots.profitPct}::numeric)`,
      })
      .from(crossPlatformSnapshots)
      .innerJoin(
        crossPlatformOpportunities,
        eq(crossPlatformSnapshots.opportunityId, crossPlatformOpportunities.id),
      )
      .where(sql`${crossPlatformOpportunities.potentialProfit}::numeric > 0`);

    const oppStats = opportunityStats[0];
    const snapStats = snapshotStats[0];

    return {
      totalOpportunities: Number(oppStats?.total ?? 0),
      activeCount: Number(oppStats?.active ?? 0),
      expiredCount: Number(oppStats?.expired ?? 0),
      avgDurationMinutes: Math.round(Number(oppStats?.avgDuration ?? 0)),
      maxProfitPct: Number(snapStats?.maxProfit ?? 0),
      avgProfitPct: Number(snapStats?.avgProfit ?? 0),
      totalSnapshots: Number(snapStats?.count ?? 0),
    };
  }

  /**
   * Get opportunity by ID (for detail view)
   */
  async getById(id: number): Promise<{
    id: number;
    polymarketQuestion: string;
    polymarketUrl: string;
    kalshiTitle: string;
    kalshiUrl: string;
    isActive: boolean;
    detectedAt: string;
    expiredAt?: string;
  } | null> {
    const rows = await this.database
      .select()
      .from(crossPlatformOpportunities)
      .where(eq(crossPlatformOpportunities.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      id: row.id,
      polymarketQuestion: row.polymarketQuestion,
      polymarketUrl: `https://polymarket.com/event/${row.polymarketSlug ?? row.polymarketId}`,
      kalshiTitle: row.kalshiTitle,
      kalshiUrl: buildKalshiUrlFromRow(row.kalshiEventTicker, row.kalshiTitle, row.kalshiTicker),
      isActive: row.isActive ?? false,
      detectedAt: row.detectedAt.toISOString(),
      expiredAt: row.expiredAt?.toISOString(),
    };
  }
}
