// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestHelper} from "./helpers/TestHelper.sol";
import {NavSnapshot} from "../src/NavSnapshot.sol";

contract NavSnapshotTest is TestHelper {
    NavSnapshot internal navSnapshot;
    
    address internal navUpdater;
    address internal unauthorized;
    
    uint256 internal constant STALENESS_THRESHOLD = 6 hours; // 21600 seconds
    
    function setUp() public {
        navUpdater = makeAddr("navUpdater");
        unauthorized = makeAddr("unauthorized");
        
        navSnapshot = new NavSnapshot(navUpdater);
    }
    
    // ============ Constructor Tests ============
    
    function testConstructorSetsNavUpdater() public view {
        assertEq(navSnapshot.navUpdater(), navUpdater, "navUpdater must be set");
    }
    
    function testConstructorRevertsZeroAddress() public {
        vm.expectRevert("invalid nav updater");
        new NavSnapshot(address(0));
    }
    
    // ============ recordNavSnapshot Tests ============
    
    function testRecordNavSnapshotSuccess() public {
        uint256 epochId = 1;
        uint256 totalAssets = 1000e6;
        uint256 totalShares = 1000e18;
        
        vm.prank(navUpdater);
        vm.expectEmit(true, false, false, true);
        emit NavSnapshot.NavSnapshotRecorded(epochId, block.timestamp, totalAssets, totalShares);
        navSnapshot.recordNavSnapshot(epochId, totalAssets, totalShares);
        
        NavSnapshot.NavSnapshotData memory snapshot = navSnapshot.getLatestNav();
        assertEq(snapshot.epochId, epochId, "epochId must match");
        assertEq(snapshot.totalAssets, totalAssets, "totalAssets must match");
        assertEq(snapshot.totalShares, totalShares, "totalShares must match");
        assertEq(snapshot.timestamp, block.timestamp, "timestamp must be current block");
    }
    
    function testRecordNavSnapshotOnlyNavUpdater() public {
        vm.prank(unauthorized);
        vm.expectRevert(NavSnapshot.NotNavUpdater.selector);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
    }
    
    function testRecordNavSnapshotRevertsZeroEpoch() public {
        vm.prank(navUpdater);
        vm.expectRevert(NavSnapshot.InvalidEpoch.selector);
        navSnapshot.recordNavSnapshot(0, 1000e6, 1000e18);
    }
    
    function testRecordNavSnapshotRevertsZeroTotalAssets() public {
        vm.prank(navUpdater);
        vm.expectRevert(NavSnapshot.ZeroTotalAssets.selector);
        navSnapshot.recordNavSnapshot(1, 0, 1000e18);
    }
    
    function testRecordNavSnapshotMultipleEpochs() public {
        // Record first epoch
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Warp time forward
        vm.warp(block.timestamp + 1 hours);
        
        // Record second epoch
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(2, 1500e6, 1500e18);
        
        // Verify latest is epoch 2
        NavSnapshot.NavSnapshotData memory latest = navSnapshot.getLatestNav();
        assertEq(latest.epochId, 2, "latest epoch must be 2");
        
        // Verify we can still query epoch 1
        NavSnapshot.NavSnapshotData memory epoch1 = navSnapshot.getNavByEpoch(1);
        assertEq(epoch1.epochId, 1, "epoch1 query must return epoch 1");
        assertEq(epoch1.totalAssets, 1000e6, "epoch1 assets must match");
        
        // Verify epoch count
        assertEq(navSnapshot.getEpochCount(), 2, "epoch count must be 2");
    }
    
    // ============ isNavStale Tests ============
    
    function testIsNavStaleReturnsTrueWhenNoSnapshot() public view {
        assertTrue(navSnapshot.isNavStale(), "NAV must be stale when no snapshot");
    }
    
    function testIsNavStaleReturnsFalseImmediatelyAfterSnapshot() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        assertFalse(navSnapshot.isNavStale(), "NAV must be fresh immediately after snapshot");
    }
    
    function testIsNavStaleReturnsFalseAtThresholdBoundary() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Warp to exactly 6 hours (boundary - should NOT be stale at exactly 6h)
        // Note: stale check is `> STALENESS_THRESHOLD`, so at exactly 6h it's NOT stale
        vm.warp(block.timestamp + STALENESS_THRESHOLD);
        
        assertFalse(navSnapshot.isNavStale(), "NAV must NOT be stale at exactly 6h");
    }
    
    function testIsNavStaleReturnsTrueAfterThreshold() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Warp past 6 hours
        vm.warp(block.timestamp + STALENESS_THRESHOLD + 1);
        
        assertTrue(navSnapshot.isNavStale(), "NAV must be stale after 6h + 1s");
    }
    
    function testIsNavStaleFreshAt5h59m() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Warp to 5h 59m = 21540 seconds (60 seconds before 6h)
        vm.warp(block.timestamp + STALENESS_THRESHOLD - 60);
        
        assertFalse(navSnapshot.isNavStale(), "NAV must be fresh at 5h59m");
    }
    
    // ============ enforceFreshNav Tests ============
    
    function testEnforceFreshNavRevertsWhenNoSnapshot() public {
        // DETERMINISTIC PATTERN: Capture timestamp immediately before expectRevert
        // This avoids timing mismatch between test expectation and contract view
        uint256 currentTime = block.timestamp;
        
        vm.expectRevert(
            abi.encodeWithSelector(NavSnapshot.NavStale.selector, 0, currentTime)
        );
        navSnapshot.enforceFreshNav();
    }
    
    function testEnforceFreshNavSucceedsImmediatelyAfterSnapshot() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Should not revert
        navSnapshot.enforceFreshNav();
    }
    
    function testEnforceFreshNavRevertsAfter6h01m() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // IMPORTANT: Capture timestamp AFTER recording but BEFORE warping
        uint256 snapshotTime = navSnapshot.getLatestNav().timestamp;
        
        // Warp to 6h 1m = 21660 seconds
        vm.warp(block.timestamp + STALENESS_THRESHOLD + 60);
        
        // DETERMINISTIC PATTERN: Capture current timestamp immediately before expectRevert
        uint256 currentTime = block.timestamp;
        
        vm.expectRevert(
            abi.encodeWithSelector(NavSnapshot.NavStale.selector, snapshotTime, currentTime)
        );
        navSnapshot.enforceFreshNav();
    }
    
    function testEnforceFreshNavSucceedsAt5h59m() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Warp to 5h 59m
        vm.warp(block.timestamp + STALENESS_THRESHOLD - 60);
        
        // Should not revert
        navSnapshot.enforceFreshNav();
    }
    
    // ============ settlementPrecheck Tests ============
    
    function testSettlementPrecheckRevertsWhenNoSnapshot() public {
        // DETERMINISTIC PATTERN: Capture timestamp immediately before expectRevert
        uint256 currentTime = block.timestamp;
        
        vm.expectRevert(
            abi.encodeWithSelector(NavSnapshot.NavStale.selector, 0, currentTime)
        );
        navSnapshot.settlementPrecheck();
    }
    
    function testSettlementPrecheckSucceedsImmediatelyAfterSnapshot() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        NavSnapshot.NavSnapshotData memory snapshot = navSnapshot.settlementPrecheck();
        
        assertEq(snapshot.epochId, 1, "epochId must match");
        assertEq(snapshot.totalAssets, 1000e6, "totalAssets must match");
        assertEq(snapshot.totalShares, 1000e18, "totalShares must match");
    }
    
    function testSettlementPrecheckRevertsAfter6h01m() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // IMPORTANT: Capture timestamp AFTER recording but BEFORE warping
        uint256 snapshotTime = navSnapshot.getLatestNav().timestamp;
        
        // Warp to 6h 1m
        vm.warp(block.timestamp + STALENESS_THRESHOLD + 60);
        
        // DETERMINISTIC PATTERN: Capture current timestamp immediately before expectRevert
        uint256 currentTime = block.timestamp;
        
        vm.expectRevert(
            abi.encodeWithSelector(NavSnapshot.NavStale.selector, snapshotTime, currentTime)
        );
        navSnapshot.settlementPrecheck();
    }
    
    function testSettlementPrecheckSucceedsAt5h59m() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Warp to 5h 59m
        vm.warp(block.timestamp + STALENESS_THRESHOLD - 60);
        
        NavSnapshot.NavSnapshotData memory snapshot = navSnapshot.settlementPrecheck();
        
        assertEq(snapshot.epochId, 1, "epochId must match");
        assertEq(snapshot.totalAssets, 1000e6, "totalAssets must match");
    }
    
    // ============ getNavByEpoch Tests ============
    
    function testGetNavByEpochReturnsEmptyForUnknownEpoch() public view {
        NavSnapshot.NavSnapshotData memory snapshot = navSnapshot.getNavByEpoch(999);
        assertEq(snapshot.epochId, 0, "unknown epoch must return empty struct");
        assertEq(snapshot.timestamp, 0, "timestamp must be 0");
    }
    
    function testGetNavByEpochReturnsCorrectData() public {
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(5, 5000e6, 5000e18);
        
        NavSnapshot.NavSnapshotData memory snapshot = navSnapshot.getNavByEpoch(5);
        assertEq(snapshot.epochId, 5, "epochId must match");
        assertEq(snapshot.totalAssets, 5000e6, "totalAssets must match");
        assertEq(snapshot.totalShares, 5000e18, "totalShares must match");
    }
    
    // ============ setNavUpdater Tests ============
    
    function testSetNavUpdaterSuccess() public {
        address newUpdater = makeAddr("newUpdater");
        
        vm.prank(navUpdater);
        vm.expectEmit(true, true, false, false);
        emit NavSnapshot.NavUpdaterUpdated(navUpdater, newUpdater);
        navSnapshot.setNavUpdater(newUpdater);
        
        assertEq(navSnapshot.navUpdater(), newUpdater, "navUpdater must be updated");
    }
    
    function testSetNavUpdaterOnlyCurrentUpdater() public {
        vm.prank(unauthorized);
        vm.expectRevert(NavSnapshot.NotNavUpdater.selector);
        navSnapshot.setNavUpdater(makeAddr("newUpdater"));
    }
    
    function testSetNavUpdaterRevertsZeroAddress() public {
        vm.prank(navUpdater);
        vm.expectRevert("invalid nav updater");
        navSnapshot.setNavUpdater(address(0));
    }
    
    // ============ Epoch History Tests ============
    
    function testGetEpochCountEmpty() public view {
        assertEq(navSnapshot.getEpochCount(), 0, "epoch count must be 0 initially");
    }
    
    function testGetEpochAtIndexRevertsOutOfBounds() public {
        vm.expectRevert("index out of bounds");
        navSnapshot.getEpochAtIndex(0);
    }
    
    function testEpochHistoryTracking() public {
        vm.startPrank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        navSnapshot.recordNavSnapshot(2, 2000e6, 2000e18);
        navSnapshot.recordNavSnapshot(3, 3000e6, 3000e18);
        vm.stopPrank();
        
        assertEq(navSnapshot.getEpochCount(), 3, "epoch count must be 3");
        assertEq(navSnapshot.getEpochAtIndex(0), 1, "first epoch must be 1");
        assertEq(navSnapshot.getEpochAtIndex(1), 2, "second epoch must be 2");
        assertEq(navSnapshot.getEpochAtIndex(2), 3, "third epoch must be 3");
    }
    
    // ============ Integration: Fresh vs Stale Settlement Readiness ============
    
    function testFreshNavAllowsSettlement() public {
        // Setup: Record NAV
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // Advance time: 5h 59m (fresh)
        vm.warp(block.timestamp + STALENESS_THRESHOLD - 60);
        
        // Settlement should succeed
        NavSnapshot.NavSnapshotData memory snapshot = navSnapshot.settlementPrecheck();
        assertEq(snapshot.epochId, 1, "settlement must proceed with fresh NAV");
        
        // Also verify enforceFreshNav doesn't revert
        navSnapshot.enforceFreshNav();
    }
    
    function testStaleNavBlocksSettlement() public {
        // Setup: Record NAV
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        // IMPORTANT: Capture timestamp AFTER recording but BEFORE warping
        uint256 snapshotTime = navSnapshot.getLatestNav().timestamp;
        
        // Advance time: 6h 1m (stale)
        vm.warp(block.timestamp + STALENESS_THRESHOLD + 60);
        
        // DETERMINISTIC PATTERN: Capture current timestamp immediately before expectRevert
        uint256 currentTime = block.timestamp;
        
        // Settlement should revert with explicit error
        vm.expectRevert(
            abi.encodeWithSelector(NavSnapshot.NavStale.selector, snapshotTime, currentTime)
        );
        navSnapshot.settlementPrecheck();
    }
    
    function testStaleNavExplicitRevertReason() public {
        // Setup: Record NAV
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        uint256 snapshotTime = navSnapshot.getLatestNav().timestamp;
        
        // Advance time: 12 hours (clearly stale)
        vm.warp(block.timestamp + 12 hours);
        
        // Capture the revert data to verify explicit error message
        (bool success, bytes memory returnData) = address(navSnapshot).staticcall(
            abi.encodeWithSelector(NavSnapshot.settlementPrecheck.selector)
        );
        
        assertFalse(success, "call must revert");
        
        // Decode the error
        bytes4 selector = bytes4(returnData);
        assertEq(selector, NavSnapshot.NavStale.selector, "error selector must be NavStale");
        
        // Decode parameters
        (uint256 lastUpdate, uint256 currentTime) = abi.decode(
            slice(returnData, 4, returnData.length - 4),
            (uint256, uint256)
        );
        
        assertEq(lastUpdate, snapshotTime, "error must include correct lastUpdate");
        assertEq(currentTime, block.timestamp, "error must include correct currentTime");
    }
    
    // ============ Helper Functions ============
    
    function slice(bytes memory data, uint256 start, uint256 length) internal pure returns (bytes memory) {
        bytes memory result = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = data[start + i];
        }
        return result;
    }
}
