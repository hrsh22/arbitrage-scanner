import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface NavHealthMock {
  stale: boolean;
  lastUpdateTime: Date;
  secondsSinceUpdate: number;
  thresholdSeconds: number;
  onChainTotalCostBasis: string;
}

interface ReconciliationResultMock {
  action: "none" | "allocated" | "deallocated" | "settled";
  amount?: number;
  details: string;
  vaultBalance: number;
  safeBalance: number;
  pendingWithdrawals: number;
}

interface WorkerHarnessOptions {
  navHealthResponses: Array<NavHealthMock | Error>;
  needsNavRefreshForActionableWork?: boolean;
  reconciliationResult?: ReconciliationResultMock;
  navRefreshError?: Error;
  vaultContractType?: "closedBookBatchVault" | "flatBookVaultV2";
  lifecycleDecision?: {
    riskState: "flat" | "risk_on" | "unknown";
    action: "none" | "close_book" | "process_queue" | "reopen_idle_cycle";
    batchStatus: string;
    hasActionableWork: boolean;
    reason: string;
  };
}

interface WorkerHarness {
  calculateAndPushNav: any;
  getNavHealth: any;
  runReconciliation: any;
  evaluateFlatBookLifecycle: any;
  needsNavRefreshForActionableWork: any;
  closeBook: any;
  processQueue: any;
  reopenIdleCycle: any;
  allocateToTradingWallet: any;
}

interface PreflightHarness {
  liquidityManager: any;
  readContract: ReturnType<typeof vi.fn>;
  recallWithdrawalLiquidityOnDemand: ReturnType<typeof vi.fn>;
}

interface ReadyQueueHarness {
  liquidityManager: any;
  markReadyIdempotent: ReturnType<typeof vi.fn>;
  updateAssetsEstimated: ReturnType<typeof vi.fn>;
}

function navHealth(stale: boolean): NavHealthMock {
  return {
    stale,
    lastUpdateTime: new Date("2026-01-01T00:00:00.000Z"),
    secondsSinceUpdate: stale ? 10_000 : 5,
    thresholdSeconds: 3_600,
    onChainTotalCostBasis: "0",
  };
}

function defaultResult(): ReconciliationResultMock {
  return {
    action: "none",
    details: "No action",
    vaultBalance: 0,
    safeBalance: 0,
    pendingWithdrawals: 0,
  };
}

async function bootWorkerHarness(options: WorkerHarnessOptions): Promise<WorkerHarness> {
  vi.resetModules();

  const calculateAndPushNav = options.navRefreshError
    ? vi.fn().mockRejectedValue(options.navRefreshError)
    : vi.fn().mockResolvedValue({
        updatedOnChain: true,
        oldValue: "0",
        newValue: "1",
        delta: "1",
      });
  const closeBook = vi.fn().mockResolvedValue({ success: true });
  const processQueue = vi.fn().mockResolvedValue({ success: true });
  const reopenIdleCycle = vi.fn().mockResolvedValue({ success: true });
  const allocateToTradingWallet = vi.fn().mockResolvedValue({ success: true });

  const queue = [...options.navHealthResponses];
  const getNavHealth = vi.fn(async () => {
    const next = queue.shift() ?? navHealth(false);
    if (next instanceof Error) throw next;
    return next;
  });

  const runReconciliation = vi
    .fn()
    .mockResolvedValue(options.reconciliationResult ?? defaultResult());
  const evaluateFlatBookLifecycle = vi.fn().mockResolvedValue(
    options.lifecycleDecision ?? {
      riskState: "flat",
      action: "none",
      batchStatus: "open",
      hasActionableWork: false,
      reason: "flat_open",
    },
  );
  const needsNavRefreshForActionableWork = vi
    .fn()
    .mockResolvedValue(options.needsNavRefreshForActionableWork ?? false);

  vi.doMock("../startupValidation.js", () => ({
    runStartupValidationOrExit: vi.fn().mockResolvedValue(undefined),
  }));

  vi.doMock("../logger.js", () => ({
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  vi.doMock("../env.js", () => ({
    env: {
      VAULT_MODE: "live",
      VAULT_NETWORK: "amoy",
      LIQUIDITY_EMERGENCY_STOP: false,
      LIQUIDITY_PAUSE: false,
      LIQUIDITY_DRY_RUN: false,
    },
    isTradingEnabled: vi.fn(() => true),
  }));

  vi.doMock("../config/index.js", () => ({
    getEnabledVaultConfigs: vi.fn(() => [
      {
        id: 1,
        name: "flatbook-test",
        enabled: true,
        type: "custom",
        vaultContractType: options.vaultContractType ?? "flatBookVaultV2",
        navRefreshIntervalMin: 1,
        reconciliationIntervalMin: 1,
      },
    ]),
    resolveVaultIdentity: vi.fn(() => ({
      vaultAddress: "0x1234567890123456789012345678901234567890",
      safeAddress: "0x0987654321098765432109876543210987654321",
      allocatorNavSignerKey: `0x${"1".repeat(64)}`,
      safeOperatorKey: `0x${"2".repeat(64)}`,
      tradingSignerKey: `0x${"3".repeat(64)}`,
      tradingFunderAddress: "0x1111111111111111111111111111111111111111",
      tradingSignatureType: 2,
      vaultId: 1,
      vaultName: "flatbook-test",
    })),
  }));

  vi.doMock("../services/navOracle.js", () => ({
    NavOracleService: vi.fn(),
    createNavOracle: vi.fn(() => ({ calculateAndPushNav, getNavHealth })),
  }));

  vi.doMock("../services/liquidityManager.js", () => ({
    LiquidityManager: vi.fn(),
    createLiquidityManager: vi.fn(() => ({
      runReconciliation,
      evaluateFlatBookLifecycle,
      needsNavRefreshForActionableWork,
      closeBook,
      processQueue,
      reopenIdleCycle,
      allocateToTradingWallet,
    })),
  }));

  vi.doMock("../services/pendingTxRegistry.js", () => ({
    pendingTxRegistry: {
      stop: vi.fn(),
    },
  }));

  vi.spyOn(globalThis, "setInterval").mockImplementation(
    (() => ({}) as NodeJS.Timeout) as unknown as typeof setInterval,
  );
  vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

  await import("../worker.js");

  return {
    calculateAndPushNav,
    getNavHealth,
    runReconciliation,
    evaluateFlatBookLifecycle,
    needsNavRefreshForActionableWork,
    closeBook,
    processQueue,
    reopenIdleCycle,
    allocateToTradingWallet,
  };
}

async function bootPreflightHarness(options: {
  lifecycleDecision: {
    riskState: "flat" | "risk_on" | "unknown";
    action: "none" | "close_book" | "process_queue" | "reopen_idle_cycle";
    batchStatus: string;
    hasActionableWork: boolean;
    reason: string;
    executionMode: "instant" | "queued" | "blocked";
    telemetryFresh: boolean;
    openPositionCount: number | null;
    liquidityMode: "vault_liquid" | "recall_required" | "queued_only";
    reopenReady: boolean;
  };
  useRealLifecycleEvaluation?: boolean;
  pendingWithdrawalLiability?: bigint;
  recallResult?: {
    success: boolean;
    action: "none" | "deallocated" | "allocated";
    amount: bigint;
    requiredVaultBalance: bigint;
    queuedAssets: bigint;
    reservedRedemptionAssets: bigint;
    pendingWithdrawalLiability: bigint;
    details: string;
    txHash?: string;
    error?: string;
  };
}): Promise<PreflightHarness> {
  vi.resetModules();
  vi.doUnmock("../services/liquidityManager.js");

  const readContract = vi.fn();
  const recallWithdrawalLiquidityOnDemand = vi.fn().mockResolvedValue(
    options.recallResult ?? {
      success: true,
      action: "deallocated",
      amount: 1000000n,
      requiredVaultBalance: 2000000n,
      queuedAssets: 0n,
      reservedRedemptionAssets: 0n,
      pendingWithdrawalLiability: 2000000n,
      details: "recall ok",
      txHash: "0xrecall",
    },
  );

  vi.doMock("viem", async () => {
    const actual = await vi.importActual<typeof import("viem")>("viem");
    return {
      ...actual,
      createPublicClient: vi.fn(() => ({ readContract })),
    };
  });

  vi.doMock("../services/vaultProviderFactory.js", () => ({
    getVaultProvider: vi.fn(() => ({
      providerType: "custom",
      getVaultInfo: vi.fn().mockResolvedValue({
        batchInfo: {
          currentBatchId: 1,
          currentBatchStatus: options.lifecycleDecision.batchStatus,
        },
      }),
      hasActionableBatchWork: vi
        .fn()
        .mockResolvedValue(options.lifecycleDecision.hasActionableWork),
      estimatePendingWithdrawalLiability: vi
        .fn()
        .mockResolvedValue(options.pendingWithdrawalLiability ?? 2000000n),
      recallWithdrawalLiquidityOnDemand,
      closeBook: vi.fn(),
      processQueue: vi.fn(),
      reopenIdleCycle: vi.fn(),
      runReconciliation: vi.fn(),
    })),
  }));

  vi.doMock("../services/flatnessDetector.js", () => ({
    FlatnessDetector: vi.fn().mockImplementation(() => ({
      checkFlatness: vi.fn().mockResolvedValue({
        isFlat: true,
        allConditionsPassed: true,
        conditions: [],
        blockingConditions: [],
        timestamp: new Date(),
        vaultId: 1,
      }),
    })),
  }));

  vi.doMock("../config/network.js", () => ({
    getNetworkConfigFromEnv: vi.fn(() => ({
      chain: { id: 137 },
      chainId: 137,
      name: "amoy",
      explorerBaseUrl: "https://polygonscan.com",
      supportsPolymarketTrading: false,
      addresses: {
        usdcE: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        ctf: "0x0000000000000000000000000000000000000001",
        ctfExchange: "0x0000000000000000000000000000000000000002",
        negRiskCtfExchange: "0x0000000000000000000000000000000000000003",
        negRiskAdapter: "0x0000000000000000000000000000000000000004",
        vaultV2Factory: "0x0000000000000000000000000000000000000005",
      },
    })),
    getRpcUrlForNetwork: vi.fn(() => "https://rpc.example"),
  }));

  vi.doMock("../rpcTransport.js", () => ({
    createNetworkTransport: vi.fn(() => ({})),
  }));

  vi.doMock("../config/index.js", () => ({
    getVaultConfig: vi.fn(() => null),
  }));

  vi.doMock("../env.js", () => ({
    env: {
      VAULT_ADDRESS: "0x1234567890123456789012345678901234567890",
      SAFE_ADDRESS: "0x0987654321098765432109876543210987654321",
    },
  }));

  vi.doMock("../logger.js", () => ({
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  const { LiquidityManager } = await import("../services/liquidityManager.js");
  const liquidityManager = new LiquidityManager({
    config: {
      id: 1,
      vaultAddress: "0x1234567890123456789012345678901234567890",
      safeAddress: "0x0987654321098765432109876543210987654321",
    } as any,
    vaultId: 1,
  });

  if (!options.useRealLifecycleEvaluation) {
    vi.spyOn(liquidityManager, "evaluateFlatBookLifecycle").mockResolvedValue(
      options.lifecycleDecision,
    );
  }

  return {
    liquidityManager,
    readContract,
    recallWithdrawalLiquidityOnDemand,
  };
}

async function bootReadyQueueHarness(): Promise<ReadyQueueHarness> {
  vi.resetModules();

  const readContract = vi.fn().mockResolvedValue(5_000_000n);
  const markReadyIdempotent = vi.fn().mockResolvedValue({ success: true });
  const updateAssetsEstimated = vi.fn().mockResolvedValue({});

  vi.doMock("viem", async () => {
    const actual = await vi.importActual<typeof import("viem")>("viem");
    return {
      ...actual,
      createPublicClient: vi.fn(() => ({ readContract })),
    };
  });

  vi.doMock("../repositories/withdrawalRepository.js", async () => {
    const actual = await vi.importActual<typeof import("../repositories/withdrawalRepository.js")>(
      "../repositories/withdrawalRepository.js",
    );
    return {
      ...actual,
      withdrawalRepository: {
        getPendingRequests: vi.fn().mockResolvedValue([
          {
            requestId: "wr-1",
            shares: "1.000000",
            assetsEstimated: "0.500000",
          },
        ]),
        getReadyRequests: vi.fn().mockResolvedValue([]),
        markReadyIdempotent,
        updateAssetsEstimated,
      },
    };
  });

  vi.doMock("../services/vaultProviderFactory.js", () => ({
    getVaultProvider: vi.fn(() => ({
      providerType: "custom",
      getVaultInfo: vi.fn().mockResolvedValue({
        navIsStale: false,
        batchInfo: {
          currentBatchId: 1,
          currentBatchStatus: "open",
        },
      }),
      hasActionableBatchWork: vi.fn().mockResolvedValue(false),
      estimatePendingWithdrawalLiability: vi.fn().mockResolvedValue(1_000_000n),
      getCurrentNav: vi.fn().mockResolvedValue(1_000_000_000_000_000_000n),
    })),
  }));

  vi.doMock("../services/flatnessDetector.js", () => ({
    FlatnessDetector: vi.fn().mockImplementation(() => ({
      checkFlatness: vi.fn().mockResolvedValue({
        isFlat: true,
        allConditionsPassed: true,
        conditions: [],
        blockingConditions: [],
        timestamp: new Date(),
        vaultId: 1,
      }),
    })),
  }));

  vi.doMock("../config/network.js", () => ({
    getNetworkConfigFromEnv: vi.fn(() => ({
      chain: { id: 137 },
      chainId: 137,
      name: "amoy",
      explorerBaseUrl: "https://polygonscan.com",
      supportsPolymarketTrading: false,
      addresses: {
        usdcE: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      },
    })),
    getRpcUrlForNetwork: vi.fn(() => "https://rpc.example"),
  }));

  vi.doMock("../rpcTransport.js", () => ({
    createNetworkTransport: vi.fn(() => ({})),
  }));

  vi.doMock("../config/index.js", () => ({
    getVaultConfig: vi.fn(() => null),
  }));

  vi.doMock("../env.js", () => ({
    env: {
      VAULT_ADDRESS: "0x1234567890123456789012345678901234567890",
      SAFE_ADDRESS: "0x0987654321098765432109876543210987654321",
    },
  }));

  vi.doMock("../logger.js", () => ({
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  const { LiquidityManager } = await import("../services/liquidityManager.js");
  const liquidityManager = new LiquidityManager({
    config: {
      id: 1,
      vaultAddress: "0x1234567890123456789012345678901234567890",
      safeAddress: "0x0987654321098765432109876543210987654321",
    } as any,
    vaultId: 1,
  });

  vi.spyOn(liquidityManager, "evaluateFlatBookLifecycle").mockResolvedValue({
    riskState: "flat",
    action: "none",
    batchStatus: "open",
    hasActionableWork: false,
    reason: "flat_open",
    executionMode: "instant",
    telemetryFresh: true,
    openPositionCount: 0,
    liquidityMode: "vault_liquid",
    reopenReady: false,
  });

  return {
    liquidityManager,
    markReadyIdempotent,
    updateAssetsEstimated,
  };
}

describe("worker flat-book lifecycle decision table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stale telemetry blocks transitions", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [new Error("telemetry fetch failed")],
      needsNavRefreshForActionableWork: true,
      lifecycleDecision: {
        riskState: "unknown",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "telemetry_error",
      },
    });

    expect(h.runReconciliation).not.toHaveBeenCalled();
    expect(h.closeBook).not.toHaveBeenCalled();
    expect(h.processQueue).not.toHaveBeenCalled();
    expect(h.reopenIdleCycle).not.toHaveBeenCalled();
  });

  it("risk on closes and queues", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [navHealth(false)],
      needsNavRefreshForActionableWork: false,
      lifecycleDecision: {
        riskState: "risk_on",
        action: "close_book",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "risk_on",
      },
    });

    expect(h.closeBook).toHaveBeenCalledTimes(1);
    expect(h.processQueue).not.toHaveBeenCalled();
    expect(h.reopenIdleCycle).not.toHaveBeenCalled();
    expect(h.calculateAndPushNav).not.toHaveBeenCalled();
  });

  it("fully flat + queued work publishes NAV once, then process queue", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [navHealth(false)],
      needsNavRefreshForActionableWork: false,
      lifecycleDecision: {
        riskState: "flat",
        action: "process_queue",
        batchStatus: "closed",
        hasActionableWork: true,
        reason: "flat_with_queue",
      },
    });

    expect(h.calculateAndPushNav).toHaveBeenCalledTimes(1);
    expect(h.processQueue).toHaveBeenCalledTimes(1);
    expect(h.reopenIdleCycle).not.toHaveBeenCalled();
  });

  it("fully flat + empty queue while Closed publishes NAV once, then reopenIdleCycle", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [navHealth(false)],
      needsNavRefreshForActionableWork: false,
      lifecycleDecision: {
        riskState: "flat",
        action: "reopen_idle_cycle",
        batchStatus: "closed",
        hasActionableWork: false,
        reason: "flat_empty_queue_closed",
      },
    });

    expect(h.calculateAndPushNav).toHaveBeenCalledTimes(1);
    expect(h.reopenIdleCycle).toHaveBeenCalledTimes(1);
    expect(h.processQueue).not.toHaveBeenCalled();
  });

  it("nav refresh failure blocks queue processing", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [navHealth(false)],
      navRefreshError: new Error("nav failed"),
      lifecycleDecision: {
        riskState: "flat",
        action: "process_queue",
        batchStatus: "closed",
        hasActionableWork: true,
        reason: "flat_with_queue",
      },
    });

    expect(h.calculateAndPushNav).toHaveBeenCalledTimes(1);
    expect(h.processQueue).not.toHaveBeenCalled();
  });

  it("nav refresh failure blocks idle reopen", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [navHealth(false)],
      navRefreshError: new Error("nav failed"),
      lifecycleDecision: {
        riskState: "flat",
        action: "reopen_idle_cycle",
        batchStatus: "closed",
        hasActionableWork: false,
        reason: "flat_empty_queue_closed",
      },
    });

    expect(h.calculateAndPushNav).toHaveBeenCalledTimes(1);
    expect(h.reopenIdleCycle).not.toHaveBeenCalled();
  });

  it("fully flat + already Open avoids periodic NAV write and forced transition", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [navHealth(false)],
      needsNavRefreshForActionableWork: false,
      lifecycleDecision: {
        riskState: "flat",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "flat_already_open",
      },
      reconciliationResult: {
        action: "none",
        details: "flat_already_open",
        vaultBalance: 40,
        safeBalance: 60,
        pendingWithdrawals: 0,
      },
    });

    expect(h.calculateAndPushNav).not.toHaveBeenCalled();
    expect(h.closeBook).not.toHaveBeenCalled();
    expect(h.processQueue).not.toHaveBeenCalled();
    expect(h.reopenIdleCycle).not.toHaveBeenCalled();
    expect(h.runReconciliation).toHaveBeenCalledTimes(1);
  });

  it("allocation is not lifecycle trigger", async () => {
    const h = await bootWorkerHarness({
      navHealthResponses: [navHealth(false)],
      needsNavRefreshForActionableWork: false,
      lifecycleDecision: {
        riskState: "flat",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "allocation_only",
      },
      reconciliationResult: {
        action: "allocated",
        details: "allocation_only",
        amount: 1,
        vaultBalance: 100,
        safeBalance: 100,
        pendingWithdrawals: 0,
      },
    });

    expect(h.runReconciliation).toHaveBeenCalledTimes(1);
    expect(h.closeBook).not.toHaveBeenCalled();
    expect(h.reopenIdleCycle).not.toHaveBeenCalled();
  });

  it("flatBookVaultV2 keeps idle reconciliation running when NAV is stale", async () => {
    const h = await bootWorkerHarness({
      vaultContractType: "flatBookVaultV2",
      navHealthResponses: [navHealth(true)],
      needsNavRefreshForActionableWork: false,
      lifecycleDecision: {
        riskState: "flat",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "flat_already_open",
      },
      reconciliationResult: {
        action: "allocated",
        details: "idle_allocation",
        amount: 2,
        vaultBalance: 2,
        safeBalance: 0,
        pendingWithdrawals: 0,
      },
    });

    expect(h.calculateAndPushNav).not.toHaveBeenCalled();
    expect(h.runReconciliation).toHaveBeenCalledTimes(1);
  });
});

it("flatBookVaultV2 startup NAV refresh is suppressed during flat/open idle", async () => {
  // Override vault config to simulate a FlatBookV2 vault in custom type
  vi.doMock("../config/index.js", () => ({
    getEnabledVaultConfigs: vi.fn(() => [
      {
        id: 1,
        name: "flatbook-v2-startup-test",
        enabled: true,
        type: "custom",
        vaultContractType: "flatBookVaultV2",
        navRefreshIntervalMin: 1,
        reconciliationIntervalMin: 1,
      },
    ]),
    resolveVaultIdentity: vi.fn(() => ({
      vaultAddress: "0x1234567890123456789012345678901234567890",
      safeAddress: "0x0987654321098765432109876543210987654321",
      allocatorNavSignerKey: `0x${"1".repeat(64)}`,
      safeOperatorKey: `0x${"2".repeat(64)}`,
      tradingSignerKey: `0x${"3".repeat(64)}`,
      tradingFunderAddress: "0x1111111111111111111111111111111111111111",
      tradingSignatureType: 2,
      vaultId: 1,
      vaultName: "flatbook-v2-startup-test",
    })),
  }));

  const h = await bootWorkerHarness({
    navHealthResponses: [navHealth(false)],
    needsNavRefreshForActionableWork: false,
    lifecycleDecision: {
      riskState: "flat",
      action: "none",
      batchStatus: "open",
      hasActionableWork: false,
      reason: "flat_already_open",
    },
  });

  expect(h.calculateAndPushNav).not.toHaveBeenCalled();
});

describe("instant withdraw preflight", () => {
  it("flat withdraw triggers recall only on demand", async () => {
    const h = await bootPreflightHarness({
      lifecycleDecision: {
        riskState: "flat",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "flat_open",
        executionMode: "instant",
        telemetryFresh: true,
        openPositionCount: 0,
        liquidityMode: "vault_liquid",
        reopenReady: false,
      },
    });

    h.readContract
      .mockResolvedValueOnce(1000000n)
      .mockResolvedValueOnce(5000000n)
      .mockResolvedValueOnce(2000000n);

    const needsRecall = await h.liquidityManager.preflightInstantWithdrawal(2000000n);
    expect(needsRecall.ready).toBe(true);
    expect(needsRecall.triggeredRecall).toBe(true);
    expect(h.recallWithdrawalLiquidityOnDemand).toHaveBeenCalledTimes(1);

    h.readContract.mockReset().mockResolvedValueOnce(3000000n).mockResolvedValueOnce(5000000n);

    const noRecallNeeded = await h.liquidityManager.preflightInstantWithdrawal(500000n);
    expect(noRecallNeeded.ready).toBe(true);
    expect(noRecallNeeded.triggeredRecall).toBe(false);
    expect(h.recallWithdrawalLiquidityOnDemand).toHaveBeenCalledTimes(1);
  });

  it("preflight subtracts other reserved withdrawal liabilities before declaring ready", async () => {
    const h = await bootPreflightHarness({
      pendingWithdrawalLiability: 4_000_000n,
      lifecycleDecision: {
        riskState: "flat",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "flat_open",
        executionMode: "instant",
        telemetryFresh: true,
        openPositionCount: 0,
        liquidityMode: "recall_required",
        reopenReady: false,
      },
    });

    h.readContract
      .mockResolvedValueOnce(2_000_000n)
      .mockResolvedValueOnce(5_000_000n)
      .mockResolvedValueOnce(4_000_000n);

    const preflight = await h.liquidityManager.preflightInstantWithdrawal(2_000_000n);
    expect(preflight.ready).toBe(true);
    expect(preflight.triggeredRecall).toBe(true);
    expect(h.recallWithdrawalLiquidityOnDemand).toHaveBeenCalledTimes(1);
    expect(h.recallWithdrawalLiquidityOnDemand).toHaveBeenCalledWith({
      vaultUsdcBalance: 2_000_000n,
      safeUsdcBalance: 5_000_000n,
      requiredAssets: 4_000_000n,
    });
  });

  it("evaluateFlatBookLifecycle marks recall_required when vault cash is below pending liability", async () => {
    const h = await bootPreflightHarness({
      useRealLifecycleEvaluation: true,
      lifecycleDecision: {
        riskState: "flat",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "flat_open",
        executionMode: "instant",
        telemetryFresh: true,
        openPositionCount: 0,
        liquidityMode: "vault_liquid",
        reopenReady: false,
      },
    });

    h.readContract.mockResolvedValueOnce(1000000n).mockResolvedValueOnce(5000000n);
    const lifecycle = await h.liquidityManager.evaluateFlatBookLifecycle();
    expect(lifecycle.executionMode).toBe("instant");
    expect(lifecycle.liquidityMode).toBe("recall_required");
  });

  it("evaluateFlatBookLifecycle marks recall_required when vault has no idle cash but trading wallet is funded", async () => {
    const h = await bootPreflightHarness({
      useRealLifecycleEvaluation: true,
      pendingWithdrawalLiability: 0n,
      lifecycleDecision: {
        riskState: "flat",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "flat_open",
        executionMode: "instant",
        telemetryFresh: true,
        openPositionCount: 0,
        liquidityMode: "vault_liquid",
        reopenReady: false,
      },
    });

    h.readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(5000000n);
    const lifecycle = await h.liquidityManager.evaluateFlatBookLifecycle();
    expect(lifecycle.executionMode).toBe("instant");
    expect(lifecycle.liquidityMode).toBe("recall_required");
  });

  it("unknown telemetry blocks instant withdraw", async () => {
    const h = await bootPreflightHarness({
      lifecycleDecision: {
        riskState: "unknown",
        action: "none",
        batchStatus: "open",
        hasActionableWork: false,
        reason: "telemetry_error",
        executionMode: "blocked",
        telemetryFresh: false,
        openPositionCount: null,
        liquidityMode: "queued_only",
        reopenReady: false,
      },
    });

    h.readContract.mockResolvedValueOnce(1000000n).mockResolvedValueOnce(5000000n);

    const preflight = await h.liquidityManager.preflightInstantWithdrawal(2000000n);
    expect(preflight.ready).toBe(false);
    expect(preflight.mode).toBe("queued");
    expect(preflight.executionMode).toBe("blocked");
    expect(preflight.telemetryFresh).toBe(false);
    expect(h.recallWithdrawalLiquidityOnDemand).not.toHaveBeenCalled();
  });
});

describe("worker-owned withdrawal readiness", () => {
  it("marks the FIFO head request ready while flat/open with enough liquidity", async () => {
    const h = await bootReadyQueueHarness();

    const result = await h.liquidityManager.markPendingWithdrawalsReady({
      vaultInfo: {
        navIsStale: false,
        batchInfo: {
          currentBatchId: 1,
          currentBatchStatus: "open",
        },
      },
      vaultBalance: 5_000_000n,
      safeBalance: 0n,
      pendingWithdrawalsCount: 1,
    });

    expect(h.updateAssetsEstimated).toHaveBeenCalledWith(
      "wr-1",
      "1",
      expect.objectContaining({ reason: "worker_ready_refresh", source: "worker_queue" }),
    );
    expect(h.markReadyIdempotent).toHaveBeenCalledWith("wr-1");
    expect(result).toMatchObject({ action: "marked_ready", amount: 1 });
  });
});
