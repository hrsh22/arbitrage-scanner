import "../env.js";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults, withdrawalRequests } from "../db/schema.js";
import { withdrawalService } from "../services/withdrawalService.js";
import { getVaultContract } from "../services/vaultContractService.js";
import { logger } from "../logger.js";
import { getChainIdForNetwork } from "../env.js";

async function processWithdrawals(): Promise<void> {
  logger.info("Starting withdrawal processing cron job");

  // Allow processing for non-public vaults too; users can still request withdrawals.
  const activeVaults = await db
    .select()
    .from(vaults)
    .where(
      and(
        inArray(vaults.status, ["public", "paused", "draft"]),
        eq(vaults.chainId, getChainIdForNetwork()),
      ),
    );

  for (const vault of activeVaults) {
    try {
      logger.info(`Processing withdrawals for vault ${vault.id} (${vault.name})`);

      const vaultContract = vault.contractAddress ? getVaultContract(vault.contractAddress) : null;
      const isV2 = vaultContract ? await vaultContract.isV2() : false;

      if (isV2) {
        const pendingRequests = await db
          .select()
          .from(withdrawalRequests)
          .where(
            and(
              eq(withdrawalRequests.vaultId, vault.id),
              inArray(withdrawalRequests.status, ["pending", "processing"]),
            ),
          );

        if (pendingRequests.length === 0) {
          logger.info(`No pending withdrawals for vault ${vault.id}`);
          continue;
        }

        const onChainRequestIds: number[] = [];

        for (const request of pendingRequests) {
          if (request.onChainRequestId === null) {
            logger.info(
              `Request ${request.id} not linked to on-chain, skipping contract submission`,
            );
            continue;
          }

          const { totalClaimable } = await withdrawalService.calculateClaimableForRequest(
            request.id,
          );
          const claimableUsdc = (Number(totalClaimable) / 1e6).toFixed(6);

          await db
            .update(withdrawalRequests)
            .set({
              currentClaimableUsdc: claimableUsdc,
              status: "processing",
            })
            .where(eq(withdrawalRequests.id, request.id));

          onChainRequestIds.push(request.onChainRequestId);
        }

        if (onChainRequestIds.length === 0) {
          logger.info(`No on-chain linked withdrawal requests for vault ${vault.id}`);
          continue;
        }

        logger.info(
          `Processed ${onChainRequestIds.length} withdrawal requests for vault ${vault.id}`,
          {
            contractVersion: "v2",
            note: "No on-chain claimable updates; claims require operator signature",
          },
        );
      } else {
        const { requestsUpdated, merkleRoot } = await withdrawalService.updateMerkleProofsForVault(
          vault.id,
        );

        if (requestsUpdated === 0) {
          logger.info(`No pending withdrawals for vault ${vault.id}`);
          continue;
        }

        if (!vault.contractAddress) {
          logger.warn(`Vault ${vault.id} has no contract address, skipping on-chain submission`);
          continue;
        }

        const pendingRequests = await db
          .select()
          .from(withdrawalRequests)
          .where(
            and(
              eq(withdrawalRequests.vaultId, vault.id),
              inArray(withdrawalRequests.status, ["pending", "processing"]),
            ),
          );

        const v1VaultContract = getVaultContract(vault.contractAddress);

        for (const request of pendingRequests) {
          if (request.onChainRequestId === null) {
            logger.info(
              `Request ${request.id} not linked to on-chain, skipping contract submission`,
            );
            continue;
          }

          const claimableUsdc = parseFloat(request.currentClaimableUsdc ?? "0");
          const totalClaimable = BigInt(Math.floor(claimableUsdc * 1e6));

          try {
            await v1VaultContract.submitClaimRoot(
              request.onChainRequestId,
              merkleRoot,
              totalClaimable,
            );
            logger.info(`Submitted claim root for request ${request.id}`, {
              onChainRequestId: request.onChainRequestId,
              totalClaimable: totalClaimable.toString(),
            });
          } catch (error) {
            logger.error(`Failed to submit claim root for request ${request.id}`, {
              error: (error as Error).message,
            });
          }
        }

        logger.info(`Processed ${requestsUpdated} withdrawal requests for vault ${vault.id}`, {
          merkleRoot,
          contractVersion: "v1",
        });
      }
    } catch (error) {
      logger.error(`Failed to process withdrawals for vault ${vault.id}`, {
        error: (error as Error).message,
      });
    }
  }

  logger.info("Withdrawal processing cron job complete");
}

processWithdrawals()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error("Withdrawal cron job failed", { error: (error as Error).message });
    process.exit(1);
  });
