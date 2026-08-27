CREATE TYPE "public"."flat_book_cycle_state" AS ENUM('open', 'closed', 'processing', 'processed');--> statement-breakpoint
CREATE TYPE "public"."flat_book_event_type" AS ENUM('close_book', 'begin_processing', 'process_redeems_chunk', 'process_deposits_chunk', 'finalize_processing', 'nav_update', 'capital_allocation');--> statement-breakpoint
CREATE TYPE "public"."flat_book_participant_status" AS ENUM('queued', 'processed', 'cancelled');--> statement-breakpoint
CREATE TABLE "flat_book_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_address" text NOT NULL,
	"cycle_id" integer NOT NULL,
	"state" "flat_book_cycle_state" DEFAULT 'open' NOT NULL,
	"locked_nav" numeric(38, 18),
	"total_queued_deposit_assets" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_queued_redeem_shares" numeric(30, 18) DEFAULT '0' NOT NULL,
	"total_queued_redeem_assets" numeric(20, 6) DEFAULT '0' NOT NULL,
	"queued_deposit_participants" integer DEFAULT 0 NOT NULL,
	"queued_redeem_participants" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flat_book_processing_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_address" text NOT NULL,
	"cycle_id" integer NOT NULL,
	"event_type" "flat_book_event_type" NOT NULL,
	"tx_hash" text,
	"block_number" bigint,
	"processed_count" integer,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flat_book_queue_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_address" text NOT NULL,
	"cycle_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"queued_deposit_assets" numeric(20, 6) DEFAULT '0' NOT NULL,
	"queued_redeem_shares" numeric(30, 18) DEFAULT '0' NOT NULL,
	"processed_deposit_shares" numeric(30, 18) DEFAULT '0' NOT NULL,
	"processed_redeem_assets" numeric(20, 6) DEFAULT '0' NOT NULL,
	"status" "flat_book_participant_status" DEFAULT 'queued' NOT NULL,
	"first_queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "flat_book_cycles_vault_idx" ON "flat_book_cycles" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "flat_book_cycles_state_idx" ON "flat_book_cycles" USING btree ("state");--> statement-breakpoint
CREATE INDEX "flat_book_cycles_processed_at_idx" ON "flat_book_cycles" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "flat_book_cycles_unique_vault_cycle_idx" ON "flat_book_cycles" USING btree ("vault_address","cycle_id");--> statement-breakpoint
CREATE INDEX "flat_book_processing_events_vault_cycle_idx" ON "flat_book_processing_events" USING btree ("vault_address","cycle_id");--> statement-breakpoint
CREATE INDEX "flat_book_processing_events_event_type_idx" ON "flat_book_processing_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "flat_book_processing_events_created_at_idx" ON "flat_book_processing_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "flat_book_queue_participants_vault_cycle_idx" ON "flat_book_queue_participants" USING btree ("vault_address","cycle_id");--> statement-breakpoint
CREATE INDEX "flat_book_queue_participants_user_idx" ON "flat_book_queue_participants" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "flat_book_queue_participants_status_idx" ON "flat_book_queue_participants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "flat_book_queue_participants_unique_vcu_idx" ON "flat_book_queue_participants" USING btree ("vault_address","cycle_id","user_address");