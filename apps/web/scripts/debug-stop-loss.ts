import { fetchPositions, fetchActivity, fetchPriceHistory } from "../lib/polymarket-api";

const WALLET = "0xabe50375A4064C5d5E0BE39063082e8eeF144097";
const TARGET_THRESHOLD = 50;

interface PricePoint {
  timestamp: number;
  price: number;
}

interface ReconstructedPosition {
  tokenId: string;
  conditionId: string;
  title: string;
  outcome: string;
  entryPrice: number;
  cost: number;
  size: number;
  profitLoss: number;
  status: "open" | "won" | "lost";
  createdAt: Date;
  resolvedAt: Date | null;
}

function findFirstBuyTimestamp(
  activity: Awaited<ReturnType<typeof fetchActivity>>,
  tokenId: string,
): Date {
  const buys = activity
    .filter((a) => a.asset === tokenId && a.type === "TRADE" && a.side === "BUY")
    .sort((a, b) => a.timestamp - b.timestamp);
  return buys.length > 0 ? new Date(buys[0]!.timestamp * 1000) : new Date();
}

function reconstructClosedPositions(
  activity: Awaited<ReturnType<typeof fetchActivity>>,
  existingTokenIds: Set<string>,
): ReconstructedPosition[] {
  const closedPositions: ReconstructedPosition[] = [];

  const conditionGroups = new Map<string, typeof activity>();
  for (const act of activity) {
    if (act.type !== "TRADE" && act.type !== "REDEEM") continue;
    const key = act.conditionId;
    if (!conditionGroups.has(key)) {
      conditionGroups.set(key, []);
    }
    conditionGroups.get(key)!.push(act);
  }

  for (const [conditionId, activities] of conditionGroups) {
    const buys = activities.filter((a) => a.type === "TRADE" && a.side === "BUY");
    const sells = activities.filter((a) => a.type === "TRADE" && a.side === "SELL");
    const redeems = activities.filter((a) => a.type === "REDEEM");

    if (buys.length === 0) continue;

    const firstBuy = buys.sort((a, b) => a.timestamp - b.timestamp)[0]!;
    const tokenId = firstBuy.asset;

    if (existingTokenIds.has(tokenId)) continue;

    const totalBought = buys.reduce((sum, b) => sum + b.usdcSize, 0);
    const totalSold = sells.reduce((sum, s) => sum + s.usdcSize, 0);
    const totalRedeemed = redeems.reduce((sum, r) => sum + r.usdcSize, 0);

    const avgEntryPrice =
      buys.reduce((sum, b) => sum + b.price * b.size, 0) / buys.reduce((sum, b) => sum + b.size, 0);

    const lastActivity = activities.sort((a, b) => b.timestamp - a.timestamp)[0]!;

    let status: "open" | "won" | "lost" = "open";
    let profitLoss = 0;

    if (redeems.length > 0) {
      profitLoss = totalRedeemed - totalBought;
      status = profitLoss >= 0 ? "won" : "lost";
    } else if (sells.length > 0 && totalSold >= totalBought * 0.9) {
      profitLoss = totalSold - totalBought;
      status = profitLoss >= 0 ? "won" : "lost";
    } else {
      continue;
    }

    closedPositions.push({
      tokenId,
      conditionId,
      title: firstBuy.title,
      outcome: firstBuy.outcome,
      entryPrice: avgEntryPrice,
      cost: totalBought,
      size: buys.reduce((sum, b) => sum + b.size, 0),
      profitLoss,
      status,
      createdAt: new Date(firstBuy.timestamp * 1000),
      resolvedAt: new Date(lastActivity.timestamp * 1000),
    });
  }

  return closedPositions;
}

function simulateStopLossForPosition(
  history: PricePoint[],
  entryPrice: number,
  entryTimestamp: number,
  actualPnL: number,
  cost: number,
  threshold: number,
): {
  triggered: boolean;
  triggerPrice: number | null;
  stopPrice: number;
  profitLossIfSold: number | null;
  profitLossIfHeld: number;
  recovered: boolean;
} {
  const stopPrice = entryPrice * (1 - threshold / 100);
  const relevantHistory = history.filter((p) => p.timestamp >= entryTimestamp);

  let triggerIndex = -1;
  for (let i = 0; i < relevantHistory.length; i++) {
    if (relevantHistory[i]!.price <= stopPrice) {
      triggerIndex = i;
      break;
    }
  }

  if (triggerIndex === -1) {
    return {
      triggered: false,
      triggerPrice: null,
      stopPrice,
      profitLossIfSold: null,
      profitLossIfHeld: actualPnL,
      recovered: false,
    };
  }

  const triggerPoint = relevantHistory[triggerIndex]!;
  const shares = cost / entryPrice;
  const valueIfSold = shares * triggerPoint.price;
  const profitLossIfSold = valueIfSold - cost;
  const recovered = actualPnL > profitLossIfSold;

  return {
    triggered: true,
    triggerPrice: triggerPoint.price,
    stopPrice,
    profitLossIfSold,
    profitLossIfHeld: actualPnL,
    recovered,
  };
}

async function main() {
  console.log("=== STOP-LOSS DEBUG SCRIPT ===\n");
  console.log(`Wallet: ${WALLET}`);
  console.log(`Target Threshold: ${TARGET_THRESHOLD}%\n`);

  console.log("Fetching positions and activity...");
  const [positions, activity] = await Promise.all([
    fetchPositions(WALLET),
    fetchActivity(WALLET, 5000),
  ]);

  console.log(`Found ${positions.length} current positions`);
  console.log(`Found ${activity.length} activity records\n`);

  const allPositions: ReconstructedPosition[] = [];

  for (const pos of positions) {
    let status: "open" | "won" | "lost" = "open";
    if (pos.redeemable) {
      status = pos.curPrice >= 0.99 ? "won" : "lost";
    }
    allPositions.push({
      tokenId: pos.asset,
      conditionId: pos.conditionId,
      title: pos.title,
      outcome: pos.outcome,
      entryPrice: pos.avgPrice,
      cost: pos.initialValue,
      size: pos.size,
      profitLoss: pos.cashPnl,
      status,
      createdAt: findFirstBuyTimestamp(activity, pos.asset),
      resolvedAt: pos.redeemable ? new Date() : null,
    });
  }

  const existingTokenIds = new Set(positions.map((p) => p.asset));
  const closedPositions = reconstructClosedPositions(activity, existingTokenIds);
  allPositions.push(...closedPositions);

  console.log(`Total positions to analyze: ${allPositions.length}\n`);

  const triggeredPositions: {
    position: ReconstructedPosition;
    result: ReturnType<typeof simulateStopLossForPosition>;
    priceHistoryLength: number;
    lowestPrice: number | null;
  }[] = [];

  let totalNetImpact = 0;
  let totalTriggered = 0;
  let totalRecovered = 0;

  for (const pos of allPositions) {
    const entryTs = Math.floor(pos.createdAt.getTime() / 1000);
    let endTs = pos.resolvedAt
      ? Math.floor(pos.resolvedAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const MAX_RANGE_SECONDS = 7 * 24 * 60 * 60;
    const adjustedStartTs = Math.max(entryTs, endTs - MAX_RANGE_SECONDS);

    const priceHistory = await fetchPriceHistory(pos.tokenId, adjustedStartTs, endTs, 5);

    const result = simulateStopLossForPosition(
      priceHistory,
      pos.entryPrice,
      entryTs,
      pos.profitLoss,
      pos.cost,
      TARGET_THRESHOLD,
    );

    if (result.triggered) {
      totalTriggered++;
      if (result.recovered) totalRecovered++;
      if (result.profitLossIfSold !== null) {
        totalNetImpact += result.profitLossIfSold - result.profitLossIfHeld;
      }

      const lowestPrice =
        priceHistory.length > 0 ? Math.min(...priceHistory.map((p) => p.price)) : null;

      triggeredPositions.push({
        position: pos,
        result,
        priceHistoryLength: priceHistory.length,
        lowestPrice,
      });
    }
  }

  console.log("=== SUMMARY ===");
  console.log(`Triggered: ${totalTriggered}`);
  console.log(`Recovered: ${totalRecovered}`);
  console.log(`Net Impact: $${totalNetImpact.toFixed(2)}\n`);

  console.log("=== TRIGGERED POSITIONS DETAIL ===\n");

  for (const { position, result, priceHistoryLength, lowestPrice } of triggeredPositions) {
    console.log(`Title: ${position.title.slice(0, 60)}...`);
    console.log(`  Outcome: ${position.outcome}`);
    console.log(`  Status: ${position.status}`);
    console.log(`  Entry Price: ${(position.entryPrice * 100).toFixed(2)}¢`);
    console.log(`  Cost: $${position.cost.toFixed(2)}`);
    console.log(`  Stop Price (${TARGET_THRESHOLD}%): ${(result.stopPrice * 100).toFixed(2)}¢`);
    console.log(
      `  Trigger Price: ${result.triggerPrice ? (result.triggerPrice * 100).toFixed(2) + "¢" : "N/A"}`,
    );
    console.log(
      `  Lowest Price in History: ${lowestPrice ? (lowestPrice * 100).toFixed(2) + "¢" : "N/A"}`,
    );
    console.log(`  Price History Points: ${priceHistoryLength}`);
    console.log(`  P/L if Sold: $${result.profitLossIfSold?.toFixed(2) ?? "N/A"}`);
    console.log(`  P/L if Held (Actual): $${result.profitLossIfHeld.toFixed(2)}`);
    console.log(
      `  Contribution to Net: $${((result.profitLossIfSold ?? 0) - result.profitLossIfHeld).toFixed(2)}`,
    );
    console.log(`  Recovered: ${result.recovered ? "YES" : "NO"}`);
    console.log("");
  }

  console.log("=== ENTRY PRICE DISTRIBUTION ===");
  const entryPriceBuckets = {
    "< 50¢": 0,
    "50-70¢": 0,
    "70-90¢": 0,
    "90-95¢": 0,
    "95-99¢": 0,
    "> 99¢": 0,
  };

  for (const { position } of triggeredPositions) {
    const p = position.entryPrice;
    if (p < 0.5) entryPriceBuckets["< 50¢"]++;
    else if (p < 0.7) entryPriceBuckets["50-70¢"]++;
    else if (p < 0.9) entryPriceBuckets["70-90¢"]++;
    else if (p < 0.95) entryPriceBuckets["90-95¢"]++;
    else if (p < 0.99) entryPriceBuckets["95-99¢"]++;
    else entryPriceBuckets["> 99¢"]++;
  }

  console.log(entryPriceBuckets);
}

main().catch(console.error);
