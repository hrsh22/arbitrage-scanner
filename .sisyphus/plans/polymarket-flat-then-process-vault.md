# Polymarket Flat-Then-Process Vault

## TL;DR

> **Summary**: Replace open-position pricing with a closed-book async vault. Deposits and redemptions queue during a trading cycle, the cycle is sealed before users can exploit known-but-unsettled outcomes, trading stops and the book is flattened, then the queued batch is processed from realized cash basis at one post-flat clearing price before the next cycle opens.
> **Deliverables**:
>
> - Closed-book contract/runtime state machine with explicit `OPEN -> CUTOFF -> FLATTENING -> SETTLING -> REOPEN`
> - Queue semantics for deposits and redemptions that never price against open-position marks
> - Flatness detector, forced-unwind/starvation policy, operator runbook, and new deployment cutover
> - Full contract/API/UI/worker verification for batch clearing and anti-sniping behavior
>   **Effort**: XL
>   **Parallel**: YES - 3 waves
>   **Critical Path**: T1 batch-seal semantics -> T2 flatness detector -> T3 canonical contract target -> T4 clearing price math -> T6 runtime close-on-flat -> T7 API/provider lifecycle -> T9 UI -> T15 cutover

## Context

### Original Request

- Avoid users sniping stale or lagging Polymarket prices.
- Prevent any user from taking other users' money.
- Keep the vault specifically compatible with Polymarket market structure.

### Interview Summary

- User initially explored boundary-priced open-position cohorts, then identified the core risk: fast-moving open-position prices can be stale and snipable.
- User explicitly chose the safer model: stack requests, close the book, flatten positions, then process the batch once flat.
- User selected `Flat-then-process` over scheduled flat windows.
- Safety and anti-gaming are more important than continuous liquidity.

### Architecture Decisions Locked

- **Supported model**: closed-book async batching only; no deposit or redemption pricing while positions are open.
- **Canonical contract target**: create a new `ClosedBookEpochVault.sol` instead of mutating `EpochTrancheVault.sol` into another incompatible mode.
- **Queue model**: deposits and redemptions are accepted into settlement batches; pricing occurs only after the batch is sealed and the portfolio is flat.
- **Batch sealing rule**: the first accepted request in `OPEN` creates the next settlement batch and immediately moves the vault into `CUTOFF`; requests submitted after cutoff are assigned to the following batch, not the current one.
- **Cancellation rule**: requests are cancelable only while the vault remains `OPEN`; once `CUTOFF` begins, the active batch is sealed and immutable.
- **Trading rule**: no new positions may be opened once the vault enters `CUTOFF`; all resting orders must be cancelled before `FLATTENING` is considered valid.
- **Flatness definition**: a vault is flat only when all five conditions are true: (1) zero open Polymarket positions for the trading wallet, (2) zero resting orders on the CLOB, (3) `deployedCapital == 0`, (4) zero non-dust CTF/outcome-token balances, and (5) the latest reconciliation pass succeeds.
- **Clearing price rule**: one post-flat clearing price is computed from realized cash basis after flattening and before processing deposits for the sealed batch.
- **Asset formula**: `batchClearingAssets = flatVaultUsdcBalance - sealedBatchQueuedDeposits - feesAccruedForBatch - reservedOperationalDust`, floored at zero.
- **Share formula**: `batchClearingPrice = floor(batchClearingAssets / totalSharesAtSettlement)` where `totalSharesAtSettlement` includes escrowed redemption shares because those holders still participate in the cycle until settlement.
- **Redemption handling**: redemption requests escrow shares at request time but do not burn them until settlement; settlement burns escrowed shares and pays `shares * batchClearingPrice`.
- **Deposit handling**: sealed-batch deposits mint after the clearing price is locked using `shares = floor(assets / batchClearingPrice)`; operational cash may net deposits against withdrawals only after price lock.
- **Fairness rule**: using sealed-batch netting after price lock is allowed, because no user is being priced against open-position marks and deposits are not changing the clearing price.
- **Starvation policy**: if flatness is not reached within `MAX_FLATTENING_WINDOW`, the vault forces unwind according to explicit slippage limits; if unwind still fails, the vault enters emergency pause and cannot reopen.
- **Reopen rule**: the next trading cycle opens only after the sealed batch is fully processed, reconciliation passes, and no settlement errors remain.
- **Migration rule**: deliver the closed-book model as a fresh deployment; the current vault remains legacy and is not migrated in place.

### Metis Review (gaps addressed)

- Metis flagged ambiguity around “flat”; resolved here with five explicit flatness conditions.
- Metis flagged starvation risk; resolved with `MAX_FLATTENING_WINDOW`, forced unwind policy, and emergency pause if flattening fails.
- Metis flagged late-entry sniping risk during flattening; resolved by sealing the batch at `CUTOFF` and assigning later requests to the next batch.
- Metis flagged state-machine desync risk; resolved by making contract state the source of truth and requiring successful reconciliation before reopening.
- Metis flagged operator abuse risk; resolved by separating cutoff/settle roles and requiring explicit runbook + forced public recovery path after timeout.

## Work Objectives

### Core Objective

- Deliver a Polymarket vault where users only enter and exit at post-flat batch clearing prices derived from realized cash basis, making stale-price sniping impossible and ensuring no value transfer from open-position marks.

### Deliverables

- New closed-book contract surface with queueing, cutoff, flattening, settlement, and reopen states.
- Runtime automation for close-on-flat behavior, flatness detection, and forced-unwind handling.
- API/UI lifecycle for queued, sealed, flattening, settling, claimable, and reopened states.
- Runbook and deployment package for a fresh staging and production cutover.

### Definition of Done (verifiable conditions with commands)

- `forge test --match-test "testFirstRequestSealsBatchAndBlocksCurrentCycleEntries|testEscrowedRedeemSharesStillParticipateUntilSettlement|testBatchClearingUsesPostFlatRealizedCashBasis|testDepositsDoNotChangeClearingPriceBeforeLock|testSettlementBlockedUntilFlatnessConditionsHold|testForceUnwindAfterMaxFlatteningWindow|testRequestsAfterCutoffRollToNextBatch"` passes in `contracts/`
- `pnpm --filter vault test -- --run src/__tests__/settlementLifecycle.integration.test.ts src/__tests__/customVaultRoutes.test.ts src/__tests__/tradingOrchestrator.test.ts src/__tests__/reconciliation.test.ts` passes in `apps/vault-api`
- `pnpm --filter vault build` passes in `apps/vault-api`
- `pnpm --filter vault-web build` passes in `apps/vault-web`
- `pnpm build` passes at repo root
- `pnpm --filter vault-web exec playwright test e2e/redemption.spec.ts e2e/erc7540-lifecycle.spec.ts` passes
- A staging lifecycle rehearsal proves: request -> cutoff -> flatten -> settle -> claim -> reopen
- No API/UI/docs surface says deposits or withdrawals are priced while positions remain open

### Must Have

- A sealed batch before flattening begins.
- Flatness gate enforced mechanically, not by operator judgment alone.
- One realized-cash clearing price per sealed batch.
- Escrowed redemption shares counted economically until settlement.
- Forced-unwind and emergency-pause policies with explicit thresholds.
- Fresh deployment and clear legacy-vault separation.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No open-position pricing for deposits or withdrawals.
- No late requests joining the active sealed batch.
- No reopening trading before settlement + reconciliation complete.
- No in-place mutation of the current live vault state.
- No gradual realization or cohort-carry support in this plan.
- No cancellation after cutoff.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after with Forge, Vitest, Playwright, and lifecycle shell scripts
- QA policy: every task includes a happy-path and failure-path scenario with executable commands or selectors
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. Lock batch semantics first, then wire runtime and UX, then validate release.

Wave 1: state machine, flatness rules, contract surface, pricing/netting math, forced-unwind policy
Wave 2: runtime automation, provider/API lifecycle, schema/repository alignment, UI lifecycle, scripts automation
Wave 3: regression, E2E/manual QA, docs/runbook, deployment scripts, staging rehearsal/cutover

### Dependency Matrix (full, all tasks)

- T1 -> T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15
- T2 -> T3, T4, T5, T6, T7, T8, T10, T11, T12, T14, T15
- T3 -> T4, T6, T7, T8, T10, T11, T12, T14, T15
- T4 -> T7, T8, T9, T10, T11, T12, T14, T15
- T5 -> T6, T10, T11, T13, T14, T15
- T6 -> T7, T8, T9, T10, T11, T12, T13, T14, T15
- T7 -> T9, T10, T11, T12, T13, T14, T15
- T8 -> T9, T10, T11, T12, T13, T14, T15
- T9 -> T11, T12, T13, T14, T15
- T10 -> T11, T12, T13, T14, T15
- T11 -> T12, T13, T14, T15
- T12 -> T13, T14, T15
- T13 -> T14, T15
- T14 -> T15

### Agent Dispatch Summary (wave -> task count -> categories)

- Wave 1 -> 5 tasks -> `deep`, `ultrabrain`, `unspecified-high`
- Wave 2 -> 5 tasks -> `deep`, `unspecified-high`, `visual-engineering`, `quick`
- Wave 3 -> 5 tasks -> `deep`, `unspecified-high`, `writing`, `quick`

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Lock the closed-book batch state machine and sealing rules

  **What to do**: Define the canonical state machine and batch assignment rules across contract, provider, worker, and API docs: `OPEN -> CUTOFF -> FLATTENING -> SETTLING -> REOPEN`. Seal the active batch at cutoff, assign later requests to the next batch, and define cancellation/immutability rules around the cutoff boundary.
  **Must NOT do**: Do not allow request intake rules to differ between contract and runtime. Do not leave “late joiners” ambiguous.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This locks the lifecycle everything else depends on.
  - Skills: []
  - Omitted: [`playwright`] — not user-facing yet.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: T2-T15 | Blocked By: none

  **References**:
  - `contracts/src/WeeklyEpochVault.sol`
  - `contracts/src/EpochTrancheVault.sol`
  - `apps/vault-api/src/services/claimStateMachine.ts`
  - `apps/vault-api/src/repositories/withdrawalRepository.ts`

  **Acceptance Criteria**:
  - [ ] One canonical state machine exists across contract/runtime/API.
  - [ ] The first request in `OPEN` seals the active batch and later requests route to the next batch.
  - [ ] Cancellation is impossible after `CUTOFF`.

  **QA Scenarios**:

  ```text
  Scenario: First request seals the batch
    Tool: Bash
    Steps: Run contract/provider test where one request arrives in OPEN and a second request arrives after cutoff.
    Expected: The second request is assigned to the next batch, not the sealed batch.
    Evidence: .sisyphus/evidence/task-1-batch-seal.txt

  Scenario: Cancellation blocked after cutoff
    Tool: Bash
    Steps: Create a request, transition to CUTOFF, then attempt cancel.
    Expected: Cancel reverts or returns structured rejection.
    Evidence: .sisyphus/evidence/task-1-cutoff-cancel.txt
  ```

  **Commit**: YES | Message: `docs(vault): lock closed-book batch lifecycle` | Files: `contracts/src/ClosedBookEpochVault.sol`, `apps/vault-api/src/services/claimStateMachine.ts`, `apps/vault-api/src/repositories/withdrawalRepository.ts`

- [ ] 2. Build the flatness detector and settlement-gate policy

  **What to do**: Implement the five-condition flatness detector and make it the only gate for settlement execution. Add runtime checks for zero open positions, zero resting orders, zero deployed capital, zero non-dust outcome-token balances, and successful reconciliation. Expose machine-readable reasons when flatness is not yet achieved.
  **Must NOT do**: Do not let operators bypass flatness with a manual boolean. Do not settle while any one flatness condition is false.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This prevents the core stale-price bug class.
  - Skills: []
  - Omitted: [`playwright`] — backend only.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T3-T15 | Blocked By: T1

  **References**:
  - `apps/vault-api/src/services/tradingOrchestrator.ts`
  - `apps/vault-api/src/services/customVaultProvider.ts`
  - `apps/vault-api/src/services/positionFetcher.ts`
  - `apps/vault-api/src/services/vaultHealthMonitor.ts`

  **Acceptance Criteria**:
  - [ ] Settlement path checks all five flatness conditions.
  - [ ] API/worker output exposes the exact blocking condition when flatness is false.
  - [ ] Flatness is rechecked immediately before settlement execution.

  **QA Scenarios**:

  ```text
  Scenario: Settlement blocked by non-flat portfolio
    Tool: Bash
    Steps: Run provider/worker test with one remaining open position or resting order.
    Expected: Settlement is rejected and the blocking condition is returned.
    Evidence: .sisyphus/evidence/task-2-flatness-block.txt

  Scenario: Flatness passes only when all conditions are true
    Tool: Bash
    Steps: Satisfy conditions one by one and rerun flatness check.
    Expected: Flatness flips to true only when all five conditions pass.
    Evidence: .sisyphus/evidence/task-2-flatness-all-clear.txt
  ```

  **Commit**: YES | Message: `feat(vault): enforce flatness gate before settlement` | Files: `apps/vault-api/src/services/tradingOrchestrator.ts`, `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/services/vaultHealthMonitor.ts`

- [ ] 3. Implement the canonical closed-book contract surface

  **What to do**: Create `ClosedBookEpochVault.sol` by reusing the best queue and settlement patterns from `WeeklyEpochVault.sol` and `EpochTrancheVault.sol`. Support deposit queueing, redemption share escrow, batch ids, cutoff, flattening, settlement, claiming, and reopen state without any carry/gradual-realization fields.
  **Must NOT do**: Do not keep open-position cohort-carry fields in the canonical v1 contract. Do not mutate the old contract into a dual-mode mess.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` — Reason: New contract target + queue escrow semantics are the highest-risk correctness layer.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T4, T6-T15 | Blocked By: T1, T2

  **References**:
  - `contracts/src/WeeklyEpochVault.sol`
  - `contracts/src/EpochTrancheVault.sol`
  - `contracts/src/SnapshotTrancheVault.sol`

  **Acceptance Criteria**:
  - [ ] New contract supports queued deposits, escrowed redemptions, sealed batches, and reopen flow.
  - [ ] Escrowed redemption shares remain in supply until settlement.
  - [ ] No open-position pricing or carry fields remain in the canonical contract path.

  **QA Scenarios**:

  ```text
  Scenario: Escrowed redemption shares remain economically live
    Tool: Bash
    Steps: Request redeem, then settle after realized P/L changes during flattening.
    Expected: Escrowed shares receive the final clearing price, then burn at settlement.
    Evidence: .sisyphus/evidence/task-3-escrowed-shares.txt

  Scenario: New contract has no carry semantics
    Tool: Bash
    Steps: Grep the new contract for carry/accrual/partial-realization fields and run build.
    Expected: Closed-book contract compiles without unsupported carry logic.
    Evidence: .sisyphus/evidence/task-3-no-carry-surface.txt
  ```

  **Commit**: YES | Message: `feat(contracts): add closed-book epoch vault` | Files: `contracts/src/ClosedBookEpochVault.sol`, `contracts/flattened/ClosedBookEpochVault.flattened.sol`

- [x] 4. Define post-flat clearing price and operational netting math

  **What to do**: Implement the single post-flat clearing price based on realized cash basis. Price withdrawals and deposits from the same locked clearing price, computed before any deposit cash changes the price. Allow operational netting of batch deposits and withdrawals only after that price is fixed.
  **Must NOT do**: Do not include sealed-batch deposit cash in the numerator before clearing price lock. Do not price redemptions from anything except post-flat realized assets.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This is the core fairness math.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T7-T15 | Blocked By: T1, T2, T3

  **References**:
  - `contracts/src/WeeklyEpochVault.sol`
  - `contracts/src/EpochTrancheVault.sol`
  - `apps/vault-api/src/services/customVaultProvider.ts`

  **Acceptance Criteria**:
  - [ ] Clearing price numerator excludes sealed-batch deposits before price lock.
  - [ ] Deposits and redemptions in the same batch clear at the same locked price.
  - [ ] Netting is operational only and does not affect price formation.

  **QA Scenarios**:

  ```text
  Scenario: Deposits do not move the locked clearing price
    Tool: Bash
    Steps: Run settlement with non-zero sealed deposits and compare price before and after mint processing.
    Expected: Price is unchanged because it is locked before minting.
    Evidence: .sisyphus/evidence/task-4-price-lock.txt

  Scenario: Netting is price-neutral
    Tool: Bash
    Steps: Run one settlement with netting and one without netting.
    Expected: User-level economic outputs match exactly.
    Evidence: .sisyphus/evidence/task-4-netting-neutrality.txt
  ```

  **Commit**: YES | Message: `fix(vault): lock post-flat batch clearing math` | Files: `contracts/src/ClosedBookEpochVault.sol`, `apps/vault-api/src/services/customVaultProvider.ts`

- [ ] 5. Add starvation, force-unwind, and emergency-pause rules

  **What to do**: Define and implement `MAX_FLATTENING_WINDOW`, forced-unwind slippage caps, and emergency-pause rules if the book cannot be flattened. Add public/operator recovery actions and prevent reopening if flattening or settlement is incomplete.
  **Must NOT do**: Do not leave users in indefinite limbo without explicit timeout behavior. Do not reopen after a failed flattening attempt.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: This spans contract, runtime, and operator policy.
  - Skills: []
  - Omitted: [`playwright`] — no browser work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T6, T10-T15 | Blocked By: T1, T2

  **References**:
  - `contracts/src/SnapshotTrancheVault.sol`
  - `apps/vault-api/src/services/tradingOrchestrator.ts`
  - `apps/vault-api/src/config/alerts.ts`

  **Acceptance Criteria**:
  - [ ] Flattening timeout triggers forced-unwind flow.
  - [ ] Slippage-cap breach triggers emergency pause instead of unsafe unwind.
  - [ ] Reopen is blocked until settlement succeeds or the vault is explicitly in emergency state.

  **QA Scenarios**:

  ```text
  Scenario: Force unwind after timeout
    Tool: Bash
    Steps: Simulate a stuck flattening window beyond `MAX_FLATTENING_WINDOW`.
    Expected: Forced-unwind path begins and is observable in status output.
    Evidence: .sisyphus/evidence/task-5-force-unwind.txt

  Scenario: Emergency pause on slippage breach
    Tool: Bash
    Steps: Simulate flattening that requires prices beyond configured caps.
    Expected: Vault enters emergency pause and does not reopen.
    Evidence: .sisyphus/evidence/task-5-slippage-pause.txt
  ```

  **Commit**: YES | Message: `feat(vault): add flattening timeout and emergency rules` | Files: `contracts/src/ClosedBookEpochVault.sol`, `apps/vault-api/src/services/tradingOrchestrator.ts`, `apps/vault-api/src/config/alerts.ts`

- [ ] 6. Wire runtime close-on-flat automation

  **What to do**: Update worker/orchestrator logic so `OPEN` trading stops immediately when a batch is sealed, all resting orders are cancelled, recall/unwind begins, flatness is monitored, and settlement is triggered only after flatness passes.
  **Must NOT do**: Do not leave new trade paths active after cutoff. Do not assume cancellation/recall succeeded without verification.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Runtime behavior must actually match the closed-book plan.
  - Skills: []
  - Omitted: [`playwright`] — backend only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T7-T15 | Blocked By: T1, T2, T3, T5

  **References**:
  - `apps/vault-api/src/services/tradingOrchestrator.ts`
  - `apps/vault-api/src/tradingWorker.ts`
  - `apps/vault-api/src/services/liquidityManager.ts`

  **Acceptance Criteria**:
  - [ ] New trading stops on cutoff.
  - [ ] Resting orders are cancelled before flatness can pass.
  - [ ] Settlement trigger waits for flatness success and cannot front-run it.

  **QA Scenarios**:

  ```text
  Scenario: Cutoff halts trading immediately
    Tool: Bash
    Steps: Create first batch request, then attempt another scan/trade cycle.
    Expected: Trading cycle is blocked due to non-OPEN state.
    Evidence: .sisyphus/evidence/task-6-cutoff-halt.txt

  Scenario: Settlement waits for flatness
    Tool: Bash
    Steps: Move to cutoff with one open position remaining, then run settlement worker.
    Expected: Settlement does not start until flattening completes.
    Evidence: .sisyphus/evidence/task-6-settlement-gate.txt
  ```

  **Commit**: YES | Message: `feat(worker): automate close-on-flat settlement flow` | Files: `apps/vault-api/src/services/tradingOrchestrator.ts`, `apps/vault-api/src/tradingWorker.ts`, `apps/vault-api/src/services/liquidityManager.ts`

- [x] 7. Rebuild provider and API lifecycle semantics for closed-book batches

  **What to do**: Replace open-position lifecycle semantics with batch lifecycle payloads: queued batch id, active state, cutoff time, flattening blockers, settlement status, clearing price, claimable redemptions, and minted deposits. Expose the active and next batch separately.
  **Must NOT do**: Do not expose mutable mark-to-market estimates for queued entries/exits. Do not keep old carry or partial-realization fields in custom-vault APIs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: This changes the external truth surface.
  - Skills: []
  - Omitted: [`playwright`] — API first.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T8-T15 | Blocked By: T1, T2, T3, T4, T6

  **References**:
  - `apps/vault-api/src/services/customVaultProvider.ts`
  - `apps/vault-api/src/routes/customVaultRoutes.ts`
  - `apps/vault-api/src/services/claimStateMachine.ts`

  **Acceptance Criteria**:
  - [ ] API distinguishes current sealed batch vs next batch.
  - [ ] API exposes flattening blockers and clearing price only after settlement lock.
  - [ ] No route claims users are being priced while positions remain open.

  **QA Scenarios**:

  ```text
  Scenario: API batch lifecycle truthfulness
    Tool: Bash
    Steps: Curl status endpoints through OPEN, CUTOFF, FLATTENING, SETTLING, and REOPEN states.
    Expected: Payload fields match the closed-book lifecycle exactly.
    Evidence: .sisyphus/evidence/task-7-api-lifecycle.txt

  Scenario: No mark-to-market estimates remain
    Tool: Bash
    Steps: Grep custom-vault routes/provider payloads for open-position pricing text.
    Expected: No mutable entry/exit estimate fields remain in the closed-book path.
    Evidence: .sisyphus/evidence/task-7-no-open-pricing.txt
  ```

  **Commit**: YES | Message: `feat(api): expose closed-book batch lifecycle` | Files: `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/services/claimStateMachine.ts`

- [x] 8. Align schema and repositories to batch ids and sealed processing

  **What to do**: Introduce canonical batch ids, sealed-batch deposit/redemption records, settlement snapshots, and reopen markers in the database layer. Reuse useful queue patterns from `withdrawalRepository.ts` but remove assumptions that custom vaults settle off open-position estimates.
  **Must NOT do**: Do not leave custom-vault persistence split across incompatible legacy and new queue semantics.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Data-model correctness is essential for batch routing.
  - Skills: []
  - Omitted: [`playwright`] — backend only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T9-T15 | Blocked By: T1, T3, T6, T7

  **References**:
  - `apps/vault-api/src/db/schema.ts`
  - `apps/vault-api/src/repositories/withdrawalRepository.ts`
  - `apps/vault-api/src/repositories/epochRepository.ts`

  **Acceptance Criteria**:
  - [ ] Batch ids and settlement snapshots are first-class data model concepts.
  - [ ] Custom-vault repository paths no longer depend on open-position estimate history.
  - [ ] State transitions are valid and idempotent across retries.

  **QA Scenarios**:

  ```text
  Scenario: Batch routing is persistent and idempotent
    Tool: Bash
    Steps: Create requests before and after cutoff, restart worker, and re-read persisted rows.
    Expected: Requests stay assigned to the correct batch across retries.
    Evidence: .sisyphus/evidence/task-8-batch-routing.txt

  Scenario: Legacy estimate-path removed for custom vault
    Tool: Bash
    Steps: Grep repository layer for `estimateHistory` and legacy custom-vault write paths.
    Expected: Closed-book custom-vault flow no longer stores open-position estimate revisions.
    Evidence: .sisyphus/evidence/task-8-no-estimate-history.txt
  ```

  **Commit**: YES | Message: `refactor(vault-api): persist sealed settlement batches` | Files: `apps/vault-api/src/db/schema.ts`, `apps/vault-api/src/repositories/*.ts`

- [x] 9. Rebuild the vault UI around the closed-book cycle

  **What to do**: Update the vault UI to show queued requests by batch, active vault state, cutoff/sealed messaging, flattening progress, settlement progress, claimable redemptions, and minted deposits. Make it explicit that users are waiting for the cycle to close and flatten, not for mark-to-market pricing.
  **Must NOT do**: Do not show “estimated shares at current NAV” or “estimated redemption at current NAV” in the closed-book path.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: The lifecycle explanation is central to trust here.
  - Skills: [`frontend-ui-ux`] — user communication is critical.
  - Omitted: [`playwright`] — verified later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T11-T15 | Blocked By: T6, T7, T8

  **References**:
  - `apps/vault-web/app/vault/[id]/vault-detail.tsx`
  - `apps/vault-web/app/vault/[id]/components/PendingRequests.tsx`
  - `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx`
  - `apps/vault-web/src/lib/hooks.ts`

  **Acceptance Criteria**:
  - [ ] UI distinguishes current cycle, sealed batch, flattening, settling, and reopen states.
  - [ ] No current-NAV estimates remain for queued deposits or redemptions.
  - [ ] Late requests clearly show they are assigned to the next batch.

  **QA Scenarios**:

  ```text
  Scenario: Sealed-batch UI renders correctly
    Tool: Playwright
    Steps: Load `/vault/1` with fixtures for OPEN, CUTOFF, FLATTENING, SETTLING, and REOPEN.
    Expected: State banners, batch ids, and request cards match the lifecycle.
    Evidence: .sisyphus/evidence/task-9-ui-cycle.png

  Scenario: No current-NAV estimate text remains
    Tool: Bash
    Steps: Grep vault-web for `current NAV`, `estimated shares`, and `estimated redemption` strings in custom-vault views.
    Expected: Closed-book path contains no open-position estimate copy.
    Evidence: .sisyphus/evidence/task-9-ui-copy-audit.txt
  ```

  **Commit**: YES | Message: `feat(vault-web): show closed-book batch lifecycle` | Files: `apps/vault-web/app/vault/[id]/*`, `apps/vault-web/src/lib/*`

- [x] 10. Add contract and backend regression coverage for batch fairness

  **What to do**: Add Forge and Vitest coverage for batch sealing, next-batch routing, flatness gating, escrow-share economics, price lock, forced unwind, and reopen gating. Make the new closed-book batch path the primary regression spine.
  **Must NOT do**: Do not rely only on happy-path tests. Do not leave next-batch routing or escrow economics implicit.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: The plan is only safe if invariant-tested.
  - Skills: []
  - Omitted: [`playwright`] — separate task.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T11-T15 | Blocked By: T2, T3, T4, T5, T6, T7, T8

  **References**:
  - `contracts/test/EpochTrancheVault.t.sol`
  - `apps/vault-api/src/__tests__/settlementLifecycle.integration.test.ts`
  - `apps/vault-api/src/__tests__/tradingOrchestrator.test.ts`
  - `apps/vault-api/src/__tests__/reconciliation.test.ts`

  **Acceptance Criteria**:
  - [ ] Targeted Forge tests cover sealed batches, escrowed shares, and clearing-price neutrality.
  - [ ] Vitest suites cover flatness gating, cutoff behavior, and reopen safety.
  - [ ] Regression names map directly to plan invariants.

  **QA Scenarios**:

  ```text
  Scenario: Forge closed-book regression suite passes
    Tool: Bash
    Steps: Run the targeted Forge command from Definition of Done.
    Expected: All listed closed-book tests pass.
    Evidence: .sisyphus/evidence/task-10-forge-regressions.txt

  Scenario: Vitest closed-book lifecycle suite passes
    Tool: Bash
    Steps: Run the targeted Vitest command from Definition of Done.
    Expected: All listed lifecycle tests pass.
    Evidence: .sisyphus/evidence/task-10-vitest-lifecycle.txt
  ```

  **Commit**: YES | Message: `test(vault): cover closed-book batch invariants` | Files: `contracts/test/*`, `apps/vault-api/src/__tests__/*`

- [x] 11. Automate lifecycle scripts and operator assertions

  **What to do**: Add or update scripts to exercise request intake, cutoff, flatten, settlement, claim, and reopen for staging. Include assertions for flatness, batch ids, and clearing price evidence so operator runs are reproducible.
  **Must NOT do**: Do not leave operator verification as manual memory or screenshots only.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: This is tooling and reproducibility work.
  - Skills: []
  - Omitted: [`playwright`] — not the focus.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T12-T15 | Blocked By: T6, T7, T8, T10

  **References**:
  - `scripts/amoy-lifecycle-test.sh`
  - `scripts/run-regression-matrix.sh`
  - `contracts/scripts/verify-amoy-deployment.sh`

  **Acceptance Criteria**:
  - [ ] Staging lifecycle scripts cover the closed-book path end to end.
  - [ ] Script output includes batch id, state transitions, flatness checks, and clearing price evidence.
  - [ ] Scripts fail loudly on non-flat settlement attempts.

  **QA Scenarios**:

  ```text
  Scenario: Closed-book lifecycle script passes
    Tool: Bash
    Steps: Run the staging lifecycle script against the new contract.
    Expected: Script reaches reopen state with recorded evidence.
    Evidence: .sisyphus/evidence/task-11-lifecycle-script.txt

  Scenario: Non-flat settlement script fails loudly
    Tool: Bash
    Steps: Run the same script with one flatness condition intentionally broken.
    Expected: Script exits non-zero and prints the blocking condition.
    Evidence: .sisyphus/evidence/task-11-lifecycle-failure.txt
  ```

  **Commit**: YES | Message: `chore(vault): automate closed-book lifecycle scripts` | Files: `scripts/*`, `contracts/scripts/*`

- [x] 12. Deliver integrated API/UI/E2E QA

  **What to do**: Run and expand API and Playwright scenarios covering request queueing, next-batch routing, cutoff banners, flattening progress, settlement completion, claims, and reopen. Verify both desktop and mobile rendering.
  **Must NOT do**: Do not ship without browser verification of the new lifecycle.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: This is the integrated user-facing verification pass.
  - Skills: [`playwright`] — browser automation is mandatory.
  - Omitted: []

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T13-T15 | Blocked By: T7, T8, T9, T10, T11

  **References**:
  - `apps/vault-web/e2e/redemption.spec.ts`
  - `apps/vault-web/e2e/erc7540-lifecycle.spec.ts`
  - `apps/vault-api/src/__tests__/customVaultRoutes.test.ts`

  **Acceptance Criteria**:
  - [ ] API and UI both reflect the closed-book lifecycle correctly.
  - [ ] No console errors or stale-price language appear.
  - [ ] Next-batch routing is visible and testable in the UI.

  **QA Scenarios**:

  ```text
  Scenario: Browser closed-book replay
    Tool: Playwright
    Steps: Run desktop and mobile lifecycle tests through queue -> cutoff -> flatten -> settle -> claim -> reopen.
    Expected: UI flow is correct and console stays clean.
    Evidence: .sisyphus/evidence/task-12-playwright.txt

  Scenario: API next-batch routing replay
    Tool: Bash
    Steps: Submit requests before and after cutoff, then query API request status.
    Expected: Responses show different batch ids as expected.
    Evidence: .sisyphus/evidence/task-12-api-batch-routing.txt
  ```

  **Commit**: YES | Message: `test(vault): verify closed-book lifecycle end to end` | Files: `apps/vault-web/e2e/*`, `apps/vault-api/src/__tests__/*`

- [x] 13. Update runbooks, disclosures, and operator workflow docs

  **What to do**: Rewrite docs to describe the closed-book cycle, queue sealing, flatness rules, forced unwind, emergency pause, settlement claims, and reopen workflow. Update user-facing disclosures around wait time and no-liquidity guarantee during open cycles.
  **Must NOT do**: Do not leave any wording that implies continuous liquidity or open-position pricing.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: This is primarily documentation and operational clarity.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T14, T15 | Blocked By: T7, T9, T10, T11, T12

  **References**:
  - `docs/operator-runbook-amoy.md`
  - `VAULT_KNOWLEDGE.md`
  - `apps/vault-web/app/vault/[id]/vault-detail.tsx`

  **Acceptance Criteria**:
  - [ ] Operator docs define flatness, cutoff, forced unwind, settlement, and reopen.
  - [ ] User-facing disclosures explain that requests wait until the cycle is flat and settled.
  - [ ] No docs describe open-position pricing as supported.

  **QA Scenarios**:

  ```text
  Scenario: Docs terminology audit
    Tool: Bash
    Steps: Grep docs/UI copy for `current NAV`, `mark-to-market settlement`, and continuous-liquidity wording.
    Expected: Only closed-book cycle wording remains.
    Evidence: .sisyphus/evidence/task-13-docs-audit.txt

  Scenario: Runbook completeness check
    Tool: Bash
    Steps: Read runbook sections for cutoff, flattening, settlement, emergency pause, and reopen.
    Expected: All five operator procedures exist with concrete commands.
    Evidence: .sisyphus/evidence/task-13-runbook-completeness.txt
  ```

  **Commit**: YES | Message: `docs(vault): document closed-book settlement cycle` | Files: `docs/operator-runbook-amoy.md`, `VAULT_KNOWLEDGE.md`, `apps/vault-web/*`

- [x] 14. Prepare deployment scripts and config for the new vault

  **What to do**: Add deployment/verification scripts, flattened contract workflow, and runtime config for the new `ClosedBookEpochVault` deployment. Keep the current vault config as legacy and add explicit config switching instructions.
  **Must NOT do**: Do not overwrite the current live vault config in place without a separate closed-book deployment artifact.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: This is deployment packaging work.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T15 | Blocked By: T3, T11, T13

  **References**:
  - `contracts/scripts/deployEpochTrancheVault.js`
  - `contracts/scripts/flattenEpochTrancheVaultForRemix.sh`
  - `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`

  **Acceptance Criteria**:
  - [ ] New deployment scripts target the closed-book contract.
  - [ ] Runtime config supports explicit selection of legacy vs closed-book vault.
  - [ ] Verification scripts return the expected new state machine and role layout.

  **QA Scenarios**:

  ```text
  Scenario: Closed-book deployment verification
    Tool: Bash
    Steps: Deploy to staging and run verification script against the new address.
    Expected: Script confirms the new contract surface and state machine.
    Evidence: .sisyphus/evidence/task-14-deploy-verify.txt

  Scenario: Legacy/new config split check
    Tool: Bash
    Steps: Read config files and grep for both legacy and new vault addresses.
    Expected: Config switching is explicit and non-destructive.
    Evidence: .sisyphus/evidence/task-14-config-split.txt
  ```

  **Commit**: YES | Message: `chore(vault): prepare closed-book deployment package` | Files: `contracts/scripts/*`, `apps/vault-api/src/config/vaults/*`

- [x] 15. Execute staging rehearsal and produce the production cutover package

  **What to do**: Rehearse the full closed-book lifecycle on staging, capture evidence, produce rollback instructions, and document the production cutover as a fresh deployment. Explicitly keep the current vault as legacy and non-migrated.
  **Must NOT do**: Do not promote without a full staging replay. Do not present in-place migration as a supported path.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: This is the release gate and final package.
  - Skills: []
  - Omitted: [`playwright`] — already covered.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: F1, F2, F3, F4 | Blocked By: T4, T6, T7, T8, T9, T10, T11, T12, T13, T14

  **References**:
  - `scripts/amoy-lifecycle-test.sh`
  - `scripts/run-regression-matrix.sh`
  - `contracts/deployments/*`
  - `docs/operator-runbook-amoy.md`

  **Acceptance Criteria**:
  - [ ] Staging replay proves request intake, cutoff, flatten, settlement, claim, and reopen.
  - [ ] Rollback package is config-based and keeps the legacy vault untouched.
  - [ ] Production cutover checklist is complete and evidence-backed.

  **QA Scenarios**:

  ```text
  Scenario: Full staging replay passes
    Tool: Bash
    Steps: Run the staging lifecycle and regression scripts against the new deployment.
    Expected: The vault returns to REOPEN with evidence for each phase.
    Evidence: .sisyphus/evidence/task-15-staging-replay.txt

  Scenario: Rollback package is complete
    Tool: Bash
    Steps: Read the cutover package and verify legacy/new address routing and rollback instructions.
    Expected: Rollback is explicit and does not mutate the legacy vault state.
    Evidence: .sisyphus/evidence/task-15-rollback-package.txt
  ```

  **Commit**: YES | Message: `chore(vault): finalize closed-book cutover package` | Files: `scripts/*`, `contracts/deployments/*`, `docs/*`

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- One commit per task.
- New contract surface lands before runtime/API/UI migration.
- Flatness automation lands before docs and deployment packaging.
- Staging rehearsal and cutover package land only after regression and E2E are green.

## Success Criteria

- No deposit or redemption is ever priced from open-position marks.
- A sealed batch cannot be modified by later requests.
- The book cannot settle until flatness is mechanically proven.
- Escrowed redeemers keep cycle exposure until settlement, then burn/claim at one realized clearing price.
- Deposits and withdrawals may net operationally, but only after the clearing price is locked.
- The rollout path is a fresh deployment with staging replay, not an in-place mutation of the current live vault.
