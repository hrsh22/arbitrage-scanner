# ClosedBook Contract-Owned Lifecycle Refactor

## Goal

Move lifecycle control for `ClosedBookBatchVault` from backend-driven procedural steps to deterministic contract-owned timing with keeper-safe, idempotent maintenance.

## Scope

### Contract

- Reintroduce immutable `EPOCH_DURATION` and use `EpochMath` to derive batch start/end from `DEPLOY_TIME`.
- Stop using mutable `currentBatchId`/`reopenBatch()` as the lifecycle clock.
- Make batch timing/phase contract-owned; expose derived current batch and derived batch phase.
- Preserve deposit semantics: deposits queue for next batch.
- Preserve redemption semantics: requests enter the current active batch before batch end.
- Keep settlement and deposit processing chunked and idempotent.
- Exclude queued deposits and reserved redemption assets from pricing.

### Backend/API/Web

- Remove route-driven lifecycle progression.
- Remove implicit lifecycle authority from `LiquidityManager` and user-facing routes.
- Keep backend as explicit keeper/monitor only.
- Read derived batch state from contract instead of reconstructing it procedurally.

## Planned Changes

### 1. Contract schedule and phase model

- Add `uint256 public immutable EPOCH_DURATION` to `contracts/src/ClosedBookBatchVault.sol`.
- Import and use `contracts/src/libraries/EpochMath.sol`.
- Add derived helpers:
  - `currentBatchId()`
  - `getCurrentBatch()`
  - `getBatchStart(uint256)`
  - `getBatchEnd(uint256)`
  - `getBatchStatus(uint256)`
- Make `Batch.startTime`/`Batch.endTime` deterministic from epoch math when batches are created or read.
- Treat `Open` vs `Cutoff` as time-driven; only irreversible checkpoints remain stored (`isPriceLocked`, settlement progress, settled state).

### 2. Contract lifecycle writes

- Refactor `queueDeposit` and `requestRedeem` to use derived current batch instead of mutable storage.
- Refactor cancellation guards to depend on whether the target batch is still open by time/phase.
- Refactor `flattenBatch` to take explicit `batchId` and require:
  - batch exists or is lazily initialized
  - batch is ended by time
  - price not already locked
  - NAV is fresh
- Remove operational dependence on `reopenBatch`; new batches are available from schedule.
- Remove backend-controlled early cutoff behavior.
- Keep `settleBatch`, `settleBatchChunk`, `resumeSettlement`, and `processDepositQueue` explicit by `batchId` and idempotent.

### 3. Backend/provider/client refactor

- Update `customVaultClient.ts` ABI and wrappers for new contract surface.
- Update `customVaultProvider.ts` to:
  - read derived current batch/phase
  - resolve earliest actionable unsettled batch instead of assuming current batch
  - stop using reopen semantics
- Update `liquidityManager.ts` to separate keeper maintenance from liquidity rebalance logic.
- Keep worker execution explicit; no user-facing route should trigger lifecycle writes.

### 4. Route/web hardening

- Keep all custom route reads side-effect free.
- Remove any remaining hidden settlement/reconciliation triggers for custom vaults.
- Update web hooks/types to consume derived batch phase and explicit queue status.

### 5. Verification

- Update `contracts/test/ClosedBookBatchVault.t.sol` for time-driven lifecycle using `vm.warp`.
- Add tests for:
  - batch phase boundaries
  - deposits target next batch by schedule
  - redemptions belong to current active batch
  - no reopen required for progression
  - flatten only after batch end
  - settlement/deposit processing remain idempotent and cursor-safe
- Run:
  - `forge test --match-contract ClosedBookBatchVaultTest`
  - `pnpm --filter vault build`
  - `pnpm --filter vault-web build`

## Risks / Watch Items

- Off-by-one boundary behavior at exact epoch end must be deterministic.
- Existing backend assumptions around `currentBatchId + 1` may break if not updated together.
- Claims and rescue accounting must remain safe after removing reopen/close from operational flow.
- Flatten/settle ordering must stay auditable for overdue batches.

## Acceptance Criteria

- No route or frontend action can secretly advance batch lifecycle.
- Contract timing alone determines when a batch is open or ended.
- Deposits/redemptions map to batches deterministically by time.
- Keeper operations are explicit, batch-scoped, and idempotent.
- Tests and builds pass.
