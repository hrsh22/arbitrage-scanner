CREATE TABLE "cross_platform_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"profit_pct" numeric(10, 4),
	"spread" numeric(10, 4),
	"poly_yes_ask" numeric(10, 4),
	"poly_no_ask" numeric(10, 4),
	"kalshi_yes_ask" numeric(10, 4),
	"kalshi_no_ask" numeric(10, 4),
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cross_platform_opportunities" ADD COLUMN "kalshi_event_ticker" text;--> statement-breakpoint
ALTER TABLE "cross_platform_opportunities" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cross_platform_snapshots" ADD CONSTRAINT "cross_platform_snapshots_opportunity_id_cross_platform_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."cross_platform_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cp_snapshot_opp_idx" ON "cross_platform_snapshots" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "cp_snapshot_time_idx" ON "cross_platform_snapshots" USING btree ("snapshot_at");