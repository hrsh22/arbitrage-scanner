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
  settlerKey: string; // actual private key from env for settlement operations
  tradingFunderAddress: string; // actual address from env
  tradingSignatureType: 0 | 1 | 2;
  safeAddress: string;
  vaultAddress: string;
  singleSafeMode?: boolean;
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

  // Determine trading funder address (hardcoded in single-Safe mode, else from env)
  let tradingFunderAddress: string | undefined;
  if (config.singleSafeMode) {
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

  const validatedSettlerKey = validatePrivateKey(
    settlerKey,
    config.settlerKeyEnv ?? '',
    config.id,
    config.name,
  );

  // Validate address
  const addressSource = config.singleSafeMode
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
  };
}
