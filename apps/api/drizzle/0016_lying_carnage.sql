CREATE TABLE "resolved_positions" (
	"id" serial PRIMARY KEY NOT NULL,
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
CREATE UNIQUE INDEX "resolved_positions_wallet_token_unique" ON "resolved_positions" USING btree ("wallet_address","token_id");--> statement-breakpoint
CREATE INDEX "resolved_positions_wallet_idx" ON "resolved_positions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "resolved_positions_result_idx" ON "resolved_positions" USING btree ("result");--> statement-breakpoint
CREATE INDEX "resolved_positions_category_idx" ON "resolved_positions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "resolved_positions_resolved_at_idx" ON "resolved_positions" USING btree ("resolved_at");