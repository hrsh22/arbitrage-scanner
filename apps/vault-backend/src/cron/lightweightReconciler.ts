import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import type { Address } from "viem";
import { db } from "../db/client.js";
import { vaults } from "../db/schema.js";
import { getChainIdForNetwork, env } from "../env.js";
import { catchUpDeposits } from "../services/depositListener.js";
import { catchUpWithdrawals, syncClaimedEvents } from "../services/withdrawalListener.js";
import { logger } from "../logger.js";

async function main() {
  logger.info("Starting lightweight reconciliation (Layer 3 safety net)");

  try {
    const activeVaults = await db
      .select({
        id: vaults.id,
        name: vaults.name,
        contractAddress: vaults.contractAddress,
        createdAt: vaults.createdAt,
      })
      .from(vaults)
      .where(
        and(
          inArray(vaults.status, ["public", "paused"]),
          eq(vaults.chainId, getChainIdForNetwork()),
        ),
      );

    if (activeVaults.length === 0) {
      logger.info("No active vaults to reconcile");
      process.exit(0);
    }

    for (const vault of activeVaults) {
      if (!vault.contractAddress) continue;

      try {
        logger.info("Reconciling vault", { vaultId: vault.id, vaultName: vault.name });

        await catchUpDeposits(vault.id, vault.contractAddress as Address, vault.createdAt);

        await catchUpWithdrawals(vault.id, vault.contractAddress as Address, vault.createdAt);

        await syncClaimedEvents(vault.id, vault.contractAddress as Address, vault.createdAt);

        logger.info("Vault reconciliation complete", { vaultId: vault.id });
      } catch (error) {
        logger.error("Failed to reconcile vault", {
          vaultId: vault.id,
          error: (error as Error).message,
        });
      }
    }

    logger.info("Lightweight reconciliation completed", {
      vaultsProcessed: activeVaults.length,
    });

    process.exit(0);
  } catch (error) {
    logger.error("Reconciliation failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    process.exit(1);
  }
}

main();
