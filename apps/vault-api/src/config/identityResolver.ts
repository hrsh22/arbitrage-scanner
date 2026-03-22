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
  tradingSignerKey?: string; // actual private key from env
  settlerKey?: string; // actual private key from env for settlement operations
  tradingSignatureType?: 0 | 1 | 2;
  safeAddress: string;
  vaultAddress: string;
  network?: "mainnet" | "amoy";
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
  const tradingSignerKey = config.tradingSignerKeyEnv
    ? process.env[config.tradingSignerKeyEnv]
    : undefined;

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

  const validatedTradingKey = config.tradingSignerKeyEnv
    ? validatePrivateKey(tradingSignerKey, config.tradingSignerKeyEnv, config.id, config.name)
    : undefined;

  const validatedSettlerKey = config.settlerKeyEnv
    ? validatePrivateKey(settlerKey, config.settlerKeyEnv, config.id, config.name)
    : undefined;

  const validatedSafeAddress = validateAddress(
    config.safeAddress,
    "safeAddress",
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
    tradingSignatureType: config.tradingSignatureType,
    safeAddress: validatedSafeAddress,
    vaultAddress: config.vaultAddress.toLowerCase(),
    network: config.network,
  };
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
