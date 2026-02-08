// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title PredictionVault
 * @notice ERC-4626-style vault with resolution-based withdrawals via Merkle proofs
 * @dev 
 * Architecture:
 * - Users deposit USDC → receive vault shares (pvUSDC)
 * - Deposits go to treasury (Gnosis Safe) for trading
 * - Withdrawals are resolution-based:
 *   1. User requests redemption → shares locked, ownership % snapshotted
 *   2. Bot tracks position resolutions off-chain
 *   3. Bot submits Merkle root of claimable amounts per request
 *   4. User claims with Merkle proof → receives USDC
 *
 * Why Merkle?
 * - Polymarket uses off-chain CLOB with limit orders
 * - Positions resolve async, impossible to track per-fill on-chain
 * - Merkle lets bot submit ONE hash covering all users' claims
 * - User proves their claim with a proof path
 */
contract PredictionVault is ERC20, Ownable, Pausable, ReentrancyGuard {
    // ============ STATE ============

    IERC20 public immutable usdc;
    
    /// @notice Treasury address (Gnosis Safe) that holds trading funds
    address public treasury;

    /// @notice Operator address that can submit claim roots (trading bot)
    address public operator;

    /// @notice Total USDC value of vault (updated by operator)
    uint256 public totalAssets;
    
    /// @notice Total shares locked in pending withdrawals (excluded from NAV)
    uint256 public totalLockedShares;

    /// @notice Total assets reserved for pending withdrawals
    uint256 public totalLockedAssets;
    
    /// @notice Minimum deposit amount in USDC (6 decimals)
    uint256 public minDeposit;

    /// @notice Withdrawal request structure
    struct WithdrawalRequest {
        address user;
        uint256 shares;           // Shares locked for this request
        uint256 ownershipBps;     // Ownership % at request time (basis points, 10000 = 100%)
        uint256 assetsReserved;   // Assets reserved at request time
        uint256 requestedAt;      // Timestamp of request
        uint256 totalClaimable;   // Total USDC claimable (set when finalized)
        uint256 claimed;          // USDC already claimed
        bool finalized;           // True when all positions resolved
    }

    uint256 public nextRequestId;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    mapping(address => uint256[]) public userRequestIds;

    /// @notice Merkle root for each withdrawal request's claimable amount
    /// @dev Bot submits root, user proves their claimable amount against it
    mapping(uint256 => bytes32) public claimRoots;

    /// @notice Tracks cumulative claims per request to prevent over-claiming
    /// @dev Leaf format: keccak256(abi.encodePacked(requestId, cumulativeClaimable))
    mapping(uint256 => uint256) public cumulativeClaimed;

    // ============ EVENTS ============

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalRequested(
        address indexed user, 
        uint256 indexed requestId, 
        uint256 shares, 
        uint256 ownershipBps
    );
    event ClaimRootUpdated(uint256 indexed requestId, bytes32 root, uint256 totalClaimable);
    event Claimed(address indexed user, uint256 indexed requestId, uint256 amount);
    event WithdrawalFinalized(uint256 indexed requestId, uint256 totalPayout);
    event WithdrawalCancelled(address indexed user, uint256 indexed requestId);
    event NavUpdated(uint256 newTotalAssets, uint256 timestamp);
    event TreasuryUpdated(address newTreasury);
    event OperatorUpdated(address newOperator);

    // ============ ERRORS ============

    error BelowMinimumDeposit();
    error ZeroShares();
    error InsufficientShares();
    error RequestNotFound();
    error AlreadyFinalized();
    error NotFinalized();
    error InvalidProof();
    error NothingToClaim();
    error Unauthorized();
    error ZeroAddress();
    error TransferFailed();

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
        uint256 _minDeposit
    ) ERC20("Prediction Vault Share", "pvUSDC") Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        treasury = _treasury;
        operator = _operator;
        minDeposit = _minDeposit;
        totalAssets = 0;
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Active shares (excluding locked ones in withdrawals)
    function activeShares() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply <= totalLockedShares) return 0;
        return supply - totalLockedShares;
    }

    /// @notice Active assets (excluding reserved for withdrawals)
    function activeAssets() public view returns (uint256) {
        if (totalAssets <= totalLockedAssets) return 0;
        return totalAssets - totalLockedAssets;
    }

    /// @notice Current NAV per share (6 decimals) - excludes locked shares/assets
    function navPerShare() public view returns (uint256) {
        uint256 active = activeShares();
        if (active == 0) return 1e6;
        return (activeAssets() * 1e6) / active;
    }

    /// @notice Preview shares received for a deposit
    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        uint256 active = activeShares();
        if (active == 0) return assets;
        return (assets * active) / activeAssets();
    }

    /// @notice Preview assets for shares at current NAV (informational only)
    function previewRedeem(uint256 shares) public view returns (uint256 assets) {
        uint256 active = activeShares();
        if (active == 0) return 0;
        return (shares * activeAssets()) / active;
    }

    /// @notice Get all request IDs for a user
    function getUserRequests(address user) external view returns (uint256[] memory) {
        return userRequestIds[user];
    }

    /// @notice Get pending claimable amount for a request (what user can claim now)
    function pendingClaim(uint256 requestId) external view returns (uint256) {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) return 0;
        return req.totalClaimable - req.claimed;
    }

    /// @notice ERC-7540 compatible: Get pending shares for a redeem request
    /// @dev Returns shares still locked (not yet redeemed)
    function pendingRedeemRequest(uint256 requestId) external view returns (uint256) {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0) || req.finalized) return 0;
        return req.shares;
    }

    /// @notice ERC-7540 compatible: Get claimable assets for a redeem request
    /// @dev Returns USDC amount user can claim right now
    function claimableRedeemRequest(uint256 requestId) external view returns (uint256) {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) return 0;
        return req.totalClaimable - req.claimed;
    }

    // ============ USER FUNCTIONS ============

    /// @notice Deposit USDC and receive vault shares
    /// @param assets Amount of USDC to deposit (6 decimals)
    /// @param receiver Address to receive the shares
    function deposit(uint256 assets, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets < minDeposit) revert BelowMinimumDeposit();

        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroShares();

        // Transfer USDC to treasury
        bool success = usdc.transferFrom(msg.sender, treasury, assets);
        if (!success) revert TransferFailed();

        // Mint shares
        _mint(receiver, shares);
        totalAssets += assets;

        emit Deposit(receiver, assets, shares);
    }

    /// @notice Request redemption - locks shares and snapshots ownership (ERC-7540 compatible naming)
    /// @param shares Amount of shares to redeem
    /// @return requestId The redemption request ID
    function requestRedeem(uint256 shares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroShares();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        // Calculate ownership and assets BEFORE locking (using active shares/assets)
        uint256 active = activeShares();
        uint256 ownershipBps = (shares * 10000) / active;
        uint256 assetsReserved = (shares * activeAssets()) / active;

        // Lock shares in contract
        _transfer(msg.sender, address(this), shares);
        
        // Track locked amounts for NAV calculation
        totalLockedShares += shares;
        totalLockedAssets += assetsReserved;

        // Create request
        requestId = nextRequestId++;
        withdrawalRequests[requestId] = WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            ownershipBps: ownershipBps,
            assetsReserved: assetsReserved,
            requestedAt: block.timestamp,
            totalClaimable: 0,
            claimed: 0,
            finalized: false
        });
        userRequestIds[msg.sender].push(requestId);

        emit WithdrawalRequested(msg.sender, requestId, shares, ownershipBps);
    }

    /// @notice Claim resolved USDC using Merkle proof
    /// @dev Leaf = keccak256(abi.encodePacked(requestId, cumulativeClaimable))
    /// @param requestId The withdrawal request ID
    /// @param cumulativeClaimable Total claimable so far (from Merkle tree)
    /// @param merkleProof Proof path to verify the claim
    function claim(
        uint256 requestId,
        uint256 cumulativeClaimable,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.user != msg.sender) revert Unauthorized();

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(requestId, cumulativeClaimable));
        if (!MerkleProof.verify(merkleProof, claimRoots[requestId], leaf)) {
            revert InvalidProof();
        }

        // Calculate new amount to claim
        uint256 alreadyClaimed = req.claimed;
        if (cumulativeClaimable <= alreadyClaimed) revert NothingToClaim();
        
        uint256 amountToClaim = cumulativeClaimable - alreadyClaimed;
        req.claimed = cumulativeClaimable;

        // Update totalClaimable if this is higher
        if (cumulativeClaimable > req.totalClaimable) {
            req.totalClaimable = cumulativeClaimable;
        }

        // Burn shares proportionally: (amountToClaim / assetsReserved) * shares
        uint256 sharesToBurn = 0;
        if (req.assetsReserved > 0 && req.shares > 0) {
            sharesToBurn = (amountToClaim * req.shares) / req.assetsReserved;
            if (sharesToBurn > req.shares) {
                sharesToBurn = req.shares;
            }
            req.shares -= sharesToBurn;
            totalLockedShares -= sharesToBurn;
            _burn(address(this), sharesToBurn);
        }

        // Reduce locked assets as USDC leaves the vault
        if (totalLockedAssets >= amountToClaim) {
            totalLockedAssets -= amountToClaim;
        } else {
            totalLockedAssets = 0;
        }
        if (totalAssets >= amountToClaim) {
            totalAssets -= amountToClaim;
        } else {
            totalAssets = 0;
        }

        // Transfer USDC from treasury to user
        bool success = usdc.transferFrom(treasury, msg.sender, amountToClaim);
        if (!success) revert TransferFailed();

        emit Claimed(msg.sender, requestId, amountToClaim);
    }

    /// @notice Finalize withdrawal after all positions resolved
    /// @dev Burns any remaining shares (from losses) and marks request complete
    /// @param requestId The withdrawal request ID
    function finalizeWithdrawal(uint256 requestId) external nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.user != msg.sender) revert Unauthorized();
        if (req.finalized) revert AlreadyFinalized();

        // Must have claimed everything available
        if (req.claimed < req.totalClaimable) revert NothingToClaim();

        // Burn any remaining shares (positions that lost)
        if (req.shares > 0) {
            totalLockedShares -= req.shares;
            _burn(address(this), req.shares);
            req.shares = 0;
        }

        req.finalized = true;

        emit WithdrawalFinalized(requestId, req.claimed);
    }

    // ============ OPERATOR FUNCTIONS ============

    /// @notice Submit Merkle root for a withdrawal request's claims
    /// @dev Called by bot as positions resolve
    /// @param requestId The withdrawal request ID
    /// @param root Merkle root of all claims
    /// @param totalClaimable Total claimable amount for this request
    function submitClaimRoot(
        uint256 requestId,
        bytes32 root,
        uint256 totalClaimable
    ) external onlyOperator {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.finalized) revert AlreadyFinalized();

        claimRoots[requestId] = root;
        req.totalClaimable = totalClaimable;

        emit ClaimRootUpdated(requestId, root, totalClaimable);
    }

    /// @notice Update NAV (total assets value)
    /// @param newTotalAssets New total value in USDC (6 decimals)
    function updateNav(uint256 newTotalAssets) external onlyOperator {
        totalAssets = newTotalAssets;
        emit NavUpdated(newTotalAssets, block.timestamp);
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Cancel a withdrawal and return shares to user
    /// @dev Only for stuck/problematic requests
    function cancelWithdrawal(uint256 requestId) external onlyOwner {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        if (req.user == address(0)) revert RequestNotFound();
        if (req.finalized) revert AlreadyFinalized();
        if (req.claimed > 0) revert NothingToClaim();

        // Release locked amounts
        totalLockedShares -= req.shares;
        totalLockedAssets -= req.assetsReserved;

        req.finalized = true;
        _transfer(address(this), req.user, req.shares);

        emit WithdrawalCancelled(req.user, requestId);
    }

    /// @notice Update treasury address
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /// @notice Update operator address (trading bot)
    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    /// @notice Update minimum deposit
    function setMinDeposit(uint256 newMinDeposit) external onlyOwner {
        minDeposit = newMinDeposit;
    }

    /// @notice Pause deposits and withdrawals
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause deposits and withdrawals
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency: recover stuck tokens (not vault shares)
    /// @dev Vault normally holds 0 USDC (all goes to treasury).
    ///      This recovers any tokens accidentally sent here.
    function recoverToken(address token, uint256 amount) external onlyOwner {
        if (token == address(this)) revert Unauthorized();
        IERC20(token).transfer(owner(), amount);
    }
}
