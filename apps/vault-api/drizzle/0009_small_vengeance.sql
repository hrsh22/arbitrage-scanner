CREATE TABLE "vault_trading_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_address" text NOT NULL,
	"position_count" integer DEFAULT 0 NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"loss_count" integer DEFAULT 0 NOT NULL,
	"win_rate" numeric(10, 6) DEFAULT '0' NOT NULL,
	"total_pnl" numeric(20, 6) DEFAULT '0' NOT NULL,
	"avg_pnl_per_position" numeric(20, 6) DEFAULT '0' NOT NULL,
	"last_resolved_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_trading_analytics_vault_address_unique" UNIQUE("vault_address")
);
--> statement-breakpoint
ALTER TABLE "vault_positions" ADD COLUMN "vault_address" text;--> statement-breakpoint
CREATE INDEX "vault_trading_analytics_vault_idx" ON "vault_trading_analytics" USING btree ("vault_address");--> statement-breakpoint
CREATE INDEX "vault_trading_analytics_computed_idx" ON "vault_trading_analytics" USING btree ("computed_at");--> statement-breakpoint
CREATE INDEX "vault_positions_vault_idx" ON "vault_positions" USING btree ("vault_address");
