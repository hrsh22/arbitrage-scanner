# Backend Types Refactor - ERC-7540 Alignment

## Summary

Completed type-only refactoring to align backend domain types with ERC-7540 lifecycle semantics. Changed redemption request status from legacy terms ("ready", "settled") to ERC-7540 standard ("pending", "claimable", "claimed").

## Files Modified

### 1. `apps/vault-api/src/services/vaultProvider.ts`

- **RequestStatus** type updated:
  - `"pending"` - Awaiting epoch settlement (unchanged)
  - `"claimable"` - Ready for claim (was `"ready"`/`"settled"`)
  - `"claimed"` - Successfully claimed (unchanged)
  - `"cancelled"` - Cancelled by user (deprecated, kept for edge cases)
  - Removed: `"ready"`, `"expired"`
- **RedemptionRequest** interface updated:
  - Added `controller?: Address` - ERC-7540 controller (defaults to user)
  - Added `owner?: Address` - ERC-7540 owner (defaults to user)
  - Added `operator?: Address` - Authorized operator
  - Added `claimableAt?: Date` - When request became claimable
  - Kept `settledAt?: Date` for backward compatibility (maps to claimableAt)
- **RequestResult** interface updated:
  - Added `controller?: Address`
  - Added `owner?: Address`

### 2. `apps/vault-api/src/services/customVaultProvider.ts`

- **mapContractStatus** function updated with ERC-7540 semantics:
  - Contract 0 (Pending) → `"pending"`
  - Contract 1 (Cancelled) → `"cancelled"` (deprecated)
  - Contract 2 (Settled) → `"claimable"` (was `"ready"`)
  - Contract 3 (Claimed) → `"claimed"`
- **mapContractRequest** method updated:
  - Maps new controller/owner/operator fields from contract
  - Sets `claimableAt` timestamp for claimable/claimed statuses
  - Sets `claimedAt` timestamp for claimed status
- **getUserRedemptionState** updated to use `"claimable"` status

### 3. `apps/vault-api/src/types.ts`

- **EpochRequestStatus** type updated:
  - `"pending"` | `"claimable"` | `"claimed"` | `"cancelled"`
  - Was: `"pending"` | `"cancelled"` | `"settled"` | `"claimed"`
- **EpochRequest** interface updated:
  - Added `controller?: string`
  - Added `owner?: string`
  - Added `operator?: string`
  - Added `claimableAt: Date | null`
- **CreateEpochRequestInput** interface updated:
  - Added `controller?: string`
  - Added `owner?: string`
  - Added `operator?: string`
- **validEpochRequestTransitions** updated:
  - `pending: ["cancelled", "claimable"]` (was `["cancelled", "settled"]`)
  - `claimable: ["claimed"]` (was `settled: ["claimed"]`)

### 4. `apps/vault-api/src/db/schema.ts`

- **epochRequestStatusEnum** updated:
  - `["pending", "claimable", "claimed", "cancelled"]`
  - Was: `["pending", "cancelled", "settled", "claimed"]`
- **epochRequests** table updated:
  - Added `controller: text("controller")`
  - Added `owner: text("owner")`
  - Added `operator: text("operator")`
  - Added `claimableAt: timestamp("claimable_at")`

### 5. `apps/vault-api/src/repositories/epochRepository.ts`

- Updated all request status references from `"settled"` to `"claimable"`
- Kept epoch status as `"settled"` (EpochStatus ≠ EpochRequestStatus)
- Updated validEpochRequestTransitions to use `"claimable"`

### 6. `apps/vault-api/src/services/liquidityManager.ts`

- Updated request status references to use `"claimable"`
- Kept ReconciliationResult action type as `"settled"` (unrelated to request status)

### 7. `apps/vault-api/src/services/vaultHealthMonitor.ts`

- Updated request status references to use `"claimable"`

## Breaking Changes

### API Changes

1. **Response Field Changes:**
   - `RedemptionRequest.status` values changed:
     - `"ready"` → `"claimable"`
     - `"settled"` → `"claimable"`
   - New fields added: `controller`, `owner`, `operator`, `claimableAt`

2. **Database Migration Required:**

   ```sql
   -- Update existing data
   UPDATE epoch_requests SET status = 'claimable' WHERE status = 'settled';

   -- Add new columns
   ALTER TABLE epoch_requests ADD COLUMN controller TEXT;
   ALTER TABLE epoch_requests ADD COLUMN owner TEXT;
   ALTER TABLE epoch_requests ADD COLUMN operator TEXT;
   ALTER TABLE epoch_requests ADD COLUMN claimable_at TIMESTAMP WITH TIME ZONE;
   ```

### Test Updates Needed

- `src/__tests__/epochRepository.test.ts` uses old `"settled"` status
- Tests need to update to use `"claimable"` for request statuses

## Migration Path

1. Apply database migration (add new columns, update enum values)
2. Deploy updated API code
3. Update frontend to handle new status values
4. Update tests to use new status values

## Notes

- Epoch status (`EpochStatus`) remains unchanged: `"pending"` | `"settling"` | `"settled"` | `"cancelled"`
- Only request status (`EpochRequestStatus`) changed to ERC-7540 semantics
- Backward compatibility: `settledAt` field kept but deprecated in favor of `claimableAt`
