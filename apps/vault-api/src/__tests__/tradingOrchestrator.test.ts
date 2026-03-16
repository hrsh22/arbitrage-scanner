import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: "0" }]),
      }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  vaultPositions: { resolvedPnl: "resolved_pnl", resolvedAt: "resolved_at", status: "status" },
}));

vi.mock("../env.js", () => ({
  env: {
    VAULT_MODE: "simulation",
    VAULT_ADDRESS: "0xVault",
    VAULT_PRIVATE_KEY: "0x0000000000000000000000000000000000000000000000000000000000000001",
    POLYGON_RPC_URL: "https://polygon-rpc.com",
    SAFE_ADDRESS: "0xSafe",
  },
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGetOpenPositions = vi.fn().mockResolvedValue([]);
const mockCreatePosition = vi.fn();
const mockRecordTrade = vi.fn();

vi.mock("../repositories/positionRepository.js", () => ({
  positionRepository: {
    getOpenPositions: (...args: any[]) => mockGetOpenPositions(...args),
    createPosition: (...args: any[]) => mockCreatePosition(...args),
    recordTrade: (...args: any[]) => mockRecordTrade(...args),
  },
}));

const mockCalculateNav = vi.fn().mockReturnValue({
  totalAssets: 1000,
  idleAssets: 900,
  deployedCostBasis: 100,
  sharePrice: 0,
  positionCount: 0,
  lastUpdated: new Date(),
});

vi.mock("../services/navCalculator.js", () => ({
  navCalculator: {
    calculateNav: (...args: any[]) => mockCalculateNav(...args),
  },
}));

vi.mock("../services/safeWallet.js", () => ({
  SafeWalletService: vi.fn().mockImplementation(() => ({
    getBalance: vi.fn().mockResolvedValue(0n),
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockGetVaultProvider = vi.fn();

vi.mock("../services/vaultProviderFactory.js", () => ({
  getVaultProvider: (...args: unknown[]) => mockGetVaultProvider(...args),
}));

let mockGetAdapterInfo = vi.fn().mockResolvedValue({
  totalDeployed: 0n,
  totalPositionCostBasis: 0n,
});
let mockGetVaultTotalAssetsUsdc = vi.fn().mockResolvedValue(1000);

vi.mock("../services/tradingClient.js", () => ({
  getVaultTradingClient: () => ({
    isInitialized: vi.fn().mockReturnValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    createOrder: vi.fn().mockResolvedValue({ success: true, orderId: "order-123" }),
  }),
  VaultTradingClient: vi.fn(),
}));

import {
  TradingOrchestratorService,
  type OrchestratorTradeRequest,
} from "../services/tradingOrchestrator.js";

function makeTradeRequest(
  overrides: Partial<OrchestratorTradeRequest> = {},
): OrchestratorTradeRequest {
  return {
    marketId: "market-1",
    tokenId: "token-1",
    conditionId: "cond-1",
    side: "buy",
    price: 0.95,
    size: 5.26,
    outcome: "YES",
    ...overrides,
  };
}

describe("TradingOrchestratorService", () => {
  let orchestrator: TradingOrchestratorService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVaultProvider.mockReset();

    mockGetOpenPositions.mockResolvedValue([]);
    mockGetAdapterInfo.mockResolvedValue({
      totalDeployed: 0n,
      totalPositionCostBasis: 0n,
    });
    mockGetVaultTotalAssetsUsdc.mockResolvedValue(1000);
    mockCalculateNav.mockReturnValue({
      totalAssets: 1000,
      idleAssets: 900,
      deployedCostBasis: 100,
      sharePrice: 0,
      positionCount: 0,
      lastUpdated: new Date(),
    });

    const mockTradingClient = {
      isInitialized: () => true,
      initialize: vi.fn().mockResolvedValue(undefined),
      createOrder: vi.fn().mockResolvedValue({
        success: true,
        orderId: "order-123",
        avgPrice: 0.95,
        filledSize: 5.26,
      }),
    };

    const mockResolvedIdentity = {
      vaultId: 1,
      vaultName: "test-vault",
      allocatorNavSignerKey: "0x" + "a".repeat(64),
      safeOperatorKey: "0x" + "b".repeat(64),
      tradingSignerKey: "0x" + "c".repeat(64),
      tradingFunderAddress: "0x" + "1".repeat(40),
      tradingSignatureType: 2 as const,
      safeAddress: "0x" + "2".repeat(40),
      vaultAddress: "0x" + "3".repeat(40),
    };

    orchestrator = new TradingOrchestratorService(
      undefined,
      mockTradingClient as any,
      null,
      mockResolvedIdentity,
    );
  });

  describe("deployed ratio check", () => {
    it("blocks scan when deployed ratio is at limit", async () => {
      mockGetAdapterInfo.mockResolvedValue({
        totalDeployed: 250_000000n,
        totalPositionCostBasis: 250_000000n,
      });
      mockGetOpenPositions.mockResolvedValue([{ costBasis: "250.000000" }]);
      mockCalculateNav.mockReturnValue({
        totalAssets: 1000,
        idleAssets: 750,
        deployedCostBasis: 250,
        sharePrice: 0,
        positionCount: 1,
        lastUpdated: new Date(),
      });

      const fakeMarket = {
        id: "m1",
        question: "Will X?",
        conditionId: "cond-1",
        endDate: new Date(Date.now() + 3600 * 1000 * 5).toISOString(),
        tokens: [
          {
            token_id: "t1",
            outcome: "Yes",
            price: "0.96",
            bestAsk: "0.96",
            bestBid: "0.94",
            liquidity: "10000",
          },
          {
            token_id: "t2",
            outcome: "No",
            price: "0.04",
            bestAsk: "0.06",
            bestBid: "0.04",
            liquidity: "10000",
          },
        ],
      };

      const candidates = await orchestrator.scanAndEvaluate([fakeMarket]);

      expect(candidates).toEqual([]);
    });

    it("blocks trade execution when projected ratio exceeds limit", async () => {
      mockGetAdapterInfo.mockResolvedValue({
        totalDeployed: 24_000000n,
        totalPositionCostBasis: 24_000000n,
      });
      mockGetOpenPositions.mockResolvedValue([{ costBasis: "24.000000" }]);
      mockCalculateNav.mockReturnValue({
        totalAssets: 100,
        idleAssets: 76,
        deployedCostBasis: 24,
        sharePrice: 0,
        positionCount: 1,
        lastUpdated: new Date(),
      });

      const result = await orchestrator.executeTrade(makeTradeRequest({ price: 0.95, size: 5 }));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Projected deployed ratio");
    });
  });

  describe("simulation mode", () => {
    it("does not execute real trades in simulation mode", async () => {
      mockCalculateNav.mockReturnValue({
        totalAssets: 10000,
        idleAssets: 9900,
        deployedCostBasis: 100,
        sharePrice: 0,
        positionCount: 1,
        lastUpdated: new Date(),
      });

      const result = await orchestrator.executeTrade(makeTradeRequest({ price: 0.95, size: 2 }));

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.orderId).toBeUndefined();
    });
  });

  describe("circuit breaker", () => {
    it("blocks trading when max positions reached", async () => {
      const maxPositions = 20;
      const positions = Array.from({ length: maxPositions }, (_, i) => ({
        id: i + 1,
        status: "open",
        costBasis: "1.000000",
        quantity: "1.052632",
      }));
      mockGetOpenPositions.mockResolvedValue(positions);

      mockCalculateNav.mockReturnValue({
        totalAssets: 10000,
        idleAssets: 9980,
        deployedCostBasis: 20,
        sharePrice: 0,
        positionCount: maxPositions,
        lastUpdated: new Date(),
      });

      const result = await orchestrator.executeTrade(makeTradeRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain("Max positions reached");
    });
  });

  describe("trade validation", () => {
    it("rejects trade with zero cost", async () => {
      const result = await orchestrator.executeTrade(makeTradeRequest({ price: 0, size: 0 }));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Trade cost must be positive");
    });

    it("rejects trade exceeding max single trade size", async () => {
      const result = await orchestrator.executeTrade(makeTradeRequest({ price: 0.95, size: 100 }));

      expect(result.success).toBe(false);
      expect(result.error).toContain("exceeds bet size");
    });
  });

  describe("scanAndEvaluate", () => {
    it("evaluates markets and returns sorted candidates by PPH", async () => {
      mockCalculateNav.mockReturnValue({
        totalAssets: 10000,
        idleAssets: 9900,
        deployedCostBasis: 100,
        sharePrice: 0,
        positionCount: 1,
        lastUpdated: new Date(),
      });

      const markets = [
        {
          id: "m1",
          question: "Fast resolve?",
          conditionId: "cond-1",
          endDate: new Date(Date.now() + 3600 * 1000 * 2).toISOString(),
          tokens: [
            {
              token_id: "t1",
              outcome: "Yes",
              price: "0.96",
              bestAsk: "0.96",
              bestBid: "0.94",
              liquidity: "10000",
            },
            {
              token_id: "t2",
              outcome: "No",
              price: "0.04",
              bestAsk: "0.06",
              bestBid: "0.04",
              liquidity: "10000",
            },
          ],
        },
        {
          id: "m2",
          question: "Slow resolve?",
          conditionId: "cond-2",
          endDate: new Date(Date.now() + 3600 * 1000 * 20).toISOString(),
          tokens: [
            {
              token_id: "t3",
              outcome: "Yes",
              price: "0.96",
              bestAsk: "0.96",
              bestBid: "0.94",
              liquidity: "10000",
            },
            {
              token_id: "t4",
              outcome: "No",
              price: "0.04",
              bestAsk: "0.06",
              bestBid: "0.04",
              liquidity: "10000",
            },
          ],
        },
      ];

      const candidates = await orchestrator.scanAndEvaluate(markets);

      expect(candidates.length).toBeGreaterThanOrEqual(1);

      if (candidates.length > 1) {
        expect(candidates[0]!.pphScore).toBeGreaterThanOrEqual(candidates[1]!.pphScore);
      }
    });

    it("skips markets without end date", async () => {
      mockCalculateNav.mockReturnValue({
        totalAssets: 10000,
        idleAssets: 9900,
        deployedCostBasis: 100,
        sharePrice: 0,
        positionCount: 1,
        lastUpdated: new Date(),
      });

      const markets = [
        {
          id: "m1",
          question: "No end date?",
          conditionId: "cond-1",
          tokens: [
            {
              token_id: "t1",
              outcome: "Yes",
              price: "0.96",
              bestAsk: "0.96",
              bestBid: "0.94",
              liquidity: "10000",
            },
            {
              token_id: "t2",
              outcome: "No",
              price: "0.04",
              bestAsk: "0.06",
              bestBid: "0.04",
              liquidity: "10000",
            },
          ],
        },
      ];

      const candidates = await orchestrator.scanAndEvaluate(markets);
      expect(candidates).toEqual([]);
    });

    it("rejects markets that cross the current epoch boundary when safety guard is enabled", async () => {
      const mockTradingClient = {
        isInitialized: () => true,
        initialize: vi.fn().mockResolvedValue(undefined),
        createOrder: vi.fn(),
      };
      const customConfig = {
        id: 77,
        name: "custom-vault",
        enabled: true,
        type: "custom",
        vaultAddress: "0x" + "3".repeat(40),
        safeAddress: "0x" + "2".repeat(40),
        allocatorNavSignerKeyEnv: "ALLOCATOR_KEY",
        safeOperatorKeyEnv: "SAFE_KEY",
        tradingSignerKeyEnv: "TRADING_KEY",
        tradingSignatureType: 2,
        betSize: 5,
        vaultReserveUsdc: 0,
        minAllocationAmountUsdc: 1,
        maxDeployedRatio: 1,
        marketFetchMaxEvents: 10,
        hedging: {
          enabled: false,
          dropThresholdPercent: 0,
          multiplier: 0,
          spreadTolerance: 0,
          minPositionAgeMinutes: 0,
          onlyNearResolution: false,
          nearResolutionMinutes: 0,
          skipCategories: [],
        },
        navRefreshIntervalMin: 1,
        reconciliationIntervalMin: 1,
        tradingScanIntervalMin: 1,
        resolutionCheckIntervalMin: 1,
        defaultMode: "simulation",
        enforceEpochBoundarySafety: true,
        epochBoundarySafetyBufferMinutes: 5,
      } as any;

      mockGetVaultProvider.mockReturnValue({
        getVaultInfo: vi.fn().mockResolvedValue({
          batchInfo: {
            currentBatchEnd: new Date(Date.now() + 30 * 60 * 1000),
          },
        }),
      });

      const customOrchestrator = new TradingOrchestratorService(
        customConfig,
        mockTradingClient as any,
        null,
        {
          vaultId: 77,
          vaultName: "custom-vault",
          allocatorNavSignerKey: "0x" + "a".repeat(64),
          safeOperatorKey: "0x" + "b".repeat(64),
          tradingSignerKey: "0x" + "c".repeat(64),
          tradingFunderAddress: "0x" + "1".repeat(40),
          tradingSignatureType: 2,
          safeAddress: "0x" + "2".repeat(40),
          vaultAddress: "0x" + "3".repeat(40),
          network: "amoy",
        } as any,
      );

      mockCalculateNav.mockReturnValue({
        totalAssets: 10000,
        idleAssets: 9900,
        deployedCostBasis: 100,
        sharePrice: 0,
        positionCount: 1,
        lastUpdated: new Date(),
      });

      const candidates = await customOrchestrator.scanAndEvaluate([
        {
          id: "late-market",
          question: "Will this run past epoch?",
          conditionId: "cond-late",
          endDate: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
          tokens: [
            {
              token_id: "t1",
              outcome: "Yes",
              price: "0.96",
              bestAsk: "0.96",
              bestBid: "0.94",
              liquidity: "10000",
            },
            {
              token_id: "t2",
              outcome: "No",
              price: "0.04",
              bestAsk: "0.06",
              bestBid: "0.04",
              liquidity: "10000",
            },
          ],
        },
      ]);

      expect(candidates).toEqual([]);
    });
  });
});
