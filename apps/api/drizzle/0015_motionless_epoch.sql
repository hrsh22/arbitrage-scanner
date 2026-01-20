DROP INDEX "bot_daily_stats_date_simulated_unique";--> statement-breakpoint
ALTER TABLE "bot_daily_stats" ADD COLUMN "bot_instance_id" text DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_event_log" ADD COLUMN "bot_instance_id" text DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_positions" ADD COLUMN "bot_instance_id" text DEFAULT '1' NOT NULL;--> statement-breakpoint
CREATE INDEX "bot_daily_stats_instance_idx" ON "bot_daily_stats" USING btree ("bot_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_daily_stats_date_simulated_instance_unique" ON "bot_daily_stats" USING btree ("date","is_simulated","bot_instance_id");--> statement-breakpoint
CREATE INDEX "bot_event_log_instance_idx" ON "bot_event_log" USING btree ("bot_instance_id");--> statement-breakpoint
CREATE INDEX "bot_positions_instance_idx" ON "bot_positions" USING btree ("bot_instance_id");