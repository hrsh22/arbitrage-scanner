import { parseAbiItem, decodeEventLog, type Address, type Hex } from "viem";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults, deposits, withdrawalRequests } from "../db/schema.js";
import { getVaultContract } from "./vaultContractService.js";
import { runProcessDepositEvent, type DepositEventData } from "./depositListener.js";
import { logger } from "../logger.js";
import { env, getFallbackRpcUrlsForNetwork } from "../env.js";

const DEPOSIT_EVENT = parseAbiItem(
  "event Deposit(address indexed user, uint256 assets, uint256 shares)",
);

const DEPOSIT_TOPIC = "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15";

const SELF_HEAL_LOOKBACK_BLOCKS = 5000;
const REQUEST_TIMEOUT_MS = 8000;
const BALANCE_MISMATCH_THRESHOLD = 0.000001;

function getRpcUrls(): string[] {
  const fallbacks = getFallbackRpcUrlsForNetwork();
  const urls = [env.POLYGON_RPC_URL, ...fallbacks];
  return [...new Set(urls)].filter((url) => url && url.trim().length > 0);
}

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
  topics: (string | null)[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RpcLog[]> {
  const result = await rpcWithFallback("eth_getLogs", [
    {
      address: address.toLowerCase(),
      topics,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
    },
  ]);
  return (result as RpcLog[]) || [];
}

function padAddress(address: string): string {
  return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
}

export interface SelfHealResult {
  healed: boolean;
  depositsFound: number;
  reason?: string;
}

export async function selfHealUserDeposits(
  vaultId: number,
  contractAddress: Address,
  userAddress: string,
): Promise<SelfHealResult> {
  try {
    const latestBlock = await getBlockNumber();
    const fromBlock = latestBlock - BigInt(SELF_HEAL_LOOKBACK_BLOCKS);

    const userTopic = padAddress(userAddress);
    const logs = await getLogs(contractAddress, [DEPOSIT_TOPIC, userTopic], fromBlock, latestBlock);

    if (logs.length === 0) {
      return { healed: false, depositsFound: 0, reason: "no_recent_deposits" };
    }

    let newDeposits = 0;

    for (const log of logs) {
      const existingDeposit = await db
        .select({ id: deposits.id })
        .from(deposits)
        .where(eq(deposits.txHash, log.transactionHash))
        .limit(1);

      if (existingDeposit.length > 0) {
        continue;
      }

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

      const result = await runProcessDepositEvent(vaultId, event);
      if (result.recorded) {
        newDeposits++;
        logger.info("Self-healed deposit", {
          vaultId,
          userAddress,
          txHash: log.transactionHash,
        });
      }
    }

    return {
      healed: newDeposits > 0,
      depositsFound: newDeposits,
      reason: newDeposits > 0 ? "healed" : "all_already_recorded",
    };
  } catch (error) {
    logger.warn("Self-healing failed", {
      vaultId,
      userAddress,
      error: (error as Error).message,
    });
    return { healed: false, depositsFound: 0, reason: (error as Error).message };
  }
}

export interface BalanceCheckResult {
  onChainShares: number;
  dbShares: number;
  mismatch: boolean;
  selfHealResult?: SelfHealResult;
}

export async function checkAndHealUserBalance(
  vaultId: number,
  contractAddress: Address,
  userAddress: string,
  dbCalculatedShares: number,
): Promise<BalanceCheckResult> {
  try {
    const vaultContract = getVaultContract(contractAddress);
    const onChainBalance = await vaultContract.balanceOf(userAddress as Hex);
    const onChainShares = Number(onChainBalance) / 1e6;

    const difference = Math.abs(onChainShares - dbCalculatedShares);
    const mismatch = difference > BALANCE_MISMATCH_THRESHOLD && onChainShares > dbCalculatedShares;

    if (!mismatch) {
      return {
        onChainShares,
        dbShares: dbCalculatedShares,
        mismatch: false,
      };
    }

    logger.info("Balance mismatch detected, initiating self-heal", {
      vaultId,
      userAddress,
      onChainShares,
      dbShares: dbCalculatedShares,
      difference,
    });

    const selfHealResult = await selfHealUserDeposits(vaultId, contractAddress, userAddress);

    return {
      onChainShares,
      dbShares: dbCalculatedShares,
      mismatch: true,
      selfHealResult,
    };
  } catch (error) {
    logger.warn("Balance check failed", {
      vaultId,
      userAddress,
      error: (error as Error).message,
    });
    return {
      onChainShares: 0,
      dbShares: dbCalculatedShares,
      mismatch: false,
    };
  }
}
