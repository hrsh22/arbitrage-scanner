import { ClobClient, Side } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { env, getChainIdForNetwork, isTestnet } from "../env.js";
import { logger } from "../logger.js";
import type { PolymarketOrder, OrderResult } from "./types.js";

const CHAIN_ID = getChainIdForNetwork();
const POLYMARKET_CLOB_URL = "https://clob.polymarket.com";

export class TradingService {
  private client: ClobClient;
  private wallet: Wallet;
  private safeAddress: string;
  private initialized: boolean = false;

  constructor(privateKey: string, safeAddress: string) {
    if (isTestnet()) {
      throw new Error("TradingService (Polymarket CLOB) is only available on mainnet");
    }
    this.wallet = new Wallet(privateKey);
    this.safeAddress = safeAddress;

    this.client = new ClobClient(
      POLYMARKET_CLOB_URL,
      CHAIN_ID,
      this.wallet,
      undefined,
      undefined,
      safeAddress,
    );
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.client.createOrDeriveApiKey();
    this.initialized = true;
    logger.info("TradingService initialized with Polymarket CLOB", {
      safeAddress: this.safeAddress,
    });
  }

  async placeOrder(order: PolymarketOrder): Promise<OrderResult> {
    await this.ensureInitialized();
    try {
      const side = order.side === "BUY" ? Side.BUY : Side.SELL;
      const signedOrder = await this.client.createOrder({
        tokenID: order.tokenId,
        side,
        price: order.price,
        size: order.size,
        feeRateBps: order.feeRateBps ?? 0,
        nonce: order.nonce ?? Date.now(),
        expiration: order.expiration ?? 0,
      });

      const response = await this.client.postOrder(signedOrder);

      logger.info("Order placed", {
        safeAddress: this.safeAddress,
        tokenId: order.tokenId,
        side: order.side,
        price: order.price,
        size: order.size,
        orderId: response.orderID,
      });

      return {
        orderId: response.orderID ?? "",
        status: response.success ? "LIVE" : "FAILED",
      };
    } catch (error) {
      logger.error("Failed to place order", {
        error: (error as Error).message,
        order,
      });
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    await this.ensureInitialized();
    try {
      await this.client.cancelOrder({ orderID: orderId });
      logger.info("Order cancelled", { orderId, safeAddress: this.safeAddress });
      return true;
    } catch (error) {
      logger.error("Failed to cancel order", { error: (error as Error).message, orderId });
      return false;
    }
  }

  async cancelAllOrders(): Promise<boolean> {
    await this.ensureInitialized();
    try {
      await this.client.cancelAll();
      logger.info("All orders cancelled", { safeAddress: this.safeAddress });
      return true;
    } catch (error) {
      logger.error("Failed to cancel all orders", { error: (error as Error).message });
      return false;
    }
  }

  async getOpenOrders(): Promise<unknown[]> {
    await this.ensureInitialized();
    try {
      const orders = await this.client.getOpenOrders();
      return orders;
    } catch (error) {
      logger.error("Failed to get open orders", { error: (error as Error).message });
      return [];
    }
  }

  async getOrderBook(tokenId: string): Promise<{ bids: unknown[]; asks: unknown[] }> {
    try {
      const book = await this.client.getOrderBook(tokenId);
      return book;
    } catch (error) {
      logger.error("Failed to get order book", { error: (error as Error).message, tokenId });
      return { bids: [], asks: [] };
    }
  }

  async getMarketPrice(tokenId: string): Promise<{ bid: number; ask: number; mid: number } | null> {
    try {
      const book = await this.client.getOrderBook(tokenId);
      const bestBid = book.bids?.[0]?.price ? parseFloat(book.bids[0].price) : 0;
      const bestAsk = book.asks?.[0]?.price ? parseFloat(book.asks[0].price) : 0;
      const mid = (bestBid + bestAsk) / 2;
      return { bid: bestBid, ask: bestAsk, mid };
    } catch (error) {
      logger.error("Failed to get market price", { error: (error as Error).message, tokenId });
      return null;
    }
  }

  getSafeAddress(): string {
    return this.safeAddress;
  }
}

const tradingServiceCache = new Map<string, TradingService>();

export function getTradingService(safeAddress: string): TradingService {
  if (isTestnet()) {
    throw new Error("TradingService is only available on mainnet (Polymarket CLOB)");
  }
  if (!env.TRADING_WALLET_PRIVATE_KEY) {
    throw new Error("TRADING_WALLET_PRIVATE_KEY required for trading");
  }

  const normalizedAddress = safeAddress.toLowerCase();
  let service = tradingServiceCache.get(normalizedAddress);

  if (!service) {
    service = new TradingService(env.TRADING_WALLET_PRIVATE_KEY, normalizedAddress);
    tradingServiceCache.set(normalizedAddress, service);
  }

  return service;
}
