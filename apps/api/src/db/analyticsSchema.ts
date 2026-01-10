import {
  index,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const resolvedPositions = pgTable(
  "resolved_positions",
  {
    id: serial("id").primaryKey(),

    walletAddress: text("wallet_address").notNull(),
    tokenId: text("token_id").notNull(),
    conditionId: text("condition_id").notNull(),

    eventSlug: text("event_slug"),
    marketSlug: text("market_slug"),
    marketQuestion: text("market_question"),
    outcome: text("outcome"),

    entryPrice: numeric("entry_price", { precision: 10, scale: 6 }),
    cost: numeric("cost", { precision: 14, scale: 4 }),
    size: numeric("size", { precision: 18, scale: 8 }),

    createdAt: timestamp("created_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    finalPrice: numeric("final_price", { precision: 10, scale: 6 }),
    profitLoss: numeric("profit_loss", { precision: 14, scale: 4 }),
    result: text("result"),

    maxDrawdownPercent: numeric("max_drawdown_percent", { precision: 10, scale: 4 }),
    lowestPrice: numeric("lowest_price", { precision: 10, scale: 6 }),
    highestPrice: numeric("highest_price", { precision: 10, scale: 6 }),

    priceHistory: jsonb("price_history"),
    oppositeOutcomePriceHistory: jsonb("opposite_outcome_price_history"),
    stopLossSimulations: jsonb("stop_loss_simulations"),
    hedgingSimulations: jsonb("hedging_simulations"),

    category: text("category"),
    tags: jsonb("tags"),

    fidelityMinutes: numeric("fidelity_minutes", { precision: 4, scale: 0 }),

    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    walletTokenUnique: uniqueIndex("resolved_positions_wallet_token_unique").on(
      table.walletAddress,
      table.tokenId,
    ),
    walletIdx: index("resolved_positions_wallet_idx").on(table.walletAddress),
    resultIdx: index("resolved_positions_result_idx").on(table.result),
    categoryIdx: index("resolved_positions_category_idx").on(table.category),
    resolvedAtIdx: index("resolved_positions_resolved_at_idx").on(table.resolvedAt),
  }),
);

export type ResolvedPosition = typeof resolvedPositions.$inferSelect;
export type NewResolvedPosition = typeof resolvedPositions.$inferInsert;
