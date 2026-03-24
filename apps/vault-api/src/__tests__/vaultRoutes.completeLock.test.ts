import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { buildVaultRouter } from "../routes/vaultRoutes.js";

const {
  mockAcquireLock,
  mockReleaseLock,
  mockGetRequestById,
  mockMarkCompletedIdempotent,
  mockPreflightInstantWithdrawal,
  mockCalculateAndPushNav,
  mockReadContract,
  mockGetTransactionReceipt,
  mockGetBlock,
  mockGetTransaction,
  mockFindFirst,
  mockGetAllVaultConfigs,
} = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn().mockReturnValue(true),
  mockGetRequestById: vi.fn(),
  mockMarkCompletedIdempotent: vi.fn(),
  mockPreflightInstantWithdrawal: vi.fn(),
  mockCalculateAndPushNav: vi.fn(),
  mockReadContract: vi.fn(),
  mockGetTransactionReceipt: vi.fn(),
  mockGetBlock: vi.fn(),
  mockGetTransaction: vi.fn(),
  mockFindFirst: vi.fn(),
  mockGetAllVaultConfigs: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: () => void) => {
    (req as unknown as { session: { address: string } }).session = {
      address: "0x1234567890123456789012345678901234567890",
    };
    next();
  },
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../services/pendingTxRegistry.js", () => ({
  pendingTxRegistry: {
    acquireLock: mockAcquireLock,
    releaseLock: mockReleaseLock,
  },
}));

vi.mock("../repositories/withdrawalRepository.js", () => ({
  withdrawalRepository: {
    getRequestById: mockGetRequestById,
    markCompletedIdempotent: mockMarkCompletedIdempotent,
    getRequestsByUser: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../services/liquidityManager.js", () => ({
  LiquidityManager: class {
    async preflightInstantWithdrawal(requestedAssets: bigint) {
      return mockPreflightInstantWithdrawal(requestedAssets);
    }

    async runReconciliation() {
      return {
        action: "none",
        amount: 0,
        details: "mock",
        vaultBalance: 0,
        safeBalance: 0,
        pendingWithdrawals: 0,
      };
    }
  },
}));

vi.mock("../services/navOracle.js", () => ({
  createNavOracle: vi.fn(() => ({
    getNavHealth: vi.fn().mockResolvedValue({ stale: false }),
    calculateAndPushNav: mockCalculateAndPushNav,
  })),
}));

vi.mock("../repositories/activityEventRepository.js", () => ({
  activityEventRepository: {
    appendUserVaultActivityEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      withdrawalRequests: {
        findFirst: mockFindFirst,
      },
    },
  },
}));

vi.mock("../config/index.js", () => ({
  getVaultConfig: vi.fn(() => ({
    id: 1,
    enabled: true,
    type: "custom",
    providerType: "custom",
    vaultAddress: "0x62646C39547c004a922D928DCe247Cae11F7d2d2",
    safeAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",
    vaultContractType: "flatBookVaultV2",
    allocatorNavSignerKeyEnv: "ALLOCATOR_NAV_SIGNER_KEY",
    settlerKeyEnv: "SETTLER_KEY",
    safeOperatorKeyEnv: "SAFE_OPERATOR_KEY",
    minAllocationAmountUsdc: 1,
    vaultReserveUsdc: 0,
    autoLiquidityManagement: true,
  })),
  getAllVaultConfigs: mockGetAllVaultConfigs,
}));

vi.mock("../config/network.js", () => ({
  getNetworkConfigFromEnv: vi.fn(() => ({
    chain: { id: 80002, name: "amoy" },
    chainId: 80002,
    name: "amoy",
    explorerBaseUrl: "https://amoy.polygonscan.com",
    supportsPolymarketTrading: false,
    addresses: {
      usdcE: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
      ctf: "0x0000000000000000000000000000000000000000",
      ctfExchange: "0x0000000000000000000000000000000000000000",
      negRiskCtfExchange: "0x0000000000000000000000000000000000000000",
      negRiskAdapter: "0x0000000000000000000000000000000000000000",
      vaultV2Factory: "0x0000000000000000000000000000000000000000",
    },
  })),
  getRpcUrlForNetwork: vi.fn(() => "https://rpc-amoy.polygon.technology"),
  getRpcUrlsForNetwork: vi.fn(() => ["https://rpc-amoy.polygon.technology"]),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");

  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mockReadContract,
      getTransactionReceipt: mockGetTransactionReceipt,
      getBlock: mockGetBlock,
      getTransaction: mockGetTransaction,
    })),
  };
});

type MockResponse = Response & { statusCode?: number; payload?: unknown };

function createMockResponse(): MockResponse {
  const res = {} as MockResponse;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res.payload = body;
    return res;
  }) as unknown as Response["json"];
  return res;
}

function getRouteHandler(path: string): (req: Request, res: Response) => Promise<void> {
  const router = buildVaultRouter();
  const layer = router.stack.find((entry) => {
    const route = (entry as { route?: { path?: string; methods?: Record<string, boolean> } }).route;
    return route?.path === path && route.methods?.post;
  });

  if (!layer) {
    throw new Error(`Route not found: POST ${path}`);
  }

  const handlers = (layer as { route: { stack: Array<{ handle: unknown }> } }).route.stack;
  const finalHandler = handlers[handlers.length - 1]?.handle;
  if (typeof finalHandler !== "function") {
    throw new Error(`Route handler missing for POST ${path}`);
  }

  return finalHandler as (req: Request, res: Response) => Promise<void>;
}

describe("vaultRoutes complete lock behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseLock.mockReturnValue(true);
    mockFindFirst.mockResolvedValue(null);
    mockCalculateAndPushNav.mockResolvedValue({
      updatedOnChain: false,
      newValue: "1",
      txHash: undefined,
    });
    mockPreflightInstantWithdrawal.mockResolvedValue({
      ready: true,
      mode: "instant",
      executionMode: "instant",
      telemetryFresh: true,
      liquidityMode: "vault_liquid",
      triggeredRecall: false,
      requestedAssets: 1.25,
      vaultBalance: 1.25,
      safeBalance: 0,
      shortfall: 0,
      reason: "Vault idle liquidity already covers this withdrawal",
    });
    mockGetAllVaultConfigs.mockReturnValue([
      {
        id: 1,
        enabled: true,
        type: "custom",
        providerType: "custom",
        vaultAddress: "0x62646C39547c004a922D928DCe247Cae11F7d2d2",
        safeAddress: "0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214",
        vaultContractType: "flatBookVaultV2",
      },
    ]);
  });

  it("returns idempotent success when lock is held but request already completed", async () => {
    mockAcquireLock.mockReturnValue({ acquired: false, existing: { action: "reconcile" } });
    mockGetRequestById.mockResolvedValue({
      requestId: "wr-1",
      vaultAddress: "0x62646C39547c004a922D928DCe247Cae11F7d2d2",
      userAddress: "0x1234567890123456789012345678901234567890",
      shares: "1.000000000000000000",
      assetsEstimated: "1.000000",
      status: "completed",
      readyAt: new Date("2026-03-20T11:00:00.000Z"),
      completedAt: new Date("2026-03-20T11:05:00.000Z"),
      requestedAt: new Date("2026-03-20T10:50:00.000Z"),
      txHash: "0xabc",
    });

    const handler = getRouteHandler("/withdrawal-request/:requestId/complete");
    const req = {
      params: { requestId: "wr-1" },
      body: { txHash: "0xabc" },
      session: { address: "0x1234567890123456789012345678901234567890" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).not.toHaveBeenCalledWith(423);
    expect(res.payload).toMatchObject({
      success: true,
      idempotent: true,
      message: "Withdrawal request was already completed",
    });
  });

  it("keeps 423 response for genuinely in-flight incomplete requests", async () => {
    mockAcquireLock.mockReturnValue({ acquired: false, existing: { action: "reconcile" } });
    mockGetRequestById.mockResolvedValue({
      requestId: "wr-2",
      vaultAddress: "0x62646C39547c004a922D928DCe247Cae11F7d2d2",
      userAddress: "0x1234567890123456789012345678901234567890",
      shares: "1.000000000000000000",
      assetsEstimated: "1.000000",
      status: "ready",
      readyAt: new Date("2026-03-20T11:00:00.000Z"),
      requestedAt: new Date("2026-03-20T10:50:00.000Z"),
      txHash: null,
    });

    const handler = getRouteHandler("/withdrawal-request/:requestId/complete");
    const req = {
      params: { requestId: "wr-2" },
      body: { txHash: "0xdef" },
      session: { address: "0x1234567890123456789012345678901234567890" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.payload).toMatchObject({
      error: "Concurrent operation in progress. Please retry shortly.",
      requestId: "wr-2",
    });
  });

  it("treats ready custom withdrawals as locked during preflight", async () => {
    mockAcquireLock.mockReturnValue({ acquired: true });
    mockReadContract
      .mockResolvedValueOnce(644703n)
      .mockResolvedValueOnce(1408998n)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2185500360000000000n);
    mockGetRequestById.mockResolvedValue({
      requestId: "wr-3",
      vaultAddress: "0x62646C39547c004a922D928DCe247Cae11F7d2d2",
      userAddress: "0x1234567890123456789012345678901234567890",
      shares: "0.644703000000000000",
      assetsEstimated: "1.408998",
      status: "ready",
      readyAt: new Date("2026-03-20T11:00:00.000Z"),
      requestedAt: new Date("2026-03-20T10:50:00.000Z"),
      txHash: null,
    });

    const handler = getRouteHandler("/withdrawal-request/:requestId/preflight");
    const req = {
      params: { requestId: "wr-3" },
      session: { address: "0x1234567890123456789012345678901234567890" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      success: true,
      ready: true,
      requestId: "wr-3",
      status: "ready",
      requestedAssets: "1.408998",
      reason: "Withdrawal amount locked and ready to claim.",
    });
  });

  it("rejects ready custom withdrawals that are not actually claimable on-chain", async () => {
    mockAcquireLock.mockReturnValue({ acquired: true });
    mockReadContract
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1900000000000000000n);
    mockGetRequestById.mockResolvedValue({
      requestId: "wr-4",
      vaultAddress: "0x62646C39547c004a922D928DCe247Cae11F7d2d2",
      userAddress: "0x1234567890123456789012345678901234567890",
      shares: "0.644703000000000000",
      assetsEstimated: "1.408998",
      status: "ready",
      readyAt: new Date("2026-03-20T11:00:00.000Z"),
      requestedAt: new Date("2026-03-20T10:50:00.000Z"),
      txHash: null,
    });

    const handler = getRouteHandler("/withdrawal-request/:requestId/preflight");
    const req = {
      params: { requestId: "wr-4" },
      session: { address: "0x1234567890123456789012345678901234567890" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      success: false,
      ready: false,
      requestId: "wr-4",
      status: "ready",
      requestedAssets: "1.408998",
    });
  });

  it("allows instant custom withdraw preflight when NAV is already fresh without a new publish", async () => {
    mockAcquireLock.mockReturnValue({ acquired: true });
    mockReadContract.mockResolvedValueOnce(1250000000000000000n).mockResolvedValueOnce(true);

    const handler = getRouteHandler("/:vaultId/instant-withdraw-preflight");
    const req = {
      params: { vaultId: "1" },
      body: { shares: "1.000000" },
      session: { address: "0x1234567890123456789012345678901234567890" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(mockCalculateAndPushNav).toHaveBeenCalledTimes(1);
    expect(mockPreflightInstantWithdrawal).toHaveBeenCalledWith(1250000n);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ready: true,
      mode: "instant",
      executionMode: "instant",
    });
  });

  it("rejects instant custom withdraw preflight when NAV remains stale after refresh", async () => {
    mockAcquireLock.mockReturnValue({ acquired: true });
    mockReadContract.mockResolvedValueOnce(1250000000000000000n).mockResolvedValueOnce(false);

    const handler = getRouteHandler("/:vaultId/instant-withdraw-preflight");
    const req = {
      params: { vaultId: "1" },
      body: { shares: "1.000000" },
      session: { address: "0x1234567890123456789012345678901234567890" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.payload).toMatchObject({
      ready: false,
      executionMode: "blocked",
      error: "NAV is still stale on-chain after refresh. Retry once it confirms.",
    });
  });
});
