import { beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";

import {
  VaultProviderFactory,
  getVaultProviderFactory,
  getVaultProvider,
} from "../services/vaultProviderFactory.js";
import { CustomVaultProvider } from "../services/customVaultProvider.js";
import type { VaultProviderConfig } from "../services/vaultProvider.js";

const TEST_VAULT_ADDRESS = "0x066A4678935b78FA4E89e914dBE8F077764F0c74" as Address;

const createCustomProviderConfig = (vaultId: number): VaultProviderConfig => ({
  vaultId,
  vaultAddress: TEST_VAULT_ADDRESS,
  providerType: "custom",
  customConfig: {
    epochDurationSeconds: 604800,
    navStalenessThresholdSeconds: 21600,
  },
});

describe("VaultProviderFactory (custom-only)", () => {
  let factory: VaultProviderFactory;

  beforeEach(() => {
    VaultProviderFactory.resetInstance();
    factory = VaultProviderFactory.getInstance();
  });

  it("registers and routes custom provider", () => {
    factory.registerProvider(createCustomProviderConfig(1));

    expect(factory.hasProvider(1)).toBe(true);
    expect(factory.getProviderType(1)).toBe("custom");

    const provider = factory.getProvider(1);
    expect(provider).toBeInstanceOf(CustomVaultProvider);
    expect(provider.providerType).toBe("custom");
  });

  it("throws for unsupported provider type at runtime", () => {
    const invalidConfig = {
      vaultId: 2,
      vaultAddress: TEST_VAULT_ADDRESS,
      providerType: "invalid" as const,
    } as unknown as VaultProviderConfig;

    factory.registerProvider(invalidConfig);

    expect(() => factory.getProvider(2)).toThrow("Unsupported provider type");
  });

  it("getProviders and getAllProviders filter invalid entries", () => {
    factory.registerProvider(createCustomProviderConfig(1));
    factory.registerProvider({
      vaultId: 2,
      vaultAddress: TEST_VAULT_ADDRESS,
      providerType: "invalid" as const,
    } as unknown as VaultProviderConfig);

    const picked = factory.getProviders([1, 2, 999]);
    expect(picked.size).toBe(1);
    expect(picked.has(1)).toBe(true);

    const all = factory.getAllProviders();
    expect(all.size).toBe(1);
  });

  it("keeps singleton semantics", () => {
    const a = VaultProviderFactory.getInstance();
    const b = VaultProviderFactory.getInstance();
    expect(a).toBe(b);
  });
});

describe("Provider convenience functions", () => {
  beforeEach(() => {
    VaultProviderFactory.resetInstance();
  });

  it("getVaultProviderFactory returns singleton", () => {
    const a = getVaultProviderFactory();
    const b = getVaultProviderFactory();
    expect(a).toBe(b);
  });

  it("getVaultProvider resolves custom provider", () => {
    const factory = getVaultProviderFactory();
    factory.registerProvider(createCustomProviderConfig(1));

    const provider = getVaultProvider(1);
    expect(provider).toBeInstanceOf(CustomVaultProvider);
    expect(provider.providerType).toBe("custom");
  });
});
