// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SnapshotTrancheVault} from "../src/SnapshotTrancheVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SnapshotTrancheVaultFreezeTest
/// @notice Tests for snapshot freeze and entitlement lock functionality
/// @dev Tests only use functions available in SnapshotTrancheVault contract
contract SnapshotTrancheVaultFreezeTest is Test {
    SnapshotTrancheVault public vault;
    MockERC20 public asset;
    
    address public admin;
    address public settler;
    address public snapshotManager;
    
    uint256 public constant EPOCH_DURATION = 7 days;
    uint256 public constant INITIAL_BALANCE = 10_000_000e6; // 10M USDC
    
    function setUp() public {
        admin = makeAddr("admin");
        settler = makeAddr("settler");
        snapshotManager = makeAddr("snapshotManager");
        
        // Deploy mock asset
        asset = new MockERC20("USD Coin", "USDC");
        
        // Deploy vault - constructor takes 5 parameters
        vault = new SnapshotTrancheVault(
            address(asset),
            admin,
            settler,
            snapshotManager,
            EPOCH_DURATION
        );
    }
    
    // Helper to advance time
    function warp(uint256 timeDelta) internal {
        vm.warp(block.timestamp + timeDelta);
    }
    
    // ============================================================================
    // SNAPSHOT FREEZE TESTS
    // ============================================================================
    
    /// @notice Test that freezeSnapshot can be called successfully
    function test_FreezeSnapshot_Success() public {
        // Move to next epoch
        warp(EPOCH_DURATION);
        
        uint256 epochId = 0;
        
        // Prepare position data for freeze
        bytes32[] memory positionIds = new bytes32[](2);
        uint256[] memory costBases = new uint256[](2);
        uint256[] memory currentValues = new uint256[](2);
        
        positionIds[0] = keccak256(abi.encodePacked("position1"));
        positionIds[1] = keccak256(abi.encodePacked("position2"));
        costBases[0] = 100_000e6;
        costBases[1] = 200_000e6;
        currentValues[0] = 150_000e6;
        currentValues[1] = 250_000e6;
        
        // Freeze snapshot
        vm.prank(snapshotManager);
        vault.freezeSnapshot(epochId, positionIds, costBases, currentValues);
        

        
        // Verify snapshot exists
        (bytes32 snapshotHash, uint256 timestamp,, bool exists) = vault.snapshots(epochId);
        
        assertTrue(exists, "Snapshot should exist");
        assertTrue(snapshotHash != bytes32(0), "Snapshot hash should not be zero");
        assertTrue(timestamp > 0, "Timestamp should be set");
    }
    
    /// @notice Test that freezeSnapshot requires SNAPSHOT_ROLE
    function test_FreezeSnapshot_RequiresSnapshotRole() public {
        warp(EPOCH_DURATION);
        
        bytes32[] memory positionIds = new bytes32[](1);
        uint256[] memory costBases = new uint256[](1);
        uint256[] memory currentValues = new uint256[](1);
        
        positionIds[0] = keccak256(abi.encodePacked("position1"));
        costBases[0] = 100_000e6;
        currentValues[0] = 150_000e6;
        
        // Try to freeze without SNAPSHOT_ROLE
        address user = makeAddr("user");
        vm.prank(user);
        vm.expectRevert();
        vault.freezeSnapshot(0, positionIds, costBases, currentValues);
    }
    
    /// @notice Test that freezeSnapshot prevents double-freezing
    function test_FreezeSnapshot_PreventsDoubleFreeze() public {
        warp(EPOCH_DURATION);
        
        bytes32[] memory positionIds = new bytes32[](1);
        uint256[] memory costBases = new uint256[](1);
        uint256[] memory currentValues = new uint256[](1);
        
        positionIds[0] = keccak256(abi.encodePacked("position1"));
        costBases[0] = 100_000e6;
        currentValues[0] = 150_000e6;
        
        // Freeze once
        vm.prank(snapshotManager);
        vault.freezeSnapshot(0, positionIds, costBases, currentValues);
        
        // Try to freeze again
        vm.prank(snapshotManager);
        vm.expectRevert();
        vault.freezeSnapshot(0, positionIds, costBases, currentValues);
    }
    
    // ============================================================================
    // FORCE CLOSE TESTS
    // ============================================================================
    
    /// @notice Test that forceClosePosition works after deadline
    function test_ForceClosePosition_Success() public {
        // First freeze a snapshot
        warp(EPOCH_DURATION);
        
        bytes32[] memory positionIds = new bytes32[](1);
        uint256[] memory costBases = new uint256[](1);
        uint256[] memory currentValues = new uint256[](1);
        
        bytes32 posId = keccak256(abi.encodePacked("position1"));
        positionIds[0] = posId;
        costBases[0] = 100_000e6;
        currentValues[0] = 150_000e6;
        
        vm.prank(snapshotManager);
        vault.freezeSnapshot(0, positionIds, costBases, currentValues);
        
        // Wait past the realization timeout (30 days)
        warp(31 days);
        
        // Force close
        vm.prank(admin);
        bytes32 eventId = vault.forceClosePosition(posId, 0, "Test force close");
        
        assertTrue(eventId != bytes32(0), "Event ID should not be zero");
    }
    
    /// @notice Test that canForceClose returns correct values
    function test_CanForceClose() public {
        // Initially should return false (no snapshot)
        bytes32 posId = keccak256(abi.encodePacked("position1"));
        assertFalse(vault.canForceClose(posId, 0), "Should not be able to force close before snapshot");
        
        // Create snapshot
        warp(EPOCH_DURATION);
        
        bytes32[] memory positionIds = new bytes32[](1);
        uint256[] memory costBases = new uint256[](1);
        uint256[] memory currentValues = new uint256[](1);
        
        positionIds[0] = posId;
        costBases[0] = 100_000e6;
        currentValues[0] = 150_000e6;
        
        vm.prank(snapshotManager);
        vault.freezeSnapshot(0, positionIds, costBases, currentValues);
        
        // Still should be false (within deadline)
        assertFalse(vault.canForceClose(posId, 0), "Should not be able to force close within deadline");
        
        // Wait past deadline
        warp(31 days);
        
        // Now should be true
        assertTrue(vault.canForceClose(posId, 0), "Should be able to force close after deadline");
    }
}

/// @title MockERC20
/// @notice Simple ERC20 mock for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1e30); // Mint lots to deployer
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
