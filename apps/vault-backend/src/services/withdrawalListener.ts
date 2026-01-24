import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { polygon } from "viem/chains";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults, syncState, withdrawalRequests, users } from "../db/schema.js";
import { withdrawalService } from "./withdrawalService.js";
import { logger } from "../logger.js";
import { env } from "../env.js";
import { getClaimableAfter } from "../config/vaultConfig.js";

const WITHDRAWAL_REQUESTED_EVENT = parseAbiItem(
  "event WithdrawalRequested(address indexed user, uint256 indexed requestId, uint256 shares, uint256 ownershipBps)",
);

const CLAIMED_EVENT = parseAbiItem(
  "event Claimed(address indexed user, uint256 indexed requestId, uint256 amount)",
);

function getPolygonClient() {
  return createPublicClient({
    chain: polygon,
    transport: http(env.POLYGON_RPC_URL),
  });
}

function getSyncStateId(vaultId: number): string {
  return `withdrawal:vault:${vaultId}`;
}

function getClaimSyncStateId(vaultId: number): string {
  return `claimed:vault:${vaultId}`;
}

export interface WithdrawalRequestedEventData {
  userAddress: string;
  onChainRequestId: number;
  shares: bigint;
  ownershipBps: bigint;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export async function processWithdrawalRequestedEvent(
  vaultId: number,
  event: WithdrawalRequestedEventData,
): Promise<{ recorded: boolean; reason?: string }> {
  const [existingRequest] = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.onChainRequestId, event.onChainRequestId))
    .limit(1);

  if (existingRequest) {
    return { recorded: false, reason: "already_processed" };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.walletAddress, event.userAddress.toLowerCase()));

  if (!user) {
    const [newUser] = await db
      .insert(users)
      .values({ walletAddress: event.userAddress.toLowerCase() })
      .returning();

    if (!newUser) {
      return { recorded: false, reason: "failed_to_create_user" };
    }

    const sharesString = (Number(event.shares) / 1e6).toFixed(6);

    const result = await withdrawalService.createWithdrawalRequest(
      vaultId,
      newUser.id,
      sharesString,
      event.onChainRequestId,
    );

    logger.info("Withdrawal request event processed (new user)", {
      vaultId,
      userAddress: event.userAddress,
      onChainRequestId: event.onChainRequestId,
      shares: sharesString,
      dbRequestId: result.requestId,
      txHash: event.txHash,
      blockNumber: event.blockNumber,
      idleClaimableAfter: getClaimableAfter(new Date()).toISOString(),
    });

    return { recorded: true };
  }

  const sharesString = (Number(event.shares) / 1e6).toFixed(6);

  const result = await withdrawalService.createWithdrawalRequest(
    vaultId,
    user.id,
    sharesString,
    event.onChainRequestId,
  );

  logger.info("Withdrawal request event processed", {
    vaultId,
    userAddress: event.userAddress,
    onChainRequestId: event.onChainRequestId,
    shares: sharesString,
    dbRequestId: result.requestId,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    idleClaimableAfter: getClaimableAfter(new Date()).toISOString(),
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
      eventType: "withdrawal",
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

export async function syncWithdrawalsFromBlock(
  vaultId: number,
  contractAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ processed: number; skipped: number }> {
  const client = getPolygonClient();

  const logs = await client.getLogs({
    address: contractAddress,
    event: WITHDRAWAL_REQUESTED_EVENT,
    fromBlock,
    toBlock,
  });

  let processed = 0;
  let skipped = 0;

  for (const log of logs) {
    const event: WithdrawalRequestedEventData = {
      userAddress: log.args.user as string,
      onChainRequestId: Number(log.args.requestId),
      shares: log.args.shares as bigint,
      ownershipBps: log.args.ownershipBps as bigint,
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
    };

    const result = await processWithdrawalRequestedEvent(vaultId, event);
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

export async function catchUpWithdrawals(vaultId: number, contractAddress: Address): Promise<void> {
  const client = getPolygonClient();
  const latestBlock = await client.getBlockNumber();
  const lastSynced = await getLastSyncedBlock(vaultId);

  const fromBlock = lastSynced ? BigInt(lastSynced + 1) : latestBlock - 10000n;

  if (fromBlock > latestBlock) {
    logger.info("Withdrawals already synced to latest block", {
      vaultId,
      latestBlock: Number(latestBlock),
    });
    return;
  }

  logger.info("Catching up withdrawals", {
    vaultId,
    fromBlock: Number(fromBlock),
    toBlock: Number(latestBlock),
  });

  const result = await syncWithdrawalsFromBlock(vaultId, contractAddress, fromBlock, latestBlock);

  logger.info("Withdrawal catch-up complete", {
    vaultId,
    processed: result.processed,
    skipped: result.skipped,
    fromBlock: Number(fromBlock),
    toBlock: Number(latestBlock),
  });

  await updateLastSyncedBlock(vaultId, Number(latestBlock));
}

export async function catchUpAllVaultsWithdrawals(): Promise<void> {
  const allVaults = await db.select().from(vaults).where(eq(vaults.status, "public"));

  for (const vault of allVaults) {
    try {
      await catchUpWithdrawals(vault.id, vault.contractAddress as Address);
      await syncClaimedEvents(vault.id, vault.contractAddress as Address);
    } catch (error) {
      logger.error("Failed to catch up withdrawals for vault", {
        vaultId: vault.id,
        error: (error as Error).message,
      });
    }
  }
}

async function getLastClaimSyncedBlock(vaultId: number): Promise<number | null> {
  const [state] = await db
    .select()
    .from(syncState)
    .where(eq(syncState.id, getClaimSyncStateId(vaultId)));

  return state?.lastSyncedBlock ?? null;
}

async function updateLastClaimSyncedBlock(vaultId: number, blockNumber: number): Promise<void> {
  const id = getClaimSyncStateId(vaultId);

  await db
    .insert(syncState)
    .values({
      id,
      vaultId,
      eventType: "claimed",
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

export async function syncClaimedEvents(
  vaultId: number,
  contractAddress: Address,
): Promise<{ processed: number; skipped: number }> {
  const client = getPolygonClient();
  const latestBlock = await client.getBlockNumber();
  const lastSynced = await getLastClaimSyncedBlock(vaultId);

  const fromBlock = lastSynced ? BigInt(lastSynced + 1) : latestBlock - 10000n;

  if (fromBlock > latestBlock) {
    return { processed: 0, skipped: 0 };
  }

  const logs = await client.getLogs({
    address: contractAddress,
    event: CLAIMED_EVENT,
    fromBlock,
    toBlock: latestBlock,
  });

  let processed = 0;
  let skipped = 0;

  for (const log of logs) {
    const onChainRequestId = Number(log.args.requestId);
    const claimedAmount = log.args.amount as bigint;
    const claimedUsdc = Number(claimedAmount) / 1e6;

    const [request] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.onChainRequestId, onChainRequestId))
      .limit(1);

    if (!request) {
      skipped++;
      continue;
    }

    const currentClaimed = parseFloat(request.totalClaimedUsdc ?? "0");
    const newTotalClaimed = currentClaimed + claimedUsdc;
    const totalClaimable = parseFloat(request.currentClaimableUsdc ?? "0");

    const isFullyClaimed = newTotalClaimed >= totalClaimable && totalClaimable > 0;

    await db
      .update(withdrawalRequests)
      .set({
        totalClaimedUsdc: newTotalClaimed.toFixed(6),
        status: isFullyClaimed ? "completed" : request.status,
        completedAt: isFullyClaimed ? new Date() : request.completedAt,
      })
      .where(eq(withdrawalRequests.id, request.id));

    logger.info("Processed Claimed event", {
      vaultId,
      requestId: request.id,
      onChainRequestId,
      claimedUsdc,
      newTotalClaimed,
      isFullyClaimed,
      txHash: log.transactionHash,
    });

    processed++;
  }

  await updateLastClaimSyncedBlock(vaultId, Number(latestBlock));

  if (processed > 0 || skipped > 0) {
    logger.info("Claimed events sync complete", {
      vaultId,
      processed,
      skipped,
      fromBlock: Number(fromBlock),
      toBlock: Number(latestBlock),
    });
  }

  return { processed, skipped };
}
