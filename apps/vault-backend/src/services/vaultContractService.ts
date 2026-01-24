import { createPublicClient, createWalletClient, http, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { env, getRpcUrl } from "../env.js";
import { logger } from "../logger.js";

const PREDICTION_VAULT_ABI = [
  {
    name: "submitClaimRoot",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "root", type: "bytes32" },
      { name: "totalClaimable", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "updateNav",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newTotalAssets", type: "uint256" }],
    outputs: [],
  },
  {
    name: "withdrawalRequests",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "ownershipBps", type: "uint256" },
      { name: "assetsReserved", type: "uint256" },
      { name: "requestedAt", type: "uint256" },
      { name: "totalClaimable", type: "uint256" },
      { name: "claimed", type: "uint256" },
      { name: "finalized", type: "bool" },
    ],
  },
  {
    name: "claimRoots",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "navPerShare",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalLockedShares",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalLockedAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export class VaultContractService {
  private contractAddress: Hex;
  private publicClient;
  private walletClient;

  constructor(contractAddress: string) {
    this.contractAddress = contractAddress as Hex;
    const rpcUrl = getRpcUrl();

    this.publicClient = createPublicClient({
      chain: polygon,
      transport: http(rpcUrl),
    });

    if (env.TRADING_WALLET_PRIVATE_KEY) {
      const account = privateKeyToAccount(
        (env.TRADING_WALLET_PRIVATE_KEY.startsWith("0x")
          ? env.TRADING_WALLET_PRIVATE_KEY
          : `0x${env.TRADING_WALLET_PRIVATE_KEY}`) as Hex,
      );
      this.walletClient = createWalletClient({
        account,
        chain: polygon,
        transport: http(rpcUrl),
      });
    }
  }

  async submitClaimRoot(
    requestId: number,
    root: `0x${string}`,
    totalClaimable: bigint,
  ): Promise<{ hash: string; success: boolean }> {
    if (!this.walletClient) {
      throw new Error("Wallet not configured - TRADING_WALLET_PRIVATE_KEY required");
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_ABI,
        functionName: "submitClaimRoot",
        args: [BigInt(requestId), root, totalClaimable],
      });

      logger.info("Claim root submitted to contract", {
        requestId,
        root,
        totalClaimable: totalClaimable.toString(),
        hash,
      });

      return { hash, success: true };
    } catch (error) {
      logger.error("Failed to submit claim root", {
        requestId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateNav(newTotalAssets: bigint): Promise<{ hash: string; success: boolean }> {
    if (!this.walletClient) {
      throw new Error("Wallet not configured - TRADING_WALLET_PRIVATE_KEY required");
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_ABI,
        functionName: "updateNav",
        args: [newTotalAssets],
      });

      logger.info("NAV updated on contract", {
        newTotalAssets: newTotalAssets.toString(),
        hash,
      });

      return { hash, success: true };
    } catch (error) {
      logger.error("Failed to update NAV", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getWithdrawalRequest(requestId: number): Promise<{
    user: string;
    shares: bigint;
    ownershipBps: bigint;
    assetsReserved: bigint;
    requestedAt: bigint;
    totalClaimable: bigint;
    claimed: bigint;
    finalized: boolean;
  }> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_ABI,
      functionName: "withdrawalRequests",
      args: [BigInt(requestId)],
    });

    return {
      user: result[0],
      shares: result[1],
      ownershipBps: result[2],
      assetsReserved: result[3],
      requestedAt: result[4],
      totalClaimable: result[5],
      claimed: result[6],
      finalized: result[7],
    };
  }

  async getClaimRoot(requestId: number): Promise<`0x${string}`> {
    return await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_ABI,
      functionName: "claimRoots",
      args: [BigInt(requestId)],
    });
  }

  async getNavPerShare(): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_ABI,
      functionName: "navPerShare",
    });
  }

  async getTotalAssets(): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_ABI,
      functionName: "totalAssets",
    });
  }

  async getVaultStats(): Promise<{
    totalAssets: bigint;
    totalLockedShares: bigint;
    totalLockedAssets: bigint;
    navPerShare: bigint;
  }> {
    const [totalAssets, totalLockedShares, totalLockedAssets, navPerShare] = await Promise.all([
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_ABI,
        functionName: "totalAssets",
      }),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_ABI,
        functionName: "totalLockedShares",
      }),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_ABI,
        functionName: "totalLockedAssets",
      }),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_ABI,
        functionName: "navPerShare",
      }),
    ]);

    return { totalAssets, totalLockedShares, totalLockedAssets, navPerShare };
  }

  encodeSubmitClaimRoot(requestId: number, root: `0x${string}`, totalClaimable: bigint): Hex {
    return encodeFunctionData({
      abi: PREDICTION_VAULT_ABI,
      functionName: "submitClaimRoot",
      args: [BigInt(requestId), root, totalClaimable],
    });
  }
}

const contractInstances = new Map<string, VaultContractService>();

export function getVaultContract(contractAddress: string): VaultContractService {
  let instance = contractInstances.get(contractAddress.toLowerCase());
  if (!instance) {
    instance = new VaultContractService(contractAddress);
    contractInstances.set(contractAddress.toLowerCase(), instance);
  }
  return instance;
}
