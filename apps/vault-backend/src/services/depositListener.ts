import { Effect, pipe } from "effect";
import { parseAbiItem, type Address, decodeEventLog } from "viem";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults, deposits, syncState } from "../db/schema.js";
import { userService } from "./userService.js";
import { vaultService } from "./vaultService.js";
import { logger } from "../logger.js";
import { env, getFallbackRpcUrlsForNetwork, getChainIdForNetwork } from "../env.js";
import { getContractDeploymentBlock } from "./chain/contractDeploymentBlock.js";
import { RpcClient, RpcClientLive, type RpcLog } from "../lib/rpc/index.js";
import {
  findBlockByTimestamp,
  delay,
  MAX_LOG_RANGE,
  MAX_BLOCKS_PER_RUN,
  INITIAL_SYNC_BUFFER_BLOCKS,
  REQUEST_SPACING_MS,
  type RpcErrors,
} from "../lib/blockchain/index.js";
import { AlreadyProcessedError, DatabaseError } from "../lib/errors/index.js";

const DEPOSIT_EVENT = parseAbiItem(
  "event Deposit(address indexed user, uint256 assets, uint256 shares)",
);

const DEPOSIT_TOPIC = "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15";
const PROGRESS_LOG_EVERY_CHUNKS = 10;

const getRpcUrls = (): string[] => {
  const fallbacks = getFallbackRpcUrlsForNetwork();
  const urls = [env.POLYGON_RPC_URL, ...fallbacks];
  return [...new Set(urls)].filter((url) => url && url.trim().length > 0);
};

const createRpcLayer = () => RpcClientLive(getRpcUrls());

const getSyncStateId = (vaultId: number): string => `deposit:vault:${vaultId}`;

export interface DepositEventData {
  userAddress: string;
  assets: bigint;
  shares: bigint;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

const decodeDepositLog = (log: RpcLog): DepositEventData => {
  const decoded = decodeEventLog({
    abi: [DEPOSIT_EVENT],
    data: log.data as `0x${string}`,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
  });

  return {
    userAddress: decoded.args.user as string,
    assets: decoded.args.assets as bigint,
    shares: decoded.args.shares as bigint,
    txHash: log.transactionHash,
    blockNumber: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
  };
};

export const processDepositEvent = (
  vaultId: number,
  event: DepositEventData,
): Effect.Effect<{ recorded: boolean; reason?: string }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
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
    },
    catch: (error) =>
      new DatabaseError({
        operation: "processDepositEvent",
        message: (error as Error).message,
        cause: error,
      }),
  });

export const getLastSyncedBlock = (vaultId: number): Effect.Effect<number | null, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [state] = await db
        .select()
        .from(syncState)
        .where(eq(syncState.id, getSyncStateId(vaultId)));

      return state?.lastSyncedBlock ?? null;
    },
    catch: (error) =>
      new DatabaseError({
        operation: "getLastSyncedBlock",
        message: (error as Error).message,
        cause: error,
      }),
  });

export const updateLastSyncedBlock = (
  vaultId: number,
  blockNumber: number,
): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
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
    },
    catch: (error) =>
      new DatabaseError({
        operation: "updateLastSyncedBlock",
        message: (error as Error).message,
        cause: error,
      }),
  });

export const syncDepositsFromBlock = (
  vaultId: number,
  contractAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Effect.Effect<
  { processed: number; skipped: number; reachedEnd: boolean },
  RpcErrors | DatabaseError,
  RpcClient
> =>
  Effect.gen(function* () {
    const rpc = yield* RpcClient;

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

      const rpcLogs = yield* rpc.getLogs(contractAddress, [DEPOSIT_TOPIC], cursor, endBlock);

      for (const log of rpcLogs) {
        const event = decodeDepositLog(log);
        const result = yield* processDepositEvent(vaultId, event);

        if (result.recorded) {
          processed++;
        } else {
          skipped++;
        }
      }

      yield* updateLastSyncedBlock(vaultId, Number(endBlock));

      cursor = endBlock + 1n;
      chunkIndex++;

      if (cursor <= cappedToBlock) {
        yield* delay(REQUEST_SPACING_MS);
      }
    }

    yield* updateLastSyncedBlock(vaultId, Number(cappedToBlock));

    const reachedEnd = cappedToBlock >= toBlock;
    return { processed, skipped, reachedEnd };
  });

const getInitialSyncBlock = (
  vaultCreatedAt: Date,
  contractAddress: Address,
  latestBlock: bigint,
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
        logger.warn("Failed to resolve deployment block; falling back to timestamp heuristic", {
          contractAddress: contractAddress.toLowerCase(),
          vaultCreatedAt: vaultCreatedAt.toISOString(),
          error: (error as Error).message,
        });

        const targetTimestamp = Math.floor(vaultCreatedAt.getTime() / 1000);
        const estimatedBlock = yield* findBlockByTimestamp(targetTimestamp, latestBlock);
        if (estimatedBlock <= INITIAL_SYNC_BUFFER_BLOCKS) return 0n;
        return estimatedBlock - INITIAL_SYNC_BUFFER_BLOCKS;
      }),
    ),
  );

export const catchUpDeposits = (
  vaultId: number,
  contractAddress: Address,
  vaultCreatedAt: Date,
): Effect.Effect<void, RpcErrors | DatabaseError, RpcClient> =>
  Effect.gen(function* () {
    const rpc = yield* RpcClient;

    logger.info("Fetching latest block number", { vaultId });

    const latestBlock = yield* rpc.getBlockNumber();
    const lastSynced = yield* getLastSyncedBlock(vaultId);

    let fromBlock: bigint;
    if (lastSynced) {
      fromBlock = BigInt(lastSynced + 1);
    } else {
      logger.info("No previous sync state, resolving initial block from contract deployment", {
        vaultId,
        vaultCreatedAt: vaultCreatedAt.toISOString(),
        contractAddress: contractAddress.toLowerCase(),
      });
      fromBlock = yield* getInitialSyncBlock(vaultCreatedAt, contractAddress, latestBlock);
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

    const result = yield* syncDepositsFromBlock(vaultId, contractAddress, fromBlock, latestBlock);

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
  });

export const catchUpAllVaults = (): Effect.Effect<void, RpcErrors | DatabaseError, RpcClient> =>
  Effect.gen(function* () {
    const allVaults = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(vaults)
          .where(
            and(
              inArray(vaults.status, ["public", "paused", "draft"]),
              eq(vaults.chainId, getChainIdForNetwork()),
            ),
          ),
      catch: (error) =>
        new DatabaseError({
          operation: "catchUpAllVaults",
          message: (error as Error).message,
          cause: error,
        }),
    });

    for (const vault of allVaults) {
      yield* catchUpDeposits(vault.id, vault.contractAddress as Address, vault.createdAt).pipe(
        Effect.catchAll((error) => {
          logger.error("Failed to catch up deposits for vault", {
            vaultId: vault.id,
            error: error._tag,
            message: "message" in error ? error.message : String(error),
          });
          return Effect.void;
        }),
      );
    }
  });

export const runCatchUpAllVaults = async (): Promise<void> => {
  const program = catchUpAllVaults().pipe(Effect.provide(createRpcLayer()));

  return Effect.runPromise(program);
};

export const runCatchUpDeposits = async (
  vaultId: number,
  contractAddress: Address,
  vaultCreatedAt: Date,
): Promise<void> => {
  const program = catchUpDeposits(vaultId, contractAddress, vaultCreatedAt).pipe(
    Effect.provide(createRpcLayer()),
  );

  return Effect.runPromise(program);
};

export const runProcessDepositEvent = async (
  vaultId: number,
  event: DepositEventData,
): Promise<{ recorded: boolean; reason?: string }> => {
  return Effect.runPromise(processDepositEvent(vaultId, event));
};

export const runUpdateLastSyncedBlock = async (
  vaultId: number,
  blockNumber: number,
): Promise<void> => {
  return Effect.runPromise(updateLastSyncedBlock(vaultId, blockNumber));
};

export const runGetLastSyncedBlock = async (vaultId: number): Promise<number | null> => {
  return Effect.runPromise(getLastSyncedBlock(vaultId));
};
