// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.28 >=0.4.16 >=0.6.2 >=0.8.4 ^0.8.20;

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/utils/Context.sol

// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

// src/libraries/EpochMath.sol

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

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/access/IAccessControl.sol

// OpenZeppelin Contracts (last updated v5.4.0) (access/IAccessControl.sol)

/**
 * @dev External interface of AccessControl declared to support ERC-165 detection.
 */
interface IAccessControl {
    /**
     * @dev The `account` is missing a role.
     */
    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

    /**
     * @dev The caller of a function is not the expected one.
     *
     * NOTE: Don't confuse with {AccessControlUnauthorizedAccount}.
     */
    error AccessControlBadConfirmation();

    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted to signal this.
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role`.
     *
     * `sender` is the account that originated the contract call. This account bears the admin role (for the granted role).
     * Expected in cases where the role was granted using the internal {AccessControl-_grantRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {AccessControl-_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function grantRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function revokeRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     */
    function renounceRole(bytes32 role, address callerConfirmation) external;
}

// ../lib/openzeppelin-contracts/contracts/utils/introspection/IERC165.sol

// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/IERC165.sol)

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165_0 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/utils/introspection/IERC165.sol

// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/IERC165.sol)

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165_1 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// ../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20_0 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20_1 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/utils/StorageSlot.sol

// OpenZeppelin Contracts (last updated v5.1.0) (utils/StorageSlot.sol)
// This file was procedurally generated from scripts/generate/templates/StorageSlot.js.

/**
 * @dev Library for reading and writing primitive types to specific storage slots.
 *
 * Storage slots are often used to avoid storage conflict when dealing with upgradeable contracts.
 * This library helps with reading and writing to such slots without the need for inline assembly.
 *
 * The functions in this library return Slot structs that contain a `value` member that can be used to read or write.
 *
 * Example usage to set ERC-1967 implementation slot:
 * ```solidity
 * contract ERC1967 {
 *     // Define the slot. Alternatively, use the SlotDerivation library to derive the slot.
 *     bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
 *
 *     function _getImplementation() internal view returns (address) {
 *         return StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value;
 *     }
 *
 *     function _setImplementation(address newImplementation) internal {
 *         require(newImplementation.code.length > 0);
 *         StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value = newImplementation;
 *     }
 * }
 * ```
 *
 * TIP: Consider using this library along with {SlotDerivation}.
 */
library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct Int256Slot {
        int256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    /**
     * @dev Returns an `AddressSlot` with member `value` located at `slot`.
     */
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `BooleanSlot` with member `value` located at `slot`.
     */
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Bytes32Slot` with member `value` located at `slot`.
     */
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Uint256Slot` with member `value` located at `slot`.
     */
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Int256Slot` with member `value` located at `slot`.
     */
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `StringSlot` with member `value` located at `slot`.
     */
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `StringSlot` representation of the string storage pointer `store`.
     */
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }

    /**
     * @dev Returns a `BytesSlot` with member `value` located at `slot`.
     */
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `BytesSlot` representation of the bytes storage pointer `store`.
     */
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol

// OpenZeppelin Contracts (last updated v5.5.0) (interfaces/draft-IERC6093.sol)

/**
 * @dev Standard ERC-20 Errors
 * Interface of the https://eips.ethereum.org/EIPS/eip-6093[ERC-6093] custom errors for ERC-20 tokens.
 */
interface IERC20Errors {
    /**
     * @dev Indicates an error related to the current `balance` of a `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param balance Current balance for the interacting account.
     * @param needed Minimum amount required to perform a transfer.
     */
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC20InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC20InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `spender`’s `allowance`. Used in transfers.
     * @param spender Address that may be allowed to operate on tokens without being their owner.
     * @param allowance Amount of tokens a `spender` is allowed to operate with.
     * @param needed Minimum amount required to perform a transfer.
     */
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC20InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `spender` to be approved. Used in approvals.
     * @param spender Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC20InvalidSpender(address spender);
}

/**
 * @dev Standard ERC-721 Errors
 * Interface of the https://eips.ethereum.org/EIPS/eip-6093[ERC-6093] custom errors for ERC-721 tokens.
 */
interface IERC721Errors {
    /**
     * @dev Indicates that an address can't be an owner. For example, `address(0)` is a forbidden owner in ERC-721.
     * Used in balance queries.
     * @param owner Address of the current owner of a token.
     */
    error ERC721InvalidOwner(address owner);

    /**
     * @dev Indicates a `tokenId` whose `owner` is the zero address.
     * @param tokenId Identifier number of a token.
     */
    error ERC721NonexistentToken(uint256 tokenId);

    /**
     * @dev Indicates an error related to the ownership over a particular token. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param tokenId Identifier number of a token.
     * @param owner Address of the current owner of a token.
     */
    error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC721InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC721InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `operator`’s approval. Used in transfers.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     * @param tokenId Identifier number of a token.
     */
    error ERC721InsufficientApproval(address operator, uint256 tokenId);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC721InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `operator` to be approved. Used in approvals.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC721InvalidOperator(address operator);
}

/**
 * @dev Standard ERC-1155 Errors
 * Interface of the https://eips.ethereum.org/EIPS/eip-6093[ERC-6093] custom errors for ERC-1155 tokens.
 */
interface IERC1155Errors {
    /**
     * @dev Indicates an error related to the current `balance` of a `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param balance Current balance for the interacting account.
     * @param needed Minimum amount required to perform a transfer.
     * @param tokenId Identifier number of a token.
     */
    error ERC1155InsufficientBalance(address sender, uint256 balance, uint256 needed, uint256 tokenId);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC1155InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC1155InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `operator`’s approval. Used in transfers.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     * @param owner Address of the current owner of a token.
     */
    error ERC1155MissingApprovalForAll(address operator, address owner);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC1155InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `operator` to be approved. Used in approvals.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC1155InvalidOperator(address operator);

    /**
     * @dev Indicates an array length mismatch between ids and values in a safeBatchTransferFrom operation.
     * Used in batch transfers.
     * @param idsLength Length of the array of token identifiers
     * @param valuesLength Length of the array of token amounts
     */
    error ERC1155InvalidArrayLength(uint256 idsLength, uint256 valuesLength);
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/utils/introspection/ERC165.sol

// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/ERC165.sol)

/**
 * @dev Implementation of the {IERC165} interface.
 *
 * Contracts that want to implement ERC-165 should inherit from this contract and override {supportsInterface} to check
 * for the additional interface id that will be supported. For example:
 *
 * ```solidity
 * function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
 *     return interfaceId == type(MyInterface).interfaceId || super.supportsInterface(interfaceId);
 * }
 * ```
 */
abstract contract ERC165 is IERC165_1 {
    /// @inheritdoc IERC165_1
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IERC165_1).interfaceId;
    }
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/interfaces/IERC165.sol

// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC165.sol)

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/interfaces/IERC20.sol

// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC20.sol)

// ../lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/extensions/IERC20Metadata.sol)

/**
 * @dev Interface for the optional metadata functions from the ERC-20 standard.
 */
interface IERC20Metadata_0 is IERC20_0 {
    /**
     * @dev Returns the name of the token.
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token.
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/extensions/IERC20Metadata.sol)

/**
 * @dev Interface for the optional metadata functions from the ERC-20 standard.
 */
interface IERC20Metadata_1 is IERC20_1 {
    /**
     * @dev Returns the name of the token.
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token.
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);
}

// ../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol

// OpenZeppelin Contracts (last updated v5.5.0) (utils/ReentrancyGuard.sol)

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 *
 * IMPORTANT: Deprecated. This storage-based reentrancy guard will be removed and replaced
 * by the {ReentrancyGuardTransient} variant in v6.0.
 *
 * @custom:stateless
 */
abstract contract ReentrancyGuard {
    using StorageSlot for bytes32;

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REENTRANCY_GUARD_STORAGE =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    /**
     * @dev A `view` only version of {nonReentrant}. Use to block view functions
     * from being called, preventing reading from inconsistent contract state.
     *
     * CAUTION: This is a "view" modifier and does not change the reentrancy
     * status. Use it only on view functions. For payable or non-payable functions,
     * use the standard {nonReentrant} modifier instead.
     */
    modifier nonReentrantView() {
        _nonReentrantBeforeView();
        _;
    }

    function _nonReentrantBeforeView() private view {
        if (_reentrancyGuardEntered()) {
            revert ReentrancyGuardReentrantCall();
        }
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        _nonReentrantBeforeView();

        // Any calls to nonReentrant after this point will fail
        _reentrancyGuardStorageSlot().getUint256Slot().value = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyGuardStorageSlot().getUint256Slot().value == ENTERED;
    }

    function _reentrancyGuardStorageSlot() internal pure virtual returns (bytes32) {
        return REENTRANCY_GUARD_STORAGE;
    }
}

// ../lib/openzeppelin-contracts/contracts/access/AccessControl.sol

// OpenZeppelin Contracts (last updated v5.6.0) (access/AccessControl.sol)

/**
 * @dev Contract module that allows children to implement role-based access
 * control mechanisms. This is a lightweight version that doesn't allow enumerating role
 * members except through off-chain means by accessing the contract event logs. Some
 * applications may benefit from on-chain enumerability, for those cases see
 * {AccessControlEnumerable}.
 *
 * Roles are referred to by their `bytes32` identifier. These should be exposed
 * in the external API and be unique. The best way to achieve this is by
 * using `public constant` hash digests:
 *
 * ```solidity
 * bytes32 public constant MY_ROLE = keccak256("MY_ROLE");
 * ```
 *
 * Roles can be used to represent a set of permissions. To restrict access to a
 * function call, use {hasRole}:
 *
 * ```solidity
 * function foo() public {
 *     require(hasRole(MY_ROLE, msg.sender));
 *     ...
 * }
 * ```
 *
 * Roles can be granted and revoked dynamically via the {grantRole} and
 * {revokeRole} functions. Each role has an associated admin role, and only
 * accounts that have a role's admin role can call {grantRole} and {revokeRole}.
 *
 * By default, the admin role for all roles is `DEFAULT_ADMIN_ROLE`, which means
 * that only accounts with this role will be able to grant or revoke other
 * roles. More complex role relationships can be created by using
 * {_setRoleAdmin}.
 *
 * WARNING: The `DEFAULT_ADMIN_ROLE` is also its own admin: it has permission to
 * grant and revoke this role. Extra precautions should be taken to secure
 * accounts that have been granted it. We recommend using {AccessControlDefaultAdminRules}
 * to enforce additional security measures for this role.
 */
abstract contract AccessControl is Context, IAccessControl, ERC165 {
    struct RoleData {
        mapping(address account => bool) hasRole;
        bytes32 adminRole;
    }

    mapping(bytes32 role => RoleData) private _roles;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    /**
     * @dev Modifier that checks that an account has a specific role. Reverts
     * with an {AccessControlUnauthorizedAccount} error including the required role.
     */
    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    /// 
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IAccessControl).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) public view virtual returns (bool) {
        return _roles[role].hasRole[account];
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `_msgSender()`
     * is missing `role`. Overriding this function changes the behavior of the {onlyRole} modifier.
     */
    function _checkRole(bytes32 role) internal view virtual {
        _checkRole(role, _msgSender());
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `account`
     * is missing `role`.
     */
    function _checkRole(bytes32 role, address account) internal view virtual {
        if (!hasRole(role, account)) {
            revert AccessControlUnauthorizedAccount(account, role);
        }
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view virtual returns (bytes32) {
        return _roles[role].adminRole;
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
    }

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been revoked `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     *
     * May emit a {RoleRevoked} event.
     */
    function renounceRole(bytes32 role, address callerConfirmation) public virtual {
        if (callerConfirmation != _msgSender()) {
            revert AccessControlBadConfirmation();
        }

        _revokeRole(role, callerConfirmation);
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        bytes32 previousAdminRole = getRoleAdmin(role);
        _roles[role].adminRole = adminRole;
        emit RoleAdminChanged(role, previousAdminRole, adminRole);
    }

    /**
     * @dev Attempts to grant `role` to `account` and returns a boolean indicating if `role` was granted.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleGranted} event.
     */
    function _grantRole(bytes32 role, address account) internal virtual returns (bool) {
        if (!hasRole(role, account)) {
            _roles[role].hasRole[account] = true;
            emit RoleGranted(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Attempts to revoke `role` from `account` and returns a boolean indicating if `role` was revoked.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleRevoked} event.
     */
    function _revokeRole(bytes32 role, address account) internal virtual returns (bool) {
        if (hasRole(role, account)) {
            _roles[role].hasRole[account] = false;
            emit RoleRevoked(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }
}

// ../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol

// OpenZeppelin Contracts (last updated v5.5.0) (token/ERC20/ERC20.sol)

/**
 * @dev Implementation of the {IERC20} interface.
 *
 * This implementation is agnostic to the way tokens are created. This means
 * that a supply mechanism has to be added in a derived contract using {_mint}.
 *
 * TIP: For a detailed writeup see our guide
 * https://forum.openzeppelin.com/t/how-to-implement-erc20-supply-mechanisms/226[How
 * to implement supply mechanisms].
 *
 * The default value of {decimals} is 18. To change this, you should override
 * this function so it returns a different value.
 *
 * We have followed general OpenZeppelin Contracts guidelines: functions revert
 * instead returning `false` on failure. This behavior is nonetheless
 * conventional and does not conflict with the expectations of ERC-20
 * applications.
 */
abstract contract ERC20 is Context, IERC20_0, IERC20Metadata_0, IERC20Errors {
    mapping(address account => uint256) private _balances;

    mapping(address account => mapping(address spender => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * Both values are immutable: they can only be set once during construction.
     */
    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5.05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the default value returned by this function, unless
     * it's overridden.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    /// @inheritdoc IERC20_0
    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    /// @inheritdoc IERC20_0
    function balanceOf(address account) public view virtual returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `value`.
     */
    function transfer(address to, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, value);
        return true;
    }

    /// @inheritdoc IERC20_0
    function allowance(address owner, address spender) public view virtual returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * NOTE: If `value` is the maximum `uint256`, the allowance is not updated on
     * `transferFrom`. This is semantically equivalent to an infinite approval.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, value);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Skips emitting an {Approval} event indicating an allowance update. This is not
     * required by the ERC. See {xref-ERC20-_approve-address-address-uint256-bool-}[_approve].
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `value`.
     * - the caller must have allowance for ``from``'s tokens of at least
     * `value`.
     */
    function transferFrom(address from, address to, uint256 value) public virtual returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, value);
        _transfer(from, to, value);
        return true;
    }

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead.
     */
    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }
        _update(from, to, value);
    }

    /**
     * @dev Transfers a `value` amount of tokens from `from` to `to`, or alternatively mints (or burns) if `from`
     * (or `to`) is the zero address. All customizations to transfers, mints, and burns should be done by overriding
     * this function.
     *
     * Emits a {Transfer} event.
     */
    function _update(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) {
            // Overflow check required: The rest of the code assumes that totalSupply never overflows
            _totalSupply += value;
        } else {
            uint256 fromBalance = _balances[from];
            if (fromBalance < value) {
                revert ERC20InsufficientBalance(from, fromBalance, value);
            }
            unchecked {
                // Overflow not possible: value <= fromBalance <= totalSupply.
                _balances[from] = fromBalance - value;
            }
        }

        if (to == address(0)) {
            unchecked {
                // Overflow not possible: value <= totalSupply or value <= fromBalance <= totalSupply.
                _totalSupply -= value;
            }
        } else {
            unchecked {
                // Overflow not possible: balance + value is at most totalSupply, which we know fits into a uint256.
                _balances[to] += value;
            }
        }

        emit Transfer(from, to, value);
    }

    /**
     * @dev Creates a `value` amount of tokens and assigns them to `account`, by transferring it from address(0).
     * Relies on the `_update` mechanism
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead.
     */
    function _mint(address account, uint256 value) internal {
        if (account == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }
        _update(address(0), account, value);
    }

    /**
     * @dev Destroys a `value` amount of tokens from `account`, lowering the total supply.
     * Relies on the `_update` mechanism.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead
     */
    function _burn(address account, uint256 value) internal {
        if (account == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        _update(account, address(0), value);
    }

    /**
     * @dev Sets `value` as the allowance of `spender` over the `owner`'s tokens.
     *
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     *
     * Overrides to this logic should be done to the variant with an additional `bool emitEvent` argument.
     */
    function _approve(address owner, address spender, uint256 value) internal {
        _approve(owner, spender, value, true);
    }

    /**
     * @dev Variant of {_approve} with an optional flag to enable or disable the {Approval} event.
     *
     * By default (when calling {_approve}) the flag is set to true. On the other hand, approval changes made by
     * `_spendAllowance` during the `transferFrom` operation sets the flag to false. This saves gas by not emitting any
     * `Approval` event during `transferFrom` operations.
     *
     * Anyone who wishes to continue emitting `Approval` events on the `transferFrom` operation can force the flag to
     * true using the following override:
     *
     * ```solidity
     * function _approve(address owner, address spender, uint256 value, bool) internal virtual override {
     *     super._approve(owner, spender, value, true);
     * }
     * ```
     *
     * Requirements are the same as {_approve}.
     */
    function _approve(address owner, address spender, uint256 value, bool emitEvent) internal virtual {
        if (owner == address(0)) {
            revert ERC20InvalidApprover(address(0));
        }
        if (spender == address(0)) {
            revert ERC20InvalidSpender(address(0));
        }
        _allowances[owner][spender] = value;
        if (emitEvent) {
            emit Approval(owner, spender, value);
        }
    }

    /**
     * @dev Updates `owner`'s allowance for `spender` based on spent `value`.
     *
     * Does not update the allowance value in case of infinite allowance.
     * Revert if not enough allowance is available.
     *
     * Does not emit an {Approval} event.
     */
    function _spendAllowance(address owner, address spender, uint256 value) internal virtual {
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance < type(uint256).max) {
            if (currentAllowance < value) {
                revert ERC20InsufficientAllowance(spender, currentAllowance, value);
            }
            unchecked {
                _approve(owner, spender, currentAllowance - value, false);
            }
        }
    }
}

// /Users/harsh/Developer/polymarket-mvp/lib/openzeppelin-contracts/contracts/interfaces/IERC1363.sol

// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC1363.sol)

/**
 * @title IERC1363
 * @dev Interface of the ERC-1363 standard as defined in the https://eips.ethereum.org/EIPS/eip-1363[ERC-1363].
 *
 * Defines an extension interface for ERC-20 tokens that supports executing code on a recipient contract
 * after `transfer` or `transferFrom`, or code on a spender contract after `approve`, in a single transaction.
 */
interface IERC1363 is IERC20_0, IERC165_1 {
    /*
     * Note: the ERC-165 identifier for this interface is 0xb0202a11.
     * 0xb0202a11 ===
     *   bytes4(keccak256('transferAndCall(address,uint256)')) ^
     *   bytes4(keccak256('transferAndCall(address,uint256,bytes)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256,bytes)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256,bytes)'))
     */

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @param data Additional data with no specified format, sent in call to `spender`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}

// ../lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol

// OpenZeppelin Contracts (last updated v5.5.0) (token/ERC20/utils/SafeERC20.sol)

/**
 * @title SafeERC20
 * @dev Wrappers around ERC-20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    /**
     * @dev An operation with an ERC-20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20_0 token, address to, uint256 value) internal {
        if (!_safeTransfer(token, to, value, true)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20_0 token, address from, address to, uint256 value) internal {
        if (!_safeTransferFrom(token, from, to, value, true)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Variant of {safeTransfer} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransfer(IERC20_0 token, address to, uint256 value) internal returns (bool) {
        return _safeTransfer(token, to, value, false);
    }

    /**
     * @dev Variant of {safeTransferFrom} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransferFrom(IERC20_0 token, address from, address to, uint256 value) internal returns (bool) {
        return _safeTransferFrom(token, from, to, value, false);
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeIncreaseAllowance(IERC20_0 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeDecreaseAllowance(IERC20_0 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     *
     * NOTE: If the token implements ERC-7674, this function will not modify any temporary allowance. This function
     * only sets the "standard" allowance. Any temporary allowance will remain active, in addition to the value being
     * set here.
     */
    function forceApprove(IERC20_0 token, address spender, uint256 value) internal {
        if (!_safeApprove(token, spender, value, false)) {
            if (!_safeApprove(token, spender, 0, true)) revert SafeERC20FailedOperation(address(token));
            if (!_safeApprove(token, spender, value, true)) revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferAndCall, with a fallback to the simple {ERC20} transfer if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that relies on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferFromAndCall, with a fallback to the simple {ERC20} transferFrom if the target
     * has no code. This can be used to implement an {ERC721}-like safe transfer that relies on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferFromAndCallRelaxed(
        IERC1363 token,
        address from,
        address to,
        uint256 value,
        bytes memory data
    ) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} approveAndCall, with a fallback to the simple {ERC20} approve if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * NOTE: When the recipient address (`to`) has no code (i.e. is an EOA), this function behaves as {forceApprove}.
     * Oppositely, when the recipient address (`to`) has code, this function only attempts to call {ERC1363-approveAndCall}
     * once without retrying, and relies on the returned value to be true.
     *
     * Reverts if the returned value is other than `true`.
     */
    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity `token.transfer(to, value)` call, relaxing the requirement on the return value: the
     * return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param to The recipient of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeTransfer(IERC20_0 token, address to, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20_0.transfer.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(to, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }

    /**
     * @dev Imitates a Solidity `token.transferFrom(from, to, value)` call, relaxing the requirement on the return
     * value: the return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param from The sender of the tokens
     * @param to The recipient of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeTransferFrom(
        IERC20_0 token,
        address from,
        address to,
        uint256 value,
        bool bubble
    ) private returns (bool success) {
        bytes4 selector = IERC20_0.transferFrom.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(from, shr(96, not(0))))
            mstore(0x24, and(to, shr(96, not(0))))
            mstore(0x44, value)
            success := call(gas(), token, 0, 0x00, 0x64, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
            mstore(0x60, 0)
        }
    }

    /**
     * @dev Imitates a Solidity `token.approve(spender, value)` call, relaxing the requirement on the return value:
     * the return value is optional (but if data is returned, it must not be false).
     *
     * @param token The token targeted by the call.
     * @param spender The spender of the tokens
     * @param value The amount of token to transfer
     * @param bubble Behavior switch if the transfer call reverts: bubble the revert reason or return a false boolean.
     */
    function _safeApprove(IERC20_0 token, address spender, uint256 value, bool bubble) private returns (bool success) {
        bytes4 selector = IERC20_0.approve.selector;

        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(0x00, selector)
            mstore(0x04, and(spender, shr(96, not(0))))
            mstore(0x24, value)
            success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)
            // if call success and return is true, all is good.
            // otherwise (not success or return is not true), we need to perform further checks
            if iszero(and(success, eq(mload(0x00), 1))) {
                // if the call was a failure and bubble is enabled, bubble the error
                if and(iszero(success), bubble) {
                    returndatacopy(fmp, 0x00, returndatasize())
                    revert(fmp, returndatasize())
                }
                // if the return value is not true, then the call is only successful if:
                // - the token address has code
                // - the returndata is empty
                success := and(success, and(iszero(returndatasize()), gt(extcodesize(token), 0)))
            }
            mstore(0x40, fmp)
        }
    }
}

// src/EpochTrancheVault.sol

contract EpochTrancheVault is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20_0;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");
    bytes32 public constant SNAPSHOT_ROLE = keccak256("SNAPSHOT_ROLE");
    bytes32 public constant DEPOSIT_PROCESSOR_ROLE = keccak256("DEPOSIT_PROCESSOR_ROLE");

    IERC20_0 public immutable asset;
    uint256 public immutable EPOCH_DURATION;
    uint256 public immutable DEPLOY_TIME;
    uint256 public immutable NAV_STALENESS_THRESHOLD;
    uint256 public immutable MIN_CLAIM_THRESHOLD;
    uint256 public immutable BALANCED_UPFRONT_BPS;
    address public immutable tradingSafe;

    enum EpochStatus {
        Active,
        Frozen,
        Settling,
        Settled,
        Finalized
    }
    enum RequestStatus {
        Pending,
        Frozen,
        Claimable,
        Claimed,
        Cancelled
    }

    struct Epoch {
        uint256 epochId;
        uint256 startTime;
        uint256 endTime;
        uint256 epochOpenNAV;
        uint256 snapshotNAV;
        uint256 snapshotTimestamp;
        uint256 totalSharesPending;
        uint256 frozenShares;
        uint256 frozenAssets;
        uint256 proRataRatio;
        uint256 carryAccrued;
        uint256 cohortTotalEntitlement;
        uint256 cohortTotalAccrued;
        uint256 cohortTotalClaimed;
        uint256 cohortCarryRemaining;
        EpochStatus status;
        bool exists;
    }

    struct DepositRequest {
        uint256 requestId;
        address depositor;
        uint256 assets;
        uint256 targetEpoch;
        uint256 createdAt;
        bool processed;
        bool exists;
    }

    struct RedemptionRequest {
        uint256 requestId;
        address controller;
        address owner;
        uint256 shares;
        uint256 assetsClaimable;
        uint256 carryDeducted;
        uint256 entitlement; // gross entitlement before carry
        uint256 accrued; // carry accrued against this request
        uint256 claimed; // amount already claimed by user
        uint256 carryRemaining; // remaining carry liability
        uint256 epochId;
        RequestStatus status;
        uint256 createdAt;
        uint256 settledAt;
        bool exists;
    }

    struct TrancheSnapshot {
        bytes32 snapshotHash;
        uint256 totalValue;
        uint256 timestamp;
        uint256 realizationDeadline;
        bool exists;
    }

    mapping(uint256 => Epoch) public epochs;
    uint256 public currentEpochId;

    mapping(uint256 => DepositRequest) public depositRequests;
    mapping(uint256 => uint256[]) public epochDepositRequests;
    mapping(address => mapping(uint256 => uint256)) public depositorEpochRequest;
    uint256 public nextDepositRequestId;
    uint256 public totalQueuedAssets;

    mapping(uint256 => RedemptionRequest) public redemptionRequests;
    mapping(uint256 => uint256[]) public epochRedemptionRequests;
    mapping(address => uint256) public controllerToRequestId;
    uint256 public nextRedemptionRequestId;
    uint256 public totalPendingRedeemShares;
    uint256 public reservedRedemptionAssets;

    mapping(uint256 => TrancheSnapshot) public epochSnapshots;

    uint256 public currentNAV;
    uint256 public lastNAVUpdate;
    bool public emergencyMode;
    uint256 public deployedCapital;

    mapping(uint256 => uint256) public nextRequestIndexToProcess;
    uint256 public constant MAX_CHUNK_SIZE = 100;
    uint256 public constant PRORATA_PRECISION = 1e18;

    struct SettlementProgress {
        uint256 processedCount;
        uint256 totalCount;
        uint256 lastProcessedIndex;
        bool complete;
    }
    mapping(uint256 => SettlementProgress) public settlementProgress;

    bytes4 constant IERC7540_REDEEM_INTERFACE_ID = 0x620ee8e4;
    bytes4 constant IERC7540_CLAIM_INTERFACE_ID = 0x2f0a18c5;

    event DepositQueued(uint256 indexed requestId, address indexed depositor, uint256 assets, uint256 targetEpoch);
    event DepositProcessed(
        uint256 indexed requestId, address indexed depositor, uint256 assets, uint256 sharesMinted, uint256 epochId
    );
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );
    event RedeemRequestCancelled(uint256 indexed requestId, address indexed controller, uint256 shares);
    event Withdraw(
        address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares
    );
    event EpochFrozen(uint256 indexed epochId, bytes32 indexed snapshotHash, uint256 nav, uint256 timestamp);
    event EpochSettled(
        uint256 indexed epochId,
        uint256 totalShares,
        uint256 totalAssets,
        uint256 carryAccrued,
        uint256 proRataRatio,
        uint256 processedCount
    );
    event SettlementChunkProcessed(
        uint256 indexed epochId, uint256 startIndex, uint256 endIndex, uint256 processedInChunk, uint256 totalProcessed
    );
    event SettlementResumed(uint256 indexed epochId, uint256 resumeIndex);
    event EpochFinalized(uint256 indexed epochId);
    event CarryAccrued(uint256 indexed epochId, uint256 totalCarry, uint256 distributionRate);
    event CarryClaimed(uint256 indexed requestId, address indexed controller, uint256 carryAmount);
    event EmergencyModeSet(bool active);
    event DustClaimed(uint256 indexed requestId, address indexed controller, uint256 assets);
    event NAVUpdated(uint256 nav, uint256 timestamp);
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    event LossRealized(uint256 indexed epochId, uint256 lossAmount, uint256 requestsAffected);
    event RequestLossAttributed(uint256 indexed requestId, uint256 lossAmount, uint256 newAccrued);
    event CapitalDeployed(uint256 amount, uint256 newTotal);
    event CapitalRecalled(uint256 amount, uint256 newTotal);

    error Unauthorized(address caller);
    error NotController(address controller, address caller);
    error NotOwner(address owner, address caller);
    error InvalidRequest(uint256 requestId);
    error RequestNotPending(uint256 requestId);
    error RequestNotClaimable(uint256 requestId);
    error EpochNotActive(uint256 epochId);
    error EpochNotFrozen(uint256 epochId);
    error EpochNotEnded(uint256 epochId);
    error EpochAlreadySettled(uint256 epochId);
    error EpochNotSettled(uint256 epochId);
    error NoPendingRequests(uint256 epochId);
    error RedemptionCancellationDisabled();
    error InsufficientShares(uint256 requested, uint256 available);
    error ZeroAmount();
    error InvalidAddress();
    error NAVStale(uint256 lastUpdate, uint256 threshold);
    error EmergencyModeActive();
    error SettlementIncomplete(uint256 epochId);
    error BelowClaimThreshold(uint256 amount, uint256 threshold);
    error SettlementChunkInvalid(uint256 startIndex, uint256 endIndex, uint256 expectedStart);
    error SettlementChunkComplete(uint256 epochId);
    error SettlementAlreadyStarted(uint256 epochId);
    error EpochNotFinalized(uint256 epochId);
    error NotDust(uint256 amount, uint256 threshold);
    error EpochNotSettledOrFinalized(uint256 epochId);
    error LossExceedsCarryRemaining(uint256 lossAmount, uint256 carryRemaining);
    error NoClaimableRequests(uint256 epochId);

    constructor(
        address _asset,
        address _admin,
        address _settler,
        address _navUpdater,
        address _snapshotter,
        address _depositProcessor,
        address _tradingSafe,
        uint256 _epochDuration,
        uint256 _navStalenessThreshold,
        uint256 _minClaimThreshold,
        uint256 _balancedUpfrontBps
    ) ERC20("Epoch Tranche Vault", "ETV") {
        if (_asset == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();
        if (_settler == address(0)) revert InvalidAddress();
        if (_navUpdater == address(0)) revert InvalidAddress();
        if (_snapshotter == address(0)) revert InvalidAddress();
        if (_depositProcessor == address(0)) revert InvalidAddress();
        if (_tradingSafe == address(0)) revert InvalidAddress();
        if (_epochDuration == 0) revert InvalidAddress();
        if (_navStalenessThreshold == 0) revert InvalidAddress();

        asset = IERC20_0(_asset);
        tradingSafe = _tradingSafe;
        EPOCH_DURATION = _epochDuration;
        NAV_STALENESS_THRESHOLD = _navStalenessThreshold;
        MIN_CLAIM_THRESHOLD = _minClaimThreshold;
        BALANCED_UPFRONT_BPS = _balancedUpfrontBps;
        DEPLOY_TIME = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(SETTLER_ROLE, _settler);
        _grantRole(NAV_UPDATER_ROLE, _navUpdater);
        _grantRole(SNAPSHOT_ROLE, _snapshotter);
        _grantRole(DEPOSIT_PROCESSOR_ROLE, _depositProcessor);

        epochs[0] = Epoch({
            epochId: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + _epochDuration,
            epochOpenNAV: 1e18,
            snapshotNAV: 0,
            snapshotTimestamp: 0,
            totalSharesPending: 0,
            frozenShares: 0,
            frozenAssets: 0,
            proRataRatio: PRORATA_PRECISION,
            carryAccrued: 0,
            cohortTotalAccrued: 0,
            cohortTotalEntitlement: 0,
            cohortTotalClaimed: 0,
            cohortCarryRemaining: 0,
            status: EpochStatus.Active,
            exists: true
        });
        currentEpochId = 0;
        nextDepositRequestId = 1;
        nextRedemptionRequestId = 1;

        lastNAVUpdate = block.timestamp;
    }

    function queueDeposit(uint256 assets) external nonReentrant returns (uint256 requestId) {
        if (assets == 0) revert ZeroAmount();
        if (emergencyMode) revert EmergencyModeActive();
        uint256 targetEpoch = currentEpochId + 1;
        requestId = depositorEpochRequest[msg.sender][targetEpoch];
        if (requestId != 0) {
            DepositRequest storage existingRequest = depositRequests[requestId];
            if (!existingRequest.exists || existingRequest.processed) revert InvalidRequest(requestId);
            existingRequest.assets += assets;
            totalQueuedAssets += assets;
            asset.safeTransferFrom(msg.sender, address(this), assets);
            emit DepositQueued(requestId, msg.sender, existingRequest.assets, targetEpoch);
        } else {
            requestId = nextDepositRequestId++;
            depositRequests[requestId] = DepositRequest({
                requestId: requestId,
                depositor: msg.sender,
                assets: assets,
                targetEpoch: targetEpoch,
                createdAt: block.timestamp,
                processed: false,
                exists: true
            });
            depositorEpochRequest[msg.sender][targetEpoch] = requestId;
            epochDepositRequests[targetEpoch].push(requestId);
            totalQueuedAssets += assets;
            asset.safeTransferFrom(msg.sender, address(this), assets);
            emit DepositQueued(requestId, msg.sender, assets, targetEpoch);
        }
        return requestId;
    }

    function processDepositQueue(uint256 epochId, uint256 startIndex, uint256 endIndex)
        external
        onlyRole(DEPOSIT_PROCESSOR_ROLE)
        nonReentrant
    {
        Epoch storage epoch = epochs[epochId];
        if (!epoch.exists) revert InvalidRequest(epochId);
        if (epoch.status != EpochStatus.Active && epoch.status != EpochStatus.Frozen) revert EpochNotActive(epochId);
        if (block.timestamp < epoch.startTime) revert EpochNotActive(epochId);
        uint256[] storage requests = epochDepositRequests[epochId];
        if (endIndex > requests.length) endIndex = requests.length;
        for (uint256 i = startIndex; i < endIndex; i++) {
            DepositRequest storage request = depositRequests[requests[i]];
            if (!request.exists || request.processed) continue;
            uint256 shares = _convertAssetsToShares(request.assets, epoch.epochOpenNAV);
            _mint(request.depositor, shares);
            request.processed = true;
            totalQueuedAssets -= request.assets;
            emit DepositProcessed(request.requestId, request.depositor, request.assets, shares, epochId);
        }
    }

    function requestRedeem(uint256 shares, address controller, address owner)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroAmount();
        if (controller == address(0)) revert InvalidAddress();
        if (owner == address(0)) revert InvalidAddress();
        if (emergencyMode) revert EmergencyModeActive();
        if (msg.sender != owner) revert NotOwner(owner, msg.sender);
        Epoch storage epoch = epochs[currentEpochId];
        if (epoch.status != EpochStatus.Active) revert EpochNotActive(currentEpochId);
        requestId = nextRedemptionRequestId++;
        redemptionRequests[requestId] = RedemptionRequest({
            requestId: requestId,
            controller: controller,
            owner: owner,
            shares: shares,
            assetsClaimable: 0,
            carryDeducted: 0,
            entitlement: 0,
            accrued: 0,
            claimed: 0,
            carryRemaining: 0,
            epochId: currentEpochId,
            status: RequestStatus.Pending,
            createdAt: block.timestamp,
            settledAt: 0,
            exists: true
        });
        epochRedemptionRequests[currentEpochId].push(requestId);
        controllerToRequestId[controller] = requestId;
        totalPendingRedeemShares += shares;
        epoch.totalSharesPending += shares;
        IERC20_0(address(this)).safeTransferFrom(owner, address(this), shares);
        _burn(address(this), shares);
        emit RedeemRequest(controller, owner, requestId, msg.sender, shares);
        return requestId;
    }

    function cancelRedeemRequest(uint256 requestId) external pure returns (uint256 cancelledShares) {
        requestId;
        cancelledShares = 0;
        revert RedemptionCancellationDisabled();
    }

    function redeem(uint256 requestId, uint256 shares, address receiver)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidAddress();
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (!request.exists) revert InvalidRequest(requestId);
        if (request.controller != msg.sender) revert NotController(request.controller, msg.sender);
        if (request.status != RequestStatus.Claimable) revert RequestNotClaimable(requestId);
        if (shares > request.shares) revert InsufficientShares(shares, request.shares);
        Epoch storage epoch = epochs[request.epochId];
        assets = (shares * epoch.frozenAssets) / epoch.frozenShares;
        uint256 carry = (assets * epoch.carryAccrued) / PRORATA_PRECISION;
        assets -= carry;
        if (epoch.status != EpochStatus.Finalized && assets < MIN_CLAIM_THRESHOLD) {
            revert BelowClaimThreshold(assets, MIN_CLAIM_THRESHOLD);
        }

        // Update ledger tracking
        request.shares -= shares;
        request.assetsClaimable -= assets;
        request.carryDeducted += carry;
        request.claimed += assets;
        request.carryRemaining -= carry;
        epoch.cohortTotalClaimed += assets;
        epoch.cohortCarryRemaining -= carry;

        if (request.shares == 0) request.status = RequestStatus.Claimed;
        if (assets > reservedRedemptionAssets) {
            reservedRedemptionAssets = 0;
        } else {
            reservedRedemptionAssets -= assets;
        }
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, request.controller, assets, shares);
        return assets;
    }

    function withdraw(uint256 requestId, uint256 assets, address receiver)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidAddress();
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (!request.exists) revert InvalidRequest(requestId);
        if (request.controller != msg.sender) revert NotController(request.controller, msg.sender);
        if (request.status != RequestStatus.Claimable) revert RequestNotClaimable(requestId);
        Epoch storage epoch = epochs[request.epochId];
        uint256 grossAssets = (assets * PRORATA_PRECISION) / (PRORATA_PRECISION - epoch.carryAccrued);
        shares = (grossAssets * epoch.frozenShares) / epoch.frozenAssets;
        if (shares > request.shares) revert InsufficientShares(shares, request.shares);
        uint256 carry = grossAssets - assets;
        if (epoch.status != EpochStatus.Finalized && assets < MIN_CLAIM_THRESHOLD) {
            revert BelowClaimThreshold(assets, MIN_CLAIM_THRESHOLD);
        }

        // Update ledger tracking
        request.shares -= shares;
        request.assetsClaimable -= assets;
        request.carryDeducted += carry;
        request.claimed += assets;
        request.carryRemaining -= carry;
        epoch.cohortTotalClaimed += assets;
        epoch.cohortCarryRemaining -= carry;

        if (request.shares == 0) request.status = RequestStatus.Claimed;
        if (assets > reservedRedemptionAssets) {
            reservedRedemptionAssets = 0;
        } else {
            reservedRedemptionAssets -= assets;
        }
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, request.controller, assets, shares);
        return shares;
    }

    function claimDust(uint256 requestId) external nonReentrant returns (uint256 assets) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (!request.exists) revert InvalidRequest(requestId);
        if (request.controller != msg.sender) revert NotController(request.controller, msg.sender);
        if (request.status != RequestStatus.Claimable) revert RequestNotClaimable(requestId);
        Epoch storage epoch = epochs[request.epochId];
        if (epoch.status != EpochStatus.Finalized) revert EpochNotFinalized(request.epochId);
        assets = request.assetsClaimable;
        uint256 remainingCarry = request.carryRemaining;
        if (assets >= MIN_CLAIM_THRESHOLD) revert NotDust(assets, MIN_CLAIM_THRESHOLD);

        // Update ledger tracking for dust claim

        // Update ledger tracking for dust claim
        request.shares = 0;
        request.assetsClaimable = 0;
        request.carryDeducted += remainingCarry;
        request.claimed += assets;
        request.carryRemaining = 0;
        request.status = RequestStatus.Claimed;
        epoch.cohortTotalClaimed += assets;
        epoch.cohortCarryRemaining -= remainingCarry;
        if (assets > reservedRedemptionAssets) {
            reservedRedemptionAssets = 0;
        } else {
            reservedRedemptionAssets -= assets;
        }

        asset.safeTransfer(request.controller, assets);
        emit DustClaimed(requestId, request.controller, assets);
        return assets;
    }

    function freezeEpoch(bytes32 snapshotHash) external onlyRole(SNAPSHOT_ROLE) {
        Epoch storage epoch = epochs[currentEpochId];
        if (epoch.status != EpochStatus.Active) revert EpochNotActive(currentEpochId);
        _requireFreshNAV();
        uint256 shareBackedAssets = epoch.totalSharesPending == 0 ? 0 : _convertSharesToAssets(epoch.totalSharesPending, currentNAV);
        epoch.frozenShares = epoch.totalSharesPending;
        if (totalPendingRedeemShares > epoch.totalSharesPending) {
            totalPendingRedeemShares -= epoch.totalSharesPending;
        } else {
            totalPendingRedeemShares = 0;
        }
        epoch.frozenAssets = shareBackedAssets;
        reservedRedemptionAssets += shareBackedAssets;
        epoch.status = EpochStatus.Frozen;
        epoch.snapshotNAV = currentNAV;
        epoch.snapshotTimestamp = block.timestamp;
        uint256[] storage requests = epochRedemptionRequests[currentEpochId];
        for (uint256 i = 0; i < requests.length; i++) {
            RedemptionRequest storage request = redemptionRequests[requests[i]];
            if (request.exists && request.status == RequestStatus.Pending) request.status = RequestStatus.Frozen;
        }
        epochSnapshots[currentEpochId] = TrancheSnapshot({
            snapshotHash: snapshotHash,
            totalValue: shareBackedAssets,
            timestamp: block.timestamp,
            realizationDeadline: block.timestamp + 30 days,
            exists: true
        });
        uint256 nextEpochId = currentEpochId + 1;
        epochs[nextEpochId] = Epoch({
            epochId: nextEpochId,
            startTime: epoch.endTime,
            endTime: epoch.endTime + EPOCH_DURATION,
            epochOpenNAV: currentNAV,
            snapshotNAV: 0,
            snapshotTimestamp: 0,
            totalSharesPending: 0,
            frozenShares: 0,
            frozenAssets: 0,
            proRataRatio: PRORATA_PRECISION,
            carryAccrued: 0,
            cohortTotalEntitlement: 0,
            cohortTotalAccrued: 0,
            cohortTotalClaimed: 0,
            cohortCarryRemaining: 0,
            status: EpochStatus.Active,
            exists: true
        });
        currentEpochId = nextEpochId;
        emit EpochFrozen(currentEpochId - 1, snapshotHash, currentNAV, block.timestamp);
    }

    function settleEpoch(uint256 epochId, uint256 carryAmount) external onlyRole(SETTLER_ROLE) nonReentrant {
        _settleEpochChunk(epochId, carryAmount, 0);
    }

    function settleEpochChunk(uint256 epochId, uint256 carryAmount, uint256 startIndex)
        external
        onlyRole(SETTLER_ROLE)
        nonReentrant
    {
        _settleEpochChunk(epochId, carryAmount, startIndex);
    }

    function _settleEpochChunk(uint256 epochId, uint256 carryAmount, uint256 startIndex) internal {
        Epoch storage epoch = epochs[epochId];
        if (!epoch.exists) revert InvalidRequest(epochId);
        if (epoch.status != EpochStatus.Frozen && epoch.status != EpochStatus.Settling) revert EpochNotFrozen(epochId);
        if (block.timestamp < epoch.endTime) revert EpochNotEnded(epochId);
        _requireFreshNAV();
        if (epoch.frozenShares == 0) revert NoPendingRequests(epochId);
        uint256 proRataRatio = epoch.proRataRatio;
        if (proRataRatio == PRORATA_PRECISION) {
            if (epoch.frozenAssets < epoch.frozenShares) {
                proRataRatio = (epoch.frozenAssets * PRORATA_PRECISION) / epoch.frozenShares;
            }
            epoch.proRataRatio = proRataRatio;
        }
        uint256[] storage requests = epochRedemptionRequests[epochId];
        uint256 totalRequests = requests.length;
        if (totalRequests == 0) {
            epoch.status = EpochStatus.Settled;
            epoch.carryAccrued = carryAmount;
            if (epoch.frozenAssets > reservedRedemptionAssets) {
                reservedRedemptionAssets = 0;
            } else {
                reservedRedemptionAssets -= epoch.frozenAssets;
            }
            settlementProgress[epochId] =
                SettlementProgress({processedCount: 0, totalCount: 0, lastProcessedIndex: 0, complete: true});
            emit EpochSettled(epochId, epoch.frozenShares, epoch.frozenAssets, carryAmount, proRataRatio, 0);
            return;
        }
        SettlementProgress storage progress = settlementProgress[epochId];
        if (progress.processedCount > 0) {
            uint256 expectedStart = progress.lastProcessedIndex + 1;
            if (startIndex != expectedStart) revert SettlementChunkInvalid(startIndex, 0, expectedStart);
        }
        if (startIndex >= totalRequests) revert SettlementChunkInvalid(startIndex, 0, totalRequests);
        if (progress.complete) revert SettlementChunkComplete(epochId);
        uint256 endIndex = startIndex + MAX_CHUNK_SIZE;
        if (endIndex > totalRequests) endIndex = totalRequests;
        if (progress.processedCount == 0) {
            epoch.status = EpochStatus.Settling;
            epoch.carryAccrued = carryAmount;
            progress.totalCount = totalRequests;
        }
        uint256 processedInChunk = 0;
        for (uint256 i = startIndex; i < endIndex; i++) {
            uint256 requestId = requests[i];
            RedemptionRequest storage request = redemptionRequests[requestId];
            if (!request.exists || request.status != RequestStatus.Frozen) continue;

            // Calculate gross entitlement (before carry)
            uint256 entitlement =
                (request.shares * epoch.frozenAssets * proRataRatio) / (epoch.frozenShares * PRORATA_PRECISION);
            // Calculate carry for this request
            uint256 carry = (entitlement * carryAmount) / PRORATA_PRECISION;

            request.status = RequestStatus.Claimable;
            request.assetsClaimable = entitlement - carry;
            request.entitlement = entitlement;
            request.accrued = carry;
            request.carryRemaining = carry;
            request.settledAt = block.timestamp;

            // Update cohort aggregates
            epoch.cohortTotalEntitlement += entitlement;
            epoch.cohortCarryRemaining += carry;
            epoch.cohortTotalAccrued += carry;        // FIX: Initialize cohortTotalAccrued
            processedInChunk++;
        }
        progress.processedCount += processedInChunk;
        progress.lastProcessedIndex = endIndex - 1;
        bool isComplete = (endIndex >= totalRequests);
        if (isComplete) {
            epoch.status = EpochStatus.Settled;
            progress.complete = true;
            uint256 netClaimableAssets = epoch.cohortTotalEntitlement - epoch.cohortTotalAccrued;
            if (epoch.frozenAssets > reservedRedemptionAssets) {
                reservedRedemptionAssets = netClaimableAssets;
            } else {
                reservedRedemptionAssets = reservedRedemptionAssets - epoch.frozenAssets + netClaimableAssets;
            }
            emit EpochSettled(
                epochId, epoch.frozenShares, epoch.frozenAssets, carryAmount, proRataRatio, progress.processedCount
            );
        }
        emit SettlementChunkProcessed(epochId, startIndex, endIndex, processedInChunk, progress.processedCount);
    }

    function resumeSettlement(uint256 epochId, uint256 carryAmount) external onlyRole(SETTLER_ROLE) nonReentrant {
        SettlementProgress storage progress = settlementProgress[epochId];
        if (progress.complete) revert SettlementChunkComplete(epochId);
        if (progress.processedCount == 0) revert SettlementChunkInvalid(0, 0, 0);
        uint256 resumeIndex = progress.lastProcessedIndex + 1;
        emit SettlementResumed(epochId, resumeIndex);
        _settleEpochChunk(epochId, carryAmount, resumeIndex);
    }

    function getSettlementProgress(uint256 epochId)
        external
        view
        returns (uint256 processed, uint256 total, uint256 lastIndex, bool isComplete)
    {
        SettlementProgress storage progress = settlementProgress[epochId];
        return (progress.processedCount, progress.totalCount, progress.lastProcessedIndex, progress.complete);
    }

    function finalizeEpoch(uint256 epochId) external onlyRole(SETTLER_ROLE) {
        Epoch storage epoch = epochs[epochId];
        if (!epoch.exists) revert InvalidRequest(epochId);
        if (epoch.status != EpochStatus.Settled) revert EpochNotSettled(epochId);
        epoch.status = EpochStatus.Finalized;
        emit EpochFinalized(epochId);
    }

    /// @notice Realize a loss and attribute it proportionally across all claimable redemption requests in an epoch
    /// @dev Loss is distributed based on shares proportion to ensure cohort-fair allocation
    /// @param epochId The epoch to realize loss for
    /// @param lossAmount The total loss amount to realize
    function realizeLoss(uint256 epochId, uint256 lossAmount) external onlyRole(SETTLER_ROLE) nonReentrant {
        Epoch storage epoch = epochs[epochId];
        if (!epoch.exists) revert InvalidRequest(epochId);
        if (epoch.status != EpochStatus.Settled && epoch.status != EpochStatus.Finalized) {
            revert EpochNotSettledOrFinalized(epochId);
        }
        if (lossAmount == 0) revert ZeroAmount();
        if (lossAmount > epoch.cohortCarryRemaining) {
            revert LossExceedsCarryRemaining(lossAmount, epoch.cohortCarryRemaining);
        }

        // First pass: calculate total claimable shares
        uint256 totalClaimableShares;
        {
            uint256[] storage requests = epochRedemptionRequests[epochId];
            for (uint256 i = 0; i < requests.length; i++) {
                RedemptionRequest storage request = redemptionRequests[requests[i]];
                if (request.exists && request.status == RequestStatus.Claimable && request.shares > 0) {
                    totalClaimableShares += request.shares;
                }
            }
        }

        if (totalClaimableShares == 0) revert NoClaimableRequests(epochId);

        // Second pass: apply loss proportionally
        uint256 requestsAffected;
        {
            uint256[] storage requests = epochRedemptionRequests[epochId];
            for (uint256 i = 0; i < requests.length; i++) {
                RedemptionRequest storage request = redemptionRequests[requests[i]];
                if (request.exists && request.status == RequestStatus.Claimable && request.shares > 0) {
                    uint256 requestLoss = (lossAmount * request.shares) / totalClaimableShares;
                    if (requestLoss > request.carryRemaining) requestLoss = request.carryRemaining;

                    request.accrued -= requestLoss;
                    request.carryRemaining -= requestLoss;
                    epoch.cohortCarryRemaining -= requestLoss;

                    requestsAffected++;
                    emit RequestLossAttributed(requests[i], requestLoss, request.accrued);
                }
            }
        }

        epoch.cohortTotalAccrued = epoch.cohortTotalClaimed + epoch.cohortCarryRemaining;
        emit LossRealized(epochId, lossAmount, requestsAffected);
        emit LossRealized(epochId, lossAmount, requestsAffected);
    }

    function deployCapital(uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        uint256 vaultBalance = asset.balanceOf(address(this));
        uint256 unavailableBalance = totalQueuedAssets + reservedRedemptionAssets;
        uint256 availableVaultBalance = vaultBalance > unavailableBalance ? vaultBalance - unavailableBalance : 0;
        if (amount > availableVaultBalance) revert InsufficientShares(amount, availableVaultBalance);
        
        deployedCapital += amount;
        asset.safeTransfer(tradingSafe, amount);
        
        emit CapitalDeployed(amount, deployedCapital);
    }

    function recallCapital(uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        if (amount > deployedCapital) revert InsufficientShares(amount, deployedCapital);
        
        deployedCapital -= amount;
        asset.safeTransferFrom(tradingSafe, address(this), amount);
        
        emit CapitalRecalled(amount, deployedCapital);
    }

    function getDeployedCapital() external view returns (uint256) {
        return deployedCapital;
    }

    function updateNAV(uint256 _nav) external onlyRole(NAV_UPDATER_ROLE) {
        currentNAV = _nav;
        lastNAVUpdate = block.timestamp;
        emit NAVUpdated(_nav, block.timestamp);
    }

    function setEmergencyMode(bool _active) external onlyRole(ADMIN_ROLE) {
        emergencyMode = _active;
        emit EmergencyModeSet(_active);
    }

    function setOperator(address operator, bool approved) external returns (bool) {
        if (operator == address(0)) revert InvalidAddress();
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    function pendingRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (request.exists && request.controller == controller && request.status == RequestStatus.Pending) {
            return request.shares;
        }
        return 0;
    }

    function claimableRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (request.exists && request.controller == controller && request.status == RequestStatus.Claimable) {
            return request.shares;
        }
        return 0;
    }

    function getCurrentEpoch() external view returns (uint256) {
        return EpochMath.getCurrentEpoch(DEPLOY_TIME, EPOCH_DURATION);
    }

    function getEpochEnd(uint256 epochId) external view returns (uint256) {
        return epochs[epochId].endTime;
    }

    function decimals() public view override returns (uint8) {
        return IERC20Metadata_0(address(asset)).decimals();
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this)) + deployedCapital;
    }

    function liquidAssets() public view returns (uint256) {
        uint256 grossAssets = totalAssets();
        uint256 reservedAssets = totalQueuedAssets + reservedRedemptionAssets;
        return grossAssets > reservedAssets ? grossAssets - reservedAssets : 0;
    }

    function isNAVFresh() external view returns (bool) {
        return block.timestamp - lastNAVUpdate <= NAV_STALENESS_THRESHOLD;
    }

    function _requireFreshNAV() internal view {
        if (block.timestamp - lastNAVUpdate > NAV_STALENESS_THRESHOLD) {
            revert NAVStale(lastNAVUpdate, NAV_STALENESS_THRESHOLD);
        }
    }

    function _convertAssetsToShares(uint256 assets, uint256 nav) internal pure returns (uint256) {
        if (nav == 0) return assets;
        return (assets * 1e18) / nav;
    }

    function _convertSharesToAssets(uint256 shares, uint256 nav) internal pure returns (uint256) {
        if (nav == 0) return shares;
        return (shares * nav) / 1e18;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IERC165_0).interfaceId || interfaceId == IERC7540_REDEEM_INTERFACE_ID
            || interfaceId == IERC7540_CLAIM_INTERFACE_ID || super.supportsInterface(interfaceId);
    }
    uint256[50] private __gap;
}

