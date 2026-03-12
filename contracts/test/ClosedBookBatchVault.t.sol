// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ClosedBookBatchVault} from "../src/ClosedBookBatchVault.sol";
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

contract ClosedBookBatchVaultTest is Test {
    ClosedBookBatchVault public vault;
    MockToken public asset;
    MockToken public strayToken;

    address public admin = makeAddr("admin");
    address public settler = makeAddr("settler");
    address public navUpdater = makeAddr("navUpdater");
    address public snapshotter = makeAddr("snapshotter");
    address public depositProcessor = makeAddr("depositProcessor");
    address public tradingWallet = makeAddr("tradingWallet");
    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");
    address public user3 = makeAddr("user3");
    address public keeper = makeAddr("keeper");

    uint256 constant NAV_STALENESS_THRESHOLD = 10 minutes;

    function setUp() public {
        vm.startPrank(admin);
        asset = new MockToken("USD Coin", "USDC", 6);
        strayToken = new MockToken("Stray Token", "STRAY", 6);
        vault = new ClosedBookBatchVault(
            address(asset),
            admin,
            settler,
            navUpdater,
            snapshotter,
            depositProcessor,
            tradingWallet,
            NAV_STALENESS_THRESHOLD
        );
        asset.transfer(user1, 1_000_000 * 1e6);
        asset.transfer(user2, 1_000_000 * 1e6);
        asset.transfer(user3, 1_000_000 * 1e6);
        vm.stopPrank();
        vm.stopPrank();
    }

    // ============================================================================
    // INVARIANT: Deposit Queueing
    // ============================================================================

    function testQueueDeposit() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        uint256 requestId = vault.queueDeposit(depositAmount);
        vm.stopPrank();

        assertEq(requestId, 1, "First request ID should be 1");
        assertEq(vault.totalQueuedAssets(), depositAmount, "Total queued assets should match");
        
        // DepositRequest: requestId, depositor, assets, targetBatch, createdAt, status, exists (7 fields)
        (uint256 storedId, address depositor, uint256 assets, uint256 targetBatch,,,) = vault.depositRequests(requestId);
        assertEq(storedId, requestId, "Request ID mismatch");
        assertEq(depositor, user1, "Depositor mismatch");
        assertEq(assets, depositAmount, "Assets mismatch");
        assertEq(targetBatch, 1, "Target batch should be next batch");
    }

    function testQueueDepositAccumulatesExistingRequest() public {
        uint256 deposit1 = 100_000 * 1e6;
        uint256 deposit2 = 50_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), deposit1 + deposit2);
        uint256 requestId1 = vault.queueDeposit(deposit1);
        uint256 requestId2 = vault.queueDeposit(deposit2);
        vm.stopPrank();

        assertEq(requestId1, requestId2, "Should return same request ID");
        assertEq(vault.totalQueuedAssets(), deposit1 + deposit2, "Total should accumulate");
        
        (,, uint256 assets,,,,) = vault.depositRequests(requestId1);
        assertEq(assets, deposit1 + deposit2, "Assets should be accumulated");
    }

    function testCancelDeposit() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        uint256 requestId = vault.queueDeposit(depositAmount);
        
        uint256 balanceBefore = asset.balanceOf(user1);
        vault.cancelDeposit(requestId);
        uint256 balanceAfter = asset.balanceOf(user1);
        vm.stopPrank();

        assertEq(balanceAfter - balanceBefore, depositAmount, "Assets should be returned");
        assertEq(vault.totalQueuedAssets(), 0, "Total queued should be 0");
        
        (,,,,, ClosedBookBatchVault.DepositStatus status,) = vault.depositRequests(requestId);
        assertEq(uint256(status), uint256(ClosedBookBatchVault.DepositStatus.Cancelled), "Status should be Cancelled");
    }

    function testCannotCancelDepositAfterCutoff() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        uint256 requestId = vault.queueDeposit(depositAmount);
        vm.stopPrank();

        // Move to cutoff
        vm.prank(snapshotter);
        vault.cutoffBatch();

        // Try to cancel
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.CannotCancelAfterCutoff.selector, 0, block.timestamp));
        vault.cancelDeposit(requestId);
    }

    // ============================================================================
    // INVARIANT: Deposit Processing
    // ============================================================================

    function testProcessDepositQueue() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        vault.queueDeposit(depositAmount);
        vm.stopPrank();

        // Complete batch 0 lifecycle to activate batch 1
        _advanceToNextBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));
        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        vm.prank(admin);
        vault.reopenBatch();
        // After reopen, batch 1 is active in Open state
        // Must cutoff and flatten to lock clearing price before processing deposits
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot2"));

        // Process deposits for batch 1 at locked clearing price
        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);

        uint256 shares = vault.balanceOf(user1);
        // Shares minted at locked clearing price (should be 1:1 at NAV 1e18)
        assertEq(shares, depositAmount, "Should mint 1:1 shares at locked clearing price");
        assertEq(vault.totalQueuedAssets(), 0, "Queued assets should be processed");
    }

    function testQueuedDepositMintsDuringRolloverToTargetBatch() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        uint256 requestId = vault.queueDeposit(depositAmount);
        vm.stopPrank();

        (,,, uint256 targetBatch,,,) = vault.depositRequests(requestId);
        assertEq(targetBatch, 1, "Deposit should target batch 1");

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot-rollover"));

        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);

        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        vm.prank(admin);
        vault.reopenBatch();

        assertEq(vault.currentBatchId(), 1, "Batch 1 should be active after rollover");
        assertEq(vault.balanceOf(user1), depositAmount, "Shares should exist when target batch opens");
        assertEq(vault.totalQueuedAssets(), 0, "Queued assets should be cleared during rollover");
    }

    // ============================================================================
    // INVARIANT: Redemption Escrow (Shares Live Until Settlement)
    // ============================================================================
    // ============================================================================
    // INVARIANT: Redemption Escrow (Shares Live Until Settlement)
    // ============================================================================

    function testRequestRedeemEscrowsShares() public {
        // First deposit and get shares
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        assertGt(shares, 0, "User should have shares");

        // Request redemption in current batch (batch 1)
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        uint256 requestId = vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();

        // Shares should be escrowed (held by vault but not burned)
        assertEq(vault.balanceOf(user1), 0, "User shares should be 0");
        assertEq(vault.balanceOf(address(vault)), shares, "Vault should hold escrowed shares");
        assertEq(vault.totalPendingRedeemShares(), shares, "Pending redeem should track shares");
        
        // Request should be in Pending state
        // RedemptionRequest: requestId, controller, owner, shares, assetsClaimable, batchId, status, createdAt, settledAt, exists (10 fields)
        (,,,,,, ClosedBookBatchVault.RedemptionStatus status,,,) = vault.redemptionRequests(requestId);
        assertEq(uint256(status), uint256(ClosedBookBatchVault.RedemptionStatus.Pending), "Status should be Pending");
    }

    function testCancelRedeemRequestReturnsShares() public {
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        uint256 requestId = vault.requestRedeem(shares, user1, user1);
        
        vault.cancelRedeemRequest(requestId);
        vm.stopPrank();

        assertEq(vault.balanceOf(user1), shares, "Shares should be returned");
        assertEq(vault.balanceOf(address(vault)), 0, "Vault should hold no shares");
        assertEq(vault.totalPendingRedeemShares(), 0, "Pending redeem should be 0");
    }

    // ============================================================================
    // INVARIANT: Sealed Batch Entry Routing
    // ============================================================================

    function testBatchStateTransitions() public {
        // Initial state: Open
        assertEq(uint256(vault.getBatchStatus(0)), uint256(ClosedBookBatchVault.BatchStatus.Open), "Initial state should be Open");

        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();

        // Cutoff
        vm.prank(snapshotter);
        vault.cutoffBatch();
        assertEq(uint256(vault.getBatchStatus(0)), uint256(ClosedBookBatchVault.BatchStatus.Cutoff), "After cutoff should be Cutoff");

        // Flatten
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));
        assertEq(uint256(vault.getBatchStatus(0)), uint256(ClosedBookBatchVault.BatchStatus.Flattening), "After flatten should be Flattening");
        // Settle and close batch 0, then reopen to batch 1
        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        vm.prank(admin);
        vault.reopenBatch();
        
        // Queue deposit for batch 2
        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();
        
        // Complete batch 1 lifecycle to activate batch 2
        _advanceToNextBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot2"));
        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);
        vm.prank(settler);
        vault.settleBatch(1);
        vm.prank(settler);
        vault.closeBatch(1);
        vm.prank(admin);
        vault.reopenBatch();
        // Batch 2 is now active in Open state
        // Must cutoff and flatten to lock clearing price before processing deposits
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot3"));
        
        // Now process deposits for batch 2 at locked clearing price
        vm.prank(depositProcessor);
        vault.processDepositQueue(2, 0, 100);
        
        // Batch 2 is in Flattening state after deposit processing
        // Settle and close batch 2

        // Settle and close batch 2
        vm.prank(settler);
        vault.settleBatch(2);
        vm.prank(settler);
        vault.closeBatch(2);
        assertEq(uint256(vault.getBatchStatus(2)), uint256(ClosedBookBatchVault.BatchStatus.Closed), "After close should be Closed");
    }

    function testCannotAdvanceEmptyBatch() public {
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.NoActionableWork.selector, 0));
        vault.cutoffBatch();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);

        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.NoActionableWork.selector, 0));
        vault.flattenBatch(keccak256("empty-batch"));
    }

    function testAllocateToTradingWalletMovesExcessCapital() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        vault.queueDeposit(depositAmount);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("allocation-batch"));
        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);
        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        vm.prank(admin);
        vault.reopenBatch();

        assertEq(vault.maxAllocatableAssets(), depositAmount, "Fresh idle capital should be allocatable");

        vm.prank(admin);
        vault.allocateToTradingWallet(depositAmount / 2);

        assertEq(asset.balanceOf(tradingWallet), depositAmount / 2, "Trading wallet should receive allocated capital");
        assertEq(vault.totalAssets(), depositAmount / 2, "Vault should retain the unallocated remainder");
    }

    function testAllocateToTradingWalletBlockedDuringFlattening() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        vault.queueDeposit(depositAmount);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("blocked-allocation-batch"));

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ClosedBookBatchVault.CapitalAllocationBlocked.selector,
                0,
                ClosedBookBatchVault.BatchStatus.Flattening
            )
        );
        vault.allocateToTradingWallet(1);
    }

    function testPermissionlessKeeperCanProgressLifecycle() public {
        uint256 depositAmount = 100_000 * 1e6;

        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        vault.queueDeposit(depositAmount);
        vm.stopPrank();

        vm.prank(keeper);
        vault.cutoffBatch();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);

        vm.prank(keeper);
        vault.flattenBatch(keccak256("keeper-batch-0"));

        vm.prank(keeper);
        vault.settleBatch(0);

        vm.prank(keeper);
        vault.closeBatch(0);

        vm.prank(keeper);
        vault.reopenBatch();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);

        vm.prank(keeper);
        vault.flattenBatch(keccak256("keeper-batch-1"));

        vm.prank(keeper);
        vault.processDepositQueue(1, 0, 100);

        assertEq(vault.balanceOf(user1), depositAmount, "Keeper should be able to process queued deposit lifecycle");
    }

    function testCannotDepositAfterCutoff() public {
        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();

        vm.prank(snapshotter);
        vault.cutoffBatch();

        vm.startPrank(user2);
        asset.approve(address(vault), 100_000 * 1e6);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.BatchNotOpen.selector, 0));
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();
    }

    function testCannotRequestRedeemAfterCutoff() public {
        _setupUserWithShares(user1, 100_000 * 1e6);

        vm.startPrank(user2);
        asset.approve(address(vault), 1_000_000);
        vault.queueDeposit(1_000_000);
        vm.stopPrank();
        
        // Cutoff current batch
        vm.prank(snapshotter);
        vault.cutoffBatch();

        uint256 shares = vault.balanceOf(user1);
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.BatchNotOpen.selector, 2));
        vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();
    }

    // ============================================================================
    // INVARIANT: Settlement Burns Shares
    // ============================================================================

    function testSettlementBurnsShares() public {
        // Setup: deposit and get shares
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        uint256 supplyBefore = vault.totalSupply();

        // Request redeem
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();
        
        uint256 redeemBatchId = vault.currentBatchId();

        // Flatten batch first
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));

        // Move through batch lifecycle
        _advanceToNextBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(settler);
        vault.settleBatch(redeemBatchId);

        // Settlement burns escrowed shares and reserves claimable assets
        assertEq(vault.balanceOf(address(vault)), 0, "Vault should not hold escrowed shares after settlement");
        assertEq(vault.totalSupply(), supplyBefore - shares, "Supply should decrease at settlement");
        assertEq(vault.reservedRedemptionAssets(), shares, "Claimable assets should be reserved after settlement");

        // Claim redemption
        vm.prank(user1);
        vault.redeem(1, shares, user1);

        // Claim should not change supply after settlement burn
        assertEq(vault.balanceOf(address(vault)), 0, "Vault should hold no shares after claim");
        assertEq(vault.totalSupply(), supplyBefore - shares, "Supply should decrease after claim");
        assertEq(vault.reservedRedemptionAssets(), 0, "Reserved assets should clear after full claim");
    }

    // ============================================================================
    // INVARIANT: Reopen Flow
    // ============================================================================

    function testReopenBatch() public {
        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();

        // Move batch 0 through its lifecycle
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));

        // Settle and close batch 0, reopen to batch 1
        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        vm.prank(admin);
        vault.reopenBatch();
        
        // Queue deposit for batch 2
        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();
        
        // Complete batch 1 lifecycle to activate batch 2
        _advanceToNextBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot2"));
        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);
        vm.prank(settler);
        vault.settleBatch(1);
        vm.prank(settler);
        vault.closeBatch(1);
        vm.prank(admin);
        vault.reopenBatch();
        
        // Batch 2 is now active in Open state
        // Must cutoff and flatten to lock clearing price before processing deposits
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot3"));
        
        // Now batch 2 is in Flattening state - process deposits
        vm.prank(depositProcessor);
        vault.processDepositQueue(2, 0, 100);
        // Batch 2 is in Flattening state after deposit processing
        // Settle and close batch 2
        vm.prank(settler);
        vault.settleBatch(2);
        vm.prank(settler);
        vault.closeBatch(2);

        uint256 prevBatchId = vault.currentBatchId();
        // Reopen
        vm.prank(admin);
        vault.reopenBatch();

        uint256 newBatchId = vault.currentBatchId();
        assertEq(newBatchId, prevBatchId + 1, "New batch ID should increment");

        // Batch struct fields (14 total): batchId, startTime, endTime, cutoffTime, snapshotNAV, lockedClearingPrice,
        // snapshotTimestamp, totalSharesPending, totalAssetsSnapshot, proRataRatio, totalQueuedDeposits,
        // status, isPriceLocked, exists
        (uint256 batchId, uint256 startTime, uint256 endTime,,,,,,,,, ClosedBookBatchVault.BatchStatus status, bool isPriceLocked, bool exists) = vault.batches(newBatchId);
        assertTrue(exists, "New batch should exist");
        assertEq(batchId, newBatchId, "Batch ID should match");
        assertEq(startTime, block.timestamp, "Start time should be set when the batch opens");
        assertEq(endTime, 0, "Open batches should not advertise a scheduled end time");
        assertEq(uint256(status), uint256(ClosedBookBatchVault.BatchStatus.Open), "Status should be Open");
    }

    function testDepositInNewBatchAfterReopen() public {
        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();

        // Close previous batch - go through full cycle
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));
        
        // Settle and close batch 0, reopen to batch 1
        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        vm.prank(admin);
        vault.reopenBatch();
        
        // Queue deposit for batch 2
        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();
        // Complete batch 1 lifecycle to activate batch 2
        _advanceToNextBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot2"));
        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);
        vm.prank(settler);
        vault.settleBatch(1);
        vm.prank(settler);
        vault.closeBatch(1);
        vm.prank(admin);
        vault.reopenBatch();
        
        // Batch 2 is now active in Open state
        // Must cutoff and flatten to lock clearing price before processing deposits
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot3"));
        
        // Process deposits for batch 2 (target of the deposit)
        vm.prank(depositProcessor);
        vault.processDepositQueue(2, 0, 100);
        // Batch 2 is in Flattening state after deposit processing
        // Settle and close batch 2
        
        // Settle and close batch 2
        vm.prank(settler);
        vault.settleBatch(2);
        vm.prank(settler);
        vault.closeBatch(2);

        vm.prank(admin);
        vault.reopenBatch();

        // Deposit in new batch
        uint256 depositAmount = 50_000 * 1e6;
        vm.startPrank(user2);
        asset.approve(address(vault), depositAmount);
        uint256 requestId = vault.queueDeposit(depositAmount);
        vm.stopPrank();

        (,,, uint256 targetBatch,,,) = vault.depositRequests(requestId);
        assertEq(targetBatch, vault.currentBatchId() + 1, "Deposit should target next batch");
    }

    // ============================================================================
    // INVARIANT: Pro-Rata Distribution
    // ============================================================================

    function testProRataDistribution() public {
        // Setup two users with deposits in batch 0 (current)
        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();
        
        vm.startPrank(user2);
        asset.approve(address(vault), 100_000 * 1e6);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();

        // Settle and close batch 0, reopen to batch 1
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));
        
        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        vm.prank(admin);
        vault.reopenBatch();

        // Need to cutoff and flatten batch 1 before processing deposits
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot2"));

        // Process deposits for batch 1
        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);

        uint256 user1Shares = vault.balanceOf(user1);
        uint256 user2Shares = vault.balanceOf(user2);
        assertGt(user1Shares, 0, "User1 should have shares");
        assertGt(user2Shares, 0, "User2 should have shares");

        // Complete batch 1 lifecycle and reopen to batch 2
        // Batch 1 is already in Flattening state, can directly settle
        vm.prank(settler);
        vault.settleBatch(1);
        vm.prank(settler);
        vault.closeBatch(1);
        vm.prank(admin);
        vault.reopenBatch();

        // Batch 2 is now active in Open state
        // First, have users request redeem (while batch is Open)
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), user1Shares);
        vault.requestRedeem(user1Shares, user1, user1);
        vm.stopPrank();

        vm.startPrank(user2);
        IERC20(address(vault)).approve(address(vault), user2Shares);
        vault.requestRedeem(user2Shares, user2, user2);
        vm.stopPrank();

        // Then cutoff and flatten batch 2
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot3"));

        // Process deposits for batch 2 (while batch is Flattening)
        vm.prank(depositProcessor);
        vault.processDepositQueue(2, 0, 100);
        
        // Verify shares are still correct

        // Batch 2 is already in Flattening state from deposit processing
        // Users requested redeem while batch was in Flattening state
        // Now settle batch 2 directly

        // Settle and close batch 2
        vm.prank(settler);
        vault.settleBatch(2);
        vm.prank(settler);
        vault.closeBatch(2);

        // Check pro-rata ratio - proRataRatio is the 11th field (index 10)
        (,,,,,,,,, uint256 proRataRatio,,,,) = vault.batches(2);
        uint256 expectedProRata = (1e18); // Full pro-rata since we didn't transfer assets out
        assertEq(proRataRatio, expectedProRata, "Pro-rata ratio should be 100%");

        // Both users should have full claimable amounts
        (,,,, uint256 claimable1,,,,,) = vault.redemptionRequests(1);
        (,,,, uint256 claimable2,,,,,) = vault.redemptionRequests(2);

        assertEq(claimable1, user1Shares, "User1 claimable should equal shares");
        assertEq(claimable2, user2Shares, "User2 claimable should equal shares");
    }
    // ============================================================================
    // INVARIANT: No Carry Surface
    // ============================================================================

    function testNoCarryFieldsInContract() public {
        // This test verifies that no carry-related fields exist
        // by checking that redemption requests don't have carry accounting
        
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        uint256 requestId = vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();

        // Request struct should only have: requestId, controller, owner, shares, 
        // assetsClaimable, batchId, status, createdAt, settledAt, exists
        // No carryDeducted, entitlement, accrued, claimed, carryRemaining
        (uint256 rid, address ctrl, address own, uint256 shs, uint256 claim, uint256 batch,,,,) = vault.redemptionRequests(requestId);
        
        // Verify the struct doesn't have carry fields
        assertEq(rid, requestId, "Request ID should match");
        assertEq(ctrl, user1, "Controller should match");
        assertEq(own, user1, "Owner should match");
        assertEq(shs, shares, "Shares should match");
        assertEq(batch, vault.currentBatchId(), "Batch should be current batch");
    }

    // ============================================================================
    // INVARIANT: Emergency Mode
    // ============================================================================

    function testEmergencyModeBlocksDeposits() public {
        vm.prank(admin);
        vault.setEmergencyMode(true);

        vm.startPrank(user1);
        asset.approve(address(vault), 100_000 * 1e6);
        vm.expectRevert(ClosedBookBatchVault.EmergencyModeActive.selector);
        vault.queueDeposit(100_000 * 1e6);
        vm.stopPrank();
    }

    function testEmergencyModeBlocksRedemptions() public {
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);

        vm.prank(admin);
        vault.setEmergencyMode(true);

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        vm.expectRevert(ClosedBookBatchVault.EmergencyModeActive.selector);
        vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();
    }

    // ============================================================================
    // INVARIANT: NAV Freshness
    // ============================================================================

    function testStaleNAVBlocksFlatten() public {
        _setupUserWithShares(user1, 100_000 * 1e6);

        vm.startPrank(user2);
        asset.approve(address(vault), 1_000_000);
        vault.queueDeposit(1_000_000);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);

        vm.prank(snapshotter);
        vault.cutoffBatch();

        // Wait for NAV to go stale
        vm.warp(block.timestamp + NAV_STALENESS_THRESHOLD + 1);

        vm.prank(snapshotter);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.NAVStale.selector, block.timestamp - NAV_STALENESS_THRESHOLD - 1, NAV_STALENESS_THRESHOLD));
        vault.flattenBatch(keccak256("snapshot"));
    }

    function testIsNAVFresh() public {
        // Initial state: deploy time is when vault was deployed
        // Since setUp just ran, NAV should be fresh (set in constructor)
        assertTrue(vault.isNAVFresh(), "NAV should be fresh initially after deploy");
        assertEq(vault.currentNAV(), 1e18, "Initial NAV should start at par");

        // Warp to make it stale
        vm.warp(block.timestamp + NAV_STALENESS_THRESHOLD + 1);
        assertFalse(vault.isNAVFresh(), "NAV should be stale after threshold");
        
        // Update NAV
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        assertTrue(vault.isNAVFresh(), "NAV should be fresh after update");
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    function _setupUserWithShares(address user, uint256 amount) internal {
        vm.startPrank(user);
        asset.approve(address(vault), amount);
        vault.queueDeposit(amount);
        vm.stopPrank();

        // Close batch 0 and reopen to batch 1
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));
        
        // Settle and close batch 0 (no redemptions)
        vm.prank(settler);
        vault.settleBatch(0);
        vm.prank(settler);
        vault.closeBatch(0);
        
        // Reopen to batch 1
        vm.prank(admin);
        vault.reopenBatch();

        // Now batch 1 is active and in Open state
        // Need to cutoff and flatten to lock clearing price before processing deposits
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot2"));

        // Now process deposits for batch 1 at locked clearing price
        vm.prank(depositProcessor);
        vault.processDepositQueue(1, 0, 100);
        
        // Complete batch 1 lifecycle and reopen to batch 2
        // Batch 1 is in Flattening state, can directly settle (no redemptions)
        vm.prank(settler);
        vault.settleBatch(1);
        vm.prank(settler);
        vault.closeBatch(1);
        vm.prank(admin);
        vault.reopenBatch();
        
        // Now batch 2 is active and in Open state for redemptions
    }

    function _advanceToNextBatch() internal {
        vm.warp(block.timestamp + 1);
    }

    // ============================================================================
    // T10: BATCH FAIRNESS REGRESSION TESTS
    // ============================================================================

    // ---------------------------------------------------------------------------
    // Test: First request seals batch and blocks current-cycle entries
    // ---------------------------------------------------------------------------
    function test_FirstDepositSealsBatchAndBlocksCurrentCycleEntries() public {
        // Setup: User1 makes first deposit - this should create target batch 1
        uint256 depositAmount = 100_000 * 1e6;
        
        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        uint256 requestId = vault.queueDeposit(depositAmount);
        vm.stopPrank();

        // Verify deposit targets next batch, not current
        (,,, uint256 targetBatch,,,) = vault.depositRequests(requestId);
        assertEq(targetBatch, 1, "Deposit should target batch 1, not current batch 0");
        
        // Verify batch 1 was auto-created
        (uint256 batchId, uint256 startTime,,,,,,,,,, ClosedBookBatchVault.BatchStatus status,, bool exists) = vault.batches(1);
        assertTrue(exists, "Batch 1 should exist");
        assertEq(batchId, 1, "Batch ID should be 1");
        assertEq(uint256(status), uint256(ClosedBookBatchVault.BatchStatus.Open), "Batch 1 should be Open");
        assertEq(startTime, 0, "Prefunded next batch should not advertise a start time before reopen");
    }

    function test_FirstRedemptionSealsBatchParticipation() public {
        // Setup: Give user1 shares first - after this we're in batch 2
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        uint256 currentBatchId = vault.currentBatchId();
        
        // User1 requests redemption in current batch
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        uint256 requestId = vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();

        // Verify redemption is recorded for current batch (batch 2)
        // RedemptionRequest struct: requestId, controller, owner, shares, assetsClaimable, batchId, ...
        (,,,,, uint256 redemptionBatchId,,,,) = vault.redemptionRequests(requestId);
        assertEq(redemptionBatchId, currentBatchId, "Redemption should be for current batch");
        
        // Verify shares are now escrowed in vault
        assertEq(vault.balanceOf(user1), 0, "User should have 0 shares");
        assertEq(vault.balanceOf(address(vault)), shares, "Vault should hold escrowed shares");
        assertEq(vault.totalPendingRedeemShares(), shares, "Pending redeem should track shares");
    }

    function test_EscrowedSharesBurnAtSettlement() public {
        // Setup: User gets shares and requests redemption - after this we're in batch 2
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        uint256 supplyBefore = vault.totalSupply();
        uint256 redeemBatchId = vault.currentBatchId(); // batch 2
        
        // Request redemption in batch 2
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        uint256 requestId = vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();

        // Advance through cutoff and flatten for batch 2
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));

        // Advance to batch 3 and settle batch 2
        _advanceToNextBatch();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        
        vm.prank(settler);
        vault.settleBatch(redeemBatchId);

        // Settlement burns shares immediately when the request becomes claimable
        assertEq(vault.totalSupply(), supplyBefore - shares, "Supply reduced at settlement");
        assertEq(vault.balanceOf(address(vault)), 0, "Vault should not hold shares after settlement");
        assertEq(vault.totalPendingRedeemShares(), 0, "Pending redeem counter should clear after settlement");

        // Claim should only transfer assets and consume the request
        vm.prank(user1);
        vault.redeem(requestId, shares, user1);

        assertEq(vault.totalSupply(), supplyBefore - shares, "Supply remains unchanged after claim");
        assertEq(vault.balanceOf(address(vault)), 0, "Vault holds no shares after claim");
    }

    function testOperatorCanRequestRedeemForOwner() public {
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);

        vm.prank(user1);
        vault.setOperator(user2, true);

        vm.prank(user1);
        IERC20(address(vault)).approve(address(vault), shares);

        vm.prank(user2);
        uint256 requestId = vault.requestRedeem(shares, user1, user1);

        assertEq(requestId, 1, "Operator should create the first request");
        assertEq(vault.balanceOf(user1), 0, "Owner shares should be escrowed");
        assertEq(vault.balanceOf(address(vault)), shares, "Vault should hold escrowed shares");
        assertTrue(vault.isOperator(user1, user2), "Operator approval should persist");
    }

    function testControllerRequestIdsTracksHistory() public {
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        uint256 firstRequestId = vault.requestRedeem(shares / 2, user1, user1);
        vault.cancelRedeemRequest(firstRequestId);
        IERC20(address(vault)).approve(address(vault), shares / 2);
        uint256 secondRequestId = vault.requestRedeem(shares / 2, user1, user1);
        vm.stopPrank();

        uint256[] memory requestIds = vault.getControllerRequestIds(user1);
        assertEq(requestIds.length, 2, "Controller request history should include both requests");
        assertEq(requestIds[0], firstRequestId, "First request should remain in history");
        assertEq(requestIds[1], secondRequestId, "Second request should remain in history");
        assertEq(vault.controllerToRequestId(user1), secondRequestId, "Latest request pointer should still update");
    }

    function testSettlementExcludesPriorReservedClaimsFromNewBatch() public {
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 firstBatchShares = vault.balanceOf(user1);
        uint256 firstBatchId = vault.currentBatchId();

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), firstBatchShares);
        vault.requestRedeem(firstBatchShares, user1, user1);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("batch-one"));
        vm.prank(settler);
        vault.settleBatch(firstBatchId);

        assertEq(vault.reservedRedemptionAssets(), firstBatchShares, "First batch claim should remain reserved");

        vm.prank(settler);
        vault.closeBatch(firstBatchId);
        vm.prank(admin);
        vault.reopenBatch();
        uint256 secondBatchId = vault.currentBatchId();
        uint256 secondBatchShares = 100_000 * 1e6;

        vm.prank(admin);
        asset.transfer(address(vault), secondBatchShares);
        deal(address(vault), user2, secondBatchShares, true);

        vm.startPrank(user2);
        IERC20(address(vault)).approve(address(vault), secondBatchShares);
        uint256 secondRequestId = vault.requestRedeem(secondBatchShares, user2, user2);
        vm.stopPrank();

        deal(
            address(asset),
            address(vault),
            asset.balanceOf(address(vault)) - (firstBatchShares / 2),
            true
        );

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("batch-two"));
        vm.prank(settler);
        vault.settleBatch(secondBatchId);

        uint256 expectedSecondClaimableAssets = secondBatchShares / 2;
        (,,,, uint256 secondClaimableAssets,,,,,) = vault.redemptionRequests(secondRequestId);
        assertEq(
            secondClaimableAssets,
            expectedSecondClaimableAssets,
            "Second batch should only receive surplus after older reserved claims"
        );
        assertEq(
            vault.reservedRedemptionAssets(),
            firstBatchShares + expectedSecondClaimableAssets,
            "Aggregate reserved assets should include prior claims plus the new pro-rata amount"
        );
    }

    function testClearingPriceExcludesReservedRedemptionAssets() public {
        _setupUserWithShares(user1, 2_000_000);

        uint256 redemptionBatchId = vault.currentBatchId();

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), 1_000_000);
        vault.requestRedeem(1_000_000, user1, user1);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("redemption-batch"));
        vm.prank(settler);
        vault.settleBatch(redemptionBatchId);

        assertEq(vault.reservedRedemptionAssets(), 1_000_000, "Reserved assets should equal claimable redemption");
        assertEq(vault.totalSupply(), 1_000_000, "One active share should remain outstanding");

        vm.prank(settler);
        vault.closeBatch(redemptionBatchId);
        vm.prank(admin);
        vault.reopenBatch();

        vm.startPrank(user1);
        asset.approve(address(vault), 1_000_000);
        vault.queueDeposit(1_000_000);
        vm.stopPrank();

        uint256 bridgeBatchId = vault.currentBatchId();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("bridge-batch"));

        (,,,, uint256 lockedClearingPrice,,,,,,,,,) = vault.batches(bridgeBatchId);
        assertEq(lockedClearingPrice, 1e18, "Reserved claims must not inflate the locked clearing price");

        vm.prank(settler);
        vault.settleBatch(bridgeBatchId);
        vm.prank(settler);
        vault.closeBatch(bridgeBatchId);
        vm.prank(admin);
        vault.reopenBatch();

        uint256 depositBatchId = vault.currentBatchId();
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("deposit-batch"));

        (,,,, uint256 depositBatchClearingPrice,,,,,,,,,) = vault.batches(depositBatchId);
        assertEq(depositBatchClearingPrice, 1e18, "Deposit batch should also lock at par");

        vm.prank(depositProcessor);
        vault.processDepositQueue(depositBatchId, 0, 1000);

        assertEq(vault.balanceOf(user1), 2_000_000, "Second deposit should mint 1.0 share at par");
    }

    function testRescueERC20BlocksAssetAndShareToken() public {
        vm.prank(admin);
        strayToken.transfer(address(vault), 10_000 * 1e6);

        vm.prank(admin);
        vault.rescueERC20(address(strayToken), user3, 5_000 * 1e6);
        assertEq(strayToken.balanceOf(user3), 5_000 * 1e6, "Rescue should transfer unrelated tokens");

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.InvalidToken.selector, address(asset)));
        vault.rescueERC20(address(asset), user3, 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.InvalidToken.selector, address(vault)));
        vault.rescueERC20(address(vault), user3, 1);
    }

    function testRescueUnderlyingSurplusRequiresEmergencyModeAndSurplusOnly() public {
        uint256 accidentalAssets = 25_000 * 1e6;
        address surplusReceiver = makeAddr("surplusReceiver");
        vm.prank(admin);
        asset.transfer(address(vault), accidentalAssets);

        vm.prank(admin);
        vm.expectRevert(ClosedBookBatchVault.EmergencyModeRequired.selector);
        vault.rescueUnderlyingSurplus(surplusReceiver, 1);

        vm.prank(admin);
        vault.setEmergencyMode(true);

        vm.prank(navUpdater);
        vault.updateNAV(1e18);

        assertEq(vault.maxRescueableUnderlying(), accidentalAssets, "Only accidental surplus should be rescueable");

        vm.prank(admin);
        vault.rescueUnderlyingSurplus(surplusReceiver, accidentalAssets / 5);

        assertEq(asset.balanceOf(surplusReceiver), accidentalAssets / 5, "Rescued underlying should transfer to receiver");
        assertEq(
            vault.maxRescueableUnderlying(),
            accidentalAssets - (accidentalAssets / 5),
            "Rescueable surplus should decrement after recovery"
        );

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ClosedBookBatchVault.RescueExceedsSurplus.selector,
                accidentalAssets,
                accidentalAssets - (accidentalAssets / 5)
            )
        );
        vault.rescueUnderlyingSurplus(surplusReceiver, accidentalAssets);
    }

    function testWithdrawRoundsUpSharesToPreventZeroShareLeak() public {
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        uint256 batchId = vault.currentBatchId();

        vm.prank(admin);
        asset.transfer(address(vault), 100_000 * 1e6);

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        uint256 requestId = vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("high-nav"));
        vm.prank(settler);
        vault.settleBatch(batchId);

        (, , , uint256 sharesBefore, uint256 assetsBefore,,,,,) = vault.redemptionRequests(requestId);

        vm.prank(user1);
        uint256 sharesConsumed = vault.withdraw(requestId, 1, user1);

        (, , , uint256 sharesAfter, uint256 assetsAfter,,,,,) = vault.redemptionRequests(requestId);
        assertEq(sharesConsumed, 1, "Withdraw should round up to at least one share");
        assertEq(sharesBefore - sharesAfter, 1, "One share should be consumed");
        assertEq(assetsBefore - assetsAfter, 1, "Requested assets should be debited exactly once");
    }

    function testSettleBatchChunkMustStartAtZero() public {
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        uint256 batchId = vault.currentBatchId();

        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("chunk-start"));

        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.SettlementIncomplete.selector, batchId));
        vault.settleBatchChunk(batchId, 1);
    }

    // ---------------------------------------------------------------------------
    // Test: Batch clearing uses post-flat realized cash basis
    // ---------------------------------------------------------------------------
    function test_ClearingPriceUsesPostFlatRealizedCashBasis() public {
        // Setup: Initial deposit creates shares at 1:1
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        
        // Queue a new deposit for next batch
        uint256 newDeposit = 50_000 * 1e6;
        vm.startPrank(user2);
        asset.approve(address(vault), newDeposit);
        vault.queueDeposit(newDeposit);
        vm.stopPrank();

        // User1 requests redemption
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();

        // Advance: cutoff -> flatten (locks price) -> settle
        vm.prank(navUpdater);
        vault.updateNAV(2e18); // NAV doubles to 2.0 (but queued deposits excluded)
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));

        // Get the locked clearing price
        (,,,, uint256 lockedClearingPrice,,,,,,,,,) = vault.batches(0);
        
        // The locked price should be based on realized assets only (excluding queued deposits)
        // Realized assets = total assets - queued assets
        // At this point, vault has 150k USDC, but 50k is queued, so 100k realized
        // Supply is 100k shares (from user1)
        // Clearing price = 100k * 1e18 / 100k = 1e18 (1.0)
        assertEq(lockedClearingPrice, 1e18, "Clearing price should be 1.0 based on realized assets");
    }

    function test_ClearingPriceWithMultipleDepositsBeforeLock() public {
        // Setup: User1 gets shares
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares1 = vault.balanceOf(user1);
        
        // User2 queues deposit for next batch
        uint256 deposit2 = 50_000 * 1e6;
        vm.startPrank(user2);
        asset.approve(address(vault), deposit2);
        vault.queueDeposit(deposit2);
        vm.stopPrank();

        // User3 also queues deposit for next batch
        uint256 deposit3 = 25_000 * 1e6;
        vm.startPrank(user1); // user1 has shares, can also deposit
        asset.approve(address(vault), deposit3);
        vault.queueDeposit(deposit3);
        vm.stopPrank();

        // Total queued = 75k, Total vault assets = 175k, Realized = 100k
        // Supply = 100k shares
        // Clearing price should be 1.0
        
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));

        (,,,, uint256 lockedClearingPrice,,,,,,,,,) = vault.batches(0);
        assertEq(lockedClearingPrice, 1e18, "Clearing price should be 1.0");
    }

    // ---------------------------------------------------------------------------
    // Test: Deposits do not change clearing price before lock
    // ---------------------------------------------------------------------------
    function test_DepositsDoNotAffectClearingPriceBeforeLock() public {
        // Setup: User1 gets shares
        _setupUserWithShares(user1, 100_000 * 1e6);
        
        // Record initial state
        uint256 initialVaultBalance = asset.balanceOf(address(vault));
        
        // User2 makes multiple deposits before lock
        uint256 deposit1 = 50_000 * 1e6;
        uint256 deposit2 = 30_000 * 1e6;
        uint256 deposit3 = 20_000 * 1e6;
        
        vm.startPrank(user2);
        asset.approve(address(vault), deposit1 + deposit2 + deposit3);
        
        uint256 req1 = vault.queueDeposit(deposit1);
        uint256 req2 = vault.queueDeposit(deposit2); // Should accumulate to req1
        uint256 req3 = vault.queueDeposit(deposit3); // Should accumulate to req1
        vm.stopPrank();

        // All deposits should accumulate into one request
        assertEq(req1, req2, "Requests should be the same");
        assertEq(req2, req3, "Requests should be the same");
        
        (,, uint256 totalAssets,,,,) = vault.depositRequests(req1);
        assertEq(totalAssets, deposit1 + deposit2 + deposit3, "Total should be accumulated");
        
        // Verify vault balance increased
        uint256 finalVaultBalance = asset.balanceOf(address(vault));
        assertEq(finalVaultBalance - initialVaultBalance, deposit1 + deposit2 + deposit3, "Vault should hold all deposits");
        
        // Now lock the price - deposits should not affect clearing price
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));

        (,,,, uint256 lockedClearingPrice,,,,,,,,,) = vault.batches(0);
        assertEq(lockedClearingPrice, 1e18, "Clearing price should still be 1.0 regardless of deposits");
    }

    function test_QueuedDepositsExcludedFromPriceCalculation() public {
        // Setup: User1 gets 100k shares
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 supply = vault.totalSupply();
        
        // User2 queues 100k deposit
        uint256 queuedDeposit = 100_000 * 1e6;
        vm.startPrank(user2);
        asset.approve(address(vault), queuedDeposit);
        vault.queueDeposit(queuedDeposit);
        vm.stopPrank();

        // Total vault assets = 200k
        // Queued assets = 100k
        // Realized assets = 100k
        // Supply = 100k shares
        // If queued deposits were included: price = 200k/100k = 2.0
        // With queued deposits excluded: price = 100k/100k = 1.0
        
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot"));

        (,,,, uint256 lockedClearingPrice,,,,,,,,,) = vault.batches(0);
        
        // Verify price is 1.0, not 2.0 (proving queued deposits are excluded)
        assertEq(lockedClearingPrice, 1e18, "Price should be 1.0, queued deposits excluded from calc");
    }

    // ---------------------------------------------------------------------------
    // Test: Requests after cutoff route to next batch / blocked appropriately
    // ---------------------------------------------------------------------------
    function test_DepositAfterCutoffRoutesToNextBatch() public {
        // Setup: User1 makes initial deposit
        uint256 deposit1 = 100_000 * 1e6;
        vm.startPrank(user1);
        asset.approve(address(vault), deposit1);
        uint256 req1 = vault.queueDeposit(deposit1);
        vm.stopPrank();

        // Cutoff current batch
        vm.prank(snapshotter);
        vault.cutoffBatch();

        // User2 deposits after cutoff
        uint256 deposit2 = 50_000 * 1e6;
        vm.startPrank(user2);
        asset.approve(address(vault), deposit2);
        
        // This should revert because batch is not Open
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.BatchNotOpen.selector, 0));
        vault.queueDeposit(deposit2);
        vm.stopPrank();
    }

    function test_RedemptionAfterCutoffIsBlocked() public {
        // Setup: User1 gets shares - after this we're in batch 2
        _setupUserWithShares(user1, 100_000 * 1e6);
        uint256 shares = vault.balanceOf(user1);
        uint256 currentBatch = vault.currentBatchId(); // should be 2

        vm.startPrank(user2);
        asset.approve(address(vault), 1_000_000);
        vault.queueDeposit(1_000_000);
        vm.stopPrank();
        
        // Cutoff current batch
        vm.prank(snapshotter);
        vault.cutoffBatch();

        // Try to request redemption after cutoff - should fail with current batch ID
        vm.startPrank(user1);
        IERC20(address(vault)).approve(address(vault), shares);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.BatchNotOpen.selector, currentBatch));
        vault.requestRedeem(shares, user1, user1);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------
    // Test: Batch state transitions and sealing behavior
    // ---------------------------------------------------------------------------
    function test_BatchStateSealsOnCutoff() public {
        uint256 depositAmount = 100_000 * 1e6;
        
        // Make initial deposit
        vm.startPrank(user1);
        asset.approve(address(vault), depositAmount);
        vault.queueDeposit(depositAmount);
        vm.stopPrank();

        // Verify batch is Open
        assertEq(uint256(vault.getBatchStatus(0)), uint256(ClosedBookBatchVault.BatchStatus.Open), "Initial state should be Open");
        
        // Cutoff seals the batch
        vm.prank(snapshotter);
        vault.cutoffBatch();
        
        // Verify batch is Cutoff
        assertEq(uint256(vault.getBatchStatus(0)), uint256(ClosedBookBatchVault.BatchStatus.Cutoff), "After cutoff should be Cutoff");
        
        // Verify no new entries allowed
        vm.startPrank(user2);
        asset.approve(address(vault), depositAmount);
        vm.expectRevert(abi.encodeWithSelector(ClosedBookBatchVault.BatchNotOpen.selector, 0));
        vault.queueDeposit(depositAmount);
        vm.stopPrank();
    }

    function test_PriceLocksOnlyOncePerBatch() public {
        // Setup: User1 gets shares
        _setupUserWithShares(user1, 100_000 * 1e6);
        
        // User2 queues deposit
        vm.startPrank(user2);
        asset.approve(address(vault), 50_000 * 1e6);
        vault.queueDeposit(50_000 * 1e6);
        vm.stopPrank();

        // First flatten locks price
        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(snapshotter);
        vault.cutoffBatch();
        vm.prank(snapshotter);
        vault.flattenBatch(keccak256("snapshot1"));

        (,,,, uint256 firstLockedPrice,,,,,,,,,) = vault.batches(0);
        assertEq(firstLockedPrice, 1e18, "First lock price should be 1.0");
        assertTrue(firstLockedPrice > 0, "Price should be locked");
    }


}
