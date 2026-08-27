/**
 * Idempotent Governance Action Wrappers
 *
 * Reusable functions for Morpho Vault V2 governance operations.
 * Each function is idempotent - checks current state before writing,
 * uses timelock wait utility for submit/execute sequencing, and
 * verifies state change after execution.
 *
 * Functions:
 *   - addAdapter(vault, vaultWithSigner, newAdapter)
 *   - setAbsoluteCap(vault, vaultWithSigner, adapter, cap)
 *   - setRelativeCap(vault, vaultWithSigner, adapter, cap)
 *   - setAllocator(vault, vaultWithSigner, allocator, isAllocator)
 *   - removeAdapter(vault, vaultWithSigner, oldAdapter)
 *
 * Usage:
 *   const { addAdapter } = require('./lib/governanceActions');
 *   const result = await addAdapter(vault, vaultWithSigner, newAdapterAddress);
 */

const ethers = require("ethers");
const { waitForExecutable } = require("./timelockWait");

// ============================================================================
// Constants
// ============================================================================

const GAS_CONFIG = {
  gasLimit: 300000,
  maxFeePerGas: ethers.parseUnits("400", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("150", "gwei"),
};

const MAX_UINT128 = (1n << 128n) - 1n;
const RELATIVE_CAP_WAD = 10n ** 18n;
const RELATIVE_CAP_BPS_DENOMINATOR = 10000n;
const BPS_TO_WAD_FACTOR = RELATIVE_CAP_WAD / RELATIVE_CAP_BPS_DENOMINATOR;

const ADAPTER_TYPE_STRING = "PolymarketAdapter";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the cap preimage for use with increaseAbsoluteCap/increaseRelativeCap.
 * The preimage is the raw ABI-encoded data that, when hashed, produces the adapterId.
 * @param {string} adapterAddress - The adapter contract address
 * @returns {Object} Object containing { preimage, adapterId }
 */
function getCapPreimage(adapterAddress) {
  if (!adapterAddress || !ethers.isAddress(adapterAddress)) {
    throw new Error(`Invalid adapter address: ${adapterAddress}`);
  }

  const normalizedAddress = ethers.getAddress(adapterAddress);
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const preimage = abiCoder.encode(["string", "address"], [ADAPTER_TYPE_STRING, normalizedAddress]);
  const adapterId = ethers.keccak256(preimage);

  return { preimage, adapterId };
}

/**
 * Encode addAdapter function call
 * @param {string} adapterAddress - Adapter address to add
 * @returns {string} Encoded function call data
 */
function encodeAddAdapter(adapterAddress) {
  const normalizedAddress = ethers.getAddress(adapterAddress);
  const iface = new ethers.Interface(["function addAdapter(address adapter) external"]);
  return iface.encodeFunctionData("addAdapter", [normalizedAddress]);
}

/**
 * Encode removeAdapter function call
 * @param {string} adapterAddress - Adapter address to remove
 * @returns {string} Encoded function call data
 */
function encodeRemoveAdapter(adapterAddress) {
  const normalizedAddress = ethers.getAddress(adapterAddress);
  const iface = new ethers.Interface(["function removeAdapter(address account) external"]);
  return iface.encodeFunctionData("removeAdapter", [normalizedAddress]);
}

/**
 * Encode increaseAbsoluteCap function call
 * @param {string} adapterAddress - Adapter address
 * @param {bigint} capValue - Cap value
 * @returns {Object} Object containing { data, preimage, adapterId }
 */
function encodeIncreaseAbsoluteCap(adapterAddress, capValue) {
  const normalizedAddress = ethers.getAddress(adapterAddress);
  const { preimage, adapterId } = getCapPreimage(normalizedAddress);

  const iface = new ethers.Interface([
    "function increaseAbsoluteCap(bytes memory id, uint256 cap) external",
  ]);

  const data = iface.encodeFunctionData("increaseAbsoluteCap", [preimage, capValue]);

  return { data, preimage, adapterId, capValue };
}

/**
 * Encode increaseRelativeCap function call
 * @param {string} adapterAddress - Adapter address
 * @param {bigint} capValue - Cap value in bps
 * @returns {Object} Object containing { data, preimage, adapterId }
 */
function encodeIncreaseRelativeCap(adapterAddress, capValue) {
  const normalizedAddress = ethers.getAddress(adapterAddress);
  const { preimage, adapterId } = getCapPreimage(normalizedAddress);
  const normalizedCap = normalizeRelativeCapToWad(capValue);

  const iface = new ethers.Interface([
    "function increaseRelativeCap(bytes memory id, uint256 cap) external",
  ]);

  const data = iface.encodeFunctionData("increaseRelativeCap", [preimage, normalizedCap]);

  return { data, preimage, adapterId, capValue: normalizedCap };
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
 * Encode setIsAllocator function call
 * @param {string} allocatorAddress - Allocator address
 * @param {boolean} isAllocator - Whether to grant or revoke allocator role
 * @returns {string} Encoded function call data
 */
function encodeSetIsAllocator(allocatorAddress, isAllocator) {
  const normalizedAddress = ethers.getAddress(allocatorAddress);
  const iface = new ethers.Interface([
    "function setIsAllocator(address allocator, bool isAllocator) external",
  ]);
  return iface.encodeFunctionData("setIsAllocator", [normalizedAddress, isAllocator]);
}

// ============================================================================
// Idempotent Governance Actions
// ============================================================================

/**
 * Idempotent addAdapter wrapper
 * Adds a new adapter to the vault if not already registered.
 * Handles timelock submit/execute sequencing.
 *
 * @param {ethers.Contract} vault - Vault contract (read-only, connected to provider)
 * @param {ethers.Contract} vaultWithSigner - Vault contract with signer for transactions
 * @param {string} newAdapter - Address of the new adapter to add
 * @param {Object} options - Options
 * @param {boolean} options.verbose - Log progress (default: true)
 * @param {number} options.timeoutMs - Timeout for timelock wait (default: 300000)
 * @returns {Promise<Object>} Result object with state and actions
 */
async function addAdapter(vault, vaultWithSigner, newAdapter, options = {}) {
  const { verbose = true, timeoutMs = 300000 } = options;
  const log = verbose ? console.log : () => {};

  const result = {
    success: false,
    function: "addAdapter",
    adapter: newAdapter,
    timestamp: new Date().toISOString(),
    actions: [],
  };

  log(`\n[addAdapter] Starting idempotent addAdapter for ${newAdapter}...`);

  // STATE 1: Check if already added (idempotent success)
  log(`[addAdapter] Checking if adapter is already registered...`);
  const isAlreadyAdapter = await vault.isAdapter(newAdapter);
  result.isAdapterBefore = isAlreadyAdapter;

  if (isAlreadyAdapter) {
    result.success = true;
    result.state = "ALREADY_ADDED";
    result.message = "New adapter already registered. Nothing to do.";
    log(`[addAdapter] ✅ Adapter already registered. Nothing to do.`);
    return result;
  }

  log(`[addAdapter] ℹ Adapter not yet registered.`);

  // Encode the addAdapter call
  const addAdapterData = encodeAddAdapter(newAdapter);
  result.encodedData = addAdapterData;

  // STATE 2: Check if already submitted and wait for executable using timelock utility
  log(`[addAdapter] Checking timelock status...`);
  const waitResult = await waitForExecutable(vault, addAdapterData, {
    timeoutMs,
    verbose,
  });

  result.timelockWait = waitResult;

  if (!waitResult.success && waitResult.error?.includes("not submitted")) {
    // Not yet submitted - submit it
    log(`[addAdapter] Submitting addAdapter to timelock...`);
    const submitTx = await vaultWithSigner.submit(addAdapterData, GAS_CONFIG);
    result.actions.push({ type: "submit", hash: submitTx.hash });
    log(`[addAdapter] Submit tx: ${submitTx.hash}`);

    const submitReceipt = await submitTx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: submitReceipt.blockNumber,
      gasUsed: submitReceipt.gasUsed.toString(),
      status: submitReceipt.status,
    };
    log(`[addAdapter] ✅ Submitted to timelock`);

    // Now wait for it to be executable
    const waitAfterSubmit = await waitForExecutable(vault, addAdapterData, {
      timeoutMs,
      verbose,
    });
    result.timelockWaitAfterSubmit = waitAfterSubmit;

    if (!waitAfterSubmit.success) {
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.message = waitAfterSubmit.error || "Timelock not yet executable";
      log(`[addAdapter] ⏳ ${result.message}`);
      return result;
    }
  } else if (!waitResult.success) {
    // Other error from wait
    result.state = "TIMELOCK_WAIT_FAILED";
    result.message = waitResult.error;
    log(`[addAdapter] ❌ Timelock wait failed: ${waitResult.error}`);
    return result;
  }

  // STATE 3: Execute addAdapter
  log(`[addAdapter] Executing addAdapter...`);
  const executeTx = await vaultWithSigner.addAdapter(newAdapter, GAS_CONFIG);
  result.actions.push({ type: "addAdapter", hash: executeTx.hash });
  log(`[addAdapter] Execute tx: ${executeTx.hash}`);

  const executeReceipt = await executeTx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: executeReceipt.blockNumber,
    gasUsed: executeReceipt.gasUsed.toString(),
    status: executeReceipt.status,
  };
  log(`[addAdapter] ✅ addAdapter executed`);

  // STATE 4: Post-execution verification
  log(`[addAdapter] Verifying adapter registration...`);
  const isNowAdapter = await vault.isAdapter(newAdapter);
  result.isAdapterAfter = isNowAdapter;

  if (isNowAdapter) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Adapter added successfully.";
    log(`[addAdapter] ✅ Adapter registration verified.`);
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Verification failed. Adapter not registered after addAdapter.";
    log(`[addAdapter] ❌ Verification failed.`);
    throw new Error(result.message);
  }

  return result;
}

/**
 * Idempotent setAbsoluteCap wrapper (uses increaseAbsoluteCap)
 * Sets the absolute cap for an adapter if not already set.
 * Handles timelock submit/execute sequencing.
 *
 * @param {ethers.Contract} vault - Vault contract (read-only)
 * @param {ethers.Contract} vaultWithSigner - Vault contract with signer
 * @param {string} adapter - Address of the adapter
 * @param {bigint} cap - Cap value (default: uint128 max for practical unlimited)
 * @param {Object} options - Options
 * @param {boolean} options.verbose - Log progress (default: true)
 * @param {number} options.timeoutMs - Timeout for timelock wait (default: 300000)
 * @returns {Promise<Object>} Result object with state and actions
 */
async function setAbsoluteCap(vault, vaultWithSigner, adapter, cap = MAX_UINT128, options = {}) {
  const { verbose = true, timeoutMs = 300000 } = options;
  const log = verbose ? console.log : () => {};

  const capValue = BigInt(cap);
  if (capValue < 0n || capValue > MAX_UINT128) {
    throw new Error(
      `Invalid absolute cap ${capValue.toString()}. Must be between 0 and ${MAX_UINT128.toString()} (uint128 max).`,
    );
  }

  const result = {
    success: false,
    function: "setAbsoluteCap",
    adapter,
    cap: capValue.toString(),
    timestamp: new Date().toISOString(),
    actions: [],
  };

  log(`\n[setAbsoluteCap] Starting idempotent setAbsoluteCap for ${adapter}...`);

  // Get preimage and adapterId
  const { preimage, adapterId } = getCapPreimage(adapter);
  result.preimage = preimage;
  result.adapterId = adapterId;

  // STATE 1: Check if already set (idempotent success)
  log(`[setAbsoluteCap] Checking if absolute cap is already set...`);
  const currentCap = await vault.absoluteCap(adapterId);
  result.currentCap = currentCap.toString();

  if (currentCap > 0n) {
    result.success = true;
    result.state = "ALREADY_SET";
    result.message = "Absolute cap already set.";
    result.finalCap = currentCap.toString();
    log(`[setAbsoluteCap] ✅ Absolute cap already set: ${currentCap.toString()}`);
    return result;
  }

  log(`[setAbsoluteCap] ℹ Absolute cap not yet set.`);

  // Encode the cap data
  const { data: capData } = encodeIncreaseAbsoluteCap(adapter, capValue);
  result.encodedData = capData;

  // STATE 2: Check if already submitted and wait for executable
  log(`[setAbsoluteCap] Checking timelock status...`);
  const waitResult = await waitForExecutable(vault, capData, {
    timeoutMs,
    verbose,
  });

  result.timelockWait = waitResult;

  if (!waitResult.success && waitResult.error?.includes("not submitted")) {
    // Not yet submitted - submit it
    log(`[setAbsoluteCap] Submitting increaseAbsoluteCap to timelock...`);
    const submitTx = await vaultWithSigner.submit(capData, GAS_CONFIG);
    result.actions.push({ type: "submit", hash: submitTx.hash });
    log(`[setAbsoluteCap] Submit tx: ${submitTx.hash}`);

    const submitReceipt = await submitTx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: submitReceipt.blockNumber,
      gasUsed: submitReceipt.gasUsed.toString(),
      status: submitReceipt.status,
    };
    log(`[setAbsoluteCap] ✅ Submitted to timelock`);

    // Now wait for it to be executable
    const waitAfterSubmit = await waitForExecutable(vault, capData, {
      timeoutMs,
      verbose,
    });
    result.timelockWaitAfterSubmit = waitAfterSubmit;

    if (!waitAfterSubmit.success) {
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.message = waitAfterSubmit.error || "Timelock not yet executable";
      log(`[setAbsoluteCap] ⏳ ${result.message}`);
      return result;
    }
  } else if (!waitResult.success) {
    // Other error from wait
    result.state = "TIMELOCK_WAIT_FAILED";
    result.message = waitResult.error;
    log(`[setAbsoluteCap] ❌ Timelock wait failed: ${waitResult.error}`);
    return result;
  }

  // STATE 3: Execute increaseAbsoluteCap
  log(`[setAbsoluteCap] Executing increaseAbsoluteCap...`);
  const executeTx = await vaultWithSigner.increaseAbsoluteCap(preimage, capValue, GAS_CONFIG);
  result.actions.push({ type: "increaseAbsoluteCap", hash: executeTx.hash });
  log(`[setAbsoluteCap] Execute tx: ${executeTx.hash}`);

  const executeReceipt = await executeTx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: executeReceipt.blockNumber,
    gasUsed: executeReceipt.gasUsed.toString(),
    status: executeReceipt.status,
  };
  log(`[setAbsoluteCap] ✅ increaseAbsoluteCap executed`);

  // STATE 4: Post-execution verification
  log(`[setAbsoluteCap] Verifying cap is set...`);
  const finalCap = await vault.absoluteCap(adapterId);
  result.finalCap = finalCap.toString();

  if (finalCap > 0n) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Absolute cap set successfully.";
    log(`[setAbsoluteCap] ✅ Absolute cap verified: ${finalCap.toString()}`);
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Verification failed. Cap is still 0.";
    log(`[setAbsoluteCap] ❌ Verification failed.`);
    throw new Error(result.message);
  }

  return result;
}

/**
 * Idempotent setRelativeCap wrapper (uses increaseRelativeCap)
 * Sets the relative cap for an adapter if not already set.
 * Handles timelock submit/execute sequencing.
 *
 * @param {ethers.Contract} vault - Vault contract (read-only)
 * @param {ethers.Contract} vaultWithSigner - Vault contract with signer
 * @param {string} adapter - Address of the adapter
 * @param {bigint} cap - Cap value in WAD or bps
 * @param {Object} options - Options
 * @param {boolean} options.verbose - Log progress (default: true)
 * @param {number} options.timeoutMs - Timeout for timelock wait (default: 300000)
 * @returns {Promise<Object>} Result object with state and actions
 */
async function setRelativeCap(
  vault,
  vaultWithSigner,
  adapter,
  cap = RELATIVE_CAP_WAD,
  options = {},
) {
  const { verbose = true, timeoutMs = 300000 } = options;
  const log = verbose ? console.log : () => {};

  const result = {
    success: false,
    function: "setRelativeCap",
    adapter,
    cap: normalizeRelativeCapToWad(cap).toString(),
    timestamp: new Date().toISOString(),
    actions: [],
  };

  log(`\n[setRelativeCap] Starting idempotent setRelativeCap for ${adapter}...`);

  // Get preimage and adapterId
  const { preimage, adapterId } = getCapPreimage(adapter);
  result.preimage = preimage;
  result.adapterId = adapterId;
  const normalizedCap = normalizeRelativeCapToWad(cap);

  // STATE 1: Check if already set (idempotent success)
  log(`[setRelativeCap] Checking if relative cap is already set...`);
  const currentCap = await vault.relativeCap(adapterId);
  result.currentCap = currentCap.toString();

  if (currentCap >= normalizedCap) {
    result.success = true;
    result.state = "ALREADY_SET";
    result.message = "Relative cap already set.";
    result.finalCap = currentCap.toString();
    log(`[setRelativeCap] ✅ Relative cap already set: ${currentCap.toString()} (WAD)`);
    return result;
  }

  log(`[setRelativeCap] ℹ Relative cap not yet set.`);

  // Encode the cap data
  const { data: capData } = encodeIncreaseRelativeCap(adapter, normalizedCap);
  result.encodedData = capData;

  // STATE 2: Check if already submitted and wait for executable
  log(`[setRelativeCap] Checking timelock status...`);
  const waitResult = await waitForExecutable(vault, capData, {
    timeoutMs,
    verbose,
  });

  result.timelockWait = waitResult;

  if (!waitResult.success && waitResult.error?.includes("not submitted")) {
    // Not yet submitted - submit it
    log(`[setRelativeCap] Submitting increaseRelativeCap to timelock...`);
    const submitTx = await vaultWithSigner.submit(capData, GAS_CONFIG);
    result.actions.push({ type: "submit", hash: submitTx.hash });
    log(`[setRelativeCap] Submit tx: ${submitTx.hash}`);

    const submitReceipt = await submitTx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: submitReceipt.blockNumber,
      gasUsed: submitReceipt.gasUsed.toString(),
      status: submitReceipt.status,
    };
    log(`[setRelativeCap] ✅ Submitted to timelock`);

    // Now wait for it to be executable
    const waitAfterSubmit = await waitForExecutable(vault, capData, {
      timeoutMs,
      verbose,
    });
    result.timelockWaitAfterSubmit = waitAfterSubmit;

    if (!waitAfterSubmit.success) {
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.message = waitAfterSubmit.error || "Timelock not yet executable";
      log(`[setRelativeCap] ⏳ ${result.message}`);
      return result;
    }
  } else if (!waitResult.success) {
    // Other error from wait
    result.state = "TIMELOCK_WAIT_FAILED";
    result.message = waitResult.error;
    log(`[setRelativeCap] ❌ Timelock wait failed: ${waitResult.error}`);
    return result;
  }

  // STATE 3: Execute increaseRelativeCap
  log(`[setRelativeCap] Executing increaseRelativeCap...`);
  const executeTx = await vaultWithSigner.increaseRelativeCap(preimage, normalizedCap, GAS_CONFIG);
  result.actions.push({ type: "increaseRelativeCap", hash: executeTx.hash });
  log(`[setRelativeCap] Execute tx: ${executeTx.hash}`);

  const executeReceipt = await executeTx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: executeReceipt.blockNumber,
    gasUsed: executeReceipt.gasUsed.toString(),
    status: executeReceipt.status,
  };
  log(`[setRelativeCap] ✅ increaseRelativeCap executed`);

  // STATE 4: Post-execution verification
  log(`[setRelativeCap] Verifying cap is set...`);
  const finalCap = await vault.relativeCap(adapterId);
  result.finalCap = finalCap.toString();

  if (finalCap > 0n) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Relative cap set successfully.";
    log(`[setRelativeCap] ✅ Relative cap verified: ${finalCap.toString()} (WAD)`);
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Verification failed. Cap is still 0.";
    log(`[setRelativeCap] ❌ Verification failed.`);
    throw new Error(result.message);
  }

  return result;
}

/**
 * Idempotent setIsAllocator wrapper
 * Grants or revokes allocator role for an address.
 * Handles timelock submit/execute sequencing.
 *
 * @param {ethers.Contract} vault - Vault contract (read-only)
 * @param {ethers.Contract} vaultWithSigner - Vault contract with signer
 * @param {string} allocator - Address to grant/revoke allocator role
 * @param {boolean} isAllocatorValue - Whether to grant (true) or revoke (false)
 * @param {Object} options - Options
 * @param {boolean} options.verbose - Log progress (default: true)
 * @param {number} options.timeoutMs - Timeout for timelock wait (default: 300000)
 * @returns {Promise<Object>} Result object with state and actions
 */
async function setAllocator(
  vault,
  vaultWithSigner,
  allocator,
  isAllocatorValue = true,
  options = {},
) {
  const { verbose = true, timeoutMs = 300000 } = options;
  const log = verbose ? console.log : () => {};

  const result = {
    success: false,
    function: "setIsAllocator",
    allocator,
    isAllocatorValue,
    timestamp: new Date().toISOString(),
    actions: [],
  };

  log(`\n[setAllocator] Starting idempotent setIsAllocator for ${allocator}...`);

  // STATE 1: Check if already in desired state (idempotent success)
  log(`[setAllocator] Checking current allocator status...`);
  const currentStatus = await vault.isAllocator(allocator);
  result.isAllocatorBefore = currentStatus;

  if (currentStatus === isAllocatorValue) {
    result.success = true;
    result.state = "ALREADY_SET";
    result.message = `Allocator already ${isAllocatorValue ? "granted" : "revoked"}. Nothing to do.`;
    result.isAllocatorAfter = currentStatus;
    log(`[setAllocator] ✅ Allocator already in desired state: ${currentStatus}`);
    return result;
  }

  log(`[setAllocator] ℹ Allocator status needs to change: ${currentStatus} → ${isAllocatorValue}`);

  // Encode the setIsAllocator call
  const allocatorData = encodeSetIsAllocator(allocator, isAllocatorValue);
  result.encodedData = allocatorData;

  // STATE 2: Check if already submitted and wait for executable
  log(`[setAllocator] Checking timelock status...`);
  const waitResult = await waitForExecutable(vault, allocatorData, {
    timeoutMs,
    verbose,
  });

  result.timelockWait = waitResult;

  if (!waitResult.success && waitResult.error?.includes("not submitted")) {
    // Not yet submitted - submit it
    log(`[setAllocator] Submitting setIsAllocator to timelock...`);
    const submitTx = await vaultWithSigner.submit(allocatorData, GAS_CONFIG);
    result.actions.push({ type: "submit", hash: submitTx.hash });
    log(`[setAllocator] Submit tx: ${submitTx.hash}`);

    const submitReceipt = await submitTx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: submitReceipt.blockNumber,
      gasUsed: submitReceipt.gasUsed.toString(),
      status: submitReceipt.status,
    };
    log(`[setAllocator] ✅ Submitted to timelock`);

    // Now wait for it to be executable
    const waitAfterSubmit = await waitForExecutable(vault, allocatorData, {
      timeoutMs,
      verbose,
    });
    result.timelockWaitAfterSubmit = waitAfterSubmit;

    if (!waitAfterSubmit.success) {
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.message = waitAfterSubmit.error || "Timelock not yet executable";
      log(`[setAllocator] ⏳ ${result.message}`);
      return result;
    }
  } else if (!waitResult.success) {
    // Other error from wait
    result.state = "TIMELOCK_WAIT_FAILED";
    result.message = waitResult.error;
    log(`[setAllocator] ❌ Timelock wait failed: ${waitResult.error}`);
    return result;
  }

  // STATE 3: Execute setIsAllocator
  log(`[setAllocator] Executing setIsAllocator...`);
  const executeTx = await vaultWithSigner.setIsAllocator(allocator, isAllocatorValue, GAS_CONFIG);
  result.actions.push({ type: "setIsAllocator", hash: executeTx.hash });
  log(`[setAllocator] Execute tx: ${executeTx.hash}`);

  const executeReceipt = await executeTx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: executeReceipt.blockNumber,
    gasUsed: executeReceipt.gasUsed.toString(),
    status: executeReceipt.status,
  };
  log(`[setAllocator] ✅ setIsAllocator executed`);

  // STATE 4: Post-execution verification
  log(`[setAllocator] Verifying allocator status...`);
  const finalStatus = await vault.isAllocator(allocator);
  result.isAllocatorAfter = finalStatus;

  if (finalStatus === isAllocatorValue) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = `Allocator ${isAllocatorValue ? "granted" : "revoked"} successfully.`;
    log(`[setAllocator] ✅ Allocator status verified: ${finalStatus}`);
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Verification failed. Allocator status not changed.";
    log(`[setAllocator] ❌ Verification failed.`);
    throw new Error(result.message);
  }

  return result;
}

/**
 * Idempotent removeAdapter wrapper
 * Removes an adapter from the vault if still registered.
 * Handles timelock submit/execute sequencing.
 *
 * GUARD: Will NOT remove if adapter has non-zero allocation.
 *
 * @param {ethers.Contract} vault - Vault contract (read-only)
 * @param {ethers.Contract} vaultWithSigner - Vault contract with signer
 * @param {string} oldAdapter - Address of the adapter to remove
 * @param {Object} options - Options
 * @param {boolean} options.verbose - Log progress (default: true)
 * @param {number} options.timeoutMs - Timeout for timelock wait (default: 300000)
 * @param {boolean} options.skipAllocationCheck - Skip allocation guard (default: false)
 * @returns {Promise<Object>} Result object with state and actions
 */
async function removeAdapter(vault, vaultWithSigner, oldAdapter, options = {}) {
  const { verbose = true, timeoutMs = 300000, skipAllocationCheck = false } = options;
  const log = verbose ? console.log : () => {};

  const result = {
    success: false,
    function: "removeAdapter",
    adapter: oldAdapter,
    timestamp: new Date().toISOString(),
    actions: [],
  };

  log(`\n[removeAdapter] Starting idempotent removeAdapter for ${oldAdapter}...`);

  // STATE 1: Check if already removed (idempotent success)
  log(`[removeAdapter] Checking if adapter is still registered...`);
  const isStillAdapter = await vault.isAdapter(oldAdapter);
  result.isAdapterBefore = isStillAdapter;

  if (!isStillAdapter) {
    result.success = true;
    result.state = "ALREADY_REMOVED";
    result.message = "Old adapter already removed. Nothing to do.";
    log(`[removeAdapter] ✅ Adapter already removed. Nothing to do.`);
    return result;
  }

  log(`[removeAdapter] ℹ Adapter is still registered.`);

  // GUARD: Check allocation before removing (unless skipped)
  if (!skipAllocationCheck) {
    const { adapterId } = getCapPreimage(oldAdapter);
    const allocation = await vault.allocation(adapterId);
    result.allocationBefore = allocation.toString();

    if (allocation > 0n) {
      const formatted = ethers.formatUnits(allocation, 6);
      result.success = false;
      result.state = "GUARD_FAILED";
      result.message =
        `Cannot remove adapter with non-zero allocation: ${formatted} USDC ` +
        `(raw=${allocation.toString()})`;
      log(`[removeAdapter] ❌ Guard failed: ${result.message}`);
      throw new Error(result.message);
    }
    log(`[removeAdapter] ✅ Allocation check passed: ${ethers.formatUnits(allocation, 6)} USDC`);
  }

  // Encode the removeAdapter call
  const removeAdapterData = encodeRemoveAdapter(oldAdapter);
  result.encodedData = removeAdapterData;

  // STATE 2: Check if already submitted and wait for executable
  log(`[removeAdapter] Checking timelock status...`);
  const waitResult = await waitForExecutable(vault, removeAdapterData, {
    timeoutMs,
    verbose,
  });

  result.timelockWait = waitResult;

  if (!waitResult.success && waitResult.error?.includes("not submitted")) {
    // Not yet submitted - submit it
    log(`[removeAdapter] Submitting removeAdapter to timelock...`);
    const submitTx = await vaultWithSigner.submit(removeAdapterData, GAS_CONFIG);
    result.actions.push({ type: "submit", hash: submitTx.hash });
    log(`[removeAdapter] Submit tx: ${submitTx.hash}`);

    const submitReceipt = await submitTx.wait();
    result.actions[result.actions.length - 1].receipt = {
      blockNumber: submitReceipt.blockNumber,
      gasUsed: submitReceipt.gasUsed.toString(),
      status: submitReceipt.status,
    };
    log(`[removeAdapter] ✅ Submitted to timelock`);

    // Now wait for it to be executable
    const waitAfterSubmit = await waitForExecutable(vault, removeAdapterData, {
      timeoutMs,
      verbose,
    });
    result.timelockWaitAfterSubmit = waitAfterSubmit;

    if (!waitAfterSubmit.success) {
      result.state = "SUBMITTED_NOT_EXECUTABLE";
      result.message = waitAfterSubmit.error || "Timelock not yet executable";
      log(`[removeAdapter] ⏳ ${result.message}`);
      return result;
    }
  } else if (!waitResult.success) {
    // Other error from wait
    result.state = "TIMELOCK_WAIT_FAILED";
    result.message = waitResult.error;
    log(`[removeAdapter] ❌ Timelock wait failed: ${waitResult.error}`);
    return result;
  }

  // STATE 3: Execute removeAdapter
  log(`[removeAdapter] Executing removeAdapter...`);
  const executeTx = await vaultWithSigner.removeAdapter(oldAdapter, GAS_CONFIG);
  result.actions.push({ type: "removeAdapter", hash: executeTx.hash });
  log(`[removeAdapter] Execute tx: ${executeTx.hash}`);

  const executeReceipt = await executeTx.wait();
  result.actions[result.actions.length - 1].receipt = {
    blockNumber: executeReceipt.blockNumber,
    gasUsed: executeReceipt.gasUsed.toString(),
    status: executeReceipt.status,
  };
  log(`[removeAdapter] ✅ removeAdapter executed`);

  // STATE 4: Post-execution verification
  log(`[removeAdapter] Verifying adapter removal...`);
  const isNowAdapter = await vault.isAdapter(oldAdapter);
  result.isAdapterAfter = isNowAdapter;

  if (!isNowAdapter) {
    result.success = true;
    result.state = "COMPLETE";
    result.message = "Adapter removed successfully.";
    log(`[removeAdapter] ✅ Adapter removal verified.`);
  } else {
    result.success = false;
    result.state = "VERIFICATION_FAILED";
    result.message = "Verification failed. Adapter still registered after removeAdapter.";
    log(`[removeAdapter] ❌ Verification failed.`);
    throw new Error(result.message);
  }

  return result;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Main governance actions
  addAdapter,
  setAbsoluteCap,
  setRelativeCap,
  setAllocator,
  removeAdapter,

  // Helper functions (exported for testing/advanced use)
  getCapPreimage,
  encodeAddAdapter,
  encodeRemoveAdapter,
  encodeIncreaseAbsoluteCap,
  encodeIncreaseRelativeCap,
  encodeSetIsAllocator,

  // Constants
  GAS_CONFIG,
  ADAPTER_TYPE_STRING,
};
