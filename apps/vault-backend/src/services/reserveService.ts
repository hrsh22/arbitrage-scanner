import { createPublicClient, http, erc20Abi, type Hex } from "viem";
import { getRpcUrl, getUsdcAddressForNetwork } from "../env.js";
import { getViemChain } from "./chain/chainUtils.js";
import { getVaultContract } from "./vaultContractService.js";
import { logger } from "../logger.js";

const USDC_ADDRESS = getUsdcAddressForNetwork();

export class ReserveService {
  private publicClient;

  constructor() {
    this.publicClient = createPublicClient({
      chain: getViemChain(),
      transport: http(getRpcUrl()),
    });
  }

  async getUsdcBalance(address: string): Promise<bigint> {
    return await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as Hex],
    });
  }

  async getAvailableForTrading(
    treasuryAddress: string,
    vaultContractAddress: string,
  ): Promise<{
    treasuryBalance: bigint;
    lockedAssets: bigint;
    availableForTrading: bigint;
  }> {
    const vaultContract = getVaultContract(vaultContractAddress);
    const [treasuryBalance, isV2] = await Promise.all([
      this.getUsdcBalance(treasuryAddress),
      vaultContract.isV2(),
    ]);

    const vaultStats = isV2
      ? await vaultContract.getVaultStatsV2()
      : await vaultContract.getVaultStats();

    const lockedAssets = vaultStats.totalLockedAssets;
    const availableForTrading =
      treasuryBalance > lockedAssets ? treasuryBalance - lockedAssets : 0n;

    return {
      treasuryBalance,
      lockedAssets,
      availableForTrading,
    };
  }

  async validateTradeAmount(
    treasuryAddress: string,
    vaultContractAddress: string,
    tradeAmountUsdc: bigint,
  ): Promise<{ allowed: boolean; available: bigint; reason?: string }> {
    const { availableForTrading, lockedAssets, treasuryBalance } =
      await this.getAvailableForTrading(treasuryAddress, vaultContractAddress);

    if (tradeAmountUsdc > availableForTrading) {
      logger.warn("Trade rejected: would use reserved withdrawal funds", {
        tradeAmount: tradeAmountUsdc.toString(),
        availableForTrading: availableForTrading.toString(),
        lockedAssets: lockedAssets.toString(),
        treasuryBalance: treasuryBalance.toString(),
      });

      return {
        allowed: false,
        available: availableForTrading,
        reason: `Trade amount ${tradeAmountUsdc} exceeds available ${availableForTrading}. ${lockedAssets} USDC reserved for pending withdrawals.`,
      };
    }

    return { allowed: true, available: availableForTrading };
  }
}

export const reserveService = new ReserveService();
