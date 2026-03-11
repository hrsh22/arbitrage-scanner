#!/usr/bin/env python3
contract_code = '''// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EpochMath} from "./libraries/EpochMath.sol";

contract EpochTrancheVault is ERC20, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");
    bytes32 public constant SNAPSHOT_ROLE = keccak256("SNAPSHOT_ROLE");
    bytes32 public constant DEPOSIT_PROCESSOR_ROLE = keccak256("DEPOSIT_PROCESSOR_ROLE");

    IERC20 public immutable asset;
    uint256 public immutable EPOCH_DURATION;
    uint256 public immutable DEPLOY_TIME;
    uint256 public immutable NAV_STALENESS_THRESHOLD;
    uint256 public immutable MIN_CLAIM_THRESHOLD;
    uint256 public immutable BALANCED_UPFRONT_BPS;

    enum EpochStatus { Active, Frozen, Settling, Settled, Finalized }
    enum RequestStatus { Pending, Frozen, Claimable, Claimed, Cancelled }

    struct Epoch {
        uint256 epochId;
        uint256 startTime;
        uint256 endTime;
        uint256 snapshotNAV;
        uint256 snapshotTimestamp;
        uint256 totalSharesPending;
        uint256 frozenShares;
        uint256 frozenAssets;
        uint256 proRataRatio;
        uint256 carryAccrued;
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

    mapping(uint256 => TrancheSnapshot) public epochSnapshots;

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
        bool complete;
    }
    mapping(uint256 => SettlementProgress) public settlementProgress;

    bytes4 constant IERC7540_REDEEM_INTERFACE_ID = 0x620ee8e4;
    bytes4 constant IERC7540_CANCEL_INTERFACE_ID = 0xe3bc4e65;
    bytes4 constant IERC7540_CLAIM_INTERFACE_ID = 0x2f0a18c5;

    event DepositQueued(uint256 indexed requestId, address indexed depositor, uint256 assets, uint256 targetEpoch);
    event DepositProcessed(uint256 indexed requestId, address indexed depositor, uint256 assets, uint256 sharesMinted, uint256 epochId);
    event RedeemRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares);
    event RedeemRequestCancelled(uint256 indexed requestId, address indexed controller, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event EpochFrozen(uint256 indexed epochId, bytes32 indexed snapshotHash, uint256 nav, uint256 timestamp);
    event EpochSettled(uint256 indexed epochId, uint256 totalShares, uint256 totalAssets, uint256 carryAccrued, uint256 proRataRatio, uint256 processedCount);
    event SettlementChunkProcessed(uint256 indexed epochId, uint256 startIndex, uint256 endIndex, uint256 processedInChunk, uint256 totalProcessed);
    event SettlementResumed(uint256 indexed epochId, uint256 resumeIndex);
    event EpochFinalized(uint256 indexed epochId);
    event CarryAccrued(uint256 indexed epochId, uint256 totalCarry, uint256 distributionRate);
    event CarryClaimed(uint256 indexed requestId, address indexed controller, uint256 carryAmount);
    event EmergencyModeSet(bool active);
    event NAVUpdated(uint256 nav, uint256 timestamp);
    event OperatorSet(address indexed controller, address indexed operator, bool approved);

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
    error CannotCancelAfterFreeze(uint256 epochId);
    error CannotCancelFrozenRequest(uint256 requestId);
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

    constructor(
        address _asset,
        address _admin,
        address _settler,
        address _navUpdater,
        address _snapshotter,
        address _depositProcessor,
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
        if (_epochDuration == 0) revert InvalidAddress();
        if (_navStalenessThreshold == 0) revert InvalidAddress();

        asset = IERC20(_asset);
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
            snapshotNAV: 0,
            snapshotTimestamp: 0,
            totalSharesPending: 0,
            frozenShares: 0,
            frozenAssets: 0,
            proRataRatio: PRORATA_PRECISION,
            carryAccrued: 0,
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

    function processDepositQueue(uint256 epochId, uint256 startIndex, uint256 endIndex) external onlyRole(DEPOSIT_PROCESSOR_ROLE) nonReentrant {
        Epoch storage epoch = epochs[epochId];
        if (!epoch.exists) revert InvalidRequest(epochId);
        if (epoch.status != EpochStatus.Active && epoch.status != EpochStatus.Frozen) revert EpochNotActive(epochId);
        uint256[] storage requests = epochDepositRequests[epochId];
        if (endIndex > requests.length) endIndex = requests.length;
        for (uint256 i = startIndex; i < endIndex; i++) {
            DepositRequest storage request = depositRequests[requests[i]];
            if (!request.exists || request.processed) continue;
            uint256 shares = _convertAssetsToShares(request.assets, currentNAV);
            _mint(request.depositor, shares);
            request.processed = true;
            totalQueuedAssets -= request.assets;
            emit DepositProcessed(request.requestId, request.depositor, request.assets, shares, epochId);
        }
    }

    function requestRedeem(uint256 shares, address controller, address owner) external nonReentrant returns (uint256 requestId) {
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
        IERC20(address(this)).safeTransferFrom(owner, address(this), shares);
        emit RedeemRequest(controller, owner, requestId, msg.sender, shares);
        return requestId;
    }

    function cancelRedeemRequest(uint256 requestId) external nonReentrant returns (uint256 cancelledShares) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (!request.exists) revert InvalidRequest(requestId);
        if (request.controller != msg.sender) revert NotController(request.controller, msg.sender);
        if (request.status == RequestStatus.Frozen) revert CannotCancelFrozenRequest(requestId);
        if (request.status != RequestStatus.Pending) revert RequestNotPending(requestId);
        Epoch storage epoch = epochs[request.epochId];
        if (epoch.status != EpochStatus.Active) revert CannotCancelAfterFreeze(request.epochId);
        cancelledShares = request.shares;
        totalPendingRedeemShares -= cancelledShares;
        epoch.totalSharesPending -= cancelledShares;
        request.status = RequestStatus.Cancelled;
        IERC20(address(this)).safeTransfer(request.owner, cancelledShares);
        emit RedeemRequestCancelled(requestId, request.controller, cancelledShares);
        return cancelledShares;
    }

    function redeem(uint256 requestId, uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
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
        if (assets < MIN_CLAIM_THRESHOLD) revert BelowClaimThreshold(assets, MIN_CLAIM_THRESHOLD);
        request.shares -= shares;
        request.assetsClaimable -= assets;
        request.carryDeducted += carry;
        if (request.shares == 0) request.status = RequestStatus.Claimed;
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, request.controller, assets, shares);
        return assets;
    }

    function withdraw(uint256 requestId, uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
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
        if (assets < MIN_CLAIM_THRESHOLD) revert BelowClaimThreshold(assets, MIN_CLAIM_THRESHOLD);
        request.shares -= shares;
        request.assetsClaimable -= grossAssets;
        request.carryDeducted += carry;
        if (request.shares == 0) request.status = RequestStatus.Claimed;
        asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, request.controller, assets, shares);
        return shares;
    }

    function freezeEpoch(bytes32 snapshotHash) external onlyRole(SNAPSHOT_ROLE) {
        Epoch storage epoch = epochs[currentEpochId];
        if (epoch.status != EpochStatus.Active) revert EpochNotActive(currentEpochId);
        _requireFreshNAV();
        epoch.frozenShares = epoch.totalSharesPending;
        epoch.frozenAssets = totalAssets();
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
            totalValue: totalAssets(),
            timestamp: block.timestamp,
            realizationDeadline: block.timestamp + 30 days,
            exists: true
        });
        uint256 nextEpochId = currentEpochId + 1;
        epochs[nextEpochId] = Epoch({
            epochId: nextEpochId,
            startTime: epoch.endTime,
            endTime: epoch.endTime + EPOCH_DURATION,
            snapshotNAV: 0,
            snapshotTimestamp: 0,
            totalSharesPending: 0,
            frozenShares: 0,
            frozenAssets: 0,
            proRataRatio: PRORATA_PRECISION,
            carryAccrued: 0,
            status: EpochStatus.Active,
            exists: true
        });
        currentEpochId = nextEpochId;
        emit EpochFrozen(currentEpochId - 1, snapshotHash, currentNAV, block.timestamp);
    }

    function settleEpoch(uint256 epochId, uint256 carryAmount) external onlyRole(SETTLER_ROLE) nonReentrant {
        _settleEpochChunk(epochId, carryAmount, 0);
    }

    function settleEpochChunk(uint256 epochId, uint256 carryAmount, uint256 startIndex) external onlyRole(SETTLER_ROLE) nonReentrant {
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
            if (epoch.frozenAssets < epoch.frozenShares) proRataRatio = (epoch.frozenAssets * PRORATA_PRECISION) / epoch.frozenShares;
            epoch.proRataRatio = proRataRatio;
        }
        uint256[] storage requests = epochRedemptionRequests[epochId];
        uint256 totalRequests = requests.length;
        if (totalRequests == 0) {
            epoch.status = EpochStatus.Settled;
            epoch.carryAccrued = carryAmount;
            settlementProgress[epochId] = SettlementProgress({processedCount: 0, totalCount: 0, lastProcessedIndex: 0, complete: true});
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
            request.status = RequestStatus.Claimable;
            request.assetsClaimable = (request.shares * epoch.frozenAssets * proRataRatio) / (epoch.frozenShares * PRORATA_PRECISION);
            request.settledAt = block.timestamp;
            processedInChunk++;
        }
        progress.processedCount += processedInChunk;
        progress.lastProcessedIndex = endIndex - 1;
        bool isComplete = (endIndex >= totalRequests);
        if (isComplete) {
            epoch.status = EpochStatus.Settled;
            progress.complete = true;
            emit EpochSettled(epochId, epoch.frozenShares, epoch.frozenAssets, carryAmount, proRataRatio, progress.processedCount);
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

    function getSettlementProgress(uint256 epochId) external view returns (uint256 processed, uint256 total, uint256 lastIndex, bool isComplete) {
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
        if (request.exists && request.controller == controller && request.status == RequestStatus.Pending) return request.shares;
        return 0;
    }

    function claimableRedeemRequest(uint256 requestId, address controller) external view returns (uint256 shares) {
        RedemptionRequest storage request = redemptionRequests[requestId];
        if (request.exists && request.controller == controller && request.status == RequestStatus.Claimable) return request.shares;
        return 0;
    }

    function getCurrentEpoch() external view returns (uint256) {
        return EpochMath.getCurrentEpoch(DEPLOY_TIME, EPOCH_DURATION);
    }

    function getEpochEnd(uint256 epochId) external view returns (uint256) {
        return epochs[epochId].endTime;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function isNAVFresh() external view returns (bool) {
        return block.timestamp - lastNAVUpdate <= NAV_STALENESS_THRESHOLD;
    }

    function _requireFreshNAV() internal view {
        if (block.timestamp - lastNAVUpdate > NAV_STALENESS_THRESHOLD) revert NAVStale(lastNAVUpdate, NAV_STALENESS_THRESHOLD);
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
        return interfaceId == type(IERC165).interfaceId ||
               interfaceId == IERC7540_REDEEM_INTERFACE_ID ||
               interfaceId == IERC7540_CANCEL_INTERFACE_ID ||
               interfaceId == IERC7540_CLAIM_INTERFACE_ID ||
               super.supportsInterface(interfaceId);
    }

    uint256[50] private __gap;
}
'''

with open('/Users/harsh/Developer/polymarket-mvp/contracts/src/EpochTrancheVault.sol', 'w') as f:
    f.write(contract_code)

print("Contract written successfully!")
