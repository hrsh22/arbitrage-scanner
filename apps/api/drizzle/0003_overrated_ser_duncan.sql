-- Drop events table (if exists)
DROP TABLE IF EXISTS "events" CASCADE;

-- Drop constraints only if they exist (using DO block)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'markets_event_id_events_id_fk') THEN
    ALTER TABLE "markets" DROP CONSTRAINT "markets_event_id_events_id_fk";
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'opportunities_market_id_markets_id_fk') THEN
    ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_market_id_markets_id_fk";
  END IF;
END $$;

-- Drop index if exists
DROP INDEX IF EXISTS "markets_event_idx";

-- Modify columns
ALTER TABLE "opportunities" ALTER COLUMN "total_cost" SET NOT NULL;

-- Add new columns (if not exist)
ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "event_slug" text;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "outcomes" jsonb;

-- Create new index
CREATE INDEX IF NOT EXISTS "opportunities_profit_idx" ON "opportunities" USING btree ("profit_pct");

-- Drop old columns (if exist)
ALTER TABLE "markets" DROP COLUMN IF EXISTS "event_id";
ALTER TABLE "markets" DROP COLUMN IF EXISTS "categories";
ALTER TABLE "opportunities" DROP COLUMN IF EXISTS "target_outcome";
ALTER TABLE "opportunities" DROP COLUMN IF EXISTS "target_price";
ALTER TABLE "opportunities" DROP COLUMN IF EXISTS "categories";