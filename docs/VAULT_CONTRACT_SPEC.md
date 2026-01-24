# PredictionVault.sol - Contract Specification

## Overview

A simplified ERC-4626-style vault for prediction market exposure. NAV is updated off-chain by admin; withdrawals are processed by admin after positions resolve.

**Key Simplification**: No on-chain position tracking. Backend handles all logic. Contract just manages deposits, share accounting, and admin-triggered withdrawals.

---

## Contract Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract PredictionVault is ERC20, Ownable, Pausable, ReentrancyGuard {
    IERC20 public immutable usdc;
    address public safe;

    uint256 public totalAssets;       // Total USDC value (set by admin)
    uint256 public minDeposit;        // Minimum deposit in USDC (6 decimals)

    // Events
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalRequested(address indexed user, uint256 shares, uint256 requestId);
    event WithdrawalFulfilled(address indexed user, uint256 requestId, uint256 assets);
    event NavUpdated(uint256 newTotalAssets, uint256 timestamp);
    event SafeUpdated(address newSafe);

    // Withdrawal request tracking
    struct WithdrawalRequest {
        address user;
        uint256 shares;
        uint256 requestedAt;
        bool fulfilled;
    }

    uint256 public nextRequestId;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    mapping(address => uint256[]) public userRequestIds;

    constructor(
        address _usdc,
        address _safe,
        uint256 _minDeposit
    ) ERC20("Prediction Vault Share", "pvUSDC") Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        safe = _safe;
        minDeposit = _minDeposit;
        totalAssets = 0;
    }

    // ============ VIEW FUNCTIONS ============

    function navPerShare() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e6; // 1:1 initially (6 decimals)
        return (totalAssets * 1e6) / supply;
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply();
        if (supply == 0) return assets; // 1:1 initially
        return (assets * supply) / totalAssets;
    }

    function getUserRequests(address user) external view returns (uint256[] memory) {
        return userRequestIds[user];
    }

    // ============ USER FUNCTIONS ============

    function deposit(uint256 assets, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        require(assets >= minDeposit, "Below minimum deposit");

        shares = previewDeposit(assets);
        require(shares > 0, "Zero shares");

        // Transfer USDC from user to Safe
        usdc.transferFrom(msg.sender, safe, assets);

        // Mint shares to receiver
        _mint(receiver, shares);

        // Update total assets
        totalAssets += assets;

        emit Deposit(receiver, assets, shares);
    }

    function requestWithdrawal(uint256 shares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        require(shares > 0, "Zero shares");
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");

        // Lock shares by transferring to contract
        _transfer(msg.sender, address(this), shares);

        requestId = nextRequestId++;
        withdrawalRequests[requestId] = WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            requestedAt: block.timestamp,
            fulfilled: false
        });
        userRequestIds[msg.sender].push(requestId);

        emit WithdrawalRequested(msg.sender, shares, requestId);
    }

    // ============ ADMIN FUNCTIONS ============

    function updateNav(uint256 newTotalAssets) external onlyOwner {
        totalAssets = newTotalAssets;
        emit NavUpdated(newTotalAssets, block.timestamp);
    }

    function fulfillWithdrawal(uint256 requestId, uint256 assetsToSend)
        external
        onlyOwner
        nonReentrant
    {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        require(req.user != address(0), "Request not found");
        require(!req.fulfilled, "Already fulfilled");

        req.fulfilled = true;

        // Burn the locked shares
        _burn(address(this), req.shares);

        // Send USDC from Safe to user (Safe must have approved this contract)
        if (assetsToSend > 0) {
            usdc.transferFrom(safe, req.user, assetsToSend);
        }

        // Update total assets
        if (totalAssets >= assetsToSend) {
            totalAssets -= assetsToSend;
        } else {
            totalAssets = 0;
        }

        emit WithdrawalFulfilled(req.user, requestId, assetsToSend);
    }

    function cancelWithdrawal(uint256 requestId) external onlyOwner {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        require(req.user != address(0), "Request not found");
        require(!req.fulfilled, "Already fulfilled");

        req.fulfilled = true; // Mark as handled

        // Return shares to user
        _transfer(address(this), req.user, req.shares);
    }

    function setSafe(address newSafe) external onlyOwner {
        safe = newSafe;
        emit SafeUpdated(newSafe);
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

    // Emergency: recover stuck tokens (not USDC or vault shares)
    function recoverToken(address token, uint256 amount) external onlyOwner {
        require(token != address(usdc), "Cannot recover USDC");
        IERC20(token).transfer(owner(), amount);
    }
}
```

---

## Deployment Parameters

| Parameter    | Testnet (Amoy)                                           | Mainnet (Polygon)                            |
| ------------ | -------------------------------------------------------- | -------------------------------------------- |
| USDC Address | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` (Test USDC) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Safe Address | Your testnet Safe                                        | Your mainnet Safe                            |
| Min Deposit  | `10000000` (10 USDC)                                     | `10000000` (10 USDC)                         |

---

## How to Deploy

### Option 1: Remix IDE (Recommended)

1. Go to https://remix.ethereum.org
2. Create new file `PredictionVault.sol`
3. Paste the contract code above
4. In Solidity Compiler:
   - Select version `0.8.20`
   - Enable optimization (200 runs)
   - Compile
5. In Deploy & Run:
   - Environment: "Injected Provider - MetaMask"
   - Select Polygon Amoy (testnet) or Polygon (mainnet)
   - Enter constructor args: `_usdc`, `_safe`, `_minDeposit`
   - Deploy

### Option 2: Using cast (Foundry CLI)

```bash
# Compile
forge build

# Deploy to Amoy testnet
cast send --rpc-url $AMOY_RPC --private-key $PRIVATE_KEY \
  --create $(cat out/PredictionVault.sol/PredictionVault.json | jq -r '.bytecode.object') \
  $USDC_ADDRESS $SAFE_ADDRESS 10000000
```

---

## Post-Deployment Steps

1. **Verify Contract** on Polygonscan
2. **Set Safe Allowance**: The Gnosis Safe must approve the vault contract to spend USDC for fulfilling withdrawals
3. **Transfer Ownership** (optional): Transfer to a multisig if desired
4. **Update Backend**: Add contract address to `.env`:
   ```
   TESTNET_VAULT_CONTRACT_ADDRESS=0x...
   # or
   VAULT_CONTRACT_ADDRESS=0x...
   ```

---

## Contract Interaction Flow

### Deposit

```
User → approve(vault, amount) on USDC
User → deposit(amount, receiver) on Vault
       → USDC transferred to Safe
       → Shares minted to receiver
       → totalAssets increased
```

### Withdrawal

```
User → requestWithdrawal(shares) on Vault
       → Shares locked in contract
       → Request ID emitted

... positions resolve off-chain ...

Admin → fulfillWithdrawal(requestId, usdcAmount) on Vault
       → Shares burned
       → USDC sent from Safe to user
       → totalAssets decreased
```

### NAV Update

```
Admin → updateNav(newTotalAssets) on Vault
       → Share price recalculated
       → Event emitted
```

---

## Security Considerations

1. **Owner is trusted**: Owner can update NAV and fulfill withdrawals
2. **Safe must approve vault**: For `fulfillWithdrawal` to work
3. **Pausable**: Owner can pause in emergency
4. **No flash loan risk**: Deposits go to Safe, not contract
5. **Reentrancy protected**: All state-changing functions use nonReentrant

---

## ABI (for frontend/backend)

After deployment, export the ABI from Remix or use:

```typescript
const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function requestWithdrawal(uint256 shares) returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function navPerShare() view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function withdrawalRequests(uint256) view returns (address user, uint256 shares, uint256 requestedAt, bool fulfilled)",
  "function getUserRequests(address) view returns (uint256[])",
  "event Deposit(address indexed user, uint256 assets, uint256 shares)",
  "event WithdrawalRequested(address indexed user, uint256 shares, uint256 requestId)",
  "event WithdrawalFulfilled(address indexed user, uint256 requestId, uint256 assets)",
  "event NavUpdated(uint256 newTotalAssets, uint256 timestamp)",
] as const;
```
