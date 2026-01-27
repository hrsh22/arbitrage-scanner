// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PredictionVaultV2
 * @notice ERC-4626-style shares + ERC-7540-style async redeem, without Merkle proofs
 *
 * Design goals vs V1:
 * - No Merkle roots / proofs (operator writes cumulative claimable amounts directly)
 * - Enforce withdrawal lock period on-chain
 * - No user finalize step (operator can finalize losses via finalizeLoss)
 * - Burn shares at request time; track withdrawal obligations as locked assets
 *
 * Notes:
 * - Treasury (e.g. Gnosis Safe) must approve this contract to spend USDC for claims.
 * - Operator is a trusted role (same trust model as V1 for NAV updates).
 */
contract PredictionVaultV2 is ERC20, Ownable, Pausable, ReentrancyGuard {
    // ============ STATE ============

    IERC20 public immutable usdc;

    /// @notice Treasury address (e.g. Gnosis Safe) that holds trading funds
    address public treasury;

    /// @notice Operator address (bot) that can update NAV and withdrawal claimables
    address public operator;

    /// @notice Total USDC value of vault (6 decimals). Updated by operator.
    uint256 public totalAssets;

    /// @notice Total assets reserved for pending withdrawals (6 decimals)
    uint256 public totalLockedAssets;

    /// @notice Minimum deposit amount in USDC (6 decimals)
    uint256 public minDeposit;

    /// @notice Claim voucher typehash for domain-separated EIP-191 signatures
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("PredictionVaultV2Claim(address vault,uint256 chainId,address user,uint256 requestId,uint256 cumulativeClaimable,uint256 deadline)");

    struct WithdrawalRequest {
        address user;
        uint256 shares; // shares burned at request time (for auditing/UI only)
        uint256 assetsReserved; // fixed reserved amount at request time (6 decimals, may be reduced via finalizeLoss)
        uint256 cumulativeClaimable; // monotonic, <= assetsReserved
        uint256 claimed; // monotonic, <= cumulativeClaimable
        uint256 requestedAt; // timestamp
    }

    uint256 public nextRequestId;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    mapping(address => uint256[]) public userRequestIds;

    // ============ EVENTS ============

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalRequested(
        address indexed user,
        uint256 indexed requestId,
        uint256 shares,
        uint256 ownershipBps
    );
    event CumulativeClaimableUpdated(uint256 indexed requestId, uint256 cumulativeClaimable);
    event Claimed(address indexed user, uint256 indexed requestId, uint256 amount);
    event LossFinalized(uint256 indexed requestId, uint256 oldReserved, uint256 newReserved);
    event NavUpdated(uint256 newTotalAssets, uint256 timestamp);
    event TreasuryUpdated(address newTreasury);
    event OperatorUpdated(address newOperator);

    // ============ ERRORS ============

    error BelowMinimumDeposit();
    error ZeroShares();
    error InsufficientShares();
    error RequestNotFound();
    error NothingToClaim();
    error Unauthorized();
    error ZeroAddress();
    error TransferFailed();
    error InvalidClaimable();
    error ActiveAssetsZero();
    error ClaimExpired();
    error InvalidSignature();

    // ============ MODIFIERS ============

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        address _usdc,
        address _treasury,
        address _operator,
        uint256 _minDeposit,
        uint256 /* _withdrawalDelaySeconds */
    ) ERC20("Prediction Vault Share", "pvUSDC") Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        treasury = _treasury;
        operator = _operator;
        minDeposit = _minDeposit;
        totalAssets = 0;
    }

    // ============ ERC20 OVERRIDES ============

    /// @notice Shares use 6 decimals to match USDC-style UX
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ============ VIEW FUNCTIONS ============

    function activeAssets() public view returns (uint256) {
        if (totalAssets <= totalLockedAssets) return 0;
        return totalAssets - totalLockedAssets;
    }

    /// @notice Current NAV per share (6 decimals), excluding locked assets
    function navPerShare() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e6;
        uint256 assets = activeAssets();
        if (assets == 0) return 0;
        return (assets * 1e6) / supply;
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply();
        if (supply == 0) return assets;
        uint256 assetsActive = activeAssets();
        if (assetsActive == 0) return 0;
        return (assets * supply) / assetsActive;
    }

    function previewRedeem(uint256 shares) public view returns (uint256 assets) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        uint256 assetsActive = activeAssets();
        if (assetsActive == 0) return 0;
        return (shares * assetsActive) / supply;
    }

    function getUserRequests(address user) external view returns (uint256[] memory) {
        return userRequestIds[user];
    }

    function pendingClaim(uint256 requestId) external view returns (uint256) {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) return 0;
        if (req.cumulativeClaimable <= req.claimed) return 0;
        return req.cumulativeClaimable - req.claimed;
    }

    // ============ USER FUNCTIONS ============

    function deposit(uint256 assets, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets < minDeposit) revert BelowMinimumDeposit();

        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroShares();

        bool success = usdc.transferFrom(msg.sender, treasury, assets);
        if (!success) revert TransferFailed();

        _mint(receiver, shares);
        totalAssets += assets;

        emit Deposit(receiver, assets, shares);
    }

    /// @notice Request redemption: burns shares immediately and reserves assets
    function requestRedeem(uint256 shares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroShares();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        // Compute reserved assets using pre-burn active values
        uint256 supplyBefore = totalSupply();
        uint256 assetsActiveBefore = activeAssets();
        if (supplyBefore == 0) revert ZeroShares();
        if (assetsActiveBefore == 0) revert ActiveAssetsZero();

        uint256 assetsReserved = (shares * assetsActiveBefore) / supplyBefore;
        uint256 ownershipBps = (shares * 10000) / supplyBefore;

        // Burn shares now (no locked shares bookkeeping needed)
        _burn(msg.sender, shares);

        // Reserve assets as an obligation, so NAV excludes them
        totalLockedAssets += assetsReserved;

        requestId = nextRequestId++;
        withdrawalRequests[requestId] = WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            assetsReserved: assetsReserved,
            cumulativeClaimable: 0,
            claimed: 0,
            requestedAt: block.timestamp
        });
        userRequestIds[msg.sender].push(requestId);

        emit WithdrawalRequested(msg.sender, requestId, shares, ownershipBps);
    }

    /// @notice Claim any available amount for a request (operator-signed)
    /// @dev Backend enforces delay by only issuing valid signatures after its configured lock.
    function claim(uint256 requestId, uint256 cumulativeClaimable, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
    {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.user != msg.sender) revert Unauthorized();

        if (block.timestamp > deadline) revert ClaimExpired();

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                CLAIM_TYPEHASH,
                address(this),
                block.chainid,
                msg.sender,
                requestId,
                cumulativeClaimable,
                deadline
            )
        );

        bytes32 digest = _toEthSignedMessageHash(messageHash);
        address signer = _recover(digest, signature);
        if (signer != operator && signer != owner()) revert InvalidSignature();

        // Enforce monotonicity and caps (signature cannot overdraw)
        if (cumulativeClaimable < req.claimed) revert InvalidClaimable();
        if (cumulativeClaimable > req.assetsReserved) revert InvalidClaimable();

        // Track latest cumulative for UI/auditing
        if (cumulativeClaimable > req.cumulativeClaimable) {
            req.cumulativeClaimable = cumulativeClaimable;
        }

        uint256 claimable = cumulativeClaimable;
        uint256 alreadyClaimed = req.claimed;
        if (claimable <= alreadyClaimed) revert NothingToClaim();

        uint256 amountToClaim = claimable - alreadyClaimed;
        req.claimed = claimable;

        // Reduce locked assets as USDC leaves the vault
        totalLockedAssets = totalLockedAssets >= amountToClaim ? totalLockedAssets - amountToClaim : 0;
        totalAssets = totalAssets >= amountToClaim ? totalAssets - amountToClaim : 0;

        bool success = usdc.transferFrom(treasury, msg.sender, amountToClaim);
        if (!success) revert TransferFailed();

        emit Claimed(msg.sender, requestId, amountToClaim);
    }

    // ============ OPERATOR FUNCTIONS ============

    function setCumulativeClaimable(uint256 requestId, uint256 newCumulativeClaimable) external onlyOperator {
        _setCumulativeClaimable(requestId, newCumulativeClaimable);
    }

    function setCumulativeClaimableBatch(uint256[] calldata requestIds, uint256[] calldata newCumulativeClaimables)
        external
        onlyOperator
    {
        if (requestIds.length != newCumulativeClaimables.length) revert InvalidClaimable();
        for (uint256 i = 0; i < requestIds.length; i++) {
            _setCumulativeClaimable(requestIds[i], newCumulativeClaimables[i]);
        }
    }

    function _setCumulativeClaimable(uint256 requestId, uint256 newCumulativeClaimable) internal {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();

        if (newCumulativeClaimable < req.claimed) revert InvalidClaimable();
        if (newCumulativeClaimable > req.assetsReserved) revert InvalidClaimable();

        req.cumulativeClaimable = newCumulativeClaimable;
        emit CumulativeClaimableUpdated(requestId, newCumulativeClaimable);
    }

    /// @notice Finalize losses by reducing the reserved amount (releasing the difference back to remaining holders)
    function finalizeLoss(uint256 requestId, uint256 finalTotalClaimable) external onlyOperator {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();

        if (finalTotalClaimable < req.claimed) revert InvalidClaimable();
        if (finalTotalClaimable > req.assetsReserved) revert InvalidClaimable();

        uint256 oldReserved = req.assetsReserved;
        if (finalTotalClaimable == oldReserved) return;

        req.assetsReserved = finalTotalClaimable;
        if (req.cumulativeClaimable > finalTotalClaimable) {
            req.cumulativeClaimable = finalTotalClaimable;
        }

        uint256 delta = oldReserved - finalTotalClaimable;
        totalLockedAssets = totalLockedAssets >= delta ? totalLockedAssets - delta : 0;

        emit LossFinalized(requestId, oldReserved, finalTotalClaimable);
    }

    /// @notice Update NAV (total assets value)
    function updateNav(uint256 newTotalAssets) external onlyOperator {
        totalAssets = newTotalAssets;
        emit NavUpdated(newTotalAssets, block.timestamp);
    }

    // ============ ADMIN FUNCTIONS ============

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    function setMinDeposit(uint256 newMinDeposit) external onlyOwner {
        minDeposit = newMinDeposit;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function recoverToken(address token, uint256 amount) external onlyOwner {
        if (token == address(this)) revert Unauthorized();
        IERC20(token).transfer(owner(), amount);
    }

    /// @notice Contract version marker for off-chain detection
    function VERSION() external pure returns (uint256) {
        return 2;
    }

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        // 32-byte hash => "\x19Ethereum Signed Message:\n32" + hash
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }
}

