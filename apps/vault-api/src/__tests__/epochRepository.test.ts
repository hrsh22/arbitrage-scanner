/**
 * Epoch Repository State Transition Tests
 *
 * Tests for:
 * - Valid state transitions (pending -> cancelled, pending -> settled -> claimed)
 * - Invalid state transition rejections
 * - Idempotent operations
 * - Schema correctness
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module inline to avoid hoisting issues
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

import type { EpochRequest } from "../types.js";

import {
  EpochRepository,
  isValidEpochTransition,
  isValidEpochRequestTransition,
  validEpochTransitions,
  validEpochRequestTransitions,
} from "../repositories/epochRepository.js";

import { db as mockDb } from "../db/index.js";

describe("Epoch State Machine", () => {
  describe("Valid Transitions", () => {
    it("allows pending -> cancelled transition", () => {
      expect(isValidEpochRequestTransition("pending", "cancelled")).toBe(true);
    });

    it("allows pending -> settled transition", () => {
      expect(isValidEpochRequestTransition("pending", "claimable")).toBe(true);
    });

    it("allows settled -> claimed transition", () => {
      expect(isValidEpochRequestTransition("claimable", "claimed")).toBe(true);
    });

    it("allows same-state transitions (idempotent)", () => {
      expect(isValidEpochRequestTransition("pending", "pending")).toBe(true);
      expect(isValidEpochRequestTransition("claimable", "claimable")).toBe(true);
      expect(isValidEpochRequestTransition("claimed", "claimed")).toBe(true);
      expect(isValidEpochRequestTransition("cancelled", "cancelled")).toBe(true);
    });

    it("rejects cancelled -> any transition", () => {
      expect(isValidEpochRequestTransition("cancelled", "pending")).toBe(false);
      expect(isValidEpochRequestTransition("cancelled", "claimable")).toBe(false);
      expect(isValidEpochRequestTransition("cancelled", "claimed")).toBe(false);
    });

    it("rejects claimed -> any transition", () => {
      expect(isValidEpochRequestTransition("claimed", "pending")).toBe(false);
      expect(isValidEpochRequestTransition("claimed", "claimable")).toBe(false);
      expect(isValidEpochRequestTransition("claimed", "cancelled")).toBe(false);
    });

    it("rejects settled -> pending/cancelled transition", () => {
      expect(isValidEpochRequestTransition("claimable", "pending")).toBe(false);
      expect(isValidEpochRequestTransition("claimable", "cancelled")).toBe(false);
    });
  });

  describe("Epoch Status Transitions", () => {
    it("allows pending -> settling transition", () => {
      expect(isValidEpochTransition("pending", "settling")).toBe(true);
    });

    it("allows pending -> cancelled transition", () => {
      expect(isValidEpochTransition("pending", "cancelled")).toBe(true);
    });

    it("allows settling -> settled transition", () => {
      expect(isValidEpochTransition("settling", "claimable")).toBe(true);
    });

    it("allows settling -> cancelled transition", () => {
      expect(isValidEpochTransition("settling", "cancelled")).toBe(true);
    });

    it("rejects settled -> any transition", () => {
      expect(isValidEpochTransition("settled", "pending")).toBe(false);
      expect(isValidEpochTransition("settled", "settling")).toBe(false);
      expect(isValidEpochTransition("settled", "cancelled")).toBe(false);
    });

    it("rejects cancelled -> any transition", () => {
      expect(isValidEpochTransition("cancelled", "pending")).toBe(false);
      expect(isValidEpochTransition("cancelled", "settling")).toBe(false);
      expect(isValidEpochTransition("cancelled", "settled")).toBe(false);
    });
  });

  describe("Transition Maps", () => {
    it("has expected valid epoch request transitions", () => {
      expect(validEpochRequestTransitions.pending).toEqual(["cancelled", "claimable"]);
      expect(validEpochRequestTransitions.claimable).toEqual(["claimed"]);
      expect(validEpochRequestTransitions.cancelled).toEqual([]);
      expect(validEpochRequestTransitions.claimed).toEqual([]);
    });

    it("has expected valid epoch transitions", () => {
      expect(validEpochTransitions.pending).toEqual(["settling", "cancelled"]);
      expect(validEpochTransitions.settling).toEqual(["claimable", "cancelled"]);
      expect(validEpochTransitions.settled).toEqual([]);
      expect(validEpochTransitions.cancelled).toEqual([]);
    });
  });
});

describe("Epoch Repository Operations", () => {
  let repo: EpochRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EpochRepository();
  });

  describe("Epoch Creation", () => {
    it("creates epoch with correct default values", async () => {
      const mockEpoch = {
        id: 1,
        epochId: "epoch-123",
        vaultAddress: "0xVault",
        startTime: new Date(),
        endTime: new Date(),
        status: "pending",
        totalSharesRequested: "0",
        totalAssetsToClaim: "0",
      };

      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockEpoch]),
        }),
      });

      const result = await repo.createEpoch({
        epochId: "epoch-123",
        vaultAddress: "0xVault",
        startTime: new Date(),
        endTime: new Date(),
      });

      expect(result.status).toBe("pending");
      expect(result.totalSharesRequested).toBe("0");
      expect(result.totalAssetsToClaim).toBe("0");
    });
  });

  describe("Request Creation", () => {
    it("creates request with pending status", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
        status: "pending",
        claimedAssets: "0",
      };

      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockRequest]),
        }),
      });

      const result = await repo.createRequest({
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
      });

      expect(result.status).toBe("pending");
    });
  });

  describe("State Transitions", () => {
    it("successfully transitions pending -> cancelled", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
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

      // Mock getRequestById
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([mockRequest]),
          }),
        }),
      });

      const cancelledRequest = { ...mockRequest, status: "cancelled", cancelledAt: new Date() };
      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([cancelledRequest]),
          }),
        }),
      });

      const result = await repo.transitionRequestStatus("req-123", "cancelled", {
        cancelledAt: new Date(),
      });

      expect(result.success).toBe(true);
    });

    it("rejects invalid pending -> claimed transition", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
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

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.transitionRequestStatus("req-123", "claimed", {
        claimTxHash: "0x123",
        claimableAssets: "1000000",
        claimedAt: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid request transition");
      expect(result.error).toContain("'pending' → 'claimed'");
    });

    it("rejects cancelled -> settled transition", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
        status: "cancelled",
        claimableAssets: null,
        claimedAssets: "0",
        claimTxHash: null,
        createdAt: new Date(),
        cancelledAt: new Date(),
        settledAt: null,
        claimedAt: null,
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.transitionRequestStatus("req-123", "claimable", {
        claimableAssets: "1000000",
        settledAt: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid request transition");
    });

    it("handles idempotent transitions (same state)", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
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

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.transitionRequestStatus("req-123", "pending");

      expect(result.success).toBe(true);
      expect(result.alreadyInTargetState).toBe(true);
    });
  });

  describe("Cancel Operation", () => {
    it("successfully cancels pending request", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
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

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const cancelledRequest = { ...mockRequest, status: "cancelled", cancelledAt: new Date() };
      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([cancelledRequest]),
          }),
        }),
      });

      const result = await repo.cancelRequest("req-123");

      expect(result.success).toBe(true);
      expect(result.entity?.status).toBe("cancelled");
    });

    it("fails to cancel already settled request", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
        status: "claimable",
        claimableAssets: "1000000",
        claimedAssets: "0",
        claimTxHash: null,
        createdAt: new Date(),
        cancelledAt: null,
        settledAt: new Date(),
        claimedAt: null,
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.cancelRequest("req-123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid request transition");
    });

    it("fails to cancel already claimed request", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
        status: "claimed",
        claimableAssets: "1000000",
        claimedAssets: "1000000",
        claimTxHash: "0x123",
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

      const result = await repo.cancelRequest("req-123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid request transition");
    });
  });

  describe("Settle Operation", () => {
    it("successfully settles pending request", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
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

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const settledRequest = {
        ...mockRequest,
        status: "claimable",
        claimableAssets: "950000",
        settledAt: new Date(),
      };
      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([settledRequest]),
          }),
        }),
      });

      const result = await repo.settleRequest("req-123", "950000");

      expect(result.success).toBe(true);
      expect(result.entity?.status).toBe("claimable");
      expect((result.entity as EpochRequest | undefined)?.claimableAssets).toBe("950000");
      expect(result.entity?.status).toBe("claimable");
      expect((result.entity as EpochRequest | undefined)?.claimableAssets).toBe("950000");
    });
  });

  describe("Claim Operation", () => {
    it("successfully claims settled request", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
        status: "claimable",
        claimableAssets: "950000",
        claimedAssets: "0",
        claimTxHash: null,
        createdAt: new Date(),
        cancelledAt: null,
        settledAt: new Date(),
        claimedAt: null,
        updatedAt: new Date(),
      };

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const claimedRequest = {
        ...mockRequest,
        status: "claimed",
        claimedAssets: "950000",
        claimTxHash: "0xabc123",
        claimedAt: new Date(),
      };
      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([claimedRequest]),
          }),
        }),
      });

      const result = await repo.claimRequest("req-123", "0xabc123");

expect(result.success).toBe(true);
expect(result.entity?.status).toBe("claimed");
      expect((result.entity as EpochRequest | undefined)?.claimTxHash).toBe("0xabc123");
      expect((result.entity as EpochRequest | undefined)?.claimedAssets).toBe("950000");
});

    it("fails to claim pending request", async () => {
      const mockRequest = {
        id: 1,
        requestId: "req-123",
        userAddress: "0xUser",
        vaultAddress: "0xVault",
        shares: "1000000000000000000",
        epochId: "epoch-123",
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

      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockRequest]),
          }),
        }),
      });

      const result = await repo.claimRequest("req-123", "0xabc123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid request transition");
    });
  });

  describe("NAV Snapshot", () => {
    it("creates NAV snapshot with fresh status", async () => {
      const mockSnapshot = {
        id: 1,
        snapshotId: "nav-123",
        epochId: "epoch-123",
        vaultAddress: "0xVault",
        totalAssets: "1000000000",
        totalShares: "1000000000000000000000",
        sharePrice: "1000000",
        timestamp: new Date(),
        recordedBy: "0xRecorder",
        txHash: "0x123",
        isFresh: true,
        staleReason: null,
        createdAt: new Date(),
      };

      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockSnapshot]),
        }),
      });

      const result = await repo.createNavSnapshot({
        snapshotId: "nav-123",
        epochId: "epoch-123",
        vaultAddress: "0xVault",
        totalAssets: "1000000000",
        totalShares: "1000000000000000000000",
        sharePrice: "1000000",
        timestamp: new Date(),
        recordedBy: "0xRecorder",
        txHash: "0x123",
      });

      expect(result.isFresh).toBe(true);
      expect(result.snapshotId).toBe("nav-123");
    });
  });
});

describe("Schema Correctness", () => {
  it("exports valid transition maps", () => {
    // Ensure all required statuses are present
    expect(Object.keys(validEpochRequestTransitions)).toContain("pending");
    expect(Object.keys(validEpochRequestTransitions)).toContain("cancelled");
    expect(Object.keys(validEpochRequestTransitions)).toContain("claimable");
    expect(Object.keys(validEpochRequestTransitions)).toContain("claimed");

    expect(Object.keys(validEpochTransitions)).toContain("pending");
    expect(Object.keys(validEpochTransitions)).toContain("settling");
    expect(Object.keys(validEpochTransitions)).toContain("claimable");
    expect(Object.keys(validEpochTransitions)).toContain("cancelled");
  });

  it("validates transition helpers work correctly", () => {
    // Test valid transitions
    expect(isValidEpochRequestTransition("pending", "cancelled")).toBe(true);
    expect(isValidEpochRequestTransition("pending", "claimable")).toBe(true);
    expect(isValidEpochRequestTransition("claimable", "claimed")).toBe(true);

    // Test invalid transitions
    expect(isValidEpochRequestTransition("pending", "claimed")).toBe(false);
    expect(isValidEpochRequestTransition("cancelled", "claimable")).toBe(false);
    expect(isValidEpochRequestTransition("claimed", "pending")).toBe(false);
  });
});
