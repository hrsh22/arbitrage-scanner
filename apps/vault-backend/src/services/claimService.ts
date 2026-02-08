import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { positionClaims, withdrawalRequests, vaultPositions } from "../db/schema";
import { logger } from "../logger";

export class ClaimService {
  async resolvePositionClaims(positionId: number, won: boolean): Promise<void> {
    const [position] = await db
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.id, positionId));

    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const claims = await db
      .select()
      .from(positionClaims)
      .where(eq(positionClaims.positionId, positionId));

    for (const claim of claims) {
      const shares = parseFloat(claim.sharesClaimed);
      const resolutionValue = won ? shares * 1.0 : 0;

      await db
        .update(positionClaims)
        .set({
          status: won ? "resolved_win" : "resolved_loss",
          resolutionValueUsdc: resolutionValue.toFixed(6),
        })
        .where(eq(positionClaims.id, claim.id));
    }

    await db
      .update(vaultPositions)
      .set({
        status: won ? "won" : "lost",
        resolvedAt: new Date(),
        resolutionValue: won ? "1.000000" : "0.000000",
      })
      .where(eq(vaultPositions.id, positionId));

    logger.info("Position claims resolved", {
      positionId,
      won,
      claimsUpdated: claims.length,
    });
  }

  async claimResolved(withdrawalRequestId: number): Promise<{
    claimedUsdc: string;
    remainingClaims: number;
  }> {
    const resolvedClaims = await db
      .select()
      .from(positionClaims)
      .where(eq(positionClaims.withdrawalRequestId, withdrawalRequestId));

    let totalClaimed = 0;
    let remaining = 0;

    for (const claim of resolvedClaims) {
      if (claim.status === "resolved_win" || claim.status === "resolved_loss") {
        if (!claim.claimedAt) {
          totalClaimed += parseFloat(claim.resolutionValueUsdc ?? "0");

          await db
            .update(positionClaims)
            .set({
              status: "claimed",
              claimedAt: new Date(),
            })
            .where(eq(positionClaims.id, claim.id));
        }
      } else if (claim.status === "pending") {
        remaining++;
      }
    }

    const [withdrawal] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, withdrawalRequestId));

    if (withdrawal) {
      const previousClaimed = parseFloat(withdrawal.totalClaimedUsdc ?? "0");
      const newTotal = previousClaimed + totalClaimed;

      await db
        .update(withdrawalRequests)
        .set({
          totalClaimedUsdc: newTotal.toFixed(6),
          status: remaining === 0 ? "completed" : "processing",
          completedAt: remaining === 0 ? new Date() : null,
        })
        .where(eq(withdrawalRequests.id, withdrawalRequestId));
    }

    logger.info("Claims processed", {
      withdrawalRequestId,
      claimedUsdc: totalClaimed.toFixed(6),
      remainingClaims: remaining,
    });

    return {
      claimedUsdc: totalClaimed.toFixed(6),
      remainingClaims: remaining,
    };
  }
}

export const claimService = new ClaimService();
