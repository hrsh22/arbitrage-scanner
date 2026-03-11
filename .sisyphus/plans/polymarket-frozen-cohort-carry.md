# Polymarket Frozen Cohort Carry

## TL;DR

> **Summary**: Redesign the Polymarket vault into a time-boundary cohort system with dual boundary prices per epoch: an exit-side price for freezing withdrawals and an entry-side price for minting queued deposits. Later free cash is distributed oldest-cohort-first without repricing frozen exits or letting entrants mint too cheaply off sell-side marks.
> **Deliverables**:
>
> - Canonical three-bucket accounting across queued deposits, active shareholders, and frozen cohort liabilities
> - Contract/runtime/API/UI support for boundary-priced cohorts with asynchronous cash fulfillment
> - Deterministic cohort waterfall, threshold-gated claims, insolvency handling, and operator procedures
> - Full regression, E2E, and deployment-cutover plan for a new vault deployment
>   **Effort**: XL
>   **Parallel**: YES - 3 waves
>   **Critical Path**: T1 accounting model -> T2 boundary NAV hardening -> T3 contract cohort ledger -> T5 waterfall allocator -> T7 repository/runtime activation -> T9 API/provider lifecycle -> T11 UI -> T15 cutover

## Context

### Original Request

- Plan the right model for Polymarket positions that will often span epochs.
- Keep the vault safe against users taking value from other users.
- Prefer the economically safest production model, not hacks.

### Interview Summary

- User explicitly chose the model: freeze economics at the boundary, then fulfill cash later as liquidity frees.
- Deposits must stay queued until issuance and must never fund prior withdrawal cohorts.
- Withdrawals must lock an entitlement at the boundary and must never be repriced afterward.
- Positions will often span epochs, so strict same-epoch settlement is not sufficient.
- The vault is specifically for Polymarket, so the pricing/oracle model must match Polymarket market structure.

### Architecture Decisions Locked

- **Boundary definition**: a boundary is the epoch time boundary only; no NAV-threshold or event-driven cohort creation.
- **Canonical price rails**: every epoch has `exitBoundaryPrice` for withdrawals and `entryBoundaryPrice` for deposits.
- **Exit-side formula**: `exitBoundaryPrice = floor(exitNetAssets / activeShareSupply)` using conservative liquidation marks for open positions.
- **Entry-side formula**: `entryBoundaryPrice = ceil(entryNetAssets / activeShareSupply)` using conservative replacement-cost marks for open positions.
- **Active net assets**: `currentNAV - queuedDepositAssets - openCohortLiabilityRemaining`, where `openCohortLiabilityRemaining = sum(entitlement - claimed)` across all non-closed cohorts.
- **Net-asset variants**: both `exitNetAssets` and `entryNetAssets` subtract queued deposits and open cohort liabilities; they differ only in how open positions are valued (sell-side vs buy-side).
- **Queued deposits**: remain non-share-bearing and non-deployable until processed at their target boundary.
- **Deposit continuity**: queued deposits may still mint at each successful boundary even while older cohorts remain unpaid, because entry-side pricing excludes all open cohort liabilities before minting.
- **Withdrawals**: burn/lock shares at request time, freeze `entitlement = floor(shares * exitBoundaryPrice)` at the next included boundary, and never reprice later.
- **Deposits**: mint `shares = floor(assets / entryBoundaryPrice)` at the next included boundary and never inherit prior cohort liabilities.
- **Cutoff rule**: the inclusion set for each boundary is sealed at the scheduled epoch timestamp, not at the later execution timestamp.
- **Blocked-boundary rule**: if conservative pricing is unavailable at the scheduled boundary, freeze/issuance execution is delayed but the inclusion set does not change; new requests and new deposits after the scheduled cutoff roll to the next epoch, not the delayed one.
- **Asynchronous fulfillment**: later free cash is allocated to frozen cohorts; only payout timing is gradual, never economics.
- **Waterfall priority**: oldest open cohort first; within a cohort, pro-rata by each request's remaining liability; residual dust from division goes by ascending `requestId`.
- **Claim threshold**: use the existing on-chain minimum claim threshold; keep dust override only when cohort is fully accrued/finalized.
- **Free cash definition**: `vaultUsdcBalance - queuedDepositAssets - unclaimedAllocatedCohortCash`, floored at zero.
- **Trading policy**: if any cohort has unpaid liability, every positive unit of free cash must be allocated to the oldest cohort before any new idle cash deployment.
- **Position ownership model**: do NOT build per-position cohort ownership graphs; frozen cohorts are senior fixed liabilities funded from later global free cash.
- **Boundary oracle rule**: do NOT use cost-basis fallback for either boundary price. If fresh conservative bid-side marks are unavailable, exit-side pricing is blocked. If fresh conservative ask-side/replacement-cost marks are unavailable, entry-side pricing is blocked. If a boundary needs both rails and either rail is blocked, boundary execution is blocked and alerted.
- **Undercollateralization rule**: if later realizations prove liabilities cannot be fully covered, pause deposits and new trading, recall capital, satisfy oldest cohorts first, and apply terminal pro-rata shortfall only inside the first underfunded cohort after full liquidation. Active shareholders absorb residual loss before later cohorts or new depositors receive value.
- **Cutover rule**: deliver this as a new vault deployment; do not mutate the current live vault into the new accounting model in place.

### Metis Review (gaps addressed)

- Metis flagged an ambiguous “boundary” definition; resolved here as time-based epoch boundaries only.
- Metis flagged scope inflation risk; resolved by explicitly rejecting per-position ownership graphs and keeping the model to frozen senior liabilities plus a global free-cash allocator.
- Metis flagged gas-limit risk in cohort waterfalls; resolved by requiring chunked allocator progress and deterministic cursors.
- Metis flagged oracle safety risk; resolved by using dual entry/exit price rails and blocking boundary execution when the required conservative rail is stale or missing.
- Metis flagged missing insolvency behavior; resolved by defining emergency pause, recall, and oldest-cohort-first deficiency handling.

## Work Objectives

### Core Objective

- Deliver a Polymarket-native async vault where epoch boundaries lock an exit-side price for withdrawers and an entry-side price for depositors, queued depositors cannot subsidize earlier withdrawals or mint too cheaply off liquidation marks, exiting cohorts cannot steal later upside, and active shareholders retain all post-boundary market risk until frozen liabilities are fully funded.

### Deliverables

- Contract and runtime accounting model for three segregated buckets.
- Boundary NAV oracle and freeze rules tailored to Polymarket bid-side liquidity.
- Cohort liability ledger and chunked cash allocator across contract, repositories, worker, and API.
- UI lifecycle for queued deposits, frozen cohorts, accruing payouts, threshold-gated claims, and final dust claims.
- Operator runbooks, deployment artifacts, regression matrix, and cutover guidance for a new deployment.

### Definition of Done (verifiable conditions with commands)

- `forge test --match-test "testBoundaryPriceExcludesQueuedDepositsAndOpenCohortLiabilities|testBoundaryPriceUsedForDepositsAndWithdrawals|testOldestCohortFirstCashWaterfall|testFreeCashExcludesQueuedAndUnclaimedAllocatedCash|testBoundaryFreezeBlockedWhenBidSideNavUnavailable|testUndercollateralizedCohortPauseFlow"` passes in `contracts/`
- `pnpm --filter vault test -- --run src/__tests__/epochRepository.invariants.test.ts src/__tests__/reconciliation.test.ts src/__tests__/settlementLifecycle.integration.test.ts src/__tests__/customVaultRoutes.test.ts` passes in `apps/vault-api`
- `pnpm --filter vault build` passes in `apps/vault-api`
- `pnpm --filter vault-web build` passes in `apps/vault-web`
- `pnpm build` passes at repo root
- `pnpm --filter vault-web exec playwright test e2e/redemption.spec.ts e2e/erc7540-lifecycle.spec.ts` passes
- Operator regression script for lifecycle and on-chain verification passes against the new staging deployment and shows the new cohort lifecycle fields
- No API/UI/docs surface claims boundary-settlement-only anymore; instead they describe frozen cohort pricing plus delayed cash fulfillment accurately

### Must Have

- Dual boundary price rails per epoch: exit-side for withdrawals and entry-side for deposits.
- `activeNetAssets` excludes queued deposits and all open cohort liabilities before pricing new entrants or exits.
- Oldest-cohort-first waterfall with deterministic intra-cohort pro-rata allocation.
- No deployment of idle free cash while unpaid cohort liability exists.
- Hard freeze block when conservative Polymarket boundary NAV cannot be produced.
- New deployment and explicit cutover plan.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No request-time pricing.
- No repricing of frozen withdrawal entitlements.
- No use of queued deposits to fund prior cohorts.
- No per-position cohort ownership graph or bespoke position-to-user tracing.
- No cost-basis fallback for either boundary price rail.
- No in-place migration of current live withdrawal state into the new model.
- No cancellation support reintroduced.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after with existing Forge, Vitest, Playwright, and shell-run lifecycle scripts
- QA policy: every task includes at least one happy-path and one failure-path scenario with concrete commands/selectors
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. Shared math and data-model tasks come first.

Wave 1: accounting model, boundary NAV rules, contract storage/lifecycle, allocator rules, insolvency guardrails, cutover architecture
Wave 2: repository/schema/runtime activation, worker/liquidity integration, API/provider semantics, UI hooks and views, docs
Wave 3: regression expansion, E2E/manual QA, deployment scripts, cutover rehearsal, release package

### Dependency Matrix (full, all tasks)

- T1 -> T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15
- T2 -> T3, T4, T5, T7, T8, T9, T12, T13, T14, T15
- T3 -> T5, T7, T8, T9, T10, T12, T13, T15
- T4 -> T7, T8, T9, T10, T12, T13
- T5 -> T7, T8, T9, T10, T12, T13, T15
- T6 -> T8, T10, T11, T13, T14, T15
- T7 -> T8, T9, T10, T11, T12, T13, T14
- T8 -> T9, T10, T11, T12, T13, T14, T15
- T9 -> T10, T11, T12, T13, T14, T15
- T10 -> T11, T12, T13, T14, T15
- T11 -> T13, T14, T15
- T12 -> T13, T14, T15
- T13 -> T14, T15
- T14 -> T15

### Agent Dispatch Summary (wave -> task count -> categories)

- Wave 1 -> 6 tasks -> `deep`, `ultrabrain`, `unspecified-high`, `writing`
- Wave 2 -> 5 tasks -> `unspecified-high`, `deep`, `visual-engineering`, `writing`
- Wave 3 -> 4 tasks -> `deep`, `writing`, `quick`, `unspecified-high`

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Establish the canonical three-bucket accounting model

  **What to do**: Implement the canonical ledger definitions across contract types, provider types, repository comments, and shared runtime types: `queuedDepositAssets`, `openCohortLiabilityRemaining`, `unclaimedAllocatedCohortCash`, `freeCash`, `exitNetAssets`, and `entryNetAssets`. Make the exit-side and entry-side formulas explicit and reusable so later tasks do not improvise formulas.
  **Must NOT do**: Do not leave multiple competing formulas for free cash or active assets. Do not keep ambiguous terms like `frozenAssets` or `reservedRedemptionAssets` without mapping them to the canonical buckets.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This locks the economic model for every later task.
  - Skills: []
  - Omitted: [`playwright`] — no browser work.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: T2-T15 | Blocked By: none

  **References**:
  - Contract ledger fields: `contracts/src/EpochTrancheVault.sol`
  - Runtime types: `apps/vault-api/src/services/vaultProvider.ts`
  - Provider implementation: `apps/vault-api/src/services/customVaultProvider.ts`
  - Schema ledger fields: `apps/vault-api/src/db/schema.ts`
  - Repository invariants: `apps/vault-api/src/repositories/entitlementRepository.ts`

  **Acceptance Criteria**:
  - [ ] A single canonical formula set exists for `exitBoundaryPrice`, `entryBoundaryPrice`, `freeCash`, and cohort liabilities.
  - [ ] Contract, provider, schema comments, and API payload names use the same bucket vocabulary.

  **QA Scenarios**:

  ```text
  Scenario: Canonical formulas are singular
    Tool: Bash
    Steps: Grep contract/runtime/schema files for `activeNetAssets`, `freeCash`, `queuedDepositAssets`, and `openCohortLiabilityRemaining`; confirm one canonical formula set is documented and implemented.
    Expected: No conflicting formulas or legacy bucket names remain un-mapped.
    Evidence: .sisyphus/evidence/task-1-canonical-ledger.txt

  Scenario: Legacy naming is fully mapped
    Tool: Bash
    Steps: Search for `reservedRedemptionAssets`, `frozenAssets`, and `carryRemaining`; verify each usage is either retained with explicit mapping or replaced.
    Expected: No economically meaningful term remains undefined or ambiguous.
    Evidence: .sisyphus/evidence/task-1-ledger-mapping.txt
  ```

  **Commit**: YES | Message: `refactor(vault): define canonical cohort accounting buckets` | Files: `contracts/src/EpochTrancheVault.sol`, `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/services/vaultProvider.ts`, `apps/vault-api/src/db/schema.ts`

- [ ] 2. Harden the boundary NAV oracle for Polymarket pricing

  **What to do**: Make the Polymarket boundary pricing source explicitly conservative for both price rails. For exit-side calculations, require fresh bid-side prices for all open positions included in withdrawal freezing. For entry-side calculations, require fresh ask-side or equivalent replacement-cost prices for all open positions included in deposit minting. Remove cost-basis fallback from both rails, add stale/missing quote failure states, and expose a runtime reason when a boundary cannot execute because a required rail is unavailable.
  **Must NOT do**: Do not silently use cost basis, midpoint, or stale quotes for either rail. Do not let exit-side or entry-side pricing succeed with partial quote coverage.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Oracle semantics determine whether fixed entitlements are safe.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T3, T4, T5, T7-T15 | Blocked By: T1

  **References**:
  - NAV oracle: `apps/vault-api/src/services/navOracle.ts`
  - Price service: `apps/vault-api/src/services/priceService.ts`
  - Position fetcher: `apps/vault-api/src/services/positionFetcher.ts`
  - Health monitor: `apps/vault-api/src/services/vaultHealthMonitor.ts`

  **Acceptance Criteria**:
  - [ ] Exit-side pricing fails closed when any open position lacks a fresh conservative bid-side mark.
  - [ ] Entry-side pricing fails closed when any open position lacks a fresh conservative ask-side/replacement-cost mark.
  - [ ] Boundary pricing no longer uses cost-basis fallback for open positions.
  - [ ] API/health output exposes which rail is blocked and why.

  **QA Scenarios**:

  ```text
  Scenario: Exit-side boundary pricing uses conservative bid-side pricing only
    Tool: Bash
    Steps: Run targeted tests and grep `navOracle.ts` for boundary-specific fallback behavior.
    Expected: No boundary pricing path falls back to cost basis for open positions.
    Evidence: .sisyphus/evidence/task-2-boundary-nav-pricing.txt

  Scenario: Missing quote blocks the required boundary rail
    Tool: Bash
    Steps: Run targeted provider/worker tests with one missing bid-side quote and one missing ask-side/replacement-cost quote.
    Expected: The boundary execution is blocked for whichever rail is required, and a structured stale/missing-quote reason is returned.
    Evidence: .sisyphus/evidence/task-2-boundary-nav-block.txt
  ```

  **Commit**: YES | Message: `fix(nav): fail closed for boundary cohort pricing` | Files: `apps/vault-api/src/services/navOracle.ts`, `apps/vault-api/src/services/priceService.ts`, `apps/vault-api/src/services/vaultHealthMonitor.ts`

- [ ] 3. Redesign contract cohort storage and lifecycle for frozen liabilities

  **What to do**: Extend `EpochTrancheVault` so each epoch-boundary withdrawal cohort stores fixed entitlement totals, allocated cash totals, claimed cash totals, and remaining liability independently from queued deposits and active capital. Keep request-time share burn/lock. Add contract fields/events/errors needed for multiple open unpaid cohorts while preserving deterministic epoch sequencing.
  **Must NOT do**: Do not model ownership by tracing each position to each user. Do not merge queued deposit cash into cohort or active ledgers.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` — Reason: Multi-cohort on-chain ledger changes are the hardest correctness layer.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T5, T7-T15 | Blocked By: T1, T2

  **References**:
  - Contract: `contracts/src/EpochTrancheVault.sol`
  - Existing cohort fields: `contracts/src/EpochTrancheVault.sol`
  - Interface precedent: `contracts/src/interfaces/ISnapshotTrancheVault.sol`
  - Existing flattened deployment artifact: `contracts/flattened/EpochTrancheVault.flattened.sol`

  **Acceptance Criteria**:
  - [ ] Contract supports multiple simultaneously open frozen cohorts with explicit remaining liability totals.
  - [ ] Shares remain burned/locked at request time and are not reintroduced later.
  - [ ] Contract events expose cohort creation, allocation, claim, completion, and emergency deficiency transitions.

  **QA Scenarios**:

  ```text
  Scenario: Multiple unpaid cohorts can coexist safely
    Tool: Bash
    Steps: Run Forge test creating two withdrawal cohorts across two boundaries while the first remains unpaid.
    Expected: Each cohort maintains independent entitlement, accrued, claimed, and remaining totals.
    Evidence: .sisyphus/evidence/task-3-multi-cohort-ledger.txt

  Scenario: Request-time share lock remains irreversible
    Tool: Bash
    Steps: Run Forge test for request creation and attempt to transfer/claim unlocked shares afterward.
    Expected: Shares are not double-counted or user-spendable after request creation.
    Evidence: .sisyphus/evidence/task-3-request-lock.txt
  ```

  **Commit**: YES | Message: `feat(vault): add frozen cohort liability ledger` | Files: `contracts/src/EpochTrancheVault.sol`, `contracts/flattened/EpochTrancheVault.flattened.sol`

- [ ] 4. Make boundary processing order canonical and order-independent

  **What to do**: Define and implement the exact boundary sequence: refresh NAV, seal the inclusion set at the scheduled cutoff, compute `exitBoundaryPrice` and `entryBoundaryPrice` from the same pre-boundary active state, freeze included redemptions at the exit-side price, mint included queued deposits at the entry-side price, then advance the epoch. Ensure ordering cannot change economics.
  **Must NOT do**: Do not allow deposit minting first on one path and redemption freezing first on another. Do not recompute either price rail after boundary execution begins.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Boundary ordering errors directly create user extraction.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T7-T15 | Blocked By: T1, T2

  **References**:
  - Freeze path: `contracts/src/EpochTrancheVault.sol`
  - Deposit queue processing: `contracts/src/EpochTrancheVault.sol`
  - Provider epoch orchestration: `apps/vault-api/src/services/customVaultProvider.ts`

  **Acceptance Criteria**:
  - [ ] Both price rails are computed from the same sealed pre-boundary state.
  - [ ] Withdrawals always use `exitBoundaryPrice` and deposits always use `entryBoundaryPrice`.
  - [ ] Boundary processing remains correct regardless of transaction chunking.

  **QA Scenarios**:

  ```text
  Scenario: Deposits and withdrawals use the correct boundary price rail
    Tool: Bash
    Steps: Run Forge test with both queued deposits and pending withdrawals at one boundary.
    Expected: Withdrawals derive from stored `exitBoundaryPrice`, deposits derive from stored `entryBoundaryPrice`, and no order dependence exists.
    Evidence: .sisyphus/evidence/task-4-shared-boundary-price.txt

  Scenario: Chunking does not change economics
    Tool: Bash
    Steps: Run one settlement path in a single chunk and one in multiple chunks.
    Expected: Cohort totals and minted shares match exactly.
    Evidence: .sisyphus/evidence/task-4-chunk-order-independence.txt
  ```

  **Commit**: YES | Message: `fix(vault): canonicalize boundary processing order` | Files: `contracts/src/EpochTrancheVault.sol`, `apps/vault-api/src/services/customVaultProvider.ts`

- [ ] 5. Implement the deterministic oldest-cohort-first cash waterfall

  **What to do**: Build the allocator that takes newly available `freeCash` and applies it oldest-cohort-first. Within the active oldest cohort, distribute pro-rata by each request's remaining liability using fixed-point math, then assign remainder units by ascending `requestId`. Continue to the next cohort only after the older one is fully accrued. Persist allocator cursors/chunks for gas-safe resumption.
  **Must NOT do**: Do not allocate cash to newer cohorts while an older cohort still has remaining liability. Do not use nondeterministic iteration order.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` — Reason: This is the main fairness and anti-gaming core.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T7-T15 | Blocked By: T1, T2, T3, T4

  **References**:
  - Contract settlement progress: `contracts/src/EpochTrancheVault.sol`
  - Entitlement ledger logic: `apps/vault-api/src/repositories/entitlementRepository.ts`
  - Payout persistence: `apps/vault-api/src/repositories/payoutRepository.ts`

  **Acceptance Criteria**:
  - [ ] Cash allocator is oldest-cohort-first across cohorts.
  - [ ] Intra-cohort allocation is pro-rata by remaining liability with deterministic dust rules.
  - [ ] Allocator is chunked/resumable without changing outcomes.

  **QA Scenarios**:

  ```text
  Scenario: Older cohort is paid before newer cohort
    Tool: Bash
    Steps: Run contract/integration test with two unpaid cohorts and one free-cash injection.
    Expected: Only the oldest cohort accrues until fully funded.
    Evidence: .sisyphus/evidence/task-5-oldest-first-waterfall.txt

  Scenario: Deterministic dust assignment
    Tool: Bash
    Steps: Run the same allocation twice with remainder-producing pro-rata math.
    Expected: Request-level accrued totals match exactly and remainder lands on the same ascending requestId order.
    Evidence: .sisyphus/evidence/task-5-deterministic-dust.txt
  ```

  **Commit**: YES | Message: `feat(vault): add deterministic cohort cash waterfall` | Files: `contracts/src/EpochTrancheVault.sol`, `apps/vault-api/src/repositories/entitlementRepository.ts`, `apps/vault-api/src/repositories/payoutRepository.ts`

- [ ] 6. Add emergency undercollateralization and freeze-block guardrails

  **What to do**: Implement the failure rules for stale boundary pricing, undercollateralized frozen liabilities, and capital deficiency. Add emergency status, operator alerts, capital recall requirements, deposit/trade pause behavior, and terminal deficiency resolution inside the first underfunded cohort after full liquidation.
  **Must NOT do**: Do not leave insolvency behavior implicit. Do not let new deposits or new trading continue after a deficiency trigger.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Failure handling crosses contract, worker, and runbook boundaries.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T8, T10, T12, T14, T15 | Blocked By: T1

  **References**:
  - Contract emergency controls: `contracts/src/EpochTrancheVault.sol`
  - Health monitor: `apps/vault-api/src/services/vaultHealthMonitor.ts`
  - Trading worker: `apps/vault-api/src/tradingWorker.ts`
  - Alerts config: `apps/vault-api/src/config/alerts.ts`

  **Acceptance Criteria**:
  - [ ] Missing/stale boundary pricing blocks freeze and emits operator-visible diagnostics.
  - [ ] Deficiency pauses new deposits and new trading deployments.
  - [ ] Terminal shortfall is resolved by explicit oldest-cohort-first rules after recall/liquidation.

  **QA Scenarios**:

  ```text
  Scenario: Boundary freeze blocked by stale pricing
    Tool: Bash
    Steps: Run worker/provider test with stale bid-side data on one open position.
    Expected: Freeze does not proceed and an alertable reason is recorded.
    Evidence: .sisyphus/evidence/task-6-freeze-block.txt

  Scenario: Deficiency triggers pause flow
    Tool: Bash
    Steps: Run contract/integration scenario where realized value drops below frozen liabilities.
    Expected: Deposits and idle redeployment pause, recall begins, and deficiency status is observable.
    Evidence: .sisyphus/evidence/task-6-deficiency-pause.txt
  ```

  **Commit**: YES | Message: `feat(vault): add cohort deficiency guardrails` | Files: `contracts/src/EpochTrancheVault.sol`, `apps/vault-api/src/services/vaultHealthMonitor.ts`, `apps/vault-api/src/tradingWorker.ts`, `apps/vault-api/src/config/alerts.ts`

- [ ] 7. Activate schema and repositories for real cohort accounting

  **What to do**: Turn the existing epoch/entitlement/realization/payout schema into the supported source of truth for the new model. Add or adjust migrations so repository fields line up exactly with the canonical buckets and cohort lifecycle. Remove “future-only” status from the paths that are now supported and keep only truly out-of-scope states disabled.
  **Must NOT do**: Do not leave live runtime paths split between legacy withdrawal tables and new cohort tables. Do not keep contradictory canonical vs legacy fields without an explicit migration plan.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: This is the main data-model activation task.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T8-T15 | Blocked By: T1, T2, T3, T5

  **References**:
  - Schema: `apps/vault-api/src/db/schema.ts`
  - Entitlements: `apps/vault-api/src/repositories/entitlementRepository.ts`
  - Realizations: `apps/vault-api/src/repositories/realizationRepository.ts`
  - Epochs: `apps/vault-api/src/repositories/epochRepository.ts`
  - Payouts: `apps/vault-api/src/repositories/payoutRepository.ts`

  **Acceptance Criteria**:
  - [ ] Runtime uses epoch/cohort tables as canonical state for accrual, claimability, and remaining liability.
  - [ ] Legacy withdrawal state is either removed from custom-vault paths or explicitly read-only compatibility only.
  - [ ] Repository invariants enforce `0 <= claimed <= accrued <= entitlement` and bucket conservation.

  **QA Scenarios**:

  ```text
  Scenario: Canonical repository state is conserved
    Tool: Bash
    Steps: Run targeted Vitest invariants and reconciliation tests.
    Expected: Canonical ledger conservation passes with no unexplained deltas.
    Evidence: .sisyphus/evidence/task-7-repo-invariants.txt

  Scenario: Legacy custom-vault paths are deactivated
    Tool: Bash
    Steps: Grep custom-vault routes/providers for legacy FIFO withdrawal table usage.
    Expected: No live custom-vault read/write path depends on the legacy queue semantics.
    Evidence: .sisyphus/evidence/task-7-legacy-paths.txt
  ```

  **Commit**: YES | Message: `refactor(vault-api): activate canonical cohort repositories` | Files: `apps/vault-api/src/db/schema.ts`, `apps/vault-api/src/repositories/*.ts`

- [ ] 8. Wire the worker and runtime free-cash allocator

  **What to do**: Update the worker and provider orchestration so every new free-cash event (position resolution, recall, idle vault cash after settlement) flows through the cohort allocator before any deploy action. Persist allocation progress, support retries/idempotency, and ensure the worker can resume safely after crashes.
  **Must NOT do**: Do not allocate or deploy idle cash before cohort liabilities are checked. Do not make allocator progress non-idempotent.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This ties the economic model to actual runtime behavior.
  - Skills: []
  - Omitted: [`playwright`] — no browser work.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T9-T15 | Blocked By: T1, T2, T5, T6, T7

  **References**:
  - Worker: `apps/vault-api/src/tradingWorker.ts`
  - Liquidity: `apps/vault-api/src/services/liquidityManager.ts`
  - Provider: `apps/vault-api/src/services/customVaultProvider.ts`
  - Reconciliation: `apps/vault-api/src/__tests__/reconciliation.test.ts`

  **Acceptance Criteria**:
  - [ ] Every positive `freeCash` path runs through the cohort allocator before redeployment.
  - [ ] Allocation is idempotent across worker restarts.
  - [ ] Idle redeployment is blocked while open cohort liability remains and free cash exists.

  **QA Scenarios**:

  ```text
  Scenario: Free cash is allocated before redeployment
    Tool: Bash
    Steps: Run integration test where recall creates idle cash while an unpaid cohort exists.
    Expected: Cohort accrual happens before any deploy-capital path.
    Evidence: .sisyphus/evidence/task-8-free-cash-priority.txt

  Scenario: Worker resume is idempotent
    Tool: Bash
    Steps: Interrupt and rerun allocation flow mid-chunk in a test harness.
    Expected: No duplicate accruals or claims are recorded.
    Evidence: .sisyphus/evidence/task-8-idempotent-resume.txt
  ```

  **Commit**: YES | Message: `feat(worker): prioritize cohort allocator before redeploy` | Files: `apps/vault-api/src/tradingWorker.ts`, `apps/vault-api/src/services/liquidityManager.ts`, `apps/vault-api/src/services/customVaultProvider.ts`

- [ ] 9. Rebuild provider and API lifecycle semantics around cohorts

  **What to do**: Update provider methods and API payloads so custom vault requests expose boundary-priced cohort semantics: target boundary, frozen entitlement, accrued amount, claimed amount, remaining liability, threshold eligibility, and cohort ordering. Replace boundary-settlement-only copy and capability flags with the new supported lifecycle.
  **Must NOT do**: Do not expose ambiguous fields like `assetsEstimated` as if they can still change after freezing. Do not keep cancellation or boundary-only wording.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: The API contract must become truthful and exact.
  - Skills: []
  - Omitted: [`playwright`] — API first.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T10-T15 | Blocked By: T1, T2, T3, T4, T5, T7, T8

  **References**:
  - Provider: `apps/vault-api/src/services/customVaultProvider.ts`
  - Routes: `apps/vault-api/src/routes/customVaultRoutes.ts`
  - Claim state machine: `apps/vault-api/src/services/claimStateMachine.ts`
  - Route tests: `apps/vault-api/src/__tests__/customVaultRoutes.test.ts`

  **Acceptance Criteria**:
  - [ ] API returns separate fields for queued deposits, frozen entitlements, accrued claimable cash, claimed cash, and remaining liability.
  - [ ] Request states support the new lifecycle without implying repricing.
  - [ ] Capability flags accurately describe async cash fulfillment and irreversible requests.

  **QA Scenarios**:

  ```text
  Scenario: Request payload truthfulness
    Tool: Bash
    Steps: Start API test server and curl request-status endpoints for pending, frozen, partially accrued, and fully claimed cohorts.
    Expected: Payload fields map exactly to the new lifecycle and never imply repricing.
    Evidence: .sisyphus/evidence/task-9-api-lifecycle.txt

  Scenario: Capability flags describe supported model
    Tool: Bash
    Steps: Curl vault info/capabilities endpoint and grep for support flags and text.
    Expected: Async cash fulfillment is described, cancellation is false, and repricing is absent.
    Evidence: .sisyphus/evidence/task-9-capabilities.txt
  ```

  **Commit**: YES | Message: `feat(api): expose frozen cohort lifecycle semantics` | Files: `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/services/claimStateMachine.ts`

- [ ] 10. Enforce trading and liquidity policy while cohorts remain open

  **What to do**: Keep Polymarket trading compatible with cross-epoch positions while enforcing the new liability seniority rules. Existing open positions may span epochs, but idle free cash must first service frozen liabilities. Add policy checks so new positions can open only if they do not consume cash already needed for existing cohorts or imminent boundary obligations.
  **Must NOT do**: Do not revert to strict “positions may not cross epochs” logic. Do not allow new idle cash deployment while unpaid liabilities are allocatable.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This task reconciles Polymarket reality with the cohort model.
  - Skills: []
  - Omitted: [`playwright`] — backend policy.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T12-T15 | Blocked By: T1, T4, T5, T6, T7, T8, T9

  **References**:
  - Trading orchestrator: `apps/vault-api/src/services/tradingOrchestrator.ts`
  - Liquidity manager: `apps/vault-api/src/services/liquidityManager.ts`
  - Worker startup/health: `apps/vault-api/src/tradingWorker.ts`
  - Vault config: `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`

  **Acceptance Criteria**:
  - [ ] Cross-epoch positions remain allowed, but idle free cash cannot bypass unpaid cohorts.
  - [ ] Policy checks prevent new trades when they would consume cash reserved for cohort allocation.
  - [ ] Health output distinguishes supported cross-epoch carrying from unsupported pricing-blocked/deficiency states.

  **QA Scenarios**:

  ```text
  Scenario: Cross-epoch position allowed with unpaid cohort present
    Tool: Bash
    Steps: Run trading orchestrator test where positions remain open across a boundary and a cohort remains unpaid.
    Expected: Existing positions remain valid, but new idle cash is not deployed ahead of cohort accrual.
    Evidence: .sisyphus/evidence/task-10-cross-epoch-policy.txt

  Scenario: Trade blocked when it consumes cohort-reserved cash
    Tool: Bash
    Steps: Attempt trade with insufficient post-trade idle cash coverage for allocatable liabilities.
    Expected: Trade is rejected with a structured cohort-liability reason.
    Evidence: .sisyphus/evidence/task-10-cash-coverage-guard.txt
  ```

  **Commit**: YES | Message: `feat(trading): enforce cohort liability seniority` | Files: `apps/vault-api/src/services/tradingOrchestrator.ts`, `apps/vault-api/src/services/liquidityManager.ts`, `apps/vault-api/src/tradingWorker.ts`, `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`

- [ ] 11. Rebuild the vault UI around the new cohort lifecycle

  **What to do**: Update the vault detail page, pending/claimable components, hooks, and API adapters so users see queued deposits, next boundary, frozen cohort entitlement, accrued-but-unclaimed cash, claimed cash, remaining liability, threshold status, and final dust claim eligibility. Make cross-epoch positions and delayed cash fulfillment understandable without implying repricing.
  **Must NOT do**: Do not show `Estimated shares at current NAV` or mutable redemption estimates after freeze. Do not use copy that implies users are waiting for “settlement only” if they are now waiting for later cash accrual.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: This is a user-facing lifecycle redesign with correctness-sensitive copy.
  - Skills: [`frontend-ui-ux`] — lifecycle communication matters here.
  - Omitted: [`playwright`] — verification handled later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T13-T15 | Blocked By: T7, T8, T9

  **References**:
  - Vault detail page: `apps/vault-web/app/vault/[id]/vault-detail.tsx`
  - Pending requests: `apps/vault-web/app/vault/[id]/components/PendingRequests.tsx`
  - Claimable requests: `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx`
  - Hooks/API: `apps/vault-web/src/lib/hooks.ts`, `apps/vault-web/src/lib/api.ts`
  - Types: `apps/vault-web/src/types.ts`

  **Acceptance Criteria**:
  - [ ] UI distinguishes queued, frozen, accruing, claimable, claimed, and finalized states.
  - [ ] Post-freeze amounts are shown as fixed entitlements plus changing accrued/remaining values, not estimates.
  - [ ] No user-facing copy implies repricing, cancellation, or deposit subsidy of prior cohorts.

  **QA Scenarios**:

  ```text
  Scenario: Cohort lifecycle renders correctly
    Tool: Playwright
    Steps: Open `/vault/1`, load fixtures with pending, frozen, accruing, and dust-claimable requests, then inspect cards and tabs.
    Expected: Fixed entitlement, accrued, claimed, remaining, and threshold copy all render correctly.
    Evidence: .sisyphus/evidence/task-11-ui-lifecycle.png

  Scenario: No misleading estimates remain
    Tool: Bash
    Steps: Grep vault-web for `current NAV`, `settlement only`, `cancel redemption`, and similar obsolete strings.
    Expected: No stale user-facing text remains.
    Evidence: .sisyphus/evidence/task-11-ui-copy-audit.txt
  ```

  **Commit**: YES | Message: `feat(vault-web): show frozen cohort carry lifecycle` | Files: `apps/vault-web/app/vault/[id]/*`, `apps/vault-web/src/lib/*`, `apps/vault-web/src/types.ts`

- [ ] 12. Expand contract and repository invariant coverage

  **What to do**: Add regression tests for canonical formulas, oldest-cohort-first payouts, invariant conservation, stale-boundary blocking, deficiency pause flow, and chunk-resume equivalence. Reuse existing `epochRepository.invariants.test.ts`, `reconciliation.test.ts`, and Forge patterns as the canonical test spine.
  **Must NOT do**: Do not rely only on happy-path unit tests. Do not leave dust/rounding behavior untested.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: The economic model is only safe if invariants are machine-checked.
  - Skills: []
  - Omitted: [`playwright`] — not for this task.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T13-T15 | Blocked By: T2, T3, T5, T6, T7, T8, T9, T10

  **References**:
  - Forge tests: `contracts/test/EpochTrancheVault.t.sol`
  - Repository invariants: `apps/vault-api/src/__tests__/epochRepository.invariants.test.ts`
  - Reconciliation tests: `apps/vault-api/src/__tests__/reconciliation.test.ts`
  - Integration lifecycle tests: `apps/vault-api/src/__tests__/settlementLifecycle.integration.test.ts`

  **Acceptance Criteria**:
  - [ ] New targeted Forge tests cover all canonical formulas and deficiency paths.
  - [ ] Repository/integration tests cover multi-cohort, free-cash, and allocator idempotency invariants.
  - [ ] Test names and evidence clearly map to plan invariants.

  **QA Scenarios**:

  ```text
  Scenario: Contract invariant suite passes
    Tool: Bash
    Steps: Run the targeted Forge regression command from Definition of Done.
    Expected: All specified cohort tests pass.
    Evidence: .sisyphus/evidence/task-12-forge-regressions.txt

  Scenario: Repository invariants pass
    Tool: Bash
    Steps: Run targeted Vitest invariant and reconciliation suites.
    Expected: No unexplained deltas, invalid transitions, or conservation failures.
    Evidence: .sisyphus/evidence/task-12-vitest-invariants.txt
  ```

  **Commit**: YES | Message: `test(vault): cover frozen cohort carry invariants` | Files: `contracts/test/EpochTrancheVault.t.sol`, `apps/vault-api/src/__tests__/*.test.ts`

- [ ] 13. Deliver API/UI/E2E QA for async cohort fulfillment

  **What to do**: Add and run route-level, worker-level, and Playwright scenarios covering the new lifecycle. Exercise unauthorized claims, threshold-gated claims, dust override, unpaid older cohort precedence, missing boundary pricing, and UI rendering under mobile and desktop.
  **Must NOT do**: Do not sign off on UI/API semantics without hands-on browser and curl verification. Do not skip failure-path QA.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: This is the integrated user-facing verification task.
  - Skills: [`playwright`] — browser execution is mandatory.
  - Omitted: []

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T14, T15 | Blocked By: T8, T9, T10, T11, T12

  **References**:
  - API route tests: `apps/vault-api/src/__tests__/customVaultRoutes.test.ts`
  - Playwright E2E: `apps/vault-web/e2e/redemption.spec.ts`, `apps/vault-web/e2e/erc7540-lifecycle.spec.ts`
  - Web config: `apps/vault-web/playwright.config.ts`

  **Acceptance Criteria**:
  - [ ] API curls and Playwright scenarios confirm the new lifecycle end to end.
  - [ ] No console/runtime errors occur in the main vault page flow.
  - [ ] Dust override and threshold behavior are demonstrated with evidence.

  **QA Scenarios**:

  ```text
  Scenario: Browser lifecycle replay
    Tool: Playwright
    Steps: Run desktop and mobile vault lifecycle tests for pending -> frozen -> accruing -> claimable -> claimed.
    Expected: UI renders correctly and console stays clean.
    Evidence: .sisyphus/evidence/task-13-playwright.txt

  Scenario: API failure-path replay
    Tool: Bash
    Steps: Curl claim and request-status endpoints for unauthorized user, below-threshold claim, and dust-override claim.
    Expected: Structured errors for invalid actions and success for final dust claim.
    Evidence: .sisyphus/evidence/task-13-api-replay.txt
  ```

  **Commit**: YES | Message: `test(vault): verify async cohort fulfillment flows` | Files: `apps/vault-api/src/__tests__/*`, `apps/vault-web/e2e/*`

- [ ] 14. Update runbooks, operator procedures, and product documentation

  **What to do**: Rewrite the vault docs and operator runbook for the new model: time-boundary pricing, queued deposit isolation, older-cohort seniority, missing-price freeze block, deficiency emergency flow, and no in-place migration. Update deploy/verify scripts and troubleshooting steps for staging and mainnet readiness.
  **Must NOT do**: Do not leave boundary-settlement-only wording in live docs. Do not document unsupported shortcuts like cost-basis fallback or manual repricing.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: Operator correctness depends on documentation quality here.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T15 | Blocked By: T6, T9, T10, T11, T12, T13

  **References**:
  - Runbook: `docs/operator-runbook-amoy.md`
  - Knowledge base: `VAULT_KNOWLEDGE.md`
  - Deploy/verify scripts: `contracts/scripts/deployEpochTrancheVault.js`, `contracts/scripts/verify-amoy-deployment.sh`, `scripts/amoy-lifecycle-test.sh`

  **Acceptance Criteria**:
  - [ ] Docs describe the new model accurately and explicitly.
  - [ ] Operator steps exist for freeze-blocked boundary, deficiency pause, and cutover.
  - [ ] Verification scripts and runbook terminology match the new lifecycle fields.

  **QA Scenarios**:

  ```text
  Scenario: Docs terminology audit
    Tool: Bash
    Steps: Grep docs/scripts for `boundary settlement only`, `gradual realization unsupported`, `cost basis fallback`, and old wording.
    Expected: Only the new cohort-carry terminology remains where appropriate.
    Evidence: .sisyphus/evidence/task-14-docs-audit.txt

  Scenario: Operator procedure completeness
    Tool: Bash
    Steps: Read runbook sections for normal boundary, blocked boundary, deficiency emergency, and cutover rehearsal.
    Expected: All four operator procedures are present and internally consistent with commands and roles.
    Evidence: .sisyphus/evidence/task-14-runbook-completeness.txt
  ```

  **Commit**: YES | Message: `docs(vault): document frozen cohort carry operations` | Files: `docs/operator-runbook-amoy.md`, `VAULT_KNOWLEDGE.md`, `contracts/scripts/*`, `scripts/*`

- [ ] 15. Deliver the new deployment cutover and release package

  **What to do**: Finalize the staging-to-production release package for a brand-new deployment. Include new vault deployment scripts/configs, staging lifecycle rehearsal, evidence capture, runtime config switch, rollback plan, and explicit treatment of the legacy vault as legacy/non-migrated state. Verify Amoy end-to-end first, then produce the mainnet cutover checklist.
  **Must NOT do**: Do not attempt in-place migration of the current live vault state. Do not promote without a full staging rehearsal on the new contract.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: This is execution packaging and verification, not fresh architecture.
  - Skills: []
  - Omitted: [`playwright`] — UI already covered.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: F1, F2, F3, F4 | Blocked By: T1, T2, T3, T5, T6, T8, T9, T10, T11, T12, T13, T14

  **References**:
  - Deployment scripts: `contracts/scripts/deployEpochTrancheVault.js`, `contracts/scripts/flattenEpochTrancheVaultForRemix.sh`, `contracts/scripts/verify-amoy-deployment.sh`
  - Current config: `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`
  - Lifecycle scripts: `scripts/amoy-lifecycle-test.sh`, `scripts/run-regression-matrix.sh`

  **Acceptance Criteria**:
  - [ ] A fresh staging deployment is verified with the new cohort lifecycle.
  - [ ] Runtime config switch instructions exist for staging and production.
  - [ ] Rollback means switching traffic/config back to the legacy vault, not mutating state in place.

  **QA Scenarios**:

  ```text
  Scenario: Staging cutover rehearsal
    Tool: Bash
    Steps: Deploy the new contract to staging, run lifecycle/regression scripts, and capture resulting evidence.
    Expected: End-to-end staging rehearsal passes on the new deployment.
    Evidence: .sisyphus/evidence/task-15-staging-cutover.txt

  Scenario: Rollback package completeness
    Tool: Bash
    Steps: Read deployment package and config diffs for new vs legacy vault addresses and rollback steps.
    Expected: Rollback is explicit, config-only, and avoids state mutation of the legacy vault.
    Evidence: .sisyphus/evidence/task-15-rollback-package.txt
  ```

  **Commit**: YES | Message: `chore(vault): prepare frozen cohort carry cutover package` | Files: `contracts/scripts/*`, `apps/vault-api/src/config/vaults/*`, `scripts/*`, `contracts/deployments/*`

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- One commit per task.
- Contract math/storage commits must not be mixed with UI/docs commits.
- Schema/repository activation must land before provider/API/UI lifecycle commits.
- Cutover/deployment scripts must be committed after regression and docs are green.

## Success Criteria

- A queued depositor cannot receive value from pre-mint positions or prior withdrawal cohorts.
- A withdrawing user's entitlement is fixed once at the boundary and never repriced.
- Active shareholders retain all post-boundary P/L after frozen liabilities are carved out.
- Older cohorts always receive new free cash before newer cohorts or new idle deployment.
- Missing conservative boundary pricing blocks freeze instead of using unsafe fallback.
- The rollout path is a fresh deployment with verified staging rehearsal, not an in-place mutation of the current live vault.
