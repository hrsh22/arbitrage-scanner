// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SnapshotTrancheVault
/// @notice A vault with frozen snapshot epochs and timeout/force-close controls
contract SnapshotTrancheVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant SNAPSHOT_ROLE = keccak256("SNAPSHOT_ROLE");

    IERC20 public immutable asset;
    uint256 public immutable EPOCH_DURATION;
    uint256 public immutable DEPLOY_TIME;

    /// @notice NAV staleness threshold (6 hours)
    uint256 public constant NAV_STALENESS_THRESHOLD = 6 hours;
    
    /// @notice Precision for entitlement ratio calculations (1e18 = 100%)
    uint256 public constant ENTITLEMENT_PRECISION = 1e18;
    
    /// @notice Latest NAV snapshot value
    uint256 public lastNAV;
    
    /// @notice Timestamp of last NAV update
    uint256 public lastNAVUpdate;
    /// @notice Default realization timeout - 30 days after snapshot (Task 10)
    uint256 public constant DEFAULT_REALIZATION_TIMEOUT = 30 days;

    struct FrozenPosition {
        bytes32 positionId;
        uint256 costBasis;
        uint256 snapshotValue;
        bool isRealized;
        bool isForceClosed;
        uint256 forceClosedAt;
        string forceCloseReason;
        bool exists;
    
    }

    /// @notice Status of a redemption request
    enum RequestStatus { Pending, Frozen, PartiallyClaimed, FullyClaimed, Cancelled }

    
    struct EpochSnapshot {
        bytes32 snapshotHash;
        uint256 timestamp;
        uint256 realizationDeadline;
        bool exists;
    }
    
    struct RealizationEvent {
        bytes32 eventId;
        bytes32 positionId;
        uint256 timestamp;
        bool isForceClose;
        string reason;
        bool exists;
    }
    
    /// @notice Redemption request data structure
    struct RedemptionRequest {
        uint256 requestId;
        address user;
        uint256 shares;
        uint256 epochId;
        RequestStatus status;
        uint256 createdAt;
        bool exists;
    }
    
    /// @notice Entitlement data for a redemption request
    struct Entitlement {
        address user;
        uint256 shares;
        uint256 entitlementRatio;
        uint256 totalEntitlement;
        uint256 claimedToDate;
        bool locked;
        bool exists;
    }
    
    mapping(uint256 => RedemptionRequest) public redemptionRequests;
    mapping(address => uint256[]) public userRequests;
    mapping(uint256 => uint256[]) public epochRequests;
    mapping(uint256 => mapping(uint256 => Entitlement)) public entitlements;
    mapping(bytes32 => uint256) public snapshotIdToEpoch;
    uint256 public nextRequestId = 1;

    mapping(uint256 => EpochSnapshot) public snapshots;
    mapping(uint256 => mapping(bytes32 => FrozenPosition)) public frozenPositions;
    mapping(uint256 => bytes32[]) public epochPositionIds;
    mapping(uint256 => mapping(bytes32 => RealizationEvent)) public realizationEvents;

    error InvalidAddress();
    error InvalidEpochDuration();
    error PositionNotFound();
    error PositionAlreadyRealized();
    error ForceCloseBeforeDeadline();
    error SnapshotNotFound();

    error NAVStale();
    error EmergencyModeActive();
    error EpochNotEnded();
    error SnapshotAlreadyFrozen();
    error RequestNotFound();
    error RequestAlreadyCancelled();
    error CannotCancelAfterSettlement();
    error NotRequestOwner();
    error ZeroAmount();
    error EntitlementNotLocked();
    error OverClaim();
    event SnapshotFrozen(
        uint256 indexed epochId,
        bytes32 indexed snapshotHash,
        uint256 timestamp,
        uint256 realizationDeadline
    );
    
    event ForceCloseExecuted(
        uint256 indexed epochId,
        bytes32 indexed positionId,
        bytes32 indexed eventId,
        uint256 timestamp,
        string reason
    );

    constructor(
        address _asset,
        address _admin,
        address _settler,
        address _snapshotter,
        uint256 _epochDuration
    ) {
        if (_asset == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();
        if (_settler == address(0)) revert InvalidAddress();
        if (_snapshotter == address(0)) revert InvalidAddress();
        if (_epochDuration == 0) revert InvalidEpochDuration();
        
        asset = IERC20(_asset);
        EPOCH_DURATION = _epochDuration;
        DEPLOY_TIME = block.timestamp;
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(SETTLER_ROLE, _settler);
        _grantRole(SNAPSHOT_ROLE, _snapshotter);
    }

    function freezeSnapshot(
        uint256 _epochId,
        bytes32[] calldata _positionIds,
        uint256[] calldata _costBases,
        uint256[] calldata _currentValues
    ) external onlyRole(SNAPSHOT_ROLE) {
        require(!snapshots[_epochId].exists, "Already frozen");
        require(_positionIds.length == _costBases.length, "Length mismatch");
        
        uint256 deadline = block.timestamp + DEFAULT_REALIZATION_TIMEOUT;
        
        for (uint256 i = 0; i < _positionIds.length; i++) {
            bytes32 posId = _positionIds[i];
            frozenPositions[_epochId][posId] = FrozenPosition({
                positionId: posId,
                costBasis: _costBases[i],
                snapshotValue: _currentValues[i],
                isRealized: false,
                isForceClosed: false,
                forceClosedAt: 0,
                forceCloseReason: "",
                exists: true
            });
            epochPositionIds[_epochId].push(posId);
        }
        
        bytes32 snapshotHash = keccak256(abi.encodePacked(_epochId, block.timestamp));
        
        snapshots[_epochId] = EpochSnapshot({
            snapshotHash: snapshotHash,
            timestamp: block.timestamp,
            realizationDeadline: deadline,
            exists: true
        });
        
        emit SnapshotFrozen(_epochId, snapshotHash, block.timestamp, deadline);
    }

    function forceClosePosition(
        bytes32 _positionId,
        uint256 _epochId,
        string calldata _reason
    ) external onlyRole(ADMIN_ROLE) returns (bytes32 eventId) {
        EpochSnapshot storage snapshot = snapshots[_epochId];
        if (!snapshot.exists) revert SnapshotNotFound();
        
        if (block.timestamp <= snapshot.realizationDeadline) {
            revert ForceCloseBeforeDeadline();
        }
        
        FrozenPosition storage position = frozenPositions[_epochId][_positionId];
        if (!position.exists) revert PositionNotFound();
        if (position.isRealized) revert PositionAlreadyRealized();
        
        position.isRealized = true;
        position.isForceClosed = true;
        position.forceClosedAt = block.timestamp;
        position.forceCloseReason = _reason;
        
        eventId = keccak256(abi.encodePacked(
            "FORCE_CLOSE",
            _positionId,
            _epochId,
            block.timestamp,
            _reason
        ));
        
        realizationEvents[_epochId][eventId] = RealizationEvent({
            eventId: eventId,
            positionId: _positionId,
            timestamp: block.timestamp,
            isForceClose: true,
            reason: _reason,
            exists: true
        });
        
        emit ForceCloseExecuted(_epochId, _positionId, eventId, block.timestamp, _reason);
        
        return eventId;
    }

    function canForceClose(bytes32 _positionId, uint256 _epochId) external view returns (bool) {
        EpochSnapshot storage snapshot = snapshots[_epochId];
        if (!snapshot.exists) return false;
        if (block.timestamp <= snapshot.realizationDeadline) return false;
        
        FrozenPosition storage position = frozenPositions[_epochId][_positionId];
        if (!position.exists || position.isRealized) return false;
        
        return true;
    }
    
    function getTimeoutStatus(uint256 _epochId) external view returns (
        bool isTimedOut,
        uint256 deadline,
        uint256 timeRemaining,
        uint256 timePastDeadline
    ) {
        deadline = snapshots[_epochId].realizationDeadline;
        
        if (block.timestamp > deadline && deadline > 0) {
            isTimedOut = true;
            timePastDeadline = block.timestamp - deadline;
            timeRemaining = 0;
        } else {
            isTimedOut = false;
            timeRemaining = deadline > block.timestamp ? deadline - block.timestamp : 0;
            timePastDeadline = 0;
        }
    }
    
    function getForceCloseInfo(bytes32 _positionId, uint256 _epochId) external view returns (
        bool isForceClosed,
        uint256 forceClosedAt,
        string memory reason
    ) {
        FrozenPosition storage position = frozenPositions[_epochId][_positionId];
        return (position.isForceClosed, position.forceClosedAt, position.forceCloseReason);
    }
    
    function getRealizationDeadline(uint256 _epochId) external view returns (uint256) {
        return snapshots[_epochId].realizationDeadline;
    }
    
    function getCurrentEpoch() external view returns (uint256) {
        return (block.timestamp - DEPLOY_TIME) / EPOCH_DURATION;
    }
}
