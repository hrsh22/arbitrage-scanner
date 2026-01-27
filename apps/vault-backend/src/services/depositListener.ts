import { parseAbiItem, type Address, decodeEventLog } from "viem";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults, deposits, syncState } from "../db/schema.js";
import { userService } from "./userService.js";
import { vaultService } from "./vaultService.js";
import { logger } from "../logger.js";
import { env, getFallbackRpcUrlsForNetwork, getChainIdForNetwork } from "../env.js";
import { getContractDeploymentBlock } from "./chain/contractDeploymentBlock.js";

const DEPOSIT_EVENT = parseAbiItem(
  "event Deposit(address indexed user, uint256 assets, uint256 shares)",
);

// Deposit event topic hash
const DEPOSIT_TOPIC = "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15";

const MAX_LOG_RANGE = 2000n;
const MAX_BLOCKS_PER_RUN = 5000n;
// Kept for backwards-compatibility fallback (should be unused now that we resolve deployment blocks).
const INITIAL_SYNC_BUFFER_BLOCKS = 500n;
const REQUEST_SPACING_MS = 250;
const REQUEST_TIMEOUT_MS = 8000;
const PROGRESS_LOG_EVERY_CHUNKS = 10;

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
  const now = Math.floor(Date.now() / 1000);
  const secondsAgo = now - targetTimestamp;
  const estimatedBlocksAgo = BigInt(Math.floor(secondsAgo / 2));

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
    await new Promise((r) => setTimeout(r, 100));
  }

  logger.info("Block search complete", { foundBlock: Number(low), iterations });
  return low;
}

async function getInitialSyncBlock(
  vaultCreatedAt: Date,
  contractAddress: Address,
  latestBlock: bigint,
): Promise<bigint> {
  try {
    const deploymentBlock = await getContractDeploymentBlock(contractAddress);
    // Safety: if deployment block resolves beyond latest (shouldn't happen), fall back to 0.
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
        lastSyncedBlock: sql`GREATEST(${syncState.lastSyncedBlock}, ${blockNumber})`,
        updatedAt: new Date(),
      },
    });
}

export async function syncDepositsFromBlock(
  vaultId: number,
  contractAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ processed: number; skipped: number; reachedEnd: boolean }> {
  // Cap toBlock to prevent long-running jobs
  const cappedToBlock =
    fromBlock + MAX_BLOCKS_PER_RUN < toBlock ? fromBlock + MAX_BLOCKS_PER_RUN : toBlock;

  const totalChunks = Number((cappedToBlock - fromBlock) / MAX_LOG_RANGE) + 1;

  logger.info("Starting deposit sync", {
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

    // Log progress periodically
    if (chunkIndex % PROGRESS_LOG_EVERY_CHUNKS === 0) {
      logger.info("Deposit sync progress", {
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
      rpcLogs = await getLogs(contractAddress, DEPOSIT_TOPIC, cursor, endBlock);
    } catch (error) {
      logger.error("Failed to fetch logs for chunk", {
        vaultId,
        chunk: chunkIndex + 1,
        blockRange: `${cursor}-${endBlock}`,
        error: (error as Error).message,
      });
      return { processed, skipped, reachedEnd: false };
    }

    for (const log of rpcLogs) {
      const decoded = decodeEventLog({
        abi: [DEPOSIT_EVENT],
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      const event: DepositEventData = {
        userAddress: decoded.args.user as string,
        assets: decoded.args.assets as bigint,
        shares: decoded.args.shares as bigint,
        txHash: log.transactionHash,
        blockNumber: Number(BigInt(log.blockNumber)),
        logIndex: Number(BigInt(log.logIndex)),
      };

      const result = await processDepositEvent(vaultId, event);
      if (result.recorded) {
        processed++;
      } else {
        skipped++;
      }
    }

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

export async function catchUpDeposits(
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
    fromBlock = await getInitialSyncBlock(vaultCreatedAt, contractAddress, latestBlock);
  }

  if (fromBlock > latestBlock) {
    logger.info("Deposits already synced to latest block", {
      vaultId,
      latestBlock: Number(latestBlock),
    });
    return;
  }

  const blocksToSync = Number(latestBlock - fromBlock);
  logger.info("Starting deposit catch-up", {
    vaultId,
    fromBlock: Number(fromBlock),
    toBlock: Number(latestBlock),
    blocksToSync,
    estimatedRuns: Math.ceil(blocksToSync / Number(MAX_BLOCKS_PER_RUN)),
  });

  const result = await syncDepositsFromBlock(vaultId, contractAddress, fromBlock, latestBlock);

  if (result.reachedEnd) {
    logger.info("Deposit catch-up complete (fully synced)", {
      vaultId,
      processed: result.processed,
      skipped: result.skipped,
    });
  } else {
    logger.info("Deposit catch-up partial (run again to continue)", {
      vaultId,
      processed: result.processed,
      skipped: result.skipped,
      maxBlocksPerRun: Number(MAX_BLOCKS_PER_RUN),
    });
  }
}

export async function catchUpAllVaults(): Promise<void> {
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
      await catchUpDeposits(vault.id, vault.contractAddress as Address, vault.createdAt);
    } catch (error) {
      logger.error("Failed to catch up deposits for vault", {
        vaultId: vault.id,
        error: (error as Error).message,
      });
    }
  }
}
