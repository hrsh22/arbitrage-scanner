CREATE TABLE "vault_analytics_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"vault_address" text NOT NULL,
	"wallet_address" text NOT NULL,
	"last_activity_timestamp" bigint,
	"last_successful_sync_at" timestamp with time zone,
	"last_attempted_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_nav_history" ALTER COLUMN "vault_address" SET NOT NULL;--> statement-breakpoint
CREATE TABLE "vault_detailed_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"vault_address" text NOT NULL,
	"wallet_address" text NOT NULL,
	"total_pnl" numeric(14, 4),
	"total_cost" numeric(14, 4),
	"win_count" numeric(10, 0),
	"loss_count" numeric(10, 0),
	"win_rate" numeric(6, 4),
	"avg_entry_price" numeric(10, 6),
	"avg_pnl_per_position" numeric(14, 4),
	"avg_holding_hours" numeric(10, 2),
	"stop_loss_analysis" jsonb,
	"hedging_analysis" jsonb,
	"category_breakdown" jsonb,
	"daily_pnl" jsonb,
	"entry_timing_analysis" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_resolved_analytics_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"vault_address" text NOT NULL,
	"wallet_address" text NOT NULL,
	"token_id" text NOT NULL,
	"condition_id" text NOT NULL,
	"event_slug" text,
	"market_slug" text,
	"market_question" text,
	"outcome" text,
	"entry_price" numeric(10, 6),
	"cost" numeric(14, 4),
	"size" numeric(18, 8),
	"created_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"market_end_date" timestamp with time zone,
	"final_price" numeric(10, 6),
	"profit_loss" numeric(14, 4),
	"result" text,
	"max_drawdown_percent" numeric(10, 4),
	"lowest_price" numeric(10, 6),
	"highest_price" numeric(10, 6),
	"price_history" jsonb,
	"opposite_outcome_price_history" jsonb,
	"stop_loss_simulations" jsonb,
	"hedging_simulations" jsonb,
	"category" text,
	"tags" jsonb,
	"fidelity_minutes" numeric(4, 0),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vault_analytics_sync_state_unique" ON "vault_analytics_sync_state" USING btree ("network","vault_address");--> statement-breakpoint
CREATE INDEX "vault_analytics_sync_state_wallet_idx" ON "vault_analytics_sync_state" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_detailed_analytics_unique" ON "vault_detailed_analytics" USING btree ("network","vault_address");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_resolved_analytics_positions_unique" ON "vault_resolved_analytics_positions" USING btree ("network","vault_address","token_id");--> statement-breakpoint
CREATE INDEX "vault_resolved_analytics_positions_vault_idx" ON "vault_resolved_analytics_positions" USING btree ("network","vault_address");--> statement-breakpoint
CREATE INDEX "vault_resolved_analytics_positions_wallet_idx" ON "vault_resolved_analytics_positions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "vault_resolved_analytics_positions_resolved_at_idx" ON "vault_resolved_analytics_positions" USING btree ("resolved_at");
