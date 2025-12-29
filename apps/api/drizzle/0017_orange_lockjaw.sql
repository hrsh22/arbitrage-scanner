ALTER TABLE "bot_positions" ADD COLUMN "realized_pnl" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "unrealized_pnl" numeric(12, 4);