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
  // Context fields (optional, controlled by STORE_AI_MATCH_CONTEXT env var)
  polyEndDate: timestamp("poly_end_date", { withTimezone: true }),
  kalshiEndDate: timestamp("kalshi_end_date", { withTimezone: true }),
  polyResolutionRules: text("poly_resolution_rules"),
  kalshiResolutionRules: text("kalshi_resolution_rules"),
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

// Cross-Platform Opportunities - stores detected Polymarket vs Kalshi arbitrage
export const crossPlatformOpportunities = pgTable("cross_platform_opportunities", {
  id: serial("id").primaryKey(),
  // Polymarket side
  polymarketId: text("polymarket_id").notNull(),
  polymarketQuestion: text("polymarket_question").notNull(),
  polymarketSlug: text("polymarket_slug"),
  polyYesBid: numeric("poly_yes_bid", { precision: 10, scale: 4 }),
  polyYesAsk: numeric("poly_yes_ask", { precision: 10, scale: 4 }),
  polyNoBid: numeric("poly_no_bid", { precision: 10, scale: 4 }),
  polyNoAsk: numeric("poly_no_ask", { precision: 10, scale: 4 }),
  polyEndsAt: timestamp("poly_ends_at", { withTimezone: true }),
  polyLiquidity: numeric("poly_liquidity", { precision: 18, scale: 2 }),
  polyVolume: numeric("poly_volume", { precision: 18, scale: 2 }),
  // Kalshi side
  kalshiTicker: text("kalshi_ticker").notNull(),
  kalshiEventTicker: text("kalshi_event_ticker"),  // Event ticker for URL building
  kalshiTitle: text("kalshi_title").notNull(),
  kalshiYesBid: numeric("kalshi_yes_bid", { precision: 10, scale: 4 }),
  kalshiYesAsk: numeric("kalshi_yes_ask", { precision: 10, scale: 4 }),
  kalshiNoBid: numeric("kalshi_no_bid", { precision: 10, scale: 4 }),
  kalshiNoAsk: numeric("kalshi_no_ask", { precision: 10, scale: 4 }),
  kalshiEndsAt: timestamp("kalshi_ends_at", { withTimezone: true }),
  kalshiVolume: numeric("kalshi_volume", { precision: 18, scale: 2 }),
  kalshiLiquidity: numeric("kalshi_liquidity", { precision: 18, scale: 2 }),
  // Arbitrage info
  arbitrageType: text("arbitrage_type"),  // poly-yes-kalshi-no, poly-no-kalshi-yes, none
  arbitrageInstruction: text("arbitrage_instruction"),
  spread: numeric("spread", { precision: 10, scale: 4 }),
  potentialProfit: numeric("potential_profit", { precision: 10, scale: 4 }),
  // Match info
  matchConfidence: numeric("match_confidence", { precision: 5, scale: 4 }),
  matchReason: text("match_reason"),
  aiVerified: boolean("ai_verified").default(false),
  aiReason: text("ai_reason"),
  // Status
  isActive: boolean("is_active").default(true),
  expiredAt: timestamp("expired_at", { withTimezone: true }),  // When opportunity became inactive
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activeIdx: index("cp_opp_active_idx").on(table.isActive),
  detectedIdx: index("cp_opp_detected_idx").on(table.detectedAt),
  polymarketIdx: index("cp_opp_polymarket_idx").on(table.polymarketId),
  kalshiIdx: index("cp_opp_kalshi_idx").on(table.kalshiTicker),
}))

// Cross-Platform Snapshots - tracks profit percentage changes over time
export const crossPlatformSnapshots = pgTable("cross_platform_snapshots", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull()
    .references(() => crossPlatformOpportunities.id, { onDelete: "cascade" }),
  profitPct: numeric("profit_pct", { precision: 10, scale: 4 }),
  spread: numeric("spread", { precision: 10, scale: 4 }),
  polyYesAsk: numeric("poly_yes_ask", { precision: 10, scale: 4 }),
  polyNoAsk: numeric("poly_no_ask", { precision: 10, scale: 4 }),
  kalshiYesAsk: numeric("kalshi_yes_ask", { precision: 10, scale: 4 }),
  kalshiNoAsk: numeric("kalshi_no_ask", { precision: 10, scale: 4 }),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  opportunityIdx: index("cp_snapshot_opp_idx").on(table.opportunityId),
  snapshotIdx: index("cp_snapshot_time_idx").on(table.snapshotAt),
}))

