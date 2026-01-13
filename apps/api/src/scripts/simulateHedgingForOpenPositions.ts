import { db } from "../db/client.js";
import { botPositions } from "../db/botSchema.js";
import { eq, isNull, and } from "drizzle-orm";

const CLOB_BASE = "https://clob.polymarket.com";
const HEDGE_THRESHOLD_PERCENT = 60;
const MAX_ALLOWED_DROP = 0.5;
const MULTIPLIER = 2;

interface OrderBookResponse {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  last_trade_price?: string;
}

async function fetchOrderBook(tokenId: string): Promise<OrderBookResponse | null> {
  try {
    const response = await fetch(`${CLOB_BASE}/book?token_id=${tokenId}`);
    if (!response.ok) return null;
    return (await response.json()) as OrderBookResponse;
  } catch {
    return null;
  }
}

function getBestBid(bids: Array<{ price: string; size: string }>): number | null {
  if (bids.length === 0) return null;
  const prices = bids.map((b) => parseFloat(b.price)).filter((p) => !isNaN(p));
  return prices.length > 0 ? Math.max(...prices) : null;
}

function getBestAsk(asks: Array<{ price: string; size: string }>): number | null {
  if (asks.length === 0) return null;
  const prices = asks.map((a) => parseFloat(a.price)).filter((p) => !isNaN(p));
  return prices.length > 0 ? Math.min(...prices) : null;
}

async function main() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║     HEDGING SIMULATION FOR CURRENT OPEN POSITIONS                    ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  const openPositions = await db
    .select()
    .from(botPositions)
    .where(
      and(
        eq(botPositions.status, "open"),
        isNull(botPositions.parentPositionId),
        isNull(botPositions.hedgedAt),
      ),
    );

  console.log(`\nFound ${openPositions.length} open positions to evaluate\n`);

  let wouldHedgeCount = 0;
  let skippedCount = 0;
  let notNeededCount = 0;

  for (const pos of openPositions) {
    const entryPrice = parseFloat(pos.entryPrice || "0");
    const cost = parseFloat(pos.cost);
    const tokenId = pos.tokenId;
    const oppositeTokenId = pos.oppositeTokenId;

    console.log("─".repeat(70));
    console.log(`Position #${pos.id}: ${pos.marketQuestion?.slice(0, 50)}...`);
    console.log(
      `   Outcome: ${pos.outcome} @ ${(entryPrice * 100).toFixed(1)}¢ | Cost: $${cost.toFixed(2)}`,
    );

    if (!tokenId) {
      console.log(`   ⚠️  SKIP: No token ID`);
      skippedCount++;
      continue;
    }

    const book = await fetchOrderBook(tokenId);
    if (!book) {
      console.log(`   ⚠️  SKIP: Could not fetch orderbook`);
      skippedCount++;
      continue;
    }

    const bestBid = getBestBid(book.bids);
    const lastTradePrice = book.last_trade_price ? parseFloat(book.last_trade_price) : null;

    console.log(
      `   Best Bid: ${bestBid?.toFixed(4) ?? "null"} | Last Trade: ${lastTradePrice?.toFixed(4) ?? "null"}`,
    );

    if (bestBid === null && lastTradePrice === null) {
      console.log(`   ⚠️  SKIP: No valid price data`);
      skippedCount++;
      continue;
    }

    const minReasonablePrice = entryPrice * (1 - MAX_ALLOWED_DROP);
    let currentPrice: number;
    let priceSource: string;

    if (bestBid !== null && bestBid >= minReasonablePrice) {
      currentPrice = bestBid;
      priceSource = "bestBid";
    } else if (lastTradePrice !== null && lastTradePrice >= minReasonablePrice) {
      currentPrice = lastTradePrice;
      priceSource = "lastTradePrice (bid unrealistic)";
    } else {
      console.log(
        `   ⚠️  SKIP: Both prices unrealistic (min reasonable: ${(minReasonablePrice * 100).toFixed(1)}¢)`,
      );
      skippedCount++;
      continue;
    }

    const dropPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
    const isGain = dropPercent < 0;

    console.log(`   Current: ${(currentPrice * 100).toFixed(1)}¢ (${priceSource})`);
    console.log(
      `   Change: ${isGain ? "+" : ""}${(-dropPercent).toFixed(1)}% ${isGain ? "📈 GAIN" : "📉 LOSS"}`,
    );

    if (dropPercent < HEDGE_THRESHOLD_PERCENT) {
      console.log(
        `   ✅ NO HEDGE NEEDED: Drop ${dropPercent.toFixed(1)}% < threshold ${HEDGE_THRESHOLD_PERCENT}%`,
      );
      notNeededCount++;
      continue;
    }

    console.log(
      `   🚨 WOULD TRIGGER HEDGE: Drop ${dropPercent.toFixed(1)}% >= threshold ${HEDGE_THRESHOLD_PERCENT}%`,
    );

    if (!oppositeTokenId) {
      console.log(`   ⚠️  But no opposite token ID - hedge would be skipped`);
      skippedCount++;
      continue;
    }

    const oppositeBook = await fetchOrderBook(oppositeTokenId);
    if (!oppositeBook) {
      console.log(`   ⚠️  Could not fetch opposite orderbook`);
      skippedCount++;
      continue;
    }

    const oppositeAsk = getBestAsk(oppositeBook.asks);
    if (oppositeAsk === null) {
      console.log(`   ⚠️  No asks on opposite token - hedge would be skipped`);
      skippedCount++;
      continue;
    }

    const originalShares = cost / entryPrice;
    const hedgeShares = originalShares * MULTIPLIER;
    const hedgeCost = hedgeShares * oppositeAsk;

    console.log(`   Opposite Ask: ${(oppositeAsk * 100).toFixed(1)}¢`);
    console.log(`   Would buy: ${hedgeShares.toFixed(2)} shares for $${hedgeCost.toFixed(2)}`);

    wouldHedgeCount++;
  }

  console.log("\n" + "═".repeat(70));
  console.log("SUMMARY");
  console.log("═".repeat(70));
  console.log(`\n   Total open positions: ${openPositions.length}`);
  console.log(`   ✅ No hedge needed: ${notNeededCount}`);
  console.log(`   ⚠️  Skipped (no data): ${skippedCount}`);
  console.log(`   🚨 Would trigger hedge: ${wouldHedgeCount}`);

  if (wouldHedgeCount === 0) {
    console.log("\n🎉 NO POSITIONS WOULD BE HEDGED - ALL GOOD!");
  } else {
    console.log(`\n⚠️  ${wouldHedgeCount} position(s) would trigger hedging!`);
  }

  console.log("\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
