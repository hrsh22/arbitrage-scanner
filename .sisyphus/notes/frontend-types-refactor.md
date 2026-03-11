# Frontend Redemption Types Refactor - Task T4 Documentation

## Summary

Refactored frontend redemption domain types and API contracts to align with controller-aware lifecycle semantics for ERC-7540 compliance.

## Breaking Changes

### 1. RedemptionRequestStatus Type Changed

**Before:**

```typescript
type RedemptionRequestStatus =
  | "pending"
  | "settled"
  | "ready"
  | "claimable"
  | "claimed"
  | "cancelled";
```

**After:**

```typescript
type RedemptionRequestStatus = "pending" | "claimable" | "claimed" | "cancelled";
```

**Migration:**

- "settled" and "ready" status values removed
- Backend must map legacy statuses to "claimable"
- Status normalization logic in hooks.ts handles legacy values for backward compatibility

### 2. RedemptionRequest Interface Updated

**Added Fields:**

```typescript
ownerAddress: string;        // The address that owns the shares being redeemed
controllerAddress: string;   // The address that initiated the request (may be operator)
operatorAddress?: string | null;  // The operator who initiated on behalf of owner
```

**Removed Fields:**

- `settlementTime: string | null` (use `targetEpochEndTime` instead)
- `settledAt: string | null` (use `targetEpochEndTime` or remove)

**Files Modified:**

- `apps/vault-web/src/types.ts`
- `apps/vault-web/src/types/redemption.ts`

### 3. RedemptionQueueResponse Interface Updated

**Before:**

```typescript
interface RedemptionQueueResponse {
  requests: RedemptionRequest[];
  pending: RedemptionRequest[];
  claimable: RedemptionRequest[];
  settled: RedemptionRequest[]; // REMOVED
  total: number;
}
```

**After:**

```typescript
interface RedemptionQueueResponse {
  requests: RedemptionRequest[];
  pending: RedemptionRequest[];
  claimable: RedemptionRequest[];
  total: number;
}
```

### 4. Status Normalization in Hooks

The `useRequests` hook in `apps/vault-web/src/lib/hooks.ts` now normalizes legacy status values:

```typescript
let normalizedStatus = request.status;
if (String(request.status) === "ready" || String(request.status) === "settled") {
  normalizedStatus = "claimable";
}
```

This provides backward compatibility during the transition period.

## API Contract Changes

### Backend Response Contract

The backend API must now return redemption requests with:

1. Status values from the new union: "pending" | "claimable" | "claimed" | "cancelled"
2. New controller/owner fields populated
3. No reliance on "settled" or "ready" status values

### Frontend Defaults

When controller/owner fields are not provided by backend:

- `ownerAddress` defaults to `controllerAddress` or empty string
- `controllerAddress` defaults to `ownerAddress` or empty string
- `operatorAddress` defaults to `null`

## UI Components Updated

### ClaimableRequests.tsx

- Updated `isMatured` check to use `status === "claimable"`
- Updated date display to use `targetEpochEndTime || createdAt`
- Updated filter logic for claimable requests

### vault-detail.tsx (WithdrawForm)

- **NOTE:** The WithdrawForm uses the OLD withdrawal system which keeps "ready" status
- Only the RedemptionPanel components use the new "claimable" status

## Verification

Build command: `pnpm --filter vault-web build`
Status: ✅ PASS

## Notes for T11 (Frontend Integration)

- Types are ready for controller-aware lifecycle
- Status normalization provides backward compatibility
- UI components updated to use new status values
- No UI layout changes were made (as per requirements)

## Files Changed

1. `apps/vault-web/src/types.ts` - Updated status union and RedemptionRequest interface
2. `apps/vault-web/src/types/redemption.ts` - Updated status union and RedemptionRequest interface
3. `apps/vault-web/src/lib/hooks.ts` - Updated status normalization logic
4. `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx` - Updated status checks
5. `apps/vault-web/app/vault/[id]/vault-detail.tsx` - No changes (kept old system for WithdrawForm)

## Related Tasks

- Blocks: T11 (Frontend integration), T14 (E2E tests)
- Related: T3 (Backend type contracts)
