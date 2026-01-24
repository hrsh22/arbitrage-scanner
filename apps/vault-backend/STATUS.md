# Polymarket Prediction Vault - Project Status

> Last Updated: 2026-01-23

## Executive Summary

The vault system has **infrastructure built** including deposit and withdrawal event listeners. Users can deposit USDC on-chain, and the Merkle claim system is in place for trustless withdrawals. The deposited funds sit idle until trading integration is complete.

---

## Completion Overview

| Category                  | Status      | Completion |
| ------------------------- | ----------- | ---------- |
| Smart Contract            | Done        | 100%       |
| Database Schema           | Done        | 100%       |
| API Routes (CRUD)         | Done        | 95%        |
| Trading Infrastructure    | Done        | 100%       |
| Event Listeners           | Done        | 100%       |
| Withdrawal System         | Done        | 95%        |
| Investment Automation     | Not Started | 0%         |
| Position Tracking         | Partial     | 30%        |
| NAV Automation            | Not Started | 0%         |
| Resolution Detection      | Not Started | 0%         |
| Frontend Deposit          | Done        | 100%       |
| Frontend Admin Trading UI | Not Started | 0%         |

---

## What Is DONE

### 1. Smart Contract (PredictionVault.sol)

| Feature                                           | Status |
| ------------------------------------------------- | ------ |
| ERC-20 share token (pvUSDC)                       | Done   |
| User deposits USDC -> receives shares             | Done   |
| USDC auto-transfers to treasury (Safe) on deposit | Done   |
| Withdrawal request system (locks shares)          | Done   |
| Admin NAV update                                  | Done   |
| Admin fulfill/cancel withdrawals                  | Done   |
| Pause/unpause functionality                       | Done   |

### 2. Backend Infrastructure

| Component           | Status | Notes                                                                                                          |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Database schema     | Done   | users, vaults, vaultState, deposits, withdrawalRequests, vaultPositions, positionClaims, navHistory, syncState |
| Express server      | Done   | Routes at /vaults, /users, /admin, /webhooks, /withdrawals                                                     |
| Vault CRUD (admin)  | Done   | Create, update, list vaults                                                                                    |
| User service        | Done   | recordDeposit, requestWithdrawal, getUserTotalShares                                                           |
| Vault service       | Done   | NAV calculation, position tracking, share management                                                           |
| Claim service       | Done   | resolvePositionClaims, claimResolved                                                                           |
| Deposit listener    | Done   | Alchemy webhook + startup catch-up + reconciliation cron                                                       |
| Withdrawal listener | Done   | Alchemy webhook + startup catch-up + reconciliation cron                                                       |
| Merkle service      | Done   | Build Merkle trees, generate proofs for claims                                                                 |
| Withdrawal service  | Done   | Orchestrates withdrawal flow, calculates claimable amounts                                                     |
| Reserve service     | Done   | Tracks reserved USDC (not tradeable)                                                                           |
| Vault config        | Done   | Configurable withdrawal lock period (7 days default)                                                           |
| Winston logging     | Done   | Structured logging                                                                                             |

### 3. Trading Infrastructure (Safe + Polymarket CLOB)

| Component               | Status | Notes                                                                                 |
| ----------------------- | ------ | ------------------------------------------------------------------------------------- |
| SafeWalletService       | Done   | approveUsdcForCtf, approveForExchange, transferUsdc, executeRaw                       |
| SelfRelayer             | Done   | Signs and submits Safe transactions, pays gas                                         |
| TradingService          | Done   | placeOrder, cancelOrder, cancelAllOrders, getOpenOrders, getMarketPrice, getOrderBook |
| Lazy API key derivation | Done   | No credentials stored, derived on first use                                           |
| setup-safe script       | Done   | One-time Safe approval for Polymarket                                                 |

### 4. Admin Trading API Endpoints

| Endpoint                                    | Method | Status |
| ------------------------------------------- | ------ | ------ |
| `/admin/vaults/:id/orders`                  | GET    | Done   |
| `/admin/vaults/:id/orders`                  | POST   | Done   |
| `/admin/vaults/:id/orders`                  | DELETE | Done   |
| `/admin/vaults/:id/orders/:orderId`         | DELETE | Done   |
| `/admin/vaults/:id/market/:tokenId`         | GET    | Done   |
| `/admin/vaults/:id/orderbook/:tokenId`      | GET    | Done   |
| `/admin/vaults/:id/nav`                     | POST   | Done   |
| `/admin/vaults/:id/withdrawals`             | GET    | Done   |
| `/admin/vaults/:id/withdrawals/:id/fulfill` | POST   | Done   |

### 5. Frontend

| Feature                                 | Status  | Notes                        |
| --------------------------------------- | ------- | ---------------------------- |
| Wallet connection (Reown/WalletConnect) | Done    | web3.tsx                     |
| Vault listing page                      | Done    | / route                      |
| Deposit flow                            | Done    | /vault/$slug/deposit         |
| Withdraw flow                           | Partial | /vault/$slug/withdraw exists |
| Admin vault list                        | Done    | /admin                       |
| Admin create vault                      | Done    | /admin/new                   |
| Admin vault detail                      | Done    | /admin/$vaultId              |

### 6. Documentation and Configuration

| Item                 | Status |
| -------------------- | ------ |
| SETUP.md             | Done   |
| AGENTS.md (backend)  | Done   |
| AGENTS.md (frontend) | Done   |
| .env.example (both)  | Done   |
| Testnet code removed | Done   |

---

## What Is NOT DONE

### 1. Deposit -> Investment Flow (CRITICAL GAP)

**Current broken flow:**

```
User deposits USDC via frontend
    |
    v
Contract transfers USDC to Safe (treasury)
    |
    v
USDC sits idle in Safe - NO TRADING HAPPENS
```

**Missing components:**

| Gap                     | Description                                                        | Priority |
| ----------------------- | ------------------------------------------------------------------ | -------- |
| Deposit event listener  | ✅ DONE - Alchemy webhook + startup catch-up                       | High     |
| Investment strategy     | No logic to decide WHAT to trade with deposited funds              | High     |
| Position creation       | Trading endpoints exist but nothing creates vaultPositions records | High     |
| Idle USDC -> Trade flow | No connection between "funds arrived" and "place orders"           | High     |

### 2. Position Management

| Missing                         | Description                                           | Priority |
| ------------------------------- | ----------------------------------------------------- | -------- |
| Create position from order fill | When order fills, no vaultPositions record is created | High     |
| Track open positions in DB      | Admin can place orders but positions not tracked      | High     |
| Resolution detection            | No mechanism to detect when markets resolve           | Medium   |
| Auto-claim winnings             | No automation to claim resolved position payouts      | Medium   |

### 3. NAV Calculation

| Missing                | Description                                       | Priority |
| ---------------------- | ------------------------------------------------- | -------- |
| Automatic NAV          | NAV is manually updated via admin endpoint        | Medium   |
| Safe balance query     | No code to query Safe's USDC balance              | Medium   |
| Position valuation     | No code to value open positions at current prices | Medium   |
| NAV formula automation | idle USDC + position values - not automated       | Medium   |

### 4. Withdrawal Fulfillment

| Missing                  | Description                                                     | Priority |
| ------------------------ | --------------------------------------------------------------- | -------- |
| On-chain event detection | ✅ DONE - withdrawalListener.ts listens for WithdrawalRequested | Medium   |
| USDC transfer from Safe  | Merkle claim system - users claim with proofs                   | Medium   |
| Automated fulfillment    | Cron job updates Merkle roots, users self-claim                 | Low      |

### 5. Frontend Admin Trading UI

| Missing               | Description                                 | Priority |
| --------------------- | ------------------------------------------- | -------- |
| Place order form      | No UI to call POST /admin/vaults/:id/orders | High     |
| View orders list      | No UI to display open orders                | High     |
| Cancel orders buttons | No UI to cancel orders                      | Medium   |
| Position view         | No display of current vault positions       | Medium   |

### 6. Known Bugs

| Bug                             | Severity | Description                                                                                                    | Fix Required                            |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Merkle tree format mismatch     | ✅ Fixed | Backend now uses raw keccak256(abi.encodePacked(...)) matching contract. Proofs will verify on-chain.          | Fixed in merkleService.ts               |
| processWithdrawals vault filter | ✅ Fixed | Cron now filters by vault.id before querying pending withdrawals.                                              | Fixed in processWithdrawals.ts          |
| No on-chain claim tracking      | ✅ Fixed | Claimed events now synced via polling in reconcileWithdrawals cron. DB tracks totalClaimedUsdc.                | Fixed in withdrawalListener.ts          |
| 7-day lock backend-only         | Medium   | Contract allows immediate claims once Merkle root submitted. Lock only enforced by not submitting roots early. | Acceptable if cron respects lock period |

---

## Design Decisions

| Decision                   | Choice                | Rationale                                                                                                                                                                                 |
| -------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7-day lock enforcement     | Backend-only          | Contract has no on-chain lock. Backend controls when Merkle roots are submitted. Cron only submits roots for requests past 7 days. User cannot claim early because no valid proof exists. |
| Withdrawal event detection | Polling (not webhook) | Withdrawals have 7-day lock anyway, so 5-minute polling latency is acceptable. Saves Alchemy webhook bandwidth for deposits.                                                              |
| Merkle claims              | Per-request roots     | Each withdrawal request gets its own Merkle root on-chain. Simpler than one global tree.                                                                                                  |

---

## Architecture Gap Visualization

### Current State (Broken)

```
Frontend (Deposit)
       |
       v
Smart Contract -----> Gnosis Safe
       |                   |
       v                   v
  Shares minted      USDC sits idle
       |                   |
       v                   X (no connection)
  User has shares    Backend unaware
                     No trades placed
```

### Required State (Complete)

```
Frontend (Deposit)
       |
       v
Smart Contract -----> Gnosis Safe
       |                   |
       v                   v
  Deposit Event      USDC available
       |                   |
       v                   v
  Event Listener --> Backend records deposit
       |                   |
       v                   v
  Update vaultState  Investment Logic
       |                   |
       v                   v
  NAV calculated     TradingService.placeOrder()
                           |
                           v
                     Polymarket CLOB
                           |
                           v
                     vaultPositions created
                           |
                           v
                     Resolution Checker
                           |
                           v
                     Auto-update NAV
```

---

## Next Steps (Prioritized)

### Phase 1: Fix Immediate Issues

1. [x] Fix `isTestnet` import bug in frontend files
2. [x] Test frontend builds successfully

### Phase 2: Deposit Recording

3. [x] Create deposit event listener (Alchemy webhook + startup catch-up)
4. [x] Connect on-chain deposits to `userService.recordDeposit()`
5. [x] Auto-update vaultState on deposit

### Phase 3: Trading Integration

6. [ ] Create position record when placing orders
7. [ ] Track order fills and update positions
8. [ ] Admin UI for placing/viewing/canceling orders

### Phase 4: NAV and Resolution

9. [ ] Query Safe USDC balance
10. [ ] Value open positions at current market prices
11. [ ] Auto-calculate and update NAV
12. [ ] Resolution detection for positions
13. [ ] Auto-claim resolved positions

### Phase 5: Withdrawal Automation

14. [x] Detect withdrawal requests on-chain (withdrawalListener.ts)
15. [x] Webhook handler for WithdrawalRequested events
16. [x] Startup catch-up for withdrawal events
17. [x] Reconciliation cron for withdrawals
18. [x] Setup script updated to approve vault contract for claims
19. [ ] Calculate user's share of assets
20. [ ] Automate USDC transfer from Safe to user

---

## Change Log

| Date       | Change                                                    | Files Affected                                                                |
| ---------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 2026-01-22 | Initial status report created                             | STATUS.md                                                                     |
| 2026-01-22 | Removed testnet code from backend                         | env.ts, index.ts, logger.ts, schema.ts, vaultService.ts, types.ts, relayer.ts |
| 2026-01-22 | Removed testnet code from frontend                        | env.ts, contracts.ts, api.ts, .env.example                                    |
| 2026-01-22 | Added trading routes to admin API                         | routes/admin.ts                                                               |
| 2026-01-22 | Fixed tradingService multi-Safe caching                   | trading/tradingService.ts                                                     |
| 2026-01-22 | Moved CLOB URL to constants                               | tradingService.ts, setupSafe.ts                                               |
| 2026-01-22 | Created AGENTS.md files                                   | AGENTS.md (backend + frontend)                                                |
| 2026-01-22 | Cleaned up setupSafe.ts output                            | scripts/setupSafe.ts                                                          |
| 2026-01-22 | Updated SETUP.md                                          | SETUP.md                                                                      |
| 2026-01-22 | Fixed isTestnet imports in frontend                       | deposit.tsx, withdraw.tsx, index.tsx, web3.tsx                                |
| 2026-01-22 | Phase 1 complete                                          | STATUS.md                                                                     |
| 2026-01-23 | Added deposit event listener (Alchemy webhook + catch-up) | depositListener.ts, webhooks.ts, reconcileDeposits.ts, index.ts, schema.ts    |
| 2026-01-23 | Added syncState table for block tracking                  | schema.ts, drizzle/0001_steep_hairball.sql                                    |
| 2026-01-23 | Phase 2 complete                                          | STATUS.md                                                                     |
| 2026-01-23 | Added withdrawal event listener (webhook + catch-up)      | withdrawalListener.ts, webhooks.ts, reconcileWithdrawals.ts, index.ts         |
| 2026-01-23 | Added Merkle claim system for trustless withdrawals       | merkleService.ts, withdrawalService.ts, vaultContractService.ts               |
| 2026-01-23 | Added vault config for withdrawal lock period             | config/vaultConfig.ts                                                         |
| 2026-01-23 | Updated setup-safe to approve vault contract              | scripts/setupSafe.ts, trading/safeWallet.ts                                   |
| 2026-01-23 | Added reserve service for tracking reserved USDC          | services/reserveService.ts                                                    |
| 2026-01-23 | Added withdrawal routes and process cron                  | routes/withdrawals.ts, cron/processWithdrawals.ts                             |
| 2026-01-23 | Fixed Merkle tree encoding to match contract              | services/merkleService.ts                                                     |
| 2026-01-23 | Fixed processWithdrawals to filter by vault               | cron/processWithdrawals.ts                                                    |
| 2026-01-23 | Added Claimed event polling to sync on-chain claims       | services/withdrawalListener.ts, db/schema.ts                                  |
