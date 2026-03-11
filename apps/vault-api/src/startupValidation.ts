/**
 * Startup Validation Module
 *
 * Performs early validation of the runtime environment before the application
 * starts accepting requests or running workers.
 *
 * This module ensures:
 * - RPC chain ID matches the configured VAULT_NETWORK
 * - Required environment variables are present
 * - Network configuration is consistent
 *
 * All validations are designed to fail fast with clear error messages.
 */

import { logger } from "./logger.js";
import {
  validateNetworkConfiguration,
  getNetworkConfigFromEnv,
  type NetworkType,
} from "./config/network.js";

/**
 * Result of startup validation
 */
export interface ValidationResult {
  success: boolean;
  errors: string[];
}

/**
 * Run all startup validations
 *
 * This should be called as early as possible in the boot process.
 * If validation fails, the application should exit immediately.
 *
 * @throws Error if any validation fails
 */
export async function runStartupValidation(): Promise<void> {
  logger.info("StartupValidation: Beginning startup validation...");

  const errors: string[] = [];

  // Validate 1: Network configuration (RPC chain ID matches VAULT_NETWORK)
  try {
    await validateNetworkConfiguration();
    const networkConfig = getNetworkConfigFromEnv();
    logger.info("StartupValidation: Network configuration validated", {
      network: networkConfig.name,
      chainId: networkConfig.chainId,
      supportsPolymarketTrading: networkConfig.supportsPolymarketTrading,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Network validation failed: ${message}`);
  }

  // If any validations failed, throw with all errors
  if (errors.length > 0) {
    logger.error("StartupValidation: Validation failed", { errors });
    throw new Error(
      `Startup validation failed with ${errors.length} error(s):\n` +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }

  logger.info("StartupValidation: All startup validations passed");
}

/**
 * Run startup validation synchronously (for use in top-level await contexts)
 *
 * This is a convenience wrapper that handles the async nature of validation.
 * It will exit the process on validation failure.
 */
export async function runStartupValidationOrExit(): Promise<void> {
  try {
    await runStartupValidation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("StartupValidation: Critical validation failure - exiting", {
      error: message,
    });
    console.error(`\n❌ STARTUP VALIDATION FAILED\n${message}\n`);
    process.exit(1);
  }
}

/**
 * Get a summary of the current network configuration
 * Useful for logging at startup
 */
export function getNetworkSummary(): {
  network: NetworkType;
  chainId: number;
  displayName: string;
  rpcUrl: string;
  supportsPolymarketTrading: boolean;
} {
  const config = getNetworkConfigFromEnv();
  return {
    network: config.name,
    chainId: config.chainId,
    displayName: config.displayName,
    rpcUrl: config.defaultRpcUrl,
    supportsPolymarketTrading: config.supportsPolymarketTrading,
  };
}
