# Vault Setup Guide

## Prerequisites

- Trading wallet with private key (generate or use existing MetaMask)
- ~5-10 MATIC in trading wallet (for gas)
- USDC on Polygon mainnet (trading capital)
- Reown Project ID from https://dashboard.reown.com

---

## Step 1: Generate Trading Wallet

Use existing MetaMask or generate new:

```bash
node -e "const w = require('ethers').Wallet.createRandom(); console.log('Address:', w.address); console.log('Private Key:', w.privateKey)"
```

Save both address and private key.

---

## Step 2: Fund Trading Wallet

Send to your trading wallet address on **Polygon Mainnet**:

| Token | Amount       | Purpose  |
| ----- | ------------ | -------- |
| MATIC | 5-10         | Gas fees |
| USDC  | Your capital | Trading  |

---

## Step 3: Configure Backend

```bash
cd apps/vault-backend
cp .env.example .env
```

Edit `.env`:

```bash
VAULT_DATABASE_URL=postgresql://user:pass@localhost:5432/polymarket_vault_mvp
TRADING_WALLET_PRIVATE_KEY=0x...your-private-key...
```

---

## Step 4: Configure Frontend

```bash
cd apps/vault-frontend
cp .env.example .env
```

Edit `.env`:

```bash
VITE_REOWN_PROJECT_ID=your-project-id
VITE_API_URL=http://localhost:8081
```

---

## Step 5: Deploy Vault Contract

1. Open https://remix.ethereum.org
2. Create `PredictionVault.sol` with content from `contracts/PredictionVault.sol`
3. Compiler: Solidity 0.8.20, optimizer ON
4. Deploy tab:
   - Environment: Injected Provider (MetaMask)
   - Network: Polygon Mainnet
   - Constructor args:
     - `_usdc`: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
     - `_treasury`: (use Safe address from Step 6)
     - `_minDeposit`: `10000000` (10 USDC)
5. Deploy and save contract address

---

## Step 6: Create Gnosis Safe

1. Go to https://app.safe.global
2. Connect your trading wallet
3. Network: Polygon
4. Create New Safe
   - Owners: Your trading wallet address
   - Threshold: 1
5. Deploy (costs gas)
6. Save the Safe address

---

## Step 7: Setup Safe for Polymarket

Run the setup script to approve contracts and register with Polymarket:

```bash
cd apps/vault-backend
pnpm setup-safe 0xYOUR_SAFE_ADDRESS
```

This will:

- Approve USDC for Polymarket's CTF and Exchange contracts
- Register/verify API credentials with Polymarket CLOB

API credentials are derived automatically from your trading wallet - no need to store them in `.env`.

---

## Step 8: Fund the Safe

Send USDC to the Safe address (this is your trading capital).

---

## Step 9: Start the App

```bash
# Terminal 1
cd apps/vault-backend && pnpm dev

# Terminal 2
cd apps/vault-frontend && pnpm dev
```

---

## Step 10: Create Vault in Admin Panel

1. Open http://localhost:3000/admin
2. Connect wallet
3. Create Vault:
   - Name: Your vault name
   - Contract Address: From Step 5
   - Safe Address: From Step 6
4. Make vault public

---

## Summary

| Component            | Address                     |
| -------------------- | --------------------------- |
| Trading Wallet (EOA) | Signs txs, pays gas         |
| Gnosis Safe          | Holds USDC, executes trades |
| Vault Contract       | User deposits/withdrawals   |

```
User → Vault Contract → Safe → Polymarket
```
