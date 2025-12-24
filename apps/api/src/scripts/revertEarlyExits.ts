/**
 * Script to revert positions that were incorrectly marked as sold.
 * Run with: npx tsx src/scripts/revertEarlyExits.ts
 */

import { db } from "../db/client.js";
import { botPositions } from "../db/botSchema.js";
import { inArray } from "drizzle-orm";

const AFFECTED_POSITION_IDS = [
  86, 87, 89, 95, 96, 97, 99, 100, 102, 103, 104, 105, 108, 110, 113, 114, 116, 117, 118, 119, 120,
  121, 122, 123, 125, 126, 127, 128,
];

async function revertPositions() {
  console.log(`Reverting ${AFFECTED_POSITION_IDS.length} positions to 'open' status...`);

  // First, show current state
  const positions = await db
    .select({
      id: botPositions.id,
      status: botPositions.status,
      profitLoss: botPositions.profitLoss,
      outcome: botPositions.outcome,
    })
    .from(botPositions)
    .where(inArray(botPositions.id, AFFECTED_POSITION_IDS));

  console.log("Current state:");
  for (const p of positions) {
    console.log(`  ID ${p.id}: status=${p.status}, profitLoss=${p.profitLoss}`);
  }

  // Revert to open
  await db
    .update(botPositions)
    .set({
      status: "open",
      profitLoss: null,
      resolvedAt: null,
    })
    .where(inArray(botPositions.id, AFFECTED_POSITION_IDS));

  console.log(`\nReverted ${AFFECTED_POSITION_IDS.length} positions back to 'open'`);

  // Verify
  const after = await db
    .select({
      id: botPositions.id,
      status: botPositions.status,
    })
    .from(botPositions)
    .where(inArray(botPositions.id, AFFECTED_POSITION_IDS));

  console.log("\nAfter revert:");
  const openCount = after.filter((p) => p.status === "open").length;
  console.log(`  ${openCount} positions now 'open'`);

  process.exit(0);
}

revertPositions().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
