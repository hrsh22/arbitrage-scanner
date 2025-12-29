ALTER TABLE "bot_positions" ADD COLUMN "shares" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "current_price" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "source" text DEFAULT 'bot';--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "last_synced_at" timestamp with time zone;