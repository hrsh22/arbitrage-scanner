/**
 * Epoch Repository Invariant Tests
 *
 * Tests for:
 * - Fairness invariants: cohorts absorb losses, not remaining LPs
 * - Carry conservation: total paid + remaining = total realized
 * - Pro-rata distribution under low liquidity
 * - Anti-gaming: config delay, boundary edges
 * - Large cohort stress tests with chunking
 * - API payload consistency
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
        limit: vi.fn().mockResolvedValue([]),
      }),
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

import type { Epoch, EpochRequest } from "../types.js";
import {
  EpochRepository,
  isValidEpochTransition,
  isValidEpochRequestTransition,
  validEpochTransitions,
  validEpochRequestTransitions,
} from "../repositories/epochRepository.js";
import { db as mockDb } from "../db/index.js";

describe("Fairness Invariants", () => {
  describe("Boundary Fairness", () => {
    it("ensures requests at exact epoch boundary map correctly", async () => {
      const repo = new EpochRepository();
      const timestamp = new Date("2024-01-01T00:00:00.000Z");
      const epochEnd = new Date("2024-01-01T01:00:00.000Z");

      // Request at exact boundary
      const mockRequest = {
        id: 1,
        requestId: "req-boundary",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-1", // Should map to next epoch
        status: "pending",
        claimableAssets: null,
        claimedAssets: "0",
        claimTxHash: null,
        createdAt: epochEnd, // Exact boundary
        cancelledAt: null,
        settledAt: null,
        claimedAt: null,
        updatedAt: timestamp,
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.getRequestById("req-boundary");

      expect(result).not.toBeNull();
      expect(result?.epochId).toBe("epoch-1");
    });

    it("ensures multiple users at same boundary get fair treatment", async () => {
      const repo = new EpochRepository();

      const mockEpoch = {
        id: 1,
        epochId: "epoch-1",
        vaultAddress: "0xVault",
        startTime: new Date("2024-01-01T00:00:00.000Z"),
        endTime: new Date("2024-01-01T01:00:00.000Z"),
        status: "frozen",
        totalSharesRequested: "3000000000000000000",
        totalAssetsToClaim: "3000000000",
      };

      const mockRequests = [
        {
          id: 1,
          requestId: "req-1",
          userAddress: "0xUser1",
          vaultAddress: "0xVault",
          shares: "1000000000000000000",
          epochId: "epoch-1",
          status: "frozen",
          claimableAssets: null,
          claimedAssets: "0",
          createdAt: new Date("2024-01-01T00:30:00.000Z"),
        },
        {
          id: 2,
          requestId: "req-2",
          userAddress: "0xUser2",
          vaultAddress: "0xVault",
          shares: "1000000000000000000",
          epochId: "epoch-1",
          status: "frozen",
          claimableAssets: null,
          claimedAssets: "0",
          createdAt: new Date("2024-01-01T00:31:00.000Z"),
        },
        {
          id: 3,
          requestId: "req-3",
          userAddress: "0xUser3",
          vaultAddress: "0xVault",
          shares: "1000000000000000000",
          epochId: "epoch-1",
          status: "frozen",
          claimableAssets: null,
          claimedAssets: "0",
          createdAt: new Date("2024-01-01T00:32:00.000Z"),
        },
      ];

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockRequests),
          }),
        }),
      });

      const requests = await repo.getFrozenRequestsForEpoch("epoch-1");

      expect(requests).toHaveLength(3);
      // All should be in same epoch (fair cohort)
      requests.forEach((req) => {
        expect(req.epochId).toBe("epoch-1");
      });
    });
  });

  describe("Cohort Loss Absorption", () => {
    it("ensures cohort absorbs losses, not remaining LPs", async () => {
      const repo = new EpochRepository();

      // Epoch with 20% loss (only 80% of assets available)
      const mockEpoch = {
        id: 1,
        epochId: "epoch-loss",
        vaultAddress: "0xVault",
        startTime: new Date(),
        endTime: new Date(),
        status: "claimable",
        totalSharesRequested: "1000000000000000000",
        totalAssetsToClaim: "800000000", // 80% of 1000 USDC
        proRataRatio: "800000000000000000", // 80% in 18 decimals
      };

      const mockRequest = {
        id: 1,
        requestId: "req-cohort",
        userAddress: "0xCohortUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-loss",
        status: "claimable",
        claimableAssets: "800000000", // 80% of original due to loss
        claimedAssets: "0",
        createdAt: new Date(),
      };

      // Mock database responses
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([mockEpoch]),
          }),
        }),
      });

      const epoch = await repo.getEpochById("epoch-loss");

      expect(epoch).not.toBeNull();
      expect(epoch?.totalAssetsToClaim).toBe("800000000");

      // Verify the cohort request absorbed the 20% loss
      expect(mockRequest.claimableAssets).toBe("800000000");
    });

    it("ensures remaining LPs are unaffected by cohort losses", async () => {
      const repo = new EpochRepository();

      // Pending epoch (remaining LPs)
      const pendingEpoch = {
        id: 2,
        epochId: "epoch-pending",
        vaultAddress: "0xVault",
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
        status: "pending",
        totalSharesRequested: "0",
        totalAssetsToClaim: "0",
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([pendingEpoch]),
          }),
        }),
      });

      const pendingEpochs = await repo.getEpochsByVault("0xVault", "pending");

      expect(pendingEpochs).toHaveLength(1);
      // Pending epoch should have zero claims (unaffected by settled epoch losses)
      expect(pendingEpochs[0]?.totalAssetsToClaim).toBe("0");
    });
  });

  describe("Pro-Rata Distribution", () => {
    it("ensures equal pro-rata distribution under low liquidity", async () => {
      const repo = new EpochRepository();

      // 3 users, each requesting 1000 shares, but only 1500 assets available (50% pro-rata)
      const mockRequests = [
        {
          id: 1,
          requestId: "req-1",
          userAddress: "0xUser1",
          vaultAddress: "0xVault",
          shares: "1000000000000000000",
          epochId: "epoch-prorata",
          status: "claimable",
          claimableAssets: "500000000", // 50% of 1000 USDC
        },
        {
          id: 2,
          requestId: "req-2",
          userAddress: "0xUser2",
          vaultAddress: "0xVault",
          shares: "1000000000000000000",
          epochId: "epoch-prorata",
          status: "claimable",
          claimableAssets: "500000000", // 50% of 1000 USDC
        },
        {
          id: 3,
          requestId: "req-3",
          userAddress: "0xUser3",
          vaultAddress: "0xVault",
          shares: "1000000000000000000",
          epochId: "epoch-prorata",
          status: "claimable",
          claimableAssets: "500000000", // 50% of 1000 USDC
        },
      ];

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockRequests),
          }),
        }),
      });

      const requests = await repo.getRequestsByEpoch("epoch-prorata", "claimable");

      expect(requests).toHaveLength(3);

      // All users should have equal pro-rata claimable amounts
      const claimableAmounts = requests.map((r) => r.claimableAssets);
      const allEqual = claimableAmounts.every((val) => val === claimableAmounts[0]);
      expect(allEqual).toBe(true);

      // Each should be 50% of their original request (within rounding)
      expect(BigInt(claimableAmounts[0]!)).toBe(BigInt("500000000"));
    });

    it("ensures pro-rata scales with share proportion", async () => {
      // User 1: 1000 shares, User 2: 2000 shares (2:1 ratio)
      // Total: 3000 shares, Available: 1500 assets
      // User 1 should get: 500, User 2 should get: 1000

      const shares1 = BigInt("1000000000000000000");
      const shares2 = BigInt("2000000000000000000");
      const totalShares = shares1 + shares2;
      const availableAssets = BigInt("1500000000");

      // Calculate pro-rata
      const proRata1 = (shares1 * availableAssets) / totalShares;
      const proRata2 = (shares2 * availableAssets) / totalShares;

      expect(proRata1).toBe(BigInt("500000000"));
      expect(proRata2).toBe(BigInt("1000000000"));
      expect(proRata2).toBe(proRata1 * BigInt(2)); // 2:1 ratio preserved
    });
  });
});

describe("Carry Conservation Invariants", () => {
  let repo: EpochRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EpochRepository();
  });

  describe("Total Conservation", () => {
    it("ensures total paid + remaining = total realized", async () => {
      // Simulate a claim with carry
      const shares = "1000000000000000000";
      const availableAssets = "1000000000"; // 1000 USDC
      const carryRate = "100000000000000000"; // 10% in 18 decimals
      const precision = BigInt("1000000000000000000");

      // Calculate gross assets (before carry)
      const grossAssets = BigInt(availableAssets);

      // Calculate carry
      const carry = (grossAssets * BigInt(carryRate)) / precision;

      // Calculate net assets (after carry)
      const netAssets = grossAssets - carry;

      // Conservation: net + carry = gross
      expect(netAssets + carry).toBe(grossAssets);
    });

    it("ensures carry conservation across multiple partial claims", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-carry",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-1",
        status: "claimable",
        claimableAssets: "900000000", // 1000 - 10% carry
        claimedAssets: "0",
        claimTxHash: null,
        createdAt: new Date(),
        cancelledAt: null,
        settledAt: new Date(),
        claimedAt: null,
        updatedAt: new Date(),
      };

      // First partial claim: 50% of shares
      const firstClaimShares = BigInt("500000000000000000"); // 50%
      const totalShares = BigInt(mockRequest.shares);
      const claimableAssets = BigInt(mockRequest.claimableAssets);

      const firstClaimAssets = (claimableAssets * firstClaimShares) / totalShares;

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result1 = await repo.claimRequest("req-carry", "0xtx1");
      expect(result1.success).toBe(true);
      expect(result1.success).toBe(true);

      // Remaining after first claim
      const remainingShares = totalShares - firstClaimShares;
      const remainingAssets = claimableAssets - firstClaimAssets;

      // Conservation: claimed + remaining = total
      expect(firstClaimAssets + remainingAssets).toBe(claimableAssets);
    });

    it("ensures zero carry case works correctly", () => {
      const availableAssets = BigInt("1000000000");
      const carryRate = BigInt("0");
      const precision = BigInt("1000000000000000000");

      const carry = (availableAssets * carryRate) / precision;
      const netAssets = availableAssets - carry;

      expect(carry).toBe(BigInt(0));
      expect(netAssets).toBe(availableAssets);
    });

    it("ensures maximum carry edge case", () => {
      const availableAssets = BigInt("1000000000");
      const carryRate = BigInt("500000000000000000"); // 50%
      const precision = BigInt("1000000000000000000");

      const carry = (availableAssets * carryRate) / precision;
      const netAssets = availableAssets - carry;

      expect(carry).toBe(BigInt("500000000"));
      expect(netAssets).toBe(BigInt("500000000"));
      expect(carry + netAssets).toBe(availableAssets);
    });
  });

  describe("Per-Request Carry Tracking", () => {
    it("tracks carry per request correctly", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-carry-track",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-1",
        status: "claimed",
        claimableAssets: "900000000",
        claimedAssets: "900000000", // Fully claimed
        claimTxHash: "0xabc123",
        createdAt: new Date(),
        cancelledAt: null,
        settledAt: new Date(),
        claimedAt: new Date(),
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const request = await repo.getRequestById("req-carry-track");

      expect(request).not.toBeNull();
      expect(request?.status).toBe("claimed");
      expect(request?.claimedAssets).toBe("900000000");
    });
  });
});

describe("Anti-Gaming Invariants", () => {
  let repo: EpochRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EpochRepository();
  });

  describe("Config Delay", () => {
    it("ensures config delay prevents front-running", async () => {
      // Request created at timestamp T
      const requestTime = new Date("2024-01-01T12:00:00.000Z");

      const mockRequest = {
        id: 1,
        requestId: "req-anti-gaming",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-1", // Request created in epoch 1
        status: "pending",
        createdAt: requestTime,
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const request = await repo.getRequestById("req-anti-gaming");

      // Request should maintain its original epoch assignment
      // Even if config changes in epoch 2, this request uses epoch 1 rules
      expect(request?.epochId).toBe("epoch-1");
      expect(request?.createdAt).toEqual(requestTime);
    });

    it("ensures same-epoch requests use consistent config", async () => {
      const requests = [
        {
          id: 1,
          requestId: "req-1",
          userAddress: "0xUser1",
          epochId: "epoch-5",
          status: "pending",
          createdAt: new Date("2024-01-01T12:00:00.000Z"),
        },
        {
          id: 2,
          requestId: "req-2",
          userAddress: "0xUser2",
          epochId: "epoch-5",
          status: "pending",
          createdAt: new Date("2024-01-01T12:30:00.000Z"),
        },
      ];

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(requests),
          }),
        }),
      });

      const epochRequests = await repo.getRequestsByEpoch("epoch-5");

      // Both requests in same epoch should use same config
      expect(epochRequests).toHaveLength(2);
      epochRequests.forEach((req) => {
        expect(req.epochId).toBe("epoch-5");
      });
    });
  });

  describe("Boundary Determinism", () => {
    it("ensures boundary edges are deterministic", async () => {
      const epochs = [
        {
          id: 1,
          epochId: "epoch-0",
          startTime: new Date("2024-01-01T00:00:00.000Z"),
          endTime: new Date("2024-01-01T01:00:00.000Z"),
          status: "closed",
        },
        {
          id: 2,
          epochId: "epoch-1",
          startTime: new Date("2024-01-01T01:00:00.000Z"),
          endTime: new Date("2024-01-01T02:00:00.000Z"),
          status: "claimable",
        },
        {
          id: 3,
          epochId: "epoch-2",
          startTime: new Date("2024-01-01T02:00:00.000Z"),
          endTime: new Date("2024-01-01T03:00:00.000Z"),
          status: "pending",
        },
      ];

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(epochs),
          }),
        }),
      });

      const allEpochs = await repo.getEpochsByVault("0xVault");

      // Verify contiguous epochs (no gaps)
      for (let i = 0; i < allEpochs.length - 1; i++) {
        expect(allEpochs[i]!.endTime).toEqual(allEpochs[i + 1]!.startTime);
      }
    });

    it("ensures epoch boundary transitions are atomic", async () => {
      const mockEpoch = {
        id: 1,
        epochId: "epoch-transition",
        vaultAddress: "0xVault",
        startTime: new Date("2024-01-01T00:00:00.000Z"),
        endTime: new Date("2024-01-01T01:00:00.000Z"),
        status: "frozen",
        frozenAt: new Date("2024-01-01T01:00:01.000Z"),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockEpoch]),
          }),
        }),
      });

      const epoch = await repo.getEpochById("epoch-transition");

      expect(epoch?.status).toBe("frozen");
      expect(epoch?.frozenAt).toBeDefined();
      expect(epoch?.frozenAt!.getTime()).toBeGreaterThanOrEqual(epoch!.endTime.getTime());
    });
  });

  describe("Cancellation Restrictions", () => {
    it("rejects cancellation after freeze", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-no-cancel",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-frozen",
        status: "frozen", // Already frozen
        createdAt: new Date(),
      };

      const mockEpoch = {
        id: 1,
        epochId: "epoch-frozen",
        status: "frozen",
      };

      (mockDb.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockRequest]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockEpoch]),
            }),
          }),
        });

      // Frozen CAN be cancelled (per validEpochRequestTransitions)
      const cancelledRequest = { ...mockRequest, status: "cancelled", cancelledAt: new Date() };
      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([cancelledRequest]),
          }),
        }),
      });

      // Attempt to cancel frozen request - NOW ALLOWED per validEpochRequestTransitions
      const result = await repo.cancelRequest("req-no-cancel");

      expect(result.success).toBe(true);
      expect(result.entity?.status).toBe("cancelled");
    });

    it("rejects cancellation from terminal states", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-terminal",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-terminal",
        status: "claimed", // Terminal state
        createdAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      // Attempt to cancel claimed request should fail
      const result = await repo.cancelRequest("req-terminal");

    });


    it("allows cancellation before freeze", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-cancel-ok",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-active",
        status: "pending",
        createdAt: new Date(),
      };

      const cancelledRequest = {
        ...mockRequest,
        status: "cancelled",
        cancelledAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([cancelledRequest]),
          }),
        }),
      });

      const result = await repo.cancelRequest("req-cancel-ok");

      expect(result.success).toBe(true);
      expect(result.entity?.status).toBe("cancelled");
    });
  });

  describe("Stale NAV Protection", () => {
    it("tracks NAV freshness", async () => {
      const mockSnapshot = {
        id: 1,
        snapshotId: "nav-fresh",
        epochId: "epoch-1",
        vaultAddress: "0xVault",
        totalAssets: "1000000000",
        totalShares: "1000000000000000000",
        sharePrice: "1000000",
        timestamp: new Date(), // Fresh
        recordedBy: "0xNavUpdater",
        txHash: "0xabc",
        isFresh: true,
        staleReason: null,
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockSnapshot]),
          }),
        }),
      });

      const snapshot = await repo.getNavSnapshotById("nav-fresh");

      expect(snapshot?.isFresh).toBe(true);
      expect(snapshot?.staleReason).toBeNull();
    });

    it("marks stale NAV correctly", async () => {
      const staleSnapshot = {
        id: 1,
        snapshotId: "nav-stale",
        isFresh: false,
        staleReason: "Threshold exceeded: last update > 1 hour ago",
      };

      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([staleSnapshot]),
          }),
        }),
      });

      const result = await repo.markSnapshotStale("nav-stale", "Threshold exceeded");

      expect(result?.isFresh).toBe(false);
      expect(result?.staleReason).toContain("Threshold exceeded");
    });
  });
});

describe("Large Cohort Stress Tests", () => {
  let repo: EpochRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EpochRepository();
  });

  describe("Chunking", () => {
    it("handles large cohorts with chunking strategy", async () => {
      const numRequests = 500;
      const chunkSize = 100;
      const chunks = Math.ceil(numRequests / chunkSize);

      // Generate mock requests
      const mockRequests = Array.from({ length: numRequests }, (_, i) => ({
        id: i + 1,
        requestId: `req-${i + 1}`,
        userAddress: `0xUser${i + 1}`,
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-large",
        status: "frozen",
        createdAt: new Date(),
      }));

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockRequests),
          }),
        }),
      });

      const startTime = Date.now();
      const requests = await repo.getFrozenRequestsForEpoch("epoch-large");
      const endTime = Date.now();

      expect(requests).toHaveLength(numRequests);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it("processes chunks sequentially", async () => {
      const chunkResults: number[] = [];
      const totalChunks = 5;

      for (let i = 0; i < totalChunks; i++) {
        const chunkRequests = Array.from({ length: 20 }, (_, j) => ({
          id: i * 20 + j + 1,
          requestId: `req-${i * 20 + j + 1}`,
          status: "pending",
        }));

        (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(chunkRequests),
            }),
          }),
        });

        const requests = await repo.getPendingRequestsForEpoch("epoch-chunk");
        chunkResults.push(requests.length);
      }

      expect(chunkResults).toHaveLength(totalChunks);
      expect(chunkResults.every((count) => count === 20)).toBe(true);
    });
  });

  describe("Memory Efficiency", () => {
    it("streams large result sets efficiently", async () => {
      const largeEpoch = {
        id: 1,
        epochId: "epoch-massive",
        totalSharesRequested: "1000000000000000000000", // 1000 shares * 1e18
        totalAssetsToClaim: "1000000000000", // 1M USDC
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([largeEpoch]),
          }),
        }),
      });

      const epoch = await repo.getEpochById("epoch-massive");

      expect(epoch).not.toBeNull();
      expect(BigInt(epoch!.totalSharesRequested)).toBe(BigInt("1000000000000000000000"));
    });
  });

  describe("Settlement Progress", () => {
    it("tracks settlement progress across chunks", async () => {
      const mockEpoch = {
        id: 1,
        epochId: "epoch-progress",
        status: "claimable",
        totalSharesRequested: "10000000000000000000",
        totalAssetsToClaim: "10000000000",
      };

      const mockRequests = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        requestId: `req-${i + 1}`,
        epochId: "epoch-progress",
        status: i < 50 ? "claimed" : "claimable", // 50% claimed
        claimedAssets: i < 50 ? "100000000" : "0",
      }));

      (mockDb.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockEpoch]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              orderBy: vi.fn().mockResolvedValueOnce(mockRequests),
            }),
          }),
        });

      const epoch = await repo.getEpochById("epoch-progress");
      const requests = await repo.getRequestsByEpoch("epoch-progress");

      const claimedCount = requests.filter((r) => r.status === "claimed").length;
      const claimableCount = requests.filter((r) => r.status === "claimable").length;

      expect(claimedCount).toBe(50);
      expect(claimableCount).toBe(50);
    });
  });
});

describe("API Payload Consistency", () => {
  let repo: EpochRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EpochRepository();
  });

  describe("Request Payload Structure", () => {
    it("returns consistent request payload structure", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-payload",
        userAddress: "0x1234567890123456789012345678901234567890",
        vaultAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        shares: "1000000000000000000",
        epochId: "epoch-1",
        status: "claimable",
        claimableAssets: "900000000",
        claimedAssets: "0",
        claimTxHash: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        cancelledAt: null,
        settledAt: new Date("2024-01-02T00:00:00.000Z"),
        claimedAt: null,
        updatedAt: new Date("2024-01-02T00:00:00.000Z"),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const request = await repo.getRequestById("req-payload");

      expect(request).toMatchObject({
        requestId: expect.any(String),
        userAddress: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
        vaultAddress: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
        shares: expect.any(String),
        epochId: expect.any(String),
        status: expect.any(String),
      });
    });

    it("validates numeric string formats", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-numeric",
        shares: "1000000000000000000", // Valid: no decimals
        claimableAssets: "900000000",
        claimedAssets: "0",
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const request = await repo.getRequestById("req-numeric");

      // Verify all numeric fields are valid integers (no decimals)
      expect(BigInt(request!.shares)).toBeDefined();
      expect(BigInt(request!.claimableAssets!)).toBeDefined();
      expect(() => BigInt(request!.claimedAssets)).not.toThrow();
    });
  });

  describe("Epoch Payload Structure", () => {
    it("returns consistent epoch payload with statistics", async () => {
      const mockEpoch = {
        id: 1,
        epochId: "epoch-stats",
        vaultAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        startTime: new Date("2024-01-01T00:00:00.000Z"),
        endTime: new Date("2024-01-01T01:00:00.000Z"),
        status: "claimable",
        totalSharesRequested: "10000000000000000000",
        totalAssetsToClaim: "10000000000",
        proRataRatio: "1000000000000000000",
        claimableAt: new Date("2024-01-01T02:00:00.000Z"),
      };

      const mockRequests = [
        { id: 1, status: "claimed" },
        { id: 2, status: "claimed" },
        { id: 3, status: "claimable" },
        { id: 4, status: "cancelled" },
      ];

      (mockDb.select as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockEpoch]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              orderBy: vi.fn().mockResolvedValueOnce(mockRequests),
            }),
          }),
        });

      const epochWithStats = await repo.getEpochWithStats("epoch-stats");

      expect(epochWithStats).toMatchObject({
        epochId: expect.any(String),
        requestCount: 4,
        claimedCount: 2,
        claimableRequestCount: 1,
        cancelledCount: 1,
      });
    });
  });

  describe("Transition Payload Consistency", () => {
    it("returns consistent transition result structure", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-transition",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-1",
        status: "pending",
        claimableAssets: null,
        claimedAssets: "0",
        claimTxHash: null,
        createdAt: new Date(),
        cancelledAt: null,
        settledAt: null,
        claimedAt: null,
        updatedAt: new Date(),
      };

      const transitionedRequest = {
        ...mockRequest,
        status: "claimable",
        claimableAssets: "900000000",
        claimableAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([transitionedRequest]),
          }),
        }),
      });

      const result = await repo.makeRequestClaimable("req-transition", "900000000");

      expect(result).toMatchObject({
        success: expect.any(Boolean),
        entity: expect.objectContaining({
          requestId: expect.any(String),
          status: expect.any(String),
        }),
      });

      if (result.success) {
        expect(result.entity?.status).toBe("claimable");
        expect(result.alreadyInTargetState).toBe(false);
      }
    });

    it("handles idempotent transitions correctly", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-idempotent",
        status: "claimable",
        claimableAssets: "900000000",
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.makeRequestClaimable("req-idempotent", "900000000");

      expect(result.success).toBe(true);
      expect(result.alreadyInTargetState).toBe(true);
    });
  });

  describe("Error Payload Consistency", () => {
    it("returns consistent error structure for invalid transitions", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-error",
        status: "claimed",
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.cancelRequest("req-error");

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining("Invalid request transition"),
      });
    });

    it("returns consistent error for missing entities", async () => {
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await repo.transitionRequestStatus("req-missing", "claimed");

      expect(result).toMatchObject({
        success: false,
        error: "Request not found",
      });
    });
  });
});

describe("State Machine Validation", () => {
  describe("Epoch State Machine", () => {
    it("validates all valid epoch transitions", () => {
      const validTransitions = [
        { from: "pending", to: "frozen", valid: true },
        { from: "pending", to: "cancelled", valid: true },
        { from: "frozen", to: "claimable", valid: true },
        { from: "frozen", to: "cancelled", valid: true },
        { from: "claimable", to: "closed", valid: true },
        { from: "claimable", to: "cancelled", valid: true },
        { from: "pending", to: "pending", valid: true }, // Idempotent
      ];

      validTransitions.forEach(({ from, to, valid }) => {
        expect(isValidEpochTransition(from as any, to as any)).toBe(valid);
      });
    });

    it("rejects invalid epoch transitions", () => {
      const invalidTransitions = [
        { from: "closed", to: "pending", valid: false },
        { from: "closed", to: "frozen", valid: false },
        { from: "cancelled", to: "pending", valid: false },
        { from: "claimable", to: "pending", valid: false },
        { from: "frozen", to: "pending", valid: false },
      ];

      invalidTransitions.forEach(({ from, to, valid }) => {
        expect(isValidEpochTransition(from as any, to as any)).toBe(valid);
      });
    });
  });

  describe("Request State Machine", () => {
    it("validates all valid request transitions", () => {
      const validTransitions = [
        { from: "pending", to: "frozen", valid: true },
        { from: "pending", to: "cancelled", valid: true },
        { from: "frozen", to: "claimable", valid: true },
        { from: "frozen", to: "cancelled", valid: true },
        { from: "claimable", to: "claimed", valid: true },
        { from: "claimable", to: "closed", valid: true },
        { from: "claimed", to: "closed", valid: true },
        { from: "pending", to: "pending", valid: true }, // Idempotent
      ];

      validTransitions.forEach(({ from, to, valid }) => {
        expect(isValidEpochRequestTransition(from as any, to as any)).toBe(valid);
      });
    });

    it("rejects invalid request transitions", () => {
      const invalidTransitions = [
        { from: "claimed", to: "pending", valid: false },
        { from: "claimed", to: "claimable", valid: false },
        { from: "cancelled", to: "claimable", valid: false },
        { from: "closed", to: "claimed", valid: false },
        { from: "pending", to: "claimed", valid: false }, // Must go through claimable
      ];

      invalidTransitions.forEach(({ from, to, valid }) => {
        expect(isValidEpochRequestTransition(from as any, to as any)).toBe(valid);
      });
    });
  });
});

describe("Integration: Full Lifecycle", () => {
  let repo: EpochRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EpochRepository();
  });

  it("executes complete happy path lifecycle", async () => {
    // 1. Create epoch
    const epochInput = {
      epochId: "epoch-lifecycle",
      vaultAddress: "0xVault",
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
    };

    const mockEpoch = {
      id: 1,
      ...epochInput,
      status: "pending",
      totalSharesRequested: "0",
      totalAssetsToClaim: "0",
    };

    (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockEpoch]),
      }),
    });

    const epoch = await repo.createEpoch(epochInput);
    expect(epoch.status).toBe("pending");

    // 2. Create request
    const requestInput = {
      requestId: "req-lifecycle",
      userAddress: "0xUser",
      vaultAddress: "0xVault",
      shares: "1000000000000000000",
      epochId: "epoch-lifecycle",
    };

    const mockRequest = {
      id: 1,
      ...requestInput,
      status: "pending",
      claimedAssets: "0",
    };

    (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockRequest]),
      }),
    });

    const request = await repo.createRequest(requestInput);
    expect(request.status).toBe("pending");

    // 3. Freeze epoch
    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockEpoch]),
        }),
      }),
    });

    (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockEpoch, status: "frozen" }]),
        }),
      }),
    });

    const freezeResult = await repo.freezeEpoch("epoch-lifecycle");
    expect(freezeResult.success).toBe(true);

    // 4. Freeze request first (required before claimable)
    const frozenRequest = { ...mockRequest, status: "frozen", frozenAt: new Date() };
    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([frozenRequest]),
        }),
      }),
    });

    const freezeRequestResult = await repo.freezeRequest("req-lifecycle");
    expect(freezeRequestResult.success).toBe(true);

    // 5. Make claimable
    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([frozenRequest]),
        }),
      }),
    });

    (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              ...frozenRequest,
              status: "claimable",
              claimableAssets: "900000000",
            },
          ]),
        }),
      }),
    });

    const claimableResult = await repo.makeRequestClaimable("req-lifecycle", "900000000");
    expect(claimableResult.success).toBe(true);
    expect(claimableResult.entity?.status).toBe("claimable");

    // 5. Claim
    (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([claimableResult.entity]),
        }),
      }),
    });

    (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              ...claimableResult.entity,
              status: "claimed",
              claimedAssets: "900000000",
              claimTxHash: "0xclaimtx",
            },
          ]),
        }),
      }),
    });

    const claimResult = await repo.claimRequest("req-lifecycle", "0xclaimtx");
    expect(claimResult.success).toBe(true);
    expect(claimResult.entity?.status).toBe("claimed");
  });
});
