/**
 * Trading Client - Polymarket CLOB SDK Wrapper
 * 
 * Handles authentication, order placement, and order book queries.
 * Uses EOA (Externally Owned Account) signature type.
 */

import { ClobClient, Side, AssetType } from "@polymarket/clob-client"
import { Wallet } from "ethers"
import { BOT_CONFIG } from "./config.js"
import type { OrderBook, TradeResult, WalletStatus } from "./types.js"
import { logger } from "../logger.js"

// Polygon mainnet chain ID
const CHAIN_ID = 137

// Polymarket CLOB API endpoint
const CLOB_HOST = "https://clob.polymarket.com"

export class TradingClient {
    private client: ClobClient | null = null
    private wallet: Wallet | null = null
    private initialized = false

    /**
     * Initialize the trading client with a private key.
     * This derives API credentials from the private key.
     */
    async initialize(privateKey: string): Promise<void> {
        if (!privateKey || !privateKey.startsWith("0x")) {
            throw new Error("Invalid private key format. Must start with 0x")
        }

        try {
            // Create wallet from private key
            this.wallet = new Wallet(privateKey)
            const walletAddress = this.wallet.address

            logger.info("TradingClient: Initializing with wallet", {
                address: walletAddress,
            })

            // Create initial client without API creds (for deriving them)
            // For EOA (signature type 0), funder address = wallet address
            this.client = new ClobClient(
                CLOB_HOST,
                CHAIN_ID,
                this.wallet,
                undefined, // No API creds yet
                0, // EOA signature type
                walletAddress // funderAddress - where USDC is held
            )

            // Derive or create API credentials from the private key
            // createOrDeriveApiKey will create a new key if none exists, or derive existing one
            const apiCreds = await this.client.createOrDeriveApiKey()

            if (!apiCreds?.key || !apiCreds?.secret || !apiCreds?.passphrase) {
                throw new Error("Failed to obtain valid API credentials from Polymarket")
            }

            logger.info("TradingClient: Obtained API credentials", {
                hasApiKey: !!apiCreds.key,
                hasSecret: !!apiCreds.secret,
            })

            // Recreate client with API credentials
            this.client = new ClobClient(
                CLOB_HOST,
                CHAIN_ID,
                this.wallet,
                apiCreds,
                0, // EOA signature type
                walletAddress // funderAddress - where USDC is held
            )

            this.initialized = true
            logger.info("TradingClient: Initialization complete")
        } catch (error) {
            logger.error("TradingClient: Initialization failed", {
                error: (error as Error).message,
            })
            throw error
        }
    }

    /**
     * Check if the client is ready for trading.
     */
    isInitialized(): boolean {
        return this.initialized && this.client !== null && this.wallet !== null
    }

    /**
     * Get wallet address.
     */
    getWalletAddress(): string | null {
        return this.wallet?.address ?? null
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
            }
        }

        const issues: string[] = []
        let usdcBalance = 0
        let allowanceOk = false

        try {
            // Get balance info from CLOB
            const balanceAllowance = await this.client!.getBalanceAllowance({
                asset_type: AssetType.COLLATERAL,
            })

            usdcBalance = parseFloat(balanceAllowance.balance ?? "0") / 1e6 // USDC has 6 decimals

            // Check if allowance is sufficient
            const allowance = parseFloat(balanceAllowance.allowance ?? "0")
            allowanceOk = allowance > 0

            if (usdcBalance < BOT_CONFIG.MIN_WALLET_RESERVE) {
                issues.push(`USDC balance ($${usdcBalance.toFixed(2)}) below minimum reserve ($${BOT_CONFIG.MIN_WALLET_RESERVE})`)
            }

            if (!allowanceOk) {
                issues.push("USDC allowance not set for Polymarket Exchange contract")
            }
        } catch (error) {
            issues.push(`Failed to check balance: ${(error as Error).message}`)
        }

        return {
            ready: issues.length === 0,
            walletAddress: this.wallet!.address,
            usdcBalance,
            allowanceOk,
            issues,
        }
    }

    /**
     * Get current USDC balance.
     */
    async getBalance(): Promise<number> {
        if (!this.isInitialized()) {
            throw new Error("Trading client not initialized")
        }

        try {
            const balanceAllowance = await this.client!.getBalanceAllowance({
                asset_type: AssetType.COLLATERAL,
            })

            // Handle various response formats
            const balanceStr = balanceAllowance?.balance
            if (!balanceStr) {
                logger.warn("TradingClient: Balance response is empty", { balanceAllowance })
                return 0
            }

            // Balance is in wei (6 decimals for USDC)
            const balance = parseFloat(String(balanceStr)) / 1e6
            return isNaN(balance) ? 0 : balance
        } catch (error) {
            logger.error("TradingClient: Failed to get balance", {
                error: (error as Error).message,
            })
            // Return 0 instead of throwing - balance check is informational
            return 0
        }
    }

    /**
     * Get order book for a specific token.
     */
    async getOrderBook(tokenId: string): Promise<OrderBook> {
        if (!this.isInitialized()) {
            throw new Error("Trading client not initialized")
        }

        try {
            const book = await this.client!.getOrderBook(tokenId)

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
            }
        } catch (error) {
            logger.error("TradingClient: Failed to get order book", {
                tokenId,
                error: (error as Error).message,
            })
            throw error
        }
    }

    /**
     * Calculate effective price for a given order size.
     * Walks the order book to determine average fill price.
     */
    calculateEffectivePrice(
        asks: { price: number; size: number }[],
        usdcAmount: number
    ): { effectivePrice: number; canFill: boolean; tokensReceived: number } {
        if (asks.length === 0) {
            return { effectivePrice: 1, canFill: false, tokensReceived: 0 }
        }

        // Sort asks by price (lowest first)
        const sortedAsks = [...asks].sort((a, b) => a.price - b.price)

        let remainingUsdc = usdcAmount
        let totalTokens = 0
        let totalCost = 0

        for (const ask of sortedAsks) {
            if (remainingUsdc <= 0) break

            // How many tokens can we buy at this price level?
            const maxTokensAtLevel = ask.size
            const costForAllTokens = maxTokensAtLevel * ask.price

            if (costForAllTokens <= remainingUsdc) {
                // Take entire level
                totalTokens += maxTokensAtLevel
                totalCost += costForAllTokens
                remainingUsdc -= costForAllTokens
            } else {
                // Partial fill at this level
                const tokensWeBuy = remainingUsdc / ask.price
                totalTokens += tokensWeBuy
                totalCost += remainingUsdc
                remainingUsdc = 0
            }
        }

        if (remainingUsdc > 0.001) {
            // Couldn't fill the entire order
            return { effectivePrice: 1, canFill: false, tokensReceived: totalTokens }
        }

        const effectivePrice = totalCost / totalTokens
        return { effectivePrice, canFill: true, tokensReceived: totalTokens }
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
        maxPrice: number
    ): Promise<TradeResult> {
        if (!this.isInitialized()) {
            return { success: false, error: "Trading client not initialized" }
        }

        try {
            // Get current order book
            const orderBook = await this.getOrderBook(tokenId)

            // Calculate effective price
            const { effectivePrice, canFill, tokensReceived } = this.calculateEffectivePrice(
                orderBook.asks,
                usdcAmount
            )

            if (!canFill) {
                return {
                    success: false,
                    error: "Insufficient liquidity to fill order",
                }
            }

            // Reject if market price is already above our max tolerance
            if (effectivePrice > maxPrice) {
                return {
                    success: false,
                    error: `Effective price (${effectivePrice.toFixed(4)}) exceeds max price (${maxPrice})`,
                }
            }

            // Use effective price + 0.1% buffer for the limit order
            // This ensures we don't pay more than current market + tiny buffer
            const limitPrice = Math.min(effectivePrice * 1.001, 0.999)

            logger.info("TradingClient: Placing market buy order", {
                tokenId,
                usdcAmount,
                maxPrice,
                effectivePrice,
                limitPrice,
                tokensReceived,
            })

            // Create and place the order
            // Using a limit order at the effective price (plus tiny buffer)
            const order = await this.client!.createOrder({
                tokenID: tokenId,
                price: limitPrice,
                size: tokensReceived,
                side: Side.BUY,
            })

            const result = await this.client!.postOrder(order)

            logger.info("TradingClient: Order placed", {
                orderId: result.orderID,
                status: result.status,
            })

            return {
                success: result.success ?? false,
                orderId: result.orderID,
                fillPrice: effectivePrice,
                fillSize: tokensReceived,
            }
        } catch (error) {
            const errorMsg = (error as Error).message
            logger.error("TradingClient: Order placement failed", {
                tokenId,
                error: errorMsg,
            })

            // Rethrow rate limit/block errors to stop further requests
            if (errorMsg.includes("403") || errorMsg.includes("429") || errorMsg.includes("blocked")) {
                throw new Error(`API blocked or rate limited: ${errorMsg}`)
            }

            return {
                success: false,
                error: errorMsg,
            }
        }
    }

    /**
     * Get current positions (open orders and fills).
     */
    async getOpenOrders(): Promise<unknown[]> {
        if (!this.isInitialized()) {
            return []
        }

        try {
            const orders = await this.client!.getOpenOrders()
            return orders
        } catch (error) {
            logger.error("TradingClient: Failed to get open orders", {
                error: (error as Error).message,
            })
            return []
        }
    }
}

// Singleton instance
let tradingClientInstance: TradingClient | null = null

export function getTradingClient(): TradingClient {
    if (!tradingClientInstance) {
        tradingClientInstance = new TradingClient()
    }
    return tradingClientInstance
}
