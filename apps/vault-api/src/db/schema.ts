/**
 * Vault Database Schema (Drizzle ORM)
 *
 * Shared pool vault tables for Morpho integration:
 * - vault_config: Vault deployment configuration
 * - vault_positions: Open and resolved positions
 * - vault_nav_history: Historical NAV snapshots
 * - vault_allocations: Fund allocate/deallocate events
 * - vault_trades: Individual trade execution records
 */

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enum: Position status
export const positionStatusEnum = pgEnum("position_status", [
  "open",
  "resolved_win",
  "resolved_loss",
]);

// Enum: Outcome (YES/NO)
export const outcomeEnum = pgEnum("outcome", ["YES", "NO"]);

// Enum: Allocation direction
export const allocationDirectionEnum = pgEnum("allocation_direction", ["allocate", "deallocate"]);

// Enum: Trade side
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);

// Enum: Trade status
export const tradeStatusEnum = pgEnum("trade_status", [
  "pending",
  "filled",
  "partially_filled",
  "cancelled",
  "failed",
]);

// Enum: Withdrawal request status
export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending", // Legacy Morpho: request pending
  "ready", // Legacy Morpho: ready for claim
  "completed", // Legacy Morpho: claim completed
  "cancelled", // Legacy Morpho: request cancelled
  "expired", // Legacy Morpho: request expired
  // Closed-book batch states (truthful semantics for custom vaults)
  "open", // Batch accepting requests (cancellable)
  "cutoff", // Batch sealed, no more requests
  "flattening", // Positions being flattened
  "settling", // Calculating entitlements
  "settled", // Ready for claims
  "claimed", // User has claimed assets
  "closed", // Batch complete
]);

/**
 * vault_config - Vault deployment configuration
 * Stores immutable deployment details for the vault
 */
export const vaultConfig = pgTable("vault_config", {
  id: serial("id").primaryKey(),
  vaultAddress: text("vault_address").notNull().unique(),
  adapterAddress: text("adapter_address").notNull(),
  safeAddress: text("safe_address").notNull(),
  asset: text("asset").notNull().default("USDC.e"), // Token symbol
  deploymentBlock: integer("deployment_block").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * vault_positions - Position tracking (open and resolved)
 * One row per position: tracks lifecycle from open → resolution
 */
export const vaultPositions = pgTable(
  "vault_positions",
  {
    id: serial("id").primaryKey(),
    positionId: text("position_id").notNull().unique(),
    vaultAddress: text("vault_address"),
    marketId: text("market_id").notNull(),
    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    outcome: outcomeEnum("outcome").notNull(),
    costBasis: numeric("cost_basis", { precision: 20, scale: 6 }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    status: positionStatusEnum("status").notNull().default("open"),
    resolvedPnl: numeric("resolved_pnl", { precision: 20, scale: 6 }), // Profit/loss at resolution
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }), // NULL until resolved
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("vault_positions_vault_idx").on(table.vaultAddress),
    statusIdx: index("vault_positions_status_idx").on(table.status),
    marketIdx: index("vault_positions_market_idx").on(table.marketId),
    tokenIdx: index("vault_positions_token_idx").on(table.tokenId),
    openedIdx: index("vault_positions_opened_idx").on(table.openedAt),
  }),
);

export const vaultTradingAnalytics = pgTable(
  "vault_trading_analytics",
  {
    id: serial("id").primaryKey(),
    vaultAddress: text("vault_address").notNull().unique(),
    positionCount: integer("position_count").notNull().default(0),
    winCount: integer("win_count").notNull().default(0),
    lossCount: integer("loss_count").notNull().default(0),
    winRate: numeric("win_rate", { precision: 10, scale: 6 }).notNull().default("0"),
    totalPnl: numeric("total_pnl", { precision: 20, scale: 6 }).notNull().default("0"),
    avgPnlPerPosition: numeric("avg_pnl_per_position", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("vault_trading_analytics_vault_idx").on(table.vaultAddress),
    computedIdx: index("vault_trading_analytics_computed_idx").on(table.computedAt),
  }),
);

export const vaultResolvedAnalyticsPositions = pgTable(
  "vault_resolved_analytics_positions",
  {
    id: serial("id").primaryKey(),
    network: text("network").notNull(),
    vaultAddress: text("vault_address").notNull(),
    walletAddress: text("wallet_address").notNull(),
    tokenId: text("token_id").notNull(),
    conditionId: text("condition_id").notNull(),
    eventSlug: text("event_slug"),
    marketSlug: text("market_slug"),
    marketQuestion: text("market_question"),
    outcome: text("outcome"),
    entryPrice: numeric("entry_price", { precision: 10, scale: 6 }),
    cost: numeric("cost", { precision: 14, scale: 4 }),
    size: numeric("size", { precision: 18, scale: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    marketEndDate: timestamp("market_end_date", { withTimezone: true }),
    finalPrice: numeric("final_price", { precision: 10, scale: 6 }),
    profitLoss: numeric("profit_loss", { precision: 14, scale: 4 }),
    result: text("result"),
    maxDrawdownPercent: numeric("max_drawdown_percent", { precision: 10, scale: 4 }),
    lowestPrice: numeric("lowest_price", { precision: 10, scale: 6 }),
    highestPrice: numeric("highest_price", { precision: 10, scale: 6 }),
    priceHistory: jsonb("price_history"),
    oppositeOutcomePriceHistory: jsonb("opposite_outcome_price_history"),
    stopLossSimulations: jsonb("stop_loss_simulations"),
    hedgingSimulations: jsonb("hedging_simulations"),
    category: text("category"),
    tags: jsonb("tags"),
    fidelityMinutes: numeric("fidelity_minutes", { precision: 4, scale: 0 }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultTokenUnique: uniqueIndex("vault_resolved_analytics_positions_unique").on(
      table.network,
      table.vaultAddress,
      table.tokenId,
    ),
    vaultIdx: index("vault_resolved_analytics_positions_vault_idx").on(
      table.network,
      table.vaultAddress,
    ),
    walletIdx: index("vault_resolved_analytics_positions_wallet_idx").on(table.walletAddress),
    resolvedAtIdx: index("vault_resolved_analytics_positions_resolved_at_idx").on(table.resolvedAt),
  }),
);

export type VaultResolvedAnalyticsPosition = typeof vaultResolvedAnalyticsPositions.$inferSelect;
export type NewVaultResolvedAnalyticsPosition = typeof vaultResolvedAnalyticsPositions.$inferInsert;

export const vaultDetailedAnalytics = pgTable(
  "vault_detailed_analytics",
  {
    id: serial("id").primaryKey(),
    network: text("network").notNull(),
    vaultAddress: text("vault_address").notNull(),
    walletAddress: text("wallet_address").notNull(),
    totalPnl: numeric("total_pnl", { precision: 14, scale: 4 }),
    totalCost: numeric("total_cost", { precision: 14, scale: 4 }),
    winCount: numeric("win_count", { precision: 10, scale: 0 }),
    lossCount: numeric("loss_count", { precision: 10, scale: 0 }),
    winRate: numeric("win_rate", { precision: 6, scale: 4 }),
    avgEntryPrice: numeric("avg_entry_price", { precision: 10, scale: 6 }),
    avgPnlPerPosition: numeric("avg_pnl_per_position", { precision: 14, scale: 4 }),
    avgHoldingHours: numeric("avg_holding_hours", { precision: 10, scale: 2 }),
    stopLossAnalysis: jsonb("stop_loss_analysis"),
    hedgingAnalysis: jsonb("hedging_analysis"),
    categoryBreakdown: jsonb("category_breakdown"),
    dailyPnl: jsonb("daily_pnl"),
    entryTimingAnalysis: jsonb("entry_timing_analysis"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultUnique: uniqueIndex("vault_detailed_analytics_unique").on(
      table.network,
      table.vaultAddress,
    ),
  }),
);

export type VaultDetailedAnalytics = typeof vaultDetailedAnalytics.$inferSelect;
export type NewVaultDetailedAnalytics = typeof vaultDetailedAnalytics.$inferInsert;

export const vaultAnalyticsSyncState = pgTable(
  "vault_analytics_sync_state",
  {
    id: serial("id").primaryKey(),
    network: text("network").notNull(),
    vaultAddress: text("vault_address").notNull(),
    walletAddress: text("wallet_address").notNull(),
    lastActivityTimestamp: bigint("last_activity_timestamp", { mode: "number" }),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    lastAttemptedSyncAt: timestamp("last_attempted_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultUnique: uniqueIndex("vault_analytics_sync_state_unique").on(
      table.network,
      table.vaultAddress,
    ),
    walletIdx: index("vault_analytics_sync_state_wallet_idx").on(table.walletAddress),
  }),
);

export type VaultAnalyticsSyncState = typeof vaultAnalyticsSyncState.$inferSelect;
export type NewVaultAnalyticsSyncState = typeof vaultAnalyticsSyncState.$inferInsert;

/**
 * vault_nav_history - NAV snapshots over time
 * Tracks vault's Net Asset Value at key points (e.g., hourly, daily)
 */
export const vaultNavHistory = pgTable(
  "vault_nav_history",
  {
    id: serial("id").primaryKey(),
    navId: text("nav_id").notNull().unique(),
    vaultAddress: text("vault_address").notNull(),
    totalAssets: numeric("total_assets", { precision: 20, scale: 6 }).notNull(),
    idleAssets: numeric("idle_assets", { precision: 20, scale: 6 }).notNull(),
    deployedCostBasis: numeric("deployed_cost_basis", {
      precision: 20,
      scale: 6,
    }).notNull(),
    sharePrice: numeric("share_price", { precision: 20, scale: 8 }).notNull(),
    positionCount: integer("position_count").notNull().default(0),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    timestampIdx: index("vault_nav_history_timestamp_idx").on(table.timestamp),
    navIdIdx: index("vault_nav_history_nav_id_idx").on(table.navId),
    vaultIdx: index("vault_nav_history_vault_idx").on(table.vaultAddress),
  }),
);

/**
 * vault_allocations - Fund allocation/deallocation events
 * Tracks when funds enter (allocate) or exit (deallocate) the vault
 */
export const vaultAllocations = pgTable(
  "vault_allocations",
  {
    id: serial("id").primaryKey(),
    allocationId: text("allocation_id").notNull().unique(),
    txHash: text("tx_hash").notNull(),
    direction: allocationDirectionEnum("direction").notNull(),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    directionalIdx: index("vault_allocations_direction_idx").on(table.direction),
    txHashIdx: index("vault_allocations_tx_hash_idx").on(table.txHash),
    timestampIdx: index("vault_allocations_timestamp_idx").on(table.timestamp),
  }),
);

/**
 * vault_trades - Individual trade execution records
 * One row per fill/order execution; tracks order lifecycle (pending → filled/cancelled)
 */
export const vaultTrades = pgTable(
  "vault_trades",
  {
    id: serial("id").primaryKey(),
    tradeId: text("trade_id").notNull().unique(),
    positionId: integer("position_id")
      .notNull()
      .references(() => vaultPositions.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    side: tradeSideEnum("side").notNull(),
    price: numeric("price", { precision: 10, scale: 6 }).notNull(),
    size: numeric("size", { precision: 20, scale: 6 }).notNull(),
    filledSize: numeric("filled_size", { precision: 20, scale: 6 }).notNull(),
    status: tradeStatusEnum("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    positionIdx: index("vault_trades_position_idx").on(table.positionId),
    orderIdx: index("vault_trades_order_idx").on(table.orderId),
    statusIdx: index("vault_trades_status_idx").on(table.status),
    sideIdx: index("vault_trades_side_idx").on(table.side),
    timestampIdx: index("vault_trades_timestamp_idx").on(table.timestamp),
  }),
);

/**
 * withdrawal_requests — FIFO withdrawal queue
 * Users who cannot instantly redeem are queued here.
 * Worker processes queue, deallocates from Safe when needed,
 * and marks requests "ready" when vault has enough liquidity.
 *
 * CLOSED-BOOK BATCH SEMANTICS:
 * - For legacy Morpho vaults: uses pending/ready/completed flow
 * - For custom closed-book vaults: uses open/cutoff/flattening/settling/settled/claimed flow
 * - batchId links withdrawal to a specific settlement batch
 * - onchainRequestId links to the on-chain redemption request
 */

export const withdrawalRequests = pgTable(
  "withdrawal_requests",
  {
    id: serial("id").primaryKey(),
    requestId: text("request_id").notNull().unique(),
    vaultAddress: text("vault_address").notNull(),
    userAddress: text("user_address").notNull(),
    shares: numeric("shares", { precision: 30, scale: 18 }).notNull(),
    assetsEstimated: numeric("assets_estimated", { precision: 20, scale: 6 }).notNull(),
    estimateHistory: text("estimate_history"), // JSON array of EstimateUpdate entries (legacy)
    status: withdrawalStatusEnum("status").notNull().default("pending"),
    // Closed-book batch vault fields (for sealed processing)
    withdrawalType: text("withdrawal_type").default("instant"), // "instant" | "batch"
    batchId: text("batch_id"), // References batch/epoch for closed-book vaults
    onchainRequestId: text("onchain_request_id"), // On-chain request ID from custom vault
    // Timestamps
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("withdrawal_requests_status_idx").on(table.status),
    vaultIdx: index("withdrawal_requests_vault_idx").on(table.vaultAddress),
    userIdx: index("withdrawal_requests_user_idx").on(table.userAddress),
    requestedIdx: index("withdrawal_requests_requested_idx").on(table.requestedAt),
  }),
);

// ============================================================================
// Cohort-Carry (Tranche-Based) Epoch Vault Schema
// ============================================================================

// Enum: Epoch status - Cohort-Carry Lifecycle
export const epochStatusEnum = pgEnum("epoch_status", [
  "pending", // Epoch is open for redemption requests
  "frozen", // Epoch frozen, positions snapshotted
  "claimable", // Realizations complete, claims available
  "closed", // All claims settled, epoch complete
  "cancelled", // Epoch was cancelled (emergency)
]);

// Enum: Epoch request status - Cohort-Carry Lifecycle
export const epochRequestStatusEnum = pgEnum("epoch_request_status", [
  "pending", // Request created, awaiting epoch freeze
  "frozen", // Epoch frozen, entitlement locked
  "claimable", // Realizations complete, ready to claim
  "claimed", // User has claimed assets
  "closed", // All claims settled, request complete
  "cancelled", // Request cancelled before settlement
]);

/**
 * epochs - Weekly epoch tracking for redemption windows
 * Each epoch represents a 7-day redemption window with deterministic settlement
 */
export const epochs = pgTable(
  "epochs",
  {
    id: serial("id").primaryKey(),
    epochId: text("epoch_id").notNull().unique(), // On-chain epoch identifier (e.g., "epoch-1735689600")
    vaultAddress: text("vault_address").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    status: epochStatusEnum("status").notNull().default("pending"),
    navSnapshotId: integer("nav_snapshot_id").references(() => navSnapshots.id, {
      onDelete: "set null",
    }),
    frozenAt: timestamp("frozen_at", { withTimezone: true }), // When epoch was frozen
    claimableAt: timestamp("claimable_at", { withTimezone: true }), // When became claimable
    closedAt: timestamp("closed_at", { withTimezone: true }), // When all claims settled
    totalSharesRequested: numeric("total_shares_requested", { precision: 30, scale: 18 })
      .notNull()
      .default("0"),
    totalAssetsToClaim: numeric("total_assets_to_claim", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    proRataRatio: numeric("pro_rata_ratio", { precision: 20, scale: 18 }), // 1.0 = full redemption, <1.0 = pro-rata
    settlementTxHash: text("settlement_tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    epochIdIdx: index("epochs_epoch_id_idx").on(table.epochId),
    vaultIdx: index("epochs_vault_idx").on(table.vaultAddress),
    statusIdx: index("epochs_status_idx").on(table.status),
    timeRangeIdx: index("epochs_time_range_idx").on(table.startTime, table.endTime),
  }),
);

/**
 * epoch_requests - Individual redemption requests within an epoch
 * Tracks user redemption requests from creation through claim
 */
export const epochRequests = pgTable(
  "epoch_requests",
  {
    id: serial("id").primaryKey(),
    requestId: text("request_id").notNull().unique(), // On-chain request ID
    userAddress: text("user_address").notNull(),
    // ERC-7540 controller/owner/operator fields
    controller: text("controller"), // Controller address (defaults to user)
    owner: text("owner"), // Owner address (defaults to user)
    operator: text("operator"), // Authorized operator address
    vaultAddress: text("vault_address").notNull(),
    shares: numeric("shares", { precision: 30, scale: 18 }).notNull(),
    epochId: text("epoch_id").notNull(),
    status: epochRequestStatusEnum("status").notNull().default("pending"),
    // Settlement values computed at epoch settlement
    claimableAssets: numeric("claimable_assets", { precision: 20, scale: 6 }),
    claimedAssets: numeric("claimed_assets", { precision: 20, scale: 6 }).default("0"),
    claimTxHash: text("claim_tx_hash"),
    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    frozenAt: timestamp("frozen_at", { withTimezone: true }), // When request was frozen
    claimableAt: timestamp("claimable_at", { withTimezone: true }), // When became claimable
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }), // When all claims settled
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    requestIdIdx: index("epoch_requests_request_id_idx").on(table.requestId),
    userIdx: index("epoch_requests_user_idx").on(table.userAddress),
    epochIdx: index("epoch_requests_epoch_idx").on(table.epochId),
    userEpochIdx: index("epoch_requests_user_epoch_idx").on(table.userAddress, table.epochId),
    statusIdx: index("epoch_requests_status_idx").on(table.status),
    vaultIdx: index("epoch_requests_vault_idx").on(table.vaultAddress),
  }),
);

/**
 * nav_snapshots - NAV snapshots at epoch settlement boundaries
 * Records the vault's NAV at the time of epoch settlement for claim calculations
 */
export const navSnapshots = pgTable(
  "nav_snapshots",
  {
    id: serial("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull().unique(), // Unique identifier for this snapshot
    epochId: text("epoch_id").notNull(), // Associated epoch
    vaultAddress: text("vault_address").notNull(),
    // NAV values at snapshot time
    totalAssets: numeric("total_assets", { precision: 20, scale: 6 }).notNull(),
    totalShares: numeric("total_shares", { precision: 30, scale: 18 }).notNull(),
    sharePrice: numeric("share_price", { precision: 20, scale: 8 }).notNull(),
    // Metadata
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    recordedBy: text("recorded_by").notNull(), // Address/identifier of the NAV updater
    txHash: text("tx_hash"), // On-chain transaction hash if applicable
    isFresh: boolean("is_fresh").notNull().default(true), // NAV within freshness threshold
    staleReason: text("stale_reason"), // Reason if NAV is marked stale
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    snapshotIdIdx: index("nav_snapshots_snapshot_id_idx").on(table.snapshotId),
    epochIdx: index("nav_snapshots_epoch_idx").on(table.epochId),
    vaultIdx: index("nav_snapshots_vault_idx").on(table.vaultAddress),
    timestampIdx: index("nav_snapshots_timestamp_idx").on(table.timestamp),
  }),
);

// ============================================================================
// Snapshot-Tranche Vault Schema (Cohort-Carry Progressive Payout)
// ============================================================================

// Enum: Snapshot position status
export const snapshotPositionStatusEnum = pgEnum("snapshot_position_status", [
  "frozen", // Position frozen at epoch close
  "realized", // Position has been realized (won/lost)
  "timed_out", // Position force-closed due to timeout
  "cancelled", // Position cancelled/invalidated
]);

// Enum: Entitlement status - Cohort-Carry Lifecycle
export const entitlementStatusEnum = pgEnum("entitlement_status", [
  "pending", // Entitlement calculated, awaiting realizations
  "frozen", // Epoch frozen, entitlement locked
  "claimable", // Some payouts available for claiming
  "partially_fulfilled", // Some claims processed
  "fully_fulfilled", // All payouts distributed up to entitlement cap
  "closed", // Entitlement closed after all claims
  "cancelled", // Entitlement cancelled
]);

// Enum: Realization outcome
export const realizationOutcomeEnum = pgEnum("realization_outcome", [
  "win", // Position resolved as win
  "loss", // Position resolved as loss
  "force_close", // Force-closed due to timeout
]);

// Enum: Payout distribution status
export const payoutStatusEnum = pgEnum("payout_status", [
  "pending", // Distribution pending
  "distributed", // Distribution recorded
  "claimed", // User has claimed
  "failed", // Distribution failed
]);

/**
 * epoch_position_snapshots - Frozen position snapshots at epoch close
 * Immutable record of all positions at the time of epoch settlement
 */
export const epochPositionSnapshots = pgTable(
  "epoch_position_snapshots",
  {
    id: serial("id").primaryKey(),
    epochId: text("epoch_id").notNull(),
    positionId: text("position_id").notNull(), // Reference to original position
    tokenId: text("token_id").notNull(),
    conditionId: text("condition_id").notNull(),
    marketId: text("market_id").notNull(),
    outcome: outcomeEnum("outcome").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    costBasis: numeric("cost_basis", { precision: 20, scale: 6 }).notNull(),
    estimatedValue: numeric("estimated_value", { precision: 20, scale: 6 }), // NAV estimated value at snapshot
    statusAtSnapshot: snapshotPositionStatusEnum("status_at_snapshot").notNull().default("frozen"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    epochIdx: index("epoch_position_snapshots_epoch_idx").on(table.epochId),
    positionIdx: index("epoch_position_snapshots_position_idx").on(table.positionId),
    tokenIdx: index("epoch_position_snapshots_token_idx").on(table.tokenId),
    marketIdx: index("epoch_position_snapshots_market_idx").on(table.marketId),
    statusIdx: index("epoch_position_snapshots_status_idx").on(table.statusAtSnapshot),
    uniqueEpochPosition: index("epoch_position_snapshots_unique_ep_idx").on(
      table.epochId,
      table.positionId,
    ),
  }),
);

/**
 * epoch_redemption_entitlements - User redemption entitlements per epoch
 * Immutable entitlement ratio calculated at epoch settlement with cohort-carry tracking
 */
export const epochRedemptionEntitlements = pgTable(
  "epoch_redemption_entitlements",
  {
    id: serial("id").primaryKey(),
    epochId: text("epoch_id").notNull(),
    trancheId: text("tranche_id"), // Cohort tranche identifier for progressive payout
    requestId: text("request_id").notNull().unique(), // Original redemption request ID
    userAddress: text("user_address").notNull(),
    sharesSubmitted: numeric("shares_submitted", { precision: 30, scale: 18 }).notNull(),
    totalEpochShares: numeric("total_epoch_shares", { precision: 30, scale: 18 }).notNull(),
    entitlementRatio: numeric("entitlement_ratio", { precision: 38, scale: 18 }).notNull(), // 0.0 to 1.0
    // Cohort-carry lifecycle fields
    entitlement: numeric("entitlement", { precision: 20, scale: 6 }).notNull().default("0"), // Total entitled amount
    accrued: numeric("accrued", { precision: 20, scale: 6 }).notNull().default("0"), // Amount accrued from realizations
    claimed: numeric("claimed", { precision: 20, scale: 6 }).notNull().default("0"), // Amount claimed by user
    carryRemaining: numeric("carry_remaining", { precision: 20, scale: 6 }).notNull().default("0"), // Remaining to be carried
    status: entitlementStatusEnum("status").notNull().default("pending"),
    // Legacy fields (maintained for backward compatibility during migration)
    totalRealizedUsdc: numeric("total_realized_usdc", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    totalClaimedUsdc: numeric("total_claimed_usdc", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    epochIdx: index("epoch_redemption_entitlements_epoch_idx").on(table.epochId),
    trancheIdx: index("epoch_redemption_entitlements_tranche_idx").on(table.trancheId),
    userIdx: index("epoch_redemption_entitlements_user_idx").on(table.userAddress),
    requestIdx: index("epoch_redemption_entitlements_request_idx").on(table.requestId),
    statusIdx: index("epoch_redemption_entitlements_status_idx").on(table.status),
    uniqueEpochUserRequest: index("epoch_redemption_entitlements_unique_eur_idx").on(
      table.epochId,
      table.userAddress,
      table.requestId,
    ),
  }),
);

/**
 * position_realization_events - Events when frozen positions realize value
 * Records gross proceeds from resolved positions
 */
export const positionRealizationEvents = pgTable(
  "position_realization_events",
  {
    id: serial("id").primaryKey(),
    epochId: text("epoch_id").notNull(),
    trancheId: text("tranche_id"), // Cohort tranche this realization belongs to
    positionSnapshotId: integer("position_snapshot_id")
      .notNull()
      .references(() => epochPositionSnapshots.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull(),
    realizedOutcome: realizationOutcomeEnum("realized_outcome").notNull(),
    grossProceeds: numeric("gross_proceeds", { precision: 20, scale: 6 }).notNull(), // Total USDC realized
    feeDeducted: numeric("fee_deducted", { precision: 20, scale: 6 }).notNull().default("0"),
    netProceeds: numeric("net_proceeds", { precision: 20, scale: 6 }).notNull(),
    realizedAt: timestamp("realized_at", { withTimezone: true }).notNull(),
    txHash: text("tx_hash"), // On-chain transaction hash
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    epochIdx: index("position_realization_events_epoch_idx").on(table.epochId),
    trancheIdx: index("position_realization_events_tranche_idx").on(table.trancheId),
    snapshotIdx: index("position_realization_events_snapshot_idx").on(table.positionSnapshotId),
    tokenIdx: index("position_realization_events_token_idx").on(table.tokenId),
    realizedAtIdx: index("position_realization_events_realized_at_idx").on(table.realizedAt),
    uniqueEpochSnapshot: index("position_realization_events_unique_es_idx").on(
      table.epochId,
      table.positionSnapshotId,
    ),
  }),
);

/**
 * realized_payout_distributions - Individual payout distributions to users
 * Records each distribution increment from realization events with cohort-carry tracking
 */
export const realizedPayoutDistributions = pgTable(
  "realized_payout_distributions",
  {
    id: serial("id").primaryKey(),
    epochId: text("epoch_id").notNull(),
    trancheId: text("tranche_id"), // Cohort tranche this payout belongs to
    entitlementId: integer("entitlement_id")
      .notNull()
      .references(() => epochRedemptionEntitlements.id, { onDelete: "cascade" }),
    realizationEventId: integer("realization_event_id")
      .notNull()
      .references(() => positionRealizationEvents.id, { onDelete: "cascade" }),
    userAddress: text("user_address").notNull(),
    grossAmount: numeric("gross_amount", { precision: 20, scale: 6 }).notNull(),
    feeDeduction: numeric("fee_deduction", { precision: 20, scale: 6 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 20, scale: 6 }).notNull(),
    // Cohort-carry fields
    entitlementAmount: numeric("entitlement_amount", { precision: 20, scale: 6 })
      .notNull()
      .default("0"), // Amount entitled at distribution
    carryForward: numeric("carry_forward", { precision: 20, scale: 6 }).notNull().default("0"), // Amount carried to next tranche
    status: payoutStatusEnum("status").notNull().default("pending"),
    distributedAt: timestamp("distributed_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    epochIdx: index("realized_payout_distributions_epoch_idx").on(table.epochId),
    trancheIdx: index("realized_payout_distributions_tranche_idx").on(table.trancheId),
    entitlementIdx: index("realized_payout_distributions_entitlement_idx").on(table.entitlementId),
    realizationIdx: index("realized_payout_distributions_realization_idx").on(
      table.realizationEventId,
    ),
    userIdx: index("realized_payout_distributions_user_idx").on(table.userAddress),
    statusIdx: index("realized_payout_distributions_status_idx").on(table.status),
    uniqueEntitlementRealization: index("realized_payout_distributions_unique_er_idx").on(
      table.entitlementId,
      table.realizationEventId,
    ),
  }),
);

export const flatBookCycleStateEnum = pgEnum("flat_book_cycle_state", [
  "open",
  "closed",
  "processing",
  "processed",
]);

export const flatBookParticipantStatusEnum = pgEnum("flat_book_participant_status", [
  "queued",
  "processed",
  "cancelled",
]);

export const flatBookEventTypeEnum = pgEnum("flat_book_event_type", [
  "close_book",
  "begin_processing",
  "process_redeems_chunk",
  "process_deposits_chunk",
  "finalize_processing",
  "nav_update",
  "capital_allocation",
]);

export const flatBookCycles = pgTable(
  "flat_book_cycles",
  {
    id: serial("id").primaryKey(),
    vaultAddress: text("vault_address").notNull(),
    cycleId: integer("cycle_id").notNull(),
    state: flatBookCycleStateEnum("state").notNull().default("open"),
    lockedNav: numeric("locked_nav", { precision: 38, scale: 18 }),
    totalQueuedDepositAssets: numeric("total_queued_deposit_assets", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("0"),
    totalQueuedRedeemShares: numeric("total_queued_redeem_shares", {
      precision: 30,
      scale: 18,
    })
      .notNull()
      .default("0"),
    totalQueuedRedeemAssets: numeric("total_queued_redeem_assets", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("0"),
    queuedDepositParticipants: integer("queued_deposit_participants").notNull().default(0),
    queuedRedeemParticipants: integer("queued_redeem_participants").notNull().default(0),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("flat_book_cycles_vault_idx").on(table.vaultAddress),
    stateIdx: index("flat_book_cycles_state_idx").on(table.state),
    processedAtIdx: index("flat_book_cycles_processed_at_idx").on(table.processedAt),
    uniqueVaultCycle: index("flat_book_cycles_unique_vault_cycle_idx").on(
      table.vaultAddress,
      table.cycleId,
    ),
  }),
);

export const flatBookQueueParticipants = pgTable(
  "flat_book_queue_participants",
  {
    id: serial("id").primaryKey(),
    vaultAddress: text("vault_address").notNull(),
    cycleId: integer("cycle_id").notNull(),
    userAddress: text("user_address").notNull(),
    queuedDepositAssets: numeric("queued_deposit_assets", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("0"),
    queuedRedeemShares: numeric("queued_redeem_shares", {
      precision: 30,
      scale: 18,
    })
      .notNull()
      .default("0"),
    processedDepositShares: numeric("processed_deposit_shares", {
      precision: 30,
      scale: 18,
    })
      .notNull()
      .default("0"),
    processedRedeemAssets: numeric("processed_redeem_assets", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("0"),
    status: flatBookParticipantStatusEnum("status").notNull().default("queued"),
    firstQueuedAt: timestamp("first_queued_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultCycleIdx: index("flat_book_queue_participants_vault_cycle_idx").on(
      table.vaultAddress,
      table.cycleId,
    ),
    userIdx: index("flat_book_queue_participants_user_idx").on(table.userAddress),
    statusIdx: index("flat_book_queue_participants_status_idx").on(table.status),
    uniqueVaultCycleUser: index("flat_book_queue_participants_unique_vcu_idx").on(
      table.vaultAddress,
      table.cycleId,
      table.userAddress,
    ),
  }),
);

export const flatBookProcessingEvents = pgTable(
  "flat_book_processing_events",
  {
    id: serial("id").primaryKey(),
    vaultAddress: text("vault_address").notNull(),
    cycleId: integer("cycle_id").notNull(),
    eventType: flatBookEventTypeEnum("event_type").notNull(),
    txHash: text("tx_hash"),
    blockNumber: bigint("block_number", { mode: "number" }),
    processedCount: integer("processed_count"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultCycleIdx: index("flat_book_processing_events_vault_cycle_idx").on(
      table.vaultAddress,
      table.cycleId,
    ),
    eventTypeIdx: index("flat_book_processing_events_event_type_idx").on(table.eventType),
    createdAtIdx: index("flat_book_processing_events_created_at_idx").on(table.createdAt),
  }),
);

export const vaultLifecycleEvents = pgTable(
  "vault_lifecycle_events",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id").notNull(),
    vaultAddress: text("vault_address").notNull(),
    cycleId: integer("cycle_id"),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    status: text("status"),
    requestId: text("request_id"),
    txHash: text("tx_hash"),
    assetAmount: text("asset_amount"),
    shareAmount: text("share_amount"),
    metadata: text("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("vault_lifecycle_events_vault_idx").on(table.vaultAddress),
    occurredIdx: index("vault_lifecycle_events_occurred_idx").on(table.occurredAt),
    cycleIdx: index("vault_lifecycle_events_cycle_idx").on(table.cycleId),
  }),
);

export const userVaultActivityEvents = pgTable(
  "user_vault_activity_events",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id").notNull(),
    vaultAddress: text("vault_address").notNull(),
    userAddress: text("user_address").notNull(),
    cycleId: integer("cycle_id"),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    status: text("status"),
    requestId: text("request_id"),
    txHash: text("tx_hash"),
    assetAmount: text("asset_amount"),
    shareAmount: text("share_amount"),
    metadata: text("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("user_vault_activity_events_vault_idx").on(table.vaultAddress),
    userIdx: index("user_vault_activity_events_user_idx").on(table.userAddress),
    occurredIdx: index("user_vault_activity_events_occurred_idx").on(table.occurredAt),
    requestIdx: index("user_vault_activity_events_request_idx").on(table.requestId),
  }),
);
