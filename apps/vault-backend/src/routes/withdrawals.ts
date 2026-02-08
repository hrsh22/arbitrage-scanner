import { Router } from "express";
import type { Request, Response, Router as RouterType } from "express";
import { z } from "zod";
import { withdrawalService } from "../services/withdrawalService.js";
import { db } from "../db/client.js";
import { withdrawalRequests, users, vaults } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger.js";
import { env } from "../env.js";
import { getVaultContract } from "../services/vaultContractService.js";
import { reserveService } from "../services/reserveService.js";
import { decodeEventLog, parseAbiItem } from "viem";
import {
  runProcessWithdrawalRequestedEvent,
  runProcessClaimedEvent,
  runUpdateLastSyncedBlock as updateWithdrawalLastSyncedBlock,
  runUpdateLastClaimSyncedBlock,
  type ClaimedEventData,
} from "../services/withdrawalListener.js";

const router: RouterType = Router();

const createWithdrawalSchema = z.object({
  vaultId: z.number(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  shares: z.string(),
  onChainRequestId: z.number().optional(),
});

const linkOnChainSchema = z.object({
  onChainRequestId: z.number(),
});

const ingestWithdrawalTxSchema = z.object({
  vaultId: z.number(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

const WITHDRAWAL_REQUESTED_EVENT = parseAbiItem(
  "event WithdrawalRequested(address indexed user, uint256 indexed requestId, uint256 shares, uint256 ownershipBps)",
);

const WITHDRAWAL_REQUESTED_TOPIC =
  "0x38e3d972947cfef94205163d483d6287ef27eb312e20cb8e0b13a49989db232e";

const CLAIMED_EVENT = parseAbiItem(
  "event Claimed(address indexed user, uint256 indexed requestId, uint256 amount)",
);

// keccak256("Claimed(address,uint256,uint256)")
const CLAIMED_TOPIC = "0x7d5c3baffc477568969ad938127891220fa5b5f16a1f373aeb374f5b0d3a22a0";

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

router.post("/", async (req: Request, res: Response) => {
  if (!env.WITHDRAWALS_ENABLED) {
    res.status(503).json({ error: "Withdrawals are currently disabled" });
    return;
  }

  const parsed = createWithdrawalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { vaultId, walletAddress, shares, onChainRequestId } = parsed.data;

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.walletAddress, walletAddress.toLowerCase()));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const result = await withdrawalService.createWithdrawalRequest(
      vaultId,
      user.id,
      shares,
      onChainRequestId,
    );

    res.json({
      success: true,
      requestId: result.requestId,
      positionClaimsCreated: result.positionClaimsCreated,
    });
  } catch (error) {
    logger.error("Failed to create withdrawal request", {
      error: (error as Error).message,
      vaultId,
      walletAddress,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/:requestId", async (req: Request, res: Response) => {
  const requestId = parseInt(req.params.requestId ?? "", 10);
  if (isNaN(requestId)) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }

  try {
    const summary = await withdrawalService.getWithdrawalSummary(requestId);
    if (!summary) {
      res.status(404).json({ error: "Withdrawal request not found" });
      return;
    }

    res.json(summary);
  } catch (error) {
    logger.error("Failed to get withdrawal summary", {
      error: (error as Error).message,
      requestId,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/user/:walletAddress", async (req: Request, res: Response) => {
  const walletAddress = req.params.walletAddress ?? "";

  try {
    const summaries = await withdrawalService.getUserWithdrawals(walletAddress);
    res.json({ withdrawals: summaries });
  } catch (error) {
    logger.error("Failed to get user withdrawals", {
      error: (error as Error).message,
      walletAddress,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/:requestId/link-onchain", async (req: Request, res: Response) => {
  const requestId = parseInt(req.params.requestId ?? "", 10);
  if (isNaN(requestId)) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }

  const parsed = linkOnChainSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    await db
      .update(withdrawalRequests)
      .set({ onChainRequestId: parsed.data.onChainRequestId })
      .where(eq(withdrawalRequests.id, requestId));

    res.json({ success: true });
  } catch (error) {
    logger.error("Failed to link on-chain request", {
      error: (error as Error).message,
      requestId,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

// Best-effort ingestion path for instant UI sync (no webhooks required).
// The frontend can call this after the requestRedeem tx is confirmed.
router.post("/ingest-tx", async (req: Request, res: Response) => {
  const parsed = ingestWithdrawalTxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { vaultId, txHash } = parsed.data;

  try {
    const [vault] = await db
      .select({ contractAddress: vaults.contractAddress, id: vaults.id })
      .from(vaults)
      .where(eq(vaults.id, vaultId));

    if (!vault?.contractAddress) {
      res.status(404).json({ error: "Vault not found" });
      return;
    }

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

    const matchingLogs = (receipt.logs ?? []).filter(
      (log) =>
        log.address?.toLowerCase() === contractAddress &&
        log.topics?.[0]?.toLowerCase() === WITHDRAWAL_REQUESTED_TOPIC.toLowerCase(),
    );

    if (matchingLogs.length === 0) {
      res.status(400).json({
        error:
          "No WithdrawalRequested event found in transaction. Ensure this tx is a requestRedeem call for the specified vault.",
      });
      return;
    }

    // Typically exactly one.
    const recordedResults: Array<{
      recorded: boolean;
      reason?: string;
      onChainRequestId?: number;
    }> = [];

    for (const log of matchingLogs) {
      const decoded = decodeEventLog({
        abi: [WITHDRAWAL_REQUESTED_EVENT],
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      const onChainRequestId = Number(decoded.args.requestId);

      const result = await runProcessWithdrawalRequestedEvent(vaultId, {
        userAddress: decoded.args.user as string,
        onChainRequestId,
        shares: decoded.args.shares as bigint,
        ownershipBps: decoded.args.ownershipBps as bigint,
        txHash: log.transactionHash,
        blockNumber,
        logIndex: Number(BigInt(log.logIndex)),
      });

      recordedResults.push({ ...result, onChainRequestId });
    }

    // Advance cursor monotonically (best-effort)
    await updateWithdrawalLastSyncedBlock(vaultId, blockNumber);

    res.json({ success: true, results: recordedResults, blockNumber });
  } catch (error) {
    logger.error("Failed to ingest withdrawal tx", {
      error: (error as Error).message,
      vaultId,
      txHash,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/:requestId/claim-data", async (req: Request, res: Response) => {
  const requestId = parseInt(req.params.requestId ?? "", 10);
  if (isNaN(requestId)) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }

  try {
    const [request] = await db
      .select({
        id: withdrawalRequests.id,
        vaultId: withdrawalRequests.vaultId,
        onChainRequestId: withdrawalRequests.onChainRequestId,
        lastMerkleProof: withdrawalRequests.lastMerkleProof,
        lastMerkleRoot: withdrawalRequests.lastMerkleRoot,
        currentClaimableUsdc: withdrawalRequests.currentClaimableUsdc,
        totalClaimedUsdc: withdrawalRequests.totalClaimedUsdc,
        status: withdrawalRequests.status,
        completedAt: withdrawalRequests.completedAt,
      })
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId));

    if (!request) {
      res.status(404).json({ error: "Withdrawal request not found" });
      return;
    }

    if (request.onChainRequestId === null || request.onChainRequestId === undefined) {
      res.status(400).json({ error: "Request not linked to on-chain transaction" });
      return;
    }

    // Get the vault's contract address
    const [vault] = await db
      .select({ contractAddress: vaults.contractAddress, safeAddress: vaults.safeAddress })
      .from(vaults)
      .where(eq(vaults.id, request.vaultId));

    if (!vault?.contractAddress) {
      res.status(400).json({ error: "Vault contract not deployed" });
      return;
    }

    const vaultContract = getVaultContract(vault.contractAddress);

    const [onChainRequest, vaultStats] = await Promise.all([
      vaultContract.getWithdrawalRequest(request.onChainRequestId),
      vaultContract.getVaultStats(),
    ]);

    const { isLocked } = await withdrawalService.calculateClaimableForRequest(requestId);
    if (isLocked) {
      res.status(400).json({ error: "No claim data available yet" });
      return;
    }

    const treasuryBalance = await reserveService.getUsdcBalance(vault.safeAddress);
    const totalLockedAssets = vaultStats.totalLockedAssets;

    let authorizedCumulative = 0n;
    if (totalLockedAssets > 0n && onChainRequest.assetsReserved > 0n) {
      const coveredLockedAssets =
        treasuryBalance < totalLockedAssets ? treasuryBalance : totalLockedAssets;
      authorizedCumulative =
        (onChainRequest.assetsReserved * coveredLockedAssets) / totalLockedAssets;
    }

    if (onChainRequest.cumulativeClaimable > authorizedCumulative) {
      authorizedCumulative = onChainRequest.cumulativeClaimable;
    }

    const cappedClaimable =
      authorizedCumulative > onChainRequest.assetsReserved
        ? onChainRequest.assetsReserved
        : authorizedCumulative;

    const claimedUsdc = Number(onChainRequest.claimed) / 1e6;
    const claimableUsdc = Number(cappedClaimable) / 1e6;
    const pendingClaimUsdc = claimableUsdc - claimedUsdc;

    if (cappedClaimable <= onChainRequest.claimed) {
      const onChainClaimedUsdc = Number(onChainRequest.claimed) / 1e6;
      const dbClaimedUsdc = parseFloat(request.totalClaimedUsdc ?? "0");
      const isFullyClaimed =
        onChainRequest.claimed >= onChainRequest.assetsReserved &&
        onChainRequest.assetsReserved > 0n;

      if (
        onChainClaimedUsdc > dbClaimedUsdc ||
        (isFullyClaimed && request.status !== "completed")
      ) {
        await db
          .update(withdrawalRequests)
          .set({
            totalClaimedUsdc: onChainClaimedUsdc.toFixed(6),
            status: isFullyClaimed ? "completed" : request.status,
            completedAt: isFullyClaimed ? new Date() : request.completedAt,
          })
          .where(eq(withdrawalRequests.id, request.id));

        logger.info("Self-healed withdrawal DB from on-chain state (claim-data)", {
          requestId,
          onChainClaimed: onChainClaimedUsdc,
          dbClaimed: dbClaimedUsdc,
          isFullyClaimed,
        });
      }

      res.status(400).json({
        error:
          "Nothing to claim. This withdrawal may already be fully claimed (or was just claimed). Refresh and try again.",
        details: {
          claimed: onChainRequest.claimed.toString(),
          cumulativeClaimable: cappedClaimable.toString(),
          assetsReserved: onChainRequest.assetsReserved.toString(),
        },
      });
      return;
    }

    if (cappedClaimable > onChainRequest.assetsReserved) {
      res.status(500).json({
        error:
          "Internal error: computed claimable exceeds assetsReserved. Please contact support or try again later.",
        details: {
          cumulativeClaimable: cappedClaimable.toString(),
          assetsReserved: onChainRequest.assetsReserved.toString(),
        },
      });
      return;
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + env.CLAIM_SIG_TTL_SECONDS);
    const signature = await vaultContract.signClaim({
      user: onChainRequest.user as `0x${string}`,
      requestId: request.onChainRequestId,
      cumulativeClaimable: cappedClaimable,
      deadline,
    });

    res.json({
      onChainRequestId: request.onChainRequestId,
      cumulativeClaimable: cappedClaimable.toString(),
      deadline: deadline.toString(),
      signature,
      pendingClaimUsdc: pendingClaimUsdc.toFixed(6),
      alreadyClaimedUsdc: claimedUsdc.toFixed(6),
    });
  } catch (error) {
    logger.error("Failed to get claim data", {
      error: (error as Error).message,
      requestId,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

const ingestClaimTxSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

router.post("/:requestId/ingest-claim", async (req: Request, res: Response) => {
  const requestId = parseInt(req.params.requestId ?? "", 10);
  if (isNaN(requestId)) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }

  const parsed = ingestClaimTxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { txHash } = parsed.data;

  try {
    const [request] = await db
      .select({
        id: withdrawalRequests.id,
        vaultId: withdrawalRequests.vaultId,
        onChainRequestId: withdrawalRequests.onChainRequestId,
      })
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId));

    if (!request) {
      res.status(404).json({ error: "Withdrawal request not found" });
      return;
    }

    if (request.onChainRequestId === null) {
      res.status(400).json({ error: "Request not linked to on-chain transaction" });
      return;
    }

    const [vault] = await db
      .select({ contractAddress: vaults.contractAddress })
      .from(vaults)
      .where(eq(vaults.id, request.vaultId));

    if (!vault?.contractAddress) {
      res.status(400).json({ error: "Vault contract not deployed" });
      return;
    }

    const receiptResult = await rpcCall("eth_getTransactionReceipt", [txHash]);
    if (!receiptResult) {
      res.status(404).json({
        error: "Transaction receipt not found. Try again in a few seconds.",
      });
      return;
    }

    const receipt = receiptResult as RpcReceipt;
    const blockNumber = Number(BigInt(receipt.blockNumber));
    const contractAddress = vault.contractAddress.toLowerCase();

    const matchingLogs = (receipt.logs ?? []).filter(
      (log) =>
        log.address?.toLowerCase() === contractAddress &&
        log.topics?.[0]?.toLowerCase() === CLAIMED_TOPIC.toLowerCase(),
    );

    if (matchingLogs.length === 0) {
      res.status(400).json({
        error: "No Claimed event found in transaction.",
      });
      return;
    }

    const recordedResults: Array<{
      recorded: boolean;
      reason?: string;
      onChainRequestId?: number;
      claimedUsdc?: number;
    }> = [];

    for (const log of matchingLogs) {
      const decoded = decodeEventLog({
        abi: [CLAIMED_EVENT],
        data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });

      const eventOnChainRequestId = Number(decoded.args.requestId);

      if (eventOnChainRequestId !== request.onChainRequestId) {
        continue;
      }

      const event: ClaimedEventData = {
        userAddress: decoded.args.user as string,
        onChainRequestId: eventOnChainRequestId,
        amount: decoded.args.amount as bigint,
        txHash: log.transactionHash,
        blockNumber,
        logIndex: Number(BigInt(log.logIndex)),
      };

      const result = await runProcessClaimedEvent(request.vaultId, event);
      recordedResults.push({
        ...result,
        onChainRequestId: eventOnChainRequestId,
        claimedUsdc: Number(event.amount) / 1e6,
      });
    }

    if (recordedResults.length === 0) {
      res.status(400).json({
        error: "No matching Claimed event found for this withdrawal request.",
      });
      return;
    }

    await runUpdateLastClaimSyncedBlock(request.vaultId, blockNumber);

    res.json({ success: true, results: recordedResults, blockNumber });
  } catch (error) {
    logger.error("Failed to ingest claim tx", {
      error: (error as Error).message,
      requestId,
      txHash,
    });
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
