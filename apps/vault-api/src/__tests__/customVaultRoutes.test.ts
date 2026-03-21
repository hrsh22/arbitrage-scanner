import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { buildCustomVaultRouter } from "../routes/customVaultRoutes.js";
import { seedLifecycleEventsFromBatchStatus } from "../routes/customVaultRoutes.js";
import { getVaultProviderFactory } from "../services/vaultProviderFactory.js";
import { VaultProviderError } from "../services/vaultProvider.js";

vi.mock("../services/vaultProviderFactory.js");
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: () => void) => {
    (req as unknown as { session: { address: string } }).session = {
      address: "0x1234567890123456789012345678901234567890",
    };
    next();
  },
}));

vi.mock("../repositories/entitlementRepository.js", () => ({
  entitlementRepository: {
    getByRequest: vi.fn().mockResolvedValue(null),
    getByUser: vi.fn().mockResolvedValue([]),
    getClaimEligibility: vi.fn().mockResolvedValue({
      canClaim: false,
      unclaimedAmount: "0",
      currentStatus: "pending",
      error: "Not claimable",
    }),
    incrementClaimed: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../repositories/payoutRepository.js", () => ({
  payoutRepository: {
    checkClaimCap: vi.fn().mockResolvedValue({ canProceed: true }),
    claimAllForEntitlement: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const { mockAppendUserVaultActivityEvent, mockGetRequestsByUser, mockMarkCompletedIdempotent } =
  vi.hoisted(() => ({
    mockAppendUserVaultActivityEvent: vi.fn().mockResolvedValue(undefined),
    mockGetRequestsByUser: vi.fn().mockResolvedValue([]),
    mockMarkCompletedIdempotent: vi.fn().mockResolvedValue({ success: true }),
  }));

const {
  mockAppendVaultLifecycleEvent,
  mockListVaultLifecycleEvents,
  mockListUserVaultActivityEvents,
  mockListVaultUserActivityEvents,
} = vi.hoisted(() => ({
  mockAppendVaultLifecycleEvent: vi.fn().mockResolvedValue(undefined),
  mockListVaultLifecycleEvents: vi.fn().mockResolvedValue([]),
  mockListUserVaultActivityEvents: vi.fn().mockResolvedValue([]),
  mockListVaultUserActivityEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../repositories/activityEventRepository.js", () => ({
  activityEventRepository: {
    appendUserVaultActivityEvent: mockAppendUserVaultActivityEvent,
    appendVaultLifecycleEvent: mockAppendVaultLifecycleEvent,
    listUserVaultActivityEvents: mockListUserVaultActivityEvents,
    listVaultUserActivityEvents: mockListVaultUserActivityEvents,
    listVaultLifecycleEvents: mockListVaultLifecycleEvents,
  },
}));

vi.mock("../repositories/withdrawalRepository.js", () => ({
  withdrawalRepository: {
    getRequestsByUser: mockGetRequestsByUser,
    markCompletedIdempotent: mockMarkCompletedIdempotent,
  },
}));

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

function getRouteHandler(
  path: string,
  method: "get" | "post",
): (req: Request, res: Response) => Promise<void> {
  const router = buildCustomVaultRouter();
  const layer = router.stack.find((entry) => {
    const route = (entry as { route?: { path?: string; methods?: Record<string, boolean> } }).route;
    return route?.path === path && route.methods?.[method];
  });

  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  const handlers = (layer as { route: { stack: Array<{ handle: unknown }> } }).route.stack;
  const finalHandler = handlers[handlers.length - 1]?.handle;
  if (typeof finalHandler !== "function") {
    throw new Error(`Route handler missing for ${method.toUpperCase()} ${path}`);
  }

  return finalHandler as (req: Request, res: Response) => Promise<void>;
}

describe("Custom Vault Routes", () => {
  const userAddress = "0x1234567890123456789012345678901234567890";
  let mockProvider: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestsByUser.mockResolvedValue([]);
    mockMarkCompletedIdempotent.mockResolvedValue({ success: true });
    mockAppendVaultLifecycleEvent.mockResolvedValue(undefined);
    mockListUserVaultActivityEvents.mockResolvedValue([]);
    mockListVaultUserActivityEvents.mockResolvedValue([]);
    mockListVaultLifecycleEvents.mockResolvedValue([]);

    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(10n),
      getBatch: vi.fn().mockResolvedValue(null),
      getNAVStatus: vi.fn().mockResolvedValue({ currentNAV: 1000000000000000000n }),
      getDepositorBatchRequest: vi.fn().mockResolvedValue(0n),
      getDepositRequest: vi.fn().mockResolvedValue(null),
      getControllerRequestIds: vi.fn().mockResolvedValue([]),
      getRedemptionRequest: vi.fn().mockResolvedValue(null),
      isOperator: vi.fn().mockResolvedValue(false),
    };

    mockProvider = {
      providerType: "custom",
      config: {
        vaultAddress: userAddress,
      },
      getVaultInfo: vi.fn().mockResolvedValue({
        vaultId: 1,
        vaultAddress: userAddress,
        providerType: "custom",
        asset: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        assetDecimals: 6,
        shareDecimals: 6,
        totalAssets: 1000000000000n,
        totalSupply: 1000000000000000000000000n,
        sharePrice: 1,
        batchInfo: {
          currentBatchId: 10,
          currentBatchStart: new Date("2026-01-01T00:00:00.000Z"),
          currentBatchEnd: new Date("2026-01-08T00:00:00.000Z"),
          currentBatchStatus: "open",
          nextBatchId: 11,
          nextBatchExists: true,
          batchDurationSeconds: 604800,
        },
        navLastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        navIsStale: false,
      }),
      getBatchStatus: vi.fn().mockResolvedValue({
        batchId: 10,
        nextBatchId: 11,
        status: "open",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        endTime: new Date("2026-01-08T00:00:00.000Z"),
        isPriceLocked: false,
        totalSharesPending: 1000000n,
        proRataRatio: 1,
        totalQueuedDeposits: 0n,
        claimableRedemptions: 1,
        mintedDeposits: 0,
      }),
      getLifecycle: vi.fn().mockResolvedValue({
        riskState: "flat",
        executionMode: "instant",
        telemetryFresh: true,
        openPositionCount: null,
        liquidityMode: "vault_liquid",
        reopenReady: false,
      }),
      getRequestStatus: vi.fn().mockResolvedValue({
        request: {
          requestId: "1",
          vaultId: 1,
          userAddress,
          controller: userAddress,
          owner: userAddress,
          operator: undefined,
          batchId: 10,
          shares: 1000000n,
          assetsEstimated: 1000000n,
          status: "pending",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        claimable: false,
        estimatedSettlementTime: new Date("2026-01-08T00:00:00.000Z"),
      }),
      getUserRedemptionState: vi.fn().mockResolvedValue({
        userAddress,
        vaultId: 1,
        pendingRequests: [
          {
            requestId: "1",
            vaultId: 1,
            userAddress,
            batchId: 10,
            shares: 1000000n,
            assetsEstimated: 1000000n,
            status: "pending",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        claimableRequests: [],
        totalSharesPending: 1000000n,
        totalSharesClaimable: 0n,
        estimatedAssetsPending: 1000000n,
        estimatedAssetsClaimable: 0n,
      }),
      requestRedeem: vi.fn().mockResolvedValue({
        success: true,
        requestId: "1",
        batchId: 10,
      }),
      claimRedemption: vi.fn().mockResolvedValue({
        success: true,
        requestId: "1",
        assetsReceived: 1000000n,
        txHash: "0xabc",
      }),
      isSettlementReady: vi.fn().mockResolvedValue(false),
      getCapabilities: vi.fn().mockReturnValue({
        batchBased: true,
      }),
      getClient: vi.fn().mockReturnValue(mockClient),
    };

    (getVaultProviderFactory as ReturnType<typeof vi.fn>).mockReturnValue({
      hasProvider: vi.fn().mockReturnValue(true),
      getProvider: vi.fn().mockReturnValue(mockProvider),
    });
  });

  // Tests for current-cycle payloads including lifecycle fields
  it("includes lifecycle fields for current cycle (flat/open telemetry)", async () => {
    const handler = getRouteHandler("/:vaultId/cycles/current", "get");
    const req = {
      params: { vaultId: "1" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.payload).toMatchObject({
      success: true,
      cycle: expect.objectContaining({
        riskState: "flat",
        executionMode: "instant",
        telemetryFresh: true,
        openPositionCount: null,
        liquidityMode: "vault_liquid",
        reopenReady: false,
      }),
    });
  });

  it("includes lifecycle fields for current cycle (stale telemetry)", async () => {
    // Override lifecycle mock for this test
    (mockProvider as any).getLifecycle = vi.fn().mockResolvedValue({
      riskState: "unknown",
      executionMode: "blocked",
      telemetryFresh: false,
      openPositionCount: null,
      liquidityMode: "queued_only",
      reopenReady: false,
    });

    const handler = getRouteHandler("/:vaultId/cycles/current", "get");
    const req = {
      params: { vaultId: "1" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.payload).toMatchObject({
      success: true,
      cycle: expect.objectContaining({
        riskState: "unknown",
        executionMode: "blocked",
        telemetryFresh: false,
      }),
    });
  });

  it("returns batch/cycle fields in request status response", async () => {
    const handler = getRouteHandler("/:vaultId/requests/:requestId", "get");
    const req = {
      params: { vaultId: "1", requestId: "1" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    expect(res.payload).toMatchObject({
      success: true,
      request: {
        requestId: "1",
        batchId: 10,
        cycleId: 10,
        targetCycle: 10,
      },
    });
  });

  it("maps request-not-found provider error to 400 for invalid request ids", async () => {
    (mockProvider.getRequestStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
      new VaultProviderError("Invalid requestId format", "REQUEST_NOT_FOUND"),
    );
    const handler = getRouteHandler("/:vaultId/requests/:requestId", "get");
    const req = {
      params: { vaultId: "1", requestId: "not-a-number" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload).toMatchObject({
      error: "Invalid request ID",
      requestId: "not-a-number",
    });
  });

  it("returns aggregate requests fields in redemptions response", async () => {
    const handler = getRouteHandler("/:vaultId/redemptions", "get");
    const req = {
      params: { vaultId: "1" },
      session: { address: userAddress },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.payload).toMatchObject({
      success: true,
      totalPendingShares: "1000000",
      totalClaimableShares: "0",
      requests: expect.any(Array),
      pendingRequests: expect.any(Array),
      claimableRequests: expect.any(Array),
    });
  });

  it("returns 410 payload for deprecated legacy-claim endpoint", async () => {
    const handler = getRouteHandler("/:vaultId/legacy-claim", "post");
    const req = {
      params: { vaultId: "1" },
      session: { address: userAddress },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.payload).toMatchObject({
      error: "Gone",
      deprecated: true,
      replacementEndpoint: "/api/vaults/:vaultId/requests/:requestId/claim",
    });
  });

  it("keeps redeem response cycle aliases aligned", async () => {
    const handler = getRouteHandler("/:vaultId/redeem", "post");
    const req = {
      params: { vaultId: "1" },
      body: { shares: "1" },
      session: { address: userAddress },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.payload).toMatchObject({
      success: true,
      requestId: "1",
      batchId: 10,
      cycleId: 10,
    });
  });

  it("records direct wallet claim activity for custom vault claims", async () => {
    const handler = getRouteHandler("/:vaultId/activity/claim", "post");
    const req = {
      params: { vaultId: "1" },
      body: {
        txHash: "0xabc",
        requestId: "claimable-0x1234567890123456789012345678901234567890",
        shares: "1.000000",
        assets: "1.000000",
      },
      session: { address: userAddress },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(mockAppendUserVaultActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "claim_completed",
        txHash: "0xabc",
        requestId: "claimable-0x1234567890123456789012345678901234567890",
        assetAmount: "1.000000",
        shareAmount: "1.000000",
      }),
    );
    expect(res.payload).toMatchObject({ success: true });
  });

  it("records queued deposit activity with inferred next cycle id", async () => {
    const handler = getRouteHandler("/:vaultId/activity/deposit", "post");
    const req = {
      params: { vaultId: "1" },
      body: {
        txHash: "0xabc",
        assets: "2.500000",
        mode: "queued",
      },
      session: { address: userAddress },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(mockAppendUserVaultActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "deposit_queued",
        cycleId: 11,
        status: "queued",
        assetAmount: "2.500000",
      }),
    );
    expect(res.payload).toMatchObject({ success: true });
  });

  it("seeds meaningful lifecycle events from settled batch status", () => {
    const startTime = new Date("2026-01-01T00:00:00.000Z");
    const endTime = new Date("2026-01-08T00:00:00.000Z");

    const seedRows = seedLifecycleEventsFromBatchStatus({
      vaultId: 1,
      vaultAddress: "0x1234567890123456789012345678901234567890",
      batchStatus: {
        batchId: 10,
        nextBatchId: 11,
        status: "settled",
        startTime,
        endTime,
        cutoffTime: endTime,
        isPriceLocked: true,
        totalSharesPending: 5n,
        totalQueuedDeposits: 7n,
        claimableRedemptions: 1,
        mintedDeposits: 0,
        proRataRatio: 1,
      },
    });

    const eventTypes = seedRows.map((row) => row.eventType);
    expect(eventTypes).toContain("cycle_opened");
    expect(eventTypes).toContain("book_closed");
    expect(eventTypes).toContain("processing_started");
    expect(eventTypes).toContain("processing_completed");
    expect(eventTypes).toContain("claim_window_opened");
    expect(eventTypes).toContain("deposit_queue_processed");
  });

  it("seeds canonical lifecycle events for /events when storage is empty", async () => {
    mockListVaultLifecycleEvents.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 1,
        vaultId: 1,
        vaultAddress: userAddress,
        cycleId: 10,
        eventType: "cycle_opened",
        title: "Cycle opened",
        detail: "A new vault cycle started.",
        status: "open",
        requestId: null,
        txHash: null,
        assetAmount: null,
        shareAmount: null,
        metadata: null,
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const handler = getRouteHandler("/:vaultId/events", "get");
    const req = {
      params: { vaultId: "1" },
      query: { limit: "20" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(mockAppendVaultLifecycleEvent).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.payload).toMatchObject({
      success: true,
      vaultId: 1,
      pagination: {
        limit: 20,
        offset: 0,
        hasMore: false,
      },
      items: [
        expect.objectContaining({
          type: "cycle_opened",
          scope: "vault",
        }),
      ],
    });
  });

  it("paginates canonical lifecycle events for /events", async () => {
    const firstEventAt = new Date("2026-03-21T10:00:00.000Z");
    const secondEventAt = new Date("2026-03-21T09:30:00.000Z");
    const thirdEventAt = new Date("2026-03-21T09:00:00.000Z");

    mockListVaultLifecycleEvents
      .mockResolvedValueOnce([
        {
          id: 101,
          vaultId: 1,
          vaultAddress: userAddress,
          cycleId: 14,
          eventType: "processing_completed",
          title: "Processing completed",
          detail: "The current cycle finished processing queued work.",
          status: "processed",
          requestId: null,
          txHash: null,
          assetAmount: null,
          shareAmount: null,
          metadata: null,
          occurredAt: firstEventAt,
          createdAt: firstEventAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 102,
          vaultId: 1,
          vaultAddress: userAddress,
          cycleId: 13,
          eventType: "claim_window_opened",
          title: "Claim window opened",
          detail: "Processed withdrawals are now claimable.",
          status: "processed",
          requestId: null,
          txHash: null,
          assetAmount: null,
          shareAmount: null,
          metadata: null,
          occurredAt: secondEventAt,
          createdAt: secondEventAt,
        },
        {
          id: 103,
          vaultId: 1,
          vaultAddress: userAddress,
          cycleId: 13,
          eventType: "deposit_queue_processed",
          title: "Deposit queue processed",
          detail: "Queued deposits were processed for the next cycle.",
          status: "processed",
          requestId: null,
          txHash: null,
          assetAmount: null,
          shareAmount: null,
          metadata: null,
          occurredAt: thirdEventAt,
          createdAt: thirdEventAt,
        },
        {
          id: 104,
          vaultId: 1,
          vaultAddress: userAddress,
          cycleId: 12,
          eventType: "cycle_reopened",
          title: "Cycle reopened",
          detail: "A new cycle is ready for vault actions.",
          status: "reopen",
          requestId: null,
          txHash: null,
          assetAmount: null,
          shareAmount: null,
          metadata: null,
          occurredAt: new Date("2026-03-21T08:30:00.000Z"),
          createdAt: new Date("2026-03-21T08:30:00.000Z"),
        },
      ]);

    mockListVaultUserActivityEvents.mockResolvedValue([]);

    const handler = getRouteHandler("/:vaultId/events", "get");
    const req = {
      params: { vaultId: "1" },
      query: { limit: "2", offset: "1" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(mockListVaultLifecycleEvents).toHaveBeenNthCalledWith(1, userAddress, 1, 0);
    expect(mockListVaultLifecycleEvents).toHaveBeenNthCalledWith(2, userAddress, 3, 1);
    expect(res.payload).toMatchObject({
      success: true,
      vaultId: 1,
      pagination: {
        limit: 2,
        offset: 1,
        hasMore: true,
      },
      items: [
        expect.objectContaining({ type: "claim_window_opened" }),
        expect.objectContaining({ type: "deposit_queue_processed" }),
      ],
    });
  });

  it("derives historical lifecycle seed timestamps from user activity", async () => {
    const firstUserEvent = new Date("2026-03-19T16:37:31.211Z");
    const lastUserEvent = new Date("2026-03-19T21:16:38.781Z");

    mockListVaultLifecycleEvents.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 11,
        vaultId: 1,
        vaultAddress: userAddress,
        cycleId: 0,
        eventType: "cycle_opened",
        title: "Cycle opened",
        detail: "A vault cycle was already active before lifecycle tracking started.",
        status: "open",
        requestId: null,
        txHash: null,
        assetAmount: null,
        shareAmount: null,
        metadata: null,
        occurredAt: firstUserEvent,
        createdAt: firstUserEvent,
      },
      {
        id: 12,
        vaultId: 1,
        vaultAddress: userAddress,
        cycleId: 0,
        eventType: "processing_completed",
        title: "Processing completed",
        detail: "Queued withdrawals were processed.",
        status: "processed",
        requestId: null,
        txHash: null,
        assetAmount: null,
        shareAmount: null,
        metadata: null,
        occurredAt: lastUserEvent,
        createdAt: lastUserEvent,
      },
    ]);

    mockListVaultUserActivityEvents.mockResolvedValue([
      {
        id: 1,
        vaultId: 1,
        vaultAddress: userAddress,
        userAddress,
        cycleId: null,
        eventType: "deposit_minted",
        title: "Deposit completed",
        detail: "Your deposit was converted into vault shares.",
        status: "minted",
        requestId: null,
        txHash: null,
        assetAmount: "1.0",
        shareAmount: "1.0",
        metadata: null,
        occurredAt: firstUserEvent,
        createdAt: firstUserEvent,
      },
      {
        id: 2,
        vaultId: 1,
        vaultAddress: userAddress,
        userAddress,
        cycleId: null,
        eventType: "withdraw_ready",
        title: "Withdrawal ready",
        detail: "Your withdrawal request is ready to claim.",
        status: "ready",
        requestId: "wr-1",
        txHash: null,
        assetAmount: "1.0",
        shareAmount: "1.0",
        metadata: null,
        occurredAt: lastUserEvent,
        createdAt: lastUserEvent,
      },
    ]);

    const handler = getRouteHandler("/:vaultId/events", "get");
    const req = {
      params: { vaultId: "1" },
      query: { limit: "20" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(mockAppendVaultLifecycleEvent).toHaveBeenCalled();
    expect(mockAppendVaultLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "cycle_opened",
        occurredAt: expect.any(Date),
      }),
    );

    const cycleOpenedCall = mockAppendVaultLifecycleEvent.mock.calls.find(
      (call) => call[0].eventType === "cycle_opened",
    );
    const cycleOpenedOccurredAt = cycleOpenedCall?.[0].occurredAt as Date | undefined;
    expect(cycleOpenedOccurredAt).toBeDefined();
    expect(
      Math.abs(cycleOpenedOccurredAt!.getTime() - firstUserEvent.getTime()),
    ).toBeLessThanOrEqual(5);
  });

  it("appends incremental vault lifecycle events from newer user activity", async () => {
    const previousLifecycleAt = new Date("2026-03-20T10:00:00.000Z");
    const queuedDepositAt = new Date("2026-03-20T10:42:11.100Z");
    const newerUserAt = new Date("2026-03-20T11:06:42.435Z");

    mockListVaultLifecycleEvents
      .mockResolvedValueOnce([
        {
          id: 1,
          vaultId: 1,
          vaultAddress: userAddress,
          cycleId: 0,
          eventType: "processing_completed",
          title: "Processing completed",
          detail: "queued done",
          status: "processed",
          requestId: null,
          txHash: null,
          assetAmount: null,
          shareAmount: null,
          metadata: null,
          occurredAt: previousLifecycleAt,
          createdAt: previousLifecycleAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 2,
          vaultId: 1,
          vaultAddress: userAddress,
          cycleId: 0,
          eventType: "processing_completed",
          title: "Processing completed",
          detail: "queued done",
          status: "processed",
          requestId: null,
          txHash: null,
          assetAmount: null,
          shareAmount: null,
          metadata: null,
          occurredAt: newerUserAt,
          createdAt: newerUserAt,
        },
      ]);

    mockListVaultUserActivityEvents.mockResolvedValue([
      {
        id: 8,
        vaultId: 1,
        vaultAddress: userAddress,
        userAddress,
        cycleId: null,
        eventType: "deposit_queued",
        title: "Deposit queued",
        detail: "queued",
        status: "queued",
        requestId: null,
        txHash: null,
        assetAmount: "2.5",
        shareAmount: null,
        metadata: null,
        occurredAt: queuedDepositAt,
        createdAt: queuedDepositAt,
      },
      {
        id: 9,
        vaultId: 1,
        vaultAddress: userAddress,
        userAddress,
        cycleId: null,
        eventType: "withdraw_ready",
        title: "Withdrawal ready",
        detail: "ready",
        status: "ready",
        requestId: "wr-abc",
        txHash: null,
        assetAmount: "1.0",
        shareAmount: "1.0",
        metadata: null,
        occurredAt: newerUserAt,
        createdAt: newerUserAt,
      },
    ]);

    const handler = getRouteHandler("/:vaultId/events", "get");
    const req = {
      params: { vaultId: "1" },
      query: { limit: "20" },
    } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res);

    expect(mockAppendVaultLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "withdraw_ready",
        requestId: "wr-abc",
      }),
    );
    expect(mockAppendVaultLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "deposit_queued",
        status: "queued",
      }),
    );
  });
});
