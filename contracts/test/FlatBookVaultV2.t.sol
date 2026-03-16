// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FlatBookVaultV2} from "../src/FlatBookVaultV2.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC7540Operator, IERC7540Deposit, IERC7540Redeem} from "../src/interfaces/IERC7540.sol";
import {IERC7575} from "../src/interfaces/IERC7575.sol";

contract MockTokenV2 is ERC20 {
    uint8 private immutable tokenDecimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        tokenDecimals = decimals_;
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals_);
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }
}

contract FlatBookVaultV2Test is Test {
    FlatBookVaultV2 internal vault;
    MockTokenV2 internal asset;

    address internal admin = makeAddr("admin");
    address internal bookRunner = makeAddr("bookRunner");
    address internal navUpdater = makeAddr("navUpdater");
    address internal tradingWallet = makeAddr("tradingWallet");
    address internal user1 = makeAddr("user1");
    address internal user2 = makeAddr("user2");
    address internal operator = makeAddr("operator");

    uint256 internal constant NAV_STALENESS_THRESHOLD = 10 minutes;

    function setUp() public {
        vm.startPrank(admin);
        asset = new MockTokenV2("USD Coin", "USDC", 6);
        vault = new FlatBookVaultV2(
            address(asset),
            admin,
            bookRunner,
            navUpdater,
            tradingWallet,
            NAV_STALENESS_THRESHOLD
        );

        asset.transfer(user1, 1_000_000 * 1e6);
        asset.transfer(user2, 1_000_000 * 1e6);
        vm.stopPrank();
    }

    function testSupportsErc7540Interfaces() public view {
        assertTrue(vault.supportsInterface(type(IERC7540Operator).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Deposit).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Redeem).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7575).interfaceId));
    }

    function testOpenInstantDepositAndRedeem() public {
        uint256 assets = 200_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), assets);
        uint256 minted = vault.deposit(assets, user1);
        assertEq(minted, assets);

        uint256 redeemShares = 50_000 * 1e6;
        uint256 redeemedAssets = vault.redeem(redeemShares, user1, user1);
        assertEq(redeemedAssets, redeemShares);
        vm.stopPrank();
    }

    function testOperatorCanRequestForOwner() public {
        uint256 assets = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), assets);
        vault.deposit(assets, user1);
        vault.approve(address(vault), assets);
        vault.setOperator(operator, true);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.prank(operator);
        vault.requestRedeem(10_000 * 1e6, user1, user1);

        assertEq(vault.pendingRedeemRequest(0, user1), 10_000 * 1e6);
    }

    function testClosedQueuesThenProcessingCreatesClaimables() public {
        uint256 user1Deposit = 400_000 * 1e6;
        uint256 user2DepositQueue = 120_000 * 1e6;
        uint256 user1RedeemQueue = 80_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), user1Deposit);
        vault.deposit(user1Deposit, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user2);
        asset.approve(address(vault), user2DepositQueue);
        vault.requestDeposit(user2DepositQueue, user2, user2);
        vm.stopPrank();

        vm.startPrank(user1);
        vault.approve(address(vault), user1RedeemQueue);
        vault.requestRedeem(user1RedeemQueue, user1, user1);
        vm.stopPrank();

        assertEq(vault.pendingDepositRequest(0, user2), user2DepositQueue);
        assertEq(vault.pendingRedeemRequest(0, user1), user1RedeemQueue);

        vm.prank(navUpdater);
        vault.updateNAV(2e18);

        vm.prank(bookRunner);
        vault.beginProcessing();
        vm.prank(bookRunner);
        vault.processRedeems(50);
        vm.prank(bookRunner);
        vault.processDeposits(50);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        assertEq(vault.pendingDepositRequest(0, user2), 0);
        assertEq(vault.pendingRedeemRequest(0, user1), 0);

        assertEq(vault.claimableDepositRequest(0, user2), user2DepositQueue);
        assertEq(vault.claimableRedeemRequest(0, user1), user1RedeemQueue);
    }

    function testClaimDepositAndClaimRedeemAfterProcessing() public {
        uint256 user1InitialDeposit = 300_000 * 1e6;
        uint256 user1QueuedRedeem = 60_000 * 1e6;
        uint256 user2QueuedDeposit = 90_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), user1InitialDeposit);
        vault.deposit(user1InitialDeposit, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user1);
        vault.approve(address(vault), user1QueuedRedeem);
        vault.requestRedeem(user1QueuedRedeem, user1, user1);
        vm.stopPrank();

        vm.startPrank(user2);
        asset.approve(address(vault), user2QueuedDeposit);
        vault.requestDeposit(user2QueuedDeposit, user2, user2);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(15e17);

        vm.prank(bookRunner);
        vault.beginProcessing();
        vm.prank(bookRunner);
        vault.processRedeems(20);
        vm.prank(bookRunner);
        vault.processDeposits(20);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        uint256 user1AssetsBefore = asset.balanceOf(user1);
        vm.prank(user1);
        uint256 claimedAssets = vault.redeem(user1QueuedRedeem, user1, user1);
        assertEq(claimedAssets, 90_000 * 1e6);
        assertEq(asset.balanceOf(user1) - user1AssetsBefore, 90_000 * 1e6);

        vm.prank(user2);
        uint256 claimedShares = vault.deposit(user2QueuedDeposit, user2, user2);
        assertEq(claimedShares, 60_000 * 1e6);
        assertEq(vault.balanceOf(user2), 60_000 * 1e6);
    }

    function testCannotCancelAfterProcessingStarts() public {
        uint256 user1InitialDeposit = 200_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), user1InitialDeposit);
        vault.deposit(user1InitialDeposit, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user2);
        asset.approve(address(vault), 50_000 * 1e6);
        vault.requestDeposit(50_000 * 1e6, user2, user2);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(bookRunner);
        vault.beginProcessing();

        vm.prank(user2);
        vm.expectRevert(
            abi.encodeWithSelector(
                FlatBookVaultV2.InvalidState.selector, FlatBookVaultV2.VaultState.Closed, FlatBookVaultV2.VaultState.Processing
            )
        );
        vault.cancelQueuedDeposit();
    }

    function testBeginProcessingChecksLiquidityAgainstExistingClaimables() public {
        uint256 initial = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), initial);
        vault.deposit(initial, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user1);
        vault.approve(address(vault), initial);
        vault.requestRedeem(initial, user1, user1);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(bookRunner);
        vault.beginProcessing();
        vm.prank(bookRunner);
        vault.processRedeems(10);
        vm.prank(bookRunner);
        vault.processDeposits(10);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        vm.startPrank(user2);
        asset.approve(address(vault), initial);
        vault.deposit(initial, user2);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user2);
        vault.approve(address(vault), initial);
        vault.requestRedeem(initial, user2, user2);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(2e18);

        vm.prank(bookRunner);
        vm.expectRevert(
            abi.encodeWithSelector(
                FlatBookVaultV2.InsufficientLiquidityForProcessing.selector,
                300_000 * 1e6,
                200_000 * 1e6
            )
        );
        vault.beginProcessing();
    }

    function testEmptyQueueReopenAdvancesCycle() public {
        uint256 startingCycleId = vault.currentCycleId();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.prank(bookRunner);
        vm.expectRevert(abi.encodeWithSelector(FlatBookVaultV2.NoActionableQueue.selector, startingCycleId));
        vault.beginProcessing();

        vm.prank(bookRunner);
        vault.reopenIdleCycle();

        assertEq(vault.currentCycleId(), startingCycleId + 1);
        assertEq(uint256(vault.state()), uint256(FlatBookVaultV2.VaultState.Open));
    }

    function testAllocationDoesNotDriveLifecycle() public {
        uint256 assets = 200_000 * 1e6;
        uint256 allocation = 40_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), assets);
        vault.deposit(assets, user1);
        vm.stopPrank();

        uint256 cycleBefore = vault.currentCycleId();
        uint256 vaultBalanceBefore = asset.balanceOf(address(vault));
        uint256 tradingWalletBefore = asset.balanceOf(tradingWallet);

        vm.prank(admin);
        vault.allocateToTradingWallet(allocation);

        assertEq(asset.balanceOf(address(vault)), vaultBalanceBefore - allocation);
        assertEq(asset.balanceOf(tradingWallet), tradingWalletBefore + allocation);
        assertEq(vault.currentCycleId(), cycleBefore);
        assertEq(uint256(vault.state()), uint256(FlatBookVaultV2.VaultState.Open));

        vm.prank(bookRunner);
        vault.closeBook();

        uint256 closedBalanceBefore = asset.balanceOf(address(vault));
        uint256 closedTradingWalletBefore = asset.balanceOf(tradingWallet);

        vm.prank(admin);
        vault.allocateToTradingWallet(allocation);

        assertEq(asset.balanceOf(address(vault)), closedBalanceBefore - allocation);
        assertEq(asset.balanceOf(tradingWallet), closedTradingWalletBefore + allocation);
        assertEq(vault.currentCycleId(), cycleBefore);
        assertEq(uint256(vault.state()), uint256(FlatBookVaultV2.VaultState.Closed));
    }

    function testReopenIdleCycleRevertsWhenQueueNotEmpty() public {
        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user1);
        asset.approve(address(vault), 10_000 * 1e6);
        vault.requestDeposit(10_000 * 1e6, user1, user1);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(FlatBookVaultV2.QueueNotEmpty.selector, vault.currentCycleId()));
        vm.prank(bookRunner);
        vault.reopenIdleCycle();
    }

    function testClosedPeriodCompletionAdvancesCycleWhenQueueEmptyAndPreservesProcessedQueueAssertions() public {
        uint256 user1InitialDeposit = 300_000 * 1e6;
        uint256 user1QueuedRedeem = 60_000 * 1e6;
        uint256 user2QueuedDeposit = 90_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), user1InitialDeposit);
        vault.deposit(user1InitialDeposit, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user1);
        vault.approve(address(vault), user1QueuedRedeem);
        vault.requestRedeem(user1QueuedRedeem, user1, user1);
        vm.stopPrank();

        vm.startPrank(user2);
        asset.approve(address(vault), user2QueuedDeposit);
        vault.requestDeposit(user2QueuedDeposit, user2, user2);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(15e17);
        vm.prank(bookRunner);
        vault.beginProcessing();
        vm.prank(bookRunner);
        vault.processRedeems(20);
        vm.prank(bookRunner);
        vault.processDeposits(20);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        assertEq(vault.pendingDepositRequest(0, user2), 0);
        assertEq(vault.pendingRedeemRequest(0, user1), 0);
        assertEq(vault.claimableDepositRequest(0, user2), user2QueuedDeposit);
        assertEq(vault.claimableRedeemRequest(0, user1), user1QueuedRedeem);
        assertEq(vault.currentCycleId(), 1);

        vm.prank(bookRunner);
        vault.closeBook();

        uint256 idleCycleId = vault.currentCycleId();

        vm.prank(bookRunner);
        vm.expectRevert(abi.encodeWithSelector(FlatBookVaultV2.NoActionableQueue.selector, idleCycleId));
        vault.beginProcessing();

        vm.prank(bookRunner);
        vault.reopenIdleCycle();

        assertEq(vault.currentCycleId(), 2);
        assertEq(vault.claimableDepositRequest(0, user2), user2QueuedDeposit);
        assertEq(vault.claimableRedeemRequest(0, user1), user1QueuedRedeem);
    }
}
