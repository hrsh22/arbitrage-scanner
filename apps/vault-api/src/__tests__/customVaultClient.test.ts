/**
 * Custom Vault Client Tests
 *
 * Tests for the CustomVaultClient contract interaction layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PublicClient, WalletClient } from "viem";
import {
  CustomVaultClient,
  WEEKLY_EPOCH_VAULT_ABI,
  parseContractError,
} from "../services/customVaultClient.js";

// Mock viem
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(),
    createWalletClient: vi.fn(),
    http: vi.fn(),
  };
});

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("CustomVaultClient", () => {
  const mockVaultAddress = "0x1234567890123456789012345678901234567890" as `0x${string}`;
  const mockRpcUrl = "https://polygon-rpc.com";

  let client: CustomVaultClient;
  let mockPublicClient: Partial<PublicClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPublicClient = {
      readContract: vi.fn() as unknown as PublicClient["readContract"],
      waitForTransactionReceipt: vi.fn(),
    };

    client = new CustomVaultClient({
      vaultAddress: mockVaultAddress,
      rpcUrl: mockRpcUrl,
    });

    // Access the private publicClient for testing
    (client as unknown as { publicClient: Partial<PublicClient> }).publicClient = mockPublicClient;
  });

  describe("getAsset", () => {
    it("should return the asset address", async () => {
      const mockAsset = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(mockAsset);

      const result = await client.getAsset();

      expect(result).toBe(mockAsset);
      expect(mockPublicClient.readContract).toHaveBeenCalledWith({
        address: mockVaultAddress,
        abi: WEEKLY_EPOCH_VAULT_ABI,
        functionName: "asset",
      });
    });
  });

  describe("getVaultConfig", () => {
    it("should return vault configuration", async () => {
      (mockPublicClient.readContract as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(604800n)
        .mockResolvedValueOnce(21600n);

      const result = await client.getVaultConfig();

      expect(result).toEqual({
        deployTime: 604800n,
        navStalenessThreshold: 21600n,
      });
    });
  });

  describe("getNAVStatus", () => {
    it("should return NAV status with freshness check", async () => {
      (mockPublicClient.readContract as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(1000000000000n) // lastNAV
        .mockResolvedValueOnce(1700003600n) // lastNAVUpdate
        .mockResolvedValueOnce(true); // isNAVFresh

      const result = await client.getNAVStatus();

      expect(result).toEqual({
        lastNAV: 1000000000000n,
        lastNAVUpdate: 1700003600n,
        isFresh: true,
      });
    });
  });

  describe("getRequest", () => {
    it("should return request data for valid request", async () => {
      const mockRequest = {
        requestId: 1n,
        user: "0x1234567890123456789012345678901234567890" as `0x${string}`,
        shares: 1000000000000000000n,
        epochId: 5n,
        status: 0, // Pending
        createdAt: 1700000000n,
        claimableAssets: 0n,
      };

      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(mockRequest);

      const result = await client.getRequest(1n);

      expect(result).toEqual(mockRequest);
    });

    it("should return null for non-existent request (requestId = 0)", async () => {
      const mockRequest = {
        requestId: 0n,
        user: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        shares: 0n,
        epochId: 0n,
        status: 0,
        createdAt: 0n,
        claimableAssets: 0n,
      };

      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(mockRequest);

      const result = await client.getRequest(999n);

      expect(result).toBeNull();
    });
  });

  describe("getUserRequestIds", () => {
    it("should return array of request IDs for user", async () => {
      const mockRequestIds = [1n, 2n, 3n];
      const userAddress = "0x1234567890123456789012345678901234567890" as `0x${string}`;

      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(mockRequestIds);

      const result = await client.getUserRequestIds(userAddress);

      expect(result).toEqual(mockRequestIds);
    });
  });

  describe("getCurrentEpoch", () => {
    it("should return current epoch number", async () => {
      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(10n);

      const result = await client.getCurrentEpoch();

      expect(result).toBe(10n);
    });
  });

  describe("getEpochEnd", () => {
    it("should return epoch end timestamp", async () => {
      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(1700604800n);

      const result = await client.getEpochEnd(5n);

      expect(result).toBe(1700604800n);
    });
  });

  describe("canSettleEpoch", () => {
    it("should return true when epoch can be settled", async () => {
      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const result = await client.canSettleEpoch(5n);

      expect(result).toBe(true);
    });
  });

  describe("isRequestClaimable", () => {
    it("should return true for settled request (status = 2)", async () => {
      const mockRequest = {
        requestId: 1n,
        user: "0x1234567890123456789012345678901234567890" as `0x${string}`,
        shares: 1000000000000000000n,
        epochId: 5n,
        status: 2, // Settled
        createdAt: 1700000000n,
        claimableAssets: 1000000n,
      };

      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(mockRequest);

      const result = await client.isRequestClaimable(1n);

      expect(result).toBe(true);
    });

    it("should return false for pending request (status = 0)", async () => {
      const mockRequest = {
        requestId: 1n,
        user: "0x1234567890123456789012345678901234567890" as `0x${string}`,
        shares: 1000000000000000000n,
        epochId: 5n,
        status: 0, // Pending
        createdAt: 1700000000n,
        claimableAssets: 0n,
      };

      (mockPublicClient.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(mockRequest);

      const result = await client.isRequestClaimable(1n);

      expect(result).toBe(false);
    });
  });

  describe("getEpochStatus", () => {
    it("should return formatted epoch status", async () => {
      (mockPublicClient.readContract as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(1700604800n) // epochEnd
        .mockResolvedValueOnce([
          // settlementStatus tuple
          {
            totalShares: 1000000000000000000n,
            totalProcessed: 5n,
            settled: true,
            proRataRatio: 1000000000000000000n,
            availableAssets: 1000000n,
          },
          5n,
          5n,
        ])
        .mockResolvedValueOnce([1n, 2n, 3n, 4n, 5n]) // requestIds
        .mockResolvedValueOnce(604800n)
        .mockResolvedValueOnce(1700000000n)
        .mockResolvedValueOnce(21600n);

      const result = await client.getEpochStatus(5n);

      expect(result).not.toBeNull();
      expect(result?.epochId).toBe(5n);
      expect(result?.settled).toBe(true);
      expect(result?.totalRequests).toBe(5);
    });
  });
});

describe("parseContractError", () => {
  it("should map known contract errors to user-friendly messages", () => {
    const error = new Error("NAVStale");
    expect(parseContractError(error)).toBe("NAV is stale - settlement requires fresh NAV");
  });

  it("should return original message for unknown errors", () => {
    const error = new Error("Unknown error");
    expect(parseContractError(error)).toBe("Unknown error");
  });

  it("should handle non-Error objects", () => {
    expect(parseContractError("string error")).toBe("Unknown error");
  });
});
