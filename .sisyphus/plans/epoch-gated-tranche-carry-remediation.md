# Epoch-Gated Tranche Carry Remediation Plan

## TL;DR

> **Quick Summary**: Close the gap between current implementation and intended cohort-fair epoch architecture by fixing contract economics (freeze snapshots, carry ledger, chunked settlement, dust override), aligning backend/frontend semantics, and producing complete verification evidence.
>
> **Deliverables**:
>
> - Corrected `EpochTrancheVault` lifecycle semantics and bounded execution paths
> - Backend settlement execution and ledger reconciliation aligned to on-chain truth
> - Frontend lifecycle accuracy for accrued/claimed/carry/dust eligibility
> - Complete evidence set and passing final verification wave
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves + Final Verification
> **Critical Path**: T1 -> T4 -> T7 -> T11 -> T15 -> T18

---

## Context

### Original Request

Plan how to complete the remaining work after implementation reached 18 tasks but failed final verification gates.

### Interview Summary

**Key Discussions**:

- User requested planning-only continuation for unresolved gaps.
- Previous audit failures (F1/F3/F4) indicate architecture mismatch and incomplete evidence.
- Breaking changes are acceptable.

**Research Findings**:

- Current contract does not fully enforce intended cohort-fair economics.
- Evidence coverage is incomplete across many tasks.
- Scope fidelity checks detected drift beyond expected implementation surfaces.

### Metis Review

**Identified Gaps** (addressed):

- Missing explicit cohort freeze economics and carry ledger invariants
- Missing bounded settlement processing and robust evidence policy
- Missing acceptance criteria tied to executable verification

---

## Work Objectives

### Core Objective

Bring the current implementation into strict alignment with the intended epoch-gated tranche carry model and pass all final verification gates with reproducible evidence.

### Concrete Deliverables

- Contract fixes for freeze economics, carry accrual/claim semantics, dust override, and chunked settlement.
- Backend fixes replacing settlement stubs with contract-backed execution and reconciliation.
- Frontend/API behavior updates aligned to corrected lifecycle.
- Full evidence regeneration and verification closure.

### Definition of Done

- [ ] F1/F2/F3/F4 all PASS with explicit evidence and command outputs.
- [ ] `EpochTrancheVault` enforces all must-have economics and guardrails.
- [ ] All required evidence files exist and match scenario definitions.

### Must Have

- Cohort-level boundary-locked freeze economics.
- Per-user carry ledger semantics (`entitlement`, `accrued`, `claimed`, `carryRemaining`) consistent on-chain/off-chain.
- Threshold claims with finalized-tranche dust override.
- Delayed deposit minting using epoch-open snapshot pricing semantics.
- Settlement execution bounded (chunked), resumable, and auditable.

### Must NOT Have (Guardrails)

- No unbounded loops in settlement-critical paths.
- No silent/manual-only settlement assumptions in backend services.
- No missing evidence for task-completion claims.
- No scope creep outside contract/api/web/docs/remediation evidence surface.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — verification must be command/tool executable.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after + invariant suites)
- **Frameworks**: Foundry, Vitest, Next build, Playwright
- **Agent-Executed QA**: REQUIRED for every task

### QA Policy

- Contract: focused + full `forge test`
- Backend: targeted + full `pnpm --filter vault test`
- Frontend: `pnpm --filter vault-web build` + Playwright flow checks
- Evidence: `.sisyphus/evidence/task-{N}-{scenario}.{ext}` mandatory for each task

### Defaults Applied

- `minClaimThreshold`: 100 USDC
- `balancedUpfrontBps`: 5000
- `configActivationDelayEpochs`: 2
- `maxSettlementChunkSize`: 100
- `carryOrderingPolicy`: pro-rata within cohort
- `dustOverridePolicy`: enabled after tranche finalization
- `deploymentMode`: break-safe remediation (new deployment acceptable if required)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation corrections):
├── T1 Contract gap matrix + acceptance lock
├── T2 Freeze snapshot economics model
├── T3 Carry ledger model and invariants
├── T4 Epoch-open mint snapshot pricing model
├── T5 Settlement chunking/resume model
└── T6 Dust override/finalization model

Wave 2 (Core implementation):
├── T7 Implement freeze economics + request state transitions
├── T8 Implement carry ledger accounting + loss attribution
├── T9 Implement chunked settlement + cursor resume
├── T10 Implement threshold+dust claim paths
├── T11 Replace backend settlement stub with contract execution
└── T12 Backend reconciliation and state machine hardening

Wave 3 (Integration and proof):
├── T13 API lifecycle contract and deprecation hardening
├── T14 Frontend lifecycle and eligibility fidelity
├── T15 Contract invariants + scenario tests completion
├── T16 Backend integration tests and payload conformance
├── T17 Evidence regeneration for missing tasks (3-11,15-17)
└── T18 Scope cleanup + docs alignment + final preflight

Wave FINAL:
├── F1 Plan Compliance Audit
├── F2 Code Quality Review
├── F3 Real QA Replay
└── F4 Scope Fidelity Check
```

### Dependency Matrix

- T1 -> T7,T8,T9,T10,T11,T12,T15
- T2 -> T7,T8,T15
- T3 -> T8,T10,T11,T12,T15,T16
- T4 -> T7,T13,T14,T15
- T5 -> T9,T11,T15,T16
- T6 -> T10,T13,T14,T15
- T7 -> T11,T13,T15
- T8 -> T11,T12,T15,T16
- T9 -> T11,T15,T16
- T10 -> T13,T14,T15
- T11 -> T12,T13,T16,T17
- T12 -> T13,T16,T17
- T13 -> T14,T16,T17,T18
- T14 -> T17,T18
- T15 -> T17,T18
- T16 -> T17,T18
- T17 -> F1,F2,F3,F4
- T18 -> F1,F2,F3,F4

### Agent Dispatch Summary

- Wave 1: 6 agents (`deep`, `unspecified-high`, `quick` mix)
- Wave 2: 6 agents (`deep`, `ultrabrain`, `unspecified-high` mix)
- Wave 3: 6 agents (`unspecified-high`, `visual-engineering`, `writing`, `deep` mix)
- Final: 4 agents (`oracle`, `unspecified-high`, `deep`)

---

## TODOs

- [x] 1. Lock remediation acceptance matrix against reported failures

  **What to do**:
  - Create a strict requirement-to-code matrix for failed F1/F3/F4 checks and map each to concrete code locations and test expectations.
  - Freeze this matrix as the source of truth for all subsequent remediation tasks.

  **Must NOT do**:
  - Do not modify business semantics in this task.
  - Do not mark gaps resolved without executable checks.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Aligning audit failures to code/test requirements requires architectural precision.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: not required for matrix creation.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1
  - **Blocks**: T7,T8,T9,T10,T11,T12,T15
  - **Blocked By**: None

  **References**:
  - `.sisyphus/plans/epoch-gated-tranche-carry-redesign.md` - Original acceptance targets and task promises.
  - `.sisyphus/evidence/task-18-e2e-lifecycle.txt` - Claimed lifecycle behavior to validate/replace.
  - `contracts/src/EpochTrancheVault.sol` - Current contract behavior baseline.

  **Acceptance Criteria**:
  - [ ] Requirement matrix includes every failed F1/F3/F4 item with owner task and verification command.
  - [ ] Matrix explicitly labels unresolved vs resolved criteria.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Gap matrix is complete and machine-checkable
    Tool: Bash
    Preconditions: Matrix file exists in .sisyphus/evidence/
    Steps:
      1. Verify each failed F1/F3/F4 item appears exactly once in matrix
      2. Confirm each item has code reference + verification command
    Expected Result: No missing or duplicate unresolved criteria
    Failure Indicators: Missing criteria or criteria without verification command
    Evidence: .sisyphus/evidence/task-1-gap-matrix.txt

  Scenario: Matrix-to-task mapping is executable
    Tool: Bash
    Preconditions: Task IDs assigned in matrix
    Steps:
      1. Validate each matrix row maps to T2-T18 or final wave task
      2. Confirm no orphan requirement remains
    Expected Result: 100% mapping coverage
    Evidence: .sisyphus/evidence/task-1-gap-mapping.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-gap-matrix.txt
  - [ ] task-1-gap-mapping.txt

  **Commit**: YES
  - Message: `docs(vault): lock remediation acceptance matrix`
  - Files: `.sisyphus/evidence/*`
  - Pre-commit: `grep` coverage check commands

- [ ] 2. Implement boundary-locked freeze economics model

  **What to do**:
  - Ensure epoch freeze records immutable economic inputs used by subsequent settlement calculations.
  - Enforce request status transitions at freeze boundary for cohort isolation.

  **Must NOT do**:
  - Do not continue using mutable runtime values for frozen cohort economics.
  - Do not leave requests in ambiguous state after freeze.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core economic integrity and lifecycle transitions.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: non-UI task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7,T8,T15
  - **Blocked By**: T1

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - freeze/settle/request status flow.
  - `contracts/src/libraries/EpochMath.sol` - epoch boundary helper semantics.
  - `contracts/test/EpochTrancheVault.t.sol` - lifecycle test scaffolding.

  **Acceptance Criteria**:
  - [ ] Freeze stores immutable economic snapshot fields consumed by settlement.
  - [ ] Frozen cohort requests cannot be mutated or canceled.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Freeze locks economics for cohort
    Tool: Bash (forge test)
    Preconditions: Active epoch with pending requests
    Steps:
      1. Execute freezeEpoch
      2. Attempt mutation to frozen economics inputs
      3. Verify settlement uses frozen values
    Expected Result: Frozen values remain immutable and used by settlement
    Failure Indicators: Settlement reads mutable current values
    Evidence: .sisyphus/evidence/task-2-freeze-immutability.txt

  Scenario: Frozen requests are non-cancelable
    Tool: Bash (forge test)
    Preconditions: Request frozen in epoch
    Steps:
      1. Call cancel path after freeze
      2. Assert expected revert/custom error
    Expected Result: Cancel blocked deterministically
    Evidence: .sisyphus/evidence/task-2-freeze-cancel-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-freeze-immutability.txt
  - [ ] task-2-freeze-cancel-guard.txt

  **Commit**: YES
  - Message: `feat(vault): enforce boundary-locked freeze economics`
  - Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Freeze"`

- [ ] 3. Add canonical per-user carry ledger semantics

  **What to do**:
  - Implement explicit `entitlement`, `accrued`, `claimed`, `carryRemaining` semantics and invariants across contract and backend models.
  - Align repository models and claim state machine with canonical ledger equations.

  **Must NOT do**:
  - Do not maintain divergent legacy and new ledger semantics without reconciliation.
  - Do not allow negative or inconsistent carry states.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Cross-layer accounting consistency.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: not needed for ledger math.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T8,T10,T11,T12,T16
  - **Blocked By**: T1

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - request ledger fields and claim paths.
  - `apps/vault-api/src/repositories/entitlementRepository.ts` - payout/entitlement persistence.
  - `apps/vault-api/src/services/claimStateMachine.ts` - allowed lifecycle operations.

  **Acceptance Criteria**:
  - [ ] Ledger invariants hold: `0 <= claimed <= accrued <= entitlement`.
  - [ ] `carryRemaining` calculation is deterministic and loss-aware.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Ledger invariants survive multi-epoch accrual and claim
    Tool: Bash (forge test + vitest)
    Preconditions: Multiple users across at least two realization cycles
    Steps:
      1. Apply accrual updates and claims
      2. Assert invariant equations on-chain and in repository rows
    Expected Result: Invariants pass for all users/cohorts
    Failure Indicators: Over-claim, negative carry, or divergence
    Evidence: .sisyphus/evidence/task-3-ledger-invariants.txt

  Scenario: Repository and contract ledgers reconcile
    Tool: Bash (vitest)
    Preconditions: Contract events ingested into backend
    Steps:
      1. Query contract state and repository state for same requests
      2. Compare accrued/claimed/carry fields
    Expected Result: 1:1 value match
    Evidence: .sisyphus/evidence/task-3-ledger-reconcile.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-ledger-invariants.txt
  - [ ] task-3-ledger-reconcile.txt

  **Commit**: YES
  - Message: `feat(vault): normalize carry ledger semantics across layers`
  - Files: `contracts/src/EpochTrancheVault.sol`, `apps/vault-api/src/repositories/*.ts`, `apps/vault-api/src/services/claimStateMachine.ts`
  - Pre-commit: `pnpm --filter vault test -- epochRepository.invariants`

- [ ] 4. Enforce epoch-open snapshot pricing for delayed mint

  **What to do**:
  - Replace mutable `currentNAV` mint conversion with epoch-open snapshot/PPS semantics.
  - Persist and consume the same snapshot in all mint finalization paths.

  **Must NOT do**:
  - Do not derive delayed mint from runtime NAV at processing time.
  - Do not permit minting before target epoch open.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Pricing correctness directly affects equity fairness.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `dev-browser`: no browser interaction.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T7,T13,T15
  - **Blocked By**: T1

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - `queueDeposit` and `processDepositQueue` flows.
  - `contracts/src/libraries/EpochMath.sol` - epoch-open boundary checks.
  - `apps/vault-api/src/services/customVaultProvider.ts` - delayed mint API semantics.

  **Acceptance Criteria**:
  - [ ] Mint conversion uses persisted epoch-open snapshot values.
  - [ ] Requests minted exactly once when target epoch opens.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Delayed mint uses epoch-open snapshot, not current NAV
    Tool: Bash (forge test)
    Preconditions: NAV changes between queue and processing time
    Steps:
      1. Queue deposit in epoch N
      2. Change current NAV before processing
      3. Process deposit at epoch N+1 open
      4. Assert shares use epoch-open snapshot, not latest NAV
    Expected Result: Mint output matches snapshot conversion
    Failure Indicators: Mint output tracks mutable NAV
    Evidence: .sisyphus/evidence/task-4-epoch-open-pricing.txt

  Scenario: Early mint attempt is rejected
    Tool: Bash (forge test)
    Preconditions: Target epoch not yet open
    Steps:
      1. Call processDepositQueue before open boundary
      2. Assert expected revert
    Expected Result: Mint blocked before boundary
    Evidence: .sisyphus/evidence/task-4-early-mint-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] task-4-epoch-open-pricing.txt
  - [ ] task-4-early-mint-guard.txt

  **Commit**: YES
  - Message: `fix(vault): enforce epoch-open pricing for delayed mint`
  - Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*DepositQueue"`

- [ ] 5. Implement bounded settlement chunking and resume cursors

  **What to do**:
  - Replace unbounded settlement loops with chunked processing and resumable cursors.
  - Expose deterministic chunk progress to backend/evidence flows.

  **Must NOT do**:
  - Do not process entire cohort in a single unbounded transaction.
  - Do not lose deterministic ordering guarantees across chunks.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: High-risk algorithmic correctness under gas limits.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: non-UI.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T9,T11,T15,T16
  - **Blocked By**: T1

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - current `settleEpoch` implementation.
  - `contracts/src/SnapshotTrancheVault.sol` - baseline tranche-processing patterns.
  - `apps/vault-api/src/services/customVaultProvider.ts` - settlement orchestration hooks.

  **Acceptance Criteria**:
  - [ ] Settlement supports chunk size cap and resume index.
  - [ ] Chunked execution outcome equals single-pass reference math.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Large cohort settles across multiple chunks
    Tool: Bash (forge test)
    Preconditions: Cohort > max chunk size
    Steps:
      1. Settle chunk 1 and record cursor/progress
      2. Resume chunk 2..N until completion
      3. Verify total allocations match expected aggregate
    Expected Result: Deterministic completion with bounded gas per chunk
    Failure Indicators: Cursor corruption, double processing, or mismatch totals
    Evidence: .sisyphus/evidence/task-5-chunked-settlement.txt

  Scenario: Interrupted settlement resumes safely
    Tool: Bash (forge test)
    Preconditions: Simulated revert mid-sequence
    Steps:
      1. Execute first chunk successfully
      2. Force failure on next call
      3. Resume after fixing condition
    Expected Result: No replay/skip of processed requests
    Evidence: .sisyphus/evidence/task-5-resume-safety.txt
  ```

  **Evidence to Capture:**
  - [ ] task-5-chunked-settlement.txt
  - [ ] task-5-resume-safety.txt

  **Commit**: YES
  - Message: `fix(vault): add bounded chunked settlement with resume cursors`
  - Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Chunk|test.*Settle"`

- [ ] 6. Add finalized-tranche dust override for threshold claims

  **What to do**:
  - Preserve threshold gating during active lifecycle.
  - Add explicit finalized-tranche override path to allow residual dust claims.

  **Must NOT do**:
  - Do not bypass threshold before tranche finalization.
  - Do not leave residual balances permanently unclaimable.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Claim-policy correctness across edge transitions.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: contract-focused.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T10,T13,T14,T15
  - **Blocked By**: T1

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - `redeem`/`withdraw`/finalization paths.
  - `apps/vault-api/src/services/customVaultProvider.ts` - claim eligibility derivation.
  - `apps/vault-web/src/lib/hooks.ts` - UI gating behavior.

  **Acceptance Criteria**:
  - [ ] Threshold enforced while tranche open.
  - [ ] Finalized tranche enables dust claim override.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Threshold blocks sub-minimum claim pre-finalization
    Tool: Bash (forge test)
    Preconditions: claimable < min threshold, tranche open
    Steps:
      1. Attempt claim
      2. Assert revert
    Expected Result: Claim blocked
    Evidence: .sisyphus/evidence/task-6-threshold-block.txt

  Scenario: Dust claim succeeds after finalization
    Tool: Bash (forge test)
    Preconditions: claimable < min threshold, tranche finalized
    Steps:
      1. Finalize tranche
      2. Attempt claim
    Expected Result: Claim succeeds and residual cleared
    Evidence: .sisyphus/evidence/task-6-dust-override.txt
  ```

  **Evidence to Capture:**
  - [ ] task-6-threshold-block.txt
  - [ ] task-6-dust-override.txt

  **Commit**: YES
  - Message: `fix(vault): add finalized-tranche dust claim override`
  - Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Threshold|test.*Dust"`

- [ ] 7. Implement contract freeze-state request transitions

  **What to do**:
  - Update request lifecycle transitions to explicitly enter frozen cohort state and align claimability rules.
  - Ensure status transitions are deterministic and event-backed.

  **Must NOT do**:
  - Do not allow pending requests to skip required freeze transition semantics.
  - Do not leave ambiguous state overlap between pending/frozen/claimable.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Lifecycle state correctness underpins all downstream logic.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: implementation task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T11,T13,T15
  - **Blocked By**: T2,T4

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - request status enum and transition functions.
  - `contracts/test/EpochTrancheVault.t.sol` - lifecycle transition tests.
  - `apps/vault-api/src/services/claimStateMachine.ts` - backend operation guards.

  **Acceptance Criteria**:
  - [ ] Transition graph is explicit and enforced on-chain.
  - [ ] Backend state machine maps exactly to on-chain transitions.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Request follows pending->frozen->claimable path
    Tool: Bash (forge test)
    Preconditions: Valid request created in active epoch
    Steps:
      1. Freeze epoch
      2. Settle epoch
      3. Assert status transitions in order
    Expected Result: Exact transition sequence without skips
    Evidence: .sisyphus/evidence/task-7-state-transitions.txt

  Scenario: Invalid state transition is rejected
    Tool: Bash (forge test)
    Preconditions: Request in pending state
    Steps:
      1. Attempt claim directly before freeze/settle
      2. Assert revert/error
    Expected Result: Invalid operation blocked
    Evidence: .sisyphus/evidence/task-7-invalid-transition.txt
  ```

  **Evidence to Capture:**
  - [ ] task-7-state-transitions.txt
  - [ ] task-7-invalid-transition.txt

  **Commit**: YES
  - Message: `fix(vault): enforce explicit freeze-state transitions`
  - Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`, `apps/vault-api/src/services/claimStateMachine.ts`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Transition"`

- [ ] 8. Implement carry accrual and realized-loss attribution logic

  **What to do**:
  - Implement explicit realized P/L attribution to cohort carry pools and user accrual.
  - Ensure carry remaining reflects losses and payouts correctly.

  **Must NOT do**:
  - Do not treat carry as static `entitlement - claimed` without realized adjustments.
  - Do not mix cohorts in accrual updates.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Economics-sensitive and mathematically strict behavior.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not relevant.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T11,T12,T15,T16
  - **Blocked By**: T3,T2

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - settlement/finalization paths.
  - `apps/vault-api/src/repositories/realizationRepository.ts` - realized event persistence.
  - `apps/vault-api/src/repositories/entitlementRepository.ts` - entitlement/accrual fields.

  **Acceptance Criteria**:
  - [ ] Realized losses reduce accrual/carry according to cohort rules.
  - [ ] Conservation equation holds: paid + remaining = realized allocation (rounding bounded).

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Cohort absorbs post-boundary loss
    Tool: Bash (forge test)
    Preconditions: Frozen cohort with unresolved positions
    Steps:
      1. Apply negative realization to cohort
      2. Recompute accruals
      3. Verify cohort claims decrease while non-cohort unaffected
    Expected Result: Loss attribution remains cohort-fair
    Evidence: .sisyphus/evidence/task-8-loss-attribution.txt

  Scenario: Carry conservation invariant holds
    Tool: Bash (forge test + vitest)
    Preconditions: Multi-user cohort with partial claims
    Steps:
      1. Process realizations and claims
      2. Validate conservation equation
    Expected Result: No value leakage/creation beyond rounding tolerance
    Evidence: .sisyphus/evidence/task-8-carry-conservation.txt
  ```

  **Evidence to Capture:**
  - [ ] task-8-loss-attribution.txt
  - [ ] task-8-carry-conservation.txt

  **Commit**: YES
  - Message: `fix(vault): add realized-loss carry attribution logic`
  - Files: `contracts/src/EpochTrancheVault.sol`, `apps/vault-api/src/repositories/*.ts`, `contracts/test/EpochTrancheVault.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Fairness|test.*Carry"`

- [ ] 9. Replace backend settlement stub with contract-backed execution

  **What to do**:
  - Replace placeholder settlement success responses with real contract calls and transaction result handling.
  - Add retries/error states and tx-hash based reconciliation.

  **Must NOT do**:
  - Do not return success before on-chain settlement confirmation.
  - Do not swallow on-chain errors.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Backend execution reliability and correctness.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: backend-only.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T12,T13,T16,T17
  - **Blocked By**: T5,T7,T8

  **References**:
  - `apps/vault-api/src/services/customVaultProvider.ts` - settlement orchestration entrypoint.
  - `apps/vault-api/src/services/customVaultClient.ts` - contract transaction wrappers.
  - `apps/vault-api/src/services/vaultHealthMonitor.ts` - post-settlement health checks.

  **Acceptance Criteria**:
  - [ ] Settlement endpoint returns success only after confirmed tx.
  - [ ] Failed on-chain settlement returns structured error with reason.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Successful settlement persists confirmed tx hash
    Tool: Bash (curl + logs)
    Preconditions: Runnable local backend and funded signer
    Steps:
      1. Trigger settlement endpoint
      2. Verify tx hash returned and persisted
      3. Verify on-chain state changed accordingly
    Expected Result: Success tied to confirmed chain transaction
    Evidence: .sisyphus/evidence/task-9-settlement-tx-success.txt

  Scenario: On-chain settlement failure surfaces error
    Tool: Bash (curl + logs)
    Preconditions: Invalid settle precondition (e.g., wrong epoch state)
    Steps:
      1. Trigger settlement
      2. Assert non-200 response and reason details
    Expected Result: No false-positive success response
    Evidence: .sisyphus/evidence/task-9-settlement-error-path.txt
  ```

  **Evidence to Capture:**
  - [ ] task-9-settlement-tx-success.txt
  - [ ] task-9-settlement-error-path.txt

  **Commit**: YES
  - Message: `fix(vault-api): execute settlement via contract tx confirmation`
  - Files: `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/services/customVaultClient.ts`
  - Pre-commit: `pnpm --filter vault test -- provider`

- [ ] 10. Harden backend reconciliation and remove dual-ledger ambiguity

  **What to do**:
  - Remove/bridge legacy fields where they conflict with canonical carry ledger semantics.
  - Add deterministic reconciliation routine between contract state and repository state.

  **Must NOT do**:
  - Do not keep unsynchronized legacy/new counters in active paths.
  - Do not silently auto-correct mismatches without evidence logs.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Data integrity and persistence consistency.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `visual-engineering`: no UI scope.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T12,T16,T17
  - **Blocked By**: T3,T9

  **References**:
  - `apps/vault-api/src/repositories/entitlementRepository.ts`
  - `apps/vault-api/src/repositories/payoutRepository.ts`
  - `apps/vault-api/src/repositories/epochRepository.ts`

  **Acceptance Criteria**:
  - [ ] Reconciliation job reports zero unexplained deltas after successful settlement/claim cycle.
  - [ ] Legacy/new field mapping is explicit and tested.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Reconciliation detects and reports mismatch
    Tool: Bash (vitest)
    Preconditions: Seed one intentional mismatch record
    Steps:
      1. Run reconciliation routine
      2. Verify mismatch surfaced with deterministic reason
    Expected Result: Mismatch detected and logged with request identifier
    Evidence: .sisyphus/evidence/task-10-reconcile-detect.txt

  Scenario: Reconciliation passes on clean run
    Tool: Bash (vitest)
    Preconditions: Contract/repo state synced
    Steps:
      1. Run reconciliation routine
      2. Verify zero unresolved deltas
    Expected Result: PASS with zero mismatch report
    Evidence: .sisyphus/evidence/task-10-reconcile-clean.txt
  ```

  **Evidence to Capture:**
  - [ ] task-10-reconcile-detect.txt
  - [ ] task-10-reconcile-clean.txt

  **Commit**: YES
  - Message: `fix(vault-api): harden contract-repo reconciliation`
  - Files: `apps/vault-api/src/repositories/*.ts`, `apps/vault-api/src/services/*`
  - Pre-commit: `pnpm --filter vault test -- epochRepository entitlementRepository`

- [ ] 11. Update API contract for corrected lifecycle semantics

  **What to do**:
  - Ensure API payloads expose corrected lifecycle fields (`entitlement`, `accrued`, `claimed`, `carryRemaining`, `claimableNow`, `minClaimThreshold`, `dustOverrideEligible`).
  - Guarantee deprecated routes return explicit replacement guidance.

  **Must NOT do**:
  - Do not return stale `pending/settled` semantics in active endpoints.
  - Do not expose partial-claim behavior contradicting threshold policy.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: API correctness across consumers.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: API task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T13,T14,T16,T17
  - **Blocked By**: T6,T9,T10

  **References**:
  - `apps/vault-api/src/routes/customVaultRoutes.ts`
  - `apps/vault-api/src/services/customVaultProvider.ts`
  - `apps/vault-api/src/__tests__/customVaultRoutes.test.ts`

  **Acceptance Criteria**:
  - [ ] API responses include full corrected lifecycle fields.
  - [ ] Deprecated endpoints respond with deterministic 410 + replacement endpoint.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Lifecycle endpoint returns corrected carry fields
    Tool: Bash (curl)
    Preconditions: API server running with seeded lifecycle data
    Steps:
      1. GET lifecycle status endpoint
      2. Assert required fields exist and numeric relations hold
    Expected Result: Payload schema matches remediation contract
    Evidence: .sisyphus/evidence/task-11-api-lifecycle-schema.txt

  Scenario: Deprecated endpoint returns explicit guidance
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. Call legacy endpoint
      2. Assert 410 response and replacement endpoint field
    Expected Result: No silent fallback to legacy logic
    Evidence: .sisyphus/evidence/task-11-api-deprecation.txt
  ```

  **Evidence to Capture:**
  - [ ] task-11-api-lifecycle-schema.txt
  - [ ] task-11-api-deprecation.txt

  **Commit**: YES
  - Message: `fix(vault-api): align route contract with corrected lifecycle`
  - Files: `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/__tests__/customVaultRoutes.test.ts`
  - Pre-commit: `pnpm --filter vault test -- customVaultRoutes`

- [ ] 12. Align frontend lifecycle UX to corrected API contract

  **What to do**:
  - Update hooks and UI rendering to corrected lifecycle fields and dust override eligibility.
  - Ensure claim CTA logic is fully driven by backend eligibility fields.

  **Must NOT do**:
  - Do not display contradictory labels relative to backend state.
  - Do not enable claim CTA when `claimableNow` is false.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: User-facing lifecycle interpretation and interaction gating.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: required for accurate and clear state presentation.
  - **Skills Evaluated but Omitted**:
    - `react-doctor`: optional follow-up, not core implementation.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T14,T17,T18
  - **Blocked By**: T6,T11

  **References**:
  - `apps/vault-web/src/lib/hooks.ts`
  - `apps/vault-web/src/lib/api.ts`
  - `apps/vault-web/app/vault/[id]/vault-detail.tsx`

  **Acceptance Criteria**:
  - [ ] Lifecycle labels match corrected backend semantics.
  - [ ] Claim CTA gating respects threshold and dust override states.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Claim CTA disables/enables based on corrected eligibility
    Tool: Playwright
    Preconditions: Fixture states for ineligible, eligible, and dust-override users
    Steps:
      1. Load vault detail page
      2. Assert CTA disabled for ineligible state
      3. Assert CTA enabled for eligible and dust-override states
    Expected Result: CTA behavior matches backend eligibility contract
    Evidence: .sisyphus/evidence/task-12-claim-cta-gating.png

  Scenario: Lifecycle labels match backend states
    Tool: Playwright
    Preconditions: API responses include corrected status variants
    Steps:
      1. Render lifecycle cards/table
      2. Verify labels/text per state
    Expected Result: No stale pending/settled wording in active flow
    Evidence: .sisyphus/evidence/task-12-lifecycle-label-fidelity.png
  ```

  **Evidence to Capture:**
  - [ ] task-12-claim-cta-gating.png
  - [ ] task-12-lifecycle-label-fidelity.png

  **Commit**: YES
  - Message: `fix(vault-web): align lifecycle UX with corrected carry semantics`
  - Files: `apps/vault-web/src/lib/api.ts`, `apps/vault-web/src/lib/hooks.ts`, `apps/vault-web/app/vault/[id]/vault-detail.tsx`
  - Pre-commit: `pnpm --filter vault-web build`

- [ ] 13. Complete contract invariant suite for remediation must-haves

  **What to do**:
  - Add targeted invariant and scenario tests for freeze economics, carry conservation, threshold+dust, and chunked settlement.
  - Replace placeholder/legacy assertions with executable behavior checks.

  **Must NOT do**:
  - Do not rely on compile-only tests.
  - Do not skip negative/error-path assertions.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Invariant testing depth across multiple contract paths.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: non-doc task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: T17,T18
  - **Blocked By**: T2,T3,T4,T5,T6,T7,T8,T9,T10

  **References**:
  - `contracts/test/EpochTrancheVault.t.sol`
  - `contracts/src/EpochTrancheVault.sol`
  - `contracts/test/EpochMath.t.sol`

  **Acceptance Criteria**:
  - [ ] New invariants fail before fixes and pass after fixes.
  - [ ] No unresolved compilation/runtime failures in remediation test suite.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full contract remediation test suite passes
    Tool: Bash (forge test)
    Preconditions: Remediation contract changes applied
    Steps:
      1. Run targeted remediation test subset
      2. Run full contract suite
    Expected Result: PASS with zero failing remediation invariants
    Evidence: .sisyphus/evidence/task-13-contract-remediation-tests.txt

  Scenario: Regression check against prior failure signatures
    Tool: Bash (forge test)
    Preconditions: Historical failing scenarios encoded as tests
    Steps:
      1. Execute prior-failure tests
      2. Verify failures no longer reproduce
    Expected Result: Historical failure scenarios resolved
    Evidence: .sisyphus/evidence/task-13-regression-resolution.txt
  ```

  **Evidence to Capture:**
  - [ ] task-13-contract-remediation-tests.txt
  - [ ] task-13-regression-resolution.txt

  **Commit**: YES
  - Message: `test(vault): add remediation invariants and regression suite`
  - Files: `contracts/test/EpochTrancheVault.t.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test`

- [ ] 14. Complete backend integration suite for corrected settlement lifecycle

  **What to do**:
  - Add/repair integration tests for settlement execution, reconciliation, API payload correctness, and error paths.
  - Ensure tests validate actual corrected lifecycle semantics end-to-end.

  **Must NOT do**:
  - Do not keep tests tied to removed method names/legacy assumptions.
  - Do not treat mocked success as integration success.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-module backend behavior verification.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: backend-focused test task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: T17,T18
  - **Blocked By**: T9,T10,T11,T12

  **References**:
  - `apps/vault-api/src/__tests__/customVaultClient.test.ts`
  - `apps/vault-api/src/__tests__/customVaultRoutes.test.ts`
  - `apps/vault-api/src/__tests__/epochRepository.invariants.test.ts`

  **Acceptance Criteria**:
  - [ ] Integration tests assert corrected carry and settlement semantics.
  - [ ] No failing tests due to stale method/API expectations.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Backend integration suite passes for corrected lifecycle
    Tool: Bash (vitest)
    Preconditions: Updated backend services/routes/repositories
    Steps:
      1. Run targeted integration tests
      2. Confirm settlement and claim flow assertions
    Expected Result: PASS with corrected semantic coverage
    Evidence: .sisyphus/evidence/task-14-backend-integration-tests.txt

  Scenario: Error-path integration assertions pass
    Tool: Bash (vitest)
    Preconditions: Invalid state/input scenarios included
    Steps:
      1. Execute error-path tests
      2. Validate expected status codes and error payloads
    Expected Result: Robust failure-mode handling validated
    Evidence: .sisyphus/evidence/task-14-backend-error-paths.txt
  ```

  **Evidence to Capture:**
  - [ ] task-14-backend-integration-tests.txt
  - [ ] task-14-backend-error-paths.txt

  **Commit**: YES
  - Message: `test(vault-api): complete integration suite for corrected lifecycle`
  - Files: `apps/vault-api/src/__tests__/*.test.ts`
  - Pre-commit: `pnpm --filter vault test`

- [ ] 15. Regenerate missing evidence set for remediation and prior gaps

  **What to do**:
  - Regenerate evidence for missing tasks (historically absent: tasks 3-11, 15-17 plus remediation tasks).
  - Standardize evidence naming and include command outputs/screenshots/response payloads.

  **Must NOT do**:
  - Do not leave narrative-only evidence without executable output.
  - Do not mark task complete without required evidence paths present.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Evidence bundle completeness and auditability.
  - **Skills**: [`playwright`]
    - `playwright`: required for UI screenshot artifacts.
  - **Skills Evaluated but Omitted**:
    - `git-master`: unrelated to evidence generation.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: T18,F1,F3
  - **Blocked By**: T9,T11,T12,T13,T14

  **References**:
  - `.sisyphus/evidence/` - canonical evidence location.
  - `.sisyphus/plans/epoch-gated-tranche-carry-remediation.md` - required evidence filenames.

  **Acceptance Criteria**:
  - [ ] All required evidence files exist with non-empty, relevant content.
  - [ ] Evidence content references exact commands/selectors/assertions used.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Evidence inventory reaches 100% required coverage
    Tool: Bash
    Preconditions: Evidence generation complete
    Steps:
      1. Enumerate required evidence list from plan
      2. Verify each file exists and non-zero size
    Expected Result: Coverage = 100%
    Failure Indicators: Missing or empty evidence files
    Evidence: .sisyphus/evidence/task-15-evidence-inventory.txt

  Scenario: Evidence quality check passes
    Tool: Bash
    Preconditions: Evidence files present
    Steps:
      1. Sample each evidence file for command/output/assertion presence
      2. Verify no placeholder-only content
    Expected Result: Audit-ready evidence quality
    Evidence: .sisyphus/evidence/task-15-evidence-quality.txt
  ```

  **Evidence to Capture:**
  - [ ] task-15-evidence-inventory.txt
  - [ ] task-15-evidence-quality.txt

  **Commit**: YES
  - Message: `docs(evidence): regenerate complete remediation evidence set`
  - Files: `.sisyphus/evidence/*`
  - Pre-commit: evidence inventory script/check command

- [ ] 16. Perform scope cleanup and isolate remediation-only diff

  **What to do**:
  - Remove/segregate unrelated changes from remediation branch/workset.
  - Ensure final diff only contains in-scope contract/api/web/docs/evidence updates.

  **Must NOT do**:
  - Do not keep unrelated lockfile/ui/submodule/cache drifts in remediation output.
  - Do not delete required artifacts for this plan.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused hygiene and scope isolation operations.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not relevant.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: T18,F4
  - **Blocked By**: T13,T14,T15

  **References**:
  - `.sisyphus/plans/epoch-gated-tranche-carry-remediation.md` - explicit scope boundary.
  - `git diff --stat` / `git status` - source of truth for scope drift.

  **Acceptance Criteria**:
  - [ ] Out-of-scope files are excluded from remediation deliverable set.
  - [ ] Scope diff aligns with declared plan boundaries.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Scope diff contains only planned surfaces
    Tool: Bash
    Preconditions: Cleanup complete
    Steps:
      1. Run git diff --stat
      2. Classify every changed file against scope allowlist
    Expected Result: 0 out-of-scope files in remediation set
    Evidence: .sisyphus/evidence/task-16-scope-diff-clean.txt

  Scenario: Required in-scope files remain present
    Tool: Bash
    Preconditions: Cleanup complete
    Steps:
      1. Verify required contract/api/web/docs files still changed as expected
      2. Verify no required file was accidentally dropped
    Expected Result: Scope-clean and complete remediation set
    Evidence: .sisyphus/evidence/task-16-scope-required-files.txt
  ```

  **Evidence to Capture:**
  - [ ] task-16-scope-diff-clean.txt
  - [ ] task-16-scope-required-files.txt

  **Commit**: YES
  - Message: `chore(vault): isolate remediation diff to planned scope`
  - Files: scope cleanup set
  - Pre-commit: `git diff --stat` scope check

- [ ] 17. Update operational runbook to corrected lifecycle semantics

  **What to do**:
  - Update runbook/docs to match corrected contract/backend/frontend behavior (including freeze economics, chunking, dust override, reconciliation).
  - Remove contradictory statements from previous evidence/docs.

  **Must NOT do**:
  - Do not document behavior not enforced by code/tests.
  - Do not keep conflicting threshold or lifecycle definitions.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Documentation correctness and operator clarity.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: optional for docs-only task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: T18,F1
  - **Blocked By**: T11,T12,T15

  **References**:
  - `VAULT_KNOWLEDGE.md`
  - `.sisyphus/evidence/task-18-e2e-lifecycle.txt`
  - `apps/vault-api/src/routes/customVaultRoutes.ts`

  **Acceptance Criteria**:
  - [ ] Runbook reflects corrected lifecycle exactly.
  - [ ] Deprecated behaviors clearly marked and mapped to replacements.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Documentation-to-code consistency check passes
    Tool: Bash
    Preconditions: Docs updated
    Steps:
      1. Cross-check documented lifecycle against contract and route behavior
      2. Verify no contradictory threshold/status values
    Expected Result: No doc/code mismatch
    Evidence: .sisyphus/evidence/task-17-doc-consistency.txt

  Scenario: Operator runbook completeness check passes
    Tool: Bash
    Preconditions: Runbook includes operational procedures
    Steps:
      1. Verify freeze/settle/finalize/reconcile procedures present
      2. Verify failure handling and rollback notes included
    Expected Result: Operator-ready runbook
    Evidence: .sisyphus/evidence/task-17-runbook-completeness.txt
  ```

  **Evidence to Capture:**
  - [ ] task-17-doc-consistency.txt
  - [ ] task-17-runbook-completeness.txt

  **Commit**: YES
  - Message: `docs(vault): align runbook with corrected lifecycle semantics`
  - Files: `VAULT_KNOWLEDGE.md`, `.sisyphus/evidence/*`
  - Pre-commit: doc consistency checklist

- [ ] 18. Execute remediation preflight and handoff package

  **What to do**:
  - Run full contract/backend/frontend verification commands.
  - Produce preflight summary artifact with pass/fail matrix for all remediation tasks and evidence completeness.

  **Must NOT do**:
  - Do not handoff with unresolved red checks.
  - Do not skip build/test commands in final preflight.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Final integration and gating decision task.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: no design changes.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 final task
  - **Blocks**: F1,F2,F3,F4
  - **Blocked By**: T13,T14,T15,T16,T17

  **References**:
  - `.sisyphus/plans/epoch-gated-tranche-carry-remediation.md`
  - `.sisyphus/evidence/`
  - `contracts/src/EpochTrancheVault.sol`

  **Acceptance Criteria**:
  - [ ] Preflight matrix artifact exists and includes all task statuses.
  - [ ] Verification commands executed with captured outputs.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full preflight command suite passes
    Tool: Bash
    Preconditions: All remediation tasks complete
    Steps:
      1. Run contract test/build commands
      2. Run backend build/test commands
      3. Run frontend build command
    Expected Result: All commands exit 0
    Evidence: .sisyphus/evidence/task-18-preflight-commands.txt

  Scenario: Handoff package completeness check
    Tool: Bash
    Preconditions: Evidence and docs finalized
    Steps:
      1. Validate required evidence list against files present
      2. Validate preflight matrix includes F1-F4 entries
    Expected Result: Handoff package complete and audit-ready
    Evidence: .sisyphus/evidence/task-18-preflight-package.txt
  ```

  **Evidence to Capture:**
  - [ ] task-18-preflight-commands.txt
  - [ ] task-18-preflight-package.txt

  **Commit**: YES
  - Message: `chore(vault): finalize remediation preflight handoff package`
  - Files: `.sisyphus/evidence/*`, verification touchpoints
  - Pre-commit: full verification command suite

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Validate must-have/must-not-have requirements against code and evidence.

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run build/lint/test + anti-pattern checks across changed files.

- [ ] F3. **Real QA Replay** — `unspecified-high` (+ `playwright` for UI)
      Re-run scenario matrix and verify evidence completeness/content.

- [ ] F4. **Scope Fidelity Check** — `deep`
      Validate diffs against plan scope and reject creep.

---

## Commit Strategy

- Contract remediation commits split by economics, chunking, and claim-path changes.
- Backend remediation commits split by settlement execution and reconciliation.
- Integration/evidence/docs commits grouped after all tests pass.

---

## Success Criteria

### Verification Commands

```bash
cd contracts && forge test
pnpm --filter vault build && pnpm --filter vault test
pnpm --filter vault-web build
```

### Final Checklist

- [ ] Boundary-locked freeze economics enforced
- [ ] Carry ledger semantics consistent on-chain/off-chain
- [ ] Chunked settlement with resume works for large cohorts
- [ ] Dust override enabled for finalized tranche
- [ ] Missing evidence set fully regenerated
- [ ] F1/F2/F3/F4 all PASS
