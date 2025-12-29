/**
 * Bot Repository - Database operations for the trading bot
 */

import { db } from "../db/client.js";
import { botPositions, botDailyStats, botEventLog, botTrades } from "../db/botSchema.js";
import { eq, desc, and, sql, inArray, isNull } from "drizzle-orm";
import type {
  Position,
  DailyStats,
  OverallStats,
  BotEvent,
  Trade,
  PositionAggregates,
} from "./types.js";

/**
 * Get today's date in YYYY-MM-DD format (UTC)
 */
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

export class BotRepository {
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
    outcome: string;
    entryPrice?: number;
    cost: number;
    closesAt?: Date;
    hoursUntilCloseAtEntry?: number;
    pphScore?: number;
    expectedProfit?: number;
    isSimulated: boolean;
  }): Promise<number> {
    const result = await db
      .insert(botPositions)
      .values({
        marketId: position.marketId,
        marketQuestion: position.marketQuestion,
        marketSlug: position.marketSlug,
        tokenId: position.tokenId,
        outcome: position.outcome,
        entryPrice: position.entryPrice?.toString(),
        cost: position.cost.toString(),
        closesAt: position.closesAt,
        hoursUntilCloseAtEntry: position.hoursUntilCloseAtEntry?.toString(),
        pphScore: position.pphScore?.toString(),
        expectedProfit: position.expectedProfit?.toString(),
        isSimulated: position.isSimulated,
        status: "open",
      })
      .returning({ id: botPositions.id });

    return result[0]!.id;
  }

  /**
   * Get all open positions (includes "in_review" since they still need resolution checks)
   */
  async getOpenPositions(isSimulated?: boolean): Promise<Position[]> {
    let query = db
      .select()
      .from(botPositions)
      .where(sql`${botPositions.status} IN ('open', 'in_review')`)
      .$dynamic();

    if (isSimulated !== undefined) {
      query = query.where(eq(botPositions.isSimulated, isSimulated));
    }

    const rows = await query.orderBy(desc(botPositions.createdAt));
    return rows.map(this.mapPosition);
  }

  /**
   * Check if we have a position in a market (for the same mode)
   */
  async hasPositionInMarket(marketId: string, isSimulated: boolean): Promise<boolean> {
    const result = await db
      .select({ id: botPositions.id })
      .from(botPositions)
      .where(
        and(
          eq(botPositions.marketId, marketId),
          eq(botPositions.isSimulated, isSimulated),
          sql`${botPositions.status} IN ('open', 'in_review')`,
        ),
      )
      .limit(1);

    return result.length > 0;
  }

  /**
   * Get all market IDs we have open positions in (for the same mode)
   */
  async getOpenPositionMarketIds(isSimulated: boolean): Promise<Set<string>> {
    const rows = await db
      .select({ marketId: botPositions.marketId })
      .from(botPositions)
      .where(
        and(
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
   * Get position history (resolved positions)
   */
  async getPositionHistory(limit: number = 100): Promise<Position[]> {
    const rows = await db
      .select()
      .from(botPositions)
      .orderBy(desc(botPositions.createdAt))
      .limit(limit);

    return rows.map(this.mapPosition);
  }

  private mapPosition(row: typeof botPositions.$inferSelect): Position {
    return {
      id: row.id,
      marketId: row.marketId,
      conditionId: row.conditionId ?? undefined,
      marketQuestion: row.marketQuestion,
      marketSlug: row.marketSlug ?? undefined,
      tokenId: row.tokenId ?? "",
      eventSlug: row.eventSlug ?? undefined,
      outcome: row.outcome,
      entryPrice: row.entryPrice ? parseFloat(row.entryPrice) : 0,
      shares: row.shares ? parseFloat(row.shares) : undefined,
      cost: parseFloat(row.cost),
      currentPrice: row.currentPrice ? parseFloat(row.currentPrice) : undefined,
      closesAt: row.closesAt ?? undefined,
      hoursUntilCloseAtEntry: row.hoursUntilCloseAtEntry
        ? parseFloat(row.hoursUntilCloseAtEntry)
        : undefined,
      pphScore: row.pphScore ? parseFloat(row.pphScore) : undefined,
      status: row.status as "open" | "won" | "lost" | "expired" | "sold",
      resolvedAt: row.resolvedAt ?? undefined,
      profitLoss: row.profitLoss ? parseFloat(row.profitLoss) : undefined,
      realizedPnL: row.realizedPnL ? parseFloat(row.realizedPnL) : undefined,
      unrealizedPnL: row.unrealizedPnL ? parseFloat(row.unrealizedPnL) : undefined,
      isSimulated: row.isSimulated,
      source: (row.source as "bot" | "external") ?? "bot",
      lastSyncedAt: row.lastSyncedAt ?? undefined,
      createdAt: row.createdAt,
    };
  }

  // ==========================================
  // DAILY STATS
  // ==========================================

  /**
   * Get or create today's stats record
   */
  async getTodayStats(isSimulated: boolean): Promise<DailyStats> {
    const today = getTodayDate();

    // Try to get existing record first
    const existing = await db
      .select()
      .from(botDailyStats)
      .where(and(eq(botDailyStats.date, today), eq(botDailyStats.isSimulated, isSimulated)))
      .limit(1);

    if (existing.length > 0) {
      return this.mapDailyStats(existing[0]!);
    }

    // Create new record for today
    try {
      const result = await db
        .insert(botDailyStats)
        .values({
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
        .where(and(eq(botDailyStats.date, today), eq(botDailyStats.isSimulated, isSimulated)))
        .limit(1);

      if (retrySelect.length > 0) {
        return this.mapDailyStats(retrySelect[0]!);
      }

      throw error;
    }
  }

  /**
   * Get remaining budget for today
   */
  async getRemainingBudget(dailyBudget: number, isSimulated: boolean): Promise<number> {
    const stats = await this.getTodayStats(isSimulated);
    return Math.max(0, dailyBudget - stats.amountDeployed);
  }

  /**
   * Increment today's bet count and amount deployed
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
      .where(and(eq(botDailyStats.date, today), eq(botDailyStats.isSimulated, isSimulated)));
  }

  /**
   * Record a win
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
      .where(and(eq(botDailyStats.date, today), eq(botDailyStats.isSimulated, isSimulated)));
  }

  /**
   * Record a loss
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
      .where(and(eq(botDailyStats.date, today), eq(botDailyStats.isSimulated, isSimulated)));
  }

  /**
   * Get overall stats across all time
   */
  async getOverallStats(isSimulated?: boolean): Promise<OverallStats> {
    let query = db
      .select({
        totalBets: sql<number>`COALESCE(SUM(${botDailyStats.betsPlaced}), 0)`,
        totalDeployed: sql<string>`COALESCE(SUM(CAST(${botDailyStats.amountDeployed} AS DECIMAL)), 0)`,
        totalWon: sql<number>`COALESCE(SUM(${botDailyStats.betsWon}), 0)`,
        totalLost: sql<number>`COALESCE(SUM(${botDailyStats.betsLost}), 0)`,
        totalPnL: sql<string>`COALESCE(SUM(CAST(${botDailyStats.netPnL} AS DECIMAL)), 0)`,
      })
      .from(botDailyStats);

    if (isSimulated !== undefined) {
      query = query.where(eq(botDailyStats.isSimulated, isSimulated)) as typeof query;
    }

    const result = await query;
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
   * Get daily stats history
   */
  async getDailyStatsHistory(limit: number = 30, isSimulated?: boolean): Promise<DailyStats[]> {
    let query = db.select().from(botDailyStats).$dynamic();

    if (isSimulated !== undefined) {
      query = query.where(eq(botDailyStats.isSimulated, isSimulated));
    }

    const rows = await query.orderBy(desc(botDailyStats.date)).limit(limit);

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
   * Log an event
   */
  async logEvent(event: {
    eventType: "circuit_breaker" | "error" | "trade" | "mode_change" | "info";
    eventName: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await db.insert(botEventLog).values({
      eventType: event.eventType,
      eventName: event.eventName,
      message: event.message,
      metadata: event.metadata,
    });
  }

  /**
   * Get recent events
   */
  async getRecentEvents(limit: number = 100): Promise<BotEvent[]> {
    const rows = await db
      .select()
      .from(botEventLog)
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
   * Get events by type
   */
  async getEventsByType(eventType: string, limit: number = 50): Promise<BotEvent[]> {
    const rows = await db
      .select()
      .from(botEventLog)
      .where(eq(botEventLog.eventType, eventType))
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
   * Find a position by tokenId
   */
  async findPositionByTokenId(tokenId: string): Promise<Position | null> {
    const rows = await db
      .select()
      .from(botPositions)
      .where(eq(botPositions.tokenId, tokenId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return this.mapPosition(rows[0]!);
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

  // ==========================================
  // POSITION SYNC (for Polymarket API sync)
  // ==========================================

  /**
   * Get all positions by tokenIds
   */
  async getPositionsByTokenIds(tokenIds: string[]): Promise<Map<string, Position>> {
    if (tokenIds.length === 0) {
      return new Map();
    }

    const rows = await db
      .select()
      .from(botPositions)
      .where(
        sql`${botPositions.tokenId} = ANY(ARRAY[${sql.join(
          tokenIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[])`,
      );

    const map = new Map<string, Position>();
    for (const row of rows) {
      if (row.tokenId) {
        map.set(row.tokenId, this.mapPosition(row));
      }
    }
    return map;
  }

  /**
   * Update position with synced data from Polymarket API
   */
  async syncPositionFromAPI(
    id: number,
    data: {
      entryPrice?: number;
      shares?: number;
      currentPrice?: number;
    },
  ): Promise<void> {
    await db
      .update(botPositions)
      .set({
        entryPrice: data.entryPrice?.toString(),
        shares: data.shares?.toString(),
        currentPrice: data.currentPrice?.toString(),
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(botPositions.id, id));
  }

  /**
   * Create an external position (detected from Polymarket API, not placed by bot)
   */
  async createExternalPosition(data: {
    tokenId: string;
    outcome: string;
    entryPrice: number;
    shares: number;
    currentPrice: number;
    marketSlug?: string;
    conditionId?: string;
  }): Promise<number> {
    const cost = data.shares * data.entryPrice;
    const result = await db
      .insert(botPositions)
      .values({
        marketId: data.conditionId || `external-${data.tokenId.slice(0, 16)}`,
        marketQuestion: data.marketSlug || `External Position ${data.tokenId.slice(0, 8)}...`,
        marketSlug: data.marketSlug,
        tokenId: data.tokenId,
        outcome: data.outcome,
        entryPrice: data.entryPrice.toString(),
        shares: data.shares.toString(),
        cost: cost.toString(),
        currentPrice: data.currentPrice.toString(),
        isSimulated: false,
        source: "external",
        status: "open",
        lastSyncedAt: new Date(),
      })
      .returning({ id: botPositions.id });

    return result[0]!.id;
  }

  /**
   * Mark a position as sold (early exit detected externally)
   */
  async markPositionAsSold(
    id: number,
    data: {
      sellPrice: number;
      profitLoss: number;
    },
  ): Promise<void> {
    await db
      .update(botPositions)
      .set({
        status: "sold",
        currentPrice: data.sellPrice.toString(),
        profitLoss: data.profitLoss.toString(),
        resolvedAt: new Date(),
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(botPositions.id, id));
  }

  /**
   * Get all open positions with their tokenIds (for sync comparison)
   */
  async getAllOpenPositionsWithTokens(): Promise<Position[]> {
    const rows = await db
      .select()
      .from(botPositions)
      .where(
        and(
          sql`${botPositions.status} IN ('open', 'in_review')`,
          sql`${botPositions.tokenId} IS NOT NULL`,
        ),
      );

    return rows.map(this.mapPosition);
  }

  // ==========================================
  // TRADES
  // ==========================================

  /**
   * Check which transaction hashes are already synced
   * Returns a Map of (transactionHash, conditionId) to identify synced trades
   */
  async getSyncedTransactionHashes(hashes: string[]): Promise<Map<string, string>> {
    if (hashes.length === 0) {
      return new Map();
    }

    const rows = await db
      .select({ transactionHash: botTrades.transactionHash, conditionId: botTrades.conditionId })
      .from(botTrades)
      .where(inArray(botTrades.transactionHash, hashes));

    const synced = new Map<string, string>();
    for (const row of rows) {
      if (row.conditionId) {
        synced.set(`${row.transactionHash}|${row.conditionId}`, row.conditionId);
      } else {
        synced.set(row.transactionHash, "");
      }
    }
    return synced;
  }

  /**
   * Find a position by conditionId
   */
  async findPositionByConditionId(conditionId: string): Promise<Position | null> {
    const rows = await db
      .select()
      .from(botPositions)
      .where(eq(botPositions.conditionId, conditionId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return this.mapPosition(rows[0]!);
  }

  /**
   * Create a trade record
   */
  async createTrade(trade: {
    transactionHash: string;
    positionId?: number;
    tokenId?: string;
    tradeType: "BUY" | "SELL" | "REDEEM";
    side?: "BUY" | "SELL";
    shares: number;
    price: number;
    usdcSize: number;
    conditionId?: string;
    title?: string;
    slug?: string;
    outcome?: string;
    eventSlug?: string;
    tradeTimestamp?: Date;
  }): Promise<number> {
    const result = await db
      .insert(botTrades)
      .values({
        transactionHash: trade.transactionHash,
        positionId: trade.positionId,
        tokenId: trade.tokenId,
        tradeType: trade.tradeType,
        side: trade.side,
        shares: trade.shares.toString(),
        price: trade.price.toString(),
        usdcSize: trade.usdcSize.toString(),
        conditionId: trade.conditionId,
        title: trade.title,
        slug: trade.slug,
        outcome: trade.outcome,
        eventSlug: trade.eventSlug,
        tradeTimestamp: trade.tradeTimestamp,
      })
      .returning({ id: botTrades.id });

    return result[0]!.id;
  }

  /**
   * Get all trades for a token
   */
  async getTradesForToken(tokenId: string): Promise<Trade[]> {
    const rows = await db
      .select()
      .from(botTrades)
      .where(eq(botTrades.tokenId, tokenId))
      .orderBy(botTrades.tradeTimestamp);

    return rows.map(this.mapTrade);
  }

  /**
   * Get all trades by conditionId (for REDEEM without tokenId)
   */
  async getTradesByConditionId(conditionId: string): Promise<Trade[]> {
    const rows = await db
      .select()
      .from(botTrades)
      .where(eq(botTrades.conditionId, conditionId))
      .orderBy(botTrades.tradeTimestamp);

    return rows.map(this.mapTrade);
  }

  /**
   * Update trades with position ID
   */
  async linkTradesToPosition(tokenId: string, positionId: number): Promise<void> {
    await db.update(botTrades).set({ positionId }).where(eq(botTrades.tokenId, tokenId));
  }

  /**
   * Link trades to position by conditionId (for REDEEM trades without tokenId)
   */
  async linkTradesToPositionByConditionId(conditionId: string, positionId: number): Promise<void> {
    await db.update(botTrades).set({ positionId }).where(eq(botTrades.conditionId, conditionId));
  }

  /**
   * Calculate position aggregates from trades
   */
  async calculatePositionAggregates(
    tokenId: string,
    currentPrice?: number,
  ): Promise<PositionAggregates> {
    const trades = await this.getTradesForToken(tokenId);

    const buys = trades.filter((t) => t.tradeType === "BUY");
    const sells = trades.filter((t) => t.tradeType === "SELL");
    const redeems = trades.filter((t) => t.tradeType === "REDEEM");

    const totalSharesBought = buys.reduce((sum, t) => sum + t.shares, 0);
    const totalSharesSold = sells.reduce((sum, t) => sum + t.shares, 0);
    const totalSharesRedeemed = redeems.reduce((sum, t) => sum + t.shares, 0);
    const netShares = totalSharesBought - totalSharesSold - totalSharesRedeemed;

    const totalCost = buys.reduce((sum, t) => sum + t.usdcSize, 0);
    const totalProceeds = sells.reduce((sum, t) => sum + t.usdcSize, 0);
    const totalRedeemProceeds = redeems.reduce((sum, t) => sum + t.usdcSize, 0);

    const avgEntryPrice = totalSharesBought > 0 ? totalCost / totalSharesBought : 0;

    // Realized P/L: proceeds from sells + redeems minus cost basis of those shares
    const sharesRealized = totalSharesSold + totalSharesRedeemed;
    const costOfRealizedShares = sharesRealized * avgEntryPrice;
    const realizedPnL = totalProceeds + totalRedeemProceeds - costOfRealizedShares;

    // Unrealized P/L: value of remaining shares minus their cost basis
    const costOfRemainingShares = netShares * avgEntryPrice;
    const currentValue = currentPrice ? netShares * currentPrice : 0;
    const unrealizedPnL = currentPrice ? currentValue - costOfRemainingShares : 0;

    return {
      totalSharesBought,
      totalSharesSold,
      netShares,
      totalCost,
      totalProceeds,
      avgEntryPrice,
      realizedPnL: Math.round(realizedPnL * 10000) / 10000,
      unrealizedPnL: Math.round(unrealizedPnL * 10000) / 10000,
    };
  }

  /**
   * Create or update position from trade data
   */
  async upsertPositionFromTrade(trade: {
    tokenId: string;
    conditionId?: string;
    title?: string;
    slug?: string;
    outcome?: string;
    eventSlug?: string;
  }): Promise<number> {
    // Check if position exists
    const existing = await this.findPositionByTokenId(trade.tokenId);

    if (existing) {
      return existing.id;
    }

    // Create new position
    const result = await db
      .insert(botPositions)
      .values({
        marketId: trade.conditionId || `sync-${trade.tokenId.slice(0, 16)}`,
        conditionId: trade.conditionId,
        marketQuestion: trade.title || `Position ${trade.tokenId.slice(0, 8)}...`,
        marketSlug: trade.slug,
        tokenId: trade.tokenId,
        eventSlug: trade.eventSlug,
        outcome: trade.outcome || "Unknown",
        cost: "0", // Will be updated from aggregates
        isSimulated: false,
        source: "external",
        status: "open",
        lastSyncedAt: new Date(),
      })
      .returning({ id: botPositions.id });

    return result[0]!.id;
  }

  /**
   * Update position from calculated aggregates
   */
  async updatePositionFromAggregates(
    positionId: number,
    aggregates: PositionAggregates,
    currentPrice?: number,
  ): Promise<void> {
    const status = aggregates.netShares > 0 ? "open" : "sold";
    const totalPnL = aggregates.realizedPnL + aggregates.unrealizedPnL;

    await db
      .update(botPositions)
      .set({
        entryPrice: aggregates.avgEntryPrice.toString(),
        shares: aggregates.netShares.toString(),
        cost: aggregates.totalCost.toString(),
        currentPrice: currentPrice?.toString(),
        profitLoss: totalPnL.toString(),
        realizedPnL: aggregates.realizedPnL.toString(),
        unrealizedPnL: aggregates.unrealizedPnL.toString(),
        status,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: status === "sold" ? new Date() : undefined,
      })
      .where(eq(botPositions.id, positionId));
  }

  private mapTrade(row: typeof botTrades.$inferSelect): Trade {
    return {
      id: row.id,
      transactionHash: row.transactionHash,
      positionId: row.positionId ?? undefined,
      tokenId: row.tokenId ?? undefined,
      tradeType: row.tradeType as "BUY" | "SELL" | "REDEEM",
      side: row.side ? (row.side as "BUY" | "SELL") : undefined,
      shares: parseFloat(row.shares),
      price: parseFloat(row.price),
      usdcSize: parseFloat(row.usdcSize),
      conditionId: row.conditionId ?? undefined,
      title: row.title ?? undefined,
      slug: row.slug ?? undefined,
      outcome: row.outcome ?? undefined,
      eventSlug: row.eventSlug ?? undefined,
      tradeTimestamp: row.tradeTimestamp ?? undefined,
      syncedAt: row.syncedAt,
    };
  }
}

// Singleton instance
let repositoryInstance: BotRepository | null = null;

export function getBotRepository(): BotRepository {
  if (!repositoryInstance) {
    repositoryInstance = new BotRepository();
  }
  return repositoryInstance;
}
