import { describe, it, expect, vi, beforeEach } from "vitest";
import { PositionRepository } from "../repositories/positionRepository.js";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({
  vaultPositions: {
    status: "status",
    vaultAddress: "vault_address",
    marketId: "market_id",
    openedAt: "opened_at",
    id: "id",
    costBasis: "cost_basis",
    resolvedAt: "resolved_at",
    resolvedPnl: "resolved_pnl",
  },
  vaultTrades: {},
  vaultAllocations: {},
  vaultTradingAnalytics: {
    vaultAddress: "vault_address",
    computedAt: "computed_at",
  },
}));

function createMockDb() {
  const chain: any = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
  };

  return {
    insert: vi.fn().mockReturnValue(chain),
    select: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

describe("PositionRepository", () => {
  let repo: PositionRepository;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    repo = new PositionRepository(mockDb as any);
  });

  describe("createPosition", () => {
    it("inserts a new position and returns it", async () => {
      const newPosition = {
        positionId: "pos-123",
        vaultAddress: "0xvault",
        marketId: "market-abc",
        conditionId: "cond-456",
        tokenId: "token-789",
        outcome: "YES" as const,
        costBasis: "5.000000",
        quantity: "5.263158",
      };

      const dbRow = { id: 1, ...newPosition, status: "open" };
      mockDb._chain.returning.mockResolvedValue([dbRow]);

      const result = await repo.createPosition(newPosition);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb._chain.values).toHaveBeenCalledWith(newPosition);
      expect(result).toEqual(dbRow);
    });
  });

  describe("getOpenPositions", () => {
    it("returns only open positions ordered by openedAt desc", async () => {
      const openPositions = [
        { id: 2, status: "open", costBasis: "10.000000" },
        { id: 1, status: "open", costBasis: "5.000000" },
      ];
      mockDb._chain.orderBy.mockResolvedValue(openPositions);

      const result = await repo.getOpenPositions();

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toEqual(openPositions);
    });

    it("returns empty array when no open positions exist", async () => {
      mockDb._chain.orderBy.mockResolvedValue([]);

      const result = await repo.getOpenPositions();
      expect(result).toEqual([]);
    });
  });

  describe("getPositionById", () => {
    it("returns position when found", async () => {
      const position = { id: 1, positionId: "pos-123", status: "open" };
      mockDb._chain.limit.mockResolvedValue([position]);

      const result = await repo.getPositionById(1);
      expect(result).toEqual(position);
    });

    it("returns null when position not found", async () => {
      mockDb._chain.limit.mockResolvedValue([]);

      const result = await repo.getPositionById(999);
      expect(result).toBeNull();
    });
  });

  describe("updatePositionStatus", () => {
    it("updates position to resolved_win with PnL", async () => {
      const updated = { id: 1, status: "resolved_win", resolvedPnl: "0.250000" };
      mockDb._chain.returning.mockResolvedValue([updated]);

      const result = await repo.updatePositionStatus(1, "resolved_win", "0.250000");

      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it("updates position to resolved_loss and returns null PnL when not provided", async () => {
      const updated = { id: 2, status: "resolved_loss", resolvedPnl: null };
      mockDb._chain.returning.mockResolvedValue([updated]);

      const result = await repo.updatePositionStatus(2, "resolved_loss");
      expect(result?.resolvedPnl).toBeNull();
    });

    it("returns null when position not found for update", async () => {
      mockDb._chain.returning.mockResolvedValue([]);

      const result = await repo.updatePositionStatus(999, "resolved_win");
      expect(result).toBeNull();
    });
  });

  describe("getTotalCostBasis", () => {
    it("aggregates cost basis of open positions", async () => {
      mockDb._chain.where.mockResolvedValue([{ total: "75.500000" }]);

      const result = await repo.getTotalCostBasis();
      expect(result).toBe(75.5);
    });

    it("returns 0 when no open positions", async () => {
      mockDb._chain.where.mockResolvedValue([{ total: "0" }]);

      const result = await repo.getTotalCostBasis();
      expect(result).toBe(0);
    });

    it("returns 0 when query returns null total", async () => {
      mockDb._chain.where.mockResolvedValue([{}]);

      const result = await repo.getTotalCostBasis();
      expect(result).toBe(0);
    });
  });

  describe("recordTrade", () => {
    it("inserts trade record and returns it", async () => {
      const trade = {
        tradeId: "trade-123",
        positionId: 1,
        orderId: "order-abc",
        side: "buy" as const,
        price: "0.950000",
        size: "5.263158",
        filledSize: "5.263158",
        status: "filled" as const,
      };

      const dbRow = { id: 1, ...trade };
      mockDb._chain.returning.mockResolvedValue([dbRow]);

      const result = await repo.recordTrade(trade);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(dbRow);
    });
  });

  describe("recordAllocation", () => {
    it("inserts allocation record and returns it", async () => {
      const allocation = {
        allocationId: "alloc-123",
        txHash: "0xabc",
        direction: "allocate" as const,
        amount: "50.000000",
      };

      const dbRow = { id: 1, ...allocation };
      mockDb._chain.returning.mockResolvedValue([dbRow]);

      const result = await repo.recordAllocation(allocation);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(dbRow);
    });
  });
});
