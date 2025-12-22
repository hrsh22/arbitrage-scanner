/**
 * Bot Repository - Database operations for the trading bot
 */

import { db } from "../db/client.js"
import {
    botPositions,
    botDailyStats,
    botEventLog,
    botConfig
} from "../db/botSchema.js"
import { eq, desc, and, sql, gte } from "drizzle-orm"
import type { Position, DailyStats, OverallStats, BotEvent } from "./types.js"

/**
 * Get today's date in YYYY-MM-DD format (UTC)
 */
function getTodayDate(): string {
    return new Date().toISOString().split("T")[0]!
}

export class BotRepository {
    // ==========================================
    // POSITIONS
    // ==========================================

    /**
     * Create a new position
     */
    async createPosition(position: {
        marketId: string
        marketQuestion: string
        marketSlug?: string
        tokenId?: string
        outcome: string
        entryPrice?: number
        cost: number
        closesAt?: Date
        hoursUntilCloseAtEntry?: number
        pphScore?: number
        expectedProfit?: number
        isSimulated: boolean
    }): Promise<number> {
        const result = await db.insert(botPositions).values({
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
        }).returning({ id: botPositions.id })

        return result[0]!.id
    }

    /**
     * Get all open positions (includes "in_review" since they still need resolution checks)
     */
    async getOpenPositions(): Promise<Position[]> {
        const rows = await db.select()
            .from(botPositions)
            .where(sql`${botPositions.status} IN ('open', 'in_review')`)
            .orderBy(desc(botPositions.createdAt))

        return rows.map(this.mapPosition)
    }

    /**
     * Check if we have a position in a market
     */
    async hasPositionInMarket(marketId: string): Promise<boolean> {
        const result = await db.select({ id: botPositions.id })
            .from(botPositions)
            .where(and(
                eq(botPositions.marketId, marketId),
                eq(botPositions.status, "open")
            ))
            .limit(1)

        return result.length > 0
    }

    /**
     * Get all market IDs we have open positions in
     */
    async getOpenPositionMarketIds(): Promise<Set<string>> {
        const rows = await db.select({ marketId: botPositions.marketId })
            .from(botPositions)
            .where(eq(botPositions.status, "open"))

        return new Set(rows.map(r => r.marketId))
    }

    /**
     * Update position when it resolves
     */
    async resolvePosition(
        id: number,
        result: { status: "won" | "lost" | "expired"; profitLoss: number }
    ): Promise<void> {
        await db.update(botPositions)
            .set({
                status: result.status,
                profitLoss: result.profitLoss.toString(),
                resolvedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(botPositions.id, id))
    }

    /**
     * Update position status (e.g., from "open" to "in_review")
     */
    async updatePositionStatus(id: number, status: string): Promise<void> {
        await db.update(botPositions)
            .set({
                status,
                updatedAt: new Date(),
            })
            .where(eq(botPositions.id, id))
    }

    /**
     * Get position history (resolved positions)
     */
    async getPositionHistory(limit: number = 100): Promise<Position[]> {
        const rows = await db.select()
            .from(botPositions)
            .orderBy(desc(botPositions.createdAt))
            .limit(limit)

        return rows.map(this.mapPosition)
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
            hoursUntilCloseAtEntry: row.hoursUntilCloseAtEntry ? parseFloat(row.hoursUntilCloseAtEntry) : undefined,
            pphScore: row.pphScore ? parseFloat(row.pphScore) : undefined,
            status: row.status as "open" | "won" | "lost" | "expired",
            resolvedAt: row.resolvedAt ?? undefined,
            profitLoss: row.profitLoss ? parseFloat(row.profitLoss) : undefined,
            isSimulated: row.isSimulated,
            createdAt: row.createdAt,
        }
    }

    // ==========================================
    // DAILY STATS
    // ==========================================

    /**
     * Get or create today's stats record
     */
    async getTodayStats(isSimulated: boolean): Promise<DailyStats> {
        const today = getTodayDate()

        // Try to get existing record
        const existing = await db.select()
            .from(botDailyStats)
            .where(and(
                eq(botDailyStats.date, today),
                eq(botDailyStats.isSimulated, isSimulated)
            ))
            .limit(1)

        if (existing.length > 0) {
            return this.mapDailyStats(existing[0]!)
        }

        // Create new record for today
        const result = await db.insert(botDailyStats)
            .values({
                date: today,
                isSimulated,
                betsPlaced: 0,
                amountDeployed: "0",
                betsWon: 0,
                betsLost: 0,
                netPnL: "0",
            })
            .returning()

        return this.mapDailyStats(result[0]!)
    }

    /**
     * Get remaining budget for today
     */
    async getRemainingBudget(dailyBudget: number, isSimulated: boolean): Promise<number> {
        const stats = await this.getTodayStats(isSimulated)
        return Math.max(0, dailyBudget - stats.amountDeployed)
    }

    /**
     * Increment today's bet count and amount deployed
     */
    async recordBet(amount: number, isSimulated: boolean): Promise<void> {
        const today = getTodayDate()

        // Ensure record exists
        await this.getTodayStats(isSimulated)

        // Increment
        await db.update(botDailyStats)
            .set({
                betsPlaced: sql`${botDailyStats.betsPlaced} + 1`,
                amountDeployed: sql`CAST(${botDailyStats.amountDeployed} AS DECIMAL) + ${amount}`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(botDailyStats.date, today),
                eq(botDailyStats.isSimulated, isSimulated)
            ))
    }

    /**
     * Record a win
     */
    async recordWin(profit: number, isSimulated: boolean): Promise<void> {
        const today = getTodayDate()
        await this.getTodayStats(isSimulated)

        await db.update(botDailyStats)
            .set({
                betsResolved: sql`${botDailyStats.betsResolved} + 1`,
                betsWon: sql`${botDailyStats.betsWon} + 1`,
                grossProfit: sql`CAST(${botDailyStats.grossProfit} AS DECIMAL) + ${profit}`,
                netPnL: sql`CAST(${botDailyStats.netPnL} AS DECIMAL) + ${profit}`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(botDailyStats.date, today),
                eq(botDailyStats.isSimulated, isSimulated)
            ))
    }

    /**
     * Record a loss
     */
    async recordLoss(loss: number, isSimulated: boolean): Promise<void> {
        const today = getTodayDate()
        await this.getTodayStats(isSimulated)

        await db.update(botDailyStats)
            .set({
                betsResolved: sql`${botDailyStats.betsResolved} + 1`,
                betsLost: sql`${botDailyStats.betsLost} + 1`,
                grossLoss: sql`CAST(${botDailyStats.grossLoss} AS DECIMAL) + ${Math.abs(loss)}`,
                netPnL: sql`CAST(${botDailyStats.netPnL} AS DECIMAL) - ${Math.abs(loss)}`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(botDailyStats.date, today),
                eq(botDailyStats.isSimulated, isSimulated)
            ))
    }

    /**
     * Get overall stats across all time
     */
    async getOverallStats(isSimulated?: boolean): Promise<OverallStats> {
        let query = db.select({
            totalBets: sql<number>`COALESCE(SUM(${botDailyStats.betsPlaced}), 0)`,
            totalDeployed: sql<string>`COALESCE(SUM(CAST(${botDailyStats.amountDeployed} AS DECIMAL)), 0)`,
            totalWon: sql<number>`COALESCE(SUM(${botDailyStats.betsWon}), 0)`,
            totalLost: sql<number>`COALESCE(SUM(${botDailyStats.betsLost}), 0)`,
            totalPnL: sql<string>`COALESCE(SUM(CAST(${botDailyStats.netPnL} AS DECIMAL)), 0)`,
        }).from(botDailyStats)

        if (isSimulated !== undefined) {
            query = query.where(eq(botDailyStats.isSimulated, isSimulated)) as typeof query
        }

        const result = await query
        const row = result[0]!

        const totalBets = Number(row.totalBets)
        const totalWon = Number(row.totalWon)
        const totalLost = Number(row.totalLost)
        const totalPnL = parseFloat(row.totalPnL)

        return {
            totalBetsPlaced: totalBets,
            totalAmountDeployed: parseFloat(row.totalDeployed),
            totalBetsWon: totalWon,
            totalBetsLost: totalLost,
            totalNetPnL: totalPnL,
            winRate: totalBets > 0 ? (totalWon / (totalWon + totalLost)) * 100 : 0,
            averagePnLPerBet: totalBets > 0 ? totalPnL / totalBets : 0,
        }
    }

    /**
     * Get daily stats history
     */
    async getDailyStatsHistory(limit: number = 30): Promise<DailyStats[]> {
        const rows = await db.select()
            .from(botDailyStats)
            .orderBy(desc(botDailyStats.date))
            .limit(limit)

        return rows.map(this.mapDailyStats)
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
        }
    }

    // ==========================================
    // EVENT LOG
    // ==========================================

    /**
     * Log an event
     */
    async logEvent(event: {
        eventType: "circuit_breaker" | "error" | "trade" | "mode_change" | "info"
        eventName: string
        message: string
        metadata?: Record<string, unknown>
    }): Promise<void> {
        await db.insert(botEventLog).values({
            eventType: event.eventType,
            eventName: event.eventName,
            message: event.message,
            metadata: event.metadata,
        })
    }

    /**
     * Get recent events
     */
    async getRecentEvents(limit: number = 100): Promise<BotEvent[]> {
        const rows = await db.select()
            .from(botEventLog)
            .orderBy(desc(botEventLog.createdAt))
            .limit(limit)

        return rows.map(row => ({
            id: row.id,
            eventType: row.eventType as BotEvent["eventType"],
            eventName: row.eventName,
            message: row.message,
            metadata: row.metadata as Record<string, unknown> | undefined,
            createdAt: row.createdAt,
        }))
    }

    /**
     * Get events by type
     */
    async getEventsByType(
        eventType: string,
        limit: number = 50
    ): Promise<BotEvent[]> {
        const rows = await db.select()
            .from(botEventLog)
            .where(eq(botEventLog.eventType, eventType))
            .orderBy(desc(botEventLog.createdAt))
            .limit(limit)

        return rows.map(row => ({
            id: row.id,
            eventType: row.eventType as BotEvent["eventType"],
            eventName: row.eventName,
            message: row.message,
            metadata: row.metadata as Record<string, unknown> | undefined,
            createdAt: row.createdAt,
        }))
    }

    // ==========================================
    // CONFIG
    // ==========================================

    /**
     * Get config value
     */
    async getConfig(key: string): Promise<string | null> {
        const result = await db.select()
            .from(botConfig)
            .where(eq(botConfig.key, key))
            .limit(1)

        return result[0]?.value ?? null
    }

    /**
     * Set config value
     */
    async setConfig(key: string, value: string): Promise<void> {
        await db.insert(botConfig)
            .values({ key, value })
            .onConflictDoUpdate({
                target: botConfig.key,
                set: { value, updatedAt: new Date() },
            })
    }

    /**
     * Get bot mode from config
     */
    async getMode(): Promise<"simulation" | "live"> {
        const mode = await this.getConfig("mode")
        return (mode === "live" ? "live" : "simulation")
    }

    /**
     * Set bot mode
     */
    async setMode(mode: "simulation" | "live"): Promise<void> {
        await this.setConfig("mode", mode)
    }
}

// Singleton instance
let repositoryInstance: BotRepository | null = null

export function getBotRepository(): BotRepository {
    if (!repositoryInstance) {
        repositoryInstance = new BotRepository()
    }
    return repositoryInstance
}
