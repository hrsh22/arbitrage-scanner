import { Router } from "express";
import type { Request, Response, Router as RouterType } from "express";
import { z } from "zod";
import { withdrawalService } from "../services/withdrawalService.js";
import { deserializeProof } from "../services/merkleService.js";
import { db } from "../db/client.js";
import { withdrawalRequests, users, vaults } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger.js";
import { env } from "../env.js";

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

    const [request] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId));

    res.json({
      ...summary,
      merkleProof: request?.lastMerkleProof ? deserializeProof(request.lastMerkleProof) : null,
      merkleRoot: request?.lastMerkleRoot ?? null,
    });
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

router.get("/:requestId/claim-data", async (req: Request, res: Response) => {
  const requestId = parseInt(req.params.requestId ?? "", 10);
  if (isNaN(requestId)) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }

  try {
    const [request] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId));

    if (!request) {
      res.status(404).json({ error: "Withdrawal request not found" });
      return;
    }

    if (!request.onChainRequestId) {
      res.status(400).json({ error: "Request not linked to on-chain transaction" });
      return;
    }

    if (!request.lastMerkleProof || !request.lastMerkleRoot) {
      res.status(400).json({ error: "No claim data available yet" });
      return;
    }

    const claimableUsdc = parseFloat(request.currentClaimableUsdc ?? "0");
    const claimedUsdc = parseFloat(request.totalClaimedUsdc ?? "0");
    const pendingClaimUsdc = claimableUsdc - claimedUsdc;

    res.json({
      onChainRequestId: request.onChainRequestId,
      cumulativeClaimable: Math.floor(claimableUsdc * 1e6).toString(),
      merkleProof: deserializeProof(request.lastMerkleProof),
      merkleRoot: request.lastMerkleRoot,
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

export default router;
