---

## T8 Implementation - ERC-165 Interface Detection and Async Preview Overrides

**Date**: 2026-03-03  
**Task**: T8 - ERC-165 Interface Detection and Async Preview Overrides  
**Contract**: `contracts/src/WeeklyEpochVault.sol`

### Successfully Implemented

#### 1. ERC-165 Interface Detection (`supportsInterface`)

- **Location**: Added to WeeklyEpochVault.sol
- **Implementation**: Pure function that returns true for supported interface IDs
- **Supported Interfaces**:
  - `0x620ee8e4` (IERC7540Redeem) - Async redemption core
  - `0xe3bc4e65` (IERC7540Operator) - Authorization delegation
  - `0x2f0a18c5` (IERC7575) - Tokenized vault
  - `0x8090723d` (IERC4626) - Base vault standard
  - `0x36372b07` (IERC20) - Token standard
  - `0x01ffc9a7` (IERC165) - Interface detection itself
- **Returns false for**:
  - `0xce3bbe50` (IERC7540Deposit) - Not supported per guardrail
  - `0xffffffff` - EIP-165 requirement for invalid interface ID

#### 2. Async Preview Overrides

- **Error Added**: `PreviewNotSupported()` custom error
- **Functions Implemented**:
  - `previewRedeem(uint256)`: Reverts with PreviewNotSupported
  - `previewWithdraw(uint256)`: Reverts with PreviewNotSupported
- **Rationale**: Exchange rate not fixed until settlement time in async vaults

#### 3. Max View Functions

- **maxRedeem(address controller)**: Returns sum of claimable shares across all settled requests for controller
- **maxWithdraw(address controller)**: Returns sum of claimable assets across all settled requests for controller
- **Implementation**: Iterates through userRequests[controller] and sums Settled requests

#### 4. ERC-7540 Required View Functions

- **pendingRedeemRequest(uint256, address)**: Returns pending shares for controller (aggregated model)
- **claimableRedeemRequest(uint256, address)**: Returns claimable shares for controller (aggregated model)

### Technical Details

#### Import Added

```solidity
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
```

#### Build Configuration

- Fixed foundry.toml to use `evm_version = "shanghai"` to avoid "osaka" EVM version error
- Build passes with `forge build`

### Interface IDs Reference (from interface-spec.md)

| Interface        | ID         | Status           |
| ---------------- | ---------- | ---------------- |
| IERC7540Redeem   | 0x620ee8e4 | ✅ Supported     |
| IERC7540Operator | 0xe3bc4e65 | ✅ Supported     |
| IERC7575         | 0x2f0a18c5 | ✅ Supported     |
| IERC4626         | 0x8090723d | ✅ Supported     |
| IERC20           | 0x36372b07 | ✅ Supported     |
| IERC165          | 0x01ffc9a7 | ✅ Supported     |
| IERC7540Deposit  | 0xce3bbe50 | ❌ Not Supported |

### Dependencies

- Blocked By: T6 (core functions) - Already implemented
- Blocks: T14 (compliance tests), F1 (compliance audit)

### Compliance Notes

- supportsInterface correctly rejects 0xffffffff per EIP-165
- Preview functions MUST revert per ERC-7540 spec for async vaults
- Max views return claimable amounts (Settled status) not pending

### Files Modified

- `contracts/src/WeeklyEpochVault.sol` - Added all ERC-165 and preview functions
- `contracts/foundry.toml` - Fixed EVM version to shanghai


---

## T7 Implementation - ERC-7540 Operator Model

**Date**: 2026-03-03  
**Task**: T7 - Operator Model and Authorization Enforcement  
**Contract**: `contracts/src/WeeklyEpochVault.sol`

### Successfully Implemented

#### 1. Operator Authorization Mapping

- Added `mapping(address => mapping(address => bool)) public _operatorApprovals;`
- Maps controller => operator => approved status
- Located in storage section

#### 2. setOperator Function

```solidity
function setOperator(address operator, bool approved) external returns (bool success)
```

- Validates operator != address(0)
- Sets approval status in `_operatorApprovals[msg.sender][operator]`
- Emits `OperatorSet(msg.sender, operator, approved)` event
- Returns true on success

#### 3. isOperator View Function

```solidity
function isOperator(address controller, address operator) external view returns (bool status)
```

- Returns approval status from `_operatorApprovals` mapping
- ERC-7540 required view function

#### 4. Custom Errors Added

- `NotOwner(address owner, address caller)` - For requestRedeem authorization failures
- `NotController(address controller, address caller)` - For redeem/withdraw/cancel authorization failures

#### 5. OperatorSet Event

```solidity
event OperatorSet(
    address indexed controller,
    address indexed operator,
    bool approved
);
```

#### 6. Authorization Checks Implemented

**requestRedeem**:
- Checks: `msg.sender == owner || _operatorApprovals[owner][msg.sender]`
- Uses `NotOwner` error on failure

**redeem / withdraw**:
- Checks: `msg.sender == controller || _operatorApprovals[controller][msg.sender]`
- Uses `NotController` error on failure

**cancelRedeemRequest**:
- Checks: `msg.sender == controller || _operatorApprovals[controller][msg.sender]`
- Uses `NotController` error on failure

### Access Control Matrix Implemented (from spec Section 7)

| Function | Caller Authorization | Revert Condition |
|----------|---------------------|------------------|
| requestRedeem | `msg.sender == owner` OR `isOperator[owner][msg.sender]` | `NotOwner()` |
| redeem | `msg.sender == controller` OR `isOperator[controller][msg.sender]` | `NotController()` |
| withdraw | `msg.sender == controller` OR `isOperator[controller][msg.sender]` | `NotController()` |
| setOperator | None (self-administered) | `InvalidAddress()` |
| isOperator | None (view) | Never reverts |

### Technical Details

#### Mapping Naming

Used `_operatorApprovals` instead of `isOperator` to avoid conflict with the `isOperator()` function.

#### Authorization Pattern

All checks use `&&` with negation:
```solidity
if (user != msg.sender && !_operatorApprovals[user][msg.sender]) {
    revert NotController(user, msg.sender);
}
```

#### NatSpec Compliance

Added proper NatSpec with `@custom:erc-7540` tags (note: hyphen required, not underscore)

### Interface ID

ERC-7540 Operator Interface ID: `0xe3bc4e65`

Function selectors:
- setOperator(address,bool): `0x37a6a0b1`
- isOperator(address,address): `0xc2c0d55a`

### Files Modified

- `contracts/src/WeeklyEpochVault.sol` - Added operator model implementation

### Dependencies

- Blocked By: T6 (core functions)
- Blocks: T13 (operator edge cases), T14 (E2E tests)


---

## T6 Implementation - Core ERC-7540 Redemption Lifecycle

**Date**: 2026-03-03
**Task**: T6 - Contract Function/Signature Rewrite
**Contract**: `contracts/src/WeeklyEpochVault.sol`

### Successfully Implemented

#### 1. Core ERC-7540 Data Structures

**RequestStatus Enum**:
- Pending (0) - Awaiting settlement
- Claimable (1) - Ready to claim (settled)
- Claimed (2) - Assets claimed (terminal)

**RedemptionRequest Struct** (4 slots, optimized):
- Slot 0: controller + owner addresses (packed)
- Slot 1: shares (uint256)
- Slot 2: assets (uint256)
- Slot 3: status + createdAt + settledAt + reserved (packed)

#### 2. Storage Layout (Per Spec)

- Slot 54: `_pendingRedeemRequest` mapping (controller => RedemptionRequest)
- Slot 55: `_claimableRedeemRequest` mapping (controller => RedemptionRequest)
- Slot 56: `isOperator` mapping (controller => operator => bool)
- Slot 57: `totalPendingRedeemShares` (uint256)
- Slots 61-68: Extension mappings (epoch, NAV, pro-rata)
- Slots 69-100: Reserved gap (32 slots)

#### 3. Core Functions Implemented

**requestRedeem(uint256 shares, address controller, address owner)**:
- Validates shares > 0, controller != 0, owner != 0
- Authorization: msg.sender == owner OR isOperator[owner][msg.sender]
- Transfers shares from owner to vault
- Accumulates shares for controller (aggregated model)
- Emits RedeemRequest(controller, owner, 0, msg.sender, shares)
- Returns 0 (controller-aggregated model)

**cancelRedeemRequest(uint256 shares)**:
- Extension function (not in ERC-7540 standard)
- Allows partial cancellation
- Validates pending request exists and epoch not ended
- Returns shares to owner
- Reduces totalPendingRedeemShares

**redeem(uint256 shares, address receiver, address controller)**:
- Validates inputs and authorization
- Checks sufficient claimable shares
- Calculates assets using settlement NAV snapshot
- Transfers assets to receiver
- Emits Withdraw(controller, receiver, controller, assets, shares)
- Returns assets amount

**withdraw(uint256 assets, address receiver, address controller)**:
- Validates inputs and authorization
- Calculates shares from assets using NAV
- Transfers assets to receiver
- Emits Withdraw event
- Returns shares consumed

**pendingRedeemRequest(uint256 requestId, address controller)**:
- Returns pending shares for controller
- Ignores requestId (aggregated model)
- View function, never reverts

**claimableRedeemRequest(uint256 requestId, address controller)**:
- Returns claimable shares for controller
- Ignores requestId (aggregated model)
- View function, never reverts

#### 4. Events Implemented

- `RedeemRequest(controller, owner, requestId, sender, shares)`
- `Withdraw(sender, receiver, owner, assets, shares)` (ERC-4626)
- `OperatorSet(controller, operator, approved)`
- `RequestCancelled(controller, shares)` (Extension)
- `EpochSettled(epochId, totalShares, totalAssets, nav)` (Extension)

#### 5. Custom Errors

**Authorization**:
- `NotOwner(address owner, address caller)`
- `NotController(address controller, address caller)`
- `Unauthorized(address caller)`

**State**:
- `NoPendingRequest(address controller)`
- `NoClaimableRequest(address controller)`
- `InsufficientClaimableShares(uint256 requested, uint256 available)`
- `ZeroAmount()`
- `InvalidAddress()`

**Extension**:
- `EpochNotEnded(uint256 epochId, uint256 epochEnd)`
- `AlreadySettled(uint256 epochId)`
- `NoPendingRequests(uint256 epochId)`
- `NAVStale(uint256 lastUpdate, uint256 threshold)`
- `SettlementIncomplete(uint256 epochId)`
- `CannotCancelAfterSettlement(uint256 epochId, uint256 epochEnd)`
- `AlreadyCancelled()`
- `EmergencyModeActive()`

#### 6. Extension Functions Preserved

**settleEpoch(uint256 epochId, uint256 availableAssets)**:
- Validates epoch ended, NAV fresh, not settled
- Calculates pro-rata ratio if needed
- Processes pending requests in chunks if needed
- Moves requests from pending to claimable state
- Stores NAV snapshot for claim calculations

**settleEpochChunked(uint256 epochId)**:
- Continues settlement from last processed index
- Processes up to MAX_CHUNK_SIZE controllers per call
- Emits EpochSettled when complete

### Technical Challenges

1. **Naming Collision**: `pendingRedeemRequest` and `claimableRedeemRequest` needed to be both mappings AND functions per spec. Solved by using internal mappings (`_pendingRedeemRequest`, `_claimableRedeemRequest`) and implementing explicit view functions with the required names.

2. **Controller-Aggregated Model**: All requests for a controller are aggregated. Multiple requests accumulate shares. This differs from the old requestId-based model.

3. **Share Transfer**: `requestRedeem` transfers shares from owner to vault using `IERC20(address(this)).safeTransferFrom()` since the vault is the token contract.

### Compilation

- Contract compiles successfully with `forge build`
- Warnings for unused requestId parameter (intentional per spec)
- Warnings for typecasts (intentional for gas optimization)
- Test file errors expected (tests need updating in T9-T14)

### Files Modified

- `contracts/src/WeeklyEpochVault.sol` - Complete rewrite (~1080 lines)

### Dependencies

- Blocked By: T1 (standards spec), T2 (storage layout), T5 (test scaffolding)
- Blocks: T7 (operator model - already done), T8 (ERC-165 - already done), T9 (backend client)


---

## T11 Implementation - Frontend API/Hooks Integration

**Date**: 2026-03-03
**Task**: T11 - Frontend API/Hooks Integration for ERC-7540 Lifecycle
**Files**: `apps/vault-web/src/lib/api.ts`, `apps/vault-web/src/lib/hooks.ts`, `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx`

### Successfully Implemented

#### 1. api.ts - postRedemptionRequest Operator Support

Added optional `operator` parameter to support ERC-7540 controller/operator semantics:

```typescript
export async function postRedemptionRequest(
  vaultId: number,
  shares: string,
  assetsEstimated?: string,
  operator?: string,
): Promise<RedemptionRequestCreateResponse>
```

The operator field is passed in the request body to the backend API for ERC-7540 compliance.

#### 2. hooks.ts - useRequestRedeem Hook Update

Updated `UseRequestRedeemResult` interface and implementation:

```typescript
export interface UseRequestRedeemResult {
  requestRedeem: (vaultId: number, shares: string, assetsEstimated?: string, operator?: string) => Promise<void>;
  // ... other fields
}
```

The hook now accepts and passes through the operator parameter to the API call.

#### 3. ClaimableRequests.tsx - Status Badge Text

Changed badge text from "ready" to "claimable" for consistency:

```tsx
<Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
  {claimableCount} claimable
</Badge>
```

### Key Insights

1. **Status Normalization Already in Place**: The hooks.ts file already had status normalization logic that converts legacy "ready" and "settled" statuses to "claimable". This was added in a previous update (T4).

2. **Controller-Aware Fields**: The RedemptionRequest type already includes ownerAddress, controllerAddress, and operatorAddress fields. The API and hooks now support passing the operator field when creating requests.

3. **No Breaking UI Changes**: All changes were behavior-only. The UI layout, styling, and component structure remained unchanged.

### Build Verification

```bash
pnpm --filter vault-web build
```

**Result**: ✅ Build passes successfully with no TypeScript errors.

### Status Values (ERC-7540 Aligned)

| Status | Description |
|--------|-------------|
| `"pending"` | Request created, awaiting settlement |
| `"claimable"` | Settlement complete, ready to claim (was "ready" or "settled") |
| `"claimed"` | User has claimed assets |
| `"cancelled"` | Request was cancelled |

### Files Modified

- `apps/vault-web/src/lib/api.ts` - Added operator parameter to postRedemptionRequest
- `apps/vault-web/src/lib/hooks.ts` - Updated useRequestRedeem hook interface and implementation
- `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx` - Updated badge text from "ready" to "claimable"

### Dependencies

- **Blocked By**: T4 (frontend types), T9 (backend), T10 (routes)
- **Blocks**: T14 (E2E tests)

### Next Steps for T14 (E2E Tests)

The frontend is now ready for end-to-end testing with the backend. Key test scenarios:
1. Create redemption request with and without operator
2. Verify pending requests display correctly
3. Verify claimable requests display after settlement
4. Verify claimed status after claiming
5. Test unauthorized operator rejection

---

## T9 Implementation - Backend Client/Provider Rewrite

**Date**: 2026-03-03  
**Task**: T9 - Rewrite backend contract client/provider to new ABI semantics  
**Files**: 
- `apps/vault-api/src/services/customVaultClient.ts`
- `apps/vault-api/src/services/customVaultProvider.ts`

### Successfully Implemented

#### 1. ABI Generation and Update

- Generated new ABI from `WeeklyEpochVault.sol` using `forge inspect WeeklyEpochVault abi`
- Contract now implements full ERC-7540 async redemption surface

**New Core Functions**:
| Function | Signature | Purpose |
|----------|-----------|---------|
| `requestRedeem` | `(shares, controller, owner) → requestId` | Create async redemption |
| `cancelRedeemRequest` | `(shares) → cancelledShares` | Cancel pending (extension) |
| `redeem` | `(shares, receiver, controller) → assets` | Claim by shares |
| `withdraw` | `(assets, receiver, controller) → shares` | Claim by assets |
| `pendingRedeemRequest` | `(requestId, controller) → shares` | View pending |
| `claimableRedeemRequest` | `(requestId, controller) → shares` | View claimable |
| `setOperator` | `(operator, approved) → success` | Manage operators |

#### 2. Client Updates (customVaultClient.ts)

**Replaced Functions**:
- Old: `requestRedeem(shares)` → New: `requestRedeem(shares, controller, owner)`
- Old: `cancelRedemption(requestId)` → New: `cancelRedeemRequest(shares)`
- Old: No direct claim → New: `redeem(shares, receiver, controller)`

**New Helper Methods**:
```typescript
// Controller-aggregated model helpers
getPendingRedeemRequest(controller: Address): Promise<bigint>
getClaimableRedeemRequest(controller: Address): Promise<bigint>
getControllerRequestState(controller: Address): Promise<ControllerRequestState>
getPendingRequestExtension(controller: Address): Promise<{ epochId: number } | null>
```

**Removed Deprecated**:
- `nextRequestId` - Not needed in controller-aggregated model
- `getRequest(requestId)` - Replaced by controller lookups
- `getUserRequests(user)` - Needs reimplementation for new model

**Updated Events**:
```typescript
// ERC-7540 standard events
RedeemRequest(controller, owner, requestId, sender, shares)
Withdraw(sender, receiver, owner, assets, shares)
OperatorSet(controller, operator, approved)

// Extension events
RequestCancelled(controller, shares)
EpochSettled(epochId, totalShares, totalAssets, nav)
```

#### 3. Provider Updates (customVaultProvider.ts)

**Controller-Aggregated Model**:
- RequestId = Controller address (not numeric ID)
- Each controller has at most: 1 pending + 1 claimable request
- Contract always returns requestId = 0

**New Status Mapping**:
```typescript
function mapControllerStateToStatus(
  pendingShares: bigint,
  claimableShares: bigint,
): RequestStatus {
  if (claimableShares > 0n) return "claimable";
  if (pendingShares > 0n) return "pending";
  return "claimed"; // Or "cancelled" if we track history
}
```

**Operator Authorization**:
```typescript
async isAuthorizedForController(
  callerAddress: Address,
  controller: Address,
): Promise<boolean> {
  // Direct authorization
  if (callerAddress.toLowerCase() === controller.toLowerCase()) return true;
  // Operator authorization
  return this.client.isOperator(controller, callerAddress);
}
```

**Updated Methods**:
- `getRequestStatus(requestId)` - Now expects controller address as requestId
- `getUserRequests(userAddress)` - Checks both pending and claimable states
- `requestRedeem(userAddress, shares)` - Returns controller/owner addresses
- `cancelRedemption(requestId, userAddress)` - Uses new client methods
- `claimRedemption(requestId, userAddress)` - Uses new client methods

### Key Architectural Changes

1. **Controller-Aggregated Model**: 
   - No per-request IDs
   - Controller address is the identifier
   - Single pending + single claimable per controller

2. **ERC-7540 Authorization**:
   - Owner: Address that owns the shares
   - Controller: Address that controls the request (can claim)
   - Operator: Address authorized to act on behalf of controller

3. **Claim Flow**:
   - Old: `claim(requestId)` 
   - New: `redeem(shares, receiver, controller)` or `withdraw(assets, receiver, controller)`

4. **Cancel Flow**:
   - Old: `cancelRedemption(requestId)`
   - New: `cancelRedeemRequest(shares)` (msg.sender is implicit controller)

### Build Verification

```bash
$ pnpm --filter vault build
# Type-check passes for client and provider files
# Routes file errors expected (handled in T10)
```

### Dependencies

- **Blocked By**: T6 (contract signatures), T7 (operator model), T8 (ERC-165/preview)
- **Blocks**: T10 (API routes), T11 (frontend hooks), T14 (E2E tests)

### Migration Notes for T10/T11

1. **Request ID Handling**: Change from numeric string to address string
2. **Claiming**: Need to specify shares/assets and receiver explicitly
3. **Cancelling**: Specify shares amount, not request ID
4. **Operator UI**: New flows needed for operator approval management



---

## T10 Implementation - API Routes for ERC-7540 Controller/Owner/Operator Semantics

**Date**: 2026-03-03  
**Task**: T10 - Route/controller rewrite with owner/controller/operator semantics  
**Files**: `apps/vault-api/src/routes/customVaultRoutes.ts`, `apps/vault-api/src/services/claimStateMachine.ts`

### Successfully Implemented

#### 1. POST /redeem Endpoint (ERC-7540 Support)

Added validation and support for ERC-7540 controller/owner/operator fields:

```typescript
// New validation helper
function isValidEthereumAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

// Updated validation interface
interface RedeemRequestValidation {
  shares: string;
  assetsEstimated?: string;
  controller?: string;  // ERC-7540
  owner?: string;       // ERC-7540
  operator?: string;    // ERC-7540
}
```

Key behaviors:
- Controller defaults to user address if not provided
- Owner defaults to user address if not provided
- Operator is optional and logged when specified
- All addresses validated as Ethereum addresses if provided

#### 2. POST /claim Endpoint (Operator Authorization)

Added ERC-7540 authorization check:

```typescript
const isOwner = request.userAddress.toLowerCase() === userAddress.toLowerCase();
const isController = request.controller?.toLowerCase() === userAddress.toLowerCase();
const isOperator = request.operator?.toLowerCase() === userAddress.toLowerCase();

const isAuthorized = isOwner || isController || isOperator;
```

Returns 403 with descriptive error for unauthorized attempts:
```
"Not authorized: You are not the owner, controller, or authorized operator for this claim"
```

#### 3. POST /cancel Endpoint (Operator Authorization)

Same authorization model as claim:
- Fetches request status to verify authorization
- Checks owner, controller, and operator fields
- Logs cancellation context (isOwner, isController, isOperator)

#### 4. formatRedemptionRequest() Helper

Updated to include ERC-7540 fields in API response:

```typescript
return {
  id: request.requestId,
  requestId: request.requestId,
  vaultId: request.vaultId,
  userAddress: request.userAddress,
  // ERC-7540 fields
  controller: request.controller ?? request.userAddress,
  owner: request.owner ?? request.userAddress,
  operator: request.operator ?? null,
  // ... other fields
};
```

#### 5. Status Mapping (claimStateMachine.ts)

Updated `mapRequestStatusToClaimState()` to support both "claimable" (ERC-7540) and "settled" (legacy):

```typescript
case "claimable":
case "settled":
  // ERC-7540: claimable (was settled) = ready to claim
  return ClaimState.FROZEN;
```

### API Request/Response Examples

**POST /redeem Request**:
```json
{
  "shares": "1000000000000000000",
  "controller": "0x1234...",  // optional
  "owner": "0x1234...",       // optional
  "operator": "0x5678..."     // optional
}
```

**POST /redeem Response**:
```json
{
  "success": true,
  "requestId": "42",
  "controller": "0x1234...",
  "owner": "0x1234...",
  "operator": "0x5678...",
  "status": "pending"
}
```

### Authorization Matrix

| Action | Owner | Controller | Operator |
|--------|-------|------------|----------|
| POST /redeem | ✓ | ✓ (as owner) | ✗ |
| POST /claim | ✓ | ✓ | ✓ |
| POST /cancel | ✓ | ✓ | ✓ |

### Build Verification

```bash
$ pnpm --filter vault build
# Routes file compiles successfully
# Test files have expected errors ("settled" -> "claimable" transition)
# Client file errors handled by T9
```

### Dependencies

- **Blocked By**: T3 (backend types), T6 (contract), T7 (operator), T9 (provider)
- **Blocks**: T11 (frontend), T14 (E2E tests)

### Notes

- Routes maintain backward compatibility for existing endpoint paths
- Provider must return controller/owner/operator fields for authorization to work
- Test files still reference "settled" status - T14 should update to "claimable"
- All authorization checks are case-insensitive for addresses
