/**
 * Trading Client - Polymarket CLOB SDK Wrapper
 *
 * Handles authentication, order placement, and order book queries.
 * Uses Gnosis Safe (signature type 2) for Polymarket proxy wallets.
 */

import { ClobClient, Side, AssetType } from "@polymarket/clob-client";
import { Wallet, ethers } from "ethers";
import { BOT_CONFIG } from "./config.js";
import type { OrderBook, TradeResult, WalletStatus } from "./types.js";
import { logger } from "../logger.js";

// Polygon mainnet chain ID
const CHAIN_ID = 137;

// Polymarket CLOB API endpoint
const CLOB_HOST = "https://clob.polymarket.com";

// Signature types for CLOB client
// 0 = EOA (standard wallet, funds in EOA directly)
// 1 = Polymarket Proxy (Magic Link users)
// 2 = Gnosis Safe (MetaMask users with proxy wallet on polymarket.com)
const SIGNATURE_TYPE = 2; // Gnosis Safe for MetaMask-connected Polymarket users

export class TradingClient {
  private client: ClobClient | null = null;
  private wallet: Wallet | null = null;
  private funderAddress: string | null = null;
  private initialized = false;

  /**
   * Initialize the trading client with a private key.
   * This derives API credentials from the private key.
   * @param privateKey - The EOA private key
   * @param funderAddress - Optional proxy wallet address (for Polymarket web users)
   */
  async initialize(privateKey: string, funderAddress?: string): Promise<void> {
    if (!privateKey || !privateKey.startsWith("0x")) {
      throw new Error("Invalid private key format. Must start with 0x");
    }

    try {
      // Create wallet from private key
      this.wallet = new Wallet(privateKey);
      const walletAddress = this.wallet.address;
      this.funderAddress =
        funderAddress || process.env.POLYMARKET_FUNDER_ADDRESS || null;

      logger.info("TradingClient: Initializing with wallet", {
        address: walletAddress,
        funderAddress: this.funderAddress,
        signatureType: SIGNATURE_TYPE,
      });

      // Create initial client without API creds (for deriving them)
      // For Gnosis Safe, pass funderAddress as the 6th parameter
      this.client = new ClobClient(
        CLOB_HOST,
        CHAIN_ID,
        this.wallet,
        undefined, // No creds yet
        SIGNATURE_TYPE,
        this.funderAddress || undefined,
      );

      // Derive or create API credentials from the private key
      // createOrDeriveApiKey will create a new key if none exists, or derive existing one
      const apiCreds = await this.client.createOrDeriveApiKey();

      if (!apiCreds?.key || !apiCreds?.secret || !apiCreds?.passphrase) {
        throw new Error(
          "Failed to obtain valid API credentials from Polymarket",
        );
      }

      logger.info("TradingClient: Obtained API credentials", {
        hasApiKey: !!apiCreds.key,
        hasSecret: !!apiCreds.secret,
      });

      // Recreate client with API credentials, signature type, and funder
      this.client = new ClobClient(
        CLOB_HOST,
        CHAIN_ID,
        this.wallet,
        apiCreds,
        SIGNATURE_TYPE,
        this.funderAddress || undefined,
      );

      this.initialized = true;
      logger.info("TradingClient: Initialization complete");
    } catch (error) {
      logger.error("TradingClient: Initialization failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Check if the client is ready for trading.
   */
  isInitialized(): boolean {
    return this.initialized && this.client !== null && this.wallet !== null;
  }

  /**
   * Get wallet address.
   */
  getWalletAddress(): string | null {
    return this.wallet?.address ?? null;
  }

  /**
   * Check wallet readiness for trading.
   * Verifies balance and allowances.
   */
  async checkReadiness(): Promise<WalletStatus> {
    if (!this.isInitialized()) {
      return {
        ready: false,
        walletAddress: "",
        usdcBalance: 0,
        allowanceOk: false,
        issues: ["Trading client not initialized"],
      };
    }

    const issues: string[] = [];
    let usdcBalance = 0;
    let allowanceOk = false;

    try {
      // Get balance info from CLOB
      const balanceAllowance = await this.client!.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });

      usdcBalance = parseFloat(balanceAllowance.balance ?? "0") / 1e6; // USDC has 6 decimals

      // Check if allowance is sufficient
      const allowance = parseFloat(balanceAllowance.allowance ?? "0");
      allowanceOk = allowance > 0;

      if (usdcBalance < BOT_CONFIG.MIN_WALLET_RESERVE) {
        issues.push(
          `USDC balance ($${usdcBalance.toFixed(2)}) below minimum reserve ($${BOT_CONFIG.MIN_WALLET_RESERVE})`,
        );
      }

      if (!allowanceOk) {
        issues.push("USDC allowance not set for Polymarket Exchange contract");
      }
    } catch (error) {
      issues.push(`Failed to check balance: ${(error as Error).message}`);
    }

    return {
      ready: issues.length === 0,
      walletAddress: this.wallet!.address,
      usdcBalance,
      allowanceOk,
      issues,
    };
  }

  /**
   * Approve USDC spending for Polymarket Exchange contract.
   * This allows to exchange to spend USDC on your behalf for trading.
   */
  async approveAllowance(): Promise<{
    success: boolean;
    txHash?: string;
    error?: string;
  }> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      // USDC contract address on Polygon (native)
      const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

      // Exchange contract addresses (CLOB API returns these)
      const exchangeAddresses = [
        "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
        "0xC5d563A36AE78145C45a50134d48A1215220f80a",
        "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
      ];

      // ERC20 ABI for approve function
      const erc20Abi = [
        "function approve(address spender, uint256 amount) external returns (bool)",
      ];

      // Connect wallet to a provider for broadcasting transactions
      const provider = new ethers.providers.JsonRpcProvider(
        "https://1rpc.io/matic",
      );
      const walletWithProvider = this.wallet!.connect(provider);

      const usdcContract = new ethers.Contract(
        USDC_ADDRESS,
        erc20Abi,
        walletWithProvider,
      );

      // Approve() first exchange contract (typically) active one)
      const exchangeAddress = exchangeAddresses[0];
      const amount = ethers.constants.MaxUint256; // Unlimited approval

      logger.info("TradingClient: Approving USDC for Exchange contract", {
        exchangeAddress,
        amount: "unlimited",
      });

      // Get current gas price and add 20% buffer for faster confirmation
      const gasPrice = await provider.getGasPrice();
      const fastGasPrice = gasPrice.mul(120).div(100);

      logger.info("TradingClient: Sending approval tx", {
        gasPrice: ethers.utils.formatUnits(fastGasPrice, "gwei") + " gwei",
      });

      // Approve all 3 exchange contracts
      const txHashes: string[] = [];
      for (const addr of exchangeAddresses) {
        logger.info("TradingClient: Approving for", { exchange: addr });
        const tx = await usdcContract.approve(addr, amount, {
          gasLimit: 100000,
          gasPrice: fastGasPrice,
        });
        logger.info("TradingClient: Tx submitted", { txHash: tx.hash });
        const receipt = await tx.wait(1);
        txHashes.push(receipt.transactionHash);
      }

      logger.info("TradingClient: All approvals successful", { txHashes });

      return {
        success: true,
        txHash: txHashes.join(", "),
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("TradingClient: Approval failed", { error: errorMsg });
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get current USDC balance.
   */
  async getBalance(): Promise<number> {
    if (!this.isInitialized()) {
      throw new Error("Trading client not initialized");
    }

    try {
      const balanceAllowance = await this.client!.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });

      // Handle various response formats
      const balanceStr = balanceAllowance?.balance;
      if (!balanceStr) {
        logger.warn("TradingClient: Balance response is empty", {
          balanceAllowance,
        });
        return 0;
      }

      // Balance is in wei (6 decimals for USDC)
      const balance = parseFloat(String(balanceStr)) / 1e6;
      return isNaN(balance) ? 0 : balance;
    } catch (error) {
      logger.error("TradingClient: Failed to get balance", {
        error: (error as Error).message,
      });
      // Return 0 instead of throwing - balance check is informational
      return 0;
    }
  }

  /**
   * Get order book for a specific token.
   */
  async getOrderBook(tokenId: string): Promise<OrderBook> {
    if (!this.isInitialized()) {
      throw new Error("Trading client not initialized");
    }

    try {
      const book = await this.client!.getOrderBook(tokenId);

      // Parse order book - SDK returns OrderSummary objects with price/size properties
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
      logger.error("TradingClient: Failed to get order book", {
        tokenId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Calculate effective price for a given order size.
   * Walks the order book to determine average fill price.
   */
  calculateEffectivePrice(
    asks: { price: number; size: number }[],
    usdcAmount: number,
  ): { effectivePrice: number; canFill: boolean; tokensReceived: number } {
    if (asks.length === 0) {
      return { effectivePrice: 1, canFill: false, tokensReceived: 0 };
    }

    // Sort asks by price (lowest first)
    const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

    let remainingUsdc = usdcAmount;
    let totalTokens = 0;
    let totalCost = 0;

    for (const ask of sortedAsks) {
      if (remainingUsdc <= 0) break;

      // How many tokens can we buy at this price level?
      const maxTokensAtLevel = ask.size;
      const costForAllTokens = maxTokensAtLevel * ask.price;

      if (costForAllTokens <= remainingUsdc) {
        // Take entire level
        totalTokens += maxTokensAtLevel;
        totalCost += costForAllTokens;
        remainingUsdc -= costForAllTokens;
      } else {
        // Partial fill at this level
        const tokensWeBuy = remainingUsdc / ask.price;
        totalTokens += tokensWeBuy;
        totalCost += remainingUsdc;
        remainingUsdc = 0;
      }
    }

    if (remainingUsdc > 0.001) {
      // Couldn't fill the entire order
      return { effectivePrice: 1, canFill: false, tokensReceived: totalTokens };
    }

    const effectivePrice = totalCost / totalTokens;
    return { effectivePrice, canFill: true, tokensReceived: totalTokens };
  }

  /**
   * Place a market buy order.
   *
   * @param tokenId - The outcome token to buy
   * @param usdcAmount - Amount of USDC to spend
   * @param maxPrice - Maximum price to pay (for slippage protection)
   */
  async placeBet(
    tokenId: string,
    usdcAmount: number,
    maxPrice: number,
  ): Promise<TradeResult> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      // Get current order book
      const orderBook = await this.getOrderBook(tokenId);

      // Calculate effective price
      const { effectivePrice, canFill, tokensReceived } =
        this.calculateEffectivePrice(orderBook.asks, usdcAmount);

      if (!canFill) {
        return {
          success: false,
          error: "Insufficient liquidity to fill order",
        };
      }

      // Reject if market price is already above our max tolerance
      if (effectivePrice > maxPrice) {
        return {
          success: false,
          error: `Effective price (${effectivePrice.toFixed(4)}) exceeds max price (${maxPrice})`,
        };
      }

      // Use effective price + 0.1% buffer for the limit order
      // This ensures we don't pay more than current market + tiny buffer
      const limitPrice = Math.min(effectivePrice * 1.001, 0.999);

      logger.info("TradingClient: Placing market buy order", {
        tokenId,
        usdcAmount,
        maxPrice,
        effectivePrice,
        limitPrice,
        tokensReceived,
      });

      // Create and place the order
      // Using a limit order at the effective price (plus tiny buffer)
      const order = await this.client!.createOrder({
        tokenID: tokenId,
        price: limitPrice,
        size: tokensReceived,
        side: Side.BUY,
      });

      const result = await this.client!.postOrder(order);

      logger.info("TradingClient: Order placed", {
        orderId: result.orderID,
        status: result.status,
      });

      return {
        success: result.success ?? false,
        orderId: result.orderID,
        fillPrice: effectivePrice,
        fillSize: tokensReceived,
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("TradingClient: Order placement failed", {
        tokenId,
        error: errorMsg,
      });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get current positions (open orders and fills).
   */
  async getOpenOrders(): Promise<unknown[]> {
    if (!this.isInitialized()) {
      return [];
    }

    try {
      const orders = await this.client!.getOpenOrders();
      return orders;
    } catch (error) {
      logger.error("TradingClient: Failed to get open orders", {
        error: (error as Error).message,
      });
      return [];
    }
  }
}

// Singleton instance
let tradingClientInstance: TradingClient | null = null;

export function getTradingClient(): TradingClient {
  if (!tradingClientInstance) {
    tradingClientInstance = new TradingClient();
  }
  return tradingClientInstance;
}
