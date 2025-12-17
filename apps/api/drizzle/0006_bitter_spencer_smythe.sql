CREATE TABLE "ai_call_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_date" text NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_call_log_call_date_unique" UNIQUE("call_date")
);
--> statement-breakpoint
CREATE TABLE "ai_match_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_hash" text NOT NULL,
	"poly_question" text NOT NULL,
	"kalshi_title" text NOT NULL,
	"is_exact_match" boolean NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_match_cache_match_hash_unique" UNIQUE("match_hash")
);
--> statement-breakpoint
CREATE INDEX "ai_call_log_date_idx" ON "ai_call_log" USING btree ("call_date");--> statement-breakpoint
CREATE INDEX "ai_match_cache_hash_idx" ON "ai_match_cache" USING btree ("match_hash");