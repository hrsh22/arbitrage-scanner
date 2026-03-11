# ERC-7540 Rewrite Issues and Technical Debt

## Date: 2026-03-03

## Task: T2 - Contract Storage Design

---

## Identified Issues

### ISSUE-001: Status Value Collision Risk

**Problem**: Old Claimed status = 3, New Claimed status = 2. If any code relies on numeric comparisons, it will break.

**Risk Level**: HIGH

**Affected Files**:

- `customVaultProvider.ts` (lines 352, 357, 409-410, 419-420, 429-430)
- `customVaultClient.ts` (need to verify)
- Database enum values

**Mitigation**:

- Use named mapping function only
- Never compare raw status integers
- Add validation tests

**Status**: ⚠️ Documented for T3, T4

---

### ISSUE-002: Cancelled Status Removal

**Problem**: Current API and DB have "cancelled" as a terminal state. New model removes cancelled requests entirely.

**Risk Level**: MEDIUM

**Impact**:

- Historical cancelled requests become "not found"
- State machine in `claimStateMachine.ts` has cancelled paths
- UI may expect cancelled status display

**Mitigation**:

- Archive cancelled requests before migration
- Update state machine to handle absence as cancelled
- Update UI to show "Cancelled" when request not found but history exists

**Status**: ⚠️ Documented for T3, T4, T10

---

### ISSUE-003: Controller Iteration for Settlement

**Problem**: New model uses `epochPendingControllers` array for settlement iteration. With many controllers, this could hit gas limits.

**Risk Level**: MEDIUM

**Current Limit**: MAX_CHUNK_SIZE = 100 (from existing code)

**Gas Calculation**:

- Per controller: ~30k gas (SLOAD + computation + SSTORE)
- 100 controllers: ~3M gas
- Block gas limit (Polygon): 30M
- Safe margin: 10 controllers per chunk

**Recommendation**: Reduce MAX_CHUNK_SIZE to 10-20 for safety.

**Status**: 📋 For T6 implementation

---

### ISSUE-004: Request Accumulation Edge Case

**Problem**: If controller has pending request and submits another, we accumulate shares. But what if second request has different `owner`?

**Example**:

1. Controller A requests 100 shares for Owner X
2. Controller A requests 50 shares for Owner Y

**Options**:

1. Reject - must be same owner
2. Accumulate shares, keep first owner
3. Create separate request (non-zero requestId)

**Decision Needed**: Option 1 (reject) for simplicity and ERC-7540 compliance.

**Status**: ⚠️ Documented for T6

---

### ISSUE-005: totalAssets Accuracy

**Problem**: `totalAssets()` excludes pending redemptions but uses current NAV. If NAV changes between request and settlement, exclusion amount is inaccurate.

**Example**:

- Request: 100 shares @ NAV 1.00 = $100 excluded
- Settlement: NAV 1.10 = $110 should be excluded

**Impact**: Minor - NAV changes are typically small (<1% per day)

**Options**:

1. Use request-time NAV (requires storing NAV per request)
2. Accept approximation (current approach)
3. Recalculate on every NAV update (expensive)

**Recommendation**: Option 2 - accept approximation for gas savings.

**Status**: 📋 Documented

---

### ISSUE-006: Extension Storage Overhead

**Problem**: Separate extension mappings add 2-3 storage slots per request.

**Gas Cost**:

- Base request: ~5 storage slots
- Extension metadata: ~3 storage slots
- Total: ~8 slots = 8 \* 20k = 160k gas for cold writes

**Mitigation**:

- Accept overhead for clarity
- Warm reads are cheap (100 gas)

**Status**: ✅ Accepted trade-off

---

## Technical Debt

### DEBT-001: Legacy Status References

**Location**: Multiple files reference old status values

**Files to Update**:

- `vaultProvider.ts` - `RequestStatus` type (lines 61-66)
- `types.ts` - `EpochRequestStatus` type (line 307)
- `schema.ts` - `epochRequestStatusEnum` (lines 229-234)
- `claimStateMachine.ts` - State transitions (lines 43-49, 384-389)

**Effort**: Medium - requires DB migration

**Status**: 📋 For T3

---

### DEBT-002: Request ID Usage

**Problem**: Current code uses requestId as primary lookup key. New model uses controller.

**Files to Update**:

- `customVaultClient.ts` - All request functions
- `customVaultProvider.ts` - `getRequestStatus`, `getUserRequests`
- `customVaultRoutes.ts` - Route handlers
- Database schema - `requestId` as primary key

**Changes Needed**:

1. Add `controller` column to DB
2. Update primary key to `(vaultAddress, controller, epochId)`
3. Update all queries

**Effort**: High - touches many files

**Status**: 📋 For T9, T10

---

### DEBT-003: Event Compatibility

**Problem**: New contract events may have different signatures.

**Old Events**:

```solidity
event RequestCreated(uint256 indexed requestId, address indexed user, uint256 shares, uint256 targetEpoch);
```

**New Events** (ERC-7540):

```solidity
event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares);
```

**Impact**: Event indexers, subgraphs, off-chain services need updates.

**Status**: 📋 For T6, T9

---

### DEBT-004: Operator Model Backwards Compatibility

**Problem**: Current code assumes msg.sender is always the owner.

**Files to Update**:

- All authorization checks in contract
- API route handlers for actor identification
- Frontend wallet connection logic

**Effort**: Medium

**Status**: 📋 For T7, T10, T11

---

## Blockers for Downstream Tasks

| Issue     | Blocks  | Resolution Required          |
| --------- | ------- | ---------------------------- |
| ISSUE-001 | T3, T4  | Document status mapping      |
| ISSUE-002 | T3, T10 | Design cancellation flow     |
| ISSUE-003 | T6, T12 | Determine chunk size         |
| ISSUE-004 | T6, T7  | Decide accumulation behavior |
| DEBT-001  | T3      | Update all type definitions  |
| DEBT-002  | T9, T10 | Design DB schema changes     |

---

## Open Questions

1. **Should we support requestId != 0 for non-aggregated mode?**
   - Not ERC-7540 compliant
   - Could be extension
   - Decision: No, stick to standard

2. **How to handle operator revocation during pending state?**
   - Current approach: Check at action time
   - Alternative: Emit event, freeze request
   - Decision: Check at action time (simpler)

3. **Should claimable requests expire?**
   - ERC-7540 doesn't specify
   - Could add expiration extension
   - Decision: No expiration for now

---

## Risk Register

| Risk                     | Probability | Impact   | Mitigation                            |
| ------------------------ | ----------- | -------- | ------------------------------------- |
| Status mapping bugs      | Medium      | High     | Comprehensive tests, explicit mapping |
| Gas limit on settlement  | Medium      | High     | Chunked processing, limit chunk size  |
| Operator auth bypass     | Low         | Critical | Security audit, extensive tests       |
| totalAssets manipulation | Low         | Medium   | Validate NAV freshness                |
| Event indexing failures  | Medium      | Medium   | Dual-run period, monitoring           |
