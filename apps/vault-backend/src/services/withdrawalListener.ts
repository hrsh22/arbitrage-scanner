import { Effect, pipe } from "effect";
import { parseAbiItem, type Address, decodeEventLog, formatUnits } from "viem";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { claimedEvents, vaults, syncState, withdrawalRequests, users } from "../db/schema.js";
import { withdrawalService } from "./withdrawalService.js";
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
import { DatabaseError } from "../lib/errors/index.js";

const normalizeDecimal = (value: string, decimals: number): string => {
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return `${whole}.${padded}`;
};

const WITHDRAWAL_REQUESTED_EVENT = parseAbiItem(
  "event WithdrawalRequested(address indexed user, uint256 indexed requestId, uint256 shares, uint256 ownershipBps)",
);

const CLAIMED_EVENT = parseAbiItem(
  "event Claimed(address indexed user, uint256 indexed requestId, uint256 amount)",
);

const WITHDRAWAL_REQUESTED_TOPIC =
  "0x38e3d972947cfef94205163d483d6287ef27eb312e20cb8e0b13a49989db232e";
const CLAIMED_TOPIC = "0x47cee97cb7acd717b3c0aa1435d004cd5b3c8c57d70dbceb4e4458bbd60e39d4";
const PROGRESS_LOG_EVERY_CHUNKS = 50;

const getRpcUrls = (): string[] => {
  const fallbacks = getFallbackRpcUrlsForNetwork();
  const urls = [env.POLYGON_RPC_URL, ...fallbacks];
  return [...new Set(urls)].filter((url) => url && url.trim().length > 0);
};

const createRpcLayer = () => RpcClientLive(getRpcUrls());

const getSyncStateId = (vaultId: number): string => `withdrawal:vault:${vaultId}`;
const getClaimSyncStateId = (vaultId: number): string => `claimed:vault:${vaultId}`;

export interface WithdrawalRequestedEventData {
  userAddress: string;
  onChainRequestId: number;
  shares: bigint;
  ownershipBps: bigint;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface ClaimedEventData {
  userAddress: string;
  onChainRequestId: number;
  amount: bigint;
  txHash: string;
  blockNumber: number;
  logIndex: number;
}

const decodeWithdrawalRequestedLog = (log: RpcLog): WithdrawalRequestedEventData => {
  const decoded = decodeEventLog({
    abi: [WITHDRAWAL_REQUESTED_EVENT],
    data: log.data as `0x${string}`,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
  });

  return {
    userAddress: decoded.args.user as string,
    onChainRequestId: Number(decoded.args.requestId),
    shares: decoded.args.shares as bigint,
    ownershipBps: decoded.args.ownershipBps as bigint,
    txHash: log.transactionHash,
    blockNumber: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
  };
};

const decodeClaimedLog = (log: RpcLog): ClaimedEventData => {
  const decoded = decodeEventLog({
    abi: [CLAIMED_EVENT],
    data: log.data as `0x${string}`,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
  });

  return {
    userAddress: decoded.args.user as string,
    onChainRequestId: Number(decoded.args.requestId),
    amount: decoded.args.amount as bigint,
    txHash: log.transactionHash,
    blockNumber: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
  };
};

export const processWithdrawalRequestedEvent = (
  vaultId: number,
  event: WithdrawalRequestedEventData,
): Effect.Effect<{ recorded: boolean; reason?: string }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
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

      const sharesString = normalizeDecimal(formatUnits(event.shares, 6), 6);

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
    },
    catch: (error) =>
      new DatabaseError({
        operation: "processWithdrawalRequestedEvent",
        message: (error as Error).message,
        cause: error,
      }),
  });

export const processClaimedEvent = (
  vaultId: number,
  event: ClaimedEventData,
): Effect.Effect<{ recorded: boolean; reason?: string }, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
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
    },
    catch: (error) =>
      new DatabaseError({
        operation: "processClaimedEvent",
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
    },
    catch: (error) =>
      new DatabaseError({
        operation: "updateLastSyncedBlock",
        message: (error as Error).message,
        cause: error,
      }),
  });

const getLastClaimSyncedBlock = (vaultId: number): Effect.Effect<number | null, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [state] = await db
        .select()
        .from(syncState)
        .where(eq(syncState.id, getClaimSyncStateId(vaultId)));

      return state?.lastSyncedBlock ?? null;
    },
    catch: (error) =>
      new DatabaseError({
        operation: "getLastClaimSyncedBlock",
        message: (error as Error).message,
        cause: error,
      }),
  });

export const updateLastClaimSyncedBlock = (
  vaultId: number,
  blockNumber: number,
): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
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
    },
    catch: (error) =>
      new DatabaseError({
        operation: "updateLastClaimSyncedBlock",
        message: (error as Error).message,
        cause: error,
      }),
  });

export const syncWithdrawalsFromBlock = (
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

      const rpcLogs = yield* rpc.getLogs(
        contractAddress,
        [WITHDRAWAL_REQUESTED_TOPIC],
        cursor,
        endBlock,
      );

      for (const log of rpcLogs) {
        const event = decodeWithdrawalRequestedLog(log);
        const result = yield* processWithdrawalRequestedEvent(vaultId, event);

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

export const syncClaimedEvents = (
  vaultId: number,
  contractAddress: Address,
  vaultCreatedAt: Date,
): Effect.Effect<
  { processed: number; skipped: number; reachedEnd: boolean },
  RpcErrors | DatabaseError,
  RpcClient
> =>
  Effect.gen(function* () {
    const rpc = yield* RpcClient;

    logger.info("Fetching latest block for claimed events sync", { vaultId });

    const latestBlock = yield* rpc.getBlockNumber();
    const lastSynced = yield* getLastClaimSyncedBlock(vaultId);

    let fromBlock: bigint;
    if (lastSynced) {
      fromBlock = BigInt(lastSynced + 1);
    } else {
      logger.info(
        "No previous claim sync state, resolving initial block from contract deployment",
        {
          vaultId,
          contractAddress: contractAddress.toLowerCase(),
        },
      );
      fromBlock = yield* getInitialSyncBlock(vaultCreatedAt, contractAddress, latestBlock);
    }

    if (fromBlock > latestBlock) {
      return { processed: 0, skipped: 0, reachedEnd: true };
    }

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

      const rpcLogs = yield* rpc.getLogs(contractAddress, [CLAIMED_TOPIC], cursor, endBlock);

      for (const log of rpcLogs) {
        const event = decodeClaimedLog(log);
        const result = yield* processClaimedEvent(vaultId, event);

        if (result.recorded) {
          processed++;
        } else {
          skipped++;
        }
      }

      yield* updateLastClaimSyncedBlock(vaultId, Number(endBlock));

      cursor = endBlock + 1n;
      chunkIndex++;

      if (cursor <= cappedToBlock) {
        yield* delay(REQUEST_SPACING_MS);
      }
    }

    yield* updateLastClaimSyncedBlock(vaultId, Number(cappedToBlock));

    const reachedEnd = cappedToBlock >= latestBlock;

    logger.info(reachedEnd ? "Claimed events sync complete" : "Claimed events sync partial", {
      vaultId,
      processed,
      skipped,
      reachedEnd,
    });

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

export const catchUpWithdrawals = (
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

    const result = yield* syncWithdrawalsFromBlock(
      vaultId,
      contractAddress,
      fromBlock,
      latestBlock,
    );

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
  });

export const catchUpAllVaultsWithdrawals = (): Effect.Effect<
  void,
  RpcErrors | DatabaseError,
  RpcClient
> =>
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
          operation: "catchUpAllVaultsWithdrawals",
          message: (error as Error).message,
          cause: error,
        }),
    });

    for (const vault of allVaults) {
      yield* catchUpWithdrawals(vault.id, vault.contractAddress as Address, vault.createdAt).pipe(
        Effect.catchAll((error) => {
          logger.error("Failed to catch up withdrawals for vault", {
            vaultId: vault.id,
            error: error._tag,
            message: "message" in error ? error.message : String(error),
          });
          return Effect.void;
        }),
      );

      yield* syncClaimedEvents(vault.id, vault.contractAddress as Address, vault.createdAt).pipe(
        Effect.catchAll((error) => {
          logger.error("Failed to sync claimed events for vault", {
            vaultId: vault.id,
            error: error._tag,
            message: "message" in error ? error.message : String(error),
          });
          return Effect.void;
        }),
      );
    }
  });

export const runCatchUpAllVaultsWithdrawals = async (): Promise<void> => {
  const program = catchUpAllVaultsWithdrawals().pipe(Effect.provide(createRpcLayer()));
  return Effect.runPromise(program);
};

export const runCatchUpWithdrawals = async (
  vaultId: number,
  contractAddress: Address,
  vaultCreatedAt: Date,
): Promise<void> => {
  const program = catchUpWithdrawals(vaultId, contractAddress, vaultCreatedAt).pipe(
    Effect.provide(createRpcLayer()),
  );
  return Effect.runPromise(program);
};

export const runProcessWithdrawalRequestedEvent = async (
  vaultId: number,
  event: WithdrawalRequestedEventData,
): Promise<{ recorded: boolean; reason?: string }> => {
  return Effect.runPromise(processWithdrawalRequestedEvent(vaultId, event));
};

export const runProcessClaimedEvent = async (
  vaultId: number,
  event: ClaimedEventData,
): Promise<{ recorded: boolean; reason?: string }> => {
  return Effect.runPromise(processClaimedEvent(vaultId, event));
};

export const runUpdateLastSyncedBlock = async (
  vaultId: number,
  blockNumber: number,
): Promise<void> => {
  return Effect.runPromise(updateLastSyncedBlock(vaultId, blockNumber));
};

export const runUpdateLastClaimSyncedBlock = async (
  vaultId: number,
  blockNumber: number,
): Promise<void> => {
  return Effect.runPromise(updateLastClaimSyncedBlock(vaultId, blockNumber));
};
