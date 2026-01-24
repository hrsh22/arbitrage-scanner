CREATE TYPE "public"."claim_status" AS ENUM('pending', 'resolved_win', 'resolved_loss', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."vault_status" AS ENUM('draft', 'public', 'paused');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'processing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"amount_usdc" numeric(18, 6) NOT NULL,
	"shares_received" numeric(24, 8) NOT NULL,
	"nav_at_deposit" numeric(18, 8) NOT NULL,
	"block_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "nav_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"nav_per_share" numeric(18, 8) NOT NULL,
	"total_assets" numeric(18, 6) NOT NULL,
	"total_shares" numeric(24, 8) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"withdrawal_request_id" integer NOT NULL,
	"position_id" integer NOT NULL,
	"shares_claimed" numeric(18, 6) NOT NULL,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"resolution_value_usdc" numeric(18, 6),
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "vault_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"market_id" text NOT NULL,
	"market_question" text NOT NULL,
	"market_slug" text,
	"token_id" text NOT NULL,
	"outcome" text NOT NULL,
	"shares" numeric(18, 6) NOT NULL,
	"entry_price" numeric(10, 6) NOT NULL,
	"cost_usdc" numeric(18, 6) NOT NULL,
	"current_price" numeric(10, 6),
	"status" "position_status" DEFAULT 'open' NOT NULL,
	"closes_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_value" numeric(10, 6),
	"is_testnet" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"total_shares" numeric(24, 8) DEFAULT '0' NOT NULL,
	"total_assets_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"idle_usdc" numeric(18, 6) DEFAULT '0' NOT NULL,
	"nav_per_share" numeric(18, 8) DEFAULT '1' NOT NULL,
	"last_nav_update_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deposits_enabled" boolean DEFAULT true NOT NULL,
	"withdrawals_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"contract_address" varchar(42) NOT NULL,
	"safe_address" varchar(42) NOT NULL,
	"admin_address" varchar(42) NOT NULL,
	"status" "vault_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vaults_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"shares_locked" numeric(24, 8) NOT NULL,
	"ownership_pct" numeric(10, 8) NOT NULL,
	"idle_usdc_claim" numeric(18, 6) NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"total_claimed_usdc" numeric(18, 6) DEFAULT '0'
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_history" ADD CONSTRAINT "nav_history_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_claims" ADD CONSTRAINT "position_claims_withdrawal_request_id_withdrawal_requests_id_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "public"."withdrawal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_claims" ADD CONSTRAINT "position_claims_position_id_vault_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."vault_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_positions" ADD CONSTRAINT "vault_positions_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_state" ADD CONSTRAINT "vault_state_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposits_vault_idx" ON "deposits" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "deposits_user_idx" ON "deposits" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_tx_hash_idx" ON "deposits" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "nav_history_vault_idx" ON "nav_history" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "nav_history_recorded_at_idx" ON "nav_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "position_claims_withdrawal_idx" ON "position_claims" USING btree ("withdrawal_request_id");--> statement-breakpoint
CREATE INDEX "position_claims_position_idx" ON "position_claims" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "position_claims_status_idx" ON "position_claims" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_idx" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "vault_positions_vault_idx" ON "vault_positions" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "vault_positions_status_idx" ON "vault_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vault_positions_market_idx" ON "vault_positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "vault_positions_testnet_idx" ON "vault_positions" USING btree ("is_testnet");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_state_vault_idx" ON "vault_state" USING btree ("vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_slug_idx" ON "vaults" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "vaults_admin_idx" ON "vaults" USING btree ("admin_address");--> statement-breakpoint
CREATE INDEX "vaults_status_idx" ON "vaults" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_vault_idx" ON "withdrawal_requests" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_user_idx" ON "withdrawal_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests" USING btree ("status");