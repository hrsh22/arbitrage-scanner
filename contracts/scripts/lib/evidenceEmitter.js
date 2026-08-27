/**
 * Evidence Emitter for Vault Post-Deploy One-Shot Flow
 *
 * Emits machine-readable JSON and human-readable text summaries
 * for each run of the vault deployment process.
 *
 * Usage:
 *   const { emitJsonEvidence, emitTextEvidence, emitEvidence } = require('./lib/evidenceEmitter');
 *
 *   const runData = {
 *     runId: 'deploy-2024-01-01',
 *     config: { vault: '0x...', adapter: '0x...' },
 *     steps: [
 *       { name: 'Add adapter', txHash: '0x...', status: 'success', blockNumber: 12345 },
 *       { name: 'Set caps', txHash: '0x...', status: 'failure', error: 'Cap too high' }
 *     ],
 *     verdict: 'failure',
 *     blockers: ['Cap exceeds maximum'],
 *     failedAtStep: 'Set caps'
 *   };
 *
 *   await emitEvidence(runData, './evidence/run-123.json', './evidence/run-123.txt');
 */

const fs = require("fs");
const path = require("path");

/**
 * Generate a timestamped filename to avoid overwriting prior evidence
 * @param {string} baseName - Base name for the file
 * @param {string} ext - File extension (without dot)
 * @returns {string} Timestamped filename
 */
function generateTimestampedFilename(baseName, ext) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${baseName}-${timestamp}.${ext}`;
}

/**
 * Ensure directory exists for file path
 * @param {string} filepath - Full file path
 */
function ensureDirectoryExists(filepath) {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate recovery command based on failed step and state
 * @param {Object} runData - Run data object
 * @returns {string} Recovery command
 */
function generateRecoveryCommand(runData) {
  const { config, failedAtStep, lastCompletedStep, runId } = runData;

  if (!config) {
    return "# Recovery: No config available. Please check logs and run manually.";
  }

  const baseCmd = "node vault-post-deploy.js";
  const flags = [];

  // Add required flags from config
  if (config.vault) flags.push(`--vault ${config.vault}`);
  if (config.newAdapter) flags.push(`--new-adapter ${config.newAdapter}`);
  if (config.oldAdapter) flags.push(`--old-adapter ${config.oldAdapter}`);
  if (config.rpcUrl) flags.push(`--rpc-url ${config.rpcUrl}`);

  // Add optional flags
  if (config.absoluteCap) flags.push(`--absolute-cap ${config.absoluteCap}`);
  if (config.relativeCap) flags.push(`--relative-cap ${config.relativeCap}`);
  if (config.allocator) flags.push(`--allocator ${config.allocator}`);

  // Always add confirm-destructive for recovery since we're resuming
  flags.push("--confirm-destructive");

  const cmd = `${baseCmd} ${flags.join(" ")}`;

  // Add comment about where to resume
  let comment = `# Resume from: ${failedAtStep || lastCompletedStep || "beginning"}`;
  if (runId) comment += `\n# Run ID: ${runId}`;

  return `${comment}\n${cmd}`;
}

/**
 * Emit machine-readable JSON evidence
 * @param {Object} runData - Run data containing config, steps, verdict, etc.
 * @param {string} filepath - Path to write JSON file
 * @param {Object} options - Options { timestamped: boolean }
 * @returns {string} Path to written file
 */
function emitJsonEvidence(runData, filepath, options = {}) {
  const { timestamped = true } = options;

  // Generate timestamped path if requested
  const finalPath = timestamped
    ? filepath.replace(/\.json$/, "") +
      "-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json"
    : filepath;

  ensureDirectoryExists(finalPath);

  // Build evidence structure
  const evidence = {
    schema: "evidence-v1",
    timestamp: new Date().toISOString(),
    runId: runData.runId || null,
    config: runData.config || {},
    steps: (runData.steps || []).map((step) => ({
      name: step.name,
      status: step.status, // 'success', 'failure', 'skipped', 'pending'
      txHash: step.txHash || null,
      blockNumber: step.blockNumber || null,
      gasUsed: step.gasUsed || null,
      error: step.error || null,
      timestamp: step.timestamp || null,
      duration: step.duration || null,
    })),
    verdict: runData.verdict || "unknown", // 'success', 'failure', 'partial'
    failedAtStep: runData.failedAtStep || null,
    lastCompletedStep: runData.lastCompletedStep || null,
    blockers: runData.blockers || [],
    metadata: {
      totalSteps: (runData.steps || []).length,
      completedSteps: (runData.steps || []).filter((s) => s.status === "success").length,
      failedSteps: (runData.steps || []).filter((s) => s.status === "failure").length,
      skippedSteps: (runData.steps || []).filter((s) => s.status === "skipped").length,
    },
    recovery: {
      canResume: runData.verdict !== "success" && runData.failedAtStep !== null,
      command: generateRecoveryCommand(runData),
      stateFile: runData.stateFile || ".vault-post-deploy-state.json",
    },
  };

  // Write JSON file
  fs.writeFileSync(finalPath, JSON.stringify(evidence, null, 2));

  return finalPath;
}

/**
 * Emit human-readable text evidence
 * @param {Object} runData - Run data containing config, steps, verdict, etc.
 * @param {string} filepath - Path to write text file
 * @param {Object} options - Options { timestamped: boolean }
 * @returns {string} Path to written file
 */
function emitTextEvidence(runData, filepath, options = {}) {
  const { timestamped = true } = options;

  // Generate timestamped path if requested
  const finalPath = timestamped
    ? filepath.replace(/\.txt$/, "") + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt"
    : filepath;

  ensureDirectoryExists(finalPath);

  const lines = [];
  const separator = "=".repeat(70);

  // Header
  lines.push(separator);
  lines.push("VAULT POST-DEPLOY EXECUTION EVIDENCE");
  lines.push(separator);
  lines.push("");

  // Metadata
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Run ID: ${runData.runId || "N/A"}`);
  lines.push(`Verdict: ${runData.verdict?.toUpperCase() || "UNKNOWN"}`);
  lines.push("");

  // Configuration
  lines.push(separator);
  lines.push("CONFIGURATION");
  lines.push(separator);
  if (runData.config && Object.keys(runData.config).length > 0) {
    Object.entries(runData.config).forEach(([key, value]) => {
      lines.push(`  ${key}: ${value || "(not set)"}`);
    });
  } else {
    lines.push("  (no configuration recorded)");
  }
  lines.push("");

  // Steps
  lines.push(separator);
  lines.push("EXECUTION STEPS");
  lines.push(separator);

  if (runData.steps && runData.steps.length > 0) {
    runData.steps.forEach((step, index) => {
      const statusIcon =
        step.status === "success"
          ? "✓"
          : step.status === "failure"
            ? "✗"
            : step.status === "skipped"
              ? "⊘"
              : "○";
      lines.push(`\n[${index + 1}] ${statusIcon} ${step.name}`);
      lines.push(`    Status: ${step.status.toUpperCase()}`);

      if (step.txHash) {
        lines.push(`    Transaction: ${step.txHash}`);
      }
      if (step.blockNumber) {
        lines.push(`    Block: ${step.blockNumber}`);
      }
      if (step.gasUsed) {
        lines.push(`    Gas Used: ${step.gasUsed}`);
      }
      if (step.timestamp) {
        lines.push(`    Timestamp: ${step.timestamp}`);
      }
      if (step.duration) {
        lines.push(`    Duration: ${step.duration}ms`);
      }
      if (step.error) {
        lines.push(`    Error: ${step.error}`);
      }
    });
  } else {
    lines.push("  (no steps recorded)");
  }
  lines.push("");

  // Summary statistics
  lines.push(separator);
  lines.push("SUMMARY STATISTICS");
  lines.push(separator);
  const total = (runData.steps || []).length;
  const success = (runData.steps || []).filter((s) => s.status === "success").length;
  const failed = (runData.steps || []).filter((s) => s.status === "failure").length;
  const skipped = (runData.steps || []).filter((s) => s.status === "skipped").length;

  lines.push(`  Total Steps:    ${total}`);
  lines.push(`  Successful:     ${success}`);
  lines.push(`  Failed:         ${failed}`);
  lines.push(`  Skipped:        ${skipped}`);
  lines.push("");

  // Blockers (if any)
  if (runData.blockers && runData.blockers.length > 0) {
    lines.push(separator);
    lines.push("BLOCKERS IDENTIFIED");
    lines.push(separator);
    runData.blockers.forEach((blocker, index) => {
      lines.push(`  ${index + 1}. ${blocker}`);
    });
    lines.push("");
  }

  // Failure details
  if (runData.failedAtStep) {
    lines.push(separator);
    lines.push("FAILURE DETAILS");
    lines.push(separator);
    lines.push(`  Failed at Step: ${runData.failedAtStep}`);
    if (runData.lastCompletedStep) {
      lines.push(`  Last Completed: ${runData.lastCompletedStep}`);
    }
    lines.push("");
  }

  // Recovery instructions
  lines.push(separator);
  lines.push("RECOVERY INSTRUCTIONS");
  lines.push(separator);

  if (runData.verdict === "success") {
    lines.push("  ✓ Execution completed successfully.");
    lines.push("  ✓ State file has been cleared.");
    lines.push("  ✓ No recovery action required.");
  } else {
    lines.push("  ⚠ Execution did not complete successfully.");
    lines.push("");

    if (runData.failedAtStep) {
      lines.push(`  Failed at: ${runData.failedAtStep}`);
    }

    lines.push("");
    lines.push("  To resume execution, run the following command:");
    lines.push("");
    lines.push("  ```bash");
    lines.push(`  ${generateRecoveryCommand(runData)}`);
    lines.push("  ```");
    lines.push("");
    lines.push("  State is preserved in:");
    lines.push(`    ${runData.stateFile || ".vault-post-deploy-state.json"}`);
    lines.push("");
    lines.push("  The script will automatically resume from the failed step.");
  }
  lines.push("");

  // Footer
  lines.push(separator);
  lines.push("END OF EVIDENCE REPORT");
  lines.push(separator);

  // Write text file
  fs.writeFileSync(finalPath, lines.join("\n"));

  return finalPath;
}

/**
 * Emit both JSON and text evidence in one call
 * @param {Object} runData - Run data containing config, steps, verdict, etc.
 * @param {string} jsonPath - Path for JSON file (or null to skip)
 * @param {string} textPath - Path for text file (or null to skip)
 * @param {Object} options - Options { timestamped: boolean }
 * @returns {Object} Paths to written files { jsonPath, textPath }
 */
function emitEvidence(runData, jsonPath, textPath, options = {}) {
  const result = {
    jsonPath: null,
    textPath: null,
  };

  if (jsonPath) {
    result.jsonPath = emitJsonEvidence(runData, jsonPath, options);
  }

  if (textPath) {
    result.textPath = emitTextEvidence(runData, textPath, options);
  }

  return result;
}

module.exports = {
  emitJsonEvidence,
  emitTextEvidence,
  emitEvidence,
  generateRecoveryCommand,
  generateTimestampedFilename,
};
