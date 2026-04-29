import type { VaultInstanceConfig, VaultNetwork } from "../types.js";
import { isAddress } from "viem";
import * as amoyModule from "./amoy/index.js";
import * as mainnetModule from "./mainnet/index.js";

/**
 * Determine which network to load vault configs for.
 * Defaults to "mainnet" if not specified.
 */
function getVaultNetwork(): VaultNetwork {
  const network = process.env.VAULT_NETWORK || "mainnet";
  if (network !== "mainnet" && network !== "amoy") {
    throw new Error(`Invalid VAULT_NETWORK: "${network}". Must be either "mainnet" or "amoy"`);
  }
  return network;
}

/**
 * Dynamically load vault configs based on the current network.
 */
function loadVaultConfigs(network: VaultNetwork): VaultInstanceConfig[] {
  if (network === "amoy") {
    return Object.values(amoyModule).filter(
      (config): config is VaultInstanceConfig =>
        config !== null && typeof config === "object" && "id" in config,
    );
  } else {
    return Object.values(mainnetModule).filter(
      (config): config is VaultInstanceConfig =>
        config !== null && typeof config === "object" && "id" in config,
    );
  }
}

const NETWORK = getVaultNetwork();

/**
 * All vault configurations for the current network.
 * Loaded dynamically based on VAULT_NETWORK env var.
 */
export const VAULT_CONFIGS: VaultInstanceConfig[] = loadVaultConfigs(NETWORK);

/**
 * Current network being used for vault configs.
 */
export const CURRENT_VAULT_NETWORK: VaultNetwork = NETWORK;

function validateConfigs(configs: VaultInstanceConfig[]): void {
  if (configs.length === 0) {
    throw new Error(
      `No vault configurations defined for network "${NETWORK}". Add at least one vault to VAULT_CONFIGS.`,
    );
  }

  const ids = new Set<number>();
  for (const config of configs) {
    if (ids.has(config.id)) {
      throw new Error(`Duplicate vault ID: ${config.id}. Each vault must have a unique ID.`);
    }
    ids.add(config.id);
  }

  const names = new Set<string>();
  for (const config of configs) {
    if (names.has(config.name)) {
      throw new Error(
        `Duplicate vault name: "${config.name}". Each vault must have a unique name.`,
      );
    }
    names.add(config.name);
  }

  const slugs = new Set<string>();
  for (const config of configs) {
    if (!config.slug || typeof config.slug !== "string") {
      throw new Error(`Vault ID ${config.id}: slug must be a non-empty string`);
    }

    if (slugs.has(config.slug)) {
      throw new Error(
        `Duplicate vault slug: "${config.slug}". Each vault must have a unique slug.`,
      );
    }

    slugs.add(config.slug);
  }

  const vaultAddresses = new Set<string>();
  for (const config of configs) {
    if (vaultAddresses.has(config.vaultAddress)) {
      throw new Error(
        `Duplicate vault address: "${config.vaultAddress}". Each vault must have a unique vault address.`,
      );
    }
    vaultAddresses.add(config.vaultAddress);
  }

  for (const config of configs) {
    if (!config.profile) {
      throw new Error(`Vault "${config.name}" (ID: ${config.id}): profile is required`);
    }

    if (!config.profile.strategy || !config.profile.strategyLabel) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): profile.strategy and profile.strategyLabel are required`,
      );
    }

    if (!config.profile.description || !config.profile.longDescription) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): profile.description and profile.longDescription are required`,
      );
    }

    if (!Number.isFinite(config.profile.minDeposit) || config.profile.minDeposit < 0) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): profile.minDeposit must be a finite number >= 0`,
      );
    }

    if (!Number.isFinite(config.profile.maxDeposit) || config.profile.maxDeposit <= 0) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): profile.maxDeposit must be a finite number > 0`,
      );
    }

    if (config.profile.maxDeposit < config.profile.minDeposit) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): profile.maxDeposit must be >= profile.minDeposit`,
      );
    }

    if (!config.vaultAddress || !isAddress(config.vaultAddress)) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): vaultAddress is invalid: ${config.vaultAddress}`,
      );
    }

    if (config.type !== "custom") {
      throw new Error(`Vault "${config.name}" (ID: ${config.id}): only type "custom" is supported`);
    }

    if (!config.safeAddress || !isAddress(config.safeAddress)) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): safeAddress is invalid: ${config.safeAddress}`,
      );
    }

    if (!Number.isFinite(config.vaultReserveUsdc) || config.vaultReserveUsdc < 0) {
      throw new Error(`Vault "${config.name}" (ID: ${config.id}): vaultReserveUsdc must be >= 0`);
    }

    if (!Number.isFinite(config.minAllocationAmountUsdc) || config.minAllocationAmountUsdc < 0) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): minAllocationAmountUsdc must be >= 0`,
      );
    }

    if (
      !Number.isFinite(config.maxDeployedRatio) ||
      config.maxDeployedRatio < 0 ||
      config.maxDeployedRatio > 1
    ) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): maxDeployedRatio must be between 0 and 1`,
      );
    }

    if (!config.enabled) continue;

    // Validate allocatorNavSignerKeyEnv
    if (
      typeof config.allocatorNavSignerKeyEnv !== "string" ||
      config.allocatorNavSignerKeyEnv === ""
    ) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): allocatorNavSignerKeyEnv must be a non-empty string`,
      );
    }

    const allocatorNavKey = process.env[config.allocatorNavSignerKeyEnv];
    if (typeof allocatorNavKey !== "string" || allocatorNavKey === "") {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): Missing required env var ${config.allocatorNavSignerKeyEnv}`,
      );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(allocatorNavKey)) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): ${config.allocatorNavSignerKeyEnv} must be a 32-byte hex value`,
      );
    }

    // Validate safeOperatorKeyEnv
    if (typeof config.safeOperatorKeyEnv !== "string" || config.safeOperatorKeyEnv === "") {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): safeOperatorKeyEnv must be a non-empty string`,
      );
    }

    const safeOperatorKey = process.env[config.safeOperatorKeyEnv];
    if (typeof safeOperatorKey !== "string" || safeOperatorKey === "") {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): Missing required env var ${config.safeOperatorKeyEnv}`,
      );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(safeOperatorKey)) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): ${config.safeOperatorKeyEnv} must be a 32-byte hex value`,
      );
    }

    if (
      config.tradingSignerKeyEnv !== undefined &&
      (typeof config.tradingSignerKeyEnv !== "string" || config.tradingSignerKeyEnv === "")
    ) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): tradingSignerKeyEnv must be a non-empty string when provided`,
      );
    }

    if (config.tradingSignerKeyEnv) {
      const tradingSignerKey = process.env[config.tradingSignerKeyEnv];
      if (typeof tradingSignerKey !== "string" || tradingSignerKey === "") {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): Missing required env var ${config.tradingSignerKeyEnv}`,
        );
      }
      if (!/^0x[0-9a-fA-F]{64}$/.test(tradingSignerKey)) {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): ${config.tradingSignerKeyEnv} must be a 32-byte hex value`,
        );
      }
    }

    if (
      config.tradingSignatureType !== undefined &&
      ![0, 1, 2, 3].includes(config.tradingSignatureType)
    ) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): tradingSignatureType must be 0, 1, 2, or 3, got ${config.tradingSignatureType}`,
      );
    }
  }
}

validateConfigs(VAULT_CONFIGS);
