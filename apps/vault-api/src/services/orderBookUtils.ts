/**
 * Order Book Utilities
 *
 * Shared utilities for order book analysis including effective price calculation
 * and slippage checks. Used by both StrategyEngine (pre-execution check) and
 * TradingClient (execution).
 *
 * Ported from apps/api/src/bot/orderBookUtils.ts
 */

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface EffectivePriceResult {
  /** Average price per token if order is filled */
  effectivePrice: number;
  /** Whether the full order can be filled with available liquidity */
  canFill: boolean;
  /** Total tokens that would be received */
  tokensReceived: number;
  /** Total USD cost to fill the order */
  totalCost: number;
}

export interface EffectivePriceCheckResult {
  /** Whether the order is acceptable to execute */
  acceptable: boolean;
  /** Effective price after walking the order book */
  effectivePrice: number;
  /** Best ask price (first level) */
  bestAsk: number;
  /** Whether the order can be fully filled */
  canFill: boolean;
  /** Tokens that would be received */
  tokensReceived: number;
  /** Profit if the bet wins: (tokensReceived * $1) - totalCost */
  profitIfWin: number;
  /** Human-readable reason if not acceptable */
  reason?: string;
}

/**
 * Calculate effective price for a given order size by walking the order book.
 *
 * This simulates filling an order by consuming liquidity from lowest to highest
 * price levels, calculating the volume-weighted average price.
 *
 * @param asks - Order book ask levels (will be sorted by price)
 * @param usdcAmount - Amount of USDC to spend
 * @returns Effective price result with fill status and tokens received
 */
export function calculateEffectivePrice(
  asks: OrderBookLevel[],
  usdcAmount: number,
): EffectivePriceResult {
  if (asks.length === 0) {
    return { effectivePrice: 1, canFill: false, tokensReceived: 0, totalCost: 0 };
  }

  // Sort asks by price (lowest first) - always work with a copy
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

  // Check if we could fill the entire order (allow small rounding tolerance)
  if (remainingUsdc > 0.001) {
    return {
      effectivePrice: totalTokens > 0 ? totalCost / totalTokens : 1,
      canFill: false,
      tokensReceived: totalTokens,
      totalCost,
    };
  }

  const effectivePrice = totalCost / totalTokens;
  return { effectivePrice, canFill: true, tokensReceived: totalTokens, totalCost };
}

/**
 * Check if an order has an acceptable effective price.
 *
 * Rejects if:
 * - effectivePrice > maxOdds (profit too small)
 * - effectivePrice >= 1.0 (guaranteed loss even if we win)
 * - Cannot fill the order (insufficient liquidity)
 */
export function checkEffectivePrice(
  asks: OrderBookLevel[],
  usdcAmount: number,
  maxOdds: number,
): EffectivePriceCheckResult {
  if (asks.length === 0) {
    return {
      acceptable: false,
      effectivePrice: 1,
      bestAsk: 1,
      canFill: false,
      tokensReceived: 0,
      profitIfWin: -usdcAmount,
      reason: "No asks in order book",
    };
  }

  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);
  const bestAsk = sortedAsks[0]!.price;

  const { effectivePrice, canFill, tokensReceived, totalCost } = calculateEffectivePrice(
    sortedAsks,
    usdcAmount,
  );

  const profitIfWin = tokensReceived - totalCost;

  if (!canFill) {
    return {
      acceptable: false,
      effectivePrice,
      bestAsk,
      canFill: false,
      tokensReceived,
      profitIfWin,
      reason: `Insufficient liquidity: only ${tokensReceived.toFixed(2)} tokens available`,
    };
  }

  if (effectivePrice >= 1.0) {
    return {
      acceptable: false,
      effectivePrice,
      bestAsk,
      canFill: true,
      tokensReceived,
      profitIfWin,
      reason: `Guaranteed loss: effective price ${(effectivePrice * 100).toFixed(1)}¢ >= $1.00`,
    };
  }

  if (effectivePrice > maxOdds) {
    return {
      acceptable: false,
      effectivePrice,
      bestAsk,
      canFill: true,
      tokensReceived,
      profitIfWin,
      reason: `Effective price ${(effectivePrice * 100).toFixed(1)}¢ exceeds max ${(maxOdds * 100).toFixed(1)}¢`,
    };
  }

  return {
    acceptable: true,
    effectivePrice,
    bestAsk,
    canFill: true,
    tokensReceived,
    profitIfWin,
  };
}

/**
 * Convert CLOB order book entries (string price/size) to OrderBookLevel.
 */
export function parseOrderBookEntries(
  entries: { price: string; size: string }[],
): OrderBookLevel[] {
  return entries
    .map((e) => ({
      price: Number(e.price),
      size: Number(e.size),
    }))
    .filter((e) => Number.isFinite(e.price) && Number.isFinite(e.size) && e.size > 0);
}