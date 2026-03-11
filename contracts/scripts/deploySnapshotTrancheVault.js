#!/usr/bin/env node
/**
 * Snapshot Tranche Vault Deployment Script
 *
 * CLI for deploying the SnapshotTrancheVault contract with proper
 * role assignment and initialization.
 *
 * Usage:
 *   node deploySnapshotTrancheVault.js --profile <profile> --rpc-url <url> [--dry-run]
 *
 * Profiles:
 *   production    - 7-day epochs (604800 seconds), mainnet addresses
 *   staging       - 1-hour epochs (3600 seconds), testnet addresses
 *   test          - 15-minute epochs (900 seconds), local/anvil addresses
 *
 * Required Environment Variables:
 *   PRIVATE_KEY                        - Deployer private key
 *   SNAPSHOT_VAULT_ADMIN_ADDRESS       - Admin role address
 *   SNAPSHOT_VAULT_SETTLER_ADDRESS     - Settler role address
 *   SNAPSHOT_VAULT_SNAPSHOTTER_ADDRESS - Snapshot role address
 *
 * Optional Environment Variables (profile-specific overrides):
 *   SNAPSHOT_VAULT_ASSET_ADDRESS       - Asset token address (defaults per profile)
 *   SNAPSHOT_VAULT_EPOCH_DURATION      - Epoch duration in seconds (defaults per profile)
 *
 * Examples:
 *   # Dry run for production
 *   node deploySnapshotTrancheVault.js --profile production --rpc-url https://polygon-mainnet.g.alchemy.com/v2/KEY --dry-run
 *
 *   # Deploy to staging
 *   node deploySnapshotTrancheVault.js --profile staging --rpc-url https://polygon-amoy.g.alchemy.com/v2/KEY
 *
 *   # Deploy to local anvil
 *   node deploySnapshotTrancheVault.js --profile test --rpc-url http://localhost:8545
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
    epochDuration: 604800, // 7 days in seconds
    assetAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e on Polygon mainnet
    description: "Production deployment with 7-day epochs",
    chainId: 137,
  },
  staging: {
    name: "Staging",
    epochDuration: 3600, // 1 hour in seconds
    assetAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e testnet
    description: "Staging deployment with 1-hour epochs for testing",
    chainId: 80002,
  },
  test: {
    name: "Test",
    epochDuration: 900, // 15 minutes in seconds
    assetAddress: null, // Must be provided via env or deployed locally
    description: "Local test deployment with 15-minute epochs",
    chainId: 31337,
  },
};

const GAS_CONFIG = {
  gasLimit: 5000000,
  maxFeePerGas: ethers.parseUnits("400", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
};

const REQUIRED_ENV_VARS = [
  "PRIVATE_KEY",
  "SNAPSHOT_VAULT_ADMIN_ADDRESS",
  "SNAPSHOT_VAULT_SETTLER_ADDRESS",
  "SNAPSHOT_VAULT_SNAPSHOTTER_ADDRESS",
];

// SnapshotTrancheVault ABI (constructor and basic functions)
const SNAPSHOT_TRANCHE_VAULT_ABI = [
  // Constructor
  "constructor(address _asset, address _admin, address _settler, address _snapshotter, uint256 _epochDuration)",
  // Read functions
  "function asset() view returns (address)",
  "function EPOCH_DURATION() view returns (uint256)",
  "function DEPLOY_TIME() view returns (uint256)",
  "function ADMIN_ROLE() view returns (bytes32)",
  "function SETTLER_ROLE() view returns (bytes32)",
  "function SNAPSHOT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function lastNAV() view returns (uint256)",
  "function lastNAVUpdate() view returns (uint256)",
  "function nextRequestId() view returns (uint256)",
  "function redemptionRequests(uint256) view returns (uint256 requestId, address user, uint256 shares, uint256 epochId, uint8 status, uint256 createdAt, bool exists)",
  "function getCurrentEpoch() view returns (uint256)",
  "function snapshots(uint256) view returns (bytes32 snapshotHash, uint256 timestamp, uint256 realizationDeadline, bool exists)",
  "function frozenPositions(uint256,bytes32) view returns (bytes32 positionId, uint256 costBasis, uint256 snapshotValue, bool isRealized, bool isForceClosed, uint256 forceClosedAt, string forceCloseReason, bool exists)",
  "function realizationEvents(uint256,bytes32) view returns (bytes32 eventId, bytes32 positionId, uint256 timestamp, bool isForceClose, string reason, bool exists)",
  "function getTimeoutStatus(uint256 _epochId) view returns (bool isTimedOut, uint256 deadline, uint256 timeRemaining, uint256 timePastDeadline)",
  "function canForceClose(bytes32 _positionId, uint256 _epochId) view returns (bool)",
  "function getRealizationDeadline(uint256 _epochId) view returns (uint256)",
  "function DEFAULT_REALIZATION_TIMEOUT() view returns (uint256)",
  // Write functions
  "function freezeSnapshot(uint256 _epochId, bytes32[] calldata _positionIds, uint256[] calldata _costBases, uint256[] calldata _currentValues) external",
  "function forceClosePosition(bytes32 _positionId, uint256 _epochId, string calldata _reason) external returns (bytes32 eventId)",
  "function updateNAV(uint256 _nav) external",
];

// SnapshotTrancheVault Bytecode placeholder
const SNAPSHOT_TRANCHE_VAULT_BYTECODE = process.env.SNAPSHOT_TRANCHE_VAULT_BYTECODE || "0x";

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
      errors.forEach((e) => console.error(`  X ${e}`));
      console.error("\nCreate a .env file with the required variables.");
      console.error("\nSee .env.example for the required template.");
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
      errors.forEach((e) => console.error(`  X ${e}`));
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
Snapshot Tranche Vault Deployment CLI

DESCRIPTION:
  Deploys the SnapshotTrancheVault contract with proper role assignment
  and initialization. Supports multiple deployment profiles for different
  environments. This vault uses frozen snapshot epochs with timeout and
  force-close controls for progressive redemption payouts.

USAGE:
  node deploySnapshotTrancheVault.js --profile <profile> --rpc-url <url> [options]

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

  staging                     1-hour epochs, Polygon testnet
                              Epoch duration: 3600 seconds
                              Asset: USDC.e testnet

  test                        15-minute epochs, local/anvil
                              Epoch duration: 900 seconds
                              Asset: Must set SNAPSHOT_VAULT_ASSET_ADDRESS

REQUIRED ENVIRONMENT VARIABLES:
  PRIVATE_KEY                          Deployer private key (0x + 64 hex)
  SNAPSHOT_VAULT_ADMIN_ADDRESS         Admin role address
  SNAPSHOT_VAULT_SETTLER_ADDRESS       Settler role address
  SNAPSHOT_VAULT_SNAPSHOTTER_ADDRESS   Snapshot role address

OPTIONAL ENVIRONMENT VARIABLES:
  SNAPSHOT_VAULT_ASSET_ADDRESS         Override asset address
  SNAPSHOT_VAULT_EPOCH_DURATION        Override epoch duration (seconds)
  SNAPSHOT_TRANCHE_VAULT_BYTECODE      Contract bytecode (for testing)

EXAMPLES:
  # Dry run for production
  node deploySnapshotTrancheVault.js \\
    --profile production \\
    --rpc-url https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY \\
    --dry-run

  # Deploy to staging
  node deploySnapshotTrancheVault.js \\
    --profile staging \\
    --rpc-url https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY

  # Deploy to local anvil
  node deploySnapshotTrancheVault.js \\
    --profile test \\
    --rpc-url http://localhost:8545

OUTPUT:
  Deployment artifacts are saved to:
    - <output-dir>/snapshot-tranche-vault-<profile>-<timestamp>.json
    - <output-dir>/snapshot-tranche-vault-<profile>-latest.json

  Evidence files are saved to:
    - .sisyphus/evidence/task-18-deploy-dryrun.txt
`);
}

// ============================================================================
// Contract Bytecode Loader
// ============================================================================

function loadBytecode() {
  // First check environment variable
  if (
    process.env.SNAPSHOT_TRANCHE_VAULT_BYTECODE &&
    process.env.SNAPSHOT_TRANCHE_VAULT_BYTECODE !== "0x"
  ) {
    return process.env.SNAPSHOT_TRANCHE_VAULT_BYTECODE;
  }

  // Try to load from Foundry build artifacts
  const artifactPaths = [
    path.join(__dirname, "../out/SnapshotTrancheVault.sol/SnapshotTrancheVault.json"),
    path.join(
      __dirname,
      "../artifacts/contracts/SnapshotTrancheVault.sol/SnapshotTrancheVault.json",
    ),
    path.join(__dirname, "./artifacts/SnapshotTrancheVault.json"),
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
// Deployment Functions
// ============================================================================

async function deploySnapshotTrancheVault(config, useJson) {
  const { profile, rpcUrl, dryRun, outputDir } = config;

  const profileConfig = PROFILES[profile];
  const log = useJson ? () => {} : console.log;
  const logError = useJson ? () => {} : console.error;

  const runId = `deploy-${profile}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
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
      log(`  ! ${warning}`);
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

    const assetAddress = process.env.SNAPSHOT_VAULT_ASSET_ADDRESS || profileConfig.assetAddress;
    const epochDuration = parseInt(
      process.env.SNAPSHOT_VAULT_EPOCH_DURATION || profileConfig.epochDuration,
      10,
    );
    const adminAddress = process.env.SNAPSHOT_VAULT_ADMIN_ADDRESS;
    const settlerAddress = process.env.SNAPSHOT_VAULT_SETTLER_ADDRESS;
    const snapshotterAddress = process.env.SNAPSHOT_VAULT_SNAPSHOTTER_ADDRESS;

    // Validate addresses
    const validations = [
      validateAddress(assetAddress, "Asset address"),
      validateAddress(adminAddress, "Admin address"),
      validateAddress(settlerAddress, "Settler address"),
      validateAddress(snapshotterAddress, "Snapshotter address"),
    ];

    const validationErrors = validations.filter((e) => e !== null);
    if (validationErrors.length > 0) {
      throw new Error(`Configuration validation failed: ${validationErrors.join("; ")}`);
    }

    log(`  Profile: ${profileConfig.name}`);
    log(`  Asset: ${assetAddress}`);
    log(`  Epoch Duration: ${epochDuration} seconds (${epochDuration / 86400} days)`);
    log(`  Admin: ${adminAddress}`);
    log(`  Settler: ${settlerAddress}`);
    log(`  Snapshotter: ${snapshotterAddress}`);

    runData.deploymentParams = {
      asset: assetAddress,
      admin: adminAddress,
      settler: settlerAddress,
      snapshotter: snapshotterAddress,
      epochDuration,
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
        "SnapshotTrancheVault bytecode not found. " +
          "Set SNAPSHOT_TRANCHE_VAULT_BYTECODE environment variable or ensure contract is compiled.",
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
      log("  * DRY RUN MODE - Simulating deployment");

      // Calculate deployment address (would-be address)
      const nonce = await provider.getTransactionCount(deployerAddress);
      const wouldBeAddress = ethers.getCreateAddress({
        from: deployerAddress,
        nonce: nonce,
      });

      log(`  Would-be address: ${wouldBeAddress}`);
      log(
        `  Gas estimate: ~${ethers.formatUnits(GAS_CONFIG.gasLimit * GAS_CONFIG.maxFeePerGas, "ether")} MATIC`,
      );

      runData.deploymentResult = {
        dryRun: true,
        wouldBeAddress,
        nonce,
      };

      runData.steps.push({
        name: "deploy",
        status: "dry-run",
        wouldBeAddress,
        nonce,
        timestamp: new Date().toISOString(),
      });

      runData.verdict = "dry-run";
    } else {
      log("  Deploying contract...");

      // Create contract factory
      const factory = new ethers.ContractFactory(SNAPSHOT_TRANCHE_VAULT_ABI, bytecode, wallet);

      // Estimate gas
      const deployTx = await factory.getDeployTransaction(
        assetAddress,
        adminAddress,
        settlerAddress,
        snapshotterAddress,
        epochDuration,
      );

      const estimatedGas = await provider.estimateGas(deployTx);
      log(`  Estimated gas: ${estimatedGas.toString()}`);

      // Deploy contract
      const contract = await factory.deploy(
        assetAddress,
        adminAddress,
        settlerAddress,
        snapshotterAddress,
        epochDuration,
        {
          ...GAS_CONFIG,
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

      log(`  + Contract deployed at: ${contractAddress}`);
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
      const deployedEpochDuration = await contract.EPOCH_DURATION();
      const deployedDeployTime = await contract.DEPLOY_TIME();

      // Verify roles
      const ADMIN_ROLE = await contract.ADMIN_ROLE();
      const SETTLER_ROLE = await contract.SETTLER_ROLE();
      const SNAPSHOT_ROLE = await contract.SNAPSHOT_ROLE();

      const adminHasRole = await contract.hasRole(ADMIN_ROLE, adminAddress);
      const settlerHasRole = await contract.hasRole(SETTLER_ROLE, settlerAddress);
      const snapshotterHasRole = await contract.hasRole(SNAPSHOT_ROLE, snapshotterAddress);

      log(
        `  Asset: ${deployedAsset} ${deployedAsset.toLowerCase() === assetAddress.toLowerCase() ? "+" : "X"}`,
      );
      log(
        `  Epoch Duration: ${deployedEpochDuration} ${deployedEpochDuration === BigInt(epochDuration) ? "+" : "X"}`,
      );
      log(`  Admin has ADMIN_ROLE: ${adminHasRole ? "+" : "X"}`);
      log(`  Settler has SETTLER_ROLE: ${settlerHasRole ? "+" : "X"}`);
      log(`  Snapshotter has SNAPSHOT_ROLE: ${snapshotterHasRole ? "+" : "X"}`);

      const verificationPassed =
        deployedAsset.toLowerCase() === assetAddress.toLowerCase() &&
        deployedEpochDuration === BigInt(epochDuration) &&
        adminHasRole &&
        settlerHasRole &&
        snapshotterHasRole;

      if (!verificationPassed) {
        throw new Error("Deployment verification failed");
      }

      log("  + Deployment verified successfully");

      runData.verification = {
        asset: deployedAsset,
        epochDuration: deployedEpochDuration.toString(),
        deployTime: deployedDeployTime.toString(),
        adminHasRole,
        settlerHasRole,
        snapshotterHasRole,
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
        `snapshot-tranche-vault-${profile}-${timestamp}.json`,
      );
      const latestArtifactFile = path.join(
        outputDir,
        `snapshot-tranche-vault-${profile}-latest.json`,
      );

      // Build deployment artifact
      const artifact = {
        name: "SnapshotTrancheVault",
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
          snapshotter: snapshotterAddress,
          epochDuration,
        },
        verification: runData.verification,
        abi: SNAPSHOT_TRANCHE_VAULT_ABI,
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

    // ============================================================================
    // Complete
    // ============================================================================
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

    logError(`\nX Deployment failed: ${error.message}`);

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
    dryRun ? "task-18-deploy-dryrun.txt" : `task-18-deploy-${runData.profile}-${timestamp}.txt`,
  );

  let text = `Snapshot Tranche Vault Deployment Evidence\n`;
  text += `=========================================\n\n`;
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
    text += `  Snapshotter: ${runData.deploymentParams.snapshotter}\n`;
    text += `  Epoch Duration: ${runData.deploymentParams.epochDuration} seconds\n`;
    text += `\n`;
  }

  if (runData.verification) {
    text += `Verification Results:\n`;
    text += `  Asset: ${runData.verification.asset}\n`;
    text += `  Epoch Duration: ${runData.verification.epochDuration}\n`;
    text += `  Admin Has Role: ${runData.verification.adminHasRole}\n`;
    text += `  Settler Has Role: ${runData.verification.settlerHasRole}\n`;
    text += `  Snapshotter Has Role: ${runData.verification.snapshotterHasRole}\n`;
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
  const result = await deploySnapshotTrancheVault(config, useJson);

  // Emit evidence
  const evidenceFile = await emitEvidence(result.runData, dryRun);
  if (!useJson) {
    console.log(`\n  Evidence saved: ${evidenceFile}`);
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
  console.error("\nX Fatal error:", error.message);
  process.exit(1);
});

// Export for testing/module use
module.exports = {
  deploySnapshotTrancheVault,
  parseArgs,
  validateRequiredFlags,
  validateEnvironment,
  PROFILES,
  REQUIRED_ENV_VARS,
};
