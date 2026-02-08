# PredictionVault Contracts

Solidity contracts for the Polymarket Prediction Vault.

## Architecture

```
User → PredictionVault.sol → Gnosis Safe (treasury) → Polymarket CLOB
                ↓
        Merkle Claim System
```

### Withdrawal Flow (Resolution-Based)

1. **Request**: User calls `requestRedeem(shares)` → shares locked, ownership % snapshotted
2. **Resolution**: Bot tracks position resolutions off-chain, computes user's share of payouts
3. **Claim Root**: Bot submits Merkle root via `submitClaimRoot(requestId, root, totalClaimable)`
4. **Claim**: User calls `claim(requestId, cumulativeClaimable, proof)` → receives USDC
5. **Finalize**: After all claimed, user calls `finalizeWithdrawal(requestId)` → shares burned

### Why Merkle?

Polymarket uses off-chain CLOB with limit orders. Positions resolve async. Storing per-fill data on-chain is impractical. Merkle lets the bot submit ONE hash covering all claims - user proves their claim with a proof path.

## Build

```bash
forge build
```

## Test

```bash
forge test
```

## Deploy

### Using Remix (Recommended for first deploy)

1. Go to https://remix.ethereum.org
2. Create new file, paste contract code
3. Compiler: 0.8.20, enable optimization (200 runs)
4. Deploy & Run: "Injected Provider - MetaMask"
5. Constructor args:
   - `_usdc`: USDC address
   - `_treasury`: Gnosis Safe address
   - `_operator`: Trading bot address
   - `_minDeposit`: 10000000 (10 USDC)

### Using Foundry

```bash
forge create src/PredictionVault.sol:PredictionVault \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $USDC_ADDRESS $TREASURY_ADDRESS $OPERATOR_ADDRESS 10000000
```

## Contract Addresses

### USDC

| Network         | Address                                      |
| --------------- | -------------------------------------------- |
| Polygon Mainnet | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |

### PredictionVault

| Network         | Address            |
| --------------- | ------------------ |
| Polygon Mainnet | TBD - not deployed |

## Constructor Arguments

| Parameter     | Type    | Description                               |
| ------------- | ------- | ----------------------------------------- |
| `_usdc`       | address | USDC token address                        |
| `_treasury`   | address | Gnosis Safe holding trading funds         |
| `_operator`   | address | Bot address that submits claim roots      |
| `_minDeposit` | uint256 | Minimum deposit (6 decimals, 10000000=10) |

## Roles

| Role     | Permissions                                      |
| -------- | ------------------------------------------------ |
| Owner    | Pause, set treasury/operator, cancel withdrawals |
| Operator | Submit claim roots, update NAV                   |

## Key Functions

### User Functions

| Function                              | Description                           |
| ------------------------------------- | ------------------------------------- |
| `deposit(assets, receiver)`           | Deposit USDC, receive shares          |
| `requestRedeem(shares)`               | Lock shares, start withdrawal         |
| `claim(requestId, cumulative, proof)` | Claim resolved USDC with Merkle proof |
| `finalizeWithdrawal(requestId)`       | Complete withdrawal, burn shares      |

### Operator Functions

| Function                                  | Description                   |
| ----------------------------------------- | ----------------------------- |
| `submitClaimRoot(requestId, root, total)` | Submit Merkle root for claims |
| `updateNav(newTotalAssets)`               | Update vault NAV              |

### View Functions

| Function                            | Description                                |
| ----------------------------------- | ------------------------------------------ |
| `navPerShare()`                     | Current NAV per share                      |
| `previewDeposit(assets)`            | Preview shares for deposit                 |
| `pendingClaim(requestId)`           | Claimable amount for request               |
| `pendingRedeemRequest(requestId)`   | Shares still locked in withdrawal          |
| `claimableRedeemRequest(requestId)` | USDC currently claimable (ERC-7540 compat) |

## Post-Deployment Checklist

1. [ ] Verify contract on Polygonscan
2. [ ] Treasury (Gnosis Safe) approves vault to spend USDC
3. [ ] Backend configured with contract address
4. [ ] Test deposit flow
5. [ ] Test withdrawal → claim flow
