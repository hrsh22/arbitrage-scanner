ALTER TABLE "vault_nav_history" ADD COLUMN IF NOT EXISTS "vault_address" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_nav_history_vault_idx" ON "vault_nav_history" USING btree ("vault_address");
