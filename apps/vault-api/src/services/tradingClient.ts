/**
 * Vault Trading Client - Polymarket CLOB SDK Wrapper
 *
 * Adapted from apps/api/src/bot/tradingClient.ts for vault usage:
 * - Uses USDC.e (bridged) instead of native USDC
 * - Uses Safe address as funder with signatureType 2 (Gnosis Safe)
 * - Initializes Builder attribution config from env vars
 * - No bot-specific logic (bet sizing, daily budget tracking, PPH)
 */

import { ClobClient, Side, AssetType, OrderType } from "@polymarket/clob-client";
import type { OpenOrder, Trade } from "@polymarket/clob-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { Wallet } from "ethers";
import { logger } from "../logger.js";
import { env } from "../env.js";
import { POLYGON_CHAIN_ID, USDC_E_ADDRESS } from "../constants.js";
import type { TradeResult } from "../types.js";
import type { VaultInstanceConfig } from "../config/types.js";

const CLOB_HOST = "https://clob.polymarket.com";

// signatureType 2 = Gnosis Safe / Contract wallet
const SIGNATURE_TYPE = 2;

export class VaultTradingClient {
  private client: ClobClient | null = null;
  private wallet: Wallet | null = null;
  private safeAddress: string;
  private initialized = false;

  constructor(
    private readonly options: {
      safeAddress?: string;
      privateKey?: string | null;
    } = {},
  ) {
    this.safeAddress = this.options.safeAddress ?? env.SAFE_ADDRESS;
  }

  /**
   * Initialize the CLOB client.
   * Creates operator wallet, derives API creds, configures builder attribution,
   * then sets up ClobClient with Safe as funder (signatureType 2).
   */
  async initialize(): Promise<void> {
    const privateKey = this.options.privateKey;

    if (!privateKey) {
      throw new Error("Missing privateKey in VaultTradingClient options");
    }

    if (!privateKey) {
      throw new Error("Missing env var: VAULT_PRIVATE_KEY");
    }

    if (!privateKey.startsWith("0x")) {
      throw new Error("Invalid private key format in VAULT_PRIVATE_KEY. Must start with 0x");
    }

    if (!this.safeAddress) {
      throw new Error("Missing env var: SAFE_ADDRESS (required as funder for vault trading)");
    }

    try {
      this.wallet = new Wallet(privateKey);

      logger.info("VaultTradingClient: Initializing", {
        operatorAddress: this.wallet.address,
        safeAddress: this.safeAddress,
        signatureType: SIGNATURE_TYPE,
        usdcAddress: USDC_E_ADDRESS,
      });

      const builderConfig = this.createBuilderConfig();

      this.client = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        this.wallet,
        undefined,
        SIGNATURE_TYPE,
        this.safeAddress,
        undefined,
        undefined,
        builderConfig,
      );

      const apiCreds = await this.client.createOrDeriveApiKey();

      if (!apiCreds?.key || !apiCreds?.secret || !apiCreds?.passphrase) {
        throw new Error("Failed to obtain valid API credentials from Polymarket");
      }

      logger.info("VaultTradingClient: Obtained API credentials", {
        hasApiKey: !!apiCreds.key,
        hasSecret: !!apiCreds.secret,
      });

      // Recreate with full credentials (two-pass init required by CLOB SDK)
      this.client = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        this.wallet,
        apiCreds,
        SIGNATURE_TYPE,
        this.safeAddress,
        undefined,
        undefined,
        builderConfig,
      );

      this.initialized = true;
      logger.info("VaultTradingClient: Initialization complete");
    } catch (error) {
      logger.error("VaultTradingClient: Initialization failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create BuilderConfig from environment variables.
   * Returns undefined if builder attribution is disabled via flag or credentials are missing.
   */
  private createBuilderConfig(): BuilderConfig | undefined {
    if (!env.VAULT_BUILDER_ENABLED) {
      logger.info("VaultTradingClient: Builder attribution disabled by config");
      return undefined;
    }

    const apiKey = env.POLYMARKET_BUILDER_API_KEY;
    const secret = env.POLYMARKET_BUILDER_SECRET;
    const passphrase = env.POLYMARKET_BUILDER_PASSPHRASE;

    if (!apiKey || !secret || !passphrase) {
      logger.warn("VaultTradingClient: Builder credentials not configured, skipping attribution");
      return undefined;
    }

    logger.info("VaultTradingClient: Builder attribution configured", {
      hasApiKey: true,
    });

    return new BuilderConfig({
      localBuilderCreds: {
        key: apiKey,
        secret,
        passphrase,
      },
    });
  }

  isInitialized(): boolean {
    return this.initialized && this.client !== null && this.wallet !== null;
  }

  getOperatorAddress(): string | null {
    return this.wallet?.address ?? null;
  }

  getSafeAddress(): string {
    return this.safeAddress;
  }

  // ===== Core Trading Methods =====

  async createOrder(
    tokenId: string,
    side: "buy" | "sell",
    price: number,
    size: number,
  ): Promise<TradeResult> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      const clobSide = side === "buy" ? Side.BUY : Side.SELL;
      const roundedPrice = Math.floor(price * 100) / 100;
      const roundedSize = Math.floor(size * 10000) / 10000;

      logger.info("VaultTradingClient: Creating order", {
        tokenId,
        side,
        price: roundedPrice,
        size: roundedSize,
      });

      const order = await this.client!.createOrder({
        tokenID: tokenId,
        price: roundedPrice,
        size: roundedSize,
        side: clobSide,
      });

      const result = await this.client!.postOrder(order, OrderType.GTC);

      logger.info("VaultTradingClient: Order posted", {
        orderId: result.orderID,
        status: result.status,
        errorMsg: result.errorMsg,
      });

      const errorField = result.errorMsg || (result as unknown as { error?: string }).error;

      return {
        success: result.success ?? false,
        orderId: result.orderID,
        avgPrice: roundedPrice,
        filledSize: roundedSize,
        error: errorField || undefined,
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("VaultTradingClient: Order creation failed", {
        tokenId,
        side,
        error: errorMsg,
      });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async getOrderStatus(orderId: string): Promise<OpenOrder | null> {
    if (!this.isInitialized()) {
      return null;
    }

    try {
      const order = await this.client!.getOrder(orderId);
      return order;
    } catch (error) {
      logger.error("VaultTradingClient: Failed to get order status", {
        orderId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      await this.client!.cancelOrder({ orderID: orderId });

      logger.info("VaultTradingClient: Order cancelled", { orderId });
      return { success: true };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("VaultTradingClient: Cancel failed", {
        orderId,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  async getActiveOrders(): Promise<OpenOrder[]> {
    if (!this.isInitialized()) {
      return [];
    }

    try {
      const response = await this.client!.getOpenOrders();
      return Array.isArray(response) ? response : [];
    } catch (error) {
      logger.error("VaultTradingClient: Failed to get active orders", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getTradeHistory(): Promise<Trade[]> {
    if (!this.isInitialized()) {
      return [];
    }

    try {
      const trades = await this.client!.getTrades();
      return trades;
    } catch (error) {
      logger.error("VaultTradingClient: Failed to get trade history", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Send heartbeat to keep orders alive.
   * Polymarket may auto-cancel stale orders; calling this periodically
   * signals the orders are still intended to be active.
   */
  async sendHeartbeat(): Promise<{ success: boolean; error?: string }> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      await this.client!.getOk();
      await this.client!.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });

      logger.debug("VaultTradingClient: Heartbeat sent");
      return { success: true };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("VaultTradingClient: Heartbeat failed", {
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  // ===== Utility Methods =====

  async getBalance(): Promise<number> {
    if (!this.isInitialized()) {
      throw new Error("Trading client not initialized");
    }

    try {
      const balanceAllowance = await this.client!.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });

      const balanceStr = balanceAllowance?.balance;
      if (!balanceStr) {
        logger.warn("VaultTradingClient: Balance response is empty", {
          balanceAllowance,
        });
        return 0;
      }

      // USDC.e has 6 decimals
      const balance = parseFloat(String(balanceStr)) / 1e6;
      return isNaN(balance) ? 0 : balance;
    } catch (error) {
      logger.error("VaultTradingClient: Failed to get balance", {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  async getOrderBook(tokenId: string) {
    if (!this.isInitialized()) {
      throw new Error("Trading client not initialized");
    }

    try {
      const book = await this.client!.getOrderBook(tokenId);
      return {
        bids: (book.bids ?? []).map((level) => ({
          price: parseFloat(String(level.price)),
          size: parseFloat(String(level.size)),
        })),
        asks: (book.asks ?? []).map((level) => ({
          price: parseFloat(String(level.price)),
          size: parseFloat(String(level.size)),
        })),
      };
    } catch (error) {
      logger.error("VaultTradingClient: Failed to get order book", {
        tokenId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async cancelAllOrders(): Promise<{ success: boolean; error?: string }> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      await this.client!.cancelAll();
      logger.info("VaultTradingClient: All orders cancelled");
      return { success: true };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("VaultTradingClient: Cancel all failed", { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }
}

let vaultTradingClient: VaultTradingClient | null = null;

export function getVaultTradingClient(): VaultTradingClient {
  if (!vaultTradingClient) {
    vaultTradingClient = new VaultTradingClient();
  }
  return vaultTradingClient;
}

export function createVaultTradingClient(config: VaultInstanceConfig): VaultTradingClient {
  // Import here to avoid circular dependency
  const { resolveVaultIdentity } = require("../config/identityResolver.js");
  const identity = resolveVaultIdentity(config);
  return new VaultTradingClient({
    safeAddress: config.safeAddress,
    privateKey: identity.tradingSignerKey,
  });
}
