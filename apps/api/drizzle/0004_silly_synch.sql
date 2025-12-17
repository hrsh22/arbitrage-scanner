CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text,
	"title" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"active" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "markets_event_idx" ON "markets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "opportunities_detected_idx" ON "opportunities" USING btree ("detected_at");