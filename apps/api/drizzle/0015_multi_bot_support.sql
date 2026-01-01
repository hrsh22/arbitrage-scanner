-- Migration: Add multi-bot support
-- Adds bot_instance_id column to all bot tables to support multiple bot configurations

-- Add bot_instance_id to bot_positions
ALTER TABLE "bot_positions" ADD COLUMN "bot_instance_id" text DEFAULT '1' NOT NULL;

-- Add bot_instance_id to bot_daily_stats
ALTER TABLE "bot_daily_stats" ADD COLUMN "bot_instance_id" text DEFAULT '1' NOT NULL;

-- Add bot_instance_id to bot_event_log
ALTER TABLE "bot_event_log" ADD COLUMN "bot_instance_id" text DEFAULT '1' NOT NULL;

-- Drop old unique constraint on bot_daily_stats (date + is_simulated)
DROP INDEX IF EXISTS "bot_daily_stats_date_simulated_unique";

-- Create new unique constraint including bot_instance_id
CREATE UNIQUE INDEX "bot_daily_stats_date_simulated_instance_unique" ON "bot_daily_stats" USING btree ("date","is_simulated","bot_instance_id");

-- Add indexes for bot_instance_id
CREATE INDEX "bot_positions_instance_idx" ON "bot_positions" USING btree ("bot_instance_id");
CREATE INDEX "bot_daily_stats_instance_idx" ON "bot_daily_stats" USING btree ("bot_instance_id");
CREATE INDEX "bot_event_log_instance_idx" ON "bot_event_log" USING btree ("bot_instance_id");
