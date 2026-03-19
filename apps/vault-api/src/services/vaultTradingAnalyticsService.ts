import { logger } from "../logger.js";
import { positionRepository, type PositionRepository } from "../repositories/positionRepository.js";

export interface VaultTradingAnalyticsResult {
  vaultAddress: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnlPerPosition: number;
  lastResolvedAt: string | null;
  computedAt: string;
}

export class VaultTradingAnalyticsService {
  constructor(private readonly repository: PositionRepository = positionRepository) {}

  async syncForVault(vaultAddress: string): Promise<VaultTradingAnalyticsResult> {
    const stats = await this.repository.getResolvedStats(vaultAddress);
    const row = await this.repository.upsertTradingAnalytics(vaultAddress, {
      positionCount: stats.positionCount,
      winCount: stats.winCount,
      lossCount: stats.lossCount,
      winRate: stats.winRate.toFixed(6),
      totalPnl: stats.totalPnl.toFixed(6),
      avgPnlPerPosition: stats.avgPnlPerPosition.toFixed(6),
      lastResolvedAt: stats.lastResolvedAt,
    });

    if (!row) {
      throw new Error(`Failed to persist trading analytics for ${vaultAddress}`);
    }

    logger.info("VaultTradingAnalyticsService: Synced trading analytics", {
      vaultAddress,
      positionCount: row.positionCount,
      winCount: row.winCount,
      lossCount: row.lossCount,
      winRate: row.winRate,
      totalPnl: row.totalPnl,
    });

    return {
      vaultAddress: row.vaultAddress,
      positionCount: row.positionCount,
      winCount: row.winCount,
      lossCount: row.lossCount,
      winRate: Number(row.winRate),
      totalPnl: Number(row.totalPnl),
      avgPnlPerPosition: Number(row.avgPnlPerPosition),
      lastResolvedAt: row.lastResolvedAt?.toISOString() ?? null,
      computedAt: row.computedAt.toISOString(),
    };
  }

  async getForVault(vaultAddress: string): Promise<VaultTradingAnalyticsResult | null> {
    const row = await this.repository.getTradingAnalytics(vaultAddress);
    if (!row) {
      return null;
    }

    return {
      vaultAddress: row.vaultAddress,
      positionCount: row.positionCount,
      winCount: row.winCount,
      lossCount: row.lossCount,
      winRate: Number(row.winRate),
      totalPnl: Number(row.totalPnl),
      avgPnlPerPosition: Number(row.avgPnlPerPosition),
      lastResolvedAt: row.lastResolvedAt?.toISOString() ?? null,
      computedAt: row.computedAt.toISOString(),
    };
  }
}

export const vaultTradingAnalyticsService = new VaultTradingAnalyticsService();
