# Type Definitions Specification

> **Authoritative Specification for T9-T11 Implementation**  
> Version: 1.0.0  
> Last Updated: 2025-03-03  
> Based on: T3 (Backend Types) & T4 (Frontend Types) Outputs

---

## Table of Contents

1. [Overview](#overview)
2. [Solidity Layer (Contracts)](#solidity-layer-contracts)
3. [API Layer (TypeScript)](#api-layer-typescript)
4. [Web Layer (UI Types)](#web-layer-ui-types)
5. [Cross-Layer Mapping](#cross-layer-mapping)
6. [Enum Definitions](#enum-definitions)
7. [Example JSON Payloads](#example-json-payloads)
8. [Validation Rules](#validation-rules)

---

## Overview

This document provides the canonical type definitions for the Polymarket Vault system across three architectural layers:

| Layer        | Location              | Purpose                       |
| ------------ | --------------------- | ----------------------------- |
| **Solidity** | `contracts/src/*.sol` | On-chain storage and logic    |
| **API**      | `apps/vault-api/src/` | Backend services and database |
| **Web**      | `apps/vault-web/src/` | Frontend UI components        |

### Type Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  SOLIDITY (On-Chain)                                            │
│  ├── WeeklyEpochVault.sol    - ERC7540 async redemption         │
│  └── SnapshotTrancheVault.sol - Progressive payout              │
└────────────────────┬────────────────────────────────────────────┘
                     │ Event Emission / Contract Calls
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  API LAYER (Backend)                                            │
│  ├── Database Schema (Drizzle)  - Persistent storage            │
│  ├── Repository Types           - Data access patterns          │
│  └── Service Types              - Business logic                │
└────────────────────┬────────────────────────────────────────────┘
                     │ REST API / tRPC
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  WEB LAYER (Frontend)                                           │
│  ├── API Response Types         - Contract with backend         │
│  ├── Component Props            - UI boundaries                 │
│  └── State Management           - React hooks/stores            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Solidity Layer (Contracts)

### 1. WeeklyEpochVault.sol

#### Struct: `RedemptionRequest`

```solidity
struct RedemptionRequest {
    uint256 requestId;        // Unique ID (starts at 1, 0 = invalid)
    address user;             // Requester address
    uint256 shares;           // Amount of shares requested
    uint256 epochId;          // Target epoch for settlement
    RequestStatus status;     // Current status (enum)
    uint256 createdAt;        // Block timestamp of creation
    uint256 claimableAssets;  // Assets claimable after settlement (0 if pending)
}
```

**Storage Mappings:**

```solidity
mapping(uint256 => RedemptionRequest) public requests;
mapping(address => uint256[]) public userRequests;
mapping(uint256 => uint256[]) public epochRequests;
uint256 public nextRequestId = 1;
```

#### Struct: `SettlementStatus`

```solidity
struct SettlementStatus {
    uint256 totalShares;      // Total shares in pending requests
    uint256 totalProcessed;   // Count of processed requests
    bool settled;             // True when settlement complete
    uint256 proRataRatio;     // 1e18 = 100%, <1e18 = pro-rata
    uint256 availableAssets;  // Assets available for distribution
}
```

**Storage Mappings:**

```solidity
mapping(uint256 => SettlementStatus) public settlementStatus;
mapping(uint256 => uint256) public nextRequestIndexToProcess;
```

#### Enum: `RequestStatus`

```solidity
enum RequestStatus {
    Pending,    // 0 - Awaiting settlement
    Cancelled,  // 1 - Cancelled by user
    Settled,    // 2 - Settlement complete, assets computed
    Claimed     // 3 - User has claimed assets
}
```

#### Immutable Config

```solidity
IERC20 public immutable asset;                    // USDC.e token
uint256 public immutable EPOCH_DURATION;          // 604800 seconds (7 days)
uint256 public immutable DEPLOY_TIME;             // Deployment timestamp
uint256 public immutable NAV_STALENESS_THRESHOLD; // 21600 seconds (6 hours)
```

#### Events

```solidity
event RequestCreated(
    uint256 indexed requestId,
    address indexed user,
    uint256 shares,
    uint256 targetEpoch
);

event RequestCancelled(
    uint256 indexed requestId,
    address indexed user,
    uint256 shares
);

event EpochSettled(
    uint256 indexed epochId,
    uint256 totalShares,
    uint256 totalAssets,
    uint256 nav
);

event ClaimProcessed(
    uint256 indexed requestId,
    address indexed user,
    uint256 assets
);

event RequestRolledOver(
    uint256 indexed requestId,
    uint256 fromEpoch,
    uint256 toEpoch,
    uint256 shares
);

event NAVUpdated(uint256 nav, uint256 timestamp);
event EmergencyModeSet(bool active);
```

---

### 2. SnapshotTrancheVault.sol

#### Struct: `FrozenPosition`

```solidity
struct FrozenPosition {
    bytes32 positionId;       // Unique position identifier
    uint256 costBasis;        // Original cost in USDC (6 decimals)
    uint256 snapshotValue;    // NAV value at snapshot
    bool isRealized;          // Whether position has realized value
    bool isForceClosed;       // Force-closed due to timeout
    uint256 forceClosedAt;    // Timestamp of force-close
    string forceCloseReason;  // Reason for force-close
    bool exists;              // Existence check
}
```

#### Struct: `EpochSnapshot`

```solidity
struct EpochSnapshot {
    bytes32 snapshotHash;         // Unique hash of snapshot data
    uint256 timestamp;            // Snapshot block timestamp
    uint256 realizationDeadline;  // Timeout deadline (30 days default)
    bool exists;                  // Existence check
}
```

#### Struct: `RealizationEvent`

```solidity
struct RealizationEvent {
    bytes32 eventId;          // Unique event identifier
    bytes32 positionId;       // Associated position
    uint256 timestamp;        // Realization timestamp
    bool isForceClose;        // Whether force-closed
    string reason;            // Realization reason
    bool exists;              // Existence check
}
```

#### Struct: `RedemptionRequest` (Snapshot Version)

```solidity
struct RedemptionRequest {
    uint256 requestId;
    address user;
    uint256 shares;
    uint256 epochId;
    RequestStatus status;     // Different enum than WeeklyEpochVault
    uint256 createdAt;
    bool exists;
}
```

#### Struct: `Entitlement`

```solidity
struct Entitlement {
    address user;
    uint256 shares;
    uint256 entitlementRatio;    // 1e18 = 100%
    uint256 totalEntitlement;    // Total USDC entitled
    uint256 claimedToDate;       // USDC already claimed
    bool locked;                 // Whether entitlement is locked
    bool exists;
}
```

#### Enum: `RequestStatus` (Snapshot Version)

```solidity
enum RequestStatus {
    Pending,           // 0
    Frozen,            // 1
    PartiallyClaimed,  // 2
    FullyClaimed,      // 3
    Cancelled          // 4
}
```

#### Constants

```solidity
uint256 public constant NAV_STALENESS_THRESHOLD = 6 hours;
uint256 public constant ENTITLEMENT_PRECISION = 1e18;
uint256 public constant DEFAULT_REALIZATION_TIMEOUT = 30 days;
```

---

## API Layer (TypeScript)

### Database Schema Types (Drizzle ORM)

Located in: `apps/vault-api/src/db/schema.ts`

#### Table: `epochs`

```typescript
export const epochs = pgTable("epochs", {
  id: serial("id").primaryKey(),
  epochId: text("epoch_id").notNull().unique(),
  vaultAddress: text("vault_address").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  status: epochStatusEnum("status").notNull().default("pending"),
  navSnapshotId: integer("nav_snapshot_id").references(() => navSnapshots.id),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  totalSharesRequested: numeric("total_shares_requested", { precision: 30, scale: 18 })
    .notNull()
    .default("0"),
  totalAssetsToClaim: numeric("total_assets_to_claim", { precision: 20, scale: 6 })
    .notNull()
    .default("0"),
  proRataRatio: numeric("pro_rata_ratio", { precision: 20, scale: 18 }),
  settlementTxHash: text("settlement_tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

#### Table: `epoch_requests`

```typescript
export const epochRequests = pgTable("epoch_requests", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull().unique(),
  userAddress: text("user_address").notNull(),
  // ERC-7540 controller/owner/operator fields
  controller: text("controller"),
  owner: text("owner"),
  operator: text("operator"),
  vaultAddress: text("vault_address").notNull(),
  shares: numeric("shares", { precision: 30, scale: 18 }).notNull(),
  epochId: text("epoch_id").notNull(),
  status: epochRequestStatusEnum("status").notNull().default("pending"),
  // Settlement values
  claimableAssets: numeric("claimable_assets", { precision: 20, scale: 6 }),
  claimedAssets: numeric("claimed_assets", { precision: 20, scale: 6 }).default("0"),
  claimTxHash: text("claim_tx_hash"),
  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  claimableAt: timestamp("claimable_at", { withTimezone: true }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

#### Table: `nav_snapshots`

```typescript
export const navSnapshots = pgTable("nav_snapshots", {
  id: serial("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull().unique(),
  epochId: text("epoch_id").notNull(),
  vaultAddress: text("vault_address").notNull(),
  totalAssets: numeric("total_assets", { precision: 20, scale: 6 }).notNull(),
  totalShares: numeric("total_shares", { precision: 30, scale: 18 }).notNull(),
  sharePrice: numeric("share_price", { precision: 20, scale: 8 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  recordedBy: text("recorded_by").notNull(),
  txHash: text("tx_hash"),
  isFresh: boolean("is_fresh").notNull().default(true),
  staleReason: text("stale_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

#### Table: `epoch_position_snapshots`

```typescript
export const epochPositionSnapshots = pgTable("epoch_position_snapshots", {
  id: serial("id").primaryKey(),
  epochId: text("epoch_id").notNull(),
  positionId: text("position_id").notNull(),
  tokenId: text("token_id").notNull(),
  conditionId: text("condition_id").notNull(),
  marketId: text("market_id").notNull(),
  outcome: outcomeEnum("outcome").notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
  costBasis: numeric("cost_basis", { precision: 20, scale: 6 }).notNull(),
  estimatedValue: numeric("estimated_value", { precision: 20, scale: 6 }),
  statusAtSnapshot: snapshotPositionStatusEnum("status_at_snapshot").notNull().default("frozen"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

#### Table: `epoch_redemption_entitlements`

```typescript
export const epochRedemptionEntitlements = pgTable("epoch_redemption_entitlements", {
  id: serial("id").primaryKey(),
  epochId: text("epoch_id").notNull(),
  requestId: text("request_id").notNull().unique(),
  userAddress: text("user_address").notNull(),
  sharesSubmitted: numeric("shares_submitted", { precision: 30, scale: 18 }).notNull(),
  totalEpochShares: numeric("total_epoch_shares", { precision: 30, scale: 18 }).notNull(),
  entitlementRatio: numeric("entitlement_ratio", { precision: 38, scale: 18 }).notNull(),
  status: entitlementStatusEnum("status").notNull().default("pending"),
  totalRealizedUsdc: numeric("total_realized_usdc", { precision: 20, scale: 6 })
    .notNull()
    .default("0"),
  totalClaimedUsdc: numeric("total_claimed_usdc", { precision: 20, scale: 6 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

#### Table: `position_realization_events`

```typescript
export const positionRealizationEvents = pgTable("position_realization_events", {
  id: serial("id").primaryKey(),
  epochId: text("epoch_id").notNull(),
  positionSnapshotId: integer("position_snapshot_id")
    .notNull()
    .references(() => epochPositionSnapshots.id, { onDelete: "cascade" }),
  tokenId: text("token_id").notNull(),
  realizedOutcome: realizationOutcomeEnum("realized_outcome").notNull(),
  grossProceeds: numeric("gross_proceeds", { precision: 20, scale: 6 }).notNull(),
  feeDeducted: numeric("fee_deducted", { precision: 20, scale: 6 }).notNull().default("0"),
  netProceeds: numeric("net_proceeds", { precision: 20, scale: 6 }).notNull(),
  realizedAt: timestamp("realized_at", { withTimezone: true }).notNull(),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

#### Table: `realized_payout_distributions`

```typescript
export const realizedPayoutDistributions = pgTable("realized_payout_distributions", {
  id: serial("id").primaryKey(),
  epochId: text("epoch_id").notNull(),
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
  status: payoutStatusEnum("status").notNull().default("pending"),
  distributedAt: timestamp("distributed_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

### Domain Types

Located in: `apps/vault-api/src/types.ts`

#### Core Types

```typescript
/** Vault configuration with blockchain addresses */
export interface VaultConfig {
  vaultAddress: string; // Vault contract on Polygon
  adapterAddress: string; // NegRisk adapter
  safeAddress: string; // Multisig for custody
  assetAddress: string; // USDC.e token
  chainConfig: {
    chainId: number;
    rpcUrl: string;
  };
}

/** Vault position in a prediction market */
export interface VaultPosition {
  marketId: string;
  conditionId: string;
  tokenId: string;
  outcome: string;
  costBasis: number;
  quantity: number;
  status: "open" | "closing" | "closed";
}

/** Vault Net Asset Value snapshot */
export interface VaultNAV {
  totalAssets: number; // AUM in USDC
  idleAssets: number; // Uninvested USDC
  deployedCostBasis: number; // Cost of positions
  deployedMarketValue: number; // Mark-to-market value
  sharePrice: number; // NAV / totalSupply
  positionCount: number;
  lastUpdated: Date;
}
```

#### Epoch-Based Redemption Types

```typescript
/** Epoch status in the redemption lifecycle */
export type EpochStatus = "pending" | "settling" | "settled" | "cancelled";

/** Epoch redemption request status - ERC-7540 aligned */
export type EpochRequestStatus = "pending" | "claimable" | "claimed" | "cancelled";

/** Epoch definition - weekly redemption window */
export interface Epoch {
  id: number;
  epochId: string; // On-chain identifier
  vaultAddress: string;
  startTime: Date;
  endTime: Date;
  status: EpochStatus;
  navSnapshotId: number | null;
  settledAt: Date | null;
  totalSharesRequested: string; // BigNumber (18 decimals)
  totalAssetsToClaim: string; // BigNumber (6 decimals)
  proRataRatio: string | null; // BigNumber (18 decimals)
  settlementTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Epoch redemption request */
export interface EpochRequest {
  id: number;
  requestId: string;
  userAddress: string;
  // ERC-7540 fields
  controller?: string;
  owner?: string;
  operator?: string;
  vaultAddress: string;
  shares: string; // BigNumber (18 decimals)
  epochId: string;
  status: EpochRequestStatus;
  claimableAssets: string | null; // BigNumber (6 decimals)
  claimedAssets: string | null;
  claimTxHash: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
  settledAt: Date | null;
  claimableAt: Date | null;
  claimedAt: Date | null;
  updatedAt: Date;
}

/** NAV snapshot at epoch settlement */
export interface NavSnapshot {
  id: number;
  snapshotId: string;
  epochId: string;
  vaultAddress: string;
  totalAssets: string; // BigNumber (6 decimals)
  totalShares: string; // BigNumber (18 decimals)
  sharePrice: string; // BigNumber (8 decimals)
  timestamp: Date;
  recordedBy: string;
  txHash: string | null;
  isFresh: boolean;
  staleReason: string | null;
  createdAt: Date;
}

/** Epoch with aggregated statistics */
export interface EpochWithStats extends Epoch {
  requestCount: number;
  pendingRequestCount: number;
  claimedCount: number;
  cancelledCount: number;
}

/** User's epoch request with epoch metadata */
export interface UserEpochRequest extends EpochRequest {
  epochStartTime: Date;
  epochEndTime: Date;
  epochStatus: EpochStatus;
  isClaimable: boolean;
  isCancellable: boolean;
}
```

#### State Machine Types

```typescript
/** Valid epoch state transitions */
export const validEpochTransitions: Record<EpochStatus, EpochStatus[]> = {
  pending: ["settling", "cancelled"],
  settling: ["settled", "cancelled"],
  settled: [], // Terminal
  cancelled: [], // Terminal
};

/** Valid epoch request state transitions */
export const validEpochRequestTransitions: Record<EpochRequestStatus, EpochRequestStatus[]> = {
  pending: ["cancelled", "claimable"],
  claimable: ["claimed"],
  claimed: [], // Terminal
  cancelled: [], // Terminal
};

/** State transition result */
export interface EpochStateTransitionResult<T = Epoch | EpochRequest> {
  success: boolean;
  entity?: T;
  error?: string;
  alreadyInTargetState?: boolean;
}
```

#### Input Types

```typescript
/** Create epoch request input */
export interface CreateEpochRequestInput {
  requestId: string;
  userAddress: string;
  controller?: string; // ERC-7540
  owner?: string; // ERC-7540
  operator?: string; // ERC-7540
  vaultAddress: string;
  shares: string;
  epochId: string;
}

/** Create epoch input */
export interface CreateEpochInput {
  epochId: string;
  vaultAddress: string;
  startTime: Date;
  endTime: Date;
}

/** Create NAV snapshot input */
export interface CreateNavSnapshotInput {
  snapshotId: string;
  epochId: string;
  vaultAddress: string;
  totalAssets: string;
  totalShares: string;
  sharePrice: string;
  timestamp: Date;
  recordedBy: string;
  txHash?: string;
}
```

---

## Web Layer (UI Types)

Located in: `apps/vault-web/src/types.ts`

### API Response Types

```typescript
/** Vault NAV from /vault/status */
export interface VaultNAV {
  totalAssets: number;
  idleAssets: number;
  vaultUsdc: number;
  safeUsdc: number;
  deployedCostBasis: number;
  redeemableCostBasis?: number;
  sharePrice: number;
  positionCount: number;
  redeemableCount?: number;
  lastUpdated: string; // ISO date string
}

/** Vault operational status */
export interface VaultStatusResponse {
  vaultId?: number;
  vaultName?: string;
  vaultSlug?: string;
  profile?: VaultProfile;
  nav: VaultNAV;
  positionCount: number;
  deployedRatio: number;
  committedExposureRatio?: number;
  totalCostBasis: number;
  mode: "simulation" | "live";
  capState?: {
    maxAllowedDeployed: number;
    currentDeployed: number;
    headroom: number;
    constraintSource: "policy_cap" | "no_headroom" | "nav_stale";
  } | null;
}

/** Position from /vault/positions */
export interface VaultPosition {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  costBasis: number;
  curPrice: number;
  currentValue?: number;
  realizedPnl?: number;
  cashPnl?: number;
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
  endDate: string;
  redeemable: boolean;
  status: "open" | "redeemable" | "closed";
}

/** NAV history item */
export interface VaultNavHistoryItem {
  id: number;
  navId: string;
  totalAssets: string;
  idleAssets: string;
  deployedCostBasis: string;
  sharePrice: string;
  positionCount: number;
  timestamp: string;
  createdAt: string;
}
```

### Epoch-Based Redemption Types (Frontend)

```typescript
/** Redemption request status - ERC-7540 aligned */
export type RedemptionRequestStatus = "pending" | "claimable" | "claimed" | "cancelled";

/** Redemption request - UI representation */
export interface RedemptionRequest {
  id: string;
  requestId: string;
  epochId?: number;
  shares: string; // BigNumber string
  sharesFormatted: string;
  targetEpoch: number;
  targetEpochEndTime: string; // ISO date string
  claimableAssets: string | null;
  claimableAssetsFormatted: string | null;
  status: RedemptionRequestStatus;
  createdAt: string; // ISO date string
  claimedAt: string | null;
  cancelledAt: string | null;
  proRataApplied: boolean;
  proRataPercentage: number | null;
  // Controller-aware lifecycle fields
  ownerAddress: string;
  controllerAddress: string;
  operatorAddress?: string | null;
}

/** Epoch information for UI */
export interface EpochInfo {
  currentEpoch: number;
  currentEpochStartTime: string;
  currentEpochEndTime: string;
  nextEpochStartTime: string;
  isSettlementWindow: boolean;
  settlementWindowStart: string | null;
  settlementWindowEnd: string | null;
  totalPendingShares: string;
  estimatedSettlementAssets: string | null;
  navFresh: boolean;
  navLastUpdated: string | null;
}

/** Redemption queue response */
export interface RedemptionQueueResponse {
  requests: RedemptionRequest[];
  pending: RedemptionRequest[];
  claimable: RedemptionRequest[];
  total: number;
}

/** User redemptions response */
export interface UserRedemptionsResponse {
  success: boolean;
  requests: RedemptionRequest[];
  pendingRequests: RedemptionRequest[];
  claimableRequests: RedemptionRequest[];
  totalPendingShares: string;
  totalClaimableShares: string;
  estimatedAssetsPendingFormatted: string;
  estimatedAssetsClaimableFormatted: string;
}

/** Epoch metadata for UI */
export interface Epoch {
  epochId: number;
  startTime: string;
  endTime: string;
  settlementTime: string;
  isActive: boolean;
  isPast: boolean;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  totalRequests: number;
  totalShares: string;
  totalSharesFormatted: string;
  settled: boolean;
  proRataRatio?: string;
  availableAssets?: string;
  availableAssetsFormatted?: string;
}
```

### API Action Response Types

```typescript
/** Create redemption request response */
export interface RedemptionRequestCreateResponse {
  success: boolean;
  requestId: string;
  epochId: number;
  status: RedemptionRequestStatus;
  message: string;
  targetSettlement: string;
}

/** Claim redemption response */
export interface RedemptionClaimResponse {
  success: boolean;
  requestId: string;
  txHash: string;
  claimedAssets: string;
  message: string;
}

/** Cancel redemption response */
export interface CancelRedemptionResponse {
  success: boolean;
  requestId: string;
  vaultId: number;
  userAddress: string;
  message: string;
}

/** Epoch status response */
export interface EpochStatusResponse {
  success: boolean;
  epoch: Epoch;
  vaultId: number;
  canSettle?: boolean;
}
```

---

## Cross-Layer Mapping

### Field Mapping: Contract → Database → API → UI

| Concept              | Solidity                  | Database                 | API Type                 | UI Type                    | Notes                     |
| -------------------- | ------------------------- | ------------------------ | ------------------------ | -------------------------- | ------------------------- |
| **Request ID**       | `uint256 requestId`       | `text request_id`        | `string requestId`       | `string requestId`         | 1-based in contract       |
| **User Address**     | `address user`            | `text user_address`      | `string userAddress`     | `string userAddress`       | Checksummed               |
| **Shares**           | `uint256 shares`          | `numeric(30,18)`         | `string shares`          | `string shares`            | 18 decimals               |
| **Shares Formatted** | —                         | —                        | —                        | `string sharesFormatted`   | Human readable            |
| **Epoch ID**         | `uint256 epochId`         | `text epoch_id`          | `string epochId`         | `number targetEpoch`       | Contract: timestamp-based |
| **Status**           | `enum RequestStatus`      | `epoch_request_status`   | `EpochRequestStatus`     | `RedemptionRequestStatus`  | See status mapping below  |
| **Created At**       | `uint256 createdAt`       | `timestamp`              | `Date createdAt`         | `string createdAt`         | ISO string in UI          |
| **Claimable Assets** | `uint256 claimableAssets` | `numeric(20,6)`          | `string claimableAssets` | `string claimableAssets`   | 6 decimals (USDC)         |
| **Claimed Assets**   | —                         | `numeric(20,6)`          | `string claimedAssets`   | —                          | Cumulative claimed        |
| **Controller**       | —                         | `text controller`        | `string controller`      | `string controllerAddress` | ERC-7540                  |
| **Owner**            | —                         | `text owner`             | `string owner`           | `string ownerAddress`      | ERC-7540                  |
| **Operator**         | —                         | `text operator`          | `string operator`        | `string operatorAddress`   | ERC-7540                  |
| **Claimable At**     | —                         | `timestamp claimable_at` | `Date claimableAt`       | —                          | When became claimable     |
| **Claimed At**       | —                         | `timestamp claimed_at`   | `Date claimedAt`         | `string claimedAt`         | When user claimed         |
| **Cancelled At**     | —                         | `timestamp cancelled_at` | `Date cancelledAt`       | `string cancelledAt`       | When cancelled            |
| **Pro Rata Ratio**   | `uint256 proRataRatio`    | `numeric(20,18)`         | `string proRataRatio`    | `number proRataPercentage` | 1e18 = 100%               |
| **Total Assets**     | —                         | `numeric(20,6)`          | `string totalAssets`     | —                          | NAV total                 |
| **Share Price**      | —                         | `numeric(20,8)`          | `string sharePrice`      | `number sharePrice`        | NAV / shares              |

### Status Mapping

#### Contract to API Status Mapping

| Contract Value | Contract Enum | API Status    | UI Status     | Description              |
| -------------- | ------------- | ------------- | ------------- | ------------------------ |
| 0              | `Pending`     | `"pending"`   | `"pending"`   | Awaiting settlement      |
| 1              | `Cancelled`   | `"cancelled"` | `"cancelled"` | User cancelled           |
| 2              | `Settled`     | `"claimable"` | `"claimable"` | Ready to claim (renamed) |
| 3              | `Claimed`     | `"claimed"`   | `"claimed"`   | User claimed assets      |

#### Epoch Status Mapping

| Database Value | API Type      | UI Display  | Description            |
| -------------- | ------------- | ----------- | ---------------------- |
| `"pending"`    | `EpochStatus` | "Open"      | Accepting requests     |
| `"settling"`   | `EpochStatus` | "Settling"  | Settlement in progress |
| `"settled"`    | `EpochStatus` | "Settled"   | Settlement complete    |
| `"cancelled"`  | `EpochStatus` | "Cancelled" | Epoch cancelled        |

### State Transitions

#### Request State Machine

```
                    ┌─────────────┐
                    │   PENDING   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                │                ▼
┌─────────────────┐        │      ┌─────────────────┐
│    CANCELLED    │        │      │   CANCELLED     │
│   (by user)     │        │      │  (by system)    │
└─────────────────┘        │      └─────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  CLAIMABLE  │◄──────┐
                    └──────┬──────┘       │
                           │              │
                           ▼              │
                    ┌─────────────┐       │
                    │   CLAIMED   │───────┘ (idempotent)
                    └─────────────┘
```

#### Epoch State Machine

```
                    ┌─────────────┐
                    │   PENDING   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                │                ▼
┌─────────────────┐        │      ┌─────────────────┐
│   CANCELLED     │        │      │    SETTLING     │
│  (emergency)    │        │      └────────┬────────┘
└─────────────────┘        │               │
                           │               ▼
                           │      ┌─────────────────┐
                           │      │     SETTLED     │
                           │      └─────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │   CANCELLED     │
                  │ (after settling)│
                  └─────────────────┘
```

---

## Enum Definitions

### Solidity Enums

#### `RequestStatus` (WeeklyEpochVault)

```solidity
enum RequestStatus {
    Pending,    // 0
    Cancelled,  // 1
    Settled,    // 2
    Claimed     // 3
}
```

#### `RequestStatus` (SnapshotTrancheVault)

```solidity
enum RequestStatus {
    Pending,           // 0
    Frozen,            // 1
    PartiallyClaimed,  // 2
    FullyClaimed,      // 3
    Cancelled          // 4
}
```

### Database Enums (PostgreSQL)

```sql
-- Epoch status
CREATE TYPE epoch_status AS ENUM (
    'pending',    -- Epoch open for requests
    'settling',   -- Settlement in progress
    'settled',    -- Settlement complete
    'cancelled'   -- Epoch cancelled
);

-- Epoch request status (ERC-7540 aligned)
CREATE TYPE epoch_request_status AS ENUM (
    'pending',    -- Request active, can be cancelled
    'claimable',  -- Settled, ready to claim (was 'settled')
    'claimed',    -- User has claimed
    'cancelled'   -- User cancelled
);

-- Position status
CREATE TYPE position_status AS ENUM (
    'open',
    'resolved_win',
    'resolved_loss'
);

-- Outcome
CREATE TYPE outcome AS ENUM ('YES', 'NO');

-- Allocation direction
CREATE TYPE allocation_direction AS ENUM ('allocate', 'deallocate');

-- Trade side
CREATE TYPE trade_side AS ENUM ('buy', 'sell');

-- Trade status
CREATE TYPE trade_status AS ENUM (
    'pending',
    'filled',
    'partially_filled',
    'cancelled',
    'failed'
);

-- Snapshot position status
CREATE TYPE snapshot_position_status AS ENUM (
    'frozen',
    'realized',
    'timed_out',
    'cancelled'
);

-- Entitlement status
CREATE TYPE entitlement_status AS ENUM (
    'pending',
    'partially_fulfilled',
    'fully_fulfilled',
    'cancelled'
);

-- Realization outcome
CREATE TYPE realization_outcome AS ENUM (
    'win',
    'loss',
    'force_close'
);

-- Payout status
CREATE TYPE payout_status AS ENUM (
    'pending',
    'distributed',
    'claimed',
    'failed'
);
```

### TypeScript Enum Types

```typescript
// apps/vault-api/src/db/schema.ts
export const epochStatusEnum = pgEnum("epoch_status", [
  "pending",
  "settling",
  "settled",
  "cancelled",
]);

export const epochRequestStatusEnum = pgEnum("epoch_request_status", [
  "pending",
  "claimable",
  "claimed",
  "cancelled",
]);

// apps/vault-api/src/types.ts
export type EpochStatus = "pending" | "settling" | "settled" | "cancelled";
export type EpochRequestStatus = "pending" | "claimable" | "claimed" | "cancelled";

// apps/vault-web/src/types.ts
export type RedemptionRequestStatus = "pending" | "claimable" | "claimed" | "cancelled";
```

---

## Example JSON Payloads

### 1. Create Redemption Request

**Request:**

```json
{
  "vaultAddress": "0x1234567890abcdef...",
  "shares": "1000000000000000000",
  "userAddress": "0xabcdef1234567890..."
}
```

**Response:**

```json
{
  "success": true,
  "requestId": "req-1735689600-1234",
  "epochId": 1735689600,
  "status": "pending",
  "message": "Redemption request created successfully",
  "targetSettlement": "2025-01-01T00:00:00Z"
}
```

### 2. Get User Redemptions

**Response:**

```json
{
  "success": true,
  "requests": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "requestId": "req-1735689600-1234",
      "shares": "1000000000000000000",
      "sharesFormatted": "1.0",
      "targetEpoch": 1735689600,
      "targetEpochEndTime": "2025-01-01T00:00:00Z",
      "claimableAssets": null,
      "claimableAssetsFormatted": null,
      "status": "pending",
      "createdAt": "2024-12-25T12:00:00Z",
      "claimedAt": null,
      "cancelledAt": null,
      "proRataApplied": false,
      "proRataPercentage": null,
      "ownerAddress": "0xabcdef1234567890...",
      "controllerAddress": "0xabcdef1234567890...",
      "operatorAddress": null
    }
  ],
  "pendingRequests": [...],
  "claimableRequests": [],
  "totalPendingShares": "1000000000000000000",
  "totalClaimableShares": "0",
  "estimatedAssetsPendingFormatted": "1,000.00",
  "estimatedAssetsClaimableFormatted": "0.00"
}
```

### 3. Epoch Settlement Complete

**Response:**

```json
{
  "success": true,
  "epoch": {
    "epochId": 1735689600,
    "startTime": "2024-12-25T00:00:00Z",
    "endTime": "2025-01-01T00:00:00Z",
    "settlementTime": "2025-01-01T06:00:00Z",
    "isActive": false,
    "isPast": true,
    "timeRemainingMs": 0,
    "timeRemainingFormatted": "0s",
    "totalRequests": 42,
    "totalShares": "50000000000000000000",
    "totalSharesFormatted": "50.0",
    "settled": true,
    "proRataRatio": "0.95",
    "availableAssets": "47500000000",
    "availableAssetsFormatted": "47,500.00"
  },
  "vaultId": 1,
  "canSettle": false
}
```

### 4. Claim Redemption

**Request:**

```json
{
  "requestId": "req-1735689600-1234"
}
```

**Response:**

```json
{
  "success": true,
  "requestId": "req-1735689600-1234",
  "txHash": "0x9876543210fedcba...",
  "claimedAssets": "950000000",
  "message": "Successfully claimed 950.00 USDC"
}
```

### 5. NAV Snapshot

**Response:**

```json
{
  "id": 1,
  "snapshotId": "snap-1735689600-abc123",
  "epochId": "1735689600",
  "vaultAddress": "0x1234567890abcdef...",
  "totalAssets": "100000000000",
  "totalShares": "100000000000000000000",
  "sharePrice": "1.00000000",
  "timestamp": "2025-01-01T06:00:00Z",
  "recordedBy": "0xsettler1234567890...",
  "txHash": "0xabcdef1234567890...",
  "isFresh": true,
  "staleReason": null,
  "createdAt": "2025-01-01T06:00:05Z"
}
```

### 6. Epoch Info (Current State)

**Response:**

```json
{
  "currentEpoch": 1736294400,
  "currentEpochStartTime": "2025-01-08T00:00:00Z",
  "currentEpochEndTime": "2025-01-15T00:00:00Z",
  "nextEpochStartTime": "2025-01-15T00:00:00Z",
  "isSettlementWindow": true,
  "settlementWindowStart": "2025-01-14T18:00:00Z",
  "settlementWindowEnd": "2025-01-15T06:00:00Z",
  "totalPendingShares": "25000000000000000000",
  "estimatedSettlementAssets": "23750000000",
  "navFresh": true,
  "navLastUpdated": "2025-01-14T20:00:00Z"
}
```

---

## Validation Rules

### Redemption Request Validation

```typescript
interface RedemptionRequestValidation {
  // Shares must be positive
  shares: {
    type: "string";
    pattern: /^[1-9][0-9]*$/;  // Positive integer
    maxLength: 78;              // uint256 max
  };

  // Addresses must be valid Ethereum addresses
  userAddress: {
    type: "string";
    pattern: /^0x[a-fA-F0-9]{40}$/;
  };

  // Vault address must be whitelisted
  vaultAddress: {
    type: "string";
    pattern: /^0x[a-fA-F0-9]{40}$/;
    validate: (addr) => isWhitelistedVault(addr);
  };

  // Cannot create request if emergency mode
  emergencyCheck: {
    rule: "emergencyMode === false";
    error: "Redemptions paused due to emergency";
  };

  // Cannot create request if NAV stale
  navFreshCheck: {
    rule: "navLastUpdated > now - NAV_STALENESS_THRESHOLD";
    error: "NAV is stale, cannot create request";
  };
}
```

### Epoch Settlement Validation

```typescript
interface EpochSettlementValidation {
  // Epoch must have ended
  epochEnded: {
    rule: "block.timestamp >= epochEndTime";
    error: "Epoch has not ended yet";
  };

  // NAV must be fresh
  navFresh: {
    rule: "navLastUpdated > now - NAV_STALENESS_THRESHOLD";
    error: "NAV is stale, cannot settle";
  };

  // Not already settled
  notSettled: {
    rule: "status !== 'settled'";
    error: "Epoch already settled";
  };

  // Must have pending requests
  hasRequests: {
    rule: "pendingRequestCount > 0";
    error: "No pending requests to settle";
  };
}
```

### Claim Validation

```typescript
interface ClaimValidation {
  // Request must exist
  requestExists: {
    rule: "request.requestId !== 0";
    error: "Request not found";
  };

  // Caller must be request owner
  ownership: {
    rule: "request.user === msg.sender";
    error: "Not request owner";
  };

  // Request must be settled (claimable)
  isSettled: {
    rule: "request.status === 'claimable'";
    error: "Request not settled yet";
  };

  // Not already claimed (idempotent)
  notClaimed: {
    rule: "request.status !== 'claimed'";
    warning: "Already claimed";
    action: "return success without transfer";
  };

  // Must have claimable assets
  hasAssets: {
    rule: "claimableAssets > 0";
    warning: "No assets to claim";
    action: "mark as claimed, return success";
  };
}
```

### Cancel Validation

```typescript
interface CancelValidation {
  // Request must exist
  requestExists: {
    rule: "request.requestId !== 0";
    error: "Request not found";
  };

  // Caller must be request owner
  ownership: {
    rule: "request.user === msg.sender";
    error: "Not request owner";
  };

  // Must not already be cancelled
  notCancelled: {
    rule: "request.status !== 'cancelled'";
    error: "Request already cancelled";
  };

  // Must be pending (not settled/claimed)
  isPending: {
    rule: "request.status === 'pending'";
    error: "Cannot cancel after settlement";
  };

  // Must be before epoch end
  beforeEpochEnd: {
    rule: "block.timestamp < epochEndTime";
    error: "Cannot cancel after settlement cutoff";
  };
}
```

### Numeric Precision Rules

| Field              | Precision | Scale | Example                            |
| ------------------ | --------- | ----- | ---------------------------------- |
| `shares`           | 30        | 18    | `1000000000000000000` = 1 share    |
| `totalShares`      | 30        | 18    | `50000000000000000000` = 50 shares |
| `claimableAssets`  | 20        | 6     | `1000000000` = 1,000 USDC          |
| `totalAssets`      | 20        | 6     | `100000000000` = 100,000 USDC      |
| `sharePrice`       | 20        | 8     | `100000000` = 1.00 USDC            |
| `proRataRatio`     | 20        | 18    | `950000000000000000` = 0.95 (95%)  |
| `entitlementRatio` | 38        | 18    | `500000000000000000` = 0.50 (50%)  |

---

## Implementation Notes

### T9-T11 Integration Checklist

- [ ] **T9 (Contract-Sync)**: Map Solidity `RequestStatus` enum (0-3) to API strings
- [ ] **T9 (Contract-Sync)**: Handle BigNumber conversions (18-decimal shares, 6-decimal USDC)
- [ ] **T10 (API Types)**: Implement Drizzle schema with all enum types
- [ ] **T10 (API Types)**: Add ERC-7540 fields (controller, owner, operator)
- [ ] **T10 (API Types)**: Implement state machine validation
- [ ] **T11 (UI Types)**: Convert Date objects to ISO strings for API consumption
- [ ] **T11 (UI Types)**: Format BigNumber values for display (sharesFormatted)
- [ ] **T11 (UI Types)**: Add status normalization for backward compatibility

### Backward Compatibility

The transition from `"settled"`/`"ready"` to `"claimable"` status requires:

1. **API Layer**: Map legacy statuses in `mapContractStatus()`
2. **Frontend**: Normalize status in hooks (`useRequests`)
3. **Database**: Migration to update existing records

```typescript
// Status normalization in hooks.ts
const normalizeStatus = (status: string): RedemptionRequestStatus => {
  if (status === "ready" || status === "settled") return "claimable";
  return status as RedemptionRequestStatus;
};
```

---

## Appendix: Type Generation

### From Solidity to TypeScript

Use typechain or similar to generate TypeScript definitions from Solidity ABIs:

```bash
# Generate types from compiled contracts
typechain --target=ethers-v6 --out-dir=./types './contracts/out/**/*.json'
```

### From Database to TypeScript

Use Drizzle ORM's type inference:

```typescript
import { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { epochRequests, epochs, navSnapshots } from "./schema";

// Select types (what comes from DB)
export type EpochRequestSelect = InferSelectModel<typeof epochRequests>;
export type EpochSelect = InferSelectModel<typeof epochs>;
export type NavSnapshotSelect = InferSelectModel<typeof navSnapshots>;

// Insert types (what goes to DB)
export type EpochRequestInsert = InferInsertModel<typeof epochRequests>;
export type EpochInsert = InferInsertModel<typeof epochs>;
export type NavSnapshotInsert = InferInsertModel<typeof navSnapshots>;
```

---

**End of Specification**
