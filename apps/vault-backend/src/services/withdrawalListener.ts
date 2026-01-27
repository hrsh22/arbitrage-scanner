import { parseAbiItem, type Address, decodeEventLog, formatUnits } from "viem";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { claimedEvents, vaults, syncState, withdrawalRequests, users } from "../db/schema.js";
import { withdrawalService } from "./withdrawalService.js";
import { logger } from "../logger.js";
import { env, getFallbackRpcUrlsForNetwork, getChainIdForNetwork } from "../env.js";
import { getContractDeploymentBlock } from "./chain/contractDeploymentBlock.js";

function normalizeDecimal(value: string, decimals: number): string {
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return `${whole}.${padded}`;
}

const WITHDRAWAL_REQUESTED_EVENT = parseAbiItem(
  "event WithdrawalRequested(address indexed user, uint256 indexed requestId, uint256 shares, uint256 ownershipBps)",
);

const CLAIMED_EVENT = parseAbiItem(
  "event Claimed(address indexed user, uint256 indexed requestId, uint256 amount)",
);

// Event topic hashes
const WITHDRAWAL_REQUESTED_TOPIC =
  "0x38e3d972947cfef94205163d483d6287ef27eb312e20cb8e0b13a49989db232e";
const CLAIMED_TOPIC = "0x47cee97cb7acd717b3c0aa1435d004cd5b3c8c57d70dbceb4e4458bbd60e39d4";

// Chunk size for eth_getLogs ranges.
// Withdrawals/claims are low-frequency events, so using larger ranges is safe and avoids long cron runtimes.
const MAX_LOG_RANGE = 2000n;
// Max blocks to process in a single cron run
const MAX_BLOCKS_PER_RUN = 5000n;
// Small buffer before vault creation time
const INITIAL_SYNC_BUFFER_BLOCKS = 500n;
// Delay between requests to avoid rate limits
const REQUEST_SPACING_MS = 250;
// Request timeout with AbortController
const REQUEST_TIMEOUT_MS = 8000;
// Progress log frequency
const PROGRESS_LOG_EVERY_CHUNKS = 50;

// RPC endpoints in order of preference
function getRpcUrls(): string[] {
  const fallbacks = getFallbackRpcUrlsForNetwork();
  const urls = [env.POLYGON_RPC_URL, ...fallbacks];
  return [...new Set(urls)].filter((url) => url && url.trim().length > 0);
}

// Simple JSON-RPC call with AbortController timeout
async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as { result?: unknown; error?: { message: string } };
    if (data.error) {
      throw new Error(data.error.message);
    }
    return data.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Try RPC call across multiple endpoints
async function rpcWithFallback(method: string, params: unknown[]): Promise<unknown> {
  const urls = getRpcUrls();
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      return await rpcCall(url, method, params);
    } catch (error) {
      lastError = error as Error;
      // Continue to next RPC
    }
  }

  throw lastError || new Error("All RPCs failed");
}

async function getBlockNumber(): Promise<bigint> {
  const result = await rpcWithFallback("eth_blockNumber", []);
  return BigInt(result as string);
}

async function getBlock(blockNumber: bigint): Promise<{ timestamp: bigint }> {
  const result = (await rpcWithFallback("eth_getBlockByNumber", [
    `0x${blockNumber.toString(16)}`,
    false,
  ])) as { timestamp: string };
  return { timestamp: BigInt(result.timestamp) };
}

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

async function getLogs(
  address: Address,
  topic: string,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RpcLog[]> {
  const result = await rpcWithFallback("eth_getLogs", [
    {
      address: address.toLowerCase(),
      topics: [topic],
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
    },
  ]);
  return (result as RpcLog[]) || [];
}

async function findBlockByTimestamp(targetTimestamp: number, latestBlock: bigint): Promise<bigint> {
  // Estimate starting point based on average 2-second block time
  const now = Math.floor(Date.now() / 1000);
  const secondsAgo = now - targetTimestamp;
  const estimatedBlocksAgo = BigInt(Math.floor(secondsAgo / 2));

  // Start search from a reasonable range around the estimate
  let low =
    latestBlock > estimatedBlocksAgo + 10000n ? latestBlock - estimatedBlocksAgo - 10000n : 0n;
  let high =
    latestBlock > estimatedBlocksAgo - 10000n
      ? latestBlock - estimatedBlocksAgo + 10000n
      : latestBlock;

  if (high > latestBlock) high = latestBlock;
  if (low < 0n) low = 0n;

  logger.info("Binary searching for block by timestamp", {
    targetTimestamp,
    searchRange: `${low}-${high}`,
  });

  let iterations = 0;
  while (low < high && iterations < 20) {
    iterations++;
    const mid = (low + high) / 2n;
    const block = await getBlock(mid);
    const blockTimestamp = Number(block.timestamp);

    if (blockTimestamp >= targetTimestamp) {
      high = mid;
    } else {
      low = mid + 1n;
    }
    // Small delay between binary search calls
    await new Promise((r) => setTimeout(r, 100));
  }

  logger.info("Block search complete", { foundBlock: Number(low), iterations });
  return low;
}

async function getInitialSyncBlockFromDeployment(
  vaultCreatedAt: Date,
  contractAddress: Address,
  latestBlock: bigint,
): Promise<bigint> {
  try {
    const deploymentBlock = await getContractDeploymentBlock(contractAddress);
    if (deploymentBlock > latestBlock) return 0n;
    return deploymentBlock;
  } catch (error) {
    logger.warn("Failed to resolve deployment block; falling back to timestamp heuristic", {
      contractAddress: contractAddress.toLowerCase(),
      vaultCreatedAt: vaultCreatedAt.toISOString(),
      error: (error as Error).message,
    });

    const targetTimestamp = Math.floor(vaultCreatedAt.getTime() / 1000);
    const estimatedBlock = await findBlockByTimestamp(targetTimestamp, latestBlock);
    if (estimatedBlock <= INITIAL_SYNC_BUFFER_BLOCKS) return 0n;
    return estimatedBlock - INITIAL_SYNC_BUFFER_BLOCKS;
  }
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
  try {
    // Check if already processed
    const [existingRequest] = await db
      .select()
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.vaultId, vaultId),
          eq(withdrawalRequests.onChainRequestId, event.onChainRequestId),
        ),
      )
      .limit(1);

    if (existingRequest) {
      return { recorded: false, reason: "already_processed" };
    }

    // Get or create user
    let [user] = await db
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
      user = newUser;
    }

    // Use on-chain event data for shares (avoids float overflow)
    const sharesString = normalizeDecimal(formatUnits(event.shares, 6), 6);

    // Create a full withdrawal request record (idle claim + position claims)
    // so claim-data can return non-zero values immediately when WITHDRAWAL_LOCK_DAYS=0.
    const { requestId } = await withdrawalService.createWithdrawalRequest(
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
      dbRequestId: requestId,
      txHash: event.txHash,
      blockNumber: event.blockNumber,
    });

    return { recorded: true };
  } catch (error) {
    logger.warn("Failed to process withdrawal event", {
      vaultId,
      onChainRequestId: event.onChainRequestId,
      error: (error as Error).message,
    });
    return { recorded: false, reason: (error as Error).message };
  }
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
        lastSyncedBlock: sql`GREATEST(${syncState.lastSyncedBlock}, ${blockNumber})`,
        updatedAt: new Date(),
      },
    });
}

export async function syncWithdrawalsFromBlock(
  vaultId: number,
  contractAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ processed: number; skipped: number; reachedEnd: boolean }> {
  // Cap toBlock to prevent long-running jobs
  const cappedToBlock =
    fromBlock + MAX_BLOCKS_PER_RUN < toBlock ? fromBlock + MAX_BLOCKS_PER_RUN : toBlock;

  const totalChunks = Number((cappedToBlock - fromBlock) / MAX_LOG_RANGE) + 1;

  logger.info("Starting withdrawal sync", {
    vaultId,
    fromBlock: Number(fromBlock),
    cappedToBlock: Number(cappedToBlock),
    originalToBlock: Number(toBlock),
    totalChunks,
    capped: cappedToBlock < toBlock,
  });

  let processed = 0;
  let skipped = 0;
  let cursor = fromBlock;
  let chunkIndex = 0;

  while (cursor <= cappedToBlock) {
    const chunkTo = cursor + MAX_LOG_RANGE - 1n;
    const endBlock = chunkTo > cappedToBlock ? cappedToBlock : chunkTo;

    // Log progress every chunk for debugging
    if (chunkIndex % 10 === 0) {
      logger.info("Withdrawal sync progress", {
        vaultId,
        chunk: chunkIndex + 1,
        totalChunks,
        blockRange: `${cursor}-${endBlock}`,
        processed,
        skipped,
      });
    }

    let rpcLogs: RpcLog[];
    try {
      rpcLogs = await getLogs(contractAddress, WITHDRAWAL_REQUESTED_TOPIC, cursor, endBlock);
    } catch (error) {
      logger.error("Failed to fetch logs for chunk", {
        vaultId,
        chunk: chunkIndex + 1,
        blockRange: `${cursor}-${endBlock}`,
        error: (error as Error).message,
      });
      // Save progress up to the last successful chunk and return
      return { processed, skipped, reachedEnd: false };
    }

    for (const log of rpcLogs) {
      // Decode the event data
      const decoded = decodeEventLog({
        abi: [WITHDRAWAL_REQUESTED_EVENT],
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      const event: WithdrawalRequestedEventData = {
        userAddress: decoded.args.user as string,
        onChainRequestId: Number(decoded.args.requestId),
        shares: decoded.args.shares as bigint,
        ownershipBps: decoded.args.ownershipBps as bigint,
        txHash: log.transactionHash,
        blockNumber: Number(BigInt(log.blockNumber)),
        logIndex: Number(BigInt(log.logIndex)),
      };

      const result = await processWithdrawalRequestedEvent(vaultId, event);
      if (result.recorded) {
        processed++;
      } else {
        skipped++;
      }
    }

    // Save sync state after each chunk
    await updateLastSyncedBlock(vaultId, Number(endBlock));

    cursor = endBlock + 1n;
    chunkIndex += 1;

    // Delay between chunks
    await new Promise((resolve) => setTimeout(resolve, REQUEST_SPACING_MS));
  }

  await updateLastSyncedBlock(vaultId, Number(cappedToBlock));

  const reachedEnd = cappedToBlock >= toBlock;
  return { processed, skipped, reachedEnd };
}

export async function catchUpWithdrawals(
  vaultId: number,
  contractAddress: Address,
  vaultCreatedAt: Date,
): Promise<void> {
  logger.info("Fetching latest block number", { vaultId });

  const latestBlock = await getBlockNumber();
  const lastSynced = await getLastSyncedBlock(vaultId);

  let fromBlock: bigint;
  if (lastSynced) {
    fromBlock = BigInt(lastSynced + 1);
  } else {
    logger.info("No previous sync state, resolving initial block from contract deployment", {
      vaultId,
      vaultCreatedAt: vaultCreatedAt.toISOString(),
      contractAddress: contractAddress.toLowerCase(),
    });
    fromBlock = await getInitialSyncBlockFromDeployment(
      vaultCreatedAt,
      contractAddress,
      latestBlock,
    );
  }

  if (fromBlock > latestBlock) {
    logger.info("Withdrawals already synced to latest block", {
      vaultId,
      latestBlock: Number(latestBlock),
    });
    return;
  }

  const blocksToSync = Number(latestBlock - fromBlock);
  logger.info("Starting withdrawal catch-up", {
    vaultId,
    fromBlock: Number(fromBlock),
    toBlock: Number(latestBlock),
    blocksToSync,
    estimatedRuns: Math.ceil(blocksToSync / Number(MAX_BLOCKS_PER_RUN)),
  });

  const result = await syncWithdrawalsFromBlock(vaultId, contractAddress, fromBlock, latestBlock);

  if (result.reachedEnd) {
    logger.info("Withdrawal catch-up complete (fully synced)", {
      vaultId,
      processed: result.processed,
      skipped: result.skipped,
    });
  } else {
    logger.info("Withdrawal catch-up partial (run again to continue)", {
      vaultId,
      processed: result.processed,
      skipped: result.skipped,
      maxBlocksPerRun: Number(MAX_BLOCKS_PER_RUN),
    });
  }
}

export async function catchUpAllVaultsWithdrawals(): Promise<void> {
  // Withdrawals can be requested even when a vault is draft/paused.
  // If we only sync "public" vaults, users won't see their requests recorded in the DB.
  const allVaults = await db
    .select()
    .from(vaults)
    .where(
      and(
        inArray(vaults.status, ["public", "paused", "draft"]),
        eq(vaults.chainId, getChainIdForNetwork()),
      ),
    );

  for (const vault of allVaults) {
    try {
      await catchUpWithdrawals(vault.id, vault.contractAddress as Address, vault.createdAt);
      await syncClaimedEvents(vault.id, vault.contractAddress as Address, vault.createdAt);
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

export async function updateLastClaimSyncedBlock(
  vaultId: number,
  blockNumber: number,
): Promise<void> {
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
        lastSyncedBlock: sql`GREATEST(${syncState.lastSyncedBlock}, ${blockNumber})`,
        updatedAt: new Date(),
      },
    });
}

export interface ClaimedEventData {
  userAddress: string;
  onChainRequestId: number;
  amount: bigint;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export async function processClaimedEvent(
  vaultId: number,
  event: ClaimedEventData,
): Promise<{ recorded: boolean; reason?: string }> {
  const claimedUsdc = Number(event.amount) / 1e6;

  const [request] = await db
    .select()
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.vaultId, vaultId),
        eq(withdrawalRequests.onChainRequestId, event.onChainRequestId),
      ),
    )
    .limit(1);

  if (!request) {
    return { recorded: false, reason: "request_not_found" };
  }

  // Idempotency: only apply once per (txHash, logIndex)
  // (unique constraint enforced at DB level)
  const inserted = await db
    .insert(claimedEvents)
    .values({
      vaultId,
      onChainRequestId: event.onChainRequestId,
      txHash: event.txHash,
      logIndex: event.logIndex,
      amountUsdc: claimedUsdc.toFixed(6),
    })
    .onConflictDoNothing()
    .returning({ id: claimedEvents.id });

  if (inserted.length === 0) {
    return { recorded: false, reason: "already_processed" };
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
    onChainRequestId: event.onChainRequestId,
    claimedUsdc,
    newTotalClaimed,
    isFullyClaimed,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
  });

  return { recorded: true };
}

export async function syncClaimedEvents(
  vaultId: number,
  contractAddress: Address,
  vaultCreatedAt: Date,
): Promise<{ processed: number; skipped: number; reachedEnd: boolean }> {
  logger.info("Fetching latest block for claimed events sync", { vaultId });

  const latestBlock = await getBlockNumber();
  const lastSynced = await getLastClaimSyncedBlock(vaultId);

  let fromBlock: bigint;
  if (lastSynced) {
    fromBlock = BigInt(lastSynced + 1);
  } else {
    logger.info("No previous claim sync state, resolving initial block from contract deployment", {
      vaultId,
      contractAddress: contractAddress.toLowerCase(),
    });
    fromBlock = await getInitialSyncBlockFromDeployment(
      vaultCreatedAt,
      contractAddress,
      latestBlock,
    );
  }

  if (fromBlock > latestBlock) {
    return { processed: 0, skipped: 0, reachedEnd: true };
  }

  // Cap toBlock to prevent long-running jobs
  const cappedToBlock =
    fromBlock + MAX_BLOCKS_PER_RUN < latestBlock ? fromBlock + MAX_BLOCKS_PER_RUN : latestBlock;

  const totalChunks = Number((cappedToBlock - fromBlock) / MAX_LOG_RANGE) + 1;

  logger.info("Starting claimed events sync", {
    vaultId,
    fromBlock: Number(fromBlock),
    cappedToBlock: Number(cappedToBlock),
    originalToBlock: Number(latestBlock),
    totalChunks,
    capped: cappedToBlock < latestBlock,
  });

  let processed = 0;
  let skipped = 0;
  let cursor = fromBlock;
  let chunkIndex = 0;

  while (cursor <= cappedToBlock) {
    const chunkTo = cursor + MAX_LOG_RANGE - 1n;
    const endBlock = chunkTo > cappedToBlock ? cappedToBlock : chunkTo;

    // Log progress periodically
    if (chunkIndex % PROGRESS_LOG_EVERY_CHUNKS === 0) {
      logger.info("Claimed sync progress", {
        vaultId,
        chunk: chunkIndex + 1,
        totalChunks,
        blockRange: `${cursor}-${endBlock}`,
        processed,
        skipped,
      });
    }

    let rpcLogs: RpcLog[];
    try {
      rpcLogs = await getLogs(contractAddress, CLAIMED_TOPIC, cursor, endBlock);
    } catch (error) {
      logger.error("Failed to fetch claimed logs for chunk", {
        vaultId,
        chunk: chunkIndex + 1,
        blockRange: `${cursor}-${endBlock}`,
        error: (error as Error).message,
      });
      return { processed, skipped, reachedEnd: false };
    }

    for (const log of rpcLogs) {
      const decoded = decodeEventLog({
        abi: [CLAIMED_EVENT],
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      const event: ClaimedEventData = {
        userAddress: decoded.args.user as string,
        onChainRequestId: Number(decoded.args.requestId),
        amount: decoded.args.amount as bigint,
        txHash: log.transactionHash,
        blockNumber: Number(BigInt(log.blockNumber)),
        logIndex: Number(BigInt(log.logIndex)),
      };

      const result = await processClaimedEvent(vaultId, event);
      if (result.recorded) {
        processed++;
      } else {
        skipped++;
      }
    }

    await updateLastClaimSyncedBlock(vaultId, Number(endBlock));

    cursor = endBlock + 1n;
    chunkIndex += 1;
    if (cursor <= cappedToBlock) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_SPACING_MS));
    }
  }

  await updateLastClaimSyncedBlock(vaultId, Number(cappedToBlock));

  const reachedEnd = cappedToBlock >= latestBlock;

  logger.info(reachedEnd ? "Claimed events sync complete" : "Claimed events sync partial", {
    vaultId,
    processed,
    skipped,
    reachedEnd,
  });

  return { processed, skipped, reachedEnd };
}
