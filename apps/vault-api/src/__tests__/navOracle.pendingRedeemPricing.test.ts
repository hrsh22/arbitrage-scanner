import { describe, expect, it } from "vitest";

import { derivePendingRedeemFallbackPricing } from "../services/pendingRedeemPricing.js";

describe("derivePendingRedeemFallbackPricing", () => {
  it("prices zero-pricing-supply batches from current queued redeems, not old claimables", () => {
    const queuedRedeemUnits = 59_431_558n;
    const pendingRedeemShares = 136_085_056n;
    const result = derivePendingRedeemFallbackPricing({
      grossTotalAssetsUnits: 79_431_558n,
      claimableRedeemAssetsRaw: 20_000_000n,
      queuedRedeemAssetsRaw: queuedRedeemUnits,
      effectiveReservedRedemptionUnits: 79_431_558n,
      totalPendingRedeemSharesRaw: pendingRedeemShares,
    });

    expect(result.usedQueuedRedeemAssets).toBe(true);
    expect(result.pendingRedeemUnits).toBe(queuedRedeemUnits);
    expect(result.pendingRedeemNavUnits).toBe(
      (queuedRedeemUnits * 10n ** 18n) / pendingRedeemShares,
    );
    expect(result.pendingRedeemSharePrice).toBeCloseTo(
      Number(queuedRedeemUnits) / Number(pendingRedeemShares),
      12,
    );
  });

  it("caps queued redeem pricing after already-claimable liabilities consume assets", () => {
    const result = derivePendingRedeemFallbackPricing({
      grossTotalAssetsUnits: 50_000_000n,
      claimableRedeemAssetsRaw: 20_000_000n,
      queuedRedeemAssetsRaw: 59_431_558n,
      effectiveReservedRedemptionUnits: 50_000_000n,
      totalPendingRedeemSharesRaw: 100_000_000n,
    });

    expect(result.pendingRedeemUnits).toBe(30_000_000n);
    expect(result.pendingRedeemNavUnits).toBe(300_000_000_000_000_000n);
    expect(result.pendingRedeemSharePrice).toBeCloseTo(0.3, 10);
  });
});
