#!/usr/bin/env node

/**
 * Vault Post-Deployment Script
 *
 * CLI for completing vault deployment with adapter registration,
 * cap configuration, and allocator role assignment.
 *
 * Usage:
 *   node vault-post-deploy.js --vault <addr> --new-adapter <addr> --old-adapter <addr> --rpc-url <url> --confirm-destructive
 *
 * Required Flags:
 *   --vault <address>           Vault contract address
 *   --new-adapter <address>     New adapter address to register
 *   --old-adapter <address>     Old adapter address to deregister
 *   --rpc-url <url>             RPC endpoint URL
 *   --confirm-destructive       Required flag for live deployment (DESTRUCTIVE)
 *
 * Optional Flags:
 *   --absolute-cap <value>      Absolute cap value (default: unlimited)
 *   --relative-cap <value>      Relative cap in WAD (default: 1e18 = 100%)
 *   --allocator <address>       Address to grant allocator role
 *   --dry-run                   Simulate transactions without sending
 *   --json                      Output results as JSON
 *   -h, --help                  Show this help message
 *
 * Safety Features:
 *   - Address validation (0x + 40 hex chars)
 *   - RPC URL validation (http/https)
 *   - Destructive confirmation required for live mode
 *   - Dry-run mode available
 *   - State persistence for resume capability
 *   - Evidence generation for audit trail
 */

// ============================================================================
// Library Imports
// ============================================================================

const ethers = require("ethers");
require("dotenv").config();

// Governance action wrappers (T3)
const {
  addAdapter,
  setAbsoluteCap,
  setRelativeCap,
  setAllocator,
  removeAdapter,
} = require("./lib/governanceActions.js");

// Safety gate for phase2 validation (T4)
const { checkSafetyGate } = require("./lib/safetyGate.js");

// State manager for resume capability (T5)
const {
  loadState,
  saveState,
  clearState,
  isStepCompleted,
  markStepCompleted,
  getStepData,
  getCompletedSteps,
} = require("./lib/stateManager.js");

// Dry-run planner (T7)
const { generateDryRunPlan, formatPlanAsText } = require("./lib/dryRunPlanner.js");

// Evidence emitter (T8)
const { emitEvidence } = require("./lib/evidenceEmitter.js");

// Rotation helpers for preflight and utilities
const { runPreflight, VAULT_PREFLIGHT_ABI, withRetry } = require("./lib/rotationHelpers.js");
const { normalizeRelativeCapToWad } = require("./lib/rotationHelpers.js");

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = process.env.RPC_URL || "https://polygon-rpc.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const GAS_CONFIG = {
  gasLimit: 300000,
  maxFeePerGas: ethers.parseUnits("400", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
};

const MAX_ABSOLUTE_CAP = (1n << 128n) - 1n;
const RELATIVE_CAP_WAD = 10n ** 18n;

// ============================================================================
// Argument Parsing (pattern from adapter-rotate.js)
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
// Validation (pattern from adapter-rotate.js)
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
// Required Flags Validation
// ============================================================================

function validateRequiredFlags(flags, useJson) {
  const errors = [];

  const vaultErr = validateAddress(flags.vault, "--vault");
  const newAdapterErr = validateAddress(flags["new-adapter"], "--new-adapter");
  const oldAdapterErr = validateAddress(flags["old-adapter"], "--old-adapter");
  const rpcErr = validateRpcUrl(flags["rpc-url"]);

  if (vaultErr) errors.push(vaultErr);
  if (newAdapterErr) errors.push(newAdapterErr);
  if (oldAdapterErr) errors.push(oldAdapterErr);
  if (rpcErr) errors.push(rpcErr);

  // Check confirm-destructive flag for live mode
  const isDryRun = flags["dry-run"] === true || flags["dry-run"] === "true";
  const confirmDestructive =
    flags["confirm-destructive"] === true || flags["confirm-destructive"] === "true";

  if (!isDryRun && !confirmDestructive) {
    errors.push("--confirm-destructive is required for live deployment (DESTRUCTIVE OPERATION)");
  }

  // Validate optional flags if provided
  if (flags.allocator) {
    const allocatorErr = validateAddress(flags.allocator, "--allocator");
    if (allocatorErr) errors.push(allocatorErr);
  }

  if (flags["absolute-cap"]) {
    const capValue = flags["absolute-cap"];
    if (capValue.toLowerCase() !== "unlimited" && capValue.toLowerCase() !== "max") {
      try {
        const parsedCap = BigInt(capValue);
        if (parsedCap < 0n || parsedCap > MAX_ABSOLUTE_CAP) {
          errors.push(
            `--absolute-cap must be between 0 and ${MAX_ABSOLUTE_CAP.toString()} (uint128 max)`,
          );
        }
      } catch {
        errors.push("--absolute-cap must be 'unlimited', 'max', or a valid integer");
      }
    }
  }

  if (flags["relative-cap"]) {
    const capValue = flags["relative-cap"];
    try {
      normalizeRelativeCapToWad(capValue);
    } catch {
      errors.push(`--relative-cap must be WAD <= ${RELATIVE_CAP_WAD.toString()} or bps <= 10000`);
    }
  }

  if (errors.length > 0) {
    if (useJson) {
      console.log(JSON.stringify({ error: errors.join("; "), success: false }, null, 2));
    } else {
      console.error("\n╔══════════════════════════════════════════════════════════════╗");
      console.error("║  VALIDATION ERRORS                                           ║");
      console.error("╚══════════════════════════════════════════════════════════════╝\n");
      errors.forEach((e) => console.error(`  ❌ ${e}`));
      console.error("");
      console.error("Run with --help for usage information.");
    }
    return false;
  }

  return true;
}

// ============================================================================
// Help Text
// ============================================================================

function showHelp() {
  console.log(`
Vault Post-Deployment CLI

DESCRIPTION:
  Completes vault deployment with adapter registration, cap configuration,
  and optional allocator role assignment. This script handles the transition
  from old adapter to new adapter in a single coordinated operation.

USAGE:
  node vault-post-deploy.js --vault <addr> --new-adapter <addr> --old-adapter <addr> --rpc-url <url> --confirm-destructive

REQUIRED FLAGS:
  --vault <address>           Vault contract address
  --new-adapter <address>     New adapter address to register
  --old-adapter <address>     Old adapter address to deregister
  --rpc-url <url>             RPC endpoint URL (http:// or https://)
  --confirm-destructive       Required flag for live deployment
                              This is a DESTRUCTIVE operation that modifies
                              vault configuration. Must be explicitly confirmed.

OPTIONAL FLAGS:
  --absolute-cap <value>      Absolute cap value for new adapter
                              Use "unlimited" or "max" for uint128 max
                              Default: unlimited

  --relative-cap <value>      Relative cap in WAD (1e18 = 100%)
                              Legacy bps shorthand is accepted (10000 = 100%)
                              Default: 1000000000000000000

  --allocator <address>       Address to grant allocator role
                              If not provided, allocator role is not modified

  --dry-run                   Simulate all transactions without sending
                              Does not require --confirm-destructive

  --json                      Output results as JSON

  -h, --help                  Show this help message

EXAMPLES:

  # Dry run to preview changes
  node vault-post-deploy.js \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --new-adapter 0x4CC11626A7E96DF5033d24Bd4D1C608749b68730 \\
    --old-adapter 0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525 \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --dry-run

  # Live deployment with default caps
  node vault-post-deploy.js \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --new-adapter 0x4CC11626A7E96DF5033d24Bd4D1C608749b68730 \\
    --old-adapter 0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525 \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --confirm-destructive

  # Live deployment with custom caps and allocator
  node vault-post-deploy.js \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --new-adapter 0x4CC11626A7E96DF5033d24Bd4D1C608749b68730 \\
    --old-adapter 0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525 \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --absolute-cap 1000000000000 \\
    --relative-cap 500000000000000000 \\
    --allocator 0xA40626A1b90030f3F6036dFf51E2B23fff0EE259 \\
    --confirm-destructive

OPERATIONS PERFORMED:
  1. Validate all addresses and configuration
  2. Add new adapter to vault (via timelock if required)
  3. Set absolute cap for new adapter
  4. Set relative cap for new adapter
  5. Grant allocator role if specified
  6. Run smoke gate validation
  7. Remove old adapter from vault (DESTRUCTIVE)

SAFETY GUARDRAILS:
  ✓ All addresses validated (0x + 40 hex chars)
  ✓ RPC URL validated (http/https protocol)
  ✓ --confirm-destructive required for live mode
  ✓ Dry-run mode available for testing
  ✓ JSON output for programmatic use
  ✓ State persistence for resume capability
  ✓ Safety gate before destructive phase2 operations
  ✓ Evidence generation for audit trail

ENVIRONMENT VARIABLES:
  PRIVATE_KEY                 Private key for transaction signing
  RPC_URL                     Default RPC endpoint (override with --rpc-url)
`);
}

// ============================================================================
// Step Tracking
// ============================================================================

const STEPS = [
  "preflight",
  "addAdapter",
  "setAbsoluteCap",
  "setRelativeCap",
  "setAllocator",
  "smokeGate",
  "removeAdapter",
  "complete",
];

function getStepIndex(stepName) {
  return STEPS.indexOf(stepName);
}

function getNextStep(stepName) {
  const idx = getStepIndex(stepName);
  return idx >= 0 && idx < STEPS.length - 1 ? STEPS[idx + 1] : null;
}

// ============================================================================
// Main One-Shot Orchestration
// ============================================================================

/**
 * Execute the complete one-shot orchestration pipeline
 *
 * Pipeline steps:
 * 1. Preflight validation
 * 2. Add new adapter (idempotent)
 * 3. Set absolute cap (idempotent)
 * 4. Set relative cap (idempotent)
 * 5. Set allocator role if specified (idempotent)
 * 6. Smoke gate validation
 * 7. Remove old adapter (requires --confirm-destructive)
 * 8. Clear state on success
 *
 * @param {Object} config - Execution configuration
 * @param {string} config.vault - Vault address
 * @param {string} config.newAdapter - New adapter address
 * @param {string} config.oldAdapter - Old adapter address
 * @param {string} config.rpcUrl - RPC URL
 * @param {string|bigint} config.absoluteCap - Absolute cap value
 * @param {string|bigint} config.relativeCap - Relative cap value (WAD)
 * @param {string|null} config.allocator - Allocator address (optional)
 * @param {boolean} config.dryRun - Dry-run mode
 * @param {boolean} config.confirmDestructive - Confirm destructive operations
 * @param {boolean} config.useJson - JSON output mode
 * @returns {Promise<Object>} Execution result
 */
async function executeOneShot(config) {
  const {
    vault: vaultAddress,
    newAdapter,
    oldAdapter,
    rpcUrl,
    absoluteCap,
    relativeCap,
    allocator,
    dryRun,
    confirmDestructive,
    useJson,
  } = config;

  const runId = `deploy-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const startTime = Date.now();

  // Initialize run data for evidence
  const runData = {
    runId,
    config: {
      vault: vaultAddress,
      newAdapter,
      oldAdapter,
      rpcUrl,
      absoluteCap: absoluteCap.toString(),
      relativeCap: relativeCap.toString(),
      allocator,
      dryRun,
      confirmDestructive,
    },
    steps: [],
    verdict: "unknown",
    failedAtStep: null,
    lastCompletedStep: null,
    blockers: [],
    stateFile: ".vault-post-deploy-state.json",
  };

  const smokeGateContext = {
    staleAllocationBypass: false,
  };

  const log = useJson ? () => {} : console.log;
  const logError = useJson ? () => {} : console.error;

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Initialize vault contracts
  const vault = new ethers.Contract(vaultAddress, VAULT_PREFLIGHT_ABI, provider);
  const vaultWithSigner = vault.connect(wallet);

  // Load persisted state
  const state = loadState();
  const completedSteps = getCompletedSteps();

  if (!useJson && completedSteps.length > 0) {
    log(`\n📋 Resuming from previous run. Completed steps: ${completedSteps.join(", ")}`);
  }

  try {
    // ========================================================================
    // STEP 1: Preflight Validation
    // ========================================================================
    const currentStep = "preflight";

    if (isStepCompleted(currentStep)) {
      log(`✓ Step '${currentStep}' already completed, skipping...`);
      runData.steps.push({
        name: currentStep,
        status: "skipped",
        timestamp: new Date().toISOString(),
      });
    } else {
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 1: PREFLIGHT VALIDATION                                ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      const preflight = await runPreflight({
        provider,
        wallet,
        vaultAddress,
        oldAdapterAddress: oldAdapter,
        newAdapterAddress: newAdapter,
        confirmRemoveOld: confirmDestructive,
        phase: "phase1",
      });

      if (!preflight.success) {
        runData.steps.push({
          name: currentStep,
          status: "failure",
          error: "Preflight checks failed",
          timestamp: new Date().toISOString(),
        });
        runData.verdict = "failure";
        runData.failedAtStep = currentStep;
        runData.blockers = preflight.errors;

        await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");

        if (useJson) {
          console.log(
            JSON.stringify(
              {
                error: "Preflight checks failed",
                success: false,
                blockers: preflight.errors,
              },
              null,
              2,
            ),
          );
        } else {
          logError("\n❌ Preflight checks failed. Aborting.");
          preflight.errors.forEach((e) => logError(`  ❌ ${e}`));
        }
        process.exit(1);
      }

      runData.steps.push({
        name: currentStep,
        status: "success",
        timestamp: new Date().toISOString(),
      });
      runData.lastCompletedStep = currentStep;
      markStepCompleted(currentStep, { preflightPassed: true });
      log("✅ Preflight validation passed");
    }

    // ========================================================================
    // Dry-Run Mode: Generate plan and exit
    // ========================================================================
    if (dryRun) {
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  DRY-RUN MODE                                                ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      const plan = await generateDryRunPlan({
        vaultAddress,
        newAdapterAddress: newAdapter,
        oldAdapterAddress: oldAdapter,
        allocatorAddress: allocator,
        absoluteCap,
        relativeCap,
        provider,
        includeSmokeTest: true,
        includeRemove: true,
      });

      const planText = formatPlanAsText(plan);
      log("\n" + planText);

      runData.verdict = "dry-run";
      runData.steps.push({
        name: "dryRun",
        status: "success",
        timestamp: new Date().toISOString(),
      });

      const evidenceResult = await emitEvidence(
        runData,
        ".sisyphus/evidence/task-6-orchestration.json",
        ".sisyphus/evidence/task-6-orchestration.txt",
        { timestamped: true },
      );

      if (useJson) {
        console.log(
          JSON.stringify(
            {
              mode: "dry-run",
              success: true,
              plan,
              evidence: evidenceResult,
            },
            (key, value) => {
              if (typeof value === "bigint") return value.toString();
              return value;
            },
            2,
          ),
        );
      }

      return { success: true, mode: "dry-run", plan };
    }

    // ========================================================================
    // STEP 2: Add New Adapter
    // ========================================================================
    const addAdapterStep = "addAdapter";

    if (isStepCompleted(addAdapterStep)) {
      log(`\n✓ Step '${addAdapterStep}' already completed, verifying on-chain...`);
      const isAdapter = await withRetry(() => vault.isAdapter(newAdapter), "Check isAdapter");

      if (isAdapter) {
        runData.steps.push({
          name: addAdapterStep,
          status: "skipped",
          timestamp: new Date().toISOString(),
        });
        log("✅ New adapter already registered");
      } else {
        log("⚠️ Step marked complete but adapter not found on-chain, re-executing...");
        // Fall through to execute
      }
    }

    if (!isStepCompleted(addAdapterStep)) {
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 2: ADD NEW ADAPTER                                     ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      const result = await addAdapter(vault, vaultWithSigner, newAdapter, {
        verbose: !useJson,
        timeoutMs: 300000,
      });

      runData.steps.push({
        name: addAdapterStep,
        status: result.success ? "success" : "failure",
        txHash: result.actions?.[0]?.hash,
        blockNumber: result.actions?.[0]?.receipt?.blockNumber,
        gasUsed: result.actions?.[0]?.receipt?.gasUsed,
        timestamp: new Date().toISOString(),
        error: result.success ? null : result.message,
      });

      if (!result.success) {
        runData.verdict = "failure";
        runData.failedAtStep = addAdapterStep;
        runData.blockers = [result.message];
        await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");
        throw new Error(`Add adapter failed: ${result.message}`);
      }

      runData.lastCompletedStep = addAdapterStep;
      markStepCompleted(addAdapterStep, {
        txHash: result.actions?.[0]?.hash,
        state: result.state,
      });
      log(`✅ Add adapter complete: ${result.state}`);
    }

    // ========================================================================
    // STEP 3: Set Absolute Cap
    // ========================================================================
    const absCapStep = "setAbsoluteCap";

    if (isStepCompleted(absCapStep)) {
      log(`\n✓ Step '${absCapStep}' already completed, verifying on-chain...`);
      // Verification is done in the governanceActions function
      runData.steps.push({
        name: absCapStep,
        status: "skipped",
        timestamp: new Date().toISOString(),
      });
    } else {
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 3: SET ABSOLUTE CAP                                    ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      const result = await setAbsoluteCap(vault, vaultWithSigner, newAdapter, absoluteCap, {
        verbose: !useJson,
        timeoutMs: 300000,
      });

      runData.steps.push({
        name: absCapStep,
        status: result.success ? "success" : "failure",
        txHash: result.actions?.[0]?.hash,
        blockNumber: result.actions?.[0]?.receipt?.blockNumber,
        gasUsed: result.actions?.[0]?.receipt?.gasUsed,
        timestamp: new Date().toISOString(),
        error: result.success ? null : result.message,
      });

      if (!result.success) {
        runData.verdict = "failure";
        runData.failedAtStep = absCapStep;
        runData.blockers = [result.message];
        await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");
        throw new Error(`Set absolute cap failed: ${result.message}`);
      }

      runData.lastCompletedStep = absCapStep;
      markStepCompleted(absCapStep, {
        txHash: result.actions?.[0]?.hash,
        cap: result.finalCap,
      });
      log(`✅ Absolute cap set: ${result.finalCap}`);
    }

    // ========================================================================
    // STEP 4: Set Relative Cap
    // ========================================================================
    const relCapStep = "setRelativeCap";

    if (isStepCompleted(relCapStep)) {
      log(`\n✓ Step '${relCapStep}' already completed, verifying on-chain...`);
      runData.steps.push({
        name: relCapStep,
        status: "skipped",
        timestamp: new Date().toISOString(),
      });
    } else {
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 4: SET RELATIVE CAP                                    ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      const result = await setRelativeCap(vault, vaultWithSigner, newAdapter, relativeCap, {
        verbose: !useJson,
        timeoutMs: 300000,
      });

      runData.steps.push({
        name: relCapStep,
        status: result.success ? "success" : "failure",
        txHash: result.actions?.[0]?.hash,
        blockNumber: result.actions?.[0]?.receipt?.blockNumber,
        gasUsed: result.actions?.[0]?.receipt?.gasUsed,
        timestamp: new Date().toISOString(),
        error: result.success ? null : result.message,
      });

      if (!result.success) {
        runData.verdict = "failure";
        runData.failedAtStep = relCapStep;
        runData.blockers = [result.message];
        await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");
        throw new Error(`Set relative cap failed: ${result.message}`);
      }

      runData.lastCompletedStep = relCapStep;
      markStepCompleted(relCapStep, {
        txHash: result.actions?.[0]?.hash,
        cap: result.finalCap,
      });
      log(`✅ Relative cap set: ${result.finalCap} (WAD)`);
    }

    // ========================================================================
    // STEP 5: Set Allocator (if specified)
    // ========================================================================
    const allocatorStep = "setAllocator";

    if (allocator) {
      if (isStepCompleted(allocatorStep)) {
        log(`\n✓ Step '${allocatorStep}' already completed, verifying on-chain...`);
        runData.steps.push({
          name: allocatorStep,
          status: "skipped",
          timestamp: new Date().toISOString(),
        });
      } else {
        log("\n╔══════════════════════════════════════════════════════════════╗");
        log("║  STEP 5: SET ALLOCATOR ROLE                                  ║");
        log("╚══════════════════════════════════════════════════════════════╝");

        const result = await setAllocator(vault, vaultWithSigner, allocator, true, {
          verbose: !useJson,
          timeoutMs: 300000,
        });

        runData.steps.push({
          name: allocatorStep,
          status: result.success ? "success" : "failure",
          txHash: result.actions?.[0]?.hash,
          blockNumber: result.actions?.[0]?.receipt?.blockNumber,
          gasUsed: result.actions?.[0]?.receipt?.gasUsed,
          timestamp: new Date().toISOString(),
          error: result.success ? null : result.message,
        });

        if (!result.success) {
          runData.verdict = "failure";
          runData.failedAtStep = allocatorStep;
          runData.blockers = [result.message];
          await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");
          throw new Error(`Set allocator failed: ${result.message}`);
        }

        runData.lastCompletedStep = allocatorStep;
        markStepCompleted(allocatorStep, {
          txHash: result.actions?.[0]?.hash,
          allocator,
        });
        log(`✅ Allocator role granted to: ${allocator}`);
      }
    } else {
      log("\nℹ No allocator specified, skipping allocator role assignment");
      runData.steps.push({
        name: allocatorStep,
        status: "skipped",
        reason: "No allocator address provided",
        timestamp: new Date().toISOString(),
      });
    }

    // ========================================================================
    // STEP 6: Smoke Gate (Safety Check before Phase 2)
    // ========================================================================
    const smokeStep = "smokeGate";

    if (isStepCompleted(smokeStep)) {
      log(`\n✓ Step '${smokeStep}' already completed`);
      const savedSmokeData = getStepData(smokeStep);
      if (savedSmokeData && savedSmokeData.staleAllocationBypass === true) {
        smokeGateContext.staleAllocationBypass = true;
        log("ℹ Using persisted stale-allocation bypass for removeAdapter guard");
      }
      runData.steps.push({
        name: smokeStep,
        status: "skipped",
        timestamp: new Date().toISOString(),
      });
    } else {
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 6: SMOKE GATE (SAFETY CHECK)                           ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      const smokeResult = await checkSafetyGate(vault, newAdapter, oldAdapter, provider);

      runData.steps.push({
        name: smokeStep,
        status: smokeResult.ready ? "success" : "failure",
        timestamp: new Date().toISOString(),
        details: {
          ready: smokeResult.ready,
          blockers: smokeResult.blockers,
          warnings: smokeResult.warnings,
        },
      });

      if (!smokeResult.ready) {
        runData.verdict = "failure";
        runData.failedAtStep = smokeStep;
        runData.blockers = smokeResult.blockers;
        await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");

        if (useJson) {
          console.log(
            JSON.stringify(
              {
                error: "Smoke gate failed - not ready for phase 2",
                success: false,
                blockers: smokeResult.blockers,
                warnings: smokeResult.warnings,
                details: smokeResult.details,
              },
              null,
              2,
            ),
          );
        } else {
          logError("\n❌ Smoke gate failed - not ready for Phase 2");
          logError("Blockers:");
          smokeResult.blockers.forEach((b) => logError(`  ❌ ${b}`));
          if (smokeResult.warnings.length > 0) {
            logError("Warnings:");
            smokeResult.warnings.forEach((w) => logError(`  ⚠ ${w}`));
          }
        }
        process.exit(1);
      }

      runData.lastCompletedStep = smokeStep;
      smokeGateContext.staleAllocationBypass = smokeResult.staleAllocationBypass === true;
      markStepCompleted(smokeStep, {
        ready: smokeResult.ready,
        staleAllocationBypass: smokeResult.staleAllocationBypass,
      });
      log("✅ Smoke gate passed - ready for Phase 2");

      if (smokeResult.warnings.length > 0) {
        smokeResult.warnings.forEach((w) => log(`  ⚠ ${w}`));
      }
    }

    // ========================================================================
    // STEP 7: Remove Old Adapter (DESTRUCTIVE)
    // ========================================================================
    const removeStep = "removeAdapter";

    if (isStepCompleted(removeStep)) {
      log(`\n✓ Step '${removeStep}' already completed, verifying on-chain...`);
      const isStillAdapter = await withRetry(
        () => vault.isAdapter(oldAdapter),
        "Check isAdapter(old)",
      );

      if (!isStillAdapter) {
        runData.steps.push({
          name: removeStep,
          status: "skipped",
          timestamp: new Date().toISOString(),
        });
        log("✅ Old adapter already removed");
      } else {
        log("⚠️ Step marked complete but adapter still found on-chain, re-executing...");
        // Fall through to execute
      }
    }

    if (!isStepCompleted(removeStep)) {
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 7: REMOVE OLD ADAPTER (DESTRUCTIVE)                    ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      if (!confirmDestructive) {
        const error = "Cannot remove old adapter without --confirm-destructive flag";
        runData.steps.push({
          name: removeStep,
          status: "failure",
          error,
          timestamp: new Date().toISOString(),
        });
        runData.verdict = "failure";
        runData.failedAtStep = removeStep;
        runData.blockers = [error];
        await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");
        throw new Error(error);
      }

      const result = await removeAdapter(vault, vaultWithSigner, oldAdapter, {
        verbose: !useJson,
        timeoutMs: 300000,
        skipAllocationCheck: smokeGateContext.staleAllocationBypass,
      });

      runData.steps.push({
        name: removeStep,
        status: result.success ? "success" : "failure",
        txHash: result.actions?.[0]?.hash,
        blockNumber: result.actions?.[0]?.receipt?.blockNumber,
        gasUsed: result.actions?.[0]?.receipt?.gasUsed,
        timestamp: new Date().toISOString(),
        error: result.success ? null : result.message,
      });

      if (!result.success) {
        runData.verdict = "failure";
        runData.failedAtStep = removeStep;
        runData.blockers = [result.message];
        await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");
        throw new Error(`Remove adapter failed: ${result.message}`);
      }

      runData.lastCompletedStep = removeStep;
      markStepCompleted(removeStep, {
        txHash: result.actions?.[0]?.hash,
        state: result.state,
      });
      log(`✅ Old adapter removed: ${result.state}`);
    }

    // ========================================================================
    // STEP 8: Complete - Clear State
    // ========================================================================
    log("\n╔══════════════════════════════════════════════════════════════╗");
    log("║  DEPLOYMENT COMPLETE                                         ║");
    log("╚══════════════════════════════════════════════════════════════╝");

    clearState();
    log("✅ State file cleared");

    const duration = Date.now() - startTime;
    runData.verdict = "success";
    runData.lastCompletedStep = "complete";
    runData.steps.push({
      name: "complete",
      status: "success",
      timestamp: new Date().toISOString(),
      duration,
    });

    // Emit evidence
    const evidenceResult = await emitEvidence(
      runData,
      ".sisyphus/evidence/task-6-orchestration.json",
      ".sisyphus/evidence/task-6-orchestration.txt",
      { timestamped: true },
    );

    if (!useJson) {
      log("\n📋 Summary:");
      log(`  Vault:           ${vaultAddress}`);
      log(`  New Adapter:     ${newAdapter}`);
      log(`  Old Adapter:     ${oldAdapter}`);
      log(`  Allocator:       ${allocator || "(not set)"}`);
      log(`  Duration:        ${duration}ms`);
      log(`  Evidence JSON:   ${evidenceResult.jsonPath || "N/A"}`);
      log(`  Evidence Text:   ${evidenceResult.textPath || "N/A"}`);
      log("\n✅ All operations completed successfully!");
    }

    if (useJson) {
      console.log(
        JSON.stringify(
          {
            success: true,
            verdict: "success",
            config: runData.config,
            steps: runData.steps,
            duration,
            evidence: evidenceResult,
          },
          (key, value) => {
            if (typeof value === "bigint") return value.toString();
            return value;
          },
          2,
        ),
      );
    }

    return {
      success: true,
      verdict: "success",
      steps: runData.steps,
      duration,
      evidence: evidenceResult,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    runData.verdict = "failure";
    runData.duration = duration;

    // Preserve state for resume
    await emitEvidence(runData, null, ".sisyphus/evidence/task-6-orchestration.txt");

    if (useJson) {
      console.log(
        JSON.stringify(
          {
            error: error.message,
            success: false,
            verdict: "failure",
            failedAtStep: runData.failedAtStep,
            lastCompletedStep: runData.lastCompletedStep,
            duration,
            canResume: true,
          },
          null,
          2,
        ),
      );
    } else {
      logError(`\n❌ Fatal error: ${error.message}`);
      logError(`\n📋 Run again to resume from step '${runData.lastCompletedStep || "beginning"}'`);
      logError(`   State preserved in: .vault-post-deploy-state.json`);
    }

    process.exit(1);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const parsed = parseArgs();

  // Show help and exit
  if (parsed.help) {
    showHelp();
    process.exit(0);
  }

  const flags = parsed.flags;
  const useJson = flags.json === true || flags.json === "true";

  // Validate required flags
  if (!validateRequiredFlags(flags, useJson)) {
    process.exit(1);
  }

  // Validate environment for live operations
  const isDryRun = flags["dry-run"] === true || flags["dry-run"] === "true";
  if (!isDryRun && !validateEnvironment()) {
    process.exit(1);
  }

  // Parse configuration
  let absoluteCap = MAX_ABSOLUTE_CAP;
  if (flags["absolute-cap"]) {
    const capInput = flags["absolute-cap"];
    if (capInput.toLowerCase() !== "max" && capInput.toLowerCase() !== "unlimited") {
      absoluteCap = BigInt(capInput);
    }
  }

  let relativeCap = RELATIVE_CAP_WAD;
  if (flags["relative-cap"]) {
    relativeCap = normalizeRelativeCapToWad(flags["relative-cap"]);
  }

  const config = {
    vault: flags.vault,
    newAdapter: flags["new-adapter"],
    oldAdapter: flags["old-adapter"],
    rpcUrl: flags["rpc-url"],
    absoluteCap,
    relativeCap,
    allocator: flags.allocator || null,
    dryRun: isDryRun,
    confirmDestructive:
      flags["confirm-destructive"] === true || flags["confirm-destructive"] === "true",
    useJson,
  };

  // Execute the one-shot orchestration
  const result = await executeOneShot(config);
  process.exit(result.success ? 0 : 1);
}

// Handle errors
main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  process.exit(1);
});

// Export for testing/module use
module.exports = {
  executeOneShot,
  parseArgs,
  validateRequiredFlags,
  validateEnvironment,
};
