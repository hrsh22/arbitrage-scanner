#!/usr/bin/env tsx
/**
 * DB Reset Script for Fresh Snapshot-Tranche Vault Rollout
 *
 * This script performs a full database reset for fresh deployment.
 * It drops all application tables and the Drizzle migration state,
 * allowing a clean migration from scratch.
 *
 * WARNING: This will DELETE ALL DATA. Only use for fresh rollouts.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const EVIDENCE_DIR = ".sisyphus/evidence";

// Tables to drop (in dependency order to avoid FK constraint issues)
const TABLES_TO_DROP = [
  // New snapshot-tranche tables
  "realized_payout_distributions",
  "position_realization_events",
  "epoch_redemption_entitlements",
  "epoch_position_snapshots",
  // Existing epoch/custom vault tables
  "epoch_requests",
  "epochs",
  "nav_snapshots",
  "withdrawal_requests",
  // Legacy vault tables
  "vault_trades",
  "vault_allocations",
  "vault_nav_history",
  "vault_positions",
  "vault_config",
];

// Enums to drop
const ENUMS_TO_DROP = [
  "payout_status",
  "realization_outcome",
  "entitlement_status",
  "snapshot_position_status",
  "epoch_request_status",
  "epoch_status",
  "withdrawal_status",
  "trade_status",
  "trade_side",
  "allocation_direction",
  "outcome",
  "position_status",
];

async function main() {
  console.log("=== DB Reset Script for Fresh Snapshot-Tranche Vault ===\n");

  const connectionString = process.env.VAULT_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("ERROR: VAULT_DATABASE_URL or DATABASE_URL environment variable is required");
    console.error("Set one of these before running db reset.");
    console.error("Example:");
    console.error(
      "  VAULT_DATABASE_URL=postgresql://user:pass@localhost:5432/vault_db pnpm db:reset",
    );
    console.error("If you keep secrets in .env, ensure the file is loaded in your shell session.");
    process.exit(1);
  }

  // Safety check: require explicit confirmation for non-local databases
  const isLocalDb =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1") ||
    connectionString.includes("::1");

  if (!isLocalDb && process.env.FORCE_RESET !== "true") {
    console.error("ERROR: Database appears to be non-local. Set FORCE_RESET=true to proceed.");
    console.error("Connection string host:", connectionString.match(/@([^/]+)/)?.[1] || "unknown");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  const db = drizzle(pool);
  const evidence: string[] = [];
  const timestamp = new Date().toISOString();

  function log(msg: string) {
    console.log(msg);
    evidence.push(`[${new Date().toISOString()}] ${msg}`);
  }

  try {
    log(`Starting DB reset at ${timestamp}`);
    log(`Database: ${connectionString.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@")}`);

    // Check current tables
    log("\n--- Checking existing tables ---");
    const tableCheck = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);

    const existingTables = tableCheck.rows.map((r: any) => r.table_name);
    log(`Found ${existingTables.length} tables: ${existingTables.join(", ") || "(none)"}`);

    // Drop tables with CASCADE to handle foreign key dependencies
    log("\n--- Dropping tables ---");
    for (const table of TABLES_TO_DROP) {
      try {
        await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`));
        if (existingTables.includes(table)) {
          log(`✓ Dropped table: ${table}`);
        } else {
          log(`  Table not found (skipped): ${table}`);
        }
      } catch (err) {
        log(`✗ Error dropping table ${table}: ${(err as Error).message}`);
      }
    }

    // Drop drizzle migrations table if it exists
    try {
      await db.execute(sql`DROP TABLE IF EXISTS "drizzle.__drizzle_migrations" CASCADE`);
      log(`✓ Dropped drizzle migrations table`);
    } catch (err) {
      log(`  Note: drizzle migrations table not found or error: ${(err as Error).message}`);
    }

    // Check existing enums
    log("\n--- Checking existing enums ---");
    const enumCheck = await db.execute(sql`
      SELECT typname 
      FROM pg_type 
      WHERE typtype = 'e' 
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);

    const existingEnums = enumCheck.rows.map((r: any) => r.typname);
    log(`Found ${existingEnums.length} enums: ${existingEnums.join(", ") || "(none)"}`);

    // Drop enums
    log("\n--- Dropping enums ---");
    for (const enumName of ENUMS_TO_DROP) {
      try {
        await db.execute(sql.raw(`DROP TYPE IF EXISTS "${enumName}" CASCADE`));
        if (existingEnums.includes(enumName)) {
          log(`✓ Dropped enum: ${enumName}`);
        } else {
          log(`  Enum not found (skipped): ${enumName}`);
        }
      } catch (err) {
        log(`✗ Error dropping enum ${enumName}: ${(err as Error).message}`);
      }
    }

    // Verify cleanup
    log("\n--- Verifying cleanup ---");
    const remainingTables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);

    const remainingCount = remainingTables.rows.length;
    if (remainingCount === 0) {
      log("✓ All tables successfully dropped");
    } else {
      const remaining = remainingTables.rows.map((r: any) => r.table_name).join(", ");
      log(`⚠ ${remainingCount} tables remain: ${remaining}`);
    }

    const remainingEnums = await db.execute(sql`
      SELECT typname 
      FROM pg_type 
      WHERE typtype = 'e' 
      AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);

    const remainingEnumCount = remainingEnums.rows.length;
    if (remainingEnumCount === 0) {
      log("✓ All enums successfully dropped");
    } else {
      const remaining = remainingEnums.rows.map((r: any) => r.typname).join(", ");
      log(`⚠ ${remainingEnumCount} enums remain: ${remaining}`);
    }

    log("\n=== DB Reset Complete ===");
    log(`Timestamp: ${new Date().toISOString()}`);
    log("\nNext steps:");
    log("  1. Run 'pnpm db:generate' to generate new migrations");
    log("  2. Run 'pnpm db:migrate' to apply migrations");

    // Write evidence file
    const evidenceContent = evidence.join("\n");
    const evidencePath = path.join(process.cwd(), EVIDENCE_DIR, "task-3-db-reset.txt");

    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, evidenceContent);
    log(`\n✓ Evidence written to: ${evidencePath}`);
  } catch (error) {
    log(`\n✗ FATAL ERROR: ${(error as Error).message}`);
    log((error as Error).stack || "");

    // Write error evidence
    const evidencePath = path.join(process.cwd(), EVIDENCE_DIR, "task-3-db-reset-error.txt");
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, evidence.join("\n"));

    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
