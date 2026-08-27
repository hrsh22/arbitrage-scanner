ALTER TYPE "public"."entitlement_status" ADD VALUE IF NOT EXISTS 'frozen' BEFORE 'partially_fulfilled';--> statement-breakpoint
ALTER TYPE "public"."entitlement_status" ADD VALUE IF NOT EXISTS 'claimable' BEFORE 'partially_fulfilled';--> statement-breakpoint
ALTER TYPE "public"."entitlement_status" ADD VALUE IF NOT EXISTS 'closed' BEFORE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'open';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'cutoff';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'flattening';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'settling';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'settled';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'claimed';--> statement-breakpoint
ALTER TYPE "public"."withdrawal_status" ADD VALUE IF NOT EXISTS 'closed';--> statement-breakpoint
ALTER TYPE "public"."epoch_request_status" ADD VALUE IF NOT EXISTS 'frozen' AFTER 'pending';--> statement-breakpoint
ALTER TYPE "public"."epoch_request_status" ADD VALUE IF NOT EXISTS 'claimable' AFTER 'frozen';--> statement-breakpoint
ALTER TYPE "public"."epoch_request_status" ADD VALUE IF NOT EXISTS 'closed' AFTER 'claimed';--> statement-breakpoint
ALTER TYPE "public"."epoch_status" ADD VALUE IF NOT EXISTS 'frozen' AFTER 'pending';--> statement-breakpoint
ALTER TYPE "public"."epoch_status" ADD VALUE IF NOT EXISTS 'claimable' AFTER 'frozen';--> statement-breakpoint
ALTER TYPE "public"."epoch_status" ADD VALUE IF NOT EXISTS 'closed' AFTER 'claimable';--> statement-breakpoint
ALTER TABLE "epoch_redemption_entitlements" ADD COLUMN IF NOT EXISTS "tranche_id" text;--> statement-breakpoint
ALTER TABLE "epoch_redemption_entitlements" ADD COLUMN IF NOT EXISTS "entitlement" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "epoch_redemption_entitlements" ADD COLUMN IF NOT EXISTS "accrued" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "epoch_redemption_entitlements" ADD COLUMN IF NOT EXISTS "claimed" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "epoch_redemption_entitlements" ADD COLUMN IF NOT EXISTS "carry_remaining" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "epoch_requests" ADD COLUMN IF NOT EXISTS "controller" text;--> statement-breakpoint
ALTER TABLE "epoch_requests" ADD COLUMN IF NOT EXISTS "owner" text;--> statement-breakpoint
ALTER TABLE "epoch_requests" ADD COLUMN IF NOT EXISTS "operator" text;--> statement-breakpoint
ALTER TABLE "epoch_requests" ADD COLUMN IF NOT EXISTS "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "epoch_requests" ADD COLUMN IF NOT EXISTS "claimable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "epoch_requests" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN IF NOT EXISTS "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN IF NOT EXISTS "claimable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "position_realization_events" ADD COLUMN IF NOT EXISTS "tranche_id" text;--> statement-breakpoint
ALTER TABLE "realized_payout_distributions" ADD COLUMN IF NOT EXISTS "tranche_id" text;--> statement-breakpoint
ALTER TABLE "realized_payout_distributions" ADD COLUMN IF NOT EXISTS "entitlement_amount" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "realized_payout_distributions" ADD COLUMN IF NOT EXISTS "carry_forward" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "withdrawal_type" text DEFAULT 'instant';--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "batch_id" text;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN IF NOT EXISTS "onchain_request_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epoch_redemption_entitlements_tranche_idx" ON "epoch_redemption_entitlements" USING btree ("tranche_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "position_realization_events_tranche_idx" ON "position_realization_events" USING btree ("tranche_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "realized_payout_distributions_tranche_idx" ON "realized_payout_distributions" USING btree ("tranche_id");
