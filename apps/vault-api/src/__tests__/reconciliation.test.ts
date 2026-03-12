/**
 * Entitlement Repository Reconciliation Tests
 *
 * Tests for:
 * - Mismatch detection between canonical and legacy fields
 * - Clean reconciliation (zero unexplained deltas)
 * - Contract vs repository state comparison
 * - Deterministic logging of mismatches
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
      limit: vi.fn().mockResolvedValue([]),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

import {
  EntitlementRepository,
  type ReconcileMismatch,
  type ContractEntitlementState,
} from "../repositories/entitlementRepository.js";
import { db as mockDb } from "../db/index.js";

describe("Reconciliation - Mismatch Detection", () => {
  let repo: EntitlementRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EntitlementRepository();
  });

  describe("Canonical vs Legacy Field Mismatches", () => {
    it("detects CANONICAL_LEGACY_ACCRUED_MISMATCH when accrued != totalRealizedUsdc", async () => {
      // Entitlement with mismatched accrued/totalRealizedUsdc
      const mockEntitlement = {
        id: 1,
        requestId: "req-mismatch-accrued",
        userAddress: "0xUser1",
        epochId: "epoch-1",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "1000000000000000000",
        entitlementRatio: "1000000000000000000", // 1.0 in 18 decimals
        entitlement: "1000000000", // 1000 USDC
        accrued: "800000000", // 800 USDC - canonical
        claimed: "0",
        carryRemaining: "1000000000",
        // Legacy fields - different from canonical
        totalRealizedUsdc: "900000000", // 900 USDC - legacy (MISMATCH!)
        totalClaimedUsdc: "0",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockEntitlement]),
          }),
        }),
      });

      const result = await repo.reconcileEntitlement(1);

      expect(result.matches).toBe(false);
      expect(result.mismatches).toHaveLength(1);

      const mismatch = result.mismatches[0]!;
      expect(mismatch.reason).toBe("CANONICAL_LEGACY_ACCRUED_MISMATCH");
      expect(mismatch.field).toBe("accrued/totalRealizedUsdc");
      expect(mismatch.canonicalValue).toBe("800000000");
      expect(mismatch.legacyValue).toBe("900000000");
      expect(mismatch.requestId).toBe("req-mismatch-accrued");
      expect(mismatch.userAddress).toBe("0xUser1");
      expect(mismatch.epochId).toBe("epoch-1");
    });

    it("detects CANONICAL_LEGACY_CLAIMED_MISMATCH when claimed != totalClaimedUsdc", async () => {
      // Entitlement with mismatched claimed/totalClaimedUsdc
      const mockEntitlement = {
        id: 2,
        requestId: "req-mismatch-claimed",
        userAddress: "0xUser2",
        epochId: "epoch-1",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "1000000000000000000",
        entitlementRatio: "1000000000000000000",
        entitlement: "1000000000",
        accrued: "1000000000",
        claimed: "500000000", // 500 USDC claimed - canonical
        carryRemaining: "500000000",
        // Legacy fields - different from canonical
        totalRealizedUsdc: "1000000000",
        totalClaimedUsdc: "600000000", // 600 USDC - legacy (MISMATCH!)
        status: "partially_fulfilled",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockEntitlement]),
          }),
        }),
      });

      const result = await repo.reconcileEntitlement(2);

      expect(result.matches).toBe(false);
      expect(result.mismatches).toHaveLength(1);

      const mismatch = result.mismatches[0]!;
      expect(mismatch.reason).toBe("CANONICAL_LEGACY_CLAIMED_MISMATCH");
      expect(mismatch.field).toBe("claimed/totalClaimedUsdc");
      expect(mismatch.canonicalValue).toBe("500000000");
      expect(mismatch.legacyValue).toBe("600000000");
    });

    it("detects multiple mismatches in single entitlement", async () => {
      // Entitlement with BOTH accrued and claimed mismatches
      const mockEntitlement = {
        id: 3,
        requestId: "req-multi-mismatch",
        userAddress: "0xUser3",
        epochId: "epoch-1",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "1000000000000000000",
        entitlementRatio: "1000000000000000000",
        entitlement: "1000000000",
        accrued: "800000000", // canonical
        claimed: "400000000", // canonical
        carryRemaining: "600000000",
        // Legacy fields - both mismatched
        totalRealizedUsdc: "900000000", // MISMATCH
        totalClaimedUsdc: "500000000", // MISMATCH
        status: "partially_fulfilled",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockEntitlement]),
          }),
        }),
      });

      const result = await repo.reconcileEntitlement(3);

      expect(result.matches).toBe(false);
      expect(result.mismatches).toHaveLength(2);

      const reasons = result.mismatches.map((m: ReconcileMismatch) => m.reason);
      expect(reasons).toContain("CANONICAL_LEGACY_ACCRUED_MISMATCH");
      expect(reasons).toContain("CANONICAL_LEGACY_CLAIMED_MISMATCH");
    });

    it("detects CARRY_REMAINING_CALCULATION_ERROR when carryRemaining is incorrect", async () => {
      // Entitlement with incorrect carryRemaining calculation
      const mockEntitlement = {
        id: 4,
        requestId: "req-carry-error",
        userAddress: "0xUser4",
        epochId: "epoch-1",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "1000000000000000000",
        entitlementRatio: "1000000000000000000",
        entitlement: "1000000000",
        accrued: "1000000000",
        claimed: "300000000",
        carryRemaining: "800000000", // WRONG: should be 1000000000 - 300000000 = 700000000
        totalRealizedUsdc: "1000000000",
        totalClaimedUsdc: "300000000",
        status: "partially_fulfilled",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockEntitlement]),
          }),
        }),
      });

      const result = await repo.reconcileEntitlement(4);

      expect(result.matches).toBe(false);
      expect(
        result.mismatches.some(
          (m: ReconcileMismatch) => m.reason === "CARRY_REMAINING_CALCULATION_ERROR",
        ),
      ).toBe(true);
    });
  });

  describe("Contract vs Repository Mismatches", () => {
    it("detects mismatch between repository and contract state", async () => {
      const mockEntitlement = {
        id: 5,
        requestId: "req-contract-mismatch",
        userAddress: "0xUser5",
        epochId: "epoch-1",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "1000000000000000000",
        entitlementRatio: "1000000000000000000",
        entitlement: "1000000000",
        accrued: "1000000000", // Repository says 1000 USDC
        claimed: "0",
        carryRemaining: "1000000000",
        totalRealizedUsdc: "1000000000",
        totalClaimedUsdc: "0",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([mockEntitlement]),
            limit: vi.fn().mockResolvedValue([mockEntitlement]),
          }),
        }),
      });

      // Contract state shows different values
      const contractStates: ContractEntitlementState[] = [
        {
          requestId: "req-contract-mismatch",
          userAddress: "0xUser5",
          sharesSubmitted: "1000000000000000000",
          entitlementRatio: "1000000000000000000",
          totalRealizedUsdc: "950000000", // Contract says 950 USDC - MISMATCH!
          totalClaimedUsdc: "0",
        },
      ];

      const result = await repo.reconcileEpoch("epoch-1", contractStates);

      expect(result.mismatchCount).toBeGreaterThan(0);
      expect(result.mismatches.some((m: ReconcileMismatch) => m.field.includes("(contract)"))).toBe(
        true,
      );
    });
  });

  describe("Missing Entitlements", () => {
    it("handles missing entitlement gracefully", async () => {
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No entitlement found
          }),
        }),
      });

      const result = await repo.reconcileEntitlement(999);

      expect(result.matches).toBe(false);
      expect(result.requestId).toBe("unknown");
      expect(result.mismatches[0]!.reason).toBe("LEDGER_INVARIANT_VIOLATION");
    });
  });
});

describe("Reconciliation - Clean State (Zero Unexplained Deltas)", () => {
  let repo: EntitlementRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EntitlementRepository();
  });

  it("reports zero unexplained deltas when all fields match", async () => {
    // Perfectly synchronized entitlement
    const mockEntitlement = {
      id: 10,
      requestId: "req-clean-1",
      userAddress: "0xCleanUser1",
      epochId: "epoch-clean",
      sharesSubmitted: "1000000000000000000",
      totalEpochShares: "1000000000000000000",
      entitlementRatio: "1000000000000000000",
      entitlement: "1000000000",
      accrued: "800000000", // Both canonical and legacy match
      claimed: "200000000", // Both canonical and legacy match
      carryRemaining: "800000000", // Correct: 1000000000 - 200000000
      totalRealizedUsdc: "800000000", // Matches accrued
      totalClaimedUsdc: "200000000", // Matches claimed
      status: "partially_fulfilled",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([mockEntitlement]),
          limit: vi.fn().mockResolvedValue([mockEntitlement]),
        }),
      }),
    });

    const result = await repo.reconcileEpoch("epoch-clean");

    expect(result.totalEntitlements).toBe(1);
    expect(result.matchingCount).toBe(1);
    expect(result.mismatchCount).toBe(0);
    expect(result.summary.unexplainedDeltas).toBe(0);
    expect(result.summary.explainedDeltas).toBe(0);
  });

  it("reports zero unexplained deltas for multiple clean entitlements", async () => {
    // Multiple perfectly synchronized entitlements
    const mockEntitlements = [
      {
        id: 11,
        requestId: "req-clean-2a",
        userAddress: "0xCleanUser2a",
        epochId: "epoch-clean-multi",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "3000000000000000000",
        entitlementRatio: "333333333333333333",
        entitlement: "500000000",
        accrued: "400000000",
        claimed: "100000000",
        carryRemaining: "400000000",
        totalRealizedUsdc: "400000000",
        totalClaimedUsdc: "100000000",
        status: "partially_fulfilled",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 12,
        requestId: "req-clean-2b",
        userAddress: "0xCleanUser2b",
        epochId: "epoch-clean-multi",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "3000000000000000000",
        entitlementRatio: "333333333333333333",
        entitlement: "500000000",
        accrued: "400000000",
        claimed: "0",
        carryRemaining: "500000000",
        totalRealizedUsdc: "400000000",
        totalClaimedUsdc: "0",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 13,
        requestId: "req-clean-2c",
        userAddress: "0xCleanUser2c",
        epochId: "epoch-clean-multi",
        sharesSubmitted: "1000000000000000000",
        totalEpochShares: "3000000000000000000",
        entitlementRatio: "333333333333333333",
        entitlement: "500000000",
        accrued: "500000000",
        claimed: "500000000",
        carryRemaining: "0",
        totalRealizedUsdc: "500000000",
        totalClaimedUsdc: "500000000",
        status: "fully_fulfilled",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(mockEntitlements),
          limit: vi.fn().mockResolvedValue(mockEntitlements),
        }),
      }),
    });

    const result = await repo.reconcileEpoch("epoch-clean-multi");

    expect(result.totalEntitlements).toBe(3);
    expect(result.matchingCount).toBe(3);
    expect(result.mismatchCount).toBe(0);
    expect(result.summary.unexplainedDeltas).toBe(0);
    expect(result.mismatches).toHaveLength(0);
  });

  it("isReconciled returns true when zero unexplained deltas", async () => {
    const mockEntitlement = {
      id: 14,
      requestId: "req-is-reconciled",
      userAddress: "0xReconciledUser",
      epochId: "epoch-reconciled",
      sharesSubmitted: "1000000000000000000",
      totalEpochShares: "1000000000000000000",
      entitlementRatio: "1000000000000000000",
      entitlement: "1000000000",
      accrued: "1000000000",
      claimed: "0",
      carryRemaining: "1000000000",
      totalRealizedUsdc: "1000000000",
      totalClaimedUsdc: "0",
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([mockEntitlement]),
          limit: vi.fn().mockResolvedValue([mockEntitlement]),
        }),
      }),
    });

    const { reconciled, report } = await repo.isReconciled("epoch-reconciled");

    expect(reconciled).toBe(true);
    expect(report.summary.unexplainedDeltas).toBe(0);
  });

  it("handles empty epoch (no entitlements) as reconciled", async () => {
    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await repo.reconcileEpoch("epoch-empty");

    expect(result.totalEntitlements).toBe(0);
    expect(result.matchingCount).toBe(0);
    expect(result.mismatchCount).toBe(0);
    expect(result.summary.unexplainedDeltas).toBe(0);
    expect(result.summary.explainedDeltas).toBe(0);
  });
});

describe("Reconciliation - Explained vs Unexplained Deltas", () => {
  let repo: EntitlementRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EntitlementRepository();
  });

  it("correctly categorizes canonical/legacy mismatches as explained", async () => {
    const mockEntitlement = {
      id: 20,
      requestId: "req-explained",
      userAddress: "0xExplainedUser",
      epochId: "epoch-explained",
      sharesSubmitted: "1000000000000000000",
      totalEpochShares: "1000000000000000000",
      entitlementRatio: "1000000000000000000",
      entitlement: "1000000000",
      accrued: "800000000",
      claimed: "0",
      carryRemaining: "1000000000",
      totalRealizedUsdc: "900000000", // Canonical/legacy mismatch
      totalClaimedUsdc: "0",
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([mockEntitlement]),
          limit: vi.fn().mockResolvedValue([mockEntitlement]),
        }),
      }),
    });

    const result = await repo.reconcileEpoch("epoch-explained");

    expect(result.summary.explainedDeltas).toBe(1);
    expect(result.summary.unexplainedDeltas).toBe(0);
  });

  it("correctly categorizes carry calculation errors as unexplained", async () => {
    const mockEntitlement = {
      id: 21,
      requestId: "req-unexplained",
      userAddress: "0xUnexplainedUser",
      epochId: "epoch-unexplained",
      sharesSubmitted: "1000000000000000000",
      totalEpochShares: "1000000000000000000",
      entitlementRatio: "1000000000000000000",
      entitlement: "1000000000",
      accrued: "1000000000",
      claimed: "200000000",
      carryRemaining: "500000000", // WRONG: should be 800000000
      totalRealizedUsdc: "1000000000",
      totalClaimedUsdc: "200000000",
      status: "partially_fulfilled",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([mockEntitlement]),
          limit: vi.fn().mockResolvedValue([mockEntitlement]),
        }),
      }),
    });

    const result = await repo.reconcileEpoch("epoch-unexplained");

    expect(result.summary.explainedDeltas).toBe(0);
    expect(result.summary.unexplainedDeltas).toBe(1);
  });
});

describe("LedgerFieldMapping Constants", () => {
  it("exports correct field mapping constants", () => {

    expect(EntitlementRepository.LedgerFieldMapping).toBeDefined();
    expect(EntitlementRepository.LedgerFieldMapping.canonical).toEqual({
      entitlement: "entitlement",
      accrued: "accrued",
      claimed: "claimed",
      carryRemaining: "carryRemaining",
    });
    expect(EntitlementRepository.LedgerFieldMapping.legacy).toEqual({
      totalRealizedUsdc: "accrued",
      totalClaimedUsdc: "claimed",
    });
  });

  it("exports correct mismatch reason constants", () => {

    expect(EntitlementRepository.ReconcileMismatchReason).toBeDefined();
    expect(EntitlementRepository.ReconcileMismatchReason.CANONICAL_LEGACY_ACCRUED_MISMATCH).toBe(
      "CANONICAL_LEGACY_ACCRUED_MISMATCH",
    );
    expect(EntitlementRepository.ReconcileMismatchReason.CANONICAL_LEGACY_CLAIMED_MISMATCH).toBe(
      "CANONICAL_LEGACY_CLAIMED_MISMATCH",
    );
    expect(EntitlementRepository.ReconcileMismatchReason.CARRY_REMAINING_CALCULATION_ERROR).toBe(
      "CARRY_REMAINING_CALCULATION_ERROR",
    );
  });
});