CREATE TABLE "wallet_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_analytics_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_analytics_wallet_idx" ON "wallet_analytics" USING btree ("wallet_address");