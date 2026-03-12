/**
 * Flatness Detector Tests
 *
 * Tests for the five-condition flatness detector and settlement gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VaultInstanceConfig } from "../config/types.js";

// Mock dependencies
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../constants.js", () => ({
  SUPPORTS_POLYMARKET_TRADING: true,
  USDC_E_ADDRESS: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  POLYGON_CHAIN_ID: 137,
  CTF_EXCHANGE_ADDRESS: "0x0000000000000000000000000000000000000001",
  NEGRISK_CTF_EXCHANGE_ADDRESS: "0x0000000000000000000000000000000000000002",
  NEGRISK_ADAPTER_ADDRESS: "0x0000000000000000000000000000000000000003",
}));

// State for controlling mock behavior
const testState = {
  openPositions: [] as any[],
  allPositions: [] as any[],
  activeOrders: [] as any[],
  deployedCapital: 0n,
  reconciled: true,
};

vi.mock("./positionFetcher.js", () => ({
  positionFetcher: {
    fetchOpenPositions: vi.fn(async () => testState.openPositions),
    fetchAllPositions: vi.fn(async () => testState.allPositions),
  },
}));

vi.mock("./vaultProviderFactory.js", () => ({
  getVaultProvider: vi.fn(() => ({
    getClient: () => ({
      getDeployedCapital: vi.fn(async () => testState.deployedCapital),
    }),
    getVaultInfo: vi.fn(async () => ({ epochInfo: { currentEpochId: 1 } })),
  })),
}));

vi.mock("../repositories/entitlementRepository.js", () => ({
  EntitlementRepository: vi.fn(() => ({
    isReconciled: vi.fn(async () => ({
      reconciled: testState.reconciled,
      report: { summary: { unexplainedDeltas: testState.reconciled ? 0 : 2 } },
    })),
  })),
}));

// Import after mocks
import { FlatnessDetector } from "../services/flatnessDetector.js";

describe("FlatnessDetector", () => {
  let detector: FlatnessDetector;
  let mockTradingClient: any;
  
  const mockVaultConfig: VaultInstanceConfig = {
    id: 1,
    name: "test-vault",
    vaultAddress: "0x1234567890123456789012345678901234567890",
    safeAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    tradingSafeAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    chainId: 137,
    type: "custom",
    minOdds: 0.95,
    maxOdds: 0.995,
    highOddsThreshold: 0.99,
    maxHoursGeneral: 24,
    maxHoursForHighOdds: 6,
    betSize: 5,
    maxDeployedRatio: 0.25,
    marketFetchMaxEvents: 100,
    defaultMode: "simulation",
    safeOperatorKeyEnv: "TEST_OPERATOR_KEY",
    epochBoundarySafetyBufferMinutes: 0,
    autoLiquidityManagement: false,
    vaultReserveUsdc: 100,
    minAllocationAmountUsdc: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset state
    testState.openPositions = [];
    testState.allPositions = [];
    testState.activeOrders = [];
    testState.deployedCapital = 0n;
    testState.reconciled = true;
    
    // Create mock trading client
    mockTradingClient = {
      isInitialized: vi.fn().mockReturnValue(true),
      getActiveOrders: vi.fn(async () => testState.activeOrders),
    };
    
    detector = new FlatnessDetector({}, mockTradingClient);
  });

  it("returns correct structure with all five conditions", async () => {
    const result = await detector.checkFlatness(mockVaultConfig);

    expect(result).toHaveProperty("isFlat");
    expect(result).toHaveProperty("allConditionsPassed");
    expect(result).toHaveProperty("conditions");
    expect(result).toHaveProperty("blockingConditions");
    expect(result).toHaveProperty("timestamp");
    expect(result.conditions).toHaveLength(5);
    
    const names = result.conditions.map(c => c.name);
    expect(names).toContain("zero_open_positions");
    expect(names).toContain("zero_resting_orders");
    expect(names).toContain("zero_deployed_capital");
    expect(names).toContain("zero_non_dust_token_balances");
    expect(names).toContain("successful_reconciliation");
  });

  it("detects resting orders as blocking condition", async () => {
    testState.activeOrders = [{ id: "order1" }];

    const result = await detector.checkFlatness(mockVaultConfig);

    expect(result.isFlat).toBe(false);
    expect(result.blockingConditions).toContain("zero_resting_orders");
  });

  it("detects reconciliation failure as blocking condition", async () => {
    testState.reconciled = false;

    const result = await detector.checkFlatness(mockVaultConfig);

    expect(result.isFlat).toBe(false);
    expect(result.blockingConditions).toContain("successful_reconciliation");
  });

  it("includes timestamp in result", async () => {
    const before = new Date();
    const result = await detector.checkFlatness(mockVaultConfig);
    const after = new Date();

    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
