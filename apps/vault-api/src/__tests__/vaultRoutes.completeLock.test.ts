import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { buildVaultRouter } from "../routes/vaultRoutes.js";

const {
  mockAcquireLock,
  mockReleaseLock,
  mockGetRequestById,
  mockMarkCompletedIdempotent,
  mockReadContract,
  mockGetTransactionReceipt,
  mockGetBlock,
  mockGetTransaction,
  mockFindFirst,
} = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn().mockReturnValue(true),
  mockGetRequestById: vi.fn(),
  mockMarkCompletedIdempotent: vi.fn(),
  mockReadContract: vi.fn(),
  mockGetTransactionReceipt: vi.fn(),
  mockGetBlock: vi.fn(),
  mockGetTransaction: vi.fn(),
  mockFindFirst: vi.fn(),
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
    calculateAndPushNav: vi.fn().mockResolvedValue({
      updatedOnChain: false,
      newValue: "1",
      txHash: undefined,
    }),
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
  getAllVaultConfigs: vi.fn(() => []),
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
});
