CREATE TABLE "bot_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "bot_daily_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"bets_placed" integer DEFAULT 0 NOT NULL,
	"amount_deployed" numeric(14, 4) DEFAULT '0' NOT NULL,
	"bets_resolved" integer DEFAULT 0,
	"bets_won" integer DEFAULT 0,
	"bets_lost" integer DEFAULT 0,
	"gross_profit" numeric(14, 4) DEFAULT '0',
	"gross_loss" numeric(14, 4) DEFAULT '0',
	"net_pnl" numeric(14, 4) DEFAULT '0',
	"is_simulated" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_daily_stats_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "bot_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_name" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"market_question" text NOT NULL,
	"market_slug" text,
	"token_id" text,
	"outcome" text NOT NULL,
	"entry_price" numeric(10, 6),
	"cost" numeric(12, 4) NOT NULL,
	"closes_at" timestamp with time zone,
	"hours_until_close_at_entry" numeric(10, 4),
	"pph_score" numeric(14, 8),
	"expected_profit" numeric(12, 6),
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"profit_loss" numeric(12, 4),
	"is_simulated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_daily_stats_date_idx" ON "bot_daily_stats" USING btree ("date");--> statement-breakpoint
CREATE INDEX "bot_event_log_type_idx" ON "bot_event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "bot_event_log_created_idx" ON "bot_event_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bot_positions_status_idx" ON "bot_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bot_positions_market_idx" ON "bot_positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "bot_positions_created_idx" ON "bot_positions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bot_positions_simulated_idx" ON "bot_positions" USING btree ("is_simulated");