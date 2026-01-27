import { db } from "../db/client.js";
import { syncState } from "../db/schema.js";
import { eq } from "drizzle-orm";

type SyncEventType = "deposit" | "withdrawal" | "claimed";

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function parseRequiredInt(value: string | undefined, name: string): number {
  if (!value) throw new Error(`Missing required ${name}`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
}

function parseEventType(value: string | undefined): SyncEventType {
  if (!value) throw new Error("Missing required eventType");
  if (value === "deposit" || value === "withdrawal" || value === "claimed") return value;
  throw new Error(`Invalid eventType: ${value}`);
}

async function main() {
  const vaultId = parseRequiredInt(getArgValue("--vaultId") ?? process.env.VAULT_ID, "vaultId");
  const eventType = parseEventType(getArgValue("--eventType") ?? process.env.EVENT_TYPE);
  const resetToBlock = parseRequiredInt(
    getArgValue("--resetToBlock") ?? process.env.RESET_TO_BLOCK,
    "resetToBlock",
  );

  const stateId = `${eventType}:vault:${vaultId}`;

  console.log(`Resetting sync state '${stateId}' to block ${resetToBlock}...`);

  await db
    .update(syncState)
    .set({ lastSyncedBlock: resetToBlock, updatedAt: new Date() })
    .where(eq(syncState.id, stateId));

  console.log("Sync state reset.");

  const [state] = await db.select().from(syncState).where(eq(syncState.id, stateId));
  console.log("Current sync state:", state);

  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
