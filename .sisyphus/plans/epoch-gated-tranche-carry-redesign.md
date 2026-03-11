# Epoch-Gated Tranche Carry Redesign Plan

## TL;DR

> **Quick Summary**: Replace the current aggregate weekly redemption model with a side-pocket epoch-tranche system: deposits queue and mint next epoch start, redemptions freeze into cohort tranches at epoch boundary, payouts are balanced upfront then auto-carry forward pro-rata as realizations arrive.
>
> **Deliverables**:
>
> - New epoch-tranche contract flow with queued deposits, frozen redemption cohorts, and carry ledger
> - Backend/API/frontend lifecycle updates for queued mint, tranche settlement, and threshold-gated claims
> - Full regression and scenario tests for fairness, anti-gaming, and carry completion behavior
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES - 3 waves + final verification
> **Critical Path**: T1 -> T3 -> T7 -> T10 -> T13 -> T16 -> T18

---

## Context

### Original Request

User requested a breaking-change redesign (nothing deployed) to support:

- Entry anytime, mint at next epoch start
- Exit anytime, settle to next-epoch cohort based on that cohort's outcomes
- If positions later lose, exiting cohort should absorb those losses
- Balanced payout (partial upfront + automatic carry)
- Pro-rata carry and threshold-gated claim UX

### Interview Summary

**Key Discussions**:

- Current `WeeklyEpochVault` is too aggregate for strict cohort fairness after epoch boundaries.
- Snapshot/tranche semantics are required to avoid mispricing exits against later P/L changes.
- Claims should accrue pro-rata but only become withdrawable when user eligibility bucket reaches threshold (plus final-dust override).

**Research Findings**:

- Ribbon pattern confirms queued deposit receipts + delayed mint using round PPS.
- Maple pattern confirms cyclical pro-rata withdrawal behavior under constrained liquidity.
- Codebase already contains useful anchors in `contracts/src/SnapshotTrancheVault.sol`, `contracts/src/WeeklyEpochVault.sol`, and vault-api entitlement/realization repositories.

### Metis Review

**Identified Gaps** (addressed in this plan):

- Missing carry threshold/dust policy -> explicit threshold-gated claim criteria included.
- Missing anti-gaming controls -> config delay and epoch boundary rules included.
- Missing gas-bound processing model -> chunked settlement/claim processing included.
- Missing role abuse controls -> role separation + timelock/timeout controls included.

---

## Work Objectives

### Core Objective

Deliver a deterministic epoch-tranche vault lifecycle where deposit and redemption economics are locked to explicit epoch boundaries, with carry-forward payout progression that preserves cohort fairness and prevents dilution/gaming.

### Concrete Deliverables

- Contract lifecycle supporting: queued deposits, epoch-open mint, redemption freeze cohorts, upfront settlement, carry accrual, threshold-gated claims.
- Backend services/routes/repositories aligned to tranche + carry semantics.
- Frontend UX showing queued deposit status, cohort progress, accrued-vs-claimable carry, and claim eligibility.
- Test suites covering profit/loss drift, insufficient liquidity, delayed realizations, and long-running carry scenarios.

### Definition of Done

- [ ] Contract + backend + frontend build/typecheck pass via project commands.
- [ ] Contract tests validate fairness invariants for post-boundary P/L and carry behavior.
- [ ] API and UI reflect new lifecycle with no references to deprecated weekly-aggregate semantics.

### Must Have

- Cohort-level frozen economics for redemptions at epoch boundary.
- Pro-rata carry distribution with per-user accrued vs claimed accounting.
- Threshold-gated claims with final-dust claim override when tranche closes.
- Delayed minting for deposits at next epoch start using epoch-open pricing.

### Must NOT Have (Guardrails)

- No payout logic based solely on request-time NAV.
- No user-specific preferential carry ordering (must remain deterministic pro-rata).
- No unbounded loops in settlement/claim paths.
- No implicit reliance on manual user checks for correctness.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — All verification is agent-executed with command/tool evidence.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: Tests-after (default applied)
- **Frameworks**: Foundry (contracts), Vitest (vault-api), Next build/typecheck (vault-web)
- **Agent-Executed QA**: Mandatory for every task

### QA Policy

- **Contract**: `forge test` targeted + full suite
- **Backend**: `pnpm --filter vault test` + targeted API/provider tests
- **Frontend**: `pnpm --filter vault-web build` + route-level behavior checks
- **Evidence**: Save logs/screenshots to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`

### Default Parameters (Applied)

- `minClaimThreshold`: `100 USDC` (claim unlock threshold)
- `balancedUpfrontBps`: `5000` (50% upfront target before carry)
- `configActivationDelayEpochs`: `2` (anti-gaming delay)
- `maxSettlementChunkSize`: `100` controllers/users per chunk
- `carryOrderingPolicy`: pro-rata within cohort (no FIFO preference)
- `finalDustClaimOverride`: enabled when tranche finalizes
- `erc7540CompatibilityMode`: extended lifecycle (strict ERC-7540 parity not required)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - architecture foundations):
├── Task 1: Canonical contract scaffold + interface [deep]
├── Task 2: Epoch boundary + anti-gaming timing rules [quick]
├── Task 3: Deposit receipt queue storage model [quick]
├── Task 4: Redemption tranche + carry storage model [deep]
├── Task 5: Role model + timelock/timeout guardrails [unspecified-high]
└── Task 6: Events/errors and compatibility surface [quick]

Wave 2 (After Wave 1 - core lifecycle mechanics):
├── Task 7: Deposit request + queue logic [deep]
├── Task 8: Epoch-open mint finalization logic [deep]
├── Task 9: Redemption request queue + epoch-close freeze [deep]
├── Task 10: Balanced upfront + pro-rata settlement [ultrabrain]
├── Task 11: Realization ingestion + auto carry accrual [deep]
└── Task 12: Threshold-gated claim + dust override [unspecified-high]

Wave 3 (After Wave 2 - platform integration):
├── Task 13: Backend ABI/client/provider upgrade [quick]
├── Task 14: DB/repository/state-machine lifecycle migration [unspecified-high]
├── Task 15: API routes for queued mint/tranche carry flow [unspecified-high]
├── Task 16: Frontend hooks/api lifecycle UX states [visual-engineering]
├── Task 17: Contract + backend test suites for new invariants [deep]
└── Task 18: E2E QA evidence + docs + old-flow cleanup [writing]

Wave FINAL (After all implementation tasks - independent review):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real QA replay from task scenarios (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: 1 -> 3 -> 7 -> 10 -> 13 -> 16 -> 18
Parallel Speedup: ~65% vs sequential
Max Concurrent: 6
```

### Dependency Matrix

- **1**: None -> 7, 9, 10, 11, 12, 13
- **2**: None -> 7, 8, 9, 10
- **3**: 1 -> 7, 8, 13, 14, 16
- **4**: 1 -> 9, 10, 11, 12, 14, 15
- **5**: 1 -> 9, 10, 11, 12, 15, 18
- **6**: 1 -> 13, 15, 16, 17
- **7**: 1,2,3 -> 8, 9, 10, 13, 17
- **8**: 2,3,7 -> 10, 11, 12, 13, 17
- **9**: 1,2,4,5,7 -> 10, 11, 12, 14, 15, 17
- **10**: 1,2,4,5,7,8,9 -> 11, 12, 13, 14, 15, 17
- **11**: 1,4,5,8,9,10 -> 12, 13, 14, 15, 17
- **12**: 1,4,5,8,9,10,11 -> 13, 14, 15, 16, 17
- **13**: 1,3,6,7,8,10,11,12 -> 15, 16, 17, 18
- **14**: 3,4,9,10,11,12 -> 15, 17, 18
- **15**: 4,5,6,9,10,11,12,13,14 -> 16, 17, 18
- **16**: 3,6,12,13,15 -> 18
- **17**: 6,7,8,9,10,11,12,13,14,15 -> 18
- **18**: 5,13,14,15,16,17 -> F1,F2,F3,F4

### Agent Dispatch Summary

- **Wave 1**: 6 agents
  - T1 `deep`, T2 `quick`, T3 `quick`, T4 `deep`, T5 `unspecified-high`, T6 `quick`
- **Wave 2**: 6 agents
  - T7 `deep`, T8 `deep`, T9 `deep`, T10 `ultrabrain`, T11 `deep`, T12 `unspecified-high`
- **Wave 3**: 6 agents
  - T13 `quick`, T14 `unspecified-high`, T15 `unspecified-high`, T16 `visual-engineering`, T17 `deep`, T18 `writing`
- **Final**: 4 agents
  - F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Establish canonical epoch-tranche contract surface

  **What to do**:
  - Introduce canonical contract target (`EpochTrancheVault` or promoted `SnapshotTrancheVault`) and freeze public interface names for deposit queue, epoch mint, redemption freeze, settlement, carry accrual, and claim.
  - Define compatibility posture with current consumers (`customVaultClient`, provider, routes) and document intentional breaking points.

  **Must NOT do**:
  - Do not keep dual active runtime contracts with diverging logic.
  - Do not leave ambiguous names for old vs new redemption flows.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires architectural decision and contract/API boundary alignment.
  - **Skills**: `[]`
    - none: contract architecture is primary; no specialized skill dependency required.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not relevant to contract surface decisions.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (critical foundation)
  - **Blocks**: 3, 4, 5, 6, 7, 9, 10, 11, 12, 13
  - **Blocked By**: None

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - Current ERC-7540 surface to explicitly supersede.
  - `contracts/src/SnapshotTrancheVault.sol` - Existing snapshot/tranche primitives to reuse.
  - `contracts/src/interfaces/ISnapshotTrancheVault.sol` - Baseline interface style and naming conventions.
  - `apps/vault-api/src/services/customVaultClient.ts` - Existing client contract method expectations.

  **Acceptance Criteria**:
  - [ ] Single canonical contract entrypoint is selected and referenced by backend client config.
  - [ ] Public method/event/error names are listed and mapped to old equivalents/deprecations.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Canonical contract target resolves unambiguously
    Tool: Bash (forge build)
    Preconditions: Contract source tree contains selected canonical contract file
    Steps:
      1. Run `cd contracts && forge build`
      2. Confirm selected contract compiles and appears in output artifacts
      3. Confirm old contract is not referenced as active runtime in vault-api config/client
    Expected Result: Build succeeds and canonical target is singular
    Failure Indicators: Multiple active contract targets or unresolved ABI mapping
    Evidence: .sisyphus/evidence/task-1-canonical-contract.txt

  Scenario: Incompatible surface changes are explicitly declared
    Tool: Bash (grep)
    Preconditions: API/client files updated with explicit migration notes
    Steps:
      1. Search for deprecated endpoint/method markers in updated files
      2. Verify each removed/renamed method has a replacement mapping
    Expected Result: No silent breaking changes remain undocumented
    Failure Indicators: Removed methods without replacement mapping
    Evidence: .sisyphus/evidence/task-1-breaking-map.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-canonical-contract.txt
  - [ ] task-1-breaking-map.txt

  **Commit**: YES
  - Message: `feat(vault): define canonical epoch tranche contract surface`
  - Files: `contracts/src/*`, `apps/vault-api/src/services/customVaultClient.ts`
  - Pre-commit: `cd contracts && forge build`

- [x] 2. Add epoch boundary and anti-gaming timing rules

  **What to do**:
  - Extend epoch timing helpers for deposit cutoff, mint-open boundary, redemption freeze boundary, and claim window checks.
  - Add delayed-config activation rule (effective after future epochs) to prevent same-epoch parameter gaming.

  **Must NOT do**:
  - Do not use `block.timestamp` logic inconsistently across boundary checks.
  - Do not allow config change to affect already-queued requests in the same cycle.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused deterministic helper/rules update in limited files.
  - **Skills**: `[]`
    - none: utility-layer change with clear deterministic behavior.
  - **Skills Evaluated but Omitted**:
    - `playwright`: not required for non-UI timing math.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with 3,4,5,6)
  - **Blocks**: 7, 8, 9, 10
  - **Blocked By**: None

  **References**:
  - `contracts/src/libraries/EpochMath.sol` - Existing epoch bucket math to extend consistently.
  - `contracts/src/WeeklyEpochVault.sol` - Current epoch end/settlement readiness checks.
  - `contracts/test/EpochMath.t.sol` - Existing boundary-test style to replicate.
  - External: `https://raw.githubusercontent.com/maple-labs/withdrawal-manager-cyclical/main/contracts/MapleWithdrawalManager.sol` - Delayed configuration activation pattern.

  **Acceptance Criteria**:
  - [ ] Boundary helper methods cover request, freeze, and mint transitions with no ambiguity.
  - [ ] Config activation delay is deterministic and tested across boundary edges.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Boundary transitions are deterministic
    Tool: Bash (forge test)
    Preconditions: Epoch helper tests include before/at/after boundary timestamps
    Steps:
      1. Run `cd contracts && forge test --match-path test/EpochMath.t.sol`
      2. Verify tests cover exact boundary second behavior
    Expected Result: Boundary tests pass for all edge timestamps
    Failure Indicators: Off-by-one behavior at cutoff/open timestamps
    Evidence: .sisyphus/evidence/task-2-epoch-boundaries.txt

  Scenario: Config change cannot affect same-cycle queued requests
    Tool: Bash (forge test)
    Preconditions: Test includes mid-cycle config update
    Steps:
      1. Queue request under config A
      2. Update config to B in same cycle
      3. Execute settlement/mint for queued request
    Expected Result: Request uses config A semantics
    Failure Indicators: Request behavior changes to config B immediately
    Evidence: .sisyphus/evidence/task-2-config-delay.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-epoch-boundaries.txt
  - [ ] task-2-config-delay.txt

  **Commit**: YES
  - Message: `feat(vault): add deterministic epoch boundary and config delay rules`
  - Files: `contracts/src/libraries/EpochMath.sol`, `contracts/test/EpochMath.t.sol`
  - Pre-commit: `cd contracts && forge test --match-path test/EpochMath.t.sol`

- [x] 3. Implement deposit receipt queue storage model

  **What to do**:
  - Add per-user deposit receipt storage with queued amount and target mint epoch.
  - Store epoch price-per-share/open NAV snapshot fields needed for deterministic mint conversion.
  - Ensure pending deposits are excluded from active epoch share-price calculations.

  **Must NOT do**:
  - Do not mint shares at request time.
  - Do not include pending deposits in current active NAV denominator.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Scoped storage/state wiring in contract core.
  - **Skills**: `[]`
    - none: focused state-model task.
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: no UI changes in this task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with 2,4,5,6)
  - **Blocks**: 7, 8, 13, 14, 16
  - **Blocked By**: 1

  **References**:
  - `contracts/src/SnapshotTrancheVault.sol` - Existing request storage patterns and status fields.
  - `contracts/src/WeeklyEpochVault.sol` - Current request storage and aggregate counters.
  - External: `https://raw.githubusercontent.com/ribbon-finance/ribbon-v2/master/contracts/vaults/BaseVaults/base/RibbonVault.sol` - `depositReceipts` and round PPS mint pattern.
  - `apps/vault-api/src/services/customVaultProvider.ts` - Existing assumption points for immediate vs delayed conversion.

  **Acceptance Criteria**:
  - [ ] Deposit receipts persist queued amount and target mint epoch.
  - [ ] Storage includes epoch open pricing snapshot input for deterministic minting.
  - [ ] Pending deposits are excluded from active epoch PnL sharing.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Deposit request is queued without immediate mint
    Tool: Bash (forge test)
    Preconditions: User has depositable assets and submits request mid-epoch
    Steps:
      1. Submit deposit request
      2. Query user share balance and receipt state
      3. Verify share balance unchanged and receipt populated
    Expected Result: Shares remain unchanged until epoch-open mint finalization
    Failure Indicators: Shares minted immediately at request time
    Evidence: .sisyphus/evidence/task-3-queued-deposit.txt

  Scenario: Pending deposit exclusion prevents dilution
    Tool: Bash (forge test)
    Preconditions: Existing LP and new pending depositor in same epoch
    Steps:
      1. Create pending deposit
      2. Simulate PnL change before mint boundary
      3. Finalize mint and compare LP vs depositor economics
    Expected Result: Pending depositor does not receive pre-mint epoch PnL
    Failure Indicators: Pending depositor captures current-epoch PnL
    Evidence: .sisyphus/evidence/task-3-dilution-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-queued-deposit.txt
  - [ ] task-3-dilution-guard.txt

  **Commit**: YES
  - Message: `feat(vault): add queued deposit receipts with delayed mint storage`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Deposit|test.*Mint"`

- [x] 4. Implement redemption tranche and carry bucket storage model

  **What to do**:
  - Add cohort/tranche structs that freeze redemption exposure at epoch boundary.
  - Add per-user ledger fields: `entitlement`, `accrued`, `claimed`, `carryRemaining`.
  - Add cohort-level aggregates required for pro-rata carry allocation.

  **Must NOT do**:
  - Do not keep only global aggregate claimable counters.
  - Do not allow mutable entitlement after tranche freeze.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core economic storage model with fairness-critical invariants.
  - **Skills**: `[]`
    - none: contract economic model definition task.
  - **Skills Evaluated but Omitted**:
    - `dev-browser`: not needed for on-chain storage architecture.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with 2,3,5,6)
  - **Blocks**: 9, 10, 11, 12, 14, 15
  - **Blocked By**: 1

  **References**:
  - `contracts/src/SnapshotTrancheVault.sol` - Existing frozen position and claim state data shapes.
  - `apps/vault-api/src/repositories/entitlementRepository.ts` - Existing entitlement lifecycle expectations.
  - `apps/vault-api/src/repositories/realizationRepository.ts` - Realization aggregation model to align with.
  - `apps/vault-api/src/repositories/payoutRepository.ts` - Claim payout recording shape.

  **Acceptance Criteria**:
  - [ ] Tranche freeze records immutable entitlement basis.
  - [ ] Per-user accrued/claimed/carry remaining can be derived without ambiguity.
  - [ ] Cohort aggregates support deterministic pro-rata carry math.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Tranche freeze locks entitlement basis
    Tool: Bash (forge test)
    Preconditions: Multiple redeemers queued in same epoch
    Steps:
      1. Freeze epoch into tranche
      2. Record entitlement snapshots
      3. Attempt mutation path and re-read snapshot
    Expected Result: Entitlement basis remains immutable after freeze
    Failure Indicators: Entitlement basis changes post-freeze
    Evidence: .sisyphus/evidence/task-4-tranche-freeze.txt

  Scenario: Ledger fields reconcile without loss
    Tool: Bash (forge test)
    Preconditions: Partial payouts across multiple carry updates
    Steps:
      1. Apply accrual updates and claims over several cycles
      2. Verify `claimed <= accrued <= entitlement`
      3. Verify carry remaining closes to zero only at completion
    Expected Result: Ledger invariants hold for every user
    Failure Indicators: Negative carry or over-claimable states
    Evidence: .sisyphus/evidence/task-4-ledger-invariants.txt
  ```

  **Evidence to Capture:**
  - [ ] task-4-tranche-freeze.txt
  - [ ] task-4-ledger-invariants.txt

  **Commit**: YES
  - Message: `feat(vault): add tranche and carry ledger storage model`
  - Files: `contracts/src/*Vault*.sol`, `apps/vault-api/src/repositories/*.ts`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Tranche|test.*Carry"`

- [x] 5. Add role separation and guardrails for settlement/realization controls

  **What to do**:
  - Separate roles for NAV update, settlement, and realization/force-close operations.
  - Add timelock/delay for sensitive config updates.
  - Enforce emergency pause semantics without blocking legitimate claim-finalization flows.

  **Must NOT do**:
  - Do not allow one hot key to change config and execute settlement in same block.
  - Do not allow force-close without timeout/authorization constraints.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Security-sensitive authorization and governance wiring.
  - **Skills**: `[]`
    - none: contract security policy task.
  - **Skills Evaluated but Omitted**:
    - `react-doctor`: irrelevant for contract role controls.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with 2,3,4,6)
  - **Blocks**: 9, 10, 11, 12, 15, 18
  - **Blocked By**: 1

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - Existing role and emergency patterns to preserve where valid.
  - `contracts/src/SnapshotTrancheVault.sol` - Existing force-close semantics and timeout hooks.
  - `apps/vault-api/src/services/navOracle.ts` - NAV updater operational flow and role assumptions.

  **Acceptance Criteria**:
  - [ ] Distinct roles gate NAV, settlement, and realization operations.
  - [ ] Config changes respect delayed activation policy.
  - [ ] Emergency mode behavior is explicit and tested.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Unauthorized role actions revert
    Tool: Bash (forge test)
    Preconditions: Non-privileged actor calls NAV/settle/realize methods
    Steps:
      1. Execute each restricted method from unauthorized account
      2. Validate expected custom errors/reverts
    Expected Result: All restricted calls revert with correct error type
    Failure Indicators: Any privileged method succeeds for unauthorized actor
    Evidence: .sisyphus/evidence/task-5-role-guards.txt

  Scenario: Delayed config activation prevents same-cycle gaming
    Tool: Bash (forge test)
    Preconditions: Requests queued before config update
    Steps:
      1. Queue requests under old config
      2. Schedule and apply config update
      3. Verify old requests process under prior config until activation epoch
    Expected Result: Config change takes effect only after delay period
    Failure Indicators: Existing requests use newly changed config immediately
    Evidence: .sisyphus/evidence/task-5-config-activation.txt
  ```

  **Evidence to Capture:**
  - [ ] task-5-role-guards.txt
  - [ ] task-5-config-activation.txt

  **Commit**: YES
  - Message: `feat(vault): harden roles and delayed config governance`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Role|test.*Config"`

- [x] 6. Standardize events, errors, and ABI compatibility mappings

  **What to do**:
  - Define event/error set for queued deposit, mint finalization, tranche freeze, carry accrual, threshold eligibility, and claim execution.
  - Update backend event parsing assumptions to new signatures.
  - Add explicit deprecation markers for old weekly-aggregate events.

  **Must NOT do**:
  - Do not emit ambiguous events that cannot reconstruct lifecycle.
  - Do not break backend parser assumptions without mapping updates.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: ABI/event alignment task across limited files.
  - **Skills**: `[]`
    - none: focused compatibility mapping.
  - **Skills Evaluated but Omitted**:
    - `playwright`: no browser dependency.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with 2,3,4,5)
  - **Blocks**: 13, 15, 16, 17
  - **Blocked By**: 1

  **References**:
  - `apps/vault-api/src/services/customVaultClient.ts` - Existing hardcoded event topic parsing and method expectations.
  - `contracts/src/WeeklyEpochVault.sol` - Existing event naming used in integration.
  - `apps/vault-api/src/__tests__/customVaultClient.test.ts` - Parser and ABI compatibility tests.

  **Acceptance Criteria**:
  - [ ] Event set can reconstruct full lifecycle from chain logs.
  - [ ] Backend client parser handles all new events and deprecated mappings.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Event stream reconstructs lifecycle deterministically
    Tool: Bash (forge test)
    Preconditions: Full deposit->mint->redeem->freeze->accrue->claim flow executed in test
    Steps:
      1. Emit full lifecycle events through test execution
      2. Decode and order events by tx/log index
      3. Rebuild request/cohort state from events only
    Expected Result: Reconstructed state matches direct storage reads
    Failure Indicators: Missing or ambiguous event fields
    Evidence: .sisyphus/evidence/task-6-event-reconstruction.txt

  Scenario: Backend parser remains synchronized with ABI
    Tool: Bash (vitest)
    Preconditions: Updated ABI and event-topic parser in client
    Steps:
      1. Run `pnpm --filter vault test -- customVaultClient`
      2. Verify parser tests include new event signatures
    Expected Result: Parser tests pass with updated signatures
    Failure Indicators: Unknown event topics or decode mismatch
    Evidence: .sisyphus/evidence/task-6-client-parser.txt
  ```

  **Evidence to Capture:**
  - [ ] task-6-event-reconstruction.txt
  - [ ] task-6-client-parser.txt

  **Commit**: YES
  - Message: `chore(vault): align events and client ABI compatibility`
  - Files: `contracts/src/*Vault*.sol`, `apps/vault-api/src/services/customVaultClient.ts`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Event" && pnpm --filter vault test -- customVaultClient`

- [x] 7. Implement deposit request queue write path

  **What to do**:
  - Add deposit request method that accepts funds and stores receipt for next epoch mint.
  - Support receipt accumulation for repeated same-epoch deposits by same user.
  - Emit queued-deposit event with target epoch and amount.

  **Must NOT do**:
  - Do not mint shares in this method.
  - Do not overwrite prior same-epoch receipt accumulation.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: User-funds write path with accounting implications.
  - **Skills**: `[]`
    - none: contract state-machine change.
  - **Skills Evaluated but Omitted**:
    - `git-master`: not required for implementation logic.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with 8,9,10,11,12)
  - **Blocks**: 8, 13, 17
  - **Blocked By**: 1, 2, 3

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - Existing request flow and input validation patterns.
  - `contracts/src/SnapshotTrancheVault.sol` - Existing request lifecycle states.
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - API payload expectations for redemption-style operations.

  **Acceptance Criteria**:
  - [ ] Deposit requests are persisted for next-epoch minting.
  - [ ] Repeated deposits in same epoch accumulate in one receipt.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Repeated same-epoch deposits accumulate correctly
    Tool: Bash (forge test)
    Preconditions: User submits multiple deposits before epoch boundary
    Steps:
      1. Submit deposit A then deposit B in same epoch
      2. Read receipt state
      3. Verify amount equals A+B and target epoch unchanged
    Expected Result: Single aggregated receipt with summed amount
    Failure Indicators: Multiple receipts or overwritten values
    Evidence: .sisyphus/evidence/task-7-receipt-accumulation.txt

  Scenario: Deposit request does not mint early
    Tool: Bash (forge test)
    Preconditions: User has zero shares before request
    Steps:
      1. Submit deposit request
      2. Read share balance before epoch-open mint
    Expected Result: Share balance unchanged until mint finalization
    Failure Indicators: Immediate share balance increase
    Evidence: .sisyphus/evidence/task-7-no-early-mint.txt
  ```

  **Evidence to Capture:**
  - [ ] task-7-receipt-accumulation.txt
  - [ ] task-7-no-early-mint.txt

  **Commit**: YES
  - Message: `feat(vault): queue deposits for next epoch mint`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*DepositQueue"`

- [x] 8. Implement epoch-open mint finalization from queued receipts

  **What to do**:
  - Implement mint-finalization function at epoch open using stored open NAV/PPS.
  - Convert queued deposit amounts to shares deterministically at open price.
  - Mark receipts consumed and prevent double-minting.

  **Must NOT do**:
  - Do not use request-time price for mint conversion.
  - Do not allow mint finalization before epoch-open boundary.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Pricing conversion correctness is economic-critical.
  - **Skills**: `[]`
    - none: fixed-point math + lifecycle transition task.
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: no UI concern.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 10, 11, 12, 13, 17
  - **Blocked By**: 2, 3, 7

  **References**:
  - `contracts/src/libraries/EpochMath.sol` - Boundary checks for epoch-open mint.
  - `apps/vault-api/src/services/navOracle.ts` - NAV publication and freshness data source.
  - External: `https://raw.githubusercontent.com/ribbon-finance/ribbon-v2/master/contracts/vaults/BaseVaults/base/RibbonVault.sol` - delayed mint via round PPS.

  **Acceptance Criteria**:
  - [ ] Queued receipts mint exactly once at epoch-open pricing.
  - [ ] Mint conversion is reproducible from stored pricing snapshot.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Mint executes at open price, not request price
    Tool: Bash (forge test)
    Preconditions: NAV changes between request and epoch open
    Steps:
      1. Queue deposit at NAV A
      2. Update NAV to B before epoch open
      3. Finalize mint at epoch open
      4. Verify shares minted against NAV B
    Expected Result: Shares match open NAV conversion
    Failure Indicators: Shares match stale/request NAV
    Evidence: .sisyphus/evidence/task-8-open-price-mint.txt

  Scenario: Double finalization is impossible
    Tool: Bash (forge test)
    Preconditions: Receipt already finalized once
    Steps:
      1. Call finalization again for same receipt
    Expected Result: Second call no-ops or reverts deterministically
    Failure Indicators: Additional shares minted on repeat call
    Evidence: .sisyphus/evidence/task-8-double-mint-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] task-8-open-price-mint.txt
  - [ ] task-8-double-mint-guard.txt

  **Commit**: YES
  - Message: `feat(vault): finalize queued mints at epoch open pricing`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*MintFinalize"`

- [x] 9. Implement redemption queue and epoch-close tranche freeze

  **What to do**:
  - Queue redemption requests during epoch and assign them to cohort freeze at boundary.
  - Freeze cohort state at epoch close and lock entitlement basis inputs.
  - Prevent post-freeze cancellation/edit for frozen requests.

  **Must NOT do**:
  - Do not keep redemption requests mutable after freeze boundary.
  - Do not blend multiple cohorts into one mutable aggregate request.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core fairness transition from pending -> frozen.
  - **Skills**: `[]`
    - none: contract lifecycle transition task.
  - **Skills Evaluated but Omitted**:
    - `playwright`: not needed.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 10, 11, 12, 14, 15, 17
  - **Blocked By**: 1, 2, 4, 5, 7

  **References**:
  - `contracts/src/SnapshotTrancheVault.sol` - Existing freeze and request status transition semantics.
  - `contracts/src/WeeklyEpochVault.sol` - Existing redemption request validation patterns.
  - `apps/vault-api/src/services/claimStateMachine.ts` - State labels requiring migration to frozen lifecycle.

  **Acceptance Criteria**:
  - [ ] Pending requests enter correct cohort and freeze at boundary.
  - [ ] Frozen requests cannot be canceled or mutated.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Epoch-close freeze locks cohort requests
    Tool: Bash (forge test)
    Preconditions: Multiple pending redemption requests in active epoch
    Steps:
      1. Advance to epoch-close boundary
      2. Execute freeze
      3. Verify all requests moved to frozen cohort state
    Expected Result: Cohort freeze completes with immutable frozen set
    Failure Indicators: Requests remain pending or mutable
    Evidence: .sisyphus/evidence/task-9-freeze-transition.txt

  Scenario: Post-freeze cancel is rejected
    Tool: Bash (forge test)
    Preconditions: Request already frozen
    Steps:
      1. Attempt cancel/edit operation after freeze
    Expected Result: Operation reverts with deterministic error
    Failure Indicators: Frozen request can be canceled/edited
    Evidence: .sisyphus/evidence/task-9-post-freeze-guard.txt
  ```

  **Evidence to Capture:**
  - [ ] task-9-freeze-transition.txt
  - [ ] task-9-post-freeze-guard.txt

  **Commit**: YES
  - Message: `feat(vault): freeze redemption cohorts at epoch close`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Freeze|test.*RedeemQueue"`

- [x] 10. Implement balanced upfront settlement and pro-rata allocation

  **What to do**:
  - At settlement, compute upfront payable amount per cohort using configured balanced policy.
  - Apply pro-rata distribution when available liquidity is insufficient.
  - Persist remaining obligation as carry for future accrual.

  **Must NOT do**:
  - Do not allocate beyond available liquid assets.
  - Do not apply non-deterministic or address-order-dependent payout math.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: High-stakes economic math and fairness invariants.
  - **Skills**: `[]`
    - none: economics-heavy algorithmic task.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: outside settlement logic scope.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 11, 12, 13, 14, 15, 17
  - **Blocked By**: 1, 2, 4, 5, 7, 8, 9

  **References**:
  - `contracts/src/WeeklyEpochVault.sol` - Current pro-rata calculation and chunking baseline.
  - `apps/vault-api/src/services/liquidityManager.ts` - Settlement readiness and available-assets operational flow.
  - External: `https://raw.githubusercontent.com/maple-labs/withdrawal-manager-cyclical/main/contracts/MapleWithdrawalManager.sol` - pro-rata under insufficient liquidity.

  **Acceptance Criteria**:
  - [ ] Upfront payouts never exceed available liquid assets.
  - [ ] Pro-rata math is deterministic and invariant-tested.
  - [ ] Carry remainder is recorded for each user/cohort.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Insufficient liquidity triggers deterministic pro-rata
    Tool: Bash (forge test)
    Preconditions: Cohort obligations > available liquidity
    Steps:
      1. Set obligations and constrained liquidity
      2. Run settlement
      3. Verify each user payout ratio is equal and bounded
    Expected Result: Equal pro-rata ratios and correct carry remainder
    Failure Indicators: Unequal ratios or over-allocation
    Evidence: .sisyphus/evidence/task-10-pro-rata-settlement.txt

  Scenario: Settlement cannot overdraw cash pool
    Tool: Bash (forge test)
    Preconditions: Settlement run with low liquid assets
    Steps:
      1. Execute settlement
      2. Compare transferred amount vs available assets snapshot
    Expected Result: Total transfers <= available assets
    Failure Indicators: Transfer total exceeds available liquidity
    Evidence: .sisyphus/evidence/task-10-cash-bound.txt
  ```

  **Evidence to Capture:**
  - [ ] task-10-pro-rata-settlement.txt
  - [ ] task-10-cash-bound.txt

  **Commit**: YES
  - Message: `feat(vault): add balanced upfront and pro-rata settlement`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*ProRata|test.*Settlement"`

- [x] 11. Implement realization ingestion and automatic carry accrual

  **What to do**:
  - Add realization update flow that credits tranche carry pools as positions resolve.
  - Auto-allocate realized amounts pro-rata to user `accrued` balances.
  - Support chunked processing to avoid gas exhaustion on large cohorts.

  **Must NOT do**:
  - Do not require manual per-user payout writes in one unbounded loop.
  - Do not blend carry from unrelated cohorts.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Multi-epoch accounting and gas-safe processing design.
  - **Skills**: `[]`
    - none: contract + accounting logic.
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: not relevant.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 12, 13, 14, 15, 17
  - **Blocked By**: 1, 4, 5, 8, 9, 10

  **References**:
  - `contracts/src/SnapshotTrancheVault.sol` - Existing realization and force-close semantics.
  - `apps/vault-api/src/repositories/realizationRepository.ts` - Realization event persistence expectations.
  - `apps/vault-api/src/services/navOracle.ts` - Position resolution trigger pathways.

  **Acceptance Criteria**:
  - [ ] Realization updates increase cohort carry pools and user accrued values deterministically.
  - [ ] Processing supports bounded chunk sizes with continuation pointers.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Realization credits carry accrual pro-rata
    Tool: Bash (forge test)
    Preconditions: Frozen cohort with non-zero carry remaining
    Steps:
      1. Submit realization amount to cohort
      2. Run accrual update
      3. Verify each user's accrued increment by cohort ratio
    Expected Result: Accrued increments are pro-rata and sum to credited amount (within rounding policy)
    Failure Indicators: Non-pro-rata accrual or value leakage
    Evidence: .sisyphus/evidence/task-11-accrual.txt

  Scenario: Chunked accrual handles large cohorts safely
    Tool: Bash (forge test)
    Preconditions: Cohort with > chunk size users
    Steps:
      1. Process accrual in multiple chunks
      2. Verify continuation index progression and final completion
    Expected Result: Full accrual completes without gas blowup
    Failure Indicators: Unbounded loop or inconsistent chunk continuation
    Evidence: .sisyphus/evidence/task-11-chunking.txt
  ```

  **Evidence to Capture:**
  - [ ] task-11-accrual.txt
  - [ ] task-11-chunking.txt

  **Commit**: YES
  - Message: `feat(vault): add realization-driven carry accrual`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Carry|test.*Realization"`

- [x] 12. Implement threshold-gated claim and final dust override

  **What to do**:
  - Add claim eligibility check: user claimable only when `accrued - claimed >= minClaimThreshold`.
  - Support final tranche closure override so residual dust is claimable below threshold.
  - Implement claim-all semantics (no user-input partial micromanagement).

  **Must NOT do**:
  - Do not trap residual balances forever below threshold.
  - Do not allow partial-amount claim API that encourages micro-claims.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: UX-policy encoded in contract accounting path.
  - **Skills**: `[]`
    - none: accounting eligibility logic task.
  - **Skills Evaluated but Omitted**:
    - `dev-browser`: non-browser task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: 13, 14, 15, 16, 17
  - **Blocked By**: 1, 4, 5, 8, 9, 10, 11

  **References**:
  - `apps/vault-api/src/repositories/payoutRepository.ts` - Claim persistence and status transitions.
  - `apps/vault-api/src/services/claimStateMachine.ts` - Claim eligibility guards requiring lifecycle update.
  - `apps/vault-web/src/lib/hooks.ts` - Frontend eligibility signaling expectations.

  **Acceptance Criteria**:
  - [ ] Claims execute only when threshold met, except final-dust tranche closure path.
  - [ ] Claim-all consumes full available amount and updates ledger deterministically.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Threshold blocks micro-claims until eligible
    Tool: Bash (forge test)
    Preconditions: User has claimable below threshold
    Steps:
      1. Attempt claim before threshold
      2. Credit additional accrual above threshold
      3. Attempt claim again
    Expected Result: First claim blocked, second claim succeeds
    Failure Indicators: Micro-claim succeeds below threshold
    Evidence: .sisyphus/evidence/task-12-threshold-gate.txt

  Scenario: Final dust can be claimed at tranche close
    Tool: Bash (forge test)
    Preconditions: Tranche finalized with residual below threshold
    Steps:
      1. Mark tranche closed/finalized
      2. Claim residual amount
    Expected Result: Residual dust claim succeeds despite threshold
    Failure Indicators: Residual remains permanently unclaimable
    Evidence: .sisyphus/evidence/task-12-dust-override.txt
  ```

  **Evidence to Capture:**
  - [ ] task-12-threshold-gate.txt
  - [ ] task-12-dust-override.txt

  **Commit**: YES
  - Message: `feat(vault): enforce threshold-gated claims with dust override`
  - Files: `contracts/src/*Vault*.sol`, `contracts/test/*.t.sol`
  - Pre-commit: `cd contracts && forge test --match-test "test.*Claim|test.*Threshold"`

- [x] 13. Upgrade backend contract client and provider to tranche ABI lifecycle

  **What to do**:
  - Replace weekly-aggregate client calls with tranche lifecycle methods (queue deposit, finalize mint, freeze cohort, accrue carry, claim-all).
  - Update provider orchestration and capability flags for delayed mint and carry semantics.
  - Remove assumptions that `requestId` maps directly to immediate claimable lifecycle.

  **Must NOT do**:
  - Do not keep stale calls to removed weekly methods.
  - Do not return optimistic immediate estimates that bypass queued lifecycle.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused API/ABI adapter changes in backend service layer.
  - **Skills**: `[]`
    - none: backend integration task.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: outside this task.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with 14,15,16,17,18)
  - **Blocks**: 15, 16, 17, 18
  - **Blocked By**: 1, 3, 6, 7, 8, 10, 11, 12

  **References**:
  - `apps/vault-api/src/services/customVaultClient.ts` - ABI read/write wrappers and event decoding.
  - `apps/vault-api/src/services/customVaultProvider.ts` - lifecycle orchestration and eligibility logic.
  - `apps/vault-api/src/__tests__/customVaultClient.test.ts` - regression tests for method behavior.

  **Acceptance Criteria**:
  - [ ] Client/provider compile with new ABI and no references to deprecated methods.
  - [ ] Provider outputs distinguish queued, frozen, accrued, claimable states.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Provider returns queued lifecycle states accurately
    Tool: Bash (vitest)
    Preconditions: Mocked client state includes queued deposit and frozen redemption
    Steps:
      1. Run provider state queries
      2. Validate mapped statuses and amounts
    Expected Result: State mapping reflects delayed mint and carry lifecycle
    Failure Indicators: Legacy pending/settled mapping leaks into responses
    Evidence: .sisyphus/evidence/task-13-provider-states.txt

  Scenario: Removed ABI methods are not called
    Tool: Bash (grep + vitest)
    Preconditions: Backend source updated
    Steps:
      1. Search for deprecated contract method names
      2. Run targeted client tests
    Expected Result: No deprecated method references and tests pass
    Failure Indicators: Calls to removed weekly methods remain
    Evidence: .sisyphus/evidence/task-13-abi-clean.txt
  ```

  **Evidence to Capture:**
  - [ ] task-13-provider-states.txt
  - [ ] task-13-abi-clean.txt

  **Commit**: YES
  - Message: `feat(vault-api): align client/provider with tranche carry abi`
  - Files: `apps/vault-api/src/services/customVaultClient.ts`, `apps/vault-api/src/services/customVaultProvider.ts`
  - Pre-commit: `pnpm --filter vault build && pnpm --filter vault test -- customVaultClient`

- [x] 14. Migrate DB schema, repositories, and claim state machine to cohort-carry lifecycle

  **What to do**:
  - Add schema/repository fields for tranche id, entitlement, accrued, claimed, carry remaining, and finalization markers.
  - Update `epochRepository`, `entitlementRepository`, `realizationRepository`, and `payoutRepository` transitions.
  - Replace legacy status assumptions in claim state machine with frozen/partially_accrued/claimable/closed equivalents.

  **Must NOT do**:
  - Do not keep mixed status vocabularies (`settled` semantics) in same read/write path.
  - Do not write migration/backfill logic for historical deployed data.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-repository consistency and lifecycle correctness.
  - **Skills**: `[]`
    - none: backend persistence/state transition task.
  - **Skills Evaluated but Omitted**:
    - `playwright`: no browser dependency.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 15, 16, 18
  - **Blocked By**: 3, 4, 9, 10, 11, 12

  **References**:
  - `apps/vault-api/src/repositories/epochRepository.ts` - epoch lifecycle persistence.
  - `apps/vault-api/src/repositories/entitlementRepository.ts` - entitlement calculation and status.
  - `apps/vault-api/src/repositories/realizationRepository.ts` - realization events.
  - `apps/vault-api/src/repositories/payoutRepository.ts` - claim payout records.
  - `apps/vault-api/src/services/claimStateMachine.ts` - operation guards and lifecycle mapping.

  **Acceptance Criteria**:
  - [ ] Repository APIs represent tranche-carry lifecycle without legacy ambiguity.
  - [ ] State machine allows only valid operations for each lifecycle state.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Repository writes and reads preserve carry ledger invariants
    Tool: Bash (vitest)
    Preconditions: Test DB configured for repository tests
    Steps:
      1. Insert tranche entitlement and realization events
      2. Execute accrual and claim updates
      3. Verify persisted totals match invariants
    Expected Result: `claimed <= accrued <= entitlement` holds in persisted records
    Failure Indicators: Persisted mismatch or invalid transition accepted
    Evidence: .sisyphus/evidence/task-14-repo-ledger.txt

  Scenario: Invalid lifecycle transitions are rejected
    Tool: Bash (vitest)
    Preconditions: Claim state machine updated with new statuses
    Steps:
      1. Attempt disallowed operations per state
      2. Validate errors/codes
    Expected Result: Disallowed transitions consistently rejected
    Failure Indicators: Forbidden operation succeeds
    Evidence: .sisyphus/evidence/task-14-state-machine.txt
  ```

  **Evidence to Capture:**
  - [ ] task-14-repo-ledger.txt
  - [ ] task-14-state-machine.txt

  **Commit**: YES
  - Message: `feat(vault-api): migrate repositories and state machine to tranche carry lifecycle`
  - Files: `apps/vault-api/src/repositories/*.ts`, `apps/vault-api/src/services/claimStateMachine.ts`
  - Pre-commit: `pnpm --filter vault test -- epochRepository entitlementRepository`

- [x] 15. Update API routes for queued mint, tranche status, and carry claim operations

  **What to do**:
  - Add/modify endpoints for deposit queue submission/status, mint finalization status, tranche progress, and threshold eligibility response fields.
  - Ensure claim/cancel routes enforce new authorization + lifecycle gates.
  - Mark deprecated weekly routes as removed or redirect-only with explicit errors.

  **Must NOT do**:
  - Do not expose claim endpoint that permits micro partial claims.
  - Do not return legacy status strings incompatible with frontend lifecycle rendering.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: API contract evolution across multiple consumers.
  - **Skills**: `[]`
    - none: backend route/controller task.
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: this task is API-only.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 16, 18
  - **Blocked By**: 4, 5, 6, 9, 10, 11, 12, 13, 14

  **References**:
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - primary route surface.
  - `apps/vault-api/src/services/customVaultProvider.ts` - response and operation semantics.
  - `apps/vault-api/src/__tests__/customVaultRoutes.test.ts` - route-level contract tests.

  **Acceptance Criteria**:
  - [ ] Route responses expose lifecycle fields required by UI (`queued`, `frozen`, `accrued`, `eligible`, `threshold`).
  - [ ] Legacy endpoints do not silently mimic old behavior.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: API returns carry eligibility and threshold fields
    Tool: Bash (vitest)
    Preconditions: Route tests with mocked tranche states
    Steps:
      1. Call redemption/tranche status endpoints
      2. Validate `accrued`, `claimed`, `claimableNow`, `minClaimThreshold`
    Expected Result: Responses include complete claim eligibility model
    Failure Indicators: Missing fields or legacy-only status values
    Evidence: .sisyphus/evidence/task-15-route-contract.txt

  Scenario: Deprecated weekly route usage fails explicitly
    Tool: Bash (curl)
    Preconditions: Server running with updated routes
    Steps:
      1. Call deprecated weekly endpoint
      2. Validate explicit deprecation/error message
    Expected Result: Deterministic non-200 response with migration hint
    Failure Indicators: Silent fallback to old semantics
    Evidence: .sisyphus/evidence/task-15-deprecation-path.txt
  ```

  **Evidence to Capture:**
  - [ ] task-15-route-contract.txt
  - [ ] task-15-deprecation-path.txt

  **Commit**: YES
  - Message: `feat(vault-api): ship tranche carry route contract`
  - Files: `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/__tests__/customVaultRoutes.test.ts`
  - Pre-commit: `pnpm --filter vault test -- customVaultRoutes`

- [x] 16. Update frontend data hooks and lifecycle UX states

  **What to do**:
  - Update frontend API client and hooks to represent queued deposits, frozen tranches, accrued carry, threshold eligibility, and final-dust claim state.
  - Add user-facing lifecycle labels and disabled-state rules for claim button when below threshold.
  - Display carry progress and next accrual expectation windows.

  **Must NOT do**:
  - Do not keep UI labels tied to old `pending/settled` semantics.
  - Do not allow claim CTA when backend says ineligible.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Lifecycle UX clarity is required for a complex payout model.
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: improves state presentation and action affordance quality.
  - **Skills Evaluated but Omitted**:
    - `react-doctor`: optional post-change check, not required for implementation itself.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 18
  - **Blocked By**: 3, 6, 12, 13, 15

  **References**:
  - `apps/vault-web/src/lib/api.ts` - API payload contracts.
  - `apps/vault-web/src/lib/hooks.ts` - query/mutation lifecycle orchestration.
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - backend response shape source of truth.

  **Acceptance Criteria**:
  - [ ] UI correctly renders new lifecycle states and eligibility.
  - [ ] Claim controls are disabled when below threshold and enabled on eligibility.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Claim CTA state follows eligibility bucket
    Tool: Playwright
    Preconditions: Mock/API states for below-threshold and eligible users
    Steps:
      1. Open redemption dashboard view
      2. Assert claim button disabled for below-threshold user
      3. Switch to eligible state and assert button enabled
    Expected Result: CTA strictly follows backend eligibility
    Failure Indicators: Button enabled while ineligible or disabled while eligible
    Evidence: .sisyphus/evidence/task-16-claim-cta.png

  Scenario: Lifecycle labels map to new statuses
    Tool: Playwright
    Preconditions: Data fixture includes queued, frozen, accrued, claimable, closed tranches
    Steps:
      1. Render lifecycle table/cards
      2. Verify each status label/text and carry progress values
    Expected Result: No legacy labels; all new states mapped correctly
    Failure Indicators: Old terminology or missing states
    Evidence: .sisyphus/evidence/task-16-lifecycle-labels.png
  ```

  **Evidence to Capture:**
  - [ ] task-16-claim-cta.png
  - [ ] task-16-lifecycle-labels.png

  **Commit**: YES
  - Message: `feat(vault-web): render tranche carry lifecycle and claim eligibility`
  - Files: `apps/vault-web/src/lib/api.ts`, `apps/vault-web/src/lib/hooks.ts`
  - Pre-commit: `pnpm --filter vault-web build`

- [ ] 17. Add contract and backend invariants for fairness, carry, and anti-gaming

  **What to do**:
  - Add Foundry tests for boundary fairness, post-boundary P/L attribution, pro-rata carry conservation, threshold behavior, and role abuse paths.
  - Add backend Vitest cases for repository transition correctness and API payload consistency.
  - Ensure stress tests for large cohorts use chunking and preserve deterministic totals.

  **Must NOT do**:
  - Do not ship with only happy-path tests.
  - Do not skip anti-gaming boundary tests at exact cutoff seconds.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Invariant-driven validation across contract and backend.
  - **Skills**: `[]`
    - none: multi-layer test engineering task.
  - **Skills Evaluated but Omitted**:
    - `frontend-design`: test/invariant focus, not UI buildout.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 18
  - **Blocked By**: 6, 7, 8, 9, 10, 11, 12, 13, 14, 15

  **References**:
  - `contracts/test/WeeklyEpochVault.erc7540.t.sol` - existing test style and harness.
  - `contracts/test/WeeklyEpochVault.extensions.t.sol` - extension testing patterns.
  - `apps/vault-api/src/__tests__/erc7540-compliance.test.ts` - backend compliance baseline.
  - `apps/vault-api/src/__tests__/epochRepository.test.ts` - repository transition patterns.

  **Acceptance Criteria**:
  - [ ] Contract tests include both happy and failure paths for every new lifecycle transition.
  - [ ] Backend tests validate payload and transition semantics for new statuses.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Fairness invariant holds after post-boundary losses
    Tool: Bash (forge test)
    Preconditions: Cohort frozen, then simulated loss event occurs
    Steps:
      1. Freeze cohort at boundary
      2. Apply adverse realization
      3. Validate cohort payout adjusts while non-cohort LP accounting remains isolated
    Expected Result: Loss attribution remains cohort-consistent
    Failure Indicators: Loss leakage to unrelated cohorts or users
    Evidence: .sisyphus/evidence/task-17-fairness-invariant.txt

  Scenario: Carry conservation invariant holds across accrual+claims
    Tool: Bash (forge test + vitest)
    Preconditions: Multi-cycle accrual and claims across users
    Steps:
      1. Execute accruals and claims over several epochs
      2. Verify total paid + remaining carry = total realized allocation (rounding-bounded)
    Expected Result: Conservation invariant holds
    Failure Indicators: Value creation/loss beyond rounding policy
    Evidence: .sisyphus/evidence/task-17-carry-conservation.txt
  ```

  **Evidence to Capture:**
  - [ ] task-17-fairness-invariant.txt
  - [ ] task-17-carry-conservation.txt

  **Commit**: YES
  - Message: `test(vault): add tranche carry fairness and conservation invariants`
  - Files: `contracts/test/*.t.sol`, `apps/vault-api/src/__tests__/*.test.ts`
  - Pre-commit: `cd contracts && forge test && pnpm --filter vault test`

- [x] 18. Final integration cleanup, docs, and operational runbook

  **What to do**:
  - Remove or disable obsolete weekly-aggregate flow references in API/service docs and runtime checks.
  - Update vault operational runbook for epoch schedule, realization cadence, threshold policy, and emergency handling.
  - Produce end-to-end evidence bundle validating full lifecycle with carry completion.

  **Must NOT do**:
  - Do not leave contradictory docs for old vs new lifecycle.
  - Do not declare completion without evidence for multi-epoch carry scenario.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Cross-system documentation and operational clarity.
  - **Skills**: [`playwright`]
    - `playwright`: capture UI lifecycle evidence for runbook validation.
  - **Skills Evaluated but Omitted**:
    - `git-master`: commit strategy handled separately.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (finalizer)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: 5, 13, 14, 15, 16, 17

  **References**:
  - `VAULT_KNOWLEDGE.md` - architecture and operations documentation baseline.
  - `apps/vault-api/src/routes/customVaultRoutes.ts` - authoritative endpoint behavior.
  - `apps/vault-web/src/lib/hooks.ts` - lifecycle rendering and action availability.
  - `.sisyphus/evidence/` - required output location for final artifacts.

  **Acceptance Criteria**:
  - [ ] Operational docs describe new lifecycle unambiguously.
  - [ ] End-to-end evidence covers deposit queue -> mint -> freeze -> carry accrual -> threshold claim -> final dust claim.

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: End-to-end multi-epoch carry lifecycle succeeds
    Tool: Bash + Playwright
    Preconditions: Local environment seeded with test users and epochs
    Steps:
      1. Queue deposit and redemption requests
      2. Advance through mint/freeze/settlement/accrual cycles
      3. Perform threshold-gated claim then final dust claim
      4. Capture backend logs and UI evidence
    Expected Result: Full lifecycle completes with consistent ledger values
    Failure Indicators: Lifecycle dead-end, claim mismatch, or stale status displays
    Evidence: .sisyphus/evidence/task-18-e2e-lifecycle.txt

  Scenario: Deprecated weekly flow is not operational
    Tool: Bash (grep + curl)
    Preconditions: Updated API service deployed locally
    Steps:
      1. Search source for old lifecycle route markers
      2. Call deprecated endpoints and verify explicit failure/deprecation response
    Expected Result: Old flow unavailable and clearly signaled
    Failure Indicators: Deprecated flow still active silently
    Evidence: .sisyphus/evidence/task-18-deprecation-verification.txt
  ```

  **Evidence to Capture:**
  - [ ] task-18-e2e-lifecycle.txt
  - [ ] task-18-deprecation-verification.txt

  **Commit**: YES
  - Message: `docs(vault): finalize tranche carry runbook and deprecate weekly flow`
  - Files: `VAULT_KNOWLEDGE.md`, `apps/vault-api/src/routes/customVaultRoutes.ts`, `.sisyphus/evidence/*`
  - Pre-commit: `pnpm --filter vault build && pnpm --filter vault-web build`

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Validate all Must Have/Must NOT Have items against implementation and evidence files.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run build/lint/test commands; flag unsafe casts, empty catches, dead code, and missing error handling.
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N/N] | VERDICT`

- [ ] F3. **Real QA Replay** — `unspecified-high` (+ `playwright` where UI needed)
      Execute each task QA scenario and ensure evidence files exist and match expected results.
      Output: `Scenarios [N/N] | Integration [PASS/FAIL] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      Compare actual diff to planned scope and guardrails; detect unplanned changes.
      Output: `Tasks [N/N compliant] | Scope Creep [none/issues] | VERDICT`

---

## Commit Strategy

- Wave 1 foundation: `feat(vault): scaffold epoch tranche architecture`
- Wave 2 mechanics: `feat(vault): implement queued mint and carry settlement lifecycle`
- Wave 3 integration: `feat(vault-platform): align api, db, and ui to tranche carry model`
- Final hardening: `test(vault): add fairness invariants and carry lifecycle coverage`

---

## Success Criteria

### Verification Commands

```bash
cd contracts && forge test
pnpm --filter vault build && pnpm --filter vault test
pnpm --filter vault-web build
```

### Final Checklist

- [ ] Deposits queue and mint only at next epoch start
- [ ] Redemption cohorts freeze at boundary and remain cohort-fair through realization
- [ ] Carry accrues automatically and claims respect threshold + final dust override
- [ ] Pro-rata behavior under low liquidity is deterministic and tested
- [ ] No deprecated weekly-aggregate paths remain active
