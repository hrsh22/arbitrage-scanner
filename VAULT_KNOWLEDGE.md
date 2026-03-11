# VAULT_KNOWLEDGE.md

Canonical knowledge base for the vault stack in this repo.

Read this file before making any vault-related change in:

- `apps/vault-api/`
- `apps/vault-web/`
- `contracts/`

This document reflects the current EpochTrancheVault architecture (Wave 3).

---

## 1) Current Architecture at a Glance

The vault system uses **EpochTrancheVault** as the canonical smart contract for epoch-gated tranche carry management.

### Core Flow

```
Deposit:   queueDeposit -> (epoch advances) -> processDepositQueue -> mint shares
Redeem:    requestRedeem -> (epoch freeze/settle) -> redeem/withdraw with carry
Settlement: freezeEpoch -> settleEpoch -> finalizeEpoch
Carry:     Accrues at settlement, deducted on claim (pro-rata)
```

### Key Components

| Component          | File                                                 | Purpose                                                                |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Canonical Contract | `contracts/src/EpochTrancheVault.sol`                | Epoch-gated vault with deposit queue, redemption epochs, carry accrual |
| Backend Provider   | `apps/vault-api/src/services/customVaultProvider.ts` | Reads vault state, manages redemption flow                             |
| Backend Client     | `apps/vault-api/src/services/customVaultClient.ts`   | viem-based contract interactions                                       |
| API Routes         | `apps/vault-api/src/routes/customVaultRoutes.ts`     | REST endpoints for lifecycle operations                                |
| Frontend Hooks     | `apps/vault-web/src/lib/hooks.ts`                    | React hooks for vault interactions                                     |
| Frontend API       | `apps/vault-web/src/lib/api.ts`                      | API client for vault operations                                        |

### Primary Active Vault

- `vault1` configured in `apps/vault-api/src/config/vaults/vault1-pph.ts`
- `type: "custom"` with custom epoch settings (1 hour default in dev, 7 days in prod)
- Provider routing: `VaultProviderFactory` instantiates `CustomVaultProvider`

---

## 2) Smart Contract Layer (EpochTrancheVault)

### 2.1 Contract Overview

File: `contracts/src/EpochTrancheVault.sol`

Core model:

- **Deposit Queue**: Async deposits queued for next epoch minting
- **Redemption Epochs**: ERC-7540 async redemption with freeze/settle/finalize
- **Carry Accrual**: Pro-rata carry distribution per epoch
- **Snapshot-based Settlement**: NAV-locked settlement with freshness guards

### 2.2 Constructor Parameters

```solidity
constructor(
    address _asset,              // USDC or other ERC20
    address _admin,              // Admin role
    address _settler,            // Settlement role
    address _navUpdater,         // NAV update role
    address _snapshotter,        // Epoch freeze role
    address _depositProcessor,   // Deposit queue processor
    uint256 _epochDuration,      // Epoch duration in seconds
    uint256 _navStalenessThreshold,  // NAV freshness threshold
    uint256 _minClaimThreshold,  // Minimum claim amount (100 USDC default)
    uint256 _balancedUpfrontBps  // Balanced upfront basis points
)
```

### 2.3 Epoch Lifecycle (Corrected)

```
Active -> Frozen -> Settled -> Finalized
  |        |          |          |
  |        |          |          +-- All claims processed, dust override enabled
  |        |          +-- Claims available (carry applied), chunked settlement complete
  |        +-- Snapshot taken, NAV locked, requests frozen
  +-- Accepting deposits and redemption requests
```

**Key Semantics:**

1. **Freeze** (SNAPSHOT_ROLE): Locks cohort economics at boundary

   - Records immutable snapshot of pending requests, NAV, and epoch totals

   - Transitions all pending requests to `Frozen` status

   - Creates next epoch for new deposits/requests

   - No new requests accepted for frozen epoch

2. **Settlement** (SETTLER_ROLE): Processes frozen cohort in chunks

   - Requires: epoch ended + frozen + fresh NAV

   - Processes requests up to `maxSettlementChunkSize` per call (default: 100)

   - Updates per-user carry ledger (entitlement, accrued, claimed, carryRemaining)

   - Transitions requests to `Claimable` status

   - Resume cursor tracks progress for interrupted settlements

3. **Finalization** (SETTLER_ROLE): Marks epoch complete

   - Called after all claims processed

   - Enables dust override for residual balances below threshold

   - Epoch enters `Finalized` state (terminal)

```
Active -> Frozen -> Settled -> Finalized
  |        |          |          |
  |        |          |          +-- All claims processed
  |        |          +-- Claims available (carry applied)
  |        +-- Snapshot taken, NAV locked
  +-- Accepting deposits and redemption requests
```

### 2.4 Role Structure

| Role                     | Purpose                              |
| ------------------------ | ------------------------------------ |
| `ADMIN_ROLE`             | Emergency mode, admin functions      |
| `SETTLER_ROLE`           | Epoch settlement and finalization    |
| `NAV_UPDATER_ROLE`       | NAV updates with freshness checks    |
| `SNAPSHOT_ROLE`          | Epoch freezing and snapshot creation |
| `DEPOSIT_PROCESSOR_ROLE` | Processing deposit queue             |

### 2.5 Key Invariants
### 2.5 Key Invariants (Corrected)

- Epoch duration is immutable after deployment

- NAV staleness threshold is immutable after deployment

- Settlement requires: epoch ended + fresh NAV + frozen state

- Claims require: settled epoch + minimum threshold met (unless dust override)

- Carry is applied pro-rata at settlement, tracked in per-user ledger

- Frozen cohort economics are immutable (snapshot-based)

- Chunked settlement preserves deterministic ordering across chunks

- Ledger invariants: `0 <= claimed <= accrued <= entitlement`
- Epoch duration is immutable after deployment
- NAV staleness threshold is immutable after deployment
- Settlement requires: epoch ended + fresh NAV + frozen state
- Claims require: settled epoch + minimum threshold met
- Carry is applied pro-rata at settlement, deducted on claim

---

## 3) Deposit Queue Flow

### 3.1 User Deposit

```solidity
function queueDeposit(uint256 assets) external returns (uint256 requestId)
```

1. User calls `queueDeposit(assets)`
2. Assets transferred to vault
3. Request queued for next epoch processing
4. Multiple deposits from same user in same epoch accumulate

### 3.2 Deposit Processing

```solidity
function processDepositQueue(
    uint256 epochId,
    uint256 startIndex,
    uint256 endIndex
) external onlyRole(DEPOSIT_PROCESSOR_ROLE)
```

- Can only be called for Active or Frozen epochs
- Mints shares based on current NAV at processing time
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

- Returns unique `requestId` (not controller-aggregated)
- Shares transferred to vault
- Request enters Pending state
- Can be cancelled while epoch is Active

### 4.2 Cancel Redemption

```solidity
function cancelRedeemRequest(uint256 requestId) external returns (uint256 cancelledShares)
```

- Only callable by controller
- Only while epoch is Active (before freeze)
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
- Carry deducted automatically
- Minimum threshold enforced (100 USDC default)

```solidity
function withdraw(
    uint256 requestId,
    uint256 assets,
    address receiver
) external returns (uint256 shares)
```

- Alternative claim by specifying output amount
- Same carry mechanics as `redeem()`

---

## 5) Epoch Settlement Flow

### 5.1 Freeze Epoch

```solidity
function freezeEpoch(bytes32 snapshotHash) external onlyRole(SNAPSHOT_ROLE)
```

- Takes snapshot of current state
- Locks NAV at snapshot time
- Creates next epoch
- No new requests accepted for frozen epoch

### 5.2 Settle Epoch

```solidity
function settleEpoch(
    uint256 epochId,
    uint256 availableAssets,
    uint256 carryAmount
) external onlyRole(SETTLER_ROLE)
```

- Requires: epoch ended + frozen + fresh NAV
- Calculates pro-rata ratio if insufficient liquidity
- Accrues carry for the epoch
- Marks redemption requests as Claimable

### 5.3 Finalize Epoch

```solidity
function finalizeEpoch(uint256 epochId) external onlyRole(SETTLER_ROLE)
```

- Called after all claims processed
- Epoch enters Finalized state (terminal)

---

## 6) Carry Mechanics (Corrected Ledger Semantics)

### 6.1 Carry Ledger Fields

Per-user ledger tracks:

| Field | Description | Invariant |
| ----- | ----------- | --------- |
| `entitlement` | Total USDC entitled (deposits + realized gains) | Immutable after settlement |
| `accrued` | Carry eligible for claiming | `accrued >= claimed` |
| `claimed` | USDC already claimed | `claimed <= accrued` |
| `carryRemaining` | Outstanding carry obligation | `carryRemaining = entitlement - accrued` |

### 6.2 Carry Accrual at Settlement

```

userAccrued += (userShares * epochCarry * proRataRatio) / 1e36

```

- Carry accrues at epoch settlement
- Applied pro-rata based on shares and settlement ratio
- Stored in `epoch.carryAccrued` per epoch

### 6.3 Carry Deduction on Claim

```

carryDeducted = (assets * epoch.carryAccrued) / 1e18

netAssets = assets - carryDeducted

```

- Deducted automatically on claim
- Carry remaining updates: `carryRemaining -= carryDeducted`

### 6.4 Minimum Claim Threshold

Default: **100 USDC** (configurable at deployment)

- Prevents micro-claims that waste gas
- Enforced in both `redeem()` and `withdraw()`
- Error: `BelowClaimThreshold(uint256 amount, uint256 threshold)`
- **Dust Override**: Bypassed after tranche finalization

---

## 7) Epoch Schedule and Timing

### 7.1 Default Parameters

| Parameter               | Development      | Production       |
| ----------------------- | ---------------- | ---------------- |
| Epoch Duration          | 1 hour (3600s)   | 7 days (604800s) |
| NAV Staleness Threshold | 6 hours (21600s) | 6 hours (21600s) |
| Minimum Claim Threshold | 100 USDC         | 100 USDC         |

### 7.2 Timing Configuration

Set via environment variables:

```bash
# apps/vault-api/.env
VAULT_1_EPOCH_DURATION_SECONDS=3600  # Dev: 1 hour
VAULT_1_EPOCH_DURATION_SECONDS=604800  # Prod: 7 days
```

### 7.3 Epoch Schedule Example (Production)

```
Epoch 0:  Jan 1 00:00 UTC -> Jan 8 00:00 UTC
Epoch 1:  Jan 8 00:00 UTC -> Jan 15 00:00 UTC
Epoch 2:  Jan 15 00:00 UTC -> Jan 22 00:00 UTC
...
```

### 7.4 Realization Cadence (Corrected)

1. **Epoch Active**: Deposits and redemption requests accepted
2. **Freeze**: Snapshot taken, NAV locked, requests frozen
3. **Settlement**: Chunked processing, carry accrued, requests become claimable
4. **Claims**: Available immediately after settlement (threshold enforced)
5. **Finalization**: After all claims processed, dust override enabled

## 8) Vault API Architecture

### 8.1 Provider Factory

File: `apps/vault-api/src/services/vaultProviderFactory.ts`

- Maps vault configs to provider instances
- Forces custom provider path for all vaults
- Creates `CustomVaultProvider` with epoch configuration

### 8.2 Custom Provider

File: `apps/vault-api/src/services/customVaultProvider.ts`

Key methods:

- `getVaultInfo()` - Vault metadata and epoch info
- `getEpochStatus(epochId)` - Epoch state and timing
- `requestRedeem()` - Create redemption request
- `cancelRedemption()` - Cancel pending request
- `claimRedemption()` - Claim settled request
- `getUserRedemptionState()` - User's full redemption state

### 8.3 API Routes

Base: `/api/vaults`

| Endpoint                               | Method | Description                 |
| -------------------------------------- | ------ | --------------------------- |
| `/:vaultId/redeem`                     | POST   | Create redemption request   |
| `/:vaultId/requests/:requestId`        | GET    | Get request status          |
| `/:vaultId/requests/:requestId/claim`  | POST   | Claim redemption            |
| `/:vaultId/requests/:requestId/cancel` | POST   | Cancel redemption           |
| `/:vaultId/epochs/current`             | GET    | Current epoch status        |
| `/:vaultId/epochs/:epochId`            | GET    | Specific epoch details      |
| `/:vaultId/redemptions`                | GET    | User's redemption state     |
| `/:vaultId/info`                       | GET    | Vault metadata              |
| `/:vaultId/deposit-queue`              | GET    | Deposit queue status        |
| `/:vaultId/tranche-status`             | GET    | Tranche progress with carry |
| `/:vaultId/carry-eligibility`          | GET    | Carry claim eligibility     |

### 8.4 Lifecycle Fields

API responses include these standardized fields:

```typescript
{
  queued: string; // Assets waiting in deposit queue
  queuedFormatted: string; // Human-readable
  frozen: string; // Shares frozen in epoch
  frozenFormatted: string;
  accrued: string; // Total realized USDC
  accruedFormatted: string;
  claimed: string; // Total USDC already claimed
  claimedFormatted: string;
  claimableNow: string; // USDC available to claim now
  claimableNowFormatted: string;
  minClaimThreshold: string; // 100 USDC default
  minClaimThresholdFormatted: string;
}
```

---

## 9) Vault Web Architecture

### 9.1 API Client

File: `apps/vault-web/src/lib/api.ts`

Two prefixes:

- `VAULT_API_PREFIX = /vault` - Legacy/general operations
- `CUSTOM_VAULT_API_PREFIX = /api/vaults` - Epoch redemption flow

### 9.2 Custom Hooks

File: `apps/vault-web/src/lib/hooks.ts`

Redemption hooks:

- `useRequestRedeem()` - Create redemption request
- `useRequests()` - Get user's redemption requests
- `useEpochStatus()` - Get epoch status
- `useClaimRedemption()` - Claim redemption
- `useCancelRedemption()` - Cancel redemption

Tranche-carry hooks:

- `useDepositQueue()` - Deposit queue status
- `useTrancheStatus()` - Tranche progress
- `useCarryEligibility()` - Carry claim eligibility

---

## 10) Configuration and Environment

### 10.1 Vault Config

File: `apps/vault-api/src/config/vaults/vault1-pph.ts`

```typescript
{
  id: 1,
  type: "custom",
  customVaultConfig: {
    epochDurationSeconds: 3600,  // or 604800 for prod
    navStalenessThresholdSeconds: 21600,
  },
  // ... other fields
}
```

### 10.2 Required Environment Variables

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

# Epoch Configuration
VAULT_1_EPOCH_DURATION_SECONDS=3600
```

**apps/vault-web/.env:**

```bash
NEXT_PUBLIC_REOWN_PROJECT_ID=...
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 11) Deprecated Components

### 11.1 Superseded Contracts

| Contract                   | Status     | Replacement             |
| -------------------------- | ---------- | ----------------------- |
| `WeeklyEpochVault.sol`     | DEPRECATED | `EpochTrancheVault.sol` |
| `SnapshotTrancheVault.sol` | DEPRECATED | `EpochTrancheVault.sol` |

### 11.2 Migration Notes

- `WeeklyEpochVault` and `SnapshotTrancheVault` are superseded by `EpochTrancheVault`
- Old contract files remain for reference but are not deployed
- All new deployments use `EpochTrancheVault`
- Migration from old contracts requires full withdrawal and redeposit

### 11.3 Deprecated Endpoints

The following endpoints return explicit 410 Gone errors:

```
POST /api/vaults/:vaultId/legacy-claim -> Use POST /api/vaults/:vaultId/requests/:requestId/claim
GET /api/vaults/:vaultId/legacy-status -> Use GET /api/vaults/:vaultId/redemptions
```

---

## 12) Operational Runbook (Corrected Lifecycle)

### 12.1 Epoch Lifecycle Procedures

#### Phase 1: Pre-Freeze Preparation

**Checklist before freezing:**

1. **Verify NAV freshness** (< 6 hours old):
   ```bash
   curl http://localhost:3001/api/vaults/1/nav-status
   ```

2. **Review pending redemption requests**:
   ```bash
   curl http://localhost:3001/api/vaults/1/epochs/current
   ```

3. **Ensure epoch has ended** (or will end at freeze time):
   ```bash
   curl http://localhost:3001/api/vaults/1/epochs/1
   # Check 'ended' field
   ```

#### Phase 2: Freeze Epoch

**Trigger freeze (SNAPSHOT_ROLE):**

```bash
# Contract call via backend or direct
curl -X POST http://localhost:3001/api/vaults/1/epochs/current/freeze \
  -H "Content-Type: application/json" \
  -d '{"snapshotHash": "0x..."}'
```

**Freeze effects:**
- All pending requests transition to `Frozen` status
- Cohort economics snapshot recorded (immutable)
- NAV locked at freeze time
- Next epoch becomes active immediately

**Verification:**
```bash
curl http://localhost:3001/api/vaults/1/epochs/1
# Check status: 'frozen'
# Check frozenAt timestamp
```

#### Phase 3: Chunked Settlement

**Settlement parameters:**

| Parameter | Description | Default |
| --------- | ----------- | ------- |
| `maxChunkSize` | Max requests per chunk | 100 |
| `availableAssets` | Total assets available for redemption | Varies |
| `carryAmount` | Total carry to distribute | Varies |

**Execute chunked settlement (SETTLER_ROLE):**

```bash
# First chunk
curl -X POST http://localhost:3001/api/vaults/1/epochs/1/settle \
  -H "Content-Type: application/json" \
  -d '{
    "availableAssets": "1000000000",
    "carryAmount": "50000000",
    "maxChunkSize": 100
  }'

# Check settlement progress
curl http://localhost:3001/api/vaults/1/epochs/1
# Check 'settlementProgress' and 'processedCount'

# Resume with next chunk if incomplete
curl -X POST http://localhost:3001/api/vaults/1/epochs/1/settle \
  -H "Content-Type: application/json" \
  -d '{
    "availableAssets": "1000000000",
    "carryAmount": "50000000",
    "maxChunkSize": 100
  }'
```

**Settlement completion criteria:**
- All requests processed (processedCount == totalRequests)
- Status transitions to 'settled'
- Carry accrued to per-user ledgers
- Requests become 'claimable'

#### Phase 4: User Claims

**View claimable amounts:**

```bash
curl http://localhost:3001/api/vaults/1/redemptions
# Check 'claimableNow' and 'carryRemaining'
```

**Threshold enforcement:**
- Claims below 100 USDC are blocked with `BelowClaimThreshold`
- Users can accumulate across epochs to meet threshold

#### Phase 5: Finalize Epoch

**Trigger finalization (SETTLER_ROLE):**

```bash
curl -X POST http://localhost:3001/api/vaults/1/epochs/1/finalize
```

**Finalization effects:**
- Epoch enters 'finalized' state (terminal)
- Dust override enabled for residual balances
- No further claims possible for this epoch

---

### 12.2 Chunked Settlement Procedures

**When to use chunked settlement:**
- Cohort size > 100 redemption requests
- Gas limit concerns for large cohorts
- Need for resumable settlement after interruptions

**Chunking mechanics:**

1. **Cursor-based resume**: Contract tracks `lastProcessedIndex`
2. **Deterministic ordering**: Requests processed in epoch order
3. **Idempotent chunks**: Safe to retry same chunk (no double processing)

**Monitoring settlement progress:**

```bash
# Watch settlement events
curl http://localhost:3001/api/vaults/1/events?type=SettlementProgress

# Check epoch status
curl http://localhost:3001/api/vaults/1/epochs/1 | jq '.settlement'
```

**Failure recovery:**

| Scenario | Recovery Action |
|----------|----------------|
| Transaction reverts | Fix condition (NAV staleness, wrong state), retry same chunk |
| Partial processing | Retry chunk, cursor ensures no duplicates |
| Settlement timeout | Check gas limits, reduce chunk size |

---

### 12.3 Dust Override Procedures

**Dust override eligibility:**

Enabled ONLY after epoch finalization. Allows claims below 100 USDC threshold.

**Check dust override status:**

```bash
curl http://localhost:3001/api/vaults/1/epochs/1 | jq '.dustOverrideEnabled'
```

**Claim with dust override:**

```bash
# Same claim endpoint, threshold check bypassed for finalized epochs
curl -X POST http://localhost:3001/api/vaults/1/requests/0x.../claim \
  -H "Content-Type: application/json" \
  -d '{"shares": "50000000"}'
```

**Important:** Dust override is FINAL. Once enabled, no further claims from this epoch.

---

### 12.4 Reconciliation Procedures

**When to reconcile:**
- After settlement completion
- Before finalization
- Periodic integrity checks
- Suspicion of ledger drift

**Reconciliation checks:**

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Contract vs Repository | `pnpm --filter vault test -- reconciliation` | Zero unexplained deltas |
| Ledger invariants | `pnpm --filter vault test -- ledger-invariants` | All invariants pass |
| Per-user balances | `curl /api/vaults/1/carry-eligibility` | Matches on-chain state |

**Ledger invariant equations:**

```
0 <= claimed <= accrued <= entitlement
carryRemaining = entitlement - accrued (>= 0)
conservation: sum(claimed) + sum(carryRemaining) = totalRealized (within rounding)
```

**Manual reconciliation:**

```bash
# Generate reconciliation report
curl -X POST http://localhost:3001/api/vaults/1/reconcile \
  -H "Content-Type: application/json" \
  -d '{"epochId": 1}'
```

**Handling mismatches:**

| Mismatch Type | Action |
|---------------|--------|
| Contract > Repository | Re-ingest events, check for missed settlements |
| Repository > Contract | Check for stale cached state, refresh from chain |
| Carry calculation drift | Verify pro-rata math matches contract exactly |

---

### 12.5 Failure Handling and Rollback

**Settlement failure scenarios:**

| Error | Cause | Resolution |
|-------|-------|------------|
| `EpochNotFrozen` | Called settle before freeze | Complete freeze first |
| `NAVStale` | NAV > 6 hours old | Update NAV via oracle |
| `EpochNotEnded` | Epoch still active | Wait for epoch end time |
| `SettlementIncomplete` | Partial settlement, resume needed | Continue chunked settlement |

**Rollback procedures:**

**Cannot rollback:**
- Freeze (immutable snapshot)
- Settlement (carry already accrued)
- Claims (assets already transferred)

**Emergency procedures:**

```bash
# Enable emergency mode (ADMIN_ROLE)
curl -X POST http://localhost:3001/api/vaults/1/emergency \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Effects:
# - New deposits blocked
# - New redemption requests blocked
# - Existing claims still allowed
# - Settlement paused

# Disable emergency mode
curl -X POST http://localhost:3001/api/vaults/1/emergency \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

**Escalation path:**

1. **Level 1**: Check logs and error messages
2. **Level 2**: Verify contract state directly via RPC
3. **Level 3**: Contact contract admin for emergency intervention

---

### 12.6 Deprecated Behaviors and Replacements

| Deprecated | Replacement | Status |
|------------|-------------|--------|
| `requestId` as unique ID | Controller address as identifier | `requestId` always returns 0 per ERC-7540 |
| `Settled` status | `Claimable` status | Renamed for clarity |
| `Cancelled` status | Request deletion (no status) | Cancellation removes request |
| Unbounded settlement | Chunked settlement with cursor | Gas-bounded processing |
| Immediate mint on deposit | Delayed mint at epoch open | Fair pricing semantics |
| Static carry calculation | Ledger-based carry tracking | Loss attribution support |

**API endpoint changes:**

| Old Endpoint | New Endpoint | Response Change |
|--------------|--------------|-----------------|
| `POST /legacy-claim` | `POST /requests/:id/claim` | Returns 410 Gone with guidance |
| `GET /legacy-status` | `GET /redemptions` | Returns 410 Gone with guidance |

**Status value mappings (contract):**

| Old | New | Value |
|-----|-----|-------|
| `Pending` | `Pending` | 0 (unchanged) |
| `Cancelled` | *deleted* | n/a |
| `Settled` | `Claimable` | 2 |
| `Claimed` | `Claimed` | 3 |

---
## 13) Change Checklist

Before coding:

- [ ] Read this file
- [ ] Open vault1 config, provider factory, and route files
- [ ] Confirm change targets EpochTrancheVault flow

During coding:

- [ ] Keep vault config, provider config, API response shapes, and frontend hooks in sync
- [ ] Update contract ABI in `customVaultClient.ts` if adding new functions
- [ ] Add error mapping for new contract errors
- [ ] Test both happy path and error cases

After coding:

- [ ] Run `pnpm --filter vault-api build`
- [ ] Run `pnpm --filter vault-web build`
- [ ] For contracts: `forge build` and `forge test` in `contracts/`
- [ ] Verify endpoint paths used by frontend match mounted backend routes

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
        |  (reads contract)   |           |  (tracks carry)     |
        +----------+----------+           +---------------------+
                   |
                   | viem / RPC
                   v
        +---------------------+
        | EpochTrancheVault   |
        | (Polygon Mainnet)   |
        +---------------------+
```

---

_Last updated: March 4, 2026 - EpochTrancheVault Wave 3_
