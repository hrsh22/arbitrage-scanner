# EpochTrancheVault Remix Flatten + Forge Mainnet Readiness

## TL;DR

> **Quick Summary**: Stabilize `EpochTrancheVault` for mainnet by fixing the carry-accounting correctness issue, resolving all 7 forge test failures, and producing a deterministic Remix-ready flattened artifact.
>
> **Deliverables**:
>
> - All contract tests pass (`forge test --via-ir` green)
> - Flattened artifact at `contracts/flattened/EpochTrancheVault-Remix.sol`
> - Deployment handoff with constructor args + env updates
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: T1 -> T5 -> T6/T7 -> T10 -> T13

---

## Context

### Original Request

User asked for a Remix flattened file and to fix forge tests for mainnet deployment.

### Interview Summary

**Key Discussions**:

- Canonical deployment target is `contracts/src/EpochTrancheVault.sol`.
- User selected strict acceptance gate: all forge tests must pass before handoff.
- Work includes flatten artifact + deployment/env instructions.

**Research Findings**:

- Current contracts suite: 179 passed / 7 failed.
- High-risk issue: carry-accounting invariant around cohort accrual initialization.
- Low-risk issues: test expectation/setup mismatches in `EpochTrancheVault.t.sol` and `NavSnapshot.t.sol`.
- Flattening risk: `forge flatten` may produce duplicate IERC20 definitions for this contract and requires deterministic post-processing + compile validation.

### Metis Review

**Identified Gaps (addressed in plan)**:

- Added explicit guardrail to prioritize economic correctness before test drift cleanup.
- Added explicit flatten verification criteria (single SPDX, no imports, Remix compile).
- Added strict deployment gate criteria and evidence artifacts.

---

## Work Objectives

### Core Objective

Ship a mainnet-ready `EpochTrancheVault` package with economically correct carry behavior, a fully green forge suite, and a Remix-compatible flattened contract artifact.

### Concrete Deliverables

- Contract/test fixes in `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`, and `contracts/test/NavSnapshot.t.sol`.
- Flattened file `contracts/flattened/EpochTrancheVault-Remix.sol`.
- Handoff docs/evidence describing constructor args, deploy order, and env configuration.

### Definition of Done

- [ ] `cd contracts && forge test --via-ir` returns 0 failures.
- [ ] `contracts/flattened/EpochTrancheVault-Remix.sol` compiles in Remix-compatible mode.
- [ ] Deployment/env guidance updated and internally consistent with code/config.

### Must Have

- Fix the carry-accounting correctness gap (not test-only masking).
- Preserve existing public lifecycle semantics (Active -> Frozen -> Settling -> Settled -> Finalized).
- Produce deterministic, reproducible flatten output with validation commands.

### Must NOT Have (Guardrails)

- No scope expansion into unrelated vault/web product features.
- No silent semantic change to claim thresholds, role model, or epoch boundaries.
- No handoff that requires human guesswork for constructor args or env mapping.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — verification is command/tool executable.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: YES (strict all-green gate)
- **Frameworks**: Foundry (`forge`), Vitest (`vault-api` support checks)
- **Policy**: contract correctness gates deployment; supporting app build checks must remain green.

### QA Policy

Every task includes agent-executed QA scenarios with captured evidence in `.sisyphus/evidence/`.

- **Contracts**: Bash (`forge build`, `forge test`, `forge test --match-test ...`)
- **Artifact validation**: Bash (`forge flatten`, grep checks, compile checks)
- **API/Web support gates**: Bash (`pnpm build` in touched packages)

Evidence naming: `.sisyphus/evidence/task-{N}-{scenario-slug}.txt`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — diagnosis + scaffolding):
├── Task 1: Failure matrix + acceptance lock [quick]
├── Task 2: Constructor/env source-of-truth lock [quick]
├── Task 3: Flatten pipeline specification + post-process rules [unspecified-high]
├── Task 4: Test harness normalization for deterministic assertions [unspecified-high]
└── Task 5: Carry-accounting fix design checkpoint [deep]

Wave 2 (After Wave 1 — implementation, MAX PARALLEL):
├── Task 6: Implement carry-accounting contract fix (depends: 5) [deep]
├── Task 7: Fix EpochTrancheVault test failures (depends: 1, 4, 6) [quick]
├── Task 8: Fix NavSnapshot test failures (depends: 1, 4) [quick]
├── Task 9: Generate + validate flattened Remix artifact (depends: 3, 6) [unspecified-high]
└── Task 10: Update runtime config/env alignment for deployment (depends: 2, 6) [quick]

Wave 3 (After Wave 2 — integration + handoff):
├── Task 11: Full forge all-green + targeted regression reruns (depends: 7, 8, 6) [deep]
├── Task 12: Remix compilation proof + bytecode/settings parity notes (depends: 9, 11) [unspecified-high]
├── Task 13: Deployment handoff package (constructor/env/remix steps) (depends: 10, 12) [writing]
└── Task 14: Scope cleanup + remediation-only diff check (depends: 11, 13) [quick]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality + build gate review (unspecified-high)
├── Task F3: Real QA replay of all task scenarios (unspecified-high)
└── Task F4: Scope fidelity check against plan promises (deep)

Critical Path: 1 -> 5 -> 6 -> 7/8 -> 11 -> 12 -> 13 -> 14
Parallel Speedup: ~60% faster than fully sequential
Max Concurrent: 5 (Waves 1 & 2)
```

### Dependency Matrix

- **1**: — -> 7, 8, 11
- **2**: — -> 10, 13
- **3**: — -> 9, 12
- **4**: — -> 7, 8
- **5**: 1 -> 6, 11
- **6**: 5 -> 7, 9, 10, 11
- **7**: 1, 4, 6 -> 11
- **8**: 1, 4 -> 11
- **9**: 3, 6 -> 12
- **10**: 2, 6 -> 13
- **11**: 6, 7, 8 -> 12, 14
- **12**: 9, 11 -> 13
- **13**: 10, 12 -> 14
- **14**: 11, 13 -> F1-F4

### Agent Dispatch Summary

- **Wave 1**: T1/T2 -> `quick`, T3/T4 -> `unspecified-high`, T5 -> `deep`
- **Wave 2**: T6 -> `deep`, T7/T8/T10 -> `quick`, T9 -> `unspecified-high`
- **Wave 3**: T11 -> `deep`, T12 -> `unspecified-high`, T13 -> `writing`, T14 -> `quick`
- **Final**: F1 -> `oracle`, F2/F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [ ] 1. Lock failure matrix and strict acceptance baseline

  **What to do**:
  - Re-run failing contract suites and capture exact failing assertions/revert mismatches.
  - Produce a machine-checkable matrix mapping each failure to owner fix task (T6/T7/T8).
  - Freeze strict gate: `forge test --via-ir` must be fully green.

  **Must NOT do**:
  - Do not modify contract/test code in this task.
  - Do not reclassify failures as "non-blocking".

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure audit/evidence lock and mapping.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `git-master`: not needed for diagnostics-only step.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: 7, 8, 11
  - **Blocked By**: None

  **References**:
  - `contracts/test/EpochTrancheVault.t.sol` - failing invariant/threshold tests to classify.
  - `contracts/test/NavSnapshot.t.sol` - stale NAV revert expectation failures.
  - `.sisyphus/evidence/task-18-preflight-matrix.txt` - prior failure baseline to reconcile.

  **Acceptance Criteria**:
  - [ ] Failure matrix file exists: `.sisyphus/evidence/task-1-mainnet-failure-matrix.txt`.
  - [ ] Each of 7 failures mapped to exactly one remediation task.
  - [ ] Gate statement explicitly says "0 failing forge tests required".

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Baseline failure capture
    Tool: Bash (forge)
    Preconditions: contracts dependencies installed
    Steps:
      1. Run `cd contracts && forge test --via-ir`
      2. Extract failing test names and counts
      3. Compare against matrix entries
    Expected Result: Matrix lists 7/7 failures with one-to-one mapping
    Failure Indicators: Missing failure, duplicate ownership, wrong counts
    Evidence: .sisyphus/evidence/task-1-mainnet-failure-matrix.txt

  Scenario: No-orphan mapping check
    Tool: Bash
    Preconditions: matrix generated
    Steps:
      1. Count mapped failures in matrix
      2. Count actual failing tests from forge output
      3. Assert counts equal
    Expected Result: Counts match exactly
    Evidence: .sisyphus/evidence/task-1-mainnet-failure-matrix-validate.txt
  ```

  **Commit**: NO

- [ ] 2. Lock constructor/env source of truth for deployment handoff

  **What to do**:
  - Extract canonical constructor args and ordering from contract.
  - Map runtime keys/addresses from vault config and env templates.
  - Lock defaults for epoch duration, staleness threshold, and claim threshold units.

  **Must NOT do**:
  - Do not invent hidden constructor parameters.
  - Do not mix chain-specific addresses without labeling.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: static reference extraction.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: full runbook writing is in T13.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: 10, 13
  - **Blocked By**: None

  **References**:
  - `contracts/src/EpochTrancheVault.sol:200` - canonical constructor signature.
  - `apps/vault-api/src/config/vaults/vault1-pph.ts` - live config/env key naming.
  - `apps/vault-api/.env.example` - runtime env template and required keys.

  **Acceptance Criteria**:
  - [ ] File `.sisyphus/evidence/task-2-constructor-env-mapping.txt` created.
  - [ ] Constructor args listed in exact on-chain order.
  - [ ] Units documented for every numeric arg (seconds, 6 decimals, bps).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Constructor order validation
    Tool: Bash + grep/read
    Preconditions: contract file accessible
    Steps:
      1. Read constructor signature from contract source
      2. Compare against mapping artifact order
      3. Assert all 10 args present and ordered
    Expected Result: Exact positional match
    Evidence: .sisyphus/evidence/task-2-constructor-env-mapping.txt

  Scenario: Env key consistency
    Tool: Bash
    Preconditions: mapping artifact generated
    Steps:
      1. Cross-check each key against `.env.example` and `vault1-pph.ts`
      2. Verify missing keys flagged explicitly (e.g. settler key)
    Expected Result: No unresolved env references
    Evidence: .sisyphus/evidence/task-2-env-consistency.txt
  ```

  **Commit**: NO

- [ ] 3. Specify deterministic flatten pipeline and validation rules

  **What to do**:
  - Define flatten command and post-processing sequence for Remix compatibility.
  - Include dedupe policy for duplicate IERC20/interface artifacts.
  - Define compile validation checks (single SPDX, no imports, compile success).

  **Must NOT do**:
  - Do not treat raw `forge flatten` output as accepted without checks.
  - Do not skip duplicate-interface detection.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: flattening gotchas + deterministic artifact constraints.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: not browser-related.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: 9, 12
  - **Blocked By**: None

  **References**:
  - `contracts/flattened/SnapshotTrancheVault-Remix.sol` - existing artifact naming/style baseline.
  - `contracts/src/EpochTrancheVault.sol` - import graph and duplicate interface risk area.
  - `contracts/foundry.toml` - compiler settings to keep parity in flatten validation.

  **Acceptance Criteria**:
  - [ ] Pipeline spec file exists: `.sisyphus/evidence/task-3-flatten-pipeline-spec.txt`.
  - [ ] Contains explicit dedupe rule and failure behavior.
  - [ ] Lists exact validation commands used by T9/T12.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Pipeline command dry-run definition
    Tool: Bash
    Preconditions: contracts directory present
    Steps:
      1. Execute documented flatten command into temp output
      2. Run SPDX/import count checks from spec
      3. Verify dedupe rule triggers on duplicate interface patterns
    Expected Result: Spec commands execute and produce deterministic checks
    Evidence: .sisyphus/evidence/task-3-flatten-pipeline-spec.txt

  Scenario: Validation rule failure path
    Tool: Bash
    Preconditions: intentionally unprocessed flatten output
    Steps:
      1. Run `grep -c "^import "` and SPDX count checks
      2. Assert failure condition is detected and logged
    Expected Result: Non-compliant artifact is rejected
    Evidence: .sisyphus/evidence/task-3-flatten-rule-failure.txt
  ```

  **Commit**: NO

- [ ] 4. Normalize test harness for deterministic timestamp/revert assertions

  **What to do**:
  - Add/adjust helper patterns in tests to capture timestamps immediately before expected revert checks.
  - Standardize revert argument expectation style for custom errors.
  - Ensure helpers avoid hidden epoch/time side effects.

  **Must NOT do**:
  - Do not modify production contract behavior in this task.
  - Do not add unrelated test refactors.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: shared test scaffolding affects multiple failing tests.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: complexity is moderate and localized.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: 7, 8
  - **Blocked By**: None

  **References**:
  - `contracts/test/NavSnapshot.t.sol` - stale NAV revert argument checks.
  - `contracts/test/EpochTrancheVault.t.sol` - invariant helper/setup ordering.

  **Acceptance Criteria**:
  - [ ] Shared helper logic updated without changing contract source.
  - [ ] Deterministic timestamp capture pattern documented in evidence.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Timestamp helper determinism
    Tool: Bash (forge)
    Preconditions: helper updates applied
    Steps:
      1. Run targeted NavSnapshot stale tests
      2. Execute twice using `forge test --match-test <name>`
      3. Compare revert argument outputs
    Expected Result: Identical revert argument values across reruns
    Evidence: .sisyphus/evidence/task-4-timestamp-determinism.txt

  Scenario: No side-effect harness check
    Tool: Bash
    Preconditions: harness adjusted
    Steps:
      1. Run unaffected smoke tests in same file
      2. Verify pass/fail state unchanged for unrelated tests
    Expected Result: No unexpected regressions from harness changes
    Evidence: .sisyphus/evidence/task-4-harness-regression.txt
  ```

  **Commit**: NO

- [ ] 5. Implement carry-accounting correctness fix in contract

  **What to do**:
  - Patch `EpochTrancheVault` so cohort accrued/remaining fields satisfy conservation and initialization invariants.
  - Ensure fix applies across first settlement touch and subsequent settlement/loss paths.
  - Add/adjust direct contract-level tests proving invariant correctness.

  **Must NOT do**:
  - Do not alter external API/event semantics unless required by invariant correctness.
  - Do not weaken threshold, role, or epoch-state guards.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: economic correctness and state-accounting risk.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: too risky for shallow pass.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential anchor
  - **Blocks**: 6, 7, 9, 10, 11
  - **Blocked By**: 1

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - carry and cohort fields update paths.
  - `contracts/test/EpochTrancheVault.t.sol` - failing conservation invariant test.
  - `.sisyphus/evidence/task-1-mainnet-failure-matrix.txt` - bug classification basis.

  **Acceptance Criteria**:
  - [ ] Carry conservation invariant passes in targeted test.
  - [ ] No regression in settlement/finalization state transitions.
  - [ ] Contract compiles with `forge build --via-ir`.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Carry conservation happy path
    Tool: Bash (forge)
    Preconditions: contract patch applied
    Steps:
      1. Run `forge test --via-ir --match-test testCarryConservationInvariant`
      2. Inspect assertions for cohort accrued/claimed/remaining
    Expected Result: Test passes with conservation equation satisfied
    Evidence: .sisyphus/evidence/task-5-carry-conservation-pass.txt

  Scenario: Loss attribution edge case
    Tool: Bash (forge)
    Preconditions: carry fix in place
    Steps:
      1. Run targeted loss realization tests
      2. Verify no negative carryRemaining and no over-deduction
    Expected Result: Graceful bounded loss handling
    Evidence: .sisyphus/evidence/task-5-loss-edge-case.txt
  ```

  **Commit**: YES
  - Message: `fix(contracts): correct cohort carry accrual initialization`
  - Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`
  - Pre-commit: `cd contracts && forge test --via-ir --match-test testCarryConservationInvariant`

- [ ] 6. Fix EpochTrancheVault failing tests (freeze + threshold)

  **What to do**:
  - Correct test setup sequencing for freeze economics invariant case.
  - Align threshold revert expectation with actual deterministic amount path.
  - Keep assertions behavioral and explicit.

  **Must NOT do**:
  - Do not suppress assertions.
  - Do not convert failing assertions into weak contains/regex checks.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: targeted test-side corrections after contract fix.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `deep`: no longer needed after T5 anchor.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 8, 9, 10)
  - **Blocks**: 11
  - **Blocked By**: 4, 5

  **References**:
  - `contracts/test/EpochTrancheVault.t.sol` - failing tests `testFreezeEconomicsInvariants`, `testThresholdDustInvariant`.
  - `contracts/src/EpochTrancheVault.sol` - expected custom error arg order and threshold semantics.

  **Acceptance Criteria**:
  - [ ] Both targeted tests pass.
  - [ ] Revert argument assertions match exact emitted values.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Freeze invariant corrected setup
    Tool: Bash (forge)
    Preconditions: test updates applied
    Steps:
      1. Run `forge test --via-ir --match-test testFreezeEconomicsInvariants`
      2. Confirm frozenShares and totalSharesPending assertion passes
    Expected Result: Test passes consistently
    Evidence: .sisyphus/evidence/task-6-freeze-invariant-pass.txt

  Scenario: Threshold revert argument exactness
    Tool: Bash (forge)
    Preconditions: threshold expectation updated
    Steps:
      1. Run `forge test --via-ir --match-test testThresholdDustInvariant`
      2. Verify expected custom error args match output
    Expected Result: Exact revert-match success
    Evidence: .sisyphus/evidence/task-6-threshold-revert-pass.txt
  ```

  **Commit**: YES
  - Message: `test(contracts): align freeze and threshold invariants`
  - Files: `contracts/test/EpochTrancheVault.t.sol`
  - Pre-commit: `cd contracts && forge test --via-ir --match-test testFreezeEconomicsInvariants --match-test testThresholdDustInvariant`

- [ ] 7. Fix NavSnapshot stale-NAV revert expectation tests

  **What to do**:
  - Correct stale NAV test timestamp capture/expectation flow.
  - Ensure `NavStale(lastUpdate, threshold)` expected args mirror contract behavior precisely.
  - Stabilize all 4 currently failing NavSnapshot tests.

  **Must NOT do**:
  - Do not mute stale NAV checks.
  - Do not modify production NavSnapshot logic unless root-cause proves contract defect.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: test-side deterministic expectation corrections.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `deep`: unnecessary unless contract bug discovered.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 9, 10)
  - **Blocks**: 11
  - **Blocked By**: 1, 4

  **References**:
  - `contracts/test/NavSnapshot.t.sol` - failing stale-nav tests.
  - `contracts/src/NavSnapshot.sol` - error signature and timestamp semantics.

  **Acceptance Criteria**:
  - [ ] 4/4 targeted NavSnapshot tests pass.
  - [ ] Revert argument values are deterministic across reruns.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Nav stale checks pass
    Tool: Bash (forge)
    Preconditions: NavSnapshot tests updated
    Steps:
      1. Run `forge test --via-ir --match-path test/NavSnapshot.t.sol`
      2. Confirm previously failing stale tests now pass
    Expected Result: Suite passes with 0 failures in NavSnapshot
    Evidence: .sisyphus/evidence/task-7-navsnapshot-pass.txt

  Scenario: Repeatability check
    Tool: Bash (forge)
    Preconditions: same commit state
    Steps:
      1. Re-run targeted stale test twice
      2. Compare output timestamps/revert arguments
    Expected Result: No flaky variance
    Evidence: .sisyphus/evidence/task-7-navsnapshot-repeatability.txt
  ```

  **Commit**: YES
  - Message: `test(contracts): stabilize NavSnapshot stale NAV assertions`
  - Files: `contracts/test/NavSnapshot.t.sol`
  - Pre-commit: `cd contracts && forge test --via-ir --match-path test/NavSnapshot.t.sol`

- [ ] 8. Run strict forge gate and targeted regression reruns

  **What to do**:
  - Execute full suite and verify no hidden regressions from test/contract fixes.
  - Re-run previously failing tests in isolation for deterministic confidence.
  - Capture machine-readable pass summary for handoff.

  **Must NOT do**:
  - Do not declare green from partial suite.
  - Do not skip via-IR mode.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: integration confidence gate across full suite.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: evidence writing only, not primary domain.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential gate
  - **Blocks**: 11, 14
  - **Blocked By**: 6, 7

  **References**:
  - `contracts/foundry.toml` - test/build settings.
  - `.sisyphus/evidence/task-1-mainnet-failure-matrix.txt` - expected fixed failures list.

  **Acceptance Criteria**:
  - [ ] `forge test --via-ir` reports 0 failures.
  - [ ] Rerun targeted tests reports 0 failures.
  - [ ] Evidence file includes total pass count and command exit codes.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Full suite all-green
    Tool: Bash (forge)
    Preconditions: T5/T6/T7 complete
    Steps:
      1. Run `cd contracts && forge test --via-ir`
      2. Parse suite summary and failure count
    Expected Result: 0 failed tests
    Evidence: .sisyphus/evidence/task-8-forge-all-green.txt

  Scenario: Former-failure regression set
    Tool: Bash (forge)
    Preconditions: full suite green once
    Steps:
      1. Run each formerly failing test by name/path
      2. Assert pass for all 7 former failures
    Expected Result: All prior failures remain green
    Evidence: .sisyphus/evidence/task-8-former-failure-rerun.txt
  ```

  **Commit**: NO

- [ ] 9. Generate Remix flattened artifact and enforce compliance checks

  **What to do**:
  - Generate `contracts/flattened/EpochTrancheVault-Remix.sol` from canonical source.
  - Apply deterministic post-processing (dedupe/import/SPDX) per T3 spec.
  - Validate artifact with compile/parity checks.

  **Must NOT do**:
  - Do not flatten deprecated contracts.
  - Do not ship artifact with duplicate event/interface collisions.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: artifact generation + correctness verification complexity.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: this task is build/artifact oriented.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 10)
  - **Blocks**: 12, 13
  - **Blocked By**: 3, 5

  **References**:
  - `contracts/src/EpochTrancheVault.sol` - canonical source for flatten.
  - `contracts/flattened/SnapshotTrancheVault-Remix.sol` - naming/format precedent.
  - `.sisyphus/evidence/task-3-flatten-pipeline-spec.txt` - rules to enforce.

  **Acceptance Criteria**:
  - [ ] Artifact exists at exact path.
  - [ ] `grep -c '^// SPDX-License-Identifier:'` equals 1.
  - [ ] `grep -c '^import '` equals 0.
  - [ ] Artifact compile check passes under expected compiler settings.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Artifact generation and structural checks
    Tool: Bash
    Preconditions: flatten pipeline ready
    Steps:
      1. Generate flattened file to target path
      2. Run SPDX/import count checks
      3. Assert duplicate interface collisions absent
    Expected Result: Structural checks pass
    Evidence: .sisyphus/evidence/task-9-flatten-structure.txt

  Scenario: Compilation validation
    Tool: Bash (forge)
    Preconditions: flattened artifact generated
    Steps:
      1. Run compile command against flattened file/settings
      2. Capture warnings/errors
    Expected Result: Compile succeeds with no blocking errors
    Evidence: .sisyphus/evidence/task-9-flatten-compile.txt
  ```

  **Commit**: YES
  - Message: `build(contracts): generate remix-ready EpochTrancheVault flatten`
  - Files: `contracts/flattened/EpochTrancheVault-Remix.sol`, optional helper script
  - Pre-commit: flatten + compile validation commands from T3

- [ ] 10. Align vault runtime config/env with deployment contract + settler flow

  **What to do**:
  - Ensure vault config/env references are complete for settlement path (including settler key mapping).
  - Verify deployed address/role assumptions map cleanly into runtime config.
  - Prevent runtime missing-key failures in settlement operations.

  **Must NOT do**:
  - Do not rotate real secrets in repo.
  - Do not broaden into unrelated strategy tuning.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: constrained config/interface alignment work.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: full human docs are in T13.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 9)
  - **Blocks**: 13
  - **Blocked By**: 2, 5

  **References**:
  - `apps/vault-api/src/config/vaults/vault1-pph.ts` - current vault config keys.
  - `apps/vault-api/src/config/identityResolver.ts` - required identity fields.
  - `apps/vault-api/.env.example` - expected env key set.
  - `apps/vault-api/src/services/customVaultProvider.ts` - settler key usage path.

  **Acceptance Criteria**:
  - [ ] Required settlement-related env keys documented and wired.
  - [ ] `apps/vault-api` build passes after config/type alignment.
  - [ ] No runtime-required key remains undocumented.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Config compile validation
    Tool: Bash
    Preconditions: config/env alignment updates complete
    Steps:
      1. Run `cd apps/vault-api && pnpm build`
      2. Verify no type errors in config/identity/provider paths
    Expected Result: Build exits 0
    Evidence: .sisyphus/evidence/task-10-vault-api-build.txt

  Scenario: Missing-key negative check
    Tool: Bash
    Preconditions: env mapping document generated
    Steps:
      1. Simulate missing settler key in controlled test env
      2. Validate explicit error message path is documented
    Expected Result: Failure is explicit and actionable
    Evidence: .sisyphus/evidence/task-10-missing-settler-key.txt
  ```

  **Commit**: YES
  - Message: `chore(vault-api): align config/env for settlement runtime`
  - Files: `apps/vault-api/src/config/*`, `apps/vault-api/.env.example` (if needed)
  - Pre-commit: `cd apps/vault-api && pnpm build`

- [ ] 11. Execute full integration gate across contracts and touched apps

  **What to do**:
  - Run full contract gate and supporting app builds as deployment confidence checks.
  - Capture command outputs and exit codes in one consolidated artifact.
  - Mark any non-blocking warnings separately from blockers.

  **Must NOT do**:
  - Do not hide failing command outputs.
  - Do not downgrade failing gates to warnings.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: multi-surface integration and evidence synthesis.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `artistry`: not a creative/alternative-solution task.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 gate
  - **Blocks**: 12, 14
  - **Blocked By**: 8

  **References**:
  - `contracts/foundry.toml` - canonical contract gate settings.
  - `apps/vault-api/package.json` - backend build command.
  - `apps/vault-web/package.json` - frontend build command.

  **Acceptance Criteria**:
  - [ ] `forge build --via-ir` passes.
  - [ ] `forge test --via-ir` passes.
  - [ ] `apps/vault-api` and `apps/vault-web` builds pass.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Combined verification run
    Tool: Bash
    Preconditions: T6-T10 complete
    Steps:
      1. Run all required verification commands sequentially
      2. Capture outputs with explicit exit codes
    Expected Result: All required commands exit 0
    Evidence: .sisyphus/evidence/task-11-combined-gates.txt

  Scenario: Regression-negative check
    Tool: Bash
    Preconditions: combined run complete
    Steps:
      1. Re-run one critical command (`forge test --via-ir`)
      2. Confirm no intermittent failures
    Expected Result: Deterministic pass
    Evidence: .sisyphus/evidence/task-11-regression-rerun.txt
  ```

  **Commit**: NO

- [ ] 12. Prove Remix deployability and compiler/settings parity

  **What to do**:
  - Validate flattened artifact against Remix compiler version/settings equivalent.
  - Confirm constructor argument schema and deployment sequence are executable.
  - Record verification caveats and fallback method if flatten verification diverges.

  **Must NOT do**:
  - Do not claim parity without command evidence.
  - Do not omit known flattening caveats.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: deployment correctness and tooling parity nuances.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `playwright`: no browser UI automation required for this artifact proof.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 sequential (after T9 + T11)
  - **Blocks**: 13
  - **Blocked By**: 9, 11

  **References**:
  - `contracts/flattened/EpochTrancheVault-Remix.sol` - deployment artifact.
  - `contracts/src/EpochTrancheVault.sol` - canonical source parity baseline.
  - `contracts/foundry.toml` - compiler settings to mirror.

  **Acceptance Criteria**:
  - [ ] Remix artifact compiles under documented compiler version.
  - [ ] Constructor args and role assignments validated against source.
  - [ ] Verification caveats documented with fallback path.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Remix compatibility proof
    Tool: Bash + artifact checks
    Preconditions: flattened artifact exists
    Steps:
      1. Run documented compile-equivalent checks
      2. Validate constructor arg list/order against source
      3. Capture proof output
    Expected Result: Artifact ready for Remix deployment flow
    Evidence: .sisyphus/evidence/task-12-remix-compatibility.txt

  Scenario: Verification fallback readiness
    Tool: Bash
    Preconditions: parity doc draft ready
    Steps:
      1. Validate fallback verification method commands are executable
      2. Ensure failure path documented clearly
    Expected Result: No ambiguous verification steps
    Evidence: .sisyphus/evidence/task-12-verification-fallback.txt
  ```

  **Commit**: NO

- [ ] 13. Produce final deployment handoff package (contract + env + ops)

  **What to do**:
  - Create operator-facing handoff covering Remix deploy steps, constructor args, role setup, and env updates.
  - Include post-deploy smoke checks and rollback notes.
  - Ensure instructions align with code and tested commands.

  **Must NOT do**:
  - Do not leave placeholder values without clear labels.
  - Do not describe unverified steps.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: precise technical runbook synthesis.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not UI work.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 sequential
  - **Blocks**: 14, F1
  - **Blocked By**: 10, 12

  **References**:
  - `VAULT_KNOWLEDGE.md` - lifecycle/runbook baseline.
  - `apps/vault-api/.env.example` - env template.
  - `apps/vault-web/.env.example` - frontend env template.
  - `.sisyphus/evidence/task-2-constructor-env-mapping.txt` - canonical deployment values.

  **Acceptance Criteria**:
  - [ ] Handoff doc includes exact constructor argument order and units.
  - [ ] Handoff doc includes required env keys for vault-api and vault-web.
  - [ ] Includes post-deploy smoke commands (`/health`, `/api/vaults/:id/info`).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Handoff completeness review
    Tool: Bash + read
    Preconditions: handoff doc drafted
    Steps:
      1. Check section presence: deploy, roles, env, smoke checks
      2. Validate all commands/path references resolve
    Expected Result: No missing required sections
    Evidence: .sisyphus/evidence/task-13-handoff-completeness.txt

  Scenario: Instruction/code consistency
    Tool: Bash + grep
    Preconditions: handoff doc complete
    Steps:
      1. Cross-check constructor args with contract source
      2. Cross-check env keys with `.env.example` files
    Expected Result: No mismatched names/order
    Evidence: .sisyphus/evidence/task-13-handoff-consistency.txt
  ```

  **Commit**: YES
  - Message: `docs(vault): add remix deployment and env handoff`
  - Files: `VAULT_KNOWLEDGE.md` and/or dedicated deployment doc
  - Pre-commit: doc consistency checks from scenario

- [ ] 14. Scope cleanup and remediation-only diff isolation

  **What to do**:
  - Audit final diff against plan scope boundaries.
  - Remove unrelated drift from staged changes.
  - Produce a clean in-scope file inventory.

  **Must NOT do**:
  - Do not remove required remediation artifacts.
  - Do not leave lockfile or unrelated package drift unexplained.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: targeted diff hygiene pass.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `git-master`: optional; not mandatory for basic scope check.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Final pre-F-wave gate
  - **Blocks**: F1-F4
  - **Blocked By**: 11, 13

  **References**:
  - `.sisyphus/plans/epoch-tranche-remix-mainnet-readiness.md` - scope baseline.
  - `git diff --stat` output - modified file inventory.

  **Acceptance Criteria**:
  - [ ] Final diff contains only in-scope contract/test/flatten/docs/env items.
  - [ ] Scope audit artifact created with explicit allowlist check.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Diff allowlist audit
    Tool: Bash (git)
    Preconditions: all implementation tasks completed
    Steps:
      1. Run `git diff --stat` and full changed file list
      2. Compare each file against plan allowlist
    Expected Result: All changed files accounted for by tasks
    Evidence: .sisyphus/evidence/task-14-scope-audit.txt

  Scenario: Out-of-scope rejection
    Tool: Bash
    Preconditions: audit script ready
    Steps:
      1. Detect any changed file outside allowlist
      2. Record required cleanup action
    Expected Result: Zero unresolved out-of-scope files
    Evidence: .sisyphus/evidence/task-14-scope-rejections.txt
  ```

  **Commit**: NO

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Verify each Must Have/Must NOT Have against code + evidence, and reject on mismatches with file:line references.

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `forge build --via-ir`, `forge test --via-ir`, and touched package builds. Flag unsafe casts, dead code, or hidden TODO stubs.

- [ ] F3. **Real QA Replay** — `unspecified-high`
      Execute all task QA scenarios end-to-end and verify evidence files exist and match expected outputs.

- [ ] F4. **Scope Fidelity Check** — `deep`
      Compare actual diff vs plan task boundaries and confirm no out-of-scope drift.

---

## Commit Strategy

- **1**: `fix(contracts): stabilize carry accounting and forge invariants`
- **2**: `test(contracts): align EpochTrancheVault and NavSnapshot expectations`
- **3**: `build(contracts): add remix flatten artifact and verification checks`
- **4**: `docs(vault): update deployment/env handoff for mainnet readiness`

---

## Success Criteria

### Verification Commands

```bash
cd contracts && forge build --via-ir
cd contracts && forge test --via-ir
cd contracts && forge flatten src/EpochTrancheVault.sol -o flattened/EpochTrancheVault-Remix.sol
grep -c "^// SPDX-License-Identifier:" contracts/flattened/EpochTrancheVault-Remix.sol
grep -c "^import " contracts/flattened/EpochTrancheVault-Remix.sol
cd apps/vault-api && pnpm build
cd apps/vault-web && pnpm build
```

### Final Checklist

- [ ] All 7 previously failing forge tests pass
- [ ] Carry-accounting invariants are satisfied and covered
- [ ] Flattened contract artifact is generated and validated
- [ ] Deployment/env handoff is complete and consistent
- [ ] Final verification wave F1-F4 approves
