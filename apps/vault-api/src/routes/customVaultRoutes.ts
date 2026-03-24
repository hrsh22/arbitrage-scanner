/**
 * Custom Vault Routes (ERC7540-style Weekly Epoch with Boundary Settlement)
 *
 * API endpoints for redemption request, status, settlement, and claim operations
 * for the custom vault with weekly epochs.
 *
 * SUPPORTED ECONOMIC MODEL: Boundary Settlement Only
 * - Redemption requests are processed at epoch settlement boundary
 * - Full entitlement realization at settlement (no gradual realization)
 * - Cancellation is disabled - requests are irreversible once submitted
 * - Cross-epoch open positions are unsupported
 *
 * New Lifecycle Fields:
 * - queued: Assets waiting in deposit queue
 * - frozen: Assets frozen in pending epochs
 * - accrued: Total realized USDC accrued for user (settlement boundary only)
 * - claimed: Total USDC already claimed by user
 * - claimableNow: USDC available to claim right now
 * - minClaimThreshold: Minimum claim amount required
 *
 * Routes:
 * - POST /api/vaults/:vaultId/redeem - Create redemption request (irreversible)
 * - GET /api/vaults/:vaultId/requests/:requestId - Get request status
 * - GET /api/vaults/:vaultId/deposit-queue - Get deposit queue status (NEW)
 * - GET /api/vaults/:vaultId/tranche-status - Get tranche progress (NEW)
 * - GET /api/vaults/:vaultId/carry-eligibility - Get carry claim eligibility (NEW)
 * - POST /api/vaults/:vaultId/requests/:requestId/claim - Claim settled request
 * - GET /api/vaults/:vaultId/epochs/current - Current epoch status
 * - GET /api/vaults/:vaultId/epochs/:epochId - Specific epoch details
 * - GET /api/vaults/:vaultId/redemptions - User's redemption state
 * - GET /api/vaults/:vaultId/info - Vault metadata and capabilities
 *
 * UNSUPPORTED OPERATIONS (not implemented):
 * - Cancellation of pending requests (disabled at contract level)
 * - Gradual/partial realization between settlement boundaries
 * - Cross-epoch position accounting without settlement
 */

import { Router } from "express";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "../logger.js";
import { requireAuth } from "../middleware/auth.js";
import {
  epochRequests,
  flatBookCycles,
  flatBookProcessingEvents,
  flatBookQueueParticipants,
  userVaultActivityEvents,
  vaultLifecycleEvents,
  withdrawalRequests,
} from "../db/schema.js";
import { getVaultProviderFactory } from "../services/vaultProviderFactory.js";
import type {
  IVaultProvider,
  RedemptionRequest as ProviderRedemptionRequest,
} from "../services/vaultProvider.js";
import { VaultProviderError } from "../services/vaultProvider.js";
import { CustomVaultProvider } from "../services/customVaultProvider.js";
import { entitlementRepository } from "../repositories/entitlementRepository.js";
import { payoutRepository } from "../repositories/payoutRepository.js";
import { withdrawalRepository } from "../repositories/withdrawalRepository.js";
import {
  ClaimState,
  mapRequestStatusToClaimState,
  ClaimOperation,
  validateClaimOperation,
} from "../services/claimStateMachine.js";
import { activityEventRepository } from "../repositories/activityEventRepository.js";
import { flatBookStateRepository } from "../repositories/flatBookStateRepository.js";
import type { BatchStatus } from "../services/vaultProvider.js";

const LIFECYCLE_CACHE_TTL_MS = 5_000;
const lifecycleCache = new WeakMap<
  CustomVaultProvider,
  { expiresAt: number; value: Record<string, unknown> }
>();

interface ActivityFeedItem {
  id: string;
  type: string;
  scope: "vault" | "user";
  title: string;
  detail: string;
  occurredAt: string;
  status?: string;
  cycleId?: number;
  requestId?: string;
  txHash?: string | null;
  amounts?: {
    assets?: string;
    shares?: string;
  };
  metadata?: Record<string, unknown>;
}

function buildVaultEventTitle(eventType: string): { title: string; detail: string } {
  switch (eventType) {
    case "close_book":
      return {
        title: "Book closed",
        detail: "The vault stopped accepting direct actions and moved into a queued state.",
      };
    case "begin_processing":
      return { title: "Processing started", detail: "Queued requests are now being processed." };
    case "process_redeems_chunk":
      return { title: "Withdrawal processing", detail: "A redemption processing batch completed." };
    case "process_deposits_chunk":
      return { title: "Deposit processing", detail: "A deposit processing batch completed." };
    case "finalize_processing":
      return { title: "Processing finalized", detail: "Queued work has finished for this cycle." };
    case "nav_update":
      return { title: "NAV updated", detail: "Vault NAV was refreshed." };
    case "capital_allocation":
      return { title: "Capital moved", detail: "Capital allocation between wallets changed." };
    default:
      return { title: "Vault event", detail: "A vault lifecycle event occurred." };
  }
}

function buildCycleStateItem(
  cycle: typeof flatBookCycles.$inferSelect,
  processingSignatures: Set<string>,
): ActivityFeedItem[] {
  const items: ActivityFeedItem[] = [
    {
      id: `cycle-open-${cycle.cycleId}`,
      type: "cycle_opened",
      scope: "vault",
      title: "Cycle opened",
      detail: "A new vault cycle started.",
      occurredAt: cycle.openedAt.toISOString(),
      cycleId: cycle.cycleId,
      status: cycle.state,
    },
  ];

  if (cycle.closedAt && !processingSignatures.has(`${cycle.cycleId}:close_book`)) {
    items.push({
      id: `cycle-closed-${cycle.cycleId}`,
      type: "book_closed",
      scope: "vault",
      title: "Queue activated",
      detail: "Direct actions paused and new requests moved into queue.",
      occurredAt: cycle.closedAt.toISOString(),
      cycleId: cycle.cycleId,
      status: cycle.state,
    });
  }

  if (cycle.processingStartedAt && !processingSignatures.has(`${cycle.cycleId}:begin_processing`)) {
    items.push({
      id: `cycle-processing-${cycle.cycleId}`,
      type: "processing_started",
      scope: "vault",
      title: "Processing started",
      detail: "Queued deposits and withdrawals started processing.",
      occurredAt: cycle.processingStartedAt.toISOString(),
      cycleId: cycle.cycleId,
      status: cycle.state,
    });
  }

  if (cycle.processedAt && !processingSignatures.has(`${cycle.cycleId}:finalize_processing`)) {
    items.push({
      id: `cycle-processed-${cycle.cycleId}`,
      type: "processing_completed",
      scope: "vault",
      title: "Processing completed",
      detail: "The current cycle finished processing queued work.",
      occurredAt: cycle.processedAt.toISOString(),
      cycleId: cycle.cycleId,
      status: cycle.state,
    });
  }

  return items;
}

function buildUserQueueActivity(
  participant: typeof flatBookQueueParticipants.$inferSelect,
): ActivityFeedItem[] {
  const items: ActivityFeedItem[] = [];

  if (participant.queuedDepositAssets !== "0") {
    items.push({
      id: `deposit-queued-${participant.id}`,
      type: "deposit_queued",
      scope: "user",
      title: "Deposit queued",
      detail: "Your deposit entered the queue.",
      occurredAt: participant.firstQueuedAt.toISOString(),
      cycleId: participant.cycleId,
      status: participant.status,
      amounts: { assets: participant.queuedDepositAssets },
    });
  }

  if (participant.processedDepositShares !== "0" && participant.processedAt) {
    items.push({
      id: `deposit-minted-${participant.id}`,
      type: "deposit_minted",
      scope: "user",
      title: "Deposit minted",
      detail: "Queued deposit finished processing and your shares were minted automatically.",
      occurredAt: participant.processedAt.toISOString(),
      cycleId: participant.cycleId,
      status: participant.status,
      amounts: { shares: participant.processedDepositShares },
    });
  }

  return items;
}

function buildWithdrawalHistoryItem(
  request: typeof withdrawalRequests.$inferSelect,
): ActivityFeedItem {
  const map: Record<string, { type: string; title: string; detail: string; occurredAt: Date }> = {
    pending: {
      type: "withdraw_requested",
      title: "Withdrawal requested",
      detail: "Your withdrawal request was submitted.",
      occurredAt: request.requestedAt,
    },
    ready: {
      type: "withdraw_ready",
      title: "Withdrawal ready",
      detail: "Your withdrawal is ready to claim.",
      occurredAt: request.readyAt ?? request.requestedAt,
    },
    completed: {
      type: "claim_completed",
      title: "Withdrawal completed",
      detail: "Your withdrawal finished successfully.",
      occurredAt: request.completedAt ?? request.updatedAt,
    },
    cancelled: {
      type: "withdraw_cancelled",
      title: "Withdrawal cancelled",
      detail: "Your withdrawal request was cancelled.",
      occurredAt: request.updatedAt,
    },
    expired: {
      type: "withdraw_cancelled",
      title: "Withdrawal expired",
      detail: "Your withdrawal request expired.",
      occurredAt: request.updatedAt,
    },
    open: {
      type: "withdraw_requested",
      title: "Withdrawal requested",
      detail: "Your withdrawal request is open.",
      occurredAt: request.requestedAt,
    },
    cutoff: {
      type: "withdraw_queued",
      title: "Withdrawal queued",
      detail: "Your withdrawal request is queued for processing.",
      occurredAt: request.updatedAt,
    },
    flattening: {
      type: "withdraw_processing",
      title: "Withdrawal processing",
      detail: "Your withdrawal request is being processed.",
      occurredAt: request.updatedAt,
    },
    settling: {
      type: "withdraw_processing",
      title: "Withdrawal settling",
      detail: "Your withdrawal request is settling.",
      occurredAt: request.updatedAt,
    },
    settled: {
      type: "withdraw_settled",
      title: "Withdrawal ready",
      detail: "Your withdrawal request is ready to claim.",
      occurredAt: request.readyAt ?? request.updatedAt,
    },
    claimed: {
      type: "claim_completed",
      title: "Claim completed",
      detail: "Claimed assets from your settled withdrawal.",
      occurredAt: request.completedAt ?? request.updatedAt,
    },
    closed: {
      type: "withdraw_settled",
      title: "Withdrawal closed",
      detail: "Your withdrawal request has been closed.",
      occurredAt: request.updatedAt,
    },
  };
  const normalized = map[request.status] ?? map.pending!;
  return {
    id: `withdrawal-${request.requestId}-${request.status}`,
    type: normalized.type,
    scope: "user",
    title: normalized.title,
    detail: normalized.detail,
    occurredAt: normalized.occurredAt.toISOString(),
    requestId: request.requestId,
    txHash: request.txHash,
    status: request.status,
    amounts: {
      assets: request.assetsEstimated,
      shares: request.shares,
    },
  };
}

function buildEpochRequestHistoryItem(
  request: typeof epochRequests.$inferSelect,
): ActivityFeedItem {
  const statusMap: Record<
    string,
    { type: string; title: string; detail: string; occurredAt: Date }
  > = {
    pending: {
      type: "withdraw_requested",
      title: "Withdrawal requested",
      detail: "Your withdrawal request was submitted.",
      occurredAt: request.createdAt,
    },
    frozen: {
      type: "withdraw_queued",
      title: "Withdrawal queued",
      detail: "Your withdrawal request is queued in the current lifecycle.",
      occurredAt: request.frozenAt ?? request.updatedAt,
    },
    claimable: {
      type: "withdraw_ready",
      title: "Withdrawal ready",
      detail: "Your withdrawal request is ready to claim.",
      occurredAt: request.claimableAt ?? request.updatedAt,
    },
    claimed: {
      type: "claim_completed",
      title: "Claim completed",
      detail: "Claimed assets from your withdrawal request.",
      occurredAt: request.claimedAt ?? request.updatedAt,
    },
    closed: {
      type: "withdraw_settled",
      title: "Withdrawal closed",
      detail: "Your withdrawal request has been closed.",
      occurredAt: request.closedAt ?? request.updatedAt,
    },
    cancelled: {
      type: "withdraw_cancelled",
      title: "Withdrawal cancelled",
      detail: "Your withdrawal request was cancelled.",
      occurredAt: request.cancelledAt ?? request.updatedAt,
    },
  };
  const normalized = statusMap[request.status] ?? statusMap.pending!;
  return {
    id: `epoch-request-${request.requestId}-${request.status}`,
    type: normalized.type,
    scope: "user",
    title: normalized.title,
    detail: normalized.detail,
    occurredAt: normalized.occurredAt.toISOString(),
    requestId: request.requestId,
    status: request.status,
    amounts: {
      shares: request.shares,
      assets: request.claimableAssets ?? undefined,
    },
    metadata: {
      epochId: request.epochId,
    },
  };
}

function buildProviderRedemptionHistoryItem(request: ProviderRedemptionRequest): ActivityFeedItem {
  const normalized: Record<
    ProviderRedemptionRequest["status"],
    { type: string; title: string; detail: string; occurredAt: Date }
  > = {
    pending: {
      type: "withdraw_requested",
      title: "Withdrawal requested",
      detail: "Your withdrawal request was submitted.",
      occurredAt: request.createdAt,
    },
    frozen: {
      type: "withdraw_queued",
      title: "Withdrawal queued",
      detail: "Your withdrawal request is queued for settlement.",
      occurredAt: request.createdAt,
    },
    claimable: {
      type: "withdraw_ready",
      title: "Withdrawal ready",
      detail: "Your withdrawal request is ready to claim.",
      occurredAt: request.settledAt ?? request.createdAt,
    },
    claimed: {
      type: "claim_completed",
      title: "Claim completed",
      detail: "Claimed assets from your withdrawal request.",
      occurredAt: request.claimedAt ?? request.settledAt ?? request.createdAt,
    },
    cancelled: {
      type: "withdraw_cancelled",
      title: "Withdrawal cancelled",
      detail: "Your withdrawal request was cancelled.",
      occurredAt: request.cancelledAt ?? request.createdAt,
    },
  };

  const entry = normalized[request.status];

  return {
    id: `provider-request-${request.requestId}-${request.status}`,
    type: entry.type,
    scope: "user",
    title: entry.title,
    detail: entry.detail,
    occurredAt: entry.occurredAt.toISOString(),
    requestId: request.requestId,
    cycleId: request.batchId,
    status: request.status,
    amounts: {
      shares: request.shares.toString(),
      assets: (request.assetsActual ?? request.assetsEstimated).toString(),
    },
  };
}

function parseMetadata(metadata: string | null): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return { raw: metadata };
  }
}

function mapCanonicalVaultEvent(event: typeof vaultLifecycleEvents.$inferSelect): ActivityFeedItem {
  const normalizedType =
    event.eventType === "settlement_completed" ? "processing_completed" : event.eventType;

  return {
    id: `canonical-vault-${event.id}`,
    type: normalizedType,
    scope: "vault",
    title: event.title,
    detail: event.detail,
    occurredAt: event.occurredAt.toISOString(),
    status: event.status ?? undefined,
    cycleId: event.cycleId ?? undefined,
    requestId: event.requestId ?? undefined,
    txHash: event.txHash,
    amounts: {
      assets: event.assetAmount ?? undefined,
      shares: event.shareAmount ?? undefined,
    },
    metadata: parseMetadata(event.metadata),
  };
}

function mapCanonicalUserEvent(
  event: typeof userVaultActivityEvents.$inferSelect,
): ActivityFeedItem {
  return {
    id: `canonical-user-${event.id}`,
    type: event.eventType,
    scope: "user",
    title: event.title,
    detail: event.detail,
    occurredAt: event.occurredAt.toISOString(),
    status: event.status ?? undefined,
    cycleId: event.cycleId ?? undefined,
    requestId: event.requestId ?? undefined,
    txHash: event.txHash,
    amounts: {
      assets: event.assetAmount ?? undefined,
      shares: event.shareAmount ?? undefined,
    },
    metadata: parseMetadata(event.metadata),
  };
}

export function seedLifecycleEventsFromBatchStatus(args: {
  batchStatus: BatchStatus;
  vaultId: number;
  vaultAddress: string;
}): Array<{
  vaultId: number;
  vaultAddress: string;
  cycleId: number;
  eventType: string;
  title: string;
  detail: string;
  occurredAt: Date;
  status: string;
}> {
  const { batchStatus, vaultId, vaultAddress } = args;
  const rows: Array<{
    vaultId: number;
    vaultAddress: string;
    cycleId: number;
    eventType: string;
    title: string;
    detail: string;
    occurredAt: Date;
    status: string;
  }> = [
    {
      vaultId,
      vaultAddress,
      cycleId: batchStatus.batchId,
      eventType: "cycle_opened",
      title: "Cycle opened",
      detail: "A new vault cycle started.",
      occurredAt: batchStatus.startTime,
      status: batchStatus.status,
    },
  ];

  if (batchStatus.status !== "open") {
    rows.push({
      vaultId,
      vaultAddress,
      cycleId: batchStatus.batchId,
      eventType: "book_closed",
      title: "Book closed",
      detail: "Direct actions paused and the vault moved into queued processing.",
      occurredAt: batchStatus.cutoffTime ?? batchStatus.endTime,
      status: batchStatus.status,
    });
  }

  if (
    ["processing", "flattening", "settling", "settled", "processed", "reopen"].includes(
      batchStatus.status,
    )
  ) {
    rows.push({
      vaultId,
      vaultAddress,
      cycleId: batchStatus.batchId,
      eventType: "processing_started",
      title: "Processing started",
      detail: "The current cycle moved into processing.",
      occurredAt: batchStatus.cutoffTime ?? batchStatus.endTime,
      status: batchStatus.status,
    });
  }

  if (["settled", "processed", "reopen"].includes(batchStatus.status)) {
    rows.push({
      vaultId,
      vaultAddress,
      cycleId: batchStatus.batchId,
      eventType: "processing_completed",
      title: "Processing completed",
      detail: "The current cycle finished processing queued work.",
      occurredAt: batchStatus.endTime,
      status: batchStatus.status,
    });

    rows.push({
      vaultId,
      vaultAddress,
      cycleId: batchStatus.batchId,
      eventType: "claim_window_opened",
      title: "Claim window opened",
      detail: "Processed withdrawals are now claimable.",
      occurredAt: batchStatus.endTime,
      status: batchStatus.status,
    });
  }

  if (batchStatus.totalQueuedDeposits > 0n) {
    rows.push({
      vaultId,
      vaultAddress,
      cycleId: batchStatus.nextBatchId,
      eventType: "deposit_queue_processed",
      title: "Deposit queue processed",
      detail: "Queued deposits were processed for the next cycle.",
      occurredAt: batchStatus.endTime,
      status: batchStatus.status,
    });
  }

  if (batchStatus.status === "reopen") {
    rows.push({
      vaultId,
      vaultAddress,
      cycleId: batchStatus.nextBatchId,
      eventType: "cycle_reopened",
      title: "Cycle reopened",
      detail: "A new cycle is ready for vault actions.",
      occurredAt: batchStatus.endTime,
      status: batchStatus.status,
    });
  }

  const dedupe = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    dedupe.set(`${row.cycleId}:${row.eventType}`, row);
  }

  return [...dedupe.values()]
    .sort((left, right) => {
      const timeDiff = left.occurredAt.getTime() - right.occurredAt.getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return left.eventType.localeCompare(right.eventType);
    })
    .map((row, index) => ({
      ...row,
      occurredAt: new Date(row.occurredAt.getTime() + index),
    }));
}

function deriveLifecycleEventsFromUserActivity(args: {
  vaultId: number;
  vaultAddress: string;
  rows: Array<
    typeof userVaultActivityEvents.$inferSelect & {
      eventType: string;
      occurredAt: Date;
    }
  >;
}): Array<{
  vaultId: number;
  vaultAddress: string;
  cycleId: number;
  eventType: string;
  title: string;
  detail: string;
  occurredAt: Date;
  status: string;
}> {
  const { vaultId, vaultAddress, rows } = args;
  if (rows.length === 0) {
    return [];
  }

  const ordered = [...rows].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
  const firstOccurredAt = ordered[0]!.occurredAt;
  const lastOccurredAt = ordered[ordered.length - 1]!.occurredAt;

  const hasWithdrawReadyOrSettled = ordered.some(
    (row) => row.eventType === "withdraw_ready" || row.eventType === "withdraw_settled",
  );
  const hasClaimCompleted = ordered.some((row) => row.eventType === "claim_completed");
  const hasDepositQueued = ordered.some((row) => row.eventType === "deposit_queued");
  const hasDepositProcessed = ordered.some((row) => row.eventType === "deposit_minted");
  const hasAnyWithdrawFlow = ordered.some((row) => row.eventType.startsWith("withdraw_"));

  const syntheticCycleId =
    ordered
      .map((row) => row.cycleId)
      .find((cycleId): cycleId is number => Number.isFinite(cycleId ?? NaN)) ?? 0;

  const events: Array<{
    vaultId: number;
    vaultAddress: string;
    cycleId: number;
    eventType: string;
    title: string;
    detail: string;
    occurredAt: Date;
    status: string;
  }> = [
    {
      vaultId,
      vaultAddress,
      cycleId: syntheticCycleId,
      eventType: "cycle_opened",
      title: "Cycle opened",
      detail: "A vault cycle was already active before lifecycle tracking started.",
      occurredAt: firstOccurredAt,
      status: "open",
    },
  ];

  if (hasAnyWithdrawFlow || hasDepositQueued || hasDepositProcessed) {
    events.push({
      vaultId,
      vaultAddress,
      cycleId: syntheticCycleId,
      eventType: "book_closed",
      title: "Book closed",
      detail: "Direct actions paused and requests moved into queued processing.",
      occurredAt: firstOccurredAt,
      status: "processing",
    });
  }

  if (hasDepositQueued) {
    const firstQueuedDeposit = ordered.find((row) => row.eventType === "deposit_queued");
    const firstQueuedAt = firstQueuedDeposit?.occurredAt ?? firstOccurredAt;
    events.push({
      vaultId,
      vaultAddress,
      cycleId: firstQueuedDeposit?.cycleId ?? syntheticCycleId + 1,
      eventType: "deposit_queued",
      title: "Deposit queued",
      detail: "A new deposit entered the queue for the next cycle.",
      occurredAt: firstQueuedAt,
      status: "queued",
    });
  }

  if (hasWithdrawReadyOrSettled || hasClaimCompleted) {
    events.push({
      vaultId,
      vaultAddress,
      cycleId: syntheticCycleId,
      eventType: "processing_started",
      title: "Processing started",
      detail: "Queued withdrawals entered processing.",
      occurredAt: firstOccurredAt,
      status: "processing",
    });

    events.push({
      vaultId,
      vaultAddress,
      cycleId: syntheticCycleId,
      eventType: "processing_completed",
      title: "Processing completed",
      detail: "Queued withdrawals were processed.",
      occurredAt: lastOccurredAt,
      status: "processed",
    });

    events.push({
      vaultId,
      vaultAddress,
      cycleId: syntheticCycleId,
      eventType: "claim_window_opened",
      title: "Claim window opened",
      detail: "Processed withdrawals became claimable.",
      occurredAt: lastOccurredAt,
      status: "processed",
    });
  }

  if (hasDepositProcessed) {
    events.push({
      vaultId,
      vaultAddress,
      cycleId: syntheticCycleId + 1,
      eventType: "deposit_queue_processed",
      title: "Deposit queue processed",
      detail: "Queued deposits were converted into vault shares.",
      occurredAt: lastOccurredAt,
      status: "processed",
    });
  }

  const deduped = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    deduped.set(`${event.cycleId}:${event.eventType}`, event);
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const timeDiff = left.occurredAt.getTime() - right.occurredAt.getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return left.eventType.localeCompare(right.eventType);
    })
    .map((event, index) => ({
      ...event,
      occurredAt: new Date(event.occurredAt.getTime() + index),
    }));
}

function deriveIncrementalLifecycleEventsFromUserActivity(args: {
  vaultId: number;
  vaultAddress: string;
  rows: Array<
    typeof userVaultActivityEvents.$inferSelect & {
      eventType: string;
      occurredAt: Date;
    }
  >;
  latestLifecycleOccurredAt: Date | null;
  cycleId: number;
  batchStatus: string;
}): Array<{
  vaultId: number;
  vaultAddress: string;
  cycleId: number;
  eventType: string;
  title: string;
  detail: string;
  occurredAt: Date;
  status: string;
  requestId?: string;
  assetAmount?: string;
  shareAmount?: string;
}> {
  const { vaultId, vaultAddress, rows, latestLifecycleOccurredAt, cycleId, batchStatus } = args;

  const incrementalRows = rows
    .filter((row) =>
      latestLifecycleOccurredAt
        ? row.occurredAt.getTime() > latestLifecycleOccurredAt.getTime()
        : true,
    )
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());

  if (incrementalRows.length === 0) {
    return [];
  }

  const events: Array<{
    vaultId: number;
    vaultAddress: string;
    cycleId: number;
    eventType: string;
    title: string;
    detail: string;
    occurredAt: Date;
    status: string;
    requestId?: string;
    assetAmount?: string;
    shareAmount?: string;
  }> = [];

  for (const row of incrementalRows) {
    if (row.eventType === "deposit_queued") {
      events.push({
        vaultId,
        vaultAddress,
        cycleId: row.cycleId ?? cycleId + 1,
        eventType: "deposit_queued",
        title: "Deposit queued",
        detail: "A new deposit entered the queue for the next cycle.",
        occurredAt: row.occurredAt,
        status: row.status ?? "queued",
        requestId: row.requestId ?? undefined,
        assetAmount: row.assetAmount ?? undefined,
        shareAmount: row.shareAmount ?? undefined,
      });
      continue;
    }

    if (row.eventType === "deposit_processed" || row.eventType === "deposit_minted") {
      events.push({
        vaultId,
        vaultAddress,
        cycleId: row.cycleId ?? cycleId,
        eventType: "deposit_minted",
        title: "Deposit minted",
        detail: "A queued deposit finished processing and shares were minted automatically.",
        occurredAt: row.occurredAt,
        status: batchStatus,
        assetAmount: row.assetAmount ?? undefined,
        shareAmount: row.shareAmount ?? undefined,
      });
      continue;
    }

    if (row.eventType === "withdraw_ready" || row.eventType === "withdraw_settled") {
      events.push({
        vaultId,
        vaultAddress,
        cycleId,
        eventType: "withdraw_ready",
        title: "Withdrawal processed",
        detail: "A queued withdrawal became ready to claim.",
        occurredAt: row.occurredAt,
        status: row.status ?? "ready",
        requestId: row.requestId ?? undefined,
        assetAmount: row.assetAmount ?? undefined,
        shareAmount: row.shareAmount ?? undefined,
      });

      events.push({
        vaultId,
        vaultAddress,
        cycleId,
        eventType: "claim_window_opened",
        title: "Claim window opened",
        detail: "At least one processed withdrawal is now claimable.",
        occurredAt: row.occurredAt,
        status: row.status ?? "ready",
      });
      continue;
    }

    if (row.eventType === "claim_completed") {
      events.push({
        vaultId,
        vaultAddress,
        cycleId,
        eventType: "processing_completed",
        title: "Processing completed",
        detail: "A queued withdrawal was claimed successfully.",
        occurredAt: row.occurredAt,
        status: row.status ?? "completed",
        requestId: row.requestId ?? undefined,
        assetAmount: row.assetAmount ?? undefined,
        shareAmount: row.shareAmount ?? undefined,
      });
    }
  }

  const deduped = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const requestKey = event.requestId ?? "-";
    deduped.set(`${event.eventType}:${requestKey}:${event.occurredAt.toISOString()}`, event);
  }

  return [...deduped.values()];
}

// ============================================================================
// Validation Helpers
// ============================================================================

function isValidDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
}

function isValidEthereumAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

interface RedeemRequestValidation {
  shares: string;
  assetsEstimated?: string;
  controller?: string;
  owner?: string;
  operator?: string;
}

function validateRedeemRequest(body: unknown): RedeemRequestValidation | null {
  if (typeof body !== "object" || body === null) return null;
  const { shares, assetsEstimated, controller, owner, operator } = body as Record<string, unknown>;
  if (!isValidDecimalString(shares)) return null;
  if (assetsEstimated !== undefined && !isValidDecimalString(assetsEstimated)) return null;

  // ERC-7540: Validate address fields if provided
  if (controller !== undefined && !isValidEthereumAddress(controller)) return null;
  if (owner !== undefined && !isValidEthereumAddress(owner)) return null;
  if (operator !== undefined && !isValidEthereumAddress(operator)) return null;

  return { shares, assetsEstimated, controller, owner, operator };
}

function validateClaimRequest(body: unknown): { signature?: string } {
  if (typeof body !== "object" || body === null) return {};
  const { signature } = body as Record<string, unknown>;
  return { signature: typeof signature === "string" ? signature : undefined };
}

function parsePositiveIntQuery(raw: unknown, fallbackValue: number, maxValue: number): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return Math.min(parsed, maxValue);
}

function parseNonNegativeIntQuery(raw: unknown, fallbackValue: number, maxValue: number): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackValue;
  }

  return Math.min(parsed, maxValue);
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getCustomVaultProvider(vaultId: number): Promise<CustomVaultProvider | null> {
  const factory = getVaultProviderFactory();

  let provider: IVaultProvider;
  try {
    provider = factory.getProvider(vaultId);
  } catch {
    return null;
  }

  if (provider.providerType !== "custom") {
    return null;
  }

  return provider as CustomVaultProvider;
}

async function getCachedLifecycleFields(
  provider: CustomVaultProvider,
): Promise<Record<string, unknown> | undefined> {
  const cached = lifecycleCache.get(provider);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const lifecycle = { ...(await provider.getLifecycle()) };
  lifecycleCache.set(provider, {
    value: lifecycle,
    expiresAt: now + LIFECYCLE_CACHE_TTL_MS,
  });
  return lifecycle;
}

/**
 * Format redemption request with corrected lifecycle fields
 * Includes: entitlement, accrued, claimed, carryRemaining, claimableNow, minClaimThreshold, dustOverrideEligible
 */
async function formatRedemptionRequest(
  request: {
    requestId: string;
    vaultId: number;
    userAddress: Address;
    controller?: Address;
    owner?: Address;
    operator?: Address;
    batchId: number;
    shares: bigint;
    assetsEstimated: bigint;
    assetsActual?: bigint;
    status: string;
    createdAt: Date;
    settledAt?: Date;
    claimedAt?: Date;
    cancelledAt?: Date;
  },
  includeLifecycleFields = true,
): Promise<Record<string, unknown>> {
  const VAULT_SHARE_DECIMALS = 6;
  const USDC_DECIMALS = 6;

  const baseResponse = {
    id: request.requestId,
    requestId: request.requestId,
    vaultId: request.vaultId,
    userAddress: request.userAddress,
    controller: request.controller ?? request.userAddress,
    owner: request.owner ?? request.userAddress,
    operator: request.operator ?? null,
    batchId: request.batchId,
    cycleId: request.batchId,
    targetCycle: request.batchId,
    targetCycleEndTime: request.settledAt?.toISOString() ?? request.createdAt.toISOString(),
    settlementTime: request.settledAt?.toISOString() ?? null,
    shares: request.shares.toString(),
    sharesFormatted: formatUnits(request.shares, VAULT_SHARE_DECIMALS),
    assetsEstimated: request.assetsEstimated.toString(),
    assetsEstimatedFormatted: formatUnits(request.assetsEstimated, USDC_DECIMALS),
    claimableAssets: request.assetsActual?.toString() ?? null,
    claimableAssetsFormatted: request.assetsActual
      ? formatUnits(request.assetsActual, USDC_DECIMALS)
      : null,
    assetsActual: request.assetsActual?.toString(),
    assetsActualFormatted: request.assetsActual
      ? formatUnits(request.assetsActual, USDC_DECIMALS)
      : undefined,
    requestKind: request.requestId.startsWith("claimable-")
      ? "controller_claimable"
      : request.requestId.startsWith("pending-")
        ? "controller_pending"
        : "request",
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    settledAt: request.settledAt?.toISOString(),
    claimedAt: request.claimedAt?.toISOString(),
    cancelledAt: request.cancelledAt?.toISOString(),
  };

  // Skip lifecycle fields if not requested
  if (!includeLifecycleFields) {
    return baseResponse;
  }

  // Fetch entitlement data for lifecycle fields
  try {
    const entitlement = await entitlementRepository.getByRequest(request.requestId);

    if (!entitlement) {
      return {
        ...baseResponse,
        // Lifecycle fields - default values when no entitlement exists
        queued: request.status === "pending" ? request.assetsEstimated.toString() : "0",
        queuedFormatted:
          request.status === "pending" ? formatUnits(request.assetsEstimated, USDC_DECIMALS) : "0",
        frozen: request.status === "claimable" ? request.shares.toString() : "0",
        frozenFormatted:
          request.status === "claimable" ? formatUnits(request.shares, VAULT_SHARE_DECIMALS) : "0",
        // Corrected lifecycle fields per T1 gap matrix
        entitlement: "0",
        entitlementFormatted: "0",
        accrued: "0",
        accruedFormatted: "0",
        claimed: "0",
        claimedFormatted: "0",
        carryRemaining: "0",
        carryRemainingFormatted: "0",
        claimableNow: "0",
        claimableNowFormatted: "0",
        minClaimThreshold: "1000000", // 1 USDC in 6 decimals
        minClaimThresholdFormatted: "1.0",
        dustOverrideEligible: false,
        lifecycleError: "No entitlement record found",
      };
    }

    // Calculate lifecycle fields from entitlement using CORRECTED schema fields
    // Schema: entitlement (total entitled), accrued (from realizations), claimed (by user), carryRemaining
    const entitlementAmount = BigInt(entitlement.entitlement);
    const accrued = BigInt(entitlement.accrued);
    const claimed = BigInt(entitlement.claimed);
    const carryRemaining = BigInt(entitlement.carryRemaining);
    const claimableNow = accrued - claimed;

    // Minimum claim threshold (1 USDC = 1000000 in 6 decimals)
    const minClaimThreshold = 1000000n;

    // Check if dust override is eligible (when claimable is below threshold but user wants to claim anyway)
    const dustOverrideEligible = claimableNow > 0n && claimableNow < minClaimThreshold;

    // Check if meets threshold for normal claim
    const meetsThreshold = claimableNow >= minClaimThreshold;

    // Determine queued vs frozen based on status
    const isPending = request.status === "pending";
    const isClaimable = request.status === "claimable";

    return {
      ...baseResponse,
      // Queued: assets waiting in queue (pending status)
      queued: isPending ? request.assetsEstimated.toString() : "0",
      queuedFormatted: isPending ? formatUnits(request.assetsEstimated, USDC_DECIMALS) : "0",
      // Frozen: shares frozen in epoch (claimable status)
      frozen: isClaimable ? request.shares.toString() : "0",
      frozenFormatted: isClaimable ? formatUnits(request.shares, VAULT_SHARE_DECIMALS) : "0",
      // Corrected lifecycle fields per T1 gap matrix
      entitlement: entitlementAmount.toString(),
      entitlementFormatted: formatUnits(entitlementAmount, USDC_DECIMALS),
      accrued: accrued.toString(),
      accruedFormatted: formatUnits(accrued, USDC_DECIMALS),
      claimed: claimed.toString(),
      claimedFormatted: formatUnits(claimed, USDC_DECIMALS),
      carryRemaining: carryRemaining.toString(),
      carryRemainingFormatted: formatUnits(carryRemaining, USDC_DECIMALS),
      claimableNow: claimableNow.toString(),
      claimableNowFormatted: formatUnits(claimableNow > 0n ? claimableNow : 0n, USDC_DECIMALS),
      minClaimThreshold: "1000000",
      minClaimThresholdFormatted: "1.0",
      dustOverrideEligible,
      meetsThreshold,
      // Additional metadata
      entitlementStatus: entitlement.status,
      sharesSubmitted: entitlement.sharesSubmitted,
      entitlementRatio: entitlement.entitlementRatio,
    };
  } catch (error) {
    logger.warn("CustomVault API: Failed to fetch lifecycle fields", {
      requestId: request.requestId,
      error: (error as Error).message,
    });

    // Return base response with default lifecycle fields on error
    return {
      ...baseResponse,
      queued: "0",
      queuedFormatted: "0",
      frozen: "0",
      frozenFormatted: "0",
      entitlement: "0",
      entitlementFormatted: "0",
      accrued: "0",
      accruedFormatted: "0",
      claimed: "0",
      claimedFormatted: "0",
      carryRemaining: "0",
      carryRemainingFormatted: "0",
      claimableNow: "0",
      claimableNowFormatted: "0",
      minClaimThreshold: "1000000",
      minClaimThresholdFormatted: "1.0",
      dustOverrideEligible: false,
      lifecycleError: (error as Error).message,
    };
  }
}

function formatEpochHistoryItem(batch: {
  batchId: bigint;
  startTime: bigint;
  endTime: bigint;
  snapshotNAV: bigint;
  snapshotTimestamp: bigint;
  totalSharesPending: bigint;
  totalAssetsSnapshot: bigint;
  proRataRatio: bigint;
  status: string;
}): Record<string, unknown> {
  return {
    cycleId: Number(batch.batchId),
    batchId: Number(batch.batchId),
    startTime: new Date(Number(batch.startTime) * 1000).toISOString(),
    endTime: new Date(Number(batch.endTime) * 1000).toISOString(),
    cycleOpenNAV: batch.snapshotNAV.toString(),
    cycleOpenNAVFormatted: formatUnits(batch.snapshotNAV, 18),
    snapshotNAV: batch.snapshotNAV.toString(),
    snapshotNAVFormatted: formatUnits(batch.snapshotNAV, 18),
    snapshotTimestamp:
      batch.snapshotTimestamp > 0n
        ? new Date(Number(batch.snapshotTimestamp) * 1000).toISOString()
        : null,
    totalSharesPending: batch.totalSharesPending.toString(),
    totalSharesPendingFormatted: formatUnits(batch.totalSharesPending, 6),
    frozenShares: batch.totalSharesPending.toString(),
    frozenSharesFormatted: formatUnits(batch.totalSharesPending, 6),
    frozenAssets: batch.totalAssetsSnapshot.toString(),
    frozenAssetsFormatted: formatUnits(batch.totalAssetsSnapshot, 6),
    proRataRatio: batch.proRataRatio.toString(),
    proRataRatioFormatted: (Number(batch.proRataRatio) / 1e18).toFixed(6),
    // CLOSED-BOOK: No carry/epoch accounting - these are always 0
    carryAccrued: "0",
    carryAccruedFormatted: "0",
    cohortTotalEntitlement: "0",
    cohortTotalEntitlementFormatted: "0",
    cohortTotalAccrued: "0",
    cohortTotalAccruedFormatted: "0",
    cohortTotalClaimed: "0",
    cohortTotalClaimedFormatted: "0",
    cohortCarryRemaining: "0",
    cohortCarryRemainingFormatted: "0",
    batchState: batch.status,
    status: batch.status,
  };
}

function formatCycleStatus(batchStatus: {
  batchId: number;
  nextBatchId: number;
  status: string;
  startTime: Date;
  endTime: Date;
  cutoffTime?: Date;
  isPriceLocked: boolean;
  lockedClearingPrice?: string;
  settlementProgress?: {
    processed: number;
    total: number;
    isComplete: boolean;
  };
  totalSharesPending: bigint;
  totalAssetsSnapshot?: string;
  proRataRatio: number;
  totalQueuedDeposits: bigint;
  claimableRedemptions: number;
  mintedDeposits: number;
}) {
  const batchState = batchStatus.status;
  const isActive = ["open", "closed", "cutoff", "flattening", "settling", "processing"].includes(
    batchState,
  );
  const isPast = ["settled", "processed", "reopen"].includes(batchState);

  let timeRemainingFormatted = "Awaiting cycle close";
  if (batchState === "cutoff") {
    timeRemainingFormatted = "Awaiting flatten";
  } else if (batchState === "closed") {
    timeRemainingFormatted = "Queueing while invested";
  } else if (batchState === "processing") {
    timeRemainingFormatted = "Processing queued requests";
  } else if (batchState === "flattening") {
    timeRemainingFormatted = "Flattening in progress";
  } else if (batchState === "settling") {
    timeRemainingFormatted = "Settlement in progress";
  } else if (batchState === "settled") {
    timeRemainingFormatted = "Claims available";
  } else if (batchState === "processed") {
    timeRemainingFormatted = "Cycle processed";
  } else if (batchState === "reopen") {
    timeRemainingFormatted = "Ready for next cycle";
  }

  return {
    cycleId: batchStatus.batchId,
    batchId: batchStatus.batchId,
    startTime: batchStatus.startTime.toISOString(),
    endTime: batchStatus.endTime.toISOString(),
    settlementTime: batchStatus.endTime.toISOString(),
    isActive,
    isPast,
    timeRemainingMs: 0,
    timeRemainingFormatted,
    totalRequests: batchStatus.claimableRedemptions,
    totalShares: batchStatus.totalSharesPending.toString(),
    totalSharesFormatted: formatUnits(batchStatus.totalSharesPending, 6),
    settled: ["settled", "processed", "reopen"].includes(batchState),
    batchState,
    proRataRatio: Math.round(batchStatus.proRataRatio * 1e18).toString(),
    availableAssets: batchStatus.totalAssetsSnapshot,
    availableAssetsFormatted: batchStatus.totalAssetsSnapshot
      ? formatUnits(BigInt(batchStatus.totalAssetsSnapshot), 6)
      : undefined,
    flatteningProgress: batchState === "flattening" ? 50 : undefined,
    settlementProgress: batchStatus.settlementProgress
      ? batchStatus.settlementProgress.total > 0
        ? Math.round(
            (batchStatus.settlementProgress.processed / batchStatus.settlementProgress.total) * 100,
          )
        : batchStatus.settlementProgress.isComplete
          ? 100
          : 0
      : undefined,
    isCutoff: batchState === "cutoff",
    cutoffTime: batchStatus.cutoffTime?.toISOString() ?? null,
  };
}

// ============================================================================
// Route Handlers
// ============================================================================

export function buildCustomVaultRouter(): Router {
  const router = Router();

  router.post("/:vaultId/redeem", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const validation = validateRedeemRequest(req.body);
      if (!validation) {
        res.status(400).json({
          error: "Invalid request body",
          message:
            "shares must be a valid decimal string. controller, owner, operator must be valid Ethereum addresses if provided.",
        });
        return;
      }

      const {
        shares,
        assetsEstimated: clientAssetsEstimated,
        controller,
        owner,
        operator,
      } = validation;
      const userAddress = req.session!.address as Address;

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
          message: "Vault does not exist or is not configured for custom cycle-based redemption",
        });
        return;
      }

      const sharesUnits = parseUnits(shares, 6);
      if (sharesUnits <= 0n) {
        res.status(400).json({ error: "Shares must be greater than zero" });
        return;
      }

      const effectiveController = controller || userAddress;
      const effectiveOwner = owner || userAddress;

      if (operator && operator.toLowerCase() !== userAddress.toLowerCase()) {
        logger.info("CustomVault API: Redemption request with operator specified", {
          vaultId,
          userAddress,
          operator,
          controller: effectiveController,
          owner: effectiveOwner,
        });
      }

      const assetsEstimated = 0n;

      if (clientAssetsEstimated) {
        const clientEstimateUnits = parseUnits(clientAssetsEstimated, 6);
        const difference =
          assetsEstimated > clientEstimateUnits
            ? assetsEstimated - clientEstimateUnits
            : clientEstimateUnits - assetsEstimated;
        const slippagePercent =
          clientEstimateUnits > 0n ? Number(difference) / Number(clientEstimateUnits) : 0;

        if (slippagePercent > 0.01) {
          logger.info("CustomVault API: Redeem estimate differs from client", {
            vaultId,
            userAddress,
            clientEstimate: clientAssetsEstimated,
            serverEstimate: "0",
            slippagePercent,
          });
        }
      }

      const result = await provider.requestRedeem(userAddress, sharesUnits);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
          vaultId,
          shares,
        });
        return;
      }

      if (!result.requestId) {
        res.status(501).json({
          success: false,
          error:
            "vault-api does not execute user-signed redeem requests on-chain. Use the direct wallet request flow in vault-web.",
          vaultId,
          shares,
        });
        return;
      }

      logger.info("CustomVault API: Redemption request created", {
        vaultId,
        userAddress,
        controller: effectiveController,
        owner: effectiveOwner,
        operator,
        shares: sharesUnits.toString(),
        batchId: result.batchId,
      });

      await activityEventRepository.appendUserVaultActivityEvent({
        vaultId,
        vaultAddress: provider.config.vaultAddress,
        userAddress,
        eventType: "withdraw_requested",
        title: "Withdrawal requested",
        detail: "Your withdrawal request entered the queue and will be processed by the worker.",
        cycleId: result.batchId ?? undefined,
        requestId: result.requestId,
        status: "pending",
        assetAmount: undefined,
        shareAmount: shares,
      });

      res.status(201).json({
        success: true,
        requestId: result.requestId,
        batchId: result.batchId ?? null,
        cycleId: result.batchId ?? null,
        vaultId,
        userAddress,
        controller: effectiveController,
        owner: effectiveOwner,
        operator: operator || null,
        shares: sharesUnits.toString(),
        sharesFormatted: shares,
        assetsEstimated: assetsEstimated.toString(),
        assetsEstimatedFormatted: formatUnits(assetsEstimated, 6),
        status: "pending",
        estimatedSettlementTime: null,
        message:
          "Redemption request created. Shares remain pending while the vault is closed and become claimable after processing.",
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to create redemption request", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to create redemption request",
        message: (error as Error).message,
      });
    }
  });

  router.post("/:vaultId/activity/deposit", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      if (Number.isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({ error: `Custom vault ${vaultId} not found` });
        return;
      }

      const userAddress = req.session!.address as Address;
      const txHash = typeof req.body?.txHash === "string" ? req.body.txHash : undefined;
      const assets = typeof req.body?.assets === "string" ? req.body.assets : undefined;
      const shares = typeof req.body?.shares === "string" ? req.body.shares : undefined;
      const mode = req.body?.mode === "queued" ? "queued" : "minted";
      let queuedCycleId: number | undefined;

      if (mode === "queued") {
        try {
          const currentBatch = await provider.getClient().getCurrentBatch();
          const currentBatchId = Number(currentBatch);
          if (Number.isFinite(currentBatchId)) {
            queuedCycleId = currentBatchId;
          }
        } catch (error) {
          logger.warn("CustomVault API: Failed to resolve queued deposit cycle", {
            vaultId,
            error: (error as Error).message,
          });
        }
      }

      if (!assets && !shares) {
        res.status(400).json({ error: "assets or shares is required" });
        return;
      }

      await activityEventRepository.appendUserVaultActivityEvent({
        vaultId,
        vaultAddress: provider.config.vaultAddress,
        userAddress,
        cycleId: queuedCycleId,
        eventType: mode === "queued" ? "deposit_queued" : "deposit_minted",
        title: mode === "queued" ? "Deposit queued" : "Deposit completed",
        detail:
          mode === "queued"
            ? "Your deposit entered the queue."
            : "Your deposit was converted into vault shares.",
        txHash,
        status: mode,
        assetAmount: assets,
        shareAmount: shares,
      });

      if (mode === "queued" && assets && queuedCycleId !== undefined) {
        await flatBookStateRepository.recordQueuedDeposit({
          vaultAddress: provider.config.vaultAddress,
          cycleId: queuedCycleId,
          userAddress,
          assetAmount: assets,
          occurredAt: new Date(),
        });

        await flatBookStateRepository.upsertCycle({
          vaultAddress: provider.config.vaultAddress,
          cycleId: queuedCycleId,
          state: "closed",
        });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error("CustomVault API: Failed to record deposit activity", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({ error: "Failed to record deposit activity" });
    }
  });

  router.post("/:vaultId/activity/claim", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }

      const vaultId = parseInt(vaultIdParam, 10);
      if (Number.isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({ error: `Custom vault ${vaultId} not found` });
        return;
      }

      const userAddress = req.session!.address as Address;
      const txHash = typeof req.body?.txHash === "string" ? req.body.txHash : undefined;
      const assets = typeof req.body?.assets === "string" ? req.body.assets : undefined;
      const shares = typeof req.body?.shares === "string" ? req.body.shares : undefined;
      const rawRequestId = typeof req.body?.requestId === "string" ? req.body.requestId : undefined;

      if (!txHash || !txHash.startsWith("0x")) {
        res.status(400).json({ error: "A claim transaction hash is required" });
        return;
      }

      const vaultAddress = provider.config.vaultAddress;
      const existingRequests = await withdrawalRepository.getRequestsByUser(
        userAddress,
        vaultAddress,
      );
      const matchingRequest =
        existingRequests.find((request) => request.requestId === rawRequestId) ??
        existingRequests.find(
          (request) => request.status === "ready" || request.status === "settled",
        );

      let recordedRequestId = rawRequestId ?? null;
      let recordedShares = shares;
      let recordedAssets = assets;

      if (matchingRequest && matchingRequest.status === "ready") {
        const completed = await withdrawalRepository.markCompletedIdempotent(
          matchingRequest.requestId,
          txHash,
        );
        if (completed.success) {
          recordedRequestId = matchingRequest.requestId;
          recordedShares = matchingRequest.shares;
          recordedAssets = matchingRequest.assetsEstimated;
        }
      }

      await activityEventRepository.appendUserVaultActivityEvent({
        vaultId,
        vaultAddress,
        userAddress,
        eventType: "claim_completed",
        title: "Claim completed",
        detail: "Claimed assets from your withdrawal request.",
        requestId: recordedRequestId ?? undefined,
        txHash,
        status: "claimed",
        assetAmount: recordedAssets,
        shareAmount: recordedShares,
      });

      res.json({ success: true, requestId: recordedRequestId });
    } catch (error) {
      logger.error("CustomVault API: Failed to record claim activity", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({ error: "Failed to record claim activity" });
    }
  });

  router.get("/:vaultId/requests/:requestId", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const requestId = req.params.requestId;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      if (!requestId) {
        res.status(400).json({ error: "Request ID is required" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const statusResult = await provider.getRequestStatus(requestId);
      const formattedRequest = await formatRedemptionRequest(statusResult.request);

      res.json({
        success: true,
        request: formattedRequest,
        claimable: statusResult.claimable,
        estimatedSettlementTime: statusResult.estimatedSettlementTime?.toISOString(),
      });
    } catch (error) {
      if (error instanceof VaultProviderError) {
        if (error.code === "REQUEST_NOT_FOUND") {
          const statusCode = error.message.includes("Invalid requestId") ? 400 : 404;
          res.status(statusCode).json({
            error: statusCode === 400 ? "Invalid request ID" : "Request not found",
            requestId: req.params.requestId,
          });
          return;
        }
      }

      if ((error as Error).message.includes("Request not found")) {
        res.status(404).json({
          error: "Request not found",
          requestId: req.params.requestId,
        });
        return;
      }

      logger.error("CustomVault API: Failed to get request status", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
        requestId: req.params.requestId,
      });
      res.status(500).json({
        error: "Failed to get request status",
        message: (error as Error).message,
      });
    }
  });

  router.post("/:vaultId/requests/:requestId/claim", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      const requestId = req.params.requestId!;
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      if (!requestId) {
        res.status(400).json({ error: "Request ID is required" });
        return;
      }

      validateClaimRequest(req.body);

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      let statusResult;
      try {
        statusResult = await provider.getRequestStatus(requestId);
      } catch (error) {
        if (error instanceof VaultProviderError && error.code === "REQUEST_NOT_FOUND") {
          const statusCode = error.message.includes("Invalid requestId") ? 400 : 404;
          res.status(statusCode).json({
            success: false,
            error: statusCode === 400 ? "Invalid request ID" : "Request not found",
            requestId,
            vaultId,
          });
          return;
        }
        throw error;
      }
      const request = statusResult.request;

      const ownerAddress = (request.owner ?? request.userAddress).toLowerCase();
      const controllerAddress = (request.controller ?? request.userAddress).toLowerCase();
      const isOwner = ownerAddress === userAddress.toLowerCase();
      const isController = controllerAddress === userAddress.toLowerCase();
      const isOperator = await provider
        .getClient()
        .isOperator(controllerAddress as Address, userAddress);

      const isAuthorized = isOwner || isController || isOperator;

      if (!isAuthorized) {
        logger.warn("CustomVault API: Unauthorized claim attempt blocked", {
          vaultId,
          requestId,
          requestOwner: ownerAddress,
          requestController: request.controller,
          requestOperatorApproved: isOperator,
          attemptingUser: userAddress,
        });
        res.status(403).json({
          success: false,
          error:
            "Not authorized: You are not the owner, controller, or authorized operator for this claim",
          requestId,
          vaultId,
        });
        return;
      }

      const currentState = mapRequestStatusToClaimState(request.status);

      const guard = validateClaimOperation(ClaimOperation.CLAIM, currentState);

      if (!guard.valid) {
        logger.warn("CustomVault API: Claim operation blocked by state machine", {
          vaultId,
          requestId,
          userAddress,
          currentState,
          error: guard.error,
        });
        res.status(409).json({
          success: false,
          error: guard.error,
          requestId,
          vaultId,
          currentState,
        });
        return;
      }

      const entitlement = await entitlementRepository.getByRequest(requestId);
      if (entitlement) {
        const eligibility = await entitlementRepository.getClaimEligibility(entitlement.id);

        if (!eligibility.canClaim) {
          res.status(409).json({
            success: false,
            error: eligibility.error || "No claimable amount available",
            requestId,
            vaultId,
            entitlementStatus: eligibility.currentStatus,
            unclaimedAmount: eligibility.unclaimedAmount,
          });
          return;
        }

        // Check minimum claim threshold (1 USDC = 1000000 in 6 decimals)
        const minClaimThreshold = 1000000n;
        const claimableAmount = BigInt(eligibility.unclaimedAmount);
        if (claimableAmount < minClaimThreshold) {
          res.status(409).json({
            success: false,
            error: `Claim amount ${formatUnits(claimableAmount, 6)} USDC is below minimum threshold of 1.0 USDC. Micro partial claims are not supported.`,
            requestId,
            vaultId,
            claimableAmount: eligibility.unclaimedAmount,
            minClaimThreshold: "1000000",
            minClaimThresholdFormatted: "1.0",
          });
          return;
        }

        const capCheck = await payoutRepository.checkClaimCap(
          entitlement.id,
          eligibility.unclaimedAmount,
        );

        if (!capCheck.canProceed) {
          logger.error("CustomVault API: Claim would exceed entitlement cap", {
            requestId,
            entitlementId: entitlement.id,
            error: capCheck.error,
          });
          res.status(409).json({
            success: false,
            error: capCheck.error,
            requestId,
            vaultId,
            entitlementCap: capCheck.entitlementCap,
            currentClaimed: capCheck.currentCumulative,
          });
          return;
        }
      }

      const result = await provider.claimRedemption(requestId, userAddress);

      if (!result.success) {
        const statusCode = result.error?.includes("not yet settled")
          ? 409
          : result.error?.includes("Not authorized")
            ? 403
            : 400;

        res.status(statusCode).json({
          success: false,
          error: result.error,
          requestId,
          vaultId,
        });
        return;
      }

      if (!result.txHash) {
        res.status(501).json({
          success: false,
          error:
            "vault-api does not execute on-chain claim transactions for users. Use the direct wallet claim flow in vault-web.",
          requestId,
          vaultId,
        });
        return;
      }

      if (entitlement) {
        const claimResult = await payoutRepository.claimAllForEntitlement(
          entitlement.id,
          result.txHash,
        );

        if (!claimResult.success) {
          logger.error("CustomVault API: Failed to record claim in entitlement ledger", {
            requestId,
            entitlementId: entitlement.id,
            error: claimResult.error,
          });
        }

        await entitlementRepository.incrementClaimed(
          entitlement.id,
          result.assetsReceived.toString(),
        );
      }

      logger.info("CustomVault API: Redemption claimed", {
        vaultId,
        requestId,
        userAddress,
        assetsReceived: result.assetsReceived.toString(),
        entitlementId: entitlement?.id,
      });

      void activityEventRepository.appendUserVaultActivityEvent({
        vaultId,
        vaultAddress: provider.config.vaultAddress,
        userAddress,
        eventType: "claim_completed",
        title: "Claim completed",
        detail: "Claimed assets from your withdrawal request.",
        requestId,
        txHash: result.txHash,
        status: "claimed",
        assetAmount: result.assetsReceived.toString(),
        shareAmount: request.shares.toString(),
      });

      res.json({
        success: true,
        requestId,
        vaultId,
        userAddress,
        assetsReceived: result.assetsReceived.toString(),
        assetsReceivedFormatted: formatUnits(result.assetsReceived, 6),
        txHash: result.txHash,
        currentState: ClaimState.CLOSED,
        message: "Redemption claimed successfully. Assets have been transferred to your wallet.",
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to claim redemption", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
        requestId: req.params.requestId,
      });
      res.status(500).json({
        error: "Failed to claim redemption",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/epochs/current", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const client = provider.getClient();
      const currentEpoch = await client.getCurrentBatch();
      const batchStatus = await provider.getBatchStatus(Number(currentEpoch));

      if (!batchStatus) {
        res.status(500).json({
          error: "Failed to get current epoch status",
        });
        return;
      }

      res.json({
        success: true,
        cycle: formatCycleStatus(batchStatus),
        vaultId,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get current epoch", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get current epoch",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/epochs", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 6;
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 6;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({ error: `Custom vault ${vaultId} not found` });
        return;
      }

      const client = provider.getClient();
      const currentEpoch = Number(await client.getCurrentBatch());
      const minEpoch = Math.max(0, currentEpoch - limit + 1);
      const epochIds: number[] = [];

      for (let epochId = currentEpoch; epochId >= minEpoch; epochId -= 1) {
        epochIds.push(epochId);
      }

      const epochs = await Promise.all(
        epochIds.map(async (epochId) => {
          const epoch = await client.getBatch(BigInt(epochId));
          return epoch ? formatEpochHistoryItem(epoch) : null;
        }),
      );

      res.json({
        success: true,
        vaultId,
        currentEpochId: currentEpoch,
        epochs: epochs.filter((epoch): epoch is Record<string, unknown> => epoch !== null),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get epoch history", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get epoch history",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/epochs/:epochId", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const epochId = parseInt(req.params.epochId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      if (isNaN(epochId)) {
        res.status(400).json({ error: "Invalid epoch ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const batchStatus = await provider.getBatchStatus(epochId);

      if (!batchStatus) {
        res.status(404).json({
          error: `Epoch ${epochId} not found`,
        });
        return;
      }

      const canSettle = await provider.isSettlementReady(epochId);

      res.json({
        success: true,
        cycle: formatCycleStatus(batchStatus),
        canSettle,
        vaultId,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get epoch details", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
        epochId: req.params.epochId,
      });
      res.status(500).json({
        error: "Failed to get epoch details",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // CYCLE ALIASES: /cycles/* routes are aliases for /epochs/* routes
  // These provide the cycle-based naming convention for the frontend
  // ============================================================================

  router.get("/:vaultId/cycles/current", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const client = provider.getClient();
      const currentEpoch = await client.getCurrentBatch();
      const batchStatus = await provider.getBatchStatus(Number(currentEpoch));

      if (!batchStatus) {
        res.status(500).json({
          error: "Failed to get current cycle status",
        });
        return;
      }

      // Attempt to fetch lifecycle telemetry fields from backend lifecycle logic
      // These fields are computed by the LiquidityManager on the backend
      // and exposed through a dedicated route method in the provider.
      let lifecycleFields: Record<string, unknown> | undefined = undefined;
      try {
        lifecycleFields = await getCachedLifecycleFields(provider);
      } catch {
        lifecycleFields = undefined;
      }

      const cyclePayload = {
        ...formatCycleStatus(batchStatus),
        ...(lifecycleFields ?? {}),
      } as Record<string, unknown>;

      res.json({
        success: true,
        cycle: cyclePayload,
        vaultId,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get current cycle", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get current cycle",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/cycles", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 6;
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 6;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({ error: `Custom vault ${vaultId} not found` });
        return;
      }

      const client = provider.getClient();
      const currentEpoch = Number(await client.getCurrentBatch());
      const minEpoch = Math.max(0, currentEpoch - limit + 1);
      const epochIds: number[] = [];

      for (let epochId = currentEpoch; epochId >= minEpoch; epochId -= 1) {
        epochIds.push(epochId);
      }

      const cycles = await Promise.all(
        epochIds.map(async (epochId) => {
          const epoch = await client.getBatch(BigInt(epochId));
          return epoch ? formatEpochHistoryItem(epoch) : null;
        }),
      );

      res.json({
        success: true,
        vaultId,
        currentCycleId: currentEpoch,
        cycles: cycles.filter((cycle): cycle is Record<string, unknown> => cycle !== null),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get cycle history", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get cycle history",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/cycles/:cycleId", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const cycleId = parseInt(req.params.cycleId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      if (isNaN(cycleId)) {
        res.status(400).json({ error: "Invalid cycle ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const batchStatus = await provider.getBatchStatus(cycleId);

      if (!batchStatus) {
        res.status(404).json({
          error: `Cycle ${cycleId} not found`,
        });
        return;
      }

      const canSettle = await provider.isSettlementReady(cycleId);

      res.json({
        success: true,
        cycle: formatCycleStatus(batchStatus),
        canSettle,
        vaultId,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get cycle details", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
        cycleId: req.params.cycleId,
      });
      res.status(500).json({
        error: "Failed to get cycle details",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/events", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);
      const limit = parsePositiveIntQuery(req.query.limit, 50, 100);
      const offset = parseNonNegativeIntQuery(req.query.offset, 0, 2000);

      if (Number.isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({ error: `Custom vault ${vaultId} not found` });
        return;
      }

      const vaultAddress = provider.config.vaultAddress;
      const canonicalHead = await activityEventRepository.listVaultLifecycleEvents(
        vaultAddress,
        1,
        0,
      );
      const hasCanonicalEvents = canonicalHead.length > 0;

      const latestCanonicalOccurredAt = canonicalHead[0]?.occurredAt ?? null;

      try {
        const [currentBatchId, historicalUserEvents] = await Promise.all([
          provider.getClient().getCurrentBatch(),
          activityEventRepository.listVaultUserActivityEvents(vaultAddress, 500),
        ]);

        if (!hasCanonicalEvents) {
          let seedRows = deriveLifecycleEventsFromUserActivity({
            vaultId,
            vaultAddress,
            rows: historicalUserEvents,
          });

          if (seedRows.length === 0) {
            const batchStatus = await provider.getBatchStatus(Number(currentBatchId));
            seedRows = seedLifecycleEventsFromBatchStatus({
              batchStatus,
              vaultId,
              vaultAddress,
            });
          }

          for (const seedRow of seedRows) {
            await activityEventRepository.appendVaultLifecycleEvent(seedRow);
          }
        } else {
          const batchStatus = await provider.getBatchStatus(Number(currentBatchId));
          const incrementalRows = deriveIncrementalLifecycleEventsFromUserActivity({
            vaultId,
            vaultAddress,
            rows: historicalUserEvents,
            latestLifecycleOccurredAt: latestCanonicalOccurredAt,
            cycleId: batchStatus.batchId,
            batchStatus: batchStatus.status,
          });

          for (const row of incrementalRows) {
            await activityEventRepository.appendVaultLifecycleEvent(row);
          }
        }
      } catch (seedError) {
        logger.warn("CustomVault API: Failed to seed canonical lifecycle events", {
          vaultId,
          vaultAddress,
          error: (seedError as Error).message,
        });
      }

      const canonicalEventsAfterSeed = await activityEventRepository.listVaultLifecycleEvents(
        vaultAddress,
        limit + 1,
        offset,
      );
      const canonicalMode = hasCanonicalEvents || canonicalEventsAfterSeed.length > 0;

      if (canonicalMode) {
        const hasMore = canonicalEventsAfterSeed.length > limit;
        const pagedItems = canonicalEventsAfterSeed.slice(0, limit).map(mapCanonicalVaultEvent);
        res.json({
          success: true,
          vaultId,
          items: pagedItems,
          pagination: {
            limit,
            offset,
            hasMore,
          },
        });
        return;
      }

      const { db } = await import("../db/index.js");
      const fallbackWindow = offset + limit + 1;

      const [cycles, processingEvents] = await Promise.all([
        db
          .select()
          .from(flatBookCycles)
          .where(eq(flatBookCycles.vaultAddress, vaultAddress))
          .orderBy(desc(flatBookCycles.openedAt))
          .limit(fallbackWindow),
        db
          .select()
          .from(flatBookProcessingEvents)
          .where(eq(flatBookProcessingEvents.vaultAddress, vaultAddress))
          .orderBy(desc(flatBookProcessingEvents.createdAt))
          .limit(fallbackWindow),
      ]);

      const processingSignatures = new Set(
        processingEvents.map((event) => `${event.cycleId}:${event.eventType}`),
      );

      const cycleItems = cycles.flatMap((cycle) =>
        buildCycleStateItem(cycle, processingSignatures),
      );
      const processingItems: ActivityFeedItem[] = processingEvents.map((event) => {
        const normalized = buildVaultEventTitle(event.eventType);
        return {
          id: `processing-${event.id}`,
          type: event.eventType,
          scope: "vault",
          title: normalized.title,
          detail: normalized.detail,
          occurredAt: event.createdAt.toISOString(),
          cycleId: event.cycleId,
          txHash: event.txHash,
          metadata: parseMetadata(event.metadata),
        };
      });

      const fallbackItems = [...cycleItems, ...processingItems]
        .sort(
          (left, right) =>
            new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
        )
        .slice(offset, offset + limit + 1);

      const hasMore = fallbackItems.length > limit;
      const pagedFallbackItems = fallbackItems.slice(0, limit);

      res.json({
        success: true,
        vaultId,
        items: pagedFallbackItems,
        pagination: {
          limit,
          offset,
          hasMore,
        },
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get vault events", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get vault events",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/history", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;
      const limit = parsePositiveIntQuery(req.query.limit, 100, 200);
      const offset = parseNonNegativeIntQuery(req.query.offset, 0, 2000);

      if (Number.isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({ error: `Custom vault ${vaultId} not found` });
        return;
      }

      const { db } = await import("../db/index.js");
      const vaultAddress = provider.config.vaultAddress;
      const windowSize = offset + limit + 1;
      const canonicalHistory = await activityEventRepository.listUserVaultActivityEvents(
        vaultAddress,
        userAddress,
        windowSize,
        0,
      );

      const [queueParticipants, withdrawHistory, epochHistory, providerState] = await Promise.all([
        db
          .select()
          .from(flatBookQueueParticipants)
          .where(
            and(
              eq(flatBookQueueParticipants.vaultAddress, vaultAddress),
              eq(flatBookQueueParticipants.userAddress, userAddress),
            ),
          )
          .orderBy(desc(flatBookQueueParticipants.firstQueuedAt))
          .limit(windowSize),
        db
          .select()
          .from(withdrawalRequests)
          .where(
            and(
              eq(withdrawalRequests.vaultAddress, vaultAddress),
              eq(withdrawalRequests.userAddress, userAddress),
            ),
          )
          .orderBy(desc(withdrawalRequests.requestedAt))
          .limit(windowSize),
        db
          .select()
          .from(epochRequests)
          .where(
            and(
              eq(epochRequests.vaultAddress, vaultAddress),
              eq(epochRequests.userAddress, userAddress),
            ),
          )
          .orderBy(desc(epochRequests.createdAt))
          .limit(windowSize),
        provider.getUserRedemptionState(userAddress),
      ]);

      const fallbackItems = [
        ...queueParticipants.flatMap(buildUserQueueActivity),
        ...withdrawHistory.map(buildWithdrawalHistoryItem),
        ...epochHistory.map(buildEpochRequestHistoryItem),
        ...providerState.pendingRequests.map(buildProviderRedemptionHistoryItem),
        ...providerState.claimableRequests.map(buildProviderRedemptionHistoryItem),
      ]
        .filter((item, index, array) => {
          const key = `${item.type}:${item.requestId ?? "-"}:${item.cycleId ?? "-"}:${item.occurredAt}`;
          return (
            array.findIndex((candidate) => {
              const candidateKey = `${candidate.type}:${candidate.requestId ?? "-"}:${candidate.cycleId ?? "-"}:${candidate.occurredAt}`;
              return candidateKey === key;
            }) === index
          );
        })
        .sort(
          (left, right) =>
            new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
        );

      const items = [...canonicalHistory.map(mapCanonicalUserEvent), ...fallbackItems]
        .filter((item, index, array) => {
          const key = `${item.type}:${item.requestId ?? "-"}:${item.cycleId ?? "-"}:${item.occurredAt}`;
          return (
            array.findIndex((candidate) => {
              const candidateKey = `${candidate.type}:${candidate.requestId ?? "-"}:${candidate.cycleId ?? "-"}:${candidate.occurredAt}`;
              return candidateKey === key;
            }) === index
          );
        })
        .sort(
          (left, right) =>
            new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
        )
        .slice(offset, offset + limit + 1);

      const hasMore = items.length > limit;
      const pagedItems = items.slice(0, limit);

      res.json({
        success: true,
        vaultId,
        userAddress,
        items: pagedItems,
        pagination: {
          limit,
          offset,
          hasMore,
        },
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get user history", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get user history",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/redemptions", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const state = await provider.getUserRedemptionState(userAddress);

      const formattedPending = await Promise.all(
        state.pendingRequests.map((req) => formatRedemptionRequest(req)),
      );
      const formattedClaimable = await Promise.all(
        state.claimableRequests.map((req) => formatRedemptionRequest(req)),
      );

      res.json({
        success: true,
        vaultId,
        userAddress,
        requests: [...formattedPending, ...formattedClaimable],
        pendingRequests: formattedPending,
        claimableRequests: formattedClaimable,
        totalPendingShares: state.totalSharesPending.toString(),
        totalClaimableShares: state.totalSharesClaimable.toString(),
        totalSharesPending: state.totalSharesPending.toString(),
        totalSharesClaimable: state.totalSharesClaimable.toString(),
        estimatedAssetsPending: state.estimatedAssetsPending.toString(),
        estimatedAssetsPendingFormatted: formatUnits(state.estimatedAssetsPending, 6),
        estimatedAssetsClaimable: state.estimatedAssetsClaimable.toString(),
        estimatedAssetsClaimableFormatted: formatUnits(state.estimatedAssetsClaimable, 6),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get user redemption state", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get redemption state",
        message: (error as Error).message,
      });
    }
  });

  router.get("/:vaultId/info", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const [vaultInfo, capabilities] = await Promise.all([
        provider.getVaultInfo(),
        Promise.resolve(provider.getCapabilities()),
      ]);

      res.json({
        success: true,
        vault: {
          vaultId: vaultInfo.vaultId,
          vaultAddress: vaultInfo.vaultAddress,
          asset: vaultInfo.asset,
          assetDecimals: vaultInfo.assetDecimals,
          shareDecimals: vaultInfo.shareDecimals,
          totalAssets: vaultInfo.totalAssets.toString(),
          totalSupply: vaultInfo.totalSupply.toString(),
          sharePrice: vaultInfo.sharePrice,
          batchInfo: vaultInfo.batchInfo
            ? {
                currentBatchId: vaultInfo.batchInfo.currentBatchId,
                currentBatchStart: vaultInfo.batchInfo.currentBatchStart.toISOString(),
                currentBatchEnd: vaultInfo.batchInfo.currentBatchEnd?.toISOString() ?? null,
                currentBatchStatus: vaultInfo.batchInfo.currentBatchStatus,
                nextBatchId: vaultInfo.batchInfo.nextBatchId,
                nextBatchExists: vaultInfo.batchInfo.nextBatchExists,
                batchDurationSeconds: vaultInfo.batchInfo.batchDurationSeconds,
              }
            : null,
          navLastUpdated: vaultInfo.navLastUpdated.toISOString(),
          navIsStale: vaultInfo.navIsStale,
        },
        capabilities,
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get vault info", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get vault info",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // NEW: Deposit Queue Status Endpoint
  // Returns queued and frozen assets for the user
  // ============================================================================

  router.get("/:vaultId/deposit-queue", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }
      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      const client = provider.getClient();
      const currentEpochId = await client.getCurrentBatch();
      const currentParticipant = await flatBookStateRepository.getQueueParticipant(
        provider.config.vaultAddress,
        Number(currentEpochId),
        userAddress,
      );
      const previousParticipant =
        currentEpochId > 0n
          ? await flatBookStateRepository.getQueueParticipant(
              provider.config.vaultAddress,
              Number(currentEpochId - 1n),
              userAddress,
            )
          : null;

      const [navStatus, epoch, requestIds, depositState] = await Promise.all([
        client.getNAVStatus(),
        client.getBatch(currentEpochId),
        client.getControllerRequestIds(userAddress),
        client.getControllerDepositState(userAddress),
      ]);

      const queuedAssets = depositState.queuedAssets;
      const hasQueuedDeposit = queuedAssets > 0n;
      const hasProcessedDeposit = false;
      const queueStatus = queuedAssets > 0n ? "queued" : "idle";
      const targetCycleId =
        queuedAssets > 0n
          ? (currentParticipant?.cycleId ?? Number(currentEpochId))
          : Number(currentEpochId);
      const estimateNav =
        epoch?.snapshotNAV && epoch.snapshotNAV > 0n ? epoch.snapshotNAV : navStatus.currentNAV;
      const estimatedQueuedShares =
        queuedAssets > 0n
          ? estimateNav > 0n
            ? (queuedAssets * 10n ** 18n) / estimateNav
            : queuedAssets
          : queuedAssets;

      const redemptionRequests = await Promise.all(
        requestIds.map(async (requestId) => client.getRedemptionRequest(requestId)),
      );
      const frozenShares = redemptionRequests.reduce((sum, request) => {
        if (!request || (request.status !== "escrowed" && request.status !== "claimable")) {
          return sum;
        }
        return sum + request.shares;
      }, 0n);
      const frozenAssets = redemptionRequests.reduce((sum, request) => {
        if (!request || (request.status !== "escrowed" && request.status !== "claimable")) {
          return sum;
        }
        return sum + request.assetsClaimable;
      }, 0n);

      const currentCycleStart = epoch
        ? new Date(Number(epoch.startTime) * 1000).toISOString()
        : null;

      res.json({
        success: true,
        vaultId,
        userAddress,
        queued: queuedAssets.toString(),
        queuedFormatted: formatUnits(queuedAssets, 6),
        queuedShares: estimatedQueuedShares.toString(),
        queuedSharesFormatted: formatUnits(estimatedQueuedShares, 6),
        hasQueuedDeposit,
        cycleOpenNavEstimate: estimateNav.toString(),
        cycleOpenNavFormatted: formatUnits(estimateNav, 18),
        estimateBasis:
          epoch?.snapshotNAV && epoch.snapshotNAV > 0n
            ? "Estimated from locked processing NAV for the active cycle."
            : "Estimated from current NAV. Final minted shares use the locked processing NAV when the queue is processed.",
        frozen: frozenAssets.toString(),
        frozenFormatted: formatUnits(frozenAssets, 6),
        frozenShares: frozenShares.toString(),
        frozenSharesFormatted: formatUnits(frozenShares, 6),
        claimableAssets: "0",
        claimableAssetsFormatted: "0",
        claimableShares: "0",
        claimableSharesFormatted: "0",
        hasProcessedDeposit,
        depositRequestId: null,
        depositCreatedAt:
          currentParticipant?.firstQueuedAt?.toISOString() ??
          previousParticipant?.firstQueuedAt?.toISOString() ??
          null,
        targetCycleId,
        currentCycleId: Number(currentEpochId),
        currentCycleStart,
        currentCycleEnd: null,
        nextCycleStart: null,
        activationTime: null,
        batchState: epoch?.status ?? null,
        queueStatus,
        mintRule:
          "Deposits queue while the vault is closed and are minted automatically at the locked NAV when processing begins.",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get deposit queue status", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get deposit queue status",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // NEW: Tranche Status Endpoint
  // Returns tranche progress including realized positions
  // ============================================================================

  router.get("/:vaultId/tranche-status", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      const cycleIdParam = req.query.cycleId as string | undefined;

      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }

      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      let cycleId: number;
      if (cycleIdParam) {
        cycleId = parseInt(cycleIdParam, 10);
        if (isNaN(cycleId)) {
          res.status(400).json({ error: "Invalid cycle ID" });
          return;
        }
      } else {
        const client = provider.getClient();
        cycleId = Number(await client.getCurrentBatch());
      }

      const batchStatus = await provider.getBatchStatus(cycleId);

      const userEntitlements = await entitlementRepository.getByUser(
        userAddress,
        `batch-${cycleId}`,
      );

      // Aggregate entitlement data using CORRECTED lifecycle fields
      let totalEntitlement = 0n;
      let totalAccrued = 0n;
      let totalClaimed = 0n;
      let totalCarryRemaining = 0n;
      let totalClaimable = 0n;

      for (const entitlement of userEntitlements) {
        const entitlementAmount = BigInt(entitlement.entitlement);
        const accrued = BigInt(entitlement.accrued);
        const claimed = BigInt(entitlement.claimed);
        const carryRemaining = BigInt(entitlement.carryRemaining);
        totalEntitlement += entitlementAmount;
        totalAccrued += accrued;
        totalClaimed += claimed;
        totalCarryRemaining += carryRemaining;
        totalClaimable += accrued - claimed;
      }

      // Minimum claim threshold
      const minClaimThreshold = 1000000n;
      const dustOverrideEligible = totalClaimable > 0n && totalClaimable < minClaimThreshold;

      res.json({
        success: true,
        vaultId,
        userAddress,
        cycleId,
        cycleStatus: {
          status: ["settled", "processed", "reopen"].includes(batchStatus.status)
            ? "settled"
            : "pending",
          startTime: batchStatus.startTime.toISOString(),
          endTime: batchStatus.endTime.toISOString(),
          settled: ["settled", "processed", "reopen"].includes(batchStatus.status),
          totalShares: batchStatus.totalSharesPending.toString(),
          totalSharesFormatted: formatUnits(batchStatus.totalSharesPending, 6),
          batchState: batchStatus.status,
        },
        // User's tranche position with corrected lifecycle fields
        tranchePosition: {
          // Total entitlement: total USDC entitled
          entitlement: totalEntitlement.toString(),
          entitlementFormatted: formatUnits(totalEntitlement, 6),
          // Accrued: total realized USDC
          accrued: totalAccrued.toString(),
          accruedFormatted: formatUnits(totalAccrued, 6),
          // Claimed: total USDC already claimed
          claimed: totalClaimed.toString(),
          claimedFormatted: formatUnits(totalClaimed, 6),
          // CarryRemaining: remaining to be carried
          carryRemaining: totalCarryRemaining.toString(),
          carryRemainingFormatted: formatUnits(totalCarryRemaining, 6),
          // ClaimableNow: USDC available to claim
          claimableNow: totalClaimable.toString(),
          claimableNowFormatted: formatUnits(totalClaimable > 0n ? totalClaimable : 0n, 6),
          // Minimum claim threshold
          minClaimThreshold: "1000000",
          minClaimThresholdFormatted: "1.0",
          dustOverrideEligible,
          meetsThreshold: totalClaimable >= minClaimThreshold,
        },
        // Entitlement count
        entitlementCount: userEntitlements.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("CustomVault API: Failed to get tranche status", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get tranche status",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // NEW: Carry Claim Eligibility Endpoint
  // Returns detailed eligibility for carry claims with lifecycle fields
  // ============================================================================

  router.get("/:vaultId/carry-eligibility", requireAuth, async (req, res) => {
    try {
      const vaultIdParam = req.params.vaultId;
      const requestIdParam = req.query.requestId as string | undefined;

      if (!vaultIdParam) {
        res.status(400).json({ error: "Vault ID is required" });
        return;
      }

      const vaultId = parseInt(vaultIdParam, 10);
      const userAddress = req.session!.address as Address;

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const provider = await getCustomVaultProvider(vaultId);
      if (!provider) {
        res.status(404).json({
          error: `Custom vault ${vaultId} not found`,
        });
        return;
      }

      // If requestId provided, get specific eligibility
      if (requestIdParam) {
        const entitlement = await entitlementRepository.getByRequest(requestIdParam);

        if (!entitlement) {
          res.status(404).json({
            error: "Entitlement not found for request",
            requestId: requestIdParam,
          });
          return;
        }

        // Verify ownership
        if (entitlement.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
          res.status(403).json({
            error: "Not authorized to view this entitlement",
          });
          return;
        }

        // Get detailed eligibility using CORRECTED lifecycle fields
        const eligibility = await entitlementRepository.getClaimEligibility(entitlement.id);

        const entitlementAmount = BigInt(entitlement.entitlement);
        const accrued = BigInt(entitlement.accrued);
        const claimed = BigInt(entitlement.claimed);
        const carryRemaining = BigInt(entitlement.carryRemaining);
        const claimableNow = accrued - claimed;

        // Check against minimum threshold (1 USDC)
        const minThreshold = 1000000n;
        const meetsThreshold = claimableNow >= minThreshold;
        const dustOverrideEligible = claimableNow > 0n && claimableNow < minThreshold;

        res.json({
          success: true,
          vaultId,
          userAddress,
          requestId: requestIdParam,
          entitlementId: entitlement.id,
          cycleId: entitlement.epochId,
          // Corrected lifecycle fields per T1 gap matrix
          entitlement: entitlementAmount.toString(),
          entitlementFormatted: formatUnits(entitlementAmount, 6),
          accrued: accrued.toString(),
          accruedFormatted: formatUnits(accrued, 6),
          claimed: claimed.toString(),
          claimedFormatted: formatUnits(claimed, 6),
          carryRemaining: carryRemaining.toString(),
          carryRemainingFormatted: formatUnits(carryRemaining, 6),
          claimableNow: claimableNow.toString(),
          claimableNowFormatted: formatUnits(claimableNow > 0n ? claimableNow : 0n, 6),
          minClaimThreshold: "1000000",
          minClaimThresholdFormatted: "1.0",
          dustOverrideEligible,
          // Eligibility status
          eligible: eligibility.canClaim && meetsThreshold,
          meetsThreshold,
          canClaim: eligibility.canClaim,
          eligibilityError: eligibility.error,
          // Status info
          entitlementStatus: entitlement.status,
          currentClaimState: mapRequestStatusToClaimState(entitlement.status),
          timestamp: new Date().toISOString(),
        });
      } else {
        const allEntitlements = await entitlementRepository.getByUser(userAddress);

        let totalEntitlement = 0n;
        let totalAccrued = 0n;
        let totalClaimed = 0n;
        let totalCarryRemaining = 0n;
        let totalClaimable = 0n;
        let eligibleCount = 0;

        const entitlementDetails = [];

        for (const entitlement of allEntitlements) {
          const eligibility = await entitlementRepository.getClaimEligibility(entitlement.id);
          const entitlementAmount = BigInt(entitlement.entitlement);
          const accrued = BigInt(entitlement.accrued);
          const claimed = BigInt(entitlement.claimed);
          const carryRemaining = BigInt(entitlement.carryRemaining);
          const claimable = accrued - claimed;
          const minThreshold = 1000000n;
          const meetsThreshold = claimable >= minThreshold;
          const dustOverrideEligible = claimable > 0n && claimable < minThreshold;
          const isEligible = eligibility.canClaim && meetsThreshold;

          if (isEligible) eligibleCount++;

          totalEntitlement += entitlementAmount;
          totalAccrued += accrued;
          totalClaimed += claimed;
          totalCarryRemaining += carryRemaining;
          totalClaimable += claimable;

          entitlementDetails.push({
            entitlementId: entitlement.id,
            requestId: entitlement.requestId,
            cycleId: entitlement.epochId,
            entitlement: entitlementAmount.toString(),
            accrued: accrued.toString(),
            claimed: claimed.toString(),
            carryRemaining: carryRemaining.toString(),
            claimableNow: claimable.toString(),
            dustOverrideEligible,
            eligible: isEligible,
            status: entitlement.status,
          });
        }

        // Aggregate dust override eligibility
        const minThreshold = 1000000n;
        const dustOverrideEligible = totalClaimable > 0n && totalClaimable < minThreshold;

        res.json({
          success: true,
          vaultId,
          userAddress,
          // Aggregated lifecycle fields with corrected semantics
          entitlement: totalEntitlement.toString(),
          entitlementFormatted: formatUnits(totalEntitlement, 6),
          accrued: totalAccrued.toString(),
          accruedFormatted: formatUnits(totalAccrued, 6),
          claimed: totalClaimed.toString(),
          claimedFormatted: formatUnits(totalClaimed, 6),
          carryRemaining: totalCarryRemaining.toString(),
          carryRemainingFormatted: formatUnits(totalCarryRemaining, 6),
          claimableNow: totalClaimable.toString(),
          claimableNowFormatted: formatUnits(totalClaimable > 0n ? totalClaimable : 0n, 6),
          minClaimThreshold: "1000000",
          minClaimThresholdFormatted: "1.0",
          dustOverrideEligible,
          meetsThreshold: totalClaimable >= minThreshold,
          // Eligibility summary
          totalEntitlements: allEntitlements.length,
          eligibleCount,
          hasEligibleClaims: eligibleCount > 0,
          // Individual entitlement details
          entitlements: entitlementDetails,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error("CustomVault API: Failed to get carry eligibility", {
        error: (error as Error).message,
        vaultId: req.params.vaultId,
      });
      res.status(500).json({
        error: "Failed to get carry eligibility",
        message: (error as Error).message,
      });
    }
  });

  // ============================================================================
  // LEGACY DEPRECATION: Explicit error for deprecated endpoints
  // ============================================================================

  router.post("/:vaultId/legacy-claim", requireAuth, async (_req, res) => {
    res.status(410).json({
      error: "Gone",
      message:
        "This endpoint has been deprecated. Use POST /api/vaults/:vaultId/requests/:requestId/claim instead.",
      deprecated: true,
      replacementEndpoint: "/api/vaults/:vaultId/requests/:requestId/claim",
      documentation: "See API docs for new claim flow with lifecycle fields",
    });
  });

  router.get("/:vaultId/legacy-status", async (_req, res) => {
    res.status(410).json({
      error: "Gone",
      message:
        "This endpoint has been deprecated. Use GET /api/vaults/:vaultId/redemptions instead.",
      deprecated: true,
      replacementEndpoint: "/api/vaults/:vaultId/redemptions",
      documentation: "See API docs for new redemption state with lifecycle fields",
    });
  });

  return router;
}
