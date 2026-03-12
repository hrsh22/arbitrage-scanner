# Dual-Safe Vault Operator Runbook: Amoy Testnet

> **CURRENT STATE NOTICE (March 2026)**
>
> This codebase now targets **ClosedBookBatchVault** (batch/cycle system), but the active Amoy deployment at `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` is still the **legacy EpochTrancheVault** contract.
>
> A new deployment is required to use the closed-book batch system. Until then:
>
> - API endpoints like `/cycles/current` will not function correctly
> - Operators must use the legacy epoch-based procedures documented in Appendix C
> - This document describes the **target** closed-book system for post-cutover operations

---

**Target Environment:** Polygon Amoy Testnet (Chain ID: 80002)  
**Target Contract:** ClosedBookBatchVault (closed-book batch architecture)  
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
9. [Current Deployment Gap](#9-current-deployment-gap)

---

## Supported Economic Model: Closed-Book Batch Settlement

This vault implements **Closed-Book Batch Settlement** - a redemption model with these constraints:

### Supported Behavior

| Feature                                | Description                                         |
| -------------------------------------- | --------------------------------------------------- |
| **Batch-based settlement**             | Redemptions processed in discrete batch cycles      |
| **Shares escrowed during settlement**  | Redemption shares held by vault until batch settles |
| **Irreversible requests after cutoff** | No cancellation after batch enters Cutoff state     |
| **Flatten-time NAV pricing**           | NAV snapshot at flatten determines clearing price   |
| **Pro-rata distribution**              | Applied if insufficient assets for full redemption  |

### Batch/Cycle Lifecycle

```
Open -> Cutoff -> Flattening -> Settling -> Settled -> Closed -> Reopen
```

1. **Open**: Accepting deposits and redemption requests
2. **Cutoff**: Deposits closed, redemptions frozen (can still request redemption)
3. **Flattening**: NAV snapshot taken, clearing price locked, deposits processed
4. **Settling**: Settlement in progress (chunked processing)
5. **Settled**: Settlement complete, claims available
6. **Closed**: Claims window ended
7. **Reopen**: Ready to start next cycle

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
CLOSED_BOOK_ADMIN_ADDRESS=0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74

# Settler role - handles batch settlement and finalization
CLOSED_BOOK_SETTLER_ADDRESS=<TBD_SETTLER_EOA>

# NAV Updater role - updates NAV with freshness checks
CLOSED_BOOK_NAV_UPDATER_ADDRESS=<TBD_NAV_UPDATER_EOA>

# Snapshotter role - triggers cutoff and creates snapshots
CLOSED_BOOK_SNAPSHOTTER_ADDRESS=<TBD_SNAPSHOTTER_EOA>

# Deposit Processor role - processes deposit queue
CLOSED_BOOK_DEPOSIT_PROCESSOR_ADDRESS=<TBD_DEPOSIT_PROCESSOR_EOA>

# Fee Recipient - receives any protocol fees
CLOSED_BOOK_FEE_RECIPIENT_ADDRESS=<TBD_FEE_RECIPIENT>

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
| Settler           | Batch settlement (EOA on Amoy) | `<TBD>`                                      |
| NAV Updater       | NAV updates (EOA on Amoy)      | `<TBD>`                                      |
| Snapshotter       | Cutoff/flatten (EOA on Amoy)   | `<TBD>`                                      |
| Deposit Processor | Queue processing (EOA on Amoy) | `<TBD>`                                      |
| Fee Recipient     | Protocol fee recipient         | `<TBD>`                                      |

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
ls -la out/ClosedBookBatchVault.sol/ClosedBookBatchVault.json
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
node deployClosedBookBatchVault.js --help

# Validate environment (dry-run mode)
node deployClosedBookBatchVault.js --profile staging --rpc-url https://rpc-amoy.polygon.technology --dry-run --json
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
- [ ] Fee recipient address determined
- [ ] Contract compiled successfully
- [ ] Environment variables configured in `.env`
- [ ] All role addresses verified as EOAs (code = 0x)
- [ ] RPC endpoint accessible

---

## 3. Contract Deployment

### 3.1 Constructor Arguments

The `ClosedBookBatchVault` constructor requires these parameters in exact order:

```solidity
constructor(
    address _asset,                    // USDC: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
    address _admin,                    // Deployer: 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74
    address _settler,                  // <TBD_SETTLER_EOA>
    address _navUpdater,               // <TBD_NAV_UPDATER_EOA>
    address _snapshotter,              // <TBD_SNAPSHOTTER_EOA>
    address _depositProcessor,         // <TBD_DEPOSIT_PROCESSOR_EOA>
    uint256 _navStalenessThreshold     // 21600 (6 hours)
)
```

### 3.2 Staging Profile Configuration

| Parameter               | Value                                        | Notes     |
| ----------------------- | -------------------------------------------- | --------- |
| NAV Staleness Threshold | 21600 seconds                                | 6 hours   |
| Asset                   | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | Amoy USDC |

### 3.3 Remix Deployment Procedure

For manual deployment via Remix IDE:

#### Step 1: Generate Flattened Contract

```bash
cd contracts
bash scripts/flattenClosedBookBatchVaultForRemix.sh
```

This generates `contracts/flattened/ClosedBookBatchVault.flattened.sol`.

#### Step 2: Remix IDE Setup

1. Open [Remix IDE](https://remix.ethereum.org)
2. Create a new file and paste the contents of `ClosedBookBatchVault.flattened.sol`
3. In the Solidity compiler tab, select version `0.8.28`
4. Click "Compile"

#### Step 3: CRITICAL - Select Correct Contract

**WARNING:** The flattened file contains multiple contracts. In the "Deploy" section of Remix:

- **SELECT:** `ClosedBookBatchVault` (the main concrete contract)
- **DO NOT SELECT:** `ERC20`, `AccessControl`, `ReentrancyGuard`, or any abstract/interface contracts

**Pitfall:** Deploying an abstract base contract instead of `ClosedBookBatchVault` will result in a non-functional deployment.

#### Step 4: Deploy with Constructor Arguments

Use the constructor parameters from Section 3.1. For staging:

```solidity
_asset:              0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
_admin:              0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74
_settler:            <SETTLER_EOA>
_navUpdater:         <NAV_UPDATER_EOA>
_snapshotter:        <SNAPSHOTTER_EOA>
_depositProcessor:   <DEPOSIT_PROCESSOR_EOA>
_navStalenessThreshold: 21600
```

Connect MetaMask to Polygon Amoy (Chain ID: 80002) and deploy.

### 3.4 Dry Run Deployment (Script)

Always run dry-run first:

```bash
cd contracts/scripts

node deployClosedBookBatchVault.js \
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
  Batch Duration: 3600 seconds (0.04 days)
  ...

╔══════════════════════════════════════════════════════════════╗
║  STEP 4: DEPLOY CONTRACT                                     ║
╚══════════════════════════════════════════════════════════════╝
  📝 DRY RUN MODE - Simulating deployment
  Would-be address: 0x... (calculated deterministically)
  Gas estimate: ~0.0015 MATIC
```

### 3.5 Live Deployment

After successful dry-run, execute live deployment:

```bash
cd contracts/scripts

node deployClosedBookBatchVault.js \
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
  Gas used: 3247392

╔══════════════════════════════════════════════════════════════╗
║  STEP 5: VERIFY DEPLOYMENT                                   ║
╚══════════════════════════════════════════════════════════════╝
  Asset: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 ✓
  Batch Duration: 3600 ✓
  NAV Staleness Threshold: 21600 ✓
  Fee Recipient: 0x... ✓
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
contracts/deployments/closed-book-batch-vault-staging-<timestamp>.json

# Latest artifact (overwritten on each deploy)
contracts/deployments/closed-book-batch-vault-staging-latest.json
```

Extract the vault address:

```bash
cd contracts
VAULT_ADDRESS=$(cat deployments/closed-book-batch-vault-staging-latest.json | grep -o '"address": "[^"]*"' | head -1 | cut -d'"' -f4)
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

# Verify batch duration (named epochDuration for compatibility)
cast call $VAULT_ADDRESS "EPOCH_DURATION()" --rpc-url $RPC_URL
# Expected: 3600 (0x0e10 in hex)

# Verify NAV staleness threshold
cast call $VAULT_ADDRESS "NAV_STALENESS_THRESHOLD()" --rpc-url $RPC_URL
# Expected: 21600 (0x5460 in hex)

# Verify current batch ID (should be 0 initially)
cast call $VAULT_ADDRESS "currentBatchId()" --rpc-url $RPC_URL
# Expected: 0

# Verify current NAV (should be 1e18 initially)
cast call $VAULT_ADDRESS "currentNAV()" --rpc-url $RPC_URL
# Expected: 1000000000000000000

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
# Expected: true

# Verify settler has role
cast call $VAULT_ADDRESS "hasRole(bytes32,address)" $SETTLER_ROLE <SETTLER_ADDRESS> --rpc-url $RPC_URL
# Expected: true
```

### 4.3 Initial Batch Verification

```bash
# Check batch 0 exists and is Open
cast call $VAULT_ADDRESS "batches(uint256)" 0 --rpc-url $RPC_URL
# Returns tuple: (batchId, startTime, endTime, cutoffTime, snapshotNAV, lockedClearingPrice, ...)
# Check status field: 0 = Open

# Verify batch 0 status
cast call $VAULT_ADDRESS "getBatchStatus(uint256)" 0 --rpc-url $RPC_URL
# Expected: 0 (Open)
```

---

## 5. Role Assignment

### 5.1 EOA Operator Model for Amoy

On Amoy testnet, roles are assigned to EOAs rather than Safe multisigs. This simplifies testing while maintaining role separation.

### 5.2 Role Summary

| Role                     | Address Type | Purpose                           |
| ------------------------ | ------------ | --------------------------------- |
| `ADMIN_ROLE`             | EOA          | Emergency mode, admin functions   |
| `SETTLER_ROLE`           | EOA          | Batch settlement                  |
| `NAV_UPDATER_ROLE`       | EOA          | NAV updates with freshness checks |
| `SNAPSHOT_ROLE`          | EOA          | Cutoff and flatten operations     |
| `DEPOSIT_PROCESSOR_ROLE` | EOA          | Processing deposit queue          |

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
```

---

## 6. End-to-End Test Sequence

Complete test flow: deposit, cutoff, flatten, settle, claim, reopen.

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

### 6.2 Step 1: Queue Deposit

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

### 6.3 Step 2: Trigger Cutoff

```bash
# Cutoff closes deposits for current batch
cast send $VAULT_ADDRESS \
  "cutoffBatch()" \
  --rpc-url $RPC_URL \
  --private-key $SNAPSHOTTER_KEY

# Verify batch status is now Cutoff (1)
cast call $VAULT_ADDRESS "getBatchStatus(uint256)" 0 --rpc-url $RPC_URL
# Expected: 1 (Cutoff)
```

### 6.4 Step 3: Flatten Batch

```bash
# Create snapshot hash
SNAPSHOT_HASH=$(cast keccak "test-snapshot-$(date +%s)")

# Flatten batch - locks NAV and clearing price
cast send $VAULT_ADDRESS \
  "flattenBatch(bytes32)" \
  $SNAPSHOT_HASH \
  --rpc-url $RPC_URL \
  --private-key $SNAPSHOTTER_KEY

# Verify batch is now Flattening (2)
cast call $VAULT_ADDRESS "getBatchStatus(uint256)" 0 --rpc-url $RPC_URL
# Expected: 2 (Flattening)

# Verify price is locked
cast call $VAULT_ADDRESS "batches(uint256)" 0 --rpc-url $RPC_URL
# Check isPriceLocked: true
```

### 6.5 Step 4: Process Deposit Queue

```bash
# Process deposit queue for batch 0
cast send $VAULT_ADDRESS \
  "processDepositQueue(uint256,uint256,uint256)" \
  0 0 100 \
  --rpc-url $RPC_URL \
  --private-key $DEPOSIT_PROCESSOR_KEY

# Verify shares minted
cast call $VAULT_ADDRESS "balanceOf(address)" $TEST_USER_ADDRESS --rpc-url $RPC_URL
# Expected: ~1000000000 shares (based on locked clearing price)
```

### 6.6 Step 5: Request Redemption

```bash
# User requests to redeem 500 shares
cast send $VAULT_ADDRESS \
  "requestRedeem(uint256,address,address)" \
  500000000 \
  $TEST_USER_ADDRESS \
  $TEST_USER_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $TEST_USER_KEY

# Note the requestId from event logs

# Verify redemption request
cast call $VAULT_ADDRESS "redemptionRequests(uint256)" <REQUEST_ID> --rpc-url $RPC_URL
# Check status: 0 (Pending) or 1 (Escrowed)
```

### 6.7 Step 6: Settle Batch

```bash
# Update NAV if needed (must be fresh)
cast send $VAULT_ADDRESS \
  "updateNAV(uint256)" 1000000000000000000 \
  --rpc-url $RPC_URL \
  --private-key $NAV_UPDATER_KEY

# Settle batch - processes redemptions
cast send $VAULT_ADDRESS \
  "settleBatch(uint256,uint256)" \
  0 \
  1000000000 \
  --rpc-url $RPC_URL \
  --private-key $SETTLER_KEY

# Verify batch status is now Settled (4)
cast call $VAULT_ADDRESS "getBatchStatus(uint256)" 0 --rpc-url $RPC_URL
# Expected: 4 (Settled)
```

### 6.8 Step 7: Claim Redemption

```bash
# User claims redemption
cast send $VAULT_ADDRESS \
  "redeem(uint256,uint256,address)" \
  <REQUEST_ID> \
  500000000 \
  $TEST_USER_ADDRESS \
  --rpc-url $RPC_URL \
  --private-key $TEST_USER_KEY

# Verify USDC received
cast call $USDC_ADDRESS "balanceOf(address)" $TEST_USER_ADDRESS --rpc-url $RPC_URL
```

### 6.9 Step 8: Close and Reopen

```bash
# Close the batch
cast send $VAULT_ADDRESS \
  "closeBatch(uint256)" \
  0 \
  --rpc-url $RPC_URL \
  --private-key $SETTLER_KEY

# Verify batch status is now Closed (5)
cast call $VAULT_ADDRESS "getBatchStatus(uint256)" 0 --rpc-url $RPC_URL
# Expected: 5 (Closed)

# Reopen for next batch
cast send $VAULT_ADDRESS \
  "reopenBatch()" \
  --rpc-url $RPC_URL \
  --private-key $SETTLER_KEY

# Verify new batch created (batch 1)
cast call $VAULT_ADDRESS "currentBatchId()" --rpc-url $RPC_URL
# Expected: 1
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

| Error                     | Cause                        | Resolution                               |
| ------------------------- | ---------------------------- | ---------------------------------------- |
| `Unauthorized`            | Caller lacks role            | Verify address has required role         |
| `NAVStale`                | NAV > 6 hours old            | Call `updateNAV()` before operation      |
| `BatchNotOpen`            | Batch not in Open state      | Check current batch status               |
| `BatchNotCutoff`          | Cutoff not triggered yet     | Call `cutoffBatch()` first               |
| `BatchNotFlattening`      | Flatten not completed        | Call `flattenBatch()` first              |
| `CannotCancelAfterCutoff` | Tried to cancel after cutoff | Cancellations only allowed in Open state |
| `EmergencyModeActive`     | Emergency mode enabled       | Call `setEmergencyMode(false)` as admin  |

### 7.3 API Issues (Current Deployment Gap)

| Issue                         | Cause                                   | Resolution                                        |
| ----------------------------- | --------------------------------------- | ------------------------------------------------- |
| `/cycles/current` returns 500 | Endpoint targets ClosedBookBatchVault   | Wait for new contract deployment                  |
| `/epochs/current` returns 404 | Old endpoint removed                    | Use `/cycles/current` after cutover               |
| Carry calculation errors      | Legacy EpochTrancheVault still deployed | Use legacy procedures in Appendix C until cutover |

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

### 8.2 Emergency Effects

When emergency mode is active:

- `queueDeposit()` reverts with `EmergencyModeActive`
- `requestRedeem()` reverts with `EmergencyModeActive`
- Existing claims still allowed
- Settlement paused

---

## 9. Current Deployment Gap

### 9.1 The Problem

The codebase has been updated to target `ClosedBookBatchVault`, but the active Amoy deployment remains the legacy `EpochTrancheVault`:

- **Legacy Deployment:** `0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D` (EpochTrancheVault)
- **Target Contract:** ClosedBookBatchVault (not yet deployed)
- **Impact:** API endpoints expecting closed-book behavior will fail

### 9.2 Affected Functionality

| Feature                    | Status          | Notes                                                              |
| -------------------------- | --------------- | ------------------------------------------------------------------ |
| `/cycles/current` endpoint | **BROKEN**      | Returns error on legacy contract                                   |
| Batch lifecycle operations | **UNAVAILABLE** | `cutoffBatch()`, `flattenBatch()` don't exist on EpochTrancheVault |
| Epoch-based operations     | **WORKING**     | Legacy freeze/settle/finalize still functional                     |
| Deposit queue              | **WORKING**     | Compatible between both contracts                                  |
| Redemption flow            | **PARTIAL**     | Different state machines, may behave unexpectedly                  |

### 9.3 Integrated QA Finding

During testing, the `/cycles/current` endpoint was found to fail when called against the current Amoy deployment. This endpoint expects:

- `currentBatchId()` function
- `batches(uint256)` mapping
- `BatchStatus` enum values

The legacy EpochTrancheVault contract lacks these, causing the call to revert.

### 9.4 Operator Guidance

**Until the new contract is deployed:**

1. Use the legacy epoch-based procedures documented in Appendix C
2. Do not rely on `/cycles/*` endpoints
3. Use `/epochs/*` endpoints for current operations
4. Monitor for deployment completion announcement

**After new contract deployment:**

1. Update all environment variables with new contract address
2. Re-run full validation sequence from Section 4
3. Switch to batch/cycle procedures in this document
4. `/cycles/*` endpoints will become functional

---

## Appendix A: Quick Reference Commands

### Contract Read Operations

```bash
# Basic info
cast call $VAULT_ADDRESS "asset()" --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "currentBatchId()" --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "currentNAV()" --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "totalAssets()" --rpc-url $RPC_URL

# Batch info
cast call $VAULT_ADDRESS "batches(uint256)" <BATCH_ID> --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "getBatchStatus(uint256)" <BATCH_ID> --rpc-url $RPC_URL
cast call $VAULT_ADDRESS "settlementProgress(uint256)" <BATCH_ID> --rpc-url $RPC_URL

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

# Snapshotter operations
cast send $VAULT_ADDRESS "cutoffBatch()" --rpc-url $RPC_URL --private-key $SNAPSHOTTER_KEY
cast send $VAULT_ADDRESS "flattenBatch(bytes32)" <SNAPSHOT_HASH> --rpc-url $RPC_URL --private-key $SNAPSHOTTER_KEY

# Settler operations
cast send $VAULT_ADDRESS "settleBatch(uint256,uint256)" <BATCH_ID> <ASSETS> --rpc-url $RPC_URL --private-key $SETTLER_KEY
cast send $VAULT_ADDRESS "closeBatch(uint256)" <BATCH_ID> --rpc-url $RPC_URL --private-key $SETTLER_KEY
cast send $VAULT_ADDRESS "reopenBatch()" --rpc-url $RPC_URL --private-key $SETTLER_KEY

# Deposit processor operations
cast send $VAULT_ADDRESS "processDepositQueue(uint256,uint256,uint256)" <BATCH> <START> <END> --rpc-url $RPC_URL --private-key $DEPOSIT_PROCESSOR_KEY

# User operations
cast send $VAULT_ADDRESS "queueDeposit(uint256)" <AMOUNT> --rpc-url $RPC_URL --private-key $USER_KEY
cast send $VAULT_ADDRESS "requestRedeem(uint256,address,address)" <SHARES> <CONTROLLER> <OWNER> --rpc-url $RPC_URL --private-key $USER_KEY
cast send $VAULT_ADDRESS "redeem(uint256,uint256,address)" <REQUEST_ID> <SHARES> <RECEIVER> --rpc-url $RPC_URL --private-key $USER_KEY
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
- Contract Type: ClosedBookBatchVault

### Role Assignments

| Role              | Address                                    | Type |
| ----------------- | ------------------------------------------ | ---- |
| Admin             | 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74 | EOA  |
| Settler           | <TBD>                                      | EOA  |
| NAV Updater       | <TBD>                                      | EOA  |
| Snapshotter       | <TBD>                                      | EOA  |
| Deposit Processor | <TBD>                                      | EOA  |
| Fee Recipient     | <TBD>                                      | EOA  |

### Configuration

- Batch Duration: 3600 seconds (1 hour)
- NAV Staleness Threshold: 21600 seconds (6 hours)
- Asset: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 (USDC)

### Verification

- [ ] Contract deployed successfully
- [ ] All roles assigned correctly
- [ ] Parameters verified on-chain
- [ ] Test deposit completed
- [ ] Test redemption completed
- [ ] Emergency mode tested
```

---

## Appendix C: Legacy EpochTrancheVault Procedures (Current Amoy)

**Use these procedures until the ClosedBookBatchVault is deployed.**

### Legacy Lifecycle

```
Active -> Frozen -> Settled -> Finalized
```

### Legacy Commands

```bash
# Freeze epoch (legacy)
cast send $VAULT_ADDRESS "freezeEpoch(bytes32)" <SNAPSHOT_HASH> --rpc-url $RPC_URL --private-key $SNAPSHOTTER_KEY

# Settle epoch with carry (legacy)
cast send $VAULT_ADDRESS "settleEpoch(uint256,uint256,uint256)" <EPOCH_ID> <AVAILABLE> <CARRY> --rpc-url $RPC_URL --private-key $SETTLER_KEY

# Finalize epoch (legacy)
cast send $VAULT_ADDRESS "finalizeEpoch(uint256)" <EPOCH_ID> --rpc-url $RPC_URL --private-key $SETTLER_KEY
```

### Legacy API Endpoints

| Endpoint               | Status  | Use Instead After Cutover |
| ---------------------- | ------- | ------------------------- |
| `/epochs/current`      | Working | `/cycles/current`         |
| `/epochs/:id/settle`   | Working | `/cycles/:id/settle`      |
| `/epochs/:id/finalize` | Working | `/cycles/:id/close`       |

---

_Last updated: March 2026 - ClosedBookBatchVault migration in progress_
