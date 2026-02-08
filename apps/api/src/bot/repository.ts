/**
 * Bot Repository - Database operations for the trading bot
 *
 * All queries are scoped by botInstanceId to support multiple bot configurations.
 */

import { db } from "../db/client.js";
import { botPositions, botDailyStats, botEventLog } from "../db/botSchema.js";
import { eq, desc, and, sql } from "drizzle-orm";
import type { Position, DailyStats, OverallStats, BotEvent } from "./types.js";

/**
 * Get today's date in YYYY-MM-DD format (UTC)
 */
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

export class BotRepository {
  private botInstanceId: string;

  /**
   * Create a repository scoped to a specific bot instance.
   * @param botInstanceId - The bot instance ID (defaults to "1" for backward compatibility)
   */
  constructor(botInstanceId: string = "1") {
    this.botInstanceId = botInstanceId;
  }

  /**
   * Get the bot instance ID this repository is scoped to.
   */
  getBotInstanceId(): string {
    return this.botInstanceId;
  }

  // ==========================================
  // POSITIONS
  // ==========================================

  /**
   * Create a new position
   */
  async createPosition(position: {
    marketId: string;
    marketQuestion: string;
    marketSlug?: string;
    tokenId?: string;
    oppositeTokenId?: string;
    oppositeOutcome?: string;
    tags?: string[];
    outcome: string;
    entryPrice?: number;
    cost: number;
    closesAt?: Date;
    hoursUntilCloseAtEntry?: number;
    pphScore?: number;
    expectedProfit?: number;
    isSimulated: boolean;
    parentPositionId?: number;
  }): Promise<number> {
    const result = await db
      .insert(botPositions)
      .values({
        botInstanceId: this.botInstanceId,
        marketId: position.marketId,
        marketQuestion: position.marketQuestion,
        marketSlug: position.marketSlug,
        tokenId: position.tokenId,
        oppositeTokenId: position.oppositeTokenId,
        oppositeOutcome: position.oppositeOutcome,
        tags: position.tags,
        outcome: position.outcome,
        entryPrice: position.entryPrice?.toString(),
        cost: position.cost.toString(),
        closesAt: position.closesAt,
        hoursUntilCloseAtEntry: position.hoursUntilCloseAtEntry?.toString(),
        pphScore: position.pphScore?.toString(),
        expectedProfit: position.expectedProfit?.toString(),
        isSimulated: position.isSimulated,
        parentPositionId: position.parentPositionId,
        status: "open",
      })
      .returning({ id: botPositions.id });

    return result[0]!.id;
  }

  async createHedgePosition(
    originalPosition: {
      id: number;
      marketId: string;
      marketQuestion: string;
      marketSlug?: string;
      outcome: string;
      closesAt: Date | null;
      isSimulated: boolean;
    },
    hedge: {
      tokenId: string;
      entryPrice: number;
      cost: number;
      outcome: string;
    },
  ): Promise<number> {
    const hedgeOutcome = hedge.outcome;

    const hedgePositionId = await this.createPosition({
      marketId: originalPosition.marketId,
      marketQuestion: originalPosition.marketQuestion,
      marketSlug: originalPosition.marketSlug,
      tokenId: hedge.tokenId,
      outcome: hedgeOutcome,
      entryPrice: hedge.entryPrice,
      cost: hedge.cost,
      closesAt: originalPosition.closesAt ?? undefined,
      isSimulated: originalPosition.isSimulated,
      parentPositionId: originalPosition.id,
    });

    await this.markPositionAsHedged(originalPosition.id);

    return hedgePositionId;
  }

  async markPositionAsHedged(positionId: number): Promise<void> {
    await db
      .update(botPositions)
      .set({
        hedgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(botPositions.id, positionId));
  }

  /**
   * Get all open positions (includes "in_review" since they still need resolution checks)
   * Scoped to this bot instance.
   */
  async getOpenPositions(isSimulated?: boolean): Promise<Position[]> {
    // Build the where condition
    const whereCondition =
      isSimulated !== undefined
        ? and(
            eq(botPositions.botInstanceId, this.botInstanceId),
            eq(botPositions.isSimulated, isSimulated),
            sql`${botPositions.status} IN ('open', 'in_review')`,
          )
        : and(
            eq(botPositions.botInstanceId, this.botInstanceId),
            sql`${botPositions.status} IN ('open', 'in_review')`,
          );

    const rows = await db
      .select()
      .from(botPositions)
      .where(whereCondition)
      .orderBy(desc(botPositions.createdAt));

    return rows.map(this.mapPosition);
  }

  /**
   * Get all open positions across ALL bot instances.
   * Useful for resolution checking that applies to all bots.
   */
  async getAllOpenPositions(
    isSimulated?: boolean,
  ): Promise<(Position & { botInstanceId: string })[]> {
    // Build the where condition
    const whereCondition =
      isSimulated !== undefined
        ? and(
            eq(botPositions.isSimulated, isSimulated),
            sql`${botPositions.status} IN ('open', 'in_review')`,
          )
        : sql`${botPositions.status} IN ('open', 'in_review')`;

    const rows = await db
      .select()
      .from(botPositions)
      .where(whereCondition)
      .orderBy(desc(botPositions.createdAt));

    return rows.map((row) => ({
      ...this.mapPosition(row),
      botInstanceId: row.botInstanceId,
    }));
  }

  /**
   * Check if we have a position in a market (for this bot instance only)
   */
  async hasPositionInMarket(marketId: string, isSimulated: boolean): Promise<boolean> {
    const result = await db
      .select({ id: botPositions.id })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.botInstanceId, this.botInstanceId),
          eq(botPositions.marketId, marketId),
          eq(botPositions.isSimulated, isSimulated),
          sql`${botPositions.status} IN ('open', 'in_review')`,
        ),
      )
      .limit(1);

    return result.length > 0;
  }

  /**
   * Get all market IDs we have open positions in (for this bot instance only)
   * This ensures bot A doesn't skip markets that bot B has positions in.
   */
  async getOpenPositionMarketIds(isSimulated: boolean): Promise<Set<string>> {
    const rows = await db
      .select({ marketId: botPositions.marketId })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.botInstanceId, this.botInstanceId),
          eq(botPositions.isSimulated, isSimulated),
          sql`${botPositions.status} IN ('open', 'in_review')`,
        ),
      );

    return new Set(rows.map((r) => r.marketId));
  }

  /**
   * Update position when it resolves
   */
  async resolvePosition(
    id: number,
    result: { status: "won" | "lost" | "expired"; profitLoss: number },
  ): Promise<void> {
    await db
      .update(botPositions)
      .set({
        status: result.status,
        profitLoss: result.profitLoss.toString(),
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(botPositions.id, id));
  }

  /**
   * Update position status (e.g., from "open" to "in_review")
   */
  async updatePositionStatus(id: number, status: string): Promise<void> {
    await db
      .update(botPositions)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(botPositions.id, id));
  }

  /**
   * Get position history (resolved positions) for this bot instance
   */
  async getPositionHistory(limit: number = 100): Promise<Position[]> {
    const rows = await db
      .select()
      .from(botPositions)
      .where(eq(botPositions.botInstanceId, this.botInstanceId))
      .orderBy(desc(botPositions.createdAt))
      .limit(limit);

    return rows.map(this.mapPosition);
  }

  /**
   * Get position history across ALL bot instances
   */
  async getAllPositionHistory(
    limit: number = 100,
  ): Promise<(Position & { botInstanceId: string })[]> {
    const rows = await db
      .select()
      .from(botPositions)
      .orderBy(desc(botPositions.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...this.mapPosition(row),
      botInstanceId: row.botInstanceId,
    }));
  }

  private mapPosition(row: typeof botPositions.$inferSelect): Position {
    return {
      id: row.id,
      marketId: row.marketId,
      marketQuestion: row.marketQuestion,
      marketSlug: row.marketSlug ?? undefined,
      tokenId: row.tokenId ?? "",
      outcome: row.outcome,
      entryPrice: row.entryPrice ? parseFloat(row.entryPrice) : 0,
      cost: parseFloat(row.cost),
      closesAt: row.closesAt ?? undefined,
      hoursUntilCloseAtEntry: row.hoursUntilCloseAtEntry
        ? parseFloat(row.hoursUntilCloseAtEntry)
        : undefined,
      pphScore: row.pphScore ? parseFloat(row.pphScore) : undefined,
      status: row.status as "open" | "won" | "lost" | "expired",
      resolvedAt: row.resolvedAt ?? undefined,
      profitLoss: row.profitLoss ? parseFloat(row.profitLoss) : undefined,
      isSimulated: row.isSimulated,
      createdAt: row.createdAt,
      parentPositionId: row.parentPositionId ?? undefined,
    };
  }

  // ==========================================
  // DAILY STATS
  // ==========================================

  /**
   * Get or create today's stats record for this bot instance
   */
  async getTodayStats(isSimulated: boolean): Promise<DailyStats> {
    const today = getTodayDate();

    // Try to get existing record first
    const existing = await db
      .select()
      .from(botDailyStats)
      .where(
        and(
          eq(botDailyStats.botInstanceId, this.botInstanceId),
          eq(botDailyStats.date, today),
          eq(botDailyStats.isSimulated, isSimulated),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return this.mapDailyStats(existing[0]!);
    }

    // Create new record for today
    try {
      const result = await db
        .insert(botDailyStats)
        .values({
          botInstanceId: this.botInstanceId,
          date: today,
          isSimulated,
          betsPlaced: 0,
          amountDeployed: "0",
          betsWon: 0,
          betsLost: 0,
          netPnL: "0",
        })
        .returning();

      return this.mapDailyStats(result[0]!);
    } catch (error) {
      // If insert failed due to race condition, try to select again
      const retrySelect = await db
        .select()
        .from(botDailyStats)
        .where(
          and(
            eq(botDailyStats.botInstanceId, this.botInstanceId),
            eq(botDailyStats.date, today),
            eq(botDailyStats.isSimulated, isSimulated),
          ),
        )
        .limit(1);

      if (retrySelect.length > 0) {
        return this.mapDailyStats(retrySelect[0]!);
      }

      throw error;
    }
  }

  /**
   * Get remaining budget for today for this bot instance
   */
  async getRemainingBudget(dailyBudget: number, isSimulated: boolean): Promise<number> {
    const stats = await this.getTodayStats(isSimulated);
    return Math.max(0, dailyBudget - stats.amountDeployed);
  }

  /**
   * Increment today's bet count and amount deployed for this bot instance
   */
  async recordBet(amount: number, isSimulated: boolean): Promise<void> {
    const today = getTodayDate();

    // Ensure record exists
    await this.getTodayStats(isSimulated);

    // Increment
    await db
      .update(botDailyStats)
      .set({
        betsPlaced: sql`${botDailyStats.betsPlaced} + 1`,
        amountDeployed: sql`CAST(${botDailyStats.amountDeployed} AS DECIMAL) + ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(botDailyStats.botInstanceId, this.botInstanceId),
          eq(botDailyStats.date, today),
          eq(botDailyStats.isSimulated, isSimulated),
        ),
      );
  }

  /**
   * Record a win for this bot instance
   */
  async recordWin(profit: number, isSimulated: boolean): Promise<void> {
    const today = getTodayDate();
    await this.getTodayStats(isSimulated);

    await db
      .update(botDailyStats)
      .set({
        betsResolved: sql`${botDailyStats.betsResolved} + 1`,
        betsWon: sql`${botDailyStats.betsWon} + 1`,
        grossProfit: sql`CAST(${botDailyStats.grossProfit} AS DECIMAL) + ${profit}`,
        netPnL: sql`CAST(${botDailyStats.netPnL} AS DECIMAL) + ${profit}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(botDailyStats.botInstanceId, this.botInstanceId),
          eq(botDailyStats.date, today),
          eq(botDailyStats.isSimulated, isSimulated),
        ),
      );
  }

  /**
   * Record a loss for this bot instance
   */
  async recordLoss(loss: number, isSimulated: boolean): Promise<void> {
    const today = getTodayDate();
    await this.getTodayStats(isSimulated);

    await db
      .update(botDailyStats)
      .set({
        betsResolved: sql`${botDailyStats.betsResolved} + 1`,
        betsLost: sql`${botDailyStats.betsLost} + 1`,
        grossLoss: sql`CAST(${botDailyStats.grossLoss} AS DECIMAL) + ${Math.abs(loss)}`,
        netPnL: sql`CAST(${botDailyStats.netPnL} AS DECIMAL) - ${Math.abs(loss)}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(botDailyStats.botInstanceId, this.botInstanceId),
          eq(botDailyStats.date, today),
          eq(botDailyStats.isSimulated, isSimulated),
        ),
      );
  }

  /**
   * Get overall stats across all time for this bot instance
   */
  async getOverallStats(isSimulated?: boolean): Promise<OverallStats> {
    // Build the where condition
    const whereCondition =
      isSimulated !== undefined
        ? and(
            eq(botDailyStats.botInstanceId, this.botInstanceId),
            eq(botDailyStats.isSimulated, isSimulated),
          )
        : eq(botDailyStats.botInstanceId, this.botInstanceId);

    const result = await db
      .select({
        totalBets: sql<number>`COALESCE(SUM(${botDailyStats.betsPlaced}), 0)`,
        totalDeployed: sql<string>`COALESCE(SUM(CAST(${botDailyStats.amountDeployed} AS DECIMAL)), 0)`,
        totalWon: sql<number>`COALESCE(SUM(${botDailyStats.betsWon}), 0)`,
        totalLost: sql<number>`COALESCE(SUM(${botDailyStats.betsLost}), 0)`,
        totalPnL: sql<string>`COALESCE(SUM(CAST(${botDailyStats.netPnL} AS DECIMAL)), 0)`,
      })
      .from(botDailyStats)
      .where(whereCondition);

    const row = result[0]!;

    const totalBets = Number(row.totalBets);
    const totalWon = Number(row.totalWon);
    const totalLost = Number(row.totalLost);
    const totalPnL = parseFloat(row.totalPnL);

    return {
      totalBetsPlaced: totalBets,
      totalAmountDeployed: parseFloat(row.totalDeployed),
      totalBetsWon: totalWon,
      totalBetsLost: totalLost,
      totalNetPnL: totalPnL,
      winRate: totalBets > 0 ? (totalWon / (totalWon + totalLost)) * 100 : 0,
      averagePnLPerBet: totalBets > 0 ? totalPnL / totalBets : 0,
    };
  }

  /**
   * Get overall stats across ALL bot instances
   */
  async getAggregateStats(isSimulated?: boolean): Promise<OverallStats> {
    // Build the where condition
    const whereCondition =
      isSimulated !== undefined ? eq(botDailyStats.isSimulated, isSimulated) : undefined;

    const baseQuery = db
      .select({
        totalBets: sql<number>`COALESCE(SUM(${botDailyStats.betsPlaced}), 0)`,
        totalDeployed: sql<string>`COALESCE(SUM(CAST(${botDailyStats.amountDeployed} AS DECIMAL)), 0)`,
        totalWon: sql<number>`COALESCE(SUM(${botDailyStats.betsWon}), 0)`,
        totalLost: sql<number>`COALESCE(SUM(${botDailyStats.betsLost}), 0)`,
        totalPnL: sql<string>`COALESCE(SUM(CAST(${botDailyStats.netPnL} AS DECIMAL)), 0)`,
      })
      .from(botDailyStats);

    const result = whereCondition ? await baseQuery.where(whereCondition) : await baseQuery;
    const row = result[0]!;

    const totalBets = Number(row.totalBets);
    const totalWon = Number(row.totalWon);
    const totalLost = Number(row.totalLost);
    const totalPnL = parseFloat(row.totalPnL);

    return {
      totalBetsPlaced: totalBets,
      totalAmountDeployed: parseFloat(row.totalDeployed),
      totalBetsWon: totalWon,
      totalBetsLost: totalLost,
      totalNetPnL: totalPnL,
      winRate: totalBets > 0 ? (totalWon / (totalWon + totalLost)) * 100 : 0,
      averagePnLPerBet: totalBets > 0 ? totalPnL / totalBets : 0,
    };
  }

  /**
   * Get daily stats history for this bot instance
   */
  async getDailyStatsHistory(limit: number = 30, isSimulated?: boolean): Promise<DailyStats[]> {
    // Build the where condition
    const whereCondition =
      isSimulated !== undefined
        ? and(
            eq(botDailyStats.botInstanceId, this.botInstanceId),
            eq(botDailyStats.isSimulated, isSimulated),
          )
        : eq(botDailyStats.botInstanceId, this.botInstanceId);

    const rows = await db
      .select()
      .from(botDailyStats)
      .where(whereCondition)
      .orderBy(desc(botDailyStats.date))
      .limit(limit);

    return rows.map(this.mapDailyStats);
  }

  private mapDailyStats(row: typeof botDailyStats.$inferSelect): DailyStats {
    return {
      date: row.date,
      betsPlaced: row.betsPlaced,
      amountDeployed: parseFloat(row.amountDeployed),
      betsWon: row.betsWon ?? 0,
      betsLost: row.betsLost ?? 0,
      netPnL: parseFloat(row.netPnL ?? "0"),
      isSimulated: row.isSimulated ?? true,
    };
  }

  // ==========================================
  // EVENT LOG
  // ==========================================

  /**
   * Log an event for this bot instance
   */
  async logEvent(event: {
    eventType:
      | "circuit_breaker"
      | "error"
      | "trade"
      | "mode_change"
      | "info"
      | "missed_opportunity";
    eventName: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await db.insert(botEventLog).values({
      botInstanceId: this.botInstanceId,
      eventType: event.eventType,
      eventName: event.eventName,
      message: event.message,
      metadata: event.metadata,
    });
  }

  async logMissedOpportunity(
    opportunity: {
      marketId: string;
      marketQuestion: string;
      outcome: string;
      buyPrice: number;
      pphScore: number;
      expectedProfit: number;
      hoursUntilClose: number;
    },
    reason: string,
  ): Promise<void> {
    const existingMissed = await db
      .select({ id: botEventLog.id })
      .from(botEventLog)
      .where(
        and(
          eq(botEventLog.botInstanceId, this.botInstanceId),
          eq(botEventLog.eventType, "missed_opportunity"),
          sql`${botEventLog.metadata}->>'marketId' = ${opportunity.marketId}`,
        ),
      )
      .limit(1);

    if (existingMissed.length > 0) {
      return;
    }

    await this.logEvent({
      eventType: "missed_opportunity",
      eventName: reason,
      message: `Missed: ${opportunity.outcome} @ ${(opportunity.buyPrice * 100).toFixed(1)}¢ on "${opportunity.marketQuestion.substring(0, 60)}..."`,
      metadata: {
        marketId: opportunity.marketId,
        marketQuestion: opportunity.marketQuestion,
        outcome: opportunity.outcome,
        buyPrice: opportunity.buyPrice,
        pphScore: opportunity.pphScore,
        expectedProfit: opportunity.expectedProfit,
        hoursUntilClose: opportunity.hoursUntilClose,
        potentialProfit: opportunity.expectedProfit,
      },
    });
  }

  /**
   * Get recent events for this bot instance
   */
  async getRecentEvents(limit: number = 100): Promise<BotEvent[]> {
    const rows = await db
      .select()
      .from(botEventLog)
      .where(eq(botEventLog.botInstanceId, this.botInstanceId))
      .orderBy(desc(botEventLog.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType as BotEvent["eventType"],
      eventName: row.eventName,
      message: row.message,
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Get recent events across ALL bot instances
   */
  async getAllRecentEvents(limit: number = 100): Promise<(BotEvent & { botInstanceId: string })[]> {
    const rows = await db
      .select()
      .from(botEventLog)
      .orderBy(desc(botEventLog.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      botInstanceId: row.botInstanceId,
      eventType: row.eventType as BotEvent["eventType"],
      eventName: row.eventName,
      message: row.message,
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Get events by type for this bot instance
   */
  async getEventsByType(eventType: string, limit: number = 50): Promise<BotEvent[]> {
    const rows = await db
      .select()
      .from(botEventLog)
      .where(
        and(
          eq(botEventLog.botInstanceId, this.botInstanceId),
          eq(botEventLog.eventType, eventType),
        ),
      )
      .orderBy(desc(botEventLog.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType as BotEvent["eventType"],
      eventName: row.eventName,
      message: row.message,
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: row.createdAt,
    }));
  }

  // ==========================================
  // POSITION SYNC (for API-first approach)
  // ==========================================

  /**
   * Find a position by tokenId (scoped to this bot instance)
   */
  async findPositionByTokenId(tokenId: string): Promise<Position | null> {
    const rows = await db
      .select()
      .from(botPositions)
      .where(
        and(eq(botPositions.botInstanceId, this.botInstanceId), eq(botPositions.tokenId, tokenId)),
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return this.mapPosition(rows[0]!);
  }

  /**
   * Find a position by tokenId across ALL bot instances
   */
  async findAnyPositionByTokenId(
    tokenId: string,
  ): Promise<(Position & { botInstanceId: string }) | null> {
    const rows = await db
      .select()
      .from(botPositions)
      .where(eq(botPositions.tokenId, tokenId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return {
      ...this.mapPosition(rows[0]!),
      botInstanceId: rows[0]!.botInstanceId,
    };
  }

  /**
   * Create a position that was sold (for positions not originally tracked in our DB)
   * This is used when we sell via API and need to record it.
   */
  async createSoldPosition(data: {
    tokenId: string;
    outcome: string;
    entryPrice: number;
    cost: number;
    profitLoss: number;
    marketSlug?: string;
  }): Promise<number> {
    const result = await db
      .insert(botPositions)
      .values({
        botInstanceId: this.botInstanceId,
        marketId: `api-${data.tokenId.slice(0, 16)}`, // Generate a placeholder marketId
        marketQuestion: data.marketSlug || `Position ${data.tokenId.slice(0, 8)}...`,
        marketSlug: data.marketSlug,
        tokenId: data.tokenId,
        outcome: data.outcome,
        entryPrice: data.entryPrice.toString(),
        cost: data.cost.toString(),
        isSimulated: false,
        status: "won",
        profitLoss: data.profitLoss.toString(),
        resolvedAt: new Date(),
      })
      .returning({ id: botPositions.id });

    return result[0]!.id;
  }

  async getOpenPositionsForHedging(isSimulated: boolean): Promise<
    {
      id: number;
      marketId: string;
      marketQuestion: string;
      marketSlug: string | null;
      tokenId: string | null;
      oppositeTokenId: string | null;
      oppositeOutcome: string | null;
      tags: string[] | null;
      outcome: string;
      entryPrice: string | null;
      cost: string;
      closesAt: Date | null;
      createdAt: Date;
      hedgedAt: Date | null;
      isSimulated: boolean;
    }[]
  > {
    const rows = await db
      .select({
        id: botPositions.id,
        marketId: botPositions.marketId,
        marketQuestion: botPositions.marketQuestion,
        marketSlug: botPositions.marketSlug,
        tokenId: botPositions.tokenId,
        oppositeTokenId: botPositions.oppositeTokenId,
        oppositeOutcome: botPositions.oppositeOutcome,
        tags: botPositions.tags,
        outcome: botPositions.outcome,
        entryPrice: botPositions.entryPrice,
        cost: botPositions.cost,
        closesAt: botPositions.closesAt,
        createdAt: botPositions.createdAt,
        hedgedAt: botPositions.hedgedAt,
        isSimulated: botPositions.isSimulated,
      })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.botInstanceId, this.botInstanceId),
          eq(botPositions.isSimulated, isSimulated),
          eq(botPositions.status, "open"),
          sql`${botPositions.hedgedAt} IS NULL`,
          sql`${botPositions.parentPositionId} IS NULL`,
        ),
      )
      .orderBy(botPositions.createdAt);

    return rows;
  }
}

// Singleton instance cache for backward compatibility
const repositoryInstances: Map<string, BotRepository> = new Map();

/**
 * Get a repository instance for a specific bot.
 * Uses caching to return the same instance for the same botInstanceId.
 */
export function getBotRepository(botInstanceId: string = "1"): BotRepository {
  let instance = repositoryInstances.get(botInstanceId);
  if (!instance) {
    instance = new BotRepository(botInstanceId);
    repositoryInstances.set(botInstanceId, instance);
  }
  return instance;
}
