CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text,
	"title" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"status" text,
	"active" boolean,
	"tags" text[],
	"series_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "markets_event_idx" ON "markets" USING btree ("event_id");