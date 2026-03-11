# Amoy Vault Deployment - COMPLETED

**Date:** 2026-03-10  
**Status:** ✅ DEPLOYED AND VALIDATED

---

## Deployment Summary

| Parameter         | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| **Network**       | Polygon Amoy Testnet (Chain ID: 80002)                               |
| **Contract**      | EpochTrancheVault                                                    |
| **Vault Address** | `0xBB6B5A07ad5E45046D61C3cdAc10bA8b813606e3`                         |
| **Trading Safe**  | `0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214`                         |
| **Asset (USDC)**  | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`                         |
| **Deployer**      | `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`                         |
| **Transaction**   | `0xa770570fee4527c726fa38fb7d8eef0a67d57d86d411a8bb7a3e1dd6b23cd9e0` |
| **Block**         | 35001201                                                             |
| **Gas Used**      | 4,275,895                                                            |
| **Timestamp**     | 2026-03-10T08:05:40.408Z                                             |

---

## On-Chain Verification ✅

| Check          | Expected          | Actual          | Status |
| -------------- | ----------------- | --------------- | ------ |
| Vault deployed | -                 | `0xBB6B...06e3` | ✅     |
| Trading Safe   | `0x5991...b214`   | `0x5991...b214` | ✅     |
| Asset (USDC)   | `0x41E9...7582`   | `0x41E9...7582` | ✅     |
| Admin Role     | Deployer has role | ✅              | ✅     |
| Epoch Duration | 3600 seconds      | 3600            | ✅     |

---

## Roles Configured

All roles assigned to deployer address:

- ✅ Admin: `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`
- ✅ Settler: `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`
- ✅ NAV Updater: `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`
- ✅ Snapshotter: `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`
- ✅ Deposit Processor: `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`

---

## Configuration Files

### Deployment Artifact

`contracts/deployments/epoch-tranche-vault-staging-latest.json`

### Vault Config (to be updated)

`apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`

Update these environment variables:

```bash
AMOY_VAULT_1_ADDRESS=0xBB6B5A07ad5E45046D61C3cdAc10bA8b813606e3
AMOY_VAULT_1_SAFE_ADDRESS=0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214
```

---

## Next Steps

1. **Update vault config** with deployed addresses
2. **Enable the vault** (set `enabled: true`)
3. **Fund the vault** with USDC for testing
4. **Run lifecycle tests** to verify deposit/withdraw flows

---

## Commands

### View Contract on Amoy Explorer

https://amoy.polygonscan.com/address/0xBB6B5A07ad5E45046D61C3cdAc10bA8b813606e3

### Check Contract State

```bash
export VAULT=0xBB6B5A07ad5E45046D61C3cdAc10bA8b813606e3
export RPC=https://rpc-amoy.polygon.technology

cast call $VAULT "tradingSafe()(address)" --rpc-url $RPC
cast call $VAULT "asset()(address)" --rpc-url $RPC
cast call $VAULT "currentEpochId()(uint256)" --rpc-url $RPC
```

---

**Deployment completed successfully!** 🎉
