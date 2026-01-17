import "dotenv/config";
import { db } from "../db/client.js";
import { resolvedPositions } from "../db/analyticsSchema.js";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";

const BATCH_SIZE = 50;

interface PricePoint {
  timestamp: number;
  price: number;
}

function findActualResolutionTime(history: PricePoint[]): number | null {
  if (history.length === 0) return null;

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]!;
    if (curr.price < 0.001 || curr.price > 0.999) {
      return curr.timestamp;
    }
  }

  return sorted[sorted.length - 1]!.timestamp;
}

async function backfillMarketEndDate() {
  const walletAddress = "0xabe50375a4064c5d5e0be39063082e8eef144097";

  const positionsToUpdate = await db
    .select({
      id: resolvedPositions.id,
      priceHistory: resolvedPositions.priceHistory,
    })
    .from(resolvedPositions)
    .where(eq(resolvedPositions.walletAddress, walletAddress));

  logger.info("Starting market_end_date backfill from price history", {
    totalPositions: positionsToUpdate.length,
  });

  let updated = 0;
  let noHistory = 0;

  for (let i = 0; i < positionsToUpdate.length; i += BATCH_SIZE) {
    const batch = positionsToUpdate.slice(i, i + BATCH_SIZE);

    for (const pos of batch) {
      const history = pos.priceHistory as PricePoint[] | null;
      if (!history || history.length === 0) {
        noHistory++;
        continue;
      }

      const resolutionTs = findActualResolutionTime(history);
      if (resolutionTs) {
        await db
          .update(resolvedPositions)
          .set({ marketEndDate: new Date(resolutionTs * 1000) })
          .where(eq(resolvedPositions.id, pos.id));
        updated++;
      }
    }

    logger.info("Backfill progress", {
      processed: Math.min(i + BATCH_SIZE, positionsToUpdate.length),
      total: positionsToUpdate.length,
      updated,
      noHistory,
    });
  }

  logger.info("Market end date backfill complete", {
    updated,
    noHistory,
    total: positionsToUpdate.length,
  });
}

backfillMarketEndDate()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error("Backfill failed", { error: (err as Error).message });
    process.exit(1);
  });
