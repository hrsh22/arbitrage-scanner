/**
 * Timelock Wait Utility
 *
 * Waits for a submitted governance operation to become executable.
 * After calling submit(data), waits minimum 10 seconds, then polls
 * executableAt(data) every 5 seconds until executable or timeout.
 *
 * Usage:
 *   const { waitForExecutable } = require('./lib/timelockWait');
 *   const result = await waitForExecutable(vault, callData, { timeoutMs: 300000 });
 *   if (result.success) {
 *     console.log(`Executable at: ${result.executableAt}`);
 *   }
 */

/**
 * Wait for a timelocked operation to become executable
 *
 * @param {ethers.Contract} vault - Vault contract (read-only, connected to provider)
 * @param {string} callData - The encoded function call data that was submitted
 * @param {Object} options - Options
 * @param {number} options.minDelayMs - Minimum delay after submit before polling (default: 10000 = 10s)
 * @param {number} options.pollIntervalMs - Poll interval in ms (default: 5000 = 5s)
 * @param {number} options.timeoutMs - Total timeout in ms (default: 300000 = 5 minutes)
 * @param {boolean} options.verbose - Log progress (default: true)
 * @returns {Promise<{success: boolean, executableAt: number|null, waitedMs: number, polls: number, error?: string}>}
 */
async function waitForExecutable(vault, callData, options = {}) {
  const {
    minDelayMs = 10000, // 10 seconds minimum delay
    pollIntervalMs = 5000, // 5 seconds between polls
    timeoutMs = 300000, // 5 minutes total timeout
    verbose = true,
  } = options;

  const startTime = Date.now();
  const log = verbose ? console.log : () => {};

  log(`\n[TimelockWait] Starting wait for executable...`);
  log(`[TimelockWait] callData: ${callData.slice(0, 50)}...${callData.slice(-20)}`);
  log(
    `[TimelockWait] Minimum delay: ${minDelayMs}ms, Poll interval: ${pollIntervalMs}ms, Timeout: ${timeoutMs}ms`,
  );

  // Step 1: Check initial executableAt to verify submission
  const initialExecutableAt = await vault.executableAt(callData);
  const now = Math.floor(Date.now() / 1000);

  log(
    `[TimelockWait] Initial executableAt: ${initialExecutableAt} (${initialExecutableAt === 0n ? "not submitted" : new Date(Number(initialExecutableAt) * 1000).toISOString()})`,
  );
  log(`[TimelockWait] Current time: ${now} (${new Date(now * 1000).toISOString()})`);

  // If executableAt is 0, the operation was never submitted
  if (initialExecutableAt === 0n) {
    return {
      success: false,
      executableAt: null,
      waitedMs: 0,
      polls: 0,
      error: "Operation not submitted: executableAt is 0",
    };
  }

  // If already executable, return immediately
  if (now >= Number(initialExecutableAt)) {
    log(`[TimelockWait] Already executable (timelock = 0 or passed)`);
    return {
      success: true,
      executableAt: Number(initialExecutableAt),
      waitedMs: 0,
      polls: 0,
    };
  }

  // Step 2: Wait minimum delay before starting to poll
  const initialWaitSeconds = Math.ceil(minDelayMs / 1000);
  log(
    `[TimelockWait] Operation submitted. Waiting minimum ${initialWaitSeconds}s before polling...`,
  );
  log(`[TimelockWait] Submit timestamp: ${new Date().toISOString()}`);

  await sleep(minDelayMs);

  const afterMinDelayTime = Date.now();
  log(`[TimelockWait] Minimum delay complete at ${new Date().toISOString()}`);

  // Step 3: Poll executableAt until executable or timeout
  let polls = 0;
  let lastExecutableAt = initialExecutableAt;

  while (true) {
    const elapsedMs = Date.now() - startTime;

    // Check timeout
    if (elapsedMs >= timeoutMs) {
      log(`[TimelockWait] ❌ Timeout after ${elapsedMs}ms (${polls} polls)`);
      return {
        success: false,
        executableAt: Number(lastExecutableAt),
        waitedMs: elapsedMs,
        polls,
        error: `Timeout: Operation not executable after ${Math.round(elapsedMs / 1000)}s`,
      };
    }

    // Poll executableAt
    polls++;
    const currentExecutableAt = await vault.executableAt(callData);
    const currentTime = Math.floor(Date.now() / 1000);
    lastExecutableAt = currentExecutableAt;

    const remainingSeconds = Number(currentExecutableAt) - currentTime;

    log(
      `[TimelockWait] Poll #${polls} at ${new Date().toISOString()}: executableAt=${currentExecutableAt}, now=${currentTime}, remaining=${remainingSeconds}s`,
    );

    // Check if executable
    if (currentTime >= Number(currentExecutableAt)) {
      const totalWaitedMs = Date.now() - startTime;
      log(`[TimelockWait] ✅ Executable! Total wait: ${totalWaitedMs}ms (${polls} polls)`);

      return {
        success: true,
        executableAt: Number(currentExecutableAt),
        waitedMs: totalWaitedMs,
        polls,
      };
    }

    // Not yet executable, wait and poll again
    log(`[TimelockWait]   Not yet executable. Waiting ${pollIntervalMs}ms...`);
    await sleep(pollIntervalMs);
  }
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  waitForExecutable,
  sleep,
};
