# ERC-7540 Redemption Compliance Rewrite (No-Migration Path)

## TL;DR

> **Quick Summary**: Replace the current custom async redemption flow with strict ERC-7540 async-redemption compliance on contract + API + web, while preserving epoch/pro-rata/NAV controls as explicit extensions.
>
> **Deliverables**:
>
> - ERC-7540-compliant redemption contract surface (with ERC-165 interfaces)
> - Refactored `vault-api` client/provider/routes aligned to controller/operator semantics
> - Refactored `vault-web` hooks/types/api aligned to new lifecycle and claim semantics
> - Compliance-focused tests and E2E evidence for Pending -> Claimable -> Claimed
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: T1 -> T6 -> T9 -> T14 -> F1

---

## Context

### Original Request

Plan how to move to real ERC-7540 properly. Nothing is deployed yet, so rewrites can be breaking and migration logic is unnecessary.

### Interview Summary

**Key Discussions**:

- Current stack is custom async-redemption and not strict ERC-7540.
- User confirmed rewrite safety because no live deployment exists.
- Goal is production-ready standards compliance, not a partial patch.

**Research Findings**:

- Current contract method signatures and status semantics are custom and tightly coupled across API/web.
- Strict compliance requires operator model, controller-aware request semantics, async preview overrides, and ERC-165 interface signaling.
- Existing test coverage is strong for current behavior but missing compliance verification categories.

### Metis Review

**Identified Gaps** (addressed):

- Missing explicit guardrails for scope creep (async-deposit, UI redesign, migration logic).
- Missing explicit acceptance criteria for interface IDs, operator permissions, and preview-revert semantics.
- Missing explicit owner/controller/operator edge-case verification matrix.

---

## Work Objectives

### Core Objective

Ship a strict ERC-7540 async-redemption implementation and end-to-end integration across contracts, backend, and frontend, with objective compliance evidence.

### Concrete Deliverables

- Updated redemption contract implementing ERC-7540 redemption + operator interfaces and ERC-165 support.
- Updated backend contract client/provider/routes aligned with new signatures and lifecycle semantics.
- Updated frontend API/hooks/types/components for controller-aware request lifecycle and claims.
- Contract/API/UI test suites and evidence outputs proving compliance and runtime behavior.

### Definition of Done

- [ ] `pnpm --filter vault build` passes
- [ ] `pnpm --filter vault exec vitest --run` passes
- [ ] `pnpm --filter vault-web build` passes
- [ ] `cd contracts && forge test` passes
- [ ] ERC-165 interface checks pass for supported interfaces

### Must Have

- Strict ERC-7540 async-redemption semantics implemented.
- Operator model implemented and enforced.
- Async preview override behavior verified.
- Full lifecycle verification with evidence artifacts.

### Must NOT Have (Guardrails)

- No migration/backfill tasks.
- No async-deposit implementation in this rewrite.
- No UI redesign or style-system churn.
- No undocumented custom behavior hidden under standard names.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after)
- **Framework**: Foundry + Vitest + Playwright E2E

### QA Policy

Every task includes concrete QA scenarios with command/selector-level assertions and evidence paths.

- **Frontend/UI**: Playwright scenarios + screenshots.
- **API/Backend**: `curl` and `vitest` with concrete response assertions.
- **Contracts**: `forge test` targeted files + interface and lifecycle assertions.

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Foundation + standards surface):

- T1 Standards contract blueprint and interface matrix
- T2 Contract storage/status model redesign
- T3 Backend type contracts and status mapping redesign
- T4 Frontend domain type and API contract redesign
- T5 Compliance test harness scaffolding (contract/api/web)

Wave 2 (Core implementation, max parallel):

- T6 Contract function/signature rewrite (request, claim, views)
- T7 Operator model and permission enforcement
- T8 Async preview override and ERC-165 support
- T9 Backend client/provider rewrite for new ABI semantics
- T10 Route/controller rewrite with owner/controller/operator semantics
- T11 Frontend API/hooks integration rewrite

Wave 3 (Extensions + hardening):

- T12 Preserve epoch/pro-rata/NAV as explicit extension layer
- T13 Edge-case hardening (partial claims, zero states, revocations)
- T14 Integration test expansion and lifecycle E2E evidence

Wave 4 (Stabilization):

- T15 Build/test/lint stabilization pass
- T16 Documentation and runbook updates
- T17 Release-readiness checklist and rollback simulation plan

Wave FINAL (Independent verification):

- F1 Plan compliance audit
- F2 Code quality review
- F3 Real manual QA execution by agent
- F4 Scope fidelity check

Critical Path: T1 -> T6 -> T9 -> T14 -> F1
Parallel Speedup: ~65%
Max Concurrent: 6

### Dependency Matrix

- **T1**: Blocked By: None | Blocks: T6, T8, T9
- **T2**: Blocked By: None | Blocks: T6, T7, T12
- **T3**: Blocked By: None | Blocks: T9, T10, T11
- **T4**: Blocked By: None | Blocks: T11, T14
- **T5**: Blocked By: None | Blocks: T14, T15
- **T6**: Blocked By: T1, T2 | Blocks: T9, T10, T12
- **T7**: Blocked By: T2 | Blocks: T10, T13
- **T8**: Blocked By: T1 | Blocks: T14
- **T9**: Blocked By: T1, T3, T6 | Blocks: T11, T14
- **T10**: Blocked By: T3, T6, T7 | Blocks: T14
- **T11**: Blocked By: T3, T4, T9 | Blocks: T14
- **T12**: Blocked By: T2, T6 | Blocks: T14
- **T13**: Blocked By: T7 | Blocks: T14, T15
- **T14**: Blocked By: T4, T5, T8, T9, T10, T11, T12, T13 | Blocks: T15, F1-F4
- **T15**: Blocked By: T5, T13, T14 | Blocks: F1-F4
- **T16**: Blocked By: T14 | Blocks: F1
- **T17**: Blocked By: T15, T16 | Blocks: F1-F4

### Agent Dispatch Summary

- **Wave 1**: T1 `deep`, T2 `deep`, T3 `quick`, T4 `quick`, T5 `unspecified-high`
- **Wave 2**: T6 `deep`, T7 `unspecified-high`, T8 `quick`, T9 `deep`, T10 `unspecified-high`, T11 `visual-engineering`
- **Wave 3**: T12 `deep`, T13 `unspecified-high`, T14 `deep`
- **Wave 4**: T15 `unspecified-high`, T16 `writing`, T17 `quick`
- **FINAL**: F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [ ] 1. Define strict ERC-7540 async-redemption contract specification

  **What to do**:
  - Create a standards matrix mapping required interfaces/events/behaviors to concrete contract signatures.
  - Lock async-redemption-only scope and explicit extension boundaries (epoch/NAV/pro-rata).

  **Must NOT do**:
  - Do not include async-deposit implementation scope.
  - Do not leave ambiguous request/controller semantics.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: standards-heavy design with many downstream dependencies.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: insufficient for interface-level architecture decisions.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3, T4, T5)
  - **Blocks**: T6, T8, T9
  - **Blocked By**: None

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - current non-standard redemption signatures to replace.
  - `apps/vault-api/src/services/customVaultClient.ts` - ABI assumptions that must match final contract surface.
  - `apps/vault-web/src/lib/api.ts` - current request/claim contract exposed to UI.

  **Acceptance Criteria**:
  - [ ] Standards matrix file drafted in plan notes with required vs extension categories.
  - [ ] Request/claim/operator semantics unambiguous and approved in plan.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Standards matrix completeness
    Tool: Bash (grep)
    Preconditions: Plan/spec files updated
    Steps:
      1. Search spec artifact for "requestRedeem", "pendingRedeemRequest", "claimableRedeemRequest", "setOperator", "supportsInterface"
      2. Verify each term appears at least once with explicit behavior notes
    Expected Result: All required terms found with concrete mappings
    Failure Indicators: Any required term missing or ambiguous
    Evidence: .sisyphus/evidence/task-1-standards-matrix.txt

  Scenario: Guardrail enforcement in spec
    Tool: Bash (grep)
    Preconditions: Spec draft contains scope section
    Steps:
      1. Search for explicit "no async-deposit" and "no UI redesign"
      2. Verify extension boundaries (epoch/NAV/pro-rata) are marked non-standard
    Expected Result: Guardrails explicitly documented
    Evidence: .sisyphus/evidence/task-1-guardrails.txt
  ```

  **Commit**: NO

- [ ] 2. Redesign contract storage and status model for ERC-7540 semantics

  **What to do**:
  - Refactor request state structures around controller-aware pending/claimable accounting.
  - Align statuses to Pending/Claimable/Claimed semantics while preserving extension metadata.

  **Must NOT do**:
  - Do not keep hidden dependency on old status numeric meanings.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: state transitions impact correctness and safety.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: too risky for core accounting transitions.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T6, T7, T12
  - **Blocked By**: None

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - existing request/status structs.
  - `apps/vault-api/src/services/customVaultProvider.ts` - current status mapping assumptions.
  - `apps/vault-api/src/db/schema.ts` - persisted status enums.

  **Acceptance Criteria**:
  - [ ] Contract storage model supports controller-aware pending/claimable reads.
  - [ ] Status mapping contract->API is deterministic and documented.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: State layout consistency
    Tool: Bash (grep)
    Preconditions: Contract updated
    Steps:
      1. Search for pending/claimable storage variables
      2. Confirm old custom-only status literals are removed from active logic
    Expected Result: New model present, old status coupling absent
    Evidence: .sisyphus/evidence/task-2-state-model.txt

  Scenario: Invalid transition rejection
    Tool: forge test
    Preconditions: Contract tests updated
    Steps:
      1. Run targeted transition tests
      2. Assert invalid state transitions revert
    Expected Result: Transition guard tests pass
    Evidence: .sisyphus/evidence/task-2-invalid-transition.txt
  ```

  **Commit**: NO

- [ ] 3. Refactor backend domain types and status mappings

  **What to do**:
  - Update provider/client/domain types to ERC-7540 lifecycle semantics.
  - Remove implicit custom status translations that conflict with final model.

  **Must NOT do**:
  - Do not keep dual status vocabularies without explicit adapter boundary.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: multi-file type alignment and mapping cleanup.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `deep`: unnecessary for straightforward typing consolidation.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T9, T10, T11
  - **Blocked By**: None

  **References**:
  - `apps/vault-api/src/services/customVaultProvider.ts` - current `mapContractStatus` behavior.
  - `apps/vault-api/src/services/vaultProvider.ts` - canonical provider interface.
  - `apps/vault-api/src/types.ts` - API response contracts.

  **Acceptance Criteria**:
  - [ ] Single canonical lifecycle enum/value set used across backend runtime paths.
  - [ ] Type-check passes with no compatibility shims leaking to routes.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Type-level consistency
    Tool: pnpm --filter vault build
    Preconditions: Backend type refactor complete
    Steps:
      1. Run TypeScript build
      2. Confirm no status/type incompatibility errors
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-3-build.txt

  Scenario: Runtime mapping sanity
    Tool: pnpm --filter vault exec vitest --run
    Preconditions: Mapping tests updated
    Steps:
      1. Run provider/status mapping tests
      2. Verify pending/claimable/claimed branches are asserted
    Expected Result: Tests pass with explicit lifecycle checks
    Evidence: .sisyphus/evidence/task-3-mapping-tests.txt
  ```

  **Commit**: NO

- [ ] 4. Refactor frontend redemption domain types and API contracts

  **What to do**:
  - Align `vault-web` types/hooks API contracts with controller-aware lifecycle semantics.
  - Remove request/claim assumptions that depend on old backend wording.

  **Must NOT do**:
  - Do not redesign UI layout or visual flows.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: typed contract alignment across hooks/types/api.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `visual-engineering`: no design refresh required.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T11, T14
  - **Blocked By**: None

  **References**:
  - `apps/vault-web/src/lib/api.ts` - existing redemption API wrappers.
  - `apps/vault-web/src/lib/hooks.ts` - lifecycle normalization and polling.
  - `apps/vault-web/src/types.ts` and `apps/vault-web/src/types/redemption.ts` - status/type definitions.

  **Acceptance Criteria**:
  - [ ] Frontend compiles with no stale status/type references.
  - [ ] Existing pages/components render using new lifecycle values without design changes.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Frontend compile validation
    Tool: pnpm --filter vault-web build
    Preconditions: Frontend types/api hooks updated
    Steps:
      1. Build vault-web
      2. Verify no type/runtime contract mismatches
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-4-web-build.txt

  Scenario: Hook lifecycle normalization
    Tool: Playwright
    Preconditions: local web + api running
    Steps:
      1. Open vault detail page `/vault/1`
      2. Trigger request list load
      3. Assert UI badges include pending/claimable/claimed only
    Expected Result: Lifecycle labels render consistently
    Evidence: .sisyphus/evidence/task-4-hook-lifecycle.png
  ```

  **Commit**: NO

- [ ] 5. Scaffold compliance-first test harnesses across contract/api/web

  **What to do**:
  - Add test skeletons for interface IDs, operator semantics, async preview overrides, and lifecycle transitions.
  - Wire dedicated test categories to avoid regression drift.

  **Must NOT do**:
  - Do not rely only on existing custom-flow tests.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: cross-stack test architecture and traceability.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: insufficient for executable test harness design.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T14, T15
  - **Blocked By**: None

  **References**:
  - `contracts/test/WeeklyEpochVault.t.sol` - baseline unit test structure.
  - `apps/vault-api/src/__tests__/customVaultClient.test.ts` - backend contract interaction tests.
  - `apps/vault-web/e2e/redemption.spec.ts` - current E2E flow patterns.

  **Acceptance Criteria**:
  - [ ] Dedicated compliance suites exist for contract, backend, and frontend.
  - [ ] Each suite contains at least one interface/operator/preview/lifecycle assertion.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Contract compliance suite registration
    Tool: Bash (grep)
    Preconditions: Test files added/updated
    Steps:
      1. Search for test names containing "interface", "operator", "preview"
      2. Confirm files are under `contracts/test`
    Expected Result: Compliance test cases present
    Evidence: .sisyphus/evidence/task-5-contract-test-skeleton.txt

  Scenario: API and E2E suite registration
    Tool: Bash (grep)
    Preconditions: Test files added/updated
    Steps:
      1. Search backend tests for lifecycle + operator cases
      2. Search Playwright specs for pending->claimable->claimed flow assertions
    Expected Result: Both API and E2E compliance suites present
    Evidence: .sisyphus/evidence/task-5-api-e2e-skeleton.txt
  ```

  **Commit**: NO

- [ ] 6. Rewrite contract function signatures and core redemption lifecycle

  **What to do**:
  - Implement strict async-redemption contract surface aligned to ERC-7540 semantics.
  - Replace custom claim path with standards-compliant claim path behavior.

  **Must NOT do**:
  - Do not keep old custom-only methods as active paths.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: high-risk core contract rewrite.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: not safe for protocol-surface rewrite.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential in Wave 2
  - **Blocks**: T9, T10, T12
  - **Blocked By**: T1, T2

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - current methods to replace.
  - `contracts/test/WeeklyEpochVault.t.sol` - behavior baselines to remap.
  - `apps/vault-api/src/services/customVaultClient.ts` - downstream ABI expectations.

  **Acceptance Criteria**:
  - [ ] Contract compiles with rewritten signatures and lifecycle behavior.
  - [ ] Request lifecycle can be exercised end-to-end in tests.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Core contract compile and lifecycle pass
    Tool: forge test
    Preconditions: Contract rewrite complete
    Steps:
      1. Run `forge test --match-path test/WeeklyEpochVault.t.sol`
      2. Verify request, settle, claim lifecycle tests pass
    Expected Result: Target contract tests pass
    Evidence: .sisyphus/evidence/task-6-forge-core.txt

  Scenario: Legacy method removal verification
    Tool: Bash (grep)
    Preconditions: Contract rewrite complete
    Steps:
      1. Search contract for deprecated custom-only public methods
      2. Assert old active paths are absent or explicitly marked deprecated-inactive
    Expected Result: No unintended legacy runtime path
    Evidence: .sisyphus/evidence/task-6-legacy-removal.txt
  ```

  **Commit**: NO

- [ ] 7. Implement and enforce operator model

  **What to do**:
  - Add and enforce operator authorization for controller-managed request lifecycle actions.
  - Cover owner/controller/operator permutations in tests.

  **Must NOT do**:
  - Do not bypass operator checks in redeem/cancel/claim-related actions.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: permission logic has security sensitivity.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: insufficient for auth-sensitive refactor.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8)
  - **Blocks**: T10, T13
  - **Blocked By**: T2

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - role and permission checks.
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - authenticated actor semantics.
  - `apps/vault-web/src/lib/hooks.ts` - user action assumptions.

  **Acceptance Criteria**:
  - [ ] Operator grant/revoke actions function and emit correct events.
  - [ ] Unauthorized actor paths revert and are tested.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Operator happy path
    Tool: forge test
    Preconditions: operator logic implemented
    Steps:
      1. Run tests where controller grants operator
      2. Operator performs request/claim action
      3. Assert success and expected events
    Expected Result: Operator-authorized flow succeeds
    Evidence: .sisyphus/evidence/task-7-operator-happy.txt

  Scenario: Unauthorized actor rejection
    Tool: forge test
    Preconditions: operator tests implemented
    Steps:
      1. Run tests where non-operator/non-controller calls restricted action
      2. Assert revert reason/code
    Expected Result: Unauthorized call fails deterministically
    Evidence: .sisyphus/evidence/task-7-operator-negative.txt
  ```

  **Commit**: NO

- [ ] 8. Implement async preview overrides and ERC-165 interface support

  **What to do**:
  - Implement required async override behavior for preview functions.
  - Implement and verify `supportsInterface` for supported interfaces.

  **Must NOT do**:
  - Do not leave interface IDs partially implemented or undocumented.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: bounded standards-conformance implementation.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `deep`: unnecessary for this bounded task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T14
  - **Blocked By**: T1

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - preview and interface implementation site.
  - `contracts/test/WeeklyEpochVault.t.sol` - interface and revert tests.

  **Acceptance Criteria**:
  - [ ] Preview functions follow async override behavior with explicit test assertions.
  - [ ] `supportsInterface` returns expected values for supported IDs and false for unsupported IDs.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Preview override behavior
    Tool: forge test
    Preconditions: preview tests added
    Steps:
      1. Run tests for preview paths before claimable state
      2. Assert required revert behavior
    Expected Result: All preview override tests pass
    Evidence: .sisyphus/evidence/task-8-preview.txt

  Scenario: Interface ID checks
    Tool: forge test
    Preconditions: supportsInterface tests added
    Steps:
      1. Run tests asserting true/false on specific interface IDs
      2. Validate expected results per standards matrix
    Expected Result: Interface tests pass exactly
    Evidence: .sisyphus/evidence/task-8-interface-ids.txt
  ```

  **Commit**: NO

- [ ] 9. Rewrite backend contract client/provider to new ABI semantics

  **What to do**:
  - Update ABI definitions, event parsing, and call payloads in client/provider layers.
  - Align request/claim data models to controller-aware lifecycle semantics.

  **Must NOT do**:
  - Do not preserve fallback codepaths for deprecated contract signatures.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: backend contract integration correctness is critical.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: insufficient for ABI/event rewrite complexity.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential in Wave 2
  - **Blocks**: T11, T14
  - **Blocked By**: T1, T3, T6

  **References**:
  - `apps/vault-api/src/services/customVaultClient.ts` - ABI + event decoding.
  - `apps/vault-api/src/services/customVaultProvider.ts` - lifecycle/status projection.
  - `apps/vault-api/src/services/vaultProvider.ts` - contract-facing interface.

  **Acceptance Criteria**:
  - [ ] Provider calls compile and run against rewritten contract ABI.
  - [ ] Event parsing reflects final contract events without shims.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Backend ABI compatibility
    Tool: pnpm --filter vault build
    Preconditions: client/provider ABI rewrite complete
    Steps:
      1. Build vault-api
      2. Verify no ABI signature/type mismatch diagnostics
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-9-backend-build.txt

  Scenario: Event decoding integrity
    Tool: pnpm --filter vault exec vitest --run
    Preconditions: event parsing tests added
    Steps:
      1. Run client/provider tests that decode request and claim events
      2. Assert decoded controller/owner/request fields match fixtures
    Expected Result: Event tests pass
    Evidence: .sisyphus/evidence/task-9-event-decode.txt
  ```

  **Commit**: NO

- [ ] 10. Rewrite API routes/controllers for owner-controller-operator semantics

  **What to do**:
  - Update route handlers and validation contracts for new request/claim semantics.
  - Ensure auth/session actor mapping correctly supports controller/operator paths.

  **Must NOT do**:
  - Do not break route stability unnecessarily; keep path continuity where possible.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: business logic and auth semantics change together.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: risky for auth-sensitive routing.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T11)
  - **Blocks**: T14
  - **Blocked By**: T3, T6, T7

  **References**:
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - current route surface.
  - `apps/vault-api/src/services/claimStateMachine.ts` - lifecycle transition assumptions.
  - `apps/vault-api/src/types.ts` - API response schema.

  **Acceptance Criteria**:
  - [ ] Route-level validation and response payloads align with final semantics.
  - [ ] Unauthorized actor actions are rejected with deterministic responses.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Happy path API lifecycle
    Tool: Bash (curl)
    Preconditions: local vault-api running
    Steps:
      1. POST redemption request endpoint with valid auth
      2. GET request status endpoint
      3. POST claim endpoint when claimable
    Expected Result: 2xx responses and lifecycle-consistent payloads
    Evidence: .sisyphus/evidence/task-10-api-happy.json

  Scenario: Unauthorized actor API rejection
    Tool: Bash (curl)
    Preconditions: local vault-api running
    Steps:
      1. Call protected action as non-owner/non-operator
      2. Assert status code and error payload
    Expected Result: Action rejected predictably
    Evidence: .sisyphus/evidence/task-10-api-negative.json
  ```

  **Commit**: NO

- [ ] 11. Rewrite frontend API/hooks integration for updated lifecycle

  **What to do**:
  - Align request/claim calls, polling behavior, and lifecycle labels with backend updates.
  - Keep existing UI structure while updating behavior and state interpretation.

  **Must NOT do**:
  - Do not add new UX flows outside scope.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI behavior and hooks integration must stay stable for users.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: design revamp is out of scope.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T14
  - **Blocked By**: T3, T4, T9

  **References**:
  - `apps/vault-web/src/lib/api.ts` - fetch/mutation API wrappers.
  - `apps/vault-web/src/lib/hooks.ts` - lifecycle and polling logic.
  - `apps/vault-web/app/vault/[id]/components/RequestForm.tsx` - request submission UI behavior.

  **Acceptance Criteria**:
  - [ ] UI can complete request and claim flows against updated API.
  - [ ] Pending/claimable/claimed displays are accurate under polling refresh.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Request flow in UI
    Tool: Playwright
    Preconditions: local web + api running, authenticated wallet/session
    Steps:
      1. Open `/vault/1`
      2. Fill request amount input and submit redemption request
      3. Assert pending list shows new item with expected status
    Expected Result: Request appears with correct lifecycle status
    Evidence: .sisyphus/evidence/task-11-ui-request.png

  Scenario: Claim action guard
    Tool: Playwright
    Preconditions: request is not yet claimable
    Steps:
      1. Open pending/claim section
      2. Attempt claim action on non-claimable request
      3. Assert button disabled or guarded error state
    Expected Result: Invalid claim action blocked
    Evidence: .sisyphus/evidence/task-11-ui-claim-guard.png
  ```

  **Commit**: NO

- [ ] 12. Reintroduce epoch/pro-rata/NAV controls as explicit extensions

  **What to do**:
  - Keep epoch settlement and NAV freshness as documented extension behavior.
  - Ensure extension logic does not violate strict base async-redemption semantics.

  **Must NOT do**:
  - Do not make extension assumptions indistinguishable from base standard logic.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: extension-layer correctness affects settlement safety.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: insufficient for settlement/accounting edge cases.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: T14
  - **Blocked By**: T2, T6

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - epoch/pro-rata/NAV implementation sections.
  - `apps/vault-api/src/services/navOracle.ts` - NAV lifecycle integration.
  - `apps/vault-api/src/services/liquidityManager.ts` - settlement and liquidity constraints.

  **Acceptance Criteria**:
  - [ ] Extension behavior is explicitly marked and tested separately from base compliance.
  - [ ] Base compliance tests still pass with extension layer enabled.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Extension-enabled lifecycle remains valid
    Tool: forge test
    Preconditions: extension behavior implemented
    Steps:
      1. Run tests for epoch-based settlement + claims
      2. Verify pending->claimable->claimed still holds
    Expected Result: Extension tests pass without base semantic violations
    Evidence: .sisyphus/evidence/task-12-extension-lifecycle.txt

  Scenario: NAV stale negative path
    Tool: forge test
    Preconditions: NAV guard tests implemented
    Steps:
      1. Simulate stale NAV condition
      2. Attempt settlement path
      3. Assert deterministic revert/guard behavior
    Expected Result: Stale NAV is blocked as designed
    Evidence: .sisyphus/evidence/task-12-nav-negative.txt
  ```

  **Commit**: NO

- [ ] 13. Harden edge cases and authorization boundaries

  **What to do**:
  - Add and fix edge cases around partial claims, zero amounts, revoked operators, and stale state transitions.
  - Ensure deterministic errors and no ambiguous silent failures.

  **Must NOT do**:
  - Do not leave behavior undefined for revoked operator or repeated claim attempts.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: edge-path hardening across auth and lifecycle logic.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: edge-case work needs deliberate verification.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: T14, T15
  - **Blocked By**: T7

  **References**:
  - `contracts/test/WeeklyEpochVault.invariants.t.sol` - invariant framework for lifecycle safety.
  - `apps/vault-api/src/services/claimStateMachine.ts` - state transition handling.
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - runtime error propagation.

  **Acceptance Criteria**:
  - [ ] Edge-case tests assert deterministic behavior for revoked operator and repeated claim.
  - [ ] No silent success on invalid transition paths unless explicitly designed idempotency.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Revoked operator negative path
    Tool: forge test
    Preconditions: operator revoke tests present
    Steps:
      1. Grant operator, create request
      2. Revoke operator
      3. Attempt restricted action as revoked operator
    Expected Result: Revert with expected auth error
    Evidence: .sisyphus/evidence/task-13-revoked-operator.txt

  Scenario: Repeated claim idempotency/guard
    Tool: forge test
    Preconditions: claim tests updated
    Steps:
      1. Execute successful claim
      2. Execute claim again on same request/context
      3. Assert documented behavior (no-op or revert) matches spec decision
    Expected Result: Deterministic second-call behavior
    Evidence: .sisyphus/evidence/task-13-repeat-claim.txt
  ```

  **Commit**: NO

- [ ] 14. Execute full integration expansion and E2E lifecycle evidence

  **What to do**:
  - Expand integration tests across contract/api/web with controller/operator permutations.
  - Produce lifecycle evidence from request creation through claim completion.

  **Must NOT do**:
  - Do not claim completion without concrete evidence artifacts.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: multi-layer integration validation.
  - **Skills**: [`playwright`]
    - `playwright`: reliable UI lifecycle automation and evidence capture.
  - **Skills Evaluated but Omitted**:
    - `dev-browser`: Playwright is the required deterministic test channel.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 sequential closeout
  - **Blocks**: T15, T16
  - **Blocked By**: T4, T5, T8, T9, T10, T11, T12, T13

  **References**:
  - `apps/vault-web/e2e/redemption.spec.ts` - baseline E2E flow.
  - `apps/vault-api/src/__tests__/customVaultRoutes.test.ts` - route-level structure/testing patterns.
  - `contracts/test/WeeklyEpochVault.t.sol` - contract-level lifecycle checks.

  **Acceptance Criteria**:
  - [ ] Integration tests cover happy + negative paths for owner/controller/operator flows.
  - [ ] Evidence artifacts captured for all lifecycle checkpoints.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: End-to-end lifecycle happy path
    Tool: Playwright + Bash (curl)
    Preconditions: local stack running with seeded test wallet
    Steps:
      1. Submit redemption request via UI/API
      2. Trigger settlement path
      3. Claim settled redemption
      4. Verify final status and balances in API response and UI
    Expected Result: Pending -> Claimable -> Claimed completes cleanly
    Evidence: .sisyphus/evidence/task-14-e2e-lifecycle.png

  Scenario: End-to-end unauthorized action
    Tool: Bash (curl)
    Preconditions: request exists, actor is unauthorized
    Steps:
      1. Attempt claim/cancel action as unauthorized actor
      2. Assert status code and error payload fields
    Expected Result: Action rejected with deterministic response
    Evidence: .sisyphus/evidence/task-14-e2e-unauthorized.json
  ```

  **Commit**: NO

- [ ] 15. Stabilize builds and test suites across monorepo targets

  **What to do**:
  - Run and fix contract/api/web build/test suites until clean.
  - Remove residual dead references and stale imports discovered during stabilization.

  **Must NOT do**:
  - Do not mask failures by skipping tests or weakening assertions.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: broad regression sweep and fixes.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: stabilization typically spans multiple modules.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: T17, F1-F4
  - **Blocked By**: T5, T13, T14

  **References**:
  - `contracts/test/` - contract suite target.
  - `apps/vault-api/package.json` - backend build/test scripts.
  - `apps/vault-web` - frontend build target.

  **Acceptance Criteria**:
  - [ ] `forge test` passes.
  - [ ] `pnpm --filter vault build` and `pnpm --filter vault exec vitest --run` pass.
  - [ ] `pnpm --filter vault-web build` passes.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Full contract + backend + frontend pass
    Tool: Bash
    Preconditions: all preceding implementation tasks complete
    Steps:
      1. Run `cd contracts && forge test`
      2. Run `pnpm --filter vault build`
      3. Run `pnpm --filter vault exec vitest --run`
      4. Run `pnpm --filter vault-web build`
    Expected Result: All commands exit 0
    Evidence: .sisyphus/evidence/task-15-full-pass.txt

  Scenario: No skipped compliance suites
    Tool: Bash (grep)
    Preconditions: test suites updated
    Steps:
      1. Search tests for skip markers on compliance scenarios
      2. Assert no critical compliance case is skipped
    Expected Result: No compliance-critical skips
    Evidence: .sisyphus/evidence/task-15-no-skips.txt
  ```

  **Commit**: NO

- [ ] 16. Update runbook and operational documentation for ERC-7540 flow

  **What to do**:
  - Update deployment and operation docs to reflect final interfaces and lifecycle.
  - Document extension behavior and non-standard additions explicitly.

  **Must NOT do**:
  - Do not leave outdated command examples or endpoint signatures.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: high-quality operational documentation required.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `quick`: insufficient depth for operational runbooks.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: T17, F1
  - **Blocked By**: T14

  **References**:
  - `VAULT_KNOWLEDGE.md` - project vault context and operational conventions.
  - `apps/vault-api/.env.example` - backend runtime config docs.
  - `apps/vault-web/.env.example` - frontend runtime config docs.

  **Acceptance Criteria**:
  - [ ] Runbook reflects actual deployed contract/API/web flow.
  - [ ] Docs clearly distinguish ERC-7540 base behavior vs extension behavior.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Command validity check from docs
    Tool: Bash
    Preconditions: docs updated
    Steps:
      1. Execute documented build/test commands verbatim
      2. Confirm commands run successfully
    Expected Result: Commands are accurate and executable
    Evidence: .sisyphus/evidence/task-16-doc-commands.txt

  Scenario: Endpoint/documentation alignment
    Tool: Bash (grep) + Read
    Preconditions: docs and routes present
    Steps:
      1. Compare documented endpoint list vs route definitions
      2. Confirm no stale/removed endpoint remains documented
    Expected Result: Documentation and routes aligned
    Evidence: .sisyphus/evidence/task-16-endpoints-alignment.txt
  ```

  **Commit**: NO

- [ ] 17. Produce release-readiness and rollback simulation checklist

  **What to do**:
  - Define pre-release checks, rollback drills, and safe toggles for launch prep.
  - Include operator misuse and stale-state failure runbooks.

  **Must NOT do**:
  - Do not ship without documented rollback and incident response steps.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: bounded checklist generation from completed artifacts.
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `writing`: heavier prose not needed beyond actionable checklist.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: T15, T16

  **References**:
  - `.sisyphus/evidence/` - produced evidence for go/no-go checks.
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - runtime failure modes and endpoints.
  - `contracts/src/WeeklyEpochVault.sol` - contract-level failure conditions.

  **Acceptance Criteria**:
  - [ ] Release checklist includes objective go/no-go criteria.
  - [ ] Rollback drill steps are executable and validated.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Rollback drill walkthrough
    Tool: Bash + Read
    Preconditions: checklist drafted
    Steps:
      1. Execute rollback rehearsal commands in non-destructive mode
      2. Verify each step has a pass/fail condition
    Expected Result: Rollback checklist is executable and complete
    Evidence: .sisyphus/evidence/task-17-rollback-drill.txt

  Scenario: Go/no-go gate validation
    Tool: Bash (grep)
    Preconditions: checklist drafted
    Steps:
      1. Verify checklist includes build/test/interface/operator/e2e gates
      2. Confirm each gate maps to evidence artifact
    Expected Result: Complete gate coverage with evidence mapping
    Evidence: .sisyphus/evidence/task-17-gates.txt
  ```

  **Commit**: NO

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Validate all must-have requirements and verify no out-of-scope implementation was introduced. Confirm evidence file presence under `.sisyphus/evidence/`.

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run type-check/lint/tests and inspect changed files for unsafe shortcuts (`as any`, disabled checks, dead feature flags, commented-out logic).

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Execute all task QA scenarios exactly as written. Capture screenshots, terminal logs, and API responses in `.sisyphus/evidence/final-qa/`.

- [ ] F4. **Scope Fidelity Check** — `deep`
      Ensure all planned work landed and no unplanned feature creep occurred, especially around async-deposit and UI redesign.

---

## Commit Strategy

- 1: `feat(contracts): implement erc7540 redemption interfaces`
- 2: `refactor(vault-api): align provider routes to controller semantics`
- 3: `refactor(vault-web): align redemption ui with erc7540 lifecycle`
- 4: `test(vault): add compliance and e2e lifecycle coverage`
- 5: `docs(vault): update runbook for erc7540 rollout`

---

## Success Criteria

### Verification Commands

```bash
cd contracts && forge test
pnpm --filter vault build
pnpm --filter vault exec vitest --run
pnpm --filter vault-web build
```

### Final Checklist

- [ ] ERC-7540 redemption interface implemented and verified
- [ ] Operator model enforced and tested
- [ ] Preview override behavior verified for async-redemption
- [ ] API/web lifecycle semantics aligned end-to-end
- [ ] All tests green and evidence captured
