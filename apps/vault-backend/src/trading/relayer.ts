import Safe from "@safe-global/protocol-kit";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { env, getRpcUrl } from "../env.js";
import { logger } from "../logger.js";
import type { TransactionRelayer, SafeTransaction, TransactionResult } from "./types.js";

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
        chain: polygon,
        transport: http(rpcUrl),
      });

      const hash = await walletClient.sendTransaction({
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

let relayerInstance: TransactionRelayer | null = null;

export function getRelayer(): TransactionRelayer {
  if (relayerInstance) return relayerInstance;

  if (!env.TRADING_WALLET_PRIVATE_KEY) {
    throw new Error("TRADING_WALLET_PRIVATE_KEY required for self-relayer");
  }

  relayerInstance = new SelfRelayer(env.TRADING_WALLET_PRIVATE_KEY);
  return relayerInstance;
}
