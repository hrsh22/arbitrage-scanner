# Dual-Safe Vault Operator Runbook: Amoy Testnet

> **CANONICAL DEPLOYMENT:** `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D`
> 
> This is the ONLY valid EpochTrancheVault deployment on Amoy. Any other address is stale or invalid.

Complete guide for deploying and operating the EpochTrancheVault contract on Polygon Amoy testnet.

Complete guide for deploying and operating the EpochTrancheVault contract on Polygon Amoy testnet.

**Target Environment:** Polygon Amoy Testnet (Chain ID: 80002)
**Contract:** EpochTrancheVault (dual-safe architecture)
**Last Updated:** March 2026

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Pre-Deployment Checklist](#2-pre-deployment-checklist)
3. [Contract Deployment](#3-contract-deployment)
4. [Post-Deployment Validation](#4-post-deployment-validation)
5. [Role Assignment](#5-role-assignment)
6. [End-to-End Test Sequence](#6-end-to-end-test-sequence)
7. [Troubleshooting Guide](#7-troubleshooting-guide)
8. [Emergency Procedures](#8-emergency-procedures)

---

## Supported Economic Model: Boundary Settlement

This vault implements **Boundary Settlement Only** - a specific redemption model with strict constraints:

### Supported Behavior

| Feature | Description |
|---------|-------------|
| **Epoch-based settlement** | Redemptions processed at epoch boundaries only |
| **Full entitlement at settlement** | 100% of entitled USDC available after settlement |
| **Irreversible requests** | No cancellation after submission |
| **Boundary NAV pricing** | NAV snapshot at freeze determines entitlement |

### Request Lifecycle

```
pending -> frozen -> claimable -> closed
```

1. **pending**: Request submitted, waiting for epoch end
2. **frozen**: Epoch frozen, NAV snapshot captured, entitlement locked
3. **claimable**: Settlement complete, full entitlement available
4. **closed**: Assets claimed, request complete

---

## 1. Prerequisites

### 1.1 Environment Variables

Create `contracts/scripts/.env` with the following:

```bash
# =============================================================================
# DEPLOYMENT KEYS
# =============================================================================

# Deployer private key (0x + 64 hex characters)
# Must have sufficient MATIC for gas fees on Amoy
PRIVATE_KEY=<YOUR_DEPLOYER_PRIVATE_KEY>

# =============================================================================
# ROLE ADDRESSES (EOA Operators for Amoy)
# =============================================================================

# Admin role - has full control over contract
EPOCH_TRANCHE_ADMIN_ADDRESS=0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74

# Settler role - handles epoch settlement and finalization
EPOCH_TRANCHE_SETTLER_ADDRESS=<TBD_SETTLER_EOA>

# NAV Updater role - updates NAV with freshness checks
EPOCH_TRANCHE_NAV_UPDATER_ADDRESS=<TBD_NAV_UPDATER_EOA>

# Snapshotter role - freezes epochs and creates snapshots
EPOCH_TRANCHE_SNAPSHOTTER_ADDRESS=<TBD_SNAPSHOTTER_EOA>

# Deposit Processor role - processes deposit queue
EPOCH_TRANCHE_DEPOSIT_PROCESSOR_ADDRESS=<TBD_DEPOSIT_PROCESSOR_EOA>

# Trading Safe - receives deployed capital (dual-safe architecture)
EPOCH_TRANCHE_TRADING_SAFE_ADDRESS=<TBD_TRADING_SAFE>

# =============================================================================
# RPC ENDPOINT
# =============================================================================

# Polygon Amoy Testnet
POLYGON_TESTNET_RPC=https://rpc-amoy.polygon.technology
```

### 1.2 Wallet Requirements

| Wallet            | Purpose                        | Address Example                              |
| ----------------- | ------------------------------ | -------------------------------------------- |
| Deployer          | Contract deployment and admin  | `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74` |
| Settler           | Epoch settlement (EOA on Amoy) | `<TBD>`                                      |
| NAV Updater       | NAV updates (EOA on Amoy)      | `<TBD>`                                      |
| Snapshotter       | Epoch freezing (EOA on Amoy)   | `<TBD>`                                      |
| Deposit Processor | Queue processing (EOA on Amoy) | `<TBD>`                                      |
| Trading Safe      | Capital deployment target      | `<TBD>`                                      |

### 1.3 Amoy Testnet Details

| Parameter      | Value                                        |
| -------------- | -------------------------------------------- |
| Chain ID       | 80002                                        |
| RPC URL        | `https://rpc-amoy.polygon.technology`        |
| USDC Address   | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |
| Block Explorer | `https://amoy.polygonscan.com`               |

### 1.4 Required Tools

```bash
# Foundry (forge, cast)
forge --version  # Should be 0.2.0 or later

# Node.js dependencies
pnpm install
cd contracts && npm install

# Verify ethers.js is available
node -e "console.log(require('ethers').version)"
```

---

## 2. Pre-Deployment Checklist

### 2.1 Funding Check

Deployer must have Amoy MATIC for gas:

```bash
# Check deployer balance
cast balance 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74 --rpc-url https://rpc-amoy.polygon.technology

# Expected: at least 0.1 MATIC (100000000000000000 wei)
```

Get Amoy MATIC from: [Polygon Faucet](https://faucet.polygon.technology)

### 2.2 Contract Compilation

```bash
cd contracts

# Clean previous builds
forge clean

# Compile contract
forge build

# Verify output exists
ls -la out/EpochTrancheVault.sol/EpochTrancheVault.json
```

Expected output:

```
[⠊] Compiling...
[⠒] Compiling 1 files with 0.8.28
[⠑] Solc finished in 2.34s
Compiler run successful!
```

### 2.3 Environment Validation

```bash
cd contracts/scripts

# Check all required env vars are set
node deployEpochTrancheVault.js --help

# Validate environment (dry-run mode)
node deployEpochTrancheVault.js --profile staging --rpc-url https://rpc-amoy.polygon.technology --dry-run --json
```

### 2.4 Role Address Validation

Verify all role addresses are valid EOAs (not contracts) on Amoy:

```bash
# Check if address is an EOA (code should be 0x)
cast code <SETTLER_ADDRESS> --rpc-url https://rpc-amoy.polygon.technology
# Expected: 0x

cast code <NAV_UPDATER_ADDRESS> --rpc-url https://rpc-amoy.polygon.technology
# Expected: 0x

cast code <SNAPSHOTTER_ADDRESS> --rpc-url https://rpc-amoy.polygon.technology
# Expected: 0x

cast code <DEPOSIT_PROCESSOR_ADDRESS> --rpc-url https://rpc-amoy.polygon.technology
# Expected: 0x
```

### 2.5 Pre-Deployment Checklist Summary

- [ ] Deployer wallet funded with Amoy MATIC (min 0.1 MATIC)
- [ ] All role addresses determined and documented
- [ ] Trading Safe address determined (can be any address on Amoy)
- [ ] Contract compiled successfully
- [ ] Environment variables configured in `.env`
- [ ] All role addresses verified as EOAs (code = 0x)
- [ ] RPC endpoint accessible

---

## 3. Contract Deployment

### 3.1 Constructor Arguments

The `EpochTrancheVault` constructor requires these parameters in exact order:

```solidity
constructor(
    address _asset,                    // USDC: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
    address _admin,                    // Deployer: 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74
    address _settler,                  // <TBD_SETTLER_EOA>
    address _navUpdater,               // <TBD_NAV_UPDATER_EOA>
    address _snapshotter,              // <TBD_SNAPSHOTTER_EOA>
    address _depositProcessor,         // <TBD_DEPOSIT_PROCESSOR_EOA>
    address _tradingSafe,              // <TBD_TRADING_SAFE>
    uint256 _epochDuration,            // 3600 (1 hour for staging)
    uint256 _navStalenessThreshold,    // 21600 (6 hours)
    uint256 _minClaimThreshold,        // 100000000 (100 USDC, 6 decimals)
    uint256 _balancedUpfrontBps        // 0
)
```

### 3.2 Staging Profile Configuration

| Parameter               | Value                                        | Notes                           |
| ----------------------- | -------------------------------------------- | ------------------------------- |
| Epoch Duration          | 3600 seconds                                 | 1 hour (suitable for testing)   |
| NAV Staleness Threshold | 21600 seconds                                | 6 hours                         |
| Min Claim Threshold     | 100000000                                    | 100 USDC (prevents dust claims) |
| Balanced Upfront Bps    | 0                                            | No upfront fee                  |
| Asset                   | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | Amoy USDC                       |

### 3.3 Remix Deployment Procedure

For manual deployment via Remix IDE (useful for testing or when script deployment is unavailable):

#### Step 1: Generate Flattened Contract

```bash
cd contracts
bash scripts/flattenEpochTrancheVaultForRemix.sh
```

This generates `contracts/flattened/EpochTrancheVault.flattened.sol`.

#### Step 2: Remix IDE Setup

1. Open [Remix IDE](https://remix.ethereum.org)
2. Create a new file and paste the contents of `EpochTrancheVault.flattened.sol`
3. In the Solidity compiler tab, select version `0.8.28`
4. Click "Compile"

#### Step 3: CRITICAL - Select Correct Contract

**WARNING:** The flattened file contains multiple contracts (libraries, abstract contracts, interfaces). In the "Deploy" section of Remix:

- **SELECT:** `EpochTrancheVault` (the main concrete contract)
- **DO NOT SELECT:** `ERC20`, `AccessControl`, `ReentrancyGuard`, or any abstract/interface contracts

**Pitfall:** Deploying an abstract base contract instead of `EpochTrancheVault` will result in a non-functional deployment that cannot be used as a vault.

#### Step 4: Deploy with Constructor Arguments

Use the constructor parameters from Section 3.1. For staging:

```solidity
_asset:              0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
_admin:              0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74
_settler:            <SETTLER_EOA>
_navUpdater:         <NAV_UPDATER_EOA>
_snapshotter:        <SNAPSHOTTER_EOA>
_depositProcessor:   <DEPOSIT_PROCESSOR_EOA>
_tradingSafe:        <TRADING_SAFE_EOA_OR_CONTRACT>
_epochDuration:      3600
_navStalenessThreshold: 21600
_minClaimThreshold:  100000000
_balancedUpfrontBps: 0
```

Connect MetaMask to Polygon Amoy (Chain ID: 80002) and deploy.

### 3.4 Dry Run Deployment (Script)

Always run dry-run first:

```bash
cd contracts/scripts

node deployEpochTrancheVault.js \
  --profile staging \
  --rpc-url https://rpc-amoy.polygon.technology \
  --dry-run
```

Expected output:

```
╔══════════════════════════════════════════════════════════════╗
║  STEP 1: SETUP PROVIDER AND WALLET                           ║
╚══════════════════════════════════════════════════════════════╝
  Network: polygon-amoy (chainId: 80002)
  Deployer: 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74
  Balance: 1.5 MATIC

╔══════════════════════════════════════════════════════════════╗
║  STEP 2: LOAD CONFIGURATION                                  ║
╚══════════════════════════════════════════════════════════════╝
  Profile: Staging
  Asset: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
  Epoch Duration: 3600 seconds (0.04 days)
  ...

╔══════════════════════════════════════════════════════════════╗
║  STEP 4: DEPLOY CONTRACT                                     ║
╚══════════════════════════════════════════════════════════════╝
  📝 DRY RUN MODE - Simulating deployment
  Would-be address: 0x... (calculated deterministically)
  Gas estimate: ~0.0012 MATIC
```

### 3.5 Live Deployment

After successful dry-run, execute live deployment:

```bash
cd contracts/scripts

node deployEpochTrancheVault.js \
  --profile staging \
  --rpc-url https://rpc-amoy.polygon.technology \
  --output-dir ./deployments
```

Expected output:

```
╔══════════════════════════════════════════════════════════════╗
║  STEP 4: DEPLOY CONTRACT                                     ║
╚══════════════════════════════════════════════════════════════╝
  🚀 Deploying contract...
  Deployment tx: 0x...
  Waiting for confirmation...
  ✅ Contract deployed at: 0x<VAULT_ADDRESS>
  Block number: 12345678
  Gas used: 2847392

╔══════════════════════════════════════════════════════════════╗
║  STEP 5: VERIFY DEPLOYMENT                                   ║
╚══════════════════════════════════════════════════════════════╝
  Asset: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 ✓
  Epoch Duration: 3600 ✓
  NAV Staleness Threshold: 21600 ✓
  Min Claim Threshold: 100000000 ✓
  Trading Safe: 0x... ✓
  Admin has ADMIN_ROLE: ✓
  Settler has SETTLER_ROLE: ✓
  NAV Updater has NAV_UPDATER_ROLE: ✓
  Snapshotter has SNAPSHOT_ROLE: ✓
  Deposit Processor has DEPOSIT_PROCESSOR_ROLE: ✓
  ✅ Deployment verified successfully

╔══════════════════════════════════════════════════════════════╗
║  DEPLOYMENT COMPLETE                                         ║
╚══════════════════════════════════════════════════════════════╝
  Profile: Staging
  Duration: 15432ms
  Verdict: success
  Contract Address: 0x<VAULT_ADDRESS>
```

### 3.6 Save Deployment Artifacts

After deployment, artifacts are saved to:

```bash
# Timestamped artifact
contracts/deployments/epoch-tranche-vault-staging-<timestamp>.json

# Latest artifact (overwritten on each deploy)
contracts/deployments/epoch-tranche-vault-staging-latest.json
```

Extract the vault address:

```bash
cd contracts
VAULT_ADDRESS=$(cat deployments/epoch-tranche-vault-staging-latest.json | grep -o '"address": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "Vault Address: $VAULT_ADDRESS"
```

---

## 4. Post-Deployment Validation

### 4.1 Contract State Verification

Replace `<VAULT_ADDRESS>` with your deployed contract address:

```bash
export VAULT_ADDRESS=<VAULT_ADDRESS>
export RPC_URL=https://rpc-amoy.polygon.technology

# Verify asset address
cast call $VAULT_ADDRESS "asset()" --rpc-url $RPC_URL
# Expected: 0x00000000000000000000000041e94eb019c0762f9bfcf9fb1e58725bfb0e7582

# Verify epoch duration
cast call $VAULT_ADDRESS "EPOCH_DURATION()" --rpc-url $RPC_URL
# Expected: 3600 (0x0e10 in hex)

# Verify NAV staleness threshold
cast call $VAULT_ADDRESS "NAV_STALENESS_THRESHOLD()" --rpc-url $RPC_URL
# Expected: 21600 (0x5460 in hex)

# Verify min claim threshold
cast call $VAULT_ADDRESS "MIN_CLAIM_THRESHOLD()" --rpc-url $RPC_URL
# Expected: 100000000 (0x05f5e100 in hex)

# Verify trading safe
cast call $VAULT_ADDRESS "tradingSafe()" --rpc-url $RPC_URL
# Expected: <TBD_TRADING_SAFE>

# Verify current epoch ID (should be 0 initially)
cast call $VAULT_ADDRESS "currentEpochId()" --rpc-url $RPC_URL
# Expected: 0

# Verify current NAV (should be 0 initially, needs update)
cast call $VAULT_ADDRESS "currentNAV()" --rpc-url $RPC_URL
# Expected: 0

# Verify emergency mode
cast call $VAULT_ADDRESS "emergencyMode()" --rpc-url $RPC_URL
# Expected: false (0x00)
```

### 4.2 Role Verification

```bash
# Get role hashes
ADMIN_ROLE=$(cast call $VAULT_ADDRESS "ADMIN_ROLE()" --rpc-url $RPC_URL)
SETTLER_ROLE=$(cast call $VAULT_ADDRESS "SETTLER_ROLE()" --rpc-url $RPC_URL)
NAV_UPDATER_ROLE=$(cast call $VAULT_ADDRESS "NAV_UPDATER_ROLE()" --rpc-url $RPC_URL)
SNAPSHOT_ROLE=$(cast call $VAULT_ADDRESS "SNAPSHOT_ROLE()" --rpc-url $RPC_URL)
DEPOSIT_PROCESSOR_ROLE=$(cast call $VAULT_ADDRESS "DEPOSIT_PROCESSOR_ROLE()" --rpc-url $RPC_URL)

echo "ADMIN_ROLE: $ADMIN_ROLE"
echo "SETTLER_ROLE: $SETTLER_ROLE"
echo "NAV_UPDATER_ROLE: $NAV_UPDATER_ROLE"
echo "SNAPSHOT_ROLE: $SNAPSHOT_ROLE"
echo "DEPOSIT_PROCESSOR_ROLE: $DEPOSIT_PROCESSOR_ROLE"

# Verify admin has role
cast call $VAULT_ADDRESS "hasRole(bytes32,address)" $ADMIN_ROLE 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74 --rpc-url $RPC_URL
# Expected: true (0x0000000000000000000000000000000000000000000000000000000000000001)

# Verify settler has role
cast call $VAULT_ADDRESS "hasRole(bytes32,address)" $SETTLER_ROLE <SETTLER_ADDRESS> --rpc-url $RPC_URL
# Expected: true

# Verify NAV updater has role
cast call $VAULT_ADDRESS "hasRole(bytes32,address)" $NAV_UPDATER_ROLE <NAV_UPDATER_ADDRESS> --rpc-url $RPC_URL
# Expected: true

# Verify snapshotter has role
cast call $VAULT_ADDRESS "hasRole(bytes32,address)" $SNAPSHOT_ROLE <SNAPSHOTTER_ADDRESS> --rpc-url $RPC_URL
# Expected: true

# Verify deposit processor has role
cast call $VAULT_ADDRESS "hasRole(bytes32,address)" $DEPOSIT_PROCESSOR_ROLE <DEPOSIT_PROCESSOR_ADDRESS> --rpc-url $RPC_URL
# Expected: true
```

### 4.3 USDC Approval Verification

Test that the vault can receive USDC:

```bash
# Check USDC balance of vault (should be 0 initially)
cast call 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 \
  "balanceOf(address)" $VAULT_ADDRESS \
  --rpc-url $RPC_URL
# Expected: 0

# Check total assets (should be 0 initially)
cast call $VAULT_ADDRESS "totalAssets()" --rpc-url $RPC_URL
# Expected: 0
```

---

## 5. Role Assignment

### 5.1 EOA Operator Model for Amoy

On Amoy testnet, roles are assigned to EOAs (Externally Owned Accounts) rather than Safe multisigs. This simplifies testing while maintaining role separation.

### 5.2 Role Summary

| Role                   | Address Type | Purpose                              |
| ---------------------- | ------------ | ------------------------------------ |
| ADMIN_ROLE             | EOA          | Emergency mode, admin functions      |
| SETTLER_ROLE           | EOA          | Epoch settlement and finalization    |
| NAV_UPDATER_ROLE       | EOA          | NAV updates with freshness checks    |
| SNAPSHOT_ROLE          | EOA          | Epoch freezing and snapshot creation |
| DEPOSIT_PROCESSOR_ROLE | EOA          | Processing deposit queue             |

### 5.3 Granting Additional Roles (if needed)

If you need to grant roles to additional addresses post-deployment:

```bash
# Set environment
export VAULT_ADDRESS=<VAULT_ADDRESS>
export RPC_URL=https://rpc-amoy.polygon.technology
export ADMIN_PRIVATE_KEY=<ADMIN_PRIVATE_KEY>

# Grant settler role to new address
cast send $VAULT_ADDRESS \
  "grantRole(bytes32,address)" \
  $SETTLER_ROLE \
  <NEW_SETTLER_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY

# Grant NAV updater role
cast send $VAULT_ADDRESS \
  "grantRole(bytes32,address)" \
  $NAV_UPDATER_ROLE \
  <NEW_NAV_UPDATER_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY

# Grant snapshotter role
cast send $VAULT_ADDRESS \
  "grantRole(bytes32,address)" \
  $SNAPSHOT_ROLE \
  <NEW_SNAPSHOTTER_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY

# Grant deposit processor role
cast send $VAULT_ADDRESS \
  "grantRole(bytes32,address)" \
  $DEPOSIT_PROCESSOR_ROLE \
  <NEW_DEPOSIT_PROCESSOR_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY
```

### 5.4 Revoking Roles

```bash
# Revoke settler role
cast send $VAULT_ADDRESS \
  "revokeRole(bytes32,address)" \
  $SETTLER_ROLE \
  <OLD_SETTLER_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_PRIVATE_KEY
```

---

## 6. End-to-End Test Sequence

Complete test flow: deposit, deploy capital, recall capital, redeem.

### 6.1 Test Prerequisites

```bash
# Set environment variables
export VAULT_ADDRESS=<VAULT_ADDRESS>
export USDC_ADDRESS=0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
export RPC_URL=https://rpc-amoy.polygon.technology

# Test user wallet (must have Amoy USDC)
export TEST_USER_KEY=<TEST_USER_PRIVATE_KEY>
export TEST_USER_ADDRESS=<TEST_USER_ADDRESS>

# Operator keys
export SNAPSHOTTER_KEY=<SNAPSHOTTER_PRIVATE_KEY>
export NAV_UPDATER_KEY=<NAV_UPDATER_PRIVATE_KEY>
export SETTLER_KEY=<SETTLER_PRIVATE_KEY>
export DEPOSIT_PROCESSOR_KEY=<DEPOSIT_PROCESSOR_PRIVATE_KEY>
export ADMIN_KEY=<ADMIN_PRIVATE_KEY>
```

Get Amoy USDC from: [Circle Testnet Faucet](https://faucet.circle.com)

### 6.2 Step 1: Update NAV

NAV must be fresh before deposits and freezes:

```bash
# Update NAV to 1.0 (1e18 precision)
cast send $VAULT_ADDRESS \
  "updateNAV(uint256)" 1000000000000000000 \
  --rpc-url $RPC_URL \
  --private-key $NAV_UPDATER_KEY

# Verify NAV update
cast call $VAULT_ADDRESS "currentNAV()" --rpc-url $RPC_URL
# Expected: 1000000000000000000

cast call $VAULT_ADDRESS "lastNAVUpdate()" --rpc-url $RPC_URL
# Expected: <current timestamp>

cast call $VAULT_ADDRESS "isNAVFresh()" --rpc-url $RPC_URL
# Expected: true
```

### 6.3 Step 2: Deposit USDC

```bash
# Approve USDC spend
cast send $USDC_ADDRESS \
  "approve(address,uint256)" \
  $VAULT_ADDRESS \
  1000000000 \
  --rpc-url $RPC_URL \
  --private-key $TEST_USER_KEY

# Queue deposit (1000 USDC = 1000000000 with 6 decimals)
cast send $VAULT_ADDRESS \
  "queueDeposit(uint256)" \
  1000000000 \
  --rpc-url $RPC_URL \
  --private-key $TEST_USER_KEY

# Note the requestId from the event logs
# Expected requestId: 1 (first deposit)

# Verify deposit queue
cast call $VAULT_ADDRESS "totalQueuedAssets()" --rpc-url $RPC_URL
# Expected: 1000000000
```

### 6.4 Step 4: Wait for Epoch to End

With 1-hour epochs on staging, wait for epoch 0 to end:

```bash
# Check current epoch
cast call $VAULT_ADDRESS "currentEpochId()" --rpc-url $RPC_URL
# Expected: 0 (if within first hour)

# Check epoch end time
cast call $VAULT_ADDRESS "epochs(uint256)" 0 --rpc-url $RPC_URL
# Returns tuple: (epochId, startTime, endTime, ...)

# Or wait for epoch to naturally progress
# For testing, you can also check block timestamp
cast block-number --rpc-url $RPC_URL
cast block $(cast block-number --rpc-url $RPC_URL) --rpc-url $RPC_URL | grep timestamp
```

### 6.5 Step 5: Freeze Epoch

Once epoch 0 has ended:

```bash
# Create snapshot hash (keccak256 of snapshot data)
SNAPSHOT_HASH=$(cast keccak "test-snapshot-$(date +%s)")

# Freeze epoch
cast send $VAULT_ADDRESS \
  "freezeEpoch(bytes32)" \
  $SNAPSHOT_HASH \
  --rpc-url $RPC_URL \
  --private-key $SNAPSHOTTER_KEY

# Verify epoch is frozen
cast call $VAULT_ADDRESS "epochs(uint256)" 0 --rpc-url $RPC_URL
# Check status field: 1 = Frozen
```

### 6.6 Step 6: Process Deposit Queue

```bash
# Process deposit queue for epoch 1 (deposits target next epoch)
cast send $VAULT_ADDRESS \
  "processDepositQueue(uint256,uint256,uint256)" \
  1 0 100 \
  --rpc-url $RPC_URL \
  --private-key $DEPOSIT_PROCESSOR_KEY

# Verify shares minted
cast call $VAULT_ADDRESS "balanceOf(address)" $TEST_USER_ADDRESS --rpc-url $RPC_URL
# Expected: ~1000000000 shares (based on NAV)

# Verify deposit processed
cast call $VAULT_ADDRESS "depositRequests(uint256)" 1 --rpc-url $RPC_URL
# Check processed field: true
```

### 6.7 Step 7: Deploy Capital

```bash
# Deploy 500 USDC to trading safe
cast send $VAULT_ADDRESS \
  "deployCapital(uint256)" \
  500000000 \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_KEY

# Verify deployed capital
cast call $VAULT_ADDRESS "getDeployedCapital()" --rpc-url $RPC_URL
# Expected: 500000000

# Verify USDC transferred to trading safe
cast call $USDC_ADDRESS "balanceOf(address)" <TRADING_SAFE> --rpc-url $RPC_URL
```

### 6.8 Step 8: Recall Capital

```bash
# Recall 200 USDC from trading safe
# NOTE: Trading safe must approve vault to transfer USDC back

cast send $VAULT_ADDRESS \
  "recallCapital(uint256)" \
  200000000 \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_KEY

# Verify updated deployed capital
cast call $VAULT_ADDRESS "getDeployedCapital()" --rpc-url $RPC_URL
# Expected: 300000000
```

### 6.9 Step 9: Request Redemption

```bash
# User requests to redeem 100 shares
cast send $VAULT_ADDRESS \
  "requestRedeem(uint256,address,address)" \
  100000000 \
  $TEST_USER_ADDRESS \
  $TEST_USER_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $TEST_USER_KEY

# Note the requestId from event logs

# Verify redemption request
cast call $VAULT_ADDRESS "redemptionRequests(uint256)" <REQUEST_ID> --rpc-url $RPC_URL
```

### 6.10 Step 10: Settle Epoch

```bash
# Update NAV (must be fresh)
cast send $VAULT_ADDRESS \
  "updateNAV(uint256)" 1000000000000000000 \
  --rpc-url $RPC_URL \
  --private-key $NAV_UPDATER_KEY

# Settle epoch with available assets and carry
cast send $VAULT_ADDRESS \
  "settleEpoch(uint256,uint256)" \
  <EPOCH_ID> \
  900000000 \
  10000000 \
  --rpc-url $RPC_URL \
  --private-key $SETTLER_KEY

# Verify epoch settled
cast call $VAULT_ADDRESS "epochs(uint256)" <EPOCH_ID> --rpc-url $RPC_URL
# Check status field: 3 = Settled
```

### 6.11 Step 11: Claim Redemption

```bash
# User claims redemption
cast send $VAULT_ADDRESS \
  "redeem(uint256,uint256,address)" \
  <REQUEST_ID> \
  100000000 \
  $TEST_USER_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $TEST_USER_KEY

# Verify USDC received
cast call $USDC_ADDRESS "balanceOf(address)" $TEST_USER_ADDRESS --rpc-url $RPC_URL
```

### 6.12 Step 12: Finalize Epoch

```bash
# Finalize epoch after all claims
cast send $VAULT_ADDRESS \
  "finalizeEpoch(uint256)" \
  <EPOCH_ID> \
  --rpc-url $RPC_URL \
  --private-key $SETTLER_KEY

# Verify epoch finalized
cast call $VAULT_ADDRESS "epochs(uint256)" <EPOCH_ID> --rpc-url $RPC_URL
# Check status field: 4 = Finalized
```

---

## 7. Troubleshooting Guide

### 7.1 Deployment Issues

| Issue                | Cause                 | Resolution                              |
| -------------------- | --------------------- | --------------------------------------- |
| `bytecode not found` | Contract not compiled | Run `forge build` in contracts/         |
| `insufficient funds` | Deployer lacks MATIC  | Get Amoy MATIC from faucet              |
| `invalid address`    | Malformed env var     | Check address format: 0x + 40 hex chars |
| `chain ID mismatch`  | Wrong RPC URL         | Verify RPC points to Amoy (80002)       |

### 7.2 Transaction Reverts

| Error                 | Cause                      | Resolution                              |
| --------------------- | -------------------------- | --------------------------------------- |
| `Unauthorized`        | Caller lacks role          | Verify address has required role        |
| `NAVStale`            | NAV > 6 hours old          | Call `updateNAV()` before operation     |
| `EpochNotActive`      | Epoch not in Active state  | Check current epoch status              |
| `EpochNotFrozen`      | Epoch not in Frozen state  | Call `freezeEpoch()` first              |
| `EpochNotEnded`       | Epoch duration not elapsed | Wait for `block.timestamp > endTime`    |
| `EpochNotSettled`     | Epoch not in Settled state | Call `settleEpoch()` first              |
| `BelowClaimThreshold` | Claim < 100 USDC           | Claim more or wait for finalization     |
| `EmergencyModeActive` | Emergency mode enabled     | Call `setEmergencyMode(false)` as admin |
| `ZeroAmount`          | Zero value provided        | Provide non-zero amount                 |
| `InvalidAddress`      | Zero address provided      | Provide valid non-zero address          |

### 7.3 Role-Related Issues

```bash
# Check if address has role
export ROLE=$(cast call $VAULT_ADDRESS "SETTLER_ROLE()" --rpc-url $RPC_URL)
cast call $VAULT_ADDRESS "hasRole(bytes32,address)" $ROLE <ADDRESS> --rpc-url $RPC_URL

# Get role admin
cast call $VAULT_ADDRESS "getRoleAdmin(bytes32)" $ROLE --rpc-url $RPC_URL
```

### 7.4 NAV-Related Issues

```bash
# Check NAV freshness
cast call $VAULT_ADDRESS "isNAVFresh()" --rpc-url $RPC_URL

# Check last NAV update timestamp
cast call $VAULT_ADDRESS "lastNAVUpdate()" --rpc-url $RPC_URL

# Check staleness threshold
cast call $VAULT_ADDRESS "NAV_STALENESS_THRESHOLD()" --rpc-url $RPC_URL

# Calculate if stale
current_time=$(date +%s)
last_update=$(cast call $VAULT_ADDRESS "lastNAVUpdate()" --rpc-url $RPC_URL | cast to-dec)
staleness=$(cast call $VAULT_ADDRESS "NAV_STALENESS_THRESHOLD()" --rpc-url $RPC_URL | cast to-dec)
if [ $((current_time - last_update)) -gt $staleness ]; then
  echo "NAV is stale, needs update"
fi
```

### 7.5 Deposit Queue Issues

```bash
# Check total queued assets
cast call $VAULT_ADDRESS "totalQueuedAssets()" --rpc-url $RPC_URL

# Check deposit request
cast call $VAULT_ADDRESS "depositRequests(uint256)" <REQUEST_ID> --rpc-url $RPC_URL

# Check depositor's request for epoch
cast call $VAULT_ADDRESS "depositorEpochRequest(address,uint256)" <DEPOSITOR> <EPOCH> --rpc-url $RPC_URL
```

### 7.6 Redemption Issues

```bash
# Check redemption request
cast call $VAULT_ADDRESS "redemptionRequests(uint256)" <REQUEST_ID> --rpc-url $RPC_URL

# Check controller's request ID
cast call $VAULT_ADDRESS "controllerToRequestId(address)" <CONTROLLER> --rpc-url $RPC_URL

# Check pending redeem request (ERC-7540)
cast call $VAULT_ADDRESS "pendingRedeemRequest(uint256,address)" 0 <CONTROLLER> --rpc-url $RPC_URL

# Check claimable redeem request (ERC-7540)
cast call $VAULT_ADDRESS "claimableRedeemRequest(uint256,address)" 0 <CONTROLLER> --rpc-url $RPC_URL
```

### 7.7 Capital Deployment Issues

```bash
# Check deployed capital
cast call $VAULT_ADDRESS "getDeployedCapital()" --rpc-url $RPC_URL

# Check trading safe
cast call $VAULT_ADDRESS "tradingSafe()" --rpc-url $RPC_URL

# Check total assets
cast call $VAULT_ADDRESS "totalAssets()" --rpc-url $RPC_URL

# Recall capital requires trading safe to have approved vault
# This is done automatically on Amoy if trading safe is an EOA you control
```

---

## 8. Emergency Procedures

### 8.1 Enable Emergency Mode

Emergency mode blocks new deposits and redemption requests:

```bash
# Enable emergency mode (ADMIN_ROLE only)
cast send $VAULT_ADDRESS \
  "setEmergencyMode(bool)" \
  true \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_KEY

# Verify emergency mode
cast call $VAULT_ADDRESS "emergencyMode()" --rpc-url $RPC_URL
# Expected: true
```

### 8.2 Disable Emergency Mode

```bash
# Disable emergency mode
cast send $VAULT_ADDRESS \
  "setEmergencyMode(bool)" \
  false \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_KEY
```

### 8.3 Emergency Effects

When emergency mode is active:

- `queueDeposit()` reverts with `EmergencyModeActive`
- `requestRedeem()` reverts with `EmergencyModeActive`
- Existing claims still allowed
- Settlement paused

### 8.4 Force Role Transfer

If a role key is compromised:

```bash
# Revoke compromised role
cast send $VAULT_ADDRESS \
  "revokeRole(bytes32,address)" \
  $COMPROMISED_ROLE \
  <COMPROMISED_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_KEY

# Grant role to new address
cast send $VAULT_ADDRESS \
  "grantRole(bytes32,address)" \
  $COMPROMISED_ROLE \
  <NEW_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $ADMIN_KEY
```

### 8.5 Contract Verification

Verify contract on Polygonscan Amoy:

```bash
# Install forge-verify if needed
cargo install forge-verify

# Verify contract
forge verify-contract \
  --chain-id 80002 \
  --verifier-url https://api-amoy.polygonscan.com/api \
  --etherscan-api-key <POLYGONSCAN_API_KEY> \
  --compiler-version 0.8.28 \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address,address,address,uint256,uint256,uint256,uint256)" \
    0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 \
    0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74 \
    <SETTLER> <NAV_UPDATER> <SNAPSHOTTER> <DEPOSIT_PROCESSOR> <TRADING_SAFE> \
    3600 21600 100000000 0) \
  <VAULT_ADDRESS> \
  src/EpochTrancheVault.sol:EpochTrancheVault
```

### 8.6 Escalation Path

| Severity | Condition            | Action                                         |
| -------- | -------------------- | ---------------------------------------------- |
| Low      | Minor role issue     | Grant/revoke roles via admin                   |
| Medium   | Contract state issue | Enable emergency mode, investigate             |
| High     | Security compromise  | Emergency mode, revoke roles, assess           |
| Critical | Funds at risk        | Emergency mode, pause all operations, escalate |

---

## 10. Unsupported Operations

### 10.1 Cancellation Disabled

**Redemption requests cannot be cancelled once submitted.** This is a deliberate design decision:
- Contract does not implement cancellation
- Requests are locked at submission time
- Users must wait for settlement to complete

### 10.2 Gradual Realization Not Supported

**Partial or gradual realization between settlements is NOT supported:**
- Full entitlement is realized at settlement boundary only
- No incremental payouts before settlement completes
- Claims only available in `claimable` state, not during `frozen`

### 10.3 Cross-Epoch Positions Unsupported

**Open positions spanning multiple epochs without settlement:**
- Not tracked or supported in current architecture
- Requires separate cohort-accounting system (not built)
- All positions must settle within their target epoch

### 10.4 Pro-rata Settlement Model

When liquidity is insufficient at settlement:
- Pro-rata distribution of available assets
- Unsettled portion rolled to next epoch
- NOT partial realization - full settlement with pro-rata scaling

---

## Appendix A: Quick Reference Commands

### Contract Read Operations

```bash
# Basic info
cast call $VAULT_ADDRESS "asset()" --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "currentEpochId()" --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "currentNAV()" --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "totalAssets()" --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "getDeployedCapital()" --rpc-url $RPC_URL

# Epoch info
cast call $VAULT_ADDRESS "epochs(uint256)" <EPOCH_ID> --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "epochSnapshots(uint256)" <EPOCH_ID> --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "getSettlementProgress(uint256)" <EPOCH_ID> --rpc-url $RPC_URL

# User info
cast call $VAULT_ADDRESS "balanceOf(address)" <USER> --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "depositRequests(uint256)" <REQUEST_ID> --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "redemptionRequests(uint256)" <REQUEST_ID> --rpc-url $RPC_URL
```

### Contract Write Operations

```bash
# Admin operations
cast send $VAULT_ADDRESS "updateNAV(uint256)" <NAV> --rpc-url $RPC_URL --private-key $NAV_UPDATER_KEY
cast send $VAULT_ADDRESS "setEmergencyMode(bool)" <true/false> --rpc-url $RPC_URL --private-key $ADMIN_KEY
cast send $VAULT_ADDRESS "deployCapital(uint256)" <AMOUNT> --rpc-url $RPC_URL --private-key $ADMIN_KEY
cast send $VAULT_ADDRESS "recallCapital(uint256)" <AMOUNT> --rpc-url $RPC_URL --private-key $ADMIN_KEY

# Snapshotter operations
cast send $VAULT_ADDRESS "freezeEpoch(bytes32)" <SNAPSHOT_HASH> --rpc-url $RPC_URL --private-key $SNAPSHOTTER_KEY

# Settler operations
cast send $VAULT_ADDRESS "settleEpoch(uint256,uint256)" <EPOCH_ID> <CARRY> --rpc-url $RPC_URL --private-key $SETTLER_KEY
cast send $VAULT_ADDRESS "finalizeEpoch(uint256)" <EPOCH_ID> --rpc-url $RPC_URL --private-key $SETTLER_KEY

# Deposit processor operations
cast send $VAULT_ADDRESS "processDepositQueue(uint256,uint256,uint256)" <EPOCH> <START> <END> --rpc-url $RPC_URL --private-key $DEPOSIT_PROCESSOR_KEY

# User operations
cast send $VAULT_ADDRESS "queueDeposit(uint256)" <AMOUNT> --rpc-url $RPC_URL --private-key $USER_KEY
cast send $VAULT_ADDRESS "requestRedeem(uint256,address,address)" <SHARES> <CONTROLLER> <OWNER> --rpc-url $RPC_URL --private-key $USER_KEY
Redeem requests are irreversible in the current vault design. Do not attempt cancellation after submission.
cast send $VAULT_ADDRESS "redeem(uint256,uint256,address)" <REQUEST_ID> <SHARES> <RECEIVER> --rpc-url $RPC_URL --private-key $USER_KEY
```

### USDC Operations

```bash
# Check USDC balance
cast call $USDC_ADDRESS "balanceOf(address)" <ADDRESS> --rpc-url $RPC_URL

# Approve USDC spend
cast send $USDC_ADDRESS "approve(address,uint256)" <SPENDER> <AMOUNT> --rpc-url $RPC_URL --private-key $KEY

# Check USDC allowance
cast call $USDC_ADDRESS "allowance(address,address)" <OWNER> <SPENDER> --rpc-url $RPC_URL
```

---

## Appendix B: Deployment Template

Copy and fill in for each deployment:

```markdown
## Deployment Record: <DATE>

### Environment

- Network: Polygon Amoy
- Chain ID: 80002
- RPC: https://rpc-amoy.polygon.technology

### Contract

- Vault Address: <TBD>
- Deployer: 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74

### Role Assignments

| Role              | Address                                    | Type         |
| ----------------- | ------------------------------------------ | ------------ |
| Admin             | 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74 | EOA          |
| Settler           | <TBD>                                      | EOA          |
| NAV Updater       | <TBD>                                      | EOA          |
| Snapshotter       | <TBD>                                      | EOA          |
| Deposit Processor | <TBD>                                      | EOA          |
| Trading Safe      | <TBD>                                      | Contract/EOA |

### Configuration

- Epoch Duration: 3600 seconds (1 hour)
- NAV Staleness Threshold: 21600 seconds (6 hours)
- Min Claim Threshold: 100000000 (100 USDC)
- Balanced Upfront Bps: 0

### Verification

- [ ] Contract deployed successfully
- [ ] All roles assigned correctly
- [ ] Parameters verified on-chain
- [ ] Test deposit completed
- [ ] Test redemption completed
- [ ] Emergency mode tested
```
