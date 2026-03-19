CREATE TABLE "user_vault_activity_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"vault_address" text NOT NULL,
	"user_address" text NOT NULL,
	"cycle_id" integer,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"status" text,
	"request_id" text,
	"tx_hash" text,
	"asset_amount" text,
	"share_amount" text,
	"metadata" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_lifecycle_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"vault_address" text NOT NULL,
	"cycle_id" integer,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"status" text,
	"request_id" text,
	"tx_hash" text,
	"asset_amount" text,
	"share_amount" text,
	"metadata" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_vault_activity_events_vault_idx" ON "user_vault_activity_events" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "user_vault_activity_events_user_idx" ON "user_vault_activity_events" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "user_vault_activity_events_occurred_idx" ON "user_vault_activity_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "user_vault_activity_events_request_idx" ON "user_vault_activity_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "vault_lifecycle_events_vault_idx" ON "vault_lifecycle_events" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "vault_lifecycle_events_occurred_idx" ON "vault_lifecycle_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "vault_lifecycle_events_cycle_idx" ON "vault_lifecycle_events" USING btree ("cycle_id");