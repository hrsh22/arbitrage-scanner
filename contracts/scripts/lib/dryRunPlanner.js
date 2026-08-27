/**
 * Dry-Run Transaction Planner
 *
 * Generates a complete transaction plan for one-shot adapter rotation flow
 * without sending any transactions. Provides call data, gas estimates, and
 * human-readable output for review before execution.
 *
 * Usage:
 *   const { generateDryRunPlan, formatPlanAsText } = require('./dryRunPlanner');
 *   const plan = await generateDryRunPlan(config);
 *   console.log(formatPlanAsText(plan));
 */

const ethers = require("ethers");

// Import encoding helpers from rotationHelpers
const {
  encodeAddAdapter,
  encodeRemoveAdapter,
  encodeIncreaseAbsoluteCap,
  encodeIncreaseRelativeCap,
  getCapPreimage,
  deriveAdapterId,
  VAULT_PREFLIGHT_ABI,
} = require("./rotationHelpers");

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_GAS_ESTIMATES = {
  // Based on Polygon mainnet observed values
  submit: 150000,
  addAdapter: 100000,
  removeAdapter: 80000,
  increaseAbsoluteCap: 120000,
  increaseRelativeCap: 120000,
  setIsAllocator: 100000,
  smokeAllocate: 200000,
  multicall: 250000,
};

const GAS_PRICE_ESTIMATES = {
  maxFeePerGas: ethers.parseUnits("400", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
};

const MAX_ABSOLUTE_CAP = (1n << 128n) - 1n;

// ============================================================================
// Plan Generation
// ============================================================================

/**
 * Configuration for dry-run plan generation
 * @typedef {Object} DryRunConfig
 * @property {string} vaultAddress - Vault contract address
 * @property {string} newAdapterAddress - New adapter to add
 * @property {string} oldAdapterAddress - Old adapter to remove
 * @property {string} allocatorAddress - Address to grant allocator role (optional)
 * @property {string|bigint} absoluteCap - Absolute cap value (default: uint128 max)
 * @property {string|bigint} relativeCap - Relative cap in bps (default: 10000)
 * @property {ethers.Provider} provider - Ethers provider (optional, for state checks)
 * @property {boolean} includeSmokeTest - Include smoke test step (default: true)
 * @property {boolean} includeRemove - Include remove adapter step (default: true)
 * @property {Object} gasEstimates - Optional custom gas estimates
 */

/**
 * Transaction step in the plan
 * @typedef {Object} TransactionStep
 * @property {number} stepNumber - Sequential step number
 * @property {string} name - Human-readable step name
 * @property {string} contract - Target contract address
 * @property {string} contractName - Contract name (e.g., "Vault", "Adapter")
 * @property {string} function - Function signature
 * @property {Array} arguments - Function arguments with types
 * @property {string} callData - Encoded transaction data
 * @property {number} estimatedGas - Gas limit estimate
 * @property {bigint} estimatedCost - Estimated cost in wei
 * @property {string} description - Human-readable description
 * @property {string} dependsOn - Previous step number this depends on
 * @property {string} verification - How to verify this step succeeded
 */

/**
 * Generates a complete dry-run transaction plan
 * @param {DryRunConfig} config - Plan configuration
 * @returns {Promise<Object>} Complete plan object with steps and metadata
 */
async function generateDryRunPlan(config) {
  const {
    vaultAddress,
    newAdapterAddress,
    oldAdapterAddress,
    allocatorAddress,
    absoluteCap = MAX_ABSOLUTE_CAP,
    relativeCap = 10000n,
    provider = null,
    includeSmokeTest = true,
    includeRemove = true,
    gasEstimates = {},
  } = config;

  // Validate required addresses
  if (!vaultAddress || !ethers.isAddress(vaultAddress)) {
    throw new Error(`Invalid vault address: ${vaultAddress}`);
  }
  if (!newAdapterAddress || !ethers.isAddress(newAdapterAddress)) {
    throw new Error(`Invalid new adapter address: ${newAdapterAddress}`);
  }
  if (includeRemove && (!oldAdapterAddress || !ethers.isAddress(oldAdapterAddress))) {
    throw new Error(`Invalid old adapter address: ${oldAdapterAddress}`);
  }

  const steps = [];
  let stepNumber = 0;

  // Get gas estimates (merge defaults with custom)
  const gas = { ...DEFAULT_GAS_ESTIMATES, ...gasEstimates };

  // Get current state if provider is available
  let currentState = null;
  if (provider) {
    currentState = await fetchCurrentState(
      provider,
      vaultAddress,
      newAdapterAddress,
      oldAdapterAddress,
    );
  }

  // ==========================================================================
  // PHASE 1: ADD NEW ADAPTER
  // ==========================================================================

  // Step 1: Submit addAdapter
  stepNumber++;
  const addAdapterData = encodeAddAdapter(newAdapterAddress);
  steps.push({
    stepNumber,
    phase: "phase1",
    name: "Submit addAdapter",
    contract: vaultAddress,
    contractName: "Vault",
    function: "submit(bytes)",
    arguments: [{ name: "data", type: "bytes", value: addAdapterData }],
    callData: encodeSubmitCall(addAdapterData),
    estimatedGas: gas.submit,
    estimatedCost: calculateCost(gas.submit),
    description: `Queue addAdapter(${newAdapterAddress}) in timelock`,
    dependsOn: null,
    verification: `Check vault.executableAt('${addAdapterData.slice(0, 20)}...') returns timestamp > 0`,
    encodedOperation: {
      function: "addAdapter(address)",
      params: [newAdapterAddress],
    },
  });

  // Step 2: Execute addAdapter
  stepNumber++;
  steps.push({
    stepNumber,
    phase: "phase1",
    name: "Execute addAdapter",
    contract: vaultAddress,
    contractName: "Vault",
    function: "addAdapter(address)",
    arguments: [{ name: "adapter", type: "address", value: newAdapterAddress }],
    callData: addAdapterData,
    estimatedGas: gas.addAdapter,
    estimatedCost: calculateCost(gas.addAdapter),
    description: `Register new adapter ${newAdapterAddress} with vault`,
    dependsOn: stepNumber - 1,
    verification: `Check vault.isAdapter('${newAdapterAddress}') returns true`,
  });

  // Step 3: Submit increaseAbsoluteCap
  stepNumber++;
  const {
    data: absCapData,
    preimage,
    adapterId,
  } = encodeIncreaseAbsoluteCap(newAdapterAddress, absoluteCap);
  steps.push({
    stepNumber,
    phase: "phase1",
    name: "Submit increaseAbsoluteCap",
    contract: vaultAddress,
    contractName: "Vault",
    function: "submit(bytes)",
    arguments: [{ name: "data", type: "bytes", value: absCapData }],
    callData: encodeSubmitCall(absCapData),
    estimatedGas: gas.submit,
    estimatedCost: calculateCost(gas.submit),
    description: `Queue increaseAbsoluteCap for adapter ${newAdapterAddress.slice(0, 10)}...`,
    dependsOn: stepNumber - 1,
    verification: `Check vault.executableAt('${absCapData.slice(0, 20)}...') returns timestamp > 0`,
    metadata: {
      preimage: preimage.slice(0, 66) + "...",
      adapterId: adapterId,
    },
    encodedOperation: {
      function: "increaseAbsoluteCap(bytes,uint256)",
      params: [preimage, absoluteCap.toString()],
    },
  });

  // Step 4: Execute increaseAbsoluteCap
  stepNumber++;
  const absCapDisplay =
    absoluteCap === MAX_ABSOLUTE_CAP ? "unlimited (max uint128)" : absoluteCap.toString();
  steps.push({
    stepNumber,
    phase: "phase1",
    name: "Execute increaseAbsoluteCap",
    contract: vaultAddress,
    contractName: "Vault",
    function: "increaseAbsoluteCap(bytes,uint256)",
    arguments: [
      { name: "id", type: "bytes", value: preimage },
      { name: "cap", type: "uint256", value: absoluteCap.toString() },
    ],
    callData: absCapData,
    estimatedGas: gas.increaseAbsoluteCap,
    estimatedCost: calculateCost(gas.increaseAbsoluteCap),
    description: `Set absolute cap to ${absCapDisplay}`,
    dependsOn: stepNumber - 1,
    verification: `Check vault.absoluteCap('${adapterId}') returns non-zero`,
    metadata: {
      capValue: absoluteCap.toString(),
      capDisplay: absCapDisplay,
    },
  });

  // Step 5: Submit increaseRelativeCap
  stepNumber++;
  const { data: relCapData } = encodeIncreaseRelativeCap(newAdapterAddress, relativeCap);
  steps.push({
    stepNumber,
    phase: "phase1",
    name: "Submit increaseRelativeCap",
    contract: vaultAddress,
    contractName: "Vault",
    function: "submit(bytes)",
    arguments: [{ name: "data", type: "bytes", value: relCapData }],
    callData: encodeSubmitCall(relCapData),
    estimatedGas: gas.submit,
    estimatedCost: calculateCost(gas.submit),
    description: `Queue increaseRelativeCap for adapter ${newAdapterAddress.slice(0, 10)}...`,
    dependsOn: stepNumber - 1,
    verification: `Check vault.executableAt('${relCapData.slice(0, 20)}...') returns timestamp > 0`,
    encodedOperation: {
      function: "increaseRelativeCap(bytes,uint256)",
      params: [preimage, relativeCap.toString()],
    },
  });

  // Step 6: Execute increaseRelativeCap
  stepNumber++;
  const relCapPercent = (Number(relativeCap) / 100).toFixed(0);
  steps.push({
    stepNumber,
    phase: "phase1",
    name: "Execute increaseRelativeCap",
    contract: vaultAddress,
    contractName: "Vault",
    function: "increaseRelativeCap(bytes,uint256)",
    arguments: [
      { name: "id", type: "bytes", value: preimage },
      { name: "cap", type: "uint256", value: relativeCap.toString() },
    ],
    callData: relCapData,
    estimatedGas: gas.increaseRelativeCap,
    estimatedCost: calculateCost(gas.increaseRelativeCap),
    description: `Set relative cap to ${relativeCap} bps (${relCapPercent}%)`,
    dependsOn: stepNumber - 1,
    verification: `Check vault.relativeCap('${adapterId}') returns non-zero`,
    metadata: {
      capValue: relativeCap.toString(),
      capPercent: relCapPercent,
    },
  });

  // Step 7: Set allocator (if provided)
  if (allocatorAddress) {
    stepNumber++;
    const setAllocatorData = encodeSetIsAllocator(allocatorAddress, true);
    steps.push({
      stepNumber,
      phase: "phase1",
      name: "Submit setIsAllocator",
      contract: vaultAddress,
      contractName: "Vault",
      function: "submit(bytes)",
      arguments: [{ name: "data", type: "bytes", value: setAllocatorData }],
      callData: encodeSubmitCall(setAllocatorData),
      estimatedGas: gas.submit,
      estimatedCost: calculateCost(gas.submit),
      description: `Queue setIsAllocator for ${allocatorAddress.slice(0, 10)}...`,
      dependsOn: stepNumber - 1,
      verification: `Check vault.isAllocator('${allocatorAddress}') returns true`,
      encodedOperation: {
        function: "setIsAllocator(address,bool)",
        params: [allocatorAddress, true],
      },
    });

    stepNumber++;
    steps.push({
      stepNumber,
      phase: "phase1",
      name: "Execute setIsAllocator",
      contract: vaultAddress,
      contractName: "Vault",
      function: "setIsAllocator(address,bool)",
      arguments: [
        { name: "allocator", type: "address", value: allocatorAddress },
        { name: "isAllocator", type: "bool", value: true },
      ],
      callData: setAllocatorData,
      estimatedGas: gas.setIsAllocator,
      estimatedCost: calculateCost(gas.setIsAllocator),
      description: `Grant allocator role to ${allocatorAddress}`,
      dependsOn: stepNumber - 1,
      verification: `Check vault.isAllocator('${allocatorAddress}') returns true`,
    });
  }

  // ==========================================================================
  // SMOKE TEST
  // ==========================================================================

  if (includeSmokeTest) {
    stepNumber++;
    // Simulate a small allocate call
    const smokeAllocateData = encodeSmokeAllocate(newAdapterAddress, 1n);
    steps.push({
      stepNumber,
      phase: "smoke",
      name: "Smoke Test - Simulate Allocate",
      contract: vaultAddress,
      contractName: "Vault",
      function: "allocate(address,bytes,uint256) [eth_call]",
      arguments: [
        { name: "adapter", type: "address", value: newAdapterAddress },
        { name: "data", type: "bytes", value: "0x" },
        { name: "assets", type: "uint256", value: "1" },
      ],
      callData: smokeAllocateData,
      estimatedGas: gas.smokeAllocate,
      estimatedCost: 0n, // eth_call is free
      description: `Simulate 1 wei allocate to new adapter (verification only)`,
      dependsOn: stepNumber - 1,
      verification: `Call should succeed without reverting`,
      notes: "This is an eth_call simulation, not a transaction",
    });
  }

  // ==========================================================================
  // PHASE 2: REMOVE OLD ADAPTER
  // ==========================================================================

  if (includeRemove && oldAdapterAddress) {
    // Step: Submit removeAdapter
    stepNumber++;
    const removeAdapterData = encodeRemoveAdapter(oldAdapterAddress);
    steps.push({
      stepNumber,
      phase: "phase2",
      name: "Submit removeAdapter",
      contract: vaultAddress,
      contractName: "Vault",
      function: "submit(bytes)",
      arguments: [{ name: "data", type: "bytes", value: removeAdapterData }],
      callData: encodeSubmitCall(removeAdapterData),
      estimatedGas: gas.submit,
      estimatedCost: calculateCost(gas.submit),
      description: `Queue removeAdapter(${oldAdapterAddress}) in timelock`,
      dependsOn: stepNumber - 1,
      verification: `Check vault.executableAt('${removeAdapterData.slice(0, 20)}...') returns timestamp > 0`,
      warning: "DESTRUCTIVE: This will unregister the old adapter",
      encodedOperation: {
        function: "removeAdapter(address)",
        params: [oldAdapterAddress],
      },
    });

    // Step: Execute removeAdapter
    stepNumber++;
    steps.push({
      stepNumber,
      phase: "phase2",
      name: "Execute removeAdapter",
      contract: vaultAddress,
      contractName: "Vault",
      function: "removeAdapter(address)",
      arguments: [{ name: "account", type: "address", value: oldAdapterAddress }],
      callData: removeAdapterData,
      estimatedGas: gas.removeAdapter,
      estimatedCost: calculateCost(gas.removeAdapter),
      description: `Unregister old adapter ${oldAdapterAddress}`,
      dependsOn: stepNumber - 1,
      verification: `Check vault.isAdapter('${oldAdapterAddress}') returns false`,
      warning: "DESTRUCTIVE: Old adapter will be removed from vault",
    });
  }

  // Calculate totals
  const totalGas = steps.reduce((sum, step) => sum + step.estimatedGas, 0);
  const totalCost = steps.reduce((sum, step) => sum + step.estimatedCost, 0n);

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      vaultAddress,
      newAdapterAddress,
      oldAdapterAddress,
      allocatorAddress: allocatorAddress || null,
      totalSteps: steps.length,
      totalGasEstimate: totalGas,
      totalCostEstimate: totalCost.toString(),
      totalCostFormatted: ethers.formatEther(totalCost) + " MATIC",
      currentState,
    },
    steps,
    config: {
      absoluteCap: absoluteCap.toString(),
      relativeCap: relativeCap.toString(),
      includeSmokeTest,
      includeRemove,
    },
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Formats a plan object as human-readable text
 * @param {Object} plan - Plan object from generateDryRunPlan
 * @returns {string} Formatted text output
 */
function formatPlanAsText(plan) {
  const lines = [];
  const { metadata, steps, config } = plan;

  // Header
  lines.push("╔══════════════════════════════════════════════════════════════════════════════╗");
  lines.push("║           DRY-RUN TRANSACTION PLAN                                           ║");
  lines.push("╚══════════════════════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Metadata
  lines.push(`Generated:    ${metadata.generatedAt}`);
  lines.push(`Vault:        ${metadata.vaultAddress}`);
  lines.push(`New Adapter:  ${metadata.newAdapterAddress}`);
  if (metadata.oldAdapterAddress) {
    lines.push(`Old Adapter:  ${metadata.oldAdapterAddress}`);
  }
  if (metadata.allocatorAddress) {
    lines.push(`Allocator:    ${metadata.allocatorAddress}`);
  }
  lines.push("");
  lines.push("Configuration:");
  lines.push(
    `  Absolute Cap: ${config.absoluteCap === ethers.MaxUint256.toString() ? "unlimited" : config.absoluteCap}`,
  );
  lines.push(
    `  Relative Cap: ${config.relativeCap} bps (${(Number(config.relativeCap) / 100).toFixed(0)}%)`,
  );
  lines.push(`  Smoke Test:   ${config.includeSmokeTest ? "included" : "skipped"}`);
  lines.push(`  Remove Step:  ${config.includeRemove ? "included" : "skipped"}`);
  lines.push("");

  // Current state if available
  if (metadata.currentState) {
    lines.push("Current State:");
    lines.push(`  New adapter registered: ${metadata.currentState.isNewAdapter ? "yes" : "no"}`);
    lines.push(`  Old adapter registered: ${metadata.currentState.isOldAdapter ? "yes" : "no"}`);
    if (metadata.currentState.newAdapterAllocation) {
      lines.push(`  New adapter allocation: ${metadata.currentState.newAdapterAllocation}`);
    }
    if (metadata.currentState.oldAdapterAllocation) {
      lines.push(`  Old adapter allocation: ${metadata.currentState.oldAdapterAllocation}`);
    }
    lines.push("");
  }

  // Summary
  lines.push("═══════════════════════════════════════════════════════════════════════════════");
  lines.push(
    `Total Steps: ${metadata.totalSteps}  |  Total Gas: ${metadata.totalGasEstimate.toLocaleString()}  |  Est. Cost: ${metadata.totalCostFormatted}`,
  );
  lines.push("═══════════════════════════════════════════════════════════════════════════════");
  lines.push("");

  // Steps
  let currentPhase = "";
  for (const step of steps) {
    // Phase header
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      const phaseTitle =
        currentPhase === "phase1"
          ? "PHASE 1: ADD NEW ADAPTER"
          : currentPhase === "smoke"
            ? "SMOKE TEST"
            : "PHASE 2: REMOVE OLD ADAPTER";
      lines.push("");
      lines.push(`${phaseTitle}`);
      lines.push("─".repeat(79));
    }

    // Step header
    lines.push("");
    lines.push(`Step ${step.stepNumber}: ${step.name}`);
    if (step.warning) {
      lines.push(`⚠️  WARNING: ${step.warning}`);
    }
    lines.push("");

    // Details
    lines.push(`  Contract:     ${step.contractName} (${step.contract.slice(0, 10)}...)`);
    lines.push(`  Function:     ${step.function}`);

    // Arguments
    if (step.arguments && step.arguments.length > 0) {
      lines.push(`  Arguments:`);
      for (const arg of step.arguments) {
        let valueDisplay = arg.value;
        if (typeof valueDisplay === "string" && valueDisplay.length > 50) {
          valueDisplay = valueDisplay.slice(0, 47) + "...";
        }
        lines.push(`    ${arg.name} (${arg.type}): ${valueDisplay}`);
      }
    }

    // Call data
    lines.push(`  Call Data:    ${step.callData.slice(0, 30)}...${step.callData.slice(-10)}`);
    lines.push(`  Gas Estimate: ${step.estimatedGas.toLocaleString()}`);
    if (step.estimatedCost > 0n) {
      lines.push(`  Est. Cost:    ${ethers.formatEther(step.estimatedCost)} MATIC`);
    }

    lines.push(`  Description:  ${step.description}`);
    if (step.dependsOn) {
      lines.push(`  Depends On:   Step ${step.dependsOn}`);
    }
    lines.push(`  Verify:       ${step.verification}`);

    if (step.notes) {
      lines.push(`  Notes:        ${step.notes}`);
    }

    // Metadata
    if (step.metadata) {
      if (step.metadata.preimage) {
        lines.push(`  Preimage:     ${step.metadata.preimage}`);
      }
      if (step.metadata.adapterId) {
        lines.push(`  Adapter ID:   ${step.metadata.adapterId}`);
      }
      if (step.metadata.capDisplay) {
        lines.push(`  Cap Value:    ${step.metadata.capDisplay}`);
      }
    }
  }

  // Footer
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════════════════════");
  lines.push("DRY-RUN COMPLETE");
  lines.push("");
  lines.push("No transactions have been sent. Review the plan above before executing.");
  lines.push(
    "To execute, run vault-post-deploy.js without --dry-run (and include --confirm-destructive).",
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Formats a plan as JSON (useful for programmatic consumption)
 * @param {Object} plan - Plan object from generateDryRunPlan
 * @returns {string} JSON string
 */
function formatPlanAsJson(plan) {
  return JSON.stringify(
    plan,
    (key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    },
    2,
  );
}

/**
 * Formats a plan as Markdown (useful for documentation/PRs)
 * @param {Object} plan - Plan object from generateDryRunPlan
 * @returns {string} Markdown string
 */
function formatPlanAsMarkdown(plan) {
  const lines = [];
  const { metadata, steps, config } = plan;

  lines.push("# Transaction Plan");
  lines.push("");
  lines.push(`**Generated:** ${metadata.generatedAt}`);
  lines.push("");

  // Overview table
  lines.push("## Overview");
  lines.push("");
  lines.push("| Parameter | Value |");
  lines.push("|-----------|-------|");
  lines.push(`| Vault | ${metadata.vaultAddress} |`);
  lines.push(`| New Adapter | ${metadata.newAdapterAddress} |`);
  if (metadata.oldAdapterAddress) {
    lines.push(`| Old Adapter | ${metadata.oldAdapterAddress} |`);
  }
  lines.push(
    `| Absolute Cap | ${config.absoluteCap === ethers.MaxUint256.toString() ? "unlimited" : config.absoluteCap} |`,
  );
  lines.push(`| Relative Cap | ${config.relativeCap} bps |`);
  lines.push(`| Total Steps | ${metadata.totalSteps} |`);
  lines.push(`| Total Gas | ${metadata.totalGasEstimate.toLocaleString()} |`);
  lines.push(`| Est. Cost | ${metadata.totalCostFormatted} |`);
  lines.push("");

  // Steps table
  lines.push("## Steps");
  lines.push("");
  lines.push("| Step | Phase | Name | Contract | Function | Gas |");
  lines.push("|------|-------|------|----------|----------|-----|");

  for (const step of steps) {
    lines.push(
      `| ${step.stepNumber} | ${step.phase} | ${step.name} | ${step.contractName} | ${step.function.split("(")[0]}() | ${step.estimatedGas.toLocaleString()} |`,
    );
  }
  lines.push("");

  // Detailed steps
  lines.push("## Detailed Breakdown");
  lines.push("");

  let currentPhase = "";
  for (const step of steps) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      const phaseTitle =
        currentPhase === "phase1"
          ? "Phase 1: Add New Adapter"
          : currentPhase === "smoke"
            ? "Smoke Test"
            : "Phase 2: Remove Old Adapter";
      lines.push(`### ${phaseTitle}`);
      lines.push("");
    }

    lines.push(`#### Step ${step.stepNumber}: ${step.name}`);
    lines.push("");
    lines.push(`- **Contract:** ${step.contractName} (${step.contract})`);
    lines.push(`- **Function:** ${step.function}`);
    lines.push(`- **Gas Estimate:** ${step.estimatedGas.toLocaleString()}`);
    lines.push(`- **Description:** ${step.description}`);
    if (step.warning) {
      lines.push(`- **⚠️ Warning:** ${step.warning}`);
    }
    lines.push("");

    lines.push("**Arguments:**");
    lines.push("");
    lines.push("| Name | Type | Value |");
    lines.push("|------|------|-------|");
    for (const arg of step.arguments) {
      let valueDisplay = arg.value;
      if (typeof valueDisplay === "string" && valueDisplay.length > 50) {
        valueDisplay = valueDisplay.slice(0, 47) + "...";
      }
      lines.push(`| ${arg.name} | ${arg.type} | ${valueDisplay} |`);
    }
    lines.push("");

    lines.push(`**Call Data:** \`${step.callData}\``);
    lines.push("");
    lines.push(`**Verification:** ${step.verification}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate estimated cost in wei
 * @param {number} gasLimit - Gas limit
 * @returns {bigint} Estimated cost in wei
 */
function calculateCost(gasLimit) {
  // Use maxFeePerGas for worst-case estimation
  return BigInt(gasLimit) * GAS_PRICE_ESTIMATES.maxFeePerGas;
}

/**
 * Encode submit(bytes) call
 * @param {string} data - Data to submit
 * @returns {string} Encoded call data
 */
function encodeSubmitCall(data) {
  const iface = new ethers.Interface(["function submit(bytes calldata data) external"]);
  return iface.encodeFunctionData("submit", [data]);
}

/**
 * Encode setIsAllocator call
 * @param {string} allocator - Allocator address
 * @param {boolean} isAllocator - Whether to grant or revoke
 * @returns {string} Encoded call data
 */
function encodeSetIsAllocator(allocator, isAllocator) {
  const iface = new ethers.Interface([
    "function setIsAllocator(address allocator, bool isAllocator) external",
  ]);
  return iface.encodeFunctionData("setIsAllocator", [allocator, isAllocator]);
}

/**
 * Encode smoke test allocate call
 * @param {string} adapter - Adapter address
 * @param {bigint} amount - Amount to allocate
 * @returns {string} Encoded call data
 */
function encodeSmokeAllocate(adapter, amount) {
  const iface = new ethers.Interface([
    "function allocate(address adapter, bytes calldata data, uint256 assets) external",
  ]);
  return iface.encodeFunctionData("allocate", [adapter, "0x", amount]);
}

/**
 * Fetch current on-chain state
 * @param {ethers.Provider} provider
 * @param {string} vaultAddress
 * @param {string} newAdapterAddress
 * @param {string} oldAdapterAddress
 * @returns {Promise<Object>} Current state
 */
async function fetchCurrentState(provider, vaultAddress, newAdapterAddress, oldAdapterAddress) {
  try {
    const vault = new ethers.Contract(vaultAddress, VAULT_PREFLIGHT_ABI, provider);

    const [isNewAdapter, isOldAdapter] = await Promise.all([
      vault.isAdapter(newAdapterAddress),
      vault.isAdapter(oldAdapterAddress),
    ]);

    const { adapterId: newAdapterId } = getCapPreimage(newAdapterAddress);
    const { adapterId: oldAdapterId } = getCapPreimage(oldAdapterAddress);

    const [newAbsCap, newRelCap, oldAbsCap, oldRelCap] = await Promise.all([
      vault.absoluteCap(newAdapterId),
      vault.relativeCap(newAdapterId),
      vault.absoluteCap(oldAdapterId),
      vault.relativeCap(oldAdapterId),
    ]);

    return {
      isNewAdapter,
      isOldAdapter,
      newAdapterAbsoluteCap: newAbsCap.toString(),
      newAdapterRelativeCap: newRelCap.toString(),
      oldAdapterAbsoluteCap: oldAbsCap.toString(),
      oldAdapterRelativeCap: oldRelCap.toString(),
    };
  } catch (error) {
    return {
      error: error.message,
      isNewAdapter: null,
      isOldAdapter: null,
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Main function
  generateDryRunPlan,

  // Formatters
  formatPlanAsText,
  formatPlanAsJson,
  formatPlanAsMarkdown,

  // Constants
  DEFAULT_GAS_ESTIMATES,
  GAS_PRICE_ESTIMATES,

  // Helpers (exported for testing)
  calculateCost,
  encodeSubmitCall,
  encodeSetIsAllocator,
  encodeSmokeAllocate,
  fetchCurrentState,
};
