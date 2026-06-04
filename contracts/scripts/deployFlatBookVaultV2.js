#!/usr/bin/env node

/**
 * FlatBookVaultV2 deployment script.
 *
 * Usage:
 *   node deployFlatBookVaultV2.js --rpc-url <url> [--dry-run]
 *
 * Required env:
 *   PRIVATE_KEY
 *   FLATBOOK_ASSET_ADDRESS              pUSD on Polygon mainnet
 *   FLATBOOK_USER_ASSET_ADDRESS         USDC.e on Polygon mainnet
 *   FLATBOOK_COLLATERAL_ONRAMP_ADDRESS  Polymarket USDC.e -> pUSD ramp
 *   FLATBOOK_COLLATERAL_OFFRAMP_ADDRESS Polymarket pUSD -> USDC.e ramp
 *   FLATBOOK_ADMIN_ADDRESS
 *   FLATBOOK_BOOK_RUNNER_ADDRESS
 *   FLATBOOK_NAV_UPDATER_ADDRESS
 *   FLATBOOK_TRADING_WALLET_ADDRESS     Trading Safe
 *   FLATBOOK_NAV_STALENESS_THRESHOLD    Seconds
 */

const ethers = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const REQUIRED_ENV_VARS = [
  "PRIVATE_KEY",
  "FLATBOOK_ASSET_ADDRESS",
  "FLATBOOK_USER_ASSET_ADDRESS",
  "FLATBOOK_COLLATERAL_ONRAMP_ADDRESS",
  "FLATBOOK_COLLATERAL_OFFRAMP_ADDRESS",
  "FLATBOOK_ADMIN_ADDRESS",
  "FLATBOOK_BOOK_RUNNER_ADDRESS",
  "FLATBOOK_NAV_UPDATER_ADDRESS",
  "FLATBOOK_TRADING_WALLET_ADDRESS",
  "FLATBOOK_NAV_STALENESS_THRESHOLD",
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const FLATBOOK_ABI = [
  "constructor(address _asset,address _userAsset,address _collateralOnramp,address _collateralOfframp,address _admin,address _bookRunner,address _navUpdater,address _tradingWallet,uint256 _navStalenessThreshold)",
  "function asset() view returns (address)",
  "function userAsset() view returns (address)",
  "function collateralOnramp() view returns (address)",
  "function collateralOfframp() view returns (address)",
  "function tradingWallet() view returns (address)",
  "function NAV_STALENESS_THRESHOLD() view returns (uint256)",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    dryRun: false,
    rpcUrl: process.env.POLYGON_RPC_URL ?? process.env.POLYGON_MAINNET_RPC,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") parsed.dryRun = true;
    if (arg === "--rpc-url") parsed.rpcUrl = args[++i];
  }

  if (!parsed.rpcUrl) {
    throw new Error("RPC URL required via --rpc-url, POLYGON_RPC_URL, or POLYGON_MAINNET_RPC");
  }

  return parsed;
}

function requireAddress(name) {
  const value = process.env[name];
  if (!ethers.isAddress(value) || value === ZERO_ADDRESS) {
    throw new Error(`${name} must be a non-zero address`);
  }
  return value;
}

function loadBytecode() {
  if (process.env.FLATBOOK_BYTECODE?.startsWith("0x")) {
    return process.env.FLATBOOK_BYTECODE;
  }

  const artifactPath = path.join(
    __dirname,
    "..",
    "out",
    "FlatBookVaultV2.sol",
    "FlatBookVaultV2.json",
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
  if (!bytecode || bytecode === "0x") {
    throw new Error("FlatBookVaultV2 bytecode missing. Run `forge build` first.");
  }
  return bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`;
}

async function main() {
  const { dryRun, rpcUrl } = parseArgs();
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const args = [
    requireAddress("FLATBOOK_ASSET_ADDRESS"),
    requireAddress("FLATBOOK_USER_ASSET_ADDRESS"),
    requireAddress("FLATBOOK_COLLATERAL_ONRAMP_ADDRESS"),
    requireAddress("FLATBOOK_COLLATERAL_OFFRAMP_ADDRESS"),
    requireAddress("FLATBOOK_ADMIN_ADDRESS"),
    requireAddress("FLATBOOK_BOOK_RUNNER_ADDRESS"),
    requireAddress("FLATBOOK_NAV_UPDATER_ADDRESS"),
    requireAddress("FLATBOOK_TRADING_WALLET_ADDRESS"),
    BigInt(process.env.FLATBOOK_NAV_STALENESS_THRESHOLD),
  ];

  const factory = new ethers.ContractFactory(FLATBOOK_ABI, loadBytecode(), wallet);
  const deployTx = await factory.getDeployTransaction(...args);
  const estimatedGas = await provider.estimateGas(deployTx);
  const nonce = await provider.getTransactionCount(wallet.address);

  console.log("FlatBookVaultV2 deployment");
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Estimated gas: ${estimatedGas.toString()}`);
  console.log(`Constructor args: ${JSON.stringify(args.map((arg) => arg.toString()), null, 2)}`);

  if (dryRun) {
    console.log(`Dry run only. Would deploy to ${ethers.getCreateAddress({ from: wallet.address, nonce })}`);
    return;
  }

  const contract = await factory.deploy(...args, { gasLimit: (estimatedGas * 120n) / 100n });
  console.log(`Deployment tx: ${contract.deploymentTransaction().hash}`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`FlatBookVaultV2 deployed at: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
