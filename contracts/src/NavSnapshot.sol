// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

/// @title NavSnapshot
/// @notice Settlement NAV snapshot recording with explicit timestamp and epoch linkage.
/// @dev Provides staleness threshold checks for settlement inputs with explicit revert reasons.
contract NavSnapshot {
    // ============ Errors ============

    /// @notice Thrown when NAV is stale (older than STALENESS_THRESHOLD).
    /// @param lastUpdate Timestamp of the last NAV update.
    /// @param currentTime Current block timestamp.
    error NavStale(uint256 lastUpdate, uint256 currentTime);

    /// @notice Thrown when caller is not authorized as NAV updater.
    error NotNavUpdater();

    /// @notice Thrown when attempting to record a snapshot with invalid epoch ID.
    error InvalidEpoch();

    /// @notice Thrown when attempting to record a snapshot with zero total assets.
    error ZeroTotalAssets();

    // ============ Structs ============

    /// @notice Represents a NAV snapshot at a specific point in time.
    /// @param timestamp Block timestamp when the snapshot was recorded.
    /// @param epochId The epoch ID associated with this snapshot.
    /// @param totalAssets Total assets in the vault at snapshot time.
    /// @param totalShares Total shares outstanding at snapshot time.
    struct NavSnapshotData {
        uint256 timestamp;
        uint256 epochId;
        uint256 totalAssets;
        uint256 totalShares;
    }

    // ============ Constants ============

    /// @notice Staleness threshold for settlement inputs (6 hours = 21600 seconds).
    uint256 public constant STALENESS_THRESHOLD = 6 hours;

    // ============ State Variables ============

    /// @notice The authorized NAV updater address.
    address public navUpdater;

    /// @notice The latest NAV snapshot data.
    NavSnapshotData public latestSnapshot;

    /// @notice Historical snapshots indexed by epoch ID.
    mapping(uint256 => NavSnapshotData) public snapshotsByEpoch;

    /// @notice Array of all recorded epoch IDs for historical lookup.
    uint256[] public epochHistory;

    // ============ Events ============

    /// @notice Emitted when a new NAV snapshot is recorded.
    /// @param epochId The epoch ID for the snapshot.
    /// @param timestamp Block timestamp of the snapshot.
    /// @param totalAssets Total assets at snapshot time.
    /// @param totalShares Total shares at snapshot time.
    event NavSnapshotRecorded(
        uint256 indexed epochId,
        uint256 timestamp,
        uint256 totalAssets,
        uint256 totalShares
    );

    /// @notice Emitted when the NAV updater address is changed.
    /// @param previousUpdater The previous NAV updater address.
    /// @param newUpdater The new NAV updater address.
    event NavUpdaterUpdated(address indexed previousUpdater, address indexed newUpdater);

    // ============ Modifiers ============

    /// @notice Restricts function to NAV updater only.
    modifier onlyNavUpdater() {
        if (msg.sender != navUpdater) {
            revert NotNavUpdater();
        }
        _;
    }

    // ============ Constructor ============

    /// @notice Initializes the NavSnapshot contract with the specified NAV updater.
    /// @param _navUpdater The authorized address for recording NAV snapshots.
    constructor(address _navUpdater) {
        require(_navUpdater != address(0), "invalid nav updater");
        navUpdater = _navUpdater;
    }

    // ============ External Functions ============

    /// @notice Records a new NAV snapshot with timestamp and epoch linkage.
    /// @dev Only callable by NAV_UPDATER_ROLE. Reverts if epoch ID is invalid or total assets is zero.
    /// @param epochId The epoch ID associated with this snapshot.
    /// @param totalAssets Total assets in the vault at snapshot time.
    /// @param totalShares Total shares outstanding at snapshot time.
    function recordNavSnapshot(
        uint256 epochId,
        uint256 totalAssets,
        uint256 totalShares
    ) external onlyNavUpdater {
        if (epochId == 0) {
            revert InvalidEpoch();
        }
        if (totalAssets == 0) {
            revert ZeroTotalAssets();
        }

        NavSnapshotData memory snapshot = NavSnapshotData({
            timestamp: block.timestamp,
            epochId: epochId,
            totalAssets: totalAssets,
            totalShares: totalShares
        });

        latestSnapshot = snapshot;
        snapshotsByEpoch[epochId] = snapshot;
        epochHistory.push(epochId);

        emit NavSnapshotRecorded(epochId, block.timestamp, totalAssets, totalShares);
    }

    /// @notice Updates the NAV updater address.
    /// @dev Only callable by current NAV updater.
    /// @param newNavUpdater The new authorized NAV updater address.
    function setNavUpdater(address newNavUpdater) external onlyNavUpdater {
        require(newNavUpdater != address(0), "invalid nav updater");
        
        address previousUpdater = navUpdater;
        navUpdater = newNavUpdater;
        
        emit NavUpdaterUpdated(previousUpdater, newNavUpdater);
    }

    // ============ View Functions ============

    /// @notice Checks if the current NAV is stale (older than STALENESS_THRESHOLD).
    /// @dev Returns true if no snapshot exists or if the latest snapshot is stale.
    /// @return isStale True if NAV is stale, false otherwise.
    function isNavStale() external view returns (bool isStale) {
        if (latestSnapshot.timestamp == 0) {
            return true;
        }
        return block.timestamp - latestSnapshot.timestamp > STALENESS_THRESHOLD;
    }

    /// @notice Returns the latest NAV snapshot data.
    /// @dev Returns the full snapshot struct including timestamp, epochId, totalAssets, totalShares.
    /// @return The latest NavSnapshotData struct.
    function getLatestNav() external view returns (NavSnapshotData memory) {
        return latestSnapshot;
    }

    /// @notice Returns the NAV snapshot for a specific epoch.
    /// @param epochId The epoch ID to query.
    /// @return The NavSnapshotData for the specified epoch, or empty struct if not found.
    function getNavByEpoch(uint256 epochId) external view returns (NavSnapshotData memory) {
        return snapshotsByEpoch[epochId];
    }

    /// @notice Returns the total number of recorded epochs.
    /// @return The length of the epoch history array.
    function getEpochCount() external view returns (uint256) {
        return epochHistory.length;
    }

    /// @notice Returns the epoch ID at a specific index in the history.
    /// @param index The index in the epoch history array.
    /// @return The epoch ID at the specified index.
    function getEpochAtIndex(uint256 index) external view returns (uint256) {
        require(index < epochHistory.length, "index out of bounds");
        return epochHistory[index];
    }

    // ============ Enforcement Functions ============

    /// @notice Enforces that the NAV is fresh (not stale) for settlement operations.
    /// @dev Reverts with NavStale error if NAV is stale or no snapshot exists.
    function enforceFreshNav() external view {
        if (latestSnapshot.timestamp == 0) {
            revert NavStale(0, block.timestamp);
        }

        uint256 timeSinceUpdate = block.timestamp - latestSnapshot.timestamp;
        if (timeSinceUpdate > STALENESS_THRESHOLD) {
            revert NavStale(latestSnapshot.timestamp, block.timestamp);
        }
    }

    /// @notice Settlement precheck that enforces fresh NAV with explicit revert reason.
    /// @dev Use this in settlement flows before processing redemptions/settlements.
    /// @return snapshot The fresh NAV snapshot data if checks pass.
    function settlementPrecheck() external view returns (NavSnapshotData memory snapshot) {
        if (latestSnapshot.timestamp == 0) {
            revert NavStale(0, block.timestamp);
        }

        uint256 timeSinceUpdate = block.timestamp - latestSnapshot.timestamp;
        if (timeSinceUpdate > STALENESS_THRESHOLD) {
            revert NavStale(latestSnapshot.timestamp, block.timestamp);
        }

        return latestSnapshot;
    }
}
