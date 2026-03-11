/**
 * Safety Gate for Adapter Rotation
 *
 * This module provides a reusable safety gate function that performs
 * pre-flight checks before proceeding with Phase 2 of adapter rotation
 * (removing the old adapter).
 *
 * Checks performed:
 *   1. New adapter is registered (vault.isAdapter(newAdapter) == true)
 *   2. Caps are set for new adapter (absoluteCap > 0, relativeCap > 0)
 *   3. Old adapter allocation == 0
 *   4. Old adapter live exposure == 0 (via getAdapterLiveExposure)
 *
 * Stale allocation bypass: If allocation > 0 but live exposure == 0,
 * this is treated as a stale accounting entry and flagged as a warning
 * rather than a blocker.
 *
 * Usage:
 *   const { checkSafetyGate } = require('./lib/safetyGate');
 *   const result = await checkSafetyGate(vault, newAdapter, oldAdapter, provider);
 *   if (result.ready) {
 *     // Proceed with Phase 2
 *   } else {
 *     // Handle blockers
 *     console.log(result.blockers);
 *   }
 */

const ethers = require("ethers");
const {
  getCapPreimage,
  getAdapterAllocation,
  getAdapterLiveExposure,
  VAULT_PREFLIGHT_ABI,
  ADAPTER_PREFLIGHT_ABI,
  ERC20_BALANCE_ABI,
} = require("./rotationHelpers.js");

/**
 * Perform comprehensive safety gate checks before Phase 2 adapter removal.
 *
 * All checks are read-only - this function does not modify contract state.
 *
 * @param {ethers.Contract} vault - Vault contract instance (with provider)
 * @param {string} newAdapter - Address of the new adapter to verify
 * @param {string} oldAdapter - Address of the old adapter to check for zero state
 * @param {ethers.Provider} provider - Ethers provider for additional reads
 * @returns {Promise<Object>} Safety gate result with structure:
 *   {
 *     ready: boolean,           // true if all checks pass (or stale bypass)
 *     blockers: string[],       // list of blocking issues (empty if ready)
 *     warnings: string[],       // list of warnings (stale bypass, etc.)
 *     details: {
 *       isAdapterNew: boolean | null,   // new adapter registered status
 *       capsSet: {
 *         absolute: boolean,            // absoluteCap > 0
 *         relative: boolean,            // relativeCap > 0
 *         absoluteCap: string,          // raw cap value
 *         relativeCap: string,          // raw cap value in bps
 *         adapterId: string,            // adapterId used for cap lookups
 *       } | null,
 *       oldAllocation: {
 *         allocation: string,           // raw allocation value
 *         formatted: string,            // formatted (6 decimals)
 *       } | null,
 *       oldLiveExposure: {
 *         safeBalance: string,          // USDC in Safe
 *         adapterBalance: string,       // USDC in adapter
 *         totalPositionCostBasis: string, // position cost basis
 *         totalDeployed: string,        // total deployed amount
 *         liveExposure: string,         // total live exposure
 *         liveExposureFormatted: string, // formatted (6 decimals)
 *       } | null,
 *     },
 *     staleAllocationBypass: boolean,  // true if allocation > 0 but exposure == 0
 *   }
 */
async function checkSafetyGate(vault, newAdapter, oldAdapter, provider) {
  const blockers = [];
  const warnings = [];
  const details = {
    isAdapterNew: null,
    capsSet: null,
    oldAllocation: null,
    oldLiveExposure: null,
  };
  let staleAllocationBypass = false;

  // Validate inputs
  if (!vault || !vault.runner) {
    throw new Error("Invalid vault contract: must have provider/signer attached");
  }
  if (!provider && !vault.runner) {
    throw new Error("Provider required for contract reads");
  }
  const readProvider = provider || vault.runner;

  if (!newAdapter || !ethers.isAddress(newAdapter)) {
    throw new Error(`Invalid new adapter address: ${newAdapter}`);
  }
  if (!oldAdapter || !ethers.isAddress(oldAdapter)) {
    throw new Error(`Invalid old adapter address: ${oldAdapter}`);
  }

  // ============================================================================
  // CHECK 1: New adapter is registered
  // ============================================================================
  try {
    const isAdapterNew = await vault.isAdapter(newAdapter);
    details.isAdapterNew = isAdapterNew;

    if (!isAdapterNew) {
      blockers.push("New adapter is not registered (vault.isAdapter(newAdapter) = false)");
    }
  } catch (error) {
    details.isAdapterNew = null;
    blockers.push(`Failed to query isAdapter(newAdapter): ${error.message}`);
  }

  // ============================================================================
  // CHECK 2: Caps are set for new adapter (absoluteCap > 0, relativeCap > 0)
  // ============================================================================
  try {
    const { adapterId } = getCapPreimage(newAdapter);

    const [absoluteCap, relativeCap] = await Promise.all([
      vault.absoluteCap(adapterId),
      vault.relativeCap(adapterId),
    ]);

    const absoluteSet = absoluteCap > 0n;
    const relativeSet = relativeCap > 0n;

    details.capsSet = {
      absolute: absoluteSet,
      relative: relativeSet,
      absoluteCap: absoluteCap.toString(),
      relativeCap: relativeCap.toString(),
      adapterId,
    };

    if (!absoluteSet) {
      blockers.push(`Absolute cap is 0 for new adapter (adapterId=${adapterId})`);
    }
    if (!relativeSet) {
      blockers.push(`Relative cap is 0 for new adapter (adapterId=${adapterId})`);
    }
  } catch (error) {
    details.capsSet = null;
    blockers.push(`Failed to query caps for new adapter: ${error.message}`);
  }

  // ============================================================================
  // CHECK 3: Old adapter allocation == 0
  // ============================================================================
  try {
    const allocationResult = await getAdapterAllocation(vault, oldAdapter);
    details.oldAllocation = {
      allocation: allocationResult.allocation.toString(),
      formatted: allocationResult.formatted,
    };

    if (allocationResult.allocation > 0n) {
      // Allocation is non-zero - flag as potential blocker
      // But we'll check live exposure for stale allocation bypass
      const allocationFormatted = allocationResult.formatted;

      // Try to get live exposure to determine if this is stale
      try {
        const exposureResult = await getAdapterLiveExposure(readProvider, oldAdapter);
        details.oldLiveExposure = {
          safeBalance: exposureResult.safeBalance.toString(),
          adapterBalance: exposureResult.adapterBalance.toString(),
          totalPositionCostBasis: exposureResult.totalPositionCostBasis.toString(),
          totalDeployed: exposureResult.totalDeployed.toString(),
          liveExposure: exposureResult.liveExposure.toString(),
          liveExposureFormatted: exposureResult.liveExposureFormatted,
        };

        if (exposureResult.liveExposure === 0n) {
          // Stale allocation bypass: allocation > 0 but no live exposure
          staleAllocationBypass = true;
          warnings.push(
            `Old adapter allocation is ${allocationFormatted} USDC but live exposure is 0; ` +
              `treating as stale legacy accounting and allowing phase2`,
          );
        } else {
          // Live exposure exists - this is a real blocker
          blockers.push(
            `Old adapter allocation is ${allocationFormatted} USDC (must be 0). ` +
              `Live exposure: ${exposureResult.liveExposureFormatted} USDC`,
          );
        }
      } catch (exposureError) {
        // Could not read exposure - treat as blocker to be safe
        warnings.push(
          `Could not read old adapter exposure for stale-allocation check: ${exposureError.message}`,
        );
        blockers.push(
          `Old adapter allocation is ${allocationFormatted} USDC (must be 0). ` +
            `Unable to verify live exposure: ${exposureError.message}`,
        );
      }
    }
  } catch (error) {
    details.oldAllocation = null;
    blockers.push(`Failed to query old adapter allocation: ${error.message}`);
  }

  // ============================================================================
  // CHECK 4: Old adapter live exposure == 0
  // ============================================================================
  // This check is only performed if we haven't already fetched exposure above
  if (details.oldLiveExposure === null) {
    try {
      const exposureResult = await getAdapterLiveExposure(readProvider, oldAdapter);
      details.oldLiveExposure = {
        safeBalance: exposureResult.safeBalance.toString(),
        adapterBalance: exposureResult.adapterBalance.toString(),
        totalPositionCostBasis: exposureResult.totalPositionCostBasis.toString(),
        totalDeployed: exposureResult.totalDeployed.toString(),
        liveExposure: exposureResult.liveExposure.toString(),
        liveExposureFormatted: exposureResult.liveExposureFormatted,
      };

      if (exposureResult.liveExposure > 0n) {
        blockers.push(
          `Old adapter has live exposure of ${exposureResult.liveExposureFormatted} USDC (must be 0)`,
        );
      }
    } catch (error) {
      details.oldLiveExposure = null;
      blockers.push(`Failed to query old adapter live exposure: ${error.message}`);
    }
  }

  // ============================================================================
  // Determine readiness
  // ============================================================================
  // Ready if no blockers OR if we have a stale allocation bypass
  const ready = blockers.length === 0 || staleAllocationBypass;

  return {
    ready,
    blockers,
    warnings,
    details,
    staleAllocationBypass,
  };
}

/**
 * Quick check for Phase 1 readiness (new adapter setup only).
 * Checks: isAdapter(new) == true and caps are set.
 *
 * @param {ethers.Contract} vault - Vault contract instance
 * @param {string} newAdapter - Address of the new adapter to verify
 * @returns {Promise<Object>} Phase 1 readiness result
 */
async function checkPhase1Ready(vault, newAdapter) {
  const blockers = [];
  const details = {
    isAdapterNew: null,
    capsSet: null,
  };

  if (!newAdapter || !ethers.isAddress(newAdapter)) {
    throw new Error(`Invalid new adapter address: ${newAdapter}`);
  }

  // Check isAdapter
  try {
    const isAdapterNew = await vault.isAdapter(newAdapter);
    details.isAdapterNew = isAdapterNew;
    if (!isAdapterNew) {
      blockers.push("New adapter is not registered");
    }
  } catch (error) {
    blockers.push(`Failed to query isAdapter: ${error.message}`);
  }

  // Check caps
  try {
    const { adapterId } = getCapPreimage(newAdapter);
    const [absoluteCap, relativeCap] = await Promise.all([
      vault.absoluteCap(adapterId),
      vault.relativeCap(adapterId),
    ]);

    details.capsSet = {
      absolute: absoluteCap > 0n,
      relative: relativeCap > 0n,
      absoluteCap: absoluteCap.toString(),
      relativeCap: relativeCap.toString(),
      adapterId,
    };

    if (absoluteCap <= 0n) {
      blockers.push("Absolute cap is 0");
    }
    if (relativeCap <= 0n) {
      blockers.push("Relative cap is 0");
    }
  } catch (error) {
    blockers.push(`Failed to query caps: ${error.message}`);
  }

  return {
    ready: blockers.length === 0,
    blockers,
    details,
  };
}

/**
 * Quick check for Phase 2 readiness (old adapter removal).
 * Checks: old adapter allocation == 0 and live exposure == 0.
 *
 * @param {ethers.Contract} vault - Vault contract instance
 * @param {string} oldAdapter - Address of the old adapter
 * @param {ethers.Provider} provider - Ethers provider
 * @returns {Promise<Object>} Phase 2 readiness result
 */
async function checkPhase2Ready(vault, oldAdapter, provider) {
  const blockers = [];
  const warnings = [];
  const details = {
    oldAllocation: null,
    oldLiveExposure: null,
  };
  let staleAllocationBypass = false;

  if (!oldAdapter || !ethers.isAddress(oldAdapter)) {
    throw new Error(`Invalid old adapter address: ${oldAdapter}`);
  }

  const readProvider = provider || vault.runner;

  // Check allocation and exposure
  try {
    const allocationResult = await getAdapterAllocation(vault, oldAdapter);
    details.oldAllocation = {
      allocation: allocationResult.allocation.toString(),
      formatted: allocationResult.formatted,
    };

    if (allocationResult.allocation > 0n) {
      // Check if this is stale
      try {
        const exposureResult = await getAdapterLiveExposure(readProvider, oldAdapter);
        details.oldLiveExposure = {
          safeBalance: exposureResult.safeBalance.toString(),
          adapterBalance: exposureResult.adapterBalance.toString(),
          totalPositionCostBasis: exposureResult.totalPositionCostBasis.toString(),
          totalDeployed: exposureResult.totalDeployed.toString(),
          liveExposure: exposureResult.liveExposure.toString(),
          liveExposureFormatted: exposureResult.liveExposureFormatted,
        };

        if (exposureResult.liveExposure === 0n) {
          staleAllocationBypass = true;
          warnings.push(
            `Stale allocation bypass: allocation=${allocationResult.formatted} USDC, exposure=0`,
          );
        } else {
          blockers.push(
            `Allocation: ${allocationResult.formatted} USDC, Exposure: ${exposureResult.liveExposureFormatted} USDC`,
          );
        }
      } catch (error) {
        blockers.push(`Allocation: ${allocationResult.formatted} USDC (unable to verify exposure)`);
      }
    }
  } catch (error) {
    blockers.push(`Failed to query allocation: ${error.message}`);
  }

  // Also check exposure if not already done
  if (!details.oldLiveExposure) {
    try {
      const exposureResult = await getAdapterLiveExposure(readProvider, oldAdapter);
      details.oldLiveExposure = {
        safeBalance: exposureResult.safeBalance.toString(),
        adapterBalance: exposureResult.adapterBalance.toString(),
        totalPositionCostBasis: exposureResult.totalPositionCostBasis.toString(),
        totalDeployed: exposureResult.totalDeployed.toString(),
        liveExposure: exposureResult.liveExposure.toString(),
        liveExposureFormatted: exposureResult.liveExposureFormatted,
      };

      if (exposureResult.liveExposure > 0n) {
        blockers.push(`Live exposure: ${exposureResult.liveExposureFormatted} USDC`);
      }
    } catch (error) {
      blockers.push(`Failed to query exposure: ${error.message}`);
    }
  }

  return {
    ready: blockers.length === 0 || staleAllocationBypass,
    blockers,
    warnings,
    details,
    staleAllocationBypass,
  };
}

module.exports = {
  checkSafetyGate,
  checkPhase1Ready,
  checkPhase2Ready,
};
