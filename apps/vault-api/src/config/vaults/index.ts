import type { VaultInstanceConfig } from "../types.js";
import vault1Pph from "./vault1-pph.js";
import vault2WeeklyEpochProd from "./vault2-weekly-epoch-prod.js";
import vault3WeeklyEpochStaging from "./vault3-weekly-epoch-staging.js";
import vault4WeeklyEpochTest from "./vault4-weekly-epoch-test.js";
import { isAddress } from "viem";

export const VAULT_CONFIGS: VaultInstanceConfig[] = [
  vault1Pph,
  vault2WeeklyEpochProd,
  vault3WeeklyEpochStaging,
  vault4WeeklyEpochTest,
];

function validateConfigs(configs: VaultInstanceConfig[]): void {
  if (configs.length === 0) {
    throw new Error("No vault configurations defined. Add at least one vault to VAULT_CONFIGS.");
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

    if (!Number.isInteger(config.marketFetchMaxEvents) || config.marketFetchMaxEvents < 1) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): marketFetchMaxEvents must be an integer >= 1`,
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

    // Validate tradingSignerKeyEnv
    if (typeof config.tradingSignerKeyEnv !== "string" || config.tradingSignerKeyEnv === "") {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): tradingSignerKeyEnv must be a non-empty string`,
      );
    }

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

    // Validate trading funder address (either hardcoded or from env)
    let tradingFunderAddress: string;
    if (config.singleSafeMode) {
      // Single-Safe mode: address must be hardcoded and match safeAddress
      if (!config.tradingFunderAddress) {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): singleSafeMode enabled but tradingFunderAddress is missing`,
        );
      }
      if (!isAddress(config.tradingFunderAddress)) {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): tradingFunderAddress must be a valid address`,
        );
      }
      if (config.tradingFunderAddress.toLowerCase() !== config.safeAddress.toLowerCase()) {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): singleSafeMode requires tradingFunderAddress to match safeAddress`,
        );
      }
      if (config.tradingSignatureType !== 2) {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): singleSafeMode requires tradingSignatureType to be 2 (Safe)`,
        );
      }
      tradingFunderAddress = config.tradingFunderAddress;
    } else {
      // Standard mode: address from env var
      if (
        typeof config.tradingFunderAddressEnv !== "string" ||
        config.tradingFunderAddressEnv === ""
      ) {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): tradingFunderAddressEnv must be a non-empty string`,
        );
      }
      const addressFromEnv = process.env[config.tradingFunderAddressEnv];
      if (typeof addressFromEnv !== "string" || addressFromEnv === "") {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): Missing required env var ${config.tradingFunderAddressEnv}`,
        );
      }
      if (!isAddress(addressFromEnv)) {
        throw new Error(
          `Vault "${config.name}" (ID: ${config.id}): ${config.tradingFunderAddressEnv} must be a valid address`,
        );
      }
      tradingFunderAddress = addressFromEnv;
    }

    // Validate tradingSignatureType
    if (![0, 1, 2].includes(config.tradingSignatureType)) {
      throw new Error(
        `Vault "${config.name}" (ID: ${config.id}): tradingSignatureType must be 0, 1, or 2, got ${config.tradingSignatureType}`,
      );
    }
  }
}

validateConfigs(VAULT_CONFIGS);
