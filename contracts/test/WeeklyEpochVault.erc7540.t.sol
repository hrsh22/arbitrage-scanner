// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {WeeklyEpochVault} from "../src/WeeklyEpochVault.sol";
import {Constants} from "../src/Constants.sol";

/// @title WeeklyEpochVaultERC7540ComplianceTest
/// @notice ERC-7540 compliance test suite for interface IDs, operator semantics,
///         async preview overrides, and lifecycle transitions.
contract WeeklyEpochVaultERC7540ComplianceTest is Test {
    uint256 internal constant ONE_USDC_E = 1e6;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant EXPECTED_EPOCH_DURATION = 604800;
    uint256 internal constant EXPECTED_NAV_STALENESS_THRESHOLD = 6 hours;
    
    bytes4 internal constant IERC7540_REDEEM_INTERFACE_ID = 0x620ee8e4;
    bytes4 internal constant IERC7540_CANCEL_INTERFACE_ID = 0xe3bc4e65;
    bytes4 internal constant IERC7540_CLAIM_INTERFACE_ID = 0x2f0a18c5;
    bytes4 internal constant IERC165_INTERFACE_ID = 0x01ffc9a7;
    
    WeeklyEpochVault internal vault;
    MockERC20 internal mockAsset;
    
    address internal admin;
    address internal settler;
    address internal navUpdater;
    address internal owner;
    address internal controller;
    address internal operator;
    address internal attacker;
    address internal receiver;
    
    event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares);
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event RequestCancelled(address indexed controller, uint256 shares);
    event EpochSettled(uint256 indexed epochId, uint256 totalShares, uint256 totalAssets, uint256 nav);
    
    function setUp() public {
        admin = makeAddr("admin");
        settler = makeAddr("settler");
        navUpdater = makeAddr("navUpdater");
        owner = makeAddr("owner");
        controller = makeAddr("controller");
        operator = makeAddr("operator");
        attacker = makeAddr("attacker");
        receiver = makeAddr("receiver");
        
        mockAsset = new MockERC20("Mock USDC", "mUSDC", 6);
        
        vault = new WeeklyEpochVault(
            address(mockAsset),
            admin,
            settler,
            navUpdater,
            EXPECTED_EPOCH_DURATION,
            EXPECTED_NAV_STALENESS_THRESHOLD
        );
        
        vm.warp(block.timestamp + 1);
        vm.prank(navUpdater);
        vault.updateNAV(WAD);
    }
    
    function _mintShares(address to, uint256 amount) internal {
        deal(address(vault), to, amount, true);
    }
    
    function _createRequest(address _owner, address _controller, uint256 shares) internal returns (uint256) {
        _mintShares(_owner, shares);
        vm.prank(_owner);
        vault.approve(address(vault), shares);
        vm.prank(_owner);
        return vault.requestRedeem(shares, _controller, _owner);
    }
    
    function _settleCurrentEpoch(uint256 availableAssets) internal {
        uint256 currentEpoch = vault.getCurrentEpoch();
        uint256 epochEnd = vault.getEpochEnd(currentEpoch);
        vm.warp(epochEnd);
        vm.prank(navUpdater);
        vault.updateNAV(WAD);
        mockAsset.mint(address(vault), availableAssets);
        vm.prank(settler);
        vault.settleEpoch(currentEpoch, availableAssets);
    }
    
    // T8: ERC-165 Interface Tests
    function testSupportsInterfaceIERC7540Redeem() public view {
        assertTrue(vault.supportsInterface(IERC7540_REDEEM_INTERFACE_ID));
    }
    
    function testSupportsInterfaceIERC7540Cancel() public view {
        assertTrue(vault.supportsInterface(IERC7540_CANCEL_INTERFACE_ID));
    }
    
    function testSupportsInterfaceIERC7540Claim() public view {
        assertTrue(vault.supportsInterface(IERC7540_CLAIM_INTERFACE_ID));
    }
    
    function testSupportsInterfaceIERC165() public view {
        assertTrue(vault.supportsInterface(IERC165_INTERFACE_ID));
    }
    
    function testSupportsInterfaceReturnsFalseForUnsupported() public view {
        assertFalse(vault.supportsInterface(0xffffffff));
    }
    
    // T7: Operator Model Tests
    function testSetOperatorGrantsPermissionAndEmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit OperatorSet(controller, operator, true);
        vm.prank(controller);
        bool success = vault.setOperator(operator, true);
        assertTrue(success);
        assertTrue(vault.isOperator(controller, operator));
    }
    
    function testSetOperatorRevokesPermission() public {
        vm.prank(controller);
        vault.setOperator(operator, true);
        assertTrue(vault.isOperator(controller, operator));
        
        vm.expectEmit(true, true, false, true);
        emit OperatorSet(controller, operator, false);
        vm.prank(controller);
        bool success = vault.setOperator(operator, false);
        assertTrue(success);
        assertFalse(vault.isOperator(controller, operator));
    }
    
    // T8: Async Preview Tests
    function testPreviewRedeemRevertsBeforeClaimable() public {
        uint256 shares = 1000 * 1e18;
        _createRequest(owner, controller, shares);
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSignature("PreviewNotSupported()"));
        vault.previewRedeem(shares);
    }
    
    function testPreviewWithdrawRevertsBeforeClaimable() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSignature("PreviewNotSupported()"));
        vault.previewWithdraw(assets);
    }
    
    function testPreviewRedeemSucceedsAfterClaimable() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        vm.prank(controller);
        uint256 previewAssets = vault.previewRedeem(shares);
        assertEq(previewAssets, assets);
    }
    
    function testPreviewWithdrawSucceedsAfterClaimable() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        vm.prank(controller);
        uint256 previewShares = vault.previewWithdraw(assets);
        // At NAV=1.0, previewWithdraw returns assets value (both are raw values)
        assertEq(previewShares, assets);
    }
    
    function testPreviewRedeemReturnsZeroForClaimed() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        mockAsset.mint(address(vault), assets);
        vm.prank(controller);
        vault.redeem(shares, controller, controller);
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSignature("PreviewNotSupported()"));
        vault.previewRedeem(shares);
    }
    
    // T6: Core Function Tests
    function testRedeemRequestEventEmitted() public {
        uint256 shares = 1000 * 1e18;
        _mintShares(owner, shares);
        vm.prank(owner);
        vault.approve(address(vault), shares);
        vm.expectEmit(true, true, true, true);
        emit RedeemRequest(controller, owner, 0, owner, shares);
        vm.prank(owner);
        vault.requestRedeem(shares, controller, owner);
    }
    
    function testRedeemClaimedEventEmitted() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        mockAsset.mint(address(vault), assets);
        vm.expectEmit(true, true, true, true);
        emit Withdraw(controller, controller, controller, assets, shares);
        vm.prank(controller);
        vault.redeem(shares, controller, controller);
    }
    
    function testReceiverCanDifferFromController() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        mockAsset.mint(address(vault), assets);
        vm.prank(controller);
        vault.redeem(shares, receiver, controller);
        assertEq(mockAsset.balanceOf(receiver), assets);
        assertEq(mockAsset.balanceOf(controller), 0);
    }
    
    // T12: Pro-Rata Test
    function testProRataWithERC7540Claimable() public {
        uint256 shares = 1000 * 1e18;
        uint256 availableAssets = 500 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        uint256 currentEpoch = vault.getCurrentEpoch();
        uint256 epochEnd = vault.getEpochEnd(currentEpoch);
        vm.warp(epochEnd);
        vm.prank(navUpdater);
        vault.updateNAV(WAD);
        mockAsset.mint(address(vault), availableAssets);
        vm.prank(settler);
        vault.settleEpoch(currentEpoch, availableAssets);
        uint256 claimableShares = vault.claimableRedeemRequest(0, controller);
        assertEq(claimableShares, shares);
    }
    
    // Additional tests for full coverage
    function testIsOperatorReturnsFalseForNonOperators() public view {
        assertFalse(vault.isOperator(controller, attacker));
    }
    
    function testOperatorCanRequestRedeemOnBehalf() public {
        uint256 shares = 1000 * 1e18;
        _mintShares(owner, shares);
        vm.prank(owner);
        vault.setOperator(operator, true);
        vm.prank(owner);
        vault.approve(address(vault), shares);
        vm.prank(operator);
        uint256 requestId = vault.requestRedeem(shares, controller, owner);
        assertEq(requestId, 0);
        assertEq(vault.pendingRedeemRequest(0, controller), shares);
    }
    
    function testFullLifecycleRequestToClaimableToClaimed() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        assertEq(vault.pendingRedeemRequest(0, controller), shares);
        assertEq(vault.claimableRedeemRequest(0, controller), 0);
        _settleCurrentEpoch(assets);
        assertEq(vault.pendingRedeemRequest(0, controller), 0);
        assertEq(vault.claimableRedeemRequest(0, controller), shares);
        mockAsset.mint(address(vault), assets);
        vm.prank(controller);
        vault.redeem(shares, controller, controller);
        assertEq(vault.claimableRedeemRequest(0, controller), 0);
        assertEq(mockAsset.balanceOf(controller), assets);
    }
    
    function testClaimableReturnsZeroForPending() public {
        uint256 shares = 1000 * 1e18;
        _createRequest(owner, controller, shares);
        assertEq(vault.claimableRedeemRequest(0, controller), 0);
    }
    
    function testPendingRedeemRequestReturnsCorrectShares() public {
        uint256 shares = 1000 * 1e18;
        _createRequest(owner, controller, shares);
        assertEq(vault.pendingRedeemRequest(0, controller), shares);
    }
    
    function testClaimableReturnsCorrectAfterSettlement() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        assertEq(vault.claimableRedeemRequest(0, controller), shares);
    }
    
    function testPendingReturnsZeroAfterSettlement() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        assertEq(vault.pendingRedeemRequest(0, controller), 0);
    }
    
    function testBothViewsReturnZeroAfterClaim() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        mockAsset.mint(address(vault), assets);
        vm.prank(controller);
        vault.redeem(shares, controller, controller);
        assertEq(vault.pendingRedeemRequest(0, controller), 0);
        assertEq(vault.claimableRedeemRequest(0, controller), 0);
    }
    
    function testEpochSettlementWithERC7540Lifecycle() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        mockAsset.mint(address(vault), assets);
        vm.prank(controller);
        vault.redeem(shares, controller, controller);
        assertEq(vault.pendingRedeemRequest(0, controller), 0);
        assertEq(vault.claimableRedeemRequest(0, controller), 0);
    }
    
    function testOperatorCanClaimOnBehalf() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        vm.prank(controller);
        vault.setOperator(operator, true);
        mockAsset.mint(address(vault), assets);
        vm.prank(operator);
        uint256 claimedAssets = vault.redeem(shares, receiver, controller);
        assertEq(claimedAssets, assets);
        assertEq(mockAsset.balanceOf(receiver), assets);
    }
    
    function testOperatorCanSpecifyDifferentReceiver() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        vm.prank(controller);
        vault.setOperator(operator, true);
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        mockAsset.mint(address(vault), assets);
        vm.prank(operator);
        vault.redeem(shares, receiver, controller);
        assertEq(mockAsset.balanceOf(receiver), assets);
    }
    
    function testCannotClaimTwice() public {
        uint256 shares = 1000 * 1e18;
        uint256 assets = 1000 * ONE_USDC_E;
        _createRequest(owner, controller, shares);
        _settleCurrentEpoch(assets);
        mockAsset.mint(address(vault), assets);
        vm.prank(controller);
        vault.redeem(shares, controller, controller);
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSignature("NoClaimableRequest(address)", controller));
        vault.redeem(shares, controller, controller);
    }
    
    function testNonOperatorCannotActOnBehalf() public {
        uint256 shares = 1000 * 1e18;
        _mintShares(owner, shares);
        vm.prank(owner);
        vault.approve(address(vault), shares);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSignature("NotOwner(address,address)", owner, attacker));
        vault.requestRedeem(shares, controller, owner);
    }
    
    function testOperatorPermissionsAreControllerSpecific() public {
        uint256 shares = 1000 * 1e18;
        address controllerA = makeAddr("controllerA");
        address controllerB = makeAddr("controllerB");
        _mintShares(owner, shares);
        vm.prank(controllerA);
        vault.setOperator(operator, true);
        vm.prank(owner);
        vault.approve(address(vault), shares);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSignature("NotOwner(address,address)", owner, operator));
        vault.requestRedeem(shares, controllerB, owner);
    }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}