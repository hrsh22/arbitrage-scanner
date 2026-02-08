/**
 * Trading Client - Polymarket CLOB SDK Wrapper
 *
 * Handles authentication, order placement, and order book queries.
 * Uses Gnosis Safe (signature type 2) for Polymarket proxy wallets.
 *
 * Supports multiple bot instances by accepting wallet credentials as env var names.
 */

import { ClobClient, Side, AssetType, OrderType } from "@polymarket/clob-client";
import { Wallet, ethers } from "ethers";
import type { OrderBook, TradeResult, WalletStatus } from "./types.js";
import { logger } from "../logger.js";
import { calculateEffectivePrice } from "./orderBookUtils.js";
import { getErrorLogger, ERROR_CODES } from "./errorLogger.js";

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

  // Wallet credential env var names
  private privateKeyEnv: string;
  private funderAddressEnv: string | undefined;

  // Minimum wallet reserve for readiness check (can be overridden per-bot)
  private minWalletReserve: number = 10;

  /**
   * Create a new trading client.
   *
   * @param privateKeyEnv - Env var name for private key (e.g., "POLYMARKET_PRIVATE_KEY")
   * @param funderAddressEnv - Env var name for funder address (e.g., "POLYMARKET_FUNDER_ADDRESS")
   * @param minWalletReserve - Minimum wallet reserve for readiness checks
   */
  constructor(
    privateKeyEnv: string = "POLYMARKET_PRIVATE_KEY",
    funderAddressEnv?: string,
    minWalletReserve: number = 10,
  ) {
    this.privateKeyEnv = privateKeyEnv;
    this.funderAddressEnv = funderAddressEnv;
    this.minWalletReserve = minWalletReserve;
  }

  /**
   * Initialize the trading client.
   * Reads credentials from environment variables and sets up the CLOB client.
   */
  async initialize(): Promise<void> {
    const privateKey = process.env[this.privateKeyEnv];

    if (!privateKey) {
      throw new Error(`Missing env var: ${this.privateKeyEnv}`);
    }

    if (!privateKey.startsWith("0x")) {
      throw new Error(`Invalid private key format in ${this.privateKeyEnv}. Must start with 0x`);
    }

    try {
      // Create wallet from private key
      this.wallet = new Wallet(privateKey);
      const walletAddress = this.wallet.address;

      // Get funder address from env var if specified
      this.funderAddress = this.funderAddressEnv
        ? (process.env[this.funderAddressEnv] ?? null)
        : null;

      logger.info("TradingClient: Initializing with wallet", {
        address: walletAddress,
        funderAddress: this.funderAddress,
        signatureType: SIGNATURE_TYPE,
        privateKeyEnv: this.privateKeyEnv,
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
        throw new Error("Failed to obtain valid API credentials from Polymarket");
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
      const errorLogger = getErrorLogger();
      await errorLogger.logError(error as Error, "tradingClient.initialize", {
        errorCode: ERROR_CODES.WALLET_ERROR,
        severity: "critical",
        context: { privateKeyEnv: this.privateKeyEnv },
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
   * Get funder address (proxy wallet).
   */
  getFunderAddress(): string | null {
    return this.funderAddress;
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

      if (usdcBalance < this.minWalletReserve) {
        issues.push(
          `USDC balance ($${usdcBalance.toFixed(2)}) below minimum reserve ($${this.minWalletReserve})`,
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
      const provider = new ethers.providers.JsonRpcProvider("https://1rpc.io/matic");
      const walletWithProvider = this.wallet!.connect(provider);

      const usdcContract = new ethers.Contract(USDC_ADDRESS, erc20Abi, walletWithProvider);

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

      return {
        bids: (book.bids ?? []).map((level) => ({
          price: parseFloat(String(level.price)),
          size: parseFloat(String(level.size)),
        })),
        asks: (book.asks ?? []).map((level) => ({
          price: parseFloat(String(level.price)),
          size: parseFloat(String(level.size)),
        })),
        lastTradePrice:
          "last_trade_price" in book && book.last_trade_price
            ? parseFloat(String(book.last_trade_price))
            : undefined,
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
   * Place a market buy order.
   *
   * @param tokenId - The outcome token to buy
   * @param usdcAmount - Amount of USDC to spend
   * @param maxPrice - Maximum price to pay (for slippage protection)
   * @param useMarketOrder - If true, use FOK market order; if false, use limit order
   */
  async placeBet(
    tokenId: string,
    usdcAmount: number,
    maxPrice: number,
    useMarketOrder: boolean = false,
  ): Promise<TradeResult> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      // Get current order book
      const orderBook = await this.getOrderBook(tokenId);

      const { effectivePrice, canFill, tokensReceived } = calculateEffectivePrice(
        orderBook.asks,
        usdcAmount,
      );

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

      if (useMarketOrder) {
        return await this.placeMarketBuyOrder(tokenId, usdcAmount, effectivePrice);
      } else {
        return await this.placeLimitBuyOrder(tokenId, effectivePrice, tokensReceived, maxPrice);
      }
    } catch (error) {
      const errorMsg = (error as Error).message;
      const errorLogger = getErrorLogger();
      await errorLogger.logOrderError(error as Error, {
        marketId: tokenId,
        tokenId,
        side: "BUY",
        amount: usdcAmount,
      });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private async placeLimitBuyOrder(
    tokenId: string,
    effectivePrice: number,
    tokensReceived: number,
    maxPrice: number,
  ): Promise<TradeResult> {
    // Add 0.1% buffer for execution, but cap at maxPrice from bot config
    const limitPrice = Math.min(effectivePrice * 1.001, maxPrice);
    const roundedPrice = Math.floor(limitPrice * 100) / 100;
    const roundedSize = Math.floor(tokensReceived * 10000) / 10000;

    logger.info("TradingClient: Placing limit buy order", {
      tokenId,
      effectivePrice,
      limitPrice,
      roundedPrice,
      tokensReceived,
      roundedSize,
    });

    const order = await this.client!.createOrder({
      tokenID: tokenId,
      price: roundedPrice,
      size: roundedSize,
      side: Side.BUY,
    });

    const result = await this.client!.postOrder(order);

    logger.info("TradingClient: Limit order placed", {
      orderId: result.orderID,
      status: result.status,
      errorMsg: result.errorMsg,
      error: (result as unknown as { error?: string }).error,
    });

    const errorField = result.errorMsg || (result as unknown as { error?: string }).error;
    const isInsufficientBalance = errorField?.includes("INVALID_ORDER_NOT_ENOUGH_BALANCE");

    return {
      success: result.success ?? false,
      orderId: result.orderID,
      fillPrice: effectivePrice,
      fillSize: roundedSize,
      error: errorField || undefined,
      insufficientBalance: isInsufficientBalance,
    };
  }

  private async placeMarketBuyOrder(
    tokenId: string,
    usdcAmount: number,
    effectivePrice: number,
  ): Promise<TradeResult> {
    const roundedAmount = Math.floor(usdcAmount * 100) / 100;

    logger.info("TradingClient: Placing FOK market buy order", {
      tokenId,
      usdcAmount,
      roundedAmount,
      effectivePrice,
    });

    const order = await this.client!.createMarketOrder({
      tokenID: tokenId,
      amount: roundedAmount,
      side: Side.BUY,
    });

    const result = await this.client!.postOrder(order, OrderType.FOK);

    logger.info("TradingClient: Market order placed", {
      orderId: result.orderID,
      status: result.status,
      errorMsg: result.errorMsg,
      error: (result as unknown as { error?: string }).error,
    });

    const tokensReceived = roundedAmount / effectivePrice;
    const errorField = result.errorMsg || (result as unknown as { error?: string }).error;
    const isInsufficientBalance = errorField?.includes("INVALID_ORDER_NOT_ENOUGH_BALANCE");

    return {
      success: result.success ?? false,
      orderId: result.orderID,
      fillPrice: effectivePrice,
      fillSize: tokensReceived,
      error: errorField || undefined,
      insufficientBalance: isInsufficientBalance,
    };
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

  /**
   * Get the current sell price for a token.
   * Uses the CLOB price API which considers market maker liquidity.
   *
   * @param tokenId - The token ID to get sell price for
   * @returns The price you would get when selling (0-1 range)
   */
  async getSellPrice(tokenId: string): Promise<number> {
    try {
      const response = await fetch(`${CLOB_HOST}/price?token_id=${tokenId}&side=sell`);

      if (!response.ok) {
        throw new Error(`Price API returned ${response.status}`);
      }

      const data = (await response.json()) as { price?: string };
      const price = parseFloat(data.price ?? "0");

      return isNaN(price) ? 0 : price;
    } catch (error) {
      logger.error("TradingClient: Failed to get sell price", {
        tokenId,
        error: (error as Error).message,
      });
      return 0;
    }
  }

  /**
   * Get the actual token balance for this wallet.
   * Queries the Data API to get real share count.
   *
   * @param tokenId - The token ID to check balance for
   * @returns The actual number of shares held
   */
  async getTokenBalance(tokenId: string): Promise<number> {
    try {
      const walletAddress = this.funderAddress || this.wallet?.address;
      if (!walletAddress) {
        return 0;
      }

      const response = await fetch(
        `https://data-api.polymarket.com/positions?user=${walletAddress}`,
      );

      if (!response.ok) {
        throw new Error(`Data API returned ${response.status}`);
      }

      const positions = (await response.json()) as Array<{ asset: string; size: number }>;
      const position = positions.find((p) => p.asset === tokenId);

      return position?.size ?? 0;
    } catch (error) {
      logger.error("TradingClient: Failed to get token balance", {
        tokenId,
        error: (error as Error).message,
      });
      return 0;
    }
  }

  /**
   * Get all positions with shares > 0 from Polymarket API.
   * This is the source of truth for what we actually own.
   */
  async getAllPositions(): Promise<
    Array<{
      tokenId: string;
      size: number;
      avgPrice: number;
      curPrice: number;
      outcome: string;
      marketSlug?: string;
      conditionId?: string;
      redeemable: boolean;
    }>
  > {
    try {
      const walletAddress = this.funderAddress || this.wallet?.address;
      if (!walletAddress) {
        logger.warn("TradingClient: No wallet address for getAllPositions");
        return [];
      }

      const response = await fetch(
        `https://data-api.polymarket.com/positions?user=${walletAddress}&sizeThreshold=0`,
      );

      if (!response.ok) {
        throw new Error(`Data API returned ${response.status}`);
      }

      const positions = (await response.json()) as Array<{
        asset: string;
        size: number;
        avgPrice: number;
        curPrice: number;
        outcome: string;
        slug?: string;
        conditionId?: string;
        redeemable?: boolean;
      }>;

      // Filter to positions with shares > 0
      return positions
        .filter((p) => p.size > 0)
        .map((p) => ({
          tokenId: p.asset,
          size: p.size,
          avgPrice: p.avgPrice,
          curPrice: p.curPrice,
          outcome: p.outcome,
          marketSlug: p.slug,
          conditionId: p.conditionId,
          redeemable: p.redeemable ?? false,
        }));
    } catch (error) {
      logger.error("TradingClient: Failed to get all positions", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Sell shares of a token at market price.
   *
   * @param tokenId - The token ID to sell
   * @param shares - Number of shares to sell
   * @param minPrice - Minimum acceptable sell price (slippage protection)
   * @returns Trade result with success status and details
   */
  async sellPosition(
    tokenId: string,
    shares: number,
    minPrice: number = 0.99,
  ): Promise<TradeResult> {
    if (!this.isInitialized()) {
      return { success: false, error: "Trading client not initialized" };
    }

    try {
      // Get current sell price
      const sellPrice = await this.getSellPrice(tokenId);

      if (sellPrice < minPrice) {
        return {
          success: false,
          error: `Sell price (${sellPrice.toFixed(4)}) below minimum (${minPrice})`,
        };
      }

      logger.info("TradingClient: Placing market sell order", {
        tokenId,
        shares,
        sellPrice,
        minPrice,
      });

      const orderPrice = 0.999;
      const roundedSize = Math.floor(shares * 10000) / 10000;

      const order = await this.client!.createOrder({
        tokenID: tokenId,
        price: orderPrice,
        size: roundedSize,
        side: Side.SELL,
      });

      const result = await this.client!.postOrder(order);

      // Check if order was successful - handle various response formats
      const isSuccess =
        result.success === true || result.status === "matched" || result.status === "delayed";

      if (!isSuccess) {
        logger.error("TradingClient: Sell order rejected", {
          tokenId,
          shares,
          result,
        });
        return {
          success: false,
          error: `Order rejected: ${result.status || "unknown"}`,
        };
      }

      logger.info("TradingClient: Sell order placed", {
        orderId: result.orderID,
        status: result.status,
      });

      return {
        success: true,
        orderId: result.orderID,
        fillPrice: sellPrice,
        fillSize: shares,
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error("TradingClient: Sell order failed", {
        tokenId,
        shares,
        error: errorMsg,
      });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}

// Cache of trading client instances by wallet env var name
const tradingClientInstances: Map<string, TradingClient> = new Map();

/**
 * Get a trading client for a specific wallet.
 * Uses caching to return the same instance for the same wallet.
 *
 * @param privateKeyEnv - Env var name for private key
 * @param funderAddressEnv - Env var name for funder address
 * @param minWalletReserve - Minimum wallet reserve
 */
export function getTradingClient(
  privateKeyEnv: string = "POLYMARKET_PRIVATE_KEY",
  funderAddressEnv?: string,
  minWalletReserve: number = 10,
): TradingClient {
  const cacheKey = `${privateKeyEnv}:${funderAddressEnv ?? ""}`;

  let instance = tradingClientInstances.get(cacheKey);
  if (!instance) {
    instance = new TradingClient(privateKeyEnv, funderAddressEnv, minWalletReserve);
    tradingClientInstances.set(cacheKey, instance);
  }

  return instance;
}
