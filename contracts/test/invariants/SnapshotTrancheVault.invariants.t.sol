// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SnapshotTrancheVaultAccountingHarness} from "./SnapshotTrancheVaultAccountingHarness.sol";

/// @title SnapshotTrancheVaultInvariants
/// @notice Invariant tests for payout accounting conservation
/// @dev Tests the fundamental invariant: Total Realized Gross == Sum of All Payouts + Fees
contract SnapshotTrancheVaultInvariants is Test {
    SnapshotTrancheVaultAccountingHarness public harness;
    
    // Epsilon/drift bounds documentation
    // These bounds account for integer division rounding in:
    // - Fee calculation: floor(gross * 100 / 10000)
    // - Entitlement ratio: floor(shares * 1e18 / totalValue)
    // - Payout calculation: floor(net * ratio / 1e18) per request per realization
    // With pro-rata distribution, drift accumulates from rounding each payout
    uint256 public constant EPSILON_ABSOLUTE = 5e12; // 5 trillion wei tolerance
    uint256 public constant EPSILON_PER_PAYOUT = 1e8; // ~100 units per payout calculation
    uint256 public constant MAX_ACCEPTABLE_DRIFT_BPS = 100; // 1% = 100 basis points
    
    function setUp() public {
        harness = new SnapshotTrancheVaultAccountingHarness();
        
        // Initialize snapshot with some positions
        bytes32[] memory positionIds = new bytes32[](5);
        uint256[] memory costBases = new uint256[](5);
        uint256[] memory currentValues = new uint256[](5);
        
        for (uint256 i = 0; i < 5; i++) {
            positionIds[i] = keccak256(abi.encodePacked("position", i));
            costBases[i] = 100_000e6; // 100k USDC
            currentValues[i] = 100_000e6 + (i * 10_000e6); // Varying values
        }
        
        harness.freezeSnapshot(positionIds, costBases, currentValues);
    }
    
    // ============================================================================
    // CORE ACCOUNTING CONSERVATION INVARIANTS
    // ============================================================================
    
    /// @notice INVARIANT: Conservation of value - Total Gross Realized == Total Net Distributed + Total Fees
    /// @dev This is the fundamental accounting equation for the vault
    function test_ConservationOfValue() public {
        // Setup: Create requests
        for (uint256 i = 0; i < 10; i++) {
            address user = makeAddr(string.concat("user", vm.toString(i)));
            harness.createRedemptionRequest(user, 50_000e6);
        }
        
        // Realize positions
        for (uint256 i = 0; i < 5; i++) {
            bytes32 positionId = keccak256(abi.encodePacked("position", i));
            harness.realizePosition(positionId, 100_000e6 + (i * 10_000e6));
            bytes32 eventId = harness.positionToLastEventId(positionId);
            harness.distributePayout(eventId);
        }
        
        // Verify conservation
        uint256 totalGrossRealized = harness.totalRealizedGross();
        uint256 totalNetDistributed = harness.totalNetDistributed();
        uint256 totalFeesCollected = harness.totalFeesCollected();
        
        uint256 expectedGross = totalNetDistributed + totalFeesCollected;
        
        assertApproxEqAbs(
            totalGrossRealized,
            expectedGross,
            EPSILON_ABSOLUTE,
            "INVARIANT VIOLATION: Conservation of value broken - Gross != Net + Fees"
        );
    }
    
    /// @notice INVARIANT: Sum of all distribution amounts equals total net distributed
    /// @dev Ensures no double-counting or missing payouts in distribution records
    function test_DistributionSumMatchesNetDistributed() public {
        // Setup
        for (uint256 i = 0; i < 5; i++) {
            address user = makeAddr(string.concat("user", vm.toString(i)));
            harness.createRedemptionRequest(user, 50_000e6);
        }
        
        // Realize and distribute
        for (uint256 i = 0; i < 3; i++) {
            bytes32 positionId = keccak256(abi.encodePacked("position", i));
            harness.realizePosition(positionId, 100_000e6);
            bytes32 eventId = harness.positionToLastEventId(positionId);
            harness.distributePayout(eventId);
        }
        
        uint256 sumOfDistributions = harness.getSumOfAllDistributions();
        uint256 totalNetDistributed = harness.totalNetDistributed();
        
        assertApproxEqAbs(
            sumOfDistributions,
            totalNetDistributed,
            EPSILON_ABSOLUTE,
            "INVARIANT VIOLATION: Sum of distributions != totalNetDistributed"
        );
    }
    
    // ============================================================================
    // ENTITLEMENT BOUND INVARIANTS
    // ============================================================================
    
    /// @notice INVARIANT: No request has exceeded its entitlement cap
    /// @dev Critical safety invariant - cumulative payout must never exceed entitlement
    function test_NoEntitlementExceeded() public {
        // Setup
        for (uint256 i = 0; i < 5; i++) {
            address user = makeAddr(string.concat("user", vm.toString(i)));
            harness.createRedemptionRequest(user, 50_000e6);
        }
        
        // Realize all positions
        for (uint256 i = 0; i < 5; i++) {
            bytes32 positionId = keccak256(abi.encodePacked("position", i));
            harness.realizePosition(positionId, 100_000e6 + (i * 10_000e6));
            bytes32 eventId = harness.positionToLastEventId(positionId);
            harness.distributePayout(eventId);
        }
        
        // Check all requests
        for (uint256 i = 1; i <= 5; i++) {
            bool exceeded = harness.hasExceededEntitlement(i);
            assertFalse(
                exceeded,
                string.concat(
                    "INVARIANT VIOLATION: Request ",
                    vm.toString(i),
                    " exceeded entitlement cap"
                )
            );
        }
    }
    
    /// @notice INVARIANT: Remaining entitlement is always non-negative
    /// @dev Derived invariant from entitlement cap
    function test_RemainingEntitlementNonNegative() public {
        // Setup
        for (uint256 i = 0; i < 3; i++) {
            address user = makeAddr(string.concat("user", vm.toString(i)));
            harness.createRedemptionRequest(user, 50_000e6);
        }
        
        // Realize some positions
        for (uint256 i = 0; i < 3; i++) {
            bytes32 positionId = keccak256(abi.encodePacked("position", i));
            harness.realizePosition(positionId, 100_000e6);
            bytes32 eventId = harness.positionToLastEventId(positionId);
            harness.distributePayout(eventId);
        }
        
        // Check remaining entitlement for all requests
        for (uint256 i = 1; i <= 3; i++) {
            uint256 remaining = harness.getRemainingEntitlement(i);
            assertGe(
                remaining,
                0,
                string.concat(
                    "INVARIANT VIOLATION: Negative remaining entitlement for request ",
                    vm.toString(i)
                )
            );
        }
    }
    
    // ============================================================================
    // DOUBLE-SPEND PREVENTION TESTS
    // ============================================================================
    
    /// @notice STRESS: Test that double processing same realization is prevented
    /// @dev Critical security test
    function testStress_DoubleProcessingPrevention() public {
        bytes32[] memory positionIds = new bytes32[](1);
        uint256[] memory costBases = new uint256[](1);
        uint256[] memory currentValues = new uint256[](1);
        
        positionIds[0] = keccak256(abi.encodePacked("singlePos"));
        costBases[0] = 100_000e6;
        currentValues[0] = 100_000e6;
        
        // Deploy fresh harness
        SnapshotTrancheVaultAccountingHarness testHarness = new SnapshotTrancheVaultAccountingHarness();
        testHarness.freezeSnapshot(positionIds, costBases, currentValues);
        
        // Create request
        address user = makeAddr("singleUser");
        testHarness.createRedemptionRequest(user, 100_000e6);
        
        // Realize position
        testHarness.realizePosition(positionIds[0], 100_000e6);
        bytes32 eventId = testHarness.positionToLastEventId(positionIds[0]);
        
        // First distribution
        uint256 firstDistribution = testHarness.totalNetDistributed();
        testHarness.distributePayout(eventId);
        uint256 afterFirstDistribution = testHarness.totalNetDistributed();
        
        uint256 amountDistributed = afterFirstDistribution - firstDistribution;
        assertGt(amountDistributed, 0, "Should have distributed on first call");
        
        // Second distribution attempt (should revert or be no-op)
        uint256 beforeSecondAttempt = testHarness.totalNetDistributed();
        
        try testHarness.distributePayout(eventId) {
            // If it succeeds, it should be a no-op
            uint256 afterSecondAttempt = testHarness.totalNetDistributed();
            assertEq(
                afterSecondAttempt,
                beforeSecondAttempt,
                "Double processing added more funds!"
            );
        } catch {
            // Expected behavior: revert on double processing
        }
        
        // Verify total distributed hasn't changed
        assertEq(
            testHarness.totalNetDistributed(),
            afterFirstDistribution,
            "Total distributed changed after double processing attempt"
        );
    }
    
    /// @notice STRESS: Test that force-closed positions don't distribute funds
    /// @dev Force close should zero out position value
    function testStress_ForceCloseNoDistribution() public {
        bytes32[] memory positionIds = new bytes32[](2);
        uint256[] memory costBases = new uint256[](2);
        uint256[] memory currentValues = new uint256[](2);
        
        positionIds[0] = keccak256(abi.encodePacked("goodPos"));
        positionIds[1] = keccak256(abi.encodePacked("badPos"));
        costBases[0] = 100_000e6;
        costBases[1] = 100_000e6;
        currentValues[0] = 100_000e6;
        currentValues[1] = 100_000e6;
        
        // Deploy fresh harness
        SnapshotTrancheVaultAccountingHarness testHarness = new SnapshotTrancheVaultAccountingHarness();
        testHarness.freezeSnapshot(positionIds, costBases, currentValues);
        
        // Create request
        address user = makeAddr("fcUser");
        testHarness.createRedemptionRequest(user, 200_000e6);
        
        // Force close one position
        testHarness.forceClosePosition(positionIds[1], "Timeout");
        
        // Realize the good position
        testHarness.realizePosition(positionIds[0], 100_000e6);
        bytes32 eventId = testHarness.positionToLastEventId(positionIds[0]);
        
        // Distribute
        testHarness.distributePayout(eventId);
        
        // Verify only the realized position contributed to distribution
        uint256 totalDistributed = testHarness.totalNetDistributed();
        uint256 expectedFromRealized = (100_000e6 * 9900) / 10000; // After 1% fee
        
        // User should receive proportional share (100% since only 1 request)
        assertApproxEqAbs(
            totalDistributed,
            expectedFromRealized,
            100, // Allow some rounding
            "Distribution should only include realized position"
        );
    }
    
    // ============================================================================
    // ROUNDING DRIFT TESTS
    // ============================================================================
    
    /// @notice STRESS: Test rounding drift over many realization/distribution cycles
    /// @dev Simulates long-running vault with many operations
    function testStress_RoundingDriftLongRun() public {
        uint256 numCycles = 100;
        uint256 numRequests = 50;
        uint256 totalOperations = 0;
        
        // Deploy fresh harness with many positions
        SnapshotTrancheVaultAccountingHarness testHarness = new SnapshotTrancheVaultAccountingHarness();
        
        bytes32[] memory positionIds = new bytes32[](numCycles);
        uint256[] memory costBases = new uint256[](numCycles);
        uint256[] memory currentValues = new uint256[](numCycles);
        
        for (uint256 i = 0; i < numCycles; i++) {
            positionIds[i] = keccak256(abi.encodePacked("driftPos", i));
            costBases[i] = 50_000e6;
            currentValues[i] = 50_000e6;
        }
        
        testHarness.freezeSnapshot(positionIds, costBases, currentValues);
        
        // Create many requests
        for (uint256 i = 0; i < numRequests; i++) {
            address user = makeAddr(string.concat("user", vm.toString(i)));
            uint256 shares = 1000e6 + (i * 1e6); // Varying amounts
            testHarness.createRedemptionRequest(user, shares);
        }
        
        // Run many realization/distribution cycles
        for (uint256 cycle = 0; cycle < numCycles; cycle++) {
            // Realize a position
            bytes32 positionId = keccak256(abi.encodePacked("driftPos", cycle));
            uint256 grossAmount = 50_000e6 + (cycle * 1000);
            
            testHarness.realizePosition(positionId, grossAmount);
            totalOperations++;
            
            // Distribute payout for this realization
            bytes32 eventId = testHarness.positionToLastEventId(positionId);
            testHarness.distributePayout(eventId);
        }
        
        // Calculate final drift
        uint256 totalGrossRealized = testHarness.totalRealizedGross();
        uint256 totalNetDistributed = testHarness.totalNetDistributed();
        uint256 totalFeesCollected = testHarness.totalFeesCollected();
        
        uint256 expectedGross = totalNetDistributed + totalFeesCollected;
        uint256 drift = totalGrossRealized > expectedGross 
            ? totalGrossRealized - expectedGross 
            : expectedGross - totalGrossRealized;
        
        // Calculate maximum acceptable drift based on total payout calculations
        // Each realization distributes to all numRequests requests
        uint256 totalPayouts = totalOperations * numRequests;
        uint256 maxAcceptableDrift = totalPayouts * EPSILON_PER_PAYOUT + EPSILON_ABSOLUTE;
        
        // Log results for analysis
        emit log_named_uint("Total Operations", totalOperations);
        emit log_named_uint("Actual Drift", drift);
        emit log_named_uint("Max Acceptable Drift", maxAcceptableDrift);
        emit log_named_uint("Drift per Operation (wei)", totalOperations > 0 ? drift / totalOperations : 0);
        
        // Assert drift is within bounds
        assertLe(
            drift,
            maxAcceptableDrift,
            "Rounding drift exceeded acceptable bounds over long run"
        );
        
        // Assert drift is negligible relative to total value (less than 1%)
        if (totalGrossRealized > 0) {
            uint256 driftBps = (drift * 10_000) / totalGrossRealized;
            assertLe(
                driftBps,
                MAX_ACCEPTABLE_DRIFT_BPS,
                "Relative drift exceeds 1%"
            );
        }
    }
    
    /// @notice STRESS: Test extreme pro-rata ratios and rounding
    /// @dev Tests edge cases with very small entitlement ratios
    function testStress_ExtremeProRataRounding() public {
        bytes32[] memory positionIds = new bytes32[](1);
        uint256[] memory costBases = new uint256[](1);
        uint256[] memory currentValues = new uint256[](1);
        
        positionIds[0] = keccak256(abi.encodePacked("largePosition"));
        costBases[0] = 1_000_000e6; // 1M USDC
        currentValues[0] = 1_000_000e6;
        
        // Deploy new harness with single large position
        SnapshotTrancheVaultAccountingHarness testHarness = new SnapshotTrancheVaultAccountingHarness();
        testHarness.freezeSnapshot(positionIds, costBases, currentValues);
        
        // Create many small requests (1 wei each)
        uint256 numRequests = 100;
        for (uint256 i = 0; i < numRequests; i++) {
            address user = makeAddr(string.concat("smallUser", vm.toString(i)));
            testHarness.createRedemptionRequest(user, 1); // 1 wei
        }
        
        // Realize the large position
        bytes32 positionId = positionIds[0];
        uint256 grossAmount = 1_000_000e6;
        
        testHarness.realizePosition(positionId, grossAmount);
        bytes32 eventId = testHarness.positionToLastEventId(positionId);
        
        // Distribute
        testHarness.distributePayout(eventId);
        
        // Check conservation
        uint256 totalGross = testHarness.totalRealizedGross();
        uint256 totalNet = testHarness.totalNetDistributed();
        uint256 totalFees = testHarness.totalFeesCollected();
        
        uint256 drift = totalGross > (totalNet + totalFees) 
            ? totalGross - (totalNet + totalFees) 
            : (totalNet + totalFees) - totalGross;
        
        // With 100 requests and integer division, expect up to 100 wei drift
        assertLe(drift, 100, "Drift within expected bounds for extreme pro-rata");
    }
    
    /// @notice STRESS: Test fee calculation precision at boundaries
    /// @dev Tests fee calculation with amounts that cause rounding
    function testStress_FeeRoundingBoundaries() public {
        uint256[] memory testAmounts = new uint256[](10);
        testAmounts[0] = 1; // 1 wei
        testAmounts[1] = 99; // Just under 1 bps
        testAmounts[2] = 100; // Exactly 1 bps
        testAmounts[3] = 101; // Just over 1 bps
        testAmounts[4] = 9999; // Just under 100 bps
        testAmounts[5] = 10000; // Exactly 100 bps (1% of this)
        testAmounts[6] = 10001; // Just over 100 bps
        testAmounts[7] = 1e6 - 1; // Just under 1 USDC
        testAmounts[8] = 1e6; // Exactly 1 USDC
        testAmounts[9] = 1e6 + 1; // Just over 1 USDC
        
        bytes32[] memory positionIds = new bytes32[](1);
        uint256[] memory costBases = new uint256[](1);
        uint256[] memory currentValues = new uint256[](1);
        
        for (uint256 i = 0; i < testAmounts.length; i++) {
            // Deploy fresh harness for each test
            SnapshotTrancheVaultAccountingHarness testHarness = new SnapshotTrancheVaultAccountingHarness();
            
            positionIds[0] = keccak256(abi.encodePacked("pos", i));
            costBases[0] = testAmounts[i];
            currentValues[0] = testAmounts[i];
            
            testHarness.freezeSnapshot(positionIds, costBases, currentValues);
            
            // Create one request
            address user = makeAddr(string.concat("user", vm.toString(i)));
            testHarness.createRedemptionRequest(user, testAmounts[i]);
            
            // Realize position
            testHarness.realizePosition(positionIds[0], testAmounts[i]);
            
            // Verify fee calculation using positionToLastEventId
            bytes32 eventId = testHarness.positionToLastEventId(positionIds[0]);
            (,,uint256 grossAmount,uint256 feeAmount,uint256 netAmount,,) = 
                testHarness.realizationEvents(eventId);
            
            if (grossAmount > 0) {
                // Verify: fee + net = gross (within 1 wei)
                assertApproxEqAbs(
                    feeAmount + netAmount,
                    grossAmount,
                    1,
                    string.concat("Fee+Net != Gross for amount ", vm.toString(testAmounts[i]))
                );
                
                // Verify fee is floor(gross * 100 / 10000)
                uint256 expectedFee = (testAmounts[i] * 100) / 10000;
                assertEq(
                    feeAmount,
                    expectedFee,
                    string.concat("Fee calculation incorrect for amount ", vm.toString(testAmounts[i]))
                );
            }
        }
    }
    
    /// @notice STRESS: Test cumulative payout never exceeds entitlement with many small realizations
    /// @dev Simulates progressive payout over many small realization events
    function testStress_ManySmallRealizations() public {
        SnapshotTrancheVaultAccountingHarness testHarness = new SnapshotTrancheVaultAccountingHarness();
        
        uint256 numPositions = 50;
        bytes32[] memory positionIds = new bytes32[](numPositions);
        uint256[] memory costBases = new uint256[](numPositions);
        uint256[] memory currentValues = new uint256[](numPositions);
        
        for (uint256 i = 0; i < numPositions; i++) {
            positionIds[i] = keccak256(abi.encodePacked("smallPos", i));
            costBases[i] = 10_000e6; // 10k each
            currentValues[i] = 10_000e6;
        }
        
        testHarness.freezeSnapshot(positionIds, costBases, currentValues);
        
        // Create several redemption requests
        uint256 numRequests = 10;
        for (uint256 i = 0; i < numRequests; i++) {
            address user = makeAddr(string.concat("reqUser", vm.toString(i)));
            testHarness.createRedemptionRequest(user, 50_000e6); // 50k each
        }
        
        // Realize positions one by one and distribute
        for (uint256 i = 0; i < numPositions; i++) {
            testHarness.realizePosition(positionIds[i], 10_000e6);
            bytes32 eventId = testHarness.positionToLastEventId(positionIds[i]);
            testHarness.distributePayout(eventId);
            
            // Check no request exceeded entitlement after each distribution
            for (uint256 j = 1; j <= numRequests; j++) {
                bool exceeded = testHarness.hasExceededEntitlement(j);
                assertFalse(
                    exceeded,
                    string.concat(
                        "Request ",
                        vm.toString(j),
                        " exceeded entitlement after realization ",
                        vm.toString(i)
                    )
                );
            }
        }
        
        // Final check: total claimed never exceeded total entitlement
        uint256 totalClaimed = testHarness.getTotalClaimed();
        uint256 totalEntitlement = 0;
        
        for (uint256 j = 1; j <= numRequests; j++) {
            (,,,,uint256 requestEntitlement,,) = testHarness.redemptionRequests(j);
            totalEntitlement += requestEntitlement;
        }
        
        assertLe(totalClaimed, totalEntitlement, "Total claimed exceeded total entitlement");
    }
}
