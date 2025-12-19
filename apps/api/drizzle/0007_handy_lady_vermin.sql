CREATE TABLE "cross_platform_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"polymarket_id" text NOT NULL,
	"polymarket_question" text NOT NULL,
	"polymarket_slug" text,
	"poly_yes_bid" numeric(10, 4),
	"poly_yes_ask" numeric(10, 4),
	"poly_no_bid" numeric(10, 4),
	"poly_no_ask" numeric(10, 4),
	"poly_ends_at" timestamp with time zone,
	"kalshi_ticker" text NOT NULL,
	"kalshi_title" text NOT NULL,
	"kalshi_yes_bid" numeric(10, 4),
	"kalshi_yes_ask" numeric(10, 4),
	"kalshi_no_bid" numeric(10, 4),
	"kalshi_no_ask" numeric(10, 4),
	"kalshi_ends_at" timestamp with time zone,
	"spread" numeric(10, 4),
	"potential_profit" numeric(10, 4),
	"match_confidence" numeric(5, 4),
	"match_reason" text,
	"ai_verified" boolean DEFAULT false,
	"ai_reason" text,
	"is_active" boolean DEFAULT true,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cp_opp_active_idx" ON "cross_platform_opportunities" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "cp_opp_detected_idx" ON "cross_platform_opportunities" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "cp_opp_polymarket_idx" ON "cross_platform_opportunities" USING btree ("polymarket_id");--> statement-breakpoint
CREATE INDEX "cp_opp_kalshi_idx" ON "cross_platform_opportunities" USING btree ("kalshi_ticker");