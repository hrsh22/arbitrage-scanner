// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ClosedBookBatchVault
/// @notice A canonical closed-book vault with batched deposits, escrowed redemptions, and settlement
/// @dev Implements ERC-7540 async patterns without carry/partial-realization accounting.
///      Shares requested for redemption remain economically live until settlement, then burn at settlement.
///      Lifecycle: OPEN -> CUTOFF -> FLATTENING -> SETTLING -> SETTLED -> CLOSED -> REOPEN
contract ClosedBookBatchVault is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // ROLES
    // ============================================================================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");
    bytes32 public constant SNAPSHOT_ROLE = keccak256("SNAPSHOT_ROLE");
    bytes32 public constant DEPOSIT_PROCESSOR_ROLE = keccak256("DEPOSIT_PROCESSOR_ROLE");

    // ============================================================================
    // IMMUTABLE CONFIGURATION
    // ============================================================================

    IERC20 public immutable asset;
    uint256 public immutable DEPLOY_TIME;
    uint256 public immutable NAV_STALENESS_THRESHOLD;
    address public immutable tradingWallet;

    // ============================================================================
    // BATCH/CYCLE STATE
    // ============================================================================

    /// @notice Lifecycle states for a batch/cycle
    enum BatchStatus {
        Open,       // Accepting deposits and redemptions
        Cutoff,     // Deposits closed, redemptions frozen
        Flattening, // NAV snapshot taken, positions marked
        Settling,   // Settlement in progress (chunked)
        Settled,    // Settlement complete, claims available
        Closed,     // Claims window ended
        Reopen      // Ready to start next cycle
    }

    /// @notice Batch/cycle data structure
    struct Batch {
        uint256 batchId;
        uint256 startTime;
        uint256 endTime;
        uint256 cutoffTime;
        uint256 snapshotNAV;            // NAV at batch start
        uint256 lockedClearingPrice;    // Locked price at flatten (excludes sealed deposits)
        uint256 snapshotTimestamp;
        uint256 totalSharesPending;     // Shares pending redemption
        uint256 totalAssetsSnapshot;    // Asset value of pending shares at snapshot NAV
        uint256 proRataRatio;           // Applied if insufficient assets (1e18 = 100%)
        uint256 totalQueuedDeposits;    // Assets queued for this batch (excluded from price calc)
        BatchStatus status;
        bool isPriceLocked;             // True after flattenBatch locks the price
        bool exists;
    }

    /// @notice Deposit request state
    enum DepositStatus { Pending, Processed, Cancelled }

    /// @notice Deposit request data
    struct DepositRequest {
        uint256 requestId;
        address depositor;
        uint256 assets;
        uint256 targetBatch;
        uint256 createdAt;
        DepositStatus status;
        bool exists;
    }

    /// @notice Redemption request state
    enum RedemptionStatus { Pending, Escrowed, Claimable, Claimed, Cancelled }

    /// @notice Redemption request data
    /// @dev Shares are held in escrow by the vault until settlement
    struct RedemptionRequest {
        uint256 requestId;
        address controller;
        address owner;
        uint256 shares;             // Shares in escrow
        uint256 assetsClaimable;    // Assets available after settlement
        uint256 batchId;
        RedemptionStatus status;
        uint256 createdAt;
        uint256 settledAt;
        bool exists;
    }

    // ============================================================================
    // STORAGE
    // ============================================================================

    mapping(uint256 => Batch) public batches;
    uint256 public currentBatchId;

    mapping(uint256 => DepositRequest) public depositRequests;
    mapping(uint256 => uint256[]) public batchDepositRequests;
    mapping(address => mapping(uint256 => uint256)) public depositorBatchRequest;
    uint256 public nextDepositRequestId;
    uint256 public totalQueuedAssets;

    mapping(uint256 => RedemptionRequest) public redemptionRequests;
    mapping(uint256 => uint256[]) public batchRedemptionRequests;
    mapping(address => uint256[]) private controllerRequestIds;
    mapping(address => uint256) public controllerToRequestId;
    mapping(address => mapping(address => bool)) public isOperator;
    uint256 public nextRedemptionRequestId;
    uint256 public totalPendingRedeemShares;
    uint256 public reservedRedemptionAssets;
    mapping(uint256 => uint256) public reservedRedemptionAssetsByBatch;

    uint256 public currentNAV;
    uint256 public lastNAVUpdate;
    bool public emergencyMode;

    mapping(uint256 => uint256) public nextRequestIndexToProcess;
    uint256 public constant MAX_CHUNK_SIZE = 100;
    uint256 public constant PRORATA_PRECISION = 1e18;

    struct SettlementProgress {
        uint256 processedCount;
        uint256 totalCount;
        uint256 lastProcessedIndex;
        uint256 reservedAssetsAllocated;
        bool complete;
    }
    mapping(uint256 => SettlementProgress) public settlementProgress;

    // ============================================================================
    // ERC-7540 INTERFACE IDS
    // ============================================================================

    bytes4 constant IERC7540_REDEEM_INTERFACE_ID = 0x620ee8e4;
    bytes4 constant IERC7540_CLAIM_INTERFACE_ID = 0x2f0a18c5;

    // ============================================================================
    // EVENTS
    // ============================================================================

    // Deposit events
    event DepositQueued(uint256 indexed requestId, address indexed depositor, uint256 assets, uint256 targetBatch);
    event DepositProcessed(
        uint256 indexed requestId, address indexed depositor, uint256 assets, uint256 sharesMinted, uint256 batchId
    );
    event DepositCancelled(uint256 indexed requestId, address indexed depositor, uint256 assets);

    // Redemption events (ERC-7540 aligned)
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );
    event SharesEscrowed(uint256 indexed requestId, address indexed controller, uint256 shares);
    event RedeemRequestCancelled(uint256 indexed requestId, address indexed controller, uint256 shares);
    event Withdraw(
        address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares
    );

    // Batch/Cycle events
    event BatchCutoff(uint256 indexed batchId, uint256 cutoffTime);
    event BatchFlattened(uint256 indexed batchId, bytes32 indexed snapshotHash, uint256 nav, uint256 timestamp);
    event BatchSettled(
        uint256 indexed batchId,
        uint256 totalShares,
        uint256 totalAssets,
        uint256 proRataRatio,
        uint256 processedCount
    );
    event SettlementChunkProcessed(
        uint256 indexed batchId, uint256 startIndex, uint256 endIndex, uint256 processedInChunk, uint256 totalProcessed
    );
    event BatchClosed(uint256 indexed batchId);
    event BatchReopened(uint256 indexed newBatchId, uint256 startTime, uint256 endTime);

    // Admin events
    event EmergencyModeSet(bool active);
    event NAVUpdated(uint256 nav, uint256 timestamp);
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    event CapitalAllocated(address indexed tradingWallet, uint256 amount);
    event ERC20Rescued(address indexed token, address indexed receiver, uint256 amount);
    event UnderlyingSurplusRescued(address indexed receiver, uint256 amount);

    // ============================================================================
    // ERRORS
    // ============================================================================

    error Unauthorized(address caller);
    error NotController(address controller, address caller);
    error NotOwner(address owner, address caller);
    error InvalidRequest(uint256 requestId);
    error RequestNotPending(uint256 requestId);
    error RequestNotClaimable(uint256 requestId);
    error RequestNotEscrowed(uint256 requestId);
    error BatchNotOpen(uint256 batchId);
    error BatchNotCutoff(uint256 batchId);
    error BatchNotFlattening(uint256 batchId);
    error BatchNotSettling(uint256 batchId);
    error BatchNotSettled(uint256 batchId);
    error BatchAlreadySettled(uint256 batchId);
    error BatchNotClosed(uint256 batchId);
    error NoPendingRequests(uint256 batchId);
    error InsufficientShares(uint256 requested, uint256 available);
    error ZeroAmount();
    error InvalidAddress();
    error NAVStale(uint256 lastUpdate, uint256 threshold);
    error EmergencyModeActive();
    error SettlementIncomplete(uint256 batchId);
    error SettlementAlreadyComplete(uint256 batchId);
    error CannotCancelAfterCutoff(uint256 batchId, uint256 cutoffTime);
    error BatchAlreadyExists(uint256 batchId);
    error PriceNotLocked(uint256 batchId);
    error InvalidToken(address token);
    error EmergencyModeRequired();
    error RescueExceedsSurplus(uint256 requested, uint256 available);
    error InvalidRescueState(uint256 batchId, BatchStatus status);
    error InvalidOperatorController(address owner, address controller);
    error ReservedAssetUnderflow(uint256 requested, uint256 reserved);
    error NoActionableWork(uint256 batchId);
    error CapitalAllocationBlocked(uint256 batchId, BatchStatus status);
    error AllocationExceedsAvailable(uint256 requested, uint256 available);

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    constructor(
        address _asset,
        address _admin,
        address _settler,
        address _navUpdater,
        address _snapshotter,
        address _depositProcessor,
        address _tradingWallet,
        uint256 _navStalenessThreshold
    ) ERC20("Closed Book Batch Vault", "CBBV") {
        if (_asset == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();
        if (_settler == address(0)) revert InvalidAddress();
        if (_navUpdater == address(0)) revert InvalidAddress();
        if (_snapshotter == address(0)) revert InvalidAddress();
        if (_depositProcessor == address(0)) revert InvalidAddress();
        if (_tradingWallet == address(0)) revert InvalidAddress();
        if (_navStalenessThreshold == 0) revert InvalidAddress();

        asset = IERC20(_asset);
        tradingWallet = _tradingWallet;
        NAV_STALENESS_THRESHOLD = _navStalenessThreshold;
        DEPLOY_TIME = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(SETTLER_ROLE, _settler);
        _grantRole(NAV_UPDATER_ROLE, _navUpdater);
        _grantRole(SNAPSHOT_ROLE, _snapshotter);
        _grantRole(DEPOSIT_PROCESSOR_ROLE, _depositProcessor);

        // Initialize batch 0
        batches[0] = Batch({
            batchId: 0,
            startTime: block.timestamp,
            endTime: 0,
            cutoffTime: 0,
            snapshotNAV: 1e18,
            lockedClearingPrice: 0,
            snapshotTimestamp: 0,
            totalSharesPending: 0,
            totalAssetsSnapshot: 0,
            proRataRatio: PRORATA_PRECISION,
            totalQueuedDeposits: 0,
            status: BatchStatus.Open,
            isPriceLocked: false,
            exists: true
        });
        currentBatchId = 0;
        currentNAV = 1e18;
        nextDepositRequestId = 1;
        nextRedemptionRequestId = 1;
        lastNAVUpdate = block.timestamp;
    }

    // ============================================================================
    // DEPOSIT FUNCTIONS
    // ============================================================================

    /// @notice Queue a deposit for the next batch
    /// @param assets Amount of assets to deposit
    /// @return requestId The ID of the deposit request
    function queueDeposit(uint256 assets) external nonReentrant returns (uint256 requestId) {
        if (assets == 0) revert ZeroAmount();
        if (emergencyMode) revert EmergencyModeActive();

        // Auto-create next batch if needed
        _ensureNextBatchExists();

        Batch storage currentBatch = batches[currentBatchId];
        if (currentBatch.status != BatchStatus.Open) revert BatchNotOpen(currentBatchId);

        uint256 targetBatchId = currentBatchId + 1;
        Batch storage targetBatch = batches[targetBatchId];

        // Check if user already has a pending request for this target batch
        requestId = depositorBatchRequest[msg.sender][targetBatchId];
        if (requestId != 0) {
            DepositRequest storage existing = depositRequests[requestId];
            if (existing.exists && existing.status == DepositStatus.Pending) {
                existing.assets += assets;
                totalQueuedAssets += assets;
                targetBatch.totalQueuedDeposits += assets;
                asset.safeTransferFrom(msg.sender, address(this), assets);
                emit DepositQueued(requestId, msg.sender, existing.assets, targetBatchId);
                return requestId;
            }
        }

        requestId = nextDepositRequestId++;
        depositRequests[requestId] = DepositRequest({
            requestId: requestId,
            depositor: msg.sender,
            assets: assets,
            targetBatch: targetBatchId,
            createdAt: block.timestamp,
            status: DepositStatus.Pending,
            exists: true
        });
        depositorBatchRequest[msg.sender][targetBatchId] = requestId;
        batchDepositRequests[targetBatchId].push(requestId);
        totalQueuedAssets += assets;
        targetBatch.totalQueuedDeposits += assets;

        asset.safeTransferFrom(msg.sender, address(this), assets);
        emit DepositQueued(requestId, msg.sender, assets, targetBatchId);
    }

    /// @notice Cancel a pending deposit request
    /// @param requestId The ID of the deposit request to cancel
    function cancelDeposit(uint256 requestId) external nonReentrant {
        DepositRequest storage request = depositRequests[requestId];
        if (!request.exists) revert InvalidRequest(requestId);
        if (request.depositor != msg.sender) revert Unauthorized(msg.sender);
        if (request.status != DepositStatus.Pending) revert RequestNotPending(requestId);

        Batch storage batch = batches[currentBatchId];
        // Can only cancel before cutoff
        if (batch.status != BatchStatus.Open) revert CannotCancelAfterCutoff(currentBatchId, batch.cutoffTime);

        request.status = DepositStatus.Cancelled;
        totalQueuedAssets -= request.assets;

        Batch storage targetBatch = batches[request.targetBatch];
        if (targetBatch.exists) {
            targetBatch.totalQueuedDeposits -= request.assets;
        }

        asset.safeTransfer(msg.sender, request.assets);
        emit DepositCancelled(requestId, msg.sender, request.assets);
    }

    /// @notice Process deposit queue for a batch
    /// @param batchId The batch to process deposits for
    /// @param startIndex Start index in the batch's deposit request array
    /// @param endIndex End index (exclusive)
    function processDepositQueue(uint256 batchId, uint256 startIndex, uint256 endIndex) external nonReentrant
    {
        Batch storage batch = batches[batchId];
        if (!batch.exists) revert InvalidRequest(batchId);
        Batch storage pricingBatch = batches[currentBatchId];

        if (batchId == currentBatchId) {
            if (batch.status != BatchStatus.Flattening && batch.status != BatchStatus.Settling) {
                revert BatchNotFlattening(batchId);
            }
            if (!batch.isPriceLocked) revert BatchNotFlattening(batchId);
            pricingBatch = batch;
        } else if (batchId == currentBatchId + 1) {
            if (pricingBatch.status != BatchStatus.Flattening && pricingBatch.status != BatchStatus.Settling) {
                revert BatchNotFlattening(currentBatchId);
            }
            if (!pricingBatch.isPriceLocked) revert BatchNotFlattening(currentBatchId);
        } else {
            revert BatchNotOpen(batchId);
        }
        
        uint256[] storage requests = batchDepositRequests[batchId];
        if (endIndex > requests.length) endIndex = requests.length;

        for (uint256 i = startIndex; i < endIndex; i++) {
            DepositRequest storage request = depositRequests[requests[i]];
            if (!request.exists || request.status != DepositStatus.Pending) continue;

            // Mint shares at the LOCKED clearing price (computed at flatten time)
            // This ensures ALL deposits in this batch mint at the SAME price
            uint256 shares = _convertAssetsToShares(request.assets, pricingBatch.lockedClearingPrice);
            _mint(request.depositor, shares);
            request.status = DepositStatus.Processed;
            totalQueuedAssets -= request.assets;
            batch.totalQueuedDeposits -= request.assets;

            emit DepositProcessed(request.requestId, request.depositor, request.assets, shares, batchId);
        }
    }

    // ============================================================================
    // REDEMPTION FUNCTIONS (ERC-7540 Aligned)
    // ============================================================================

    /// @notice Request redemption - shares are escrowed until settlement
    /// @param shares Amount of shares to redeem
    /// @param controller Address that controls the request (can claim)
    /// @param owner Address that owns the shares
    /// @return requestId The ID of the redemption request
    function requestRedeem(uint256 shares, address controller, address owner)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroAmount();
        if (controller == address(0)) revert InvalidAddress();
        if (owner == address(0)) revert InvalidAddress();
        if (emergencyMode) revert EmergencyModeActive();
        bool isApprovedOperator = msg.sender != owner && isOperator[owner][msg.sender];
        if (msg.sender != owner && !isApprovedOperator) {
            revert NotOwner(owner, msg.sender);
        }
        if (isApprovedOperator && controller != owner) {
            revert InvalidOperatorController(owner, controller);
        }

        Batch storage batch = batches[currentBatchId];
        if (batch.status != BatchStatus.Open) revert BatchNotOpen(currentBatchId);

        requestId = nextRedemptionRequestId++;
        redemptionRequests[requestId] = RedemptionRequest({
            requestId: requestId,
            controller: controller,
            owner: owner,
            shares: shares,
            assetsClaimable: 0,
            batchId: currentBatchId,
            status: RedemptionStatus.Pending,
            createdAt: block.timestamp,
            settledAt: 0,
            exists: true
        });

        batchRedemptionRequests[currentBatchId].push(requestId);
        controllerRequestIds[controller].push(requestId);
        controllerToRequestId[controller] = requestId;
        totalPendingRedeemShares += shares;
        batch.totalSharesPending += shares;

        // Transfer shares to vault for escrow (shares remain economically live)
        IERC20(address(this)).safeTransferFrom(owner, address(this), shares);

        emit RedeemRequest(controller, owner, requestId, msg.sender, shares);
        return requestId;
    }

    /// @notice Cancel a pending redemption request (only before cutoff)
    /// @param requestId The ID of the redemption request
    function cancelRedeemRequest(uint256 requestId) external nonReentrant {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (!request.exists) revert InvalidRequest(requestId);
        if (request.controller != msg.sender) revert NotController(request.controller, msg.sender);
        if (request.status != RedemptionStatus.Pending && request.status != RedemptionStatus.Escrowed) {
            revert RequestNotPending(requestId);
        }

        Batch storage batch = batches[request.batchId];
        // Can only cancel before cutoff
        if (batch.status != BatchStatus.Open) revert CannotCancelAfterCutoff(request.batchId, batch.cutoffTime);

        uint256 shares = request.shares;
        request.status = RedemptionStatus.Cancelled;
        totalPendingRedeemShares -= shares;
        batch.totalSharesPending -= shares;

        // Return escrowed shares to owner
        IERC20(address(this)).safeTransfer(request.owner, shares);

        emit RedeemRequestCancelled(requestId, request.controller, shares);
    }

    /// @notice Redeem claimable shares for assets
    /// @param requestId The redemption request ID
    /// @param shares Amount of shares to redeem
    /// @param receiver Address to receive assets
    /// @return assets Amount of assets transferred
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
        if (request.status != RedemptionStatus.Claimable) revert RequestNotClaimable(requestId);
        if (shares > request.shares) revert InsufficientShares(shares, request.shares);

        assets = (shares * request.assetsClaimable) / request.shares;

        // Update request state
        request.shares -= shares;
        request.assetsClaimable -= assets;

        if (request.shares == 0) {
            request.status = RedemptionStatus.Claimed;
        }

        // Update reserved assets
        if (assets > reservedRedemptionAssetsByBatch[request.batchId]) {
            revert ReservedAssetUnderflow(assets, reservedRedemptionAssetsByBatch[request.batchId]);
        }
        if (assets > reservedRedemptionAssets) {
            revert ReservedAssetUnderflow(assets, reservedRedemptionAssets);
        }
        reservedRedemptionAssetsByBatch[request.batchId] -= assets;
        reservedRedemptionAssets -= assets;

        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, request.controller, assets, shares);
        return assets;
    }

    /// @notice Withdraw assets by specifying output amount
    /// @param requestId The redemption request ID
    /// @param assets Amount of assets to withdraw
    /// @param receiver Address to receive assets
    /// @return shares Amount of shares consumed
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
        if (request.status != RedemptionStatus.Claimable) revert RequestNotClaimable(requestId);

        shares = Math.mulDiv(assets, request.shares, request.assetsClaimable, Math.Rounding.Ceil);
        if (shares > request.shares) revert InsufficientShares(shares, request.shares);

        // Update request state
        request.shares -= shares;
        request.assetsClaimable -= assets;

        if (request.shares == 0) {
            request.status = RedemptionStatus.Claimed;
        }

        // Update reserved assets
        if (assets > reservedRedemptionAssetsByBatch[request.batchId]) {
            revert ReservedAssetUnderflow(assets, reservedRedemptionAssetsByBatch[request.batchId]);
        }
        if (assets > reservedRedemptionAssets) {
            revert ReservedAssetUnderflow(assets, reservedRedemptionAssets);
        }
        reservedRedemptionAssetsByBatch[request.batchId] -= assets;
        reservedRedemptionAssets -= assets;

        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, request.controller, assets, shares);
        return shares;
    }

    /// @notice Get pending redeem shares for a controller (ERC-7540 view)
    function pendingRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (request.exists && request.controller == controller && 
            (request.status == RedemptionStatus.Pending || request.status == RedemptionStatus.Escrowed)) {
            return request.shares;
        }
        return 0;
    }

    /// @notice Get claimable redeem shares for a controller (ERC-7540 view)
    function claimableRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (request.exists && request.controller == controller && request.status == RedemptionStatus.Claimable) {
            return request.shares;
        }
        return 0;
    }

    function getControllerRequestIds(address controller) external view returns (uint256[] memory requestIds) {
        return controllerRequestIds[controller];
    }

    // ============================================================================
    // BATCH/CYCLE STATE TRANSITIONS
    // ============================================================================

    /// @notice Close deposits and freeze redemptions for the current batch (CUTOFF)
    function cutoffBatch() external {
        Batch storage batch = batches[currentBatchId];
        if (!batch.exists) revert InvalidRequest(currentBatchId);
        if (batch.status != BatchStatus.Open) revert BatchNotOpen(currentBatchId);
        if (!hasActionableWork(currentBatchId)) revert NoActionableWork(currentBatchId);

        batch.status = BatchStatus.Cutoff;
        batch.cutoffTime = block.timestamp;
        batch.endTime = block.timestamp;

        emit BatchCutoff(currentBatchId, block.timestamp);
    }

    /// @notice Take NAV snapshot, lock clearing price, and transition to Flattening state
    /// @param snapshotHash Hash of the off-chain snapshot data
    /// @dev The clearing price is locked BEFORE any deposit processing. This ensures:
    ///      1. All deposits in the batch mint shares at the SAME locked price
    ///      2. All redemptions in the batch redeem at the SAME locked price
    ///      3. Sealed-batch deposits (totalQueuedDeposits) do NOT affect the price
    ///      4. Operational netting happens AFTER price lock and does NOT affect price
    function flattenBatch(bytes32 snapshotHash) external {
        _lockClearingPriceAndNet();
        
        Batch storage batch = batches[currentBatchId];
        batch.snapshotNAV = currentNAV;
        batch.snapshotTimestamp = block.timestamp;
        batch.status = BatchStatus.Flattening;

        emit BatchFlattened(currentBatchId, snapshotHash, currentNAV, block.timestamp);
    }

    function _lockClearingPriceAndNet() internal {
        Batch storage batch = batches[currentBatchId];
        if (!batch.exists) revert InvalidRequest(currentBatchId);
        if (batch.status != BatchStatus.Cutoff && batch.status != BatchStatus.Open) {
            revert BatchNotOpen(currentBatchId);
        }
        if (batch.status == BatchStatus.Open) {
            if (!hasActionableWork(currentBatchId)) revert NoActionableWork(currentBatchId);
            batch.status = BatchStatus.Cutoff;
            batch.cutoffTime = block.timestamp;
            batch.endTime = block.timestamp;
            emit BatchCutoff(currentBatchId, block.timestamp);
        }
        _requireFreshNAV();

        // COMPUTE LOCKED CLEARING PRICE
        // Price is based on realized cash basis EXCLUDING all unprocessed queued deposits
        uint256 totalVaultAssets = asset.balanceOf(address(this));
        uint256 excludedAssets = totalQueuedAssets + reservedRedemptionAssets;
        uint256 realizedAssets = totalVaultAssets > excludedAssets
            ? totalVaultAssets - excludedAssets
            : 0;
        uint256 realizedShares = totalSupply();

        // Lock the clearing price: realizedAssets / realizedShares
        uint256 clearingPrice = realizedShares > 0 ? (realizedAssets * 1e18) / realizedShares : currentNAV;
        batch.lockedClearingPrice = clearingPrice;
        batch.isPriceLocked = true;

        // COMPUTE ASSET VALUE USING LOCKED CLEARING PRICE (not current NAV)
        // This ensures redemption entitlements are priced consistently with deposits
        uint256 assetValue = batch.totalSharesPending == 0
            ? 0
            : (batch.totalSharesPending * clearingPrice) / 1e18;

        batch.totalAssetsSnapshot = assetValue;

        uint256[] storage requests = batchRedemptionRequests[currentBatchId];
        for (uint256 i = 0; i < requests.length; i++) {
            RedemptionRequest storage request = redemptionRequests[requests[i]];
            if (request.exists && request.status == RedemptionStatus.Pending) {
                request.status = RedemptionStatus.Escrowed;
                emit SharesEscrowed(request.requestId, request.controller, request.shares);
            }
        }
    }

    /// @notice Settle the batch - compute claimable assets for all escrowed redemptions
    /// @param batchId The batch to settle
    function settleBatch(uint256 batchId) external nonReentrant {
        _settleBatchChunk(batchId, 0);
    }

    /// @notice Settle a chunk of the batch
    /// @param batchId The batch to settle
    /// @param startIndex Index to start processing from
    function settleBatchChunk(uint256 batchId, uint256 startIndex) external nonReentrant
    {
        _settleBatchChunk(batchId, startIndex);
    }

    function _settleBatchChunk(uint256 batchId, uint256 startIndex) internal {
        Batch storage batch = batches[batchId];
        if (!batch.exists) revert InvalidRequest(batchId);
        if (batch.status != BatchStatus.Flattening && batch.status != BatchStatus.Settling) {
            revert BatchNotFlattening(batchId);
        }

        // Settlement uses the locked clearing price, not a fresh NAV
        if (!batch.isPriceLocked) revert PriceNotLocked(batchId);

        uint256[] storage requests = batchRedemptionRequests[batchId];
        uint256 totalRequests = requests.length;

        if (totalRequests == 0) {
            batch.status = BatchStatus.Settled;
            settlementProgress[batchId] = SettlementProgress({
                processedCount: 0,
                totalCount: 0,
                lastProcessedIndex: 0,
                reservedAssetsAllocated: 0,
                complete: true
            });
            emit BatchSettled(batchId, batch.totalSharesPending, 0, PRORATA_PRECISION, 0);
            return;
        }

        SettlementProgress storage progress = settlementProgress[batchId];

        if (progress.processedCount > 0 && startIndex != progress.lastProcessedIndex + 1) {
            revert SettlementIncomplete(batchId);
        }

        if (progress.complete) revert SettlementAlreadyComplete(batchId);

        if (progress.processedCount == 0) {
            if (startIndex != 0) revert SettlementIncomplete(batchId);

            uint256 vaultBalance = asset.balanceOf(address(this));
            uint256 unavailableAssets = reservedRedemptionAssets + totalQueuedAssets;
            uint256 availableAssets = vaultBalance > unavailableAssets
                ? vaultBalance - unavailableAssets
                : 0;

            uint256 initialProRataRatio = PRORATA_PRECISION;
            if (batch.totalAssetsSnapshot > 0 && availableAssets < batch.totalAssetsSnapshot) {
                initialProRataRatio = (availableAssets * PRORATA_PRECISION) / batch.totalAssetsSnapshot;
            }

            batch.proRataRatio = initialProRataRatio;
            batch.status = BatchStatus.Settling;
            progress.totalCount = totalRequests;
        }

        uint256 proRataRatio = batch.proRataRatio;

        if (startIndex >= totalRequests) {
            batch.status = BatchStatus.Settled;
            progress.complete = true;
            emit BatchSettled(
                batchId,
                batch.totalSharesPending,
                progress.reservedAssetsAllocated,
                proRataRatio,
                progress.processedCount
            );
            return;
        }

        uint256 endIndex = startIndex + MAX_CHUNK_SIZE;
        if (endIndex > totalRequests) endIndex = totalRequests;

        uint256 processedInChunk = 0;
        for (uint256 i = startIndex; i < endIndex; i++) {
            RedemptionRequest storage request = redemptionRequests[requests[i]];
            if (!request.exists || request.status != RedemptionStatus.Escrowed) continue;

            // Calculate claimable assets with pro-rata if needed
            uint256 entitledAssets = (request.shares * batch.totalAssetsSnapshot) / batch.totalSharesPending;
            uint256 claimableAssets = (entitledAssets * proRataRatio) / PRORATA_PRECISION;

            request.status = RedemptionStatus.Claimable;
            request.assetsClaimable = claimableAssets;
            request.settledAt = block.timestamp;
            totalPendingRedeemShares -= request.shares;
            progress.reservedAssetsAllocated += claimableAssets;
            reservedRedemptionAssets += claimableAssets;
            reservedRedemptionAssetsByBatch[batchId] += claimableAssets;
            _burn(address(this), request.shares);

            processedInChunk++;
        }

        progress.processedCount += processedInChunk;
        progress.lastProcessedIndex = endIndex - 1;

        bool isComplete = endIndex >= totalRequests;
        if (isComplete) {
            batch.status = BatchStatus.Settled;
            progress.complete = true;
            emit BatchSettled(
                batchId,
                batch.totalSharesPending,
                progress.reservedAssetsAllocated,
                proRataRatio,
                progress.processedCount
            );
        }

        emit SettlementChunkProcessed(batchId, startIndex, endIndex, processedInChunk, progress.processedCount);
    }

    /// @notice Resume settlement from where it left off
    function resumeSettlement(uint256 batchId) external nonReentrant {
        SettlementProgress storage progress = settlementProgress[batchId];
        if (progress.complete) revert SettlementAlreadyComplete(batchId);
        if (progress.processedCount == 0) revert SettlementIncomplete(batchId);

        _settleBatchChunk(batchId, progress.lastProcessedIndex + 1);
    }

    /// @notice Close the batch - transition from Settled to Closed
    function closeBatch(uint256 batchId) external {
        Batch storage batch = batches[batchId];
        if (!batch.exists) revert InvalidRequest(batchId);
        if (batch.status != BatchStatus.Settled) revert BatchNotSettled(batchId);

        batch.status = BatchStatus.Closed;
        emit BatchClosed(batchId);
    }

    /// @notice Reopen the vault for the next batch cycle
    function reopenBatch() external {
        Batch storage currentBatch = batches[currentBatchId];
        if (!currentBatch.exists) revert InvalidRequest(currentBatchId);
        if (currentBatch.status != BatchStatus.Closed && currentBatch.status != BatchStatus.Settled) {
            revert BatchNotClosed(currentBatchId);
        }

        // Mark current batch as reopen if it was settled but not closed
        if (currentBatch.status == BatchStatus.Settled) {
            currentBatch.status = BatchStatus.Reopen;
        }
        uint256 newBatchId = currentBatchId + 1;

        // If next batch was pre-created by _ensureNextBatchExists, just open it
        if (batches[newBatchId].exists) {
            if (batches[newBatchId].startTime == 0) {
                batches[newBatchId].startTime = block.timestamp;
            }
            batches[newBatchId].status = BatchStatus.Open;
        } else {
            // Create new batch from scratch
            uint256 startTime = block.timestamp;
            uint256 endTime = 0;
            
            batches[newBatchId] = Batch({
                batchId: newBatchId,
                startTime: startTime,
                endTime: endTime,
                cutoffTime: 0,
                snapshotNAV: currentNAV,
                lockedClearingPrice: 0,
                snapshotTimestamp: 0,
                totalSharesPending: 0,
                totalAssetsSnapshot: 0,
                proRataRatio: PRORATA_PRECISION,
                totalQueuedDeposits: 0,
                status: BatchStatus.Open,
                isPriceLocked: false,
                exists: true
            });

            emit BatchReopened(newBatchId, startTime, endTime);
        }

        currentBatchId = newBatchId;
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    function setEmergencyMode(bool _active) external onlyRole(ADMIN_ROLE) {
        emergencyMode = _active;
        emit EmergencyModeSet(_active);
    }

    function allocateToTradingWallet(uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Batch storage batch = batches[currentBatchId];
        if (batch.status == BatchStatus.Flattening || batch.status == BatchStatus.Settling) {
            revert CapitalAllocationBlocked(currentBatchId, batch.status);
        }

        _requireFreshNAV();

        uint256 available = maxAllocatableAssets();
        if (amount > available) revert AllocationExceedsAvailable(amount, available);

        asset.safeTransfer(tradingWallet, amount);
        emit CapitalAllocated(tradingWallet, amount);
    }

    function rescueERC20(address token, address receiver, uint256 amount)
        external
        onlyRole(ADMIN_ROLE)
        nonReentrant
    {
        if (token == address(0) || receiver == address(0)) revert InvalidAddress();
        if (token == address(asset) || token == address(this)) revert InvalidToken(token);

        IERC20(token).safeTransfer(receiver, amount);
        emit ERC20Rescued(token, receiver, amount);
    }

    function maxRescueableUnderlying() external view returns (uint256) {
        return _maxRescueableUnderlying();
    }

    function rescueUnderlyingSurplus(address receiver, uint256 amount)
        external
        onlyRole(ADMIN_ROLE)
        nonReentrant
    {
        if (!emergencyMode) revert EmergencyModeRequired();
        if (receiver == address(0)) revert InvalidAddress();

        Batch storage batch = batches[currentBatchId];
        if (batch.status == BatchStatus.Flattening || batch.status == BatchStatus.Settling) {
            revert InvalidRescueState(currentBatchId, batch.status);
        }

        _requireFreshNAV();

        uint256 rescueableAssets = _maxRescueableUnderlying();
        if (amount > rescueableAssets) revert RescueExceedsSurplus(amount, rescueableAssets);

        asset.safeTransfer(receiver, amount);
        emit UnderlyingSurplusRescued(receiver, amount);
    }

    function updateNAV(uint256 _nav) external onlyRole(NAV_UPDATER_ROLE) {
        currentNAV = _nav;
        lastNAVUpdate = block.timestamp;
        emit NAVUpdated(_nav, block.timestamp);
    }

    function setOperator(address operator, bool approved) external returns (bool) {
        if (operator == address(0)) revert InvalidAddress();
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    function isNAVFresh() external view returns (bool) {
        return block.timestamp - lastNAVUpdate <= NAV_STALENESS_THRESHOLD;
    }

    function getCurrentBatch() external view returns (uint256) {
        return currentBatchId;
    }

    function getBatchEnd(uint256 batchId) external view returns (uint256) {
        return batches[batchId].endTime;
    }

    function getBatchStatus(uint256 batchId) external view returns (BatchStatus) {
        return batches[batchId].status;
    }

    function getSettlementProgress(uint256 batchId)
        external
        view
        returns (
            uint256 processed,
            uint256 total,
            uint256 lastIndex,
            uint256 reservedAssetsAllocated,
            bool isComplete
        )
    {
        SettlementProgress storage progress = settlementProgress[batchId];
        return (
            progress.processedCount,
            progress.totalCount,
            progress.lastProcessedIndex,
            progress.reservedAssetsAllocated,
            progress.complete
        );
    }

    function decimals() public view override returns (uint8) {
        return IERC20Metadata(address(asset)).decimals();
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function maxAllocatableAssets() public view returns (uint256) {
        uint256 requiredVaultBalance = totalQueuedAssets + reservedRedemptionAssets;
        uint256 currentBalance = asset.balanceOf(address(this));
        return currentBalance > requiredVaultBalance ? currentBalance - requiredVaultBalance : 0;
    }

    function hasActionableWork(uint256 batchId) public view returns (bool) {
        Batch storage batch = batches[batchId];
        if (!batch.exists) {
            return false;
        }

        if (batch.totalSharesPending > 0 || batch.totalQueuedDeposits > 0) {
            return true;
        }

        if (batchId == currentBatchId) {
            Batch storage nextBatch = batches[batchId + 1];
            return nextBatch.exists && nextBatch.totalQueuedDeposits > 0;
        }

        return false;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IERC165).interfaceId ||
               interfaceId == IERC7540_REDEEM_INTERFACE_ID ||
               interfaceId == IERC7540_CLAIM_INTERFACE_ID ||
               super.supportsInterface(interfaceId);
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    function _requireFreshNAV() internal view {
        if (block.timestamp - lastNAVUpdate > NAV_STALENESS_THRESHOLD) {
            revert NAVStale(lastNAVUpdate, NAV_STALENESS_THRESHOLD);
        }
    }

    /// @notice Ensure the next batch exists, creating it if necessary
    function _ensureNextBatchExists() internal {
        uint256 nextBatchId = currentBatchId + 1;
        if (!batches[nextBatchId].exists) {
            batches[nextBatchId] = Batch({
                batchId: nextBatchId,
                startTime: 0,
                endTime: 0,
                cutoffTime: 0,
                snapshotNAV: currentNAV,
                lockedClearingPrice: 0,
                snapshotTimestamp: 0,
                totalSharesPending: 0,
                totalAssetsSnapshot: 0,
                proRataRatio: PRORATA_PRECISION,
                totalQueuedDeposits: 0,
                status: BatchStatus.Open,
                isPriceLocked: false,
                exists: true
            });
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

    function _maxRescueableUnderlying() internal view returns (uint256) {
        uint256 requiredAssets =
            totalQueuedAssets +
            reservedRedemptionAssets +
            _convertSharesToAssets(totalSupply(), currentNAV);
        uint256 currentBalance = asset.balanceOf(address(this));
        return currentBalance > requiredAssets ? currentBalance - requiredAssets : 0;
    }
    // ============================================================================
    // RESERVED GAP
    // ============================================================================

    uint256[50] private __gap;
}
