#!/usr/bin/env tsx

import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import {
  epochRequests,
  flatBookCycles,
  flatBookProcessingEvents,
  flatBookQueueParticipants,
  userVaultActivityEvents,
  vaultConfig,
  vaultLifecycleEvents,
  withdrawalRequests,
} from "../src/db/schema.js";

type LifecycleInsert = typeof vaultLifecycleEvents.$inferInsert;
type UserInsert = typeof userVaultActivityEvents.$inferInsert;

function buildVaultEventTitle(eventType: string): { title: string; detail: string } {
  switch (eventType) {
    case "close_book":
      return {
        title: "Book closed",
        detail: "Direct actions paused and the vault moved into queued processing.",
      };
    case "begin_processing":
      return {
        title: "Processing started",
        detail: "Queued requests are now being processed.",
      };
    case "process_redeems_chunk":
      return {
        title: "Withdrawal processing",
        detail: "A redemption processing batch completed.",
      };
    case "process_deposits_chunk":
      return {
        title: "Deposit processing",
        detail: "A deposit processing batch completed.",
      };
    case "finalize_processing":
      return {
        title: "Processing finalized",
        detail: "Queued work has finished for this cycle.",
      };
    case "nav_update":
      return { title: "NAV updated", detail: "Vault NAV was refreshed." };
    case "capital_allocation":
      return { title: "Capital moved", detail: "Capital allocation between wallets changed." };
    default:
      return { title: "Vault event", detail: "A vault lifecycle event occurred." };
  }
}

function dedupe<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseOptionalCycleId(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  const { db } = await import("../src/db/index.js");
  const replace = process.argv.includes("--replace");
  const vaultConfigs = await db.select().from(vaultConfig);
  const vaultIdByAddress = new Map(
    vaultConfigs.map((config) => [config.vaultAddress.toLowerCase(), config.id]),
  );

  const [existingVaultEvents, existingUserEvents] = await Promise.all([
    db.select({ count: vaultLifecycleEvents.id }).from(vaultLifecycleEvents),
    db.select({ count: userVaultActivityEvents.id }).from(userVaultActivityEvents),
  ]);

  if ((existingVaultEvents.length > 0 || existingUserEvents.length > 0) && !replace) {
    console.error(
      "Canonical activity tables already contain rows. Re-run with --replace to clear and rebuild them.",
    );
    process.exit(1);
  }

  if (replace) {
    await db.delete(userVaultActivityEvents);
    await db.delete(vaultLifecycleEvents);
  }

  const [cycles, processingEvents, queueParticipants, withdraws, epochs] = await Promise.all([
    db.select().from(flatBookCycles).orderBy(desc(flatBookCycles.openedAt)),
    db.select().from(flatBookProcessingEvents).orderBy(desc(flatBookProcessingEvents.createdAt)),
    db
      .select()
      .from(flatBookQueueParticipants)
      .orderBy(desc(flatBookQueueParticipants.firstQueuedAt)),
    db.select().from(withdrawalRequests).orderBy(desc(withdrawalRequests.requestedAt)),
    db.select().from(epochRequests).orderBy(desc(epochRequests.createdAt)),
  ]);

  const processingSignatures = new Set(
    processingEvents.map(
      (event) => `${event.vaultAddress.toLowerCase()}:${event.cycleId}:${event.eventType}`,
    ),
  );

  const lifecycleInserts: LifecycleInsert[] = [];
  const userInserts: UserInsert[] = [];

  for (const cycle of cycles) {
    const vaultId = vaultIdByAddress.get(cycle.vaultAddress.toLowerCase());
    if (!vaultId) continue;

    lifecycleInserts.push({
      vaultId,
      vaultAddress: cycle.vaultAddress,
      cycleId: cycle.cycleId,
      eventType: "cycle_opened",
      title: "Cycle opened",
      detail: "A new vault cycle started.",
      status: cycle.state,
      occurredAt: cycle.openedAt,
    });

    const closeKey = `${cycle.vaultAddress.toLowerCase()}:${cycle.cycleId}:close_book`;
    if (cycle.closedAt && !processingSignatures.has(closeKey)) {
      lifecycleInserts.push({
        vaultId,
        vaultAddress: cycle.vaultAddress,
        cycleId: cycle.cycleId,
        eventType: "book_closed",
        title: "Queue activated",
        detail: "Direct actions paused and new requests moved into queue.",
        status: cycle.state,
        occurredAt: cycle.closedAt,
      });
    }

    const processingKey = `${cycle.vaultAddress.toLowerCase()}:${cycle.cycleId}:begin_processing`;
    if (cycle.processingStartedAt && !processingSignatures.has(processingKey)) {
      lifecycleInserts.push({
        vaultId,
        vaultAddress: cycle.vaultAddress,
        cycleId: cycle.cycleId,
        eventType: "processing_started",
        title: "Processing started",
        detail: "Queued deposits and withdrawals started processing.",
        status: cycle.state,
        occurredAt: cycle.processingStartedAt,
      });
    }

    const finalizedKey = `${cycle.vaultAddress.toLowerCase()}:${cycle.cycleId}:finalize_processing`;
    if (cycle.processedAt && !processingSignatures.has(finalizedKey)) {
      lifecycleInserts.push({
        vaultId,
        vaultAddress: cycle.vaultAddress,
        cycleId: cycle.cycleId,
        eventType: "processing_completed",
        title: "Processing completed",
        detail: "The current cycle finished processing queued work.",
        status: cycle.state,
        occurredAt: cycle.processedAt,
      });
    }
  }

  for (const event of processingEvents) {
    const vaultId = vaultIdByAddress.get(event.vaultAddress.toLowerCase());
    if (!vaultId) continue;
    const normalized = buildVaultEventTitle(event.eventType);
    lifecycleInserts.push({
      vaultId,
      vaultAddress: event.vaultAddress,
      cycleId: event.cycleId,
      eventType: event.eventType,
      title: normalized.title,
      detail: normalized.detail,
      txHash: event.txHash ?? null,
      metadata: event.metadata,
      occurredAt: event.createdAt,
    });
  }

  for (const participant of queueParticipants) {
    const vaultId = vaultIdByAddress.get(participant.vaultAddress.toLowerCase());
    if (!vaultId) continue;

    if (participant.queuedDepositAssets !== "0") {
      userInserts.push({
        vaultId,
        vaultAddress: participant.vaultAddress,
        userAddress: participant.userAddress,
        cycleId: participant.cycleId,
        eventType: "deposit_queued",
        title: "Deposit queued",
        detail: "Your deposit entered the queue.",
        status: participant.status,
        assetAmount: participant.queuedDepositAssets,
        occurredAt: participant.firstQueuedAt,
      });
    }

    if (participant.processedDepositShares !== "0" && participant.processedAt) {
      userInserts.push({
        vaultId,
        vaultAddress: participant.vaultAddress,
        userAddress: participant.userAddress,
        cycleId: participant.cycleId,
        eventType: "deposit_minted",
        title: "Deposit minted",
        detail: "Queued deposit was converted into vault shares.",
        status: participant.status,
        shareAmount: participant.processedDepositShares,
        occurredAt: participant.processedAt,
      });
    }
  }

  for (const request of withdraws) {
    const vaultId = vaultIdByAddress.get(request.vaultAddress.toLowerCase());
    if (!vaultId) continue;

    userInserts.push({
      vaultId,
      vaultAddress: request.vaultAddress,
      userAddress: request.userAddress,
      eventType: "withdraw_queued",
      title: "Withdrawal queued",
      detail: "Your withdrawal request entered the queue for processing.",
      requestId: request.requestId,
      status: request.status,
      assetAmount: request.assetsEstimated,
      shareAmount: request.shares,
      txHash: request.txHash,
      occurredAt: request.requestedAt,
    });

    if (request.status === "ready" && request.readyAt) {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        eventType: "withdraw_ready",
        title: "Withdrawal ready",
        detail: "Your withdrawal request is ready to claim.",
        requestId: request.requestId,
        status: request.status,
        assetAmount: request.assetsEstimated,
        shareAmount: request.shares,
        txHash: request.txHash,
        occurredAt: request.readyAt,
      });
    }

    if (request.status === "settled") {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        eventType: "withdraw_settled",
        title: "Withdrawal settled",
        detail: "Your queued withdrawal is ready to claim.",
        requestId: request.requestId,
        status: request.status,
        assetAmount: request.assetsEstimated,
        shareAmount: request.shares,
        txHash: request.txHash,
        occurredAt: request.updatedAt,
      });
    }

    if (request.status === "cancelled") {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        eventType: "withdraw_cancelled",
        title: "Withdrawal cancelled",
        detail: "Your withdrawal request was cancelled.",
        requestId: request.requestId,
        status: request.status,
        assetAmount: request.assetsEstimated,
        shareAmount: request.shares,
        txHash: request.txHash,
        occurredAt: request.updatedAt,
      });
    }

    if (request.status === "completed" || request.status === "claimed") {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        eventType: "claim_completed",
        title: "Claim completed",
        detail: "Claimed assets from your withdrawal request.",
        requestId: request.requestId,
        status: request.status,
        assetAmount: request.assetsEstimated,
        shareAmount: request.shares,
        txHash: request.txHash,
        occurredAt: request.completedAt ?? request.updatedAt,
      });
    }
  }

  for (const request of epochs) {
    const vaultId = vaultIdByAddress.get(request.vaultAddress.toLowerCase());
    if (!vaultId) continue;

    userInserts.push({
      vaultId,
      vaultAddress: request.vaultAddress,
      userAddress: request.userAddress,
      cycleId: parseOptionalCycleId(request.epochId),
      eventType: "withdraw_queued",
      title: "Withdrawal queued",
      detail: "Your withdrawal request entered the queue for processing.",
      requestId: request.requestId,
      status: request.status,
      shareAmount: request.shares,
      occurredAt: request.createdAt,
      metadata: JSON.stringify({ epochId: request.epochId }),
    });

    if (request.frozenAt) {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        cycleId: parseOptionalCycleId(request.epochId),
        eventType: "withdraw_queued",
        title: "Withdrawal queued",
        detail: "Your withdrawal request entered the queue.",
        requestId: request.requestId,
        status: request.status,
        shareAmount: request.shares,
        occurredAt: request.frozenAt,
        metadata: JSON.stringify({ epochId: request.epochId }),
      });
    }

    if (request.claimableAt) {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        cycleId: parseOptionalCycleId(request.epochId),
        eventType: "withdraw_ready",
        title: "Withdrawal ready",
        detail: "Your withdrawal request is ready to claim.",
        requestId: request.requestId,
        status: request.status,
        assetAmount: request.claimableAssets ?? undefined,
        shareAmount: request.shares,
        occurredAt: request.claimableAt,
        metadata: JSON.stringify({ epochId: request.epochId }),
      });
    }

    if (request.cancelledAt) {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        cycleId: parseOptionalCycleId(request.epochId),
        eventType: "withdraw_cancelled",
        title: "Withdrawal cancelled",
        detail: "Your withdrawal request was cancelled.",
        requestId: request.requestId,
        status: request.status,
        shareAmount: request.shares,
        occurredAt: request.cancelledAt,
        metadata: JSON.stringify({ epochId: request.epochId }),
      });
    }

    if (request.claimedAt) {
      userInserts.push({
        vaultId,
        vaultAddress: request.vaultAddress,
        userAddress: request.userAddress,
        cycleId: parseOptionalCycleId(request.epochId),
        eventType: "claim_completed",
        title: "Claim completed",
        detail: "Claimed assets from your withdrawal request.",
        requestId: request.requestId,
        status: request.status,
        assetAmount: request.claimableAssets ?? undefined,
        shareAmount: request.shares,
        occurredAt: request.claimedAt,
        metadata: JSON.stringify({ epochId: request.epochId }),
      });
    }
  }

  const dedupedLifecycle = dedupe(
    lifecycleInserts,
    (item) =>
      `${item.vaultAddress}:${item.eventType}:${item.cycleId ?? "-"}:${item.requestId ?? "-"}:${item.occurredAt.toISOString()}`,
  );
  const dedupedUser = dedupe(
    userInserts,
    (item) =>
      `${item.vaultAddress}:${item.userAddress}:${item.eventType}:${item.requestId ?? "-"}:${item.occurredAt.toISOString()}`,
  );

  if (dedupedLifecycle.length > 0) {
    await db.insert(vaultLifecycleEvents).values(dedupedLifecycle);
  }
  if (dedupedUser.length > 0) {
    await db.insert(userVaultActivityEvents).values(dedupedUser);
  }

  console.log(`Backfilled ${dedupedLifecycle.length} vault lifecycle events.`);
  console.log(`Backfilled ${dedupedUser.length} user activity events.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
