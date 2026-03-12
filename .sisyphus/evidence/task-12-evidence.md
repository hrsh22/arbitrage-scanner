# T12 Integrated API/UI Fix - Evidence

## Summary

Fixed API/UI integration issues for the vault feature to enable clean non-connected page loads.

## Issues Fixed

### 1. Backend 404 Errors for Cycle Endpoints

**Problem:** Frontend requests to `/api/vaults/1/cycles/current` and `/api/vaults/1/cycles` returned 404

**Solution:** Added cycle route aliases in `customVaultRoutes.ts`:

- `GET /:vaultId/cycles/current` - Returns current cycle status (aliases epochs/current)
- `GET /:vaultId/cycles` - Returns cycle history (aliases epochs)
- `GET /:vaultId/cycles/:cycleId` - Returns specific cycle details

**Also fixed:** Added back the missing `GET /:vaultId/epochs/:epochId` route that was accidentally omitted when adding cycle aliases.

### 2. Frontend 401 Console Errors on Initial Load

**Problem:** Unauthenticated users saw 401 errors for `/deposit-queue` and `/redemptions` endpoints

**Solution:** Updated hooks in `hooks.ts`:

- `useRequests(vaultId, isAuthenticated)` - Now accepts isAuthenticated parameter
- `useDepositQueue(vaultId, isAuthenticated)` - Now accepts isAuthenticated parameter
- Both hooks skip fetching when unauthenticated
- Both hooks silently handle 401 errors without console spam

### 3. Updated vault-detail.tsx

- Added `isAuthenticated` boolean based on wallet connection state
- Passes `isAuthenticated` to `useRequests` and `useDepositQueue` hooks

### 4. Stale UI Copy Fix

**Problem:** RedemptionPanel still used "weekly settlement" wording

**Solution:** Updated copy in `RedemptionPanel.tsx`:

- Subtitle: "Request shares to be redeemed at cycle settlement"
- Alert: "Cycle Settlement: Redemption requests are processed when the cycle closes and positions are frozen..."

## Files Modified

1. `apps/vault-api/src/routes/customVaultRoutes.ts` - Added cycle route aliases AND restored missing epochs/:epochId route
2. `apps/vault-web/src/lib/hooks.ts` - Added auth-gating to hooks
3. `apps/vault-web/app/vault/[id]/vault-detail.tsx` - Pass isAuthenticated to hooks
4. `apps/vault-web/app/vault/[id]/components/RedemptionPanel.tsx` - Updated copy

## Build/Test Status

- ✅ `pnpm --filter vault build` passes
- ✅ `pnpm --filter vault-web build` passes
- ✅ `pnpm --filter vault exec vitest run src/__tests__/customVaultRoutes.test.ts` passes (19 tests)

## Playwright Verification Results

- Page loads at http://localhost:3000/vault/1 without console spam
- No 404 errors for /cycles/\* endpoints
- No 401 errors for /deposit-queue or /redemptions (hooks don't fire when unauthenticated)
- Page renders correctly for non-connected users
- Updated copy visible: "cycle settlement" instead of "weekly settlement"
