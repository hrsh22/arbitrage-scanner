import "dotenv/config";
import { db } from "../db/client.js";
import { resolvedPositions } from "../db/analyticsSchema.js";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";

const CLOB_API_BASE = "https://clob.polymarket.com";
const FIDELITY_MINUTES = 5;
const BATCH_SIZE = 10;
const RATE_LIMIT_DELAY_MS = 100;

interface PricePoint {
  t: number;
  p: number;
}

async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  endTs: number,
  fidelityMinutes: number,
): Promise<{ timestamp: number; price: number }[]> {
  const url = `${CLOB_API_BASE}/prices-history?market=${tokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=${fidelityMinutes}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = (await response.json()) as { history?: PricePoint[] };
  return (data.history || []).map((p) => ({ timestamp: p.t, price: p.p }));
}

async function backfillPriceHistory() {
  const walletAddress = "0xabe50375a4064c5d5e0be39063082e8eef144097";

  const positions = await db
    .select({
      id: resolvedPositions.id,
      tokenId: resolvedPositions.tokenId,
      createdAt: resolvedPositions.createdAt,
      resolvedAt: resolvedPositions.resolvedAt,
    })
    .from(resolvedPositions)
    .where(eq(resolvedPositions.walletAddress, walletAddress));

  logger.info("Starting price history backfill", {
    totalPositions: positions.length,
  });

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < positions.length; i += BATCH_SIZE) {
    const batch = positions.slice(i, i + BATCH_SIZE);

    for (const pos of batch) {
      try {
        if (!pos.resolvedAt || !pos.createdAt) {
          failed++;
          continue;
        }

        const resolvedTs = Math.floor(pos.resolvedAt.getTime() / 1000);
        const entryTs = Math.floor(pos.createdAt.getTime() / 1000);
        const twentyFourHoursBeforeResolution = resolvedTs - 24 * 60 * 60;
        const historyStartTs = Math.min(entryTs, twentyFourHoursBeforeResolution);

        const priceHistory = await fetchPriceHistory(
          pos.tokenId,
          historyStartTs,
          resolvedTs,
          FIDELITY_MINUTES,
        );

        if (priceHistory.length === 0) {
          failed++;
          continue;
        }

        await db
          .update(resolvedPositions)
          .set({ priceHistory })
          .where(eq(resolvedPositions.id, pos.id));

        updated++;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      } catch (err) {
        logger.warn("Failed to backfill position", {
          id: pos.id,
          error: (err as Error).message,
        });
        failed++;
      }
    }

    logger.info("Backfill progress", {
      processed: Math.min(i + BATCH_SIZE, positions.length),
      total: positions.length,
      updated,
      failed,
    });
  }

  logger.info("Price history backfill complete", {
    updated,
    failed,
    total: positions.length,
  });
}

backfillPriceHistory()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error("Backfill failed", { error: (err as Error).message });
    process.exit(1);
  });
