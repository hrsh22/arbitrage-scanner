// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

/// @title EpochMath
/// @notice Deterministic epoch calculation library for fixed-duration epochs
/// @dev All functions are pure/view and operate on immutable parameters.
///      Critical boundary rule: request at exact epoch end maps to NEXT epoch.
library EpochMath {
    /// @notice Error thrown when epoch duration is zero
    error ZeroEpochDuration();

    /// @notice Error thrown when arithmetic would overflow
    error Overflow();

    /// @notice Error thrown when arithmetic would underflow
    error Underflow();

    /// @notice Returns the current epoch number based on block.timestamp
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @return epoch The current epoch number
    /// @dev Uses floor division: epoch = (block.timestamp - genesis) / duration
    function getCurrentEpoch(uint256 genesisTimestamp, uint256 epochDuration)
        internal
        view
        returns (uint256 epoch)
    {
        return getCurrentEpochAt(genesisTimestamp, epochDuration, block.timestamp);
    }

    /// @notice Returns the epoch number for a specific timestamp
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param timestamp The timestamp to calculate epoch for (must be >= genesis)
    /// @return epoch The epoch number containing the timestamp
    /// @dev Epoch N contains timestamps [genesis + N*duration, genesis + (N+1)*duration)
    ///      Reverts if timestamp < genesis (underflow protection)
    function getCurrentEpochAt(uint256 genesisTimestamp, uint256 epochDuration, uint256 timestamp)
        internal
        pure
        returns (uint256 epoch)
    {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) revert Underflow();

        unchecked {
            return (timestamp - genesisTimestamp) / epochDuration;
        }
    }

    /// @notice Returns the start timestamp of a specific epoch
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param epoch The epoch number
    /// @return start The timestamp when the epoch begins
    /// @dev Epoch N starts at: genesis + N * duration
    function getEpochStart(uint256 genesisTimestamp, uint256 epochDuration, uint256 epoch)
        internal
        pure
        returns (uint256 start)
    {
        if (epochDuration == 0) revert ZeroEpochDuration();

        unchecked {
            // Check for overflow: genesis + epoch * duration <= type(uint256).max
            uint256 epochOffset = epoch * epochDuration;
            if (epoch > 0 && epochOffset / epoch != epochDuration) revert Overflow();
            if (genesisTimestamp + epochOffset < genesisTimestamp) revert Overflow();

            return genesisTimestamp + epochOffset;
        }
    }

    /// @notice Returns the end timestamp of a specific epoch
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param epoch The epoch number
    /// @return end The timestamp when the epoch ends (exclusive upper bound)
    /// @dev Epoch N ends at: genesis + (N + 1) * duration
    ///      This is also the start of epoch N+1 (contiguous epochs)
    function getEpochEnd(uint256 genesisTimestamp, uint256 epochDuration, uint256 epoch)
        internal
        pure
        returns (uint256 end)
    {
        if (epochDuration == 0) revert ZeroEpochDuration();

        unchecked {
            // epoch + 1 could overflow if epoch == type(uint256).max
            if (epoch == type(uint256).max) revert Overflow();

            // Calculate (epoch + 1) * duration with overflow check
            uint256 nextEpoch = epoch + 1;
            uint256 epochOffset = nextEpoch * epochDuration;
            if (nextEpoch > 0 && epochOffset / nextEpoch != epochDuration) revert Overflow();
            if (genesisTimestamp + epochOffset < genesisTimestamp) revert Overflow();

            return genesisTimestamp + epochOffset;
        }
    }

    /// @notice Checks if a timestamp falls exactly on an epoch boundary
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param timestamp The timestamp to check
    /// @return isBoundary True if timestamp is exactly on a boundary, false otherwise
    /// @dev A timestamp is on a boundary if (timestamp - genesis) % duration == 0
    function isEpochBoundary(uint256 genesisTimestamp, uint256 epochDuration, uint256 timestamp)
        internal
        pure
        returns (bool isBoundary)
    {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) return false;

        unchecked {
            return (timestamp - genesisTimestamp) % epochDuration == 0;
        }
    }

    /// @notice Buckets a redemption request timestamp to its target epoch
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param requestTimestamp The timestamp when the request is made
    /// @return epoch The target epoch for the request
    /// @dev CRITICAL BOUNDARY RULE: Request at exact epoch boundary maps to NEXT epoch.
    ///      This ensures deterministic behavior when t == epochEnd:
    ///      - At epoch end boundary, request is assigned to the NEXT epoch
    ///      - This prevents ambiguous "end of epoch N" vs "start of epoch N+1" semantics
    /// 
    ///      Examples (assuming 7-day epochs, genesis = Monday 00:00):
    ///      - Request at t=0 (genesis): buckets to epoch 0
    ///      - Request at t=6d23h59m: buckets to epoch 0
    ///      - Request at t=7d00h00m (exact end): buckets to epoch 1 (NEXT epoch)
    ///      - Request at t=7d00h01m: buckets to epoch 1
    function bucketRequest(uint256 genesisTimestamp, uint256 epochDuration, uint256 requestTimestamp)
        internal
        pure
        returns (uint256 epoch)
    {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (requestTimestamp < genesisTimestamp) revert Underflow();

        unchecked {
            uint256 elapsed = requestTimestamp - genesisTimestamp;
            uint256 rawEpoch = elapsed / epochDuration;
            uint256 remainder = elapsed % epochDuration;

            // If we're exactly at a boundary (remainder == 0) AND not at genesis,
            // we map to the NEXT epoch for deterministic boundary behavior
            if (remainder == 0 && elapsed > 0) {
                // Check for overflow before incrementing
                if (rawEpoch == type(uint256).max) revert Overflow();
                return rawEpoch;
            }

            return rawEpoch;
        }
    }

    /// @notice Returns the number of seconds until the current epoch ends
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param timestamp The current timestamp
    /// @return secondsUntil The number of seconds until epoch end (0 if at boundary)
    /// @dev Returns 0 if timestamp is exactly at an epoch boundary (epoch has ended)
    function getSecondsUntilEpochEnd(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 timestamp
    ) internal pure returns (uint256 secondsUntil) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) revert Underflow();

        unchecked {
            uint256 elapsed = timestamp - genesisTimestamp;
            uint256 remainder = elapsed % epochDuration;

            // If at exact boundary, epoch has just ended
            if (remainder == 0) {
                return 0;
            }

            return epochDuration - remainder;
        }
    }

    /// @notice Checks if a timestamp falls within the settlement window of its epoch
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param timestamp The timestamp to check
    /// @param settlementStartOffset Seconds after epoch start when settlement window opens
    /// @param settlementEndOffset Seconds before epoch end when settlement window closes
    /// @return isWithin True if timestamp is within settlement window
    /// @dev Settlement window: [epoch_start + startOffset, epoch_end - endOffset)
    ///      Example: For a 7-day epoch with 1h start offset and 1h end offset,
    ///      settlement is allowed from 1h after epoch start until 1h before epoch end
    function isWithinSettlementWindow(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 timestamp,
        uint256 settlementStartOffset,
        uint256 settlementEndOffset
    ) internal pure returns (bool isWithin) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) return false;
        if (settlementStartOffset + settlementEndOffset >= epochDuration) return false;

        unchecked {
            uint256 currentEpoch = getCurrentEpochAt(genesisTimestamp, epochDuration, timestamp);
            uint256 epochStart = getEpochStart(genesisTimestamp, epochDuration, currentEpoch);
            uint256 epochEnd = getEpochEnd(genesisTimestamp, epochDuration, currentEpoch);

            uint256 windowOpen = epochStart + settlementStartOffset;
            uint256 windowClose = epochEnd - settlementEndOffset;

            return timestamp >= windowOpen && timestamp < windowClose;
        }
    }

    /// @notice Returns the epoch that contains a given timestamp
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param timestamp The timestamp to find epoch for
    /// @return epoch The epoch containing the timestamp
    /// @dev This is an alias for getCurrentEpochAt for semantic clarity
    function getEpochContaining(uint256 genesisTimestamp, uint256 epochDuration, uint256 timestamp)
        internal
        pure
        returns (uint256 epoch)
    {
        return getCurrentEpochAt(genesisTimestamp, epochDuration, timestamp);
    }

    /// @notice Calculates the remaining time in the current epoch as a percentage
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds (must be > 0)
    /// @param timestamp The current timestamp
    /// @return percentRemaining Percentage of epoch remaining (0-10000, where 10000 = 100%)
    /// @dev Useful for UI countdown displays. Returns 0 at exact boundary.
    function getEpochPercentRemaining(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 timestamp
    ) internal pure returns (uint256 percentRemaining) {
        uint256 secondsUntil = getSecondsUntilEpochEnd(genesisTimestamp, epochDuration, timestamp);
        return (secondsUntil * 10000) / epochDuration;
    }

    // ============================================================================
    // BOUNDARY CHECK FUNCTIONS (Anti-Gaming)
    // ============================================================================

    /// @notice Checks if deposits are still allowed for a given epoch (deposit cutoff)
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds
    /// @param timestamp The current timestamp to check
    /// @param depositCutoffOffset Seconds before epoch end when deposits close
    /// @return allowed True if deposits are still allowed
    /// @dev Deposit window: [epoch_start, epoch_end - depositCutoffOffset)
    ///      Example: For 7-day epochs with 1-hour cutoff, deposits allowed until 1h before epoch end
    function isDepositAllowed(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 timestamp,
        uint256 depositCutoffOffset
    ) internal pure returns (bool allowed) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) return false;
        if (depositCutoffOffset >= epochDuration) return false;

        unchecked {
            uint256 currentEpoch = getCurrentEpochAt(genesisTimestamp, epochDuration, timestamp);
            uint256 epochEnd = getEpochEnd(genesisTimestamp, epochDuration, currentEpoch);

            uint256 depositCutoffTime = epochEnd - depositCutoffOffset;
            return timestamp < depositCutoffTime;
        }
    }

    /// @notice Checks if minting is open for a given epoch (mint-open boundary)
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds
    /// @param timestamp The current timestamp to check
    /// @param mintOpenOffset Seconds after epoch start when minting opens
    /// @return open True if minting is open
    /// @dev Mint window: [epoch_start + mintOpenOffset, epoch_end)
    ///      Example: For 7-day epochs with 1-hour offset, minting opens 1h after epoch start
    function isMintOpen(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 timestamp,
        uint256 mintOpenOffset
    ) internal pure returns (bool open) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) return false;
        if (mintOpenOffset >= epochDuration) return false;

        unchecked {
            uint256 currentEpoch = getCurrentEpochAt(genesisTimestamp, epochDuration, timestamp);
            uint256 epochStart = getEpochStart(genesisTimestamp, epochDuration, currentEpoch);

            uint256 mintOpenTime = epochStart + mintOpenOffset;
            return timestamp >= mintOpenTime;
        }
    }

    /// @notice Checks if redemption requests are frozen for a given epoch (redemption freeze boundary)
    /// @param genesisTimestamp The timestamp when epoch 0 begins
    /// @param epochDuration The duration of each epoch in seconds
    /// @param timestamp The current timestamp to check
    /// @param redemptionFreezeOffset Seconds before epoch end when redemptions freeze
    /// @return frozen True if redemptions are frozen
    /// @dev Redemption freeze: [epoch_end - redemptionFreezeOffset, epoch_end)
    ///      Example: For 7-day epochs with 2-hour freeze, redemptions frozen in final 2h
    function isRedemptionFrozen(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 timestamp,
        uint256 redemptionFreezeOffset
    ) internal pure returns (bool frozen) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) return false;
        if (redemptionFreezeOffset == 0) return false;
        if (redemptionFreezeOffset >= epochDuration) return true; // Always frozen

        unchecked {
            uint256 currentEpoch = getCurrentEpochAt(genesisTimestamp, epochDuration, timestamp);
            uint256 epochEnd = getEpochEnd(genesisTimestamp, epochDuration, currentEpoch);

            uint256 freezeStartTime = epochEnd - redemptionFreezeOffset;
            return timestamp >= freezeStartTime;
        }
    }
    /// @notice Checks if the claim window is open for a settled epoch
    /// @dev Claim window: [settlementTimestamp, settlementTimestamp + claimWindowDuration)
    ///      settledEpoch parameter position reserved for future use
    function isClaimWindowOpen(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 /*settledEpoch*/,
        uint256 timestamp,
        uint256 claimWindowDuration,
        uint256 settlementTimestamp
    ) internal pure returns (bool open) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (timestamp < genesisTimestamp) return false;
        if (settlementTimestamp == 0) return false;
        if (claimWindowDuration == 0) return false;

        unchecked {
            uint256 claimWindowEnd = settlementTimestamp + claimWindowDuration;
            // Prevent overflow
            if (claimWindowEnd < settlementTimestamp) return false;

            return timestamp >= settlementTimestamp && timestamp < claimWindowEnd;
        }
    }

    /// @notice Calculates when a config change will take effect (anti-gaming)
    function getConfigActivationTime(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 currentTimestamp,
        uint256 activationDelayEpochs
    ) internal pure returns (uint256 effectiveEpoch, uint256 effectiveTimestamp) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (currentTimestamp < genesisTimestamp) revert Underflow();

        unchecked {
            uint256 currentEpoch = getCurrentEpochAt(genesisTimestamp, epochDuration, currentTimestamp);

            // Config takes effect after: current + 1 (next) + activationDelayEpochs
            // If delay=2: current=5 -> effective=8 (completes epoch 6 and 7)
            effectiveEpoch = currentEpoch + 1 + activationDelayEpochs;

            // Effective timestamp is the start of the effective epoch
            effectiveTimestamp = getEpochStart(genesisTimestamp, epochDuration, effectiveEpoch);

            return (effectiveEpoch, effectiveTimestamp);
        }
    }

    /// @notice Checks if a queued request should use original epoch's config or new config
    /// @dev genesisTimestamp parameter position reserved for interface consistency
    function shouldUseOriginalConfig(
        uint256 /*genesisTimestamp*/,
        uint256 epochDuration,
        uint256 requestQueueEpoch,
        uint256 configEffectiveEpoch
    ) internal pure returns (bool useOriginalConfig) {
        if (epochDuration == 0) revert ZeroEpochDuration();

        unchecked {
            // If request was queued before config takes effect, use original config
            return requestQueueEpoch < configEffectiveEpoch;
        }
    }

    /// @notice Returns the deposit cutoff timestamp for a specific epoch
    function getDepositCutoffTime(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 epoch,
        uint256 depositCutoffOffset
    ) internal pure returns (uint256 cutoff) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (depositCutoffOffset >= epochDuration) revert Underflow();

        unchecked {
            uint256 epochEnd = getEpochEnd(genesisTimestamp, epochDuration, epoch);
            return epochEnd - depositCutoffOffset;
        }
    }

    /// @notice Returns the redemption freeze start timestamp for a specific epoch
    function getRedemptionFreezeStart(
        uint256 genesisTimestamp,
        uint256 epochDuration,
        uint256 epoch,
        uint256 redemptionFreezeOffset
    ) internal pure returns (uint256 freezeStart) {
        if (epochDuration == 0) revert ZeroEpochDuration();
        if (redemptionFreezeOffset >= epochDuration) revert Overflow();

        unchecked {
            uint256 epochEnd = getEpochEnd(genesisTimestamp, epochDuration, epoch);
            return epochEnd - redemptionFreezeOffset;
        }
    }
}
