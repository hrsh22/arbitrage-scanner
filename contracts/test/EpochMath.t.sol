// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {EpochMath} from "../src/libraries/EpochMath.sol";

/// @title EpochMath Test Wrapper
/// @notice Wrapper contract to test EpochMath library with configurable epoch duration
contract EpochMathWrapper {
    uint256 public immutable epochDuration;
    uint256 public immutable genesisTimestamp;

    constructor(uint256 _epochDuration, uint256 _genesisTimestamp) {
        require(_epochDuration > 0, "EpochMath: zero duration");
        epochDuration = _epochDuration;
        genesisTimestamp = _genesisTimestamp;
    }

    function getCurrentEpoch() external view returns (uint256) {
        return EpochMath.getCurrentEpoch(genesisTimestamp, epochDuration);
    }

    function getCurrentEpochAt(uint256 timestamp) external view returns (uint256) {
        return EpochMath.getCurrentEpochAt(genesisTimestamp, epochDuration, timestamp);
    }

    function getEpochStart(uint256 epoch) external view returns (uint256) {
        return EpochMath.getEpochStart(genesisTimestamp, epochDuration, epoch);
    }

    function getEpochEnd(uint256 epoch) external view returns (uint256) {
        return EpochMath.getEpochEnd(genesisTimestamp, epochDuration, epoch);
    }

    function isEpochBoundary(uint256 timestamp) external view returns (bool) {
        return EpochMath.isEpochBoundary(genesisTimestamp, epochDuration, timestamp);
    }

    function bucketRequest(uint256 requestTimestamp) external view returns (uint256 epoch) {
        return EpochMath.bucketRequest(genesisTimestamp, epochDuration, requestTimestamp);
    }

    function getSecondsUntilEpochEnd(uint256 timestamp) external view returns (uint256) {
        return EpochMath.getSecondsUntilEpochEnd(genesisTimestamp, epochDuration, timestamp);
    }

    function isWithinSettlementWindow(
        uint256 timestamp,
        uint256 settlementStartOffset,
        uint256 settlementEndOffset
    ) external view returns (bool) {
        return EpochMath.isWithinSettlementWindow(
            genesisTimestamp, epochDuration, timestamp, settlementStartOffset, settlementEndOffset
        );
    }

    function getEpochPercentRemaining(uint256 timestamp) external view returns (uint256) {

        return EpochMath.getEpochPercentRemaining(genesisTimestamp, epochDuration, timestamp);

    }



    // New boundary check functions

    function isDepositAllowed(uint256 timestamp, uint256 depositCutoffOffset) external view returns (bool) {

        return EpochMath.isDepositAllowed(genesisTimestamp, epochDuration, timestamp, depositCutoffOffset);

    }



    function isMintOpen(uint256 timestamp, uint256 mintOpenOffset) external view returns (bool) {

        return EpochMath.isMintOpen(genesisTimestamp, epochDuration, timestamp, mintOpenOffset);

    }



    function isRedemptionFrozen(uint256 timestamp, uint256 redemptionFreezeOffset) external view returns (bool) {

        return EpochMath.isRedemptionFrozen(genesisTimestamp, epochDuration, timestamp, redemptionFreezeOffset);

    }



    function isClaimWindowOpen(uint256 settledEpoch, uint256 timestamp, uint256 claimWindowDuration, uint256 settlementTimestamp) external view returns (bool) {

        return EpochMath.isClaimWindowOpen(

            genesisTimestamp, epochDuration, settledEpoch, timestamp, claimWindowDuration, settlementTimestamp

        );

    }



    function getConfigActivationTime(uint256 currentTimestamp, uint256 activationDelayEpochs) external view returns (uint256 effectiveEpoch, uint256 effectiveTimestamp) {

        return EpochMath.getConfigActivationTime(genesisTimestamp, epochDuration, currentTimestamp, activationDelayEpochs);

    }



    function shouldUseOriginalConfig(uint256 requestQueueEpoch, uint256 configEffectiveEpoch) external view returns (bool) {

        return EpochMath.shouldUseOriginalConfig(genesisTimestamp, epochDuration, requestQueueEpoch, configEffectiveEpoch);

    }



    function getDepositCutoffTime(uint256 epoch, uint256 depositCutoffOffset) external view returns (uint256) {

        return EpochMath.getDepositCutoffTime(genesisTimestamp, epochDuration, epoch, depositCutoffOffset);

    }



    function getRedemptionFreezeStart(uint256 epoch, uint256 redemptionFreezeOffset) external view returns (uint256) {

        return EpochMath.getRedemptionFreezeStart(genesisTimestamp, epochDuration, epoch, redemptionFreezeOffset);

    }

}

/// @title EpochMath Tests
/// @title EpochMath Tests
/// @notice Comprehensive boundary tests for epoch math library
contract EpochMathTest is Test {
    // Common epoch durations for testing
    uint256 constant FIFTEEN_MINUTES = 15 minutes;
    uint256 constant ONE_HOUR = 1 hours;
    uint256 constant ONE_DAY = 1 days;
    uint256 constant SEVEN_DAYS = 7 days;

    // Test wrappers for different configurations
    EpochMathWrapper public weeklyWrapper;
    EpochMathWrapper public hourlyWrapper;
    EpochMathWrapper public fifteenMinWrapper;
    EpochMathWrapper public dailyWrapper;

    // Genesis timestamps for different scenarios
    uint256 constant GENESIS_JAN_1_2024 = 1704067200; // Monday, Jan 1, 2024 00:00:00 UTC
    uint256 constant GENESIS_ZERO = 0;

    function setUp() public {
        weeklyWrapper = new EpochMathWrapper(SEVEN_DAYS, GENESIS_JAN_1_2024);
        // Hourly wrapper uses GENESIS_ZERO for easier testing with small timestamps
        hourlyWrapper = new EpochMathWrapper(ONE_HOUR, GENESIS_ZERO);
        fifteenMinWrapper = new EpochMathWrapper(FIFTEEN_MINUTES, GENESIS_ZERO);
        dailyWrapper = new EpochMathWrapper(ONE_DAY, GENESIS_ZERO);
    }

    // ============================================================
    // SECTION: Basic Epoch Calculation Tests
    // ============================================================

    function test_GetCurrentEpoch_AtGenesis() public view {
        uint256 epoch = weeklyWrapper.getCurrentEpochAt(GENESIS_JAN_1_2024);
        assertEq(epoch, 0, "Epoch at genesis should be 0");
    }

    function test_GetCurrentEpoch_OneEpochLater() public view {
        uint256 oneEpochLater = GENESIS_JAN_1_2024 + SEVEN_DAYS;
        uint256 epoch = weeklyWrapper.getCurrentEpochAt(oneEpochLater);
        assertEq(epoch, 1, "One epoch after genesis should be epoch 1");
    }

    function test_GetCurrentEpoch_MultipleEpochs() public view {
        uint256 fiveEpochsLater = GENESIS_JAN_1_2024 + (5 * SEVEN_DAYS);
        uint256 epoch = weeklyWrapper.getCurrentEpochAt(fiveEpochsLater);
        assertEq(epoch, 5, "Five epochs after genesis should be epoch 5");
    }

    function test_Revert_GetCurrentEpoch_BeforeGenesis() public {
        uint256 beforeGenesis = GENESIS_JAN_1_2024 - 1;
        vm.expectRevert(EpochMath.Underflow.selector);
        weeklyWrapper.getCurrentEpochAt(beforeGenesis);
    }

    // ============================================================
    // SECTION: Boundary Tests - Critical for Deterministic Behavior
    // ============================================================

    /// @notice Test exact epoch boundary maps to NEXT epoch
    /// @dev This is the critical boundary rule: t == epochEnd maps to epoch + 1
    function test_Boundary_ExactEpochEnd_MapsToNextEpoch() public view {
        uint256 epoch0End = weeklyWrapper.getEpochEnd(0);
        
        // At exact epoch end, should be considered epoch 1
        uint256 epoch = weeklyWrapper.getCurrentEpochAt(epoch0End);
        assertEq(epoch, 1, "Exact epoch end should map to next epoch");
        
        // One second before should still be epoch 0
        uint256 epochBefore = weeklyWrapper.getCurrentEpochAt(epoch0End - 1);
        assertEq(epochBefore, 0, "One second before epoch end should be current epoch");
    }

    function test_Boundary_MultipleEpochBoundaries() public view {
        // Test boundaries for epochs 0-5
        for (uint256 i = 0; i < 5; i++) {
            uint256 epochEnd = weeklyWrapper.getEpochEnd(i);
            
            // Exact boundary maps to next epoch
            uint256 epochAtBoundary = weeklyWrapper.getCurrentEpochAt(epochEnd);
            assertEq(epochAtBoundary, i + 1, "Boundary should map to next epoch");
            
            // One second before maps to current epoch
            uint256 epochBefore = weeklyWrapper.getCurrentEpochAt(epochEnd - 1);
            assertEq(epochBefore, i, "Before boundary should be current epoch");
            
            // One second after boundary stays in next epoch
            uint256 epochAfter = weeklyWrapper.getCurrentEpochAt(epochEnd + 1);
            assertEq(epochAfter, i + 1, "After boundary should be next epoch");
        }
    }

    function test_Boundary_PreEndExactEndPostEnd() public {
        // Use a wrapper with genesis=0 for easier mental math
        EpochMathWrapper wrapper = new EpochMathWrapper(100, 0); // 100-second epochs
        
        // Epoch 0: [0, 100), Epoch 1: [100, 200), etc.
        // epochEnd(0) = 100
        
        uint256 epochEnd0 = wrapper.getEpochEnd(0);
        assertEq(epochEnd0, 100, "Epoch 0 end should be 100");
        
        // Pre-end (t=99): Should be epoch 0
        uint256 preEnd = wrapper.getCurrentEpochAt(99);
        assertEq(preEnd, 0, "Pre-end should be epoch 0");
        
        // Exact-end (t=100): Should be epoch 1 (maps to NEXT)
        uint256 exactEnd = wrapper.getCurrentEpochAt(100);
        assertEq(exactEnd, 1, "Exact end should map to next epoch (epoch 1)");
        
        // Post-end (t=101): Should be epoch 1
        uint256 postEnd = wrapper.getCurrentEpochAt(101);
        assertEq(postEnd, 1, "Post-end should be epoch 1");
    }

    // ============================================================
    // SECTION: Bucket Request Tests
    // ============================================================

    function test_BucketRequest_AtGenesis() public view {
        uint256 epoch = weeklyWrapper.bucketRequest(GENESIS_JAN_1_2024);
        assertEq(epoch, 0, "Request at genesis buckets to epoch 0");
    }

    function test_BucketRequest_MidEpoch() public view {
        uint256 midEpoch = GENESIS_JAN_1_2024 + (SEVEN_DAYS / 2);
        uint256 epoch = weeklyWrapper.bucketRequest(midEpoch);
        assertEq(epoch, 0, "Request mid-epoch buckets to current epoch");
    }

    /// @notice Critical test: Request at exact epoch boundary buckets to NEXT epoch
    function test_BucketRequest_AtExactBoundary() public view {
        uint256 epoch0End = weeklyWrapper.getEpochEnd(0);
        
        // Request at exact boundary goes to next epoch
        uint256 bucketedEpoch = weeklyWrapper.bucketRequest(epoch0End);
        assertEq(bucketedEpoch, 1, "Request at exact boundary buckets to next epoch");
        
        // One second before boundary goes to current epoch
        uint256 bucketedBefore = weeklyWrapper.bucketRequest(epoch0End - 1);
        assertEq(bucketedBefore, 0, "Request before boundary buckets to current epoch");
    }

    // ============================================================
    // SECTION: Epoch Start/End Tests
    // ============================================================

    function test_GetEpochStart() public view {
        assertEq(weeklyWrapper.getEpochStart(0), GENESIS_JAN_1_2024, "Epoch 0 start is genesis");
        assertEq(weeklyWrapper.getEpochStart(1), GENESIS_JAN_1_2024 + SEVEN_DAYS, "Epoch 1 start");
        assertEq(weeklyWrapper.getEpochStart(5), GENESIS_JAN_1_2024 + (5 * SEVEN_DAYS), "Epoch 5 start");
    }

    function test_GetEpochEnd() public view {
        // Epoch end is the start of the next epoch (exclusive upper bound)
        assertEq(weeklyWrapper.getEpochEnd(0), GENESIS_JAN_1_2024 + SEVEN_DAYS, "Epoch 0 end");
        assertEq(weeklyWrapper.getEpochEnd(1), GENESIS_JAN_1_2024 + (2 * SEVEN_DAYS), "Epoch 1 end");
    }

    function test_EpochStartLessThanEnd() public view {
        for (uint256 i = 0; i < 10; i++) {
            uint256 start = weeklyWrapper.getEpochStart(i);
            uint256 end = weeklyWrapper.getEpochEnd(i);
            assertLt(start, end, "Epoch start must be less than end");
        }
    }

    function test_ConsecutiveEpochsContiguous() public view {
        for (uint256 i = 0; i < 10; i++) {
            uint256 epochIEnd = weeklyWrapper.getEpochEnd(i);
            uint256 epochIPlus1Start = weeklyWrapper.getEpochStart(i + 1);
            assertEq(epochIEnd, epochIPlus1Start, "Epoch end must equal next epoch start");
        }
    }

    // ============================================================
    // SECTION: IsEpochBoundary Tests
    // ============================================================

    function test_IsEpochBoundary_True() public view {
        // Genesis is a boundary
        assertTrue(weeklyWrapper.isEpochBoundary(GENESIS_JAN_1_2024), "Genesis is a boundary");
        
        // Epoch ends are boundaries
        assertTrue(weeklyWrapper.isEpochBoundary(weeklyWrapper.getEpochEnd(0)), "Epoch 0 end is boundary");
        assertTrue(weeklyWrapper.isEpochBoundary(weeklyWrapper.getEpochEnd(1)), "Epoch 1 end is boundary");
    }

    function test_IsEpochBoundary_False() public view {
        // Mid-epoch is not a boundary
        uint256 midEpoch = GENESIS_JAN_1_2024 + (SEVEN_DAYS / 2);
        assertFalse(weeklyWrapper.isEpochBoundary(midEpoch), "Mid-epoch is not a boundary");
        
        // One second after boundary is not a boundary
        assertFalse(
            weeklyWrapper.isEpochBoundary(GENESIS_JAN_1_2024 + 1), "One second after genesis is not boundary"
        );
    }

    // ============================================================
    // SECTION: Different Epoch Durations
    // ============================================================

    function test_FifteenMinuteEpochs() public view {
        uint256 epoch = fifteenMinWrapper.getCurrentEpochAt(FIFTEEN_MINUTES);
        assertEq(epoch, 1, "15-min epoch: one duration later is epoch 1");
        
        epoch = fifteenMinWrapper.getCurrentEpochAt(FIFTEEN_MINUTES - 1);
        assertEq(epoch, 0, "15-min epoch: one second before end is epoch 0");
        
        // Boundary test
        uint256 bucketed = fifteenMinWrapper.bucketRequest(FIFTEEN_MINUTES);
        assertEq(bucketed, 1, "15-min: request at boundary buckets to next epoch");
    }

    function test_HourlyEpochs() public view {
        uint256 epoch = hourlyWrapper.getCurrentEpochAt(ONE_HOUR);
        assertEq(epoch, 1, "Hourly epoch: one hour later is epoch 1");
        
        epoch = hourlyWrapper.getCurrentEpochAt(ONE_HOUR - 1);
        assertEq(epoch, 0, "Hourly epoch: one second before end is epoch 0");
        
        // Test across multiple hours
        epoch = hourlyWrapper.getCurrentEpochAt(5 * ONE_HOUR + 30 minutes);
        assertEq(epoch, 5, "5.5 hours later is epoch 5");
    }

    function test_DailyEpochs() public view {
        uint256 epoch = dailyWrapper.getCurrentEpochAt(ONE_DAY);
        assertEq(epoch, 1, "Daily epoch: one day later is epoch 1");
        
        epoch = dailyWrapper.getCurrentEpochAt(ONE_DAY - 1);
        assertEq(epoch, 0, "Daily epoch: one second before end is epoch 0");
    }

    // ============================================================
    // SECTION: Settlement Window Tests
    // ============================================================

    function test_SettlementWindow_WithinWindow() public view {
        // Set settlement window from epoch start + 1 hour to epoch end - 1 hour
        uint256 epochStart = weeklyWrapper.getEpochStart(1);
        uint256 withinWindow = epochStart + 2 hours;
        
        bool isWithin = weeklyWrapper.isWithinSettlementWindow(withinWindow, 1 hours, 1 hours);
        assertTrue(isWithin, "Should be within settlement window");
    }

    function test_SettlementWindow_OutsideWindow() public view {
        // Too early in epoch
        uint256 epochStart = weeklyWrapper.getEpochStart(1);
        uint256 tooEarly = epochStart + 30 minutes;
        
        bool isWithin = weeklyWrapper.isWithinSettlementWindow(tooEarly, 1 hours, 1 hours);
        assertFalse(isWithin, "Should be outside settlement window (too early)");
        
        // Too late in epoch
        uint256 epochEnd = weeklyWrapper.getEpochEnd(1);
        uint256 tooLate = epochEnd - 30 minutes;
        
        isWithin = weeklyWrapper.isWithinSettlementWindow(tooLate, 1 hours, 1 hours);
        assertFalse(isWithin, "Should be outside settlement window (too late)");
    }

    // ============================================================
    // SECTION: Overflow/Underflow Tests
    // ============================================================

    function test_Revert_ZeroEpochDuration() public {
        vm.expectRevert("EpochMath: zero duration");
        new EpochMathWrapper(0, GENESIS_JAN_1_2024);
    }

    function test_Revert_UnderflowBeforeGenesis() public {
        // Request timestamp before genesis should cause arithmetic issues
        uint256 beforeGenesis = GENESIS_JAN_1_2024 - 1;
        
        // This should revert due to underflow in subtraction
        vm.expectRevert(EpochMath.Underflow.selector);
        weeklyWrapper.getCurrentEpochAt(beforeGenesis);
    }

    function test_NoOverflow_LargeEpochs() public view {
        // Test with large epoch numbers
        uint256 largeEpoch = 1_000_000;
        uint256 start = weeklyWrapper.getEpochStart(largeEpoch);
        uint256 end = weeklyWrapper.getEpochEnd(largeEpoch);
        
        assertGt(end, start, "Large epoch: end > start");
        assertEq(end - start, SEVEN_DAYS, "Large epoch: duration correct");
    }

    function test_NoOverflow_LargeTimestamps() public {
        // Test with timestamps near uint256 max (but safely within range)
        uint256 largeTimestamp = type(uint256).max / 2;
        
        // Create wrapper with genesis that allows large timestamps
        EpochMathWrapper largeWrapper = new EpochMathWrapper(SEVEN_DAYS, largeTimestamp - SEVEN_DAYS);
        
        uint256 epoch = largeWrapper.getCurrentEpochAt(largeTimestamp);
        assertEq(epoch, 1, "Large timestamp should be epoch 1");
    }

    function test_Revert_Overflow_MaxUintTimestamp() public {
        // Test overflow when genesis + calculation would overflow
        uint256 largeGenesis = type(uint256).max - 1000;
        
        // Creating with large genesis should work
        EpochMathWrapper overflowWrapper = new EpochMathWrapper(SEVEN_DAYS, largeGenesis);
        
        // Test overflow in epoch start calculation with very large epoch number
        vm.expectRevert(EpochMath.Overflow.selector);
        overflowWrapper.getEpochStart(type(uint256).max / SEVEN_DAYS);
    }

    // ============================================================
    // SECTION: Seconds Until Epoch End Tests
    // ============================================================

    function test_SecondsUntilEpochEnd_AtStart() public view {
        // Test at the very beginning of an epoch (but not exactly at boundary)
        uint256 epochStart = weeklyWrapper.getEpochStart(1);
        uint256 oneSecondAfterStart = epochStart + 1;
        uint256 secondsUntil = weeklyWrapper.getSecondsUntilEpochEnd(oneSecondAfterStart);
        assertEq(secondsUntil, SEVEN_DAYS - 1, "One second after epoch start");
        
        // At exact epoch boundary, seconds until should be 0 (epoch ended)
        uint256 secondsAtBoundary = weeklyWrapper.getSecondsUntilEpochEnd(epochStart);
        assertEq(secondsAtBoundary, 0, "At exact epoch start/boundary, epoch has technically ended");
    }

    function test_SecondsUntilEpochEnd_MidEpoch() public view {
        uint256 midEpoch = weeklyWrapper.getEpochStart(1) + (SEVEN_DAYS / 2);
        uint256 secondsUntil = weeklyWrapper.getSecondsUntilEpochEnd(midEpoch);
        assertEq(secondsUntil, SEVEN_DAYS / 2, "Mid-epoch: half duration until end");
    }

    function test_SecondsUntilEpochEnd_AtBoundary() public view {
        uint256 epochEnd = weeklyWrapper.getEpochEnd(1);
        uint256 secondsUntil = weeklyWrapper.getSecondsUntilEpochEnd(epochEnd);
        // At exact boundary, we're technically in the NEXT epoch
        // So seconds until epoch 1 end should be 0 (it already ended)
        assertEq(secondsUntil, 0, "At boundary, epoch has ended");
    }

    // ============================================================
    // SECTION: Fuzz Tests for Deterministic Behavior
    // ============================================================

    function testFuzz_EpochCalculation(uint256 timestamp) public view {
        // Bound timestamp to reasonable range
        vm.assume(timestamp >= GENESIS_JAN_1_2024);
        vm.assume(timestamp < GENESIS_JAN_1_2024 + (1000 * SEVEN_DAYS));
        
        uint256 epoch = weeklyWrapper.getCurrentEpochAt(timestamp);
        uint256 start = weeklyWrapper.getEpochStart(epoch);
        uint256 end = weeklyWrapper.getEpochEnd(epoch);
        
        // Timestamp should be within [start, end)
        assertGe(timestamp, start, "Timestamp >= epoch start");
        assertLt(timestamp, end, "Timestamp < epoch end");
    }

    function testFuzz_BoundaryDeterminism(uint256 epoch) public view {
        // Bound to reasonable epoch numbers
        vm.assume(epoch < 1000);
        
        uint256 epochEnd = weeklyWrapper.getEpochEnd(epoch);
        
        // At exact boundary, should be epoch + 1
        uint256 epochAtBoundary = weeklyWrapper.getCurrentEpochAt(epochEnd);
        assertEq(epochAtBoundary, epoch + 1, "Boundary determinism");
        
        // Just before boundary, should be epoch
        uint256 epochBefore = weeklyWrapper.getCurrentEpochAt(epochEnd - 1);
        assertEq(epochBefore, epoch, "Before boundary determinism");
    }

    function testFuzz_BucketRequestDeterminism(uint256 requestTime) public view {
        // Bound to reasonable range - must be >= genesis and within 100 epochs
        // Use bound() instead of assume() for better performance
        requestTime = bound(requestTime, GENESIS_JAN_1_2024, GENESIS_JAN_1_2024 + (100 * SEVEN_DAYS));
        
        uint256 bucketed = weeklyWrapper.bucketRequest(requestTime);
        
        // Bucketed epoch should always be >= 0 and reasonable
        assertGe(bucketed, 0, "Bucketed epoch >= 0");
        assertLe(bucketed, 100, "Bucketed epoch within expected range");
        
        // Request time should be <= the end of its bucketed epoch
        uint256 bucketEnd = weeklyWrapper.getEpochEnd(bucketed);
        assertLe(requestTime, bucketEnd, "Request time <= bucket end (with boundary rule)");
    }

    // ============================================================
    // SECTION: Documentation Verification Tests
    // ============================================================

    /// @notice Verifies the critical rule documented in NatSpec
    function test_Documentation_BoundaryRule() public view {
        // The key rule: "Request at exact epoch boundary maps to NEXT epoch"
        // This test serves as executable documentation
        
        uint256 boundary = weeklyWrapper.getEpochEnd(0); // End of epoch 0
        
        // Execute bucketRequest
        uint256 result = weeklyWrapper.bucketRequest(boundary);
        
        // Verify it maps to next epoch (epoch 1)
        assertEq(result, 1, "CRITICAL RULE: Request at exact epoch boundary maps to NEXT epoch");
        
        // Log for evidence
        console2.log("Boundary timestamp:", boundary);
        console2.log("Bucketed to epoch:", result);
        console2.log("Expected epoch: 1");
    }

    /// @notice Verifies epoch continuity
    function test_Documentation_EpochContinuity() public view {
        // Epochs should form a continuous timeline with no gaps
        
        for (uint256 i = 0; i < 5; i++) {
            uint256 endI = weeklyWrapper.getEpochEnd(i);
            uint256 startIPlus1 = weeklyWrapper.getEpochStart(i + 1);
            
            assertEq(endI, startIPlus1, "Epochs must be contiguous");
            console2.log(string.concat("Epoch ", vm.toString(i), " end = Epoch ", vm.toString(i + 1), " start"));
        }
    }

    // ============================================================
    // SECTION: Deposit Cutoff Boundary Tests
    // ============================================================

    function test_DepositCutoff_WithinWindow() public view {
        // 1-hour deposit cutoff for 7-day epoch
        uint256 epochStart = weeklyWrapper.getEpochStart(1);
        uint256 depositCutoffOffset = 1 hours;

        // Early in epoch: deposits allowed
        uint256 earlyTime = epochStart + 1 hours;
        assertTrue(weeklyWrapper.isDepositAllowed(earlyTime, depositCutoffOffset), "Early deposit should be allowed");

        // Just before cutoff: deposits allowed
        uint256 epochEnd = weeklyWrapper.getEpochEnd(1);
        uint256 justBeforeCutoff = epochEnd - depositCutoffOffset - 1;
        assertTrue(weeklyWrapper.isDepositAllowed(justBeforeCutoff, depositCutoffOffset), "Just before cutoff should be allowed");
    }

    function test_DepositCutoff_AfterCutoff() public view {
        uint256 epochEnd = weeklyWrapper.getEpochEnd(1);
        uint256 depositCutoffOffset = 1 hours;

        // At cutoff time: deposits NOT allowed
        uint256 atCutoff = epochEnd - depositCutoffOffset;
        assertFalse(weeklyWrapper.isDepositAllowed(atCutoff, depositCutoffOffset), "At cutoff should not be allowed");

        // After cutoff: deposits NOT allowed
        uint256 afterCutoff = epochEnd - depositCutoffOffset + 1;
        assertFalse(weeklyWrapper.isDepositAllowed(afterCutoff, depositCutoffOffset), "After cutoff should not be allowed");
    }

    function test_DepositCutoff_ExactBoundary() public {
        // Use small epoch for easier testing
        EpochMathWrapper wrapper = new EpochMathWrapper(100, 0); // 100-second epochs

        // 10-second deposit cutoff
        uint256 depositCutoffOffset = 10;

        // Epoch 1: [100, 200), cutoff at t=190
        uint256 epoch1Start = wrapper.getEpochStart(1); // 100
        uint256 epoch1End = wrapper.getEpochEnd(1); // 200
        uint256 cutoffTime = epoch1End - depositCutoffOffset; // 190

        // Before cutoff (t=189): allowed
        assertTrue(wrapper.isDepositAllowed(189, depositCutoffOffset), "Before cutoff should be allowed");

        // At cutoff (t=190): NOT allowed
        assertFalse(wrapper.isDepositAllowed(190, depositCutoffOffset), "At cutoff should NOT be allowed");

        // After cutoff (t=191): NOT allowed
        assertFalse(wrapper.isDepositAllowed(191, depositCutoffOffset), "After cutoff should NOT be allowed");
    }

    // ============================================================
    // SECTION: Mint-Open Boundary Tests
    // ============================================================

    function test_MintOpen_BeforeOffset() public view {
        uint256 epochStart = weeklyWrapper.getEpochStart(1);
        uint256 mintOpenOffset = 1 hours;

        // At epoch start: minting NOT open yet
        assertFalse(weeklyWrapper.isMintOpen(epochStart, mintOpenOffset), "At start should not be open");

        // Before offset: minting NOT open
        uint256 beforeOffset = epochStart + mintOpenOffset - 1;
        assertFalse(weeklyWrapper.isMintOpen(beforeOffset, mintOpenOffset), "Before offset should not be open");
    }

    function test_MintOpen_AtAndAfterOffset() public view {
        uint256 epochStart = weeklyWrapper.getEpochStart(1);
        uint256 mintOpenOffset = 1 hours;

        // At offset: minting IS open
        uint256 atOffset = epochStart + mintOpenOffset;
        assertTrue(weeklyWrapper.isMintOpen(atOffset, mintOpenOffset), "At offset should be open");

        // After offset: minting IS open
        uint256 afterOffset = epochStart + mintOpenOffset + 1;
        assertTrue(weeklyWrapper.isMintOpen(afterOffset, mintOpenOffset), "After offset should be open");
    }

    function test_MintOpen_ExactBoundary() public {
        EpochMathWrapper wrapper = new EpochMathWrapper(100, 0); // 100-second epochs
        uint256 mintOpenOffset = 10;

        // Epoch 1: [100, 200), mint opens at t=110
        uint256 epoch1Start = 100;

        // Before offset (t=109): NOT open
        assertFalse(wrapper.isMintOpen(109, mintOpenOffset), "Before offset should NOT be open");

        // At offset (t=110): IS open
        assertTrue(wrapper.isMintOpen(110, mintOpenOffset), "At offset should be open");

        // After offset (t=111): IS open
        assertTrue(wrapper.isMintOpen(111, mintOpenOffset), "After offset should be open");
    }

    // ============================================================
    // SECTION: Redemption Freeze Boundary Tests
    // ============================================================

    function test_RedemptionFreeze_BeforeFreeze() public view {
        uint256 epochEnd = weeklyWrapper.getEpochEnd(1);
        uint256 redemptionFreezeOffset = 2 hours;

        // Well before freeze: NOT frozen
        uint256 epochStart = weeklyWrapper.getEpochStart(1);
        uint256 wellBefore = epochStart + 1 hours;
        assertFalse(weeklyWrapper.isRedemptionFrozen(wellBefore, redemptionFreezeOffset), "Well before should not be frozen");

        // Just before freeze: NOT frozen
        uint256 justBeforeFreeze = epochEnd - redemptionFreezeOffset - 1;
        assertFalse(weeklyWrapper.isRedemptionFrozen(justBeforeFreeze, redemptionFreezeOffset), "Just before freeze should not be frozen");
    }

    function test_RedemptionFreeze_AtAndAfterFreeze() public view {
        uint256 epochEnd = weeklyWrapper.getEpochEnd(1);
        uint256 redemptionFreezeOffset = 2 hours;

        // At freeze start: IS frozen
        uint256 atFreezeStart = epochEnd - redemptionFreezeOffset;
        assertTrue(weeklyWrapper.isRedemptionFrozen(atFreezeStart, redemptionFreezeOffset), "At freeze start should be frozen");

        // After freeze start: IS frozen
        uint256 afterFreezeStart = epochEnd - redemptionFreezeOffset + 1;
        assertTrue(weeklyWrapper.isRedemptionFrozen(afterFreezeStart, redemptionFreezeOffset), "After freeze start should be frozen");
    }

    function test_RedemptionFreeze_ExactBoundary() public {
        EpochMathWrapper wrapper = new EpochMathWrapper(100, 0); // 100-second epochs
        uint256 redemptionFreezeOffset = 10;

        // Epoch 1: [100, 200), freeze starts at t=190
        uint256 epoch1End = 200;

        // Before freeze (t=189): NOT frozen
        assertFalse(wrapper.isRedemptionFrozen(189, redemptionFreezeOffset), "Before freeze should NOT be frozen");

        // At freeze start (t=190): IS frozen
        assertTrue(wrapper.isRedemptionFrozen(190, redemptionFreezeOffset), "At freeze start should be frozen");

        // After freeze start (t=191): IS frozen
        assertTrue(wrapper.isRedemptionFrozen(191, redemptionFreezeOffset), "After freeze start should be frozen");
    }

    // ============================================================
    // SECTION: Claim Window Boundary Tests
    // ============================================================

    function test_ClaimWindow_WithinWindow() public view {
        uint256 settlementTimestamp = GENESIS_JAN_1_2024 + 7 days;
        uint256 claimWindowDuration = 30 days;
        uint256 settledEpoch = 0;

        // Right at settlement: window IS open
        assertTrue(
            weeklyWrapper.isClaimWindowOpen(settledEpoch, settlementTimestamp, claimWindowDuration, settlementTimestamp),
            "At settlement should be open"
        );

        // Mid-window: window IS open
        uint256 midWindow = settlementTimestamp + 15 days;
        assertTrue(
            weeklyWrapper.isClaimWindowOpen(settledEpoch, midWindow, claimWindowDuration, settlementTimestamp),
            "Mid-window should be open"
        );

        // Just before window closes: window IS open
        uint256 justBeforeClose = settlementTimestamp + claimWindowDuration - 1;
        assertTrue(
            weeklyWrapper.isClaimWindowOpen(settledEpoch, justBeforeClose, claimWindowDuration, settlementTimestamp),
            "Just before close should be open"
        );
    }

    function test_ClaimWindow_OutsideWindow() public view {
        uint256 settlementTimestamp = GENESIS_JAN_1_2024 + 7 days;
        uint256 claimWindowDuration = 30 days;
        uint256 settledEpoch = 0;

        // Before settlement: window NOT open
        uint256 beforeSettlement = settlementTimestamp - 1;
        assertFalse(
            weeklyWrapper.isClaimWindowOpen(settledEpoch, beforeSettlement, claimWindowDuration, settlementTimestamp),
            "Before settlement should not be open"
        );

        // At window close: window NOT open
        uint256 atClose = settlementTimestamp + claimWindowDuration;
        assertFalse(
            weeklyWrapper.isClaimWindowOpen(settledEpoch, atClose, claimWindowDuration, settlementTimestamp),
            "At close should not be open"
        );

        // After window close: window NOT open
        uint256 afterClose = settlementTimestamp + claimWindowDuration + 1;
        assertFalse(
            weeklyWrapper.isClaimWindowOpen(settledEpoch, afterClose, claimWindowDuration, settlementTimestamp),
            "After close should not be open"
        );
    }

    // ============================================================
    // SECTION: Config Delay (Anti-Gaming) Tests
    // ============================================================

    function test_ConfigActivationTime_DefaultDelay() public view {
        // Default delay is 2 epochs
        uint256 activationDelayEpochs = 2;
        uint256 currentTimestamp = GENESIS_JAN_1_2024 + 3 days; // Epoch 0
        uint256 currentEpoch = weeklyWrapper.getCurrentEpochAt(currentTimestamp);
        assertEq(currentEpoch, 0, "Should be epoch 0");

        (uint256 effectiveEpoch, uint256 effectiveTimestamp) = weeklyWrapper.getConfigActivationTime(currentTimestamp, activationDelayEpochs);

        // Current epoch 0 + 1 (next) + 2 (delay) = epoch 3
        assertEq(effectiveEpoch, 3, "Effective epoch should be 3 (0+1+2)");

        // Effective timestamp should be start of epoch 3
        uint256 epoch3Start = weeklyWrapper.getEpochStart(3);
        assertEq(effectiveTimestamp, epoch3Start, "Effective timestamp should be epoch 3 start");
    }

    function test_ConfigActivationTime_ZeroDelay() public view {
        // Zero delay: effective next epoch
        uint256 activationDelayEpochs = 0;
        uint256 currentTimestamp = GENESIS_JAN_1_2024 + 3 days; // Epoch 0
        uint256 currentEpoch = weeklyWrapper.getCurrentEpochAt(currentTimestamp);
        assertEq(currentEpoch, 0, "Should be epoch 0");

        (uint256 effectiveEpoch, uint256 effectiveTimestamp) = weeklyWrapper.getConfigActivationTime(currentTimestamp, activationDelayEpochs);

        // Current epoch 0 + 1 (next) + 0 (delay) = epoch 1
        assertEq(effectiveEpoch, 1, "Effective epoch should be 1 (next epoch)");
    }

    function test_ShouldUseOriginalConfig_True() public view {
        // Request queued in epoch 5, config effective in epoch 8
        // Should use original config (epoch 5 < epoch 8)
        bool useOriginal = weeklyWrapper.shouldUseOriginalConfig(5, 8);
        assertTrue(useOriginal, "Request queued in epoch 5 should use original config for epoch 8 change");
    }

    function test_ShouldUseOriginalConfig_False() public view {
        // Request queued in epoch 9, config effective in epoch 8
        // Should use new config (epoch 9 >= epoch 8)
        bool useOriginal = weeklyWrapper.shouldUseOriginalConfig(9, 8);
        assertFalse(useOriginal, "Request queued in epoch 9 should use new config for epoch 8 change");
    }

    function test_ShouldUseOriginalConfig_SameEpoch() public view {
        // Request queued in same epoch as config change
        // Should use new config (epoch 8 >= epoch 8)
        bool useOriginal = weeklyWrapper.shouldUseOriginalConfig(8, 8);
        assertFalse(useOriginal, "Request queued in same epoch as config change should use new config");
    }

    function test_ConfigActivation_DeterministicAcrossEpochs() public view {
        // Test that config activation is deterministic
        uint256 activationDelayEpochs = 2;

        for (uint256 epoch = 0; epoch < 5; epoch++) {
            uint256 epochStart = weeklyWrapper.getEpochStart(epoch);
            uint256 epochMid = epochStart + (SEVEN_DAYS / 2);

            (uint256 effectiveEpoch, uint256 effectiveTimestamp) = weeklyWrapper.getConfigActivationTime(epochMid, activationDelayEpochs);

            // Should always be: current + 1 + delay
            uint256 expectedEffectiveEpoch = epoch + 1 + activationDelayEpochs;
            assertEq(effectiveEpoch, expectedEffectiveEpoch, "Effective epoch should be deterministic");

            // Timestamp should be start of effective epoch
            uint256 expectedTimestamp = weeklyWrapper.getEpochStart(expectedEffectiveEpoch);
            assertEq(effectiveTimestamp, expectedTimestamp, "Effective timestamp should be deterministic");
        }
    }

    function test_Boundary_TimingAtExactEpochEnd() public view {
        // Critical test: verify all boundary functions handle exact epoch end correctly
        uint256 epochEnd = weeklyWrapper.getEpochEnd(1);
        uint256 depositCutoffOffset = 1 hours;
        uint256 mintOpenOffset = 1 hours;
        uint256 redemptionFreezeOffset = 1 hours;

        // At exact epoch end:
        // - getCurrentEpoch should return next epoch
        uint256 epochAtBoundary = weeklyWrapper.getCurrentEpochAt(epochEnd);
        assertEq(epochAtBoundary, 2, "At boundary should be next epoch");

        // - isDepositAllowed should use NEW epoch's deposit cutoff
        // In epoch 2, deposits are allowed until epoch2End - 1h
        // At epochEnd (which is epoch2 start), deposits should be allowed
        bool depositsAllowed = weeklyWrapper.isDepositAllowed(epochEnd, depositCutoffOffset);
        assertTrue(depositsAllowed, "At epoch boundary, deposits should use new epoch rules");

        // - isMintOpen should use NEW epoch's mint offset
        // In epoch 2, mint opens at epoch2Start + 1h
        // At epochEnd (which is epoch2 start), mint should NOT be open yet
        bool mintOpen = weeklyWrapper.isMintOpen(epochEnd, mintOpenOffset);
        assertFalse(mintOpen, "At epoch boundary, mint should not be open yet (uses new epoch rules)");

        // - isRedemptionFrozen should use NEW epoch's freeze rules
        // In epoch 2, freeze starts at epoch2End - 1h
        // At epochEnd (which is epoch2 start), redemptions should NOT be frozen
        bool frozen = weeklyWrapper.isRedemptionFrozen(epochEnd, redemptionFreezeOffset);
        assertFalse(frozen, "At epoch boundary, redemptions should not be frozen (uses new epoch rules)");
    }

    function test_GetDepositCutoffTime() public view {
        uint256 epoch = 1;
        uint256 depositCutoffOffset = 1 hours;
        uint256 epochEnd = weeklyWrapper.getEpochEnd(epoch);
        uint256 expectedCutoff = epochEnd - depositCutoffOffset;

        uint256 cutoffTime = weeklyWrapper.getDepositCutoffTime(epoch, depositCutoffOffset);
        assertEq(cutoffTime, expectedCutoff, "Deposit cutoff time should be epoch end minus offset");
    }

    function test_GetRedemptionFreezeStart() public view {
        uint256 epoch = 1;
        uint256 redemptionFreezeOffset = 2 hours;
        uint256 epochEnd = weeklyWrapper.getEpochEnd(epoch);
        uint256 expectedFreezeStart = epochEnd - redemptionFreezeOffset;

        uint256 freezeStart = weeklyWrapper.getRedemptionFreezeStart(epoch, redemptionFreezeOffset);
        assertEq(freezeStart, expectedFreezeStart, "Freeze start should be epoch end minus offset");
    }

    // ============================================================
    // SECTION: Fuzz Tests for Boundary Functions
    // ============================================================

    function testFuzz_DepositCutoffDeterminism(uint256 timestamp, uint256 cutoffOffset) public view {
        // Bound inputs to reasonable ranges
        timestamp = bound(timestamp, GENESIS_JAN_1_2024, GENESIS_JAN_1_2024 + (100 * SEVEN_DAYS));
        cutoffOffset = bound(cutoffOffset, 1, SEVEN_DAYS - 1);

        bool isAllowed = weeklyWrapper.isDepositAllowed(timestamp, cutoffOffset);
        uint256 currentEpoch = weeklyWrapper.getCurrentEpochAt(timestamp);
        uint256 epochEnd = weeklyWrapper.getEpochEnd(currentEpoch);
        uint256 cutoffTime = epochEnd - cutoffOffset;

        // Verify consistency
        if (timestamp < cutoffTime) {
            assertTrue(isAllowed, "Before cutoff should be allowed");
        } else {
            assertFalse(isAllowed, "At or after cutoff should not be allowed");
        }
    }

    function testFuzz_MintOpenDeterminism(uint256 timestamp, uint256 openOffset) public view {
        // Bound inputs
        timestamp = bound(timestamp, GENESIS_JAN_1_2024, GENESIS_JAN_1_2024 + (100 * SEVEN_DAYS));
        openOffset = bound(openOffset, 1, SEVEN_DAYS - 1);

        bool isOpen = weeklyWrapper.isMintOpen(timestamp, openOffset);
        uint256 currentEpoch = weeklyWrapper.getCurrentEpochAt(timestamp);
        uint256 epochStart = weeklyWrapper.getEpochStart(currentEpoch);
        uint256 openTime = epochStart + openOffset;

        // Verify consistency
        if (timestamp >= openTime) {
            assertTrue(isOpen, "At or after open time should be open");
        } else {
            assertFalse(isOpen, "Before open time should not be open");
        }
    }

    function testFuzz_RedemptionFreezeDeterminism(uint256 timestamp, uint256 freezeOffset) public view {
        // Bound inputs
        timestamp = bound(timestamp, GENESIS_JAN_1_2024, GENESIS_JAN_1_2024 + (100 * SEVEN_DAYS));
        freezeOffset = bound(freezeOffset, 1, SEVEN_DAYS - 1);

        bool isFrozen = weeklyWrapper.isRedemptionFrozen(timestamp, freezeOffset);
        uint256 currentEpoch = weeklyWrapper.getCurrentEpochAt(timestamp);
        uint256 epochEnd = weeklyWrapper.getEpochEnd(currentEpoch);
        uint256 freezeStart = epochEnd - freezeOffset;

        // Verify consistency
        if (timestamp >= freezeStart) {
            assertTrue(isFrozen, "At or after freeze start should be frozen");
        } else {
            assertFalse(isFrozen, "Before freeze start should not be frozen");
        }
    }

    function testFuzz_ConfigActivationDeterminism(uint256 currentTimestamp, uint256 delayEpochs) public view {
        // Bound inputs
        currentTimestamp = bound(currentTimestamp, GENESIS_JAN_1_2024, GENESIS_JAN_1_2024 + (100 * SEVEN_DAYS));
        delayEpochs = bound(delayEpochs, 0, 10);

        (uint256 effectiveEpoch, uint256 effectiveTimestamp) = weeklyWrapper.getConfigActivationTime(currentTimestamp, delayEpochs);

        // Verify effective timestamp is start of effective epoch
        uint256 expectedTimestamp = weeklyWrapper.getEpochStart(effectiveEpoch);
        assertEq(effectiveTimestamp, expectedTimestamp, "Effective timestamp should be start of effective epoch");

        // Verify effective epoch is after current
        uint256 currentEpoch = weeklyWrapper.getCurrentEpochAt(currentTimestamp);
        assertGe(effectiveEpoch, currentEpoch + 1, "Effective epoch should be after current");

        // Verify delay is respected
        uint256 expectedEpoch = currentEpoch + 1 + delayEpochs;
        assertEq(effectiveEpoch, expectedEpoch, "Effective epoch should respect delay");
    }

    // ============================================================
    // SECTION: Anti-Gaming Evidence Tests
    // ============================================================

    /// @notice Demonstrates anti-gaming: config change cannot affect same-epoch requests
    function test_AntiGaming_SameEpochRequests() public view {
        // Scenario: Admin tries to change config at last second of epoch 5
        uint256 epoch5Start = weeklyWrapper.getEpochStart(5);
        uint256 epoch5End = weeklyWrapper.getEpochEnd(5);
        uint256 lastSecondOfEpoch5 = epoch5End - 1;

        // Calculate when config change would take effect (delay = 2)
        (uint256 effectiveEpoch, uint256 effectiveTimestamp) = weeklyWrapper.getConfigActivationTime(lastSecondOfEpoch5, 2);

        // Config takes effect in epoch 8, NOT epoch 5
        assertEq(effectiveEpoch, 8, "Config should not take effect until epoch 8");
        assertGt(effectiveEpoch, 5, "Config should not affect same epoch");

        // Request queued in epoch 5 should use ORIGINAL config
        bool useOriginal = weeklyWrapper.shouldUseOriginalConfig(5, effectiveEpoch);
        assertTrue(useOriginal, "Request queued in epoch 5 should use original config");

        console2.log("Config proposed at last second of epoch 5");
        console2.log("Effective epoch:", effectiveEpoch);
        console2.log("Request in epoch 5 uses original config:", useOriginal);
    }

    /// @notice Demonstrates deterministic boundary behavior across all transition types
    function test_AntiGaming_DeterministicBoundaries() public {
        EpochMathWrapper wrapper = new EpochMathWrapper(1000, 0); // 1000-second epochs

        uint256 depositCutoffOffset = 100;
        uint256 mintOpenOffset = 50;
        uint256 redemptionFreezeOffset = 100;

        // Test each boundary second: before, at, and after
        for (uint256 epoch = 1; epoch <= 3; epoch++) {
            uint256 epochStart = wrapper.getEpochStart(epoch);
            uint256 epochEnd = wrapper.getEpochEnd(epoch);

            // Boundary: epoch start (test within current epoch, not across boundary)
            uint256 beforeMintOpen = epochStart + mintOpenOffset - 1;
            uint256 atMintOpen = epochStart + mintOpenOffset;

            // Verify mint-open boundary (within epoch)
            assertFalse(wrapper.isMintOpen(beforeMintOpen, mintOpenOffset), "Before mint open: mint not open");
            assertTrue(wrapper.isMintOpen(atMintOpen, mintOpenOffset), "At mint open: mint is open");


            // Boundary: deposit cutoff
            uint256 afterStart = epochStart + 1;

            // Boundary: deposit cutoff
            uint256 depositCutoff = epochEnd - depositCutoffOffset;
            uint256 beforeDepositCutoff = depositCutoff - 1;
            uint256 atDepositCutoff = depositCutoff;

            // Boundary: redemption freeze
            uint256 freezeStart = epochEnd - redemptionFreezeOffset;
            uint256 beforeFreeze = freezeStart - 1;
            uint256 atFreeze = freezeStart;


            // Verify deposit cutoff boundary
            // Verify mint-open boundary (at start)

            // Note: atStart behavior depends on mintOpenOffset

            // Verify deposit cutoff boundary
            assertTrue(wrapper.isDepositAllowed(beforeDepositCutoff, depositCutoffOffset), "Before cutoff: deposit allowed");
            assertFalse(wrapper.isDepositAllowed(atDepositCutoff, depositCutoffOffset), "At cutoff: deposit not allowed");

            // Verify redemption freeze boundary
            assertFalse(wrapper.isRedemptionFrozen(beforeFreeze, redemptionFreezeOffset), "Before freeze: not frozen");
            assertTrue(wrapper.isRedemptionFrozen(atFreeze, redemptionFreezeOffset), "At freeze: frozen");
        }
    }
}
