// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @dev Minimal interface for Polymarket Conditional Token Framework (CTF) contract.
interface IPolymarketConditionalTokens {
    /// @dev Returns balance of conditional tokens for a given token ID and holder.
    function balanceOf(address holder, uint256 tokenId) external view returns (uint256);

    /// @dev Safely transfers conditional tokens from one account to another.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data)
        external;
}
