ALTER TABLE "vault_nav_history" ADD COLUMN "vault_address" text;--> statement-breakpoint
CREATE INDEX "vault_nav_history_vault_idx" ON "vault_nav_history" USING btree ("vault_address");
