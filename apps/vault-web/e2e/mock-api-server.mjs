import http from "http";

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
]);

const applyCorsHeaders = (res, origin) => {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
};

const vault = {
  id: 1,
  slug: "alpha-vault",
  name: "Alpha Vault",
  enabled: true,
  type: "custom",
  mode: "simulation",
  profile: {
    strategy: "balanced",
    strategyLabel: "Balanced",
    description: "Balanced strategy",
    longDescription: "Balanced strategy with deterministic test coverage.",
    riskLevel: "medium",
    minDeposit: 1,
    maxDeposit: 1000,
    fees: {
      management: 0.01,
      performance: 0.02,
      withdrawal: 0,
    },
    tradingMetadata: {
      assets: ["usdc"],
      platforms: ["polymarket"],
      marketType: "prediction",
    },
  },
  config: {
    vaultAddress: "0x1111111111111111111111111111111111111111",
    safeAddress: "0x2222222222222222222222222222222222222222",
  },
  intervals: {
    navRefreshMin: 15,
    reconciliationMin: 5,
    resolutionCheckMin: 10,
  },
};

const cycle = {
  success: true,
  vaultId: 1,
  cycle: {
    cycleId: 17,
    batchId: 17,
    startTime: "2026-03-27T10:00:00.000Z",
    endTime: "2026-03-27T18:00:00.000Z",
    settlementTime: "2026-03-28T10:00:00.000Z",
    isActive: true,
    isPast: false,
    timeRemainingMs: 28_800_000,
    timeRemainingFormatted: "8h",
    totalRequests: 0,
    totalShares: "0",
    totalSharesFormatted: "0",
    settled: false,
    batchState: "open",
    isCutoff: false,
    executionMode: "instant",
    telemetryFresh: true,
    liquidityMode: "vault_liquid",
    reopenReady: false,
    openPositionCount: 0,
    hasActionableWork: false,
  },
  canSettle: true,
  timeRemainingFormatted: "8h",
};

const json = (res, statusCode, body, origin) => {
  applyCorsHeaders(res, origin);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    applyCorsHeaders(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost:8081");
  const { pathname, searchParams } = url;

  if (pathname === "/vault/instances") {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return json(res, 200, { instances: [vault], total: 1 }, origin);
  }

  if (pathname === "/vault/status") {
    return json(
      res,
      200,
      {
        vaultId: vault.id,
        vaultName: vault.name,
        vaultSlug: vault.slug,
        profile: vault.profile,
        nav: {
          totalAssets: 1250,
          trackedTotalAssets: 1250,
          idleAssets: 250,
          vaultUsdc: 1250,
          safeUsdc: 1250,
          deployedCostBasis: 1000,
          redeemableCostBasis: 0,
          sharePrice: 1.025,
          positionCount: 3,
          lastUpdated: "2026-03-27T12:00:00.000Z",
        },
        positionCount: 3,
        deployedRatio: 0.8,
        totalCostBasis: 1000,
        mode: vault.mode,
        capState: null,
      },
      origin,
    );
  }

  if (pathname === "/vault/1/nav-history") {
    return json(
      res,
      200,
      {
        snapshots: [
          {
            id: 1,
            navId: "nav-1",
            totalAssets: "1250",
            idleAssets: "250",
            deployedCostBasis: "1000",
            sharePrice: "1.025",
            positionCount: 3,
            timestamp: "2026-03-27T12:00:00.000Z",
            createdAt: "2026-03-27T12:00:00.000Z",
          },
        ],
        total: 1,
      },
      origin,
    );
  }

  if (pathname === "/vault/1/positions" || pathname === "/vault/1/position-history") {
    return json(res, 200, { positions: [], total: 0 }, origin);
  }

  if (pathname === "/vault/1/trading-analytics") {
    return json(
      res,
      200,
      {
        vaultId: vault.id,
        vaultSlug: vault.slug,
        vaultName: vault.name,
        analytics: {
          vaultAddress: vault.config.vaultAddress,
          positionCount: 0,
          winCount: 0,
          lossCount: 0,
          winRate: 0,
          totalPnl: 0,
          avgPnlPerPosition: 0,
          lastResolvedAt: null,
          computedAt: "2026-03-27T12:00:00.000Z",
        },
      },
      origin,
    );
  }

  if (pathname === "/vault/withdrawal-queue") {
    return json(res, 200, { requests: [], total: 0 }, origin);
  }

  if (pathname === "/api/vaults/1/cycles/current") {
    return json(res, 200, cycle, origin);
  }

  if (pathname === "/api/vaults/1/events") {
    return json(
      res,
      200,
      {
        success: true,
        vaultId: vault.id,
        items: [],
        pagination: { limit: 50, offset: 0, hasMore: false },
      },
      origin,
    );
  }

  if (pathname === "/api/vaults/1/history") {
    return json(
      res,
      200,
      {
        success: true,
        vaultId: vault.id,
        userAddress: "0x0000000000000000000000000000000000000000",
        items: [],
        pagination: { limit: 100, offset: 0, hasMore: false },
      },
      origin,
    );
  }

  if (pathname === "/api/vaults/1/redemptions") {
    return json(
      res,
      200,
      {
        success: true,
        requests: [],
        pendingRequests: [],
        claimableRequests: [],
        totalPendingShares: "0",
        totalClaimableShares: "0",
        estimatedAssetsPendingFormatted: "0.00",
        estimatedAssetsClaimableFormatted: "0.00",
      },
      origin,
    );
  }

  if (pathname === "/api/vaults/1/deposit-queue") {
    return json(
      res,
      200,
      {
        success: true,
        vaultId: vault.id,
        userAddress: "0x0000000000000000000000000000000000000000",
        queued: "0",
        queuedFormatted: "0",
        queuedShares: "0",
        queuedSharesFormatted: "0",
        hasQueuedDeposit: false,
        cycleOpenNavEstimate: null,
        cycleOpenNavFormatted: null,
        estimateBasis: "",
        frozen: "0",
        frozenFormatted: "0",
        frozenShares: "0",
        frozenSharesFormatted: "0",
        claimableAssets: "0",
        claimableAssetsFormatted: "0",
        claimableShares: "0",
        claimableSharesFormatted: "0",
        hasProcessedDeposit: false,
        depositRequestId: null,
        depositCreatedAt: null,
        targetCycleId: 17,
        currentCycleId: 17,
        currentCycleEnd: null,
        queueStatus: "idle",
        mintRule: "",
        batchState: "open",
        timestamp: new Date().toISOString(),
      },
      origin,
    );
  }

  if (
    pathname === "/api/vaults/1/carry-eligibility" ||
    pathname === "/api/vaults/1/tranche-status"
  ) {
    return json(
      res,
      200,
      {
        success: true,
      },
      origin,
    );
  }

  if (pathname === "/health") {
    return json(res, 200, { status: "ok", service: "mock-api", uptime: 1 }, origin);
  }

  return json(
    res,
    404,
    {
      error: `Unhandled mock path: ${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`,
    },
    origin,
  );
});

server.listen(8081, "127.0.0.1", () => {
  process.stdout.write("Mock API listening on 8081\n");
});
