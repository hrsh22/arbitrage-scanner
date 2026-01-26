# PredictionVault.sol - Contract Specification (Merkle-Claim Vault)

## Overview

This vault contract is an ERC-20 share token (pvUSDC) that represents ownership in a prediction-market trading strategy. It does not track positions on-chain. An off-chain operator computes NAV and claimable amounts and submits them on-chain.

Key design points:

- Treasury (Gnosis Safe) holds USDC and trading positions.
- Contract mints/burns shares and tracks withdrawal requests.
- Operator updates `totalAssets` (NAV) on-chain using off-chain data.
- Withdrawals use Merkle proofs per request.

---

## Core Concepts

- **totalAssets**: Total USDC value of the vault (6 decimals). Updated by operator.
- **totalLockedShares / totalLockedAssets**: Assets reserved for pending withdrawals.
- **Withdrawal request**: Locks shares, snapshots ownership and reserved assets.
- **Merkle claim**: Operator submits a root; user claims with proof.

Leaf format for claims:

```
keccak256(abi.encodePacked(requestId, cumulativeClaimable))
```

---

## Contract Interface (Summary)

### View

- `activeShares()`, `activeAssets()`
- `navPerShare()`, `previewDeposit(assets)`, `previewRedeem(shares)`
- `pendingClaim(requestId)`
- `pendingRedeemRequest(requestId)`, `claimableRedeemRequest(requestId)`
- `getUserRequests(user)`

### User

- `deposit(assets, receiver)`
- `requestRedeem(shares)`
- `claim(requestId, cumulativeClaimable, merkleProof)`
- `finalizeWithdrawal(requestId)`

### Operator / Owner

- `submitClaimRoot(requestId, root, totalClaimable)` (operator or owner)
- `updateNav(newTotalAssets)` (operator or owner)
- Owner-only admin: `setTreasury`, `setOperator`, `setMinDeposit`, `pause`, `unpause`, `cancelWithdrawal`, `recoverToken`

---

## Deposit Flow

1. User approves USDC.e for the vault.
2. `deposit(assets, receiver)` transfers USDC.e to the treasury Safe.
3. Shares are minted at current NAV (`previewDeposit`).
4. `totalAssets` increases by `assets`.

---

## Withdrawal Flow (Merkle-Claim)

1. User calls `requestRedeem(shares)`.
2. Contract locks shares and snapshots:
   - `ownershipBps`
   - `assetsReserved`
   - updates `totalLockedShares` / `totalLockedAssets`
3. Off-chain operator tracks positions and computes **cumulative claimable** per request.
4. Operator submits `submitClaimRoot(requestId, root, totalClaimable)`.
5. User calls `claim(requestId, cumulativeClaimable, merkleProof)` to receive USDC.e.
6. After all claims, user calls `finalizeWithdrawal(requestId)` to burn any remaining shares (losses).

---

## NAV Updates

NAV is updated off-chain and stored on-chain:

```
NAV = treasury USDC.e + position values - locked assets
```

The operator calls:

```
updateNav(newTotalAssets)
```

---

## Deployment Parameters (Polygon Mainnet)

| Parameter     | Value |
| ------------- | ----- |
| USDC Address  | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (USDC.e) |
| Treasury Safe | Your Safe address |
| Operator      | Bot/operator EOA |
| Min Deposit   | `10000000` (10 USDC) |

---

## How to Deploy

Use the repo contract at `contracts/src/PredictionVault.sol`.

1. Compile with Solidity `0.8.20` (optimize 200 runs).
2. Deploy with constructor args: `_usdc`, `_treasury`, `_operator`, `_minDeposit`.

---

## Post-Deployment Steps

1. Verify contract on Polygonscan.
2. Safe approves the vault contract to transfer USDC.e for claims:
   ```
   pnpm setup-safe <SAFE_ADDRESS> <VAULT_CONTRACT_ADDRESS>
   ```
3. Ensure backend has `TRADING_WALLET_PRIVATE_KEY` for operator actions.
4. Register the vault in the admin UI (contract + Safe address).

---

## Security Considerations

- Operator/owner can update NAV and claim roots. This is a trusted role.
- Safe must approve the vault for USDC.e transfers on `claim`.
- Pausable + reentrancy protection enabled.

---

## ABI (frontend/backend)

Use the full ABI from `apps/vault-frontend/src/lib/contracts.ts` (or export from `contracts/src/PredictionVault.sol`).
