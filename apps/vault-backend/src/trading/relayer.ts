import Safe from "@safe-global/protocol-kit";
import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, getRpcUrl, isTestnet } from "../env.js";
import { getViemChain } from "../services/chain/chainUtils.js";
import { logger } from "../logger.js";
import type { TransactionRelayer, SafeTransaction, TransactionResult } from "./types.js";

interface WaitableTransactionResponse {
  wait: () => Promise<{ status: string }>;
}

export class SelfRelayer implements TransactionRelayer {
  private signerKey: Hex;

  constructor(privateKey: string) {
    if (!privateKey.startsWith("0x")) {
      this.signerKey = `0x${privateKey}` as Hex;
    } else {
      this.signerKey = privateKey as Hex;
    }
  }

  async execute(safeAddress: string, transactions: SafeTransaction[]): Promise<TransactionResult> {
    const rpcUrl = getRpcUrl();

    const protocolKit = await Safe.init({
      provider: rpcUrl,
      signer: this.signerKey,
      safeAddress,
    });

    const safeTransactionData = transactions.map((tx) => ({
      to: tx.to,
      data: tx.data,
      value: tx.value,
    }));

    const safeTransaction = await protocolKit.createTransaction({
      transactions: safeTransactionData,
    });

    const signedTx = await protocolKit.signTransaction(safeTransaction);
    const response = await protocolKit.executeTransaction(signedTx);

    const hash = typeof response.hash === "string" ? response.hash : "";
    if (!hash) {
      throw new Error("Safe transaction failed: missing tx hash");
    }

    // IMPORTANT: Safe nonce only increments once the tx is mined.
    // For back-to-back Safe operations (e.g., setup-safe), we must wait for mining
    // so the next transaction is created with the correct nonce.
    const txResponse = response.transactionResponse as unknown as WaitableTransactionResponse;
    if (typeof txResponse?.wait === "function") {
      const receipt = await txResponse.wait();
      if (receipt.status !== "success") {
        throw new Error(`Safe transaction reverted (status=${receipt.status})`);
      }
    }

    logger.info("Self-relayed transaction executed", {
      safeAddress,
      hash,
      txCount: transactions.length,
    });

    return {
      hash,
      success: true,
    };
  }

  async deploySafe(ownerAddress: string): Promise<string> {
    const rpcUrl = getRpcUrl();

    const protocolKit = await Safe.init({
      provider: rpcUrl,
      signer: this.signerKey,
      predictedSafe: {
        safeAccountConfig: {
          owners: [ownerAddress],
          threshold: 1,
        },
      },
    });

    const safeAddress = await protocolKit.getAddress();
    const isSafeDeployed = await protocolKit.isSafeDeployed();

    if (!isSafeDeployed) {
      const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction();

      const account = privateKeyToAccount(this.signerKey);

      const walletClient = createWalletClient({
        account,
        chain: getViemChain(),
        transport: http(rpcUrl),
      });

      const hash = await walletClient.sendTransaction({
        chain: getViemChain(),
        to: deploymentTransaction.to as Hex,
        data: deploymentTransaction.data as Hex,
        value: BigInt(deploymentTransaction.value || "0"),
      });

      logger.info("Safe deployed", { safeAddress, hash, owner: ownerAddress });
    } else {
      logger.info("Safe already deployed", { safeAddress, owner: ownerAddress });
    }

    return safeAddress;
  }
}

export class EOARelayer implements TransactionRelayer {
  private signerKey: Hex;

  constructor(privateKey: string) {
    if (!privateKey.startsWith("0x")) {
      this.signerKey = `0x${privateKey}` as Hex;
    } else {
      this.signerKey = privateKey as Hex;
    }
  }

  async execute(
    _walletAddress: string,
    transactions: SafeTransaction[],
  ): Promise<TransactionResult> {
    const rpcUrl = getRpcUrl();
    const account = privateKeyToAccount(this.signerKey);
    const chain = getViemChain();

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    let lastHash = "";

    for (const tx of transactions) {
      const hash = await walletClient.sendTransaction({
        chain,
        to: tx.to as Hex,
        data: tx.data as Hex,
        value: BigInt(tx.value || "0"),
      });

      await publicClient.waitForTransactionReceipt({ hash });
      lastHash = hash;

      logger.info("EOA transaction executed", {
        to: tx.to,
        hash,
      });
    }

    return {
      hash: lastHash,
      success: true,
    };
  }

  async deploySafe(_ownerAddress: string): Promise<string> {
    const account = privateKeyToAccount(this.signerKey);
    logger.info("Testnet mode: using EOA wallet instead of Safe", {
      address: account.address,
    });
    return account.address;
  }

  getEOAAddress(): string {
    const account = privateKeyToAccount(this.signerKey);
    return account.address;
  }
}

let relayerInstance: TransactionRelayer | null = null;

export function getRelayer(): TransactionRelayer {
  if (relayerInstance) return relayerInstance;

  if (!env.TRADING_WALLET_PRIVATE_KEY) {
    throw new Error("TRADING_WALLET_PRIVATE_KEY required for relayer");
  }

  if (isTestnet()) {
    logger.info("Using EOA relayer for testnet");
    relayerInstance = new EOARelayer(env.TRADING_WALLET_PRIVATE_KEY);
  } else {
    relayerInstance = new SelfRelayer(env.TRADING_WALLET_PRIVATE_KEY);
  }

  return relayerInstance;
}

export function getEOAAddress(): string | null {
  if (!env.TRADING_WALLET_PRIVATE_KEY) return null;
  const account = privateKeyToAccount(
    env.TRADING_WALLET_PRIVATE_KEY.startsWith("0x")
      ? (env.TRADING_WALLET_PRIVATE_KEY as Hex)
      : (`0x${env.TRADING_WALLET_PRIVATE_KEY}` as Hex),
  );
  return account.address;
}
