// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {NavSnapshot} from "../src/NavSnapshot.sol";

contract DebugTest is Test {
    NavSnapshot internal navSnapshot;
    address internal navUpdater;
    uint256 internal constant STALENESS_THRESHOLD = 6 hours;
    
    function setUp() public {
        navUpdater = makeAddr("navUpdater");
        navSnapshot = new NavSnapshot(navUpdater);
        console.log("setUp: block.timestamp =", block.timestamp);
    }
    
    function testDebugTimestamp() public {
        console.log("Before record: block.timestamp =", block.timestamp);
        
        vm.prank(navUpdater);
        navSnapshot.recordNavSnapshot(1, 1000e6, 1000e18);
        
        console.log("After record: block.timestamp =", block.timestamp);
        
        NavSnapshot.NavSnapshotData memory snap = navSnapshot.getLatestNav();
        console.log("Snapshot timestamp:", snap.timestamp);
        
        uint256 snapshotTime = block.timestamp;
        console.log("Captured snapshotTime:", snapshotTime);
        
        vm.warp(block.timestamp + STALENESS_THRESHOLD + 60);
        console.log("After warp: block.timestamp =", block.timestamp);
        
        uint256 currentTime = block.timestamp;
        console.log("Captured currentTime:", currentTime);
        
        snap = navSnapshot.getLatestNav();
        console.log("Snapshot timestamp after warp:", snap.timestamp);
        
        console.log("Expected revert: NavStale(", snapshotTime, ",", currentTime, ")");
        
        vm.expectRevert(
            abi.encodeWithSelector(NavSnapshot.NavStale.selector, snapshotTime, currentTime)
        );
        navSnapshot.enforceFreshNav();
    }
}
