CREATE TYPE "public"."entitlement_status" AS ENUM('pending', 'partially_fulfilled', 'fully_fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'distributed', 'claimed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."realization_outcome" AS ENUM('win', 'loss', 'force_close');--> statement-breakpoint
CREATE TYPE "public"."snapshot_position_status" AS ENUM('frozen', 'realized', 'timed_out', 'cancelled');--> statement-breakpoint
CREATE TABLE "epoch_position_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" text NOT NULL,
	"position_id" text NOT NULL,
	"token_id" text NOT NULL,
	"condition_id" text NOT NULL,
	"market_id" text NOT NULL,
	"outcome" "outcome" NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"cost_basis" numeric(20, 6) NOT NULL,
	"estimated_value" numeric(20, 6),
	"status_at_snapshot" "snapshot_position_status" DEFAULT 'frozen' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epoch_redemption_entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" text NOT NULL,
	"request_id" text NOT NULL,
	"user_address" text NOT NULL,
	"shares_submitted" numeric(30, 18) NOT NULL,
	"total_epoch_shares" numeric(30, 18) NOT NULL,
	"entitlement_ratio" numeric(38, 18) NOT NULL,
	"status" "entitlement_status" DEFAULT 'pending' NOT NULL,
	"total_realized_usdc" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_claimed_usdc" numeric(20, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epoch_redemption_entitlements_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "position_realization_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" text NOT NULL,
	"position_snapshot_id" integer NOT NULL,
	"token_id" text NOT NULL,
	"realized_outcome" realization_outcome NOT NULL,
	"gross_proceeds" numeric(20, 6) NOT NULL,
	"fee_deducted" numeric(20, 6) DEFAULT '0' NOT NULL,
	"net_proceeds" numeric(20, 6) NOT NULL,
	"realized_at" timestamp with time zone NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realized_payout_distributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"epoch_id" text NOT NULL,
	"entitlement_id" integer NOT NULL,
	"realization_event_id" integer NOT NULL,
	"user_address" text NOT NULL,
	"gross_amount" numeric(20, 6) NOT NULL,
	"fee_deduction" numeric(20, 6) DEFAULT '0' NOT NULL,
	"net_amount" numeric(20, 6) NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"distributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "position_realization_events" ADD CONSTRAINT "position_realization_events_position_snapshot_id_epoch_position_snapshots_id_fk" FOREIGN KEY ("position_snapshot_id") REFERENCES "public"."epoch_position_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_payout_distributions" ADD CONSTRAINT "realized_payout_distributions_entitlement_id_epoch_redemption_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."epoch_redemption_entitlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_payout_distributions" ADD CONSTRAINT "realized_payout_distributions_realization_event_id_position_realization_events_id_fk" FOREIGN KEY ("realization_event_id") REFERENCES "public"."position_realization_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "epoch_position_snapshots_epoch_idx" ON "epoch_position_snapshots" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "epoch_position_snapshots_position_idx" ON "epoch_position_snapshots" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "epoch_position_snapshots_token_idx" ON "epoch_position_snapshots" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "epoch_position_snapshots_market_idx" ON "epoch_position_snapshots" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "epoch_position_snapshots_status_idx" ON "epoch_position_snapshots" USING btree ("status_at_snapshot");--> statement-breakpoint
CREATE INDEX "epoch_position_snapshots_unique_ep_idx" ON "epoch_position_snapshots" USING btree ("epoch_id","position_id");--> statement-breakpoint
CREATE INDEX "epoch_redemption_entitlements_epoch_idx" ON "epoch_redemption_entitlements" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "epoch_redemption_entitlements_user_idx" ON "epoch_redemption_entitlements" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "epoch_redemption_entitlements_request_idx" ON "epoch_redemption_entitlements" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "epoch_redemption_entitlements_status_idx" ON "epoch_redemption_entitlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "epoch_redemption_entitlements_unique_eur_idx" ON "epoch_redemption_entitlements" USING btree ("epoch_id","user_address","request_id");--> statement-breakpoint
CREATE INDEX "position_realization_events_epoch_idx" ON "position_realization_events" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "position_realization_events_snapshot_idx" ON "position_realization_events" USING btree ("position_snapshot_id");--> statement-breakpoint
CREATE INDEX "position_realization_events_token_idx" ON "position_realization_events" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "position_realization_events_realized_at_idx" ON "position_realization_events" USING btree ("realized_at");--> statement-breakpoint
CREATE INDEX "position_realization_events_unique_es_idx" ON "position_realization_events" USING btree ("epoch_id","position_snapshot_id");--> statement-breakpoint
CREATE INDEX "realized_payout_distributions_epoch_idx" ON "realized_payout_distributions" USING btree ("epoch_id");--> statement-breakpoint
CREATE INDEX "realized_payout_distributions_entitlement_idx" ON "realized_payout_distributions" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "realized_payout_distributions_realization_idx" ON "realized_payout_distributions" USING btree ("realization_event_id");--> statement-breakpoint
CREATE INDEX "realized_payout_distributions_user_idx" ON "realized_payout_distributions" USING btree ("user_address");--> statement-breakpoint
CREATE INDEX "realized_payout_distributions_status_idx" ON "realized_payout_distributions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "realized_payout_distributions_unique_er_idx" ON "realized_payout_distributions" USING btree ("entitlement_id","realization_event_id");