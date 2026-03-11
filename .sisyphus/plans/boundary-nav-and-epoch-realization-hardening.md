# Boundary NAV And Epoch Realization Hardening

## TL;DR

> **Summary**: Harden the vault around one explicitly supported model: boundary-settlement with epoch-end NAV pricing for both queued deposits and redemption cohorts, while removing or clearly disabling any runtime/UI semantics that imply true gradual realization across epochs.
> **Deliverables**:
>
> - Contract/runtime/UI/docs aligned to boundary-settlement-only support
> - No misleading partial-realization/cohort-carry claims in live API/UI flows
> - Automated liability-first transfer behavior retained and verified against the new Amoy deployment
> - Fresh operator runbook and deployment artifact verification for `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D`
>   **Effort**: Large
>   **Parallel**: YES - 3 waves
>   **Critical Path**: T1 supported-model lock -> T2/T3 contract/runtime hardening -> T4/T5 API/UI truthfulness -> T6/T7 validation -> T8 deployment/runbook sync

## Context

### Original Request

- Properly plan the remaining important vault issues instead of ignoring them.
- Specifically address: epoch-end NAV for withdrawals, whether gradual realization is actually supported, and anything else still economically unsafe.

### Interview Summary

- Boundary NAV should be the pricing source for queued deposit minting and redemption cohort freezing when NAV is the authoritative mark-to-market number.
- Queued deposits must never subsidize prior withdrawal cohorts or unresolved positions before share issuance.
- The user does not want hacks, misleading behavior, or UI/runtime semantics that suggest support for features that are not really implemented.
- A valid new Amoy deployment exists at `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` and the broken deployment at `0x7EF2e0048f5bAeDe046f6BF797943daF4ED8CB47` must not be used.

### Metis Review (gaps addressed)

- Do not expand this work into full cohort accounting / gradual realization implementation.
- Treat boundary settlement as the supported model and explicitly harden product/runtime/docs around that decision.
- Add mathematical and behavioral acceptance criteria proving queued deposits do not subsidize prior cohorts and that unsupported gradual-realization semantics are not exposed.

## Work Objectives

### Core Objective

- Make the system economically and operationally truthful as a boundary-settlement epoch vault: deposits mint from epoch boundary NAV, redemptions freeze from epoch boundary NAV, queued deposits remain isolated until issuance, and no runtime/UI path implies true gradual realization support.

### Deliverables

- Contract-level safeguards and tests for boundary-NAV settlement semantics.
- Runtime/API enforcement that boundary settlement is the only supported open-position model.
- UI/API wording and data model cleanup removing misleading gradual-realization expectations.
- Verified active Amoy runtime pointed at `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D`.
- Updated operator runbook and deployment artifacts reflecting the valid deployment and unsupported behavior boundaries.

### Definition of Done (verifiable conditions with commands)

- `forge test --match-test "testWithdrawalUsesEpochBoundaryNavWhenQueuedDepositsExist|testFreezeEconomicsInvariants|testFreezeExcludesQueuedAssetsFromRedemptionSnapshot|testReservedRedemptionAssetsBlockDeploymentUntilClaimed|testWithdrawReleasesReservedRedemptionAssets"` passes in `contracts/`
- `pnpm --filter vault build` passes in `apps/vault-api`
- `pnpm --filter vault-web build` passes in `apps/vault-web`
- `pnpm build` passes at repo root
- On-chain verification script for `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` succeeds and returns expected parameters/roles
- No API/UI copy or capability flag claims cancellation or gradual realization support

### Must Have

- Boundary NAV is the single economic pricing source for boundary minting and redemption freeze.
- Queued deposits remain non-deployable and non-share-bearing until processing.
- Withdrawal liabilities are explicitly prioritized over capital deployment.
- Runtime/UI/docs state that open positions spanning epochs are not supported as gradual cohort realization.

### Must NOT Have

- No claim that gradual realization is supported end-to-end.
- No silent fallback from unsupported open-position carryover into misleading UI estimates.
- No use of queued deposits to fund prior redemptions.
- No new architecture for full cohort accounting in this plan.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after with Forge + Vitest + TypeScript builds
- QA policy: every task includes code-path verification or runtime probe
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. Extract shared dependencies first.

Wave 1: supported-model lock, contract/API truthfulness, deployment verification
Wave 2: runtime/UI/docs hardening
Wave 3: regression, runbook, and deployment artifact sync

### Dependency Matrix (full, all tasks)

- T1 blocks T2, T3, T4, T5, T8
- T2 blocks T6
- T3 blocks T6
- T4 blocks T6
- T5 blocks T6 and T8
- T6 blocks T7
- T8 can run after T1 and T5

### Agent Dispatch Summary (wave -> task count -> categories)

- Wave 1 -> 3 tasks -> `deep`, `quick`
- Wave 2 -> 3 tasks -> `deep`, `writing`, `quick`
- Wave 3 -> 2 tasks -> `quick`, `writing`

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Lock The Supported Economic Model

  **What to do**: Define the product/runtime support posture as boundary settlement only. Audit and update capability flags, route responses, entitlement/claim copy, and any internal comments or docs that still imply gradual realization or cohort-carry support is live. Explicitly mark open positions spanning epochs as unsupported behavior unless/until a separate cohort-accounting architecture is built.
  **Must NOT do**: Do not implement full cohort accounting. Do not leave ambiguous wording like "partial realization" or "gradual distribution" in user-facing flows unless it is actually wired.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This task defines the support boundary the rest of the work must follow.
  - Skills: []
  - Omitted: [`playwright`] — no browser work needed yet.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: T2, T3, T4, T5, T8 | Blocked By: none

  **References**:
  - Contract: `contracts/src/EpochTrancheVault.sol`
  - Runtime claim states: `apps/vault-api/src/services/claimStateMachine.ts`
  - API routes: `apps/vault-api/src/routes/customVaultRoutes.ts`
  - UI claims/pending requests: `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx`, `apps/vault-web/app/vault/[id]/components/PendingRequests.tsx`
  - External: `https://eips.ethereum.org/EIPS/eip-7540`

  **Acceptance Criteria**:
  - [ ] API capabilities and user-facing wording do not claim gradual realization or cancellation support.
  - [ ] Any remaining gradual-realization repository/schema code is clearly non-runtime or internal-only, not represented as live product behavior.

  **QA Scenarios**:

  ```text
  Scenario: Capability truthfulness
    Tool: Bash
    Steps: Run API build and grep generated outputs/routes/capabilities for "cancelBeforeSettlement" and "partially_realized" user-facing claims.
    Expected: Cancellation is false/absent and no live route/UI text claims gradual realization support.
    Evidence: .sisyphus/evidence/task-1-capability-truthfulness.txt

  Scenario: Unsupported behavior declaration
    Tool: Bash
    Steps: Search docs/API/UI for "gradual realization" and "open positions" language after changes.
    Expected: Supported model is boundary settlement; unsupported semantics are explicitly marked.
    Evidence: .sisyphus/evidence/task-1-unsupported-model-text.txt
  ```

  **Commit**: YES | Message: `docs(vault): lock supported epoch settlement model` | Files: `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/services/claimStateMachine.ts`, `apps/vault-web/app/vault/[id]/components/*`, `docs/operator-runbook-amoy.md`

- [ ] 2. Finish Boundary-NAV Contract Hardening

  **What to do**: Confirm and complete the contract-level fixes so redemption cohorts freeze from boundary NAV, queued deposits stay excluded from prior cohorts, and reserved liabilities are released on all claim paths. Remove or guard any residual code paths that still mix principal/liquid-assets pricing with NAV-based pricing for the same epoch boundary.
  **Must NOT do**: Do not leave mixed pricing sources. Do not rely on runtime/UI fixes to paper over contract economic bugs.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Contract economics are the highest-risk correctness layer.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T6 | Blocked By: T1

  **References**:
  - Contract: `contracts/src/EpochTrancheVault.sol`
  - Contract tests: `contracts/test/EpochTrancheVault.t.sol`

  **Acceptance Criteria**:
  - [ ] Boundary-NAV withdrawal regression passes.
  - [ ] `withdraw()` and `redeem()` both correctly reduce `reservedRedemptionAssets`.
  - [ ] No test remains that encodes the old principal-based freeze behavior.

  **QA Scenarios**:

  ```text
  Scenario: Boundary NAV regression
    Tool: Bash
    Steps: Run forge tests for boundary NAV, queued deposit exclusion, and reserve release.
    Expected: All targeted contract regression tests pass.
    Evidence: .sisyphus/evidence/task-2-contract-regressions.txt

  Scenario: Wrong-model regression guard
    Tool: Bash
    Steps: Search contract tests for old assumptions like frozenAssets == raw liquid assets at freeze.
    Expected: No remaining passing test encodes the obsolete pricing model.
    Evidence: .sisyphus/evidence/task-2-obsolete-assumptions.txt
  ```

  **Commit**: YES | Message: `fix(vault): align redemption freeze with boundary nav` | Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`, `contracts/flattened/EpochTrancheVault.flattened.sol`

- [ ] 3. Make Runtime NAV Semantics Match The Contract

  **What to do**: Ensure `navOracle`, `customVaultProvider`, and related routes consistently treat `currentNAV` as the authoritative boundary pricing input while excluding queued deposits and reserved liabilities. Verify no runtime preview/estimate path reintroduces raw `totalAssets / totalSupply` shortcuts or principal-based redemption math.
  **Must NOT do**: Do not publish NAV that includes queued deposits or reserved redemption liabilities. Do not show estimates that disagree with boundary pricing.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Runtime must match contract economics exactly.
  - Skills: []
  - Omitted: [`playwright`] — not yet.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T6 | Blocked By: T1

  **References**:
  - NAV oracle: `apps/vault-api/src/services/navOracle.ts`
  - Provider previews: `apps/vault-api/src/services/customVaultProvider.ts`
  - Deposit queue route: `apps/vault-api/src/routes/customVaultRoutes.ts`
  - Status route: `apps/vault-api/src/routes/vaultRoutes.ts`

  **Acceptance Criteria**:
  - [ ] Deposit and redemption previews derive from boundary NAV semantics.
  - [ ] NAV publication excludes queued deposits and reserved liabilities.
  - [ ] No runtime estimate path uses raw pool ratio for custom vaults.

  **QA Scenarios**:

  ```text
  Scenario: NAV semantics consistency
    Tool: Bash
    Steps: Run vault-api build and grep for raw totalAssets/totalSupply share-price shortcuts in custom vault paths.
    Expected: Custom vault preview/pricing paths rely on NAV-based logic only.
    Evidence: .sisyphus/evidence/task-3-nav-consistency.txt

  Scenario: Liability exclusion verification
    Tool: Bash
    Steps: Execute the existing on-chain/local probe script path against a test deployment or mocked values and inspect queued/reserved subtraction behavior.
    Expected: Published NAV excludes queued and reserved assets.
    Evidence: .sisyphus/evidence/task-3-liability-exclusion.txt
  ```

  **Commit**: YES | Message: `fix(vault-api): align custom vault nav semantics` | Files: `apps/vault-api/src/services/navOracle.ts`, `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/routes/vaultRoutes.ts`

- [ ] 4. Remove Misleading Gradual-Realization Runtime Paths

  **What to do**: Audit `realizationRepository`, `entitlementRepository`, `claimStateMachine`, and related API routes. Either isolate these paths as future-only/internal tooling or block them from user-facing execution until a true cohort-accounting engine exists. Update state labels and summary endpoints so they cannot imply live partial-realization support.
  **Must NOT do**: Do not delete schema/history that may be useful later. Do not leave user-facing states like `partially_realized` exposed if they are not live-backed.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Requires careful separation of future scaffolding from active behavior.
  - Skills: []
  - Omitted: [`playwright`] — backend/state only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T6 | Blocked By: T1

  **References**:
  - `apps/vault-api/src/repositories/realizationRepository.ts`
  - `apps/vault-api/src/repositories/entitlementRepository.ts`
  - `apps/vault-api/src/services/claimStateMachine.ts`
  - `apps/vault-api/src/db/schema.ts`
  - `apps/vault-api/src/routes/customVaultRoutes.ts`

  **Acceptance Criteria**:
  - [ ] No user-facing route or UI summary presents partial/gradual realization as a live supported path.
  - [ ] Internal scaffolding remains compile-safe and future-extensible.

  **QA Scenarios**:

  ```text
  Scenario: User-facing state cleanup
    Tool: Bash
    Steps: Search API routes and UI payload builders for partially_realized / fully_realized / realization-driven language.
    Expected: Unsupported realization states are not exposed as live product semantics.
    Evidence: .sisyphus/evidence/task-4-state-cleanup.txt

  Scenario: Internal scaffolding preserved
    Tool: Bash
    Steps: Run vault-api build after state cleanup.
    Expected: Repositories/schema still compile without exposing unsupported semantics.
    Evidence: .sisyphus/evidence/task-4-build.txt
  ```

  **Commit**: YES | Message: `refactor(vault-api): isolate unsupported realization paths` | Files: `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/services/claimStateMachine.ts`, `apps/vault-api/src/repositories/*.ts`

- [ ] 5. Enforce Boundary-Only Position Support In Runtime

  **What to do**: Harden `tradingOrchestrator`, `liquidityManager`, and worker flows so new trades that would span beyond the supported epoch boundary are rejected, and runtime messaging/health checks explicitly flag open-position carryover as unsupported. Keep automatic liability-first recall/deploy behavior, but do not let it imply gradual realization support.
  **Must NOT do**: Do not silently allow positions to cross epochs while still presenting the vault as boundary-settlement-safe.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Runtime safety and supported-product behavior must align.
  - Skills: []
  - Omitted: [`playwright`] — runtime only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T6, T8 | Blocked By: T1

  **References**:
  - `apps/vault-api/src/services/tradingOrchestrator.ts`
  - `apps/vault-api/src/services/liquidityManager.ts`
  - `apps/vault-api/src/tradingWorker.ts`
  - `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`

  **Acceptance Criteria**:
  - [ ] Markets closing after the current epoch boundary are rejected when the guard is enabled.
  - [ ] Liquidity automation prioritizes queued deposits and withdrawal liabilities without implying gradual realization.
  - [ ] Startup/health checks support both EOA and Safe trading wallets.

  **QA Scenarios**:

  ```text
  Scenario: Epoch-boundary trade rejection
    Tool: Bash
    Steps: Run targeted Vitest coverage for trading orchestrator boundary guard.
    Expected: Markets beyond the epoch boundary are not trade candidates.
    Evidence: .sisyphus/evidence/task-5-boundary-guard.txt

  Scenario: Liquidity-first runtime behavior
    Tool: Bash
    Steps: Run targeted reconciliation tests and inspect logs/details for recall-before-deploy behavior.
    Expected: Liability-first cash handling is preserved without claiming gradual realization.
    Evidence: .sisyphus/evidence/task-5-liquidity-runtime.txt
  ```

  **Commit**: YES | Message: `fix(vault-api): enforce boundary-only position support` | Files: `apps/vault-api/src/services/tradingOrchestrator.ts`, `apps/vault-api/src/services/liquidityManager.ts`, `apps/vault-api/src/tradingWorker.ts`, `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`

- [ ] 6. Align UI And API Summaries With Supported Semantics

  **What to do**: Update vault detail cards, request status panels, claim summaries, and queue explanations so they accurately describe boundary pricing, unsupported gradual realization, and the meaning of queued/frozen/claimable states. Ensure the active Amoy deployment address is referenced correctly where surfaced.
  **Must NOT do**: Do not surface stale addresses or misleading “live realized over time” explanations.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: Primary work is truthfulness/clarity across user-facing surfaces.
  - Skills: []
  - Omitted: [`frontend-design`] — not a visual redesign.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: T7 | Blocked By: T2, T3, T4, T5

  **References**:
  - `apps/vault-web/app/vault/[id]/vault-detail.tsx`
  - `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx`
  - `apps/vault-web/app/vault/[id]/components/PendingRequests.tsx`
  - `apps/vault-web/src/lib/hooks.ts`
  - `apps/vault-web/src/types.ts`

  **Acceptance Criteria**:
  - [ ] UI copy says withdrawals are priced from epoch boundary NAV, not gradually realized over time.
  - [ ] No card or tooltip implies unsupported position-by-position payout tracking.
  - [ ] Address-dependent links/data use the new valid deployment.

  **QA Scenarios**:

  ```text
  Scenario: Copy audit
    Tool: Bash
    Steps: Search vault-web for gradual realization / partial realization / outdated vault address references.
    Expected: User-facing copy matches the supported boundary-settlement model and new address.
    Evidence: .sisyphus/evidence/task-6-copy-audit.txt

  Scenario: Web build verification
    Tool: Bash
    Steps: Run vault-web build.
    Expected: UI compiles after wording/type updates.
    Evidence: .sisyphus/evidence/task-6-web-build.txt
  ```

  **Commit**: YES | Message: `docs(vault-web): align ui with boundary settlement semantics` | Files: `apps/vault-web/app/vault/[id]/*`, `apps/vault-web/src/*`

- [ ] 7. Regression And Deployment Verification Sweep

  **What to do**: Run the full targeted regression sweep for contract, API, and UI. Re-verify the new Amoy deployment `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` on-chain, including bytecode size, roles, parameters, initial state, and interface support. Confirm the invalid deployment `0x7EF2e0048f5bAeDe046f6BF797943daF4ED8CB47` is explicitly documented as unusable.
  **Must NOT do**: Do not mark the system ready if any runtime still references the invalid deployment or if any core contract method mismatch remains.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: Verification-heavy, low-design task.
  - Skills: []
  - Omitted: [`playwright`] — not needed.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: T8 | Blocked By: T6

  **References**:
  - `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`
  - `contracts/flattened/EpochTrancheVault.flattened.sol`
  - `contracts/scripts/flattenEpochTrancheVaultForRemix.sh`

  **Acceptance Criteria**:
  - [ ] Valid deployment probe passes for `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D`.
  - [ ] Invalid deployment `0x7EF2...` is not referenced as active anywhere.
  - [ ] Monorepo build passes.

  **QA Scenarios**:

  ```text
  Scenario: On-chain deployment verification
    Tool: Bash
    Steps: Run the existing viem verification script against 0x8D87... and compare code size / roles / parameters.
    Expected: All checks pass and contract methods return valid values.
    Evidence: .sisyphus/evidence/task-7-onchain-verify.txt

  Scenario: Build sweep
    Tool: Bash
    Steps: Run root build.
    Expected: Monorepo build passes cleanly.
    Evidence: .sisyphus/evidence/task-7-root-build.txt
  ```

  **Commit**: YES | Message: `chore(vault): verify boundary settlement deployment` | Files: runtime configs, deployment notes, evidence outputs

- [ ] 8. Runbook And Deployment Artifact Cleanup

  **What to do**: Update operator-facing docs and deployment artifacts so the valid deployment `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` is the canonical Amoy vault. Document the exact supported semantics: boundary settlement, queued deposits isolated until issuance, no cancellation, no true gradual realization support, Safe/EOA trading wallet support, and the correct Remix deployment procedure (select `EpochTrancheVault` in the flattened file).
  **Must NOT do**: Do not leave stale addresses or imply the broken `0x7EF2...` deployment was valid.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: Operator handoff and future deployment hygiene.
  - Skills: []
  - Omitted: [`playwright`] — not relevant.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: none | Blocked By: T1, T5, T7

  **References**:
  - `docs/operator-runbook-amoy.md`
  - `contracts/deployments/epoch-tranche-vault-staging-latest.json`
  - `contracts/scripts/deployEpochTrancheVault.js`
  - `contracts/scripts/flattenEpochTrancheVaultForRemix.sh`
  - `contracts/flattened/EpochTrancheVault.flattened.sol`

  **Acceptance Criteria**:
  - [ ] Runbook names the valid deployment address and correct constructor parameters.
  - [ ] Runbook explicitly warns that gradual realization is not supported and that the wrong Remix contract selection can produce unusable deployments.
  - [ ] Deployment artifacts are consistent with the valid contract.

  **QA Scenarios**:

  ```text
  Scenario: Runbook consistency audit
    Tool: Bash
    Steps: Search operator docs and deployment JSONs for stale vault addresses and outdated semantics.
    Expected: Only 0x8D87... is presented as the current Amoy deployment; broken deployments are clearly historical/invalid.
    Evidence: .sisyphus/evidence/task-8-runbook-audit.txt

  Scenario: Remix procedure check
    Tool: Bash
    Steps: Search the flattened file for constructor-bearing contracts and confirm docs instruct selecting EpochTrancheVault specifically.
    Expected: Runbook prevents the earlier wrong-contract deployment pitfall.
    Evidence: .sisyphus/evidence/task-8-remix-procedure.txt
  ```

  **Commit**: YES | Message: `docs(vault): refresh amoy deployment runbook` | Files: `docs/operator-runbook-amoy.md`, `contracts/deployments/*.json`, `contracts/scripts/*.js`, `contracts/scripts/flattenEpochTrancheVaultForRemix.sh`

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- Create atomic commits per TODO group, keeping contract, runtime, UI, and runbook changes separable.
- Do not amend; if follow-up fixes are needed, create new commits.

## Success Criteria

- Boundary-settlement-only support is explicit and truthful across contract, runtime, UI, and docs.
- The valid Amoy deployment `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` is the active runtime address.
- No part of the product claims support for gradual realization across open positions unless a future cohort-accounting architecture is implemented.
- Contract, API, UI, and deployment documentation are mathematically and operationally aligned.
