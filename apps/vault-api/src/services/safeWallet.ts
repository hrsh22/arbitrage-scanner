/**
 * Safe Wallet Service — Gnosis Safe interaction layer for the Polymarket Vault.
 *
 * Uses @safe-global/protocol-kit for TX creation, signing, and execution.
 * Uses viem for ERC20 balance reads (avoids ethers v5/v6 conflicts).
 * Thin execution abstraction so Builder relayer path can replace direct
 * Safe TX calls without refactor.
 */

import * as ProtocolKit from "@safe-global/protocol-kit";
import type {
  MetaTransactionData,
  SafeTransaction,
  TransactionResult,
} from "@safe-global/types-kit";
import { OperationType } from "@safe-global/types-kit";
import { createPublicClient, encodeFunctionData, erc20Abi, type Address } from "viem";
import { polygon } from "viem/chains";

import {
  USDC_E_ADDRESS,
  CTF_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEGRISK_CTF_EXCHANGE_ADDRESS,
  NEGRISK_ADAPTER_ADDRESS,
} from "../constants.js";
import { logger } from "../logger.js";
import { createPolygonTransport } from "../rpcTransport.js";
// Protocol Kit CJS/ESM interop: default export resolves to the Safe class at runtime
const Safe = ProtocolKit.default as unknown as {
  init(config: { provider: string; signer: string; safeAddress: string }): Promise<SafeKitInstance>;
};

interface SafeKitInstance {
  getAddress(): Promise<string>;
  getOwners(): Promise<string[]>;
  getThreshold(): Promise<number>;
  getModules(): Promise<string[]>;
  getChainId(): Promise<bigint>;
  getNonce(): Promise<number>;
  createTransaction(props: { transactions: MetaTransactionData[] }): Promise<SafeTransaction>;
  signTransaction(safeTx: SafeTransaction): Promise<SafeTransaction>;
  executeTransaction(safeTx: SafeTransaction): Promise<TransactionResult>;
}

const MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const MAX_UINT256_BI = BigInt(MAX_UINT256);
const DEFAULT_MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const POLYMARKET_EXCHANGES: Address[] = [
  CTF_EXCHANGE_ADDRESS as Address,
  NEGRISK_CTF_EXCHANGE_ADDRESS as Address,
  NEGRISK_ADAPTER_ADDRESS as Address,
];

const APPROVE_ABI = [
  {
    name: "approve",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "spender", type: "address" as const },
      { name: "amount", type: "uint256" as const },
    ],
    outputs: [{ name: "success", type: "bool" as const }],
  },
] as const;

const TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "amount", type: "uint256" as const },
    ],
    outputs: [{ name: "success", type: "bool" as const }],
  },
] as const;

const SET_APPROVAL_FOR_ALL_ABI = [
  {
    name: "setApprovalForAll",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "operator", type: "address" as const },
      { name: "approved", type: "bool" as const },
    ],
    outputs: [],
  },
] as const;

export interface SafeTxResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface SafeInfo {
  address: string;
  owners: string[];
  threshold: number;
  modules: string[];
  chainId: bigint;
  nonce: number;
}

export class SafeWalletService {
  private protocolKit: SafeKitInstance | null = null;
  private initialized = false;

  private readonly safeAddress: string;
  private readonly safeOperatorKey: string;
  private readonly rpcUrl: string;

  /**
   * @param safeAddress - Gnosis Safe contract address (required)
   * @param safeOperatorKey - Safe operator private key, must be a Safe owner (required)
   * @param rpcUrl - Polygon RPC endpoint (required)
   */
  constructor(safeAddress: string, safeOperatorKey: string, rpcUrl: string) {
    this.safeAddress = safeAddress;
    this.safeOperatorKey = safeOperatorKey;
    this.rpcUrl = rpcUrl;

    if (!this.safeAddress) {
      throw new Error("SafeWalletService: safeAddress is required");
    }

    if (!this.safeOperatorKey) {
      throw new Error("SafeWalletService: safeOperatorKey is required");
    }

    if (!this.rpcUrl) {
      throw new Error("SafeWalletService: rpcUrl is required");
    }
  }

  /** Must be called before any transaction methods. */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.protocolKit = await Safe.init({
        provider: this.rpcUrl,
        signer: this.safeOperatorKey,
        safeAddress: this.safeAddress,
      });

      const safeAddr = await this.protocolKit.getAddress();
      const owners = await this.protocolKit.getOwners();
      const threshold = await this.protocolKit.getThreshold();

      logger.info("SafeWalletService: Initialized", {
        safeAddress: safeAddr,
        owners,
        threshold,
      });

      this.initialized = true;
    } catch (error) {
      logger.error("SafeWalletService: Initialization failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private ensureInitialized(): SafeKitInstance {
    if (!this.initialized || !this.protocolKit) {
      throw new Error("SafeWalletService: Not initialized. Call initialize() first.");
    }
    return this.protocolKit;
  }

  /**
   * Get ERC20 token balance of the Safe.
   * @returns Balance as bigint (raw, no decimal adjustment)
   */
  async getBalance(tokenAddress: string): Promise<bigint> {
    const client = createPublicClient({
      chain: polygon,
      transport: createPolygonTransport(this.rpcUrl),
    });

    try {
      const balance = await client.readContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.safeAddress as Address],
      });

      logger.debug("SafeWalletService: getBalance", {
        token: tokenAddress,
        safe: this.safeAddress,
        balance: balance.toString(),
      });

      return balance;
    } catch (error) {
      logger.error("SafeWalletService: getBalance failed", {
        token: tokenAddress,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getAllowance(tokenAddress: string, spender: string): Promise<bigint> {
    const client = createPublicClient({
      chain: polygon,
      transport: createPolygonTransport(this.rpcUrl),
    });

    try {
      const allowance = await client.readContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [this.safeAddress as Address, spender as Address],
      });

      logger.debug("SafeWalletService: getAllowance", {
        token: tokenAddress,
        safe: this.safeAddress,
        spender,
        allowance: allowance.toString(),
      });

      return allowance;
    } catch (error) {
      logger.error("SafeWalletService: getAllowance failed", {
        token: tokenAddress,
        spender,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create, sign, and execute a Safe TX to approve ERC20 spending.
   * @param amount - Raw units string. Defaults to unlimited (MAX_UINT256).
   */
  async approveToken(
    tokenAddress: string,
    spender: string,
    amount: string = MAX_UINT256,
  ): Promise<SafeTxResult> {
    const kit = this.ensureInitialized();

    const data = encodeFunctionData({
      abi: APPROVE_ABI,
      functionName: "approve",
      args: [spender as Address, BigInt(amount)],
    });

    const txData: MetaTransactionData = {
      to: tokenAddress,
      value: "0",
      data,
      operation: OperationType.Call,
    };

    logger.info("SafeWalletService: approveToken", {
      token: tokenAddress,
      spender,
      amount: amount === MAX_UINT256 ? "unlimited" : amount,
    });

    const safeTx = await kit.createTransaction({ transactions: [txData] });
    return this.executeTransaction(safeTx);
  }

  /**
   * Create, sign, and execute a Safe TX to setApprovalForAll on an ERC1155 token.
   * Used for CTF (Conditional Token Framework) approvals.
   */
  async setApprovalForAll(
    tokenAddress: string,
    operator: string,
    approved: boolean = true,
  ): Promise<SafeTxResult> {
    const kit = this.ensureInitialized();

    const data = encodeFunctionData({
      abi: SET_APPROVAL_FOR_ALL_ABI,
      functionName: "setApprovalForAll",
      args: [operator as Address, approved],
    });

    const txData: MetaTransactionData = {
      to: tokenAddress,
      value: "0",
      data,
      operation: OperationType.Call,
    };

    logger.info("SafeWalletService: setApprovalForAll", {
      token: tokenAddress,
      operator,
      approved,
    });

    const safeTx = await kit.createTransaction({ transactions: [txData] });
    return this.executeTransaction(safeTx);
  }

  /** Create, sign, and execute a Safe TX to transfer ERC20 tokens. */
  async transferToken(tokenAddress: string, to: string, amount: string): Promise<SafeTxResult> {
    const kit = this.ensureInitialized();

    const data = encodeFunctionData({
      abi: TRANSFER_ABI,
      functionName: "transfer",
      args: [to as Address, BigInt(amount)],
    });

    const txData: MetaTransactionData = {
      to: tokenAddress,
      value: "0",
      data,
      operation: OperationType.Call,
    };

    logger.info("SafeWalletService: transferToken", {
      token: tokenAddress,
      to,
      amount,
    });

    const safeTx = await kit.createTransaction({ transactions: [txData] });
    return this.executeTransaction(safeTx);
  }

  /**
   * Approve USDC.e and CTF tokens to all 3 Polymarket exchange contracts.
   * Batches all 6 approvals into a single MultiSend Safe TX.
   */
  async approvePolymarketExchanges(): Promise<SafeTxResult> {
    const kit = this.ensureInitialized();

    const transactions: MetaTransactionData[] = [];

    for (const exchange of POLYMARKET_EXCHANGES) {
      const usdcApproveData = encodeFunctionData({
        abi: APPROVE_ABI,
        functionName: "approve",
        args: [exchange, BigInt(MAX_UINT256)],
      });

      transactions.push({
        to: USDC_E_ADDRESS,
        value: "0",
        data: usdcApproveData,
        operation: OperationType.Call,
      });
    }

    for (const exchange of POLYMARKET_EXCHANGES) {
      const ctfApproveData = encodeFunctionData({
        abi: APPROVE_ABI,
        functionName: "approve",
        args: [exchange, BigInt(MAX_UINT256)],
      });

      transactions.push({
        to: CTF_ADDRESS,
        value: "0",
        data: ctfApproveData,
        operation: OperationType.Call,
      });
    }

    logger.info("SafeWalletService: approvePolymarketExchanges", {
      exchanges: POLYMARKET_EXCHANGES,
      tokens: [USDC_E_ADDRESS, CTF_ADDRESS],
      txCount: transactions.length,
    });

    const safeTx = await kit.createTransaction({ transactions });
    return this.executeTransaction(safeTx);
  }

  getMaxUint256(): bigint {
    return MAX_UINT256_BI;
  }

  /**
   * Generic Safe TX execution with error handling and retry.
   * Kept thin so the Builder relayer path can replace it without refactoring callers.
   */
  async executeTransaction(
    safeTx: SafeTransaction,
    maxRetries: number = DEFAULT_MAX_RETRIES,
  ): Promise<SafeTxResult> {
    const kit = this.ensureInitialized();

    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const signedTx = await kit.signTransaction(safeTx);
        const result: TransactionResult = await kit.executeTransaction(signedTx);

        logger.info("SafeWalletService: TX executed", {
          txHash: result.hash,
          attempt,
        });

        return {
          success: true,
          txHash: result.hash,
        };
      } catch (error) {
        lastError = (error as Error).message;
        logger.warn("SafeWalletService: TX execution attempt failed", {
          attempt,
          maxRetries,
          error: lastError,
        });

        const isNonRetryable =
          lastError.includes("Transactions can only be signed by Safe owners") ||
          lastError.includes("No signer provided") ||
          lastError.includes("signatures missing");

        if (isNonRetryable) break;

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    }

    logger.error("SafeWalletService: TX execution failed after retries", {
      error: lastError,
      maxRetries,
    });

    return {
      success: false,
      error: lastError,
    };
  }

  /**
   * Create, sign, and execute a Safe TX from raw calldata.
   * Use for arbitrary contract interactions not covered by helper methods.
   */
  async executeRawTransaction(
    to: string,
    data: string,
    value: string = "0",
  ): Promise<SafeTxResult> {
    const kit = this.ensureInitialized();

    const txData: MetaTransactionData = {
      to,
      value,
      data,
      operation: OperationType.Call,
    };

    const safeTx = await kit.createTransaction({ transactions: [txData] });
    return this.executeTransaction(safeTx);
  }

  /** Get Safe owners, threshold, modules, chainId, nonce. */
  async getSafeInfo(): Promise<SafeInfo> {
    const kit = this.ensureInitialized();

    const [address, owners, threshold, modules, chainId, nonce] = await Promise.all([
      kit.getAddress(),
      kit.getOwners(),
      kit.getThreshold(),
      kit.getModules(),
      kit.getChainId(),
      kit.getNonce(),
    ]);

    const info: SafeInfo = {
      address,
      owners,
      threshold,
      modules,
      chainId,
      nonce,
    };

    logger.info("SafeWalletService: getSafeInfo", {
      address: info.address,
      owners: info.owners,
      threshold: info.threshold,
      modules: info.modules,
      nonce: info.nonce,
    });

    return info;
  }
}
