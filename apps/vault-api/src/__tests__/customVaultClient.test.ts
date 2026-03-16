import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, WalletClient } from "viem";

const { mockReadContract, mockWaitForTransactionReceipt, mockCreatePublicClient } = vi.hoisted(
  () => {
    const readContract = vi.fn();
    const waitForTransactionReceipt = vi.fn();
    const createPublicClient = vi.fn(() => ({
      readContract,
      waitForTransactionReceipt,
    }));

    return {
      mockReadContract: readContract,
      mockWaitForTransactionReceipt: waitForTransactionReceipt,
      mockCreatePublicClient: createPublicClient,
    };
  },
);

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: mockCreatePublicClient,
    http: vi.fn(() => ({})),
  };
});

import {
  CustomVaultClient,
  FLAT_BOOK_VAULT_V2_ABI,
  parseContractError,
} from "../services/customVaultClient.js";

const VAULT_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const CONTROLLER = "0x00000000000000000000000000000000000000aa" as Address;

describe("CustomVaultClient (FlatBookVaultV2)", () => {
  let client: CustomVaultClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CustomVaultClient({
      vaultAddress: VAULT_ADDRESS,
      rpcUrl: "https://rpc.example.test",
    });
  });

  it("reads NAV status from V2 view functions", async () => {
    mockReadContract
      .mockResolvedValueOnce(1100000000000000000n)
      .mockResolvedValueOnce(1700000000n)
      .mockResolvedValueOnce(true);

    const navStatus = await client.getNAVStatus();

    expect(navStatus).toEqual({
      currentNAV: 1100000000000000000n,
      lastNAVUpdate: 1700000000n,
      isFresh: true,
    });
    expect(mockReadContract).toHaveBeenCalledTimes(3);
    expect(mockReadContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: VAULT_ADDRESS,
        abi: FLAT_BOOK_VAULT_V2_ABI,
        functionName: "currentNAV",
        args: [],
      }),
    );
    expect(mockReadContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "lastNAVUpdate",
      }),
    );
    expect(mockReadContract).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        functionName: "isNAVFresh",
      }),
    );
  });

  it("maps current cycle state to open batch status", async () => {
    mockReadContract
      .mockResolvedValueOnce(3n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(1050000000000000000n)
      .mockResolvedValueOnce(1700000100n)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([0n, 5000000n, 2000000n, 2000000n, 0n, 0n, 0n, false, false, false]);

    const batch = await client.getBatch(3n);

    expect(batch).not.toBeNull();
    expect(batch?.status).toBe("open");
    expect(batch?.batchId).toBe(3n);
    expect(batch?.totalQueuedDeposits).toBe(5000000n);
    expect(batch?.isPriceLocked).toBe(false);
  });

  it("maps processing state to flattening until cursors complete", async () => {
    mockReadContract
      .mockResolvedValueOnce(8n)
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce(1010000000000000000n)
      .mockResolvedValueOnce(1700000500n)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([
        1010000000000000000n,
        0n,
        7000000n,
        7100000n,
        1n,
        4n,
        1700000400n,
        false,
        false,
        false,
      ]);

    const batch = await client.getBatch(8n);

    expect(batch).not.toBeNull();
    expect(batch?.status).toBe("flattening");
    expect(batch?.isPriceLocked).toBe(true);
    expect(batch?.lockedClearingPrice).toBe(1010000000000000000n);
  });

  it("closes the book before beginProcessing when state is returned as bigint open", async () => {
    mockReadContract.mockResolvedValueOnce(0n);
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const writeContract = vi.fn().mockResolvedValueOnce("0xclose").mockResolvedValueOnce("0xbegin");
    const walletClient = {
      writeContract,
      chain: { id: 137 },
      account: { address: CONTROLLER },
    } as unknown as WalletClient;

    const result = await client.flattenBatch(walletClient, "0x0" as Hex);

    expect(writeContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ functionName: "closeBook" }),
    );
    expect(writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ functionName: "beginProcessing" }),
    );
    expect(result).toEqual({ success: true, txHash: "0xbegin" });
  });

  it("returns synthetic controller request id when pending or claimable redeem exists", async () => {
    mockReadContract
      .mockResolvedValueOnce(5n)
      .mockResolvedValueOnce(5n)
      .mockResolvedValueOnce(1200000n)
      .mockResolvedValueOnce(0n);

    const requestIds = await client.getControllerRequestIds(CONTROLLER);

    expect(requestIds).toHaveLength(1);
    const cycleFactor = 10000000000000000000000000000000000000000n;
    const expected = BigInt(CONTROLLER.toLowerCase()) + 5n * cycleFactor;
    expect(requestIds[0]).toBe(expected);
  });

  it("writes transactions and surfaces parsed contract errors", async () => {
    const writeContract = vi.fn().mockRejectedValue(new Error("InvalidState"));
    const walletClient = {
      writeContract,
      chain: { id: 137 },
      account: { address: CONTROLLER },
    } as unknown as WalletClient;

    const result = await client.allocateToTradingWallet(walletClient, 1000000n);

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: VAULT_ADDRESS,
        abi: FLAT_BOOK_VAULT_V2_ABI,
        functionName: "allocateToTradingWallet",
        args: [1000000n],
      }),
    );
    expect(result).toEqual({
      success: false,
      error: "Operation not available in current vault state",
    });
  });

  it("parses known contract revert signatures", () => {
    expect(parseContractError(new Error("NAVStale"))).toBe(
      "NAV is stale - settlement requires fresh NAV",
    );
    expect(parseContractError(new Error("InsufficientLiquidityForProcessing"))).toBe(
      "Insufficient liquidity to start processing",
    );
    expect(parseContractError(new Error("AccessControlUnauthorizedAccount"))).toBe(
      "Signer is missing the required on-chain role",
    );
    expect(parseContractError(new Error("AllocationExceedsAvailable"))).toBe(
      "Allocation exceeds currently available vault assets",
    );
    expect(parseContractError(new Error("something else"))).toBe("something else");
  });

  it("waits for transaction receipt successfully", async () => {
    const txHash = "0x1234" as Hex;
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const result = await client.waitForTransaction(txHash);

    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith({ hash: txHash });
    expect(result).toEqual({ success: true });
  });
});
