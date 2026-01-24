import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  vaults,
  vaultState,
  vaultPositions,
  navHistory,
  type VaultState,
  type VaultPosition,
  type Vault,
} from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";
import type { VaultStatus, PositionRecord } from "../types";

export class VaultService {
  async getVaultById(vaultId: number): Promise<Vault | null> {
    const [vault] = await db.select().from(vaults).where(eq(vaults.id, vaultId));
    return vault ?? null;
  }

  async getVaultBySlug(slug: string): Promise<Vault | null> {
    const [vault] = await db.select().from(vaults).where(eq(vaults.slug, slug));
    return vault ?? null;
  }

  async getPublicVaults(): Promise<Vault[]> {
    return db.select().from(vaults).where(eq(vaults.status, "public"));
  }

  async getVaultsByAdmin(adminAddress: string): Promise<Vault[]> {
    const normalized = adminAddress.toLowerCase();
    return db.select().from(vaults).where(eq(vaults.adminAddress, normalized));
  }

  async getOrCreateVaultState(vaultId: number): Promise<VaultState> {
    const [existing] = await db.select().from(vaultState).where(eq(vaultState.vaultId, vaultId));

    if (existing) {
      return existing;
    }

    const [created] = await db
      .insert(vaultState)
      .values({
        vaultId,
        totalShares: "0",
        totalAssetsUsdc: "0",
        idleUsdc: "0",
        navPerShare: "1",
        depositsEnabled: env.DEPOSITS_ENABLED,
        withdrawalsEnabled: env.WITHDRAWALS_ENABLED,
      })
      .returning();

    logger.info("Created initial vault state", { vaultId });
    return created!;
  }

  async getVaultStatus(vaultId: number): Promise<VaultStatus> {
    const vault = await this.getVaultById(vaultId);
    if (!vault) {
      throw new Error(`Vault ${vaultId} not found`);
    }

    const state = await this.getOrCreateVaultState(vaultId);
    const openPositions = await db
      .select({ count: sql<number>`count(*)` })
      .from(vaultPositions)
      .where(eq(vaultPositions.vaultId, vaultId));

    return {
      totalShares: state.totalShares,
      totalAssetsUsdc: state.totalAssetsUsdc,
      idleUsdc: state.idleUsdc,
      navPerShare: state.navPerShare,
      lastNavUpdateAt: state.lastNavUpdateAt.toISOString(),
      depositsEnabled: state.depositsEnabled,
      withdrawalsEnabled: state.withdrawalsEnabled,
      openPositionsCount: Number(openPositions[0]?.count ?? 0),
      contractAddress: vault.contractAddress,
      treasuryAddress: vault.safeAddress,
    };
  }

  async getOpenPositions(vaultId: number): Promise<PositionRecord[]> {
    const positions = await db
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.vaultId, vaultId));

    return positions.filter((p) => p.status === "open").map((p) => this.mapPositionToRecord(p));
  }

  async getAllPositions(vaultId: number): Promise<PositionRecord[]> {
    const positions = await db
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.vaultId, vaultId));
    return positions.map((p) => this.mapPositionToRecord(p));
  }

  async updateNav(vaultId: number, totalAssetsUsdc: string): Promise<VaultState> {
    const state = await this.getOrCreateVaultState(vaultId);
    const totalShares = parseFloat(state.totalShares);

    const navPerShare = totalShares > 0 ? parseFloat(totalAssetsUsdc) / totalShares : 1;

    const [updated] = await db
      .update(vaultState)
      .set({
        totalAssetsUsdc,
        navPerShare: navPerShare.toFixed(8),
        lastNavUpdateAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vaultState.id, state.id))
      .returning();

    await db.insert(navHistory).values({
      vaultId,
      navPerShare: navPerShare.toFixed(8),
      totalAssets: totalAssetsUsdc,
      totalShares: state.totalShares,
    });

    logger.info("NAV updated", {
      vaultId,
      totalAssetsUsdc,
      navPerShare: navPerShare.toFixed(8),
    });

    return updated!;
  }

  async addShares(vaultId: number, sharesAmount: string, usdcDeposited: string): Promise<void> {
    const state = await this.getOrCreateVaultState(vaultId);
    const newTotalShares = (parseFloat(state.totalShares) + parseFloat(sharesAmount)).toFixed(8);
    const newTotalAssets = (parseFloat(state.totalAssetsUsdc) + parseFloat(usdcDeposited)).toFixed(
      6,
    );
    const newIdleUsdc = (parseFloat(state.idleUsdc) + parseFloat(usdcDeposited)).toFixed(6);

    await db
      .update(vaultState)
      .set({
        totalShares: newTotalShares,
        totalAssetsUsdc: newTotalAssets,
        idleUsdc: newIdleUsdc,
        updatedAt: new Date(),
      })
      .where(eq(vaultState.id, state.id));
  }

  async lockSharesForWithdrawal(vaultId: number, sharesAmount: string): Promise<void> {
    const state = await this.getOrCreateVaultState(vaultId);
    const newTotalShares = (parseFloat(state.totalShares) - parseFloat(sharesAmount)).toFixed(8);

    if (parseFloat(newTotalShares) < 0) {
      throw new Error("Insufficient shares to lock");
    }

    await db
      .update(vaultState)
      .set({
        totalShares: newTotalShares,
        updatedAt: new Date(),
      })
      .where(eq(vaultState.id, state.id));
  }

  private mapPositionToRecord(p: VaultPosition): PositionRecord {
    const currentPrice = p.currentPrice ? parseFloat(p.currentPrice) : null;
    const shares = parseFloat(p.shares);
    const currentValueUsdc = currentPrice ? (shares * currentPrice).toFixed(6) : "0";

    return {
      id: p.id,
      marketId: p.marketId,
      marketQuestion: p.marketQuestion,
      marketSlug: p.marketSlug,
      tokenId: p.tokenId,
      outcome: p.outcome,
      shares: p.shares,
      entryPrice: p.entryPrice,
      costUsdc: p.costUsdc,
      currentPrice: p.currentPrice,
      currentValueUsdc,
      status: p.status,
      closesAt: p.closesAt?.toISOString() ?? null,
      resolvedAt: p.resolvedAt?.toISOString() ?? null,
    };
  }
}

export const vaultService = new VaultService();
