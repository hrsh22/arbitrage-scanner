# Position-Driven FlatBook Lifecycle

## TL;DR

> **Summary**: Refactor the FlatBook lifecycle so instant deposit/withdraw UX is driven by flat/open-position status instead of capital custody, while keeping settlement, NAV publication, and queued request processing deterministic.
> **Deliverables**:
>
> - FlatBook contract supports empty-queue reopen and non-custody-driven allocation semantics
> - vault-api worker/provider/client enforce a position-driven lifecycle decision table
> - vault-web renders explicit instant vs queued modes from API lifecycle data
> - contract, backend, and web verification cover flat, risk-on, stale-telemetry, and queued-processing paths
>   **Effort**: Large
>   **Parallel**: YES - 3 waves
>   **Critical Path**: Contract lifecycle semantics -> backend orchestration -> web lifecycle UX -> full verification

## Context

### Original Request

Plan the lifecycle so the vault stays open while no positions are open, closes while positions are open, queues requests only while positions are open, refreshes NAV once when flat again, processes queued requests around reopen, and recalls capital only for withdrawal liquidity or emergency.

### Interview Summary

- User wants position status, not trading-wallet custody, to determine whether requests are instant or queued.
- Trading system is independent; worker polling every minute is acceptable to detect whether positions are open.
- Small race windows are acceptable operationally, but the system should default conservatively when telemetry is stale or unknown.
- Deposits should remain instant while flat/open.
- Withdrawals should be instant while flat/open, but only trigger recall from trading wallet on actual withdrawal liquidity demand.

### Metis Review (gaps addressed)

- Use the full existing flatness gate as the backend reopen/processing authority, not raw `openPositions.length === 0` alone.
- Add explicit empty-queue reopen semantics; do not leave the closed-without-queue case undefined.
- Remove capital-custody-driven closure from the normal worker loop; allocation must not be the reason lifecycle state changes.
- Define a single source of truth for web UX: API lifecycle payloads must expose product mode (`instant` vs `queued`) explicitly instead of forcing UI to infer from raw contract states.
- Treat stale or failed telemetry as `risk_on` for state transitions and as `unknown` for UX messaging; no state change is allowed on stale telemetry.

## Work Objectives

### Core Objective

Ship a deterministic FlatBook lifecycle where:

- `Open` means flat enough to allow instant user actions.
- `Closed` means risk is on or flatness/telemetry is not trustworthy enough to permit instant user actions.
- queued processing only happens when flatness is confirmed and NAV has been refreshed for the soon-to-open cycle.

### Deliverables

- Contract changes in `contracts/src/FlatBookVaultV2.sol` and matching tests in `contracts/test/FlatBookVaultV2*.t.sol`
- Backend lifecycle/orchestration changes in `apps/vault-api/src/worker.ts`, `apps/vault-api/src/services/liquidityManager.ts`, `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/services/customVaultClient.ts`, `apps/vault-api/src/services/navOracle.ts`, and relevant routes/tests
- Web/API lifecycle UX changes in `apps/vault-web/app/vault/[id]/vault-detail.tsx`, `apps/vault-web/src/lib/hooks.ts`, `apps/vault-web/src/types.ts`, and any supporting API payload types/routes
- Verification artifacts under `.sisyphus/evidence/`

### Definition of Done (verifiable conditions with commands)

- `cd contracts && forge test --match-path test/FlatBookVaultV2.t.sol`
- `cd contracts && forge test --match-path test/FlatBookVaultV2.fuzz.t.sol`
- `cd contracts && forge test --match-path test/FlatBookVaultV2.conformance.t.sol`
- `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts src/__tests__/settlementLifecycle.integration.test.ts src/__tests__/customVaultClient.test.ts src/__tests__/customVaultProvider.readiness.test.ts src/__tests__/flatnessDetector.test.ts`
- `cd apps/vault-api && pnpm build`
- `cd apps/vault-web && pnpm build`
- `cd apps/vault-web && pnpm exec playwright test e2e/flatbook-lifecycle.spec.ts --project=chromium`

### Must Have

- Contract lifecycle supports `Open -> Closed -> Processing -> Open` plus explicit empty-queue reopen behavior.
- Allocation to trading wallet is no longer the trigger for closing the book.
- Worker closes the book when risk-on telemetry is observed and reopens only after fresh flatness confirmation.
- NAV is updated once on transition back to flat before queued processing/reopen, not continuously while flat/open.
- Web/API show `instant`, `queued`, and `stale/unknown` modes explicitly.
- Instant withdrawals while flat/open use direct on-chain withdraw only when vault idle liquidity is sufficient; otherwise backend performs recall preflight and the UI waits for liquidity before the user signs the final withdraw tx.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- Must NOT redesign the trading engine, Safe architecture, or unrelated legacy vault types.
- Must NOT close the vault solely because excess cash exists in the vault or solely to allocate capital.
- Must NOT reopen on stale/failed position telemetry.
- Must NOT leave cycle advancement semantics implicit when reopening with an empty queue.
- Must NOT make the web infer lifecycle mode from raw `batchState` alone once API mode fields exist.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after with existing Foundry + Vitest + Playwright coverage
- QA policy: Every task includes concrete happy-path and failure-path scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: contract semantics, lifecycle decision table, backend telemetry policy, regression tests
Wave 2: provider/client/liquidity worker orchestration, API lifecycle payloads, contract/backend integration
Wave 3: web UX, Playwright coverage, deployment/readiness cleanup

### Dependency Matrix (full, all tasks)

| Task | Depends On  |
| ---- | ----------- |
| 1    | -           |
| 2    | 1           |
| 3    | 1           |
| 4    | 1           |
| 5    | 1           |
| 6    | 2,3,4,5     |
| 7    | 2,3,4       |
| 8    | 2,6,7       |
| 9    | 3,6,7       |
| 10   | 8,9         |
| 11   | 2,3,4,5,6,7 |
| 12   | 8,9,10      |
| 13   | 11,12       |

### Agent Dispatch Summary

| Wave | Task Count | Categories                                    |
| ---- | ---------- | --------------------------------------------- |
| 1    | 5          | deep, ultrabrain, unspecified-high            |
| 2    | 4          | deep, unspecified-high, quick                 |
| 3    | 4          | visual-engineering, unspecified-high, writing |

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Lock FlatBook position-driven semantics with failing contract tests

  **What to do**: Extend Foundry coverage so the desired lifecycle is explicit before any contract implementation changes. Add tests for flat/open instant deposit+withdraw, close-on-risk semantics, empty-queue reopen semantics, allocation not causing state transitions, and queue processing order when closed periods end. Fix the cycle rule now: every closed-period completion advances `currentCycleId`, even when queue is empty.
  **Must NOT do**: Do not change contract code in this task. Do not leave reopened-empty-cycle behavior implicit.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: contract invariants must be locked before refactoring.
  - Skills: `[]` — No special skill required.
  - Omitted: [`playwright`] — Browser tooling is irrelevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `contracts/src/FlatBookVaultV2.sol:466` — Current `closeBook()` entry point.
  - Pattern: `contracts/src/FlatBookVaultV2.sol:471` — Current `beginProcessing()` path and empty-queue revert.
  - Pattern: `contracts/src/FlatBookVaultV2.sol:605` — Current `finalizeProcessing()` reopen behavior.
  - Pattern: `contracts/src/FlatBookVaultV2.sol:627` — Current allocation restriction.
  - Test: `contracts/test/FlatBookVaultV2.t.sol` — Existing lifecycle tests to extend.
  - Test: `contracts/test/FlatBookVaultV2.conformance.t.sol` — Existing conformance assertions.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd contracts && forge test --match-path test/FlatBookVaultV2.t.sol` fails only on the newly added position-driven expectations before implementation.
  - [ ] New tests cover empty-queue reopen, allocation-without-close, open-position closed periods, and cycle advancement semantics.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Red contract spec for empty-queue reopen
    Tool: Bash
    Steps: Run `cd contracts && forge test --match-test testEmptyQueueReopenAdvancesCycle`
    Expected: Test fails before implementation because current contract lacks reopen-without-processing support.
    Evidence: .sisyphus/evidence/task-1-empty-queue-red.txt

  Scenario: Red contract spec for allocation without lifecycle mutation
    Tool: Bash
    Steps: Run `cd contracts && forge test --match-test testAllocationDoesNotDriveLifecycle`
    Expected: Test fails before implementation because allocation remains tied to Closed-only semantics.
    Evidence: .sisyphus/evidence/task-1-allocation-red.txt
  ```

  **Commit**: YES | Message: `test(contracts): lock flatbook position-driven lifecycle semantics` | Files: `contracts/test/FlatBookVaultV2.t.sol`, `contracts/test/FlatBookVaultV2.conformance.t.sol`, `contracts/test/FlatBookVaultV2.fuzz.t.sol`

- [x] 2. Implement contract support for empty-queue reopen and non-custody allocation

  **What to do**: Update `FlatBookVaultV2` so lifecycle supports the product model. Add `reopenIdleCycle()` (name fixed) callable only in `Closed`, requiring zero queued deposits and zero queued redeems for the current cycle, incrementing `currentCycleId`, setting `state = Open`, and emitting `IdleCycleReopened(uint256 closedCycleId, uint256 nextCycleId)`. Update `allocateToTradingWallet(uint256)` so it is callable in either `Open` or `Closed`, never mutates lifecycle state, and still enforces `AllocationExceedsAvailable`. Keep `beginProcessing()` strict: it still reverts on empty queue and remains the queued-processing path only.
  **Must NOT do**: Do not add new lifecycle states. Do not move position telemetry on-chain. Do not make allocation auto-close or auto-open the vault.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` — Reason: contract semantics are changing while preserving invariants.
  - Skills: `[]` — No extra skill required.
  - Omitted: [`playwright`] — Not relevant.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4,5,6,7 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `contracts/src/FlatBookVaultV2.sol:466` — Existing close transition.
  - Pattern: `contracts/src/FlatBookVaultV2.sol:627` — Existing allocation restriction to `Closed`.
  - API/Type: `contracts/src/interfaces/IERC7540.sol` — Preserve async request interface behavior.
  - Test: `contracts/test/FlatBookVaultV2.t.sol` — Must make red tests green.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd contracts && forge test --match-path test/FlatBookVaultV2.t.sol`
  - [ ] `cd contracts && forge test --match-path test/FlatBookVaultV2.fuzz.t.sol`
  - [ ] `cd contracts && forge test --match-path test/FlatBookVaultV2.conformance.t.sol`
  - [ ] `reopenIdleCycle()` increments the cycle and reopens only when queue is empty.
  - [ ] `allocateToTradingWallet()` succeeds in `Open` and `Closed` without changing `state`.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path reopen with empty queue
    Tool: Bash
    Steps: Run `cd contracts && forge test --match-test testEmptyQueueReopenAdvancesCycle`
    Expected: Test passes and asserts state returns to Open and cycle increments by exactly one.
    Evidence: .sisyphus/evidence/task-2-empty-queue-green.txt

  Scenario: Failure path processing still rejects empty queue
    Tool: Bash
    Steps: Run `cd contracts && forge test --match-test testBeginProcessingRejectsEmptyQueue`
    Expected: Test passes and confirms the old processing path still reverts on empty queue.
    Evidence: .sisyphus/evidence/task-2-processing-empty-queue.txt
  ```

  **Commit**: YES | Message: `feat(contracts): add reopen and allocation semantics for flatbook lifecycle` | Files: `contracts/src/FlatBookVaultV2.sol`, `contracts/test/FlatBookVaultV2*.t.sol`

- [x] 3. Encode the backend lifecycle decision table and worker tests

  **What to do**: Add a dedicated worker/liquidity test file that locks the decision table for FlatBook. The fixed table is: (1) stale/error telemetry -> no lifecycle transition, `riskState=unknown`; (2) risk-on telemetry -> ensure `Closed`, no queue processing, no reopen; (3) fully flat + queued work -> publish NAV once, then process queue; (4) fully flat + empty queue while Closed -> publish NAV once, then `reopenIdleCycle()`; (5) fully flat + already Open -> no periodic NAV write, no forced lifecycle transition. Use the full flatness gate (positions + orders + deployed capital + dust), not raw open-position count alone.
  **Must NOT do**: Do not leave lifecycle rules encoded only in prose. Do not permit stale telemetry to reopen the vault.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is the control-plane spec for the refactor.
  - Skills: `[]` — None needed.
  - Omitted: [`playwright`] — Backend-only task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4,5,6,7,8 | Blocked By: 2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `apps/vault-api/src/services/liquidityManager.ts:96` — Current reconciliation loop.
  - Pattern: `apps/vault-api/src/services/flatnessDetector.ts:167` — Current open-position check.
  - Pattern: `apps/vault-api/src/services/navOracle.ts:592` — Current NAV publish entry point.
  - Pattern: `apps/vault-api/src/worker.ts:93` — Current worker reconciliation path.
  - Test: `apps/vault-api/src/__tests__/settlementLifecycle.integration.test.ts` — Existing integration patterns.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts`
  - [ ] Tests explicitly assert close, process, reopen, and no-op branches for the five decision-table cases.
  - [ ] Tests verify allocation is not the trigger for close/reopen.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Risk-on telemetry closes but does not process
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts --testNamePattern "risk on closes and queues"`
    Expected: Test passes and shows closeBook called once, no processing methods called, no NAV publish.
    Evidence: .sisyphus/evidence/task-3-risk-on-close.txt

  Scenario: Stale telemetry makes no transition
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts --testNamePattern "stale telemetry blocks transitions"`
    Expected: Test passes and confirms no close/reopen/process call occurs.
    Evidence: .sisyphus/evidence/task-3-stale-telemetry.txt
  ```

  **Commit**: YES | Message: `test(vault-api): cover position-driven worker lifecycle orchestration` | Files: `apps/vault-api/src/__tests__/worker.flatBookLifecycle.test.ts`

- [x] 4. Refactor worker, liquidity manager, provider, and client to execute the decision table

  **What to do**: Implement the new lifecycle control flow across `worker.ts`, `liquidityManager.ts`, `customVaultProvider.ts`, and `customVaultClient.ts`. Add client support for `reopenIdleCycle()`. Remove the behavior where allocation drives close/open transitions. Use `FlatnessDetector` as the authoritative flatness signal. Ensure `closeBook()` is called only when transitioning from flat/open to risk-on/closed. Ensure `reopenIdleCycle()` or queue processing is called only when flatness is confirmed and telemetry is fresh. Preserve strict receipt-status checking in transaction confirmation.
  **Must NOT do**: Do not scatter lifecycle branching across routes and UI. Do not keep `closedBookBatchVault`-style assumptions in FlatBook paths.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: multi-file orchestration refactor with subtle sequencing.
  - Skills: `[]` — None needed.
  - Omitted: [`playwright`] — Not needed.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5,6,7,8,9 | Blocked By: 2,3

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `apps/vault-api/src/services/customVaultProvider.ts:1084` — Current rebalance logic that is still custody-driven.
  - Pattern: `apps/vault-api/src/services/customVaultClient.ts` — Current FlatBook ABI wrapper.
  - Pattern: `apps/vault-api/src/worker.ts:146` — Current NAV-health gate.
  - API/Type: `apps/vault-api/src/services/vaultProvider.ts` — Provider interface to keep aligned.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts src/__tests__/settlementLifecycle.integration.test.ts src/__tests__/customVaultClient.test.ts src/__tests__/customVaultProvider.readiness.test.ts src/__tests__/flatnessDetector.test.ts`
  - [ ] `cd apps/vault-api && pnpm build`
  - [ ] When mocked open positions are non-empty, worker closes once and never reopens/processes in the same tick.
  - [ ] When mocked flatness returns true and queue is empty, worker reopens via `reopenIdleCycle()` without `beginProcessing()`.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path flat + queued work
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/settlementLifecycle.integration.test.ts --testNamePattern "flat queue publishes nav then processes"`
    Expected: Test passes and proves NAV publish occurs once before redeem/deposit processing and reopen.
    Evidence: .sisyphus/evidence/task-4-flat-queued.txt

  Scenario: Failure path telemetry error
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts --testNamePattern "telemetry fetch failure is no-op"`
    Expected: Test passes and confirms no lifecycle transition occurs on fetch failure.
    Evidence: .sisyphus/evidence/task-4-telemetry-failure.txt
  ```

  **Commit**: YES | Message: `feat(vault-api): drive flatbook lifecycle from telemetry and queue state` | Files: `apps/vault-api/src/worker.ts`, `apps/vault-api/src/services/liquidityManager.ts`, `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/services/customVaultClient.ts`, related tests

- [x] 5. Make NAV publication transition-based instead of periodic during flat/open periods

  **What to do**: Refactor `NavOracleService` and worker scheduling so FlatBook NAV writes are transition-based. Preserve mark-to-market calculation, but suppress automatic on-chain NAV updates while the vault is already open and flat. Publish NAV exactly once when transitioning from risk-on/closed to flat/open or immediately before queue processing/reopen. Preserve manual operator-triggered refresh capability. Add lightweight transition memory in backend state/persistence so repeated worker ticks do not republish identical flat NAVs.
  **Must NOT do**: Do not remove live position valuation logic. Do not republish NAV every minute while already open and flat.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: focused service refactor with subtle operational behavior.
  - Skills: `[]` — None needed.
  - Omitted: [`playwright`] — Not applicable.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: 3

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `apps/vault-api/src/services/navOracle.ts:592` — Current NAV publish router.
  - Pattern: `apps/vault-api/src/worker.ts:49` — Current periodic NAV refresh path.
  - Test: `apps/vault-api/src/__tests__/navCalculator.test.ts` — Existing NAV test patterns.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts src/__tests__/navCalculator.test.ts`
  - [ ] Flat/open idle ticks do not republish NAV repeatedly.
  - [ ] Flat transition before reopen or queue processing publishes NAV exactly once per transition.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path transition-based NAV publish
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts --testNamePattern "flat transition publishes nav once"`
    Expected: Test passes and proves one NAV write across multiple flat ticks.
    Evidence: .sisyphus/evidence/task-5-flat-nav-once.txt

  Scenario: Failure path NAV publish blocks reopen
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts --testNamePattern "nav publish failure blocks reopen"`
    Expected: Test passes and confirms reopen/processing is skipped if NAV publish fails.
    Evidence: .sisyphus/evidence/task-5-nav-failure.txt
  ```

  **Commit**: YES | Message: `feat(vault-api): make flatbook nav publication transition-based` | Files: `apps/vault-api/src/services/navOracle.ts`, `apps/vault-api/src/worker.ts`, related tests

- [x] 6. Add explicit API lifecycle payloads for product mode and telemetry freshness

  **What to do**: Extend vault status/current-cycle payloads so the frontend never has to infer business mode from raw contract state. Add fixed response fields: `riskState: "flat" | "risk_on" | "unknown"`, `executionMode: "instant" | "queued" | "blocked"`, `telemetryFresh: boolean`, `openPositionCount: number | null`, `liquidityMode: "vault_liquid" | "recall_required" | "queued_only"`, and `reopenReady: boolean`. Compute these in API services/routes from the backend decision table, not ad hoc in the UI.
  **Must NOT do**: Do not break existing fields that other screens may still consume. Do not expose raw backend errors as user-facing lifecycle strings.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: API contract work with downstream UI consumers.
  - Skills: `[]` — None needed.
  - Omitted: [`playwright`] — Not needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8,9 | Blocked By: 4,5

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `apps/vault-api/src/routes/vaultRoutes.ts` — Existing vault status payload builder.
  - Pattern: `apps/vault-api/src/routes/customVaultRoutes.ts` — Existing custom vault route shapes.
  - Pattern: `apps/vault-web/src/types.ts` — Existing frontend status types.
  - Test: `apps/vault-api/src/__tests__/customVaultRoutes.test.ts` — Existing response-shape tests.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-api && pnpm vitest run src/__tests__/customVaultRoutes.test.ts src/__tests__/settlementLifecycle.integration.test.ts`
  - [ ] Vault status/current-cycle responses include all six new lifecycle fields with deterministic values.
  - [ ] Stale telemetry maps to `riskState="unknown"` and `executionMode="blocked"`.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path flat/open API payload
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/customVaultRoutes.test.ts --testNamePattern "flat lifecycle payload exposes instant mode"`
    Expected: Test passes and verifies `riskState=flat`, `executionMode=instant`, `telemetryFresh=true`.
    Evidence: .sisyphus/evidence/task-6-flat-payload.txt

  Scenario: Failure path stale telemetry API payload
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/customVaultRoutes.test.ts --testNamePattern "stale lifecycle payload blocks instant mode"`
    Expected: Test passes and verifies `riskState=unknown`, `executionMode=blocked`.
    Evidence: .sisyphus/evidence/task-6-stale-payload.txt
  ```

  **Commit**: YES | Message: `feat(vault-api): expose explicit flatbook lifecycle payloads` | Files: `apps/vault-api/src/routes/vaultRoutes.ts`, `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/types.ts`, related tests

- [x] 7. Implement instant-withdraw liquidity preflight and recall-on-demand

  **What to do**: Add a backend-assisted withdraw preflight flow for FlatBook. The fixed rule is: while `executionMode=instant`, if requested assets are covered by vault idle balance, the user signs a normal direct withdraw/redeem tx; otherwise the API exposes a `prepareInstantWithdraw` endpoint that triggers recall from trading wallet, waits for liquidity to arrive, and only then marks the withdraw as `ready`. If telemetry is stale/unknown or risk-on, the same request path must route to queued withdrawal instead. Do not recall capital preemptively when there is no withdrawal demand.
  **Must NOT do**: Do not claim instant withdraw is available when vault liquidity is short. Do not auto-recall simply because the vault is flat.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: mixes liquidity policy, API orchestration, and lifecycle correctness.
  - Skills: `[]` — None needed.
  - Omitted: [`playwright`] — Backend-first task.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 8,9,10 | Blocked By: 4,6

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `apps/vault-api/src/services/customVaultProvider.ts:1084` — Existing rebalance/recall path.
  - Pattern: `apps/vault-api/src/services/liquidityManager.ts:125` — Current rebalance entry point.
  - Pattern: `apps/vault-web/app/vault/[id]/vault-detail.tsx` — Current withdraw UX hooks to replace/extend.
  - Test: `apps/vault-api/src/__tests__/settlementLifecycle.integration.test.ts` — Existing liquidity integration patterns.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-api && pnpm vitest run src/__tests__/settlementLifecycle.integration.test.ts src/__tests__/worker.flatBookLifecycle.test.ts`
  - [ ] `prepareInstantWithdraw` returns `ready` only when vault-side idle liquidity is sufficient after any triggered recall.
  - [ ] No recall is triggered when there is no withdrawal request.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path recall-on-demand for flat/open withdraw
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/settlementLifecycle.integration.test.ts --testNamePattern "flat withdraw triggers recall only on demand"`
    Expected: Test passes and proves recall occurs only after preflight request and transitions to ready.
    Evidence: .sisyphus/evidence/task-7-recall-on-demand.txt

  Scenario: Failure path stale telemetry queues instead of preparing instant withdraw
    Tool: Bash
    Steps: Run `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts --testNamePattern "unknown telemetry blocks instant withdraw"`
    Expected: Test passes and confirms API routes the request to queued mode.
    Evidence: .sisyphus/evidence/task-7-stale-withdraw.txt
  ```

  **Commit**: YES | Message: `feat(vault-api): add instant withdraw liquidity preflight` | Files: `apps/vault-api/src/routes/*`, `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/services/liquidityManager.ts`, related tests

- [x] 8. Refactor vault-web lifecycle display to consume explicit API mode fields

  **What to do**: Update frontend types, hooks, and page state so `vault-detail` consumes the new API lifecycle fields instead of inferring behavior from raw `batchState`. Add a single lifecycle badge and control matrix using `riskState`, `executionMode`, `telemetryFresh`, `liquidityMode`, and `reopenReady`. Add explicit stale messaging banner using `data-testid="lifecycle-stale-banner"`.
  **Must NOT do**: Do not keep business logic duplicated in components. Do not infer `instant` purely from `batchState === "open"` once new fields exist.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: this is a UI contract and interaction-state refactor.
  - Skills: [`frontend-ui-ux`] — Helpful for clear state presentation.
  - Omitted: [`playwright`] — Used later for verification only.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 9,10 | Blocked By: 6

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `apps/vault-web/app/vault/[id]/vault-detail.tsx` — Current lifecycle-dependent controls.
  - Pattern: `apps/vault-web/src/lib/hooks.ts` — Current custom vault tx builders and state hooks.
  - API/Type: `apps/vault-web/src/types.ts` — Frontend payload types to extend.
  - Test: `apps/vault-web/e2e/lifecycle-happy-path.spec.ts` — Existing e2e patterns.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-web && pnpm build`
  - [ ] UI lifecycle badge derives solely from API mode fields for custom vaults.
  - [ ] `data-testid="lifecycle-stale-banner"` appears for unknown telemetry and disables instant actions.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path flat/open lifecycle rendering
    Tool: Playwright
    Steps: Load fixture/API state with `riskState=flat`, `executionMode=instant`, `telemetryFresh=true`; open `/vault/1`.
    Expected: `data-testid="vault-lifecycle-badge"` shows flat/instant mode and stale banner is absent.
    Evidence: .sisyphus/evidence/task-8-flat-ui.png

  Scenario: Failure path stale telemetry rendering
    Tool: Playwright
    Steps: Load fixture/API state with `riskState=unknown`, `executionMode=blocked`, `telemetryFresh=false`; open `/vault/1`.
    Expected: stale banner is visible and instant action buttons are disabled.
    Evidence: .sisyphus/evidence/task-8-stale-ui.png
  ```

  **Commit**: YES | Message: `feat(vault-web): render explicit flatbook lifecycle modes` | Files: `apps/vault-web/src/types.ts`, `apps/vault-web/src/lib/hooks.ts`, `apps/vault-web/app/vault/[id]/vault-detail.tsx`

- [x] 9. Implement deposit and withdraw action routing for instant vs queued modes

  **What to do**: Update web action handlers so custom vault actions route by API lifecycle mode. Deposit rules: `executionMode=instant` -> direct `deposit`, `executionMode=queued` -> `requestDeposit`, `executionMode=blocked` -> disabled. Withdraw rules: `executionMode=instant` + `liquidityMode=vault_liquid` -> direct `withdraw/redeem`; `executionMode=instant` + `liquidityMode=recall_required` -> call `prepareInstantWithdraw`, wait until ready, then launch direct wallet tx; `executionMode=queued` -> request-based withdraw path; `executionMode=blocked` -> disabled. Surface the exact mode text next to the CTA.
  **Must NOT do**: Do not show “instant” when the next step is actually a queued request. Do not call legacy `queueDeposit` for FlatBook.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: user-action routing plus UX wording.
  - Skills: [`frontend-ui-ux`] — Helpful for explicit stateful controls.
  - Omitted: [`playwright`] — Verification comes in the next task.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 10 | Blocked By: 7,8

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `apps/vault-web/src/constants.ts` — Current ABI definitions.
  - Pattern: `apps/vault-web/src/lib/hooks.ts` — Current `deposit` / `queueDeposit` logic.
  - Pattern: `apps/vault-web/app/vault/[id]/vault-detail.tsx` — Current CTA branch logic.
  - Test: `apps/vault-web/e2e/lifecycle-happy-path.spec.ts` — Existing end-to-end structure.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-web && pnpm build`
  - [ ] Flat/open deposit uses direct `deposit`.
  - [ ] Risk-on deposit uses `requestDeposit`.
  - [ ] Flat/open withdraw either uses direct withdraw or recall-preflight depending on `liquidityMode`.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path instant deposit routing
    Tool: Playwright
    Steps: Load fixture/API state with `executionMode=instant`; submit deposit from `/vault/1`.
    Expected: Browser tx builder encodes `deposit`, not `requestDeposit`.
    Evidence: .sisyphus/evidence/task-9-instant-deposit.png

  Scenario: Failure path blocked mode disables actions
    Tool: Playwright
    Steps: Load fixture/API state with `executionMode=blocked`; inspect deposit and withdraw controls.
    Expected: Both instant action buttons are disabled and queued actions are not misrepresented as instant.
    Evidence: .sisyphus/evidence/task-9-blocked-actions.png
  ```

  **Commit**: YES | Message: `feat(vault-web): route custom vault actions by lifecycle mode` | Files: `apps/vault-web/src/constants.ts`, `apps/vault-web/src/lib/hooks.ts`, `apps/vault-web/app/vault/[id]/vault-detail.tsx`

- [x] 10. Add end-to-end lifecycle verification and readiness checks

  **What to do**: Add a dedicated Playwright spec `apps/vault-web/e2e/flatbook-lifecycle.spec.ts` and finalize backend/contract verification coverage. The spec must cover flat/open instant mode, risk-on queued mode, stale telemetry blocked mode, and recall-preflight withdraw mode. Update any missing targeted Vitest tests so the entire feature is covered from contract to UI. Keep evidence paths stable.
  **Must NOT do**: Do not leave e2e coverage as skeletons. Do not rely on manual clicking as acceptance proof.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: cross-layer verification and QA glue.
  - Skills: [`playwright`] — Required for browser verification.
  - Omitted: [`frontend-ui-ux`] — Styling is not the focus.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: none | Blocked By: 8,9

  **References** (executor has NO interview context — be exhaustive):
  - Test: `apps/vault-web/e2e/erc7540-lifecycle.spec.ts` — Existing skeleton to learn fixture patterns from.
  - Test: `apps/vault-web/e2e/lifecycle-happy-path.spec.ts` — Existing UI E2E structure.
  - Test: `apps/vault-api/src/__tests__/customVaultRoutes.test.ts` — API payload verification pattern.
  - Test: `contracts/test/FlatBookVaultV2.t.sol` — Contract-level source of truth.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cd apps/vault-web && pnpm exec playwright test e2e/flatbook-lifecycle.spec.ts --project=chromium`
  - [ ] `cd apps/vault-web && pnpm build`
  - [ ] `cd apps/vault-api && pnpm vitest run src/__tests__/worker.flatBookLifecycle.test.ts src/__tests__/settlementLifecycle.integration.test.ts src/__tests__/customVaultRoutes.test.ts`
  - [ ] Playwright report is generated at `apps/vault-web/playwright-report/index.html`.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```text
  Scenario: Happy path risk-on queued mode
    Tool: Playwright
    Steps: Load fixture/API state with `riskState=risk_on`, `executionMode=queued`; open `/vault/1`; attempt deposit and withdraw.
    Expected: UI presents queued actions only and request paths are used.
    Evidence: .sisyphus/evidence/task-10-risk-on-queued.png

  Scenario: Failure path recall preflight timeout
    Tool: Playwright
    Steps: Load fixture/API state with `executionMode=instant`, `liquidityMode=recall_required`; force `prepareInstantWithdraw` to time out.
    Expected: UI shows explicit liquidity-preparation failure and does not launch the withdraw wallet tx.
    Evidence: .sisyphus/evidence/task-10-recall-timeout.png
  ```

  **Commit**: YES | Message: `test(vault-web): cover flatbook lifecycle end to end` | Files: `apps/vault-web/e2e/flatbook-lifecycle.spec.ts`, related backend/web tests

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy

- Commit 1: `test(contracts): lock flatbook position-driven lifecycle semantics`
- Commit 2: `feat(contracts): add reopen and allocation semantics for flatbook lifecycle`
- Commit 3: `test(vault-api): cover position-driven worker lifecycle orchestration`
- Commit 4: `feat(vault-api): drive flatbook lifecycle from telemetry and queue state`
- Commit 5: `test(vault-web): cover instant vs queued lifecycle UX`
- Commit 6: `feat(vault-web): render explicit flatbook lifecycle modes`

## Success Criteria

- The system stays `Open` while telemetry confirms flatness, regardless of whether trading capital still sits in the trading wallet.
- The system closes quickly after open-position detection and queues all new requests while risk is on.
- Empty-queue flat periods can reopen cleanly without deadlock.
- NAV publication happens exactly once on the flat-to-open return path.
- No automatic allocation/recall cycle is triggered solely by custody location.
- Deposit/withdraw UX matches backend lifecycle mode without relying on stale inference.
