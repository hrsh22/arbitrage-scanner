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

contract MockCollateralRampV2 {
    MockTokenV2 internal immutable vaultAsset;
    MockTokenV2 internal immutable userAsset;

    bool public wrapPaused;
    bool public unwrapPaused;
    uint256 public wrapOutputBps = 10_000;
    uint256 public unwrapOutputBps = 10_000;

    constructor(MockTokenV2 _vaultAsset, MockTokenV2 _userAsset) {
        vaultAsset = _vaultAsset;
        userAsset = _userAsset;
    }

    function setWrapPaused(bool paused) external {
        wrapPaused = paused;
    }

    function setUnwrapPaused(bool paused) external {
        unwrapPaused = paused;
    }

    function setWrapOutputBps(uint256 bps) external {
        wrapOutputBps = bps;
    }

    function setUnwrapOutputBps(uint256 bps) external {
        unwrapOutputBps = bps;
    }

    function wrap(address asset, address to, uint256 amount) external {
        require(!wrapPaused, "WRAP_PAUSED");
        require(asset == address(userAsset), "BAD_WRAP_ASSET");
        require(userAsset.transferFrom(msg.sender, address(this), amount), "USER_TRANSFER_FAILED");
        uint256 output = (amount * wrapOutputBps) / 10_000;
        require(vaultAsset.transfer(to, output), "VAULT_TRANSFER_FAILED");
    }

    function unwrap(address asset, address to, uint256 amount) external {
        require(!unwrapPaused, "UNWRAP_PAUSED");
        require(asset == address(userAsset), "BAD_UNWRAP_ASSET");
        require(vaultAsset.transferFrom(msg.sender, address(this), amount), "VAULT_TRANSFER_FROM_FAILED");
        uint256 output = (amount * unwrapOutputBps) / 10_000;
        require(userAsset.transfer(to, output), "USER_TRANSFER_FAILED");
    }
}

contract FlatBookVaultV2Test is Test {
    FlatBookVaultV2 internal vault;
    MockTokenV2 internal asset;
    MockTokenV2 internal userAsset;
    MockCollateralRampV2 internal ramp;

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
        asset = new MockTokenV2("Polymarket USD", "pUSD", 6);
        userAsset = new MockTokenV2("Bridged USD Coin", "USDC.e", 6);
        ramp = new MockCollateralRampV2(asset, userAsset);
        vault = new FlatBookVaultV2(
            address(asset),
            address(userAsset),
            address(ramp),
            address(ramp),
            admin,
            bookRunner,
            navUpdater,
            tradingWallet,
            NAV_STALENESS_THRESHOLD
        );

        asset.transfer(user1, 1_000_000 * 1e6);
        asset.transfer(user2, 1_000_000 * 1e6);
        userAsset.transfer(user1, 1_000_000 * 1e6);
        userAsset.transfer(user2, 1_000_000 * 1e6);
        asset.transfer(address(ramp), 10_000_000 * 1e6);
        userAsset.transfer(address(ramp), 10_000_000 * 1e6);
        vm.stopPrank();
    }

    function testSupportsErc7540Interfaces() public view {
        assertTrue(vault.supportsInterface(type(IERC7540Operator).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Deposit).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Redeem).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7575).interfaceId));
    }

    function testVaultShareMetadata() public view {
        assertEq(vault.name(), "Sisyphus Vault Token");
        assertEq(vault.symbol(), "SVT");
        assertEq(vault.asset(), address(asset));
        assertEq(vault.userAsset(), address(userAsset));
    }

    function testDepositUSDCeWrapsAtomicallyAndMintsShares() public {
        uint256 assets = 25_000 * 1e6;
        bytes32 intentId = keccak256("deposit-usdce-open");

        vm.startPrank(user1);
        userAsset.approve(address(vault), assets);
        uint256 shares = vault.depositUSDCe(assets, user1, assets, block.timestamp + 1 hours, intentId);
        vm.stopPrank();

        assertEq(shares, assets);
        assertEq(vault.balanceOf(user1), assets);
        assertEq(asset.balanceOf(address(vault)), assets);
        assertEq(userAsset.balanceOf(address(vault)), 0);
        assertTrue(vault.consumedIntents(intentId));
    }

    function testDepositUSDCeRevertsAtomicallyWhenRampPaused() public {
        uint256 assets = 25_000 * 1e6;
        uint256 userBalanceBefore = userAsset.balanceOf(user1);
        uint256 rampBalanceBefore = userAsset.balanceOf(address(ramp));
        uint256 vaultAssetBefore = asset.balanceOf(address(vault));
        bytes32 intentId = keccak256("paused-deposit");

        ramp.setWrapPaused(true);

        vm.startPrank(user1);
        userAsset.approve(address(vault), assets);
        vm.expectRevert("WRAP_PAUSED");
        vault.depositUSDCe(assets, user1, assets, block.timestamp + 1 hours, intentId);
        vm.stopPrank();

        assertEq(userAsset.balanceOf(user1), userBalanceBefore);
        assertEq(userAsset.balanceOf(address(ramp)), rampBalanceBefore);
        assertEq(asset.balanceOf(address(vault)), vaultAssetBefore);
        assertEq(vault.balanceOf(user1), 0);
        assertEq(userAsset.balanceOf(address(vault)), 0);
        assertFalse(vault.consumedIntents(intentId));
    }

    function testDepositUSDCeSlippageRevertsWithoutStrandingFunds() public {
        uint256 assets = 25_000 * 1e6;
        bytes32 intentId = keccak256("slippage-deposit");
        ramp.setWrapOutputBps(9_000);

        vm.startPrank(user1);
        userAsset.approve(address(vault), assets);
        vm.expectRevert(abi.encodeWithSelector(FlatBookVaultV2.SlippageExceeded.selector, 22_500 * 1e6, assets));
        vault.depositUSDCe(assets, user1, assets, block.timestamp + 1 hours, intentId);
        vm.stopPrank();

        assertEq(vault.balanceOf(user1), 0);
        assertEq(asset.balanceOf(address(vault)), 0);
        assertEq(userAsset.balanceOf(address(vault)), 0);
        assertFalse(vault.consumedIntents(intentId));
    }

    function testDepositUSDCeIntentCannotBeReusedAfterSuccess() public {
        uint256 assets = 10_000 * 1e6;
        bytes32 intentId = keccak256("single-use-deposit");

        vm.startPrank(user1);
        userAsset.approve(address(vault), assets * 2);
        vault.depositUSDCe(assets, user1, assets, block.timestamp + 1 hours, intentId);
        vm.expectRevert(abi.encodeWithSelector(FlatBookVaultV2.IntentAlreadyConsumed.selector, intentId));
        vault.depositUSDCe(assets, user1, assets, block.timestamp + 1 hours, intentId);
        vm.stopPrank();
    }

    function testRequestDepositUSDCeQueuesWrappedAssets() public {
        uint256 assets = 30_000 * 1e6;
        bytes32 intentId = keccak256("queue-usdce");

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(user2);
        userAsset.approve(address(vault), assets);
        vault.requestDepositUSDCe(assets, user2, user2, assets, block.timestamp + 1 hours, intentId);
        vm.stopPrank();

        assertEq(vault.pendingDepositRequest(0, user2), assets);
        assertEq(asset.balanceOf(address(vault)), assets);
        assertEq(userAsset.balanceOf(address(vault)), 0);
    }

    function testClaimUSDCeUnwrapsClaimableRedeemAtomically() public {
        uint256 initialDeposit = 100_000 * 1e6;
        uint256 redeemShares = 40_000 * 1e6;
        bytes32 intentId = keccak256("claim-usdce");

        vm.startPrank(user1);
        asset.approve(address(vault), initialDeposit);
        vault.deposit(initialDeposit, user1);
        vault.approve(address(vault), redeemShares);
        vault.requestRedeem(redeemShares, user1, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();
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

        uint256 userAssetBefore = userAsset.balanceOf(user1);
        vm.prank(user1);
        uint256 claimed =
            vault.claimUSDCe(redeemShares, user1, user1, redeemShares, block.timestamp + 1 hours, intentId);

        assertEq(claimed, redeemShares);
        assertEq(userAsset.balanceOf(user1) - userAssetBefore, redeemShares);
        assertEq(vault.claimableRedeemRequest(0, user1), 0);
        assertEq(vault.claimableRedeemAssetsByController(user1), 0);
        assertEq(userAsset.balanceOf(address(vault)), 0);
        assertTrue(vault.consumedIntents(intentId));
    }

    function testClaimUSDCeRejectsVaultReceiver() public {
        uint256 initialDeposit = 100_000 * 1e6;
        uint256 redeemShares = 40_000 * 1e6;
        bytes32 intentId = keccak256("claim-usdce-self-receiver");

        vm.startPrank(user1);
        asset.approve(address(vault), initialDeposit);
        vault.deposit(initialDeposit, user1);
        vault.approve(address(vault), redeemShares);
        vault.requestRedeem(redeemShares, user1, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();
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

        vm.prank(user1);
        vm.expectRevert(FlatBookVaultV2.InvalidAddress.selector);
        vault.claimUSDCe(redeemShares, address(vault), user1, redeemShares, block.timestamp + 1 hours, intentId);

        assertEq(vault.claimableRedeemRequest(0, user1), redeemShares);
        assertEq(vault.claimableRedeemAssetsByController(user1), redeemShares);
        assertFalse(vault.consumedIntents(intentId));
    }

    function testClaimUSDCeOfframpFailurePreservesClaimablePusdFallback() public {
        uint256 initialDeposit = 100_000 * 1e6;
        uint256 redeemShares = 40_000 * 1e6;
        bytes32 failedIntent = keccak256("failed-usdce-claim");

        vm.startPrank(user1);
        asset.approve(address(vault), initialDeposit);
        vault.deposit(initialDeposit, user1);
        vault.approve(address(vault), redeemShares);
        vault.requestRedeem(redeemShares, user1, user1);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();
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

        ramp.setUnwrapPaused(true);
        vm.prank(user1);
        vm.expectRevert("UNWRAP_PAUSED");
        vault.claimUSDCe(redeemShares, user1, user1, redeemShares, block.timestamp + 1 hours, failedIntent);

        assertEq(vault.claimableRedeemRequest(0, user1), redeemShares);
        assertEq(vault.claimableRedeemAssetsByController(user1), redeemShares);
        assertFalse(vault.consumedIntents(failedIntent));

        uint256 pUsdBefore = asset.balanceOf(user1);
        vm.prank(user1);
        uint256 fallbackClaim = vault.redeem(redeemShares, user1, user1);
        assertEq(fallbackClaim, redeemShares);
        assertEq(asset.balanceOf(user1) - pUsdBefore, redeemShares);
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

    function testOpenStateCanQueueRedeemRequest() public {
        uint256 assets = 100_000 * 1e6;
        uint256 queuedRedeem = 25_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), assets);
        vault.deposit(assets, user1);
        vault.approve(address(vault), queuedRedeem);
        vault.requestRedeem(queuedRedeem, user1, user1);
        vm.stopPrank();

        assertEq(vault.pendingRedeemRequest(0, user1), queuedRedeem);
        assertEq(vault.balanceOf(user1), assets - queuedRedeem);
        assertEq(vault.balanceOf(address(vault)), queuedRedeem);
        (,, uint256 totalQueuedRedeemAssets,,,,,,,) = vault.cycles(0);
        assertEq(totalQueuedRedeemAssets, queuedRedeem);
    }

    function testOpenStateCanCancelQueuedRedeemBeforeProcessing() public {
        uint256 assets = 100_000 * 1e6;
        uint256 queuedRedeem = 25_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), assets);
        vault.deposit(assets, user1);
        vault.approve(address(vault), queuedRedeem);
        vault.requestRedeem(queuedRedeem, user1, user1);
        uint256 returnedShares = vault.cancelQueuedRedeem();
        vm.stopPrank();

        assertEq(returnedShares, queuedRedeem);
        assertEq(vault.pendingRedeemRequest(0, user1), 0);
        assertEq(vault.balanceOf(user1), assets);
        assertEq(vault.balanceOf(address(vault)), 0);
        (,, uint256 totalQueuedRedeemAssets,,,,,,,) = vault.cycles(0);
        assertEq(totalQueuedRedeemAssets, 0);
    }

    function testCancelQueuedRedeemUsesOriginalReservedAssetsNotCurrentNav() public {
        uint256 assets = 100_000 * 1e6;
        uint256 queuedRedeem = 25_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), assets);
        vault.deposit(assets, user1);
        vault.approve(address(vault), queuedRedeem);
        vault.requestRedeem(queuedRedeem, user1, user1);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(2e18);

        vm.prank(user1);
        vault.cancelQueuedRedeem();

        (,, uint256 totalQueuedRedeemAssets,,,,,,,) = vault.cycles(0);
        assertEq(totalQueuedRedeemAssets, 0);
    }

    function testQueuedOpenRedeemReducesAllocatableAssets() public {
        uint256 assets = 100_000 * 1e6;
        uint256 queuedRedeem = 25_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), assets);
        vault.deposit(assets, user1);
        vault.approve(address(vault), queuedRedeem);
        vault.requestRedeem(queuedRedeem, user1, user1);
        vm.stopPrank();

        assertEq(vault.maxAllocatableAssets(), assets - queuedRedeem);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                FlatBookVaultV2.AllocationExceedsAvailable.selector, assets - queuedRedeem + 1, assets - queuedRedeem
            )
        );
        vault.allocateToTradingWallet(assets - queuedRedeem + 1);
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

        assertEq(vault.claimableDepositRequest(0, user2), 0);
        assertEq(vault.balanceOf(user2), 60_000 * 1e6);
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

        assertEq(vault.balanceOf(user2), 60_000 * 1e6);
        assertEq(vault.claimableDepositRequest(0, user2), 0);
        assertEq(vault.claimableDepositSharesByController(user2), 0);
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
                FlatBookVaultV2.InvalidState.selector,
                FlatBookVaultV2.VaultState.Closed,
                FlatBookVaultV2.VaultState.Processing
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
                FlatBookVaultV2.InsufficientLiquidityForProcessing.selector, 300_000 * 1e6, 200_000 * 1e6
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
        assertEq(vault.claimableDepositRequest(0, user2), 0);
        assertEq(vault.balanceOf(user2), 60_000 * 1e6);
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
        assertEq(vault.claimableDepositRequest(0, user2), 0);
        assertEq(vault.balanceOf(user2), 60_000 * 1e6);
        assertEq(vault.claimableRedeemRequest(0, user1), user1QueuedRedeem);
    }
}
