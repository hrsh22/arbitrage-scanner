ALTER TABLE "bot_positions" ADD COLUMN "opposite_token_id" text;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "hedged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "hedge_token_id" text;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "hedge_cost" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "hedge_price" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "hedge_shares" numeric(14, 6);