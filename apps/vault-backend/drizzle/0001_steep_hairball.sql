CREATE TYPE "public"."sync_event_type" AS ENUM('deposit', 'withdrawal');--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" integer,
	"event_type" "sync_event_type" NOT NULL,
	"last_synced_block" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "vault_positions_testnet_idx";--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_positions" DROP COLUMN "is_testnet";