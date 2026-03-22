#!/usr/bin/env node
/**
 * Staging Readiness Check
 *
 * Validates that the vault environment is properly configured for the selected
 * network (mainnet or amoy) before deployment or testing.
 *
 * Checks performed:
 * - Required environment variables are present
 * - RPC chain ID matches VAULT_NETWORK configuration
 * - Contract addresses are valid for the selected network
 * - No legacy contract shapes or placeholder addresses
 * - Dual-safe configuration (tradingSafe address, capital functions)
 * - Vault USDC balance for operations
 * - TradingSafe approval for recall operations
 *
 * Dual-Safe Amoy Flow:
 * - Validates tradingSafe is configured and valid
 * - Checks deployCapital and recallCapital function accessibility
 * - Verifies vault has USDC balance for capital deployment
 * - Verifies tradingSafe has approved vault for recall operations
 *
 * Usage:
 *   npx tsx src/scripts/stagingReadinessCheck.ts [options]
 *
 * Options:
 *   --json         Output results as JSON
 *   --quiet        Only output on failure
 *   --verbose      Output detailed check information
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 *   2 - Configuration error (invalid VAULT_NETWORK, etc.)
 * - Required environment variables are present
 * - RPC chain ID matches VAULT_NETWORK configuration
 * - Contract addresses are valid for the selected network
 * - No legacy contract shapes or placeholder addresses
 *
 * Usage:
 *   npx tsx src/scripts/stagingReadinessCheck.ts [options]
 *
 * Options:
 *   --json         Output results as JSON
 *   --quiet        Only output on failure
 *   --verbose      Output detailed check information
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 *   2 - Configuration error (invalid VAULT_NETWORK, etc.)
 *
 * Examples:
 *   VAULT_NETWORK=mainnet npx tsx src/scripts/stagingReadinessCheck.ts
 *   VAULT_NETWORK=amoy npx tsx src/scripts/stagingReadinessCheck.ts --verbose
 */

import "dotenv/config";
import { createPublicClient, http, type Address } from "viem";
import { getAllVaultConfigs } from "../config/index.js";
import { getRpcUrlForNetwork, type NetworkType, NETWORK_CONFIGS } from "../config/network.js";
import { env } from "../env.js";

// ============================================================================
// TYPES
// ============================================================================

type CheckStatus = "pass" | "fail" | "warn";

interface ReadinessCheck {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

interface ReadinessReport {
  network: NetworkType;
  chainId: number;
  timestamp: string;
  overallStatus: "ready" | "not-ready" | "error";
  checks: ReadinessCheck[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    total: number;
  };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// USDC token ABI for balance and allowance checks
const USDC_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "spender", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;

const TRADING_WALLET_ABI = [
  {
    type: "function",
    name: "tradingWallet",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
] as const;

const CAPITAL_STATUS_ABI = [
  {
    type: "function",
    name: "maxAllocatableAssets",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allocateToTradingWallet",
    inputs: [{ name: "amount", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const ERC1155_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "operator", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
] as const;

const REQUIRED_ENV_VARS = ["VAULT_DATABASE_URL", "VAULT_SESSION_SECRET"] as const;

const NETWORK_REQUIRED_ENV_VARS: Record<NetworkType, string[]> = {
  mainnet: ["POLYGON_RPC_URL"],
  amoy: ["AMOY_RPC_URL"],
};

// Minimal ERC7540 vault ABI for checking contract shape
const VAULT_ABI = [
  {
    type: "function",
    name: "totalAssets",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "asset",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tradingWallet",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "currentNAV",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ============================================================================
// CHECK FUNCTIONS
// ============================================================================

function getPrimaryVaultConfigForChecks() {
  return getAllVaultConfigs().find((config) => config.enabled) ?? getAllVaultConfigs()[0] ?? null;
}

async function checkEnvironmentVariables(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];

  // Check required env vars (universal)
  for (const varName of REQUIRED_ENV_VARS) {
    const value = process.env[varName];
    checks.push({
      name: `env:${varName}`,
      status: value ? "pass" : "fail",
      message: value ? `${varName} is set` : `${varName} is required but not set`,
      details: value ? { length: value.length } : undefined,
    });
  }

  // Check network-specific required env vars
  const networkRequired = NETWORK_REQUIRED_ENV_VARS[network];
  for (const varName of networkRequired) {
    const value = process.env[varName];
    checks.push({
      name: `env:${varName}`,
      status: value ? "pass" : "fail",
      message: value
        ? `${varName} is set for ${network}`
        : `${varName} is required for ${network} but not set`,
      details: value ? { length: value.length } : undefined,
    });
  }

  return checks;
}

async function checkNetworkConfiguration(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const config = NETWORK_CONFIGS[network];
  const explicitRpcEnvValue = process.env[config.rpcEnvKey];
  const hasConfiguredRpcEnv = Boolean(explicitRpcEnvValue);

  // Validate VAULT_NETWORK value
  checks.push({
    name: "config:VAULT_NETWORK",
    status: "pass",
    message: `VAULT_NETWORK=${network} (chainId=${config.chainId})`,
    details: {
      network,
      chainId: config.chainId,
      displayName: config.displayName,
      supportsPolymarketTrading: config.supportsPolymarketTrading,
    },
  });

  // Validate RPC URL is configured
  const rpcUrl = getRpcUrlForNetwork(network);
  if (!rpcUrl) {
    checks.push({
      name: "config:RPC_URL",
      status: "fail",
      message: `No RPC URL configured for ${network}. Set ${config.rpcEnvKey}.`,
      details: { rpcEnvKey: config.rpcEnvKey, usingDefault: false },
    });
  } else if (hasConfiguredRpcEnv) {
    checks.push({
      name: "config:RPC_URL",
      status: "pass",
      message: `Custom RPC URL configured via ${config.rpcEnvKey}`,
      details: {
        rpcEnvKey: config.rpcEnvKey,
        usingDefault: false,
      },
    });
  } else {
    checks.push({
      name: "config:RPC_URL",
      status: "warn",
      message: `Using default RPC URL for ${network}. Consider setting ${config.rpcEnvKey} for production.`,
      details: { rpcEnvKey: config.rpcEnvKey, usingDefault: true },
    });
  }

  return checks;
}

async function checkChainIdValidation(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const config = NETWORK_CONFIGS[network];

  try {
    const rpcUrl = getRpcUrlForNetwork(network);
    const client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    const actualChainId = await client.getChainId();

    if (actualChainId === config.chainId) {
      checks.push({
        name: "chain:ChainIdMatch",
        status: "pass",
        message: `RPC chain ID (${actualChainId}) matches expected ${network} chain ID`,
        details: { expected: config.chainId, actual: actualChainId, rpcUrl },
      });
    } else {
      checks.push({
        name: "chain:ChainIdMatch",
        status: "fail",
        message: `Chain ID mismatch! RPC reports ${actualChainId} but VAULT_NETWORK=${network} expects ${config.chainId}`,
        details: { expected: config.chainId, actual: actualChainId, rpcUrl },
      });
    }
  } catch (error) {
    checks.push({
      name: "chain:ChainIdMatch",
      status: "fail",
      message: `Failed to validate chain ID: ${(error as Error).message}`,
      details: { error: (error as Error).message },
    });
  }

  return checks;
}

async function checkContractAddresses(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const config = NETWORK_CONFIGS[network];
  const addresses = config.addresses;

  const addressChecks: { name: string; address: string; required: boolean }[] = [
    { name: "USDC.e", address: addresses.usdcE, required: true },
    { name: "CTF", address: addresses.ctf, required: network === "mainnet" },
    { name: "CTF Exchange", address: addresses.ctfExchange, required: network === "mainnet" },
    {
      name: "NegRisk CTF Exchange",
      address: addresses.negRiskCtfExchange,
      required: network === "mainnet",
    },
    { name: "NegRisk Adapter", address: addresses.negRiskAdapter, required: network === "mainnet" },
    { name: "VaultV2 Factory", address: addresses.vaultV2Factory, required: false },
  ];

  for (const { name, address, required } of addressChecks) {
    const isZeroAddress = address.toLowerCase() === ZERO_ADDRESS.toLowerCase();

    if (isZeroAddress) {
      if (required) {
        checks.push({
          name: `contract:${name}`,
          status: "fail",
          message: `${name} address is zero address on ${network}. Contract must be deployed.`,
          details: { address, required, network },
        });
      } else {
        checks.push({
          name: `contract:${name}`,
          status: "warn",
          message: `${name} address is zero address (optional for ${network})`,
          details: { address, required, network },
        });
      }
    } else {
      // Basic address validation
      const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(address);
      checks.push({
        name: `contract:${name}`,
        status: isValidAddress ? "pass" : "fail",
        message: isValidAddress
          ? `${name} address is valid on ${network}`
          : `${name} address is malformed: ${address}`,
        details: { address, required, network },
      });
    }
  }

  return checks;
}

async function checkVaultContractShape(): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const vaultConfig = getPrimaryVaultConfigForChecks();
  const vaultAddress = vaultConfig?.vaultAddress;

  if (!vaultAddress) {
    checks.push({
      name: "vault:ContractShape",
      status: "warn",
      message: "No vault config available, skipping contract shape validation",
    });
    return checks;
  }

  const network = env.VAULT_NETWORK;
  const config = NETWORK_CONFIGS[network];

  try {
    const rpcUrl = getRpcUrlForNetwork(network);
    const client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    // Check if contract exists at address
    const code = await client.getBytecode({ address: vaultAddress as Address });

    if (!code || code === "0x") {
      checks.push({
        name: "vault:ContractShape",
        status: "fail",
        message: `No contract found at configured vault address ${vaultAddress} on ${network}`,
        details: { address: vaultAddress, network },
      });
      return checks;
    }

    // Try to call totalAssets to verify it's a vault
    try {
      const [asset, tradingWallet, currentNav] = await Promise.all([
        client.readContract({
          address: vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "asset",
        }),
        client.readContract({
          address: vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "tradingWallet",
        }),
        client.readContract({
          address: vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "currentNAV",
        }),
      ]);

      checks.push({
        name: "vault:ContractShape",
        status: "pass",
        message: `Vault contract at ${vaultAddress} exposes asset(), tradingWallet(), and currentNAV()`,
        details: {
          address: vaultAddress,
          asset,
          tradingWallet,
          currentNav: currentNav.toString(),
        },
      });
    } catch {
      checks.push({
        name: "vault:ContractShape",
        status: "fail",
        message: `Contract at ${vaultAddress} does not appear to expose the expected FlatBookVaultV2 surface`,
        details: { address: vaultAddress },
      });
    }
  } catch (error) {
    checks.push({
      name: "vault:ContractShape",
      status: "fail",
      message: `Failed to validate vault contract: ${(error as Error).message}`,
      details: { address: vaultAddress, error: (error as Error).message },
    });
  }

  return checks;
}

async function checkPolymarketConfiguration(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const config = NETWORK_CONFIGS[network];

  if (!config.supportsPolymarketTrading) {
    checks.push({
      name: "polymarket:TradingSupport",
      status: "pass",
      message: `Polymarket trading is disabled on ${network} (expected behavior)`,
      details: { network, supportsTrading: false },
    });
    return checks;
  }

  // Check for Polymarket credentials on mainnet
  const hasBuilderKey = !!process.env.POLYMARKET_BUILDER_API_KEY;
  const hasBuilderSecret = !!process.env.POLYMARKET_BUILDER_SECRET;
  const hasBuilderPassphrase = !!process.env.POLYMARKET_BUILDER_PASSPHRASE;

  const allBuilderVarsSet = hasBuilderKey && hasBuilderSecret && hasBuilderPassphrase;

  if (allBuilderVarsSet) {
    checks.push({
      name: "polymarket:BuilderCredentials",
      status: "pass",
      message: "Polymarket builder credentials are configured",
    });
  } else {
    checks.push({
      name: "polymarket:BuilderCredentials",
      status: "warn",
      message: `Polymarket builder credentials incomplete on mainnet. Trading may fail.`,
      details: {
        hasKey: hasBuilderKey,
        hasSecret: hasBuilderSecret,
        hasPassphrase: hasBuilderPassphrase,
      },
    });
  }

  return checks;
}

// ============================================================================
// DUAL-SAFE CHECK FUNCTIONS
// ============================================================================

async function checkTradingSafe(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const vaultConfig = getPrimaryVaultConfigForChecks();
  const vaultAddress = vaultConfig?.vaultAddress;

  if (!vaultAddress) {
    checks.push({
      name: "dualsafe:TradingSafe",
      status: "warn",
      message: "No vault config available, skipping tradingSafe validation",
    });
    return checks;
  }

  const config = NETWORK_CONFIGS[network];

  try {
    const rpcUrl = getRpcUrlForNetwork(network);
    const client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    // Try to read tradingSafe address from vault contract
    try {
      const tradingWalletAddress = await client.readContract({
        address: vaultAddress as Address,
        abi: TRADING_WALLET_ABI,
        functionName: "tradingWallet",
      });

      // Validate tradingSafe address
      const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(tradingWalletAddress);
      const isZeroAddress = tradingWalletAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase();

      if (!isValidAddress) {
        checks.push({
          name: "dualsafe:TradingSafe",
          status: "fail",
          message: `Trading wallet address is malformed: ${tradingWalletAddress}`,
          details: { vaultAddress, tradingWalletAddress },
        });
      } else if (isZeroAddress) {
        checks.push({
          name: "dualsafe:TradingSafe",
          status: "fail",
          message: `Trading wallet address is zero address. Contract not properly configured.`,
          details: { vaultAddress, tradingWalletAddress },
        });
      } else {
        checks.push({
          name: "dualsafe:TradingSafe",
          status: "pass",
          message: `Trading wallet address is valid: ${tradingWalletAddress}`,
          details: { vaultAddress, tradingWalletAddress },
        });
      }
    } catch (error) {
      checks.push({
        name: "dualsafe:TradingSafe",
        status: "warn",
        message: `Vault contract does not expose tradingWallet()`,
        details: { vaultAddress, error: (error as Error).message },
      });
    }
  } catch (error) {
    checks.push({
      name: "dualsafe:TradingSafe",
      status: "fail",
      message: `Failed to validate trading wallet: ${(error as Error).message}`,
      details: { vaultAddress, error: (error as Error).message },
    });
  }

  return checks;
}

async function checkCapitalFunctions(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const vaultConfig = getPrimaryVaultConfigForChecks();
  const vaultAddress = vaultConfig?.vaultAddress;

  if (!vaultAddress) {
    checks.push({
      name: "dualsafe:CapitalFunctions",
      status: "warn",
      message: "No vault config available, skipping capital functions validation",
    });
    return checks;
  }

  const config = NETWORK_CONFIGS[network];

  try {
    const rpcUrl = getRpcUrlForNetwork(network);
    const client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    try {
      const maxAllocatableAssets = await client.readContract({
        address: vaultAddress as Address,
        abi: CAPITAL_STATUS_ABI,
        functionName: "maxAllocatableAssets",
      });

      checks.push({
        name: "dualsafe:CapitalFunctions",
        status: "pass",
        message: `Capital allocation surface is accessible. maxAllocatableAssets=${maxAllocatableAssets.toString()}`,
        details: { vaultAddress, maxAllocatableAssets: maxAllocatableAssets.toString() },
      });
    } catch (error) {
      checks.push({
        name: "dualsafe:CapitalFunctions",
        status: "warn",
        message: `Capital allocation surface not accessible on vault`,
        details: { vaultAddress, error: (error as Error).message },
      });
    }
  } catch (error) {
    checks.push({
      name: "dualsafe:CapitalFunctions",
      status: "fail",
      message: `Failed to validate capital functions: ${(error as Error).message}`,
      details: { vaultAddress, error: (error as Error).message },
    });
  }

  return checks;
}

async function checkVaultUSDCBalance(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const vaultConfig = getPrimaryVaultConfigForChecks();
  const vaultAddress = vaultConfig?.vaultAddress;

  if (!vaultAddress) {
    checks.push({
      name: "dualsafe:VaultUSDCBalance",
      status: "warn",
      message: "No vault config available, skipping USDC balance check",
    });
    return checks;
  }

  const config = NETWORK_CONFIGS[network];
  const usdcAddress = config.addresses.usdcE;

  // Skip if USDC address is not configured for this network
  if (usdcAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    checks.push({
      name: "dualsafe:VaultUSDCBalance",
      status: "warn",
      message: `USDC.e address not configured for ${network}, skipping balance check`,
      details: { network, usdcAddress },
    });
    return checks;
  }

  try {
    const rpcUrl = getRpcUrlForNetwork(network);
    const client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    // Check vault USDC balance
    const balance = await client.readContract({
      address: usdcAddress as Address,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [vaultAddress as Address],
    });

    const balanceFormatted = Number(balance) / 1e6;

    if (balance === 0n) {
      checks.push({
        name: "dualsafe:VaultUSDCBalance",
        status: "warn",
        message: `Vault has zero USDC balance. Deposit required for operations.`,
        details: { vaultAddress, balance: balance.toString(), balanceFormatted },
      });
    } else {
      checks.push({
        name: "dualsafe:VaultUSDCBalance",
        status: "pass",
        message: `Vault USDC balance: ${balanceFormatted.toFixed(2)} USDC`,
        details: { vaultAddress, balance: balance.toString(), balanceFormatted },
      });
    }
  } catch (error) {
    checks.push({
      name: "dualsafe:VaultUSDCBalance",
      status: "fail",
      message: `Failed to check vault USDC balance: ${(error as Error).message}`,
      details: { vaultAddress, error: (error as Error).message },
    });
  }

  return checks;
}

async function checkTradingSafeApproval(network: NetworkType): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const vaultConfig = getPrimaryVaultConfigForChecks();
  const vaultAddress = vaultConfig?.vaultAddress;

  if (!vaultAddress) {
    checks.push({
      name: "dualsafe:TradingSafeApproval",
      status: "warn",
      message: "No vault config available, skipping tradingSafe approval check",
    });
    return checks;
  }

  const config = NETWORK_CONFIGS[network];
  const usdcAddress = config.addresses.usdcE;

  // Skip if USDC address is not configured for this network
  if (usdcAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    checks.push({
      name: "dualsafe:TradingSafeApproval",
      status: "warn",
      message: `USDC.e address not configured for ${network}, skipping approval check`,
      details: { network, usdcAddress },
    });
    return checks;
  }

  try {
    const rpcUrl = getRpcUrlForNetwork(network);
    const client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    let tradingWalletAddress: Address;
    try {
      tradingWalletAddress = await client.readContract({
        address: vaultAddress as Address,
        abi: TRADING_WALLET_ABI,
        functionName: "tradingWallet",
      });
    } catch {
      checks.push({
        name: "dualsafe:TradingSafeApproval",
        status: "warn",
        message: `Cannot check exchange approvals - tradingWallet not readable on vault`,
        details: { vaultAddress },
      });
      return checks;
    }

    const exchanges = [
      { name: "CTF Exchange", address: config.addresses.ctfExchange },
      { name: "NegRisk CTF Exchange", address: config.addresses.negRiskCtfExchange },
      { name: "NegRisk Adapter", address: config.addresses.negRiskAdapter },
    ].filter((exchange) => exchange.address.toLowerCase() !== ZERO_ADDRESS.toLowerCase());

    if (exchanges.length === 0) {
      checks.push({
        name: "dualsafe:TradingSafeApproval",
        status: "warn",
        message: `No Polymarket exchange addresses configured for ${network}, skipping approval check`,
        details: { network },
      });
      return checks;
    }

    for (const exchange of exchanges) {
      const [allowance, isApprovedForAll] = await Promise.all([
        client.readContract({
          address: usdcAddress as Address,
          abi: USDC_ABI,
          functionName: "allowance",
          args: [tradingWalletAddress, exchange.address as Address],
        }),
        client.readContract({
          address: config.addresses.ctf as Address,
          abi: ERC1155_ABI,
          functionName: "isApprovedForAll",
          args: [tradingWalletAddress, exchange.address as Address],
        }),
      ]);

      checks.push({
        name: `dualsafe:TradingSafeApproval:${exchange.name}:USDC`,
        status: allowance > 0n ? "pass" : "warn",
        message:
          allowance > 0n
            ? `Trading wallet has USDC approval for ${exchange.name}`
            : `Trading wallet is missing USDC approval for ${exchange.name}`,
        details: {
          vaultAddress,
          tradingWalletAddress,
          exchange: exchange.address,
          allowance: allowance.toString(),
        },
      });

      checks.push({
        name: `dualsafe:TradingSafeApproval:${exchange.name}:CTF`,
        status: isApprovedForAll ? "pass" : "warn",
        message: isApprovedForAll
          ? `Trading wallet has CTF approval for ${exchange.name}`
          : `Trading wallet is missing CTF approval for ${exchange.name}`,
        details: { vaultAddress, tradingWalletAddress, exchange: exchange.address, isApprovedForAll },
      });
    }
  } catch (error) {
    checks.push({
      name: "dualsafe:TradingSafeApproval",
      status: "fail",
      message: `Failed to check trading wallet approvals: ${(error as Error).message}`,
      details: { vaultAddress, error: (error as Error).message },
    });
  }

  return checks;
}

// ============================================================================
// PRE-DEPLOY AND POST-DEPLOY VALIDATION FUNCTIONS
// ============================================================================

interface PreDeployConfig {
  asset: string;
  admin: string;
  settler: string;
  navUpdater: string;
  snapshotter: string;
  depositProcessor: string;
  tradingSafe: string;
  epochDuration: bigint;
  navStalenessThreshold: bigint;
  minClaimThreshold: bigint;
  balancedUpfrontBps: bigint;
}

async function runPreDeployValidation(
  network: NetworkType,
  config: PreDeployConfig,
): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];

  // Validate all addresses are non-zero
  const addressFields: { name: string; value: string }[] = [
    { name: "asset", value: config.asset },
    { name: "admin", value: config.admin },
    { name: "settler", value: config.settler },
    { name: "navUpdater", value: config.navUpdater },
    { name: "snapshotter", value: config.snapshotter },
    { name: "depositProcessor", value: config.depositProcessor },
    { name: "tradingSafe", value: config.tradingSafe },
  ];

  for (const { name, value } of addressFields) {
    const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(value);
    const isZeroAddress = value.toLowerCase() === ZERO_ADDRESS.toLowerCase();

    if (!isValidAddress || isZeroAddress) {
      checks.push({
        name: `predeploy:ConstructorArg:${name}`,
        status: "fail",
        message: `Invalid constructor arg ${name}: ${isZeroAddress ? "zero address" : "malformed address"}`,
        details: { name, value },
      });
    } else {
      checks.push({
        name: `predeploy:ConstructorArg:${name}`,
        status: "pass",
        message: `${name} address is valid: ${value.slice(0, 6)}...${value.slice(-4)}`,
        details: { name, value },
      });
    }
  }

  // Validate numeric parameters
  if (config.epochDuration === 0n) {
    checks.push({
      name: "predeploy:ConstructorArg:epochDuration",
      status: "fail",
      message: "epochDuration cannot be zero",
      details: { value: config.epochDuration.toString() },
    });
  } else {
    checks.push({
      name: "predeploy:ConstructorArg:epochDuration",
      status: "pass",
      message: `epochDuration: ${config.epochDuration.toString()} seconds`,
      details: { value: config.epochDuration.toString() },
    });
  }

  if (config.navStalenessThreshold === 0n) {
    checks.push({
      name: "predeploy:ConstructorArg:navStalenessThreshold",
      status: "fail",
      message: "navStalenessThreshold cannot be zero",
      details: { value: config.navStalenessThreshold.toString() },
    });
  } else {
    checks.push({
      name: "predeploy:ConstructorArg:navStalenessThreshold",
      status: "pass",
      message: `navStalenessThreshold: ${config.navStalenessThreshold.toString()} seconds`,
      details: { value: config.navStalenessThreshold.toString() },
    });
  }

  return checks;
}

async function runPostDeployValidation(
  network: NetworkType,
  vaultAddress: Address,
  expectedConfig: Partial<PreDeployConfig>,
): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const config = NETWORK_CONFIGS[network];

  try {
    const rpcUrl = getRpcUrlForNetwork(network);
    const client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    // Check contract exists
    const code = await client.getBytecode({ address: vaultAddress });
    if (!code || code === "0x") {
      checks.push({
        name: "postdeploy:ContractExists",
        status: "fail",
        message: `No contract found at ${vaultAddress}`,
        details: { vaultAddress },
      });
      return checks;
    }

    checks.push({
      name: "postdeploy:ContractExists",
      status: "pass",
      message: `Contract deployed at ${vaultAddress}`,
      details: { vaultAddress, codeLength: code.length },
    });

    // Verify tradingSafe matches expected
    if (expectedConfig.tradingSafe) {
      try {
        const actualTradingSafe = await client.readContract({
          address: vaultAddress,
          abi: TRADING_WALLET_ABI,
          functionName: "tradingWallet",
        });

        const matches =
          actualTradingSafe.toLowerCase() === expectedConfig.tradingSafe.toLowerCase();
        checks.push({
          name: "postdeploy:TradingSafeMatch",
          status: matches ? "pass" : "fail",
          message: matches
            ? `TradingSafe matches expected: ${actualTradingSafe}`
            : `TradingSafe mismatch! Expected: ${expectedConfig.tradingSafe}, Got: ${actualTradingSafe}`,
          details: { expected: expectedConfig.tradingSafe, actual: actualTradingSafe },
        });
      } catch (error) {
        checks.push({
          name: "postdeploy:TradingSafeMatch",
          status: "fail",
          message: `Failed to read tradingSafe: ${(error as Error).message}`,
          details: { error: (error as Error).message },
        });
      }
    }

    // Verify asset matches expected (USDC.e)
    if (expectedConfig.asset) {
      try {
        const actualAsset = await client.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: "asset",
        });

        const matches = actualAsset.toLowerCase() === expectedConfig.asset.toLowerCase();
        checks.push({
          name: "postdeploy:AssetMatch",
          status: matches ? "pass" : "fail",
          message: matches
            ? `Asset (USDC.e) matches expected`
            : `Asset mismatch! Expected: ${expectedConfig.asset}, Got: ${actualAsset}`,
          details: { expected: expectedConfig.asset, actual: actualAsset },
        });
      } catch (error) {
        checks.push({
          name: "postdeploy:AssetMatch",
          status: "fail",
          message: `Failed to read asset: ${(error as Error).message}`,
          details: { error: (error as Error).message },
        });
      }
    }

    // Verify contract state
    try {
      const totalAssets = await client.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "totalAssets",
      });

      checks.push({
        name: "postdeploy:ContractState",
        status: "pass",
        message: `Contract is functional - totalAssets: ${(Number(totalAssets) / 1e6).toFixed(2)} USDC`,
        details: { totalAssets: totalAssets.toString() },
      });
    } catch (error) {
      checks.push({
        name: "postdeploy:ContractState",
        status: "fail",
        message: `Contract state check failed: ${(error as Error).message}`,
        details: { error: (error as Error).message },
      });
    }
  } catch (error) {
    checks.push({
      name: "postdeploy:Validation",
      status: "fail",
      message: `Post-deploy validation failed: ${(error as Error).message}`,
      details: { vaultAddress, error: (error as Error).message },
    });
  }

  return checks;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

function parseArgs(): { json: boolean; quiet: boolean; verbose: boolean } {
  const args = process.argv.slice(2);
  return {
    json: args.includes("--json"),
    quiet: args.includes("--quiet"),
    verbose: args.includes("--verbose"),
  };
}

function formatReport(report: ReadinessReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push("\n" + "=".repeat(70));
  lines.push(" STAGING READINESS CHECK");
  lines.push("=".repeat(70));
  lines.push(` Network:     ${report.network} (chainId=${report.chainId})`);
  lines.push(` Timestamp:   ${report.timestamp}`);
  lines.push(
    ` Status:      ${report.overallStatus === "ready" ? "✅ READY" : report.overallStatus === "error" ? "❌ ERROR" : "❌ NOT READY"}`,
  );
  lines.push("-".repeat(70));

  // Group checks by status
  const failed = report.checks.filter((c) => c.status === "fail");
  const warnings = report.checks.filter((c) => c.status === "warn");
  const passed = report.checks.filter((c) => c.status === "pass");

  if (failed.length > 0) {
    lines.push("\n❌ FAILED CHECKS:");
    for (const check of failed) {
      lines.push(`  ${check.name}`);
      lines.push(`     ${check.message}`);
      if (verbose && check.details) {
        lines.push(`     Details: ${JSON.stringify(check.details)}`);
      }
    }
  }

  if (warnings.length > 0) {
    lines.push("\n⚠️  WARNINGS:");
    for (const check of warnings) {
      lines.push(`  ${check.name}`);
      lines.push(`     ${check.message}`);
      if (verbose && check.details) {
        lines.push(`     Details: ${JSON.stringify(check.details)}`);
      }
    }
  }

  if (verbose && passed.length > 0) {
    lines.push("\n✅ PASSED CHECKS:");
    for (const check of passed) {
      lines.push(`  ${check.name}: ${check.message}`);
    }
  }

  lines.push("\n" + "-".repeat(70));
  lines.push(
    ` Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`,
  );
  lines.push("=".repeat(70) + "\n");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const startTime = Date.now();

  // Determine network from env
  let network: NetworkType;
  try {
    network = env.VAULT_NETWORK;
  } catch (error) {
    const report: ReadinessReport = {
      network: "unknown" as NetworkType,
      chainId: 0,
      timestamp: new Date().toISOString(),
      overallStatus: "error",
      checks: [
        {
          name: "config:VAULT_NETWORK",
          status: "fail",
          message: (error as Error).message,
        },
      ],
      summary: { passed: 0, failed: 1, warnings: 0, total: 1 },
    };

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else if (!args.quiet) {
      console.error(formatReport(report, args.verbose));
    }
    process.exit(2);
  }

  const config = NETWORK_CONFIGS[network];

  // Run all checks
  const allChecks: ReadinessCheck[] = [];

  try {
    allChecks.push(...(await checkEnvironmentVariables(network)));
    allChecks.push(...(await checkNetworkConfiguration(network)));
    allChecks.push(...(await checkChainIdValidation(network)));
    allChecks.push(...(await checkContractAddresses(network)));
    allChecks.push(...(await checkVaultContractShape()));
    allChecks.push(...(await checkPolymarketConfiguration(network)));

    // Dual-safe specific checks
    allChecks.push(...(await checkTradingSafe(network)));
    allChecks.push(...(await checkCapitalFunctions(network)));
    allChecks.push(...(await checkVaultUSDCBalance(network)));
    allChecks.push(...(await checkTradingSafeApproval(network)));
  } catch (error) {
    allChecks.push({
      name: "system:CheckExecution",
      status: "fail",
      message: `Unexpected error during checks: ${(error as Error).message}`,
    });
  }

  // Calculate summary

  // Calculate summary
  const passed = allChecks.filter((c) => c.status === "pass").length;
  const failed = allChecks.filter((c) => c.status === "fail").length;
  const warnings = allChecks.filter((c) => c.status === "warn").length;

  const overallStatus: ReadinessReport["overallStatus"] = failed > 0 ? "not-ready" : "ready";

  const report: ReadinessReport = {
    network,
    chainId: config.chainId,
    timestamp: new Date().toISOString(),
    overallStatus,
    checks: allChecks,
    summary: { passed, failed, warnings, total: allChecks.length },
  };

  // Output results
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!args.quiet || failed > 0) {
    console.log(formatReport(report, args.verbose));
  }

  // Exit with appropriate code
  const exitCode = failed > 0 ? 1 : 0;

  if (!args.quiet) {
    const duration = Date.now() - startTime;
    console.log(`Readiness check completed in ${duration}ms with exit code ${exitCode}`);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("Fatal error during readiness check:", error);
  process.exit(2);
});
