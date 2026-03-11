# ERC-7540 Vault Interface Specification

> **Document Type**: Technical Interface Specification (TIS)  
> **Version**: 1.0.0  
> **Date**: 2026-03-03  
> **Status**: PRIMARY REFERENCE for T6-T8  
> **Scope**: Async-redemption-only implementation per ERC-7540

---

## 1. DOCUMENT PURPOSE

This specification defines the exact contract interface surface for the ERC-7540-compliant WeeklyEpochVault rewrite. It serves as the authoritative reference for:

- **T6**: Contract function/signature rewrite
- **T7**: Operator model and permission enforcement
- **T8**: Async preview override and ERC-165 support

All function signatures, events, errors, behaviors, and state transitions are specified herein.

---

## 2. STANDARDS COMPLIANCE

### 2.1 Implemented Standards

| Standard          | Interface ID | Status      | Notes                         |
| ----------------- | ------------ | ----------- | ----------------------------- |
| ERC-7540 Redeem   | `0x620ee8e4` | ✅ REQUIRED | Async redemption core         |
| ERC-7540 Operator | `0xe3bc4e65` | ✅ REQUIRED | Authorization delegation      |
| ERC-7575          | `0x2f0a18c5` | ✅ REQUIRED | Tokenized vault (`share()`)   |
| ERC-4626          | `0x8090723d` | ✅ REQUIRED | Base vault standard           |
| ERC-20            | `0x36372b07` | ✅ REQUIRED | Token standard                |
| ERC-165           | `0x01ffc9a7` | ✅ REQUIRED | Interface detection           |
| ERC-7540 Deposit  | `0xce3bbe50` | ❌ EXCLUDED | Per guardrail - deposits sync |

### 2.2 Interface ID Calculation

```solidity
// ERC-7540 Redeem Interface ID
// = keccak256 of function selectors for:
//   requestRedeem(uint256,address,address)
//   pendingRedeemRequest(uint256,address)
//   claimableRedeemRequest(uint256,address)
//   redeem(uint256,address,address)
//   withdraw(uint256,address,address)
bytes4 constant IERC7540_REDEEM_ID = 0x620ee8e4;

// ERC-7540 Operator Interface ID
// = keccak256 of function selectors for:
//   setOperator(address,bool)
//   isOperator(address,address)
bytes4 constant IERC7540_OPERATOR_ID = 0xe3bc4e65;

// ERC-7575 Interface ID
// = keccak256 of function selectors for:
//   share(), asset(), totalAssets(), convertToShares(uint256), convertToAssets(uint256)
bytes4 constant IERC7575_ID = 0x2f0a18c5;

// ERC-4626 Interface ID
bytes4 constant IERC4626_ID = 0x8090723d;

// ERC-165 Interface ID
bytes4 constant IERC165_ID = 0x01ffc9a7;
```

---

## 3. INTERFACE DEFINITIONS

### 3.1 IERC7540Redeem

```solidity
/// @title ERC-7540 Asynchronous Redemption Interface
/// @notice Interface for vaults with async redemption flows
/// @dev Request ID = 0 indicates controller-aggregated model
interface IERC7540Redeem {

    /// @notice Request a redemption of shares
    /// @dev Locks shares in vault, creates pending request
    /// @param shares Amount of shares to redeem
    /// @param controller Address controlling the request (can claim)
    /// @param owner Address owning the shares
    /// @return requestId Unique identifier (0 for aggregated model)
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    ) external returns (uint256 requestId);

    /// @notice Get pending redemption shares for controller
    /// @dev Returns shares in PENDING state only
    /// @param requestId Request identifier (0 for aggregated model)
    /// @param controller Controller address to query
    /// @return shares Amount of shares pending redemption
    function pendingRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @notice Get claimable redemption shares for controller
    /// @dev Returns shares in CLAIMABLE state only
    /// @param requestId Request identifier (0 for aggregated model)
    /// @param controller Controller address to query
    /// @return shares Amount of shares ready to claim
    function claimableRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @notice Claim redeemed assets
    /// @dev Reduces claimable shares, transfers assets
    /// @param shares Amount of shares to claim
    /// @param receiver Address to receive assets
    /// @param controller Controller of the request
    /// @return assets Amount of assets transferred
    function redeem(
        uint256 shares,
        address receiver,
        address controller
    ) external returns (uint256 assets);

    /// @notice Claim assets by specifying output amount
    /// @dev Calculates shares needed, reduces claimable, transfers assets
    /// @param assets Amount of assets to withdraw
    /// @param receiver Address to receive assets
    /// @param controller Controller of the request
    /// @return shares Amount of shares claimed
    function withdraw(
        uint256 assets,
        address receiver,
        address controller
    ) external returns (uint256 shares);
}
```

### 3.2 IERC7540Operator

```solidity
/// @title ERC-7540 Operator Interface
/// @notice Interface for delegation of redemption request control
interface IERC7540Operator {

    /// @notice Set operator approval status
    /// @dev msg.sender is the controller being operated on behalf of
    /// @param operator Address to grant/revoke operator status
    /// @param approved True to grant, false to revoke
    /// @return success Always returns true
    function setOperator(
        address operator,
        bool approved
    ) external returns (bool success);

    /// @notice Check if address is approved operator for controller
    /// @param controller Controller address to check
    /// @param operator Operator address to check
    /// @return status True if operator is approved
    function isOperator(
        address controller,
        address operator
    ) external view returns (bool status);
}
```

### 3.3 IERC7540 (Complete)

```solidity
/// @title ERC-7540 Complete Interface
/// @notice Combines Redeem and Operator interfaces
interface IERC7540 is IERC7540Redeem, IERC7540Operator {}
```

### 3.4 IERC165

```solidity
/// @title ERC-165 Interface Detection
/// @notice Standard interface for querying supported interfaces
interface IERC165 {
    /// @notice Query if contract implements interface
    /// @param interfaceId Interface identifier (XOR of function selectors)
    /// @return supported True if interface is supported
    function supportsInterface(bytes4 interfaceId) external view returns (bool supported);
}
```

---

## 4. EVENT SPECIFICATIONS

### 4.1 RedeemRequest Event

```solidity
/// @notice Emitted when redemption request is created
/// @param controller Indexed: Controller address (can claim)
/// @param owner Indexed: Owner of shares
/// @param requestId Indexed: Request identifier
/// @param sender Address that called requestRedeem
/// @param shares Amount of shares locked
event RedeemRequest(
    address indexed controller,
    address indexed owner,
    uint256 indexed requestId,
    address sender,
    uint256 shares
);
```

**Event Behavior**:

- MUST be emitted by `requestRedeem()`
- MUST include all indexed parameters
- `requestId` = 0 for controller-aggregated model
- `sender` may differ from `controller` if operator called

**Current → New Mapping**:

```solidity
// Current (custom):
event RequestCreated(
    uint256 indexed requestId,
    address indexed user,
    uint256 shares,
    uint256 targetEpoch
);

// New (ERC-7540):
event RedeemRequest(
    address indexed controller,
    address indexed owner,
    uint256 indexed requestId,
    address sender,
    uint256 shares
);

// Mapping:
// - controller = user (original requester)
// - owner = user (self-owned)
// - requestId = 0 (aggregated model)
// - sender = msg.sender
// - shares = shares
// - targetEpoch = emit separately in extension event
```

### 4.2 OperatorSet Event

```solidity
/// @notice Emitted when operator approval changes
/// @param controller Indexed: Controller that set operator
/// @param operator Indexed: Operator address
/// @param approved New approval status (true = approved)
event OperatorSet(
    address indexed controller,
    address indexed operator,
    bool approved
);
```

**Event Behavior**:

- MUST be emitted by `setOperator()`
- MUST emit on both grant and revoke
- `controller` is always `msg.sender`

**Current**: No equivalent (new functionality)

### 4.3 Withdraw Event (ERC-4626 Override)

```solidity
/// @notice Emitted when assets are claimed/redeemed
/// @param sender Indexed: Controller (or operator) claiming
/// @param receiver Indexed: Asset receiver
/// @param owner Indexed: Controller of request
/// @param assets Amount of assets transferred
/// @param shares Amount of shares claimed
event Withdraw(
    address indexed sender,
    address indexed receiver,
    address indexed owner,
    uint256 assets,
    uint256 shares
);
```

**Event Behavior**:

- MUST be emitted by `redeem()` and `withdraw()`
- First param MUST be `controller` (not `msg.sender` if operator)
- Third param is `controller` (request owner)
- Shares already transferred in `requestRedeem()`, so no share transfer

**Current → New Mapping**:

```solidity
// Current (custom):
event ClaimProcessed(
    uint256 indexed requestId,
    address indexed user,
    uint256 assets
);

// New (ERC-7540 uses standard Withdraw):
event Withdraw(
    address indexed sender,    // controller
    address indexed receiver,  // asset receiver
    address indexed owner,     // controller
    uint256 assets,
    uint256 shares
);
```

---

## 5. CUSTOM ERROR SPECIFICATIONS

### 5.1 ERC-7540 Standard Errors

```solidity
// Authorization Errors
/// @notice Caller is not authorized (not owner/controller/operator)
/// @param caller The unauthorized caller address
error Unauthorized(address caller);

/// @notice Caller is not the controller or approved operator
/// @param controller Expected controller
/// @param caller Actual caller
error NotController(address controller, address caller);

/// @notice Caller is not the owner or approved operator
/// @param owner Expected owner
/// @param caller Actual caller
error NotOwner(address owner, address caller);

// State Errors
/// @notice No pending redeem request exists for controller
/// @param controller Controller address queried
error NoPendingRequest(address controller);

/// @notice No claimable redeem request exists for controller
/// @param controller Controller address queried
error NoClaimableRequest(address controller);

/// @notice Insufficient claimable shares
/// @param requested Amount requested to claim
/// @param available Amount actually available
error InsufficientClaimableShares(uint256 requested, uint256 available);

/// @notice Amount must be greater than zero
error ZeroAmount();

/// @notice Invalid address (zero address)
error InvalidAddress();

// Preview Override Errors
/// @notice Preview functions not supported in async redemption vaults
error PreviewNotSupported();
```

### 5.2 Extension Errors (Non-Standard)

```solidity
// Epoch Errors
/// @notice Epoch has not ended yet
/// @param epochId Epoch being queried
/// @param epochEnd Timestamp when epoch ends
error EpochNotEnded(uint256 epochId, uint256 epochEnd);

/// @notice Epoch has already been settled
/// @param epochId Epoch being settled
error AlreadySettled(uint256 epochId);

/// @notice No pending requests in epoch
/// @param epochId Epoch being settled
error NoPendingRequests(uint256 epochId);

// NAV Errors
/// @notice NAV is stale (older than threshold)
/// @param lastUpdate Timestamp of last NAV update
/// @param threshold Maximum allowed staleness
error NAVStale(uint256 lastUpdate, uint256 threshold);

/// @notice Settlement is incomplete (chunked processing)
/// @param epochId Epoch being settled
error SettlementIncomplete(uint256 epochId);

// Cancellation Errors (Extension)
/// @notice Cannot cancel after settlement cutoff
/// @param epochId Target epoch
/// @param epochEnd Settlement cutoff time
error CannotCancelAfterSettlement(uint256 epochId, uint256 epochEnd);

/// @notice Request has already been cancelled
error AlreadyCancelled();

// Emergency Errors
/// @notice Emergency mode is active
error EmergencyModeActive();
```

---

## 6. FUNCTION BEHAVIOR SPECIFICATIONS

### 6.1 requestRedeem

```solidity
function requestRedeem(
    uint256 shares,
    address controller,
    address owner
) external returns (uint256 requestId);
```

**NatSpec**:

```solidity
/// @notice Creates an asynchronous redemption request
/// @dev Transfers shares from owner to vault, locks until settlement
/// @param shares Amount of vault shares to redeem
/// @param controller Address that will control the request (can claim)
/// @param owner Address that owns the shares being redeemed
/// @return requestId Unique identifier for the request (0 = aggregated)
///
/// Requirements:
/// - `shares` > 0
/// - `controller` != address(0)
/// - `owner` != address(0)
/// - `owner` must have approved vault to spend `shares`
/// - `msg.sender` must be `owner` OR approved operator for `owner`
/// - Emergency mode must NOT be active
///
/// Effects:
/// - Transfers `shares` from `owner` to vault
/// - Adds `shares` to `pendingRedeemRequest[controller]`
/// - Increases `totalPendingRedeemShares` by `shares`
/// - Assigns to current epoch (extension)
/// - Emits `RedeemRequest(controller, owner, 0, msg.sender, shares)`
///
/// @custom:erc7540 Standard function - required
/// @custom:events Emits RedeemRequest
/// @custom:access Owner or operator
```

**Behavior Matrix**:
| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Happy path | shares=100, controller=A, owner=A | Success, request created |
| Operator request | shares=100, controller=A, owner=B (where msg.sender is operator for B) | Success, owner=B's shares used |
| Zero shares | shares=0 | Revert: ZeroAmount() |
| Zero controller | controller=address(0) | Revert: InvalidAddress() |
| Zero owner | owner=address(0) | Revert: InvalidAddress() |
| Unauthorized | owner=B, msg.sender=C (not operator) | Revert: NotOwner(B, C) |
| Emergency mode | emergencyMode=true | Revert: EmergencyModeActive() |
| Multiple requests | controller=A calls twice | Shares accumulate in pending |

**State Changes**:

```solidity
// Preconditions: owner has approved shares, authorization valid
pendingRedeemRequest[controller].shares += shares;
totalPendingRedeemShares += shares;
// Transfer shares from owner to vault
IERC20(address(this)).transferFrom(owner, address(this), shares);
// Emit event
emit RedeemRequest(controller, owner, 0, msg.sender, shares);
```

---

### 6.2 pendingRedeemRequest

```solidity
function pendingRedeemRequest(
    uint256 requestId,
    address controller
) external view returns (uint256 shares);
```

**NatSpec**:

```solidity
/// @notice Get the amount of pending shares for a controller
/// @dev ERC-7540 required view function
/// @param requestId Request identifier (0 for aggregated model)
/// @param controller Controller address to query
/// @return shares Amount of shares in pending state
///
/// Requirements:
/// - MUST NOT revert for valid inputs
/// - MUST NOT include claimable shares
/// - MUST return 0 if no pending request
///
/// @custom:erc7540 Standard function - required
/// @custom:access View - no restrictions
```

**Behavior Matrix**:
| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Has pending | controller=A with 100 pending | Returns 100 |
| No pending | controller=B with no requests | Returns 0 |
| After settlement | controller=A after epoch settled | Returns 0 |
| After partial claim | controller=A with 50 claimed from 100 | Returns 0 (claimable reduced) |

**Implementation**:

```solidity
function pendingRedeemRequest(uint256 requestId, address controller)
    external
    view
    returns (uint256)
{
    // requestId ignored for aggregated model
    return pendingRedeemRequest[controller].shares;
}
```

---

### 6.3 claimableRedeemRequest

```solidity
function claimableRedeemRequest(
    uint256 requestId,
    address controller
) external view returns (uint256 shares);
```

**NatSpec**:

```solidity
/// @notice Get the amount of claimable shares for a controller
/// @dev ERC-7540 required view function
/// @param requestId Request identifier (0 for aggregated model)
/// @param controller Controller address to query
/// @return shares Amount of shares in claimable state
///
/// Requirements:
/// - MUST NOT revert for valid inputs
/// - MUST NOT include pending shares
/// - MUST return shares (not assets)
/// - MUST return 0 if no claimable request
///
/// @custom:erc7540 Standard function - required
/// @custom:access View - no restrictions
```

**Behavior Matrix**:
| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Has claimable | controller=A with 100 claimable | Returns 100 |
| No claimable | controller=A with pending only | Returns 0 |
| After full claim | controller=A after claiming 100 | Returns 0 |
| After partial claim | controller=A after claiming 50 | Returns 50 |

**Implementation**:

```solidity
function claimableRedeemRequest(uint256 requestId, address controller)
    external
    view
    returns (uint256)
{
    // requestId ignored for aggregated model
    return claimableRedeemRequest[controller].shares;
}
```

---

### 6.4 redeem

```solidity
function redeem(
    uint256 shares,
    address receiver,
    address controller
) external returns (uint256 assets);
```

**NatSpec**:

```solidity
/// @notice Claim assets for claimable shares
/// @dev Reduces claimable shares, transfers assets to receiver
/// @param shares Amount of shares to claim (must be <= claimable)
/// @param receiver Address to receive the assets
/// @param controller Controller of the request being claimed
/// @return assets Amount of assets transferred to receiver
///
/// Requirements:
/// - `shares` > 0
/// - `receiver` != address(0)
/// - `controller` != address(0)
/// - `controller` must have claimable shares >= `shares`
/// - `msg.sender` must be `controller` OR approved operator for `controller`
///
/// Effects:
/// - Reduces `claimableRedeemRequest[controller]` by `shares`
/// - Calculates `assets` based on settlement NAV
/// - Transfers `assets` from vault to `receiver`
/// - If all shares claimed, marks request as Claimed
/// - Emits `Withdraw(controller, receiver, controller, assets, shares)`
///
/// @custom:erc7540 Standard function - required
/// @custom:events Emits Withdraw
/// @custom:access Controller or operator
```

**Behavior Matrix**:
| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Happy path | shares=100, receiver=A, controller=A (with 100 claimable) | Success, assets transferred |
| Operator claim | shares=100, receiver=B, controller=A (where msg.sender is operator for A) | Success, B receives assets |
| Zero shares | shares=0 | Revert: ZeroAmount() |
| Insufficient | shares=100, controller=A (with 50 claimable) | Revert: InsufficientClaimableShares(100, 50) |
| Unauthorized | controller=A, msg.sender=B (not operator) | Revert: NotController(A, B) |
| Partial claim | shares=50, controller=A (with 100 claimable) | Success, 50 remain claimable |

**State Changes**:

```solidity
// Preconditions: authorization valid, sufficient claimable shares
RedemptionRequest storage claimable = claimableRedeemRequest[controller];
require(claimable.shares >= shares, InsufficientClaimableShares);

// Calculate assets
assets = convertSharesToAssets(shares, claimable.navSnapshot);

// Update state
claimable.shares -= shares;
claimable.assets -= assets;

// If fully claimed, mark status
if (claimable.shares == 0) {
    claimable.status = RequestStatus.Claimed;
}

// Transfer assets
asset.safeTransfer(receiver, assets);

// Emit event
emit Withdraw(controller, receiver, controller, assets, shares);
```

---

### 6.5 withdraw

```solidity
function withdraw(
    uint256 assets,
    address receiver,
    address controller
) external returns (uint256 shares);
```

**NatSpec**:

```solidity
/// @notice Claim assets by specifying asset amount
/// @dev Calculates shares needed, reduces claimable, transfers assets
/// @param assets Amount of assets to withdraw
/// @param receiver Address to receive the assets
/// @param controller Controller of the request being claimed
/// @return shares Amount of shares consumed
///
/// Requirements:
/// - `assets` > 0
/// - `receiver` != address(0)
/// - `controller` != address(0)
/// - `controller` must have claimable assets >= `assets`
/// - `msg.sender` must be `controller` OR approved operator for `controller`
///
/// Effects:
/// - Calculates `shares` from `assets` using settlement NAV
/// - Reduces `claimableRedeemRequest[controller]` by `shares`
/// - Transfers `assets` from vault to `receiver`
/// - If all shares claimed, marks request as Claimed
/// - Emits `Withdraw(controller, receiver, controller, assets, shares)`
///
/// @custom:erc7540 Standard function - required
/// @custom:events Emits Withdraw
/// @custom:access Controller or operator
```

**Behavior Matrix**:
| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Happy path | assets=100, receiver=A, controller=A (with 100+ assets claimable) | Success, shares calculated |
| Exceeds claimable | assets=100, controller=A (with 50 assets claimable) | Revert: InsufficientClaimableShares |

**Implementation Notes**:

- Converts assets to shares: `shares = (assets * 1e18) / nav`
- Then behaves identically to `redeem()` with calculated shares

---

### 6.6 setOperator

```solidity
function setOperator(
    address operator,
    bool approved
) external returns (bool success);
```

**NatSpec**:

```solidity
/// @notice Approve or revoke an operator for msg.sender
/// @dev Operator can act on behalf of controller (msg.sender)
/// @param operator Address to set operator status for
/// @param approved True to approve, false to revoke
/// @return success Always returns true
///
/// Requirements:
/// - `operator` != address(0)
/// - Can be called by any address to set operators for themselves
///
/// Effects:
/// - Sets `isOperator[msg.sender][operator] = approved`
/// - Emits `OperatorSet(msg.sender, operator, approved)`
///
/// @custom:erc7540 Standard function - required
/// @custom:events Emits OperatorSet
/// @custom:access Any (self-administered)
```

**Behavior Matrix**:
| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Grant operator | operator=B, approved=true (msg.sender=A) | Success, B can act for A |
| Revoke operator | operator=B, approved=false (msg.sender=A) | Success, B cannot act for A |
| Zero operator | operator=address(0) | Revert: InvalidAddress() |
| Re-grant | operator=B, approved=true (already true) | Success (no-op, event emitted) |
| Revoke non-operator | operator=C, approved=false (C was never operator) | Success (no-op, event emitted) |

**State Changes**:

```solidity
// Preconditions: operator != address(0)
isOperator[msg.sender][operator] = approved;
emit OperatorSet(msg.sender, operator, approved);
return true;
```

---

### 6.7 isOperator

```solidity
function isOperator(
    address controller,
    address operator
) external view returns (bool status);
```

**NatSpec**:

```solidity
/// @notice Check if address is approved operator for controller
/// @dev ERC-7540 required view function
/// @param controller Controller address to check
/// @param operator Operator address to check
/// @return status True if operator is approved for controller
///
/// Requirements:
/// - MUST NOT revert for valid inputs
/// - MUST return false if never set
///
/// @custom:erc7540 Standard function - required
/// @custom:access View - no restrictions
```

**Implementation**:

```solidity
function isOperator(address controller, address operator)
    external
    view
    returns (bool)
{
    return isOperator[controller][operator];
}
```

---

### 6.8 supportsInterface

```solidity
function supportsInterface(bytes4 interfaceId) external view returns (bool);
```

**NatSpec**:

```solidity
/// @notice Query if contract implements an interface
/// @dev ERC-165 required function
/// @param interfaceId Interface identifier (first 4 bytes of keccak256 of function selectors)
/// @return supported True if contract implements interface
///
/// Supported Interfaces:
/// - 0x620ee8e4 (IERC7540Redeem) = true
/// - 0xe3bc4e65 (IERC7540Operator) = true
/// - 0x2f0a18c5 (IERC7575) = true
/// - 0x8090723d (IERC4626) = true
/// - 0x36372b07 (IERC20) = true
/// - 0x01ffc9a7 (IERC165) = true
/// - 0xce3bbe50 (IERC7540Deposit) = false
/// - 0xffffffff = false (EIP-165 requirement)
///
/// @custom:erc165 Standard function - required
/// @custom:access View - no restrictions
```

**Return Values**:
| Interface ID | Interface | Return Value |
|--------------|-----------|--------------|
| 0x620ee8e4 | IERC7540Redeem | true |
| 0xe3bc4e65 | IERC7540Operator | true |
| 0x2f0a18c5 | IERC7575 | true |
| 0x8090723d | IERC4626 | true |
| 0x36372b07 | IERC20 | true |
| 0x01ffc9a7 | IERC165 | true |
| 0xce3bbe50 | IERC7540Deposit | false |
| 0xffffffff | Invalid | false |
| Any other | Unknown | false |

**Implementation**:

```solidity
function supportsInterface(bytes4 interfaceId)
    public
    view
    virtual
    override
    returns (bool)
{
    return interfaceId == type(IERC7540Redeem).interfaceId
        || interfaceId == type(IERC7540Operator).interfaceId
        || interfaceId == type(IERC7575).interfaceId
        || interfaceId == type(IERC4626).interfaceId
        || interfaceId == type(IERC20).interfaceId
        || interfaceId == type(IERC165).interfaceId;
}
```

---

### 6.9 Async Preview Overrides

```solidity
function previewRedeem(uint256 shares) external view returns (uint256);
function previewWithdraw(uint256 assets) external view returns (uint256);
```

**NatSpec**:

```solidity
/// @notice Preview redeem is NOT supported in async vaults
/// @dev ERC-7540 async vaults MUST revert on preview functions
/// @param shares Amount of shares (ignored)
/// @return assets Never returns - always reverts
///
/// Reverts: PreviewNotSupported()
///
/// Rationale: Exchange rate not fixed until settlement time
///
/// @custom:erc7540 Async override - must revert
```

**Behavior**: MUST revert for ALL inputs

**Implementation**:

```solidity
function previewRedeem(uint256) external pure override returns (uint256) {
    revert PreviewNotSupported();
}

function previewWithdraw(uint256) external pure override returns (uint256) {
    revert PreviewNotSupported();
}
```

---

## 7. ACCESS CONTROL MATRIX

### 7.1 Actor Definitions

| Actor          | Definition                                       | Key Capabilities                                            |
| -------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| **Owner**      | Address that owned shares before `requestRedeem` | Can approve operators, initially owns shares                |
| **Controller** | Address specified in `requestRedeem`             | Controls request lifecycle, can claim, authorizes operators |
| **Operator**   | Address approved by Controller via `setOperator` | Can act on behalf of controller for request/claim           |
| **Sender**     | `msg.sender` of transaction                      | May be controller or operator                               |

### 7.2 Authorization Matrix

| Function                 | Caller Authorization                                               | Parameter Checks                        | Revert Condition                                                   |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------ |
| `requestRedeem`          | `msg.sender == owner` OR `isOperator[owner][msg.sender]`           | owner != 0, controller != 0, shares > 0 | `NotOwner()`, `InvalidAddress()`, `ZeroAmount()`                   |
| `redeem`                 | `msg.sender == controller` OR `isOperator[controller][msg.sender]` | shares <= claimable, shares > 0         | `NotController()`, `InsufficientClaimableShares()`, `ZeroAmount()` |
| `withdraw`               | `msg.sender == controller` OR `isOperator[controller][msg.sender]` | assets <= claimableAssets, assets > 0   | `NotController()`, `InsufficientClaimableShares()`, `ZeroAmount()` |
| `setOperator`            | None (self-administered)                                           | operator != 0                           | `InvalidAddress()`                                                 |
| `isOperator`             | None (view)                                                        | None                                    | Never reverts                                                      |
| `pendingRedeemRequest`   | None (view)                                                        | None                                    | Never reverts                                                      |
| `claimableRedeemRequest` | None (view)                                                        | None                                    | Never reverts                                                      |
| `supportsInterface`      | None (view)                                                        | None                                    | Never reverts                                                      |

### 7.3 Permission Flow Diagram

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│    Owner    │────────▶│  Approves   │────────▶│  Operator   │
│  (of shares)│         │  Operator   │         │ (delegated) │
└──────┬──────┘         └─────────────┘         └──────┬──────┘
       │                                                │
       │ calls requestRedeem()                          │ can call
       │ (owner=Owner, controller=Controller)           │ requestRedeem()
       ▼                                                │ on behalf of Owner
┌─────────────┐                                         │
│   Pending   │◀────────────────────────────────────────┘
│   Request   │
└──────┬──────┘
       │ Settlement (extension)
       ▼
┌─────────────┐
│  Claimable  │◀── Controller or Operator can call
│   Request   │    redeem()/withdraw()
└──────┬──────┘
       │ Claim
       ▼
┌─────────────┐
│   Claimed   │
└─────────────┘
```

---

## 8. STATE TRANSITION DIAGRAMS

### 8.1 Request Lifecycle State Machine

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                                                         │
                    ▼                                                         │
┌──────────┐   requestRedeem()   ┌──────────┐   Settlement   ┌──────────┐   │
│   IDLE   │────────────────────▶│ PENDING  │───────────────▶│CLAIMABLE │───┤
└──────────┘                     └────┬─────┘                └────┬─────┘   │
     ▲                                │                           │       │
     │                                │ Cancel                    │ Claim │
     │                                ▼                           ▼       │
     │                           ┌──────────┐                ┌──────────┐  │
     │                           │CANCELLED │                │ CLAIMED  │──┘
     │                           │(deleted) │                │(terminal)│
     │                           └──────────┘                └──────────┘
     │                                                           ▲
     └───────────────────────────────────────────────────────────┘
                    (New request can be created)
```

### 8.2 State Transition Table

| Current State | Event           | Next State | Action                               | Valid?             |
| ------------- | --------------- | ---------- | ------------------------------------ | ------------------ |
| IDLE          | `requestRedeem` | PENDING    | Create request, lock shares          | ✅ Yes             |
| PENDING       | Settlement      | CLAIMABLE  | Process settlement, calculate assets | ✅ Yes             |
| PENDING       | Cancel          | IDLE       | Return shares, delete request        | ✅ Yes (Extension) |
| PENDING       | Claim           | -          | Revert: not claimable                | ❌ Invalid         |
| CLAIMABLE     | Claim (partial) | CLAIMABLE  | Reduce claimable, transfer assets    | ✅ Yes             |
| CLAIMABLE     | Claim (full)    | CLAIMED    | Transfer assets, mark claimed        | ✅ Yes             |
| CLAIMABLE     | Cancel          | -          | Revert: cannot cancel claimable      | ❌ Invalid         |
| CLAIMED       | Any             | -          | No-op or revert                      | ❌ Terminal        |

### 8.3 Controller-Aggregated Model Transitions

```
Controller A State:

IDLE ──requestRedeem(100)──▶ PENDING(100)
                                │
                                │ requestRedeem(50) [additional]
                                ▼
                           PENDING(150) ──Settlement──▶ CLAIMABLE(150, assets=1500)
                                                          │
                                                          │ redeem(100)
                                                          ▼
                                                    CLAIMABLE(50, assets=500)
                                                          │
                                                          │ redeem(50)
                                                          ▼
                                                       CLAIMED(0)
```

### 8.4 Operator Authorization State

```
Controller: Alice

Initial: isOperator[Alice][Bob] = false

         setOperator(Bob, true)
                │
                ▼
    isOperator[Alice][Bob] = true
                │
                ├── Bob can call requestRedeem(..., owner=Carol, controller=Alice)
                ├── Bob can call redeem(..., controller=Alice)
                └── Bob can call withdraw(..., controller=Alice)
                │
                ▼
         setOperator(Bob, false)
                │
                ▼
    isOperator[Alice][Bob] = false
                │
                └── Bob CANNOT perform controller actions for Alice
```

---

## 9. EXTENSION FUNCTIONS (NON-STANDARD)

These functions extend ERC-7540 with vault-specific behavior. They are NOT part of the standard.

### 9.1 cancelRedeemRequest (Extension)

```solidity
/// @notice Cancel a pending redemption request
/// @dev Extension - NOT part of ERC-7540 standard
/// @param shares Amount of shares to cancel (partial cancellation allowed)
/// @return cancelledShares Amount actually cancelled
///
/// Requirements:
/// - Controller must have pending request
/// - Must be before settlement cutoff (epoch not ended)
/// - Caller must be controller or operator
///
/// Effects:
/// - Returns shares to owner
/// - Removes from pending mapping
/// - Reduces totalPendingRedeemShares
function cancelRedeemRequest(uint256 shares) external returns (uint256 cancelledShares);
```

### 9.2 Epoch Settlement (Extension)

```solidity
/// @notice Settle an epoch and process pending requests
/// @dev Extension - NOT part of ERC-7540 standard
/// @param epochId Epoch to settle
/// @param availableAssets Total assets available for distribution
///
/// Effects:
/// - Moves all pending requests for epoch to claimable
/// - Calculates assets per request using NAV
/// - Applies pro-rata if insufficient assets
function settleEpoch(uint256 epochId, uint256 availableAssets) external;

/// @notice Process settlement in chunks
/// @dev Extension - For gas efficiency with many requests
function settleEpochChunked(uint256 epochId) external;
```

### 9.3 NAV Management (Extension)

```solidity
/// @notice Update the NAV value
/// @dev Extension - NOT part of ERC-7540 standard
/// @param nav New NAV value
function updateNAV(uint256 nav) external;

/// @notice Check if NAV is fresh
/// @return fresh True if NAV is within staleness threshold
function isNAVFresh() external view returns (bool);
```

---

## 10. STORAGE LAYOUT SPECIFICATION

### 10.1 Core ERC-7540 Storage

```solidity
// Slot 50+: ERC-7540 Core

/// @notice Pending redemption requests per controller
/// @dev Maps controller => RedemptionRequest
mapping(address => RedemptionRequest) public pendingRedeemRequest;

/// @notice Claimable redemption requests per controller
/// @dev Maps controller => RedemptionRequest
mapping(address => RedemptionRequest) public claimableRedeemRequest;

/// @notice Operator approvals
/// @dev Maps controller => operator => approved
mapping(address => mapping(address => bool)) public isOperator;

/// @notice Total pending shares across all controllers
/// @dev Used for totalAssets() exclusion
uint256 public totalPendingRedeemShares;
```

### 10.2 RedemptionRequest Struct

```solidity
struct RedemptionRequest {
    address controller;     // Controller address (ERC-7540)
    address owner;          // Original owner of shares
    uint256 shares;         // Shares requested/claimable
    uint256 assets;         // Assets claimable (0 if pending)
    RequestStatus status;   // Pending/Claimable/Claimed
    uint256 createdAt;      // Creation timestamp
    uint256 settledAt;      // Settlement timestamp (0 if pending)
    uint256 navSnapshot;    // NAV at settlement (extension)
}
```

### 10.3 Status Enum

```solidity
enum RequestStatus {
    Pending,    // 0 - Awaiting settlement
    Claimable,  // 1 - Ready to claim (settled)
    Claimed     // 2 - Assets claimed (terminal)
}
```

---

## 11. CURRENT → NEW MAPPING SUMMARY

### 11.1 Function Mapping

| Current Function   | Current Signature      | New Function                                      | New Signature               | Notes                        |
| ------------------ | ---------------------- | ------------------------------------------------- | --------------------------- | ---------------------------- |
| `requestRedeem`    | `(uint256 _shares)`    | `requestRedeem`                                   | `(uint256,address,address)` | Adds controller/owner params |
| `claim`            | `(uint256 _requestId)` | `redeem`                                          | `(uint256,address,address)` | Controller-aggregated model  |
| `cancelRedemption` | `(uint256 _requestId)` | `cancelRedeemRequest`                             | `(uint256 shares)`          | Shares-based cancellation    |
| `getRequest`       | `(uint256)`            | `pendingRedeemRequest` + `claimableRedeemRequest` | `(uint256,address)`         | Split view functions         |
| N/A                | -                      | `withdraw`                                        | `(uint256,address,address)` | New ERC-7540 function        |
| N/A                | -                      | `setOperator`                                     | `(address,bool)`            | New operator model           |
| N/A                | -                      | `isOperator`                                      | `(address,address)`         | New operator query           |
| N/A                | -                      | `supportsInterface`                               | `(bytes4)`                  | New ERC-165 support          |

### 11.2 Event Mapping

| Current Event    | Current Params                        | New Event       | New Params                                   | Notes                   |
| ---------------- | ------------------------------------- | --------------- | -------------------------------------------- | ----------------------- |
| `RequestCreated` | `(requestId,user,shares,targetEpoch)` | `RedeemRequest` | `(controller,owner,requestId,sender,shares)` | Controller-aggregated   |
| `ClaimProcessed` | `(requestId,user,assets)`             | `Withdraw`      | `(sender,receiver,owner,assets,shares)`      | Standard ERC-4626 event |
| N/A              | -                                     | `OperatorSet`   | `(controller,operator,approved)`             | New operator model      |

### 11.3 Error Mapping

| Current Error       | New Error                                 | Change                    |
| ------------------- | ----------------------------------------- | ------------------------- |
| `NotRequestOwner`   | `NotOwner` / `NotController`              | Split by context          |
| `RequestNotFound`   | `NoPendingRequest` / `NoClaimableRequest` | More specific             |
| `RequestNotSettled` | `NoClaimableRequest`                      | Aligns with view function |
| `AlreadyClaimed`    | `InsufficientClaimableShares`             | Covered by shares check   |
| N/A                 | `PreviewNotSupported`                     | New for ERC-7540          |
| N/A                 | `Unauthorized`                            | Generic auth error        |

---

## 12. IMPLEMENTATION CHECKLIST

### 12.1 T6: Function/Signature Rewrite

- [ ] Implement `requestRedeem(uint256,address,address)` with NatSpec
- [ ] Implement `redeem(uint256,address,address)` with NatSpec
- [ ] Implement `withdraw(uint256,address,address)` with NatSpec
- [ ] Implement `pendingRedeemRequest(uint256,address)` view
- [ ] Implement `claimableRedeemRequest(uint256,address)` view
- [ ] Replace `claim(uint256)` with ERC-7540 equivalents
- [ ] Update `cancelRedemption(uint256)` to `cancelRedeemRequest(uint256)`
- [ ] Remove `getRequest(uint256)` - replaced by standard views
- [ ] Add events: `RedeemRequest`, `Withdraw`, `OperatorSet`
- [ ] Add errors per Section 5

### 12.2 T7: Operator Model

- [ ] Implement `setOperator(address,bool)`
- [ ] Implement `isOperator(address,address)` view
- [ ] Add operator authorization check to `requestRedeem`
- [ ] Add operator authorization check to `redeem`
- [ ] Add operator authorization check to `withdraw`
- [ ] Add `isOperator` mapping storage
- [ ] Test operator grant/revoke flows
- [ ] Test operator authorization enforcement

### 12.3 T8: ERC-165 and Preview Overrides

- [ ] Implement `supportsInterface(bytes4)`
- [ ] Return true for: 0x620ee8e4, 0xe3bc4e65, 0x2f0a18c5, 0x8090723d, 0x36372b07, 0x01ffc9a7
- [ ] Return false for: 0xce3bbe50, 0xffffffff
- [ ] Override `previewRedeem(uint256)` to revert
- [ ] Override `previewWithdraw(uint256)` to revert
- [ ] Add `PreviewNotSupported()` error
- [ ] Test all interface ID returns
- [ ] Test preview function reverts

---

## 13. TESTING REQUIREMENTS

### 13.1 Interface ID Tests

```solidity
// Required test cases
function test_Interface_IERC7540Redeem() public {
    assertTrue(vault.supportsInterface(0x620ee8e4));
}

function test_Interface_IERC7540Operator() public {
    assertTrue(vault.supportsInterface(0xe3bc4e65));
}

function test_Interface_IERC7540Deposit_NotSupported() public {
    assertFalse(vault.supportsInterface(0xce3bbe50));
}

function test_Interface_Invalid_ReturnsFalse() public {
    assertFalse(vault.supportsInterface(0xffffffff));
}
```

### 13.2 Operator Authorization Tests

```solidity
// Required test cases
function test_Operator_CanRequestOnBehalf() public;
function test_Operator_CanRedeemOnBehalf() public;
function test_Operator_CanWithdrawOnBehalf() public;
function test_Operator_RevocationPreventsActions() public;
function test_NonOperator_CannotRequestOnBehalf() public;
function test_NonOperator_CannotRedeemOnBehalf() public;
```

### 13.3 Preview Override Tests

```solidity
// Required test cases
function test_PreviewRedeem_Reverts() public {
    vm.expectRevert(PreviewNotSupported.selector);
    vault.previewRedeem(100);
}

function test_PreviewWithdraw_Reverts() public {
    vm.expectRevert(PreviewNotSupported.selector);
    vault.previewWithdraw(100);
}
```

### 13.4 Lifecycle Tests

```solidity
// Required test cases
function test_Lifecycle_RequestToPending() public;
function test_Lifecycle_SettlementToClaimable() public;
function test_Lifecycle_ClaimToClaimed() public;
function test_Lifecycle_EventsEmitted() public;
function test_Lifecycle_StateTransitionsValid() public;
```

---

## 14. REFERENCES

### 14.1 Standards Documents

- [EIP-7540](https://eips.ethereum.org/EIPS/eip-7540) - Asynchronous ERC-4626 Tokenized Vaults
- [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626) - Tokenized Vaults
- [EIP-165](https://eips.ethereum.org/EIPS/eip-165) - Standard Interface Detection
- [EIP-7575](https://eips.ethereum.org/EIPS/eip-7575) - Tokenized Vaults Standard

### 14.2 Internal References

- `.sisyphus/notes/erc7540-standards-matrix.md` - Standards matrix (T1 output)
- `.sisyphus/notes/contract-storage-design.md` - Storage layout (T2 output)
- `contracts/src/WeeklyEpochVault.sol` - Current implementation

---

## 15. APPENDIX: COMPLETE INTERFACE FILE

```solidity
// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

/// @title IERC7540Redeem
/// @notice ERC-7540 asynchronous redemption interface
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

    function requestRedeem(uint256 shares, address controller, address owner)
        external returns (uint256 requestId);
    function redeem(uint256 shares, address receiver, address controller)
        external returns (uint256 assets);
    function withdraw(uint256 assets, address receiver, address controller)
        external returns (uint256 shares);
    function pendingRedeemRequest(uint256 requestId, address controller)
        external view returns (uint256 shares);
    function claimableRedeemRequest(uint256 requestId, address controller)
        external view returns (uint256 shares);
}

/// @title IERC7540Operator
/// @notice ERC-7540 operator delegation interface
interface IERC7540Operator {
    event OperatorSet(
        address indexed controller,
        address indexed operator,
        bool approved
    );

    function setOperator(address operator, bool approved)
        external returns (bool success);
    function isOperator(address controller, address operator)
        external view returns (bool status);
}

/// @title IERC7540
/// @notice Complete ERC-7540 interface
interface IERC7540 is IERC7540Redeem, IERC7540Operator {}

/// @title IERC165
/// @notice ERC-165 interface detection
interface IERC165 {
    function supportsInterface(bytes4 interfaceId)
        external view returns (bool supported);
}
```

---

## Document Control

| Version | Date       | Changes                         |
| ------- | ---------- | ------------------------------- |
| 1.0.0   | 2026-03-03 | Initial specification for T6-T8 |

---

**END OF SPECIFICATION**
