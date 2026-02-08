CREATE TABLE "claimed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"on_chain_request_id" integer NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"amount_usdc" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claimed_events" ADD CONSTRAINT "claimed_events_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claimed_events_vault_idx" ON "claimed_events" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "claimed_events_on_chain_idx" ON "claimed_events" USING btree ("on_chain_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claimed_events_tx_log_idx" ON "claimed_events" USING btree ("tx_hash","log_index");