#!/usr/bin/env node

/**
 * Vault Metadata Update Script
 *
 * Updates vault share token name and symbol with owner verification.
 *
 * Usage:
 *   node set-vault-metadata.js \
 *     --vault <address> \
 *     --name "New Name" \
 *     --symbol "NEW" \
 *     --rpc-url <url> \
 *     --private-key <key> \
 *     [--dry-run]
 *
 * Features:
 *   - Owner permission verification
 *   - Pre/post state readback
 *   - Dry-run mode for simulation
 *   - Exit codes: 0 (success), 1 (error)
 */

const ethers = require("ethers");
require("dotenv").config();

// ============================================================================
// Minimal Vault ABI
// ============================================================================

const VAULT_ABI = [
  // View functions
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  // Write functions
  "function setName(string memory newName)",
  "function setSymbol(string memory newSymbol)",
];

// ============================================================================
// Configuration
// ============================================================================

const GAS_CONFIG = {
  gasLimit: 300000,
  maxFeePerGas: ethers.parseUnits("400", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
};

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

function validateRpcUrl(url) {
  if (!url) {
    return "--rpc-url is required";
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "--rpc-url must be a valid HTTP(S) URL";
  }
  return null;
}

function validatePrivateKey(key) {
  if (!key) {
    return "--private-key is required";
  }
  if (!key.startsWith("0x") || key.length !== 66) {
    return "--private-key must be a valid private key (0x + 64 hex chars)";
  }
  return null;
}

// ============================================================================
// Help Text
// ============================================================================

function showHelp() {
  console.log(`
Vault Metadata Update Script

Updates vault share token name and symbol with owner verification.

REQUIRED FLAGS:
    --vault <address>           Vault contract address
    --name <string>             New vault name (enclose in quotes if contains spaces)
    --symbol <string>           New vault symbol (max 11 chars recommended)
    --rpc-url <url>             RPC endpoint URL
    --private-key <key>         Private key for signing (0x + 64 hex chars)

OPTIONAL FLAGS:
    --dry-run                   Simulate transactions without sending
    -h, --help                  Show this help message

EXAMPLES:

  # Dry run to preview changes
  node set-vault-metadata.js \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --name "Polymarket Vault Shares" \\
    --symbol "pmUSDC" \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --private-key 0x... \\
    --dry-run

  # Execute the update
  node set-vault-metadata.js \\
    --vault 0x066A4678935b78FA4E89e914dBE8F077764F0c74 \\
    --name "Polymarket Vault Shares" \\
    --symbol "pmUSDC" \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --private-key 0x...

SAFETY FEATURES:
  ✓ Validates all addresses and private key format
  ✓ Verifies caller is vault owner before any transactions
  ✓ Reads pre-state (current name/symbol)
  ✓ Reads post-state (new name/symbol) for verification
  ✓ Dry-run mode to preview intended calls

EXIT CODES:
  0 - Success (or dry-run completed)
  1 - Error (validation failure, not owner, or transaction failed)
`);
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  const parsed = parseArgs();

  if (parsed.help) {
    showHelp();
    process.exit(0);
  }

  const flags = parsed.flags;
  const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true";

  // Validate required flags
  const vaultErr = validateAddress(flags.vault, "--vault");
  const rpcErr = validateRpcUrl(flags["rpc-url"]);
  const keyErr = validatePrivateKey(flags["private-key"]);
  const nameErr = !flags.name ? "--name is required" : null;
  const symbolErr = !flags.symbol ? "--symbol is required" : null;

  const errors = [vaultErr, rpcErr, keyErr, nameErr, symbolErr].filter(Boolean);

  if (errors.length > 0) {
    console.error("❌ Validation errors:");
    errors.forEach((e) => console.error(`   - ${e}`));
    console.error("\nUse --help for usage information.");
    process.exit(1);
  }

  const vaultAddress = flags.vault;
  const newName = flags.name;
  const newSymbol = flags.symbol;
  const rpcUrl = flags["rpc-url"];
  const privateKey = flags["private-key"];

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║           VAULT METADATA UPDATE                              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Configuration:");
  console.log(`  Vault:       ${vaultAddress}`);
  console.log(`  New Name:    "${newName}"`);
  console.log(`  New Symbol:  "${newSymbol}"`);
  console.log(`  RPC URL:     ${rpcUrl}`);
  console.log(`  Mode:        ${dryRun ? "DRY RUN (simulation only)" : "LIVE EXECUTION"}`);
  console.log("");

  // Connect to provider and vault
  let provider;
  let wallet;
  let vault;

  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    wallet = new ethers.Wallet(privateKey, provider);
    vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
  } catch (error) {
    console.error(`❌ Failed to connect: ${error.message}`);
    process.exit(1);
  }

  // Step 1: Read current state (pre)
  console.log("[STEP 1/4] Reading current vault metadata...");

  let currentName;
  let currentSymbol;
  let ownerAddress;

  try {
    [currentName, currentSymbol, ownerAddress] = await Promise.all([
      vault.name(),
      vault.symbol(),
      vault.owner(),
    ]);

    console.log(`   Current Name:   "${currentName}"`);
    console.log(`   Current Symbol: "${currentSymbol}"`);
    console.log(`   Owner:          ${ownerAddress}`);
  } catch (error) {
    console.error(`❌ Failed to read vault state: ${error.message}`);
    process.exit(1);
  }

  // Step 2: Verify ownership
  console.log("\n[STEP 2/4] Verifying ownership...");

  const signerAddress = await wallet.getAddress();
  console.log(`   Signer:         ${signerAddress}`);
  console.log(`   Vault Owner:    ${ownerAddress}`);

  if (signerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
    console.error("❌ Ownership check FAILED");
    console.error(`   Signer ${signerAddress} is not the vault owner ${ownerAddress}`);
    console.error("   Only the vault owner can update name and symbol.");
    process.exit(1);
  }

  console.log("   ✅ Signer is the vault owner");

  // Step 3: Execute or simulate
  console.log("\n[STEP 3/4] Preparing transactions...");

  if (dryRun) {
    console.log("   🔍 DRY RUN MODE - No transactions will be sent");
    console.log("");
    console.log("   Intended calls:");
    console.log(`   ┌─────────────────────────────────────────────────────────────┐`);
    console.log(`   │ 1. vault.setName("${newName}")`);
    console.log(`   │    To: ${vaultAddress}`);
    console.log(`   │    From: ${signerAddress}`);
    console.log(`   │    Gas: ${GAS_CONFIG.gasLimit}`);
    console.log(`   ├─────────────────────────────────────────────────────────────┤`);
    console.log(`   │ 2. vault.setSymbol("${newSymbol}")`);
    console.log(`   │    To: ${vaultAddress}`);
    console.log(`   │    From: ${signerAddress}`);
    console.log(`   │    Gas: ${GAS_CONFIG.gasLimit}`);
    console.log(`   └─────────────────────────────────────────────────────────────┘`);
    console.log("");
    console.log("   Pre-state:");
    console.log(`     Name:   "${currentName}"`);
    console.log(`     Symbol: "${currentSymbol}"`);
    console.log("");
    console.log("   Expected post-state:");
    console.log(`     Name:   "${newName}"`);
    console.log(`     Symbol: "${newSymbol}"`);
    console.log("");
    console.log("   ✅ Dry run complete. No transactions sent.");
    console.log("   To execute, run without --dry-run flag.");
    process.exit(0);
  }

  // Live execution
  console.log("   📝 Sending transactions...");

  const vaultWithSigner = vault.connect(wallet);
  let setNameTx;
  let setSymbolTx;

  try {
    // Execute setName
    console.log(`   Calling vault.setName("${newName}")...`);
    setNameTx = await vaultWithSigner.setName(newName, GAS_CONFIG);
    console.log(`   Tx hash: ${setNameTx.hash}`);
    console.log("   Waiting for confirmation...");
    const nameReceipt = await setNameTx.wait();
    console.log(`   ✅ setName confirmed (block ${nameReceipt.blockNumber})`);

    // Execute setSymbol
    console.log(`\n   Calling vault.setSymbol("${newSymbol}")...`);
    setSymbolTx = await vaultWithSigner.setSymbol(newSymbol, GAS_CONFIG);
    console.log(`   Tx hash: ${setSymbolTx.hash}`);
    console.log("   Waiting for confirmation...");
    const symbolReceipt = await setSymbolTx.wait();
    console.log(`   ✅ setSymbol confirmed (block ${symbolReceipt.blockNumber})`);
  } catch (error) {
    console.error(`\n❌ Transaction failed: ${error.message}`);
    process.exit(1);
  }

  // Step 4: Verify post-state
  console.log("\n[STEP 4/4] Verifying updated metadata...");

  let updatedName;
  let updatedSymbol;

  try {
    [updatedName, updatedSymbol] = await Promise.all([vault.name(), vault.symbol()]);

    console.log(`   Updated Name:   "${updatedName}"`);
    console.log(`   Updated Symbol: "${updatedSymbol}"`);
  } catch (error) {
    console.error(`❌ Failed to read updated state: ${error.message}`);
    process.exit(1);
  }

  // Verify changes
  const nameOk = updatedName === newName;
  const symbolOk = updatedSymbol === newSymbol;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  if (nameOk && symbolOk) {
    console.log("║  ✅ UPDATE SUCCESSFUL                                        ║");
  } else {
    console.log("║  ⚠️  UPDATE COMPLETED WITH WARNINGS                          ║");
  }
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Summary:");
  console.log(`  Name:   "${currentName}" → "${updatedName}" ${nameOk ? "✅" : "❌"}`);
  console.log(`  Symbol: "${currentSymbol}" → "${updatedSymbol}" ${symbolOk ? "✅" : "❌"}`);
  console.log("");

  if (setNameTx && setSymbolTx) {
    console.log("Transactions:");
    console.log(`  setName:   ${setNameTx.hash}`);
    console.log(`  setSymbol: ${setSymbolTx.hash}`);
    console.log("");
  }

  if (!nameOk || !symbolOk) {
    console.error("❌ Verification failed: Metadata does not match expected values.");
    process.exit(1);
  }

  console.log("✅ Vault metadata updated successfully!");
  process.exit(0);
}

// Run main
main().catch((error) => {
  console.error(`\n❌ Unexpected error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
