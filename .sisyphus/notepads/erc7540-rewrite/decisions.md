# ERC-7540 Rewrite Decisions

## Date: 2026-03-03

## Task: T2 - Contract Storage Design

---

## Architectural Decisions

### ADR-001: Controller-Aggregated Model

**Decision**: Use `requestId = 0` controller-aggregated model per ERC-7540 specification.

**Rationale**:

- Strict compliance with standard
- Simpler client integration
- Single pending request per controller is sufficient for our use case

**Consequences**:

- Multiple requests from same controller accumulate
- No individual request tracking for pending state
- Simpler queries, more complex accumulation logic

**Rejected Alternatives**:

- Non-zero request IDs with per-request tracking (non-compliant)
- Hybrid model (complex, non-standard)

---

### ADR-002: Extension Metadata Pattern

**Decision**: Store extension metadata (epoch, NAV, pro-rata) in separate mappings with explicit markers.

**Rationale**:

- Clear separation between base ERC-7540 and extensions
- Easier audit and compliance verification
- Allows extensions to be documented/verified independently

**Implementation**:

```solidity
mapping(address => EpochExtension) public pendingRequestExtension;
struct EpochExtension {
    uint256 epochId;
    bool isExtension;  // Marker
}
```

**Consequences**:

- Additional storage reads for extension data
- More mappings to manage
- Clearer code organization

---

### ADR-003: Cancellation as Absence

**Decision**: Implement cancellation as deletion from pending mapping, not status change.

**Rationale**:

- ERC-7540 has no "cancelled" status
- Cleaner state model
- No orphaned cancelled records

**Implementation**:

```solidity
function cancelRedeemRequest(address controller) external {
    delete pendingRedeemRequest[controller];
    delete pendingRequestExtension[controller];
    // ... return shares
}
```

**API Impact**:

- Cancelled requests return "not found" instead of "cancelled" status
- Frontend must handle missing request as cancelled
- DB can soft-delete or archive cancelled requests

---

### ADR-004: Status Enum Values

**Decision**: Use `Pending(0), Claimable(1), Claimed(2)` - removing Cancelled, renaming Settled.

**Rationale**:

- "Claimable" is more descriptive than "Settled"
- Aligns with ERC-7540 `claimableRedeemRequest` function name
- Three states sufficient for lifecycle

**Migration Impact**:
| Old | New | Mapping |
|-----|-----|---------|
| Pending(0) | Pending(0) | Same |
| Cancelled(1) | _removed_ | Absence |
| Settled(2) | Claimable(1) | Renamed + value change |
| Claimed(3) | Claimed(2) | Value change |

---

### ADR-005: totalAssets Exclusion

**Decision**: Exclude pending redemption assets from `totalAssets()` per ERC-7540.

**Rationale**:

- Strict standard compliance
- Pending shares represent reserved assets
- Prevents double-counting in share price calculations

**Implementation**:

```solidity
function totalAssets() public view returns (uint256) {
    return asset.balanceOf(address(this)) - pendingAssetsBackingRedemptions;
}
```

**Note**: Claimable assets ARE included (they're liabilities, not reserves).

---

### ADR-006: Operator Model Implementation

**Decision**: Implement full ERC-7540 operator model with `setOperator` and `isOperator`.

**Rationale**:

- Required for standard compliance
- Enables third-party claim services
- Important for institutional users

**Scope**:

- Operator can `requestRedeem` on behalf of controller
- Operator can `redeem` (claim) on behalf of controller
- Operator can `cancelRedeemRequest` on behalf of controller
- Operator approval is all-or-nothing per controller

---

## Storage Layout Decisions

### Decision: Reserve Slots for Future Extensions

Reserve slots 67-100 for future extensions without storage collision.

**Pattern**:

```solidity
uint256[34] private __gap;  // Slots 67-100 reserved
```

---

## Database Schema Decisions

### Decision: Remove Cancelled from Enum

Remove "cancelled" from `epochRequestStatusEnum` - cancelled requests are deleted.

**Rationale**:

- Matches contract behavior
- Simpler state machine
- No orphaned records

**Migration**:

```sql
-- Archive cancelled requests before migration
INSERT INTO archived_requests SELECT * FROM epoch_requests WHERE status = 'cancelled';
DELETE FROM epoch_requests WHERE status = 'cancelled';

-- Update enum
ALTER TYPE epoch_request_status RENAME TO epoch_request_status_old;
CREATE TYPE epoch_request_status AS ENUM ('pending', 'claimable', 'claimed');

-- Migrate settled -> claimable
UPDATE epoch_requests SET status = 'claimable' WHERE status = 'settled';
```

---

## Rejected Decisions

### Rejected: Keep Cancelled Status

**Reason**: Non-compliant with ERC-7540. Cancellation should remove request.

### Rejected: Support Multiple Pending Requests per Controller

**Reason**: Complicates ERC-7540 compliance. Controller-aggregated model uses single request with accumulation.

### Rejected: Store Full Request History On-Chain

**Reason**: Gas expensive. History belongs off-chain (subgraph, indexer).

### Rejected: Include Extension Data in Base Struct

**Reason**: Blurs line between standard and extension. Makes compliance verification harder.

---

## Decision Log Summary

| ID      | Decision                    | Status      | Blocked By | Blocks     |
| ------- | --------------------------- | ----------- | ---------- | ---------- |
| ADR-001 | Controller-aggregated model | ✅ Approved | -          | T6, T7     |
| ADR-002 | Extension metadata pattern  | ✅ Approved | -          | T6, T12    |
| ADR-003 | Cancellation as absence     | ✅ Approved | -          | T6, T9     |
| ADR-004 | Status enum values          | ✅ Approved | -          | T3, T4, T6 |
| ADR-005 | totalAssets exclusion       | ✅ Approved | -          | T6, T8     |
| ADR-006 | Operator model              | ✅ Approved | -          | T7         |

---

## Migration Strategy Document Created (2025-03-03)

**File**: `.sisyphus/notes/migration-strategy.md`

**Purpose**: Comprehensive deployment, rollback, and coordination guide for T16 (Documentation) and T17 (Release Checklist).

**Key Design Decisions**:

1. **No-Migration Path Respected**: Document assumes clean deployment with no data migration required per plan guardrails.

2. **Phase-Based Deployment**:
   - Phase 0: Pre-deployment gates (mandatory)
   - Phase 1: Contract deployment (immutable, high risk)
   - Phase 2: API deployment (blue/green capable)
   - Phase 3: Web deployment (instant rollback)
   - Phase 4: Integration validation
   - Phase 5: Monitoring handoff

3. **Rollback Hierarchy**:
   - Web: Instant (CDN/Vercel)
   - API: Fast (30s blue/green switch)
   - Contract: Emergency pause first, redeploy only if critical

4. **Contract Immutability Acknowledged**: Since contracts cannot be rolled back, mitigation focuses on:
   - Emergency pause functionality
   - Extensive pre-deployment verification
   - Dry-run mandatory before live deploy

5. **Evidence-Driven Gates**: Each phase requires specific evidence artifacts from T1-T15 completion.

**Sections Included**:
- Deployment phase sequence (5 phases with gates)
- DB migration scripts (minimal - fresh deploy only)
- Environment variable changes (contract, API, web)
- Rollback procedures per component
- Health check commands (contract, API, web, integration)
- Coordination checklist (pre/during/post deployment)
- Risk mitigation matrix with contingencies
- Executable runbook template

**Next Steps for T16/T17**:
- T16: Use Phase 5 (Monitoring Handoff) for runbook updates
- T17: Use Section 4 (Rollback) and Section 6 (Coordination) for release checklist
