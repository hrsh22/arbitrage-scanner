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
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const errorSeverityEnum = pgEnum("error_severity", [
  "critical", // System down, immediate action required
  "error", // Error that affects functionality
  "warning", // Potential issue, system continues
  "info", // Informational error (e.g., expected validation failures)
]);

/**
 * Bot Positions - tracks all bets placed by the bot
 */
export const botPositions = pgTable(
  "bot_positions",
  {
    id: serial("id").primaryKey(),

    // Bot instance identifier (supports multiple bot configurations)
    botInstanceId: text("bot_instance_id").notNull().default("1"),

    // Market info
    marketId: text("market_id").notNull(),
    marketQuestion: text("market_question").notNull(),
    marketSlug: text("market_slug"),
    tokenId: text("token_id"),

    // Position details
    outcome: text("outcome").notNull(), // "Yes" or "No"
    entryPrice: numeric("entry_price", { precision: 10, scale: 6 }),
    cost: numeric("cost", { precision: 12, scale: 4 }).notNull(),

    // Opposite outcome info (for hedging)
    oppositeTokenId: text("opposite_token_id"),
    oppositeOutcome: text("opposite_outcome"),
    tags: text("tags").array(),

    // Strategy info at time of bet
    closesAt: timestamp("closes_at", { withTimezone: true }),
    hoursUntilCloseAtEntry: numeric("hours_until_close_at_entry", { precision: 10, scale: 4 }),
    pphScore: numeric("pph_score", { precision: 14, scale: 8 }),
    expectedProfit: numeric("expected_profit", { precision: 12, scale: 6 }),

    // Resolution
    status: text("status").notNull().default("open"), // open, won, lost, expired
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    profitLoss: numeric("profit_loss", { precision: 12, scale: 4 }),

    // Hedging
    hedgedAt: timestamp("hedged_at", { withTimezone: true }),
    hedgeTokenId: text("hedge_token_id"),
    hedgeCost: numeric("hedge_cost", { precision: 12, scale: 4 }),
    hedgePrice: numeric("hedge_price", { precision: 10, scale: 6 }),
    hedgeShares: numeric("hedge_shares", { precision: 14, scale: 6 }),

    // Links a hedge position to its original position (NULL for original positions)
    parentPositionId: integer("parent_position_id"),

    // Mode tracking
    isSimulated: boolean("is_simulated").notNull().default(true),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("bot_positions_status_idx").on(table.status),
    marketIdx: index("bot_positions_market_idx").on(table.marketId),
    createdIdx: index("bot_positions_created_idx").on(table.createdAt),
    simulatedIdx: index("bot_positions_simulated_idx").on(table.isSimulated),
    instanceIdx: index("bot_positions_instance_idx").on(table.botInstanceId),
  }),
);

export const botDailyStats = pgTable(
  "bot_daily_stats",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),

    botInstanceId: text("bot_instance_id").notNull().default("1"),

    betsPlaced: integer("bets_placed").notNull().default(0),
    amountDeployed: numeric("amount_deployed", { precision: 14, scale: 4 }).notNull().default("0"),

    betsResolved: integer("bets_resolved").default(0),
    betsWon: integer("bets_won").default(0),
    betsLost: integer("bets_lost").default(0),

    grossProfit: numeric("gross_profit", { precision: 14, scale: 4 }).default("0"),
    grossLoss: numeric("gross_loss", { precision: 14, scale: 4 }).default("0"),
    netPnL: numeric("net_pnl", { precision: 14, scale: 4 }).default("0"),

    isSimulated: boolean("is_simulated").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dateIdx: index("bot_daily_stats_date_idx").on(table.date),
    instanceIdx: index("bot_daily_stats_instance_idx").on(table.botInstanceId),
    dateSimulatedInstanceUnique: uniqueIndex("bot_daily_stats_date_simulated_instance_unique").on(
      table.date,
      table.isSimulated,
      table.botInstanceId,
    ),
  }),
);

export const botErrors = pgTable(
  "bot_errors",
  {
    id: serial("id").primaryKey(),

    botInstanceId: text("bot_instance_id").notNull().default("1"),

    errorCode: varchar("error_code", { length: 50 }).notNull(),
    severity: errorSeverityEnum("severity").notNull().default("error"),
    message: text("message").notNull(),
    stackTrace: text("stack_trace"),

    component: varchar("component", { length: 100 }).notNull(),
    functionName: varchar("function_name", { length: 100 }),
    filePath: varchar("file_path", { length: 255 }),
    lineNumber: integer("line_number"),

    requestId: varchar("request_id", { length: 64 }),
    correlationId: varchar("correlation_id", { length: 64 }),

    positionId: integer("position_id"),
    marketId: text("market_id"),
    tokenId: text("token_id"),

    environment: varchar("environment", { length: 20 }).notNull().default("development"),
    nodeVersion: varchar("node_version", { length: 20 }),
    appVersion: varchar("app_version", { length: 20 }),

    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: varchar("resolved_by", { length: 100 }),
    resolutionNote: text("resolution_note"),

    errorHash: varchar("error_hash", { length: 64 }),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    severityIdx: index("bot_errors_severity_idx").on(table.severity),
    componentIdx: index("bot_errors_component_idx").on(table.component),
    errorCodeIdx: index("bot_errors_error_code_idx").on(table.errorCode),
    createdIdx: index("bot_errors_created_idx").on(table.createdAt),
    instanceIdx: index("bot_errors_instance_idx").on(table.botInstanceId),
    unresolvedIdx: index("bot_errors_unresolved_idx").on(table.isResolved),
    hashIdx: uniqueIndex("bot_errors_hash_unique").on(table.errorHash),
    correlationIdx: index("bot_errors_correlation_idx").on(table.correlationId),
    positionIdx: index("bot_errors_position_idx").on(table.positionId),
    marketIdx: index("bot_errors_market_idx").on(table.marketId),
  }),
);

export type ErrorSeverity = "critical" | "error" | "warning" | "info";
export type BotError = typeof botErrors.$inferSelect;
export type NewBotError = typeof botErrors.$inferInsert;

/**
 * Bot Event Log - all notable events (circuit breakers, errors, trades, etc.)
 *
 * This is viewable from the web dashboard.
 */
export const botEventLog = pgTable(
  "bot_event_log",
  {
    id: serial("id").primaryKey(),

    // Bot instance identifier (supports multiple bot configurations)
    botInstanceId: text("bot_instance_id").notNull().default("1"),

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
    instanceIdx: index("bot_event_log_instance_idx").on(table.botInstanceId),
  }),
);
