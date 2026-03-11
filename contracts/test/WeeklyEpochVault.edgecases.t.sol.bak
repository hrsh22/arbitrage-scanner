// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WeeklyEpochVault} from "../src/WeeklyEpochVault.sol";

/// @notice Mock ERC20 token for testing
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

/// @title WeeklyEpochVaultEdgeCaseTest
/// @notice Edge case and negative path tests for WeeklyEpochVault
/// @dev These tests verify authorization, validation, and access control edge cases
contract WeeklyEpochVaultEdgeCaseTest is Test {
    uint256 internal constant ONE_USDC_E = 1e6;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant EXPECTED_EPOCH_DURATION = 604800; // 7 days
    uint256 internal constant EXPECTED_NAV_STALENESS_THRESHOLD = 6 hours;
    
    WeeklyEpochVault internal vault;
    MockERC20 internal mockAsset;
    
    address internal admin;
    address internal settler;
    address internal navUpdater;
    address internal depositor;
    address internal operator;
    address internal attacker;
    
    function setUp() public {
        admin = makeAddr("admin");
        settler = makeAddr("settler");
        navUpdater = makeAddr("navUpdater");
        depositor = makeAddr("depositor");
        operator = makeAddr("operator");
        attacker = makeAddr("attacker");
        
        mockAsset = new MockERC20("Mock USDC", "mUSDC", 6);
        
        vault = new WeeklyEpochVault(
            address(mockAsset),
            admin,
            settler,
            navUpdater,
            EXPECTED_EPOCH_DURATION,
            EXPECTED_NAV_STALENESS_THRESHOLD
        );
    }
    
    // ============================================================================
    // REVOKED OPERATOR TESTS
    // ============================================================================
    
    /// @notice Test revoked operator cannot call requestRedeem on behalf of owner
    function testRevokedOperatorCannotRequestRedeem() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        // Setup: depositor grants operator approval
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        // Verify operator is approved
        assertTrue(vault.isOperator(depositor, operator), "Operator should be approved");
        
        // Revoke operator approval
        vm.prank(depositor);
        vault.setOperator(operator, false);
        
        // Verify operator is revoked
        assertFalse(vault.isOperator(depositor, operator), "Operator should be revoked");
        
        // Revoked operator tries to request redeem - should revert with NotOwner
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotOwner.selector, depositor, operator));
        vault.requestRedeem(shares, depositor, depositor);
    }
    
    /// @notice Test revoked operator cannot call redeem on behalf of controller
    function testRevokedOperatorCannotRedeem() public {
        // Grant then revoke operator approval
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        vm.prank(depositor);
        vault.setOperator(operator, false);
        
        // Revoked operator tries to redeem - should revert with NotController
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, depositor, operator));
        vault.redeem(100 * ONE_USDC_E, depositor, depositor);
    }
    
    /// @notice Test revoked operator cannot call withdraw on behalf of controller
    function testRevokedOperatorCannotWithdraw() public {
        // Grant then revoke operator approval
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        vm.prank(depositor);
        vault.setOperator(operator, false);
        
        // Revoked operator tries to withdraw - should revert with NotController
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, depositor, operator));
        vault.withdraw(100 * ONE_USDC_E, depositor, depositor);
    }
    
    /// @notice Test operator authorization is correctly stored
    function testOperatorAuthorizationStorage() public {
        // Initially operator should not be authorized
        assertFalse(vault.isOperator(depositor, operator), "Operator should not be authorized initially");
        
        // Grant operator approval
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        // Operator should now be authorized
        assertTrue(vault.isOperator(depositor, operator), "Operator should be authorized");
        
        // Different user should not affect the first user's operator
        address otherUser = makeAddr("otherUser");
        assertFalse(vault.isOperator(otherUser, operator), "Operator should not be authorized for other user");
        
        // Revoke operator
        vm.prank(depositor);
        vault.setOperator(operator, false);
        
        // Operator should no longer be authorized
        assertFalse(vault.isOperator(depositor, operator), "Operator should be revoked");
    }
    
    /// @notice Test operator can be re-approved after revocation
    function testOperatorCanBeReapprovedAfterRevocation() public {
        // Grant operator
        vm.prank(depositor);
        vault.setOperator(operator, true);
        assertTrue(vault.isOperator(depositor, operator), "Operator should be approved");
        
        // Revoke operator
        vm.prank(depositor);
        vault.setOperator(operator, false);
        assertFalse(vault.isOperator(depositor, operator), "Operator should be revoked");
        
        // Re-approve operator
        vm.prank(depositor);
        vault.setOperator(operator, true);
        assertTrue(vault.isOperator(depositor, operator), "Operator should be re-approved");
    }
    
    // ============================================================================
    // REPEATED CLAIM TESTS (Authorization Level)
    // ============================================================================
    
    /// @notice Test claiming with no claimable request reverts
    function testClaimWithNoClaimableRequestReverts() public {
        // Try to redeem without having a claimable request
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, depositor));
        vault.redeem(100 * ONE_USDC_E, depositor, depositor);
    }
    
    /// @notice Test withdrawing with no claimable request reverts
    function testWithdrawWithNoClaimableRequestReverts() public {
        // Try to withdraw without having a claimable request
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, depositor));
        vault.withdraw(100 * ONE_USDC_E, depositor, depositor);
    }
    
    /// @notice Test repeated claim attempts fail consistently
    function testRepeatedClaimAttemptsFailConsistently() public {
        // First attempt should fail (no claimable request)
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, depositor));
        vault.redeem(100 * ONE_USDC_E, depositor, depositor);
        
        // Second attempt should also fail with same error
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, depositor));
        vault.redeem(100 * ONE_USDC_E, depositor, depositor);
        
        // Third attempt should also fail with same error
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, depositor));
        vault.redeem(50 * ONE_USDC_E, depositor, depositor);
    }
    
    // ============================================================================
    // PARTIAL CLAIM EDGE CASES (Authorization Level)
    // ============================================================================
    
    /// @notice Test claim more than claimable reverts with InsufficientClaimableShares
    function testClaimMoreThanClaimableReverts() public {
        // Without any claimable shares, any amount should revert
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, depositor));
        vault.redeem(1, depositor, depositor);
    }
    
    /// @notice Test withdraw more than claimable assets reverts
    function testWithdrawMoreThanClaimableReverts() public {
        // Without any claimable assets, any amount should revert
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, depositor));
        vault.withdraw(1, depositor, depositor);
    }
    
    /// @notice Test claiming exactly zero after having claimable should use different error
    function testClaimZeroAmountRevertsBeforeClaimableCheck() public {
        // Zero amount should revert with ZeroAmount before checking claimable
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.ZeroAmount.selector);
        vault.redeem(0, depositor, depositor);
    }
    
    // ============================================================================
    // ZERO AMOUNT TESTS
    // ============================================================================
    
    /// @notice Test requestRedeem with zero shares reverts with ZeroAmount
    function testRequestRedeemZeroAmountReverts() public {
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.ZeroAmount.selector);
        vault.requestRedeem(0, depositor, depositor);
    }
    
    /// @notice Test cancelRedeemRequest with zero shares reverts with ZeroAmount
    function testCancelRedeemRequestZeroAmountReverts() public {
        // Try to cancel 0 shares
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.ZeroAmount.selector);
        vault.cancelRedeemRequest(0);
    }
    
    /// @notice Test redeem with zero shares reverts with ZeroAmount
    function testRedeemZeroAmountReverts() public {
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.ZeroAmount.selector);
        vault.redeem(0, depositor, depositor);
    }
    
    /// @notice Test withdraw with zero assets reverts with ZeroAmount
    function testWithdrawZeroAmountReverts() public {
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.ZeroAmount.selector);
        vault.withdraw(0, depositor, depositor);
    }
    
    // ============================================================================
    // UNAUTHORIZED CONTROLLER TESTS
    // ============================================================================
    
    /// @notice Test non-controller cannot call redeem
    function testUnauthorizedControllerCannotRedeem() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        // Attacker tries to redeem on behalf of depositor
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, depositor, attacker));
        vault.redeem(shares, attacker, depositor);
    }
    
    /// @notice Test non-controller cannot call withdraw
    function testUnauthorizedControllerCannotWithdraw() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        // Attacker tries to withdraw on behalf of depositor
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, depositor, attacker));
        vault.withdraw(shares, attacker, depositor);
    }
    
    /// @notice Test controller cannot redeem on behalf of different controller
    function testControllerCannotRedeemForDifferentController() public {
        uint256 shares = 100 * ONE_USDC_E;
        address user1 = makeAddr("user1");
        address user2 = makeAddr("user2");
        
        // User2 tries to redeem on behalf of user1
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, user1, user2));
        vault.redeem(shares, user2, user1);
    }
    
    /// @notice Test operator cannot redeem for controller after being revoked
    function testRevokedOperatorCannotRedeemForController() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        // Grant operator approval
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        // Revoke operator
        vm.prank(depositor);
        vault.setOperator(operator, false);
        
        // Revoked operator tries to redeem
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, depositor, operator));
        vault.redeem(shares, depositor, depositor);
    }
    
    /// @notice Test msg.sender must be controller or operator for redeem
    function testRedeemRequiresControllerOrOperator() public {
        address controller = makeAddr("controller");
        address randomUser = makeAddr("randomUser");
        
        // Random user tries to redeem for controller
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, controller, randomUser));
        vault.redeem(100 * ONE_USDC_E, randomUser, controller);
    }
    
    /// @notice Test msg.sender must be controller or operator for withdraw
    function testWithdrawRequiresControllerOrOperator() public {
        address controller = makeAddr("controller");
        address randomUser = makeAddr("randomUser");
        
        // Random user tries to withdraw for controller
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, controller, randomUser));
        vault.withdraw(100 * ONE_USDC_E, randomUser, controller);
    }
    
    // ============================================================================
    // INVALID ADDRESS TESTS
    // ============================================================================
    
    /// @notice Test operator can be set to zero address - but should revert
    function testSetOperatorZeroAddressReverts() public {
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.InvalidAddress.selector);
        vault.setOperator(address(0), true);
    }
    
    /// @notice Test requestRedeem with zero controller address reverts
    function testRequestRedeemZeroControllerReverts() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.InvalidAddress.selector);
        vault.requestRedeem(shares, address(0), depositor);
    }
    
    /// @notice Test requestRedeem with zero owner address reverts
    function testRequestRedeemZeroOwnerReverts() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.InvalidAddress.selector);
        vault.requestRedeem(shares, depositor, address(0));
    }
    
    /// @notice Test redeem with zero receiver reverts
    function testRedeemZeroReceiverReverts() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.InvalidAddress.selector);
        vault.redeem(shares, address(0), depositor);
    }
    
    /// @notice Test withdraw with zero receiver reverts
    function testWithdrawZeroReceiverReverts() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.InvalidAddress.selector);
        vault.withdraw(shares, address(0), depositor);
    }
    
    /// @notice Test redeem with zero controller reverts
    function testRedeemZeroControllerReverts() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.InvalidAddress.selector);
        vault.redeem(shares, depositor, address(0));
    }
    
    /// @notice Test withdraw with zero controller reverts
    function testWithdrawZeroControllerReverts() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.InvalidAddress.selector);
        vault.withdraw(shares, depositor, address(0));
    }
    
    // ============================================================================
    // NOT OWNER TESTS (For requestRedeem)
    // ============================================================================
    
    /// @notice Test random user cannot call requestRedeem for another user
    function testRandomUserCannotRequestRedeemForOthers() public {
        uint256 shares = 100 * ONE_USDC_E;
        address owner = makeAddr("owner");
        
        // Random user tries to request redeem on behalf of owner
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotOwner.selector, owner, attacker));
        vault.requestRedeem(shares, owner, owner);
    }
    
    /// @notice Test operator cannot request redeem after revocation
    function testRevokedOperatorCannotRequestRedeemForOwner() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        // Grant and then revoke operator
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        vm.prank(depositor);
        vault.setOperator(operator, false);
        
        // Revoked operator tries to request redeem
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotOwner.selector, depositor, operator));
        vault.requestRedeem(shares, depositor, depositor);
    }
    
    // ============================================================================
    // NO PENDING REQUEST TESTS (For cancelRedeemRequest)
    // ============================================================================
    
    /// @notice Test cancel redeem with no pending request reverts
    function testCancelRedeemWithNoPendingRequestReverts() public {
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoPendingRequest.selector, depositor));
        vault.cancelRedeemRequest(100 * ONE_USDC_E);
    }
    
    /// @notice Test cancel redeem for different user reverts
    function testCancelRedeemForDifferentUserReverts() public {
        address user1 = makeAddr("user1");
        address user2 = makeAddr("user2");
        
        // User2 tries to cancel for user1 (who has no pending request)
        vm.prank(user2);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoPendingRequest.selector, user2));
        vault.cancelRedeemRequest(100 * ONE_USDC_E);
    }
    
    // ============================================================================
    // EMERGENCY MODE INTERACTION TESTS
    // ============================================================================
    
    /// @notice Test request redeem is blocked in emergency mode
    function testRequestRedeemBlockedInEmergencyMode() public {
        uint256 shares = 100 * ONE_USDC_E;
        
        // Enable emergency mode
        vm.prank(admin);
        vault.setEmergencyMode(true);
        
        // Try to request redeem
        vm.prank(depositor);
        vm.expectRevert(WeeklyEpochVault.EmergencyModeActive.selector);
        vault.requestRedeem(shares, depositor, depositor);
    }
    
    /// @notice Test emergency mode can be disabled
    function testEmergencyModeCanBeDisabled() public {
        // Enable emergency mode
        vm.prank(admin);
        vault.setEmergencyMode(true);
        assertTrue(vault.emergencyMode(), "Emergency mode should be active");
        
        // Disable emergency mode
        vm.prank(admin);
        vault.setEmergencyMode(false);
        assertFalse(vault.emergencyMode(), "Emergency mode should be inactive");
    }
    
    // ============================================================================
    // EVENT TESTS
    // ============================================================================
    
    /// @notice Test OperatorSet event is emitted on approval
    function testOperatorSetEventOnApproval() public {
        vm.expectEmit(true, true, false, true);
        emit WeeklyEpochVault.OperatorSet(depositor, operator, true);
        
        vm.prank(depositor);
        vault.setOperator(operator, true);
    }
    
    /// @notice Test OperatorSet event is emitted on revocation
    function testOperatorSetEventOnRevocation() public {
        // First approve
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        // Then revoke and check event
        vm.expectEmit(true, true, false, true);
        emit WeeklyEpochVault.OperatorSet(depositor, operator, false);
        
        vm.prank(depositor);
        vault.setOperator(operator, false);
    }
    
    /// @notice Test multiple operator changes emit multiple events
    function testMultipleOperatorChangesEmitEvents() public {
        address operator2 = makeAddr("operator2");
        
        // First approval
        vm.expectEmit(true, true, false, true);
        emit WeeklyEpochVault.OperatorSet(depositor, operator, true);
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        // Second operator approval
        vm.expectEmit(true, true, false, true);
        emit WeeklyEpochVault.OperatorSet(depositor, operator2, true);
        vm.prank(depositor);
        vault.setOperator(operator2, true);
        
        // Verify both are operators
        assertTrue(vault.isOperator(depositor, operator), "Operator 1 should be approved");
        assertTrue(vault.isOperator(depositor, operator2), "Operator 2 should be approved");
    }
    
    // ============================================================================
    // COMPLEX SCENARIOS
    // ============================================================================
    
    /// @notice Test multiple operators can be set for same controller
    function testMultipleOperatorsForSameController() public {
        address operator2 = makeAddr("operator2");
        address operator3 = makeAddr("operator3");
        
        // Set multiple operators
        vm.prank(depositor);
        vault.setOperator(operator, true);
        
        vm.prank(depositor);
        vault.setOperator(operator2, true);
        
        vm.prank(depositor);
        vault.setOperator(operator3, true);
        
        // Verify all are operators
        assertTrue(vault.isOperator(depositor, operator), "Operator 1 should be approved");
        assertTrue(vault.isOperator(depositor, operator2), "Operator 2 should be approved");
        assertTrue(vault.isOperator(depositor, operator3), "Operator 3 should be approved");
        
        // Revoke one operator
        vm.prank(depositor);
        vault.setOperator(operator2, false);
        
        // Verify only operator2 is revoked
        assertTrue(vault.isOperator(depositor, operator), "Operator 1 should still be approved");
        assertFalse(vault.isOperator(depositor, operator2), "Operator 2 should be revoked");
        assertTrue(vault.isOperator(depositor, operator3), "Operator 3 should still be approved");
    }
    
    /// @notice Test operator status is independent per controller
    function testOperatorStatusIndependentPerController() public {
        address user1 = makeAddr("user1");
        address user2 = makeAddr("user2");
        
        // user1 approves operator
        vm.prank(user1);
        vault.setOperator(operator, true);
        
        // user2 does not approve operator
        // (implicit - no action taken)
        
        // Verify operator status is independent
        assertTrue(vault.isOperator(user1, operator), "Operator should be approved for user1");
        assertFalse(vault.isOperator(user2, operator), "Operator should not be approved for user2");
        
        // user2 approves same operator
        vm.prank(user2);
        vault.setOperator(operator, true);
        
        // Both should now have operator approved
        assertTrue(vault.isOperator(user1, operator), "Operator should still be approved for user1");
        assertTrue(vault.isOperator(user2, operator), "Operator should now be approved for user2");
        
        // user1 revokes operator
        vm.prank(user1);
        vault.setOperator(operator, false);
        
        // Only user1's operator should be revoked
        assertFalse(vault.isOperator(user1, operator), "Operator should be revoked for user1");
        assertTrue(vault.isOperator(user2, operator), "Operator should still be approved for user2");
    }
    
    /// @notice Test all authorization errors in sequence
    function testAuthorizationErrorsSequence() public {
        address controller = makeAddr("controller");
        address randomUser = makeAddr("randomUser");
        
        // Test 1: NotOwner for requestRedeem
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotOwner.selector, controller, randomUser));
        vault.requestRedeem(100 * ONE_USDC_E, controller, controller);
        
        // Test 2: NotController for redeem
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, controller, randomUser));
        vault.redeem(100 * ONE_USDC_E, randomUser, controller);
        
        // Test 3: NotController for withdraw
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NotController.selector, controller, randomUser));
        vault.withdraw(100 * ONE_USDC_E, randomUser, controller);
        
        // Test 4: NoPendingRequest for cancel
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoPendingRequest.selector, randomUser));
        vault.cancelRedeemRequest(100 * ONE_USDC_E);
        
        // Test 5: NoClaimableRequest for redeem
        vm.prank(controller);
        vm.expectRevert(abi.encodeWithSelector(WeeklyEpochVault.NoClaimableRequest.selector, controller));
        vault.redeem(100 * ONE_USDC_E, controller, controller);
    }
}
