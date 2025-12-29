CREATE TABLE "bot_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_hash" text NOT NULL,
	"position_id" integer,
	"token_id" text NOT NULL,
	"side" text NOT NULL,
	"shares" numeric(18, 8) NOT NULL,
	"price" numeric(10, 6) NOT NULL,
	"usdc_size" numeric(12, 4) NOT NULL,
	"condition_id" text,
	"title" text,
	"slug" text,
	"outcome" text,
	"event_slug" text,
	"trade_timestamp" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_trades_transaction_hash_unique" UNIQUE("transaction_hash")
);
--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "condition_id" text;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "event_slug" text;--> statement-breakpoint
ALTER TABLE "bot_trades" ADD CONSTRAINT "bot_trades_position_id_bot_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."bot_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_trades_tx_hash_idx" ON "bot_trades" USING btree ("transaction_hash");--> statement-breakpoint
CREATE INDEX "bot_trades_token_idx" ON "bot_trades" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "bot_trades_position_idx" ON "bot_trades" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "bot_trades_timestamp_idx" ON "bot_trades" USING btree ("trade_timestamp");