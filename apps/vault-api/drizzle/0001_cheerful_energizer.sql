CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'ready', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"vault_address" text NOT NULL,
	"user_address" text NOT NULL,
	"shares" numeric(30, 18) NOT NULL,
	"assets_estimated" numeric(20, 6) NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_vault_idx" ON "withdrawal_requests" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_user_idx" ON "withdrawal_requests" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_requested_idx" ON "withdrawal_requests" USING btree ("requested_at");