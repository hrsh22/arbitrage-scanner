// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FlatBookVaultV2} from "../src/FlatBookVaultV2.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC7540Operator, IERC7540Deposit, IERC7540Redeem} from "../src/interfaces/IERC7540.sol";
import {IERC7575} from "../src/interfaces/IERC7575.sol";

contract MockTokenConformance is ERC20 {
    uint8 private immutable tokenDecimals;

    constructor() ERC20("USD Coin", "USDC") {
        tokenDecimals = 6;
        _mint(msg.sender, 1_000_000_000 * 1e6);
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }
}

contract FlatBookVaultV2ConformanceTest is Test {
    FlatBookVaultV2 internal vault;
    MockTokenConformance internal asset;

    address internal admin = makeAddr("admin");
    address internal bookRunner = makeAddr("bookRunner");
    address internal navUpdater = makeAddr("navUpdater");
    address internal tradingWallet = makeAddr("tradingWallet");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.startPrank(admin);
        asset = new MockTokenConformance();
        vault = new FlatBookVaultV2(address(asset), admin, bookRunner, navUpdater, tradingWallet, 10 minutes);
        asset.transfer(alice, 2_000_000 * 1e6);
        asset.transfer(bob, 2_000_000 * 1e6);
        vm.stopPrank();
    }

    function testInterfacesAreExplicit() public view {
        assertTrue(vault.supportsInterface(type(IERC7540Operator).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Deposit).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Redeem).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7575).interfaceId));
        assertEq(vault.asset(), address(asset));
        assertEq(vault.share(), address(vault));
    }

    function testPendingClaimableSeparationAndPreviewRules() public {
        vm.startPrank(alice);
        asset.approve(address(vault), 200_000 * 1e6);
        vault.deposit(200_000 * 1e6, alice);
        vault.approve(address(vault), 70_000 * 1e6);
        vm.stopPrank();

        vm.prank(bookRunner);
        vault.closeBook();

        vm.startPrank(alice);
        vault.requestRedeem(70_000 * 1e6, alice, alice);
        vm.stopPrank();

        vm.startPrank(bob);
        asset.approve(address(vault), 120_000 * 1e6);
        vault.requestDeposit(120_000 * 1e6, bob, bob);
        vm.stopPrank();

        assertEq(vault.pendingRedeemRequest(0, alice), 70_000 * 1e6);
        assertEq(vault.claimableRedeemRequest(0, alice), 0);
        assertEq(vault.pendingDepositRequest(0, bob), 120_000 * 1e6);
        assertEq(vault.claimableDepositRequest(0, bob), 0);

        vm.expectRevert(FlatBookVaultV2.PreviewNotSupported.selector);
        vault.previewDeposit(1e6);

        vm.prank(navUpdater);
        vault.updateNAV(2e18);
        vm.prank(bookRunner);
        vault.beginProcessing();

        vm.expectRevert(FlatBookVaultV2.PreviewNotSupported.selector);
        vault.previewRedeem(1e6);

        vm.prank(bookRunner);
        vault.processRedeems(100);
        vm.prank(bookRunner);
        vault.processDeposits(100);
        vm.prank(bookRunner);
        vault.finalizeProcessing();

        assertEq(vault.pendingRedeemRequest(0, alice), 0);
        assertEq(vault.claimableRedeemRequest(0, alice), 70_000 * 1e6);
        assertEq(vault.pendingDepositRequest(0, bob), 0);
        assertEq(vault.claimableDepositRequest(0, bob), 0);
        assertEq(vault.balanceOf(bob), 60_000 * 1e6);
    }
}
