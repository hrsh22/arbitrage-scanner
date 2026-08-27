#!/usr/bin/env node
import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { getAllVaultConfigs, getVaultConfig } from "../config/index.js";
import { db } from "../db/index.js";

type SqlExecutor = Pick<typeof db, "execute">;

interface CliOptions {
  vaultId?: number;
  vaultAddress?: string;
}

interface MigrationDefinition {
  tag: string;
  hash: string;
  folderMillis: number;
}

function parseArgs(argv: string[]): CliOptions {
  let vaultId: number | undefined;
  let vaultAddress: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--vault-id") {
      const next = argv[index + 1];
      if (!next) throw new Error("--vault-id requires a value");
      vaultId = Number(next);
      if (!Number.isInteger(vaultId) || vaultId <= 0) {
        throw new Error(`Invalid --vault-id value: ${next}`);
      }
      index += 1;
      continue;
    }

    if (arg === "--vault-address") {
      const next = argv[index + 1];
      if (!next) throw new Error("--vault-address requires a value");
      vaultAddress = next.toLowerCase();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { vaultId, vaultAddress };
}

function resolveVaultAddress(options: CliOptions): string {
  if (options.vaultAddress) {
    return options.vaultAddress;
  }

  if (options.vaultId !== undefined) {
    const config = getVaultConfig(options.vaultId);
    if (!config) {
      throw new Error(`Vault ${options.vaultId} not found in config`);
    }
    return config.vaultAddress.toLowerCase();
  }

  const enabledVaults = getAllVaultConfigs().filter((config) => config.enabled);
  if (enabledVaults.length !== 1) {
    throw new Error(
      `Expected exactly one enabled vault when no args are provided, found ${enabledVaults.length}. Use --vault-id or --vault-address.`,
    );
  }

  return enabledVaults[0]!.vaultAddress.toLowerCase();
}

function getScriptsDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getMigrationDefinition(tag: string): MigrationDefinition {
  const drizzleDir = path.resolve(getScriptsDir(), "../../drizzle");
  const journalPath = path.join(drizzleDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };

  const journalEntry = journal.entries.find((entry) => entry.tag === tag);
  if (!journalEntry) {
    throw new Error(`Migration ${tag} not found in drizzle journal`);
  }

  const migrationPath = path.join(drizzleDir, `${tag}.sql`);
  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  return {
    tag,
    hash: crypto.createHash("sha256").update(migrationSql).digest("hex"),
    folderMillis: journalEntry.when,
  };
}

function getCount(result: { rows: unknown[] }, key: string): number {
  const row = result.rows[0];
  if (!row || typeof row !== "object") {
    return 0;
  }

  const value = (row as Record<string, unknown>)[key];
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function ensureMigrationHistoryTable(): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function hasMigration(
  executor: SqlExecutor,
  hash: string,
  folderMillis: number,
): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM drizzle.__drizzle_migrations
    WHERE hash = ${hash} AND created_at = ${folderMillis}
  `);
  return getCount(result, "count") > 0;
}

async function assertNoMigrationConflict(
  executor: SqlExecutor,
  migration: MigrationDefinition,
): Promise<void> {
  const result = await executor.execute(sql`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    WHERE created_at = ${migration.folderMillis}
  `);

  const conflictingHashes = result.rows
    .map((row) => (typeof row === "object" && row ? (row as Record<string, unknown>).hash : null))
    .filter((hash): hash is string => typeof hash === "string" && hash !== migration.hash);

  if (conflictingHashes.length > 0) {
    throw new Error(
      `Migration history conflict for ${migration.tag}: created_at=${migration.folderMillis} is already recorded with a different hash`,
    );
  }
}

async function markMigrationApplied(
  executor: SqlExecutor,
  migration: MigrationDefinition,
): Promise<void> {
  await assertNoMigrationConflict(executor, migration);
  const alreadyApplied = await hasMigration(executor, migration.hash, migration.folderMillis);
  if (alreadyApplied) {
    return;
  }

  await executor.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${migration.hash}, ${migration.folderMillis})
  `);
}

async function getRemainingNullCount(executor: SqlExecutor): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM vault_nav_history
    WHERE vault_address IS NULL OR vault_address = ''
  `);
  return getCount(result, "count");
}

async function assertSafeBackfillTarget(
  executor: SqlExecutor,
  vaultAddress: string,
): Promise<void> {
  const distinctResult = await executor.execute(sql`
    SELECT LOWER(vault_address) AS vault_address
    FROM vault_nav_history
    WHERE vault_address IS NOT NULL AND vault_address <> ''
    GROUP BY LOWER(vault_address)
  `);

  const distinctAddresses = distinctResult.rows
    .map((row) =>
      typeof row === "object" && row ? (row as Record<string, unknown>).vault_address : null,
    )
    .filter((value): value is string => typeof value === "string");

  if (distinctAddresses.length > 1) {
    throw new Error(
      `Refusing repair: vault_nav_history already contains multiple non-empty vault addresses (${distinctAddresses.join(", ")})`,
    );
  }

  if (distinctAddresses.length === 1 && distinctAddresses[0] !== vaultAddress) {
    throw new Error(
      `Refusing repair: existing vault_nav_history rows use ${distinctAddresses[0]}, but requested backfill target is ${vaultAddress}`,
    );
  }
}

async function applyMigration0010(executor: SqlExecutor): Promise<void> {
  await executor.execute(sql`
    ALTER TABLE vault_nav_history
    ADD COLUMN IF NOT EXISTS vault_address text
  `);

  await executor.execute(sql`
    CREATE INDEX IF NOT EXISTS vault_nav_history_vault_idx
    ON vault_nav_history USING btree (vault_address)
  `);
}

async function backfillVaultAddress(executor: SqlExecutor, vaultAddress: string): Promise<number> {
  await assertSafeBackfillTarget(executor, vaultAddress);
  const beforeCount = await getRemainingNullCount(executor);

  await executor.execute(sql`
    UPDATE vault_nav_history
    SET vault_address = ${vaultAddress}
    WHERE vault_address IS NULL OR vault_address = ''
  `);

  const afterCount = await getRemainingNullCount(executor);
  return beforeCount - afterCount;
}

async function applyMigration0011(executor: SqlExecutor): Promise<void> {
  const remainingNulls = await getRemainingNullCount(executor);
  if (remainingNulls > 0) {
    throw new Error(
      `Cannot finalize migration 0011: vault_nav_history still has ${remainingNulls} rows without vault_address`,
    );
  }

  await executor.execute(sql`
    ALTER TABLE vault_nav_history
    ALTER COLUMN vault_address SET NOT NULL
  `);

  await executor.execute(sql`
    CREATE TABLE vault_analytics_sync_state (
      id serial PRIMARY KEY NOT NULL,
      network text NOT NULL,
      vault_address text NOT NULL,
      wallet_address text NOT NULL,
      last_activity_timestamp bigint,
      last_successful_sync_at timestamp with time zone,
      last_attempted_sync_at timestamp with time zone,
      last_error text,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await executor.execute(sql`
    CREATE TABLE vault_detailed_analytics (
      id serial PRIMARY KEY NOT NULL,
      network text NOT NULL,
      vault_address text NOT NULL,
      wallet_address text NOT NULL,
      total_pnl numeric(14, 4),
      total_cost numeric(14, 4),
      win_count numeric(10, 0),
      loss_count numeric(10, 0),
      win_rate numeric(6, 4),
      avg_entry_price numeric(10, 6),
      avg_pnl_per_position numeric(14, 4),
      avg_holding_hours numeric(10, 2),
      stop_loss_analysis jsonb,
      hedging_analysis jsonb,
      category_breakdown jsonb,
      daily_pnl jsonb,
      entry_timing_analysis jsonb,
      computed_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await executor.execute(sql`
    CREATE TABLE vault_resolved_analytics_positions (
      id serial PRIMARY KEY NOT NULL,
      network text NOT NULL,
      vault_address text NOT NULL,
      wallet_address text NOT NULL,
      token_id text NOT NULL,
      condition_id text NOT NULL,
      event_slug text,
      market_slug text,
      market_question text,
      outcome text,
      entry_price numeric(10, 6),
      cost numeric(14, 4),
      size numeric(18, 8),
      created_at timestamp with time zone,
      resolved_at timestamp with time zone,
      market_end_date timestamp with time zone,
      final_price numeric(10, 6),
      profit_loss numeric(14, 4),
      result text,
      max_drawdown_percent numeric(10, 4),
      lowest_price numeric(10, 6),
      highest_price numeric(10, 6),
      price_history jsonb,
      opposite_outcome_price_history jsonb,
      stop_loss_simulations jsonb,
      hedging_simulations jsonb,
      category text,
      tags jsonb,
      fidelity_minutes numeric(4, 0),
      captured_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await executor.execute(sql`
    CREATE UNIQUE INDEX vault_analytics_sync_state_unique
    ON vault_analytics_sync_state USING btree (network, vault_address)
  `);

  await executor.execute(sql`
    CREATE INDEX vault_analytics_sync_state_wallet_idx
    ON vault_analytics_sync_state USING btree (wallet_address)
  `);

  await executor.execute(sql`
    CREATE UNIQUE INDEX vault_detailed_analytics_unique
    ON vault_detailed_analytics USING btree (network, vault_address)
  `);

  await executor.execute(sql`
    CREATE UNIQUE INDEX vault_resolved_analytics_positions_unique
    ON vault_resolved_analytics_positions USING btree (network, vault_address, token_id)
  `);

  await executor.execute(sql`
    CREATE INDEX vault_resolved_analytics_positions_vault_idx
    ON vault_resolved_analytics_positions USING btree (network, vault_address)
  `);

  await executor.execute(sql`
    CREATE INDEX vault_resolved_analytics_positions_wallet_idx
    ON vault_resolved_analytics_positions USING btree (wallet_address)
  `);

  await executor.execute(sql`
    CREATE INDEX vault_resolved_analytics_positions_resolved_at_idx
    ON vault_resolved_analytics_positions USING btree (resolved_at)
  `);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const vaultAddress = resolveVaultAddress(options);
  const migration0010 = getMigrationDefinition("0010_gorgeous_shotgun");
  const migration0011 = getMigrationDefinition("0011_mature_the_fallen");

  await ensureMigrationHistoryTable();
  const backfilledRows = await db.transaction(async (tx) => {
    await assertNoMigrationConflict(tx, migration0010);
    await assertNoMigrationConflict(tx, migration0011);

    const migration0010Applied = await hasMigration(
      tx,
      migration0010.hash,
      migration0010.folderMillis,
    );
    const migration0011Applied = await hasMigration(
      tx,
      migration0011.hash,
      migration0011.folderMillis,
    );

    if (!migration0010Applied) {
      await applyMigration0010(tx);
    }

    const changedRows = await backfillVaultAddress(tx, vaultAddress);

    if (!migration0010Applied) {
      await markMigrationApplied(tx, migration0010);
    }

    if (!migration0011Applied) {
      await applyMigration0011(tx);
      await markMigrationApplied(tx, migration0011);
    }

    return changedRows;
  });

  const remainingNullRows = await getRemainingNullCount(db);
  const applied0010 = await hasMigration(db, migration0010.hash, migration0010.folderMillis);
  const applied0011 = await hasMigration(db, migration0011.hash, migration0011.folderMillis);

  console.log(
    JSON.stringify(
      {
        vaultAddress,
        backfilledRows,
        remainingNullRows,
        appliedMigrations: {
          [migration0010.tag]: applied0010,
          [migration0011.tag]: applied0011,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[repair-vault-nav-history-migration] ${(error as Error).message}`);
  process.exit(1);
});
