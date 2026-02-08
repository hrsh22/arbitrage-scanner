import { Context, Effect, Layer } from "effect";
import type { Address } from "viem";
import { RpcError, HttpError, TimeoutError, JsonRpcError } from "../errors/index.js";

const REQUEST_TIMEOUT_MS = 8000;

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

export interface BlockData {
  timestamp: bigint;
  number: bigint;
}

export interface RpcClientService {
  readonly call: <T>(
    method: string,
    params: unknown[],
  ) => Effect.Effect<T, RpcError | HttpError | TimeoutError | JsonRpcError>;

  readonly getBlockNumber: () => Effect.Effect<
    bigint,
    RpcError | HttpError | TimeoutError | JsonRpcError
  >;

  readonly getBlock: (
    blockNumber: bigint,
  ) => Effect.Effect<BlockData, RpcError | HttpError | TimeoutError | JsonRpcError>;

  readonly getLogs: (
    address: Address,
    topics: string[],
    fromBlock: bigint,
    toBlock: bigint,
  ) => Effect.Effect<RpcLog[], RpcError | HttpError | TimeoutError | JsonRpcError>;
}

export class RpcClient extends Context.Tag("RpcClient")<RpcClient, RpcClientService>() {}

const makeRpcCall = (
  url: string,
  method: string,
  params: unknown[],
): Effect.Effect<unknown, HttpError | TimeoutError | JsonRpcError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const timeoutId = setTimeout(
        () => signal.dispatchEvent(new Event("abort")),
        REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal,
        });

        if (!response.ok) {
          throw new HttpError({ status: response.status, url, message: `HTTP ${response.status}` });
        }

        const data = (await response.json()) as {
          result?: unknown;
          error?: { code?: number; message: string; data?: unknown };
        };

        if (data.error) {
          throw new JsonRpcError({
            code: data.error.code,
            message: data.error.message,
            data: data.error.data,
          });
        }

        return data.result;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    catch: (error) => {
      if (error instanceof HttpError || error instanceof JsonRpcError) {
        return error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        return new TimeoutError({ timeoutMs: REQUEST_TIMEOUT_MS, operation: method });
      }
      return new HttpError({ status: 0, url, message: (error as Error).message });
    },
  });

const rpcWithFallback = (
  urls: string[],
  method: string,
  params: unknown[],
): Effect.Effect<unknown, RpcError | HttpError | TimeoutError | JsonRpcError> => {
  if (urls.length === 0) {
    return Effect.fail(new RpcError({ method, message: "No RPC URLs configured" }));
  }

  const [firstUrl, ...restUrls] = urls;

  return restUrls
    .reduce(
      (effect, url) => Effect.catchAll(effect, () => makeRpcCall(url, method, params)),
      makeRpcCall(firstUrl!, method, params),
    )
    .pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new RpcError({
            method,
            message: `All ${urls.length} RPC endpoints failed`,
            cause: error,
          }),
        ),
      ),
    );
};

export const makeRpcClientService = (rpcUrls: string[]): RpcClientService => {
  const urls = [...new Set(rpcUrls)].filter((url) => url && url.trim().length > 0);

  const call = <T>(method: string, params: unknown[]) =>
    rpcWithFallback(urls, method, params) as Effect.Effect<
      T,
      RpcError | HttpError | TimeoutError | JsonRpcError
    >;

  const getBlockNumber = () =>
    call<string>("eth_blockNumber", []).pipe(Effect.map((result) => BigInt(result)));

  const getBlock = (blockNumber: bigint) =>
    call<{ timestamp: string; number: string }>("eth_getBlockByNumber", [
      `0x${blockNumber.toString(16)}`,
      false,
    ]).pipe(
      Effect.map((result) => ({
        timestamp: BigInt(result.timestamp),
        number: BigInt(result.number),
      })),
    );

  const getLogs = (address: Address, topics: string[], fromBlock: bigint, toBlock: bigint) =>
    call<RpcLog[]>("eth_getLogs", [
      {
        address: address.toLowerCase(),
        topics,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      },
    ]).pipe(Effect.map((result) => result || []));

  return { call, getBlockNumber, getBlock, getLogs };
};

export const RpcClientLive = (rpcUrls: string[]): Layer.Layer<RpcClient> =>
  Layer.succeed(RpcClient, makeRpcClientService(rpcUrls));
