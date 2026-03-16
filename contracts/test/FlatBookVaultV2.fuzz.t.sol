// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FlatBookVaultV2} from "../src/FlatBookVaultV2.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockTokenFuzz is ERC20 {
    uint8 private immutable tokenDecimals;

    constructor() ERC20("USD Coin", "USDC") {
        tokenDecimals = 6;
        _mint(msg.sender, 1_000_000_000 * 1e6);
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }
}

contract FlatBookVaultV2FuzzTest is Test {
    FlatBookVaultV2 internal vault;
    MockTokenFuzz internal asset;

    address internal admin = makeAddr("admin");
    address internal bookRunner = makeAddr("bookRunner");
    address internal navUpdater = makeAddr("navUpdater");
    address internal tradingWallet = makeAddr("tradingWallet");
    address internal owner = makeAddr("owner");
    address internal controller = makeAddr("controller");
    address internal attacker = makeAddr("attacker");
    address internal operator = makeAddr("operator");
    address internal carol = makeAddr("carol");

    function setUp() public {
        vm.startPrank(admin);
        asset = new MockTokenFuzz();
        vault = new FlatBookVaultV2(address(asset), admin, bookRunner, navUpdater, tradingWallet, 10 minutes);
        asset.transfer(owner, 3_000_000 * 1e6);
        asset.transfer(controller, 3_000_000 * 1e6);
        asset.transfer(carol, 3_000_000 * 1e6);
        vm.stopPrank();

        vm.startPrank(owner);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(500_000 * 1e6, owner);
        vault.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(controller);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(500_000 * 1e6, controller);
        vault.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(carol);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(500_000 * 1e6, carol);
        vault.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();
    }

    function testFuzzUnauthorizedRequestRedeemReverts(uint96 rawShares) public {
        uint256 shares = bound(uint256(rawShares), 1e6, 200_000 * 1e6);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(FlatBookVaultV2.NotOwner.selector, owner, attacker));
        vault.requestRedeem(shares, controller, owner);
    }

    function testFuzzOperatorRequestRedeemSucceeds(uint96 rawShares) public {
        uint256 shares = bound(uint256(rawShares), 1e6, 200_000 * 1e6);

        vm.prank(owner);
        vault.setOperator(operator, true);

        vm.prank(operator);
        vault.requestRedeem(shares, owner, owner);

        assertEq(vault.pendingRedeemRequest(0, owner), shares);
    }

    function testFuzzUnauthorizedClaimDepositReverts(uint96 rawAssets) public {
        uint256 assets = bound(uint256(rawAssets), 1e6, 100_000 * 1e6);

        vm.prank(controller);
        vault.requestDeposit(assets, controller, controller);

        vm.prank(navUpdater);
        vault.updateNAV(1e18);
        vm.prank(bookRunner);
        vault.beginProcessing();
        vm.prank(bookRunner);
        vault.processDeposits(100);
        vm.prank(bookRunner);
        vault.processRedeems(100);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(FlatBookVaultV2.NotController.selector, controller, attacker));
        vault.deposit(assets, attacker, controller);
    }

    function testFuzzQueueToClaimableConservation(uint96 rawDeposit, uint96 rawRedeem) public {
        uint256 queuedDeposit = bound(uint256(rawDeposit), 1e6, 250_000 * 1e6);
        uint256 queuedRedeem = bound(uint256(rawRedeem), 1e6, 200_000 * 1e6);

        vm.prank(controller);
        vault.requestDeposit(queuedDeposit, controller, controller);

        vm.prank(owner);
        vault.requestRedeem(queuedRedeem, owner, owner);

        assertEq(vault.pendingDepositRequest(0, controller), queuedDeposit);
        assertEq(vault.pendingRedeemRequest(0, owner), queuedRedeem);

        vm.prank(navUpdater);
        vault.updateNAV(15e17);
        vm.prank(bookRunner);
        vault.beginProcessing();

        vm.prank(bookRunner);
        vault.processDeposits(1);
        vm.prank(bookRunner);
        vault.processRedeems(1);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        assertEq(vault.pendingDepositRequest(0, controller), 0);
        assertEq(vault.pendingRedeemRequest(0, owner), 0);
        assertEq(vault.claimableDepositRequest(0, controller), queuedDeposit);
        assertEq(vault.claimableRedeemRequest(0, owner), queuedRedeem);
    }

    function testChunkedProcessingConservesTotals() public {
        uint256 depositA = 30_000 * 1e6;
        uint256 depositB = 50_000 * 1e6;
        uint256 redeemA = 40_000 * 1e6;
        uint256 redeemB = 20_000 * 1e6;

        vm.prank(controller);
        vault.requestDeposit(depositA, controller, controller);
        vm.prank(carol);
        vault.requestDeposit(depositB, carol, carol);

        vm.prank(owner);
        vault.requestRedeem(redeemA, owner, owner);
        vm.prank(controller);
        vault.requestRedeem(redeemB, controller, controller);

        vm.prank(navUpdater);
        vault.updateNAV(125e16); // 1.25

        vm.prank(bookRunner);
        vault.beginProcessing();

        // Chunked processing (1 user at a time)
        vm.prank(bookRunner);
        vault.processRedeems(1);
        vm.prank(bookRunner);
        vault.processDeposits(1);
        vm.prank(bookRunner);
        vault.processRedeems(1);
        vm.prank(bookRunner);
        vault.processDeposits(1);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        assertEq(vault.pendingDepositRequest(0, controller), 0);
        assertEq(vault.pendingDepositRequest(0, carol), 0);
        assertEq(vault.pendingRedeemRequest(0, owner), 0);
        assertEq(vault.pendingRedeemRequest(0, controller), 0);

        assertEq(vault.claimableDepositRequest(0, controller), depositA);
        assertEq(vault.claimableDepositRequest(0, carol), depositB);
        assertEq(vault.claimableRedeemRequest(0, owner), redeemA);
        assertEq(vault.claimableRedeemRequest(0, controller), redeemB);

        uint256 expectedClaimableRedeemAssets = ((redeemA + redeemB) * 125e16) / 1e18;
        assertEq(vault.totalClaimableRedeemAssets(), expectedClaimableRedeemAssets);
    }
}
