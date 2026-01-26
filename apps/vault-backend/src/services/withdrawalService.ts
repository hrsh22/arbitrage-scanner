import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  withdrawalRequests,
  positionClaims,
  vaultPositions,
  vaultState,
  users,
  vaults,
} from "../db/schema.js";
import { buildClaimTree, serializeProof, type ClaimLeaf } from "./merkleService.js";
import { isClaimable, getClaimableAfter } from "../config/vaultConfig.js";
import { logger } from "../logger.js";
import { getVaultContract } from "./vaultContractService.js";

export interface WithdrawalSummary {
  requestId: number;
  onChainRequestId: number | null;
  status: string;
  sharesLocked: string;
  ownershipPct: string;
  idleUsdcClaim: string;
  totalClaimedUsdc: string;
  currentClaimableUsdc: string;
  pendingPositions: number;
  resolvedPositions: number;
  claimableAfter: string;
  isClaimable: boolean;
}

export class WithdrawalService {
  async createWithdrawalRequest(
    vaultId: number,
    userId: number,
    shares: string,
    onChainRequestId?: number,
  ): Promise<{ requestId: number; positionClaimsCreated: number }> {
    const [state] = await db.select().from(vaultState).where(eq(vaultState.vaultId, vaultId));

    if (!state) {
      throw new Error(`Vault state not found for vault ${vaultId}`);
    }

    const totalShares = parseFloat(state.totalShares);
    const idleUsdc = parseFloat(state.idleUsdc);
    const sharesFloat = parseFloat(shares);

    if (totalShares === 0) {
      throw new Error("No shares in vault");
    }

    const ownershipPct = sharesFloat / totalShares;
    const idleUsdcClaim = ownershipPct * idleUsdc;

    const [request] = await db
      .insert(withdrawalRequests)
      .values({
        vaultId,
        userId,
        onChainRequestId: onChainRequestId ?? null,
        sharesLocked: shares,
        ownershipPct: ownershipPct.toFixed(8),
        idleUsdcClaim: idleUsdcClaim.toFixed(6),
        status: "pending",
        currentClaimableUsdc: idleUsdcClaim.toFixed(6),
      })
      .returning();

    if (!request) {
      throw new Error("Failed to create withdrawal request");
    }

    const openPositions = await db
      .select()
      .from(vaultPositions)
      .where(and(eq(vaultPositions.vaultId, vaultId), eq(vaultPositions.status, "open")));

    let claimsCreated = 0;
    for (const position of openPositions) {
      const positionShares = parseFloat(position.shares);
      const userSharesClaim = positionShares * ownershipPct;

      await db.insert(positionClaims).values({
        withdrawalRequestId: request.id,
        positionId: position.id,
        sharesClaimed: userSharesClaim.toFixed(6),
        status: "pending",
      });
      claimsCreated++;
    }

    logger.info("Withdrawal request created", {
      requestId: request.id,
      vaultId,
      userId,
      shares,
      ownershipPct: ownershipPct.toFixed(8),
      idleUsdcClaim: idleUsdcClaim.toFixed(6),
      positionClaimsCreated: claimsCreated,
    });

    return { requestId: request.id, positionClaimsCreated: claimsCreated };
  }

  async calculateClaimableForRequest(requestId: number): Promise<{
    totalClaimable: bigint;
    breakdown: { idle: bigint; resolved: bigint };
    isLocked: boolean;
  }> {
    const [request] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId));

    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (!isClaimable(request.requestedAt)) {
      return {
        totalClaimable: 0n,
        breakdown: { idle: 0n, resolved: 0n },
        isLocked: true,
      };
    }

    const idleClaimUsdc = BigInt(Math.floor(parseFloat(request.idleUsdcClaim) * 1e6));

    const claims = await db
      .select()
      .from(positionClaims)
      .where(eq(positionClaims.withdrawalRequestId, requestId));

    let resolvedClaimUsdc = 0n;
    for (const claim of claims) {
      if (claim.status === "resolved_win" || claim.status === "resolved_loss") {
        const value = claim.resolutionValueUsdc
          ? BigInt(Math.floor(parseFloat(claim.resolutionValueUsdc) * 1e6))
          : 0n;
        resolvedClaimUsdc += value;
      }
    }

    return {
      totalClaimable: idleClaimUsdc + resolvedClaimUsdc,
      breakdown: { idle: idleClaimUsdc, resolved: resolvedClaimUsdc },
      isLocked: false,
    };
  }

  async updateMerkleProofsForVault(vaultId: number): Promise<{
    requestsUpdated: number;
    merkleRoot: `0x${string}`;
  }> {
    const pendingRequests = await db
      .select()
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.vaultId, vaultId),
          inArray(withdrawalRequests.status, ["pending", "processing"]),
        ),
      );

    if (pendingRequests.length === 0) {
      return {
        requestsUpdated: 0,
        merkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
      };
    }

    const claims: ClaimLeaf[] = [];
    const claimableMap = new Map<number, bigint>();

    for (const request of pendingRequests) {
      if (request.onChainRequestId === null) continue;

      const { totalClaimable } = await this.calculateClaimableForRequest(request.id);
      claims.push({
        requestId: request.onChainRequestId,
        cumulativeClaimable: totalClaimable,
      });
      claimableMap.set(request.id, totalClaimable);
    }

    if (claims.length === 0) {
      return {
        requestsUpdated: 0,
        merkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
      };
    }

    const { root, proofs } = buildClaimTree(claims);

    for (const request of pendingRequests) {
      if (request.onChainRequestId === null) continue;

      const proof = proofs.get(request.onChainRequestId);
      const claimable = claimableMap.get(request.id);

      if (proof && claimable !== undefined) {
        await db
          .update(withdrawalRequests)
          .set({
            lastMerkleRoot: root,
            lastMerkleProof: serializeProof(proof),
            currentClaimableUsdc: (Number(claimable) / 1e6).toFixed(6),
            status: "processing",
          })
          .where(eq(withdrawalRequests.id, request.id));
      }
    }

    logger.info("Merkle proofs updated for vault", {
      vaultId,
      requestsUpdated: claims.length,
      merkleRoot: root,
    });

    return { requestsUpdated: claims.length, merkleRoot: root };
  }

  async getWithdrawalSummary(requestId: number): Promise<WithdrawalSummary | null> {
    const [request] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId));

    if (!request) return null;

    const claims = await db
      .select()
      .from(positionClaims)
      .where(eq(positionClaims.withdrawalRequestId, requestId));

    const pendingPositions = claims.filter((c) => c.status === "pending").length;
    const resolvedPositions = claims.filter(
      (c) => c.status === "resolved_win" || c.status === "resolved_loss" || c.status === "claimed",
    ).length;

    const claimableAfterDate = getClaimableAfter(request.requestedAt);
    const nowClaimable = isClaimable(request.requestedAt);

    // Check on-chain state if we have an onChainRequestId
    let status = request.status;
    let totalClaimedUsdc = request.totalClaimedUsdc ?? "0";
    let currentClaimableUsdc = nowClaimable ? (request.currentClaimableUsdc ?? "0") : "0";

    if (request.onChainRequestId !== null && request.vaultId) {
      try {
        const [vault] = await db
          .select({ contractAddress: vaults.contractAddress })
          .from(vaults)
          .where(eq(vaults.id, request.vaultId));

        if (vault?.contractAddress) {
          const vaultContract = getVaultContract(vault.contractAddress);
          const onChainRequest = await vaultContract.getWithdrawalRequest(request.onChainRequestId);

          const onChainClaimed = Number(onChainRequest.claimed) / 1e6;
          const onChainTotalClaimable = Number(onChainRequest.totalClaimable) / 1e6;

          totalClaimedUsdc = onChainClaimed.toFixed(6);
          currentClaimableUsdc = onChainTotalClaimable.toFixed(6);

          // If fully claimed on-chain, mark as completed
          if (onChainTotalClaimable > 0 && onChainClaimed >= onChainTotalClaimable) {
            status = "completed";
            // Update DB in background
            if (request.status !== "completed") {
              db.update(withdrawalRequests)
                .set({
                  status: "completed",
                  totalClaimedUsdc: totalClaimedUsdc,
                  completedAt: new Date(),
                })
                .where(eq(withdrawalRequests.id, request.id))
                .then(() => {
                  logger.info("Withdrawal auto-marked complete from on-chain state", { requestId });
                })
                .catch((err) => {
                  logger.error("Failed to auto-mark withdrawal complete", {
                    requestId,
                    error: (err as Error).message,
                  });
                });
            }
          }
        }
      } catch (error) {
        logger.warn("Failed to fetch on-chain withdrawal state", {
          requestId,
          error: (error as Error).message,
        });
      }
    }

    return {
      requestId: request.id,
      onChainRequestId: request.onChainRequestId,
      status,
      sharesLocked: request.sharesLocked,
      ownershipPct: request.ownershipPct,
      idleUsdcClaim: request.idleUsdcClaim,
      totalClaimedUsdc,
      currentClaimableUsdc,
      pendingPositions,
      resolvedPositions,
      claimableAfter: claimableAfterDate.toISOString(),
      isClaimable: nowClaimable,
    };
  }

  async getUserWithdrawals(walletAddress: string): Promise<WithdrawalSummary[]> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.walletAddress, walletAddress.toLowerCase()));

    if (!user) return [];

    const requests = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.userId, user.id));

    const summaries: WithdrawalSummary[] = [];
    for (const req of requests) {
      const summary = await this.getWithdrawalSummary(req.id);
      if (summary) summaries.push(summary);
    }

    return summaries;
  }

  async markWithdrawalComplete(requestId: number): Promise<void> {
    await db
      .update(withdrawalRequests)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(withdrawalRequests.id, requestId));

    logger.info("Withdrawal marked complete", { requestId });
  }
}

export const withdrawalService = new WithdrawalService();
