// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC7540, IERC7540Operator, IERC7540Deposit, IERC7540Redeem} from "./interfaces/IERC7540.sol";
import {IERC7575} from "./interfaces/IERC7575.sol";

contract FlatBookVaultV2 is ERC20, AccessControl, ReentrancyGuard, IERC7540 {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BOOK_RUNNER_ROLE = keccak256("BOOK_RUNNER_ROLE");
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");

    enum VaultState {
        Open,
        Closed,
        Processing
    }

    struct CycleData {
        uint256 lockedNav;
        uint256 totalQueuedDepositAssets;
        uint256 totalQueuedRedeemShares;
        uint256 totalQueuedRedeemAssets;
        uint256 depositCursor;
        uint256 redeemCursor;
        uint256 processingStartedAt;
        bool depositsComplete;
        bool redeemsComplete;
        bool finalized;
    }

    IERC20 private immutable assetToken;
    address public immutable tradingWallet;
    uint256 public immutable NAV_STALENESS_THRESHOLD;

    VaultState public state;
    uint256 public currentCycleId;
    uint256 public currentNAV;
    uint256 public lastNAVUpdate;

    mapping(uint256 => CycleData) public cycles;
    mapping(uint256 => mapping(address => uint256)) public queuedDepositAssets;
    mapping(uint256 => mapping(address => uint256)) public queuedRedeemShares;
    mapping(uint256 => mapping(address => bool)) public hasQueuedDepositEntry;
    mapping(uint256 => mapping(address => bool)) public hasQueuedRedeemEntry;
    mapping(uint256 => address[]) private cycleDepositParticipants;
    mapping(uint256 => address[]) private cycleRedeemParticipants;

    mapping(address => uint256) public claimableDepositAssetsByController;
    mapping(address => uint256) public claimableDepositSharesByController;
    mapping(address => uint256) public claimableRedeemAssetsByController;
    mapping(address => uint256) public claimableRedeemSharesByController;
    uint256 public totalClaimableRedeemAssets;

    mapping(address => mapping(address => bool)) public isOperator;

    event NAVUpdated(uint256 nav, uint256 timestamp);
    event BookClosed(uint256 indexed cycleId);
    event ProcessingStarted(
        uint256 indexed cycleId,
        uint256 lockedNav,
        uint256 totalQueuedDepositAssets,
        uint256 totalQueuedRedeemShares,
        uint256 totalQueuedRedeemAssets
    );
    event ProcessingFinalized(uint256 indexed processedCycleId, uint256 nextCycleId);
    event IdleCycleReopened(uint256 closedCycleId, uint256 nextCycleId);
    event ProcessingRedeemsChunk(uint256 indexed cycleId, uint256 startIndex, uint256 endIndex, uint256 processedUsers);
    event ProcessingDepositsChunk(uint256 indexed cycleId, uint256 startIndex, uint256 endIndex, uint256 processedUsers);
    event InstantDeposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event InstantRedeem(address indexed caller, address indexed receiver, address indexed owner, uint256 shares, uint256 assets);
    event InstantWithdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event CapitalAllocated(address indexed tradingWallet, uint256 amount);
    event DepositRequestCancelled(address indexed controller, uint256 assets);
    event RedeemRequestCancelled(address indexed controller, uint256 shares);

    error InvalidAddress();
    error ZeroAmount();
    error InvalidState(VaultState expected, VaultState actual);
    error NAVStale(uint256 lastUpdate, uint256 threshold);
    error NoActionableQueue(uint256 cycleId);
    error QueueNotEmpty(uint256 cycleId);
    error InsufficientQueuedAmount();
    error ProcessingNotReady(uint256 cycleId);
    error InsufficientLiquidityForProcessing(uint256 requiredAssets, uint256 availableAssets);
    error ProcessingNotComplete(uint256 cycleId);
    error AllocationExceedsAvailable(uint256 requested, uint256 available);
    error NotController(address controller, address caller);
    error NotOwner(address owner, address caller);
    error InvalidRequestWindow(VaultState actual);
    error RequestNotClaimable(address controller);
    error InsufficientClaimableAmount(uint256 requested, uint256 available);
    error PreviewNotSupported();

    constructor(
        address _asset,
        address _admin,
        address _bookRunner,
        address _navUpdater,
        address _tradingWallet,
        uint256 _navStalenessThreshold
    ) ERC20("Flat Book Vault", "FBV2") {
        if (_asset == address(0)) revert InvalidAddress();
        if (_admin == address(0)) revert InvalidAddress();
        if (_bookRunner == address(0)) revert InvalidAddress();
        if (_navUpdater == address(0)) revert InvalidAddress();
        if (_tradingWallet == address(0)) revert InvalidAddress();
        if (_navStalenessThreshold == 0) revert InvalidAddress();

        assetToken = IERC20(_asset);
        tradingWallet = _tradingWallet;
        NAV_STALENESS_THRESHOLD = _navStalenessThreshold;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(BOOK_RUNNER_ROLE, _bookRunner);
        _grantRole(NAV_UPDATER_ROLE, _navUpdater);

        state = VaultState.Open;
        currentCycleId = 0;
        currentNAV = 1e18;
        lastNAVUpdate = block.timestamp;
    }

    modifier onlyState(VaultState expected) {
        if (state != expected) revert InvalidState(expected, state);
        _;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControl, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC7540Operator).interfaceId || interfaceId == type(IERC7540Deposit).interfaceId
            || interfaceId == type(IERC7540Redeem).interfaceId || interfaceId == type(IERC7575).interfaceId
            || super.supportsInterface(interfaceId);
    }

    function share() external view override returns (address) {
        return address(this);
    }

    function asset() external view override returns (address assetTokenAddress) {
        return address(assetToken);
    }

    function setOperator(address operator, bool approved) external override returns (bool success) {
        if (operator == address(0)) revert InvalidAddress();
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    function requestDeposit(uint256 assets) external returns (uint256 requestId) {
        return requestDeposit(assets, msg.sender, msg.sender);
    }

    function requestDeposit(uint256 assets, address controller, address owner)
        public
        nonReentrant
        onlyState(VaultState.Closed)
        override
        returns (uint256 requestId)
    {
        if (assets == 0) revert ZeroAmount();
        if (controller == address(0) || owner == address(0)) revert InvalidAddress();
        if (msg.sender != owner && !isOperator[owner][msg.sender]) {
            revert NotOwner(owner, msg.sender);
        }

        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];

        assetToken.safeTransferFrom(owner, address(this), assets);

        if (!hasQueuedDepositEntry[cycleId][controller]) {
            hasQueuedDepositEntry[cycleId][controller] = true;
            cycleDepositParticipants[cycleId].push(controller);
        }

        queuedDepositAssets[cycleId][controller] += assets;
        cycle.totalQueuedDepositAssets += assets;

        emit DepositRequest(controller, owner, 0, msg.sender, assets);
        return 0;
    }

    function pendingDepositRequest(uint256, address controller)
        external
        view
        override
        returns (uint256 pendingAssets)
    {
        return queuedDepositAssets[currentCycleId][controller];
    }

    function claimableDepositRequest(uint256, address controller)
        external
        view
        override
        returns (uint256 claimableAssets)
    {
        return claimableDepositAssetsByController[controller];
    }

    function requestRedeem(uint256 shares) external returns (uint256 requestId) {
        return requestRedeem(shares, msg.sender, msg.sender);
    }

    function requestRedeem(uint256 shares, address controller, address owner)
        public
        nonReentrant
        override
        returns (uint256 requestId)
    {
        if (state != VaultState.Open && state != VaultState.Closed) {
            revert InvalidRequestWindow(state);
        }
        if (shares == 0) revert ZeroAmount();
        if (controller == address(0) || owner == address(0)) revert InvalidAddress();
        if (msg.sender != owner && !isOperator[owner][msg.sender]) {
            revert NotOwner(owner, msg.sender);
        }

        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];
        uint256 estimatedAssets = _convertSharesToAssets(shares, currentNAV);

        _spendAllowance(owner, address(this), shares);
        _transfer(owner, address(this), shares);

        if (!hasQueuedRedeemEntry[cycleId][controller]) {
            hasQueuedRedeemEntry[cycleId][controller] = true;
            cycleRedeemParticipants[cycleId].push(controller);
        }

        queuedRedeemShares[cycleId][controller] += shares;
        cycle.totalQueuedRedeemShares += shares;
        cycle.totalQueuedRedeemAssets += estimatedAssets;

        emit RedeemRequest(controller, owner, 0, msg.sender, shares);
        return 0;
    }

    function pendingRedeemRequest(uint256, address controller)
        external
        view
        override
        returns (uint256 pendingShares)
    {
        return queuedRedeemShares[currentCycleId][controller];
    }

    function claimableRedeemRequest(uint256, address controller)
        external
        view
        override
        returns (uint256 claimableShares)
    {
        return claimableRedeemSharesByController[controller];
    }

    function cancelQueuedDeposit() external nonReentrant onlyState(VaultState.Closed) returns (uint256 assetsReturned) {
        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];

        assetsReturned = queuedDepositAssets[cycleId][msg.sender];
        if (assetsReturned == 0) revert InsufficientQueuedAmount();

        queuedDepositAssets[cycleId][msg.sender] = 0;
        cycle.totalQueuedDepositAssets -= assetsReturned;
        assetToken.safeTransfer(msg.sender, assetsReturned);
        emit DepositRequestCancelled(msg.sender, assetsReturned);
    }

    function cancelQueuedRedeem() external nonReentrant returns (uint256 sharesReturned) {
        if (state != VaultState.Open && state != VaultState.Closed) {
            revert InvalidRequestWindow(state);
        }
        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];

        sharesReturned = queuedRedeemShares[cycleId][msg.sender];
        if (sharesReturned == 0) revert InsufficientQueuedAmount();
        uint256 reservedAssets = _convertSharesToAssets(sharesReturned, currentNAV);

        queuedRedeemShares[cycleId][msg.sender] = 0;
        cycle.totalQueuedRedeemShares -= sharesReturned;
        cycle.totalQueuedRedeemAssets = cycle.totalQueuedRedeemAssets > reservedAssets
            ? cycle.totalQueuedRedeemAssets - reservedAssets
            : 0;
        _transfer(address(this), msg.sender, sharesReturned);
        emit RedeemRequestCancelled(msg.sender, sharesReturned);
    }

    function deposit(uint256 assets, address receiver)
        external
        nonReentrant
        onlyState(VaultState.Open)
        override
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidAddress();
        _requireFreshNAV();

        shares = _convertAssetsToShares(assets, currentNAV);
        if (shares == 0) revert ZeroAmount();

        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
        emit InstantDeposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver)
        external
        nonReentrant
        onlyState(VaultState.Open)
        override
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidAddress();
        _requireFreshNAV();

        assets = Math.mulDiv(shares, currentNAV, 1e18, Math.Rounding.Ceil);
        if (assets == 0) revert ZeroAmount();

        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
        emit InstantDeposit(msg.sender, receiver, assets, shares);
    }

    function deposit(uint256 assets, address receiver, address controller)
        external
        nonReentrant
        override
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0) || controller == address(0)) revert InvalidAddress();
        _requireControllerAuth(controller);

        uint256 claimableAssets = claimableDepositAssetsByController[controller];
        uint256 claimableShares = claimableDepositSharesByController[controller];

        if (claimableAssets == 0 || claimableShares == 0) revert RequestNotClaimable(controller);
        if (assets > claimableAssets) revert InsufficientClaimableAmount(assets, claimableAssets);

        shares = Math.mulDiv(assets, claimableShares, claimableAssets);
        if (shares == 0) revert ZeroAmount();
        if (shares > claimableShares) shares = claimableShares;

        uint256 consumedAssets = Math.mulDiv(shares, claimableAssets, claimableShares);
        claimableDepositAssetsByController[controller] = claimableAssets - consumedAssets;
        claimableDepositSharesByController[controller] = claimableShares - shares;

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, consumedAssets, shares);
    }

    function mint(uint256 shares, address receiver, address controller)
        external
        nonReentrant
        override
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0) || controller == address(0)) revert InvalidAddress();
        _requireControllerAuth(controller);

        uint256 claimableAssets = claimableDepositAssetsByController[controller];
        uint256 claimableShares = claimableDepositSharesByController[controller];
        if (claimableAssets == 0 || claimableShares == 0) revert RequestNotClaimable(controller);
        if (shares > claimableShares) revert InsufficientClaimableAmount(shares, claimableShares);

        assets = Math.mulDiv(shares, claimableAssets, claimableShares, Math.Rounding.Ceil);
        if (assets > claimableAssets) assets = claimableAssets;

        claimableDepositAssetsByController[controller] = claimableAssets - assets;
        claimableDepositSharesByController[controller] = claimableShares - shares;

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner)
        external
        nonReentrant
        override
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0) || owner == address(0)) revert InvalidAddress();

        uint256 claimableShares = claimableRedeemSharesByController[owner];
        uint256 claimableAssets = claimableRedeemAssetsByController[owner];
        if (claimableShares > 0 && claimableAssets > 0 && (msg.sender == owner || isOperator[owner][msg.sender])) {
            if (shares > claimableShares) revert InsufficientClaimableAmount(shares, claimableShares);

            assets = Math.mulDiv(shares, claimableAssets, claimableShares);
            claimableRedeemSharesByController[owner] = claimableShares - shares;
            claimableRedeemAssetsByController[owner] = claimableAssets - assets;
            totalClaimableRedeemAssets -= assets;
            assetToken.safeTransfer(receiver, assets);
            emit Withdraw(msg.sender, receiver, owner, assets, shares);
            return assets;
        }

        if (state != VaultState.Open) revert InvalidState(VaultState.Open, state);
        _requireFreshNAV();

        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        assets = _convertSharesToAssets(shares, currentNAV);
        _burn(owner, shares);
        assetToken.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        emit InstantRedeem(msg.sender, receiver, owner, shares, assets);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        external
        nonReentrant
        override
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0) || owner == address(0)) revert InvalidAddress();

        uint256 claimableAssets = claimableRedeemAssetsByController[owner];
        uint256 claimableShares = claimableRedeemSharesByController[owner];
        if (claimableAssets > 0 && claimableShares > 0 && (msg.sender == owner || isOperator[owner][msg.sender])) {
            if (assets > claimableAssets) revert InsufficientClaimableAmount(assets, claimableAssets);

            shares = Math.mulDiv(assets, claimableShares, claimableAssets, Math.Rounding.Ceil);
            if (shares > claimableShares) shares = claimableShares;

            uint256 consumedAssets = Math.mulDiv(shares, claimableAssets, claimableShares);
            claimableRedeemSharesByController[owner] = claimableShares - shares;
            claimableRedeemAssetsByController[owner] = claimableAssets - consumedAssets;
            totalClaimableRedeemAssets -= consumedAssets;
            assetToken.safeTransfer(receiver, consumedAssets);
            emit Withdraw(msg.sender, receiver, owner, consumedAssets, shares);
            return shares;
        }

        if (state != VaultState.Open) revert InvalidState(VaultState.Open, state);
        _requireFreshNAV();

        shares = Math.mulDiv(assets, 1e18, currentNAV, Math.Rounding.Ceil);
        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        _burn(owner, shares);
        assetToken.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
        emit InstantWithdraw(msg.sender, receiver, owner, assets, shares);
    }

    function closeBook() external onlyRole(BOOK_RUNNER_ROLE) onlyState(VaultState.Open) {
        state = VaultState.Closed;
        emit BookClosed(currentCycleId);
    }

    function reopenIdleCycle() external onlyRole(BOOK_RUNNER_ROLE) onlyState(VaultState.Closed) {
        uint256 closedCycleId = currentCycleId;
        CycleData storage cycle = cycles[closedCycleId];
        if (cycle.totalQueuedDepositAssets != 0 || cycle.totalQueuedRedeemShares != 0) {
            revert QueueNotEmpty(closedCycleId);
        }

        uint256 nextCycleId = closedCycleId + 1;
        currentCycleId = nextCycleId;
        state = VaultState.Open;

        emit IdleCycleReopened(closedCycleId, nextCycleId);
    }

    function beginProcessing() external onlyRole(BOOK_RUNNER_ROLE) onlyState(VaultState.Closed) {
        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];

        if (cycle.totalQueuedDepositAssets == 0 && cycle.totalQueuedRedeemShares == 0) {
            revert NoActionableQueue(cycleId);
        }

        _requireFreshNAV();

        uint256 lockedNav = currentNAV;
        uint256 requiredRedeemAssets = _convertSharesToAssets(cycle.totalQueuedRedeemShares, lockedNav);
        uint256 availableAssets = assetToken.balanceOf(address(this));
        if (availableAssets < requiredRedeemAssets + totalClaimableRedeemAssets) {
            revert InsufficientLiquidityForProcessing(requiredRedeemAssets + totalClaimableRedeemAssets, availableAssets);
        }

        cycle.lockedNav = lockedNav;
        cycle.totalQueuedRedeemAssets = requiredRedeemAssets;
        cycle.processingStartedAt = block.timestamp;
        cycle.depositCursor = 0;
        cycle.redeemCursor = 0;
        cycle.depositsComplete = cycleDepositParticipants[cycleId].length == 0;
        cycle.redeemsComplete = cycleRedeemParticipants[cycleId].length == 0;
        cycle.finalized = false;

        state = VaultState.Processing;
        emit ProcessingStarted(
            cycleId,
            lockedNav,
            cycle.totalQueuedDepositAssets,
            cycle.totalQueuedRedeemShares,
            requiredRedeemAssets
        );
    }

    function processRedeems(uint256 maxUsers)
        external
        nonReentrant
        onlyRole(BOOK_RUNNER_ROLE)
        onlyState(VaultState.Processing)
    {
        if (maxUsers == 0) revert ZeroAmount();

        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];
        if (cycle.lockedNav == 0) revert ProcessingNotReady(cycleId);

        address[] storage participants = cycleRedeemParticipants[cycleId];
        uint256 start = cycle.redeemCursor;
        uint256 len = participants.length;
        if (start >= len) {
            cycle.redeemsComplete = true;
            return;
        }

        uint256 end = start + maxUsers;
        if (end > len) end = len;

        uint256 processedUsers = 0;
        for (uint256 i = start; i < end; i++) {
            address controller = participants[i];
            uint256 shares = queuedRedeemShares[cycleId][controller];
            if (shares == 0) continue;

            uint256 assetsOut = _convertSharesToAssets(shares, cycle.lockedNav);
            queuedRedeemShares[cycleId][controller] = 0;

            cycle.totalQueuedRedeemShares -= shares;
            cycle.totalQueuedRedeemAssets -= assetsOut;

            claimableRedeemSharesByController[controller] += shares;
            claimableRedeemAssetsByController[controller] += assetsOut;
            totalClaimableRedeemAssets += assetsOut;

            _burn(address(this), shares);
            processedUsers++;
        }

        cycle.redeemCursor = end;
        if (end == len) {
            cycle.redeemsComplete = true;
        }

        emit ProcessingRedeemsChunk(cycleId, start, end, processedUsers);
    }

    function processDeposits(uint256 maxUsers)
        external
        nonReentrant
        onlyRole(BOOK_RUNNER_ROLE)
        onlyState(VaultState.Processing)
    {
        if (maxUsers == 0) revert ZeroAmount();

        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];
        if (cycle.lockedNav == 0) revert ProcessingNotReady(cycleId);

        address[] storage participants = cycleDepositParticipants[cycleId];
        uint256 start = cycle.depositCursor;
        uint256 len = participants.length;
        if (start >= len) {
            cycle.depositsComplete = true;
            return;
        }

        uint256 end = start + maxUsers;
        if (end > len) end = len;

        uint256 processedUsers = 0;
        for (uint256 i = start; i < end; i++) {
            address controller = participants[i];
            uint256 assetsIn = queuedDepositAssets[cycleId][controller];
            if (assetsIn == 0) continue;

            queuedDepositAssets[cycleId][controller] = 0;
            cycle.totalQueuedDepositAssets -= assetsIn;

            uint256 shares = _convertAssetsToShares(assetsIn, cycle.lockedNav);
            _mint(controller, shares);
            emit Deposit(controller, controller, assetsIn, shares);

            processedUsers++;
        }

        cycle.depositCursor = end;
        if (end == len) {
            cycle.depositsComplete = true;
        }

        emit ProcessingDepositsChunk(cycleId, start, end, processedUsers);
    }

    function finalizeProcessing() external onlyRole(BOOK_RUNNER_ROLE) onlyState(VaultState.Processing) {
        uint256 cycleId = currentCycleId;
        CycleData storage cycle = cycles[cycleId];

        if (!cycle.redeemsComplete || !cycle.depositsComplete) {
            revert ProcessingNotComplete(cycleId);
        }

        cycle.finalized = true;
        state = VaultState.Open;
        currentCycleId = cycleId + 1;

        emit ProcessingFinalized(cycleId, currentCycleId);
    }

    function updateNAV(uint256 _nav) external onlyRole(NAV_UPDATER_ROLE) {
        if (_nav == 0) revert ZeroAmount();
        currentNAV = _nav;
        lastNAVUpdate = block.timestamp;
        if (state != VaultState.Processing) {
            cycles[currentCycleId].totalQueuedRedeemAssets = _convertSharesToAssets(
                cycles[currentCycleId].totalQueuedRedeemShares, _nav
            );
        }
        emit NAVUpdated(_nav, block.timestamp);
    }

    function allocateToTradingWallet(uint256 amount)
        external
        onlyRole(ADMIN_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (state == VaultState.Processing) revert InvalidState(VaultState.Open, state);

        uint256 available = maxAllocatableAssets();
        if (amount > available) {
            revert AllocationExceedsAvailable(amount, available);
        }

        assetToken.safeTransfer(tradingWallet, amount);
        emit CapitalAllocated(tradingWallet, amount);
    }

    function decimals() public view override returns (uint8) {
        return IERC20Metadata(address(assetToken)).decimals();
    }

    function totalAssets() external view override returns (uint256) {
        return assetToken.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) external view override returns (uint256 shares) {
        return _convertAssetsToShares(assets, currentNAV);
    }

    function convertToAssets(uint256 shares) external view override returns (uint256 assets) {
        return _convertSharesToAssets(shares, currentNAV);
    }

    function maxDeposit(address) external view override returns (uint256 maxAssets) {
        if (state == VaultState.Open) {
            return type(uint256).max;
        }
        return 0;
    }

    function maxMint(address) external view override returns (uint256 maxShares) {
        if (state == VaultState.Open) {
            return type(uint256).max;
        }
        return 0;
    }

    function maxWithdraw(address owner) external view override returns (uint256 maxAssets) {
        uint256 openAssets = state == VaultState.Open ? _convertSharesToAssets(balanceOf(owner), currentNAV) : 0;
        return openAssets + claimableRedeemAssetsByController[owner];
    }

    function maxRedeem(address owner) external view override returns (uint256 maxShares) {
        uint256 openShares = state == VaultState.Open ? balanceOf(owner) : 0;
        return openShares + claimableRedeemSharesByController[owner];
    }

    function isNAVFresh() external view returns (bool) {
        return block.timestamp - lastNAVUpdate <= NAV_STALENESS_THRESHOLD;
    }

    function hasActionableQueueWork() external view returns (bool) {
        CycleData storage cycle = cycles[currentCycleId];
        return cycle.totalQueuedDepositAssets > 0 || cycle.totalQueuedRedeemShares > 0;
    }

    function getCycleParticipants(uint256 cycleId)
        external
        view
        returns (address[] memory depositParticipants, address[] memory redeemParticipants)
    {
        return (cycleDepositParticipants[cycleId], cycleRedeemParticipants[cycleId]);
    }

    function maxAllocatableAssets() public view returns (uint256) {
        CycleData storage cycle = cycles[currentCycleId];
        uint256 currentBalance = assetToken.balanceOf(address(this));
        uint256 reserved = cycle.totalQueuedDepositAssets + cycle.totalQueuedRedeemAssets + totalClaimableRedeemAssets;
        if (currentBalance <= reserved) {
            return 0;
        }
        return currentBalance - reserved;
    }

    function previewDeposit(uint256 assets) external view override returns (uint256 shares) {
        if (state != VaultState.Open) revert PreviewNotSupported();
        return _convertAssetsToShares(assets, currentNAV);
    }

    function previewMint(uint256 shares) external view override returns (uint256 assets) {
        if (state != VaultState.Open) revert PreviewNotSupported();
        return Math.mulDiv(shares, currentNAV, 1e18, Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) external view override returns (uint256 assets) {
        if (state != VaultState.Open) revert PreviewNotSupported();
        return _convertSharesToAssets(shares, currentNAV);
    }

    function previewWithdraw(uint256 assets) external view override returns (uint256 shares) {
        if (state != VaultState.Open) revert PreviewNotSupported();
        return Math.mulDiv(assets, 1e18, currentNAV, Math.Rounding.Ceil);
    }

    function _convertAssetsToShares(uint256 assets, uint256 nav) internal pure returns (uint256) {
        if (assets == 0) return 0;
        if (nav == 0) return assets;
        return Math.mulDiv(assets, 1e18, nav);
    }

    function _convertSharesToAssets(uint256 shares, uint256 nav) internal pure returns (uint256) {
        if (shares == 0) return 0;
        if (nav == 0) return shares;
        return Math.mulDiv(shares, nav, 1e18);
    }

    function _requireFreshNAV() internal view {
        if (block.timestamp - lastNAVUpdate > NAV_STALENESS_THRESHOLD) {
            revert NAVStale(lastNAVUpdate, NAV_STALENESS_THRESHOLD);
        }
    }

    function _requireControllerAuth(address controller) internal view {
        if (msg.sender != controller && !isOperator[controller][msg.sender]) {
            revert NotController(controller, msg.sender);
        }
    }
}
