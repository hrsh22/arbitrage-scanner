import { encodeFunctionData, createPublicClient, http, type Hex } from "viem";
import { getRelayer } from "./relayer.js";
import { logger } from "../logger.js";
import { isTestnet, getUsdcAddressForNetwork, getRpcUrl } from "../env.js";
import { getViemChain } from "../services/chain/chainUtils.js";
import type { SafeTransaction } from "./types.js";

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC1155_ABI = [
  {
    name: "setApprovalForAll",
    type: "function",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "isApprovedForAll",
    type: "function",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const MAINNET_ADDRESSES = {
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as Hex,
  USDC_NATIVE: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Hex,
  CTF: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045" as Hex,
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as Hex,
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a" as Hex,
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as Hex,
};

function getUsdcAddress(): Hex {
  return getUsdcAddressForNetwork() as Hex;
}

export class SafeWalletService {
  private safeAddress: string;

  constructor(safeAddress: string) {
    this.safeAddress = safeAddress;
  }

  async approveUsdcForCtf(
    amount: bigint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
  ): Promise<string> {
    if (isTestnet()) {
      throw new Error("Polymarket CTF not available on testnet");
    }
    const relayer = getRelayer();

    const tx: SafeTransaction = {
      to: getUsdcAddress(),
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MAINNET_ADDRESSES.CTF, amount],
      }),
      value: "0",
    };

    const result = await relayer.execute(this.safeAddress, [tx]);
    logger.info("Approved USDC for CTF", { safeAddress: this.safeAddress, hash: result.hash });
    return result.hash;
  }

  async approveForExchange(
    amount: bigint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
  ): Promise<string> {
    if (isTestnet()) {
      throw new Error("Polymarket exchanges not available on testnet");
    }
    const relayer = getRelayer();

    const transactions: SafeTransaction[] = [
      {
        to: getUsdcAddress(),
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MAINNET_ADDRESSES.CTF_EXCHANGE, amount],
        }),
        value: "0",
      },
      {
        to: getUsdcAddress(),
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MAINNET_ADDRESSES.NEG_RISK_CTF_EXCHANGE, amount],
        }),
        value: "0",
      },
    ];

    const result = await relayer.execute(this.safeAddress, transactions);
    logger.info("Approved USDC for exchanges", {
      safeAddress: this.safeAddress,
      hash: result.hash,
    });
    return result.hash;
  }

  async transferUsdc(to: string, amount: bigint): Promise<string> {
    const relayer = getRelayer();

    const tx: SafeTransaction = {
      to: getUsdcAddress(),
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to as Hex, amount],
      }),
      value: "0",
    };

    const result = await relayer.execute(this.safeAddress, [tx]);
    logger.info("Transferred USDC", {
      safeAddress: this.safeAddress,
      to,
      amount: amount.toString(),
      hash: result.hash,
    });
    return result.hash;
  }

  async approveUsdcForSpender(
    spender: string,
    amount: bigint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
  ): Promise<string> {
    const relayer = getRelayer();

    const tx: SafeTransaction = {
      to: getUsdcAddress(),
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender as Hex, amount],
      }),
      value: "0",
    };

    const result = await relayer.execute(this.safeAddress, [tx]);
    logger.info("Approved USDC for spender", {
      safeAddress: this.safeAddress,
      spender,
      hash: result.hash,
    });
    return result.hash;
  }

  async approveNativeUsdcForSpender(
    spender: string,
    amount: bigint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
  ): Promise<string> {
    if (isTestnet()) {
      // On testnet, there's only one USDC - redirect to regular approve
      return this.approveUsdcForSpender(spender, amount);
    }
    const relayer = getRelayer();

    const tx: SafeTransaction = {
      to: MAINNET_ADDRESSES.USDC_NATIVE,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender as Hex, amount],
      }),
      value: "0",
    };

    const result = await relayer.execute(this.safeAddress, [tx]);
    logger.info("Approved native USDC for spender", {
      safeAddress: this.safeAddress,
      spender,
      hash: result.hash,
    });
    return result.hash;
  }

  async approveAllForPolymarket(): Promise<string> {
    if (isTestnet()) {
      throw new Error("Polymarket contracts not available on testnet");
    }
    const relayer = getRelayer();
    const maxAmount = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const usdc = getUsdcAddress();

    const transactions: SafeTransaction[] = [
      {
        to: usdc,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MAINNET_ADDRESSES.CTF, maxAmount],
        }),
        value: "0",
      },
      {
        to: usdc,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MAINNET_ADDRESSES.CTF_EXCHANGE, maxAmount],
        }),
        value: "0",
      },
      {
        to: usdc,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MAINNET_ADDRESSES.NEG_RISK_CTF_EXCHANGE, maxAmount],
        }),
        value: "0",
      },
      {
        to: usdc,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MAINNET_ADDRESSES.NEG_RISK_ADAPTER, maxAmount],
        }),
        value: "0",
      },
      {
        to: MAINNET_ADDRESSES.CTF,
        data: encodeFunctionData({
          abi: ERC1155_ABI,
          functionName: "setApprovalForAll",
          args: [MAINNET_ADDRESSES.CTF_EXCHANGE, true],
        }),
        value: "0",
      },
      {
        to: MAINNET_ADDRESSES.CTF,
        data: encodeFunctionData({
          abi: ERC1155_ABI,
          functionName: "setApprovalForAll",
          args: [MAINNET_ADDRESSES.NEG_RISK_CTF_EXCHANGE, true],
        }),
        value: "0",
      },
      {
        to: MAINNET_ADDRESSES.CTF,
        data: encodeFunctionData({
          abi: ERC1155_ABI,
          functionName: "setApprovalForAll",
          args: [MAINNET_ADDRESSES.NEG_RISK_ADAPTER, true],
        }),
        value: "0",
      },
    ];

    const result = await relayer.execute(this.safeAddress, transactions);
    logger.info("Approved all tokens for Polymarket", {
      safeAddress: this.safeAddress,
      hash: result.hash,
      approvalCount: transactions.length,
    });
    return result.hash;
  }

  async getUsdcAllowance(spender: string): Promise<bigint> {
    const publicClient = createPublicClient({
      chain: getViemChain(),
      transport: http(getRpcUrl()),
    });

    const allowance = await publicClient.readContract({
      address: getUsdcAddress(),
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.safeAddress as Hex, spender as Hex],
    });

    return allowance as bigint;
  }

  async isCtfApprovedForOperator(operator: string): Promise<boolean> {
    if (isTestnet()) {
      return false;
    }

    const publicClient = createPublicClient({
      chain: getViemChain(),
      transport: http(getRpcUrl()),
    });

    const isApproved = await publicClient.readContract({
      address: MAINNET_ADDRESSES.CTF,
      abi: ERC1155_ABI,
      functionName: "isApprovedForAll",
      args: [this.safeAddress as Hex, operator as Hex],
    });

    return isApproved as boolean;
  }

  async getSetupStatus(vaultContractAddress: string): Promise<{
    treasuryAddress: string;
    isTestnet: boolean;
    vaultApproved: boolean;
    polymarketApproved: boolean;
    polymarketDetails?: {
      usdcForCtf: boolean;
      usdcForCtfExchange: boolean;
      usdcForNegRiskExchange: boolean;
      usdcForNegRiskAdapter: boolean;
      ctfForCtfExchange: boolean;
      ctfForNegRiskExchange: boolean;
      ctfForNegRiskAdapter: boolean;
    };
  }> {
    const testnetMode = isTestnet();

    const vaultAllowance = await this.getUsdcAllowance(vaultContractAddress);
    const vaultApproved = vaultAllowance > 0n;

    if (testnetMode) {
      return {
        treasuryAddress: this.safeAddress,
        isTestnet: true,
        vaultApproved,
        polymarketApproved: false,
      };
    }

    const [
      usdcForCtf,
      usdcForCtfExchange,
      usdcForNegRiskExchange,
      usdcForNegRiskAdapter,
      ctfForCtfExchange,
      ctfForNegRiskExchange,
      ctfForNegRiskAdapter,
    ] = await Promise.all([
      this.getUsdcAllowance(MAINNET_ADDRESSES.CTF),
      this.getUsdcAllowance(MAINNET_ADDRESSES.CTF_EXCHANGE),
      this.getUsdcAllowance(MAINNET_ADDRESSES.NEG_RISK_CTF_EXCHANGE),
      this.getUsdcAllowance(MAINNET_ADDRESSES.NEG_RISK_ADAPTER),
      this.isCtfApprovedForOperator(MAINNET_ADDRESSES.CTF_EXCHANGE),
      this.isCtfApprovedForOperator(MAINNET_ADDRESSES.NEG_RISK_CTF_EXCHANGE),
      this.isCtfApprovedForOperator(MAINNET_ADDRESSES.NEG_RISK_ADAPTER),
    ]);

    const polymarketDetails = {
      usdcForCtf: usdcForCtf > 0n,
      usdcForCtfExchange: usdcForCtfExchange > 0n,
      usdcForNegRiskExchange: usdcForNegRiskExchange > 0n,
      usdcForNegRiskAdapter: usdcForNegRiskAdapter > 0n,
      ctfForCtfExchange,
      ctfForNegRiskExchange,
      ctfForNegRiskAdapter,
    };

    const polymarketApproved = Object.values(polymarketDetails).every(Boolean);

    return {
      treasuryAddress: this.safeAddress,
      isTestnet: false,
      vaultApproved,
      polymarketApproved,
      polymarketDetails,
    };
  }

  async executeRaw(transactions: SafeTransaction[]): Promise<string> {
    const relayer = getRelayer();
    const result = await relayer.execute(this.safeAddress, transactions);
    return result.hash;
  }

  getAddress(): string {
    return this.safeAddress;
  }
}

export async function deploySafeWallet(ownerAddress: string): Promise<string> {
  const relayer = getRelayer();
  return relayer.deploySafe(ownerAddress);
}

export function createSafeWalletService(safeAddress: string): SafeWalletService {
  return new SafeWalletService(safeAddress);
}
