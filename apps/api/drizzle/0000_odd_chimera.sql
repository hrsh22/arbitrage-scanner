CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"slug" text,
	"status" text NOT NULL,
	"close_date" timestamp with time zone,
	"categories" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_key" text NOT NULL,
	"market_id" text NOT NULL,
	"type" text NOT NULL,
	"profit_pct" numeric(10, 4) NOT NULL,
	"profit_abs" numeric(12, 4) NOT NULL,
	"liquidity" numeric(14, 4) NOT NULL,
	"total_cost" numeric(12, 4),
	"target_outcome" text,
	"target_price" numeric(10, 4),
	"score" numeric(14, 4) NOT NULL,
	"closes_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_opportunity_key_unique" UNIQUE("opportunity_key")
);
--> statement-breakpoint
CREATE TABLE "opportunity_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"action" text NOT NULL,
	"investment" numeric(14, 4),
	"actual_profit" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_actions" ADD CONSTRAINT "opportunity_actions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_type_idx" ON "opportunities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "opportunities_market_idx" ON "opportunities" USING btree ("market_id");