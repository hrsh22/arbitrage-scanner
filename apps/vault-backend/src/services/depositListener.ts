import { createPublicClient, http, parseAbiItem, type Log, type Address } from "viem";
import { polygon } from "viem/chains";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults, deposits, syncState } from "../db/schema.js";
import { userService } from "./userService.js";
import { vaultService } from "./vaultService.js";
import { logger } from "../logger.js";
import { env } from "../env.js";

const DEPOSIT_EVENT = parseAbiItem(
  "event Deposit(address indexed user, uint256 assets, uint256 shares)",
);

const POLYGON_CHAIN_ID = 137;

function getPolygonClient() {
  return createPublicClient({
    chain: polygon,
    transport: http(env.POLYGON_RPC_URL),
  });
}

function getSyncStateId(vaultId: number): string {
  return `deposit:vault:${vaultId}`;
}

export interface DepositEventData {
  userAddress: string;
  assets: bigint;
  shares: bigint;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export async function processDepositEvent(
  vaultId: number,
  event: DepositEventData,
): Promise<{ recorded: boolean; reason?: string }> {
  const existingDeposit = await db
    .select()
    .from(deposits)
    .where(eq(deposits.txHash, event.txHash))
    .limit(1);

  if (existingDeposit.length > 0) {
    return { recorded: false, reason: "already_processed" };
  }

  const user = await userService.getOrCreateUser(event.userAddress);

  const state = await vaultService.getOrCreateVaultState(vaultId);
  const navAtDeposit = state.navPerShare;

  const amountUsdc = (Number(event.assets) / 1e6).toFixed(6);
  const sharesReceived = (Number(event.shares) / 1e6).toFixed(6);

  await userService.recordDeposit(
    vaultId,
    user.id,
    event.txHash,
    amountUsdc,
    sharesReceived,
    navAtDeposit,
    event.blockNumber,
  );

  logger.info("Deposit event processed", {
    vaultId,
    userAddress: event.userAddress,
    amountUsdc,
    sharesReceived,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
  });

  return { recorded: true };
}

export async function getLastSyncedBlock(vaultId: number): Promise<number | null> {
  const [state] = await db
    .select()
    .from(syncState)
    .where(eq(syncState.id, getSyncStateId(vaultId)));

  return state?.lastSyncedBlock ?? null;
}

export async function updateLastSyncedBlock(vaultId: number, blockNumber: number): Promise<void> {
  const id = getSyncStateId(vaultId);

  await db
    .insert(syncState)
    .values({
      id,
      vaultId,
      eventType: "deposit",
      lastSyncedBlock: blockNumber,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: syncState.id,
      set: {
        lastSyncedBlock: blockNumber,
        updatedAt: new Date(),
      },
    });
}

export async function syncDepositsFromBlock(
  vaultId: number,
  contractAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ processed: number; skipped: number }> {
  const client = getPolygonClient();

  const logs = await client.getLogs({
    address: contractAddress,
    event: DEPOSIT_EVENT,
    fromBlock,
    toBlock,
  });

  let processed = 0;
  let skipped = 0;

  for (const log of logs) {
    const event: DepositEventData = {
      userAddress: log.args.user as string,
      assets: log.args.assets as bigint,
      shares: log.args.shares as bigint,
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
    };

    const result = await processDepositEvent(vaultId, event);
    if (result.recorded) {
      processed++;
    } else {
      skipped++;
    }
  }

  if (logs.length > 0) {
    await updateLastSyncedBlock(vaultId, Number(toBlock));
  }

  return { processed, skipped };
}

export async function catchUpDeposits(vaultId: number, contractAddress: Address): Promise<void> {
  const client = getPolygonClient();
  const latestBlock = await client.getBlockNumber();
  const lastSynced = await getLastSyncedBlock(vaultId);

  const fromBlock = lastSynced ? BigInt(lastSynced + 1) : latestBlock - 10000n;

  if (fromBlock > latestBlock) {
    logger.info("Deposits already synced to latest block", {
      vaultId,
      latestBlock: Number(latestBlock),
    });
    return;
  }

  logger.info("Catching up deposits", {
    vaultId,
    fromBlock: Number(fromBlock),
    toBlock: Number(latestBlock),
  });

  const result = await syncDepositsFromBlock(vaultId, contractAddress, fromBlock, latestBlock);

  logger.info("Deposit catch-up complete", {
    vaultId,
    processed: result.processed,
    skipped: result.skipped,
    fromBlock: Number(fromBlock),
    toBlock: Number(latestBlock),
  });

  await updateLastSyncedBlock(vaultId, Number(latestBlock));
}

export async function catchUpAllVaults(): Promise<void> {
  const allVaults = await db.select().from(vaults).where(eq(vaults.status, "public"));

  for (const vault of allVaults) {
    try {
      await catchUpDeposits(vault.id, vault.contractAddress as Address);
    } catch (error) {
      logger.error("Failed to catch up deposits for vault", {
        vaultId: vault.id,
        error: (error as Error).message,
      });
    }
  }
}
