import { Effect } from "effect";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  keccak256,
  encodePacked,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, getRpcUrl, getChainIdForNetwork } from "../env.js";
import { getViemChain } from "./chain/chainUtils.js";
import { logger } from "../logger.js";
import { ContractError, WalletNotConfiguredError } from "../lib/errors/index.js";

const PREDICTION_VAULT_V2_ABI = [
  {
    name: "setCumulativeClaimableBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestIds", type: "uint256[]" },
      { name: "newCumulativeClaimables", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "setCumulativeClaimable",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "newCumulativeClaimable", type: "uint256" },
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
      { name: "assetsReserved", type: "uint256" },
      { name: "cumulativeClaimable", type: "uint256" },
      { name: "claimed", type: "uint256" },
      { name: "requestedAt", type: "uint256" },
    ],
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
    name: "totalLockedAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface WithdrawalRequestData {
  user: string;
  shares: bigint;
  assetsReserved: bigint;
  cumulativeClaimable: bigint;
  claimed: bigint;
  requestedAt: bigint;
}

export interface VaultStats {
  totalAssets: bigint;
  totalLockedAssets: bigint;
  navPerShare: bigint;
}

export class VaultContractService {
  private contractAddress: Hex;
  private publicClient;
  private walletClient;
  private account: ReturnType<typeof privateKeyToAccount> | null = null;

  constructor(contractAddress: string) {
    this.contractAddress = contractAddress as Hex;
    const rpcUrl = getRpcUrl();

    this.publicClient = createPublicClient({
      chain: getViemChain(),
      transport: http(rpcUrl),
    });

    if (env.TRADING_WALLET_PRIVATE_KEY) {
      const account = privateKeyToAccount(
        (env.TRADING_WALLET_PRIVATE_KEY.startsWith("0x")
          ? env.TRADING_WALLET_PRIVATE_KEY
          : `0x${env.TRADING_WALLET_PRIVATE_KEY}`) as Hex,
      );
      this.account = account;
      this.walletClient = createWalletClient({
        account,
        chain: getViemChain(),
        transport: http(rpcUrl),
      });
    }
  }

  private requireWallet(): void {
    if (!this.walletClient) {
      throw new Error("Wallet not configured - TRADING_WALLET_PRIVATE_KEY required");
    }
  }

  async updateNav(newTotalAssets: bigint): Promise<{ hash: string; success: boolean }> {
    this.requireWallet();

    try {
      const hash = await this.walletClient!.writeContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_V2_ABI,
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

  async setCumulativeClaimableBatch(
    requestIds: number[],
    newCumulativeClaimables: bigint[],
  ): Promise<{ hash: string; success: boolean }> {
    this.requireWallet();

    if (requestIds.length !== newCumulativeClaimables.length) {
      throw new Error("requestIds and newCumulativeClaimables length mismatch");
    }

    const requestIdsBigInt = requestIds.map((id) => BigInt(id));

    try {
      const hash = await this.walletClient!.writeContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_V2_ABI,
        functionName: "setCumulativeClaimableBatch",
        args: [requestIdsBigInt, newCumulativeClaimables],
      });

      logger.info("Cumulative claimables updated (batch)", {
        requestCount: requestIds.length,
        hash,
      });

      return { hash, success: true };
    } catch (error) {
      logger.error("Failed to set cumulative claimables (batch)", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getWithdrawalRequest(requestId: number): Promise<WithdrawalRequestData> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_V2_ABI,
      functionName: "withdrawalRequests",
      args: [BigInt(requestId)],
    });

    return {
      user: result[0],
      shares: result[1],
      assetsReserved: result[2],
      cumulativeClaimable: result[3],
      claimed: result[4],
      requestedAt: result[5],
    };
  }

  async getNavPerShare(): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_V2_ABI,
      functionName: "navPerShare",
    });
  }

  async getTotalAssets(): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_V2_ABI,
      functionName: "totalAssets",
    });
  }

  async getVaultStats(): Promise<VaultStats> {
    const [totalAssets, totalLockedAssets, navPerShare] = await Promise.all([
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_V2_ABI,
        functionName: "totalAssets",
      }),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_V2_ABI,
        functionName: "totalLockedAssets",
      }),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: PREDICTION_VAULT_V2_ABI,
        functionName: "navPerShare",
      }),
    ]);

    return { totalAssets, totalLockedAssets, navPerShare };
  }

  async balanceOf(account: Hex): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.contractAddress,
      abi: PREDICTION_VAULT_V2_ABI,
      functionName: "balanceOf",
      args: [account],
    });
  }

  async signClaim(args: {
    user: `0x${string}`;
    requestId: number;
    cumulativeClaimable: bigint;
    deadline: bigint;
  }): Promise<`0x${string}`> {
    if (!this.account) {
      throw new Error("Wallet not configured - TRADING_WALLET_PRIVATE_KEY required");
    }

    const claimTypehash = keccak256(
      encodePacked(
        ["string"],
        [
          "PredictionVaultV2Claim(address vault,uint256 chainId,address user,uint256 requestId,uint256 cumulativeClaimable,uint256 deadline)",
        ],
      ),
    );

    const messageHash = keccak256(
      encodePacked(
        ["bytes32", "address", "uint256", "address", "uint256", "uint256", "uint256"],
        [
          claimTypehash,
          this.contractAddress,
          BigInt(getChainIdForNetwork()),
          args.user,
          BigInt(args.requestId),
          args.cumulativeClaimable,
          args.deadline,
        ],
      ),
    );

    return await this.account.signMessage({ message: { raw: messageHash } });
  }

  getWithdrawalRequestEffect(
    requestId: number,
  ): Effect.Effect<WithdrawalRequestData, ContractError> {
    return Effect.tryPromise({
      try: () => this.getWithdrawalRequest(requestId),
      catch: (error) =>
        new ContractError({
          contract: this.contractAddress,
          method: "getWithdrawalRequest",
          message: (error as Error).message,
          cause: error,
        }),
    });
  }

  getVaultStatsEffect(): Effect.Effect<VaultStats, ContractError> {
    return Effect.tryPromise({
      try: () => this.getVaultStats(),
      catch: (error) =>
        new ContractError({
          contract: this.contractAddress,
          method: "getVaultStats",
          message: (error as Error).message,
          cause: error,
        }),
    });
  }

  updateNavEffect(
    newTotalAssets: bigint,
  ): Effect.Effect<{ hash: string; success: boolean }, ContractError | WalletNotConfiguredError> {
    if (!this.walletClient) {
      return Effect.fail(
        new WalletNotConfiguredError({
          message: "TRADING_WALLET_PRIVATE_KEY required for updateNav",
        }),
      );
    }

    return Effect.tryPromise({
      try: () => this.updateNav(newTotalAssets),
      catch: (error) =>
        new ContractError({
          contract: this.contractAddress,
          method: "updateNav",
          message: (error as Error).message,
          cause: error,
        }),
    });
  }

  setCumulativeClaimableBatchEffect(
    requestIds: number[],
    newCumulativeClaimables: bigint[],
  ): Effect.Effect<{ hash: string; success: boolean }, ContractError | WalletNotConfiguredError> {
    if (!this.walletClient) {
      return Effect.fail(
        new WalletNotConfiguredError({
          message: "TRADING_WALLET_PRIVATE_KEY required for setCumulativeClaimableBatch",
        }),
      );
    }

    return Effect.tryPromise({
      try: () => this.setCumulativeClaimableBatch(requestIds, newCumulativeClaimables),
      catch: (error) =>
        new ContractError({
          contract: this.contractAddress,
          method: "setCumulativeClaimableBatch",
          message: (error as Error).message,
          cause: error,
        }),
    });
  }

  signClaimEffect(args: {
    user: `0x${string}`;
    requestId: number;
    cumulativeClaimable: bigint;
    deadline: bigint;
  }): Effect.Effect<`0x${string}`, ContractError | WalletNotConfiguredError> {
    if (!this.account) {
      return Effect.fail(
        new WalletNotConfiguredError({
          message: "TRADING_WALLET_PRIVATE_KEY required for signClaim",
        }),
      );
    }

    return Effect.tryPromise({
      try: () => this.signClaim(args),
      catch: (error) =>
        new ContractError({
          contract: this.contractAddress,
          method: "signClaim",
          message: (error as Error).message,
          cause: error,
        }),
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
