import { Router } from "express";
import type { Request, Response, Router as RouterType } from "express";
import { z } from "zod";
import { parseAbiItem, decodeEventLog, type Address } from "viem";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults, deposits } from "../db/schema.js";
import { userService } from "../services/userService.js";
import { vaultService } from "../services/vaultService.js";
import { logger } from "../logger.js";
import { env } from "../env.js";
import {
  runUpdateLastSyncedBlock,
  runProcessDepositEvent,
  type DepositEventData,
} from "../services/depositListener.js";

const router: RouterType = Router();

const DEPOSIT_EVENT = parseAbiItem(
  "event Deposit(address indexed user, uint256 assets, uint256 shares)",
);

// keccak256("Deposit(address,uint256,uint256)")
const DEPOSIT_TOPIC = "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15";

interface RpcReceiptLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

interface RpcReceipt {
  status?: string;
  blockNumber: string;
  logs: RpcReceiptLog[];
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(env.POLYGON_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const data = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.result;
}

const ingestDepositTxSchema = z.object({
  vaultSlug: z.string().min(1),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

/**
 * POST /deposits/ingest
 *
 * Frontend-triggered deposit ingestion.
 * Called immediately after a deposit tx confirms to sync the DB in real-time.
 *
 * This is the primary sync mechanism - no cron needed for the happy path.
 * If this fails, the self-healing logic in user data reads will catch it.
 */
router.post("/ingest", async (req: Request, res: Response) => {
  const parsed = ingestDepositTxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { vaultSlug, txHash } = parsed.data;

  try {
    // Look up vault by slug
    const [vault] = await db
      .select({ id: vaults.id, contractAddress: vaults.contractAddress })
      .from(vaults)
      .where(eq(vaults.slug, vaultSlug));

    if (!vault?.contractAddress) {
      res.status(404).json({ error: "Vault not found or has no contract address" });
      return;
    }

    // Check if already processed (idempotency)
    const [existingDeposit] = await db
      .select({ id: deposits.id })
      .from(deposits)
      .where(eq(deposits.txHash, txHash))
      .limit(1);

    if (existingDeposit) {
      logger.info("Deposit already ingested", { txHash, depositId: existingDeposit.id });
      res.json({
        success: true,
        alreadyProcessed: true,
        depositId: existingDeposit.id,
      });
      return;
    }

    // Fetch transaction receipt
    const receiptResult = await rpcCall("eth_getTransactionReceipt", [txHash]);
    if (!receiptResult) {
      res.status(404).json({
        error:
          "Transaction receipt not found (tx may not be indexed yet). Try again in a few seconds.",
      });
      return;
    }

    const receipt = receiptResult as RpcReceipt;
    const blockNumber = Number(BigInt(receipt.blockNumber));
    const contractAddress = vault.contractAddress.toLowerCase();

    // Find Deposit event logs from this vault
    const matchingLogs = (receipt.logs ?? []).filter(
      (log) =>
        log.address?.toLowerCase() === contractAddress &&
        log.topics?.[0]?.toLowerCase() === DEPOSIT_TOPIC.toLowerCase(),
    );

    if (matchingLogs.length === 0) {
      res.status(400).json({
        error:
          "No Deposit event found in transaction. Ensure this tx is a deposit call for the specified vault.",
      });
      return;
    }

    const recordedResults: Array<{
      recorded: boolean;
      reason?: string;
      userAddress?: string;
      amountUsdc?: string;
      sharesReceived?: string;
    }> = [];

    for (const log of matchingLogs) {
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
        blockNumber,
        logIndex: Number(BigInt(log.logIndex)),
      };

      const result = await runProcessDepositEvent(vault.id, event);

      const amountUsdc = (Number(event.assets) / 1e6).toFixed(6);
      const sharesReceived = (Number(event.shares) / 1e6).toFixed(6);

      recordedResults.push({
        ...result,
        userAddress: event.userAddress,
        amountUsdc,
        sharesReceived,
      });
    }

    // Update sync state cursor (best effort)
    await runUpdateLastSyncedBlock(vault.id, blockNumber);

    logger.info("Deposit tx ingested", {
      vaultSlug,
      txHash,
      blockNumber,
      resultsCount: recordedResults.length,
    });

    res.json({
      success: true,
      results: recordedResults,
      blockNumber,
    });
  } catch (error) {
    logger.error("Failed to ingest deposit tx", {
      error: (error as Error).message,
      vaultSlug,
      txHash,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /deposits/user/:vaultSlug/:walletAddress
 *
 * Get deposits for a specific user in a vault.
 * Includes self-healing: checks on-chain for any unsynced deposits.
 */
router.get("/user/:vaultSlug/:walletAddress", async (req: Request, res: Response) => {
  const { vaultSlug, walletAddress } = req.params;

  if (!vaultSlug || !walletAddress) {
    res.status(400).json({ error: "vaultSlug and walletAddress required" });
    return;
  }

  try {
    const vault = await vaultService.getVaultBySlug(vaultSlug);
    if (!vault) {
      res.status(404).json({ error: "Vault not found" });
      return;
    }

    const normalizedAddress = walletAddress.toLowerCase();
    const user = await userService.getOrCreateUser(normalizedAddress);

    const userDeposits = await db
      .select()
      .from(deposits)
      .where(and(eq(deposits.vaultId, vault.id), eq(deposits.userId, user.id)));

    res.json({
      success: true,
      data: userDeposits.map((d) => ({
        id: d.id,
        txHash: d.txHash,
        amountUsdc: d.amountUsdc,
        sharesReceived: d.sharesReceived,
        navAtDeposit: d.navAtDeposit,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error("Failed to get user deposits", {
      error: (error as Error).message,
      vaultSlug,
      walletAddress,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
