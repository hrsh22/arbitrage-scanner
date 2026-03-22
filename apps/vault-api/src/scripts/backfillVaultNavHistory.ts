#!/usr/bin/env node
import "dotenv/config";

import { sql } from "drizzle-orm";
import { getAllVaultConfigs, getVaultConfig } from "../config/index.js";
import { db } from "../db/index.js";

interface CliOptions {
  vaultId?: number;
  vaultAddress?: string;
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const vaultAddress = resolveVaultAddress(options);

  const before = await db.execute(
    sql.raw(
      "SELECT COUNT(*)::int AS count FROM vault_nav_history WHERE vault_address IS NULL OR vault_address = ''",
    ),
  );
  const beforeCount = Number(before.rows[0]?.count ?? 0);

  if (beforeCount === 0) {
    console.log(`No NULL vault_nav_history rows found. Nothing to backfill for ${vaultAddress}.`);
    return;
  }

  await db.execute(
    sql.raw(
      `UPDATE vault_nav_history SET vault_address='${vaultAddress}' WHERE vault_address IS NULL OR vault_address = ''`,
    ),
  );

  const after = await db.execute(
    sql.raw(
      "SELECT COUNT(*)::int AS count FROM vault_nav_history WHERE vault_address IS NULL OR vault_address = ''",
    ),
  );
  const afterCount = Number(after.rows[0]?.count ?? 0);

  console.log(
    JSON.stringify(
      {
        vaultAddress,
        backfilledRows: beforeCount - afterCount,
        remainingNullRows: afterCount,
      },
      null,
      2,
    ),
  );

  if (afterCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[backfill-vault-nav-history] ${(error as Error).message}`);
  process.exit(1);
});
