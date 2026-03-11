/**
 * Identity Resolver for Vault Configurations
 *
 * Resolves environment variable names to actual key/address values.
 * Validates all required fields are present and properly formatted.
 */

import type { VaultInstanceConfig } from "./types.js";

/**
 * Resolved vault identity with actual key/address values (not env var names)
 */
export interface ResolvedVaultIdentity {
  vaultId: number;
  vaultName: string;
  allocatorNavSignerKey: string; // actual private key from env
  safeOperatorKey: string; // actual private key from env
  tradingSignerKey: string; // actual private key from env
  settlerKey?: string; // actual private key from env for settlement operations
  tradingFunderAddress: string; // actual address from env
  tradingSignatureType: 0 | 1 | 2;
  safeAddress: string;
  vaultAddress: string;
  singleSafeMode?: boolean;
  network?: "mainnet" | "amoy";
  tradingSafeAddress?: string;
}

/**
 * Validates that a string is a valid Ethereum private key (0x-prefixed 64-char hex)
 */
function validatePrivateKey(
  value: string | undefined,
  name: string,
  vaultId: number,
  vaultName: string,
): string {
  if (!value) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Missing required private key "${name}". ` +
        `Ensure the corresponding environment variable is set.`,
    );
  }

  // Check 0x prefix
  if (!value.startsWith("0x")) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Private key "${name}" must start with "0x". ` +
        `Got: ${value.slice(0, 10)}...`,
    );
  }

  // Check length (0x + 64 hex chars = 66 chars)
  if (value.length !== 66) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Private key "${name}" must be 66 characters ` +
        `(0x prefix + 64 hex chars). Got: ${value.length} characters`,
    );
  }

  // Check valid hex
  const hexPart = value.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Private key "${name}" contains invalid characters. ` +
        `Must be hex (0-9, a-f, A-F).`,
    );
  }

  return value;
}

/**
 * Validates that a string is a valid Ethereum address (0x-prefixed 40-char hex)
 */
function validateAddress(
  value: string | undefined,
  name: string,
  vaultId: number,
  vaultName: string,
): string {
  if (!value) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Missing required address "${name}". ` +
        `Ensure the corresponding environment variable is set.`,
    );
  }

  // Check 0x prefix
  if (!value.startsWith("0x")) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Address "${name}" must start with "0x". ` +
        `Got: ${value.slice(0, 10)}...`,
    );
  }

  // Check length (0x + 40 hex chars = 42 chars)
  if (value.length !== 42) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Address "${name}" must be 42 characters ` +
        `(0x prefix + 40 hex chars). Got: ${value.length} characters`,
    );
  }

  // Check valid hex
  const hexPart = value.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error(
      `Vault ${vaultId} (${vaultName}): Address "${name}" contains invalid characters. ` +
        `Must be hex (0-9, a-f, A-F).`,
    );
  }

  return value.toLowerCase();
}

/**
 * Resolves a vault configuration's environment variable names to actual values.
 *
 * Reads the following env vars using the *Env field names from config:
 * - allocatorNavSignerKeyEnv -> allocatorNavSignerKey
 * - safeOperatorKeyEnv -> safeOperatorKey
 * - tradingSignerKeyEnv -> tradingSignerKey
 * - settlerKeyEnv -> settlerKey
 * - tradingFunderAddressEnv -> tradingFunderAddress
 *
 * Validates all required fields are present and properly formatted:
 * - Private keys must be 0x-prefixed 64-character hex strings
 * - Addresses must be valid Ethereum addresses
 *
 * @param config - The vault instance configuration with env var names
 * @returns ResolvedVaultIdentity with actual key/address values
 * @throws Error if any required env var is missing or invalid
 */
export function resolveVaultIdentity(config: VaultInstanceConfig): ResolvedVaultIdentity {
  // Read environment variables using the env var names from config
  const allocatorNavSignerKey = process.env[config.allocatorNavSignerKeyEnv];
  const safeOperatorKey = process.env[config.safeOperatorKeyEnv];
  const tradingSignerKey = process.env[config.tradingSignerKeyEnv];

  let tradingFunderAddress: string | undefined;
  if (config.singleSafeMode) {
    tradingFunderAddress = config.tradingFunderAddress;
  } else if (config.tradingFunderAddress) {
    tradingFunderAddress = config.tradingFunderAddress;
  } else {
    tradingFunderAddress = process.env[config.tradingFunderAddressEnv ?? ""];
  }

  // Read settler key from environment
  const settlerKey = config.settlerKeyEnv ? process.env[config.settlerKeyEnv] : undefined;

  // Validate private keys
  const validatedAllocatorKey = validatePrivateKey(
    allocatorNavSignerKey,
    config.allocatorNavSignerKeyEnv,
    config.id,
    config.name,
  );

  const validatedSafeOperatorKey = validatePrivateKey(
    safeOperatorKey,
    config.safeOperatorKeyEnv,
    config.id,
    config.name,
  );

  const validatedTradingKey = validatePrivateKey(
    tradingSignerKey,
    config.tradingSignerKeyEnv,
    config.id,
    config.name,
  );

  const validatedSettlerKey = config.settlerKeyEnv
    ? validatePrivateKey(settlerKey, config.settlerKeyEnv, config.id, config.name)
    : undefined;

  // Validate address
  const addressSource =
    config.singleSafeMode || config.tradingFunderAddress
      ? "tradingFunderAddress (hardcoded)"
      : config.tradingFunderAddressEnv;
  const validatedFunderAddress = validateAddress(
    tradingFunderAddress,
    addressSource ?? "tradingFunderAddress",
    config.id,
    config.name,
  );

  // Return resolved identity with actual values
  return {
    vaultId: config.id,
    vaultName: config.name,
    allocatorNavSignerKey: validatedAllocatorKey,
    safeOperatorKey: validatedSafeOperatorKey,
    tradingSignerKey: validatedTradingKey,
    settlerKey: validatedSettlerKey,
    tradingFunderAddress: validatedFunderAddress,
    tradingSignatureType: config.tradingSignatureType,
    safeAddress: config.safeAddress.toLowerCase(),
    vaultAddress: config.vaultAddress.toLowerCase(),
    singleSafeMode: config.singleSafeMode,
    network: config.network,
    tradingSafeAddress: config.tradingSafeAddress?.toLowerCase(),
  };
}

/**
 * Trading Safe role definitions
 */
export const TradingSafeRole = {
  ADMIN_ROLE: "0xa49807205ce4d355092f5b8a18ee56e666aeb51c", // ADMIN_ROLE for capital operations
  OPERATOR_ROLE: "0x97667070c54efb05df3c70e0bde31b61969fc4f3", // OPERATOR_ROLE for trading
} as const;

/**
 * Resolves the trading safe address from a vault configuration.
 *
 * In dual-safe architecture, the tradingSafeAddress is separate from the main safe.
 * In single-safe mode, returns the main safeAddress.
 *
 * @param config - The vault instance configuration
 * @returns The trading safe address, or undefined if not configured
 * @throws Error if trading safe is required but not configured
 */
export function resolveTradingSafe(config: VaultInstanceConfig): string | undefined {
  // Single-safe mode: main safe handles everything
  if (config.singleSafeMode) {
    return config.safeAddress.toLowerCase();
  }

  // Dual-safe mode: return configured trading safe if present
  if (config.tradingSafeAddress) {
    // Validate address format
    return validateAddress(config.tradingSafeAddress, "tradingSafeAddress", config.id, config.name);
  }

  // No trading safe configured - this is valid for non-trading vaults
  return undefined;
}

/**
 * Validates that resolved addresses match the expected network.
 *
 * Mainnet addresses start with 0x and are 42 characters (standard Ethereum).
 * Amoy testnet uses the same address format, so we validate based on:
 * - Known contract addresses for each network
 * - Config-specified network field
 *
 * @param identity - The resolved vault identity
 * @param expectedNetwork - The expected network ("mainnet" | "amoy")
 * @throws Error if addresses don't match expected network
 */
export function validateNetworkMatch(
  identity: ResolvedVaultIdentity,
  expectedNetwork: "mainnet" | "amoy" = "mainnet",
): void {
  const actualNetwork = identity.network ?? "mainnet";

  if (actualNetwork !== expectedNetwork) {
    throw new Error(
      `Vault ${identity.vaultId} (${identity.vaultName}): Network mismatch. ` +
        `Expected ${expectedNetwork} but config specifies ${actualNetwork}`,
    );
  }

  // Note: Address format validation happens during resolution
  // Additional network-specific validation can be added here if needed
  // e.g., checking against known mainnet/amoy contract addresses
}

/**
 * Validates that the trading safe has the required roles for operations.
 *
 * In dual-safe architecture, the trading safe must have:
 * - ADMIN_ROLE for capital operations (allocations, large transfers)
 * - OPERATOR_ROLE for trading operations
 *
 * This is a static validation - on-chain role verification happens at runtime.
 *
 * @param tradingSafeAddress - The trading safe address
 * @param requiredRoles - Array of required role hashes (defaults to [ADMIN_ROLE])
 * @returns Object with validation result and details
 */
export function validateTradingSafeRoles(
  tradingSafeAddress: string | undefined,
  requiredRoles: string[] = [TradingSafeRole.ADMIN_ROLE],
): {
  valid: boolean;
  missingRoles: string[];
  details: string;
} {
  if (!tradingSafeAddress) {
    return {
      valid: false,
      missingRoles: requiredRoles,
      details: "Trading safe address not configured",
    };
  }

  // Static validation - ensure address format is valid
  // Note: Actual on-chain role verification requires contract calls
  const isValidAddress =
    tradingSafeAddress.startsWith("0x") &&
    tradingSafeAddress.length === 42 &&
    /^[0-9a-fA-F]+$/.test(tradingSafeAddress.slice(2));

  if (!isValidAddress) {
    return {
      valid: false,
      missingRoles: requiredRoles,
      details: `Invalid trading safe address format: ${tradingSafeAddress}`,
    };
  }

  // For dual-safe configs, we expect ADMIN_ROLE to be granted
  // The actual role check happens at runtime via contract calls
  return {
    valid: true,
    missingRoles: [],
    details:
      `Trading safe ${tradingSafeAddress} has valid format. ` +
      `Required roles: ${requiredRoles.join(", ")}. ` +
      "On-chain verification required at runtime.",
  };
}

/**
 * Complete vault identity resolution with dual-safe support.
 *
 * Resolves all addresses and keys, validates network consistency,
 * and checks trading safe configuration.
 *
 * @param config - The vault instance configuration
 * @param expectedNetwork - Optional network to validate against
 * @returns Resolved identity with trading safe information
 * @throws Error if resolution or validation fails
 */
export function resolveVaultIdentityComplete(
  config: VaultInstanceConfig,
  expectedNetwork?: "mainnet" | "amoy",
): ResolvedVaultIdentity & {
  tradingSafeRoleValidation: ReturnType<typeof validateTradingSafeRoles>;
} {
  // Resolve base identity
  const identity = resolveVaultIdentity(config);

  // Validate network if specified
  if (expectedNetwork) {
    validateNetworkMatch(identity, expectedNetwork);
  }

  // Resolve and validate trading safe
  const tradingSafeAddress = resolveTradingSafe(config);
  const tradingSafeRoleValidation = validateTradingSafeRoles(tradingSafeAddress, [
    TradingSafeRole.ADMIN_ROLE,
    TradingSafeRole.OPERATOR_ROLE,
  ]);

  return {
    ...identity,
    tradingSafeRoleValidation,
  };
}
