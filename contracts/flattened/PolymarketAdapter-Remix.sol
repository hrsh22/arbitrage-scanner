// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.28 >=0.4.16 >=0.5.0 >=0.6.2 ^0.8.20;

// lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol

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

// lib/openzeppelin-contracts/contracts/utils/introspection/IERC165.sol

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
interface IERC165 {
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

// lib/vault-v2/src/interfaces/IERC20.sol

// Copyright (c) 2025 Morpho Association

interface IERC20_1 {
    function decimals() external view returns (uint8);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 shares) external returns (bool success);
    function transferFrom(address from, address to, uint256 shares) external returns (bool success);
    function approve(address spender, uint256 shares) external returns (bool success);
    function allowance(address owner, address spender) external view returns (uint256);
}

// lib/vault-v2/src/interfaces/IERC2612.sol

// Copyright (c) 2025 Morpho Association

interface IERC2612 {
    function permit(address owner, address spender, uint256 shares, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

// src/Constants.sol

/// @dev All Polygon contract addresses as constants for Polymarket Vault
library Constants {
    address internal constant USDC_E = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address internal constant CTF = 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045;
    address internal constant CTF_EXCHANGE = 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E;
    address internal constant NEGRISK_CTF_EXCHANGE = 0xC5d563A36AE78145C45a50134d48A1215220f80a;
    address internal constant NEGRISK_ADAPTER = 0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296;
    address internal constant VAULT_V2_FACTORY = 0xA1D94F746dEfa1928926b84fB2596c06926C0405;
    address internal constant POLYMARKET_CONDITIONAL_TOKENS = CTF;
}

// src/interfaces/IAdapter.sol

// Copyright (c) 2025 Morpho Association

/// @dev See VaultV2 NatSpec comments for more details on adapter's spec.
interface IAdapter {
    /// @dev Returns the market' ids and the change in assets on this market.
    function allocate(bytes memory data, uint256 assets, bytes4 selector, address sender)
        external
        returns (bytes32[] memory ids, int256 change);

    /// @dev Returns the market' ids and the change in assets on this market.
    function deallocate(bytes memory data, uint256 assets, bytes4 selector, address sender)
        external
        returns (bytes32[] memory ids, int256 change);

    /// @dev Returns the current value of the investments of the adapter (in underlying asset).
    function realAssets() external view returns (uint256 assets);

    /// @dev Returns the total deployed amount (Safe balance + position cost basis).
    /// @notice This should be a live view for deterministic headroom calculations.
    function totalDeployed() external view returns (uint256);

    /// @dev Returns the complete deploy state for backend headroom calculations.
    /// @notice Use this for atomic deploy-state queries to avoid race conditions.
    function getDeployState()
        external
        view
        returns (
            uint256 deployed,
            uint256 costBasis,
            uint256 safeBalance,
            uint256 adapterBalance,
            uint256 maxDeployable
        );
}

// lib/openzeppelin-contracts/contracts/interfaces/IERC165.sol

// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC165.sol)

// lib/openzeppelin-contracts/contracts/interfaces/IERC20.sol

// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC20.sol)

// lib/vault-v2/src/interfaces/IERC4626.sol

// Copyright (c) 2025 Morpho Association

interface IERC4626 is IERC20_1 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function convertToShares(uint256 assets) external view returns (uint256 shares);
    function deposit(uint256 assets, address onBehalf) external returns (uint256 shares);
    function mint(uint256 shares, address onBehalf) external returns (uint256 assets);
    function withdraw(uint256 assets, address receiver, address onBehalf) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address onBehalf) external returns (uint256 assets);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewMint(uint256 shares) external view returns (uint256 assets);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);
    function maxDeposit(address onBehalf) external view returns (uint256 assets);
    function maxMint(address onBehalf) external view returns (uint256 shares);
    function maxWithdraw(address onBehalf) external view returns (uint256 assets);
    function maxRedeem(address onBehalf) external view returns (uint256 shares);
}

// lib/vault-v2/src/interfaces/IVaultV2.sol

// Copyright (c) 2025 Morpho Association

struct Caps {
    uint256 allocation;
    uint128 absoluteCap;
    uint128 relativeCap;
}

interface IVaultV2 is IERC4626, IERC2612 {
    // State variables
    function virtualShares() external view returns (uint256);
    function owner() external view returns (address);
    function curator() external view returns (address);
    function receiveSharesGate() external view returns (address);
    function sendSharesGate() external view returns (address);
    function receiveAssetsGate() external view returns (address);
    function sendAssetsGate() external view returns (address);
    function adapterRegistry() external view returns (address);
    function isSentinel(address account) external view returns (bool);
    function isAllocator(address account) external view returns (bool);
    function firstTotalAssets() external view returns (uint256);
    function _totalAssets() external view returns (uint128);
    function lastUpdate() external view returns (uint64);
    function maxRate() external view returns (uint64);
    function adapters(uint256 index) external view returns (address);
    function adaptersLength() external view returns (uint256);
    function isAdapter(address account) external view returns (bool);
    function allocation(bytes32 id) external view returns (uint256);
    function absoluteCap(bytes32 id) external view returns (uint256);
    function relativeCap(bytes32 id) external view returns (uint256);
    function forceDeallocatePenalty(address adapter) external view returns (uint256);
    function liquidityAdapter() external view returns (address);
    function liquidityData() external view returns (bytes memory);
    function timelock(bytes4 selector) external view returns (uint256);
    function abdicated(bytes4 selector) external view returns (bool);
    function executableAt(bytes memory data) external view returns (uint256);
    function performanceFee() external view returns (uint96);
    function performanceFeeRecipient() external view returns (address);
    function managementFee() external view returns (uint96);
    function managementFeeRecipient() external view returns (address);

    // Gating
    function canSendShares(address account) external view returns (bool);
    function canReceiveShares(address account) external view returns (bool);
    function canSendAssets(address account) external view returns (bool);
    function canReceiveAssets(address account) external view returns (bool);

    // Multicall
    function multicall(bytes[] memory data) external;

    // Owner functions
    function setOwner(address newOwner) external;
    function setCurator(address newCurator) external;
    function setIsSentinel(address account, bool isSentinel) external;
    function setName(string memory newName) external;
    function setSymbol(string memory newSymbol) external;

    // Timelocks for curator functions
    function submit(bytes memory data) external;
    function revoke(bytes memory data) external;

    // Curator functions
    function setIsAllocator(address account, bool newIsAllocator) external;
    function setReceiveSharesGate(address newReceiveSharesGate) external;
    function setSendSharesGate(address newSendSharesGate) external;
    function setReceiveAssetsGate(address newReceiveAssetsGate) external;
    function setSendAssetsGate(address newSendAssetsGate) external;
    function setAdapterRegistry(address newAdapterRegistry) external;
    function addAdapter(address account) external;
    function removeAdapter(address account) external;
    function increaseTimelock(bytes4 selector, uint256 newDuration) external;
    function decreaseTimelock(bytes4 selector, uint256 newDuration) external;
    function abdicate(bytes4 selector) external;
    function setPerformanceFee(uint256 newPerformanceFee) external;
    function setManagementFee(uint256 newManagementFee) external;
    function setPerformanceFeeRecipient(address newPerformanceFeeRecipient) external;
    function setManagementFeeRecipient(address newManagementFeeRecipient) external;
    function increaseAbsoluteCap(bytes memory idData, uint256 newAbsoluteCap) external;
    function decreaseAbsoluteCap(bytes memory idData, uint256 newAbsoluteCap) external;
    function increaseRelativeCap(bytes memory idData, uint256 newRelativeCap) external;
    function decreaseRelativeCap(bytes memory idData, uint256 newRelativeCap) external;
    function setMaxRate(uint256 newMaxRate) external;
    function setForceDeallocatePenalty(address adapter, uint256 newForceDeallocatePenalty) external;

    // Allocator functions
    function allocate(address adapter, bytes memory data, uint256 assets) external;
    function deallocate(address adapter, bytes memory data, uint256 assets) external;
    function setLiquidityAdapterAndData(address newLiquidityAdapter, bytes memory newLiquidityData) external;

    // Exchange rate
    function accrueInterest() external;
    function accrueInterestView()
        external
        view
        returns (uint256 newTotalAssets, uint256 performanceFeeShares, uint256 managementFeeShares);

    // Force deallocate
    function forceDeallocate(address adapter, bytes memory data, uint256 assets, address onBehalf)
        external
        returns (uint256 penaltyShares);
}

// lib/openzeppelin-contracts/contracts/interfaces/IERC1363.sol

// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC1363.sol)

/**
 * @title IERC1363
 * @dev Interface of the ERC-1363 standard as defined in the https://eips.ethereum.org/EIPS/eip-1363[ERC-1363].
 *
 * Defines an extension interface for ERC-20 tokens that supports executing code on a recipient contract
 * after `transfer` or `transferFrom`, or code on a spender contract after `approve`, in a single transaction.
 */
interface IERC1363 is IERC20_0, IERC165 {
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

// lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol

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

// src/PolymarketAdapter.sol

/// @title Polymarket Adapter
/// @notice Morpho Vault V2 adapter that routes deployed USDC.e to a Gnosis Safe for trading.
contract PolymarketAdapter is IAdapter {
    using SafeERC20 for IERC20_0;

    uint256 public constant MAX_DEPLOYED_RATIO_BPS = 10_000;
    uint256 public constant BPS = 10_000;
    uint256 public constant NAV_STALENESS_THRESHOLD = 1 hours;

    address public immutable parentVault;
    address public immutable safe;
    IERC20_0 public immutable asset;
    bytes32 public immutable adapterId;

    address public navUpdater;
    uint256 public totalPositionCostBasis;
    uint256 public lastNavUpdate;
    uint256 private _totalDeployedCached;
    /// @notice Deploys the adapter and configures static dependencies.
    /// @param _parentVault Morpho Vault V2 using this adapter.
    /// @param _safe Gnosis Safe that custodies deployed capital.
    /// @param _asset Vault asset expected to be USDC.e.
    /// @param _navUpdater Authorized EOA allowed to push position cost basis updates.
    constructor(address _parentVault, address _safe, address _asset, address _navUpdater) {
        require(_parentVault != address(0), "invalid vault");
        require(_safe != address(0), "invalid safe");
        require(_asset == Constants.USDC_E, "invalid asset");
        require(_asset == IVaultV2(_parentVault).asset(), "asset mismatch");
        require(_navUpdater != address(0), "invalid nav updater");

        parentVault = _parentVault;
        safe = _safe;
        asset = IERC20_0(_asset);
        navUpdater = _navUpdater;
        adapterId = keccak256(abi.encode("PolymarketAdapter", address(this)));
        lastNavUpdate = block.timestamp;

        IERC20_0(_asset).forceApprove(_parentVault, type(uint256).max);
    }

    /// @notice Returns the total amount deployed to the Safe plus position cost basis.
    /// @dev This is a live view using current Safe balance, NOT a cached historical counter.
    ///      Backend should use this for deterministic headroom calculations.
    function totalDeployed() public view returns (uint256) {
        return asset.balanceOf(safe) + totalPositionCostBasis;
    }

    /// @notice Returns the complete deploy state for backend headroom calculations.
    /// @return deployed The current deployed amount (Safe balance + position cost basis)
    /// @return costBasis The total position cost basis tracked by navUpdater
    /// @return safeBalance The live USDC.e balance of the Safe
    /// @return adapterBalance The USDC.e balance held by this adapter (idle)
    /// @return maxDeployable The maximum allowed deployed based on vault totalAssets and cap ratio
    function getDeployState()
        external
        view
        returns (
            uint256 deployed,
            uint256 costBasis,
            uint256 safeBalance,
            uint256 adapterBalance,
            uint256 maxDeployable
        )
    {
        safeBalance = asset.balanceOf(safe);
        adapterBalance = asset.balanceOf(address(this));
        costBasis = totalPositionCostBasis;
        deployed = safeBalance + costBasis;

        uint256 vaultTotalAssets = IVaultV2(parentVault).totalAssets();
        maxDeployable = (vaultTotalAssets * MAX_DEPLOYED_RATIO_BPS) / BPS;
    }

    /// @notice Moves idle vault assets to Safe for market deployment.
    /// @dev Called only by the parent vault after transferring assets to this adapter.
    function allocate(bytes memory, uint256 assets, bytes4, address) external returns (bytes32[] memory, int256) {
        require(msg.sender == parentVault, "not authorized");

        uint256 maxDeployable = (IVaultV2(parentVault).totalAssets() * MAX_DEPLOYED_RATIO_BPS) / BPS;
        // Use live calculation for cap check - same as totalDeployed()
        uint256 currentDeployed = asset.balanceOf(safe) + totalPositionCostBasis;
        require(currentDeployed + assets <= maxDeployable, "deploy cap exceeded");

        if (assets > 0) {
            asset.safeTransfer(safe, assets);
        }

        // Sync the cached value for events/off-chain tracking (not used for cap logic)
        _syncTotalDeployedCached();

        return (ids(), _toInt256(assets));
    }

    /// @notice Pulls assets back from Safe so the parent vault can pull them.
    /// @dev Safe must pre-approve this adapter for USDC.e.
    function deallocate(bytes memory, uint256 assets, bytes4, address) external returns (bytes32[] memory, int256) {
        require(msg.sender == parentVault, "not authorized");

        if (assets > 0) {
            asset.safeTransferFrom(safe, address(this), assets);
        }

        // Sync the cached value for events/off-chain tracking (not used for cap logic)
        _syncTotalDeployedCached();

        return (ids(), -_toInt256(assets));
    }

    /// @notice Returns total adapter-controlled assets used by the vault for accounting.
    /// @dev Reverts when NAV data is stale beyond NAV_STALENESS_THRESHOLD.
    function realAssets() external view returns (uint256) {
        require(block.timestamp - lastNavUpdate <= NAV_STALENESS_THRESHOLD, "NAV stale");

        return asset.balanceOf(address(this)) + asset.balanceOf(safe) + totalPositionCostBasis;
    }

    /// @notice Updates tracked open-position cost basis used by realAssets.
    /// @param newTotalCostBasis Aggregate cost basis of all open prediction market positions.
    function updatePositionValues(uint256 newTotalCostBasis) external {
        require(msg.sender == navUpdater, "not nav updater");

        totalPositionCostBasis = newTotalCostBasis;
        lastNavUpdate = block.timestamp;
        _syncTotalDeployedCached();
    }

    /// @notice Updates the NAV updater address.
    /// @param newNavUpdater New authorized NAV updater EOA.
    function setNavUpdater(address newNavUpdater) external {
        require(msg.sender == IVaultV2(parentVault).owner(), "not vault owner");
        require(newNavUpdater != address(0), "invalid nav updater");

        navUpdater = newNavUpdater;
    }

    /// @notice Returns this adapter's single risk id for VaultV2 cap accounting.
    function ids() public view returns (bytes32[] memory ids_) {
        ids_ = new bytes32[](1);
        ids_[0] = adapterId;
    }

    function _toInt256(uint256 value) internal pure returns (int256) {
        require(value <= uint256(type(int256).max), "int overflow");
        return int256(value);
    }
    /// @notice Syncs the cached totalDeployed value for off-chain tracking.
    /// @dev This is NOT used for cap enforcement - cap uses live balanceOf calculation.
    function _syncTotalDeployedCached() internal {
        _totalDeployedCached = asset.balanceOf(safe) + totalPositionCostBasis;
    }
}

