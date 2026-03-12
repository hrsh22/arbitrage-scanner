# T11: Closed-Book Batch Vault Lifecycle Scripts

## Task Description

Automate lifecycle scripts and operator assertions for the closed-book batch vault, scoped to scripts and script-facing verification only.

## Closed-Book Batch Lifecycle Flow

The new lifecycle is:

```
requestDeposit → cutoffBatch → flattenBatch → processDepositQueue → settleBatch → claim → reopenBatch
```

### Batch Status Enum

| Status     | Value | Description                           |
| ---------- | ----- | ------------------------------------- |
| Open       | 0     | Accepting deposits and redemptions    |
| Cutoff     | 1     | Deposits closed, redemptions frozen   |
| Flattening | 2     | NAV snapshot taken, price locked      |
| Settling   | 3     | Settlement in progress                |
| Settled    | 4     | Settlement complete, claims available |
| Closed     | 5     | Claims window ended                   |
| Reopen     | 6     | Ready to start next cycle             |

### Key Differences from EpochTrancheVault

| Aspect              | EpochTrancheVault                 | ClosedBookBatchVault                        |
| ------------------- | --------------------------------- | ------------------------------------------- |
| Time unit           | Epoch                             | Batch/Cycle                                 |
| Deposit processing  | Immediate mint                    | Queued until flatten                        |
| Price determination | Current NAV                       | Locked clearing price at flatten            |
| Redemption          | Request → Freeze → Settle → Claim | Request → Cutoff → Flatten → Settle → Claim |
| Capital deployment  | deployCapital()                   | Not present                                 |
| Capital recall      | recallCapital()                   | Not present                                 |

### Critical Evidence Points

1. **Batch ID**: Tracked via `getCurrentBatch()`
2. **Flatness Check**: `isPriceLocked` boolean + `lockedClearingPrice` value
3. **Settlement Progress**: `getSettlementProgress(batchId)` returns (processed, total, lastIndex, isComplete)
4. **NAV Freshness**: `isNAVFresh()` boolean check

## Files Modified

### 1. scripts/amoy-lifecycle-test.sh

- Updated for closed-book batch flow
- Steps: Deposit → Verify → Cutoff → Flatten → Process Deposits → Settle → Reopen
- Tracks batch IDs, flatness checks, and locked clearing price evidence

### 2. scripts/run-regression-matrix.sh

- Updated terminology from "dual-safe" to "closed-book batch"
- Updated test functions for batch lifecycle
- Renamed env vars from EPOCH*TRANCHE*_ to CBBV\__

### 3. contracts/scripts/verify-amoy-deployment.sh

- Updated to verify ClosedBookBatchVault instead of EpochTrancheVault
- Added batch/cycle getters: `getCurrentBatch()`, `getBatchStatus()`
- Added flatness checks: `isPriceLocked`, `lockedClearingPrice`
- Removed epoch-specific getters: `currentEpochId()`, `genesisTimestamp()`
- Added NAV-related checks: `isNAVFresh()`, `currentNAV()`, `lastNAVUpdate()`

## Environment Variables

### Required for amoy-lifecycle-test.sh

```bash
VAULT_ADDRESS                    # ClosedBookBatchVault contract address
DEPOSITOR_PRIVATE_KEY           # Private key of depositor
ADMIN_PRIVATE_KEY               # Private key with ADMIN_ROLE
SNAPSHOTTER_PRIVATE_KEY         # Private key with SNAPSHOT_ROLE
DEPOSIT_PROCESSOR_PRIVATE_KEY   # Private key with DEPOSIT_PROCESSOR_ROLE
SETTLER_PRIVATE_KEY             # Private key with SETTLER_ROLE
```

### Required for run-regression-matrix.sh (Amoy)

```bash
VAULT_NETWORK=amoy
CBBV_ASSET_ADDRESS              # USDC.e address
CBBV_ADMIN_ADDRESS              # Admin address
CBBV_SETTLER_ADDRESS            # Settler address
CBBV_SNAPSHOTTER_ADDRESS        # Snapshotter address (required)
```

## Validation Commands

```bash
# Syntax check all scripts
bash -n scripts/amoy-lifecycle-test.sh
bash -n scripts/run-regression-matrix.sh
bash -n contracts/scripts/verify-amoy-deployment.sh

# Dry-run lifecycle test (shows help/validation)
VAULT_ADDRESS=0x1234... ./scripts/amoy-lifecycle-test.sh 2>&1 | head -20

# Run regression matrix (dry-run mode)
VAULT_NETWORK=amoy ./scripts/run-regression-matrix.sh --skip-readiness
```

## Operator Assertions

The scripts verify:

1. **Batch Status Transitions**: Open → Cutoff → Flattening → Settled
2. **Flatness Readiness**: `isPriceLocked` must be true after flatten
3. **Locked Clearing Price**: Non-zero value set after flatten
4. **Settlement Progress**: Tracks processed/total requests
5. **Reopen Ready**: Batch must be Settled before reopen

## Date

2026-03-11
