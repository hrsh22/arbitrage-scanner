# VAULT_KNOWLEDGE.md

Canonical knowledge base for the vault stack in this repo.

Read this file before making any vault-related change in:

- `apps/vault-api/`
- `apps/vault-web/`
- `contracts/`

**Current State (March 2026):** The codebase targets **ClosedBookBatchVault**, but the active Amoy deployment still uses the legacy **EpochTrancheVault** contract. A deployment cutover is required to use the new batch/cycle system.

---

## 1) Current Architecture at a Glance

The vault system uses **ClosedBookBatchVault** as the canonical smart contract for batch-gated deposit and redemption processing.

### Core Flow (Closed-Book Batch System)

```
Deposit:   queueDeposit -> (batch cutoff/flatten) -> processDepositQueue -> mint shares
Redeem:    requestRedeem -> shares escrowed -> (batch settle) -> claim assets
Batch:     Open -> Cutoff -> Flattening -> Settling -> Settled -> Closed -> Reopen
```

### Key Components

| Component          | File                                                 | Purpose                                                                   |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Canonical Contract | `contracts/src/ClosedBookBatchVault.sol`             | Closed-book vault with deposit queue, redemption escrow, batch settlement |
| Legacy Contract    | `contracts/src/EpochTrancheVault.sol`                | Epoch-gated vault with carry (still deployed on Amoy)                     |
| Backend Provider   | `apps/vault-api/src/services/customVaultProvider.ts` | Reads vault state, manages redemption flow                                |
| Backend Client     | `apps/vault-api/src/services/customVaultClient.ts`   | viem-based contract interactions                                          |
| API Routes         | `apps/vault-api/src/routes/customVaultRoutes.ts`     | REST endpoints for lifecycle operations                                   |
| Frontend Hooks     | `apps/vault-web/src/lib/hooks.ts`                    | React hooks for vault interactions                                        |
| Frontend API       | `apps/vault-web/src/lib/api.ts`                      | API client for vault operations                                           |

### Primary Active Vault

- `vault1` configured in `apps/vault-api/src/config/vaults/vault1-pph.ts`
- `type: "custom"` with custom batch settings (1 hour default in dev, 7 days in prod)
- Provider routing: `VaultProviderFactory` instantiates `CustomVaultProvider`

### Current Deployment Gap

| Environment  | Contract             | Address                                      | Status      |
| ------------ | -------------------- | -------------------------------------------- | ----------- |
| Amoy Testnet | EpochTrancheVault    | `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` | **Legacy**  |
| Amoy Testnet | ClosedBookBatchVault | Not deployed                                 | **Pending** |

**Impact:** API endpoints like `/cycles/current` will not function until the new contract is deployed.

---

## 2) Smart Contract Layer (ClosedBookBatchVault)

### 2.1 Contract Overview

File: `contracts/src/ClosedBookBatchVault.sol`

Core model:

- **Deposit Queue**: Async deposits queued for batch processing after flatten
- **Redemption Escrow**: Shares held by vault during settlement, burned at settlement time
- **Batch Settlement**: Discrete cycles with cutoff, flatten, settle, close, reopen phases
- **Flatten-Time Pricing**: All deposits in a batch mint at the same locked clearing price
- **Pro-rata Distribution**: Applied if insufficient assets for full redemptions

### 2.2 Constructor Parameters

```solidity
constructor(
    address _asset,              // USDC or other ERC20
    address _admin,              // Admin role
    address _settler,            // Settlement role
    address _navUpdater,         // NAV update role
    address _snapshotter,        // Cutoff/flatten role
    address _depositProcessor,   // Deposit queue processor
    uint256 _navStalenessThreshold  // NAV freshness threshold
)
```

### 2.3 Batch/Cycle Lifecycle

```
Open -> Cutoff -> Flattening -> Settling -> Settled -> Closed -> Reopen
  |        |          |           |           |         |        |
  |        |          |           |           |         |        +-- New batch starts
  |        |          |           |           |         +-- Claims window ended
  |        |          |           |           +-- Claims available
  |        |          |           +-- Chunked settlement in progress
  |        |          +-- NAV locked, clearing price set, deposits processed
  |        +-- Deposits closed, redemptions frozen
  +-- Accepting deposits and redemption requests
```

**Key Semantics:**

1. **Cutoff** (SNAPSHOT_ROLE): Closes deposits for current batch
   - Deposits are now queued for the _next_ batch
   - Redemptions can still be requested but are frozen in place

2. **Flatten** (SNAPSHOT_ROLE): Locks cohort economics
   - Records NAV snapshot
   - Locks clearing price (excluding sealed/queued deposits)
   - Transitions batch to Flattening state
   - Creates next batch for new deposits

3. **Deposit Processing** (DEPOSIT_PROCESSOR_ROLE): Mints shares at locked price
   - Only callable in Flattening or Settling states
   - All deposits mint at the same lockedClearingPrice
   - Chunked processing for gas efficiency

4. **Settlement** (SETTLER_ROLE): Processes redemptions
   - Requires: batch ended + flattened + fresh NAV
   - Shares escrowed during settlement
   - Burns shares at settlement, calculates claimable assets
   - Applies pro-rata ratio if insufficient liquidity

5. **Close** (SETTLER_ROLE): Ends claims window
   - Called after sufficient time for claims
   - Batch enters Closed state

6. **Reopen** (SETTLER_ROLE): Starts next batch
   - Creates new batch with fresh timing
   - Cycle begins again

### 2.4 Role Structure

| Role                     | Purpose                           |
| ------------------------ | --------------------------------- |
| `ADMIN_ROLE`             | Emergency mode, admin functions   |
| `SETTLER_ROLE`           | Batch settlement, close, reopen   |
| `NAV_UPDATER_ROLE`       | NAV updates with freshness checks |
| `SNAPSHOT_ROLE`          | Cutoff and flatten operations     |
| `DEPOSIT_PROCESSOR_ROLE` | Processing deposit queue          |

### 2.5 Key Invariants

- Batch duration is immutable after deployment
- NAV staleness threshold is immutable after deployment
- Settlement requires: batch cutoff + flattened + fresh NAV
- Claims require: settled batch
- All deposits in a batch mint at the same locked clearing price
- Shares are escrowed during redemption, burned at settlement
- Pro-rata ratio preserves fairness when assets are insufficient

---

## 3) Deposit Queue Flow

### 3.1 User Deposit

```solidity
function queueDeposit(uint256 assets) external returns (uint256 requestId)
```

1. User calls `queueDeposit(assets)`
2. Assets transferred to vault
3. Request queued for next batch processing
4. Multiple deposits from same user in same target batch accumulate

### 3.2 Deposit Processing

```solidity
function processDepositQueue(
    uint256 batchId,
    uint256 startIndex,
    uint256 endIndex
) external onlyRole(DEPOSIT_PROCESSOR_ROLE)
```

- Can only be called for Flattening or Settling batches
- Mints shares based on `lockedClearingPrice` (set at flatten time)
- Ensures fair pricing: all deposits in batch get same price
- Chunked processing for gas efficiency (max 100 per call)

---

## 4) Redemption Flow (ERC-7540)

### 4.1 Request Redemption

```solidity
function requestRedeem(
    uint256 shares,
    address controller,
    address owner
) external returns (uint256 requestId)
```

- Returns unique `requestId`
- Shares transferred to vault and held in escrow
- Request enters Pending state
- Can be cancelled while batch is Open

### 4.2 Cancel Redemption

```solidity
function cancelRedeemRequest(uint256 requestId) external returns (uint256 cancelledShares)
```

- Only callable by controller
- Only while batch is Open (before cutoff)
- Returns shares to owner

### 4.3 Claim Redemption

```solidity
function redeem(
    uint256 requestId,
    uint256 shares,
    address receiver
) external returns (uint256 assets)
```

- Claims assets for redeemed shares
- Shares already burned at settlement
- Claims available only after batch reaches Settled state

---

## 5) Batch Settlement Flow

### 5.1 Cutoff Batch

```solidity
function cutoffBatch() external onlyRole(SNAPSHOT_ROLE)
```

- Closes deposits for current batch
- New deposits queue for next batch
- Redemptions frozen in place

### 5.2 Flatten Batch

```solidity
function flattenBatch(bytes32 snapshotHash) external onlyRole(SNAPSHOT_ROLE)
```

- Takes NAV snapshot
- Locks clearing price for deposit processing
- Creates next batch for new deposits
- Transitions to Flattening state

### 5.3 Settle Batch

```solidity
function settleBatch(
    uint256 batchId,
    uint256 availableAssets
) external onlyRole(SETTLER_ROLE)
```

- Requires: batch cutoff + flattened + fresh NAV
- Calculates pro-rata ratio if insufficient liquidity
- Burns escrowed shares, calculates claimable assets
- Transitions to Settled state

### 5.4 Close Batch

```solidity
function closeBatch(uint256 batchId) external onlyRole(SETTLER_ROLE)
```

- Called after claims window
- Transitions to Closed state

### 5.5 Reopen Batch

```solidity
function reopenBatch() external onlyRole(SETTLER_ROLE)
```

- Creates new batch
- Cycle begins again

---

## 6) Batch Schedule and Timing

### 6.1 Default Parameters

| Parameter               | Development      | Production       |
| ----------------------- | ---------------- | ---------------- |
| Batch Duration          | 1 hour (3600s)   | 7 days (604800s) |
| NAV Staleness Threshold | 6 hours (21600s) | 6 hours (21600s) |

### 6.2 Timing Configuration

Set via environment variables:

```bash
# apps/vault-api/.env
VAULT_1_BATCH_DURATION_SECONDS=3600  # Dev: 1 hour
VAULT_1_BATCH_DURATION_SECONDS=604800  # Prod: 7 days
```

### 6.3 Batch Schedule Example (Production)

```
Batch 0:  Jan 1 00:00 UTC -> Jan 8 00:00 UTC
Batch 1:  Jan 8 00:00 UTC -> Jan 15 00:00 UTC
Batch 2:  Jan 15 00:00 UTC -> Jan 22 00:00 UTC
...
```

### 6.4 Realization Cadence

1. **Open**: Deposits and redemption requests accepted
2. **Cutoff**: Deposits closed, redemptions frozen
3. **Flatten**: NAV locked, clearing price set
4. **Settlement**: Chunked processing, shares burned, assets calculated
5. **Claims**: Available immediately after settlement
6. **Close**: Claims window ended
7. **Reopen**: Next batch begins

---

## 7) Vault API Architecture

### 7.1 Provider Factory

File: `apps/vault-api/src/services/vaultProviderFactory.ts`

- Maps vault configs to provider instances
- Forces custom provider path for all vaults
- Creates `CustomVaultProvider` with batch configuration

### 7.2 Custom Provider

File: `apps/vault-api/src/services/customVaultProvider.ts`

Key methods:

- `getVaultInfo()` - Vault metadata and batch info
- `getBatchStatus(batchId)` - Batch state and timing
- `requestRedeem()` - Create redemption request
- `cancelRedemption()` - Cancel pending request
- `claimRedemption()` - Claim settled request
- `getUserRedemptionState()` - User's full redemption state

### 7.3 API Routes

Base: `/api/vaults`

| Endpoint                               | Method | Description               | Status                   |
| -------------------------------------- | ------ | ------------------------- | ------------------------ |
| `/:vaultId/redeem`                     | POST   | Create redemption request | Working                  |
| `/:vaultId/requests/:requestId`        | GET    | Get request status        | Working                  |
| `/:vaultId/requests/:requestId/claim`  | POST   | Claim redemption          | Working                  |
| `/:vaultId/requests/:requestId/cancel` | POST   | Cancel redemption         | Working                  |
| `/:vaultId/cycles/current`             | GET    | Current batch status      | **Broken until cutover** |
| `/:vaultId/cycles/:cycleId`            | GET    | Specific batch details    | **Broken until cutover** |
| `/:vaultId/redemptions`                | GET    | User's redemption state   | Working                  |
| `/:vaultId/info`                       | GET    | Vault metadata            | Working                  |
| `/:vaultId/deposit-queue`              | GET    | Deposit queue status      | Working                  |

### 7.4 Lifecycle Fields

API responses include these standardized fields:

```typescript
{
  queued: string; // Assets waiting in deposit queue
  queuedFormatted: string; // Human-readable
  escrowed: string; // Shares escrowed in settlement
  escrowedFormatted: string;
  claimableNow: string; // USDC available to claim now
  claimableNowFormatted: string;
  batchStatus: "Open" | "Cutoff" | "Flattening" | "Settling" | "Settled" | "Closed";
  currentBatchId: string;
}
```

---

## 8) Vault Web Architecture

### 8.1 API Client

File: `apps/vault-web/src/lib/api.ts`

Two prefixes:

- `VAULT_API_PREFIX = /vault` - Legacy/general operations
- `CUSTOM_VAULT_API_PREFIX = /api/vaults` - Batch redemption flow

### 8.2 Custom Hooks

File: `apps/vault-web/src/lib/hooks.ts`

Redemption hooks:

- `useRequestRedeem()` - Create redemption request
- `useRequests()` - Get user's redemption requests
- `useBatchStatus()` - Get batch status
- `useClaimRedemption()` - Claim redemption
- `useCancelRedemption()` - Cancel redemption

---

## 9) Configuration and Environment

### 9.1 Vault Config

File: `apps/vault-api/src/config/vaults/vault1-pph.ts`

```typescript
{
  id: 1,
  type: "custom",
  customVaultConfig: {
    batchDurationSeconds: 3600,  // or 604800 for prod
    navStalenessThresholdSeconds: 21600,
  },
  // ... other fields
}
```

### 9.2 Required Environment Variables

**apps/vault-api/.env:**

```bash
# Server
VAULT_PORT=3001
VAULT_SESSION_SECRET=...

# Database
VAULT_DATABASE_URL=postgresql://...

# RPC
POLYGON_RPC_URL=https://...

# Vault 1 Keys
VAULT_1_ALLOCATOR_NAV_KEY=...
VAULT_1_SAFE_OPERATOR_KEY=...
VAULT_1_TRADING_SIGNER_KEY=...

# Batch Configuration
VAULT_1_BATCH_DURATION_SECONDS=3600
```

**apps/vault-web/.env:**

```bash
NEXT_PUBLIC_REOWN_PROJECT_ID=...
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 10) Deprecated Components

### 10.1 Superseded Contracts

| Contract                   | Status     | Replacement                |
| -------------------------- | ---------- | -------------------------- |
| `WeeklyEpochVault.sol`     | DEPRECATED | `ClosedBookBatchVault.sol` |
| `SnapshotTrancheVault.sol` | DEPRECATED | `ClosedBookBatchVault.sol` |
| `EpochTrancheVault.sol`    | LEGACY     | `ClosedBookBatchVault.sol` |

### 10.2 Migration Notes

- `EpochTrancheVault` is still deployed on Amoy but superseded by `ClosedBookBatchVault`
- New deployments should use `ClosedBookBatchVault`
- Migration from old contracts requires full withdrawal and redeposit
- Carry mechanics from EpochTrancheVault are NOT present in ClosedBookBatchVault

### 10.3 Deprecated Endpoints

The following endpoints return explicit 410 Gone errors:

```
POST /api/vaults/:vaultId/legacy-claim -> Use POST /api/vaults/:vaultId/requests/:requestId/claim
GET /api/vaults/:vaultId/legacy-status -> Use GET /api/vaults/:vaultId/redemptions
```

---

## 11) Operational Runbook (Closed-Book Lifecycle)

### 11.1 Batch Lifecycle Procedures

#### Phase 1: Pre-Cutoff Preparation

**Checklist before cutoff:**

1. **Verify NAV freshness** (< 6 hours old):

   ```bash
   curl http://localhost:3001/api/vaults/1/nav-status
   ```

2. **Review pending redemption requests**:

   ```bash
   curl http://localhost:3001/api/vaults/1/redemptions
   ```

3. **Review deposit queue**:
   ```bash
   curl http://localhost:3001/api/vaults/1/deposit-queue
   ```

#### Phase 2: Cutoff Batch

**Trigger cutoff (SNAPSHOT_ROLE):**

```bash
curl -X POST http://localhost:3001/api/vaults/1/cycles/current/cutoff \
  -H "Content-Type: application/json"
```

**Cutoff effects:**

- Deposits now queue for next batch
- Redemptions frozen in place

**Verification:**

```bash
curl http://localhost:3001/api/vaults/1/cycles/current
# Check status: 'Cutoff'
```

#### Phase 3: Flatten Batch

**Trigger flatten (SNAPSHOT_ROLE):**

```bash
curl -X POST http://localhost:3001/api/vaults/1/cycles/current/flatten \
  -H "Content-Type: application/json" \
  -d '{"snapshotHash": "0x..."}'
```

**Flatten effects:**

- NAV locked at snapshot time
- Clearing price locked
- Next batch created
- Deposit queue can now be processed

#### Phase 4: Process Deposits

**Execute deposit processing (DEPOSIT_PROCESSOR_ROLE):**

```bash
curl -X POST http://localhost:3001/api/vaults/1/cycles/current/process-deposits \
  -H "Content-Type: application/json" \
  -d '{
    "startIndex": 0,
    "endIndex": 100
  }'
```

#### Phase 5: Settle Batch

**Execute settlement (SETTLER_ROLE):**

```bash
curl -X POST http://localhost:3001/api/vaults/1/cycles/current/settle \
  -H "Content-Type: application/json" \
  -d '{
    "availableAssets": "1000000000"
  }'
```

**Settlement effects:**

- Shares escrowed for redemption burned
- Claimable assets calculated
- Pro-rata ratio applied if needed

#### Phase 6: User Claims

**View claimable amounts:**

```bash
curl http://localhost:3001/api/vaults/1/redemptions
# Check 'claimableNow'
```

#### Phase 7: Close Batch

**Trigger close (SETTLER_ROLE):**

```bash
curl -X POST http://localhost:3001/api/vaults/1/cycles/current/close
```

#### Phase 8: Reopen

**Trigger reopen (SETTLER_ROLE):**

```bash
curl -X POST http://localhost:3001/api/vaults/1/cycles/reopen
```

---

## 12) Current Deployment Gap (IMPORTANT)

### 12.1 The Problem

The codebase targets `ClosedBookBatchVault`, but Amoy still runs `EpochTrancheVault`:

- **Amoy Deployment:** `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` (EpochTrancheVault)
- **Codebase Target:** ClosedBookBatchVault
- **Gap:** New contract deployment required

### 12.2 Affected Endpoints

| Endpoint              | Status on Current Amoy          | Works After Cutover |
| --------------------- | ------------------------------- | ------------------- |
| `/cycles/current`     | **BROKEN** - function not found | Yes                 |
| `/cycles/:id/flatten` | **BROKEN** - function not found | Yes                 |
| `/cycles/:id/settle`  | **BROKEN** - signature mismatch | Yes                 |
| `/epochs/current`     | Working (legacy)                | Removed             |
| Deposit queue         | Working                         | Yes                 |
| Redemption requests   | Partial                         | Yes                 |

### 12.3 QA Finding

Integrated QA confirmed `/cycles/current` fails against current Amoy deployment with:

```
Error: contract function not found: currentBatchId()
```

This is expected - the legacy contract uses `currentEpochId()` instead.

### 12.4 Operator Action

**Until cutover:**

- Use legacy `/epochs/*` endpoints
- Follow EpochTrancheVault procedures
- Reference legacy documentation in operator-runbook-amoy.md Appendix C

**After cutover:**

- Update contract address in config
- Switch to `/cycles/*` endpoints
- Follow procedures in this document

---

## 13) Change Checklist

Before coding:

- [ ] Read this file
- [ ] Open vault1 config, provider factory, and route files
- [ ] Confirm change targets ClosedBookBatchVault flow
- [ ] Check current deployment state (legacy vs new)

During coding:

- [ ] Keep vault config, provider config, API response shapes, and frontend hooks in sync
- [ ] Update contract ABI in `customVaultClient.ts` if adding new functions
- [ ] Add error mapping for new contract errors
- [ ] Test both happy path and error cases
- [ ] Account for deployment gap if working with current Amoy

After coding:

- [ ] Run `pnpm --filter vault-api build`
- [ ] Run `pnpm --filter vault-web build`
- [ ] For contracts: `forge build` and `forge test` in `contracts/`
- [ ] Verify endpoint paths used by frontend match mounted backend routes
- [ ] Update deployment gap documentation if state changed

---

## 14) Quick Commands

**Backend build:**

```bash
pnpm --filter vault-api build
```

**Frontend build:**

```bash
pnpm --filter vault-web build
```

**Contracts build:**

```bash
cd contracts
forge build
```

**Contracts test:**

```bash
cd contracts
forge test
```

**Full build:**

```bash
pnpm build
```

---

## 15) Architecture Diagram

```
                                    User
                                     |
                                     v
                            +--------+--------+
                            |   vault-web     |
                            |  (Next.js)      |
                            +--------+--------+
                                     |
                                     | HTTP / API
                                     v
                            +--------+--------+
                            |   vault-api     |
                            |  (Express)      |
                            +--------+--------+
                                     |
                    +----------------+----------------+
                    |                                 |
                    v                                 v
        +---------------------+           +---------------------+
        |  CustomVaultProvider|           |  Entitlement Repo   |
        |  (reads contract)   |           |  (tracks state)     |
        +----------+----------+           +---------------------+
                   |
                   | viem / RPC
                   v
        +---------------------+
        | ClosedBookBatchVault|
        | (Polygon Mainnet)   |
        +---------------------+
```

---

_Last updated: March 2026 - ClosedBookBatchVault migration in progress_
