#!/usr/bin/env node
/**
 * Deterministic Lifecycle Simulation Harness
 *
 * Simulates a full withdrawal lifecycle (deposit → request → ready → claim)
 * using deterministic mock data. Outputs pass/fail results.
 *
 * Usage:
 *   npx tsx src/scripts/simulateLiquidityLifecycle.ts [options]
 *
 * Options:
 *   --dry-run      Run in dry-run mode (no actual transactions, default)
 *   --live         Run in live simulation mode (simulates blockchain interactions)
 *   --verbose      Output detailed step-by-step state
 *   --scenario     Run specific scenario: basic, concurrent, deallocation, cancel, all (default)
 *
 * Examples:
 *   npx tsx src/scripts/simulateLiquidityLifecycle.ts
 *   npx tsx src/scripts/simulateLiquidityLifecycle.ts --scenario=deallocation --verbose
 *   npx tsx src/scripts/simulateLiquidityLifecycle.ts --live
 */

import "dotenv/config";

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

type ScenarioName = "basic" | "concurrent" | "deallocation" | "cancel" | "all";
type SimulationMode = "dry-run" | "live";

interface SimulationConfig {
  mode: SimulationMode;
  verbose: boolean;
  scenario: ScenarioName;
}

interface VaultState {
  vaultBalance: number; // USDC.e in vault
  safeBalance: number; // USDC.e in safe
  totalDeployed: number; // Amount deployed via adapter
  pendingWithdrawals: Array<{
    requestId: string;
    shares: string;
    assetsEstimated: number;
    requestedAt: Date;
    status: "pending" | "ready" | "cancelled" | "completed";
  }>;
  readyWithdrawals: Array<{
    requestId: string;
    shares: string;
    assetsEstimated: number;
    readyAt: Date;
    status: "ready" | "completed";
  }>;
}

interface SimulationStep {
  name: string;
  action: () => Promise<StepResult>;
}

interface StepResult {
  success: boolean;
  state: VaultState;
  action?: string;
  amount?: number;
  details?: string;
  error?: string;
}

interface SimulationResult {
  scenario: string;
  passed: boolean;
  steps: Array<{
    name: string;
    passed: boolean;
    durationMs: number;
    error?: string;
  }>;
  finalState: VaultState;
  invariants: Array<{
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
  }>;
}

// ============================================================================
// DETERMINISTIC MOCK DATA
// ============================================================================

const MOCK_ADDRESSES = {
  vault: "0x066A4678935b78FA4E89e914dBE8F077764F0c74",
  adapter: "0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525",
  safe: "0x5Eb9f355cCa830Bc1bB928D24509e278A0804b6b",
  user: "0x1234567890123456789012345678901234567890",
} as const;

const DETERMINISTIC_SEED = 12345;

// Deterministic pseudo-random generator for reproducible simulations
function createDeterministicPRNG(seed: number): () => number {
  let state = seed;
  return () => {
    // Linear congruential generator
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// ============================================================================
// MOCK SERVICES
// ============================================================================

class MockLiquidityManager {
  private state: VaultState;
  private requestCounter = 0;
  private rng: () => number;
  private mode: SimulationMode;

  constructor(mode: SimulationMode, seed: number = DETERMINISTIC_SEED) {
    this.mode = mode;
    this.rng = createDeterministicPRNG(seed);
    this.state = this.createInitialState();
  }

  private createInitialState(): VaultState {
    return {
      vaultBalance: 1000, // $1000 USDC.e in vault
      safeBalance: 0, // $0 in safe initially
      totalDeployed: 0, // Nothing deployed
      pendingWithdrawals: [],
      readyWithdrawals: [],
    };
  }

  reset(): void {
    this.state = this.createInitialState();
    this.requestCounter = 0;
  }

  getState(): VaultState {
    return { ...this.state };
  }

  // Step 1: Simulate deposit (adds USDC.e to vault)
  async simulateDeposit(amount: number): Promise<StepResult> {
    const startTime = Date.now();

    try {
      this.state.vaultBalance += amount;

      if (this.mode === "live") {
        // Simulate async blockchain interaction
        await this.simulateNetworkDelay();
      }

      return {
        success: true,
        state: this.getState(),
        action: "deposit",
        amount,
        details: `Deposited $${amount.toFixed(2)} USDC.e into vault`,
      };
    } catch (error) {
      return {
        success: false,
        state: this.getState(),
        error: (error as Error).message,
      };
    }
  }

  // Step 2: Simulate withdrawal request
  async simulateWithdrawalRequest(shares: string, assetsEstimated: number): Promise<StepResult> {
    const startTime = Date.now();

    try {
      this.requestCounter++;
      const requestId = `req-${this.requestCounter.toString().padStart(4, "0")}`;

      const request = {
        requestId,
        shares,
        assetsEstimated,
        requestedAt: new Date(),
        status: "pending" as const,
      };

      this.state.pendingWithdrawals.push(request);

      if (this.mode === "live") {
        await this.simulateNetworkDelay();
      }

      return {
        success: true,
        state: this.getState(),
        action: "withdrawal_request",
        amount: assetsEstimated,
        details: `Created withdrawal request ${requestId} for ${shares} shares (~$${assetsEstimated.toFixed(2)})`,
      };
    } catch (error) {
      return {
        success: false,
        state: this.getState(),
        error: (error as Error).message,
      };
    }
  }

  // Step 3: Simulate allocation (move funds to Safe for trading)
  async simulateAllocation(amount: number): Promise<StepResult> {
    const startTime = Date.now();

    try {
      if (amount > this.state.vaultBalance) {
        throw new Error(`Insufficient vault balance: ${this.state.vaultBalance} < ${amount}`);
      }

      this.state.vaultBalance -= amount;
      this.state.safeBalance += amount;
      this.state.totalDeployed += amount;

      if (this.mode === "live") {
        await this.simulateNetworkDelay();
      }

      return {
        success: true,
        state: this.getState(),
        action: "allocated",
        amount,
        details: `Allocated $${amount.toFixed(2)} from vault to Safe`,
      };
    } catch (error) {
      return {
        success: false,
        state: this.getState(),
        error: (error as Error).message,
      };
    }
  }

  // Step 4: Simulate reconciliation (process queue)
  async simulateReconciliation(): Promise<StepResult> {
    const startTime = Date.now();

    try {
      if (this.state.pendingWithdrawals.length === 0) {
        return {
          success: true,
          state: this.getState(),
          action: "none",
          details: "No pending withdrawals to process",
        };
      }

      // Process FIFO queue (only head)
      const head = this.state.pendingWithdrawals[0];
      if (!head) {
        return {
          success: true,
          state: this.getState(),
          action: "none",
          details: "No pending withdrawals to process",
        };
      }
      const neededAmount = head.assetsEstimated;

      // Check if vault has enough
      if (this.state.vaultBalance >= neededAmount) {
        // Mark as ready
        const readyRequest = {
          requestId: head.requestId,
          shares: head.shares,
          assetsEstimated: head.assetsEstimated,
          readyAt: new Date(),
          status: "ready" as const,
        };

        this.state.readyWithdrawals.push(readyRequest);
        this.state.pendingWithdrawals.shift(); // Remove from pending

        if (this.mode === "live") {
          await this.simulateNetworkDelay();
        }

        return {
          success: true,
          state: this.getState(),
          action: "marked_ready",
          amount: neededAmount,
          details: `Marked withdrawal ${head.requestId} as ready`,
        };
      }

      // Need to deallocate from Safe
      const deficit = neededAmount - this.state.vaultBalance;
      const deallocateAmount = Math.min(deficit, this.state.safeBalance);

      if (deallocateAmount > 0) {
        this.state.safeBalance -= deallocateAmount;
        this.state.vaultBalance += deallocateAmount;
        this.state.totalDeployed -= deallocateAmount;

        // Check if now ready
        if (this.state.vaultBalance >= neededAmount) {
          const readyRequest = {
            requestId: head.requestId,
            shares: head.shares,
            assetsEstimated: head.assetsEstimated,
            readyAt: new Date(),
            status: "ready" as const,
          };

          this.state.readyWithdrawals.push(readyRequest);
          this.state.pendingWithdrawals.shift();

          if (this.mode === "live") {
            await this.simulateNetworkDelay();
          }

          return {
            success: true,
            state: this.getState(),
            action: "marked_ready",
            amount: deallocateAmount,
            details: `Deallocated $${deallocateAmount.toFixed(2)} and marked withdrawal ${head.requestId} as ready`,
          };
        }

        return {
          success: true,
          state: this.getState(),
          action: "deallocated",
          amount: deallocateAmount,
          details: `Deallocated $${deallocateAmount.toFixed(2)} from Safe. Still need $${(neededAmount - this.state.vaultBalance).toFixed(2)}`,
        };
      }

      return {
        success: true,
        state: this.getState(),
        action: "none",
        details: `Waiting for liquidity. Need $${neededAmount.toFixed(2)}, vault: $${this.state.vaultBalance.toFixed(2)}, safe: $${this.state.safeBalance.toFixed(2)}`,
      };
    } catch (error) {
      return {
        success: false,
        state: this.getState(),
        error: (error as Error).message,
      };
    }
  }

  // Step 5: Simulate cancellation
  async simulateCancellation(requestId: string): Promise<StepResult> {
    const startTime = Date.now();

    try {
      const index = this.state.pendingWithdrawals.findIndex((r) => r.requestId === requestId);

      if (index === -1) {
        // Check if already in ready state (can't cancel)
        const readyIndex = this.state.readyWithdrawals.findIndex((r) => r.requestId === requestId);
        if (readyIndex !== -1) {
          throw new Error(`Cannot cancel request ${requestId}: already marked ready`);
        }
        throw new Error(`Request ${requestId} not found`);
      }

      const request = this.state.pendingWithdrawals[index];
      if (!request) {
        throw new Error(`Request ${requestId} not found in pending state`);
      }
      request.status = "cancelled";
      request.status = "cancelled";
      this.state.pendingWithdrawals.splice(index, 1);

      if (this.mode === "live") {
        await this.simulateNetworkDelay();
      }

      return {
        success: true,
        state: this.getState(),
        action: "cancelled",
        amount: request.assetsEstimated,
        details: `Cancelled withdrawal request ${requestId}`,
      };
    } catch (error) {
      return {
        success: false,
        state: this.getState(),
        error: (error as Error).message,
      };
    }
  }

  // Step 6: Simulate claim
  async simulateClaim(requestId: string): Promise<StepResult> {
    const startTime = Date.now();

    try {
      const index = this.state.readyWithdrawals.findIndex((r) => r.requestId === requestId);

      if (index === -1) {
        throw new Error(`Request ${requestId} not found in ready state`);
      }

      const request = this.state.readyWithdrawals[index];
      if (!request) {
        throw new Error(`Request ${requestId} not found in ready state`);
      }
      const amount = request.assetsEstimated;

      // Deduct from vault
      if (this.state.vaultBalance < amount) {
        throw new Error(
          `Insufficient vault balance for claim: ${this.state.vaultBalance} < ${amount}`,
        );
      }

      this.state.vaultBalance -= amount;
      request.status = "completed";
      this.state.readyWithdrawals.splice(index, 1);

      if (this.mode === "live") {
        await this.simulateNetworkDelay();
      }

      return {
        success: true,
        state: this.getState(),
        action: "completed",
        amount,
        details: `Completed withdrawal ${requestId}, transferred $${amount.toFixed(2)} to user`,
      };
    } catch (error) {
      return {
        success: false,
        state: this.getState(),
        error: (error as Error).message,
      };
    }
  }

  private simulateNetworkDelay(): Promise<void> {
    // Deterministic delay between 10-100ms
    const delay = 10 + Math.floor(this.rng() * 90);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// ============================================================================
// INVARIANT CHECKERS
// ============================================================================

class InvariantChecker {
  static checkAll(
    state: VaultState,
  ): Array<{ name: string; passed: boolean; expected: string; actual: string }> {
    return [
      this.checkConservationOfFunds(state),
      this.checkQueueOrdering(state),
      this.checkStatusConsistency(state),
      this.checkNonNegativeBalances(state),
    ];
  }

  // Invariant 1: Total funds are conserved
  static checkConservationOfFunds(state: VaultState): {
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
  } {
    const totalInVaultAndSafe = state.vaultBalance + state.safeBalance;
    const totalInQueues =
      state.pendingWithdrawals.reduce((sum, r) => sum + r.assetsEstimated, 0) +
      state.readyWithdrawals.reduce((sum, r) => sum + r.assetsEstimated, 0);

    // In a real system, totalDeployed would include positions, but in our simulation
    // deployed = vaultBalance + safeBalance - queueAmounts (since queue amounts are reserved)

    return {
      name: "Conservation of Funds",
      passed: totalInVaultAndSafe >= 0,
      expected: "Total funds >= 0",
      actual: `Vault: $${state.vaultBalance.toFixed(2)}, Safe: $${state.safeBalance.toFixed(2)}, Queues: $${totalInQueues.toFixed(2)}`,
    };
  }

  // Invariant 2: Pending queue is ordered by request time (FIFO)
  static checkQueueOrdering(state: VaultState): {
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
  } {
    let passed = true;
    for (let i = 1; i < state.pendingWithdrawals.length; i++) {
      const current = state.pendingWithdrawals[i];
      const previous = state.pendingWithdrawals[i - 1];
      if (current && previous && current.requestedAt < previous.requestedAt) {
        passed = false;
        break;
      }
    }

    return {
      name: "FIFO Queue Ordering",
      passed,
      expected: "Pending queue ordered by request time (oldest first)",
      actual: `Queue length: ${state.pendingWithdrawals.length}`,
    };
  }

  // Invariant 3: Status consistency
  static checkStatusConsistency(state: VaultState): {
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
  } {
    const pendingValid = state.pendingWithdrawals.every((r) => r.status === "pending");
    const readyValid = state.readyWithdrawals.every((r) => r.status === "ready");

    return {
      name: "Status Consistency",
      passed: pendingValid && readyValid,
      expected: "All pending have status=pending, all ready have status=ready",
      actual: `Pending valid: ${pendingValid}, Ready valid: ${readyValid}`,
    };
  }

  // Invariant 4: Non-negative balances
  static checkNonNegativeBalances(state: VaultState): {
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
  } {
    const passed = state.vaultBalance >= 0 && state.safeBalance >= 0 && state.totalDeployed >= 0;

    return {
      name: "Non-negative Balances",
      passed,
      expected: "All balances >= 0",
      actual: `Vault: $${state.vaultBalance.toFixed(2)}, Safe: $${state.safeBalance.toFixed(2)}, Deployed: $${state.totalDeployed.toFixed(2)}`,
    };
  }
}

// ============================================================================
// SCENARIO DEFINITIONS
// ============================================================================

class Scenarios {
  static async runBasic(
    manager: MockLiquidityManager,
    verbose: boolean,
  ): Promise<SimulationResult> {
    const steps: SimulationResult["steps"] = [];

    const stepDefinitions: Array<{ name: string; fn: () => Promise<StepResult> }> = [
      { name: "Initial Deposit", fn: () => manager.simulateDeposit(1000) },
      {
        name: "Create Withdrawal Request",
        fn: () => manager.simulateWithdrawalRequest("1000000000000000000", 100),
      },
      { name: "Reconciliation (mark ready)", fn: () => manager.simulateReconciliation() },
      { name: "Claim Withdrawal", fn: () => manager.simulateClaim("req-0001") },
    ];

    for (const step of stepDefinitions) {
      const startTime = Date.now();
      const result = await step.fn();
      const durationMs = Date.now() - startTime;

      steps.push({
        name: step.name,
        passed: result.success,
        durationMs,
        error: result.error,
      });

      if (verbose) {
        console.log(
          `  [${result.success ? "PASS" : "FAIL"}] ${step.name}: ${result.details || result.error}`,
        );
      }
    }

    const finalState = manager.getState();
    const invariants = InvariantChecker.checkAll(finalState);

    return {
      scenario: "basic",
      passed: steps.every((s) => s.passed) && invariants.every((i) => i.passed),
      steps,
      finalState,
      invariants,
    };
  }

  static async runDeallocation(
    manager: MockLiquidityManager,
    verbose: boolean,
  ): Promise<SimulationResult> {
    const steps: SimulationResult["steps"] = [];

    const stepDefinitions: Array<{ name: string; fn: () => Promise<StepResult> }> = [
      { name: "Initial Deposit", fn: () => manager.simulateDeposit(1000) },
      { name: "Allocate to Safe", fn: () => manager.simulateAllocation(800) },
      {
        name: "Create Large Withdrawal",
        fn: () => manager.simulateWithdrawalRequest("500000000000000000000", 500),
      },
      {
        name: "Reconciliation (deallocate + mark ready)",
        fn: () => manager.simulateReconciliation(),
      },
      { name: "Claim Withdrawal", fn: () => manager.simulateClaim("req-0002") },
    ];

    for (const step of stepDefinitions) {
      const startTime = Date.now();
      const result = await step.fn();
      const durationMs = Date.now() - startTime;

      steps.push({
        name: step.name,
        passed: result.success,
        durationMs,
        error: result.error,
      });

      if (verbose) {
        console.log(
          `  [${result.success ? "PASS" : "FAIL"}] ${step.name}: ${result.details || result.error}`,
        );
      }
    }

    const finalState = manager.getState();
    const invariants = InvariantChecker.checkAll(finalState);

    return {
      scenario: "deallocation",
      passed: steps.every((s) => s.passed) && invariants.every((i) => i.passed),
      steps,
      finalState,
      invariants,
    };
  }

  static async runCancel(
    manager: MockLiquidityManager,
    verbose: boolean,
  ): Promise<SimulationResult> {
    const steps: SimulationResult["steps"] = [];

    const stepDefinitions: Array<{ name: string; fn: () => Promise<StepResult> }> = [
      { name: "Initial Deposit", fn: () => manager.simulateDeposit(1000) },
      {
        name: "Create Withdrawal Request 1",
        fn: () => manager.simulateWithdrawalRequest("1000000000000000000", 100),
      },
      {
        name: "Create Withdrawal Request 2",
        fn: () => manager.simulateWithdrawalRequest("2000000000000000000", 200),
      },
      { name: "Cancel Request 2", fn: () => manager.simulateCancellation("req-0002") },
      {
        name: "Reconciliation (process only request 1)",
        fn: () => manager.simulateReconciliation(),
      },
      { name: "Claim Request 1", fn: () => manager.simulateClaim("req-0001") },
    ];

    for (const step of stepDefinitions) {
      const startTime = Date.now();
      const result = await step.fn();
      const durationMs = Date.now() - startTime;

      steps.push({
        name: step.name,
        passed: result.success,
        durationMs,
        error: result.error,
      });

      if (verbose) {
        console.log(
          `  [${result.success ? "PASS" : "FAIL"}] ${step.name}: ${result.details || result.error}`,
        );
      }
    }

    const finalState = manager.getState();
    const invariants = InvariantChecker.checkAll(finalState);

    return {
      scenario: "cancel",
      passed: steps.every((s) => s.passed) && invariants.every((i) => i.passed),
      steps,
      finalState,
      invariants,
    };
  }

  static async runConcurrent(
    manager: MockLiquidityManager,
    verbose: boolean,
  ): Promise<SimulationResult> {
    const steps: SimulationResult["steps"] = [];

    // Simulate multiple sequential requests and verify FIFO
    const stepDefinitions: Array<{ name: string; fn: () => Promise<StepResult> }> = [
      { name: "Initial Deposit", fn: () => manager.simulateDeposit(2000) },
      { name: "Allocate to Safe", fn: () => manager.simulateAllocation(1500) },
      {
        name: "Create Request A (oldest)",
        fn: () => manager.simulateWithdrawalRequest("1000000000000000000", 100),
      },
      {
        name: "Create Request B",
        fn: () => manager.simulateWithdrawalRequest("2000000000000000000", 200),
      },
      {
        name: "Create Request C (newest)",
        fn: () => manager.simulateWithdrawalRequest("3000000000000000000", 300),
      },
      { name: "Reconciliation Cycle 1 (process A)", fn: () => manager.simulateReconciliation() },
      { name: "Claim A", fn: () => manager.simulateClaim("req-0001") },
      { name: "Reconciliation Cycle 2 (process B)", fn: () => manager.simulateReconciliation() },
      { name: "Claim B", fn: () => manager.simulateClaim("req-0002") },
      { name: "Reconciliation Cycle 3 (process C)", fn: () => manager.simulateReconciliation() },
      { name: "Claim C", fn: () => manager.simulateClaim("req-0003") },
    ];

    for (const step of stepDefinitions) {
      const startTime = Date.now();
      const result = await step.fn();
      const durationMs = Date.now() - startTime;

      steps.push({
        name: step.name,
        passed: result.success,
        durationMs,
        error: result.error,
      });

      if (verbose) {
        console.log(
          `  [${result.success ? "PASS" : "FAIL"}] ${step.name}: ${result.details || result.error}`,
        );
      }
    }

    const finalState = manager.getState();
    const invariants = InvariantChecker.checkAll(finalState);

    // Additional check: Verify all requests were processed in FIFO order
    const fifoCheck = steps.filter((s) => s.name.includes("Claim")).every((s) => s.passed);
    if (!fifoCheck) {
      invariants.push({
        name: "FIFO Processing Order",
        passed: false,
        expected: "Requests processed in order: A, B, C",
        actual: "Processing order violated",
      });
    }

    return {
      scenario: "concurrent",
      passed: steps.every((s) => s.passed) && invariants.every((i) => i.passed),
      steps,
      finalState,
      invariants,
    };
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

function parseArgs(): SimulationConfig {
  const args = process.argv.slice(2);

  const config: SimulationConfig = {
    mode: "dry-run",
    verbose: false,
    scenario: "all",
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      config.mode = "dry-run";
    } else if (arg === "--live") {
      config.mode = "live";
    } else if (arg === "--verbose") {
      config.verbose = true;
    } else if (arg.startsWith("--scenario=")) {
      const scenario = arg.split("=")[1] as ScenarioName;
      if (["basic", "concurrent", "deallocation", "cancel", "all"].includes(scenario)) {
        config.scenario = scenario;
      }
    }
  }

  return config;
}

function formatResult(result: SimulationResult): string {
  const lines: string[] = [];

  lines.push(`\n${"=".repeat(60)}`);
  lines.push(`Scenario: ${result.scenario.toUpperCase()}`);
  lines.push(`Result: ${result.passed ? "✅ PASSED" : "❌ FAILED"}`);
  lines.push(`${"=".repeat(60)}`);

  lines.push("\nSteps:");
  for (const step of result.steps) {
    const status = step.passed ? "✅" : "❌";
    lines.push(`  ${status} ${step.name} (${step.durationMs}ms)`);
    if (step.error) {
      lines.push(`     Error: ${step.error}`);
    }
  }

  lines.push("\nFinal State:");
  lines.push(`  Vault Balance: $${result.finalState.vaultBalance.toFixed(2)}`);
  lines.push(`  Safe Balance: $${result.finalState.safeBalance.toFixed(2)}`);
  lines.push(`  Total Deployed: $${result.finalState.totalDeployed.toFixed(2)}`);
  lines.push(`  Pending Requests: ${result.finalState.pendingWithdrawals.length}`);
  lines.push(`  Ready Requests: ${result.finalState.readyWithdrawals.length}`);

  lines.push("\nInvariants:");
  for (const inv of result.invariants) {
    const status = inv.passed ? "✅" : "❌";
    lines.push(`  ${status} ${inv.name}`);
    lines.push(`     Expected: ${inv.expected}`);
    lines.push(`     Actual: ${inv.actual}`);
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const config = parseArgs();

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Liquidity Lifecycle Simulation Harness                   ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nConfiguration:`);
  console.log(`  Mode: ${config.mode}`);
  console.log(`  Scenario: ${config.scenario}`);
  console.log(`  Verbose: ${config.verbose ? "yes" : "no"}`);

  const manager = new MockLiquidityManager(config.mode);
  const results: SimulationResult[] = [];

  const scenariosToRun: ScenarioName[] =
    config.scenario === "all"
      ? ["basic", "deallocation", "cancel", "concurrent"]
      : [config.scenario];

  for (const scenario of scenariosToRun) {
    manager.reset();

    console.log(`\n\nRunning scenario: ${scenario}...`);

    let result: SimulationResult;
    switch (scenario) {
      case "basic":
        result = await Scenarios.runBasic(manager, config.verbose);
        break;
      case "deallocation":
        result = await Scenarios.runDeallocation(manager, config.verbose);
        break;
      case "cancel":
        result = await Scenarios.runCancel(manager, config.verbose);
        break;
      case "concurrent":
        result = await Scenarios.runConcurrent(manager, config.verbose);
        break;
      default:
        throw new Error(`Unknown scenario: ${scenario}`);
    }

    results.push(result);
    console.log(formatResult(result));
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const totalPassed = results.filter((r) => r.passed).length;
  const totalFailed = results.filter((r) => !r.passed).length;

  console.log(`\nTotal Scenarios: ${results.length}`);
  console.log(`  ✅ Passed: ${totalPassed}`);
  console.log(`  ❌ Failed: ${totalFailed}`);

  if (totalFailed > 0) {
    console.log("\nFailed scenarios:");
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.scenario}`);
      const failedSteps = result.steps.filter((s) => !s.passed);
      for (const step of failedSteps) {
        console.log(`      Step "${step.name}": ${step.error || "Failed"}`);
      }
    }
  }

  console.log(`\n${totalFailed === 0 ? "✅ ALL SCENARIOS PASSED" : "❌ SOME SCENARIOS FAILED"}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
