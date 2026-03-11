// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EpochTrancheVault} from "../src/EpochTrancheVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint8 decimals) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals);
    }
}

contract EpochTrancheVaultTest is Test {
    EpochTrancheVault public vault;
    MockToken public asset;

    address public admin = makeAddr("admin");
    address public settler = makeAddr("settler");
    address public navUpdater = makeAddr("navUpdater");
    address public snapshotter = makeAddr("snapshotter");
    address public depositProcessor = makeAddr("depositProcessor");
    address public user1 = makeAddr("user1");

    uint256 constant EPOCH_DURATION = 1 hours;
    uint256 constant NAV_STALENESS_THRESHOLD = 10 minutes;
    uint256 constant MIN_CLAIM_THRESHOLD = 1000;

    function setUp() public {
        vm.startPrank(admin);
        asset = new MockToken("USD Coin", "USDC", 6);
        vault = new EpochTrancheVault(
            address(asset), admin, settler, navUpdater, snapshotter, depositProcessor,
            EPOCH_DURATION, NAV_STALENESS_THRESHOLD, MIN_CLAIM_THRESHOLD, 1000
        );
        asset.transfer(user1, 1_000_000 * 1e6);
        vm.stopPrank();
    }

    // ============================================================================
    // INVARIANT TESTS FOR REMEDIATION MUST-HAVES
    // ============================================================================

    /// @notice INVARIANT: Freeze economics - frozen shares and assets are immutable snapshots
    function testFreezeEconomicsInvariants() public {
        address user2 = makeAddr("user2");
        
        vm.startPrank(admin);
        asset.transfer(user2, 500_000 * 1e6);
        vm.stopPrank();

        _depositAndGetShares(user1, 100_000 * 1e6);
        uint256 shares1 = vault.balanceOf(user1);
        _requestRedeem(user1, shares1);

        vm.startPrank(user2);
        asset.approve(address(vault), 200_000 * 1e6);
        vault.queueDeposit(200_000 * 1e6);
        vm.stopPrank();
        _advanceToNextEpoch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.freezeEpoch(keccak256(abi.encodePacked(block.timestamp)));
        uint256 depositEpochId = vault.currentEpochId();
        vm.prank(depositProcessor);
        vault.processDepositQueue(depositEpochId, 0, 100);
        
        uint256 shares2 = vault.balanceOf(user2);
        vm.startPrank(user2);
        IERC20(address(vault)).approve(address(vault), shares2);
        vault.requestRedeem(shares2, user2, user2);
        vm.stopPrank();

        uint256 epochId = vault.currentEpochId();
        _advanceToNextEpoch();

        uint256 totalAssetsBeforeFreeze = asset.balanceOf(address(vault));
        (, , , , , , , uint256 totalSharesPendingBefore, , , , , , , , , ) = vault.epochs(epochId);
        
        _freezeEpoch();

        (, , , , , , , uint256 frozenShares, uint256 frozenAssets, , , , , , , , ) = vault.epochs(epochId);
        assertEq(frozenShares, totalSharesPendingBefore, "INVARIANT: frozenShares must equal totalSharesPending at freeze");
        assertEq(frozenAssets, totalAssetsBeforeFreeze, "INVARIANT: frozenAssets must equal totalAssets() at freeze");

        vm.prank(admin);
        asset.transfer(address(vault), 100_000 * 1e6);
        
        (, , , , , , , uint256 frozenSharesAfter, uint256 frozenAssetsAfter, , , , , , , , ) = vault.epochs(epochId);
        assertEq(frozenSharesAfter, frozenShares, "INVARIANT: frozenShares must be immutable after freeze");
        assertEq(frozenAssetsAfter, frozenAssets, "INVARIANT: frozenAssets must be immutable after freeze");

        (, , , , , , , , , uint256 proRataRatio, , , , , , , ) = vault.epochs(epochId);
        assertEq(proRataRatio, 1e18, "INVARIANT: proRataRatio must be PRORATA_PRECISION initially");

        (, , , , , , , , , , , , , , , EpochTrancheVault.EpochStatus epochStatus, bool exists) = vault.epochs(epochId);
        assertEq(uint256(epochStatus), uint256(EpochTrancheVault.EpochStatus.Frozen), "INVARIANT: Epoch status must be Frozen after freeze");
    }

    /// @notice INVARIANT: Carry conservation - total carry is conserved across cohort
    function testCarryConservationInvariant() public {
        address user2 = makeAddr("user2");
        
        vm.startPrank(admin);
        asset.transfer(user2, 500_000 * 1e6);
        vm.stopPrank();

        _depositAndGetShares(user1, 100_000 * 1e6);
        uint256 shares1 = vault.balanceOf(user1);
        _requestRedeem(user1, shares1);
        uint256 requestId1 = 1;

        vm.startPrank(user2);
        asset.approve(address(vault), 150_000 * 1e6);
        vault.queueDeposit(150_000 * 1e6);
        vm.stopPrank();
        _advanceToNextEpoch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.freezeEpoch(keccak256(abi.encodePacked(block.timestamp)));
        uint256 depositEpochId = vault.currentEpochId();
        vm.prank(depositProcessor);
        vault.processDepositQueue(depositEpochId, 0, 100);
        
        uint256 shares2 = vault.balanceOf(user2);
        vm.startPrank(user2);
        IERC20(address(vault)).approve(address(vault), shares2);
        vault.requestRedeem(shares2, user2, user2);
        vm.stopPrank();

        uint256 epochId = vault.currentEpochId();
        _advanceToNextEpoch();
        _freezeEpoch();

        uint256 carryAmount = 0.1e18;
        _settleEpoch(epochId, carryAmount);

        (, , , , , , , , , , uint256 cohortTotalEntitlement, uint256 cohortTotalAccrued, uint256 cohortTotalClaimed, uint256 cohortCarryRemaining, , , ) = vault.epochs(epochId);
        
        assertEq(cohortCarryRemaining, cohortTotalAccrued, "INVARIANT: cohortCarryRemaining must equal cohortTotalAccrued initially");
        
        uint256 leftSide = cohortTotalClaimed + cohortCarryRemaining;
        assertApproxEqAbs(leftSide, cohortTotalEntitlement, 10, "INVARIANT: cohortTotalClaimed + cohortCarryRemaining must equal cohortTotalEntitlement");

        vm.prank(user1);
        vault.redeem(requestId1, shares1 / 2, user1);
        
        (, , , , , , , , , , , uint256 cohortTotalAccruedAfter, uint256 cohortTotalClaimedAfter, uint256 cohortCarryRemainingAfter, , , ) = vault.epochs(epochId);
        uint256 leftSideAfter = cohortTotalClaimedAfter + cohortCarryRemainingAfter;
        assertApproxEqAbs(leftSideAfter, cohortTotalEntitlement, 10, "INVARIANT: Conservation equation must hold after partial claim");

        vm.prank(user1);
        vault.redeem(requestId1, shares1 / 2, user1);
        
        (, , , , , , , , , , , , uint256 cohortTotalClaimedAfterFull, uint256 cohortCarryRemainingAfterFull, , , ) = vault.epochs(epochId);
        uint256 leftSideAfterFull = cohortTotalClaimedAfterFull + cohortCarryRemainingAfterFull;
        assertApproxEqAbs(leftSideAfterFull, cohortTotalEntitlement, 10, "INVARIANT: Conservation equation must hold after full claim");
        
        (, , , , , , , , , , , EpochTrancheVault.RequestStatus requestStatus, , , ) = vault.redemptionRequests(requestId1);
        assertEq(uint256(requestStatus), uint256(EpochTrancheVault.RequestStatus.Claimed), "INVARIANT: Request status must be Claimed after full claim");
    }

    /// @notice INVARIANT: Threshold and dust handling - dust only claimable when finalized
    function testThresholdDustInvariant() public {
        _depositAndGetShares(user1, 10_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        _requestRedeem(user1, shares);
        
        uint256 epochId = vault.currentEpochId();
        _advanceToNextEpoch();
        _freezeEpoch();

        uint256 carryAmount = 0.99e18;
        _settleEpoch(epochId, carryAmount);

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.BelowClaimThreshold.selector, 100, MIN_CLAIM_THRESHOLD));
        vault.redeem(1, 1, user1);

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.EpochNotFinalized.selector, epochId));
        vault.claimDust(1);

        vm.prank(settler);
        vault.finalizeEpoch(epochId);

        (, , , , uint256 assetsClaimable, , , , , , , , , , ) = vault.redemptionRequests(1);
        
        if (assetsClaimable < MIN_CLAIM_THRESHOLD) {
            vm.prank(user1);
            uint256 dustClaimed = vault.claimDust(1);
            assertGt(dustClaimed, 0, "INVARIANT: Dust claim should return assets after finalization");
            assertLt(dustClaimed, MIN_CLAIM_THRESHOLD, "INVARIANT: Dust claimed should be below threshold");
            
            (, , , , , , , , , , , EpochTrancheVault.RequestStatus status, , , ) = vault.redemptionRequests(1);
            assertEq(uint256(status), uint256(EpochTrancheVault.RequestStatus.Claimed), "INVARIANT: Request status must be Claimed after dust claim");
        } else {
            vm.prank(user1);
            vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.NotDust.selector, assetsClaimable, MIN_CLAIM_THRESHOLD));
            vault.claimDust(1);
        }
    }

    /// @notice INVARIANT: Chunked settlement - all requests processed correctly across chunks
    function testChunkedSettlementInvariant() public {
        uint256 numUsers = 10;
        address[] memory users = new address[](numUsers);
        
        for (uint256 i = 0; i < numUsers; i++) {
            users[i] = makeAddr(string.concat("user", vm.toString(i)));
            vm.startPrank(admin);
            asset.transfer(users[i], 10_000 * 1e6);
            vm.stopPrank();
        }

        for (uint256 i = 0; i < numUsers; i++) {
            vm.startPrank(users[i]);
            asset.approve(address(vault), 10_000 * 1e6);
            vault.queueDeposit(10_000 * 1e6);
            vm.stopPrank();
        }
        
        _advanceToNextEpoch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.freezeEpoch(keccak256(abi.encodePacked(block.timestamp)));
        uint256 depositEpochId = vault.currentEpochId();
        vm.prank(depositProcessor);
        vault.processDepositQueue(depositEpochId, 0, 200);
        
        for (uint256 i = 0; i < numUsers; i++) {
            uint256 shares = vault.balanceOf(users[i]);
            vm.startPrank(users[i]);
            IERC20(address(vault)).approve(address(vault), shares);
            vault.requestRedeem(shares, users[i], users[i]);
            vm.stopPrank();
        }

        uint256 epochId = vault.currentEpochId();
        _advanceToNextEpoch();
        _freezeEpoch();

        _settleEpoch(epochId, 0);
        
        (uint256 processed, uint256 total, , bool isComplete) = vault.getSettlementProgress(epochId);
        assertEq(processed, numUsers, "INVARIANT: All requests should be processed");
        assertEq(total, numUsers, "INVARIANT: Total should match");
        assertTrue(isComplete, "INVARIANT: Settlement should be complete");

        (, , , , , , , , , , , , , , , EpochTrancheVault.EpochStatus epochStatus, bool exists2) = vault.epochs(epochId);
        assertEq(uint256(epochStatus), uint256(EpochTrancheVault.EpochStatus.Settled), "INVARIANT: Epoch status should be Settled");
    }

    // Helper functions
    function _depositAndGetShares(address user, uint256 amount) internal {
        vm.startPrank(user);
        asset.approve(address(vault), amount);
        vault.queueDeposit(amount);
        vm.stopPrank();
        _advanceToNextEpoch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.freezeEpoch(keccak256(abi.encodePacked(block.timestamp)));
        uint256 depositEpochId = vault.currentEpochId();
        vm.prank(depositProcessor);
        vault.processDepositQueue(depositEpochId, 0, 100);
    }

    function _requestRedeem(address user, uint256 shares) internal {
        vm.startPrank(user);
        IERC20(address(vault)).approve(address(vault), shares);
        vault.requestRedeem(shares, user, user);
        vm.stopPrank();
    }

    function _advanceToNextEpoch() internal {
        vm.warp(vault.getEpochEnd(vault.currentEpochId()) + 1);
    }

    function _freezeEpoch() internal {
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.freezeEpoch(keccak256(abi.encodePacked(block.timestamp)));
    }

    function _settleEpoch(uint256 epochId, uint256 carryAmount) internal {
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(settler);
        vault.settleEpoch(epochId, carryAmount);
    }
}
