# ERC-7540 Contract Storage Design Document

> **Task**: T2 - Redesign contract storage and status model for ERC-7540 semantics  
> **Date**: 2026-03-03  
> **Author**: Sisyphus-Junior

---

## 1. Executive Summary

This document defines the new storage layout and status model for the ERC-7540-compliant `WeeklyEpochVault` contract. The redesign moves from a request-ID-centric model to a controller-aggregated model with clear separation between base ERC-7540 semantics and vault-specific extensions (epochs, NAV, pro-rata).

### Key Changes

| Aspect              | Old Model                                          | New Model                                                                |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| **Status Values**   | `Pending(0), Cancelled(1), Settled(2), Claimed(3)` | `Pending(0), Claimable(1), Claimed(2)`                                   |
| **Request ID**      | Unique per request (1, 2, 3...)                    | `requestId = 0` for controller-aggregated state                          |
| **Storage Pattern** | `requests[requestId]` mapping                      | `pendingRedeemRequest[controller]`, `claimableRedeemRequest[controller]` |
| **Cancellation**    | Status change to `Cancelled`                       | Return shares to owner, remove from pending mapping                      |
| **Settlement**      | Status `Pending → Settled`                         | Status `Pending → Claimable`                                             |

---

## 2. ERC-7540 Base Semantics

### 2.1 Required Interface Compliance

```solidity
// IERC7540Redeem
function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256 requestId);
function redeem(uint256 shares, address receiver, address controller) external returns (uint256 assets);
function pendingRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares);
function claimableRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares);

// IERC7540Operator
function setOperator(address operator, bool approved) external returns (bool);
function isOperator(address controller, address operator) external view returns (bool);
```

### 2.2 Required Events

```solidity
event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares);
event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
event OperatorSet(address indexed controller, address indexed operator, bool approved);
```

---

## 3. Storage Layout Design

### 3.1 Core ERC-7540 Storage (Base Layer)

```solidity
// ============================================================================
// ERC-7540 REDEMPTION REQUEST STATE (Base Standard)
// ============================================================================

/// @notice Status of a redemption request per ERC-7540
/// @dev Numeric values are part of the standard interface
enum RequestStatus {
    Pending,    // 0 - Request submitted, awaiting settlement
    Claimable,  // 1 - Settlement complete, assets available for claim
    Claimed     // 2 - Assets claimed, request complete
}

/// @notice Redemption request data structure (ERC-7540 aligned)
/// @dev For controller-aggregated model, requestId = 0
struct RedemptionRequest {
    address controller;     // The controller address (ERC-7540 semantics)
    address owner;          // The owner of shares (may differ from controller)
    uint256 shares;         // Shares requested for redemption
    uint256 assets;         // Assets claimable after settlement (0 if pending)
    RequestStatus status;   // Current status
    uint256 createdAt;      // Block timestamp of request creation
    uint256 settledAt;      // Block timestamp of settlement (0 if pending)
}

/// @notice Pending redemption requests by controller (ERC-7540 standard)
/// @dev Maps controller address to their pending request
/// @dev Returns shares = 0 if no pending request
mapping(address => RedemptionRequest) public pendingRedeemRequest;

/// @notice Claimable redemption requests by controller (ERC-7540 standard)
/// @dev Maps controller address to their claimable request
/// @dev Returns shares = 0 if no claimable request
mapping(address => RedemptionRequest) public claimableRedeemRequest;

/// @notice Operator approvals per ERC-7540
/// @dev controller => operator => approved
mapping(address => mapping(address => bool)) public isOperator;

/// @notice Total pending shares across all controllers
/// @dev Used for totalAssets() exclusion per ERC-7540
uint256 public totalPendingRedeemShares;
```

### 3.2 Extension Storage (Vault-Specific)

```solidity
// ============================================================================
// EXTENSION: EPOCH BUCKETING
// ============================================================================

/// @notice Extension metadata linking requests to epochs
/// @dev This is NON-STANDARD - epoch concept is a vault extension
struct EpochExtension {
    uint256 epochId;        // The epoch this request belongs to
    bool isExtension;       // Always true - marker for extension data
}

/// @notice Extension metadata for pending requests
/// @dev Maps controller => epoch extension data
mapping(address => EpochExtension) public pendingRequestExtension;

/// @notice Extension metadata for claimable requests
/// @dev Maps controller => epoch extension data
mapping(address => EpochExtension) public claimableRequestExtension;

/// @notice All controllers with pending requests in an epoch
/// @dev Used for epoch settlement iteration
/// @dev Non-standard extension for settlement operations
mapping(uint256 => address[]) public epochPendingControllers;

/// @notice Tracks which controllers have been processed in epoch settlement
/// @dev Used to prevent double-processing during chunked settlement
mapping(uint256 => mapping(address => bool)) public epochControllerProcessed;

// ============================================================================
// EXTENSION: NAV TRACKING
// ============================================================================

/// @notice NAV snapshot at settlement time
/// @dev Extension - not part of base ERC-7540
struct NavSnapshot {
    uint256 nav;            // NAV value at settlement
    uint256 timestamp;      // When the snapshot was taken
    bool isFresh;           // Whether NAV was within freshness threshold
}

/// @notice NAV snapshot for settled (claimable) requests
/// @dev Maps controller => snapshot data
/// @dev Extension for settlement calculations
mapping(address => NavSnapshot) public claimableNavSnapshot;

/// @notice Current NAV value
/// @dev Updated periodically by NAV_UPDATER_ROLE
uint256 public currentNAV;

/// @notice Timestamp of last NAV update
uint256 public lastNAVUpdate;

/// @notice NAV staleness threshold in seconds
uint256 public immutable NAV_STALENESS_THRESHOLD;

// ============================================================================
// EXTENSION: PRO-RATA SETTLEMENT
// ============================================================================

/// @notice Pro-rata settlement data
/// @dev Extension - vault-specific behavior for insufficient liquidity
struct ProRataData {
    uint256 ratio;          // Pro-rata ratio applied (1e18 = 100%)
    uint256 originalShares; // Original shares before pro-rata adjustment
    bool wasProRata;        // True if pro-rata was applied
}

/// @notice Pro-rata data for claimable requests
/// @dev Maps controller => pro-rata settlement info
/// @dev Extension for partial settlement tracking
mapping(address => ProRataData) public claimableProRataData;

/// @notice Precision factor for pro-rata calculations
uint256 public constant PRO_RATA_PRECISION = 1e18;
```

### 3.3 Complete Storage Layout Summary

| Slot   | Variable                                   | Type      | Purpose                             |
| ------ | ------------------------------------------ | --------- | ----------------------------------- |
| 0-49   | Inherited (AccessControl, ReentrancyGuard) | -         | OpenZeppelin storage                |
| 50     | `asset`                                    | `IERC20`  | Immutable - vault asset             |
| 51     | `EPOCH_DURATION`                           | `uint256` | Immutable - epoch length            |
| 52     | `DEPLOY_TIME`                              | `uint256` | Immutable - deployment timestamp    |
| 53     | `NAV_STALENESS_THRESHOLD`                  | `uint256` | Immutable - NAV freshness limit     |
| 54     | `pendingRedeemRequest`                     | `mapping` | ERC-7540 pending state              |
| 55     | `claimableRedeemRequest`                   | `mapping` | ERC-7540 claimable state            |
| 56     | `isOperator`                               | `mapping` | ERC-7540 operator approvals         |
| 57     | `totalPendingRedeemShares`                 | `uint256` | Total pending shares                |
| 58     | `currentNAV`                               | `uint256` | Current NAV value                   |
| 59     | `lastNAVUpdate`                            | `uint256` | Last NAV update timestamp           |
| 60     | `emergencyMode`                            | `bool`    | Emergency pause flag                |
| 61     | `pendingRequestExtension`                  | `mapping` | EXTENSION: epoch metadata           |
| 62     | `claimableRequestExtension`                | `mapping` | EXTENSION: epoch metadata           |
| 63     | `epochPendingControllers`                  | `mapping` | EXTENSION: epoch controller list    |
| 64     | `epochControllerProcessed`                 | `mapping` | EXTENSION: settlement tracking      |
| 65     | `claimableNavSnapshot`                     | `mapping` | EXTENSION: NAV at settlement        |
| 66     | `claimableProRataData`                     | `mapping` | EXTENSION: pro-rata settlement info |
| 67-100 | Reserved                                   | -         | Future extension slots              |

---

## 4. Status Model

### 4.1 Status Enum Definition

```solidity
enum RequestStatus {
    Pending,    // 0
    Claimable,  // 1
    Claimed     // 2
}
```

### 4.2 Status Semantics

| Status      | Value | Meaning                                  | Transitions To                                                |
| ----------- | ----- | ---------------------------------------- | ------------------------------------------------------------- |
| `Pending`   | 0     | Shares locked, awaiting epoch settlement | `Pending` (additional shares), `Claimable` (after settlement) |
| `Claimable` | 1     | Settlement complete, assets available    | `Claimed` (after claim)                                       |
| `Claimed`   | 2     | Assets transferred, request complete     | (terminal)                                                    |

### 4.3 Cancellation Behavior

Cancellation is **NOT** a status. When a user cancels:

1. Shares are returned to owner
2. Entry removed from `pendingRedeemRequest[controller]`
3. `totalPendingRedeemShares` decreased
4. Controller removed from `epochPendingControllers[epochId]`
5. Extension metadata cleared

```solidity
function cancelRedeemRequest(address controller) external {
    // Only controller or operator can cancel
    // Only if status is Pending
    // Must be before epoch settlement cutoff

    RedemptionRequest memory request = pendingRedeemRequest[controller];
    require(request.status == RequestStatus.Pending, "Not pending");
    require(request.shares > 0, "No pending request");

    // Return shares to owner
    _transferShares(address(this), request.owner, request.shares);

    // Update total pending
    totalPendingRedeemShares -= request.shares;

    // Clear pending mapping
    delete pendingRedeemRequest[controller];
    delete pendingRequestExtension[controller];

    emit CancelRedeemRequest(controller, request.shares);
}
```

---

## 5. Contract → API Status Mapping

### 5.1 Mapping Table

| Contract Status (uint8) | Contract Name | API Status String | API Enum Value |
| ----------------------- | ------------- | ----------------- | -------------- |
| 0                       | `Pending`     | `"pending"`       | `PENDING`      |
| 1                       | `Claimable`   | `"claimable"`     | `CLAIMABLE`    |
| 2                       | `Claimed`     | `"claimed"`       | `CLAIMED`      |

### 5.2 Old → New Migration Mapping

For reference when updating consumers:

| Old Contract Status | Old Value | New Contract Status | New Value | Notes                                  |
| ------------------- | --------- | ------------------- | --------- | -------------------------------------- |
| `Pending`           | 0         | `Pending`           | 0         | **UNCHANGED**                          |
| `Cancelled`         | 1         | _removed_           | -         | Cancellation is now absence of request |
| `Settled`           | 2         | `Claimable`         | 1         | **RENAMED** - semantic equivalent      |
| `Claimed`           | 3         | `Claimed`           | 2         | **VALUE CHANGED** - was 3, now 2       |

### 5.3 API Implementation

```typescript
// vaultProvider.ts - Updated RequestStatus type
export type RequestStatus =
  | "pending" // Awaiting settlement
  | "claimable" // Ready to claim (settled)
  | "claimed"; // Assets claimed

// customVaultProvider.ts - Updated mapContractStatus function
function mapContractStatus(contractStatus: number): RequestStatus {
  const statusMap: Record<number, RequestStatus> = {
    0: "pending",
    1: "claimable", // Was "ready" for Settled(2), now Claimable(1)
    2: "claimed", // Was 3, now 2
  };
  return statusMap[contractStatus] ?? "pending";
}
```

### 5.4 Database Schema Updates

```typescript
// schema.ts - Updated epochRequestStatusEnum
export const epochRequestStatusEnum = pgEnum("epoch_request_status", [
  "pending", // 0 - Request active, can be cancelled
  "claimable", // 1 - Settlement complete, ready to claim (was "settled")
  "claimed", // 2 - User has claimed assets
]);

// Note: "cancelled" is removed - cancelled requests are deleted from DB
// Note: "settled" renamed to "claimable" to align with ERC-7540 terminology
```

---

## 6. totalAssets() Compliance

### 6.1 ERC-7540 Requirement

Per ERC-7540, pending redemption shares **MUST NOT** be counted in `totalAssets()`. The vault assets backing pending redemptions are effectively reserved and should not be considered available for investment.

### 6.2 Implementation

```solidity
/// @notice Total assets managed by vault
/// @dev Excludes assets backing pending redemption requests per ERC-7540
function totalAssets() public view override returns (uint256) {
    // Get total vault assets
    uint256 totalVaultAssets = asset.balanceOf(address(this));

    // Calculate assets backing pending redemptions
    // Using current NAV for pending share valuation
    uint256 pendingAssets = _convertSharesToAssets(totalPendingRedeemShares, currentNAV);

    // Return assets excluding pending redemptions
    return totalVaultAssets > pendingAssets ? totalVaultAssets - pendingAssets : 0;
}

/// @notice Convert shares to assets using NAV
function _convertSharesToAssets(uint256 shares, uint256 nav) internal pure returns (uint256) {
    if (nav == 0) return 0;
    // shares * nav / 1e18 (assuming 18-decimal NAV)
    return (shares * nav) / 1e18;
}
```

### 6.3 Extension: Claimable Assets

Claimable assets (after settlement) **ARE** counted in `totalAssets()` because they represent the vault's liability to fulfill claims, not reserved assets for future settlement.

---

## 7. Migration Plan

### 7.1 State Migration

**No state migration required** - this is a rewrite for a fresh deployment.

### 7.2 Code Migration

#### Phase 1: Contract Layer

1. **Remove** old `RedemptionRequest` struct (with `requestId`, `user`, `claimableAssets`)
2. **Add** new `RedemptionRequest` struct (with `controller`, `owner`, `assets`)
3. **Replace** `requests[requestId]` with `pendingRedeemRequest[controller]` and `claimableRedeemRequest[controller]`
4. **Update** `RequestStatus` enum (remove `Cancelled`, rename `Settled` to `Claimable`)
5. **Add** operator-related storage and functions
6. **Preserve** extension mappings for epoch/NAV/pro-rata

#### Phase 2: Backend Layer

1. **Update** `mapContractStatus` function in `customVaultProvider.ts`
2. **Update** `RequestStatus` type in `vaultProvider.ts`
3. **Update** `epochRequestStatusEnum` in `schema.ts`
4. **Update** state machine in `claimStateMachine.ts` (remove cancelled path)
5. **Update** type definitions in `types.ts`
6. **Run** database migration to update enum values

#### Phase 3: Frontend Layer

1. **Update** status rendering in UI components
2. **Update** polling logic for new status values
3. **Update** type definitions

### 7.3 Deployment Checklist

- [ ] Contract deployed with new storage layout
- [ ] Backend updated with new ABI and status mappings
- [ ] Database migrations applied
- [ ] Frontend updated and deployed
- [ ] Integration tests passing

---

## 8. Gas Implications

### 8.1 Storage Changes

| Operation                   | Old Gas | New Gas | Delta | Notes                                  |
| --------------------------- | ------- | ------- | ----- | -------------------------------------- |
| `requestRedeem`             | ~60k    | ~65k    | +5k   | Controller validation + operator check |
| `cancelRedemption`          | ~40k    | ~35k    | -5k   | No status change, just delete mapping  |
| `settleEpoch` (per request) | ~25k    | ~30k    | +5k   | Move between mappings vs status change |
| `claim`                     | ~45k    | ~40k    | -5k   | Simpler status logic                   |

### 8.2 Key Gas Optimizations

1. **Controller-aggregated model**: Single storage read for `pendingRedeemRequest[controller]` vs iterating request IDs
2. **No requestId tracking**: Eliminates `nextRequestId` counter and request ID lookups
3. **Packed structs**: `RedemptionRequest` fields pack efficiently into 3 slots

```solidity
// Storage layout for RedemptionRequest (optimized)
// Slot 0: controller (20 bytes) + owner (20 bytes) = 40 bytes (2 addresses)
// Slot 1: shares (32 bytes)
// Slot 2: assets (32 bytes)
// Slot 3: status (1 byte) + createdAt (32 bytes) + settledAt (32 bytes) = 65 bytes (spans 3 slots)
// Total: 5 slots per request
```

### 8.3 Trade-offs

- **More mappings**: 2x mappings (pending/claimable) vs 1x (requests) increases code size
- **Controller iteration**: `epochPendingControllers` array needed for settlement iteration
- **Extension overhead**: Extension metadata adds 2-3 storage slots per request

---

## 9. Edge Cases

### 9.1 Multiple Requests from Same Controller

ERC-7540 uses `requestId = 0` for controller-aggregated state. If a controller submits multiple requests:

```solidity
// Add to existing pending request
RedemptionRequest storage existing = pendingRedeemRequest[controller];
if (existing.shares > 0) {
    // Accumulate shares
    existing.shares += shares;
    // Update timestamp
    existing.createdAt = block.timestamp;
} else {
    // Create new request
    pendingRedeemRequest[controller] = RedemptionRequest({
        controller: controller,
        owner: owner,
        shares: shares,
        assets: 0,
        status: RequestStatus.Pending,
        createdAt: block.timestamp,
        settledAt: 0
    });
}
```

### 9.2 Partial Claims

Not supported in base ERC-7540. For partial claims (extension):

```solidity
// Extension function for partial claim
function claimPartial(address controller, uint256 sharesToClaim) external returns (uint256 assets) {
    RedemptionRequest storage claimable = claimableRedeemRequest[controller];
    require(claimable.status == RequestStatus.Claimable, "Not claimable");
    require(sharesToClaim <= claimable.shares, "Insufficient shares");

    // Calculate proportional assets
    assets = (sharesToClaim * claimable.assets) / claimable.shares;

    // Reduce remaining claimable amount
    claimable.shares -= sharesToClaim;
    claimable.assets -= assets;

    // If fully claimed, mark as Claimed
    if (claimable.shares == 0) {
        claimable.status = RequestStatus.Claimed;
    }

    // Transfer assets
    asset.transfer(claimable.owner, assets);
}
```

### 9.3 Revoked Operator

If an operator is revoked mid-flow:

1. **Pending requests**: Unaffected - operator revocation doesn't cancel requests
2. **Claim**: Revoked operator cannot claim (checked at claim time)
3. **Cancel**: Revoked operator cannot cancel

---

## 10. Testing Strategy

### 10.1 Unit Tests

```solidity
// Test status transitions
function test_Status_PendingToClaimable() public { ... }
function test_Status_ClaimableToClaimed() public { ... }
function test_Status_CancelRemovesPending() public { ... }

// Test ERC-7540 compliance
function test_ERC7540_pendingRedeemRequest() public { ... }
function test_ERC7540_claimableRedeemRequest() public { ... }
function test_ERC7540_requestRedeemEmitsEvent() public { ... }

// Test operator model
function test_Operator_CanRequestOnBehalf() public { ... }
function test_Operator_CanClaimOnBehalf() public { ... }
function test_Operator_RevocationPreventsActions() public { ... }

// Test totalAssets exclusion
function test_TotalAssets_ExcludesPending() public { ... }
function test_TotalAssets_IncludesClaimable() public { ... }
```

### 10.2 Integration Tests

- End-to-end request → settle → claim flow
- Operator authorization flows
- Extension layer interaction (epoch/NAV/pro-rata)

---

## 11. Extension Boundary Documentation

### 11.1 Base ERC-7540 (Standard)

- `requestRedeem()` - Create redemption request
- `redeem()` - Claim redeemed assets
- `pendingRedeemRequest()` - Query pending shares
- `claimableRedeemRequest()` - Query claimable shares
- `setOperator()` / `isOperator()` - Operator management
- `RequestStatus` enum - Pending/Claimable/Claimed

### 11.2 Vault Extensions (Non-Standard)

| Extension     | Purpose                            | Key Functions/Storage                                  |
| ------------- | ---------------------------------- | ------------------------------------------------------ |
| **Epoch**     | Weekly settlement windows          | `epochId`, `epochPendingControllers`, `EPOCH_DURATION` |
| **NAV**       | Net Asset Value tracking           | `currentNAV`, `lastNAVUpdate`, `claimableNavSnapshot`  |
| **Pro-Rata**  | Partial settlement for illiquidity | `proRataRatio`, `claimableProRataData`                 |
| **Emergency** | Pause functionality                | `emergencyMode`, `EMERGENCY_ROLE`                      |

---

## 12. References

- [EIP-7540](https://eips.ethereum.org/EIPS/eip-7540) - Asynchronous ERC-4626 Tokenized Vaults
- [EIP-165](https://eips.ethereum.org/EIPS/eip-165) - Standard Interface Detection
- [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626) - Tokenized Vault Standard
- Current contract: `contracts/src/WeeklyEpochVault.sol`
- Current API: `apps/vault-api/src/services/customVaultProvider.ts`
- Current schema: `apps/vault-api/src/db/schema.ts`

---

## 13. Appendix: Complete Interface Definition

```solidity
// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

interface IERC7540Redeem {
    event RedeemRequest(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        address sender,
        uint256 shares
    );

    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );

    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    ) external returns (uint256 requestId);

    function redeem(
        uint256 shares,
        address receiver,
        address controller
    ) external returns (uint256 assets);

    function pendingRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    function claimableRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);
}

interface IERC7540Operator {
    event OperatorSet(
        address indexed controller,
        address indexed operator,
        bool approved
    );

    function setOperator(address operator, bool approved) external returns (bool);
    function isOperator(address controller, address operator) external view returns (bool);
}

interface IERC7540 is IERC7540Redeem, IERC7540Operator {}
```

---

## Document History

| Version | Date       | Changes                        |
| ------- | ---------- | ------------------------------ |
| 1.0     | 2026-03-03 | Initial design document for T2 |
