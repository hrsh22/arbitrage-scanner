CREATE TYPE "public"."allocation_direction" AS ENUM('allocate', 'deallocate');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('open', 'resolved_win', 'resolved_loss');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('pending', 'filled', 'partially_filled', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "vault_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"allocation_id" text NOT NULL,
	"tx_hash" text NOT NULL,
	"direction" "allocation_direction" NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_allocations_allocation_id_unique" UNIQUE("allocation_id")
);
--> statement-breakpoint
CREATE TABLE "vault_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_address" text NOT NULL,
	"adapter_address" text NOT NULL,
	"safe_address" text NOT NULL,
	"asset" text DEFAULT 'USDC.e' NOT NULL,
	"deployment_block" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_config_vault_address_unique" UNIQUE("vault_address")
);
--> statement-breakpoint
CREATE TABLE "vault_nav_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"nav_id" text NOT NULL,
	"total_assets" numeric(20, 6) NOT NULL,
	"idle_assets" numeric(20, 6) NOT NULL,
	"deployed_cost_basis" numeric(20, 6) NOT NULL,
	"share_price" numeric(20, 8) NOT NULL,
	"position_count" integer DEFAULT 0 NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_nav_history_nav_id_unique" UNIQUE("nav_id")
);
--> statement-breakpoint
CREATE TABLE "vault_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" text NOT NULL,
	"market_id" text NOT NULL,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"outcome" "outcome" NOT NULL,
	"cost_basis" numeric(20, 6) NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"status" "position_status" DEFAULT 'open' NOT NULL,
	"resolved_pnl" numeric(20, 6),
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_positions_position_id_unique" UNIQUE("position_id")
);
--> statement-breakpoint
CREATE TABLE "vault_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" text NOT NULL,
	"position_id" integer NOT NULL,
	"order_id" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"price" numeric(10, 6) NOT NULL,
	"size" numeric(20, 6) NOT NULL,
	"filled_size" numeric(20, 6) NOT NULL,
	"status" "trade_status" DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_trades_trade_id_unique" UNIQUE("trade_id")
);
--> statement-breakpoint
ALTER TABLE "vault_trades" ADD CONSTRAINT "vault_trades_position_id_vault_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."vault_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_allocations_direction_idx" ON "vault_allocations" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "vault_allocations_tx_hash_idx" ON "vault_allocations" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "vault_allocations_timestamp_idx" ON "vault_allocations" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "vault_nav_history_timestamp_idx" ON "vault_nav_history" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "vault_nav_history_nav_id_idx" ON "vault_nav_history" USING btree ("nav_id");--> statement-breakpoint
CREATE INDEX "vault_positions_status_idx" ON "vault_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vault_positions_market_idx" ON "vault_positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "vault_positions_token_idx" ON "vault_positions" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "vault_positions_opened_idx" ON "vault_positions" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "vault_trades_position_idx" ON "vault_trades" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "vault_trades_order_idx" ON "vault_trades" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "vault_trades_status_idx" ON "vault_trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vault_trades_side_idx" ON "vault_trades" USING btree ("side");--> statement-breakpoint
CREATE INDEX "vault_trades_timestamp_idx" ON "vault_trades" USING btree ("timestamp");