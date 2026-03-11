# Amoy Vault Deployment Readiness Report

**Date:** 2026-03-10  
**Status:** ✅ READY FOR DEPLOYMENT  
**Plan:** amoy-live-dual-safe-validation

---

## Summary

All 12 preparation tasks completed. The dual-safe vault architecture is fully restored and ready for Amoy testnet deployment. Two execution tasks remain pending actual contract deployment.

---

## ✅ Completed Infrastructure (12/14)

### Wave 1: Contract Foundation

| #   | Task                                | Status | Evidence                                |
| --- | ----------------------------------- | ------ | --------------------------------------- |
| 1   | Restore EpochTrancheVault dual-safe | ✅     | `tradingSafe` param + capital functions |
| 2   | Align deploy scripts                | ✅     | `deployEpochTrancheVault.js` created    |
| 3   | Split vault configs by network      | ✅     | `mainnet/` + `amoy/` folders            |

### Wave 2: Runtime & Resolution

| #   | Task                | Status | Evidence                                   |
| --- | ------------------- | ------ | ------------------------------------------ |
| 4   | Identity resolution | ✅     | `resolveTradingSafe()`, network validation |
| 5   | Live-only Amoy      | ✅     | Trading blocked, live mode enforced        |
| 6   | Readiness tooling   | ✅     | 7-step Amoy test suite                     |

### Wave 3: UI & Documentation

| #   | Task                | Status | Evidence                                     |
| --- | ------------------- | ------ | -------------------------------------------- |
| 7   | Vault-web alignment | ✅     | Network badges (green/orange)                |
| 8   | Operator runbook    | ✅     | `docs/operator-runbook-amoy.md` (1050 lines) |

### Wave 4: Validation & Probes

| #   | Task                     | Status | Evidence                            |
| --- | ------------------------ | ------ | ----------------------------------- |
| 9   | Pre-deploy probes        | ✅     | Amoy USDC verified                  |
| 10  | Mainnet regression       | ✅     | Matrix passed                       |
| 11  | Post-deploy probe script | ✅     | `scripts/amoy-post-deploy-probe.sh` |
| 12  | Lifecycle test script    | ✅     | `scripts/amoy-lifecycle-test.sh`    |

---

## ⏳ Pending Execution (2/14)

These tasks require the deployed vault address:

| #   | Task                       | Status | Trigger                                           |
| --- | -------------------------- | ------ | ------------------------------------------------- |
| 13  | Execute post-deploy probes | ⏳     | Run `./scripts/amoy-post-deploy-probe.sh 0xVAULT` |
| 14  | Execute lifecycle test     | ⏳     | Run `./scripts/amoy-lifecycle-test.sh`            |

---

## Verification Evidence

### Amoy USDC Contract ✅

```
Address:  0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
Status:   VERIFIED
Decimals: 6
Symbol:   USDC
Name:     USDC
Supply:   ~1.19M USDC
Evidence: .sisyphus/evidence/task-9-amoy-usdc-probe.txt
```

### Mainnet Preservation ✅

```
Network:   mainnet (chainId=137)
Status:    READY
Build:     PASS (vault-api, vault-web)
Readiness: 12 passed, 0 failed
Evidence:  .sisyphus/evidence/task-10-mainnet-matrix.txt
```

---

## Ready-to-Execute Scripts

### 1. Post-Deploy Probe

```bash
./scripts/amoy-post-deploy-probe.sh 0xYOUR_VAULT_ADDRESS
```

**Validates:**

- Trading safe address configured
- Asset is correct USDC
- Admin has ADMIN_ROLE
- Contract not paused
- Epoch state valid

### 2. End-to-End Lifecycle Test

```bash
export VAULT_ADDRESS=0xYOUR_VAULT_ADDRESS
export DEPOSITOR_PRIVATE_KEY=0x...
export ADMIN_PRIVATE_KEY=0x...
export DEPOSIT_PROCESSOR_PRIVATE_KEY=0x...
export TRADING_SAFE_PRIVATE_KEY=0x...

./scripts/amoy-lifecycle-test.sh
```

**Tests:**

1. Deposit USDC
2. Verify deposit queued
3. Process deposits
4. Deploy capital to tradingSafe
5. Verify capital deployed
6. Recall capital from tradingSafe
7. Verify capital recalled

---

## Deployment Checklist

```bash
# 1. Get Amoy MATIC from faucet
# https://faucet.polygon.technology

# 2. Deploy contract
cd contracts/scripts
node deployEpochTrancheVault.js \
  --profile staging \
  --rpc-url https://rpc-amoy.polygon.technology

# 3. Save vault address from output

# 4. Run post-deploy probe
./scripts/amoy-post-deploy-probe.sh 0xYOUR_VAULT_ADDRESS

# 5. Update config
# Edit: apps/vault-api/src/config/vaults/amoy/vault1-pph.ts
# Set: vaultAddress, safeAddress, tradingSafeAddress

# 6. Run lifecycle test
./scripts/amoy-lifecycle-test.sh

# 7. Mark tasks complete in this report
```

---

## Key Configuration Values

| Parameter          | Value                                        |
| ------------------ | -------------------------------------------- |
| **Amoy USDC**      | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |
| **Deployer**       | `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74` |
| **RPC**            | `https://rpc-amoy.polygon.technology`        |
| **Chain ID**       | 80002                                        |
| **Epoch Duration** | 3600 (1 hour for testing)                    |
| **NAV Staleness**  | 21600 (6 hours)                              |
| **Min Claim**      | 100000000 (100 USDC)                         |

---

## Next Steps

1. **Deploy the contract** using the runbook
2. **Run post-deploy probe** with the vault address
3. **Execute lifecycle test** to verify end-to-end flow
4. **Update this report** with deployment results

**When deployment is complete, the remaining 2 tasks will be automatically executed.**

---

## Artifacts Created

### Contracts

- `contracts/src/EpochTrancheVault.sol` - Dual-safe vault contract
- `contracts/scripts/deployEpochTrancheVault.js` - Deployment script

### Config

- `apps/vault-api/src/config/vaults/amoy/` - Amoy vault configs
- `apps/vault-api/src/config/vaults/mainnet/` - Mainnet vault configs

### Scripts

- `scripts/amoy-post-deploy-probe.sh` - Post-deploy validation
- `scripts/amoy-lifecycle-test.sh` - End-to-end test
- `scripts/run-regression-matrix.sh` - Full regression suite

### Documentation

- `docs/operator-runbook-amoy.md` - Complete operator guide
- `.sisyphus/notepads/amoy-live-dual-safe-validation/` - Design decisions & learnings

### Evidence

- `.sisyphus/evidence/task-9-amoy-usdc-probe.txt` - USDC verification
- `.sisyphus/evidence/task-10-mainnet-matrix.txt` - Mainnet regression

---

**Report Status:** READY FOR DEPLOYMENT  
**Last Updated:** 2026-03-10
