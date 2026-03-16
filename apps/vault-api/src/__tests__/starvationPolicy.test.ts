/**
 * Starvation Policy & Emergency Pause Tests (T5)
 *
 * Tests for:
 * - MAX_FLATTENING_WINDOW timeout triggering forced-unwind
 * - Slippage cap breach triggering emergency pause
 * - Reopen blocking when flattening/settlement incomplete
 * - Operator recovery actions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TradingOrchestratorService,
  MAX_FLATTENING_WINDOW_MS,
  DEFAULT_FORCE_UNWIND_SLIPPAGE_CAP,
  MAX_SLIPPAGE_BREACH_COUNT,
  type VaultOperationalState,
  type FlatteningAttempt,
  type EmergencyPauseState,
} from "../services/tradingOrchestrator.js";
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

vi.mock("../env.js", () => ({
  env: {
    VAULT_MODE: "simulation",
    POLYGON_RPC_URL: "http://localhost:8545",
    DATABASE_URL: "postgres://localhost/test",
    VAULT_DATABASE_URL: "postgres://localhost/test",
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock("../services/positionFetcher.js", () => ({
  positionFetcher: {
    fetchOpenPositions: vi.fn(async () => []),
    fetchAllPositions: vi.fn(async () => []),
  },
}));

vi.mock("../services/vaultProviderFactory.js", () => ({
  getVaultProvider: vi.fn(() => ({
    getClient: () => ({
      getDeployedCapital: vi.fn(async () => 0n),
    }),
    getVaultInfo: vi.fn(async () => ({ batchInfo: { currentBatchId: 1 } })),
    getCapabilities: vi.fn(() => ({ batchBased: true, epochBased: true })),
  })),
}));

// Test fixture vault config
const testVaultConfig: VaultInstanceConfig = {
  id: 999,
  slug: "test-vault",
  name: "Test Vault",
  enabled: true,
  type: "custom",
  vaultAddress: "0x1234567890123456789012345678901234567890",
  safeAddress: "0x0987654321098765432109876543210987654321",
  network: "mainnet",
  allocatorNavSignerKeyEnv: "TEST_ALLOCATOR_KEY",
  safeOperatorKeyEnv: "TEST_OPERATOR_KEY",
  tradingSignerKeyEnv: "TEST_TRADING_KEY",
  tradingSignatureType: 0,
  betSize: 5,
  vaultReserveUsdc: 1000,
  minAllocationAmountUsdc: 10,
  maxDeployedRatio: 0.25,
  marketFetchMaxEvents: 100,
  hedging: { enabled: false, mode: "none" },
  navRefreshIntervalMin: 5,
  reconciliationIntervalMin: 15,
  tradingScanIntervalMin: 10,
  resolutionCheckIntervalMin: 60,
  defaultMode: "simulation",
  // T5 policy config
  maxFlatteningWindowMs: 60 * 60 * 1000, // 1 hour for testing
  forceUnwindSlippageCap: 0.05, // 5%
  maxSlippageBreachCount: 3,
  allowOperatorOverride: true,
};

describe("Starvation Policy & Emergency Pause (T5)", () => {
  let orchestrator: TradingOrchestratorService;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create orchestrator with test config
    orchestrator = new TradingOrchestratorService(testVaultConfig);
  });

  // ============================================================================
  // Initial State Tests
  // ============================================================================

  describe("Initial State", () => {
    it("should start in 'normal' operational state", () => {
      expect(orchestrator.getVaultOperationalState()).toBe("normal");
    });

    it("should not be in emergency pause initially", () => {
      expect(orchestrator.isEmergencyPaused()).toBe(false);
    });

    it("should have no active flattening attempt", () => {
      expect(orchestrator.getCurrentFlatteningAttempt()).toBeNull();
    });

    it("should allow reopen initially", () => {
      const result = orchestrator.canReopen();
      expect(result.allowed).toBe(true);
    });

    it("should return policy config with defaults", () => {
      const config = orchestrator.getVaultPolicyConfig();
      expect(config.maxFlatteningWindowMs).toBe(MAX_FLATTENING_WINDOW_MS);
      expect(config.forceUnwindSlippageCap).toBe(DEFAULT_FORCE_UNWIND_SLIPPAGE_CAP);
      expect(config.maxSlippageBreachCount).toBe(MAX_SLIPPAGE_BREACH_COUNT);
      expect(config.allowOperatorOverride).toBe(true);
    });
  });

  // ============================================================================
  // Flattening & Timeout Tests
  // ============================================================================

  describe("Flattening & Timeout (Starvation)", () => {
    it("should start flattening attempt with correct deadline", () => {
      const before = Date.now();
      const attempt = orchestrator.startFlatteningAttempt();
      const after = Date.now();

      expect(attempt.vaultId).toBe(testVaultConfig.id);
      expect(attempt.status).toBe("in_progress");
      expect(attempt.timeoutTriggered).toBe(false);
      expect(attempt.slippageBreaches).toBe(0);
      expect(attempt.blockingConditions).toEqual([]);

      // Verify timestamps
      const startedAt = new Date(attempt.startedAt).getTime();
      expect(startedAt).toBeGreaterThanOrEqual(before);
      expect(startedAt).toBeLessThanOrEqual(after + 1000);

      // Verify deadline
      const deadline = new Date(attempt.expectedDeadline).getTime();
      expect(deadline - startedAt).toBe(MAX_FLATTENING_WINDOW_MS);
    });

    it("should transition to 'flattening' operational state", () => {
      orchestrator.startFlatteningAttempt();
      expect(orchestrator.getVaultOperationalState()).toBe("flattening");
    });

    it("should block reopen when flattening in progress", () => {
      orchestrator.startFlatteningAttempt();

      const result = orchestrator.canReopen();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Flattening in progress");
    });

    it("should detect timeout when deadline is exceeded", () => {
      orchestrator.startFlatteningAttempt();

      // Initially no timeout
      expect(orchestrator.hasFlatteningTimeout()).toBe(false);

      // Advance time past the deadline using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(MAX_FLATTENING_WINDOW_MS + 1000);

      // Update with blocking conditions to trigger timeout check
      orchestrator.updateFlatteningProgress(["zero_open_positions"]);

      // Now should have timeout
      expect(orchestrator.hasFlatteningTimeout()).toBe(true);
      expect(orchestrator.getVaultOperationalState()).toBe("forced_unwind");

      vi.useRealTimers();
    });

    it("should transition to 'forced_unwind' state on timeout", () => {
      orchestrator.startFlatteningAttempt();

      // Advance time past the deadline using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(MAX_FLATTENING_WINDOW_MS + 1000);

      orchestrator.updateFlatteningProgress(["zero_open_positions"]);

      expect(orchestrator.getVaultOperationalState()).toBe("forced_unwind");

      // Reopen should be blocked in forced_unwind state
      const reopenResult = orchestrator.canReopen();
      expect(reopenResult.allowed).toBe(false);
      expect(reopenResult.reason).toContain("Forced unwind in progress");

      vi.useRealTimers();
    });

    it("should complete flattening successfully", () => {
      orchestrator.startFlatteningAttempt();
      orchestrator.completeFlattening();

      const attempt = orchestrator.getCurrentFlatteningAttempt();
      expect(attempt?.status).toBe("completed");
    });
  });

  // ============================================================================
  // Slippage Cap & Emergency Pause Tests
  // ============================================================================

  describe("Slippage Cap & Emergency Pause", () => {
    it("should record slippage breach", () => {
      orchestrator.startFlatteningAttempt();

      const shouldPause = orchestrator.recordSlippageBreach(0.06); // 6% slippage

      const attempt = orchestrator.getCurrentFlatteningAttempt();
      expect(attempt?.slippageBreaches).toBe(1);
      expect(attempt?.lastSlippagePercent).toBe(0.06);
    });

    it("should trigger emergency pause when slippage exceeds cap", () => {
      orchestrator.startFlatteningAttempt();

      // 10% slippage exceeds 5% cap
      orchestrator.recordSlippageBreach(0.1);

      expect(orchestrator.isEmergencyPaused()).toBe(true);
      expect(orchestrator.getVaultOperationalState()).toBe("emergency_paused");

      const pauseState = orchestrator.getEmergencyPauseState();
      expect(pauseState.isPaused).toBe(true);
      expect(pauseState.triggeredBy).toBe("slippage");
      expect(pauseState.reason).toContain("10.00%");
      expect(pauseState.pausedAt).toBeInstanceOf(Date);
    });

    it("should trigger emergency pause after max breach count", () => {
      orchestrator.startFlatteningAttempt();

      // Record breaches below cap but repeatedly
      orchestrator.recordSlippageBreach(0.03); // 3% - below cap
      expect(orchestrator.isEmergencyPaused()).toBe(false);

      orchestrator.recordSlippageBreach(0.03);
      expect(orchestrator.isEmergencyPaused()).toBe(false);

      orchestrator.recordSlippageBreach(0.03);
      // 3rd breach should trigger pause
      expect(orchestrator.isEmergencyPaused()).toBe(true);
    });

    it("should block all operations when emergency paused", () => {
      orchestrator.startFlatteningAttempt();
      orchestrator.recordSlippageBreach(0.1);

      const reopenResult = orchestrator.canReopen();
      expect(reopenResult.allowed).toBe(false);
      expect(reopenResult.reason).toContain("Emergency pause active");
    });

    it("should return complete emergency pause state", () => {
      orchestrator.startFlatteningAttempt();
      orchestrator.recordSlippageBreach(0.1);

      const state = orchestrator.getEmergencyPauseState();
      expect(state).toEqual({
        isPaused: true,
        pausedAt: expect.any(Date),
        reason: expect.stringContaining("10.00%"),
        triggeredBy: "slippage",
        recoveryAction: expect.stringContaining("Manual operator intervention"),
      });
    });
  });

  // ============================================================================
  // Operator Recovery Tests
  // ============================================================================

  describe("Operator Recovery", () => {
    it("should clear emergency pause with operator action (override enabled)", async () => {
      orchestrator.startFlatteningAttempt();
      orchestrator.recordSlippageBreach(0.1);

      expect(orchestrator.isEmergencyPaused()).toBe(true);

      // Mock isFlat to return true for recovery check
      vi.spyOn(
        orchestrator as unknown as { isFlat: () => Promise<boolean> },
        "isFlat",
      ).mockResolvedValue(true);

      const result = await orchestrator.clearEmergencyPause("operator-123");

      expect(result.success).toBe(true);
      expect(orchestrator.isEmergencyPaused()).toBe(false);
      expect(orchestrator.getVaultOperationalState()).toBe("normal");
      expect(orchestrator.getCurrentFlatteningAttempt()).toBeNull();
    });

    it("should reject clearing pause when vault not flat (override disabled)", async () => {
      // Create orchestrator with override disabled
      const strictConfig = { ...testVaultConfig, allowOperatorOverride: false };
      const strictOrchestrator = new TradingOrchestratorService(strictConfig);

      strictOrchestrator.startFlatteningAttempt();
      strictOrchestrator.recordSlippageBreach(0.1);

      // Mock isFlat to return false
      vi.spyOn(
        strictOrchestrator as unknown as { isFlat: () => Promise<boolean> },
        "isFlat",
      ).mockResolvedValue(false);

      const result = await strictOrchestrator.clearEmergencyPause("operator-123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Operator override disabled");
      expect(strictOrchestrator.isEmergencyPaused()).toBe(true);
    });

    it("should reject clearing pause when not in emergency state", async () => {
      const result = await orchestrator.clearEmergencyPause("operator-123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not in emergency pause");
    });

    it("should allow clearing pause when vault is flat even without override", async () => {
      // Create orchestrator with override disabled
      const strictConfig = { ...testVaultConfig, allowOperatorOverride: false };
      const strictOrchestrator = new TradingOrchestratorService(strictConfig);

      strictOrchestrator.startFlatteningAttempt();
      strictOrchestrator.recordSlippageBreach(0.1);

      // Mock isFlat to return true
      vi.spyOn(
        strictOrchestrator as unknown as { isFlat: () => Promise<boolean> },
        "isFlat",
      ).mockResolvedValue(true);

      const result = await strictOrchestrator.clearEmergencyPause("operator-123");

      expect(result.success).toBe(true);
      expect(strictOrchestrator.isEmergencyPaused()).toBe(false);
    });
  });

  // ============================================================================
  // Settlement Gating Tests
  // ============================================================================

  describe("Settlement Gating", () => {
    it("should block reopen when settlement in progress", () => {
      orchestrator.startSettlement();

      const result = orchestrator.canReopen();
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Settlement in progress");
      expect(orchestrator.getVaultOperationalState()).toBe("settling");
    });

    it("should allow reopen after settlement completes", () => {
      orchestrator.startSettlement();
      expect(orchestrator.canReopen().allowed).toBe(false);

      orchestrator.completeSettlement();

      expect(orchestrator.canReopen().allowed).toBe(true);
      expect(orchestrator.getVaultOperationalState()).toBe("settled");
    });

    it("should clear flattening attempt on settlement complete", () => {
      orchestrator.startFlatteningAttempt();
      orchestrator.startSettlement();

      expect(orchestrator.getCurrentFlatteningAttempt()).not.toBeNull();

      orchestrator.completeSettlement();

      expect(orchestrator.getCurrentFlatteningAttempt()).toBeNull();
    });
  });

  // ============================================================================
  // Policy Configuration Tests
  // ============================================================================

  describe("Policy Configuration", () => {
    it("should use custom policy values from config", () => {
      const customConfig: VaultInstanceConfig = {
        ...testVaultConfig,
        maxFlatteningWindowMs: 30 * 60 * 1000, // 30 minutes
        forceUnwindSlippageCap: 0.02, // 2%
        maxSlippageBreachCount: 5,
        allowOperatorOverride: false,
      };

      const customOrchestrator = new TradingOrchestratorService(customConfig);
      const config = customOrchestrator.getVaultPolicyConfig();

      expect(config.maxFlatteningWindowMs).toBe(30 * 60 * 1000);
      expect(config.forceUnwindSlippageCap).toBe(0.02);
      expect(config.maxSlippageBreachCount).toBe(5);
      expect(config.allowOperatorOverride).toBe(false);
    });

    it("should use defaults when policy values not in config", () => {
      const minimalConfig: VaultInstanceConfig = {
        ...testVaultConfig,
        maxFlatteningWindowMs: undefined,
        forceUnwindSlippageCap: undefined,
        maxSlippageBreachCount: undefined,
        allowOperatorOverride: undefined,
      };

      const minimalOrchestrator = new TradingOrchestratorService(minimalConfig);
      const config = minimalOrchestrator.getVaultPolicyConfig();

      expect(config.maxFlatteningWindowMs).toBe(MAX_FLATTENING_WINDOW_MS);
      expect(config.forceUnwindSlippageCap).toBe(DEFAULT_FORCE_UNWIND_SLIPPAGE_CAP);
      expect(config.maxSlippageBreachCount).toBe(MAX_SLIPPAGE_BREACH_COUNT);
    });
  });

  // ============================================================================
  // Manual Emergency Pause Tests
  // ============================================================================

  describe("Manual Emergency Pause (Operator Triggered)", () => {
    it("should allow operator to trigger emergency pause", () => {
      orchestrator.triggerEmergencyPause("operator", "Manual safety stop");

      expect(orchestrator.isEmergencyPaused()).toBe(true);
      expect(orchestrator.getVaultOperationalState()).toBe("emergency_paused");

      const state = orchestrator.getEmergencyPauseState();
      expect(state.triggeredBy).toBe("operator");
      expect(state.reason).toBe("Manual safety stop");
    });

    it("should block all reopen attempts when manually paused", () => {
      orchestrator.triggerEmergencyPause("operator", "Market volatility");

      const result = orchestrator.canReopen();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Market volatility");
    });
  });
});
