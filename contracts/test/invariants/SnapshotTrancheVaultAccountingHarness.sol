// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @title SnapshotTrancheVaultAccountingHarness
/// @notice Accounting harness for testing payout invariants in snapshot-tranche vault
/// @dev This contract simulates the accounting model of SnapshotTrancheVault:
///      - Frozen position snapshots at epoch close
///      - Entitlement ratios locked at snapshot time
///      - Progressive payout distribution from realized outcomes
///      - Fee accounting at realization events
contract SnapshotTrancheVaultAccountingHarness is Test {
    
    // ============================================================================
    // STRUCTS
    // ============================================================================
    
    /// @notice Represents a frozen position in the snapshot
    /// @param positionId Unique identifier for the position
    /// @param costBasis Original cost basis of the position (for entitlement calc)
    /// @param currentValue Current estimated value at snapshot time
    /// @param realizedValue Amount realized from this position (0 initially)
    /// @param feeAmount Fees deducted from this position's realizations
    struct FrozenPosition {
        bytes32 positionId;
        uint256 costBasis;
        uint256 currentValue;
        uint256 realizedValue;
        uint256 feeAmount;
        bool isRealized;
        bool isForceClosed;
    }
    
    /// @notice Represents a redemption request with entitlement
    /// @param requestId Unique identifier
    /// @param user Address of the requester
    /// @param shares Amount of shares requested
    /// @param entitlementRatio Ratio of total portfolio entitled to (1e18 = 100%)
    /// @param totalEntitlement Absolute entitlement amount in assets
    /// @param claimedToDate Cumulative amount already claimed
    struct RedemptionRequest {
        uint256 requestId;
        address user;
        uint256 shares;
        uint256 entitlementRatio; // 1e18 precision
        uint256 totalEntitlement;
        uint256 claimedToDate;
        bool exists;
    }
    
    /// @notice Tracks a realization event
    /// @param eventId Unique identifier for this realization
    /// @param positionId Which position was realized
    /// @param grossAmount Total gross amount realized
    /// @param feeAmount Fee deducted
    /// @param netAmount Net amount available for distribution
    /// @param timestamp When the realization occurred
    struct RealizationEvent {
        bytes32 eventId;
        bytes32 positionId;
        uint256 grossAmount;
        uint256 feeAmount;
        uint256 netAmount;
        uint256 timestamp;
        bool processed;
    }
    
    /// @notice Tracks a payout distribution to a user
    /// @param distributionId Unique identifier
    /// @param requestId Which request received the payout
    /// @param realizationEventId Which realization triggered this
    /// @param amount Amount paid out
    struct PayoutDistribution {
        bytes32 distributionId;
        uint256 requestId;
        bytes32 realizationEventId;
        uint256 amount;
        uint256 timestamp;
    }
    
    // ============================================================================
    // STATE VARIABLES
    // ============================================================================
    
    // Frozen snapshot state
    mapping(bytes32 => FrozenPosition) public frozenPositions;
    bytes32[] public positionIds;
    uint256 public snapshotTotalValue;
    uint256 public snapshotTimestamp;
    bool public snapshotFrozen;
    
    // Redemption request state
    mapping(uint256 => RedemptionRequest) public redemptionRequests;
    uint256[] public requestIds;
    uint256 public nextRequestId = 1;
    uint256 public totalSharesRequested; // Track total for ratio calculations

    
    // Realization events
    mapping(bytes32 => RealizationEvent) public realizationEvents;
    bytes32[] public realizationEventIds;
    mapping(bytes32 => bytes32) public positionToLastEventId; // Maps positionId -> last realization eventId
    uint256 public totalRealizedGross;
    uint256 public totalFeesCollected;
    uint256 public totalNetDistributed;
    
    // Payout distributions
    mapping(bytes32 => PayoutDistribution) public payoutDistributions;
    bytes32[] public distributionIds;
    
    // Fee configuration
    uint256 public constant FEE_BASIS_POINTS = 100; // 1% = 100 bps
    uint256 public constant BPS_PRECISION = 10_000;
    
    // Precision for entitlement calculations
    uint256 public constant ENTITLEMENT_PRECISION = 1e18;
    
    // ============================================================================
    // ERRORS
    // ============================================================================
    
    error SnapshotNotFrozen();
    error SnapshotAlreadyFrozen();
    error PositionNotFound();
    error PositionAlreadyRealized();
    error RequestNotFound();
    error EntitlementExceeded();
    error RealizationNotFound();
    error AlreadyProcessed();
    error InsufficientRealizedFunds();
    error InvalidAmount();
    
    // ============================================================================
    // EVENTS
    // ============================================================================
    
    event SnapshotFrozen(uint256 totalValue, uint256 timestamp, uint256 numPositions);
    event PositionRealized(bytes32 indexed positionId, uint256 grossAmount, uint256 feeAmount, uint256 netAmount);
    event RequestCreated(uint256 indexed requestId, address indexed user, uint256 shares, uint256 entitlementRatio);
    event PayoutDistributed(bytes32 indexed distributionId, uint256 indexed requestId, uint256 amount);
    event ForceCloseExecuted(bytes32 indexed positionId, uint256 timestamp, string reason);
    
    // ============================================================================
    // SNAPSHOT FUNCTIONS
    // ============================================================================
    
    /// @notice Freeze the snapshot with positions
    /// @param _positionIds Array of position IDs
    /// @param _costBases Array of cost bases for each position
    /// @param _currentValues Array of current values at snapshot time
    function freezeSnapshot(
        bytes32[] calldata _positionIds,
        uint256[] calldata _costBases,
        uint256[] calldata _currentValues
    ) external {
        if (snapshotFrozen) revert SnapshotAlreadyFrozen();
        require(_positionIds.length == _costBases.length, "Length mismatch");
        require(_positionIds.length == _currentValues.length, "Length mismatch");
        
        uint256 totalValue = 0;
        
        for (uint256 i = 0; i < _positionIds.length; i++) {
            bytes32 posId = _positionIds[i];
            
            frozenPositions[posId] = FrozenPosition({
                positionId: posId,
                costBasis: _costBases[i],
                currentValue: _currentValues[i],
                realizedValue: 0,
                feeAmount: 0,
                isRealized: false,
                isForceClosed: false
            });
            
            positionIds.push(posId);
            totalValue += _currentValues[i];
        }
        
        snapshotTotalValue = totalValue;
        snapshotTimestamp = block.timestamp;
        snapshotFrozen = true;
        
        emit SnapshotFrozen(totalValue, block.timestamp, _positionIds.length);
    }
    
    /// @notice Create a redemption request with entitlement calculation
    /// @param _user Address of the requester
    /// @param _shares Amount of shares to redeem
    /// @return requestId The ID of the created request
    function createRedemptionRequest(address _user, uint256 _shares) external returns (uint256 requestId) {
        if (!snapshotFrozen) revert SnapshotNotFrozen();
        if (_shares == 0) revert InvalidAmount();
        
        requestId = nextRequestId++;
        
        // Update total shares before calculating ratio
        uint256 newTotalShares = totalSharesRequested + _shares;
        
        // Calculate entitlement ratio: shares / total_shares
        uint256 entitlementRatio = (totalSharesRequested > 0)
            ? (_shares * ENTITLEMENT_PRECISION) / totalSharesRequested
            : ENTITLEMENT_PRECISION; // First request gets 100% initially
        
        // For proportional entitlement, use the snapshot value
        uint256 totalEntitlement = (snapshotTotalValue * _shares) / newTotalShares;
        
        redemptionRequests[requestId] = RedemptionRequest({
            requestId: requestId,
            user: _user,
            shares: _shares,
            entitlementRatio: entitlementRatio,
            totalEntitlement: totalEntitlement,
            claimedToDate: 0,
            exists: true
        });
        
        requestIds.push(requestId);
        totalSharesRequested = newTotalShares;
        
        emit RequestCreated(requestId, _user, _shares, entitlementRatio);
    }
    
    // ============================================================================
    // REALIZATION FUNCTIONS
    // ============================================================================
    
    /// @notice Record a realization event for a position
    /// @param _positionId The position being realized
    /// @param _grossAmount The gross amount realized
    /// @return eventId The ID of the realization event
    function realizePosition(
        bytes32 _positionId,
        uint256 _grossAmount
    ) external returns (bytes32 eventId) {
        if (!snapshotFrozen) revert SnapshotNotFrozen();
        
        FrozenPosition storage position = frozenPositions[_positionId];
        if (position.positionId == bytes32(0)) revert PositionNotFound();
        if (position.isRealized) revert PositionAlreadyRealized();
        
        // Calculate fee
        uint256 feeAmount = (_grossAmount * FEE_BASIS_POINTS) / BPS_PRECISION;
        uint256 netAmount = _grossAmount - feeAmount;
        
        // Update position
        position.realizedValue = _grossAmount;
        position.feeAmount = feeAmount;
        position.isRealized = true;
        
        // Update global accounting
        totalRealizedGross += _grossAmount;
        totalFeesCollected += feeAmount;
        
        // Create realization event
        eventId = keccak256(abi.encodePacked(_positionId, _grossAmount, block.timestamp, realizationEventIds.length));
        
        realizationEvents[eventId] = RealizationEvent({
            eventId: eventId,
            positionId: _positionId,
            grossAmount: _grossAmount,
            feeAmount: feeAmount,
            netAmount: netAmount,
            timestamp: block.timestamp,
            processed: false
        });
        
        realizationEventIds.push(eventId);
        positionToLastEventId[_positionId] = eventId;
        
        emit PositionRealized(_positionId, _grossAmount, feeAmount, netAmount);
    }
    
    /// @notice Force close an unresolved position after timeout
    /// @param _positionId The position to force close
    /// @param _reason Reason for force close
    function forceClosePosition(bytes32 _positionId, string calldata _reason) external {
        if (!snapshotFrozen) revert SnapshotNotFrozen();
        
        FrozenPosition storage position = frozenPositions[_positionId];
        if (position.positionId == bytes32(0)) revert PositionNotFound();
        if (position.isRealized) revert PositionAlreadyRealized();
        
        position.isRealized = true;
        position.isForceClosed = true;
        position.realizedValue = 0;
        
        emit ForceCloseExecuted(_positionId, block.timestamp, _reason);
    }
    
    // ============================================================================
    // DISTRIBUTION FUNCTIONS
    // ============================================================================
    
    /// @notice Distribute payouts for a realization event to all eligible requests
    /// @param _eventId The realization event to distribute
    /// @return totalDistributed Total amount distributed
    function distributePayout(bytes32 _eventId) external returns (uint256 totalDistributed) {
        RealizationEvent storage event_ = realizationEvents[_eventId];
        if (event_.eventId == bytes32(0)) revert RealizationNotFound();
        if (event_.processed) revert AlreadyProcessed();
        
        uint256 netAmount = event_.netAmount;
        
        // Distribute proportionally to all requests based on shares / totalShares
        for (uint256 i = 0; i < requestIds.length; i++) {
            RedemptionRequest storage request = redemptionRequests[requestIds[i]];
            if (!request.exists) continue;
            
            // Calculate payout: netAmount * shares / totalSharesRequested
            uint256 payoutAmount = (netAmount * request.shares) / totalSharesRequested;
            
            // Check entitlement cap: claimedToDate + payout <= totalEntitlement
            if (request.claimedToDate + payoutAmount > request.totalEntitlement) {
                // Cap at remaining entitlement
                payoutAmount = request.totalEntitlement - request.claimedToDate;
            }
            
            if (payoutAmount > 0) {
                // Create distribution record
                bytes32 distributionId = keccak256(abi.encodePacked(_eventId, request.requestId, block.timestamp));
                
                payoutDistributions[distributionId] = PayoutDistribution({
                    distributionId: distributionId,
                    requestId: request.requestId,
                    realizationEventId: _eventId,
                    amount: payoutAmount,
                    timestamp: block.timestamp
                });
                
                distributionIds.push(distributionId);
                
                // Update request state
                request.claimedToDate += payoutAmount;
                
                // Update global accounting
                totalNetDistributed += payoutAmount;
                totalDistributed += payoutAmount;
                
                emit PayoutDistributed(distributionId, request.requestId, payoutAmount);
            }
        }
        
        event_.processed = true;
    }
    
    /// @notice Claim accumulated payouts for a request
    /// @param _requestId The request to claim for
    /// @return claimedAmount Amount claimed in this transaction
    function claim(uint256 _requestId) external returns (uint256 claimedAmount) {
        RedemptionRequest storage request = redemptionRequests[_requestId];
        if (!request.exists) revert RequestNotFound();
        
        claimedAmount = request.claimedToDate;
        // In real implementation, would transfer tokens here
        // For harness, we just track the claim
    }
    
    // ============================================================================
    // VIEW FUNCTIONS FOR INVARIANT CHECKING
    // ============================================================================
    
    /// @notice Get total entitlement across all requests
    function getTotalEntitlement() external view returns (uint256 total) {
        for (uint256 i = 0; i < requestIds.length; i++) {
            total += redemptionRequests[requestIds.length].totalEntitlement;
        }
    }
    
    /// @notice Get total claimed across all requests
    function getTotalClaimed() external view returns (uint256 total) {
        for (uint256 i = 0; i < requestIds.length; i++) {
            total += redemptionRequests[requestIds[i]].claimedToDate;
        }
        return total;
    }
    
    /// @notice Get the sum of all payout distributions
    function getSumOfAllDistributions() external view returns (uint256 total) {
        for (uint256 i = 0; i < distributionIds.length; i++) {
            total += payoutDistributions[distributionIds[i]].amount;
        }
        return total;
    }
    
    /// @notice Get the sum of all realization net amounts
    function getSumOfAllNetRealizations() external view returns (uint256 total) {
        for (uint256 i = 0; i < realizationEventIds.length; i++) {
            total += realizationEvents[realizationEventIds[i]].netAmount;
        }
        return total;
    }
    
    /// @notice Get the sum of all realization gross amounts
    function getSumOfAllGrossRealizations() external view returns (uint256 total) {
        for (uint256 i = 0; i < realizationEventIds.length; i++) {
            total += realizationEvents[realizationEventIds[i]].grossAmount;
        }
        return total;
    }
    
    /// @notice Get the sum of all fees
    function getSumOfAllFees() external view returns (uint256 total) {
        for (uint256 i = 0; i < realizationEventIds.length; i++) {
            total += realizationEvents[realizationEventIds[i]].feeAmount;
        }
        return total;
    }
    
    /// @notice Check if a request has exceeded its entitlement
    function hasExceededEntitlement(uint256 _requestId) external view returns (bool) {
        RedemptionRequest storage request = redemptionRequests[_requestId];
        if (!request.exists) return false;
        return request.claimedToDate > request.totalEntitlement;
    }
    
    /// @notice Get remaining entitlement for a request
    function getRemainingEntitlement(uint256 _requestId) external view returns (uint256) {
        RedemptionRequest storage request = redemptionRequests[_requestId];
        if (!request.exists) return 0;
        if (request.claimedToDate >= request.totalEntitlement) return 0;
        return request.totalEntitlement - request.claimedToDate;
    }
    
    /// @notice Calculate expected rounding error bound for a given number of operations
    /// @param _numOperations Number of division operations performed
    /// @return maxError Maximum expected rounding error in wei
    function calculateRoundingErrorBound(uint256 _numOperations) external pure returns (uint256 maxError) {
        // Each division can lose up to 1 wei
        // Conservative bound: numOperations wei
        return _numOperations;
    }
}
