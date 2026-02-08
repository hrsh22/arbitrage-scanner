import { Effect, pipe } from "effect";
import type { Address } from "viem";
import { RpcClient, type RpcLog } from "../rpc/index.js";
import type { RpcError, HttpError, TimeoutError, JsonRpcError } from "../errors/index.js";

export const MAX_LOG_RANGE = 2000n;
export const MAX_BLOCKS_PER_RUN = 5000n;
export const INITIAL_SYNC_BUFFER_BLOCKS = 500n;
export const REQUEST_SPACING_MS = 250;

export type RpcErrors = RpcError | HttpError | TimeoutError | JsonRpcError;

export interface SyncProgress {
  processed: number;
  skipped: number;
  currentBlock: bigint;
  reachedEnd: boolean;
}

export interface ChunkResult<T> {
  logs: RpcLog[];
  events: T[];
  endBlock: bigint;
}

export const delay = (ms: number): Effect.Effect<void> =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

export const findBlockByTimestamp = (
  targetTimestamp: number,
  latestBlock: bigint,
): Effect.Effect<bigint, RpcErrors, RpcClient> =>
  Effect.gen(function* () {
    const rpc = yield* RpcClient;

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

    let iterations = 0;
    while (low < high && iterations < 20) {
      iterations++;
      const mid = (low + high) / 2n;
      const block = yield* rpc.getBlock(mid);
      const blockTimestamp = Number(block.timestamp);

      if (blockTimestamp >= targetTimestamp) {
        high = mid;
      } else {
        low = mid + 1n;
      }
      yield* delay(100);
    }

    return low;
  });

export const fetchLogsInChunks = <T>(
  contractAddress: Address,
  topic: string,
  fromBlock: bigint,
  toBlock: bigint,
  decodeLog: (log: RpcLog) => T,
  onProgress?: (chunk: number, total: number, processed: number, skipped: number) => void,
): Effect.Effect<{ logs: T[]; endBlock: bigint }, RpcErrors, RpcClient> =>
  Effect.gen(function* () {
    const rpc = yield* RpcClient;

    const cappedToBlock =
      fromBlock + MAX_BLOCKS_PER_RUN < toBlock ? fromBlock + MAX_BLOCKS_PER_RUN : toBlock;

    const totalChunks = Number((cappedToBlock - fromBlock) / MAX_LOG_RANGE) + 1;
    const allLogs: T[] = [];
    let cursor = fromBlock;
    let chunkIndex = 0;

    while (cursor <= cappedToBlock) {
      const chunkTo = cursor + MAX_LOG_RANGE - 1n;
      const endBlock = chunkTo > cappedToBlock ? cappedToBlock : chunkTo;

      if (onProgress && chunkIndex % 10 === 0) {
        onProgress(chunkIndex + 1, totalChunks, allLogs.length, 0);
      }

      const rpcLogs = yield* rpc.getLogs(contractAddress, [topic], cursor, endBlock);

      for (const log of rpcLogs) {
        allLogs.push(decodeLog(log));
      }

      cursor = endBlock + 1n;
      chunkIndex++;

      if (cursor <= cappedToBlock) {
        yield* delay(REQUEST_SPACING_MS);
      }
    }

    return { logs: allLogs, endBlock: cappedToBlock };
  });

export const capToBlock = (fromBlock: bigint, toBlock: bigint): bigint =>
  fromBlock + MAX_BLOCKS_PER_RUN < toBlock ? fromBlock + MAX_BLOCKS_PER_RUN : toBlock;

/**
 * Resolves the initial block for syncing a contract.
 * Tries to use contract deployment block first, falls back to timestamp heuristic.
 */
export const getInitialSyncBlock = (
  vaultCreatedAt: Date,
  contractAddress: Address,
  latestBlock: bigint,
  getContractDeploymentBlock: (address: Address) => Promise<bigint>,
  onFallback?: (error: Error) => void,
): Effect.Effect<bigint, RpcErrors, RpcClient> =>
  pipe(
    Effect.tryPromise({
      try: () => getContractDeploymentBlock(contractAddress),
      catch: (error) => error as Error,
    }),
    Effect.flatMap((deploymentBlock) => {
      if (deploymentBlock > latestBlock) return Effect.succeed(0n);
      return Effect.succeed(deploymentBlock);
    }),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        if (onFallback) {
          onFallback(error as Error);
        }

        const targetTimestamp = Math.floor(vaultCreatedAt.getTime() / 1000);
        const estimatedBlock = yield* findBlockByTimestamp(targetTimestamp, latestBlock);
        if (estimatedBlock <= INITIAL_SYNC_BUFFER_BLOCKS) return 0n;
        return estimatedBlock - INITIAL_SYNC_BUFFER_BLOCKS;
      }),
    ),
  );

export interface SyncResult {
  processed: number;
  skipped: number;
  reachedEnd: boolean;
}

export interface EventProcessor<T> {
  decode: (log: RpcLog) => T;
  process: (
    vaultId: number,
    event: T,
  ) => Effect.Effect<
    { recorded: boolean; reason?: string },
    import("../errors/index.js").DatabaseError
  >;
}

/**
 * Generic event syncing from blockchain logs.
 * Processes events in chunks with rate limiting and progress logging.
 */
export const syncEventsFromBlock = <T>(
  vaultId: number,
  contractAddress: Address,
  topic: string,
  fromBlock: bigint,
  toBlock: bigint,
  processor: EventProcessor<T>,
  updateSyncedBlock: (
    vaultId: number,
    blockNumber: number,
  ) => Effect.Effect<void, import("../errors/index.js").DatabaseError>,
  onProgress?: (
    chunk: number,
    total: number,
    range: string,
    processed: number,
    skipped: number,
  ) => void,
  progressEveryChunks: number = 10,
): Effect.Effect<SyncResult, RpcErrors | import("../errors/index.js").DatabaseError, RpcClient> =>
  Effect.gen(function* () {
    const rpc = yield* RpcClient;

    const cappedToBlock = capToBlock(fromBlock, toBlock);
    const totalChunks = Number((cappedToBlock - fromBlock) / MAX_LOG_RANGE) + 1;

    let processed = 0;
    let skipped = 0;
    let cursor = fromBlock;
    let chunkIndex = 0;

    while (cursor <= cappedToBlock) {
      const chunkTo = cursor + MAX_LOG_RANGE - 1n;
      const endBlock = chunkTo > cappedToBlock ? cappedToBlock : chunkTo;

      if (onProgress && chunkIndex % progressEveryChunks === 0) {
        onProgress(chunkIndex + 1, totalChunks, `${cursor}-${endBlock}`, processed, skipped);
      }

      const rpcLogs = yield* rpc.getLogs(contractAddress, [topic], cursor, endBlock);

      for (const log of rpcLogs) {
        const event = processor.decode(log);
        const result = yield* processor.process(vaultId, event);

        if (result.recorded) {
          processed++;
        } else {
          skipped++;
        }
      }

      yield* updateSyncedBlock(vaultId, Number(endBlock));

      cursor = endBlock + 1n;
      chunkIndex++;

      if (cursor <= cappedToBlock) {
        yield* delay(REQUEST_SPACING_MS);
      }
    }

    yield* updateSyncedBlock(vaultId, Number(cappedToBlock));

    return { processed, skipped, reachedEnd: cappedToBlock >= toBlock };
  });
