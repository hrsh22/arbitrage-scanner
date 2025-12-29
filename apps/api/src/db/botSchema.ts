/**
 * Bot Database Schema
 *
 * Tables for tracking positions, daily stats, and events.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Bot Positions - tracks all bets placed by the bot
 */
export const botPositions = pgTable(
  "bot_positions",
  {
    id: serial("id").primaryKey(),

    // Market info
    marketId: text("market_id").notNull(),
    conditionId: text("condition_id"), // Polymarket's condition ID (market identifier)
    marketQuestion: text("market_question").notNull(),
    marketSlug: text("market_slug"),
    tokenId: text("token_id"),
    eventSlug: text("event_slug"), // Polymarket event slug

    // Position details
    outcome: text("outcome").notNull(), // "Yes" or "No"
    entryPrice: numeric("entry_price", { precision: 10, scale: 6 }),
    shares: numeric("shares", { precision: 18, scale: 8 }), // Actual share count from Polymarket
    cost: numeric("cost", { precision: 12, scale: 4 }).notNull(),
    currentPrice: numeric("current_price", { precision: 10, scale: 6 }), // Latest price from Polymarket

    // Strategy info at time of bet
    closesAt: timestamp("closes_at", { withTimezone: true }),
    hoursUntilCloseAtEntry: numeric("hours_until_close_at_entry", { precision: 10, scale: 4 }),
    pphScore: numeric("pph_score", { precision: 14, scale: 8 }),
    expectedProfit: numeric("expected_profit", { precision: 12, scale: 6 }),

    // Resolution
    status: text("status").notNull().default("open"), // open, won, lost, expired, sold
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    profitLoss: numeric("profit_loss", { precision: 12, scale: 4 }), // Total P/L (realized + unrealized at close)
    realizedPnL: numeric("realized_pnl", { precision: 12, scale: 4 }), // P/L from shares already sold
    unrealizedPnL: numeric("unrealized_pnl", { precision: 12, scale: 4 }), // P/L from shares still held

    // Mode tracking
    isSimulated: boolean("is_simulated").notNull().default(true),
    source: text("source").default("bot"), // "bot" | "external" - where the position originated

    // Sync tracking
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("bot_positions_status_idx").on(table.status),
    marketIdx: index("bot_positions_market_idx").on(table.marketId),
    createdIdx: index("bot_positions_created_idx").on(table.createdAt),
    simulatedIdx: index("bot_positions_simulated_idx").on(table.isSimulated),
  }),
);

/**
 * Bot Daily Stats - aggregated daily statistics
 */
export const botDailyStats = pgTable(
  "bot_daily_stats",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(), // YYYY-MM-DD in UTC

    // Deployment stats
    betsPlaced: integer("bets_placed").notNull().default(0),
    amountDeployed: numeric("amount_deployed", { precision: 14, scale: 4 }).notNull().default("0"),

    // Resolution stats (updated as positions resolve)
    betsResolved: integer("bets_resolved").default(0),
    betsWon: integer("bets_won").default(0),
    betsLost: integer("bets_lost").default(0),

    // P&L
    grossProfit: numeric("gross_profit", { precision: 14, scale: 4 }).default("0"),
    grossLoss: numeric("gross_loss", { precision: 14, scale: 4 }).default("0"),
    netPnL: numeric("net_pnl", { precision: 14, scale: 4 }).default("0"),

    // Mode tracking
    isSimulated: boolean("is_simulated").notNull().default(true),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dateIdx: index("bot_daily_stats_date_idx").on(table.date),
    // Composite unique: one row per date per mode (simulated vs live)
    dateSimulatedUnique: uniqueIndex("bot_daily_stats_date_simulated_unique").on(
      table.date,
      table.isSimulated,
    ),
  }),
);

/**
 * Bot Event Log - all notable events (circuit breakers, errors, trades, etc.)
 *
 * This is viewable from the web dashboard.
 */
export const botEventLog = pgTable(
  "bot_event_log",
  {
    id: serial("id").primaryKey(),

    // Event classification
    eventType: text("event_type").notNull(), // circuit_breaker, error, trade, mode_change, info
    eventName: text("event_name").notNull(), // Specific event name

    // Details
    message: text("message").notNull(),
    metadata: jsonb("metadata"), // Additional structured data
    // Timestamp
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeIdx: index("bot_event_log_type_idx").on(table.eventType),
    createdIdx: index("bot_event_log_created_idx").on(table.createdAt),
  }),
);

/**
 * Bot Trades - individual trade records from Polymarket
 *
 * Each trade (buy/sell/redeem) is stored separately for granular tracking.
 * Positions are aggregated from trades.
 */
export const botTrades = pgTable(
  "bot_trades",
  {
    id: serial("id").primaryKey(),

    // Unique identifier from Polymarket (prevents double-sync)
    // Note: REDEEM transactions can have multiple markets per tx, so we use (hash, conditionId) as unique
    transactionHash: text("transaction_hash").notNull(),

    // Link to position (optional - set after position is created/found)
    positionId: integer("position_id").references(() => botPositions.id),

    // Trade details
    tokenId: text("token_id"), // asset from Polymarket (empty for REDEEM)
    tradeType: text("trade_type").notNull().default("BUY"), // "BUY" | "SELL" | "REDEEM"
    side: text("side"), // "BUY" | "SELL" | empty for REDEEM (legacy, use tradeType instead)
    shares: numeric("shares", { precision: 18, scale: 8 }).notNull(),
    price: numeric("price", { precision: 10, scale: 6 }).notNull(),
    usdcSize: numeric("usdc_size", { precision: 12, scale: 4 }).notNull(),

    // Market metadata (from activity API)
    conditionId: text("condition_id"), // Market ID
    title: text("title"),
    slug: text("slug"),
    outcome: text("outcome"),
    eventSlug: text("event_slug"),

    // Timestamps
    tradeTimestamp: timestamp("trade_timestamp", { withTimezone: true }), // From Polymarket
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Unique on (transactionHash, conditionId) to handle REDEEM with multiple markets per tx
    txHashConditionIdx: uniqueIndex("bot_trades_tx_hash_condition_idx").on(
      table.transactionHash,
      table.conditionId,
    ),
    tokenIdx: index("bot_trades_token_idx").on(table.tokenId),
    positionIdx: index("bot_trades_position_idx").on(table.positionId),
    timestampIdx: index("bot_trades_timestamp_idx").on(table.tradeTimestamp),
    tradeTypeIdx: index("bot_trades_type_idx").on(table.tradeType),
  }),
);
