import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { users, deposits, withdrawalRequests, positionClaims, vaultPositions } from "../db/schema";
import { vaultService } from "../services/vaultService";
import type { ApiResponse, UserPosition, DepositRecord, WithdrawalRequestRecord } from "../types";

export const userRoutes: IRouter = Router();

userRoutes.get("/:vaultSlug/:walletAddress", async (req: Request, res: Response) => {
  try {
    const { vaultSlug, walletAddress } = req.params;
    if (!walletAddress || !vaultSlug) {
      res.status(400).json({ success: false, error: "Vault slug and wallet address required" });
      return;
    }

    const vault = await vaultService.getVaultBySlug(vaultSlug);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }

    const normalizedAddress = walletAddress.toLowerCase();

    let [user] = await db.select().from(users).where(eq(users.walletAddress, normalizedAddress));

    if (!user) {
      [user] = await db.insert(users).values({ walletAddress: normalizedAddress }).returning();
    }

    const state = await vaultService.getOrCreateVaultState(vault.id);

    const userDeposits = await db
      .select()
      .from(deposits)
      .where(and(eq(deposits.vaultId, vault.id), eq(deposits.userId, user!.id)));

    const totalSharesDeposited = userDeposits.reduce(
      (sum, d) => sum + parseFloat(d.sharesReceived),
      0,
    );

    const pendingWithdrawals = await db
      .select()
      .from(withdrawalRequests)
      .where(
        and(eq(withdrawalRequests.vaultId, vault.id), eq(withdrawalRequests.userId, user!.id)),
      );

    const sharesLocked = pendingWithdrawals
      .filter((w) => w.status === "pending" || w.status === "processing")
      .reduce((sum, w) => sum + parseFloat(w.sharesLocked), 0);

    const availableShares = totalSharesDeposited - sharesLocked;
    const navPerShare = parseFloat(state.navPerShare);
    const valueUsdc = availableShares * navPerShare;
    const totalShares = parseFloat(state.totalShares);
    const ownershipPct = totalShares > 0 ? (availableShares / totalShares) * 100 : 0;

    const position: UserPosition = {
      shares: availableShares.toFixed(8),
      valueUsdc: valueUsdc.toFixed(6),
      ownershipPct: ownershipPct.toFixed(6),
      pendingWithdrawal: sharesLocked > 0,
    };

    res.json({ success: true, data: { user: user!, position } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

userRoutes.get("/:vaultSlug/:walletAddress/deposits", async (req: Request, res: Response) => {
  try {
    const { vaultSlug, walletAddress } = req.params;
    if (!walletAddress || !vaultSlug) {
      res.status(400).json({ success: false, error: "Vault slug and wallet address required" });
      return;
    }

    const vault = await vaultService.getVaultBySlug(vaultSlug);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }

    const normalizedAddress = walletAddress.toLowerCase();

    const [user] = await db.select().from(users).where(eq(users.walletAddress, normalizedAddress));

    if (!user) {
      res.json({ success: true, data: [] });
      return;
    }

    const userDeposits = await db
      .select()
      .from(deposits)
      .where(and(eq(deposits.vaultId, vault.id), eq(deposits.userId, user.id)));

    const records: DepositRecord[] = userDeposits.map((d) => ({
      id: d.id,
      txHash: d.txHash,
      amountUsdc: d.amountUsdc,
      sharesReceived: d.sharesReceived,
      navAtDeposit: d.navAtDeposit,
      createdAt: d.createdAt.toISOString(),
    }));

    res.json({ success: true, data: records });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

userRoutes.get("/:vaultSlug/:walletAddress/withdrawals", async (req: Request, res: Response) => {
  try {
    const { vaultSlug, walletAddress } = req.params;
    if (!walletAddress || !vaultSlug) {
      res.status(400).json({ success: false, error: "Vault slug and wallet address required" });
      return;
    }

    const vault = await vaultService.getVaultBySlug(vaultSlug);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }

    const normalizedAddress = walletAddress.toLowerCase();

    const [user] = await db.select().from(users).where(eq(users.walletAddress, normalizedAddress));

    if (!user) {
      res.json({ success: true, data: [] });
      return;
    }

    const userWithdrawals = await db
      .select()
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.vaultId, vault.id), eq(withdrawalRequests.userId, user.id)));

    const records: WithdrawalRequestRecord[] = await Promise.all(
      userWithdrawals.map(async (w) => {
        const claims = await db
          .select({
            claim: positionClaims,
            position: vaultPositions,
          })
          .from(positionClaims)
          .leftJoin(vaultPositions, eq(positionClaims.positionId, vaultPositions.id))
          .where(eq(positionClaims.withdrawalRequestId, w.id));

        return {
          id: w.id,
          sharesLocked: w.sharesLocked,
          ownershipPct: w.ownershipPct,
          idleUsdcClaim: w.idleUsdcClaim,
          status: w.status,
          requestedAt: w.requestedAt.toISOString(),
          completedAt: w.completedAt?.toISOString() ?? null,
          totalClaimedUsdc: w.totalClaimedUsdc ?? "0",
          claims: claims.map((c) => ({
            id: c.claim.id,
            positionId: c.claim.positionId,
            marketQuestion: c.position?.marketQuestion ?? "Unknown",
            sharesClaimed: c.claim.sharesClaimed,
            status: c.claim.status,
            resolutionValueUsdc: c.claim.resolutionValueUsdc,
            claimedAt: c.claim.claimedAt?.toISOString() ?? null,
          })),
        };
      }),
    );

    res.json({ success: true, data: records });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
