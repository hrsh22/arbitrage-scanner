import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.VAULT_1_ALLOCATOR_NAV_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
process.env.VAULT_1_SAFE_OPERATOR_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000002";
process.env.VAULT_1_TRADING_SIGNER_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000003";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({
  vaultPositions: {},
  vaultTrades: {},
  vaultAllocations: {},
  vaultNavHistory: {},
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../constants.js", () => ({
  COLLATERAL_ADDRESS: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
  CTF_ADDRESS: "0x00000000000000000000000000000000000000c7",
  CTF_EXCHANGE_ADDRESS: "0xCTFExchange",
  NEGRISK_CTF_EXCHANGE_ADDRESS: "0xNegRiskCTFExchange",
  NEGRISK_ADAPTER_ADDRESS: "0xNegRiskAdapter",
  USDC_E_ADDRESS: "0xUSDC",
  COLLATERAL_DECIMALS: 6,
  NAV_STALENESS_THRESHOLD: 3600,
  MAX_DEPLOYED_RATIO: 0.25,
  WITHDRAWAL_FEE_BPS: 50,
  POLYGON_CHAIN_ID: 137,
  SUPPORTS_POLYMARKET_TRADING: true,
}));

vi.mock("../config/index.js", () => ({
  getAllVaultConfigs: vi.fn(() => []),
  getVaultConfig: vi.fn(() => null),
}));

vi.mock("../env.js", () => ({
  env: {
    VAULT_ADDRESS: "0xVault",
    SAFE_ADDRESS: "0xSafe",
    VAULT_PRIVATE_KEY: "0x0000000000000000000000000000000000000000000000000000000000000001",
    POLYGON_RPC_URL: "https://polygon-rpc.com",
    POLYGON_RPC_URLS: ["https://polygon-rpc.com"],
    AMOY_RPC_URLS: ["https://polygon-rpc.com"],
  },
}));

vi.mock("viem", () => ({
  encodeFunctionData: vi.fn().mockReturnValue("0xencoded"),
  createPublicClient: vi.fn().mockReturnValue({ readContract: vi.fn() }),
  createWalletClient: vi.fn().mockReturnValue({ writeContract: vi.fn() }),
  isAddress: vi.fn(() => true),
  http: vi.fn(),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({ address: "0xMock" }),
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137 },
  polygonAmoy: { id: 80002 },
}));

vi.mock("../services/navOracle.js", () => ({
  NavOracleService: vi.fn().mockImplementation(() => ({
    handleResolution: vi.fn().mockResolvedValue({
      updatedOnChain: true,
      oldValue: "10.000000",
      newValue: "5.000000",
      delta: "-5.000000",
      txHash: "0xtx123",
    }),
    calculateAndPushNav: vi.fn(),
    getNavHealth: vi.fn(),
    forceNavUpdate: vi.fn(),
  })),
  navOracle: {
    handleResolution: vi.fn().mockResolvedValue({
      updatedOnChain: true,
      oldValue: "10.000000",
      newValue: "5.000000",
      delta: "-5.000000",
      txHash: "0xtx123",
    }),
    calculateAndPushNav: vi.fn(),
    getNavHealth: vi.fn(),
    forceNavUpdate: vi.fn(),
  },
}));

import { ResolutionCheckerService } from "../services/resolutionChecker.js";

function createMockPosition(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    positionId: "pos-123",
    marketId: "market-abc",
    conditionId: "0xcond123",
    tokenId: "token-456",
    outcome: "YES",
    costBasis: "4.750000",
    quantity: "5.000000",
    status: "open",
    openedAt: new Date(),
    resolvedAt: null,
    resolvedPnl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockPositionRepo() {
  return {
    getOpenPositions: vi.fn().mockResolvedValue([]),
    getPositionById: vi.fn().mockResolvedValue(null),
    updatePositionStatus: vi.fn().mockResolvedValue(null),
    createPosition: vi.fn(),
    getPositionsByMarket: vi.fn().mockResolvedValue([]),
    getTotalCostBasis: vi.fn().mockResolvedValue(0),
    recordTrade: vi.fn(),
    recordAllocation: vi.fn(),
  };
}

function createMockNavOracle() {
  return {
    handleResolution: vi.fn().mockResolvedValue({
      updatedOnChain: true,
      oldValue: "10.000000",
      newValue: "5.000000",
      delta: "-5.000000",
      txHash: "0xtx123",
    }),
    calculateAndPushNav: vi.fn(),
    getNavHealth: vi.fn(),
    forceNavUpdate: vi.fn(),
  };
}

function createMockSafeWallet() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    executeRawTransaction: vi.fn().mockResolvedValue({ success: true, txHash: "0xredeem" }),
    getBalance: vi.fn().mockResolvedValue(0n),
  };
}

function mockFetchResponse(body: any, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("ResolutionCheckerService", () => {
  let positionRepo: ReturnType<typeof createMockPositionRepo>;
  let navOracle: ReturnType<typeof createMockNavOracle>;
  let safeWallet: ReturnType<typeof createMockSafeWallet>;
  let checker: ResolutionCheckerService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    positionRepo = createMockPositionRepo();
    navOracle = createMockNavOracle();
    safeWallet = createMockSafeWallet();
    checker = new ResolutionCheckerService(
      positionRepo as any,
      navOracle as any,
      safeWallet as any,
    );
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("checkResolutions — no open positions", () => {
    it("returns zero counts when no open positions", async () => {
      positionRepo.getOpenPositions.mockResolvedValue([]);

      const result = await checker.checkResolutions();

      expect(result.checked).toBe(0);
      expect(result.resolved).toBe(0);
      expect(result.won).toBe(0);
      expect(result.lost).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe("checkResolutions — win resolution", () => {
    it("detects win, updates PnL correctly, and redeems tokens", async () => {
      const position = createMockPosition({
        outcome: "Yes",
        costBasis: "4.750000",
        quantity: "5.000000",
      });
      positionRepo.getOpenPositions.mockResolvedValue([position]);

      globalThis.fetch = mockFetchResponse({
        id: "market-abc",
        closed: true,
        active: false,
        outcomes: JSON.stringify(["Yes", "No"]),
        outcomePrices: JSON.stringify(["1", "0"]),
      });

      const result = await checker.checkResolutions();

      expect(result.checked).toBe(1);
      expect(result.resolved).toBe(1);
      expect(result.won).toBe(1);
      expect(result.lost).toBe(0);

      expect(navOracle.handleResolution).toHaveBeenCalledWith(position.id, true);

      expect(safeWallet.initialize).toHaveBeenCalled();
      expect(result.redeemed).toBe(1);
    });
  });

  describe("checkResolutions — loss resolution", () => {
    it("detects loss and zeroes cost basis via negative PnL", async () => {
      const position = createMockPosition({
        outcome: "Yes",
        costBasis: "4.750000",
        quantity: "5.000000",
      });
      positionRepo.getOpenPositions.mockResolvedValue([position]);

      globalThis.fetch = mockFetchResponse({
        id: "market-abc",
        closed: true,
        active: false,
        outcomes: JSON.stringify(["Yes", "No"]),
        outcomePrices: JSON.stringify(["0", "1"]),
      });

      const result = await checker.checkResolutions();

      expect(result.checked).toBe(1);
      expect(result.resolved).toBe(1);
      expect(result.won).toBe(0);
      expect(result.lost).toBe(1);
      expect(result.redeemed).toBe(0);

      expect(navOracle.handleResolution).toHaveBeenCalledWith(position.id, false);
    });
  });

  describe("checkResolutions — unresolved market", () => {
    it("skips positions whose market is not yet resolved", async () => {
      const position = createMockPosition();
      positionRepo.getOpenPositions.mockResolvedValue([position]);

      globalThis.fetch = mockFetchResponse({
        id: "market-abc",
        closed: false,
        active: true,
        outcomes: JSON.stringify(["Yes", "No"]),
        outcomePrices: JSON.stringify(["0.95", "0.05"]),
      });

      const result = await checker.checkResolutions();

      expect(result.checked).toBe(1);
      expect(result.resolved).toBe(0);
      expect(navOracle.handleResolution).not.toHaveBeenCalled();
    });
  });

  describe("checkResolutions — API error", () => {
    it("handles market fetch failure gracefully", async () => {
      const position = createMockPosition();
      positionRepo.getOpenPositions.mockResolvedValue([position]);

      globalThis.fetch = mockFetchResponse(null, false, 500);

      const result = await checker.checkResolutions();

      expect(result.checked).toBe(1);
      expect(result.resolved).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe("checkResolutions — multiple positions", () => {
    it("processes multiple positions: one win, one loss, one unresolved", async () => {
      const winPosition = createMockPosition({
        id: 1,
        marketId: "market-win",
        outcome: "Yes",
        costBasis: "4.750000",
        quantity: "5.000000",
      });
      const lossPosition = createMockPosition({
        id: 2,
        marketId: "market-loss",
        outcome: "Yes",
        costBasis: "4.750000",
        quantity: "5.000000",
      });
      const unresolvedPosition = createMockPosition({
        id: 3,
        marketId: "market-active",
        outcome: "Yes",
      });

      positionRepo.getOpenPositions.mockResolvedValue([
        winPosition,
        lossPosition,
        unresolvedPosition,
      ]);

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("market-win")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: "market-win",
                closed: true,
                outcomes: JSON.stringify(["Yes", "No"]),
                outcomePrices: JSON.stringify(["1", "0"]),
              }),
          });
        }
        if (url.includes("market-loss")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: "market-loss",
                closed: true,
                outcomes: JSON.stringify(["Yes", "No"]),
                outcomePrices: JSON.stringify(["0", "1"]),
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "market-active",
              closed: false,
              active: true,
              outcomes: JSON.stringify(["Yes", "No"]),
              outcomePrices: JSON.stringify(["0.95", "0.05"]),
            }),
        });
      });

      const result = await checker.checkResolutions();

      expect(result.checked).toBe(3);
      expect(result.resolved).toBe(2);
      expect(result.won).toBe(1);
      expect(result.lost).toBe(1);
    });
  });

  describe("redeemConditionalTokens", () => {
    it("calls safe wallet to redeem on win", async () => {
      safeWallet.executeRawTransaction.mockResolvedValue({
        success: true,
        txHash: "0xredeem123",
      });

      const result = await checker.redeemConditionalTokens("0xcond456");

      expect(safeWallet.initialize).toHaveBeenCalled();
      expect(safeWallet.executeRawTransaction).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.txHash).toBe("0xredeem123");
    });

    it("returns error when redemption fails", async () => {
      safeWallet.executeRawTransaction.mockResolvedValue({
        success: false,
        error: "Insufficient balance",
      });

      const result = await checker.redeemConditionalTokens("0xcond456");

      expect(result.success).toBe(false);
    });
  });
});
