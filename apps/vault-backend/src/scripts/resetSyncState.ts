import { db } from "../db/client.js";
import { syncState } from "../db/schema.js";
import { eq } from "drizzle-orm";

const VAULT_ID = 1;
// Reset to before the withdrawal at block 82119172
const RESET_TO_BLOCK = 82119160;

async function main() {
  console.log(`Resetting sync state for vault ${VAULT_ID} to block ${RESET_TO_BLOCK}...`);
  
  // Reset withdrawal sync state
  const withdrawalStateId = `withdrawal:vault:${VAULT_ID}`;
  await db
    .update(syncState)
    .set({ lastSyncedBlock: RESET_TO_BLOCK, updatedAt: new Date() })
    .where(eq(syncState.id, withdrawalStateId));
  
  console.log("Withdrawal sync state reset.");
  
  // Also reset claimed sync state
  const claimedStateId = `claimed:vault:${VAULT_ID}`;
  await db
    .update(syncState)
    .set({ lastSyncedBlock: RESET_TO_BLOCK, updatedAt: new Date() })
    .where(eq(syncState.id, claimedStateId));
  
  console.log("Claimed sync state reset.");
  
  // Show current state
  const states = await db.select().from(syncState);
  console.log("Current sync states:", states);
  
  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
