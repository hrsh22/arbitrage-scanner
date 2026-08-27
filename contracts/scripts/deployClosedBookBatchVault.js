#!/usr/bin/env node

/**
 * Closed Book Batch Vault Deployment Script
 *
 * CLI for deploying the ClosedBookBatchVault contract.
 *
 * This is a NEW contract that will eventually replace EpochTrancheVault.
 * Current state: Prepared for deployment, NOT yet live on Amoy.
 *
 * Usage:
 *   node deployClosedBookBatchVault.js --profile <profile> --rpc-url <url> [--dry-run]
 *
 * Profiles:
 *   production    - 7-day epochs (604800 seconds), mainnet addresses
 *   staging       - 1-hour epochs (3600 seconds), testnet addresses
 *   test          - 15-minute epochs (900 seconds), local/anvil addresses
 *
 * Required Environment Variables:
 *   PRIVATE_KEY                        - Deployer private key
 *   CBBV_ADMIN_ADDRESS                 - Admin role address
 *   CBBV_SETTLER_ADDRESS               - Settler role address
 *   CBBV_NAV_UPDATER_ADDRESS           - NAV updater role address
 *   CBBV_SNAPSHOTTER_ADDRESS           - Snapshot role address
 *   CBBV_DEPOSIT_PROCESSOR_ADDRESS     - Deposit processor role address
 *   CBBV_TRADING_WALLET_ADDRESS        - Trading wallet / Safe address
 *
 * Optional Environment Variables (profile-specific overrides):
 *   CBBV_ASSET_ADDRESS                 - Asset token address (defaults per profile)
 *   CBBV_NAV_STALENESS_THRESHOLD       - NAV staleness threshold (defaults per profile)
 *
 * Examples:
 *   # Dry run for production
 *   node deployClosedBookBatchVault.js --profile production --rpc-url https://polygon-mainnet.g.alchemy.com/v2/KEY --dry-run
 *
 *   # Deploy to staging
 *   node deployClosedBookBatchVault.js --profile staging --rpc-url https://polygon-amoy.g.alchemy.com/v2/KEY
 *
 *   # Deploy to local anvil
 *   node deployClosedBookBatchVault.js --profile test --rpc-url http://localhost:8545
 */

// ============================================================================
// Library Imports
// ============================================================================

const ethers = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ============================================================================
// Configuration
// ============================================================================

const PROFILES = {
  production: {
    name: "Production",
    navStalenessThreshold: 21600,
    assetAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e on Polygon mainnet
    description: "Production deployment for the closed-book batch vault",
    chainId: 137,
  },
  staging: {
    name: "Staging",
    navStalenessThreshold: 3600,
    assetAddress: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", // USDC on Amoy testnet
    description: "Staging deployment for the closed-book batch vault",
    chainId: 80002,
  },
  test: {
    name: "Test",
    navStalenessThreshold: 900,
    assetAddress: null, // Must be provided via env or deployed locally
    description: "Local deployment for the closed-book batch vault",
    chainId: 31337,
  },
};

const GAS_CONFIG = {
  gasLimit: 5000000,
  // Gas pricing: uses provider fee data with env overrides and profile-aware caps
  // Staging/production can override via env vars for cost control
  maxFeePerGasGwei: process.env.CBBV_MAX_FEE_PER_GAS_GWEI
    ? parseInt(process.env.CBBV_MAX_FEE_PER_GAS_GWEI, 10)
    : null, // null = use provider fee data with caps
  maxPriorityFeePerGasGwei: process.env.CBBV_MAX_PRIORITY_FEE_PER_GAS_GWEI
    ? parseInt(process.env.CBBV_MAX_PRIORITY_FEE_PER_GAS_GWEI, 10)
    : null, // null = use provider fee data with caps
  // Profile-specific caps (in gwei) when using provider fee data
  caps: {
    production: {
      maxFeePerGas: 100, // 100 gwei cap for production
      maxPriorityFeePerGas: 30, // 30 gwei cap for production
    },
    staging: {
      maxFeePerGas: 50, // 50 gwei cap for staging (sufficient for Amoy ~30 gwei)
      maxPriorityFeePerGas: 15, // 15 gwei priority fee cap for staging
    },
    test: {
      maxFeePerGas: 100, // generous for local anvil
      maxPriorityFeePerGas: 30,
    },
  },
};

const REQUIRED_ENV_VARS = [
  "PRIVATE_KEY",
  "CBBV_ADMIN_ADDRESS",
  "CBBV_SETTLER_ADDRESS",
  "CBBV_NAV_UPDATER_ADDRESS",
  "CBBV_SNAPSHOTTER_ADDRESS",
  "CBBV_DEPOSIT_PROCESSOR_ADDRESS",
  "CBBV_TRADING_WALLET_ADDRESS",
];

// ClosedBookBatchVault ABI (constructor and basic functions)
const CBBV_ABI = [
  // Constructor
  "constructor(address _asset, address _admin, address _settler, address _navUpdater, address _snapshotter, address _depositProcessor, address _tradingWallet, uint256 _navStalenessThreshold)",
  // Read functions
  "function asset() view returns (address)",
  "function NAV_STALENESS_THRESHOLD() view returns (uint256)",
  "function DEPLOY_TIME() view returns (uint256)",
  "function ADMIN_ROLE() view returns (bytes32)",
  "function SETTLER_ROLE() view returns (bytes32)",
  "function NAV_UPDATER_ROLE() view returns (bytes32)",
  "function SNAPSHOT_ROLE() view returns (bytes32)",
  "function DEPOSIT_PROCESSOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function currentNAV() view returns (uint256)",
  "function lastNAVUpdate() view returns (uint256)",
  "function tradingWallet() view returns (address)",
  "function emergencyMode() view returns (bool)",
  "function currentBatchId() view returns (uint256)",
  "function getCurrentBatch() view returns (uint256)",
  "function getBatchStatus(uint256 batchId) view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalQueuedAssets() view returns (uint256)",
  "function totalPendingRedeemShares() view returns (uint256)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  // Write functions
  "function updateNAV(uint256 _nav) external",
  "function setEmergencyMode(bool _active) external",
  "function queueDeposit(uint256 assets) external returns (uint256 requestId)",
  "function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256 requestId)",
];

// ClosedBookBatchVault Bytecode (placeholder - will be populated from build output)
const CBBV_BYTECODE = process.env.CBBV_BYTECODE || "0x";

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

function validateProfile(profile) {
  if (!profile) {
    return "--profile is required";
  }
  if (!PROFILES[profile]) {
    return `Invalid profile: ${profile}. Must be one of: ${Object.keys(PROFILES).join(", ")}`;
  }
  return null;
}

function validateEnvironment(useJson) {
  const errors = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar];
    if (!value) {
      errors.push(`${envVar} not set in environment`);
    } else if (envVar.endsWith("_ADDRESS") && !isValidAddress(value)) {
      errors.push(`${envVar} format invalid (must be 0x + 40 hex chars)`);
    } else if (envVar === "PRIVATE_KEY" && (!value.startsWith("0x") || value.length !== 66)) {
      errors.push(`${envVar} format invalid (must be 0x + 64 hex chars)`);
    }
  }

  if (errors.length > 0) {
    if (useJson) {
      console.log(JSON.stringify({ error: errors.join("; "), success: false }, null, 2));
    } else {
      console.error("\n╔══════════════════════════════════════════════════════════════╗");
      console.error("║  ENVIRONMENT VALIDATION ERRORS                               ║");
      console.error("╚══════════════════════════════════════════════════════════════╝\n");
      errors.forEach((e) => console.error(`  ❌ ${e}`));
      console.error("\nCreate a .env file with the required variables.");
    }
    return false;
  }

  return true;
}

function validateRequiredFlags(flags, useJson) {
  const errors = [];

  const profileErr = validateProfile(flags.profile);
  const rpcErr = validateRpcUrl(flags["rpc-url"]);

  if (profileErr) errors.push(profileErr);
  if (rpcErr) errors.push(rpcErr);

  if (errors.length > 0) {
    if (useJson) {
      console.log(JSON.stringify({ error: errors.join("; "), success: false }, null, 2));
    } else {
      console.error("\n╔══════════════════════════════════════════════════════════════╗");
      console.error("║  VALIDATION ERRORS                                           ║");
      console.error("╚══════════════════════════════════════════════════════════════╝\n");
      errors.forEach((e) => console.error(`  ❌ ${e}`));
      console.error("\nRun with --help for usage information.");
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
Closed Book Batch Vault Deployment CLI

DESCRIPTION:
  Deploys the ClosedBookBatchVault contract - the NEW vault implementation
  that will eventually replace EpochTrancheVault.

  CURRENT STATE: Prepared for deployment, NOT yet live on Amoy.
  
  The legacy EpochTrancheVault remains active at:
    0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D

USAGE:
  node deployClosedBookBatchVault.js --profile <profile> --rpc-url <url> [options]

REQUIRED FLAGS:
  --profile <profile>         Deployment profile (production|staging|test)
  --rpc-url <url>             RPC endpoint URL (http:// or https://)

OPTIONS:
  --dry-run                   Simulate deployment without sending transactions
  --json                      Output results as JSON
  --output-dir <path>         Directory for deployment artifacts (default: ./deployments)
  -h, --help                  Show this help message

PROFILES:
  production                  7-day epochs, Polygon mainnet
                              Epoch duration: 604800 seconds
                              Asset: USDC.e (0x2791...4174)

  staging                     1-hour epochs, Polygon Amoy testnet
                              Epoch duration: 3600 seconds
                              Asset: USDC (0x41E9...7582)

  test                        15-minute epochs, local/anvil
                              Epoch duration: 900 seconds
                              Asset: Must set CBBV_ASSET_ADDRESS

REQUIRED ENVIRONMENT VARIABLES:
  PRIVATE_KEY                          Deployer private key (0x + 64 hex)
  CBBV_ADMIN_ADDRESS                   Admin role address
  CBBV_SETTLER_ADDRESS                 Settler role address
  CBBV_NAV_UPDATER_ADDRESS             NAV updater role address
  CBBV_SNAPSHOTTER_ADDRESS             Snapshot role address
  CBBV_DEPOSIT_PROCESSOR_ADDRESS       Deposit processor role address

OPTIONAL ENVIRONMENT VARIABLES:
  CBBV_ASSET_ADDRESS                   Override asset address
  CBBV_NAV_STALENESS_THRESHOLD         Override NAV staleness threshold
  CBBV_BYTECODE                        Contract bytecode (for testing)

EXAMPLES:
  # Dry run for production
  node deployClosedBookBatchVault.js \\
    --profile production \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --dry-run

  # Deploy to staging
  node deployClosedBookBatchVault.js \\
    --profile staging \\
    --rpc-url https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY

OUTPUT:
  Deployment artifacts are saved to:
    - <output-dir>/closed-book-batch-vault-<profile>-<timestamp>.json
    - <output-dir>/closed-book-batch-vault-<profile>-latest.json

  Evidence files are saved to:
    - .sisyphus/evidence/task-deploy-cbbv-dry-run.txt

LEGACY CONTRACT:
  EpochTrancheVault remains active for production use.
  Deployment script: deployEpochTrancheVault.js
`);
}

// ============================================================================
// Contract Bytecode Loader
// ============================================================================

function loadBytecode() {
  // First check environment variable
  if (process.env.CBBV_BYTECODE && process.env.CBBV_BYTECODE !== "0x") {
    return process.env.CBBV_BYTECODE;
  }

  // Try to load from Foundry build artifacts
  const artifactPaths = [
    path.join(__dirname, "../out/ClosedBookBatchVault.sol/ClosedBookBatchVault.json"),
    path.join(
      __dirname,
      "../artifacts/contracts/ClosedBookBatchVault.sol/ClosedBookBatchVault.json",
    ),
    path.join(__dirname, "./artifacts/ClosedBookBatchVault.json"),
  ];

  for (const artifactPath of artifactPaths) {
    try {
      if (fs.existsSync(artifactPath)) {
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        if (artifact.bytecode || artifact.deployedBytecode) {
          return artifact.bytecode || artifact.deployedBytecode.object || artifact.deployedBytecode;
        }
      }
    } catch (error) {
      // Continue to next path
    }
  }

  return null;
}

// ============================================================================
// Gas Configuration Helper
// ============================================================================

/**
 * Calculate gas fees based on provider data with profile-aware caps and env overrides.
 * Priority: env vars > provider data (capped) > hardcoded defaults
 *
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @param {string} profile - Deployment profile (production|staging|test)
 * @returns {Promise<{maxFeePerGas: bigint, maxPriorityFeePerGas: bigint}>}
 */
async function calculateGasFees(provider, profile) {
  // If env vars are set, use them directly (absolute override)
  if (GAS_CONFIG.maxFeePerGasGwei !== null && GAS_CONFIG.maxPriorityFeePerGasGwei !== null) {
    return {
      maxFeePerGas: ethers.parseUnits(String(GAS_CONFIG.maxFeePerGasGwei), "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits(String(GAS_CONFIG.maxPriorityFeePerGasGwei), "gwei"),
    };
  }

  // Get fee data from provider
  const feeData = await provider.getFeeData();
  const caps = GAS_CONFIG.caps[profile] || GAS_CONFIG.caps.staging;

  // Calculate maxFeePerGas with cap
  let maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits("50", "gwei");
  const maxFeeCap = ethers.parseUnits(String(caps.maxFeePerGas), "gwei");
  if (maxFeePerGas > maxFeeCap) {
    maxFeePerGas = maxFeeCap;
  }

  // Calculate maxPriorityFeePerGas with cap
  let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits("10", "gwei");
  const maxPriorityCap = ethers.parseUnits(String(caps.maxPriorityFeePerGas), "gwei");
  if (maxPriorityFeePerGas > maxPriorityCap) {
    maxPriorityFeePerGas = maxPriorityCap;
  }

  // Ensure priority fee doesn't exceed max fee
  if (maxPriorityFeePerGas > maxFeePerGas) {
    maxPriorityFeePerGas = maxFeePerGas;
  }

  return { maxFeePerGas, maxPriorityFeePerGas };
}
// ============================================================================
// Deployment Functions
// ============================================================================

async function deployClosedBookBatchVault(config, useJson) {
  const { profile, rpcUrl, dryRun, outputDir } = config;

  const profileConfig = PROFILES[profile];
  const log = useJson ? () => {} : console.log;
  const logError = useJson ? () => {} : console.error;

  const runId = `deploy-cbbv-${profile}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const startTime = Date.now();

  // Initialize run data for evidence
  const runData = {
    runId,
    profile,
    profileConfig,
    config: {
      rpcUrl,
      dryRun,
      outputDir,
    },
    steps: [],
    verdict: "unknown",
    error: null,
  };

  try {
    // ========================================================================
    // STEP 1: Setup Provider and Wallet
    // ========================================================================
    log("\n╔══════════════════════════════════════════════════════════════╗");
    log("║  STEP 1: SETUP PROVIDER AND WALLET                           ║");
    log("╚══════════════════════════════════════════════════════════════╝");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    log(`  Network: ${network.name} (chainId: ${network.chainId})`);

    // Validate chain ID matches profile
    if (network.chainId !== BigInt(profileConfig.chainId)) {
      const warning = `Warning: Chain ID mismatch. Expected ${profileConfig.chainId}, got ${network.chainId}`;
      log(`  ⚠ ${warning}`);
      runData.steps.push({
        name: "chainValidation",
        status: "warning",
        warning,
        timestamp: new Date().toISOString(),
      });
    }

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const deployerAddress = wallet.address;
    log(`  Deployer: ${deployerAddress}`);

    const deployerBalance = await provider.getBalance(deployerAddress);
    log(`  Balance: ${ethers.formatEther(deployerBalance)} MATIC`);

    if (deployerBalance === 0n && !dryRun) {
      throw new Error("Deployer has zero balance");
    }

    runData.steps.push({
      name: "setup",
      status: "success",
      deployer: deployerAddress,
      balance: deployerBalance.toString(),
      timestamp: new Date().toISOString(),
    });

    // ========================================================================
    // STEP 2: Load Configuration
    // ========================================================================
    log("\n╔══════════════════════════════════════════════════════════════╗");
    log("║  STEP 2: LOAD CONFIGURATION                                  ║");
    log("╚══════════════════════════════════════════════════════════════╝");

    const assetAddress = process.env.CBBV_ASSET_ADDRESS || profileConfig.assetAddress;
    const navStalenessThreshold = parseInt(
      process.env.CBBV_NAV_STALENESS_THRESHOLD || profileConfig.navStalenessThreshold,
      10,
    );

    // Role addresses
    const adminAddress = process.env.CBBV_ADMIN_ADDRESS;
    const settlerAddress = process.env.CBBV_SETTLER_ADDRESS;
    const navUpdaterAddress = process.env.CBBV_NAV_UPDATER_ADDRESS;
    const snapshotterAddress = process.env.CBBV_SNAPSHOTTER_ADDRESS;
    const depositProcessorAddress = process.env.CBBV_DEPOSIT_PROCESSOR_ADDRESS;
    const tradingWalletAddress = process.env.CBBV_TRADING_WALLET_ADDRESS;
    // Validate addresses
    const validations = [
      validateAddress(assetAddress, "Asset address"),
      validateAddress(adminAddress, "Admin address"),
      validateAddress(settlerAddress, "Settler address"),
      validateAddress(navUpdaterAddress, "NAV updater address"),
      validateAddress(snapshotterAddress, "Snapshotter address"),
      validateAddress(depositProcessorAddress, "Deposit processor address"),
      validateAddress(tradingWalletAddress, "Trading wallet address"),
    ];

    const validationErrors = validations.filter((e) => e !== null);
    if (validationErrors.length > 0) {
      throw new Error(`Configuration validation failed: ${validationErrors.join("; ")}`);
    }

    log(`  Profile: ${profileConfig.name}`);
    log(`  Asset: ${assetAddress}`);
    log(`  NAV Staleness Threshold: ${navStalenessThreshold} seconds`);
    log(`  Admin: ${adminAddress}`);
    log(`  Settler: ${settlerAddress}`);
    log(`  NAV Updater: ${navUpdaterAddress}`);
    log(`  Snapshotter: ${snapshotterAddress}`);
    log(`  Deposit Processor: ${depositProcessorAddress}`);
    log(`  Trading Wallet: ${tradingWalletAddress}`);

    runData.deploymentParams = {
      asset: assetAddress,
      admin: adminAddress,
      settler: settlerAddress,
      navUpdater: navUpdaterAddress,
      snapshotter: snapshotterAddress,
      depositProcessor: depositProcessorAddress,
      tradingWallet: tradingWalletAddress,
      navStalenessThreshold,
    };

    runData.steps.push({
      name: "config",
      status: "success",
      params: runData.deploymentParams,
      timestamp: new Date().toISOString(),
    });

    // ========================================================================
    // STEP 3: Load Contract Bytecode
    // ========================================================================
    log("\n╔══════════════════════════════════════════════════════════════╗");
    log("║  STEP 3: LOAD CONTRACT BYTECODE                              ║");
    log("╚══════════════════════════════════════════════════════════════╝");

    const bytecode = loadBytecode();
    if (!bytecode || bytecode === "0x") {
      throw new Error(
        "ClosedBookBatchVault bytecode not found. " +
          "Set CBBV_BYTECODE environment variable or ensure contract is compiled.",
      );
    }

    log(`  Bytecode loaded: ${bytecode.length} characters`);

    runData.steps.push({
      name: "bytecode",
      status: "success",
      bytecodeLength: bytecode.length,
      timestamp: new Date().toISOString(),
    });

    // ========================================================================
    // STEP 4: Deploy Contract
    // ========================================================================
    log("\n╔══════════════════════════════════════════════════════════════╗");
    log("║  STEP 4: DEPLOY CONTRACT                                     ║");
    log("╚══════════════════════════════════════════════════════════════╝");

    if (dryRun) {
      log("  📝 DRY RUN MODE - Simulating deployment");

      // Calculate deployment address (would-be address)
      const nonce = await provider.getTransactionCount(deployerAddress);
      const wouldBeAddress = ethers.getCreateAddress({
        from: deployerAddress,
        nonce: nonce,
      });

      // Calculate dynamic gas fees for cost estimate
      const gasFees = await calculateGasFees(provider, profile);
      const estimatedCost = (BigInt(GAS_CONFIG.gasLimit) * gasFees.maxFeePerGas) / BigInt(1e18);

      log(`  Would-be address: ${wouldBeAddress}`);
      log(`  Max fee per gas: ${ethers.formatUnits(gasFees.maxFeePerGas, "gwei")} gwei`);
      log(`  Max priority fee: ${ethers.formatUnits(gasFees.maxPriorityFeePerGas, "gwei")} gwei`);
      log(`  Estimated max cost: ~${estimatedCost} MATIC (at ${GAS_CONFIG.gasLimit} gas limit)`);

      runData.deploymentResult = {
        dryRun: true,
        wouldBeAddress,
        nonce,
        gasFees: {
          maxFeePerGas: gasFees.maxFeePerGas.toString(),
          maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas.toString(),
        },
      };

      runData.steps.push({
        name: "deploy",
        status: "dry-run",
        wouldBeAddress,
        nonce,
        gasFees: runData.deploymentResult.gasFees,
        timestamp: new Date().toISOString(),
      });

      runData.verdict = "dry-run";
    } else {
      log("  🚀 Deploying contract...");

      // Create contract factory
      const factory = new ethers.ContractFactory(CBBV_ABI, bytecode, wallet);

      // Estimate gas with all constructor parameters
      const deployTx = await factory.getDeployTransaction(
        assetAddress,
        adminAddress,
        settlerAddress,
        navUpdaterAddress,
        snapshotterAddress,
        depositProcessorAddress,
        tradingWalletAddress,
        navStalenessThreshold,
      );

      const estimatedGas = await provider.estimateGas(deployTx);
      log(`  Estimated gas: ${estimatedGas.toString()}`);

      // Calculate dynamic gas fees
      const gasFees = await calculateGasFees(provider, profile);
      log(`  Max fee per gas: ${ethers.formatUnits(gasFees.maxFeePerGas, "gwei")} gwei`);
      log(`  Max priority fee: ${ethers.formatUnits(gasFees.maxPriorityFeePerGas, "gwei")} gwei`);

      // Deploy contract with all parameters
      const contract = await factory.deploy(
        assetAddress,
        adminAddress,
        settlerAddress,
        navUpdaterAddress,
        snapshotterAddress,
        depositProcessorAddress,
        tradingWalletAddress,
        navStalenessThreshold,
        {
          maxFeePerGas: gasFees.maxFeePerGas,
          maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
          gasLimit: (estimatedGas * 120n) / 100n, // Add 20% buffer
        },
      );

      log(`  Deployment tx: ${contract.deploymentTransaction().hash}`);
      log("  Waiting for confirmation...");

      await contract.waitForDeployment();

      const contractAddress = await contract.getAddress();
      const deploymentReceipt = await provider.getTransactionReceipt(
        contract.deploymentTransaction().hash,
      );

      log(`  ✅ Contract deployed at: ${contractAddress}`);
      log(`  Block number: ${deploymentReceipt.blockNumber}`);
      log(`  Gas used: ${deploymentReceipt.gasUsed.toString()}`);

      runData.deploymentResult = {
        dryRun: false,
        contractAddress,
        txHash: contract.deploymentTransaction().hash,
        blockNumber: deploymentReceipt.blockNumber,
        gasUsed: deploymentReceipt.gasUsed.toString(),
      };

      runData.steps.push({
        name: "deploy",
        status: "success",
        contractAddress,
        txHash: contract.deploymentTransaction().hash,
        blockNumber: deploymentReceipt.blockNumber,
        gasUsed: deploymentReceipt.gasUsed.toString(),
        timestamp: new Date().toISOString(),
      });

      // ========================================================================
      // STEP 5: Verify Deployment
      // ========================================================================
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 5: VERIFY DEPLOYMENT                                   ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      // Verify contract state
      const deployedAsset = await contract.asset();
      const deployedNavStalenessThreshold = await contract.NAV_STALENESS_THRESHOLD();
      const deployedTradingWallet = await contract.tradingWallet();
      const deployedDeployTime = await contract.DEPLOY_TIME();
      const deployedName = await contract.name();
      const deployedSymbol = await contract.symbol();

      // Verify roles
      const ADMIN_ROLE = await contract.ADMIN_ROLE();
      const SETTLER_ROLE = await contract.SETTLER_ROLE();
      const NAV_UPDATER_ROLE = await contract.NAV_UPDATER_ROLE();
      const SNAPSHOT_ROLE = await contract.SNAPSHOT_ROLE();
      const DEPOSIT_PROCESSOR_ROLE = await contract.DEPOSIT_PROCESSOR_ROLE();

      const adminHasRole = await contract.hasRole(ADMIN_ROLE, adminAddress);
      const settlerHasRole = await contract.hasRole(SETTLER_ROLE, settlerAddress);
      const navUpdaterHasRole = await contract.hasRole(NAV_UPDATER_ROLE, navUpdaterAddress);
      const snapshotterHasRole = await contract.hasRole(SNAPSHOT_ROLE, snapshotterAddress);
      const depositProcessorHasRole = await contract.hasRole(
        DEPOSIT_PROCESSOR_ROLE,
        depositProcessorAddress,
      );

      log(
        `  Asset: ${deployedAsset} ${deployedAsset.toLowerCase() === assetAddress.toLowerCase() ? "✓" : "✗"}`,
      );
      log(
        `  NAV Staleness Threshold: ${deployedNavStalenessThreshold} ${deployedNavStalenessThreshold === BigInt(navStalenessThreshold) ? "✓" : "✗"}`,
      );
      log(
        `  Trading Wallet: ${deployedTradingWallet} ${deployedTradingWallet.toLowerCase() === tradingWalletAddress.toLowerCase() ? "✓" : "✗"}`,
      );
      log(`  Name: ${deployedName}`);
      log(`  Symbol: ${deployedSymbol}`);
      log(`  Admin has ADMIN_ROLE: ${adminHasRole ? "✓" : "✗"}`);
      log(`  Settler has SETTLER_ROLE: ${settlerHasRole ? "✓" : "✗"}`);
      log(`  NAV Updater has NAV_UPDATER_ROLE: ${navUpdaterHasRole ? "✓" : "✗"}`);
      log(`  Snapshotter has SNAPSHOT_ROLE: ${snapshotterHasRole ? "✓" : "✗"}`);
      log(`  Deposit Processor has DEPOSIT_PROCESSOR_ROLE: ${depositProcessorHasRole ? "✓" : "✗"}`);

      const verificationPassed =
        deployedAsset.toLowerCase() === assetAddress.toLowerCase() &&
        deployedNavStalenessThreshold === BigInt(navStalenessThreshold) &&
        deployedTradingWallet.toLowerCase() === tradingWalletAddress.toLowerCase() &&
        adminHasRole &&
        settlerHasRole &&
        navUpdaterHasRole &&
        snapshotterHasRole &&
        depositProcessorHasRole;

      if (!verificationPassed) {
        throw new Error("Deployment verification failed");
      }

      log("  ✅ Deployment verified successfully");

      runData.verification = {
        asset: deployedAsset,
        navStalenessThreshold: deployedNavStalenessThreshold.toString(),
        tradingWallet: deployedTradingWallet,
        name: deployedName,
        symbol: deployedSymbol,
        deployTime: deployedDeployTime.toString(),
        adminHasRole,
        settlerHasRole,
        navUpdaterHasRole,
        snapshotterHasRole,
        depositProcessorHasRole,
      };

      runData.steps.push({
        name: "verify",
        status: "success",
        verification: runData.verification,
        timestamp: new Date().toISOString(),
      });

      runData.verdict = "success";

      // ========================================================================
      // STEP 6: Save Artifacts
      // ========================================================================
      log("\n╔══════════════════════════════════════════════════════════════╗");
      log("║  STEP 6: SAVE ARTIFACTS                                      ║");
      log("╚══════════════════════════════════════════════════════════════╝");

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Generate artifact filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const artifactFile = path.join(
        outputDir,
        `closed-book-batch-vault-${profile}-${timestamp}.json`,
      );
      const latestArtifactFile = path.join(
        outputDir,
        `closed-book-batch-vault-${profile}-latest.json`,
      );

      // Build deployment artifact
      const artifact = {
        name: "ClosedBookBatchVault",
        version: "1.0.0",
        profile,
        network: {
          name: network.name,
          chainId: Number(network.chainId),
        },
        deployment: {
          address: contractAddress,
          txHash: contract.deploymentTransaction().hash,
          blockNumber: deploymentReceipt.blockNumber,
          gasUsed: deploymentReceipt.gasUsed.toString(),
          deployer: deployerAddress,
          timestamp: new Date().toISOString(),
        },
        configuration: {
          asset: assetAddress,
          admin: adminAddress,
          settler: settlerAddress,
          navUpdater: navUpdaterAddress,
          snapshotter: snapshotterAddress,
          depositProcessor: depositProcessorAddress,
          navStalenessThreshold,
        },
        verification: runData.verification,
        abi: CBBV_ABI,
      };

      // Write artifact files
      fs.writeFileSync(artifactFile, JSON.stringify(artifact, null, 2));
      fs.writeFileSync(latestArtifactFile, JSON.stringify(artifact, null, 2));

      log(`  Artifact saved: ${artifactFile}`);
      log(`  Latest artifact: ${latestArtifactFile}`);

      runData.artifacts = {
        artifactFile,
        latestArtifactFile,
      };

      runData.steps.push({
        name: "artifacts",
        status: "success",
        files: [artifactFile, latestArtifactFile],
        timestamp: new Date().toISOString(),
      });
    }

    // =========================================================================
    // Complete
    // =========================================================================
    const duration = Date.now() - startTime;
    runData.duration = duration;

    log("\n╔══════════════════════════════════════════════════════════════╗");
    log("║  DEPLOYMENT COMPLETE                                         ║");
    log("╚══════════════════════════════════════════════════════════════╝");
    log(`  Profile: ${profileConfig.name}`);
    log(`  Duration: ${duration}ms`);
    log(`  Verdict: ${runData.verdict}`);

    if (runData.deploymentResult?.contractAddress) {
      log(`  Contract Address: ${runData.deploymentResult.contractAddress}`);
    } else if (runData.deploymentResult?.wouldBeAddress) {
      log(`  Would-be Address: ${runData.deploymentResult.wouldBeAddress}`);
    }

    return { success: true, runData };
  } catch (error) {
    runData.verdict = "failure";
    runData.error = error.message;
    runData.duration = Date.now() - startTime;

    logError(`\n❌ Deployment failed: ${error.message}`);

    return { success: false, runData, error };
  }
}

// ============================================================================
// Evidence Emitter
// ============================================================================

async function emitEvidence(runData, dryRun) {
  const evidenceDir = path.join(process.cwd(), ".sisyphus", "evidence");
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidenceFile = path.join(
    evidenceDir,
    dryRun
      ? "task-deploy-cbbv-dry-run.txt"
      : `task-deploy-cbbv-${runData.profile}-${timestamp}.txt`,
  );

  let text = `Closed Book Batch Vault Deployment Evidence\n`;
  text += `===========================================\n\n`;
  text += `Run ID: ${runData.runId}\n`;
  text += `Profile: ${runData.profile}\n`;
  text += `Verdict: ${runData.verdict}\n`;
  text += `Duration: ${runData.duration}ms\n`;
  text += `Timestamp: ${new Date().toISOString()}\n\n`;

  if (runData.deploymentResult) {
    text += `Deployment Result:\n`;
    if (runData.deploymentResult.dryRun) {
      text += `  Mode: DRY RUN\n`;
      text += `  Would-be Address: ${runData.deploymentResult.wouldBeAddress}\n`;
      text += `  Nonce: ${runData.deploymentResult.nonce}\n`;
    } else {
      text += `  Mode: LIVE\n`;
      text += `  Contract Address: ${runData.deploymentResult.contractAddress}\n`;
      text += `  Transaction Hash: ${runData.deploymentResult.txHash}\n`;
      text += `  Block Number: ${runData.deploymentResult.blockNumber}\n`;
      text += `  Gas Used: ${runData.deploymentResult.gasUsed}\n`;
    }
    text += `\n`;
  }

  if (runData.deploymentParams) {
    text += `Deployment Parameters:\n`;
    text += `  Asset: ${runData.deploymentParams.asset}\n`;
    text += `  Admin: ${runData.deploymentParams.admin}\n`;
    text += `  Settler: ${runData.deploymentParams.settler}\n`;
    text += `  NAV Updater: ${runData.deploymentParams.navUpdater}\n`;
    text += `  Snapshotter: ${runData.deploymentParams.snapshotter}\n`;
    text += `  Deposit Processor: ${runData.deploymentParams.depositProcessor}\n`;
    text += `  Trading Wallet: ${runData.deploymentParams.tradingWallet}\n`;
    text += `  NAV Staleness Threshold: ${runData.deploymentParams.navStalenessThreshold} seconds\n`;
    text += `\n`;
  }

  if (runData.verification) {
    text += `Verification Results:\n`;
    text += `  Asset: ${runData.verification.asset}\n`;
    text += `  NAV Staleness Threshold: ${runData.verification.navStalenessThreshold}\n`;
    text += `  Trading Wallet: ${runData.verification.tradingWallet}\n`;
    text += `  Name: ${runData.verification.name}\n`;
    text += `  Symbol: ${runData.verification.symbol}\n`;
    text += `  Admin Has Role: ${runData.verification.adminHasRole}\n`;
    text += `  Settler Has Role: ${runData.verification.settlerHasRole}\n`;
    text += `  NAV Updater Has Role: ${runData.verification.navUpdaterHasRole}\n`;
    text += `  Snapshotter Has Role: ${runData.verification.snapshotterHasRole}\n`;
    text += `  Deposit Processor Has Role: ${runData.verification.depositProcessorHasRole}\n`;
    text += `\n`;
  }

  text += `Steps:\n`;
  for (const step of runData.steps) {
    text += `  ${step.name}: ${step.status}\n`;
  }

  if (runData.error) {
    text += `\nError: ${runData.error}\n`;
  }

  fs.writeFileSync(evidenceFile, text);
  return evidenceFile;
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

  // Validate environment
  if (!validateEnvironment(useJson)) {
    process.exit(1);
  }

  const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true";
  const outputDir = flags["output-dir"] || path.join(__dirname, "../deployments");

  const config = {
    profile: flags.profile,
    rpcUrl: flags["rpc-url"],
    dryRun,
    outputDir,
  };

  // Execute deployment
  const result = await deployClosedBookBatchVault(config, useJson);

  // Emit evidence
  const evidenceFile = await emitEvidence(result.runData, dryRun);
  if (!useJson) {
    console.log(`\n📄 Evidence saved: ${evidenceFile}`);
  }

  // Output result
  if (useJson) {
    console.log(
      JSON.stringify(
        {
          success: result.success,
          runData: result.runData,
          evidence: evidenceFile,
        },
        (key, value) => {
          if (typeof value === "bigint") return value.toString();
          return value;
        },
        2,
      ),
    );
  }

  process.exit(result.success ? 0 : 1);
}

// Handle errors
main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  process.exit(1);
});

// Export for testing/module use
module.exports = {
  deployClosedBookBatchVault,
  parseArgs,
  validateRequiredFlags,
  validateEnvironment,
  PROFILES,
  REQUIRED_ENV_VARS,
};
