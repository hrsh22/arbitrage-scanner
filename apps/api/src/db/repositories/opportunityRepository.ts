import { desc, eq, isNull, sql } from "drizzle-orm"
import { db as defaultDb } from "../client.js"
import { events, markets, opportunities, opportunityActions } from "../schema.js"
import type { NormalizedMarket, Opportunity } from "../../types.js"

const toNumericRequired = (value: number) => value.toString()

type DbClient = typeof defaultDb

const chunk = <T>(arr: T[], size: number): T[][] => {
  if (size <= 0) return [arr]
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

export class OpportunityRepository {
  constructor(private readonly database: DbClient = defaultDb) { }

  /**
   * Upsert events from normalized markets
   */
  async upsertEvents(records: NormalizedMarket[]) {
    const eventMap = new Map<string, NormalizedMarket>()
    for (const record of records) {
      if (record.eventId) {
        eventMap.set(record.eventId, record)
      }
    }

    if (eventMap.size === 0) return

    const values = Array.from(eventMap.entries()).map(([eventId, record]) => ({
      id: eventId,
      slug: record.eventSlug ?? null,
      title: record.eventTitle ?? null,
      startDate: record.eventStartDate ?? null,
      endDate: record.eventEndDate ?? null,
      active: true,
      updatedAt: new Date(),
    }))

    for (const batch of chunk(values, 200)) {
      await this.database
        .insert(events)
        .values(batch)
        .onConflictDoUpdate({
          target: events.id,
          set: {
            slug: sql`excluded.slug`,
            title: sql`excluded.title`,
            startDate: sql`excluded.start_date`,
            endDate: sql`excluded.end_date`,
            active: sql`excluded.active`,
            updatedAt: sql`now()`,
          },
        })
    }
  }

  /**
   * Upsert markets
   */
  async upsertMarkets(records: NormalizedMarket[]) {
    if (!records.length) return

    const deduped = new Map<string, NormalizedMarket>()
    for (const market of records) {
      deduped.set(market.id, market)
    }

    const values = Array.from(deduped.values()).map((market) => ({
      id: market.id,
      eventId: market.eventId ?? null,
      question: market.question,
      slug: market.slug,
      eventSlug: market.eventSlug,
      status: market.status,
      closeDate: market.endsAt,
      updatedAt: new Date(),
    }))

    for (const batch of chunk(values, 200)) {
      await this.database
        .insert(markets)
        .values(batch)
        .onConflictDoUpdate({
          target: markets.id,
          set: {
            eventId: sql`excluded.event_id`,
            question: sql`excluded.question`,
            slug: sql`excluded.slug`,
            eventSlug: sql`excluded.event_slug`,
            status: sql`excluded.status`,
            closeDate: sql`excluded.close_date`,
            updatedAt: sql`now()`,
          },
        })
    }
  }

  /**
   * Upsert opportunities and mark expired ones
   */
  async upsertOpportunities(records: Opportunity[]) {
    if (!records.length) return

    // Get current opportunity keys
    const currentKeys = Array.from(new Set(records.map((r) => r.key)))

    // Mark opportunities as expired if they're no longer in the current set
    if (currentKeys.length > 0) {
      await this.database
        .update(opportunities)
        .set({ expiredAt: new Date(), updatedAt: new Date() })
        .where(
          sql`${opportunities.expiredAt} IS NULL AND ${opportunities.opportunityKey} NOT IN (${sql.join(
            currentKeys.map((k) => sql`${k}`),
            sql`, `
          )})`
        )
    }

    // Upsert current opportunities
    const deduped = new Map<string, Opportunity>()
    for (const item of records) {
      deduped.set(item.key, item)
    }

    const values = Array.from(deduped.values()).map((item) => ({
      opportunityKey: item.key,
      marketId: item.marketId,
      type: item.type,
      outcomes: item.outcomes,
      profitPct: toNumericRequired(item.profitPercentage),
      profitAbs: toNumericRequired(item.profitAbsolute),
      totalCost: toNumericRequired(item.totalCost),
      liquidity: toNumericRequired(item.availableLiquidity),
      score: toNumericRequired(item.score),
      closesAt: item.closesAt,
      detectedAt: item.detectedAt,
      expiredAt: null,  // Reset expiredAt for active opportunities
      raw: {
        marketSlug: item.marketSlug,
        eventSlug: item.eventSlug,
        question: item.question,
      },
      updatedAt: new Date(),
    }))

    for (const batch of chunk(values, 200)) {
      await this.database
        .insert(opportunities)
        .values(batch)
        .onConflictDoUpdate({
          target: opportunities.opportunityKey,
          set: {
            outcomes: sql`excluded.outcomes`,
            profitPct: sql`excluded.profit_pct`,
            profitAbs: sql`excluded.profit_abs`,
            totalCost: sql`excluded.total_cost`,
            liquidity: sql`excluded.liquidity`,
            score: sql`excluded.score`,
            closesAt: sql`excluded.closes_at`,
            detectedAt: sql`excluded.detected_at`,
            expiredAt: sql`NULL`,
            raw: sql`excluded.raw`,
            updatedAt: sql`now()`,
          },
        })
    }
  }

  async persistSnapshot(marketsSnapshot: NormalizedMarket[], opportunitiesSnapshot: Opportunity[]) {
    await this.upsertEvents(marketsSnapshot)
    await this.upsertMarkets(marketsSnapshot)
    await this.upsertOpportunities(opportunitiesSnapshot)
  }

  async getOpportunityByKey(key: string) {
    const [row] = await this.database
      .select()
      .from(opportunities)
      .where(eq(opportunities.opportunityKey, key))
      .limit(1)
    return row ?? null
  }

  async recordAction(
    key: string,
    action: "executed" | "missed",
    investment?: number,
    actualProfit?: number,
  ): Promise<{ success: boolean }> {
    const record = await this.getOpportunityByKey(key)
    if (!record) {
      throw new Error("Opportunity not found")
    }

    await this.database.insert(opportunityActions).values({
      opportunityId: record.id,
      action,
      investment: investment !== undefined ? investment.toString() : null,
      actualProfit: actualProfit !== undefined ? actualProfit.toString() : null,
    })

    return { success: true }
  }

  /**
   * Get recent opportunities (for history view)
   */
  async recent(limit = 100, includeExpired = true) {
    const baseQuery = this.database
      .select({
        id: opportunities.id,
        opportunityKey: opportunities.opportunityKey,
        marketId: opportunities.marketId,
        type: opportunities.type,
        outcomes: opportunities.outcomes,
        profitPct: opportunities.profitPct,
        profitAbs: opportunities.profitAbs,
        totalCost: opportunities.totalCost,
        liquidity: opportunities.liquidity,
        score: opportunities.score,
        closesAt: opportunities.closesAt,
        detectedAt: opportunities.detectedAt,
        expiredAt: opportunities.expiredAt,
        raw: opportunities.raw,
        createdAt: opportunities.createdAt,
        marketSlug: markets.slug,
        eventSlug: markets.eventSlug,
        marketQuestion: markets.question,
      })
      .from(opportunities)
      .leftJoin(markets, eq(opportunities.marketId, markets.id))
      .orderBy(desc(opportunities.detectedAt))
      .limit(limit)

    if (!includeExpired) {
      return baseQuery.where(isNull(opportunities.expiredAt))
    }

    return baseQuery
  }

  /**
   * Get aggregated stats
   */
  async stats() {
    const [summary] = await this.database
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${opportunities.expiredAt} IS NULL then 1 else 0 end)`,
        expired: sql<number>`sum(case when ${opportunities.expiredAt} IS NOT NULL then 1 else 0 end)`,
        potentialProfit: sql<number>`coalesce(sum(${opportunities.profitAbs}), 0)`,
      })
      .from(opportunities)

    const [actionsSummary] = await this.database
      .select({
        executed: sql<number>`sum(case when ${opportunityActions.action} = 'executed' then 1 else 0 end)`,
        missed: sql<number>`sum(case when ${opportunityActions.action} = 'missed' then 1 else 0 end)`,
        actualProfit: sql<number>`coalesce(sum(${opportunityActions.actualProfit}), 0)`,
      })
      .from(opportunityActions)

    return {
      opportunities: summary,
      actions: actionsSummary,
    }
  }
}
