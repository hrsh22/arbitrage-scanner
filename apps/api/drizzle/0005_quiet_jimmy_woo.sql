CREATE TABLE "exclusivity_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_title" text NOT NULL,
	"is_mutually_exclusive" boolean NOT NULL,
	"confidence" text NOT NULL,
	"reason" text NOT NULL,
	"ai_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exclusivity_cache_event_id_unique" UNIQUE("event_id")
);
