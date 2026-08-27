// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EpochTrancheVault} from "../src/EpochTrancheVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    uint8 private immutable tokenDecimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        tokenDecimals = decimals_;
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals_);
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
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
    address public tradingSafe = makeAddr("tradingSafe");
    address public user1 = makeAddr("user1");

    uint256 constant EPOCH_DURATION = 1 hours;
    uint256 constant NAV_STALENESS_THRESHOLD = 10 minutes;
    uint256 constant MIN_CLAIM_THRESHOLD = 1000;

    function setUp() public {
        vm.startPrank(admin);
        asset = new MockToken("USD Coin", "USDC", 6);
        vault = new EpochTrancheVault(
            address(asset), admin, settler, navUpdater, snapshotter, depositProcessor, tradingSafe,
            EPOCH_DURATION, NAV_STALENESS_THRESHOLD, MIN_CLAIM_THRESHOLD, 1000
        );
        asset.transfer(user1, 1_000_000 * 1e6);
        asset.transfer(user1, 1_000_000 * 1e6);
        vm.stopPrank();
    }

    function testShareTokenUsesAssetDecimals() public view {
        assertEq(asset.decimals(), 6, "mock asset should expose 6 decimals");
        assertEq(vault.decimals(), 6, "vault shares should match asset decimals");
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

        (, , , , , , uint256 totalSharesPendingBefore, , , , , , , , , , ) = vault.epochs(epochId);
        uint256 currentNavBeforeFreeze = vault.currentNAV();
        
        _freezeEpoch();

        (, , , , , , , uint256 frozenShares, uint256 frozenAssets, , , , , , , , ) = vault.epochs(epochId);
        assertEq(frozenShares, totalSharesPendingBefore, "INVARIANT: frozenShares must equal totalSharesPending at freeze");
        uint256 expectedFrozenAssets = (totalSharesPendingBefore * currentNavBeforeFreeze) / 1e18;
        assertEq(
            frozenAssets,
            expectedFrozenAssets,
            "INVARIANT: frozenAssets must be priced from boundary NAV"
        );

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

    function testFreezeExcludesQueuedAssetsFromRedemptionSnapshot() public {
        address user2 = makeAddr("user2");

        vm.prank(admin);
        asset.transfer(user2, 10_000 * 1e6);

        _depositAndGetShares(user1, 1_000_000);
        uint256 user1Shares = vault.balanceOf(user1);
        _requestRedeem(user1, user1Shares);

        vm.startPrank(user2);
        asset.approve(address(vault), 2_000_000);
        vault.queueDeposit(2_000_000);
        vm.stopPrank();

        uint256 redeemEpochId = vault.currentEpochId();

        _advanceToNextEpoch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.freezeEpoch(keccak256(abi.encodePacked(block.timestamp)));

        (, , , , uint256 snapshotNav, , , uint256 frozenShares, uint256 frozenAssets, , , , , , , , ) =
            vault.epochs(redeemEpochId);
        assertEq(snapshotNav, 1e18, "snapshot NAV should ignore queued deposits");
        assertEq(frozenShares, user1Shares, "pending redemption shares should be frozen");
        assertEq(frozenAssets, 1_000_000, "queued deposits must not inflate redeemable assets");

        uint256 depositEpochId = vault.currentEpochId();
        vm.prank(depositProcessor);
        vault.processDepositQueue(depositEpochId, 0, 100);

        assertEq(vault.balanceOf(user2), 2_000_000, "queued deposit should mint two shares at NAV 1");
    }

    function testWithdrawalUsesEpochBoundaryNavWhenQueuedDepositsExist() public {
        address user2 = makeAddr("user2");

        vm.prank(admin);
        asset.transfer(user2, 10_000_000);

        _depositAndGetShares(user1, 3_000_000);
        _requestRedeem(user1, 2_000_000);

        vm.startPrank(user2);
        asset.approve(address(vault), 1_000_000);
        vault.queueDeposit(1_000_000);
        vm.stopPrank();

        uint256 redeemEpochId = vault.currentEpochId();

        _advanceToNextEpoch();
        vm.prank(navUpdater);
        vault.updateNAV(1_333_333_333_333_333_333);
        vm.prank(snapshotter);
        vault.freezeEpoch(keccak256(abi.encodePacked(block.timestamp)));

        (, , , , , , , uint256 frozenShares, uint256 frozenAssets, , , , , , , , ) = vault.epochs(redeemEpochId);
        assertEq(frozenShares, 2_000_000, "redeeming cohort should freeze the requested shares");
        assertEq(frozenAssets, 2_666_666, "redeeming cohort should receive its epoch-end NAV entitlement");

        uint256 depositEpochId = vault.currentEpochId();
        vm.prank(depositProcessor);
        vault.processDepositQueue(depositEpochId, 0, 100);
        assertEq(vault.balanceOf(user2), 750_000, "queued deposit should mint from epoch open NAV");

        _settleEpoch(redeemEpochId, 0);
        vm.prank(settler);
        vault.finalizeEpoch(redeemEpochId);

        (, , , , uint256 assetsClaimable, , uint256 entitlement, , , , , EpochTrancheVault.RequestStatus status, , , ) =
            vault.redemptionRequests(1);
        assertEq(uint256(status), uint256(EpochTrancheVault.RequestStatus.Claimable));
        assertEq(entitlement, 2_666_666, "settlement should preserve the NAV-priced entitlement");
        assertEq(assetsClaimable, 2_666_666, "claimable assets should equal the epoch-end NAV entitlement");
    }

    function testRequestRedeemBurnsSharesAndDisablesCancellation() public {
        _depositAndGetShares(user1, 1_000_000);

        uint256 shares = vault.balanceOf(user1);
        uint256 supplyBefore = vault.totalSupply();

        _requestRedeem(user1, shares);

        assertEq(vault.balanceOf(user1), 0, "user shares should move out of circulation on request");
        assertEq(vault.totalSupply(), supplyBefore - shares, "redeem request should burn requested shares");
        assertEq(vault.totalPendingRedeemShares(), shares, "pending redeem tracker should retain requested shares");

        vm.prank(user1);
        vm.expectRevert(EpochTrancheVault.RedemptionCancellationDisabled.selector);
        vault.cancelRedeemRequest(1);

        assertEq(vault.balanceOf(user1), 0, "cancel attempt must not restore user shares");
        assertEq(vault.totalSupply(), supplyBefore - shares, "cancel attempt must not change supply");
        assertEq(vault.totalPendingRedeemShares(), shares, "cancel attempt must not clear pending tracker");
    }

    function testReservedRedemptionAssetsBlockDeploymentUntilClaimed() public {
        _depositAndGetShares(user1, 1_000_000);
        uint256 shares = vault.balanceOf(user1);
        _requestRedeem(user1, shares);

        uint256 epochId = vault.currentEpochId();
        _advanceToNextEpoch();
        _freezeEpoch();

        assertEq(vault.reservedRedemptionAssets(), 1_000_000, "freeze should reserve the cohort assets");

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.InsufficientShares.selector, 1, 0));
        vault.deployCapital(1);

        _settleEpoch(epochId, 0);
        vm.prank(settler);
        vault.finalizeEpoch(epochId);

        vm.prank(user1);
        vault.redeem(1, shares, user1);

        assertEq(vault.reservedRedemptionAssets(), 0, "claim should release the reserved redemption assets");
    }

    function testWithdrawReleasesReservedRedemptionAssets() public {
        _depositAndGetShares(user1, 1_000_000);
        uint256 shares = vault.balanceOf(user1);
        _requestRedeem(user1, shares);

        uint256 epochId = vault.currentEpochId();
        _advanceToNextEpoch();
        _freezeEpoch();
        _settleEpoch(epochId, 0);
        vm.prank(settler);
        vault.finalizeEpoch(epochId);

        assertEq(vault.reservedRedemptionAssets(), 1_000_000, "settlement should reserve claimable assets");

        vm.prank(user1);
        uint256 sharesBurned = vault.withdraw(1, 500_000, user1);

        assertEq(sharesBurned, 500_000, "withdraw should burn the corresponding frozen shares");
        assertEq(vault.reservedRedemptionAssets(), 500_000, "withdraw should release reserved assets by the claimed amount");
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
        uint256 requestId2 = 2;

        uint256 epochId = vault.currentEpochId();
        _advanceToNextEpoch();
        _freezeEpoch();

        uint256 carryAmount = 0.1e18;
        _settleEpoch(epochId, carryAmount);

        (, , , , , , , , , , , uint256 cohortTotalEntitlement, uint256 cohortTotalAccrued, uint256 cohortTotalClaimed, uint256 cohortCarryRemaining, , ) = vault.epochs(epochId);
        
        assertEq(cohortCarryRemaining, cohortTotalAccrued, "INVARIANT: cohortCarryRemaining must equal cohortTotalAccrued initially");
        
        (, , , , uint256 request2Claimable, , , , , , , EpochTrancheVault.RequestStatus request2Status, , , ) = vault.redemptionRequests(requestId2);
        uint256 totalNetEntitlement = cohortTotalEntitlement - cohortTotalAccrued;
        assertEq(uint256(request2Status), uint256(EpochTrancheVault.RequestStatus.Claimable));
        assertApproxEqAbs(
            request2Claimable + cohortTotalClaimed,
            totalNetEntitlement,
            10,
            "INVARIANT: total user-claimable assets plus claimed assets must equal net entitlement"
        );

        vm.prank(user2);
        vault.redeem(requestId2, shares2 / 2, user2);
        
        (, , , , uint256 request2ClaimableAfter, , , , , , , EpochTrancheVault.RequestStatus request2StatusAfter, , , ) = vault.redemptionRequests(requestId2);
        (, , , , , , , , , , , , uint256 cohortTotalAccruedAfter, uint256 cohortTotalClaimedAfter, uint256 cohortCarryRemainingAfter, , ) = vault.epochs(epochId);
        assertEq(uint256(request2StatusAfter), uint256(EpochTrancheVault.RequestStatus.Claimable));
        assertLe(
            cohortCarryRemainingAfter,
            cohortTotalAccruedAfter,
            "INVARIANT: carry remaining cannot exceed total accrued carry after partial claim"
        );
        assertApproxEqAbs(
            request2ClaimableAfter + cohortTotalClaimedAfter,
            totalNetEntitlement,
            10,
            "INVARIANT: Conservation equation must hold after partial claim"
        );

        vm.prank(user2);
        vault.redeem(requestId2, shares2 / 2, user2);
        
        (, , , , uint256 request2ClaimableAfterFull, , , , , , , EpochTrancheVault.RequestStatus requestStatus, , , ) = vault.redemptionRequests(requestId2);
        (, , , , , , , , , , , , , uint256 cohortTotalClaimedAfterFull, uint256 cohortCarryRemainingAfterFull, , ) = vault.epochs(epochId);
        assertEq(request2ClaimableAfterFull, 0, "INVARIANT: fully claimed request should have no remaining claimable assets");
        assertApproxEqAbs(
            request2ClaimableAfterFull + cohortTotalClaimedAfterFull,
            totalNetEntitlement,
            10,
            "INVARIANT: Conservation equation must hold after full claim"
        );
        assertLe(
            cohortCarryRemainingAfterFull,
            cohortTotalAccrued,
            "INVARIANT: carry remaining cannot exceed accrued carry"
        );
        
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
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.BelowClaimThreshold.selector, 1, MIN_CLAIM_THRESHOLD));
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

    // ============================================================================
    // CAPITAL DEPLOYMENT TESTS
    // ============================================================================

    /// @notice Test that constructor validates tradingSafe is not zero address
    function testConstructorRejectsZeroTradingSafe() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.InvalidAddress.selector));
        new EpochTrancheVault(
            address(asset), admin, settler, navUpdater, snapshotter, depositProcessor, address(0),
            EPOCH_DURATION, NAV_STALENESS_THRESHOLD, MIN_CLAIM_THRESHOLD, 1000
        );
        vm.stopPrank();
    }

    /// @notice Test that tradingSafe is set correctly in constructor
    function testTradingSafeIsSet() public view {
        assertEq(vault.tradingSafe(), tradingSafe, "tradingSafe should be set correctly");
    }

    /// @notice Test deployCapital transfers USDC from vault to tradingSafe
    function testDeployCapital() public {
        // First deposit some assets to the vault
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        uint256 vaultBalanceBefore = asset.balanceOf(address(vault));
        uint256 tradingSafeBalanceBefore = asset.balanceOf(tradingSafe);
        uint256 deployAmount = 50_000 * 1e6;
        
        vm.prank(admin);
        vault.deployCapital(deployAmount);
        
        uint256 vaultBalanceAfter = asset.balanceOf(address(vault));
        uint256 tradingSafeBalanceAfter = asset.balanceOf(tradingSafe);
        
        assertEq(vaultBalanceAfter, vaultBalanceBefore - deployAmount, "Vault balance should decrease");
        assertEq(tradingSafeBalanceAfter, tradingSafeBalanceBefore + deployAmount, "TradingSafe balance should increase");
        assertEq(vault.getDeployedCapital(), deployAmount, "deployedCapital should track the deployed amount");
    }

    /// @notice Test deployCapital emits CapitalDeployed event
    function testDeployCapitalEmitsEvent() public {
        _depositAndGetShares(user1, 100_000 * 1e6);
        uint256 deployAmount = 50_000 * 1e6;
        
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit EpochTrancheVault.CapitalDeployed(deployAmount, deployAmount);
        vault.deployCapital(deployAmount);
    }

    /// @notice Test deployCapital reverts with ZeroAmount for zero amount
    function testDeployCapitalRevertsZeroAmount() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.ZeroAmount.selector));
        vault.deployCapital(0);
    }

    /// @notice Test deployCapital reverts if amount exceeds available vault balance
    function testDeployCapitalRevertsInsufficientBalance() public {
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        // After _depositAndGetShares, vault has balance but assets are reserved for redemption
        // availableVaultBalance = vaultBalance - totalQueuedAssets - reservedRedemptionAssets
        // Since there are no pending redemptions in this flow, available balance equals vault balance
        uint256 vaultBalance = asset.balanceOf(address(vault));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.InsufficientShares.selector, vaultBalance + 1, vaultBalance));
        vault.deployCapital(vaultBalance + 1);
    }

    /// @notice Test deployCapital is only callable by admin
    function testDeployCapitalOnlyAdmin() public {
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        vm.prank(user1);
        vm.expectRevert();
        vault.deployCapital(50_000 * 1e6);
    }

    /// @notice Test recallCapital transfers USDC from tradingSafe back to vault
    function testRecallCapital() public {
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        uint256 deployAmount = 50_000 * 1e6;
        vm.prank(admin);
        vault.deployCapital(deployAmount);
        
        // Fund the tradingSafe so it can return the capital
        vm.prank(admin);
        asset.transfer(tradingSafe, deployAmount);
        
        uint256 vaultBalanceBefore = asset.balanceOf(address(vault));
        uint256 recallAmount = 30_000 * 1e6;
        
        // tradingSafe needs to approve the vault to pull funds
        vm.prank(tradingSafe);
        asset.approve(address(vault), recallAmount);
        
        vm.prank(admin);
        vault.recallCapital(recallAmount);
        
        uint256 vaultBalanceAfter = asset.balanceOf(address(vault));
        
        assertEq(vaultBalanceAfter, vaultBalanceBefore + recallAmount, "Vault balance should increase");
        assertEq(vault.getDeployedCapital(), deployAmount - recallAmount, "deployedCapital should decrease");
    }

    /// @notice Test recallCapital emits CapitalRecalled event
    function testRecallCapitalEmitsEvent() public {
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        uint256 deployAmount = 50_000 * 1e6;
        vm.prank(admin);
        vault.deployCapital(deployAmount);
        
        // Fund and approve
        vm.prank(admin);
        asset.transfer(tradingSafe, deployAmount);
        vm.prank(tradingSafe);
        asset.approve(address(vault), deployAmount);
        
        uint256 recallAmount = 30_000 * 1e6;
        
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit EpochTrancheVault.CapitalRecalled(recallAmount, deployAmount - recallAmount);
        vault.recallCapital(recallAmount);
    }

    /// @notice Test recallCapital reverts with ZeroAmount for zero amount
    function testRecallCapitalRevertsZeroAmount() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.ZeroAmount.selector));
        vault.recallCapital(0);
    }

    /// @notice Test recallCapital reverts if amount exceeds deployed capital
    function testRecallCapitalRevertsExceedsDeployed() public {
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        uint256 deployAmount = 50_000 * 1e6;
        vm.prank(admin);
        vault.deployCapital(deployAmount);
        
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(EpochTrancheVault.InsufficientShares.selector, 100_000 * 1e6, deployAmount));
        vault.recallCapital(100_000 * 1e6);
    }

    /// @notice Test recallCapital is only callable by admin
    function testRecallCapitalOnlyAdmin() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.recallCapital(10_000 * 1e6);
    }

    /// @notice Test totalAssets includes deployed capital
    function testTotalAssetsIncludesDeployedCapital() public {
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        uint256 deployAmount = 50_000 * 1e6;
        vm.prank(admin);
        vault.deployCapital(deployAmount);
        
        uint256 vaultBalance = asset.balanceOf(address(vault));
        uint256 totalAssets = vault.totalAssets();
        
        assertEq(totalAssets, vaultBalance + deployAmount, "totalAssets should include deployed capital");
    }

    /// @notice Test getDeployedCapital returns correct value
    function testGetDeployedCapital() public {
        assertEq(vault.getDeployedCapital(), 0, "Initial deployed capital should be 0");
        
        _depositAndGetShares(user1, 100_000 * 1e6);
        
        uint256 deployAmount = 50_000 * 1e6;
        vm.prank(admin);
        vault.deployCapital(deployAmount);
        
        assertEq(vault.getDeployedCapital(), deployAmount, "getDeployedCapital should return deployed amount");
    }
}
