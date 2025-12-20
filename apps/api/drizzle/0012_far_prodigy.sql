ALTER TABLE "ai_match_cache" ADD COLUMN "poly_end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_match_cache" ADD COLUMN "kalshi_end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_match_cache" ADD COLUMN "poly_resolution_rules" text;--> statement-breakpoint
ALTER TABLE "ai_match_cache" ADD COLUMN "kalshi_resolution_rules" text;