ALTER TABLE "bot_config" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "bot_config" CASCADE;--> statement-breakpoint
ALTER TABLE "bot_daily_stats" DROP CONSTRAINT "bot_daily_stats_date_unique";--> statement-breakpoint
ALTER TABLE "bot_daily_stats" ALTER COLUMN "is_simulated" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_daily_stats_date_simulated_unique" ON "bot_daily_stats" USING btree ("date","is_simulated");