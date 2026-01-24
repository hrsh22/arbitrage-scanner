import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  users,
  deposits,
  withdrawalRequests,
  positionClaims,
  vaultPositions,
  type NewDeposit,
  type NewWithdrawalRequest,
} from "../db/schema";
import { vaultService } from "./vaultService";
import { logger } from "../logger";

export class UserService {
  async getOrCreateUser(walletAddress: string): Promise<{ id: number; walletAddress: string }> {
    const normalized = walletAddress.toLowerCase();

    const [existing] = await db.select().from(users).where(eq(users.walletAddress, normalized));

    if (existing) {
      return existing;
    }

    const [created] = await db.insert(users).values({ walletAddress: normalized }).returning();

    logger.info("New user created", { walletAddress: normalized });
    return created!;
  }

  async recordDeposit(
    vaultId: number,
    userId: number,
    txHash: string,
    amountUsdc: string,
    sharesReceived: string,
    navAtDeposit: string,
    blockNumber?: number,
  ): Promise<void> {
    const deposit: NewDeposit = {
      vaultId,
      userId,
      txHash,
      amountUsdc,
      sharesReceived,
      navAtDeposit,
      blockNumber,
    };

    await db.insert(deposits).values(deposit);
    await vaultService.addShares(vaultId, sharesReceived, amountUsdc);

    logger.info("Deposit recorded", {
      vaultId,
      userId,
      txHash,
      amountUsdc,
      sharesReceived,
    });
  }

  async requestRedeem(vaultId: number, userId: number, sharesToWithdraw: string): Promise<number> {
    const state = await vaultService.getOrCreateVaultState(vaultId);

    const totalShares = parseFloat(state.totalShares);
    const shares = parseFloat(sharesToWithdraw);

    if (shares <= 0 || shares > totalShares) {
      throw new Error("Invalid shares amount");
    }

    const ownershipPct = (shares / totalShares) * 100;
    const idleUsdcClaim = (parseFloat(state.idleUsdc) * ownershipPct) / 100;

    const openPositions = await db
      .select()
      .from(vaultPositions)
      .where(and(eq(vaultPositions.vaultId, vaultId), eq(vaultPositions.status, "open")));

    const withdrawal: NewWithdrawalRequest = {
      vaultId,
      userId,
      sharesLocked: sharesToWithdraw,
      ownershipPct: ownershipPct.toFixed(8),
      idleUsdcClaim: idleUsdcClaim.toFixed(6),
      status: "pending",
    };

    const [created] = await db.insert(withdrawalRequests).values(withdrawal).returning();

    for (const position of openPositions) {
      const positionShares = parseFloat(position.shares);
      const userSharesInPosition = (positionShares * ownershipPct) / 100;

      await db.insert(positionClaims).values({
        withdrawalRequestId: created!.id,
        positionId: position.id,
        sharesClaimed: userSharesInPosition.toFixed(6),
        status: "pending",
      });
    }

    await vaultService.lockSharesForWithdrawal(vaultId, sharesToWithdraw);

    logger.info("Withdrawal requested", {
      vaultId,
      userId,
      withdrawalId: created!.id,
      shares: sharesToWithdraw,
      ownershipPct: ownershipPct.toFixed(4),
      positionsClaimed: openPositions.length,
    });

    return created!.id;
  }

  async getUserTotalShares(vaultId: number, userId: number): Promise<number> {
    const userDeposits = await db
      .select()
      .from(deposits)
      .where(and(eq(deposits.vaultId, vaultId), eq(deposits.userId, userId)));

    const totalDeposited = userDeposits.reduce((sum, d) => sum + parseFloat(d.sharesReceived), 0);

    const pendingWithdrawals = await db
      .select()
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.vaultId, vaultId),
          eq(withdrawalRequests.userId, userId),
          sql`${withdrawalRequests.status} IN ('pending', 'processing')`,
        ),
      );

    const sharesLocked = pendingWithdrawals.reduce((sum, w) => sum + parseFloat(w.sharesLocked), 0);

    return totalDeposited - sharesLocked;
  }
}

export const userService = new UserService();
