// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (c) 2025 Morpho Association
pragma solidity >=0.5.0;

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
