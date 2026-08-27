/**
 * Governance Encoding Helpers for Adapter Rotation Operations
 *
 * This module provides reusable functions for encoding governance operations
 * on the Morpho Vault V2 system. It correctly handles adapterId derivation
 * and preimage computation to avoid the ZeroAbsoluteCap error.
 *
 * Features:
 *   - Automatic retry logic for transient RPC errors (3 attempts, 2s delay)
 *   - Idempotent state checking before all operations
 *   - Step markers for interruption recovery
 *
 * Usage:
 *   const { deriveAdapterId, encodeAddAdapter, withRetry } = require('./lib/rotationHelpers');
 *   const adapterId = deriveAdapterId(adapterAddress);
 *   const addAdapterData = encodeAddAdapter(adapterAddress);
 */

const ethers = require("ethers");

// ============================================================================
// Constants
// ============================================================================

const ADAPTER_TYPE_STRING = "PolymarketAdapter";
const RELATIVE_CAP_WAD = 10n ** 18n;
const RELATIVE_CAP_BPS_DENOMINATOR = 10000n;
const BPS_TO_WAD_FACTOR = RELATIVE_CAP_WAD / RELATIVE_CAP_BPS_DENOMINATOR;

// Vault V2 function selectors (computed from function signatures)
const VAULT_FUNCTIONS = {
  // function addAdapter(address adapter) external
  addAdapter: "addAdapter(address)",

  // function removeAdapter(address account) external
  removeAdapter: "removeAdapter(address)",

  // function increaseAbsoluteCap(bytes memory id, uint256 cap) external
  increaseAbsoluteCap: "increaseAbsoluteCap(bytes,uint256)",

  // function increaseRelativeCap(bytes memory id, uint256 cap) external
  increaseRelativeCap: "increaseRelativeCap(bytes,uint256)",
};

// ============================================================================
// Adapter ID Derivation
// ============================================================================

/**
 * Derives the adapterId exactly as the PolymarketAdapter contract does.
 *
 * The adapterId is computed as:
 *   keccak256(abi.encode("PolymarketAdapter", adapterAddress))
 *
 * This is set in the adapter constructor and returned by the ids() function.
 *
 * @param {string} adapterAddress - The adapter contract address (hex string)
 * @returns {string} The adapterId as a hex string (bytes32)
 *
 * @example
 * const adapterId = deriveAdapterId("0x4CC11626A7E96DF5033d24Bd4D1C608749b68730");
 * // Returns: "0xf946c594f2b2ce335803cb20f66ed7f33aa2a16d058e10de24c5b20931ec2218"
 */
function deriveAdapterId(adapterAddress) {
  if (!adapterAddress || !ethers.isAddress(adapterAddress)) {
    throw new Error(`Invalid adapter address: ${adapterAddress}`);
  }

  // Normalize to checksummed address
  const normalizedAddress = ethers.getAddress(adapterAddress);

  // Compute preimage: abi.encode("PolymarketAdapter", address)
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const preimage = abiCoder.encode(["string", "address"], [ADAPTER_TYPE_STRING, normalizedAddress]);

  // Compute adapterId: keccak256(preimage)
  const adapterId = ethers.keccak256(preimage);

  return adapterId;
}

/**
 * Gets the cap preimage for use with increaseAbsoluteCap/increaseRelativeCap.
 *
 * The preimage is the raw ABI-encoded data that, when hashed, produces the adapterId.
 * The vault uses this preimage to look up caps at keccak256(preimage).
 *
 * Returns both the preimage and the derived adapterId for verification.
 *
 * @param {string} adapterAddress - The adapter contract address (hex string)
 * @returns {Object} Object containing { preimage, adapterId }
 *   - preimage: The raw ABI-encoded bytes (hex string)
 *   - adapterId: The keccak256 hash of the preimage (bytes32 hex string)
 *
 * @example
 * const { preimage, adapterId } = getCapPreimage("0x4CC11626A7E96DF5033d24Bd4D1C608749b68730");
 * // preimage: "0x00000000000000000000000000000000000000000000000000000000000000400000000000000000000000004cc11626a7e96df5033d24bd4d1c608749b687300000000000000000000000000000000000000000000000000000000000000011506f6c796d61726b657441646170746572000000000000000000000000000000"
 * // adapterId: "0xf946c594f2b2ce335803cb20f66ed7f33aa2a16d058e10de24c5b20931ec2218"
 */
function getCapPreimage(adapterAddress) {
  if (!adapterAddress || !ethers.isAddress(adapterAddress)) {
    throw new Error(`Invalid adapter address: ${adapterAddress}`);
  }

  // Normalize to checksummed address
  const normalizedAddress = ethers.getAddress(adapterAddress);

  // Compute preimage: abi.encode("PolymarketAdapter", address)
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const preimage = abiCoder.encode(["string", "address"], [ADAPTER_TYPE_STRING, normalizedAddress]);

  // Compute adapterId: keccak256(preimage)
  const adapterId = ethers.keccak256(preimage);

  return {
    preimage,
    adapterId,
  };
}

// ============================================================================
// Governance Encoding Functions
// ============================================================================

/**
 * Encodes the addAdapter function call for the vault.
 *
 * This function registers a new adapter with the vault. Must be called
 * via submit() if timelock > 0, or directly if timelock = 0.
 *
 * @param {string} adapterAddress - The adapter contract address to add
 * @returns {string} The encoded function call data (hex string)
 *
 * @example
 * const data = encodeAddAdapter("0x4CC11626A7E96DF5033d24Bd4D1C608749b68730");
 * // Submit to vault: vault.submit(data) then vault.addAdapter(adapterAddress)
 */
function encodeAddAdapter(adapterAddress) {
  if (!adapterAddress || !ethers.isAddress(adapterAddress)) {
    throw new Error(`Invalid adapter address: ${adapterAddress}`);
  }

  const normalizedAddress = ethers.getAddress(adapterAddress);

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const data = abiCoder.encode(["string", "address"], ["addAdapter(address)", normalizedAddress]);

  // Actually, we need the function selector + encoded parameters
  // Let me use the proper encoding
  const iface = new ethers.Interface(["function addAdapter(address adapter) external"]);

  return iface.encodeFunctionData("addAdapter", [normalizedAddress]);
}

/**
 * Encodes the removeAdapter function call for the vault.
 *
 * This function unregisters an adapter from the vault. The adapter must
 * have zero allocation before it can be removed.
 *
 * @param {string} adapterAddress - The adapter contract address to remove
 * @returns {string} The encoded function call data (hex string)
 *
 * @example
 * const data = encodeRemoveAdapter("0xD59CfD8D1BE7f44Bd83DC1896e5BD64e12E409b5");
 * // Submit to vault: vault.submit(data) then vault.removeAdapter(adapterAddress)
 */
function encodeRemoveAdapter(adapterAddress) {
  if (!adapterAddress || !ethers.isAddress(adapterAddress)) {
    throw new Error(`Invalid adapter address: ${adapterAddress}`);
  }

  const normalizedAddress = ethers.getAddress(adapterAddress);

  const iface = new ethers.Interface(["function removeAdapter(address account) external"]);

  return iface.encodeFunctionData("removeAdapter", [normalizedAddress]);
}

/**
 * Encodes the increaseAbsoluteCap function call for the vault.
 *
 * Sets the maximum absolute value (in asset units) that can be allocated
 * to the adapter. Use type(uint256).max for unlimited.
 *
 * IMPORTANT: The id parameter must be the PREIMAGE of adapterId, not the
 * adapterId itself. This function handles that automatically.
 *
 * @param {string} adapterAddress - The adapter contract address
 * @param {string|bigint} capValue - The cap value (as string or bigint)
 * @returns {Object} Object containing { data, preimage, adapterId, capValue }
 *   - data: The encoded function call data
 *   - preimage: The preimage used for the id parameter
 *   - adapterId: The derived adapterId for verification
 *   - capValue: The normalized cap value as bigint
 *
 * @example
 * // Set unlimited cap
 * const { data, preimage } = encodeIncreaseAbsoluteCap(adapterAddress, ethers.MaxUint256);
 *
 * // Set 1M USDC cap (USDC has 6 decimals)
 * const { data } = encodeIncreaseAbsoluteCap(adapterAddress, 1000000_000000);
 */
function encodeIncreaseAbsoluteCap(adapterAddress, capValue) {
  if (!adapterAddress || !ethers.isAddress(adapterAddress)) {
    throw new Error(`Invalid adapter address: ${adapterAddress}`);
  }

  const normalizedAddress = ethers.getAddress(adapterAddress);

  // Get the preimage for cap operations
  const { preimage, adapterId } = getCapPreimage(normalizedAddress);

  // Normalize cap value
  const normalizedCap =
    typeof capValue === "string" && capValue.startsWith("0x") ? BigInt(capValue) : BigInt(capValue);

  const iface = new ethers.Interface([
    "function increaseAbsoluteCap(bytes memory id, uint256 cap) external",
  ]);

  const data = iface.encodeFunctionData("increaseAbsoluteCap", [
    preimage, // NOTE: This is the preimage, not the adapterId!
    normalizedCap,
  ]);

  return {
    data,
    preimage,
    adapterId,
    capValue: normalizedCap,
  };
}

function normalizeRelativeCapToWad(capValue) {
  const rawCap = BigInt(capValue);

  if (rawCap < 0n) {
    throw new Error("Relative cap cannot be negative");
  }

  if (rawCap <= RELATIVE_CAP_BPS_DENOMINATOR) {
    return rawCap * BPS_TO_WAD_FACTOR;
  }

  if (rawCap <= RELATIVE_CAP_WAD) {
    return rawCap;
  }

  throw new Error(`Relative cap must be <= ${RELATIVE_CAP_WAD.toString()} (WAD)`);
}

/**
 * Encodes the increaseRelativeCap function call for the vault.
 *
 * Sets the maximum percentage of vault assets that can be allocated
 * to the adapter. Vault V2 expects WAD units (100% = 1e18).
 * Legacy bps inputs (100% = 10000) are auto-converted to WAD.
 *
 * IMPORTANT: The id parameter must be the PREIMAGE of adapterId, not the
 * adapterId itself. This function handles that automatically.
 *
 * @param {string} adapterAddress - The adapter contract address
 * @param {string|number|bigint} capValue - The cap value in WAD or bps
 * @returns {Object} Object containing { data, preimage, adapterId, capValue }
 *   - data: The encoded function call data
 *   - preimage: The preimage used for the id parameter
 *   - adapterId: The derived adapterId for verification
 *   - capValue: The normalized cap value as bigint
 *
 * @example
 * // Set 100% cap via bps shorthand (10000 -> 1e18)
 * const { data, preimage } = encodeIncreaseRelativeCap(adapterAddress, 10000);
 *
 * // Set 50% cap via bps shorthand (5000 -> 5e17)
 * const { data } = encodeIncreaseRelativeCap(adapterAddress, 5000);
 */
function encodeIncreaseRelativeCap(adapterAddress, capValue) {
  if (!adapterAddress || !ethers.isAddress(adapterAddress)) {
    throw new Error(`Invalid adapter address: ${adapterAddress}`);
  }

  const normalizedAddress = ethers.getAddress(adapterAddress);

  // Get the preimage for cap operations
  const { preimage, adapterId } = getCapPreimage(normalizedAddress);

  const normalizedCap = normalizeRelativeCapToWad(capValue);

  const iface = new ethers.Interface([
    "function increaseRelativeCap(bytes memory id, uint256 cap) external",
  ]);

  const data = iface.encodeFunctionData("increaseRelativeCap", [
    preimage, // NOTE: This is the preimage, not the adapterId!
    normalizedCap,
  ]);

  return {
    data,
    preimage,
    adapterId,
    capValue: normalizedCap,
  };
}

// ============================================================================
// Batch Encoding
// ============================================================================

/**
 * Encodes a complete adapter setup: addAdapter + increaseAbsoluteCap + increaseRelativeCap.
 *
 * This is a convenience function for Phase 1 of adapter rotation.
 * All three operations must still be submitted and executed separately via timelock.
 *
 * @param {string} adapterAddress - The adapter contract address
 * @param {string|bigint} absoluteCap - The absolute cap value (default: type(uint256).max)
 * @param {string|number|bigint} relativeCap - The relative cap in WAD or bps
 * @returns {Object} Object containing all encoded operations and metadata
 *
 * @example
 * const setup = encodeAdapterSetup(newAdapterAddress);
 * // Submit each operation:
 * await vault.submit(setup.addAdapter.data);
 * await vault.submit(setup.absoluteCap.data);
 * await vault.submit(setup.relativeCap.data);
 */
function encodeAdapterSetup(
  adapterAddress,
  absoluteCap = ethers.MaxUint256.toString(),
  relativeCap = RELATIVE_CAP_WAD,
) {
  const normalizedAddress = ethers.getAddress(adapterAddress);

  return {
    adapterAddress: normalizedAddress,
    adapterId: deriveAdapterId(normalizedAddress),
    addAdapter: {
      function: "addAdapter(address)",
      data: encodeAddAdapter(normalizedAddress),
    },
    absoluteCap: {
      function: "increaseAbsoluteCap(bytes,uint256)",
      ...encodeIncreaseAbsoluteCap(normalizedAddress, absoluteCap),
    },
    relativeCap: {
      function: "increaseRelativeCap(bytes,uint256)",
      ...encodeIncreaseRelativeCap(normalizedAddress, relativeCap),
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Verifies that a computed adapterId matches the on-chain value.
 * This is useful for sanity checking before submitting transactions.
 *
 * @param {string} adapterAddress - The adapter contract address
 * @param {string} expectedAdapterId - The expected adapterId (optional, for comparison)
 * @returns {Object} Verification result
 */
function verifyAdapterId(adapterAddress, expectedAdapterId = null) {
  const computedId = deriveAdapterId(adapterAddress);
  const { preimage } = getCapPreimage(adapterAddress);

  const result = {
    adapterAddress: ethers.getAddress(adapterAddress),
    computedAdapterId: computedId,
    preimage: preimage,
    matches: expectedAdapterId
      ? computedId.toLowerCase() === expectedAdapterId.toLowerCase()
      : null,
  };

  if (expectedAdapterId) {
    result.expectedAdapterId = expectedAdapterId;
  }

  return result;
}
// ============================================================================
// Retry Utility
// ============================================================================

const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  delayMs: 2000,
};

/**
 * Execute an async function with retry logic for transient RPC errors
 * @param {Function} fn - Async function to execute
 * @param {string} operationName - Name of the operation for logging
 * @param {number} maxAttempts - Maximum retry attempts (default: 3)
 * @param {number} delayMs - Delay between retries in ms (default: 2000)
 * @returns {Promise<any>} Result of the function
 */
async function withRetry(
  fn,
  operationName,
  maxAttempts = DEFAULT_RETRY_CONFIG.maxAttempts,
  delayMs = DEFAULT_RETRY_CONFIG.delayMs,
) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it's a transient RPC error
      const isTransientError =
        error.code === "NETWORK_ERROR" ||
        error.code === "TIMEOUT" ||
        error.code === "SERVER_ERROR" ||
        (error.message &&
          (error.message.includes("timeout") ||
            error.message.includes("disconnected") ||
            error.message.includes("rate limit") ||
            error.message.includes("internal error") ||
            error.message.includes("connection reset") ||
            error.message.includes("ECONNRESET") ||
            error.message.includes("ETIMEDOUT")));

      if (!isTransientError || attempt === maxAttempts) {
        throw error;
      }

      console.log(
        `   ⚠️ ${operationName} failed (attempt ${attempt}/${maxAttempts}): ${error.message}`,
      );
      console.log(`   Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Adapter ID derivation
  deriveAdapterId,
  getCapPreimage,
  verifyAdapterId,

  // Governance encoding
  encodeAddAdapter,
  encodeRemoveAdapter,
  encodeIncreaseAbsoluteCap,
  encodeIncreaseRelativeCap,

  // Batch operations
  encodeAdapterSetup,

  // Retry utility
  withRetry,
  DEFAULT_RETRY_CONFIG,

  // Constants
  ADAPTER_TYPE_STRING,
  VAULT_FUNCTIONS,
};

// ============================================================================
// Preflight Safety Checks
// ============================================================================

const VAULT_PREFLIGHT_ABI = [
  "function curator() external view returns (address)",
  "function owner() external view returns (address)",
  "function allocation(bytes32 id) external view returns (uint256)",
  "function isAdapter(address adapter) external view returns (bool)",
  "function adapters() external view returns (address[] memory)",
  "function executableAt(bytes calldata data) external view returns (uint256)",
  "function submit(bytes calldata data) external",
  "function addAdapter(address adapter) external",
  "function removeAdapter(address account) external",
  "function timelock(bytes4 selector) external view returns (uint256)",
  "function absoluteCap(bytes32 id) external view returns (uint256)",
  "function relativeCap(bytes32 id) external view returns (uint256)",
  "function increaseAbsoluteCap(bytes memory id, uint256 cap) external",
  "function increaseRelativeCap(bytes memory id, uint256 cap) external",
  "event AddAdapter(address indexed adapter)",
  "event RemoveAdapter(address indexed adapter)",
];

const ADAPTER_PREFLIGHT_ABI = [
  "function asset() external view returns (address)",
  "function safe() external view returns (address)",
  "function totalPositionCostBasis() external view returns (uint256)",
  "function totalDeployed() external view returns (uint256)",
];

const ERC20_BALANCE_ABI = ["function balanceOf(address account) external view returns (uint256)"];

/**
 * Check if address is valid Ethereum address (0x + 40 hex chars)
 * @param {string} addr - Address to validate
 * @returns {boolean}
 */
function isValidAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  if (!addr.startsWith("0x")) return false;
  if (addr.length !== 42) return false;
  const hexPart = addr.slice(2);
  return /^[0-9a-fA-F]{40}$/.test(hexPart);
}

/**
 * Validates all addresses and returns any invalid ones
 * @param {Object} addresses - Object with name -> address mapping
 * @returns {Array<{name: string, address: string, reason: string}>} Invalid entries
 */
function validateAddresses(addresses) {
  const invalid = [];

  for (const [name, address] of Object.entries(addresses)) {
    if (!address) {
      invalid.push({ name, address: address || "undefined", reason: "Address is empty" });
    } else if (!isValidAddress(address)) {
      invalid.push({
        name,
        address,
        reason: `Invalid format (expected 0x + 40 hex chars, got ${address.length} chars)`,
      });
    }
  }

  return invalid;
}

/**
 * Check wallet has sufficient MATIC for gas
 * @param {ethers.Provider} provider
 * @param {string} walletAddress
 * @param {ethers.BigNumberish} minBalance - Minimum balance in wei (default: 0.1 MATIC)
 * @returns {Promise<{sufficient: boolean, balance: bigint, required: bigint}>}
 */
async function checkGasBalance(provider, walletAddress, minBalance = null) {
  const required = minBalance || ethers.parseEther("0.1");
  const balance = await provider.getBalance(walletAddress);

  return {
    sufficient: balance >= required,
    balance,
    required,
    balanceFormatted: ethers.formatEther(balance),
    requiredFormatted: ethers.formatEther(required),
  };
}

/**
 * Check if contract has code at address
 * @param {ethers.Provider} provider
 * @param {string} address
 * @returns {Promise<{hasCode: boolean, codeSize: number}>}
 */
async function checkContractCode(provider, address) {
  const code = await provider.getCode(address);
  return {
    hasCode: code !== "0x",
    codeSize: (code.length - 2) / 2, // Subtract "0x" prefix, divide by 2 for bytes
  };
}

/**
 * Check if caller is curator (or owner, which typically has all permissions)
 * @param {ethers.Contract} vault
 * @param {string} callerAddress
 * @returns {Promise<{isCurator: boolean, isOwner: boolean, curatorAddress: string, ownerAddress: string}>}
 */
async function checkCuratorPermission(vault, callerAddress) {
  const curator = await vault.curator();
  const owner = await vault.owner();

  const normalizedCaller = callerAddress.toLowerCase();

  return {
    isCurator: curator.toLowerCase() === normalizedCaller,
    isOwner: owner.toLowerCase() === normalizedCaller,
    curatorAddress: curator,
    ownerAddress: owner,
  };
}

/**
 * Get current allocation for an adapter
 * @param {ethers.Contract} vault
 * @param {string} adapterAddress
 * @returns {Promise<{allocation: bigint, formatted: string, adapterId: string, preimage: string}>}
 */
async function getAdapterAllocation(vault, adapterAddress) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const preimage = abiCoder.encode(["string", "address"], [ADAPTER_TYPE_STRING, adapterAddress]);
  const adapterId = ethers.keccak256(preimage);

  const allocation = await vault.allocation(adapterId);

  return {
    allocation,
    adapterId,
    preimage,
    formatted: ethers.formatUnits(allocation, 6), // USDC has 6 decimals
  };
}

/**
 * Get total deployed amount from adapter
 * @param {ethers.Contract} adapter
 * @returns {Promise<{deployed: bigint, formatted: string}>}
 */
async function getTotalDeployed(adapter) {
  const deployed = await adapter.totalDeployed();
  return {
    deployed,
    formatted: ethers.formatUnits(deployed, 6), // USDC has 6 decimals
  };
}

async function getAdapterLiveExposure(provider, adapterAddress) {
  const adapter = new ethers.Contract(adapterAddress, ADAPTER_PREFLIGHT_ABI, provider);
  const [assetAddress, safeAddress, totalPositionCostBasis, totalDeployed] = await Promise.all([
    adapter.asset(),
    adapter.safe(),
    adapter.totalPositionCostBasis(),
    adapter.totalDeployed(),
  ]);

  const asset = new ethers.Contract(assetAddress, ERC20_BALANCE_ABI, provider);
  const [safeBalance, adapterBalance] = await Promise.all([
    asset.balanceOf(safeAddress),
    asset.balanceOf(adapterAddress),
  ]);

  const liveExposure = safeBalance + adapterBalance + totalPositionCostBasis;

  return {
    safeBalance,
    adapterBalance,
    totalPositionCostBasis,
    totalDeployed,
    liveExposure,
    safeBalanceFormatted: ethers.formatUnits(safeBalance, 6),
    adapterBalanceFormatted: ethers.formatUnits(adapterBalance, 6),
    totalPositionCostBasisFormatted: ethers.formatUnits(totalPositionCostBasis, 6),
    totalDeployedFormatted: ethers.formatUnits(totalDeployed, 6),
    liveExposureFormatted: ethers.formatUnits(liveExposure, 6),
  };
}

/**
 * Check if phase1 is complete (new adapter registered)
 * @param {ethers.Contract} vault
 * @param {string} newAdapterAddress
 * @returns {Promise<{complete: boolean, isAdapter: boolean}>}
 */
async function checkPhase1Complete(vault, newAdapterAddress) {
  const isAdapter = await vault.isAdapter(newAdapterAddress);

  return {
    complete: isAdapter,
    isAdapter,
  };
}

/**
 * Check phase2 prerequisites
 * @param {ethers.Contract} vault
 * @param {string} oldAdapterAddress
 * @param {boolean} confirmRemoveOld - Whether --confirm-remove-old flag was passed
 * @returns {Promise<{canProceed: boolean, reasons: string[], allocation: bigint, allocationFormatted: string}>}
 */
async function checkPhase2Prerequisites(vault, oldAdapterAddress, confirmRemoveOld) {
  const reasons = [];
  const warnings = [];

  // Check 1: Must have explicit confirm flag
  if (!confirmRemoveOld) {
    reasons.push("Phase2 requires --confirm-remove-old flag (DESTRUCTIVE OPERATION)");
  }

  // Check 2: Old adapter allocation must be 0
  const { allocation, formatted } = await getAdapterAllocation(vault, oldAdapterAddress);
  let deployed = null;
  let deployedFormatted = null;
  let liveExposure = null;
  let liveExposureFormatted = null;
  let safeBalance = null;
  let adapterBalance = null;
  let totalPositionCostBasis = null;
  let staleAllocationBypass = false;

  if (allocation > 0n) {
    try {
      const exposure = await getAdapterLiveExposure(vault.runner, oldAdapterAddress);
      deployed = exposure.totalDeployed;
      deployedFormatted = exposure.totalDeployedFormatted;
      liveExposure = exposure.liveExposure;
      liveExposureFormatted = exposure.liveExposureFormatted;
      safeBalance = exposure.safeBalance;
      adapterBalance = exposure.adapterBalance;
      totalPositionCostBasis = exposure.totalPositionCostBasis;

      if (liveExposure === 0n) {
        staleAllocationBypass = true;
        warnings.push(
          `Old adapter allocation is ${formatted} USDC but live exposure is 0; treating as stale legacy accounting and allowing phase2`,
        );
      }
    } catch (error) {
      warnings.push(
        `Could not read old adapter exposure for stale-allocation check: ${error.message}`,
      );
    }

    if (!staleAllocationBypass) {
      reasons.push(`Old adapter allocation is ${formatted} USDC (must be 0)`);
    }
  }

  return {
    canProceed: reasons.length === 0,
    reasons,
    warnings,
    allocation,
    allocationFormatted: formatted,
    deployed,
    deployedFormatted,
    liveExposure,
    liveExposureFormatted,
    safeBalance,
    adapterBalance,
    totalPositionCostBasis,
    staleAllocationBypass,
  };
}

/**
 * Run complete preflight check
 * @param {Object} params
 * @param {ethers.Provider} params.provider
 * @param {ethers.Wallet} params.wallet
 * @param {string} params.vaultAddress
 * @param {string} params.oldAdapterAddress
 * @param {string} params.newAdapterAddress
 * @param {boolean} params.confirmRemoveOld
 * @param {string} params.phase - "phase1" | "phase2" | "status"
 * @returns {Promise<{success: boolean, errors: string[], warnings: string[], data: Object}>}
 */
async function runPreflight(params) {
  const {
    provider,
    wallet,
    vaultAddress,
    oldAdapterAddress,
    newAdapterAddress,
    confirmRemoveOld,
    phase,
  } = params;
  const errors = [];
  const warnings = [];
  const data = {};

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║           PREFLIGHT SAFETY CHECKS                            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 1. Address validation
  console.log("1. Validating addresses...");
  const addressesToValidate = {
    vault: vaultAddress,
    oldAdapter: oldAdapterAddress,
    newAdapter: newAdapterAddress,
  };

  const invalidAddresses = validateAddresses(addressesToValidate);
  if (invalidAddresses.length > 0) {
    for (const invalid of invalidAddresses) {
      errors.push(`Invalid address: ${invalid.name} = ${invalid.address} (${invalid.reason})`);
    }
  } else {
    console.log("   ✓ All addresses valid");
  }

  // 2. Gas balance check
  console.log("2. Checking gas balance...");
  const gasCheck = await checkGasBalance(provider, wallet.address);
  data.gasBalance = gasCheck;

  if (!gasCheck.sufficient) {
    errors.push(
      `Insufficient MATIC: ${gasCheck.balanceFormatted} < ${gasCheck.requiredFormatted} required`,
    );
  } else {
    console.log(`   ✓ Gas balance: ${gasCheck.balanceFormatted} MATIC`);
  }

  // 3. Contract code presence
  console.log("3. Checking adapter contract code...");
  const [oldAdapterCode, newAdapterCode] = await Promise.all([
    checkContractCode(provider, oldAdapterAddress),
    checkContractCode(provider, newAdapterAddress),
  ]);

  data.oldAdapterCode = oldAdapterCode;
  data.newAdapterCode = newAdapterCode;

  if (!newAdapterCode.hasCode) {
    errors.push(`New adapter at ${newAdapterAddress} has no code (not a contract)`);
  } else {
    console.log(`   ✓ New adapter code: ${newAdapterCode.codeSize} bytes`);
  }

  if (!oldAdapterCode.hasCode) {
    warnings.push(`Old adapter at ${oldAdapterAddress} has no code (may already be removed)`);
  } else {
    console.log(`   ✓ Old adapter code: ${oldAdapterCode.codeSize} bytes`);
  }

  // 4. Curator permission check
  console.log("4. Checking curator permissions...");
  const vault = new ethers.Contract(vaultAddress, VAULT_PREFLIGHT_ABI, provider);
  const permCheck = await checkCuratorPermission(vault, wallet.address);
  data.permissions = permCheck;

  if (!permCheck.isCurator && !permCheck.isOwner) {
    errors.push(
      `Not authorized: ${wallet.address} is neither curator (${permCheck.curatorAddress}) nor owner (${permCheck.ownerAddress})`,
    );
  } else {
    const role = permCheck.isOwner ? "owner" : "curator";
    console.log(`   ✓ Wallet is ${role}`);
  }

  // 5. Phase-specific checks
  if (phase === "phase1") {
    console.log("5. Checking phase1 prerequisites...");
    const phase1Check = await checkPhase1Complete(vault, newAdapterAddress);
    data.phase1 = phase1Check;

    if (phase1Check.isAdapter) {
      console.log("   ✓ New adapter already registered (idempotent)");
    } else {
      console.log("   ℹ New adapter not yet registered (will add)");
    }
  } else if (phase === "phase2") {
    console.log("5. Checking phase2 prerequisites...");
    const phase2Check = await checkPhase2Prerequisites(vault, oldAdapterAddress, confirmRemoveOld);
    data.phase2 = phase2Check;

    if (!phase2Check.canProceed) {
      for (const reason of phase2Check.reasons) {
        errors.push(reason);
      }
    } else {
      console.log("   ✓ Phase2 prerequisites met");
      console.log(`   ✓ Old adapter allocation: ${phase2Check.allocationFormatted} USDC`);
      if (phase2Check.staleAllocationBypass) {
        console.log(
          `   ⚠ Old adapter live exposure is ${phase2Check.liveExposureFormatted} USDC; bypassing stale allocation gate`,
        );
      }
    }

    for (const warning of phase2Check.warnings) {
      warnings.push(warning);
    }

    // Check phase1 is complete before allowing phase2
    const phase1Check = await checkPhase1Complete(vault, newAdapterAddress);
    if (!phase1Check.complete) {
      errors.push("Phase1 not complete: new adapter must be registered before phase2");
    } else {
      console.log("   ✓ Phase1 complete (new adapter registered)");
    }
  }

  // Print summary
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  if (errors.length === 0) {
    console.log("║  PREFLIGHT: ✅ ALL CHECKS PASSED                             ║");
  } else {
    console.log("║  PREFLIGHT: ❌ CHECKS FAILED                                 ║");
  }
  console.log("╚══════════════════════════════════════════════════════════════╝");

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const error of errors) {
      console.log(`  ❌ ${error}`);
    }
  }

  console.log("");

  return {
    success: errors.length === 0,
    errors,
    warnings,
    data,
    vault, // Return vault contract for reuse
  };
}

/**
 * Print planned transactions in dry-run mode
 * @param {string} phase
 * @param {Object} params
 * @param {ethers.Contract} vault
 */
async function printPlannedTransactions(phase, params, vault, capValues = {}) {
  const { vaultAddress, newAdapterAddress, oldAdapterAddress } = params;
  const { absoluteCap, relativeCap } = capValues;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  DRY-RUN MODE: Planned Transactions                          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (phase === "phase1") {
    console.log("Phase 1: Add New Adapter + Set Caps");
    console.log("────────────────────────────────────");
    console.log(`Target:     ${vaultAddress} (Vault)`);
    console.log(`Adapter:    ${newAdapterAddress}`);
    console.log(`\nStep 1: addAdapter`);
    console.log(`  Action:     submit(bytes) + addAdapter(address)`);
    console.log(`  Parameter:  ${newAdapterAddress}`);

    // Get preimage for display
    const { preimage, adapterId } = getCapPreimage(newAdapterAddress);
    console.log(`\nPreimage derivation (for caps):`);
    console.log(`  Preimage:   ${preimage.slice(0, 50)}...${preimage.slice(-20)}`);
    console.log(`  AdapterId:  ${adapterId}`);

    console.log(`\nStep 2: increaseAbsoluteCap`);
    console.log(`  Action:     submit(bytes) + increaseAbsoluteCap(bytes,uint256)`);
    if (absoluteCap !== undefined) {
      const capDisplay =
        absoluteCap === ethers.MaxUint256 ? "unlimited (max uint256)" : absoluteCap.toString();
      console.log(`  Cap value:  ${capDisplay}`);
    }
    console.log(`  Note:       Uses preimage (NOT adapterId) as id parameter`);

    console.log(`\nStep 3: increaseRelativeCap`);
    console.log(`  Action:     submit(bytes) + increaseRelativeCap(bytes,uint256)`);
    if (relativeCap !== undefined) {
      console.log(
        `  Cap value:  ${relativeCap.toString()} bps (${(Number(relativeCap) / 100).toFixed(0)}%)`,
      );
    }
    console.log(`  Note:       Uses preimage (NOT adapterId) as id parameter`);

    console.log(`\nPost-execution verification:`);
    console.log(`  - Check isAdapter(${newAdapterAddress}) returns true`);
    console.log(`  - Check absoluteCap(adapterId) returns non-zero`);
    console.log(`  - Check relativeCap(adapterId) returns non-zero`);
  } else if (phase === "phase2") {
    console.log("Phase 2: Remove Old Adapter (DESTRUCTIVE)");
    console.log("──────────────────────────────────────────");
    console.log(`⚠️  WARNING: This will remove ${oldAdapterAddress} from the vault`);
    console.log(`\nTarget:     ${vaultAddress} (Vault)`);
    console.log(`Action:     submit(bytes) + removeAdapter(address)`);
    console.log(`Parameter:  ${oldAdapterAddress}`);
    console.log(`\nPrerequisites verified:`);

    const phase2Check = await checkPhase2Prerequisites(vault, oldAdapterAddress, true);
    console.log(`  ✓ Old adapter allocation: ${phase2Check.allocationFormatted} USDC`);
    if (phase2Check.staleAllocationBypass) {
      console.log(
        `  ⚠ Bypass active: live exposure is ${phase2Check.liveExposureFormatted} USDC (legacy stale allocation)`,
      );
    }
    console.log(`  ✓ --confirm-remove-old flag: present`);

    console.log(`\nSteps:`);
    console.log(`  1. Encode removeAdapter(${oldAdapterAddress})`);
    console.log(`  2. Call vault.submit(encodedData)`);
    console.log(`  3. If timelock=0, call vault.removeAdapter(${oldAdapterAddress})`);
    console.log(`\nExpected outcome:`);
    console.log(`  - Old adapter removed from vault.adapters()`);
    console.log(`  - No more allocations possible to old adapter`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════\n");
  console.log("Dry-run complete. No transactions were sent.");
  console.log("Remove --dry-run flag to execute.\n");
}

// ============================================================================
// Cap State Machine Functions
// ============================================================================

/**
 * State machine for idempotent absolute cap handling
 * Handles all states: not submitted / submitted not executable / executable / already set
 *
 * @param {ethers.Contract} vaultWithSigner - Vault contract with signer
 * @param {ethers.Contract} vault - Vault contract read-only
 * @param {string} adapterAddress - Adapter address
 * @param {bigint} capValue - Absolute cap value (default: MaxUint256)
 * @param {boolean} useJson - JSON output mode
 * @returns {Promise<Object>} Result object with state and actions
 */
async function handleAbsoluteCapStateMachine(
  vaultWithSigner,
  vault,
  adapterAddress,
  capValue = ethers.MaxUint256,
  useJson = false,
) {
  const result = {
    success: false,
    step: null,
    actions: [],
    adapter: adapterAddress,
    capType: "absolute",
    timestamp: new Date().toISOString(),
  };

  // Get preimage and adapterId
  const { preimage, adapterId } = getCapPreimage(adapterAddress);
  result.preimage = preimage;
  result.adapterId = adapterId;
  result.capValue = capValue.toString();

  // STATE 1: Check if already set
  result.step = "check_absoluteCap";
  const currentCap = await vault.absoluteCap(adapterId);
  result.currentCap = currentCap.toString();

  if (currentCap > 0n) {
    result.success = true;
    result.state = "ALREADY_SET";
    result.message = "Absolute cap already set.";
    if (!useJson) {
      console.log("✅ State: ABSOLUTE_CAP_ALREADY_SET");
      console.log(`   Current cap: ${currentCap.toString()}`);
    }
    return result;
  }

  if (!useJson) {
    console.log("ℹ State: ABSOLUTE_CAP_NOT_SET");
    console.log("   Absolute cap needs to be set.");
  }

  // Encode the cap data
  const { data: capData } = encodeIncreaseAbsoluteCap(adapterAddress, capValue);
  result.encodedData = capData;

  // STATE 2: Check timelock submission status
  result.step = "check_executableAt";
  const executableAt = await vault.executableAt(capData);
  const now = Math.floor(Date.now() / 1000);
  result.executableAt = executableAt.toString();
  result.currentTime = now;

  // STATE 2a: Not yet submitted
  if (executableAt === 0n) {
    result.state = "NOT_SUBMITTED";
    if (!useJson) {
      console.log("\nℹ State: ABSOLUTE_CAP_NOT_SUBMITTED");
      console.log("   Action: Calling vault.submit(capData)...");
    }

    result.step = "submit";
    const tx = await vaultWithSigner.submit(capData, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
    });
    result.actions.push({ type: "submit_absolute_cap", hash: tx.hash });

    if (!useJson) {
      console.log("   Tx hash:", tx.hash);
      console.log("   Waiting for confirmation...");
    }

    const receipt = await tx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
    };

    if (!useJson) {
      console.log("   ✅ Submitted absolute cap to timelock");
    }

    // Re-check executableAt
    const newExecutableAt = await vault.executableAt(capData);
    result.executableAtAfterSubmit = newExecutableAt.toString();

    if (now >= Number(newExecutableAt)) {
      result.state = "SUBMITTED_AND_EXECUTABLE";
      if (!useJson) {
        console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
        console.log("   Action: Calling vault.increaseAbsoluteCap()...");
      }
    } else {
      const waitSeconds = Number(newExecutableAt) - now;
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.waitSeconds = waitSeconds;
      result.message = `Absolute cap timelock active. Wait ${waitSeconds}s.`;
      result.success = false;
      if (!useJson) {
        console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
        console.log(`   Wait ${waitSeconds}s then run again.`);
      }
      return result;
    }
  }
  // STATE 2b: Submitted but not executable
  else if (now < Number(executableAt)) {
    const waitSeconds = Number(executableAt) - now;
    result.state = "SUBMITTED_NOT_EXECUTABLE";
    result.waitSeconds = waitSeconds;
    result.message = `Absolute cap already submitted. Wait ${waitSeconds}s.`;
    result.success = false;
    if (!useJson) {
      console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
      console.log(`   Already submitted. Wait ${waitSeconds}s.`);
    }
    return result;
  }
  // STATE 2c: Submitted and executable
  else {
    result.state = "SUBMITTED_AND_EXECUTABLE";
    if (!useJson) {
      console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
      console.log("   Action: Calling vault.increaseAbsoluteCap()...");
    }
  }

  // STATE 3: Execute increaseAbsoluteCap
  result.step = "execute";
  const tx = await vaultWithSigner.increaseAbsoluteCap(preimage, capValue, {
    gasLimit: 300000,
    maxFeePerGas: ethers.parseUnits("400", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
  });
  result.actions.push({ type: "increaseAbsoluteCap", hash: tx.hash });

  if (!useJson) {
    console.log("   Tx hash:", tx.hash);
    console.log("   Waiting for confirmation...");
  }

  const receipt = await tx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
  };

  if (!useJson) {
    console.log("   ✅ increaseAbsoluteCap executed");
  }

  // STATE 4: Verification
  result.step = "verify";
  const finalCap = await vault.absoluteCap(adapterId);
  result.finalCap = finalCap.toString();

  if (finalCap > 0n) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Absolute cap set successfully.";
    if (!useJson) {
      console.log("   ✅ Absolute cap verified.");
    }
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Absolute cap verification failed. Cap is still 0.";
    throw new Error("Absolute cap verification failed. Cap is still 0.");
  }

  return result;
}

/**
 * State machine for idempotent relative cap handling
 * Handles all states: not submitted / submitted not executable / executable / already set
 *
 * @param {ethers.Contract} vaultWithSigner - Vault contract with signer
 * @param {ethers.Contract} vault - Vault contract read-only
 * @param {string} adapterAddress - Adapter address
 * @param {bigint} capValue - Relative cap value in WAD or bps
 * @param {boolean} useJson - JSON output mode
 * @returns {Promise<Object>} Result object with state and actions
 */
async function handleRelativeCapStateMachine(
  vaultWithSigner,
  vault,
  adapterAddress,
  capValue = RELATIVE_CAP_WAD,
  useJson = false,
) {
  const result = {
    success: false,
    step: null,
    actions: [],
    adapter: adapterAddress,
    capType: "relative",
    timestamp: new Date().toISOString(),
  };

  // Get preimage and adapterId
  const { preimage, adapterId } = getCapPreimage(adapterAddress);
  result.preimage = preimage;
  result.adapterId = adapterId;
  const normalizedCapValue = normalizeRelativeCapToWad(capValue);
  result.capValue = normalizedCapValue.toString();

  // STATE 1: Check if already set
  result.step = "check_relativeCap";
  const currentCap = await vault.relativeCap(adapterId);
  result.currentCap = currentCap.toString();

  if (currentCap >= normalizedCapValue) {
    result.success = true;
    result.state = "ALREADY_SET";
    result.message = "Relative cap already set.";
    if (!useJson) {
      console.log("✅ State: RELATIVE_CAP_ALREADY_SET");
      console.log(`   Current cap: ${currentCap.toString()} (WAD)`);
    }
    return result;
  }

  if (!useJson) {
    console.log("ℹ State: RELATIVE_CAP_NOT_SET");
    console.log("   Relative cap needs to be set.");
  }

  // Encode the cap data
  const { data: capData } = encodeIncreaseRelativeCap(adapterAddress, normalizedCapValue);
  result.encodedData = capData;

  // STATE 2: Check timelock submission status
  result.step = "check_executableAt";
  const executableAt = await vault.executableAt(capData);
  const now = Math.floor(Date.now() / 1000);
  result.executableAt = executableAt.toString();
  result.currentTime = now;

  // STATE 2a: Not yet submitted
  if (executableAt === 0n) {
    result.state = "NOT_SUBMITTED";
    if (!useJson) {
      console.log("\nℹ State: RELATIVE_CAP_NOT_SUBMITTED");
      console.log("   Action: Calling vault.submit(capData)...");
    }

    result.step = "submit";
    const tx = await vaultWithSigner.submit(capData, {
      gasLimit: 300000,
      maxFeePerGas: ethers.parseUnits("400", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
    });
    result.actions.push({ type: "submit_relative_cap", hash: tx.hash });

    if (!useJson) {
      console.log("   Tx hash:", tx.hash);
      console.log("   Waiting for confirmation...");
    }

    const receipt = await tx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
    };

    if (!useJson) {
      console.log("   ✅ Submitted relative cap to timelock");
    }

    // Re-check executableAt
    const newExecutableAt = await vault.executableAt(capData);
    result.executableAtAfterSubmit = newExecutableAt.toString();

    if (now >= Number(newExecutableAt)) {
      result.state = "SUBMITTED_AND_EXECUTABLE";
      if (!useJson) {
        console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
        console.log("   Action: Calling vault.increaseRelativeCap()...");
      }
    } else {
      const waitSeconds = Number(newExecutableAt) - now;
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.waitSeconds = waitSeconds;
      result.message = `Relative cap timelock active. Wait ${waitSeconds}s.`;
      result.success = false;
      if (!useJson) {
        console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
        console.log(`   Wait ${waitSeconds}s then run again.`);
      }
      return result;
    }
  }
  // STATE 2b: Submitted but not executable
  else if (now < Number(executableAt)) {
    const waitSeconds = Number(executableAt) - now;
    result.state = "SUBMITTED_NOT_EXECUTABLE";
    result.waitSeconds = waitSeconds;
    result.message = `Relative cap already submitted. Wait ${waitSeconds}s.`;
    result.success = false;
    if (!useJson) {
      console.log("\n⏳ State: SUBMITTED_NOT_EXECUTABLE");
      console.log(`   Already submitted. Wait ${waitSeconds}s.`);
    }
    return result;
  }
  // STATE 2c: Submitted and executable
  else {
    result.state = "SUBMITTED_AND_EXECUTABLE";
    if (!useJson) {
      console.log("\nℹ State: SUBMITTED_AND_EXECUTABLE");
      console.log("   Action: Calling vault.increaseRelativeCap()...");
    }
  }

  // STATE 3: Execute increaseRelativeCap
  result.step = "execute";
  const tx = await vaultWithSigner.increaseRelativeCap(preimage, normalizedCapValue, {
    gasLimit: 300000,
    maxFeePerGas: ethers.parseUnits("400", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
  });
  result.actions.push({ type: "increaseRelativeCap", hash: tx.hash });

  if (!useJson) {
    console.log("   Tx hash:", tx.hash);
    console.log("   Waiting for confirmation...");
  }

  const receipt = await tx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
  };

  if (!useJson) {
    console.log("   ✅ increaseRelativeCap executed");
  }

  // STATE 4: Verification
  result.step = "verify";
  const finalCap = await vault.relativeCap(adapterId);
  result.finalCap = finalCap.toString();

  if (finalCap > 0n) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Relative cap set successfully.";
    if (!useJson) {
      console.log("   ✅ Relative cap verified.");
    }
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Relative cap verification failed. Cap is still 0.";
    throw new Error("Relative cap verification failed. Cap is still 0.");
  }

  return result;
}

/**
 * Check if caps are set for an adapter
 * @param {ethers.Contract} vault
 * @param {string} adapterAddress
 * @returns {Promise<{absoluteCap: bigint, relativeCap: bigint, absoluteSet: boolean, relativeSet: boolean}>}
 */
async function checkCaps(vault, adapterAddress) {
  const { adapterId } = getCapPreimage(adapterAddress);

  const [absoluteCap, relativeCap] = await Promise.all([
    vault.absoluteCap(adapterId),
    vault.relativeCap(adapterId),
  ]);

  return {
    absoluteCap,
    relativeCap,
    absoluteSet: absoluteCap > 0n,
    relativeSet: relativeCap > 0n,
    adapterId,
  };
}

module.exports = {
  // Adapter ID derivation
  deriveAdapterId,
  getCapPreimage,
  verifyAdapterId,

  // Governance encoding
  encodeAddAdapter,
  encodeRemoveAdapter,
  encodeIncreaseAbsoluteCap,
  encodeIncreaseRelativeCap,

  // Batch operations
  encodeAdapterSetup,

  // Constants
  ADAPTER_TYPE_STRING,
  VAULT_FUNCTIONS,

  // Preflight safety checks
  isValidAddress,
  validateAddresses,
  checkGasBalance,
  checkContractCode,
  checkCuratorPermission,
  getAdapterAllocation,
  getTotalDeployed,
  getAdapterLiveExposure,
  checkPhase1Complete,
  checkPhase2Prerequisites,
  runPreflight,
  printPlannedTransactions,
  VAULT_PREFLIGHT_ABI,
  ADAPTER_PREFLIGHT_ABI,

  // Cap state machine functions
  handleAbsoluteCapStateMachine,
  handleRelativeCapStateMachine,
  checkCaps,
  normalizeRelativeCapToWad,

  // Retry utility
  withRetry,
  DEFAULT_RETRY_CONFIG,
};
