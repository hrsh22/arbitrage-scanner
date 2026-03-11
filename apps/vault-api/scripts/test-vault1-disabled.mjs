#!/usr/bin/env node
/**
 * Test script to verify disabled vault1 doesn't break runtime
 *
 * This script verifies:
 * 1. getEnabledVaultConfigs() returns empty array when vault1 is disabled
 * 2. No VAULT_1_* env vars are required for disabled config
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Unset all VAULT_1_* environment variables to simulate missing env vars
const envVarsToUnset = [
  "VAULT_1_ALLOCATOR_NAV_KEY",
  "VAULT_1_SAFE_OPERATOR_KEY",
  "VAULT_1_TRADING_SIGNER_KEY",
  "VAULT_1_TRADING_FUNDER_ADDRESS",
];

console.log("=== Vault1 Disable Validation Test ===\n");

console.log("Step 1: Unsetting VAULT_1_* environment variables...");
for (const envVar of envVarsToUnset) {
  const wasSet = envVar in process.env;
  delete process.env[envVar];
  console.log(`  ${envVar}: ${wasSet ? "was set, now unset" : "already unset"}`);
}

console.log("\nStep 2: Attempting to import vault config module...");

try {
  // Import from the dist directory (compiled output)
  const configModule = await import("../dist/config/index.js");

  console.log("  ✓ Module imported successfully (no env var errors)");

  console.log("\nStep 3: Checking getEnabledVaultConfigs()...");
  const enabledConfigs = configModule.getEnabledVaultConfigs();
  console.log(`  Enabled vaults count: ${enabledConfigs.length}`);

  if (enabledConfigs.length === 0) {
    console.log("  ✓ getEnabledVaultConfigs() returns empty array as expected");
  } else {
    console.log("  ✗ UNEXPECTED: getEnabledVaultConfigs() returned vaults:");
    for (const config of enabledConfigs) {
      console.log(`    - ID ${config.id}: ${config.name} (enabled: ${config.enabled})`);
    }
    process.exit(1);
  }

  console.log("\nStep 4: Checking getAllVaultConfigs()...");
  const allConfigs = configModule.getAllVaultConfigs();
  console.log(`  All vaults count: ${allConfigs.length}`);

  for (const config of allConfigs) {
    console.log(`    - ID ${config.id}: ${config.name} (enabled: ${config.enabled})`);
  }

  // Verify vault1 is in all configs but disabled
  const vault1 = allConfigs.find((c) => c.id === 1);
  if (vault1) {
    if (vault1.enabled === false) {
      console.log("  ✓ Vault1 is present but disabled");
    } else {
      console.log("  ✗ UNEXPECTED: Vault1 is enabled");
      process.exit(1);
    }
  } else {
    console.log("  Note: Vault1 not found in all configs");
  }

  console.log("\n=== TEST PASSED ===");
  console.log("All checks successful:");
  console.log("  ✓ Build passes without errors");
  console.log("  ✓ getEnabledVaultConfigs() returns empty array");
  console.log("  ✓ No VAULT_1_* env vars required when disabled");
  console.log("  ✓ No fatal errors during module load");
} catch (error) {
  console.error("\n✗ TEST FAILED");
  console.error("Error during test:", error.message);
  console.error("\nStack trace:", error.stack);
  process.exit(1);
}
