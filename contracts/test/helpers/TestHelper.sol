// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/**
 * @title TestHelper
 * @notice Shared helper patterns for deterministic timestamp/revert assertions.
 * @dev All helpers capture timestamps immediately before expected operations to avoid
 *      timing mismatches in revert argument expectations.
 *
 *      CRITICAL: These helpers do NOT modify blockchain state (no vm.warp/vm.roll).
 *      They are pure assertion helpers that capture time at the exact moment needed.
 */
abstract contract TestHelper is Test {

    /**
     * @notice Captures current timestamp and asserts that a call reverts with NavStale error.
     * @dev Use this pattern when the expected revert includes block.timestamp as an argument
     *      and you want deterministic assertions regardless of test execution timing.
     *
     *      Pattern: Capture timestamp IMMEDIATELY before expectRevert, not after setup.
     *
     * @param target The contract to call
     * @param callData The encoded function call
     * @param expectedLastUpdate The expected lastUpdate timestamp in the NavStale error
     */
    function expectNavStaleRevert(
        address target,
        bytes memory callData,
        uint256 expectedLastUpdate
    ) internal {
        // CAPTURE: Get timestamp immediately before expectRevert
        // This ensures the expected currentTime matches what the contract will see
        uint256 currentTime = block.timestamp;

        // ASSERT: Expect revert with captured timestamp
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("NavStale(uint256,uint256)")),
                expectedLastUpdate,
                currentTime
            )
        );

        // EXECUTE: Make the call that should revert
        (bool success,) = target.call(callData);

        // If we reach here, the call didn't revert - fail the test
        if (success) {
            revert("expectNavStaleRevert: call succeeded but expected revert");
        }
    }

    /**
     * @notice Captures current timestamp and asserts staticcall reverts with NavStale error.
     * @dev Use for view functions that should revert with NavStale.
     *
     * @param target The contract to staticcall
     * @param callData The encoded function call
     * @param expectedLastUpdate The expected lastUpdate timestamp in the NavStale error
     */
    function expectNavStaleRevertStatic(
        address target,
        bytes memory callData,
        uint256 expectedLastUpdate
    ) internal {
        // CAPTURE: Get timestamp immediately before the call
        uint256 currentTime = block.timestamp;

        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("NavStale(uint256,uint256)")),
                expectedLastUpdate,
                currentTime
            )
        );

        (bool success,) = target.staticcall(callData);

        // Silence unused variable warning while preserving logic
        // The expectRevert should have already failed the test if success=true
        success;
    }

    /**
     * @notice Standard pattern for asserting custom error reverts with arguments.
     * @dev Captures block state immediately before expectRevert to avoid timing issues.
     *
     * @param target The contract to call
     * @param callData The encoded function call
     * @param errorSelector The 4-byte error selector (e.g., MyError.selector)
     * @param expectedArgs ABI-encoded expected arguments (use abi.encode)
     */
    function expectRevertWithArgs(
        address target,
        bytes memory callData,
        bytes4 errorSelector,
        bytes memory expectedArgs
    ) internal {
        // Combine selector with arguments for full error data
        bytes memory expectedError = abi.encodePacked(errorSelector, expectedArgs);

        vm.expectRevert(expectedError);

        (bool success,) = target.call(callData);
        success; // Silence warning - expectRevert handles failure
    }

    /**
     * @notice Pattern for asserting simple custom errors (no arguments).
     * @param target The contract to call
     * @param callData The encoded function call
     * @param errorSelector The 4-byte error selector
     */
    function expectRevertWithSelector(
        address target,
        bytes memory callData,
        bytes4 errorSelector
    ) internal {
        vm.expectRevert(errorSelector);

        (bool success,) = target.call(callData);
        success; // Silence warning
    }

    /**
     * @notice Captures timestamp AFTER state changes but BEFORE assertions.
     * @dev Use this pattern when:
     *      - You've made state changes (warp, record snapshot, etc.)
     *      - You need to assert about the current timestamp
     *      - You want to avoid race conditions between capture and assertion
     *
     *      PATTERN:
     *        1. Setup state
     *        2. Warp time (if needed)
     *        3. CAPTURE_TIMESTAMP_HERE
     *        4. Use captured value in assertions
     *
     * @return The current block.timestamp
     */
    function captureAssertionTimestamp() internal view returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Records snapshot and returns timestamp for later assertion use.
     * @dev Combines snapshot recording with immediate timestamp capture.
     *      Use when you need both: the snapshot result AND the exact timestamp.
     *
     * @param target Contract to snapshot
     * @param callData Snapshot function call
     * @return snapshotTimestamp The exact timestamp when snapshot was recorded
     */
    function recordSnapshotWithTimestamp(
        address target,
        bytes memory callData
    ) internal returns (uint256 snapshotTimestamp) {
        (bool success,) = target.call(callData);
        require(success, "recordSnapshotWithTimestamp: call failed");

        // Capture immediately after successful call
        return block.timestamp;
    }

    /**
     * @notice Helper to extract revert data from a failed call without reverting the test.
     * @dev Useful for inspecting revert reasons programmatically in tests.
     *
     * @param target The contract to call
     * @param callData The encoded function call
     * @return success Whether the call succeeded
     * @return returnData The return data (error data on revert)
     */
    function tryStaticCall(
        address target,
        bytes memory callData
    ) internal view returns (bool success, bytes memory returnData) {
        return target.staticcall(callData);
    }

    /**
     * @notice Standardized slice helper for extracting error arguments from revert data.
     * @param data The revert data (includes 4-byte selector)
     * @return selector The 4-byte error selector
     * @return args The ABI-encoded arguments (everything after selector)
     */
    function decodeErrorData(
        bytes memory data
    ) internal pure returns (bytes4 selector, bytes memory args) {
        require(data.length >= 4, "decodeErrorData: data too short");

        // Extract selector
        selector = bytes4(data);

        // Extract arguments
        uint256 argsLength = data.length - 4;
        args = new bytes(argsLength);
        for (uint256 i = 0; i < argsLength; i++) {
            args[i] = data[i + 4];
        }

        return (selector, args);
    }

    /**
     * @notice Validates that captured timestamp matches expected range.
     * @dev Use for sanity checks in tests with time-based assertions.
     *
     * @param capturedTimestamp The timestamp captured before operation
     * @param toleranceSeconds Acceptable difference from current (usually 0 or 1)
     */
    function assertTimestampFresh(
        uint256 capturedTimestamp,
        uint256 toleranceSeconds
    ) internal view {
        uint256 currentTime = block.timestamp;
        uint256 diff = currentTime > capturedTimestamp
            ? currentTime - capturedTimestamp
            : capturedTimestamp - currentTime;

        require(
            diff <= toleranceSeconds,
            string.concat(
                "Timestamp stale: captured=",
                vm.toString(capturedTimestamp),
                " current=",
                vm.toString(currentTime),
                " diff=",
                vm.toString(diff)
            )
        );
    }
}
