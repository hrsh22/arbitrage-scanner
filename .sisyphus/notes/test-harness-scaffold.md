# Test Harness Scaffold Documentation

## Created: 2026-03-03

This document records the compliance-first test harness scaffold created for the ERC-7540 rewrite.

---

## Files Created

### 1. Contract Compliance Tests

**Path:** `contracts/test/WeeklyEpochVault.erc7540.t.sol`

**Purpose:** Solidity test suite for ERC-7540 compliance verification at the contract layer.

**Test Categories:**

- **Interface ID Tests (5 tests):** Verifies ERC-165 support for interface IDs
  - `0x620ee8e4` - IERC7540_REDEEM_INTERFACE_ID
  - `0xe3bc4e65` - IERC7540_CANCEL_INTERFACE_ID
  - `0x2f0a18c5` - IERC7540_CLAIM_INTERFACE_ID
  - `0x01ffc9a7` - IERC165_INTERFACE_ID
  - Unsupported interface rejection

- **Operator Model Tests (8 tests):** Verifies setOperator/isOperator semantics
  - setOperator grants permission and emits OperatorSet event
  - setOperator can revoke permission
  - isOperator returns false for non-operators
  - Operator can requestRedeem on behalf of controller
  - Operator can cancelRedeemRequest on behalf of controller
  - Operator can claimRedeemRequest on behalf of controller
  - Non-operator cannot act on behalf of controller
  - Operator permissions are controller-specific

- **Async Preview Override Tests (6 tests):** Verifies preview function behavior
  - previewRedeem reverts before claimable state
  - previewWithdraw reverts before claimable state
  - previewRedeem succeeds after claimable state
  - previewWithdraw succeeds after claimable state
  - previewRedeem returns 0 for claimed request

- **Lifecycle Transition Tests (11 tests):** Verifies Pending → Claimable → Claimed
  - Full lifecycle flow
  - pendingRedeemRequest returns correct shares (pending)
  - claimableRedeemRequest returns 0 (pending)
  - claimableRedeemRequest returns correct amount (after settlement)
  - pendingRedeemRequest returns 0 (after settlement)
  - Both return 0 (after claim)
  - RedeemRequest event on request
  - RedeemRequestCanceled event on cancel
  - RedeemClaimed event on claim
  - Cannot claim same request twice
  - Cancel transitions to cancelled state

- **Controller/Receiver Separation (2 tests):** Verifies asset routing
  - Receiver can differ from controller
  - Operator with different receiver than controller

- **Extension Boundary Tests (2 tests):** Verifies extension layer doesn't break compliance
  - Epoch-based settlement with ERC-7540 lifecycle
  - Pro-rata settlement with ERC-7540 claimable views

**Implementation Timeline:**

- T6: Lifecycle tests (requestRedeem, claimRedeemRequest, events)
- T7: Operator tests (setOperator, isOperator, permissions)
- T8: Interface ID and preview tests (ERC-165, async overrides)
- T12: Extension boundary tests (epoch/pro-rata integration)
- T13: Edge cases (double-claim, revoked operator)

---

### 2. Backend Compliance Tests

**Path:** `apps/vault-api/src/__tests__/erc7540-compliance.test.ts`

**Purpose:** Vitest test suite for ERC-7540 compliance at the API/provider layer.

**Test Categories:**

- **Operator Permission API (7 tests):**
  - Grant operator via setOperator API with event
  - Revoke operator via setOperator API
  - isOperator API returns correct status
  - Operator can submit requestRedeem on behalf
  - Operator can cancelRedeemRequest on behalf
  - Operator can claimRedeemRequest on behalf
  - Reject unauthorized operator actions
  - Reject operator action for different controller
  - List all operators for a controller

- **Lifecycle State Transitions (11 tests):**
  - Create request with Pending status
  - pendingRedeemRequest returns correct shares
  - claimableRedeemRequest returns 0 for pending
  - Pending → Claimable after settlement
  - Claimable → Claimed after claim
  - Pending → Cancelled via cancel
  - Reject claim for Pending request
  - Reject claim for already Claimed request
  - Reject cancel for Claimable request
  - Reject cancel for Claimed request
  - List all requests with correct statuses

- **Controller/Receiver Separation (3 tests):**
  - Create request with different receiver
  - Assets transferred to receiver on claim
  - Operator can claim to different receiver

- **Async Preview API (3 tests):**
  - Error for previewRedeem on pending
  - Error for previewWithdraw on pending
  - Valid preview after claimable

- **Event Parsing (4 tests):**
  - Parse RedeemRequest event
  - Parse RedeemRequestCanceled event
  - Parse RedeemClaimed event
  - Parse OperatorSet event

- **Extension Layer Integration (3 tests):**
  - Epoch-based settlement with ERC-7540 views
  - Pro-rata reflection in claimableRedeemRequest
  - NAV staleness blocking settlement

**Implementation Timeline:**

- T9: Client/provider tests (event parsing, lifecycle views)
- T10: Route/controller tests (operator API, authorization, validation)
- T12: Extension layer tests (epoch, pro-rata, NAV)

---

### 3. Frontend E2E Compliance Spec

**Path:** `apps/vault-web/e2e/erc7540-lifecycle.spec.ts`

**Purpose:** Playwright E2E tests for ERC-7540 compliance at the UI layer.

**Test Categories:**

- **Pending → Claimable → Claimed Flow (5 tests):**
  - Full redemption lifecycle
  - Pending state with correct details
  - Claimable state with amount display
  - Claimed state in history
  - Pending → Cancelled cancellation flow
  - Lifecycle polling updates

- **Unauthorized Action Rejection (6 tests):**
  - Cannot cancel another user's request
  - Cannot claim another user's request
  - Operator cannot act without authorization
  - Cannot claim before settlement
  - Cannot cancel after settlement
  - Cannot claim already claimed request

- **Operator Flow (2 tests):**
  - Authorized operator can manage controller's requests
  - Operator can specify different receiver

- **Extension Layer UI (3 tests):**
  - Epoch display with target epoch
  - Pro-rata display when applicable
  - NAV staleness warning

**Implementation Timeline:**

- T11: All tests (frontend integration rewrite)

---

## Design Decisions

### 1. Skeleton-First Approach

All tests are initially implemented as skeletons with:

- `assertTrue(false, "SKIPPED: Implement in T[X]")` in Solidity
- `expect(true).toBe(false)` in TypeScript
- `test.skip(true, "SKIPPED")` in Playwright

This ensures:

- Tests compile and type-check immediately
- Test structure serves as acceptance criteria
- Clear mapping of tests to implementation tasks

### 2. Comprehensive Coverage

Each ERC-7540 requirement category has dedicated tests:

- Interface IDs: 5 contract tests
- Operator semantics: 17 total tests (8 contract + 7 API + 2 E2E)
- Async preview: 9 total tests (6 contract + 3 API)
- Lifecycle: 22 total tests (11 contract + 11 API + 5 E2E)

### 3. Cross-Stack Traceability

Tests are organized to mirror each other across layers:

- Contract `testOperatorCanRequestRedeemOnBehalf` ↔ API `should allow operator to submit requestRedeem` ↔ E2E `Operator flow: authorized operator can manage`

### 4. Extension Boundary Clarity

Tests explicitly mark where extension behavior (epoch/pro-rata/NAV):

- Integrates with base ERC-7540 (boundary tests)
- Does not interfere with compliance (lifecycle tests with extensions enabled)

---

## Usage Instructions

### Running Tests (Future State)

```bash
# Contract tests
forge test --match-path test/WeeklyEpochVault.erc7540.t.sol

# Backend tests
pnpm --filter vault exec vitest --run src/__tests__/erc7540-compliance.test.ts

# Frontend E2E tests
pnpm --filter vault-web exec playwright test e2e/erc7540-lifecycle.spec.ts
```

### Current State

All tests will initially fail/skip. They serve as:

1. Acceptance criteria for T6-T13 implementation tasks
2. Compilation/type-checking validation
3. Documentation of expected behavior

---

## Success Criteria

Per T5 acceptance criteria:

- [x] Dedicated compliance suites exist for contract, backend, and frontend
- [x] Each suite contains at least one assertion per ERC-7540 requirement category
- [x] Tests compile without type errors
- [x] Each test documents what it verifies
- [x] Clear mapping to implementation tasks (T6-T13)

---

## References

- ERC-7540 Specification: https://eips.ethereum.org/EIPS/eip-7540
- Plan: `.sisyphus/plans/erc7540-rewrite-plan.md` (T5 section)
- Contract baseline: `contracts/test/WeeklyEpochVault.t.sol`
- API baseline: `apps/vault-api/src/__tests__/customVaultClient.test.ts`
- E2E baseline: `apps/vault-web/e2e/redemption.spec.ts`
