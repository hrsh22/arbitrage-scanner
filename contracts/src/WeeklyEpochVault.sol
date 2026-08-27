// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EpochMath} from "./libraries/EpochMath.sol";

/// @title WeeklyEpochVault
/// @notice A single-asset async vault with fixed weekly redemption epochs.
/// @dev Implements ERC-7540 async redemption with controller-aggregated model (requestId = 0).
///      Epoch settlement, NAV controls, and pro-rata distribution are explicit extensions.
contract WeeklyEpochVault is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // ROLES
    // ============================================================================
    
    /// @notice Role for administrative functions (emergency mode, role management)
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    /// @notice Role for epoch settlement operations
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    
    /// @notice Role for NAV updates
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");

    // ============================================================================
    // IMMUTABLE CONFIGURATION (Slots 50-53)
    // ============================================================================
    
    /// @notice The single asset managed by this vault (immutable)
    IERC20 public immutable asset;
    
    /// @notice Duration of each epoch in seconds (immutable, fixed at 7 days for production)
    uint256 public immutable EPOCH_DURATION;
    
    /// @notice Timestamp when the vault was deployed
    uint256 public immutable DEPLOY_TIME;

    /// @notice NAV staleness threshold (6 hours - settlement requires fresh NAV)
    uint256 public immutable NAV_STALENESS_THRESHOLD;

    // ============================================================================
    // ERC-7540 CORE STATE (Slots 54-57)
    // ============================================================================

    /// @notice Status of a redemption request per ERC-7540
    /// @dev uint8 values match standard interface expectations
    enum RequestStatus {
        Pending,    // 0 - Awaiting settlement
        Claimable,  // 1 - Ready to claim (settled)
        Claimed     // 2 - Assets claimed (terminal)
    }

    /// @notice Redemption request data structure (ERC-7540 aligned)
    /// @dev Optimized packing: 4 slots vs 5 in naive layout
    /// @dev Slot 0: controller + owner (40 bytes)
    /// @dev Slot 1: shares (32 bytes)
    /// @dev Slot 2: assets (32 bytes)
    /// @dev Slot 3: status (1 byte) + createdAt (6 bytes) + settledAt (6 bytes) + reserved (8 bytes) + padding (11 bytes)
    struct RedemptionRequest {
        // Slot 0: Packed addresses (40 bytes total, 24 bytes remaining)
        address controller;     // 20 bytes - ERC-7540 controller
        address owner;          // 20 bytes - owner of shares

        // Slot 1: shares value (32 bytes)
        uint256 shares;         // Shares requested for redemption

        // Slot 2: assets value (32 bytes)
        uint256 assets;         // Assets claimable after settlement (0 if pending)

        // Slot 3: Status and timestamps (packed)
        RequestStatus status;   // 1 byte - current status
        uint48 createdAt;       // 6 bytes - sufficient until year 8,925
        uint48 settledAt;       // 6 bytes - settlement timestamp (0 if pending)
        uint64 __reserved;      // 8 bytes - for future use, keeps slot clean
    }

    /// @notice Pending redemption requests per controller (Slot 54)
    /// @dev Maps controller => RedemptionRequest
    mapping(address => RedemptionRequest) internal _pendingRedeemRequest;

    /// @notice Claimable redemption requests per controller (Slot 55)
    /// @dev Maps controller => RedemptionRequest
    mapping(address => RedemptionRequest) internal _claimableRedeemRequest;

    /// @notice Operator approvals (Slot 56)
    /// @dev Maps controller => operator => approved
    mapping(address => mapping(address => bool)) public isOperator;

    /// @notice Total pending shares across all controllers (Slot 57)
    /// @dev Used for totalAssets() exclusion per ERC-7540
    uint256 public totalPendingRedeemShares;

    // ============================================================================
    // NAV STATE (Slots 58-60)
    // ============================================================================
    
    /// @notice Latest NAV snapshot value
    uint256 public currentNAV;
    
    /// @notice Timestamp of last NAV update
    uint256 public lastNAVUpdate;
    
    /// @notice Emergency mode flag - when true, new redemption requests are paused
    /// @dev Existing claims remain unaffected - admin cannot confiscate user funds
    bool public emergencyMode;
    
    /// @notice Padding for slot 60 alignment
    uint248 private __emergencyPadding;

    // ============================================================================
    // EXTENSION STATE (Slots 61-68)
    // ============================================================================

    /// @notice EXTENSION (Non-Standard): Metadata linking pending requests to epochs
    struct EpochExtension {
        uint32 epochId;         // 4 bytes - supports 4.2B epochs
        uint8 __padding;        // 1 byte - alignment
        uint8 __padding2;       // 1 byte - alignment
        uint224 __reserved;     // 26 bytes - future extension data
    }

    /// @notice EXTENSION (Non-Standard): Pro-rata settlement data for insufficient liquidity
    struct ProRataData {
        uint128 ratio;          // 16 bytes - pro-rata ratio (1e18 = 100%)
        uint128 originalShares; // 16 bytes - original shares before pro-rata
    }

    /// @notice EXTENSION (Non-Standard): NAV snapshot at settlement time
    struct NavSnapshot {
        uint256 nav;            // NAV value at settlement
        uint48 timestamp;       // When snapshot was taken
        bool isFresh;           // Whether NAV was within freshness threshold
        uint40 __reserved;      // Future use
    }

    /// @notice EXTENSION (Non-Standard): Settlement status for an epoch
    struct SettlementStatus {
        uint128 totalShares;        // 16 bytes - total shares in pending requests
        uint128 totalProcessed;     // 16 bytes - total requests processed
        uint128 availableAssets;    // 16 bytes - assets available for distribution
        uint64 proRataRatio;        // 8 bytes - ratio (1e18 precision truncated to 64-bit)
        bool settled;               // 1 byte - settlement complete flag
        uint24 __padding;           // 3 bytes - alignment
        uint128 __reserved;         // 16 bytes - future use
    }

    /// @notice Extension metadata for pending requests (Slot 61)
    mapping(address => EpochExtension) public pendingRequestExtension;

    /// @notice Extension metadata for claimable requests (Slot 62)
    mapping(address => EpochExtension) public claimableRequestExtension;

    /// @notice List of controllers with pending requests per epoch (Slot 63)
    mapping(uint256 => address[]) public epochPendingControllers;

    /// @notice Tracks which controllers have been processed for settlement (Slot 64)
    mapping(uint256 => mapping(address => bool)) public epochControllerProcessed;

    /// @notice NAV snapshot at settlement per controller (Slot 65)
    mapping(address => NavSnapshot) public claimableNavSnapshot;

    /// @notice Pro-rata data per controller after settlement (Slot 66)
    mapping(address => ProRataData) public claimableProRataData;

    /// @notice Settlement status per epoch (Slot 67)
    mapping(uint256 => SettlementStatus) public settlementStatus;

    /// @notice Tracks the next controller index to process for chunked settlement (Slot 68)
    mapping(uint256 => uint256) public nextRequestIndexToProcess;


// ============================================================================
// ERC-7540 INTERFACE IDS
// ============================================================================

bytes4 constant IERC7540_REDEEM_INTERFACE_ID = 0x620ee8e4;
bytes4 constant IERC7540_CANCEL_INTERFACE_ID = 0xe3bc4e65;
bytes4 constant IERC7540_CLAIM_INTERFACE_ID = 0x2f0a18c5;

    // ============================================================================
    // CONSTANTS
    // ============================================================================
    
    /// @notice Maximum number of requests to process in a single chunk
    uint256 public constant MAX_CHUNK_SIZE = 100;
    
    /// @notice Precision factor for pro-rata calculations (1e18 = 100%)
    uint256 public constant PRORATA_PRECISION = 1e18;

    // ============================================================================
    // ERC-7540 EVENTS
    // ============================================================================

    /// @notice Emitted when redemption request is created
    /// @param controller Indexed: Controller address (can claim)
    /// @param owner Indexed: Owner of shares
    /// @param requestId Indexed: Request identifier (0 for aggregated model)
    /// @param sender Address that called requestRedeem
    /// @param shares Amount of shares locked
    event RedeemRequest(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        address sender,
        uint256 shares
    );

    /// @notice Emitted when assets are claimed/redeemed (ERC-4626 standard)
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

    /// @notice Emitted when operator approval changes
    /// @param controller Indexed: Controller that set operator
    /// @param operator Indexed: Operator address
    /// @param approved New approval status (true = approved)
    event OperatorSet(
        address indexed controller,
        address indexed operator,
        bool approved
    );

    // ============================================================================
    // EXTENSION EVENTS (Non-Standard)
    // ============================================================================

    /// @notice Emitted when a request is cancelled
    /// @param controller The controller whose request was cancelled
    /// @param shares Amount of shares returned
    event RequestCancelled(
        address indexed controller,
        uint256 shares
    );
    
    /// @notice Emitted when an epoch is settled
    /// @param epochId The settled epoch
    /// @param totalShares Total shares redeemed in this epoch
    /// @param totalAssets Total assets distributed
    /// @param nav NAV used for settlement
    event EpochSettled(
        uint256 indexed epochId,
        uint256 totalShares,
        uint256 totalAssets,
        uint256 nav
    );

    /// @notice Emitted when emergency mode is toggled
    /// @param active New emergency mode state
    event EmergencyModeSet(bool active);

    /// @notice Emitted when NAV is updated
    /// @param nav New NAV value
    /// @param timestamp Block timestamp of the update
    event NAVUpdated(uint256 nav, uint256 timestamp);

    // ============================================================================
    // CUSTOM ERRORS
    // ============================================================================

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

    // Epoch Errors (Extension)
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

    // NAV Errors (Extension)
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

    // ============================================================================
    // RESERVED GAP (Slots 69-100)
    // ============================================================================
    
    /// @notice Reserved storage slots for future upgrades
    uint256[32] private __gap;

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================
    
    /// @notice Deploys the vault with immutable parameters
    /// @param _asset The single asset managed by this vault
    /// @param _admin Address with admin role
    /// @param _settler Address with settler role
    /// @param _navUpdater Address with nav updater role
    /// @param _epochDuration Duration of each epoch in seconds (604800 for 7 days)
    /// @param _navStalenessThreshold NAV freshness threshold in seconds
    constructor(
        address _asset,
        address _admin,
        address _settler,
        address _navUpdater,
        uint256 _epochDuration,
        uint256 _navStalenessThreshold
    ) ERC20("Weekly Epoch Vault", "WEV") {
        // Validate all inputs - no zero addresses allowed
        if (_asset == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();
        if (_settler == address(0)) revert InvalidAddress();
        if (_navUpdater == address(0)) revert InvalidAddress();
        if (_epochDuration == 0) revert InvalidAddress();
        if (_navStalenessThreshold == 0) revert InvalidAddress();
        
        // Set immutable configuration
        asset = IERC20(_asset);
        EPOCH_DURATION = _epochDuration;
        NAV_STALENESS_THRESHOLD = _navStalenessThreshold;
        DEPLOY_TIME = block.timestamp;
        
        // Grant roles (admin is the default admin for AccessControl)
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(SETTLER_ROLE, _settler);
        _grantRole(NAV_UPDATER_ROLE, _navUpdater);
        
        // Initialize NAV tracking
        lastNAVUpdate = block.timestamp;
    }

    // ============================================================================
    // ERC-7540 CORE FUNCTIONS
    // ============================================================================

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
    /// - Adds `shares` to `_pendingRedeemRequest[controller]`
    /// - Increases `totalPendingRedeemShares` by `shares`
    /// - Assigns to current epoch (extension)
    /// - Emits `RedeemRequest(controller, owner, 0, msg.sender, shares)`
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    ) external returns (uint256 requestId) {
        // Validate inputs
        if (shares == 0) revert ZeroAmount();
        if (controller == address(0)) revert InvalidAddress();
        if (owner == address(0)) revert InvalidAddress();
        _requireNotEmergency();

        // Authorization: msg.sender must be owner or approved operator
        if (msg.sender != owner && !isOperator[owner][msg.sender]) {
            revert NotOwner(owner, msg.sender);
        }

        // Determine target epoch using EpochMath
        uint256 targetEpoch = EpochMath.bucketRequest(DEPLOY_TIME, EPOCH_DURATION, block.timestamp);

        // Get existing pending request for this controller (if any)
        RedemptionRequest storage pending = _pendingRedeemRequest[controller];
        
        // If this is a new controller for this epoch, add to epoch list
        if (pending.shares == 0) {
            epochPendingControllers[targetEpoch].push(controller);
        }

        // Accumulate shares in pending request (controller-aggregated model)
        pending.controller = controller;
        pending.owner = owner;
        pending.shares += shares;
        pending.status = RequestStatus.Pending;
        pending.createdAt = uint48(block.timestamp);
        // settledAt remains 0 (pending)

        // Update total pending shares counter
        totalPendingRedeemShares += shares;

        // Store epoch extension data
        pendingRequestExtension[controller].epochId = uint32(targetEpoch);

        // Transfer shares from owner to vault
        // NOTE: Owner must have approved vault to spend shares
        IERC20(address(this)).safeTransferFrom(owner, address(this), shares);

        // Emit ERC-7540 event
        emit RedeemRequest(controller, owner, 0, msg.sender, shares);

        // Return 0 for controller-aggregated model
        return 0;
    }

    /// @notice EXTENSION (Non-Standard): Cancel a pending redemption request
    /// @dev NOT part of ERC-7540 standard
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
    function cancelRedeemRequest(uint256 shares) external returns (uint256 cancelledShares) {
        if (shares == 0) revert ZeroAmount();

        // Get controller (msg.sender for now, T7 will add operator support)
        address controller = msg.sender;

        RedemptionRequest storage pending = _pendingRedeemRequest[controller];

        // Validate pending request exists
        if (pending.shares == 0) revert NoPendingRequest(controller);
        if (pending.status != RequestStatus.Pending) revert AlreadyCancelled();

        // Get epoch info for settlement cutoff check
        EpochExtension storage ext = pendingRequestExtension[controller];
        uint256 epochEnd = EpochMath.getEpochEnd(DEPLOY_TIME, EPOCH_DURATION, ext.epochId);
        
        // Validate settlement cutoff hasn't passed
        if (block.timestamp >= epochEnd) {
            revert CannotCancelAfterSettlement(ext.epochId, epochEnd);
        }

        // Determine actual shares to cancel (cannot exceed pending)
        uint256 sharesToCancel = shares > pending.shares ? pending.shares : shares;

        // Update pending state
        pending.shares -= sharesToCancel;
        totalPendingRedeemShares -= sharesToCancel;

        // If all shares cancelled, clear the request
        if (pending.shares == 0) {
            pending.status = RequestStatus.Claimed; // Mark as terminal
            delete pendingRequestExtension[controller];
        }

        // Return shares to owner (original owner stored in request)
        address owner = pending.owner;
        IERC20(address(this)).safeTransfer(owner, sharesToCancel);

        emit RequestCancelled(controller, sharesToCancel);

        return sharesToCancel;
    }

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
    /// - Reduces `_claimableRedeemRequest[controller]` by `shares`
    /// - Calculates `assets` based on settlement NAV
    /// - Transfers `assets` from vault to `receiver`
    /// - If all shares claimed, marks request as Claimed
    /// - Emits `Withdraw(controller, receiver, controller, assets, shares)`
    function redeem(
        uint256 shares,
        address receiver,
        address controller
    ) external nonReentrant returns (uint256 assets) {
        // Validate inputs
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidAddress();
        if (controller == address(0)) revert InvalidAddress();

        // Authorization: msg.sender must be controller or operator
        if (msg.sender != controller && !isOperator[controller][msg.sender]) {
            revert NotController(controller, msg.sender);
        }

        // Get claimable request
        RedemptionRequest storage claimable = _claimableRedeemRequest[controller];

        // Validate claimable request exists
        if (claimable.shares == 0) revert NoClaimableRequest(controller);
        if (claimable.status != RequestStatus.Claimable) revert NoClaimableRequest(controller);

        // Validate sufficient claimable shares
        if (claimable.shares < shares) {
            revert InsufficientClaimableShares(shares, claimable.shares);
        }

        // Calculate assets to transfer using settlement NAV snapshot
        NavSnapshot storage navSnap = claimableNavSnapshot[controller];
        assets = _convertSharesToAssets(shares, navSnap.nav);

        // Cap assets at available to prevent over-allocation
        if (assets > claimable.assets) {
            assets = claimable.assets;
        }

        // Update claimable state
        claimable.shares -= shares;
        claimable.assets -= assets;

        // If all shares claimed, mark as Claimed
        if (claimable.shares == 0) {
            claimable.status = RequestStatus.Claimed;
            // Cleanup extension data
            delete claimableRequestExtension[controller];
            delete claimableNavSnapshot[controller];
            delete claimableProRataData[controller];
        }

        // Transfer assets to receiver
        asset.safeTransfer(receiver, assets);

        // Emit ERC-4626 Withdraw event
        emit Withdraw(controller, receiver, controller, assets, shares);

        return assets;
    }

    /// @notice Claim assets by specifying output amount
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
    /// - Reduces `_claimableRedeemRequest[controller]` by `shares`
    /// - Transfers `assets` from vault to `receiver`
    /// - If all shares claimed, marks request as Claimed
    /// - Emits `Withdraw(controller, receiver, controller, assets, shares)`
    function withdraw(
        uint256 assets,
        address receiver,
        address controller
    ) external nonReentrant returns (uint256 shares) {
        // Validate inputs
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidAddress();
        if (controller == address(0)) revert InvalidAddress();

        // Authorization: msg.sender must be controller or operator
        if (msg.sender != controller && !isOperator[controller][msg.sender]) {
            revert NotController(controller, msg.sender);
        }

        // Get claimable request
        RedemptionRequest storage claimable = _claimableRedeemRequest[controller];

        // Validate claimable request exists
        if (claimable.shares == 0) revert NoClaimableRequest(controller);
        if (claimable.status != RequestStatus.Claimable) revert NoClaimableRequest(controller);

        // Validate sufficient claimable assets
        if (claimable.assets < assets) {
            revert InsufficientClaimableShares(assets, claimable.assets);
        }

        // Calculate shares from assets using settlement NAV
        NavSnapshot storage navSnap = claimableNavSnapshot[controller];
        shares = _convertAssetsToShares(assets, navSnap.nav);

        // Validate calculated shares don't exceed claimable
        if (shares > claimable.shares) {
            shares = claimable.shares;
        }

        // Update claimable state
        claimable.shares -= shares;
        claimable.assets -= assets;

        // If all shares claimed, mark as Claimed
        if (claimable.shares == 0) {
            claimable.status = RequestStatus.Claimed;
            // Cleanup extension data
            delete claimableRequestExtension[controller];
            delete claimableNavSnapshot[controller];
            delete claimableProRataData[controller];
        }

        // Transfer assets to receiver
        asset.safeTransfer(receiver, assets);

        // Emit ERC-4626 Withdraw event
        emit Withdraw(controller, receiver, controller, assets, shares);

        return shares;
    }

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
    function pendingRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares) {
        // requestId ignored for aggregated model
        RedemptionRequest storage pending = _pendingRedeemRequest[controller];
        if (pending.status == RequestStatus.Pending) {
            return pending.shares;
        }
        return 0;
    }

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
    function claimableRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares) {
        // requestId ignored for aggregated model
        RedemptionRequest storage claimable = _claimableRedeemRequest[controller];
        if (claimable.status == RequestStatus.Claimable) {
            return claimable.shares;
        }
        return 0;
    }

    // ============================================================================
    // ERC-7540 OPERATOR FUNCTIONS (T7)
    // ============================================================================

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
    function setOperator(address operator, bool approved) external returns (bool success) {
        if (operator == address(0)) revert InvalidAddress();
        
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }


    /// @notice Check if the contract supports a given interface
    /// @dev Implements ERC-165 interface detection
    /// @param interfaceId The interface identifier, as specified in ERC-165
    /// @return supported True if the contract supports the interface
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool supported) {
        return interfaceId == type(IERC165).interfaceId ||
               interfaceId == IERC7540_REDEEM_INTERFACE_ID ||
               interfaceId == IERC7540_CANCEL_INTERFACE_ID ||
               interfaceId == IERC7540_CLAIM_INTERFACE_ID ||
               super.supportsInterface(interfaceId);
    }

    /// @notice Preview redeem shares to assets
    /// @dev ERC-7540: reverts if not claimable, returns assets if claimable
    /// @param shares Amount of shares to preview
    /// @return assets Amount of assets that would be received
    function previewRedeem(uint256 shares) external view returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        
        // Check if there's a claimable request for msg.sender
        RedemptionRequest storage claimable = _claimableRedeemRequest[msg.sender];
        if (claimable.status != RequestStatus.Claimable) {
            revert PreviewNotSupported();
        }
        
        // Calculate assets using settlement NAV
        NavSnapshot storage navSnap = claimableNavSnapshot[msg.sender];
        assets = _convertSharesToAssets(shares, navSnap.nav);
        
        // Cap at available
        if (assets > claimable.assets) {
            assets = claimable.assets;
        }
        
        return assets;
    }

    /// @notice Preview withdraw assets to shares
    /// @dev ERC-7540: reverts if not claimable, returns shares if claimable
    /// @param assets Amount of assets to preview
    /// @return shares Amount of shares that would be consumed
    function previewWithdraw(uint256 assets) external view returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        
        // Check if there's a claimable request for msg.sender
        RedemptionRequest storage claimable = _claimableRedeemRequest[msg.sender];
        if (claimable.status != RequestStatus.Claimable) {
            revert PreviewNotSupported();
        }
        
        // Calculate shares using settlement NAV
        NavSnapshot storage navSnap = claimableNavSnapshot[msg.sender];
        shares = _convertAssetsToShares(assets, navSnap.nav);
        
        // Validate calculated shares don't exceed claimable
        if (shares > claimable.shares) {
            shares = claimable.shares;
        }
        
        return shares;
    }
    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================
    
    /// @notice Toggle emergency mode
    /// @dev When active, new redemption requests are blocked. Existing claims remain claimable.
    /// @param _active New emergency mode state
    function setEmergencyMode(bool _active) external onlyRole(ADMIN_ROLE) {
        emergencyMode = _active;
        emit EmergencyModeSet(_active);
    }

    // ============================================================================
    // NAV UPDATER FUNCTIONS
    // ============================================================================
    
    /// @notice Update the NAV snapshot
    /// @dev Called periodically to provide fresh NAV for settlement calculations
    /// @param _nav New NAV value
    function updateNAV(uint256 _nav) external onlyRole(NAV_UPDATER_ROLE) {
        currentNAV = _nav;
        lastNAVUpdate = block.timestamp;
        emit NAVUpdated(_nav, block.timestamp);
    }

    // ============================================================================
    // SETTLER FUNCTIONS (Epoch Settlement Extension)
    // ============================================================================
    
    /// @notice EXTENSION (Non-Standard): Settle an epoch by computing claimable assets for all pending requests
    /// @dev Uses pro-rata distribution when liquid assets are insufficient.
    ///      For large request volumes, automatically uses chunked processing.
    ///      This is an extension function, not part of base ERC-7540.
    /// @param _availableAssets Total assets available for distribution in this epoch
    function settleEpoch(uint256 _epochId, uint256 _availableAssets)
        external
        onlyRole(SETTLER_ROLE)
        nonReentrant
    {
        _validateSettlementPreconditions(_epochId);
        
        // Get all controllers with pending requests for this epoch
        address[] storage controllers = epochPendingControllers[_epochId];
        uint256 totalPending = 0;
        uint256 totalShares = 0;
        
        // Count pending controllers and total shares
        for (uint256 i = 0; i < controllers.length; i++) {
            address controller = controllers[i];
            RedemptionRequest storage pending = _pendingRedeemRequest[controller];
            if (pending.status == RequestStatus.Pending && pending.shares > 0) {
                totalPending++;
                totalShares += pending.shares;
            }
        }
        
        if (totalPending == 0) revert NoPendingRequests(_epochId);
        if (totalShares == 0) revert NoPendingRequests(_epochId);
        
        // Calculate pro-rata ratio if needed
        uint256 proRataRatio = PRORATA_PRECISION;
        if (_availableAssets < totalShares) {
            // Pro-rata distribution: userGets = (userShares * availableAssets) / totalShares
            proRataRatio = (_availableAssets * PRORATA_PRECISION) / totalShares;
        }
        
        // Initialize settlement status
        SettlementStatus storage status = settlementStatus[_epochId];
        status.totalShares = uint128(totalShares);
        status.availableAssets = uint128(_availableAssets);
        status.proRataRatio = uint64(proRataRatio);
        status.settled = false;
        status.totalProcessed = 0;
        nextRequestIndexToProcess[_epochId] = 0;
        
        // If controller count is small, process all in one transaction
        if (totalPending <= MAX_CHUNK_SIZE) {
            _processSettlementChunk(_epochId, _availableAssets, totalShares, proRataRatio, controllers.length);
            status.settled = true;
            status.totalProcessed = uint128(totalPending);
            emit EpochSettled(_epochId, totalShares, _availableAssets, currentNAV);
        }
        // Otherwise, chunked processing is required - caller must call settleEpochChunked()
    }
    
    /// @notice EXTENSION (Non-Standard): Process a chunk of settlement for an epoch
    /// @dev Can be called multiple times until all requests are processed.
    ///      Each call processes up to MAX_CHUNK_SIZE pending controllers.
    ///      This is an extension function, not part of base ERC-7540.
    function settleEpochChunked(uint256 _epochId)
        external
        onlyRole(SETTLER_ROLE)
        nonReentrant
    {
        SettlementStatus storage status = settlementStatus[_epochId];
        
        // Validate epoch was initialized for settlement
        if (status.totalShares == 0) revert SettlementIncomplete(_epochId);
        if (status.settled) revert AlreadySettled(_epochId);
        
        address[] storage controllers = epochPendingControllers[_epochId];
        uint256 startIndex = nextRequestIndexToProcess[_epochId];
        
        if (startIndex >= controllers.length) {
            // All controllers processed, mark as settled
            status.settled = true;
            emit EpochSettled(_epochId, status.totalShares, status.availableAssets, currentNAV);
            return;
        }
        
        // Calculate end index for this chunk
        uint256 endIndex = startIndex + MAX_CHUNK_SIZE;
        if (endIndex > controllers.length) {
            endIndex = controllers.length;
        }
        
        // Process this chunk
        _processSettlementChunk(
            _epochId,
            status.availableAssets,
            status.totalShares,
            status.proRataRatio,
            endIndex
        );
        
        // Update processed count and next index
        uint256 processedInChunk = 0;
        for (uint256 i = startIndex; i < endIndex; i++) {
            address controller = controllers[i];
            RedemptionRequest storage pending = _pendingRedeemRequest[controller];
            if (pending.status == RequestStatus.Pending && pending.shares > 0) {
                processedInChunk++;
            }
        }
        status.totalProcessed += uint128(processedInChunk);
        nextRequestIndexToProcess[_epochId] = endIndex;
        
        // Check if settlement is complete
        if (endIndex >= controllers.length) {
            status.settled = true;
            emit EpochSettled(_epochId, status.totalShares, status.availableAssets, currentNAV);
        }
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================
    
    /// @notice EXTENSION (Non-Standard): Check if NAV is fresh (not stale)
    /// @return fresh True if NAV was updated within NAV_STALENESS_THRESHOLD
    function isNAVFresh() external view returns (bool fresh) {
        return block.timestamp - lastNAVUpdate <= NAV_STALENESS_THRESHOLD;
    }
    
    /// @notice EXTENSION (Non-Standard): Get the current epoch ID
    /// @return Current epoch number based on block timestamp
    function getCurrentEpoch() external view returns (uint256) {
        return (block.timestamp - DEPLOY_TIME) / EPOCH_DURATION;
    }
    
    /// @notice EXTENSION (Non-Standard): Get the end timestamp of a specific epoch
    /// @param _epochId The epoch to query
    /// @return Timestamp when the epoch ends
    function getEpochEnd(uint256 _epochId) external view returns (uint256) {
        return DEPLOY_TIME + (_epochId + 1) * EPOCH_DURATION;
    }
    
    /// @notice EXTENSION (Non-Standard): Check if an epoch can be settled (has ended and NAV is fresh)
    /// @param _epochId The epoch to check
    /// @return canSettle True if epoch can be settled
    function canSettleEpoch(uint256 _epochId) external view returns (bool) {
        uint256 epochEnd = DEPLOY_TIME + (_epochId + 1) * EPOCH_DURATION;
        bool epochEnded = block.timestamp >= epochEnd;
        bool navFresh = block.timestamp - lastNAVUpdate <= NAV_STALENESS_THRESHOLD;
        return epochEnded && navFresh && !settlementStatus[_epochId].settled;
    }


    /// @notice EXTENSION (Non-Standard): Get the settlement status for an epoch
    /// @param _epochId The epoch to query
    /// @return status The settlement status struct
    /// @return nextIndex The next controller index to process (for chunked settlement)
    /// @return totalControllers The total number of controllers in the epoch
    function getSettlementStatus(uint256 _epochId)
        external
        view
        returns (SettlementStatus memory status, uint256 nextIndex, uint256 totalControllers)
    {
        status = settlementStatus[_epochId];
        nextIndex = nextRequestIndexToProcess[_epochId];
        totalControllers = epochPendingControllers[_epochId].length;
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    /// @notice Converts shares to assets using NAV
    /// @param shares Amount of shares to convert
    /// @param nav NAV value to use for conversion
    /// @return assets Amount of assets
    function _convertSharesToAssets(uint256 shares, uint256 nav) internal pure returns (uint256 assets) {
        // Assuming 1 share = 1 asset at NAV = 1e18
        // Formula: assets = (shares * nav) / 1e18
        if (nav == 0) return shares; // Fallback to 1:1 if no NAV
        return (shares * nav) / 1e18;
    }

    /// @notice Converts assets to shares using NAV
    /// @param assets Amount of assets to convert
    /// @param nav NAV value to use for conversion
    /// @return shares Amount of shares
    function _convertAssetsToShares(uint256 assets, uint256 nav) internal pure returns (uint256 shares) {
        // Assuming 1 share = 1 asset at NAV = 1e18
        // Formula: shares = (assets * 1e18) / nav
        if (nav == 0) return assets; // Fallback to 1:1 if no NAV
        return (assets * 1e18) / nav;
    }
    
    /// @notice Reverts if NAV is stale
    /// @dev Used by functions requiring fresh NAV
    function _requireFreshNAV() internal view {
        if (block.timestamp - lastNAVUpdate > NAV_STALENESS_THRESHOLD) {
            revert NAVStale(lastNAVUpdate, NAV_STALENESS_THRESHOLD);
        }
    }
    
    /// @notice Reverts if emergency mode is active
    /// @dev Used by functions that should be paused during emergencies
    function _requireNotEmergency() internal view {
        if (emergencyMode) revert EmergencyModeActive();
    }
    
    /// @notice Validates settlement preconditions
    /// @dev Checks epoch has ended, NAV is fresh, and epoch not already settled
    /// @param _epochId The epoch to validate
    function _validateSettlementPreconditions(uint256 _epochId) internal view {
        // Check epoch has ended
        uint256 epochEnd = DEPLOY_TIME + (_epochId + 1) * EPOCH_DURATION;
        if (block.timestamp < epochEnd) {
            revert EpochNotEnded(_epochId, epochEnd);
        }
        
        // Check NAV is fresh
        _requireFreshNAV();
        
        // Check not already settled
        if (settlementStatus[_epochId].settled) {
            revert AlreadySettled(_epochId);
        }
    }
    
    /// @notice Processes a chunk of settlement requests
    /// @dev Updates each pending request with claimable assets based on pro-rata ratio
    /// @param _epochId The epoch being settled
    /// @param _availableAssets Total assets available for distribution
    /// @param _totalShares Total shares across all pending requests
    /// @param _proRataRatio Ratio to apply when liquid assets < obligations (1e18 = 100%)
    /// @param _endIndex Index to process up to (exclusive)
    function _processSettlementChunk(
        uint256 _epochId,
        uint256 _availableAssets,
        uint256 _totalShares,
        uint256 _proRataRatio,
        uint256 _endIndex
    ) internal {
        address[] storage controllers = epochPendingControllers[_epochId];
        uint256 startIndex = nextRequestIndexToProcess[_epochId];
        
        for (uint256 i = startIndex; i < _endIndex; i++) {
            address controller = controllers[i];
            
            // Skip already processed controllers
            if (epochControllerProcessed[_epochId][controller]) {
                continue;
            }
            
            RedemptionRequest storage pending = _pendingRedeemRequest[controller];
            
            // Only process pending requests with shares
            if (pending.status == RequestStatus.Pending && pending.shares > 0) {
                // Calculate claimable assets with pro-rata if needed
                // Formula: claimable = (shares * proRataRatio) / 1e18
                uint256 claimableAssets = (pending.shares * _proRataRatio) / PRORATA_PRECISION;
                
                // Cap at available assets to prevent over-allocation
                if (claimableAssets > _availableAssets) {
                    claimableAssets = _availableAssets;
                }
                
                // Move from pending to claimable
                RedemptionRequest storage claimable = _claimableRedeemRequest[controller];
                claimable.controller = controller;
                claimable.owner = pending.owner;
                claimable.shares = pending.shares;
                claimable.assets = claimableAssets;
                claimable.status = RequestStatus.Claimable;
                claimable.createdAt = pending.createdAt;
                claimable.settledAt = uint48(block.timestamp);

                // Store NAV snapshot for claim calculation
                claimableNavSnapshot[controller] = NavSnapshot({
                    nav: currentNAV,
                    timestamp: uint48(block.timestamp),
                    isFresh: true,
                    __reserved: 0
                });

                // Store pro-rata data if applicable
                if (_proRataRatio < PRORATA_PRECISION) {
                    claimableProRataData[controller] = ProRataData({
                        ratio: uint128(_proRataRatio),
                        originalShares: uint128(pending.shares)
                    });
                }

                // Move epoch extension data
                EpochExtension storage pendingExt = pendingRequestExtension[controller];
                claimableRequestExtension[controller] = EpochExtension({
                    epochId: pendingExt.epochId,
                    __padding: 0,
                    __padding2: 0,
                    __reserved: 0
                });

                // Update total pending shares counter
                totalPendingRedeemShares -= pending.shares;

                // Delete pending request
                delete _pendingRedeemRequest[controller];
                delete pendingRequestExtension[controller];
                
                // Mark as processed
                epochControllerProcessed[_epochId][controller] = true;
            }
        }
    }
}
