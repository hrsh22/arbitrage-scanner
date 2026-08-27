CREATE TYPE "public"."epoch_request_status" AS ENUM('pending', 'cancelled', 'settled', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."epoch_status" AS ENUM('pending', 'settling', 'settled', 'cancelled');--> statement-breakpoint
CREATE TABLE "epoch_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_address" text NOT NULL,
	"vault_address" text NOT NULL,
	"shares" numeric(30, 18) NOT NULL,
	"epoch_id" text NOT NULL,
	"status" "epoch_request_status" DEFAULT 'pending' NOT NULL,
	"claimable_assets" numeric(20, 6),
	"claimed_assets" numeric(20, 6) DEFAULT '0',
	"claim_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epoch_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "epochs" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" text NOT NULL,
	"vault_address" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"status" "epoch_status" DEFAULT 'pending' NOT NULL,
	"nav_snapshot_id" integer,
	"settled_at" timestamp with time zone,
	"total_shares_requested" numeric(30, 18) DEFAULT '0' NOT NULL,
	"total_assets_to_claim" numeric(20, 6) DEFAULT '0' NOT NULL,
	"pro_rata_ratio" numeric(20, 18),
	"settlement_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epochs_epoch_id_unique" UNIQUE("epoch_id")
);
--> statement-breakpoint
CREATE TABLE "nav_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"epoch_id" text NOT NULL,
	"vault_address" text NOT NULL,
	"total_assets" numeric(20, 6) NOT NULL,
	"total_shares" numeric(30, 18) NOT NULL,
	"share_price" numeric(20, 8) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"tx_hash" text,
	"is_fresh" boolean DEFAULT true NOT NULL,
	"stale_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nav_snapshots_snapshot_id_unique" UNIQUE("snapshot_id")
);
--> statement-breakpoint
ALTER TABLE "epochs" ADD CONSTRAINT "epochs_nav_snapshot_id_nav_snapshots_id_fk" FOREIGN KEY ("nav_snapshot_id") REFERENCES "public"."nav_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "epoch_requests_request_id_idx" ON "epoch_requests" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "epoch_requests_user_idx" ON "epoch_requests" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "epoch_requests_epoch_idx" ON "epoch_requests" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "epoch_requests_user_epoch_idx" ON "epoch_requests" USING btree ("user_address","epoch_id");--> statement-breakpoint
CREATE INDEX "epoch_requests_status_idx" ON "epoch_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "epoch_requests_vault_idx" ON "epoch_requests" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "epochs_epoch_id_idx" ON "epochs" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "epochs_vault_idx" ON "epochs" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "epochs_status_idx" ON "epochs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "epochs_time_range_idx" ON "epochs" USING btree ("start_time","end_time");--> statement-breakpoint
CREATE INDEX "nav_snapshots_snapshot_id_idx" ON "nav_snapshots" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "nav_snapshots_epoch_idx" ON "nav_snapshots" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "nav_snapshots_vault_idx" ON "nav_snapshots" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "nav_snapshots_timestamp_idx" ON "nav_snapshots" USING btree ("timestamp");