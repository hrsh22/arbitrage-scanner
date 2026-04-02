import { describe, expect, it } from "vitest";

import { computeExternalTradingAnalytics } from "../services/externalTradingAnalytics.js";

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
