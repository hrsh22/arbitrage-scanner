import { describe, expect, it, vi } from "vitest";

const { mockExecuteRawTransaction } = vi.hoisted(() => ({
  mockExecuteRawTransaction: vi.fn().mockResolvedValue({ success: true, txHash: "0xsafe" }),
}));

const { mockGetPendingRequests, mockGetReadyRequests } = vi.hoisted(() => ({
  mockGetPendingRequests: vi.fn().mockResolvedValue([]),
  mockGetReadyRequests: vi.fn().mockResolvedValue([]),
}));

const { mockListDepositParticipantAddresses, mockEnsureQueueParticipant } = vi.hoisted(() => ({
  mockListDepositParticipantAddresses: vi.fn().mockResolvedValue([]),
  mockEnsureQueueParticipant: vi.fn().mockResolvedValue(undefined),
}));

const mockVaultInstanceConfig = {
  id: 1,
  name: "test-vault",
  enabled: true,
  type: "custom",
  vaultContractType: "flatBookVaultV2",
  network: "amoy",
  vaultAddress: "0x1234567890123456789012345678901234567890",
  safeAddress: "0x0987654321098765432109876543210987654321",
  allocatorNavSignerKeyEnv: "TEST_ALLOCATOR_KEY",
  safeOperatorKeyEnv: "TEST_SAFE_KEY",
  tradingSignerKeyEnv: "TEST_TRADING_KEY",
  settlerKeyEnv: "TEST_SETTLER_KEY",
  tradingSignatureType: 2,
  customVaultConfig: {
    epochDurationSeconds: 3600,
    navStalenessThresholdSeconds: 3600,
    minClaimThresholdUsdc: 1000000,
    balancedUpfrontBps: 0,
  },
  betSize: 1,
  dailyBudget: Infinity,
  minOdds: 0.9,
  maxOdds: 0.995,
  maxHoursGeneral: 1,
  maxHoursForHighOdds: 1,
  highOddsThreshold: 0.99,
  marketFetchMaxEvents: 10,
  categoryTimeLimits: {
    crypto: 1,
  },
  skipCategories: [],
  minWalletReserve: 0,
  maxDailyLoss: Infinity,
  enableEarlyExit: true,
  earlyExitMinPrice: 0.9995,
  useMarketOrders: true,
  vaultReserveUsdc: 0,
  minAllocationAmountUsdc: 1,
  maxDeployedRatio: 1,
  autoLiquidityManagement: true,
  enforceEpochBoundarySafety: true,
  epochBoundarySafetyBufferMinutes: 5,
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
  navRefreshIntervalMin: 2,
  reconciliationIntervalMin: 2,
  tradingScanIntervalMin: 1,
  resolutionCheckIntervalMin: 5,
  defaultMode: "live",
} as const;

const mockMaintenanceKey = "0x1111111111111111111111111111111111111111111111111111111111111111";

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../config/index.js", () => ({
  getVaultConfig: vi.fn(() => mockVaultInstanceConfig),
}));

vi.mock("../config/network.js", () => ({
  // Provide a complete mock network config to satisfy constants.ts imports
  getNetworkConfigFromEnv: vi.fn(() => ({
    name: "amoy",
    chain: { id: 80002 },
    // Minimal addresses surface needed by vault constants
    addresses: {
      usdcE: "0x1111111111111111111111111111111111111111",
      collateral: "0x1111111111111111111111111111111111111111",
      collateralSymbol: "pUSD",
      collateralDecimals: 6,
      legacyUsdcE: "0x1111111111111111111111111111111111111111",
      collateralOnramp: "0x7777777777777777777777777777777777777777",
      collateralOfframp: "0x8888888888888888888888888888888888888888",
      ctf: "0x2222222222222222222222222222222222222222",
      ctfExchange: "0x3333333333333333333333333333333333333333",
      negRiskCtfExchange: "0x4444444444444444444444444444444444444444",
      negRiskAdapter: "0x5555555555555555555555555555555555555555",
      vaultV2Factory: "0x6666666666666666666666666666666666666666",
    },
  })),
  getRpcUrlForNetwork: vi.fn(() => "https://rpc.example.test"),
  getRpcUrlsForNetwork: vi.fn(() => ["https://rpc.example.test"]),
}));

vi.mock("../services/customVaultClient.js", async () => {
  const actual = await vi.importActual<typeof import("../services/customVaultClient.js")>(
    "../services/customVaultClient.js",
  );

  return {
    ...actual,
    createCustomVaultClient: vi.fn(() => ({})),
  };
});

vi.mock("../services/flatnessDetector.js", () => ({
  FlatnessDetector: vi.fn().mockImplementation(() => ({
    checkFlatness: vi.fn().mockResolvedValue({
      isFlat: true,
      blockingConditions: [],
    }),
  })),
}));

vi.mock("../services/safeWallet.js", () => ({
  SafeWalletService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    transferToken: vi.fn().mockResolvedValue({ success: true, txHash: "0xmock" }),
    executeRawTransaction: mockExecuteRawTransaction,
  })),
}));

vi.mock("../repositories/withdrawalRepository.js", () => ({
  withdrawalRepository: {
    getPendingRequests: mockGetPendingRequests,
    getReadyRequests: mockGetReadyRequests,
  },
}));

vi.mock("../repositories/flatBookStateRepository.js", () => ({
  flatBookStateRepository: {
    listDepositParticipantAddresses: mockListDepositParticipantAddresses,
    ensureQueueParticipant: mockEnsureQueueParticipant,
    upsertCycle: vi.fn().mockResolvedValue(undefined),
    getQueueParticipant: vi.fn().mockResolvedValue(null),
    markDepositProcessed: vi.fn().mockResolvedValue(undefined),
    recordProcessingEvent: vi.fn().mockResolvedValue(undefined),
    recordQueuedDeposit: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CustomVaultProvider } from "../services/customVaultProvider.js";
import type { BatchData, CustomVaultClient } from "../services/customVaultClient.js";
import { SafeWalletService } from "../services/safeWallet.js";

function makeBatch(overrides: Partial<BatchData>): BatchData {
  return {
    batchId: 0n,
    startTime: 0n,
    endTime: 0n,
    cutoffTime: 0n,
    snapshotNAV: 0n,
    lockedClearingPrice: 0n,
    snapshotTimestamp: 0n,
    totalSharesPending: 0n,
    totalAssetsSnapshot: 0n,
    proRataRatio: 1000000000000000000n,
    totalQueuedDeposits: 0n,
    status: "open",
    isPriceLocked: false,
    ...overrides,
  };
}

describe("CustomVaultProvider settlement readiness", () => {
  it("reserves claimable processed deposits during capital rebalancing", async () => {
    mockListDepositParticipantAddresses.mockResolvedValueOnce([
      "0x00000000000000000000000000000000000000aa",
    ]);

    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(3n),
      getCycleParticipants: vi.fn().mockResolvedValue({
        depositParticipants: ["0x00000000000000000000000000000000000000aa"],
        redeemParticipants: [],
      }),
      getClaimableDepositAssets: vi.fn().mockResolvedValue(1_000_000n),
      getClaimableDepositShares: vi.fn().mockResolvedValue(617_239n),
      getTotalQueuedAssets: vi.fn().mockResolvedValue(0n),
      getReservedRedemptionAssets: vi.fn().mockResolvedValue(0n),
      getMaxAllocatableAssets: vi.fn().mockResolvedValue(5_000_000n),
      getAdminRole: vi.fn().mockResolvedValue("0xadminrole"),
      hasRole: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      allocateToTradingWallet: vi.fn(),
    };

    const provider = new CustomVaultProvider(
      {
        vaultId: 1,
        vaultAddress: "0x1234567890123456789012345678901234567890",
        providerType: "custom",
      },
      {
        adminKey: mockMaintenanceKey,
        safeOperatorKey: mockMaintenanceKey,
      },
    );

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(
      provider.rebalanceCapital({
        vaultUsdcBalance: 5_000_000n,
        safeUsdcBalance: 0n,
        pendingWithdrawalLiability: 0n,
      }),
    ).resolves.toMatchObject({
      success: true,
      action: "allocated",
      amount: 4_000_000n,
      txHash: "0xsafe",
    });
  });

  it("surfaces pending queue state separately from aggregated claimable balance", async () => {
    const mockClient = {
      getControllerRedemptionState: vi.fn().mockResolvedValue({
        currentCycle: 7n,
        pendingShares: 200000n,
        claimableShares: 1000000n,
        claimableAssets: 1000000n,
      }),
    };

    const provider = new CustomVaultProvider(
      {
        vaultId: 1,
        vaultAddress: "0x1234567890123456789012345678901234567890",
        providerType: "custom",
      },
      mockMaintenanceKey,
    );

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    const state = await provider.getUserRedemptionState(
      "0x00000000000000000000000000000000000000aa",
    );

    expect(state.pendingRequests).toHaveLength(1);
    expect(state.claimableRequests).toHaveLength(1);
    expect(state.pendingRequests[0]?.requestId).toContain("pending-");
    expect(state.claimableRequests[0]?.requestId).toContain("claimable-");
    expect(state.pendingRequests[0]?.shares).toBe(200000n);
    expect(state.claimableRequests[0]?.assetsActual).toBe(1000000n);
  });

  it("allocates via trading safe when the safe holds ADMIN_ROLE", async () => {
    mockExecuteRawTransaction.mockResolvedValueOnce({ success: true, txHash: "0xsafe" });

    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(3n),
      getCycleParticipants: vi.fn().mockResolvedValue({
        depositParticipants: [],
        redeemParticipants: [],
      }),
      getClaimableDepositAssets: vi.fn().mockResolvedValue(0n),
      getClaimableDepositShares: vi.fn().mockResolvedValue(0n),
      getTotalQueuedAssets: vi.fn().mockResolvedValue(0n),
      getReservedRedemptionAssets: vi.fn().mockResolvedValue(0n),
      getMaxAllocatableAssets: vi.fn().mockResolvedValue(5_000_000n),
      getAdminRole: vi.fn().mockResolvedValue("0xadminrole"),
      hasRole: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      allocateToTradingWallet: vi.fn(),
    };

    const provider = new CustomVaultProvider(
      {
        vaultId: 1,
        vaultAddress: "0x1234567890123456789012345678901234567890",
        providerType: "custom",
      },
      {
        adminKey: mockMaintenanceKey,
        safeOperatorKey: mockMaintenanceKey,
      },
    );

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(
      provider.rebalanceCapital({
        vaultUsdcBalance: 5_000_000n,
        safeUsdcBalance: 0n,
        pendingWithdrawalLiability: 0n,
      }),
    ).resolves.toMatchObject({
      success: true,
      action: "allocated",
      amount: 5_000_000n,
      txHash: "0xsafe",
    });

    expect(mockClient.allocateToTradingWallet).not.toHaveBeenCalled();
    expect(mockExecuteRawTransaction).toHaveBeenCalledWith(
      "0x1234567890123456789012345678901234567890",
      expect.stringMatching(/^0x/),
      "0",
    );
  });

  it("treats next-batch queued deposits as actionable work for current batch advancement", async () => {
    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(0n),
      getNAVStatus: vi.fn().mockResolvedValue({
        currentNAV: 1000000000000000000n,
        lastNAVUpdate: 1700000000n,
        isFresh: true,
      }),
      getBatch: vi.fn(async (batchId: bigint) => {
        if (batchId === 0n) {
          return makeBatch({ batchId: 0n, totalQueuedDeposits: 0n, totalSharesPending: 0n });
        }

        if (batchId === 1n) {
          return makeBatch({ batchId: 1n, totalQueuedDeposits: 1000000n });
        }

        return null;
      }),
    };

    const provider = new CustomVaultProvider(
      {
        vaultId: 1,
        vaultAddress: "0x1234567890123456789012345678901234567890",
        providerType: "custom",
      },
      mockMaintenanceKey,
    );

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(provider.hasActionableBatchWork()).resolves.toBe(true);
    await expect(provider.isSettlementReady()).resolves.toBe(true);
    expect(mockClient.getBatch).toHaveBeenCalledWith(1n);
  });

  it("includes pending and ready instant requests in withdrawal liability", async () => {
    mockGetPendingRequests.mockResolvedValueOnce([
      { assetsEstimated: "1.250000" },
      { assetsEstimated: "0.750000" },
    ]);
    mockGetReadyRequests.mockResolvedValueOnce([{ assetsEstimated: "2.000000" }]);

    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(0n),
      getBatch: vi
        .fn()
        .mockResolvedValue(
          makeBatch({ batchId: 0n, totalSharesPending: 0n, totalQueuedDeposits: 0n }),
        ),
    };

    const provider = new CustomVaultProvider(
      {
        vaultId: 1,
        vaultAddress: "0x1234567890123456789012345678901234567890",
        providerType: "custom",
      },
      mockMaintenanceKey,
    );

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(provider.estimatePendingWithdrawalLiability()).resolves.toBe(4_000_000n);
  });

  it("recalls below minimum transfer amount when satisfying withdrawal liability", async () => {
    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(5n),
      getCycleParticipants: vi.fn().mockResolvedValue({
        depositParticipants: [],
        redeemParticipants: [],
      }),
      getClaimableDepositAssets: vi.fn().mockResolvedValue(0n),
      getClaimableDepositShares: vi.fn().mockResolvedValue(0n),
      getTotalQueuedAssets: vi.fn().mockResolvedValue(0n),
      getReservedRedemptionAssets: vi.fn().mockResolvedValue(0n),
      getErc20Balance: vi.fn().mockResolvedValue(1_946_228n),
      getAsset: vi.fn().mockResolvedValue("0x1111111111111111111111111111111111111111"),
    };

    const provider = new CustomVaultProvider(
      {
        vaultId: 1,
        vaultAddress: "0x1234567890123456789012345678901234567890",
        providerType: "custom",
      },
      {
        adminKey: mockMaintenanceKey,
        safeOperatorKey: mockMaintenanceKey,
      },
    );

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(
      provider.rebalanceCapital({
        vaultUsdcBalance: 1_911_950n,
        safeUsdcBalance: 3_235_247n,
        pendingWithdrawalLiability: 1_946_228n,
      }),
    ).resolves.toMatchObject({
      success: true,
      action: "deallocated",
      amount: 34_278n,
      requiredVaultBalance: 1_946_228n,
    });

    expect(SafeWalletService).toHaveBeenCalled();
  });

  it("retries post-recall balance checks before failing", async () => {
    const mockClient = {
      getAsset: vi.fn().mockResolvedValue("0x1111111111111111111111111111111111111111"),
      getErc20Balance: vi
        .fn()
        .mockResolvedValueOnce(900_000n)
        .mockResolvedValueOnce(900_000n)
        .mockResolvedValueOnce(902_575n),
    };

    const provider = new CustomVaultProvider(
      {
        vaultId: 1,
        vaultAddress: "0x1234567890123456789012345678901234567890",
        providerType: "custom",
      },
      {
        adminKey: mockMaintenanceKey,
        safeOperatorKey: mockMaintenanceKey,
      },
    );

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(
      provider.recallWithdrawalLiquidityOnDemand({
        vaultUsdcBalance: 0n,
        safeUsdcBalance: 902_575n,
        requiredAssets: 902_575n,
      }),
    ).resolves.toMatchObject({
      success: true,
      action: "deallocated",
      amount: 902_575n,
    });
  });

  it("requires a NAV refresh when actionable work exists but NAV is stale or zero", async () => {
    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(0n),
      getNAVStatus: vi.fn().mockResolvedValue({
        currentNAV: 0n,
        lastNAVUpdate: 1700000000n,
        isFresh: false,
      }),
      getBatch: vi.fn(async (batchId: bigint) => {
        if (batchId === 0n) {
          return makeBatch({ batchId: 0n, totalQueuedDeposits: 0n, totalSharesPending: 0n });
        }

        if (batchId === 1n) {
          return makeBatch({ batchId: 1n, totalQueuedDeposits: 1000000n });
        }

        return null;
      }),
    };

    const provider = new CustomVaultProvider({
      vaultId: 1,
      vaultAddress: "0x1234567890123456789012345678901234567890",
      providerType: "custom",
    });

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(provider.needsNavRefreshForActionableWork()).resolves.toBe(true);
    await expect(provider.isSettlementReady()).resolves.toBe(false);
  });

  it("estimates pending custom withdrawal liability before settlement", async () => {
    const mockClient = {
      getCurrentBatch: vi.fn().mockResolvedValue(1n),
      getBatch: vi.fn().mockResolvedValue(
        makeBatch({
          batchId: 1n,
          totalSharesPending: 1000000n,
          status: "open",
        }),
      ),
      getNAVStatus: vi.fn().mockResolvedValue({
        currentNAV: 1000000000000000000n,
        lastNAVUpdate: 1700000000n,
        isFresh: true,
      }),
    };

    const provider = new CustomVaultProvider({
      vaultId: 1,
      vaultAddress: "0x1234567890123456789012345678901234567890",
      providerType: "custom",
    });

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(provider.estimatePendingWithdrawalLiability()).resolves.toBe(1000000n);
  });

  it("does not report zero-asset claimable requests as claimable", async () => {
    const mockClient = {
      getRedemptionRequest: vi.fn().mockResolvedValue({
        requestId: 1n,
        controller: "0x1111111111111111111111111111111111111111",
        owner: "0x1111111111111111111111111111111111111111",
        shares: 1000000n,
        assetsClaimable: 0n,
        batchId: 1n,
        status: "claimable",
        createdAt: 1700000000n,
        settledAt: 1700000100n,
        exists: true,
      }),
    };

    const provider = new CustomVaultProvider({
      vaultId: 1,
      vaultAddress: "0x1234567890123456789012345678901234567890",
      providerType: "custom",
    });

    (provider as unknown as { client: CustomVaultClient }).client =
      mockClient as unknown as CustomVaultClient;

    await expect(provider.getRequestStatus("1")).resolves.toMatchObject({ claimable: false });
  });
});
