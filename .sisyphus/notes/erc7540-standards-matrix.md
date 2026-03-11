# ERC-7540 Async Redemption Standards Matrix

> **Scope**: Async-redemption-only implementation. This document provides the authoritative mapping from ERC-7540 specification to concrete contract signatures for the WeeklyEpochVault rewrite.

**Version**: 1.0.0  
**Date**: 2026-03-03  
**Status**: Foundation document for T6 (Contract rewrite), T8 (ERC-165), T9 (Backend client)

---

## 1. SCOPE & GUARDRAILS

### 1.1 In Scope (REQUIRED)

- ERC-7540 asynchronous redemption flow (request → pending → claimable → claimed)
- ERC-7540 operator model (authorization and permissions)
- ERC-165 interface detection
- ERC-7575 compatibility (share() method)
- Async preview function overrides (MUST revert)

### 1.2 Explicitly OUT OF SCOPE

| Item                           | Status      | Note                                        |
| ------------------------------ | ----------- | ------------------------------------------- |
| Async deposit (requestDeposit) | ❌ EXCLUDED | Per guardrail - deposits remain synchronous |
| ERC-4626 sync redeem/withdraw  | ❌ EXCLUDED | All redemptions go through async flow       |
| UI redesign                    | ❌ EXCLUDED | Behavior changes only, no layout changes    |
| Migration/backfill logic       | ❌ EXCLUDED | Greenfield rewrite, no live deployment yet  |

### 1.3 Extension Boundaries (Non-Standard Additions)

The following features are preserved as **explicit extensions**, clearly marked and separated from base ERC-7540 compliance:

| Extension  | Description                                  | Implementation                                         |
| ---------- | -------------------------------------------- | ------------------------------------------------------ |
| `EPOCH`    | Weekly epoch-based settlement                | Settlement only processes requests at epoch boundaries |
| `NAV`      | NAV freshness requirements                   | Settlement blocked if NAV is stale                     |
| `PRO_RATA` | Pro-rata distribution on liquidity shortfall | Partial fulfillment when assets < obligations          |
| `CANCEL`   | Request cancellation                         | Custom function (not in ERC-7540 spec)                 |
| `ROLLOVER` | Unfilled request rollover                    | Custom extension for pro-rata scenarios                |

---

## 2. INTERFACE IDs (ERC-165)

| Interface          | ID           | Required | Description                               |
| ------------------ | ------------ | -------- | ----------------------------------------- |
| `IERC7540Redeem`   | `0x620ee8e4` | ✅ YES   | Async redemption methods                  |
| `IERC7540Operator` | `0xe3bc4e65` | ✅ YES   | Operator management (all ERC-7540 vaults) |
| `IERC7575`         | `0x2f0a18c5` | ✅ YES   | Tokenized vault standard (share() method) |
| `IERC7540Deposit`  | `0xce3bbe50` | ❌ NO    | Excluded per scope guardrail              |
| `IERC4626`         | `0x8090723d` | ✅ YES   | Base vault standard                       |
| `IERC20`           | `0x36372b07` | ✅ YES   | Token standard                            |
| `IERC165`          | `0x01ffc9a7` | ✅ YES   | Interface detection standard              |

### Interface ID Calculation

```solidity
// ERC-7540 Redeem: keccak256 of function selectors
bytes4 constant IERC7540_REDEEM_ID = 0x620ee8e4;
// requestRedeem + pendingRedeemRequest + claimableRedeemRequest
// + redeem + withdraw (overloaded with controller)

// ERC-7540 Operator: keccak256 of function selectors
bytes4 constant IERC7540_OPERATOR_ID = 0xe3bc4e65;
// setOperator + isOperator

// ERC-7575: keccak256 of function selectors
bytes4 constant IERC7575_ID = 0x2f0a18c5;
// share + asset + totalAssets + convertToShares + convertToAssets
```

---

## 3. REQUIRED FUNCTION SIGNATURES

### 3.1 Core Async Redemption Functions (IERC7540Redeem)

#### `requestRedeem`

```solidity
function requestRedeem(
    uint256 shares,
    address controller,
    address owner
) external returns (uint256 requestId);
```

| Parameter    | Type      | Description                                   |
| ------------ | --------- | --------------------------------------------- |
| `shares`     | `uint256` | Amount of shares to redeem                    |
| `controller` | `address` | Address that controls the request (can claim) |
| `owner`      | `address` | Address that owns the shares                  |

**Returns**: `requestId` - Unique identifier for the request (or 0 for aggregated model)

**Behavior**:

- Transfers `shares` from `owner` to vault
- Creates request in PENDING state
- `owner` MUST equal `msg.sender` unless `msg.sender` is approved operator
- MUST emit `RedeemRequest` event

**Current → New Mapping**:

```
Current: requestRedeem(uint256 _shares) returns (uint256 requestId)
New:     requestRedeem(uint256 shares, address controller, address owner) returns (uint256 requestId)

Migration:
- controller = msg.sender (original behavior)
- owner = msg.sender (self-owned)
- requestId = 0 (controller-aggregated model, see section 5)
```

---

#### `pendingRedeemRequest`

```solidity
function pendingRedeemRequest(
    uint256 requestId,
    address controller
) external view returns (uint256 shares);
```

| Parameter    | Type      | Description                                 |
| ------------ | --------- | ------------------------------------------- |
| `requestId`  | `uint256` | Request identifier (0 for aggregated model) |
| `controller` | `address` | Controller address to query                 |

**Returns**: `shares` - Amount of shares in PENDING state for this controller

**Behavior**:

- MUST NOT include claimable shares
- MUST NOT vary by caller
- MUST NOT revert (except overflow)

**Current → New Mapping**:

```
Current: getUserRequests(address _user) + check status == Pending
New:     pendingRedeemRequest(uint256 requestId, address controller)

Migration:
- requestId = 0 (aggregated model)
- controller = user address
- Sum all pending shares for controller
```

---

#### `claimableRedeemRequest`

```solidity
function claimableRedeemRequest(
    uint256 requestId,
    address controller
) external view returns (uint256 shares);
```

| Parameter    | Type      | Description                                 |
| ------------ | --------- | ------------------------------------------- |
| `requestId`  | `uint256` | Request identifier (0 for aggregated model) |
| `controller` | `address` | Controller address to query                 |

**Returns**: `shares` - Amount of shares in CLAIMABLE state for this controller

**Behavior**:

- MUST NOT include pending shares
- MUST NOT vary by caller
- MUST NOT revert (except overflow)
- Returns claimable SHARES (not assets)

**Current → New Mapping**:

```
Current: Sum claimableAssets from settled requests
New:     claimableRedeemRequest(uint256 requestId, address controller)

Migration:
- requestId = 0 (aggregated model)
- controller = user address
- Track claimable shares per controller separately
```

---

#### `redeem` (Async Override)

```solidity
function redeem(
    uint256 shares,
    address receiver,
    address controller
) external returns (uint256 assets);
```

| Parameter    | Type      | Description               |
| ------------ | --------- | ------------------------- |
| `shares`     | `uint256` | Amount of shares to claim |
| `receiver`   | `address` | Address to receive assets |
| `controller` | `address` | Controller of the request |

**Returns**: `assets` - Amount of assets transferred to receiver

**Behavior**:

- Does NOT transfer shares (already done in `requestRedeem`)
- Reduces `claimableRedeemRequest[controller]` by `shares`
- `controller` MUST equal `msg.sender` or `msg.sender` must be operator
- MUST emit `Withdraw` event with `controller` as first param

**Current → New Mapping**:

```
Current: claim(uint256 _requestId) - specific request claim
New:     redeem(uint256 shares, address receiver, address controller)

Migration:
- controller = msg.sender
- receiver = msg.sender (or specified)
- shares = amount from claimableRedeemRequest
- claimableRedeemRequest reduced by shares amount
```

---

#### `withdraw` (Async Override)

```solidity
function withdraw(
    uint256 assets,
    address receiver,
    address controller
) external returns (uint256 shares);
```

| Parameter    | Type      | Description                  |
| ------------ | --------- | ---------------------------- |
| `assets`     | `uint256` | Amount of assets to withdraw |
| `receiver`   | `address` | Address to receive assets    |
| `controller` | `address` | Controller of the request    |

**Returns**: `shares` - Amount of shares burned from claimable

**Behavior**:

- Does NOT transfer shares (already done in `requestRedeem`)
- Converts assets to shares using current exchange rate
- Reduces `claimableRedeemRequest[controller]` by calculated shares
- `controller` MUST equal `msg.sender` or `msg.sender` must be operator

---

### 3.2 Operator Functions (IERC7540Operator)

#### `setOperator`

```solidity
function setOperator(
    address operator,
    bool approved
) external returns (bool success);
```

| Parameter  | Type      | Description                             |
| ---------- | --------- | --------------------------------------- |
| `operator` | `address` | Address to grant/revoke operator status |
| `approved` | `bool`    | True to grant, false to revoke          |

**Returns**: `success` - Always returns `true`

**Behavior**:

- Sets operator status for `msg.sender` (as controller)
- Operator can act on behalf of controller
- MUST emit `OperatorSet` event

---

#### `isOperator`

```solidity
function isOperator(
    address controller,
    address operator
) external view returns (bool status);
```

| Parameter    | Type      | Description                 |
| ------------ | --------- | --------------------------- |
| `controller` | `address` | Controller address to check |
| `operator`   | `address` | Operator address to check   |

**Returns**: `status` - True if operator is approved for controller

**Behavior**:

- Returns current operator approval status
- MUST NOT vary by caller

---

### 3.3 ERC-165 Function

#### `supportsInterface`

```solidity
function supportsInterface(bytes4 interfaceId) external view returns (bool);
```

**Required Returns**:
| Interface ID | Return |
|--------------|--------|
| `0x620ee8e4` (IERC7540Redeem) | `true` |
| `0xe3bc4e65` (IERC7540Operator) | `true` |
| `0x2f0a18c5` (IERC7575) | `true` |
| `0xce3bbe50` (IERC7540Deposit) | `false` (excluded) |
| `0x01ffc9a7` (IERC165) | `true` |

---

### 3.4 Async Override Functions (MUST REVERT)

#### `previewRedeem`

```solidity
function previewRedeem(uint256 shares) external view returns (uint256);
```

**Behavior**: MUST revert for ALL callers and inputs in async redemption vaults.

**Rationale**: Exchange rate between shares and assets is not fixed until claim time. Cannot preview claim output.

---

#### `previewWithdraw`

```solidity
function previewWithdraw(uint256 assets) external view returns (uint256);
```

**Behavior**: MUST revert for ALL callers and inputs in async redemption vaults.

---

## 4. REQUIRED EVENTS

### 4.1 RedeemRequest

```solidity
event RedeemRequest(
    address indexed controller,
    address indexed owner,
    uint256 indexed requestId,
    address sender,
    uint256 shares
);
```

| Parameter    | Indexed | Description                       |
| ------------ | ------- | --------------------------------- |
| `controller` | ✅      | Address controlling the request   |
| `owner`      | ✅      | Address that owned the shares     |
| `requestId`  | ✅      | Request identifier                |
| `sender`     | ❌      | Address that called requestRedeem |
| `shares`     | ❌      | Amount of shares locked           |

**Current → New Mapping**:

```solidity
// Current custom event:
event RequestCreated(
    uint256 indexed requestId,
    address indexed user,
    uint256 shares,
    uint256 targetEpoch
);

// New ERC-7540 event:
event RedeemRequest(
    address indexed controller,
    address indexed owner,
    uint256 indexed requestId,
    address sender,
    uint256 shares
);

// Mapping:
// - controller = user (original caller)
// - owner = user (self-owned)
// - requestId = 0 (aggregated model)
// - sender = msg.sender
// - shares = shares
// - targetEpoch = extension data (emit separately if needed)
```

---

### 4.2 OperatorSet

```solidity
event OperatorSet(
    address indexed controller,
    address indexed operator,
    bool approved
);
```

| Parameter    | Indexed | Description                      |
| ------------ | ------- | -------------------------------- |
| `controller` | ✅      | Controller that set the operator |
| `operator`   | ✅      | Operator address                 |
| `approved`   | ❌      | New approval status              |

**Current**: No equivalent - this is new functionality

---

### 4.3 Withdraw (ERC-4626)

```solidity
event Withdraw(
    address indexed sender,
    address indexed receiver,
    address indexed owner,
    uint256 assets,
    uint256 shares
);
```

| Parameter  | Indexed | Description                                                  |
| ---------- | ------- | ------------------------------------------------------------ |
| `sender`   | ✅      | Address that called redeem/withdraw (controller or operator) |
| `receiver` | ✅      | Address receiving assets                                     |
| `owner`    | ✅      | Controller of the request                                    |
| `assets`   | ❌      | Amount of assets transferred                                 |
| `shares`   | ❌      | Amount of shares claimed                                     |

**Behavior Override for Async**:

- First param MUST be `controller` (not `msg.sender` if operator called)
- Third param is `controller` (request owner)

**Current → New Mapping**:

```solidity
// Current custom event:
event ClaimProcessed(
    uint256 indexed requestId,
    address indexed user,
    uint256 assets
);

// New ERC-7540 uses standard Withdraw:
event Withdraw(
    address indexed sender,    // controller
    address indexed receiver,  // asset receiver
    address indexed owner,     // controller (request owner)
    uint256 assets,
    uint256 shares
);
```

---

## 5. REQUEST SEMANTICS (REQUESTID = 0 MODEL)

### 5.1 Controller-Aggregated Model

This implementation uses **`requestId = 0`** semantics, meaning:

1. **Aggregation**: All requests from the same `controller` are aggregated
2. **Discrimination**: Requests are discriminated purely by `controller` address
3. **Fungibility**: Multiple requests from same controller are fungible
4. **State Tracking**: Pending and Claimable amounts tracked per-controller

### 5.2 State Mappings

```solidity
// Storage for aggregated model (requestId = 0)
mapping(address controller => uint256) public pendingRedeemRequest;
mapping(address controller => uint256) public claimableRedeemRequest;
mapping(address controller => uint256) public claimableAssets; // Extension: track assets per controller
```

### 5.3 Transition Behavior

| State         | Meaning                            | Trigger                         |
| ------------- | ---------------------------------- | ------------------------------- |
| **PENDING**   | Shares locked, awaiting settlement | `requestRedeem()` call          |
| **CLAIMABLE** | Shares processed, assets available | `settleEpoch()` extension call  |
| **CLAIMED**   | Assets transferred, shares burned  | `redeem()` or `withdraw()` call |

### 5.4 Request Lifecycle Flow

```
User calls requestRedeem(shares, controller, owner)
    ↓
Shares transferred from owner to vault
    ↓
pendingRedeemRequest[controller] += shares
    ↓
Emit RedeemRequest(controller, owner, 0, sender, shares)
    ↓
[EXTENSION: Epoch settlement occurs]
    ↓
Settler calls settleEpoch() (extension)
    ↓
pendingRedeemRequest[controller] -= shares
claimableRedeemRequest[controller] += shares
claimableAssets[controller] += assets
    ↓
User calls redeem(shares, receiver, controller)
    ↓
claimableRedeemRequest[controller] -= shares
Assets transferred to receiver
    ↓
Emit Withdraw(controller, receiver, controller, assets, shares)
```

---

## 6. AUTHORIZATION SEMANTICS

### 6.1 Actor Definitions

| Actor        | Role                   | Permissions                                     |
| ------------ | ---------------------- | ----------------------------------------------- |
| `owner`      | Share owner            | Initially owns shares, can approve operators    |
| `controller` | Request controller     | Can claim redeem requests, authorizes operators |
| `operator`   | Delegated actor        | Can act on behalf of controller if approved     |
| `sender`     | Transaction originator | May be controller or operator                   |

### 6.2 Authorization Matrix

| Action          | Caller Authorization                                               | Notes                                   |
| --------------- | ------------------------------------------------------------------ | --------------------------------------- |
| `requestRedeem` | `msg.sender == owner` OR `isOperator[owner][msg.sender]`           | Operator can request on behalf of owner |
| `redeem`        | `msg.sender == controller` OR `isOperator[controller][msg.sender]` | Controller or operator can claim        |
| `withdraw`      | `msg.sender == controller` OR `isOperator[controller][msg.sender]` | Controller or operator can claim        |
| `setOperator`   | Always `msg.sender` as controller                                  | Cannot set operator for others          |

### 6.3 Operator Trust Model

Approving an operator grants the operator authority over:

- The `asset` of the vault (can trigger redemptions)
- The `share` of the vault (can request redemptions)

**WARNING**: Users must fully trust any approved operator.

---

## 7. EXTENSION SPECIFICATIONS

### 7.1 EPOCH Extension

```solidity
// Non-standard extension for weekly epoch settlement
function settleEpoch(uint256 epochId, uint256 availableAssets) external;
function settleEpochChunked(uint256 epochId) external;

// View functions
function getCurrentEpoch() external view returns (uint256);
function getEpochEnd(uint256 epochId) external view returns (uint256);
```

**Behavior**:

- Settlement only processes requests at epoch boundaries
- `requestRedeem` assigns requests to target epoch
- Requests become claimable after epoch settlement

---

### 7.2 NAV Extension

```solidity
// Non-standard extension for NAV freshness
function updateNAV(uint256 nav) external;
function isNAVFresh() external view returns (bool);
```

**Behavior**:

- Settlement blocked if NAV is stale (> 6 hours)
- NAV used for calculating claimable assets

---

### 7.3 PRO_RATA Extension

```solidity
// Non-standard extension for partial fulfillment
struct SettlementStatus {
    uint256 totalShares;
    uint256 totalProcessed;
    bool settled;
    uint256 proRataRatio;  // 1e18 = 100%
    uint256 availableAssets;
}
```

**Behavior**:

- When `availableAssets < totalShares`, pro-rata distribution applied
- Users receive partial fulfillment based on ratio

---

### 7.4 CANCEL Extension (Non-Standard)

```solidity
// NOT in ERC-7540 spec - custom extension
function cancelRedemption(uint256 shares) external returns (bool);
```

**Behavior**:

- Allows cancelling pending requests before epoch cutoff
- Returns shares to owner
- Removes from `pendingRedeemRequest[controller]`

**Note**: Cancellation is not standardized in ERC-7540. This is an implementation-specific extension.

---

## 8. CURRENT → NEW MAPPING TABLE

| Current (Custom)                       | New (ERC-7540)                                                                  | Change Type                 |
| -------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| `requestRedeem(uint256 _shares)`       | `requestRedeem(uint256 shares, address controller, address owner)`              | Signature change            |
| `claim(uint256 _requestId)`            | `redeem(uint256 shares, address receiver, address controller)`                  | Signature + semantics       |
| `cancelRedemption(uint256 _requestId)` | `cancelRedemption(uint256 shares)`                                              | Retained as extension       |
| `getRequest(uint256)`                  | `pendingRedeemRequest(0, controller)` + `claimableRedeemRequest(0, controller)` | Split into standard views   |
| `RequestCreated` event                 | `RedeemRequest` event                                                           | Event rename + params       |
| `ClaimProcessed` event                 | `Withdraw` event                                                                | Use standard ERC-4626 event |
| `userRequests` mapping                 | `pendingRedeemRequest` + `claimableRedeemRequest`                               | Storage restructure         |
| N/A                                    | `setOperator(address, bool)`                                                    | New functionality           |
| N/A                                    | `isOperator(address, address)`                                                  | New functionality           |
| N/A                                    | `supportsInterface(bytes4)`                                                     | New functionality (ERC-165) |
| `previewRedeem` (if exists)            | `previewRedeem` (MUST revert)                                                   | Override behavior           |

---

## 9. TESTING REQUIREMENTS

### 9.1 Interface ID Tests

- `supportsInterface(0x620ee8e4)` returns `true`
- `supportsInterface(0xe3bc4e65)` returns `true`
- `supportsInterface(0x2f0a18c5)` returns `true`
- `supportsInterface(0xce3bbe50)` returns `false` (deposit excluded)
- `supportsInterface(0x01ffc9a7)` returns `true` (ERC-165)
- `supportsInterface(0xffffffff)` returns `false` (invalid)

### 9.2 Operator Tests

- Operator can call `requestRedeem` on behalf of owner
- Operator can call `redeem` on behalf of controller
- Revoked operator cannot perform restricted actions
- Non-operator cannot perform restricted actions

### 9.3 Preview Override Tests

- `previewRedeem(any)` reverts
- `previewWithdraw(any)` reverts

### 9.4 Lifecycle Tests

- `requestRedeem` → `pendingRedeemRequest` increases
- Settlement → `claimableRedeemRequest` increases, `pendingRedeemRequest` decreases
- `redeem` → `claimableRedeemRequest` decreases, assets transferred
- `Withdraw` event emitted with correct parameters

### 9.5 Authorization Tests

- Owner can request for self
- Non-owner cannot request without operator approval
- Controller can redeem for self
- Non-controller cannot redeem without operator approval

---

## 10. ABI COMPATIBILITY NOTES

### For Backend (customVaultClient.ts)

| ABI Change                   | Impact                              |
| ---------------------------- | ----------------------------------- |
| `requestRedeem` new params   | Update function signature in ABI    |
| `claim` removed              | Replace with `redeem` or `withdraw` |
| `pendingRedeemRequest` new   | Add to ABI                          |
| `claimableRedeemRequest` new | Add to ABI                          |
| `setOperator` new            | Add to ABI                          |
| `isOperator` new             | Add to ABI                          |
| `supportsInterface` new      | Add to ABI                          |
| Events renamed               | Update event parsing logic          |

### For Frontend (api.ts)

| API Change          | Impact                                                  |
| ------------------- | ------------------------------------------------------- |
| Request creation    | Pass controller = owner = connected address             |
| Status checking     | Query `pendingRedeemRequest` + `claimableRedeemRequest` |
| Claim action        | Call `redeem(shares, receiver, controller)`             |
| Operator management | New feature - can be exposed in UI                      |

---

## 11. REFERENCES

### Standards Documents

- [ERC-7540](https://eips.ethereum.org/EIPS/eip-7540) - Asynchronous ERC-4626 Tokenized Vaults
- [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626) - Tokenized Vaults
- [ERC-165](https://eips.ethereum.org/EIPS/eip-165) - Standard Interface Detection
- [ERC-7575](https://eips.ethereum.org/EIPS/eip-7575) - Tokenized Vaults Standard

### Project Files

- `contracts/src/WeeklyEpochVault.sol` - Current contract implementation
- `apps/vault-api/src/services/customVaultClient.ts` - Backend ABI assumptions
- `apps/vault-web/src/lib/api.ts` - Frontend API contracts
- `.sisyphus/plans/erc7540-rewrite-plan.md` - Full rewrite plan

---

## 12. REVISION HISTORY

| Version | Date       | Changes                                            |
| ------- | ---------- | -------------------------------------------------- |
| 1.0.0   | 2026-03-03 | Initial standards matrix for async-redemption-only |

---

_This document is READ-ONLY for implementation reference. Any deviations from ERC-7540 spec must be explicitly marked as EXTENSION._
