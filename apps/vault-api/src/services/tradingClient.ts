/**
 * Vault Trading Client - Polymarket CLOB SDK Wrapper
 *
 * Adapted from apps/api/src/bot/tradingClient.ts for vault usage:
 * - Uses pUSD collateral instead of legacy USDC.e
 * - Uses Safe address as funder with a Polymarket V2 signature type
 * - Initializes Builder attribution from builderCode env config
 * - No bot-specific logic (bet sizing, daily budget tracking, PPH)
 */

import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  type OpenOrder,
  SignatureTypeV2,
  Side,
  type Trade,
} from "@polymarket/clob-client-v2";
import { Wallet } from "ethers";
import { logger } from "../logger.js";
import { env } from "../env.js";
import { SUPPORTS_POLYMARKET_TRADING } from "../constants.js";
import type { TradeResult } from "../types.js";
import type { VaultInstanceConfig } from "../config/types.js";
import { getAllVaultConfigs, resolveVaultIdentity } from "../config/index.js";

const CLOB_HOST = "https://clob.polymarket.com";

interface ClobApiCreds {
  key: string;
  secret: string;
  passphrase: string;
}

function isClobApiCreds(value: unknown): value is ClobApiCreds {
  const candidate = value as Partial<ClobApiCreds> | null;
  return Boolean(candidate?.key && candidate.secret && candidate.passphrase);
}

async function withSuppressedClobRequestLogs<T>(callback: () => Promise<T>): Promise<T> {
  const originalError = console.error;

  console.error = (...args: unknown[]) => {
    const firstArg = args[0];
    if (typeof firstArg === "string" && firstArg.includes("[CLOB Client] request error")) {
      return;
    }

    originalError(...args);
  };

  try {
    return await callback();
  } finally {
    console.error = originalError;
  }
}

async function createOrDeriveApiCredentials(client: ClobClient): Promise<ClobApiCreds> {
  return withSuppressedClobRequestLogs(async () => {
    try {
      const createdOrDerived = await client.createOrDeriveApiKey();
      if (isClobApiCreds(createdOrDerived)) {
        return createdOrDerived;
      }
    } catch {
      // The SDK's createOrDeriveApiKey does not catch createApiKey failures.
      // Fall through to deriveApiKey so existing Polymarket API keys can be recovered safely.
    }

    const derived = await client.deriveApiKey();
    if (!isClobApiCreds(derived)) {
      throw new Error("Failed to obtain valid API credentials from Polymarket");
    }

    return derived;
  });
}

export class VaultTradingClient {
  private client: ClobClient | null = null;
  private wallet: Wallet | null = null;
  private safeAddress: string;
  private signatureType: SignatureTypeV2;
  private initialized = false;

  constructor(
    private readonly options: {
      safeAddress?: string;
      privateKey?: string | null;
      signatureType?: SignatureTypeV2;
    } = {},
  ) {
    this.safeAddress = this.options.safeAddress ?? "";
    this.signatureType = this.options.signatureType ?? SignatureTypeV2.POLY_GNOSIS_SAFE;
  }

  /**
   * Initialize the CLOB client.
   * Creates operator wallet, derives API creds, configures builder attribution,
   * then sets up ClobClient with the configured funder/signature type.
   */
  async initialize(): Promise<void> {
    // Block initialization on unsupported networks
    if (!SUPPORTS_POLYMARKET_TRADING) {
      throw new Error(
        "VaultTradingClient: Polymarket trading is not supported on the current network. " +
          "Trading is only available on Polygon mainnet.",
      );
    }

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
      throw new Error("Missing trading funder address in VaultTradingClient options");
    }

    try {
      this.wallet = new Wallet(privateKey);

        logger.info("VaultTradingClient: Initializing", {
          operatorAddress: this.wallet.address,
          safeAddress: this.safeAddress,
          signatureType: this.signatureType,
        });

      const builderConfig = this.createBuilderConfig();

      const l1Client = new ClobClient({
        host: CLOB_HOST,
        chain: Chain.POLYGON,
        signer: this.wallet,
      });

      const apiCreds = await createOrDeriveApiCredentials(l1Client);

      logger.info("VaultTradingClient: Obtained API credentials", {
        hasApiKey: !!apiCreds.key,
        hasSecret: !!apiCreds.secret,
      });

      // Recreate with full credentials (two-pass init required by CLOB SDK)
      this.client = new ClobClient({
        host: CLOB_HOST,
        chain: Chain.POLYGON,
        signer: this.wallet,
        creds: apiCreds,
        signatureType: this.signatureType,
        funderAddress: this.safeAddress,
        builderConfig,
      });

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
   * Create builder config from environment variables.
   * Returns undefined if builder attribution is disabled via flag or builderCode is missing.
   */
  private createBuilderConfig(): { builderCode: string } | undefined {
    if (!env.VAULT_BUILDER_ENABLED) {
      logger.info("VaultTradingClient: Builder attribution disabled by config");
      return undefined;
    }

    const builderCode = env.POLYMARKET_BUILDER_CODE;

    if (!builderCode) {
      logger.warn("VaultTradingClient: Builder code not configured, skipping attribution");
      return undefined;
    }

    logger.info("VaultTradingClient: Builder attribution configured", {
      hasBuilderCode: true,
    });

    return { builderCode };
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

      const [tickSize, negRisk] = await Promise.all([
        this.client!.getTickSize(tokenId),
        this.client!.getNegRisk(tokenId),
      ]);

      const result = await this.client!.createAndPostOrder(
        {
          tokenID: tokenId,
          price: roundedPrice,
          size: roundedSize,
          side: clobSide,
        },
        { tickSize, negRisk },
        OrderType.GTC,
      );

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

      // pUSD collateral has 6 decimals
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
    const defaultConfig =
      getAllVaultConfigs().find((config) => config.enabled) ?? getAllVaultConfigs()[0];
    if (!defaultConfig) {
      throw new Error("No vault configuration available for VaultTradingClient");
    }
    vaultTradingClient = createVaultTradingClient(defaultConfig);
  }
  return vaultTradingClient;
}

export function createVaultTradingClient(config: VaultInstanceConfig): VaultTradingClient {
  const identity = resolveVaultIdentity(config);
  return new VaultTradingClient({
    safeAddress: identity.safeAddress,
    privateKey: identity.tradingSignerKey,
    signatureType: identity.tradingSignatureType,
  });
}
