import { afterEach, describe, expect, it, vi } from "vitest";

import type { VaultInstanceConfig } from "../config/types.js";
import {
  clearExternalTradingAnalyticsCache,
  computeExternalTradingAnalytics,
  getExternalTradingAnalytics,
} from "../services/externalTradingAnalytics.js";

const testVaultConfig: VaultInstanceConfig = {
  id: 1,
  name: "test",
  enabled: true,
  type: "custom",
  vaultContractType: "flatBookVaultV2",
  vaultAddress: "0xVault",
  safeAddress: "0xSafe",
  allocatorNavSignerKeyEnv: "ALLOCATOR_KEY",
  safeOperatorKeyEnv: "SAFE_OPERATOR_KEY",
  vaultReserveUsdc: 0,
  minAllocationAmountUsdc: 0,
  maxDeployedRatio: 1,
  navRefreshIntervalMin: 5,
  reconciliationIntervalMin: 5,
  resolutionCheckIntervalMin: 5,
};

function mockClosedPositionsFetch(positions: Array<{ realizedPnl: number; timestamp: number }>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(positions)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  clearExternalTradingAnalyticsCache();
  vi.unstubAllGlobals();
});

describe("computeExternalTradingAnalytics", () => {
  it("computes win rate from Polymarket closed positions", () => {
    const result = computeExternalTradingAnalytics({
      vaultAddress: "0xvault",
      walletAddress: "0xwallet",
      closedPositions: [
        { realizedPnl: 5, timestamp: 300 },
        { realizedPnl: -2, timestamp: 200 },
        { realizedPnl: 0, timestamp: 100 },
      ],
      computedAt: new Date("2026-04-02T00:00:00.000Z"),
    });

    expect(result.positionCount).toBe(3);
    expect(result.winCount).toBe(2);
    expect(result.lossCount).toBe(1);
    expect(result.winRate).toBeCloseTo(2 / 3, 12);
    expect(result.totalPnl).toBe(3);
    expect(result.avgPnlPerPosition).toBe(1);
    expect(result.lastResolvedAt).toBe("1970-01-01T00:05:00.000Z");
    expect(result.computedAt).toBe("2026-04-02T00:00:00.000Z");
  });
});

describe("getExternalTradingAnalytics", () => {
  it("caches Polymarket closed-position analytics between calls", async () => {
    const fetchMock = mockClosedPositionsFetch([{ realizedPnl: 5, timestamp: 300 }]);

    const first = await getExternalTradingAnalytics(testVaultConfig);
    const second = await getExternalTradingAnalytics(testVaultConfig);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests for the same vault and safe", async () => {
    const fetchMock = mockClosedPositionsFetch([{ realizedPnl: -1, timestamp: 200 }]);

    const [first, second] = await Promise.all([
      getExternalTradingAnalytics(testVaultConfig),
      getExternalTradingAnalytics(testVaultConfig),
    ]);

    expect(first).toEqual(second);
    expect(first.lossCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
