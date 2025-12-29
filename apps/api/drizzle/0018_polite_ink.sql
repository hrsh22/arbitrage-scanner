ALTER TABLE "bot_trades" DROP CONSTRAINT "bot_trades_transaction_hash_unique";--> statement-breakpoint
DROP INDEX "bot_trades_tx_hash_idx";--> statement-breakpoint
ALTER TABLE "bot_trades" ALTER COLUMN "token_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_trades" ALTER COLUMN "side" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_trades" ADD COLUMN "trade_type" text DEFAULT 'BUY' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_trades_tx_hash_condition_idx" ON "bot_trades" USING btree ("transaction_hash","condition_id");--> statement-breakpoint
CREATE INDEX "bot_trades_type_idx" ON "bot_trades" USING btree ("trade_type");