// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC7575} from "./IERC7575.sol";

interface IERC7540Operator {
    event OperatorSet(address indexed controller, address indexed operator, bool approved);

    function setOperator(address operator, bool approved) external returns (bool);
    function isOperator(address controller, address operator) external view returns (bool status);
}

interface IERC7540Deposit is IERC7540Operator {
    event DepositRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets
    );

    function requestDeposit(uint256 assets, address controller, address owner) external returns (uint256 requestId);
    function pendingDepositRequest(uint256 requestId, address controller) external view returns (uint256 pendingAssets);
    function claimableDepositRequest(uint256 requestId, address controller) external view returns (uint256 claimableAssets);
    function deposit(uint256 assets, address receiver, address controller) external returns (uint256 shares);
    function mint(uint256 shares, address receiver, address controller) external returns (uint256 assets);
}

interface IERC7540Redeem is IERC7540Operator {
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );

    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256 requestId);
    function pendingRedeemRequest(uint256 requestId, address controller) external view returns (uint256 pendingShares);
    function claimableRedeemRequest(uint256 requestId, address controller) external view returns (uint256 claimableShares);
}

interface IERC7540 is IERC7540Deposit, IERC7540Redeem, IERC7575 {}
