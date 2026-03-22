#!/usr/bin/env node
import "dotenv/config";

import { AssetType, ClobClient } from "@polymarket/clob-client";
import { Wallet, utils } from "ethers";
import { createPublicClient, type Address } from "viem";
import { getVaultConfig, resolveVaultIdentity } from "../config/index.js";
import { getNetworkConfigFromEnv, validateNetworkConfiguration } from "../config/network.js";
import {
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEGRISK_ADAPTER_ADDRESS,
  NEGRISK_CTF_EXCHANGE_ADDRESS,
  USDC_E_ADDRESS,
} from "../constants.js";
import { env } from "../env.js";
import { createNetworkTransport } from "../rpcTransport.js";

type CheckStatus = "pass" | "fail" | "warn";

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

interface Report {
  vaultId: number;
  timestamp: string;
  overallStatus: "ready" | "not-ready";
  checks: CheckResult[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    total: number;
  };
}

const CLOB_HOST = "https://clob.polymarket.com";
const DEFAULT_VAULT_ID = 1;
const DEFAULT_SESSION_SECRET = "vault-dev-secret-change-me";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADMIN_ROLE = utils.id("ADMIN_ROLE") as `0x${string}`;
const BOOK_RUNNER_ROLE = utils.id("BOOK_RUNNER_ROLE") as `0x${string}`;
const NAV_UPDATER_ROLE = utils.id("NAV_UPDATER_ROLE") as `0x${string}`;

const VAULT_ABI = [
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
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32", internalType: "bytes32" },
      { name: "account", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
] as const;

const SAFE_ABI = [
  {
    type: "function",
    name: "getOwners",
    inputs: [],
    outputs: [{ name: "", type: "address[]", internalType: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getThreshold",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;

const ERC20_ALLOWANCE_ABI = [
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

const ERC1155_APPROVAL_ABI = [
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

const POLYMARKET_EXCHANGES = [
  CTF_EXCHANGE_ADDRESS,
  NEGRISK_CTF_EXCHANGE_ADDRESS,
  NEGRISK_ADAPTER_ADDRESS,
] as const;

function parseArgs(argv: string[]): { vaultId: number; json: boolean } {
  let vaultId = DEFAULT_VAULT_ID;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--vault-id") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--vault-id requires a numeric value");
      }
      vaultId = Number(next);
      if (!Number.isInteger(vaultId) || vaultId <= 0) {
        throw new Error(`Invalid --vault-id value: ${next}`);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { vaultId, json };
}

function addCheck(
  checks: CheckResult[],
  status: CheckStatus,
  name: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  checks.push({ name, status, message, details });
}

function summarize(checks: CheckResult[]): Report["summary"] {
  return {
    passed: checks.filter((check) => check.status === "pass").length,
    failed: checks.filter((check) => check.status === "fail").length,
    warnings: checks.filter((check) => check.status === "warn").length,
    total: checks.length,
  };
}

function printTextReport(report: Report): void {
  console.log(`Mainnet verification for vault ${report.vaultId}`);
  console.log(`Status: ${report.overallStatus}`);
  console.log("");

  for (const check of report.checks) {
    const prefix =
      check.status === "pass" ? "[PASS]" : check.status === "fail" ? "[FAIL]" : "[WARN]";
    console.log(`${prefix} ${check.name}: ${check.message}`);
  }

  console.log("");
  console.log(
    `Passed: ${report.summary.passed}  Failed: ${report.summary.failed}  Warnings: ${report.summary.warnings}`,
  );
}

async function main(): Promise<void> {
  const { vaultId, json } = parseArgs(process.argv.slice(2));
  const checks: CheckResult[] = [];

  addCheck(
    checks,
    env.VAULT_NETWORK === "mainnet" ? "pass" : "fail",
    "env:VAULT_NETWORK",
    `VAULT_NETWORK=${env.VAULT_NETWORK}`,
  );

  addCheck(
    checks,
    Boolean(env.VAULT_DATABASE_URL) ? "pass" : "fail",
    "env:VAULT_DATABASE_URL",
    Boolean(env.VAULT_DATABASE_URL) ? "Database URL is set" : "Database URL is missing",
  );

  addCheck(
    checks,
    env.VAULT_SESSION_SECRET && env.VAULT_SESSION_SECRET !== DEFAULT_SESSION_SECRET
      ? "pass"
      : "fail",
    "env:VAULT_SESSION_SECRET",
    env.VAULT_SESSION_SECRET && env.VAULT_SESSION_SECRET !== DEFAULT_SESSION_SECRET
      ? "Session secret is set to a non-default value"
      : "Session secret is missing or still using the default dev value",
  );

  addCheck(
    checks,
    env.POLYGON_RPC_URLS.length > 0 ? "pass" : "fail",
    "env:POLYGON_RPC_URL",
    env.POLYGON_RPC_URLS.length > 0
      ? `Configured ${env.POLYGON_RPC_URLS.length} mainnet RPC endpoint(s)`
      : "POLYGON_RPC_URL is missing",
  );

  try {
    await validateNetworkConfiguration();
    addCheck(checks, "pass", "network:rpc", "Mainnet RPC configuration validated successfully");
  } catch (error) {
    addCheck(checks, "fail", "network:rpc", (error as Error).message);
  }

  const networkConfig = getNetworkConfigFromEnv();
  const config = getVaultConfig(vaultId);

  if (!config) {
    addCheck(
      checks,
      "fail",
      "config:vault",
      `Vault ${vaultId} was not found in current configuration`,
    );
    const report: Report = {
      vaultId,
      timestamp: new Date().toISOString(),
      overallStatus: "not-ready",
      checks,
      summary: summarize(checks),
    };
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }
    process.exit(1);
  }

  addCheck(
    checks,
    config.enabled ? "pass" : "fail",
    "config:enabled",
    config.enabled ? `Vault ${vaultId} is enabled` : `Vault ${vaultId} is disabled`,
  );

  addCheck(
    checks,
    config.network === "mainnet" ? "pass" : "fail",
    "config:network",
    `Vault config network=${config.network ?? "undefined"}`,
  );

  let identity;
  try {
    identity = resolveVaultIdentity(config);
    addCheck(checks, "pass", "identity:resolve", "Resolved vault identity successfully");
  } catch (error) {
    addCheck(checks, "fail", "identity:resolve", (error as Error).message);
    const report: Report = {
      vaultId,
      timestamp: new Date().toISOString(),
      overallStatus: "not-ready",
      checks,
      summary: summarize(checks),
    };
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }
    process.exit(1);
  }

  const allocatorAddress = new Wallet(identity.allocatorNavSignerKey).address.toLowerCase();
  const safeOperatorAddress = new Wallet(identity.safeOperatorKey).address.toLowerCase();
  const tradingSignerAddress = identity.tradingSignerKey
    ? new Wallet(identity.tradingSignerKey).address.toLowerCase()
    : null;
  const settlerAddress = identity.settlerKey
    ? new Wallet(identity.settlerKey).address.toLowerCase()
    : null;
  const maintenanceSignerAddress = (settlerAddress ?? allocatorAddress).toLowerCase();
  const expectedTradingWallet = config.safeAddress.toLowerCase();

  addCheck(
    checks,
    identity.safeAddress.toLowerCase() === expectedTradingWallet ? "pass" : "fail",
    "identity:funder",
    identity.safeAddress.toLowerCase() === expectedTradingWallet
      ? `Trading funder matches expected trading wallet ${expectedTradingWallet}`
      : `Trading funder ${identity.safeAddress} does not match expected trading wallet ${expectedTradingWallet}`,
  );

  const client = createPublicClient({
    chain: networkConfig.chain,
    transport: createNetworkTransport(),
  });

  try {
    const vaultCode = await client.getCode({ address: config.vaultAddress as Address });
    addCheck(
      checks,
      vaultCode && vaultCode !== "0x" ? "pass" : "fail",
      "contract:vault-code",
      vaultCode && vaultCode !== "0x"
        ? `Vault contract deployed at ${config.vaultAddress}`
        : `No contract code found at vault address ${config.vaultAddress}`,
    );

    if (vaultCode && vaultCode !== "0x") {
      const [assetAddress, tradingWallet] = await Promise.all([
        client.readContract({
          address: config.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "asset",
        }),
        client.readContract({
          address: config.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "tradingWallet",
        }),
      ]);

      addCheck(
        checks,
        assetAddress.toLowerCase() === networkConfig.addresses.usdcE.toLowerCase()
          ? "pass"
          : "fail",
        "contract:asset",
        assetAddress.toLowerCase() === networkConfig.addresses.usdcE.toLowerCase()
          ? `Vault asset matches Polygon USDC.e ${assetAddress}`
          : `Vault asset ${assetAddress} does not match expected ${networkConfig.addresses.usdcE}`,
      );

      addCheck(
        checks,
        tradingWallet.toLowerCase() === expectedTradingWallet ? "pass" : "fail",
        "contract:tradingWallet",
        tradingWallet.toLowerCase() === expectedTradingWallet
          ? `On-chain tradingWallet matches expected ${tradingWallet}`
          : `On-chain tradingWallet ${tradingWallet} does not match expected ${expectedTradingWallet}`,
      );

      const [
        allocatorHasNavRole,
        maintenanceSignerHasBookRole,
        allocatorHasAdminRole,
        walletHasAdminRole,
      ] = await Promise.all([
        client.readContract({
          address: config.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "hasRole",
          args: [NAV_UPDATER_ROLE, allocatorAddress as Address],
        }),
        client.readContract({
          address: config.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "hasRole",
          args: [BOOK_RUNNER_ROLE, maintenanceSignerAddress as Address],
        }),
        client.readContract({
          address: config.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "hasRole",
          args: [ADMIN_ROLE, allocatorAddress as Address],
        }),
        client.readContract({
          address: config.vaultAddress as Address,
          abi: VAULT_ABI,
          functionName: "hasRole",
          args: [ADMIN_ROLE, expectedTradingWallet as Address],
        }),
      ]);

      addCheck(
        checks,
        allocatorHasNavRole ? "pass" : "fail",
        "roles:NAV_UPDATER_ROLE",
        allocatorHasNavRole
          ? `Allocator/NAV signer ${allocatorAddress} has NAV_UPDATER_ROLE`
          : `Allocator/NAV signer ${allocatorAddress} is missing NAV_UPDATER_ROLE`,
      );

      addCheck(
        checks,
        maintenanceSignerHasBookRole ? "pass" : "fail",
        "roles:BOOK_RUNNER_ROLE",
        maintenanceSignerHasBookRole
          ? `Maintenance signer ${maintenanceSignerAddress} has BOOK_RUNNER_ROLE`
          : `Maintenance signer ${maintenanceSignerAddress} is missing BOOK_RUNNER_ROLE`,
      );

      addCheck(
        checks,
        allocatorHasAdminRole || walletHasAdminRole ? "pass" : "fail",
        "roles:ADMIN_ROLE",
        allocatorHasAdminRole || walletHasAdminRole
          ? `ADMIN_ROLE present on ${allocatorHasAdminRole ? allocatorAddress : expectedTradingWallet}`
          : `Neither allocator ${allocatorAddress} nor trading wallet ${expectedTradingWallet} has ADMIN_ROLE`,
      );
    }
  } catch (error) {
    addCheck(checks, "fail", "contract:read", (error as Error).message);
  }

  try {
    const code = await client.getCode({ address: expectedTradingWallet as Address });
    if (!code || code === "0x") {
      addCheck(
        checks,
        safeOperatorAddress === expectedTradingWallet ? "pass" : "fail",
        "wallet:mode",
        safeOperatorAddress === expectedTradingWallet
          ? `Trading wallet ${expectedTradingWallet} is an EOA and safeOperatorKey matches it`
          : `Trading wallet ${expectedTradingWallet} is an EOA but safeOperatorKey resolves to ${safeOperatorAddress}`,
      );
    } else {
      const [owners, threshold] = await Promise.all([
        client.readContract({
          address: expectedTradingWallet as Address,
          abi: SAFE_ABI,
          functionName: "getOwners",
        }),
        client.readContract({
          address: expectedTradingWallet as Address,
          abi: SAFE_ABI,
          functionName: "getThreshold",
        }),
      ]);
      const normalizedOwners = owners.map((owner) => owner.toLowerCase());
      const thresholdNumber = Number(threshold);
      addCheck(
        checks,
        normalizedOwners.includes(safeOperatorAddress) ? "pass" : "fail",
        "wallet:owner",
        normalizedOwners.includes(safeOperatorAddress)
          ? `Trading wallet ${expectedTradingWallet} is a Safe and safeOperatorKey is an owner`
          : `Trading wallet ${expectedTradingWallet} is a Safe but safeOperatorKey ${safeOperatorAddress} is not an owner`,
      );
      addCheck(
        checks,
        thresholdNumber === 1 ? "pass" : "fail",
        "wallet:threshold",
        thresholdNumber === 1
          ? `Trading Safe threshold is automation-compatible (${thresholdNumber})`
          : `Trading Safe threshold is ${thresholdNumber}; current automation only supports threshold 1`,
      );
    }
  } catch (error) {
    addCheck(checks, "fail", "wallet:mode", (error as Error).message);
  }

  try {
    for (const exchange of POLYMARKET_EXCHANGES) {
      if (exchange.toLowerCase() === ZERO_ADDRESS) {
        addCheck(
          checks,
          "fail",
          `approval:exchange:${exchange}`,
          `Polymarket exchange address is unset for current network: ${exchange}`,
        );
        continue;
      }

      const [usdcAllowance, ctfApprovedForAll] = await Promise.all([
        client.readContract({
          address: USDC_E_ADDRESS as Address,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: "allowance",
          args: [expectedTradingWallet as Address, exchange as Address],
        }),
        client.readContract({
          address: CTF_ADDRESS as Address,
          abi: ERC1155_APPROVAL_ABI,
          functionName: "isApprovedForAll",
          args: [expectedTradingWallet as Address, exchange as Address],
        }),
      ]);

      addCheck(
        checks,
        usdcAllowance > 0n ? "pass" : "fail",
        `approval:USDC:${exchange}`,
        usdcAllowance > 0n
          ? `USDC allowance is set for ${exchange}`
          : `USDC allowance is missing for ${exchange}`,
      );

      addCheck(
        checks,
        ctfApprovedForAll ? "pass" : "fail",
        `approval:CTF:${exchange}`,
        ctfApprovedForAll
          ? `CTF approvalForAll is set for ${exchange}`
          : `CTF approvalForAll is missing for ${exchange}`,
      );
    }
  } catch (error) {
    addCheck(checks, "fail", "approval:read", (error as Error).message);
  }

  addCheck(
    checks,
    identity.tradingSignatureType === undefined || identity.tradingSignatureType === 2
      ? "pass"
      : "warn",
    "config:signatureType",
    identity.tradingSignatureType === undefined || identity.tradingSignatureType === 2
      ? "Configured signature type is compatible"
      : `Configured signatureType is ${identity.tradingSignatureType}; expected 2 for Safe-backed Polymarket setup`,
  );

  if (!identity.tradingSignerKey) {
    addCheck(
      checks,
      "warn",
      "clob:auth",
      "Trading signer is not configured in vault-api; skipping Polymarket auth check because trading is external.",
    );
  } else {
    try {
      const signer = new Wallet(identity.tradingSignerKey);
      const l1Client = new ClobClient(
        CLOB_HOST,
        networkConfig.chainId,
        signer,
        undefined,
        identity.tradingSignatureType ?? 2,
        identity.safeAddress,
        undefined,
        true,
      );
      const creds = await l1Client.createOrDeriveApiKey();

      if (!creds?.key || !creds?.secret || !creds?.passphrase) {
        throw new Error("createOrDeriveApiKey returned incomplete credentials");
      }

      const l2Client = new ClobClient(
        CLOB_HOST,
        networkConfig.chainId,
        signer,
        creds,
        identity.tradingSignatureType ?? 2,
        identity.safeAddress,
        undefined,
        true,
      );

      await l2Client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });

      addCheck(
        checks,
        "pass",
        "clob:auth",
        `Trading signer ${tradingSignerAddress ?? "unknown"} authenticated against Polymarket with funder ${identity.safeAddress}`,
      );
    } catch (error) {
      addCheck(checks, "fail", "clob:auth", (error as Error).message);
    }
  }

  const report: Report = {
    vaultId,
    timestamp: new Date().toISOString(),
    overallStatus: checks.some((check) => check.status === "fail") ? "not-ready" : "ready",
    checks,
    summary: summarize(checks),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  process.exit(report.overallStatus === "ready" ? 0 : 1);
}

main().catch((error) => {
  console.error(`[verify:mainnet] ${(error as Error).message}`);
  process.exit(1);
});
