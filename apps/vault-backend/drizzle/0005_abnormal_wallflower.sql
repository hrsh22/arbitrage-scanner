-- Drop the old unique constraint and index on slug only
ALTER TABLE "vaults" DROP CONSTRAINT IF EXISTS "vaults_slug_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "vaults_slug_idx";--> statement-breakpoint

-- Add chain_id column as nullable first
ALTER TABLE "vaults" ADD COLUMN "chain_id" integer;--> statement-breakpoint

-- Set existing rows to mainnet (137)
UPDATE "vaults" SET "chain_id" = 137 WHERE "chain_id" IS NULL;--> statement-breakpoint

-- Now make it NOT NULL
ALTER TABLE "vaults" ALTER COLUMN "chain_id" SET NOT NULL;--> statement-breakpoint

-- Create new composite unique index (slug + chainId)
CREATE UNIQUE INDEX "vaults_slug_chain_idx" ON "vaults" USING btree ("slug","chain_id");--> statement-breakpoint

-- Create index on chainId for filtering
CREATE INDEX "vaults_chain_idx" ON "vaults" USING btree ("chain_id");
