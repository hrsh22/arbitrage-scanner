import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core"

// Events table - stores Polymarket events
export const events = pgTable("events", {
  id: text("id").primaryKey(),
  slug: text("slug"),
  title: text("title"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  active: boolean("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// Markets table - stores individual markets within events
export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  eventId: text("event_id"),
  question: text("question").notNull(),
  slug: text("slug"),
  eventSlug: text("event_slug"),
  status: text("status").notNull(),
  closeDate: timestamp("close_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventIdx: index("markets_event_idx").on(table.eventId),
}))

// Opportunities table - stores detected arbitrage opportunities
export const opportunities = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    opportunityKey: text("opportunity_key").notNull().unique(),
    marketId: text("market_id").notNull(),
    type: text("type").notNull(),
    outcomes: jsonb("outcomes"),  // Array of {name, askPrice, liquidity}
    profitPct: numeric("profit_pct", { precision: 10, scale: 4 }).notNull(),
    profitAbs: numeric("profit_abs", { precision: 12, scale: 4 }).notNull(),
    totalCost: numeric("total_cost", { precision: 12, scale: 4 }).notNull(),
    liquidity: numeric("liquidity", { precision: 14, scale: 4 }).notNull(),
    score: numeric("score", { precision: 14, scale: 4 }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    expiredAt: timestamp("expired_at", { withTimezone: true }),  // When opportunity disappeared
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeIdx: index("opportunities_type_idx").on(table.type),
    marketIdx: index("opportunities_market_idx").on(table.marketId),
    profitIdx: index("opportunities_profit_idx").on(table.profitPct),
    detectedIdx: index("opportunities_detected_idx").on(table.detectedAt),
  }),
)

// Actions table - tracks user actions on opportunities
export const opportunityActions = pgTable("opportunity_actions", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id")
    .notNull()
    .references(() => opportunities.id),
  action: text("action").notNull(),
  investment: numeric("investment", { precision: 14, scale: 4 }),
  actualProfit: numeric("actual_profit", { precision: 14, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// Exclusivity cache - persists AI exclusivity check results
export const exclusivityCache = pgTable("exclusivity_cache", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventTitle: text("event_title").notNull(),
  isMutuallyExclusive: boolean("is_mutually_exclusive").notNull(),
  confidence: text("confidence").notNull(),  // high, medium, low
  reason: text("reason").notNull(),
  aiVerified: boolean("ai_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// AI Match Cache - stores AI verification results for cross-platform matching
export const aiMatchCache = pgTable("ai_match_cache", {
  id: serial("id").primaryKey(),
  matchHash: text("match_hash").notNull().unique(), // MD5 hash of poly+kalshi
  polyQuestion: text("poly_question").notNull(),
  kalshiTitle: text("kalshi_title").notNull(),
  isExactMatch: boolean("is_exact_match").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hashIdx: index("ai_match_cache_hash_idx").on(table.matchHash),
}))

// AI Call Log - tracks daily AI API usage
export const aiCallLog = pgTable("ai_call_log", {
  id: serial("id").primaryKey(),
  callDate: text("call_date").notNull().unique(), // YYYY-MM-DD in UTC
  callCount: integer("call_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dateIdx: index("ai_call_log_date_idx").on(table.callDate),
}))
