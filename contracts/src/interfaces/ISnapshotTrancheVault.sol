// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

/// @title ISnapshotTrancheVault
/// @notice Interface for SnapshotTrancheVault to expose types for testing
/// @dev This interface defines all structs and enums for external reference
interface ISnapshotTrancheVault {
    // ============================================================================
    // ENUMS
    // ============================================================================
    
    enum SnapshotStatus {
        Pending,
        Frozen,
        Realizing,
        Completed
    }
    
    enum RequestStatus {
        Pending,
        Frozen,
        PartiallyClaimed,
        FullyClaimed,
        Cancelled
    }
    
    // ============================================================================
    // STRUCTS
    // ============================================================================
    
    struct FrozenPosition {
        bytes32 positionId;
        uint256 costBasis;
        uint256 snapshotValue;
        uint256 realizedValue;
        uint256 feeAmount;
        bool isRealized;
        bool isForceClosed;
    }
    
    struct EpochSnapshot {
        uint256 epochId;
        bytes32 snapshotId;
        uint256 totalValue;
        uint256 timestamp;
        uint256 numPositions;
        SnapshotStatus status;
        uint256 totalRealizedGross;
        uint256 totalFeesCollected;
        uint256 totalNetDistributed;
    }
    
    struct RedemptionRequest {
        uint256 requestId;
        address user;
        uint256 shares;
        uint256 epochId;
        RequestStatus status;
        uint256 createdAt;
        uint256 entitlementRatio;
        uint256 totalEntitlement;
        uint256 claimedToDate;
    }
    
    struct RealizationEvent {
        bytes32 eventId;
        bytes32 positionId;
        uint256 grossAmount;
        uint256 feeAmount;
        uint256 netAmount;
        uint256 timestamp;
        bool processed;
    }
    
    // ============================================================================
    // EVENTS
    // ============================================================================
    
    event RequestCreated(
        uint256 indexed requestId,
        address indexed user,
        uint256 shares,
        uint256 targetEpoch
    );
    
    event RequestCancelled(
        uint256 indexed requestId,
        address indexed user,
        uint256 shares
    );
    
    event SnapshotFrozen(
        uint256 indexed epochId,
        bytes32 indexed snapshotId,
        uint256 totalValue,
        uint256 timestamp,
        uint256 numPositions
    );
    
    event EntitlementLocked(
        uint256 indexed requestId,
        address indexed user,
        uint256 shares,
        uint256 entitlementRatio,
        uint256 totalEntitlement
    );
    
    event PositionRealized(
        uint256 indexed epochId,
        bytes32 indexed positionId,
        bytes32 indexed eventId,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount
    );
    
    event PayoutDistributed(
        uint256 indexed epochId,
        bytes32 indexed eventId,
        uint256 indexed requestId,
        uint256 amount
    );
    
    event ClaimProcessed(
        uint256 indexed requestId,
        address indexed user,
        uint256 assets
    );
    
    event EmergencyModeSet(bool active);
    
    event NAVUpdated(uint256 nav, uint256 timestamp);
}