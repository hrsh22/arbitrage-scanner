import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const vaultStatusEnum = pgEnum("vault_status", ["draft", "public", "paused"]);

export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending",
  "processing",
  "completed",
  "cancelled",
]);

export const claimStatusEnum = pgEnum("claim_status", [
  "pending",
  "resolved_win",
  "resolved_loss",
  "claimed",
]);

export const positionStatusEnum = pgEnum("position_status", ["open", "won", "lost"]);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    walletIdx: uniqueIndex("users_wallet_idx").on(table.walletAddress),
  }),
);

export const vaults = pgTable(
  "vaults",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    contractAddress: varchar("contract_address", { length: 42 }).notNull(),
    safeAddress: varchar("safe_address", { length: 42 }).notNull(),
    adminAddress: varchar("admin_address", { length: 42 }).notNull(),
    chainId: integer("chain_id").notNull(),
    status: vaultStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Slug is unique per chain (same vault name can exist on mainnet and testnet)
    slugChainIdx: uniqueIndex("vaults_slug_chain_idx").on(table.slug, table.chainId),
    chainIdx: index("vaults_chain_idx").on(table.chainId),
    adminIdx: index("vaults_admin_idx").on(table.adminAddress),
    statusIdx: index("vaults_status_idx").on(table.status),
  }),
);

export const vaultState = pgTable(
  "vault_state",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id")
      .notNull()
      .references(() => vaults.id),
    totalShares: numeric("total_shares", { precision: 24, scale: 8 }).notNull().default("0"),
    totalAssetsUsdc: numeric("total_assets_usdc", { precision: 18, scale: 6 })
      .notNull()
      .default("0"),
    idleUsdc: numeric("idle_usdc", { precision: 18, scale: 6 }).notNull().default("0"),
    navPerShare: numeric("nav_per_share", { precision: 18, scale: 8 }).notNull().default("1"),
    lastNavUpdateAt: timestamp("last_nav_update_at", { withTimezone: true }).notNull().defaultNow(),
    depositsEnabled: boolean("deposits_enabled").notNull().default(true),
    withdrawalsEnabled: boolean("withdrawals_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: uniqueIndex("vault_state_vault_idx").on(table.vaultId),
  }),
);

export const vaultPositions = pgTable(
  "vault_positions",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id")
      .notNull()
      .references(() => vaults.id),
    marketId: text("market_id").notNull(),
    marketQuestion: text("market_question").notNull(),
    marketSlug: text("market_slug"),
    tokenId: text("token_id").notNull(),
    outcome: text("outcome").notNull(),
    shares: numeric("shares", { precision: 18, scale: 6 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 10, scale: 6 }).notNull(),
    costUsdc: numeric("cost_usdc", { precision: 18, scale: 6 }).notNull(),
    currentPrice: numeric("current_price", { precision: 10, scale: 6 }),
    status: positionStatusEnum("status").notNull().default("open"),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionValue: numeric("resolution_value", { precision: 10, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("vault_positions_vault_idx").on(table.vaultId),
    statusIdx: index("vault_positions_status_idx").on(table.status),
    marketIdx: index("vault_positions_market_idx").on(table.marketId),
  }),
);

export const deposits = pgTable(
  "deposits",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id")
      .notNull()
      .references(() => vaults.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    txHash: varchar("tx_hash", { length: 66 }).notNull().unique(),
    amountUsdc: numeric("amount_usdc", { precision: 18, scale: 6 }).notNull(),
    sharesReceived: numeric("shares_received", { precision: 24, scale: 8 }).notNull(),
    navAtDeposit: numeric("nav_at_deposit", { precision: 18, scale: 8 }).notNull(),
    blockNumber: integer("block_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("deposits_vault_idx").on(table.vaultId),
    userIdx: index("deposits_user_idx").on(table.userId),
    txHashIdx: uniqueIndex("deposits_tx_hash_idx").on(table.txHash),
  }),
);

export const withdrawalRequests = pgTable(
  "withdrawal_requests",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id")
      .notNull()
      .references(() => vaults.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    onChainRequestId: integer("on_chain_request_id"),
    sharesLocked: numeric("shares_locked", { precision: 24, scale: 8 }).notNull(),
    ownershipPct: numeric("ownership_pct", { precision: 10, scale: 8 }).notNull(),
    idleUsdcClaim: numeric("idle_usdc_claim", { precision: 18, scale: 6 }).notNull(),
    status: withdrawalStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    totalClaimedUsdc: numeric("total_claimed_usdc", { precision: 18, scale: 6 }).default("0"),
    currentClaimableUsdc: numeric("current_claimable_usdc", { precision: 18, scale: 6 }).default(
      "0",
    ),
    lastMerkleRoot: text("last_merkle_root"),
    lastMerkleProof: text("last_merkle_proof"),
  },
  (table) => ({
    vaultIdx: index("withdrawal_requests_vault_idx").on(table.vaultId),
    userIdx: index("withdrawal_requests_user_idx").on(table.userId),
    statusIdx: index("withdrawal_requests_status_idx").on(table.status),
    onChainIdx: index("withdrawal_requests_on_chain_idx").on(table.onChainRequestId),
  }),
);

export const positionClaims = pgTable(
  "position_claims",
  {
    id: serial("id").primaryKey(),
    withdrawalRequestId: integer("withdrawal_request_id")
      .notNull()
      .references(() => withdrawalRequests.id),
    positionId: integer("position_id")
      .notNull()
      .references(() => vaultPositions.id),
    sharesClaimed: numeric("shares_claimed", { precision: 18, scale: 6 }).notNull(),
    status: claimStatusEnum("status").notNull().default("pending"),
    resolutionValueUsdc: numeric("resolution_value_usdc", { precision: 18, scale: 6 }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    withdrawalIdx: index("position_claims_withdrawal_idx").on(table.withdrawalRequestId),
    positionIdx: index("position_claims_position_idx").on(table.positionId),
    statusIdx: index("position_claims_status_idx").on(table.status),
  }),
);

export const navHistory = pgTable(
  "nav_history",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id")
      .notNull()
      .references(() => vaults.id),
    navPerShare: numeric("nav_per_share", { precision: 18, scale: 8 }).notNull(),
    totalAssets: numeric("total_assets", { precision: 18, scale: 6 }).notNull(),
    totalShares: numeric("total_shares", { precision: 24, scale: 8 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("nav_history_vault_idx").on(table.vaultId),
    recordedAtIdx: index("nav_history_recorded_at_idx").on(table.recordedAt),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Vault = typeof vaults.$inferSelect;
export type NewVault = typeof vaults.$inferInsert;
export type VaultState = typeof vaultState.$inferSelect;
export type VaultPosition = typeof vaultPositions.$inferSelect;
export type NewVaultPosition = typeof vaultPositions.$inferInsert;
export type Deposit = typeof deposits.$inferSelect;
export type NewDeposit = typeof deposits.$inferInsert;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;
export type NewWithdrawalRequest = typeof withdrawalRequests.$inferInsert;
export type PositionClaim = typeof positionClaims.$inferSelect;
export type NewPositionClaim = typeof positionClaims.$inferInsert;
export type NavHistory = typeof navHistory.$inferSelect;

export const syncEventTypeEnum = pgEnum("sync_event_type", ["deposit", "withdrawal", "claimed"]);

export const syncState = pgTable("sync_state", {
  id: text("id").primaryKey(),
  vaultId: integer("vault_id").references(() => vaults.id),
  eventType: syncEventTypeEnum("event_type").notNull(),
  lastSyncedBlock: integer("last_synced_block").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimedEvents = pgTable(
  "claimed_events",
  {
    id: serial("id").primaryKey(),
    vaultId: integer("vault_id")
      .notNull()
      .references(() => vaults.id),
    onChainRequestId: integer("on_chain_request_id").notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    amountUsdc: numeric("amount_usdc", { precision: 18, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vaultIdx: index("claimed_events_vault_idx").on(table.vaultId),
    requestIdx: index("claimed_events_on_chain_idx").on(table.onChainRequestId),
    txLogUnique: uniqueIndex("claimed_events_tx_log_idx").on(table.txHash, table.logIndex),
  }),
);

export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;

export type ClaimedEvent = typeof claimedEvents.$inferSelect;
export type NewClaimedEvent = typeof claimedEvents.$inferInsert;
