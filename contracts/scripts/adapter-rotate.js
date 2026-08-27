#!/usr/bin/env node

/**
 * Adapter Rotation Script with Preflight Safety Gates
 *
 * This script provides subcommands for adapter rotation with comprehensive
 * preflight safety checks, dry-run mode, and phase2 guards.
 *
 * Usage:
 *   node adapter-rotate.js status --vault <addr> --rpc-url <url>
 *   node adapter-rotate.js phase1 --vault <addr> --new-adapter <addr> --rpc-url <url> [--dry-run]
 *   node adapter-rotate.js phase2 --vault <addr> --old-adapter <addr> --rpc-url <url> --confirm-remove-old [--dry-run]
 *   node adapter-rotate.js smoke --vault <addr> --rpc-url <url>
 *
 * Safety Features:
 *   - Address validation (0x + 40 hex chars)
 *   - Gas balance check (>= 0.1 MATIC)
 *   - Contract code verification
 *   - Curator permission verification
 *   - Phase prerequisites (phase2 requires phase1)
 *   - Phase2 requires --confirm-remove-old flag
 *   - Phase2 requires old allocation == 0
 *   - Dry-run mode for all write operations
 */

const ethers = require("ethers");
require("dotenv").config();

const {
  runPreflight,
  printPlannedTransactions,
  encodeAddAdapter,
  encodeRemoveAdapter,
  getAdapterAllocation,
  getAdapterLiveExposure,
  checkPhase1Complete,
  checkPhase2Prerequisites,
  VAULT_PREFLIGHT_ABI,
  handleAbsoluteCapStateMachine,
  handleRelativeCapStateMachine,
  checkCaps,
  getCapPreimage,
} = require("./lib/rotationHelpers");

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = process.env.RPC_URL || "https://polygon-rpc.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const DEFAULT_OLD_ADAPTER = "0x4CC11626A7E96DF5033d24Bd4D1C608749b68730";
const DEFAULT_NEW_ADAPTER = "0x29AAe313f2129Fb6bd25f12aaf515d00aa4B3d84";

const GAS_CONFIG = {
  gasLimit: 300000,
  maxFeePerGas: ethers.parseUnits("400", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
};

// ============================================================================
// Idempotency & Resumability Configuration
// ============================================================================

const RETRY_CONFIG = {
  maxAttempts: 3,
  delayMs: 2000,
};

// State file for resumability
const STATE_FILE = ".adapter-rotate-state.json";

// ============================================================================
// Retry Utility
// ============================================================================

/**
 * Execute an async function with retry logic for transient RPC errors
 * @param {Function} fn - Async function to execute
 * @param {string} operationName - Name of the operation for logging
 * @param {number} maxAttempts - Maximum retry attempts (default: 3)
 * @param {number} delayMs - Delay between retries in ms (default: 2000)
 * @returns {Promise<any>} Result of the function
 */
async function withRetry(
  fn,
  operationName,
  maxAttempts = RETRY_CONFIG.maxAttempts,
  delayMs = RETRY_CONFIG.delayMs,
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it's a transient RPC error
      const isTransientError =
        error.code === "NETWORK_ERROR" ||
        error.code === "TIMEOUT" ||
        error.code === "SERVER_ERROR" ||
        (error.message &&
          (error.message.includes("timeout") ||
            error.message.includes("disconnected") ||
            error.message.includes("rate limit") ||
            error.message.includes("internal error") ||
            error.message.includes("connection reset") ||
            error.message.includes("ECONNRESET") ||
            error.message.includes("ETIMEDOUT")));

      if (!isTransientError || attempt === maxAttempts) {
        throw error;
      }

      console.log(
        `   ⚠️ ${operationName} failed (attempt ${attempt}/${maxAttempts}): ${error.message}`,
      );
      console.log(`   Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// ============================================================================
// Step Marker Utility
// ============================================================================

const PhaseSteps = {
  phase1: {
    total: 7,
    names: [
      "Preflight checks",
      "Add adapter",
      "Set absolute cap",
      "Set relative cap",
      "Verify adapter registered",
      "Verify caps set",
      "Complete",
    ],
  },
  phase2: {
    total: 5,
    names: [
      "Preflight checks",
      "Smoke validation",
      "Remove old adapter",
      "Verify removal",
      "Complete",
    ],
  },
};

let currentPhase = null;
let currentStep = 0;

function startPhase(phase) {
  currentPhase = phase;
  currentStep = 0;
}

function printStep(message, useJson = false) {
  if (useJson || !currentPhase) return;

  currentStep++;
  const stepConfig = PhaseSteps[currentPhase];
  const total = stepConfig ? stepConfig.total : currentStep;
  const stepName =
    stepConfig && stepConfig.names[currentStep - 1] ? stepConfig.names[currentStep - 1] : message;

  console.log(`\n[STEP ${currentStep}/${total}] ${stepName}`);
  if (message !== stepName) {
    console.log(`   ${message}`);
  }
}

// ============================================================================
// State Persistence for Resumability
// ============================================================================

const fs = require("fs");
const path = require("path");

function getStateFilePath() {
  return path.join(process.cwd(), STATE_FILE);
}

function loadState() {
  try {
    const statePath = getStateFilePath();
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, "utf8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`Warning: Could not load state file: ${error.message}`);
  }
  return {};
}

function saveState(state) {
  try {
    const statePath = getStateFilePath();
    const existingState = loadState();
    const mergedState = { ...existingState, ...state, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(statePath, JSON.stringify(mergedState, null, 2));
  } catch (error) {
    console.error(`Warning: Could not save state file: ${error.message}`);
  }
}

function clearState(phase = null) {
  try {
    const statePath = getStateFilePath();
    if (phase) {
      // Clear only specific phase state
      const existingState = loadState();
      delete existingState[phase];
      saveState(existingState);
    } else if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  } catch (error) {
    console.error(`Warning: Could not clear state file: ${error.message}`);
  }
}

function getPhaseState(phase, vaultAddress) {
  const state = loadState();
  const phaseKey = `${phase}_${vaultAddress}`;
  return state[phaseKey] || { completedSteps: [], lastAttempt: null };
}

function updatePhaseState(phase, vaultAddress, stepCompleted, data = {}) {
  const phaseKey = `${phase}_${vaultAddress}`;
  const existingState = getPhaseState(phase, vaultAddress);

  if (!existingState.completedSteps.includes(stepCompleted)) {
    existingState.completedSteps.push(stepCompleted);
  }

  existingState.lastAttempt = new Date().toISOString();
  Object.assign(existingState, data);

  saveState({ [phaseKey]: existingState });
  return existingState;
}

function isStepCompleted(phase, vaultAddress, stepName) {
  const state = getPhaseState(phase, vaultAddress);
  return state.completedSteps.includes(stepName);
}
// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    _: [],
    flags: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        parsed.flags[key] = nextArg;
        i++;
      } else {
        parsed.flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        parsed.flags[key] = nextArg;
        i++;
      } else {
        parsed.flags[key] = true;
      }
    } else {
      parsed._.push(arg);
    }
  }

  return parsed;
}

// ============================================================================
// Validation
// ============================================================================

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isValidAddress(addr) {
  return typeof addr === "string" && ADDRESS_REGEX.test(addr);
}

function validateAddress(addr, name) {
  if (!addr) {
    return `${name} is required`;
  }
  if (!isValidAddress(addr)) {
    return `${name} must be a valid Ethereum address (0x + 40 hex chars)`;
  }
  return null;
}

function validatePrivateKey(key, name) {
  if (!key) {
    return `${name} is required`;
  }
  if (!key.startsWith("0x") || key.length !== 66) {
    return `${name} must be a valid private key (0x + 64 hex chars)`;
  }
  return null;
}

function validateRpcUrl(url) {
  if (!url) {
    return "--rpc-url is required";
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "--rpc-url must be a valid HTTP(S) URL";
  }
  return null;
}

function validateEnvironment() {
  if (!PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not set in environment");
    console.error("   Create a .env file with: PRIVATE_KEY=0x...");
    return false;
  }

  if (!PRIVATE_KEY.startsWith("0x") || PRIVATE_KEY.length !== 66) {
    console.error("❌ PRIVATE_KEY format invalid (must be 0x + 64 hex chars)");
    return false;
  }

  return true;
}

// ============================================================================
// Help Text
// ============================================================================

function showHelp() {
  console.log(`
Adapter Rotation CLI with Preflight Safety Gates

SUBCOMMANDS:
  status    Check adapter status, allocation, and caps
  phase1    Add new adapter to vault and set caps (with preflight checks)
  phase2    Remove old adapter from vault (DESTRUCTIVE, requires confirmation)
  smoke     Run smoke tests to validate setup

REQUIRED FLAGS:
    --vault <address>           Vault contract address
    --rpc-url <url>             RPC endpoint URL

  For phase1:
    --new-adapter <address>     New adapter address to add
    --absolute-cap <value>      Absolute cap value (default: unlimited, max uint256)
    --relative-cap <value>      Relative cap in basis points (default: 10000 = 100%)

    Examples for caps:
    --absolute-cap unlimited    Set unlimited absolute cap
    --absolute-cap 1000000      Set absolute cap to 1M USDC (with 6 decimals: 1000000000000)
    --relative-cap 5000         Set relative cap to 50% (5000 basis points)


  For phase2:
    --old-adapter <address>     Old adapter address to remove

  For smoke:
    --new-adapter <address>     Adapter to validate (default: DEFAULT_NEW_ADAPTER)
    --simulate-allocate         Run a tiny allocate simulation (eth_call only)
    --simulate-from <address>   From address for simulation (default: vault.curator())
    --simulate-assets <value>   Asset amount for simulation (default: 1)
    --force                     Exit 0 even when not ready

OPTIONAL FLAGS:
    --dry-run                   Simulate transactions without sending
    --confirm-remove-old        Required flag for phase2 to confirm adapter removal
    --json                      Output results as JSON
    -h, --help                  Show this help message

EXAMPLES:

  # Check current status
  node adapter-rotate.js status \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

  # Phase 1: Add new adapter with caps (dry run first)
  node adapter-rotate.js phase1 \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --new-adapter 0x4CC11626A7E96DF5033d24Bd4D1C608749b68730 \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --dry-run

  # Phase 1: Add adapter with custom caps
  node adapter-rotate.js phase1 \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --new-adapter 0x4CC11626A7E96DF5033d24Bd4D1C608749b68730 \\
    --absolute-cap unlimited \\
    --relative-cap 10000 \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY


  # Phase 2: Remove old adapter (after allocation is zero)
  node adapter-rotate.js phase2 \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --old-adapter 0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525 \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --confirm-remove-old

SAFETY GUARDRAILS:

  ✓ Address validation (0x + 40 hex chars)
  ✓ Gas balance check (>= 0.1 MATIC)
  ✓ Contract code verification
  ✓ Curator permission verification
  ✓ Phase2 requires phase1 complete
  ✓ Phase2 requires --confirm-remove-old flag
  ✓ Phase2 requires old allocation == 0
  ✓ Dry-run mode for all write operations

PREFLIGHT CHECKS:

  Before any write operation, the script validates:
  1. All addresses are valid Ethereum addresses
  2. Wallet has sufficient MATIC for gas
  3. Adapter contracts have code deployed
  4. Caller is curator or owner of the vault
  5. Phase prerequisites are met
  6. Phase2-specific safety gates

`);
}

// ============================================================================
// State Machine for Phase 1
// ============================================================================

/**
 * State machine for idempotent addAdapter handling
 * Handles all states: not submitted / submitted not executable / executable / already added
 */
async function handleAddAdapterStateMachine(
  vaultWithSigner,
  vault,
  newAdapter,
  addAdapterData,
  useJson,
) {
  const result = {
    success: false,
    step: null,
    actions: [],
    adapter: newAdapter,
    timestamp: new Date().toISOString(),
  };

  // STATE 1: Check if already added (idempotent success)
  result.step = "check_isAdapter";
  const isAlreadyAdapter = await vault.isAdapter(newAdapter);
  result.isAdapter = isAlreadyAdapter;

  if (isAlreadyAdapter) {
    result.success = true;
    result.state = "ALREADY_ADDED";
    result.message = "New adapter already registered. Nothing to do.";
    if (!useJson) {
      console.log("✅ State: ALREADY_ADDED");
      console.log("   New adapter already registered. Nothing to do.");
    }
    return result;
  }

  if (!useJson) {
    console.log("ℹ State: NOT_YET_ADDED");
    console.log("   New adapter not yet registered.");
  }

  // STATE 2: Check timelock submission status
  result.step = "check_executableAt";
  const executableAt = await vault.executableAt(addAdapterData);
  const now = Math.floor(Date.now() / 1000);
  result.executableAt = executableAt.toString();
  result.currentTime = now;

  // STATE 2a: Not yet submitted (executableAt = 0)
  if (executableAt === 0n) {
    result.state = "NOT_SUBMITTED";
    if (!useJson) {
      console.log("\nℹ State: NOT_SUBMITTED (needs submit)");
      console.log("   Action: Calling vault.submit(addAdapterData)...");
    }

    result.step = "submit";
    const tx = await vaultWithSigner.submit(addAdapterData, GAS_CONFIG);
    result.actions.push({ type: "submit", hash: tx.hash });

    if (!useJson) {
      console.log("   Tx hash:", tx.hash);
      console.log("   Waiting for confirmation...");
    }

    const receipt = await tx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
    };

    if (!useJson) {
      console.log("   ✅ Submitted to timelock");
    }

    // Re-check executableAt after submit
    const newExecutableAt = await vault.executableAt(addAdapterData);
    result.executableAtAfterSubmit = newExecutableAt.toString();

    if (now >= Number(newExecutableAt)) {
      // Timelock = 0, can execute immediately
      result.state = "SUBMITTED_AND_EXECUTABLE";
      if (!useJson) {
        console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
        console.log("   Action: Calling vault.addAdapter()...");
      }
    } else {
      // Timelock > 0, must wait
      const waitSeconds = Number(newExecutableAt) - now;
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.waitSeconds = waitSeconds;
      result.message = `Timelock active. Wait ${waitSeconds}s then run again.`;
      result.success = false;
      if (!useJson) {
        console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
        console.log(`   Timelock active. Wait ${waitSeconds}s then run again.`);
        console.log(`   Executable at: ${new Date(Number(newExecutableAt) * 1000).toISOString()}`);
      }
      return result;
    }
  }
  // STATE 2b: Submitted but not yet executable
  else if (now < Number(executableAt)) {
    const waitSeconds = Number(executableAt) - now;
    result.state = "SUBMITTED_NOT_EXECUTABLE";
    result.waitSeconds = waitSeconds;
    result.message = `Already submitted. Wait ${waitSeconds}s then run again.`;
    result.success = false;
    if (!useJson) {
      console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
      console.log(`   Already submitted. Wait ${waitSeconds}s then run again.`);
      console.log(`   Executable at: ${new Date(Number(executableAt) * 1000).toISOString()}`);
    }
    return result;
  }
  // STATE 2c: Submitted and executable
  else {
    result.state = "SUBMITTED_AND_EXECUTABLE";
    if (!useJson) {
      console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
      console.log("   Action: Calling vault.addAdapter()...");
    }
  }

  // STATE 3: Execute addAdapter
  result.step = "execute";
  const tx = await vaultWithSigner.addAdapter(newAdapter, GAS_CONFIG);
  result.actions.push({ type: "addAdapter", hash: tx.hash });

  if (!useJson) {
    console.log("   Tx hash:", tx.hash);
    console.log("   Waiting for confirmation...");
  }

  const receipt = await tx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
  };

  if (!useJson) {
    console.log("   ✅ addAdapter executed");
  }

  // STATE 4: Post-execution verification
  result.step = "verify";
  if (!useJson) {
    console.log("\n4. Verifying...");
  }

  const isNowAdapter = await vault.isAdapter(newAdapter);
  result.isAdapterAfter = isNowAdapter;

  if (isNowAdapter) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Phase 1 complete! New adapter registered.";
    if (!useJson) {
      console.log("   ✅ Phase 1 complete! New adapter registered.");
    }
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Verification failed. Adapter not registered after addAdapter.";
    throw new Error("Verification failed. Adapter not registered after addAdapter.");
  }

  return result;
}

// ============================================================================
// Subcommand Handlers
// ============================================================================

async function cmdStatus(provider, wallet, flags, useJson) {
  const vaultAddress = flags.vault;
  const newAdapter = flags["new-adapter"] || DEFAULT_NEW_ADAPTER;
  const oldAdapter = flags["old-adapter"] || DEFAULT_OLD_ADAPTER;

  const vault = new ethers.Contract(vaultAddress, VAULT_PREFLIGHT_ABI, provider);

  const results = {
    timestamp: new Date().toISOString(),
    vault: vaultAddress,
    oldAdapter,
    newAdapter,
    checks: {},
    readiness: {},
    errors: [],
    success: true,
  };

  try {
    // Check curator
    const curator = await vault.curator();
    const owner = await vault.owner();
    results.checks.curator = curator;
    results.checks.owner = owner;

    // Check if adapters are registered
    const isNewAdapter = await vault.isAdapter(newAdapter);
    const isOldAdapter = await vault.isAdapter(oldAdapter);
    results.checks.isAdapterNew = isNewAdapter;
    results.checks.isAdapterOld = isOldAdapter;

    // Get allocations
    const { allocation: newAllocation, formatted: newAllocationFormatted } =
      await getAdapterAllocation(vault, newAdapter);
    const { allocation: oldAllocation, formatted: oldAllocationFormatted } =
      await getAdapterAllocation(vault, oldAdapter);
    results.checks.allocationNew = {
      value: newAllocation.toString(),
      formatted: newAllocationFormatted,
    };
    results.checks.allocationOld = {
      value: oldAllocation.toString(),
      formatted: oldAllocationFormatted,
      isZero: oldAllocation === 0n,
    };

    let oldDeployed = null;
    let oldDeployedFormatted = null;
    let oldLiveExposure = null;
    let oldLiveExposureFormatted = null;
    let staleAllocationBypass = false;

    // Only check old adapter live exposure if it's still registered
    if (isOldAdapter) {
      try {
        const exposure = await getAdapterLiveExposure(provider, oldAdapter);
        oldDeployed = exposure.totalDeployed;
        oldDeployedFormatted = exposure.totalDeployedFormatted;
        oldLiveExposure = exposure.liveExposure;
        oldLiveExposureFormatted = exposure.liveExposureFormatted;
        staleAllocationBypass = oldAllocation > 0n && oldLiveExposure === 0n;
      } catch (_error) {
        staleAllocationBypass = false;
      }
    } else {
      // Old adapter already removed - phase 2 is complete
      staleAllocationBypass = false;
    }

    // Calculate readiness
    results.readiness.PHASE1_COMPLETE = isNewAdapter;
    results.readiness.READY_FOR_PHASE1 = !isNewAdapter;
    results.readiness.PHASE2_COMPLETE = !isOldAdapter;
    results.readiness.READY_FOR_PHASE2 =
      !results.readiness.PHASE2_COMPLETE &&
      isNewAdapter &&
      (oldAllocation === 0n || staleAllocationBypass) &&
      isOldAdapter;
    results.readiness.phase2Blockers = [];
    results.readiness.staleAllocationBypass = staleAllocationBypass;
    if (!results.readiness.PHASE2_COMPLETE) {
      if (!isNewAdapter) results.readiness.phase2Blockers.push("New adapter not registered");
      if (oldAllocation > 0n && !staleAllocationBypass)
        results.readiness.phase2Blockers.push(
          `Old adapter has ${oldAllocationFormatted} USDC allocated`,
        );
      if (!isOldAdapter) results.readiness.phase2Blockers.push("Old adapter not registered");
    }

    if (oldDeployed !== null) {
      results.checks.totalDeployedOld = {
        value: oldDeployed.toString(),
        formatted: oldDeployedFormatted,
      };
    }
    if (oldLiveExposure !== null) {
      results.checks.liveExposureOld = {
        value: oldLiveExposure.toString(),
        formatted: oldLiveExposureFormatted,
      };
    }
  } catch (error) {
    results.errors.push(error.message);
    results.success = false;
  }

  if (useJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║           ADAPTER ROTATION STATUS                            ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
    console.log(`Vault:     ${results.vault}`);
    console.log(`Curator:   ${results.checks.curator}`);
    console.log(`Owner:     ${results.checks.owner}`);
    console.log(`\nAdapters:`);
    console.log(`  Old: ${oldAdapter}`);
    console.log(`    Registered: ${results.checks.isAdapterOld ? "✅" : "❌"}`);
    console.log(`    Allocation: ${results.checks.allocationOld?.formatted || "N/A"} USDC`);
    console.log(`  New: ${newAdapter}`);
    console.log(`    Registered: ${results.checks.isAdapterNew ? "✅" : "❌"}`);
    console.log(`    Allocation: ${results.checks.allocationNew?.formatted || "N/A"} USDC`);
    console.log(`\nReadiness:`);
    const phase1Label = results.readiness.PHASE1_COMPLETE
      ? "✅ Complete"
      : results.readiness.READY_FOR_PHASE1
        ? "✅ Ready"
        : "⏳ Pending";
    const phase2Label = results.readiness.PHASE2_COMPLETE
      ? "✅ Complete"
      : results.readiness.READY_FOR_PHASE2
        ? "✅ Ready"
        : "❌ Blocked";
    console.log(`  Phase 1 (Add):    ${phase1Label}`);
    console.log(`  Phase 2 (Remove): ${phase2Label}`);
    if (!results.readiness.PHASE2_COMPLETE && results.readiness.phase2Blockers.length > 0) {
      console.log(`    Blockers:`);
      results.readiness.phase2Blockers.forEach((b) => console.log(`      - ${b}`));
    }
    if (results.readiness.PHASE2_COMPLETE) {
      console.log(`    ✅ Old adapter removed - rotation complete`);
    } else if (results.readiness.staleAllocationBypass) {
      console.log(
        "    ⚠ Old adapter allocation is non-zero but live exposure is zero (legacy stale accounting bypass active)",
      );
    }
    console.log("");
  }

  return results;
}

async function cmdPhase1(provider, wallet, flags, useJson) {
  const vaultAddress = flags.vault;
  const newAdapter = flags["new-adapter"] || DEFAULT_NEW_ADAPTER;
  const oldAdapter = flags["old-adapter"] || DEFAULT_OLD_ADAPTER;
  const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true";

  // Initialize phase tracking
  startPhase("phase1");

  // Load resumable state
  const phaseState = getPhaseState("phase1", vaultAddress);
  if (!useJson && phaseState.completedSteps.length > 0) {
    console.log(
      `\n📋 Resuming from previous run. Completed steps: ${phaseState.completedSteps.join(", ")}`,
    );
  }

  // Parse cap values with defaults
  const DEFAULT_ABSOLUTE_CAP = ethers.MaxUint256;
  const DEFAULT_RELATIVE_CAP = 10000n;

  let absoluteCap = DEFAULT_ABSOLUTE_CAP;
  let relativeCap = DEFAULT_RELATIVE_CAP;

  if (flags["absolute-cap"]) {
    const capInput = flags["absolute-cap"];
    if (capInput.toLowerCase() === "max" || capInput.toLowerCase() === "unlimited") {
      absoluteCap = ethers.MaxUint256;
    } else {
      absoluteCap = BigInt(capInput);
    }
  }

  if (flags["relative-cap"]) {
    relativeCap = BigInt(flags["relative-cap"]);
  }

  // Validate required flags
  const vaultErr = validateAddress(vaultAddress, "--vault");
  const newAdapterErr = validateAddress(newAdapter, "--new-adapter");

  if (vaultErr || newAdapterErr) {
    const errors = [vaultErr, newAdapterErr].filter(Boolean);
    if (useJson) {
      console.log(JSON.stringify({ error: errors.join("; "), success: false }, null, 2));
    } else {
      console.error("Validation errors:");
      errors.forEach((e) => console.error(`  - ${e}`));
    }
    process.exit(1);
  }

  if (!useJson) {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║           PHASE 1: ADD NEW ADAPTER + SET CAPS                ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("\nConfiguration:");
    console.log(
      `  Absolute cap: ${absoluteCap === ethers.MaxUint256 ? "unlimited (max uint256)" : absoluteCap.toString()}`,
    );
    console.log(
      `  Relative cap: ${relativeCap.toString()} bps (${(Number(relativeCap) / 100).toFixed(0)}%)`,
    );
    console.log(
      `  Retry config: ${RETRY_CONFIG.maxAttempts} attempts, ${RETRY_CONFIG.delayMs}ms delay`,
    );
  }

  // STEP 1: Run preflight checks
  printStep("Running preflight checks", useJson);

  if (isStepCompleted("phase1", vaultAddress, "preflight")) {
    printStep("✓ Preflight already completed, skipping", useJson);
  }

  const preflight = await runPreflight({
    provider,
    wallet,
    vaultAddress,
    oldAdapterAddress: oldAdapter,
    newAdapterAddress: newAdapter,
    confirmRemoveOld: false,
    phase: "phase1",
  });

  if (!preflight.success) {
    if (useJson) {
      console.log(JSON.stringify({ error: "Preflight checks failed", success: false }, null, 2));
    } else {
      console.error("\n❌ Preflight checks failed. Aborting.");
    }
    process.exit(1);
  }

  updatePhaseState("phase1", vaultAddress, "preflight", { preflightPassed: true });

  // Dry-run mode
  if (dryRun) {
    printStep("Dry-run mode - displaying planned transactions", useJson);
    await printPlannedTransactions(
      "phase1",
      {
        vaultAddress,
        newAdapterAddress: newAdapter,
        oldAdapterAddress: oldAdapter,
      },
      preflight.vault,
      {
        absoluteCap,
        relativeCap,
      },
    );

    if (useJson) {
      console.log(JSON.stringify({ mode: "dry-run", phase: "phase1", success: true }, null, 2));
    }
    return;
  }

  printStep("Executing Phase 1...", useJson);

  // Print preimage and adapterId for traceability
  if (!useJson) {
    const { preimage, adapterId } = getCapPreimage(newAdapter);
    console.log("Preimage derivation:");
    console.log(`  Preimage:   ${preimage}`);
    console.log(`  AdapterId:  ${adapterId}`);
    console.log("");
  }

  const vaultWithSigner = preflight.vault.connect(wallet);
  const addAdapterData = encodeAddAdapter(newAdapter);

  // State machine: Check current state and handle idempotently
  let result;
  let absoluteCapResult;
  let relativeCapResult;

  try {
    // STEP 2: Add adapter (or skip if already added)
    printStep("Checking if adapter needs to be added", useJson);

    if (isStepCompleted("phase1", vaultAddress, "addAdapter")) {
      printStep("✓ Adapter add step already completed, checking on-chain state...", useJson);
      // Verify on-chain
      const isAdapter = await withRetry(
        () => preflight.vault.isAdapter(newAdapter),
        "Check isAdapter",
      );
      if (isAdapter) {
        result = { success: true, state: "ALREADY_ADDED", message: "Adapter already registered" };
      } else {
        printStep(
          "⚠️ Step marked complete but adapter not found on-chain, re-executing...",
          useJson,
        );
      }
    }

    if (!result) {
      result = await handleAddAdapterStateMachine(
        vaultWithSigner,
        preflight.vault,
        newAdapter,
        addAdapterData,
        useJson,
      );
    }

    if (result.success) {
      updatePhaseState("phase1", vaultAddress, "addAdapter", {
        adapter: newAdapter,
        state: result.state,
        txHash: result.actions?.[0]?.hash,
      });
    }

    // STEP 3: Set absolute cap (proceed even if addAdapter was skipped)
    printStep("Setting absolute cap", useJson);

    if (isStepCompleted("phase1", vaultAddress, "absoluteCap")) {
      printStep("✓ Absolute cap step already completed, checking on-chain state...", useJson);
      const { adapterId } = getCapPreimage(newAdapter);
      const currentCap = await withRetry(
        () => preflight.vault.absoluteCap(adapterId),
        "Check absoluteCap",
      );
      if (currentCap > 0n) {
        absoluteCapResult = {
          success: true,
          state: "ALREADY_SET",
          currentCap: currentCap.toString(),
          message: "Absolute cap already set",
        };
      } else {
        printStep("⚠️ Step marked complete but cap not found on-chain, re-executing...", useJson);
      }
    }

    if (!absoluteCapResult) {
      absoluteCapResult = await handleAbsoluteCapStateMachine(
        vaultWithSigner,
        preflight.vault,
        newAdapter,
        absoluteCap,
        useJson,
      );
    }

    // Stop if absolute cap verification failed
    if (!absoluteCapResult.success) {
      throw new Error(`Absolute cap setting failed: ${absoluteCapResult.message}`);
    }

    updatePhaseState("phase1", vaultAddress, "absoluteCap", {
      cap: absoluteCap.toString(),
      txHash: absoluteCapResult.actions?.[0]?.hash,
    });

    // STEP 4: Set relative cap
    printStep("Setting relative cap", useJson);

    if (isStepCompleted("phase1", vaultAddress, "relativeCap")) {
      printStep("✓ Relative cap step already completed, checking on-chain state...", useJson);
      const { adapterId } = getCapPreimage(newAdapter);
      const currentCap = await withRetry(
        () => preflight.vault.relativeCap(adapterId),
        "Check relativeCap",
      );
      if (currentCap > 0n) {
        relativeCapResult = {
          success: true,
          state: "ALREADY_SET",
          currentCap: currentCap.toString(),
          message: "Relative cap already set",
        };
      } else {
        printStep("⚠️ Step marked complete but cap not found on-chain, re-executing...", useJson);
      }
    }

    if (!relativeCapResult) {
      relativeCapResult = await handleRelativeCapStateMachine(
        vaultWithSigner,
        preflight.vault,
        newAdapter,
        relativeCap,
        useJson,
      );
    }

    // Stop if relative cap verification failed
    if (!relativeCapResult.success) {
      throw new Error(`Relative cap setting failed: ${relativeCapResult.message}`);
    }

    updatePhaseState("phase1", vaultAddress, "relativeCap", {
      cap: relativeCap.toString(),
      txHash: relativeCapResult.actions?.[0]?.hash,
    });

    // STEP 5: Final verification
    printStep("Verifying adapter registration", useJson);
    const isAdapter = await withRetry(
      () => preflight.vault.isAdapter(newAdapter),
      "Final isAdapter check",
    );

    if (!isAdapter) {
      throw new Error("Final verification failed: adapter not registered");
    }
    updatePhaseState("phase1", vaultAddress, "verifyAdapter");

    // STEP 6: Verify caps
    printStep("Verifying caps are set", useJson);
    const { adapterId } = getCapPreimage(newAdapter);
    const [absCap, relCap] = await Promise.all([
      withRetry(() => preflight.vault.absoluteCap(adapterId), "Check absoluteCap"),
      withRetry(() => preflight.vault.relativeCap(adapterId), "Check relativeCap"),
    ]);

    if (absCap === 0n || relCap === 0n) {
      throw new Error(`Final verification failed: caps not set (abs=${absCap}, rel=${relCap})`);
    }
    updatePhaseState("phase1", vaultAddress, "verifyCaps");

    // STEP 7: Complete
    printStep("Phase 1 complete", useJson);

    // Clear state on successful completion
    clearState("phase1");

    // Final summary
    if (!useJson) {
      console.log("\n╔══════════════════════════════════════════════════════════════╗");
      console.log("║  PHASE 1 COMPLETE                                            ║");
      console.log("╚══════════════════════════════════════════════════════════════╝");
      console.log("\nSummary:");
      console.log(`  Adapter:        ${newAdapter}`);
      console.log(`  isAdapter:      ✅ Registered`);
      console.log(
        `  Absolute cap:   ✅ ${absoluteCapResult.finalCap || absoluteCapResult.currentCap}`,
      );
      console.log(
        `  Relative cap:   ✅ ${relativeCapResult.finalCap || relativeCapResult.currentCap} bps`,
      );
      console.log(`  State file:     ✅ Cleared`);
      console.log("");
    }
  } catch (error) {
    if (useJson) {
      console.log(
        JSON.stringify(
          {
            error: error.message,
            success: false,
            step: result?.step || "unknown",
            addAdapter: result,
            absoluteCap: absoluteCapResult,
            relativeCap: relativeCapResult,
            resumableState: getPhaseState("phase1", vaultAddress),
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`\n❌ ${error.message}`);
      console.error(`\n📋 Run again to resume from step ${currentStep + 1}`);
      console.error(`   State saved to: ${STATE_FILE}`);
    }
    process.exit(1);
  }

  if (useJson) {
    console.log(
      JSON.stringify(
        {
          success: true,
          adapter: result,
          absoluteCap: absoluteCapResult,
          relativeCap: relativeCapResult,
          stepsCompleted: phaseState.completedSteps,
        },
        null,
        2,
      ),
    );
  }
}

async function handleRemoveAdapterStateMachine(
  vaultWithSigner,
  vault,
  oldAdapter,
  removeAdapterData,
  useJson,
) {
  const result = {
    success: false,
    step: null,
    actions: [],
    adapter: oldAdapter,
    timestamp: new Date().toISOString(),
  };

  // STATE 1: Check if already removed (idempotent success)
  result.step = "check_isAdapter";
  const isStillAdapter = await vault.isAdapter(oldAdapter);
  result.isAdapterBefore = isStillAdapter;

  if (!isStillAdapter) {
    result.success = true;
    result.state = "ALREADY_REMOVED";
    result.message = "Old adapter already removed. Nothing to do.";
    if (!useJson) {
      console.log("✅ State: ALREADY_REMOVED");
      console.log("   Old adapter already removed. Nothing to do.");
    }
    return result;
  }

  if (!useJson) {
    console.log("ℹ State: STILL_REGISTERED");
    console.log("   Old adapter is still registered.");
  }

  // STATE 2: Check timelock submission status
  result.step = "check_executableAt";
  const executableAt = await vault.executableAt(removeAdapterData);
  const now = Math.floor(Date.now() / 1000);
  result.executableAt = executableAt.toString();
  result.currentTime = now;

  // STATE 2a: Not yet submitted (executableAt = 0)
  if (executableAt === 0n) {
    result.state = "NOT_SUBMITTED";
    if (!useJson) {
      console.log("\nℹ State: NOT_SUBMITTED (needs submit)");
      console.log("   Action: Calling vault.submit(removeAdapterData)...");
    }

    result.step = "submit";
    const tx = await vaultWithSigner.submit(removeAdapterData, GAS_CONFIG);
    result.actions.push({ type: "submit", hash: tx.hash });

    if (!useJson) {
      console.log("   Tx hash:", tx.hash);
      console.log("   Waiting for confirmation...");
    }

    const receipt = await tx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
    };

    if (!useJson) {
      console.log("   ✅ Submitted to timelock");
    }

    // Re-check executableAt after submit
    const newExecutableAt = await vault.executableAt(removeAdapterData);
    result.executableAtAfterSubmit = newExecutableAt.toString();

    if (now >= Number(newExecutableAt)) {
      // Timelock = 0, can execute immediately
      result.state = "SUBMITTED_AND_EXECUTABLE";
      if (!useJson) {
        console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
        console.log("   Action: Calling vault.removeAdapter()...");
      }
    } else {
      // Timelock > 0, must wait
      const waitSeconds = Number(newExecutableAt) - now;
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.waitSeconds = waitSeconds;
      result.message = `Timelock active. Wait ${waitSeconds}s then run again.`;
      result.success = false;
      if (!useJson) {
        console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
        console.log(`   Timelock active. Wait ${waitSeconds}s then run again.`);
        console.log(`   Executable at: ${new Date(Number(newExecutableAt) * 1000).toISOString()}`);
      }
      return result;
    }
  }
  // STATE 2b: Submitted but not yet executable
  else if (now < Number(executableAt)) {
    const waitSeconds = Number(executableAt) - now;
    result.state = "SUBMITTED_NOT_EXECUTABLE";
    result.waitSeconds = waitSeconds;
    result.message = `Already submitted. Wait ${waitSeconds}s then run again.`;
    result.success = false;
    if (!useJson) {
      console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
      console.log(`   Already submitted. Wait ${waitSeconds}s then run again.`);
      console.log(`   Executable at: ${new Date(Number(executableAt) * 1000).toISOString()}`);
    }
    return result;
  }
  // STATE 2c: Submitted and executable
  else {
    result.state = "SUBMITTED_AND_EXECUTABLE";
    if (!useJson) {
      console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
      console.log("   Action: Calling vault.removeAdapter()...");
    }
  }

  // STATE 3: Execute removeAdapter
  result.step = "execute";
  const tx = await vaultWithSigner.removeAdapter(oldAdapter, GAS_CONFIG);
  result.actions.push({ type: "removeAdapter", hash: tx.hash });

  if (!useJson) {
    console.log("   Tx hash:", tx.hash);
    console.log("   Waiting for confirmation...");
  }

  const receipt = await tx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
  };

  if (!useJson) {
    console.log("   ✅ removeAdapter executed");
  }

  // STATE 4: Post-execution verification
  result.step = "verify";
  if (!useJson) {
    console.log("\n4. Verifying...");
  }

  const isNowAdapter = await vault.isAdapter(oldAdapter);
  result.isAdapterAfter = isNowAdapter;

  if (!isNowAdapter) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Phase 2 complete! Old adapter removed.";
    if (!useJson) {
      console.log("   ✅ Phase 2 complete! Old adapter removed.");
    }
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Verification failed. Adapter still registered after removeAdapter.";
    throw new Error("Verification failed. Adapter still registered after removeAdapter.");
  }

  return result;
}

async function cmdPhase2(provider, wallet, flags, useJson) {
  const vaultAddress = flags.vault;
  const oldAdapter = flags["old-adapter"] || DEFAULT_OLD_ADAPTER;
  const newAdapter = flags["new-adapter"] || DEFAULT_NEW_ADAPTER;
  const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true";
  const confirmRemoveOld =
    flags["confirm-remove-old"] === true || flags["confirm-remove-old"] === "true";

  // Initialize phase tracking
  startPhase("phase2");

  // Load resumable state
  const phaseState = getPhaseState("phase2", vaultAddress);
  if (!useJson && phaseState.completedSteps.length > 0) {
    console.log(
      `\n📋 Resuming from previous run. Completed steps: ${phaseState.completedSteps.join(", ")}`,
    );
  }

  // Validate required flags
  const vaultErr = validateAddress(vaultAddress, "--vault");
  const oldAdapterErr = validateAddress(oldAdapter, "--old-adapter");
  const newAdapterErr = validateAddress(newAdapter, "--new-adapter");

  if (vaultErr || oldAdapterErr || newAdapterErr) {
    const errors = [vaultErr, oldAdapterErr, newAdapterErr].filter(Boolean);
    if (useJson) {
      console.log(JSON.stringify({ error: errors.join("; "), success: false }, null, 2));
    } else {
      console.error("Validation errors:");
      errors.forEach((e) => console.error(`  - ${e}`));
    }
    process.exit(1);
  }

  // Check confirm-remove-old flag explicitly
  if (!confirmRemoveOld) {
    if (useJson) {
      console.log(
        JSON.stringify(
          {
            error: "Phase2 requires --confirm-remove-old flag (DESTRUCTIVE OPERATION)",
            success: false,
            hint: "This operation removes the old adapter from the vault. Pass --confirm-remove-old to confirm.",
          },
          null,
          2,
        ),
      );
    } else {
      console.error("\n╔══════════════════════════════════════════════════════════════╗");
      console.error("║  ERROR: CONFIRMATION REQUIRED                                ║");
      console.error("╚══════════════════════════════════════════════════════════════╝\n");
      console.error("Phase2 requires the --confirm-remove-old flag.");
      console.error("This is a DESTRUCTIVE operation that removes the old adapter.\n");
      console.error("If you are sure you want to proceed, run with:");
      console.error(`  --confirm-remove-old\n`);
    }
    process.exit(1);
  }

  if (!useJson) {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║           PHASE 2: REMOVE OLD ADAPTER (DESTRUCTIVE)          ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("\n⚠️  WARNING: This operation will remove the old adapter from the vault.");
    console.log(`   Old adapter: ${oldAdapter}`);
    console.log(`   Vault:       ${vaultAddress}`);
    console.log(
      `   Retry config: ${RETRY_CONFIG.maxAttempts} attempts, ${RETRY_CONFIG.delayMs}ms delay`,
    );
    console.log("");
  }

  // STEP 1: Run preflight checks
  printStep("Running preflight checks", useJson);

  if (isStepCompleted("phase2", vaultAddress, "preflight")) {
    printStep("✓ Preflight already completed, skipping", useJson);
  }

  const preflight = await runPreflight({
    provider,
    wallet,
    vaultAddress,
    oldAdapterAddress: oldAdapter,
    newAdapterAddress: newAdapter,
    confirmRemoveOld: true,
    phase: "phase2",
  });

  if (!preflight.success) {
    if (useJson) {
      console.log(
        JSON.stringify(
          { error: "Preflight checks failed", success: false, details: preflight.errors },
          null,
          2,
        ),
      );
    } else {
      console.error("\n❌ Preflight checks failed. Aborting.");
    }
    process.exit(1);
  }

  updatePhaseState("phase2", vaultAddress, "preflight", { preflightPassed: true });

  // STEP 2: Smoke validation
  printStep("Running smoke validation", useJson);

  if (isStepCompleted("phase2", vaultAddress, "smoke")) {
    printStep("✓ Smoke validation already completed, skipping", useJson);
  } else {
    const vault = preflight.vault;

    // Use retry for all smoke checks
    const { allocation: oldAllocation, formatted: oldAllocationFormatted } = await withRetry(
      () => getAdapterAllocation(vault, oldAdapter),
      "Get old adapter allocation",
    );
    let oldDeployed = null;
    let oldDeployedFormatted = null;
    let oldLiveExposure = null;
    let oldLiveExposureFormatted = null;
    try {
      const exposure = await withRetry(
        () => getAdapterLiveExposure(provider, oldAdapter),
        "Get old adapter live exposure",
      );
      oldDeployed = exposure.totalDeployed;
      oldDeployedFormatted = exposure.totalDeployedFormatted;
      oldLiveExposure = exposure.liveExposure;
      oldLiveExposureFormatted = exposure.liveExposureFormatted;
    } catch (_error) {
      oldDeployed = null;
    }

    const staleAllocationBypass = oldAllocation > 0n && oldLiveExposure === 0n;

    const { absoluteSet, relativeSet } = await withRetry(
      () => checkCaps(vault, newAdapter),
      "Check new adapter caps",
    );
    const isNewAdapter = await withRetry(() => vault.isAdapter(newAdapter), "Check isAdapter(new)");
    const isOldAdapter = await withRetry(() => vault.isAdapter(oldAdapter), "Check isAdapter(old)");

    const smokePass =
      isNewAdapter && absoluteSet && relativeSet && (oldAllocation === 0n || staleAllocationBypass);

    if (!smokePass) {
      const blockers = [];
      if (!isNewAdapter) blockers.push("New adapter is not registered");
      if (!absoluteSet) blockers.push("New adapter absolute cap not set");
      if (!relativeSet) blockers.push("New adapter relative cap not set");
      if (oldAllocation > 0n && !staleAllocationBypass) {
        blockers.push(`Old adapter has ${ethers.formatUnits(oldAllocation, 6)} USDC allocated`);
      }
      if (!isOldAdapter) blockers.push("Old adapter is not registered (may already be removed)");

      if (useJson) {
        console.log(
          JSON.stringify(
            {
              error: "Smoke check failed - not ready for Phase 2",
              success: false,
              READY_FOR_PHASE2: false,
              blockers,
            },
            null,
            2,
          ),
        );
      } else {
        console.error("\n╔══════════════════════════════════════════════════════════════╗");
        console.error("║  ERROR: SMOKE CHECK FAILED                                   ║");
        console.error("╚══════════════════════════════════════════════════════════════╝\n");
        console.error("The following prerequisites are not met:\n");
        blockers.forEach((b) => console.error(`  ❌ ${b}`));
        console.error("\nRun 'smoke' subcommand for detailed diagnostics.");
      }
      process.exit(1);
    }

    if (!useJson && staleAllocationBypass) {
      console.log(
        `   ⚠ Smoke bypass: old allocation ${oldAllocationFormatted} USDC, totalDeployed ${oldDeployedFormatted} USDC, live exposure ${oldLiveExposureFormatted} USDC`,
      );
    }

    updatePhaseState("phase2", vaultAddress, "smoke", { passed: true });
  }

  if (!useJson) {
    console.log("✓ Smoke check passed - READY_FOR_PHASE2=true");
    console.log("");
  }

  // Dry-run mode
  if (dryRun) {
    printStep("Dry-run mode - displaying planned transactions", useJson);
    await printPlannedTransactions(
      "phase2",
      {
        vaultAddress,
        newAdapterAddress: newAdapter,
        oldAdapterAddress: oldAdapter,
      },
      preflight.vault,
    );

    if (useJson) {
      console.log(JSON.stringify({ mode: "dry-run", phase: "phase2", success: true }, null, 2));
    }
    return;
  }

  // Execute phase2 with idempotent state handling
  printStep("Executing Phase 2...", useJson);

  const vaultWithSigner = preflight.vault.connect(wallet);
  const removeAdapterData = encodeRemoveAdapter(oldAdapter);

  // State machine: Check current state and handle idempotently
  let result;

  try {
    // STEP 3: Remove old adapter (or skip if already removed)
    printStep("Removing old adapter", useJson);

    if (isStepCompleted("phase2", vaultAddress, "removeAdapter")) {
      printStep("✓ Remove adapter step already completed, checking on-chain state...", useJson);
      // Verify on-chain
      const isStillAdapter = await withRetry(
        () => preflight.vault.isAdapter(oldAdapter),
        "Check isAdapter(old)",
      );
      if (!isStillAdapter) {
        result = {
          success: true,
          state: "ALREADY_REMOVED",
          message: "Old adapter already removed",
        };
      } else {
        printStep(
          "⚠️ Step marked complete but adapter still found on-chain, re-executing...",
          useJson,
        );
      }
    }

    if (!result) {
      result = await handleRemoveAdapterStateMachine(
        vaultWithSigner,
        preflight.vault,
        oldAdapter,
        removeAdapterData,
        useJson,
      );
    }

    if (result.success) {
      updatePhaseState("phase2", vaultAddress, "removeAdapter", {
        adapter: oldAdapter,
        state: result.state,
        txHash: result.actions?.[0]?.hash,
      });
    }

    // STEP 4: Verify removal
    printStep("Verifying adapter removal", useJson);
    const isStillAdapter = await withRetry(
      () => preflight.vault.isAdapter(oldAdapter),
      "Final isAdapter check",
    );

    if (isStillAdapter) {
      throw new Error("Final verification failed: old adapter still registered");
    }
    updatePhaseState("phase2", vaultAddress, "verifyRemoval");

    // STEP 5: Complete
    printStep("Phase 2 complete", useJson);

    // Clear state on successful completion
    clearState("phase2");

    // Final summary
    if (!useJson) {
      console.log("\n╔══════════════════════════════════════════════════════════════╗");
      console.log("║  PHASE 2 COMPLETE                                            ║");
      console.log("╚══════════════════════════════════════════════════════════════╝");
      console.log("\nSummary:");
      console.log(`  Old adapter:    ${oldAdapter}`);
      console.log(`  isAdapter(old): ❌ Removed (verified)`);
      console.log(`  State file:     ✅ Cleared`);
      console.log("");
    }
  } catch (error) {
    if (useJson) {
      console.log(
        JSON.stringify(
          {
            error: error.message,
            success: false,
            step: result?.step || "unknown",
            removeAdapter: result,
            resumableState: getPhaseState("phase2", vaultAddress),
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`\n❌ ${error.message}`);
      console.error(`\n📋 Run again to resume from step ${currentStep + 1}`);
      console.error(`   State saved to: ${STATE_FILE}`);
    }
    process.exit(1);
  }

  if (useJson) {
    console.log(
      JSON.stringify(
        {
          success: true,
          oldAdapter: result,
          READY_FOR_PHASE2: true,
          stepsCompleted: phaseState.completedSteps,
        },
        null,
        2,
      ),
    );
  }
}

async function cmdSmoke(provider, wallet, flags, useJson) {
  const vaultAddress = flags.vault;
  const newAdapter = flags["new-adapter"] || DEFAULT_NEW_ADAPTER;

  const force = flags.force === true || flags.force === "true";
  const simulateAllocate =
    flags["simulate-allocate"] === true || flags["simulate-allocate"] === "true";

  const simulateFromFlag = flags["simulate-from"];
  const simulateAssets = flags["simulate-assets"] ? BigInt(flags["simulate-assets"]) : 1n;

  const errors = [
    validateAddress(vaultAddress, "--vault"),
    validateAddress(newAdapter, "--new-adapter"),
  ].filter(Boolean);

  if (simulateAllocate && simulateFromFlag) {
    const fromErr = validateAddress(simulateFromFlag, "--simulate-from");
    if (fromErr) errors.push(fromErr);
  }

  if (errors.length > 0) {
    if (useJson) {
      console.log(JSON.stringify({ error: errors.join("; "), success: false }, null, 2));
    } else {
      console.error("Validation errors:");
      errors.forEach((e) => console.error(`  - ${e}`));
    }
    process.exit(1);
  }

  const SMOKE_VAULT_ABI = [
    ...VAULT_PREFLIGHT_ABI,
    "function allocate(address adapter, bytes calldata data, uint256 assets) external",
  ];

  const vault = new ethers.Contract(vaultAddress, SMOKE_VAULT_ABI, provider);

  const unmet = [];
  const result = {
    timestamp: new Date().toISOString(),
    vault: vaultAddress,
    newAdapter,
    checks: {},
    unmetConditions: unmet,
    READY_FOR_PHASE2: false,
    success: false,
  };

  // Check 1: New adapter registered
  try {
    const isNewAdapter = await vault.isAdapter(newAdapter);
    result.checks.isAdapterNew = isNewAdapter;
    if (!isNewAdapter) {
      unmet.push("New adapter is not registered (vault.isAdapter(new)=false)");
    }
  } catch (error) {
    result.checks.isAdapterNew = null;
    unmet.push(`Failed to query isAdapter(new): ${error.message}`);
  }

  // Check 2: Caps must be set (> 0)
  try {
    const caps = await checkCaps(vault, newAdapter);
    result.checks.caps = {
      adapterId: caps.adapterId,
      absoluteCap: caps.absoluteCap.toString(),
      relativeCap: caps.relativeCap.toString(),
    };

    if (caps.absoluteCap <= 0n) {
      unmet.push(`Absolute cap is 0 (adapterId=${caps.adapterId})`);
    }
    if (caps.relativeCap <= 0n) {
      unmet.push(`Relative cap is 0 (adapterId=${caps.adapterId})`);
    }
  } catch (error) {
    result.checks.caps = null;
    unmet.push(`Failed to query caps: ${error.message}`);
  }

  // Check 3 (Optional): Tiny allocation simulation (eth_call only)
  if (simulateAllocate) {
    let fromAddress = simulateFromFlag;
    try {
      if (!fromAddress) {
        fromAddress = await vault.curator();
      }

      const fromErr = validateAddress(fromAddress, "--simulate-from");
      if (fromErr) {
        result.checks.allocateSimulation = { success: false, from: fromAddress, error: fromErr };
        unmet.push(fromErr);
      } else {
        await vault.getFunction("allocate").staticCall(newAdapter, "0x", simulateAssets, {
          from: fromAddress,
        });

        result.checks.allocateSimulation = {
          success: true,
          from: fromAddress,
          assets: simulateAssets.toString(),
        };
      }
    } catch (error) {
      const msg = error.shortMessage || error.message;
      result.checks.allocateSimulation = {
        success: false,
        from: fromAddress || null,
        assets: simulateAssets.toString(),
        error: msg,
      };
      unmet.push(`Allocation simulation failed: ${msg}`);
    }
  } else {
    result.checks.allocateSimulation = { skipped: true };
  }

  const ready = unmet.length === 0;
  result.READY_FOR_PHASE2 = ready;
  result.success = ready;

  const decisionLine = `READY_FOR_PHASE2=${ready ? "true" : "false"}`;

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
    // Keep stdout JSON-clean; emit decision line on stderr.
    console.error(decisionLine);
  } else {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║   SMOKE VALIDATION (PHASED CUTOVER GATE)                     ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");

    console.log(`Vault:      ${vaultAddress}`);
    console.log(`New adapter: ${newAdapter}`);

    console.log("");
    if (result.checks.isAdapterNew !== null) {
      console.log(`1) isAdapter(new) = ${result.checks.isAdapterNew ? "true ✅" : "false ❌"}`);
    } else {
      console.log("1) isAdapter(new) = ERROR ❌");
    }

    console.log("");
    if (result.checks.caps) {
      console.log(`2) absoluteCap(adapterId) = ${result.checks.caps.absoluteCap}`);
      console.log(`   relativeCap(adapterId) = ${result.checks.caps.relativeCap}`);
      console.log(`   adapterId              = ${result.checks.caps.adapterId}`);
    } else {
      console.log("2) Caps check = ERROR ❌");
    }

    console.log("");
    if (result.checks.allocateSimulation?.skipped) {
      console.log("3) Allocation simulation = SKIPPED (pass --simulate-allocate to run)");
    } else if (result.checks.allocateSimulation?.success) {
      console.log(
        `3) Allocation simulation = PASS ✅ (from=${result.checks.allocateSimulation.from}, assets=${result.checks.allocateSimulation.assets})`,
      );
    } else {
      console.log("3) Allocation simulation = FAIL ❌");
      if (result.checks.allocateSimulation?.error) {
        console.log(`   Error: ${result.checks.allocateSimulation.error}`);
      }
    }

    if (!ready) {
      console.log("");
      console.log("Unmet conditions:");
      unmet.forEach((c) => console.log(`  - ${c}`));
    }

    console.log("");
    console.log(decisionLine);
  }

  if (ready || force) {
    process.exit(0);
  }
  process.exit(2);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const parsed = parseArgs();
  const useJson = parsed.flags.json === true || parsed.flags.json === "true";

  if (parsed.help || parsed._.includes("help")) {
    showHelp();
    process.exit(0);
  }

  const subcommand = parsed._[0];
  if (!subcommand) {
    showHelp();
    process.exit(1);
  }

  // Validate environment for write operations
  if ((subcommand === "phase1" || subcommand === "phase2") && !validateEnvironment()) {
    process.exit(1);
  }

  // Setup provider and wallet
  const rpcUrl = parsed.flags["rpc-url"] || RPC_URL;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = PRIVATE_KEY ? new ethers.Wallet(PRIVATE_KEY, provider) : null;

  // Route to command handler
  try {
    switch (subcommand) {
      case "status":
        await cmdStatus(provider, wallet, parsed.flags, useJson);
        break;
      case "phase1":
        await cmdPhase1(provider, wallet, parsed.flags, useJson);
        break;
      case "phase2":
        await cmdPhase2(provider, wallet, parsed.flags, useJson);
        break;
      case "smoke":
        await cmdSmoke(provider, wallet, parsed.flags, useJson);
        break;
      default:
        console.error(`Unknown command: ${subcommand}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    if (useJson) {
      console.log(JSON.stringify({ error: error.message, success: false }, null, 2));
    } else {
      console.error("\nFatal error:", error.message);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error.message);
  process.exit(1);
});
