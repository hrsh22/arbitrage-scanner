# Bot Configurations

> Trading bot configurations for the Polymarket Trading System.
> Last updated: 2026-01-02

---

## Overview

The system runs autonomous trading bots on Polymarket prediction markets. Each bot has its own strategy, wallet, and configuration. Bots scan for markets near resolution and place bets using the PPH (Profit Per Hour) strategy.

### Important: Odds = Buy Price

**All entry/exit decisions use the actual buy price from the order book, NOT the displayed probability.**

- **Buy Price (Odds):** The actual price you pay per share (e.g., 96¢)
- **Probability:** The displayed likelihood shown by Polymarket (informational only)

The bot checks: "Can I buy this share for X¢?" — not "Does Polymarket show X% probability?"

### Active Bots

| Bot            | Strategy         | Status      | Odds Range | Time Window |
| -------------- | ---------------- | ----------- | ---------- | ----------- |
| **default**    | Standard         | ✅ Enabled  | 95-99.5¢   | ≤24 hours   |
| **aggressive** | High risk/reward | ❌ Disabled | 90-99.5¢   | ≤3 hours    |
| **safe**       | Low risk         | ❌ Disabled | 98-99.5¢   | ≤1 hour     |

---

## Bot 1: Default

**Strategy:** Standard balanced approach - moderate odds with flexible time window.

| Parameter  | Value                    | Description         |
| ---------- | ------------------------ | ------------------- |
| **Status** | ✅ Enabled               |                     |
| **Wallet** | Primary (`POLYMARKET_*`) | Main trading wallet |

### Entry Criteria

All checks use **buy price** (order book ask price), not displayed probability.

| Parameter             | Value         | Description                                   |
| --------------------- | ------------- | --------------------------------------------- |
| Min Odds              | 95¢ (0.95)    | Only bet when buy price ≥ 95¢                 |
| Max Odds              | 99.5¢ (0.995) | Skip if buy price > 99.5¢ (too little profit) |
| Max Hours             | 24h           | Market must resolve within 24 hours           |
| High Odds Threshold   | 99¢ (0.99)    | Special rule for 99¢+ buy price               |
| Max Hours (High Odds) | 2h            | 99¢+ buy price: must resolve within 2 hours   |
| Min Liquidity         | $50           | Minimum market liquidity                      |

### Category-Specific Limits

| Category | Max Hours | Reason                           |
| -------- | --------- | -------------------------------- |
| Crypto   | 3h        | High volatility - shorter window |

### Betting

| Parameter    | Value     | Description           |
| ------------ | --------- | --------------------- |
| Bet Size     | $5.00     | Fixed amount per bet  |
| Daily Budget | Unlimited | No daily spending cap |

### Exit Strategy

| Parameter            | Value      | Description                                    |
| -------------------- | ---------- | ---------------------------------------------- |
| Early Exit           | ✅ Enabled | Sell positions before resolution if profitable |
| Early Exit Min Price | 99.95¢     | Sell when price reaches 99.95¢                 |

### Safety Limits

| Parameter          | Value     | Description        |
| ------------------ | --------- | ------------------ |
| Min Wallet Reserve | $0        | No minimum reserve |
| Max Daily Loss     | Unlimited | No loss limit      |

---

## Bot 2: Aggressive

**Strategy:** Lower odds with fast resolution - higher risk, higher potential reward per bet.

| Parameter  | Value                   | Description                    |
| ---------- | ----------------------- | ------------------------------ |
| **Status** | ❌ Disabled             | Requires `WALLET_2_*` env vars |
| **Wallet** | Wallet 2 (`WALLET_2_*`) | Separate wallet                |

### Entry Criteria

All checks use **buy price** (order book ask price), not displayed probability.

| Parameter      | Value         | Description                              |
| -------------- | ------------- | ---------------------------------------- |
| Min Odds       | 90¢ (0.90)    | Accepts lower buy price bets             |
| Max Odds       | 99.5¢ (0.995) | Skip if buy price > 99.5¢                |
| Max Hours      | 3h            | Market must resolve within 3 hours       |
| High Odds Rule | Disabled      | No special treatment for high buy prices |
| Min Liquidity  | $50           | Minimum market liquidity                 |

### Category-Specific Limits

| Category | Max Hours | Reason                     |
| -------- | --------- | -------------------------- |
| Crypto   | 1h        | Extra caution - 1 hour max |

### Betting

| Parameter    | Value     | Description           |
| ------------ | --------- | --------------------- |
| Bet Size     | $5.00     | Fixed amount per bet  |
| Daily Budget | Unlimited | No daily spending cap |

### Exit Strategy

| Parameter            | Value      | Description                                    |
| -------------------- | ---------- | ---------------------------------------------- |
| Early Exit           | ✅ Enabled | Sell positions before resolution if profitable |
| Early Exit Min Price | 99.95¢     | Sell when price reaches 99.95¢                 |

### Safety Limits

| Parameter          | Value     | Description        |
| ------------------ | --------- | ------------------ |
| Min Wallet Reserve | $0        | No minimum reserve |
| Max Daily Loss     | Unlimited | No loss limit      |

---

## Bot 3: Safe

**Strategy:** High odds with very fast resolution - lower risk, lower reward, high confidence.

| Parameter  | Value                   | Description                    |
| ---------- | ----------------------- | ------------------------------ |
| **Status** | ❌ Disabled             | Requires `WALLET_3_*` env vars |
| **Wallet** | Wallet 3 (`WALLET_3_*`) | Separate wallet                |

### Entry Criteria

All checks use **buy price** (order book ask price), not displayed probability.

| Parameter      | Value         | Description                              |
| -------------- | ------------- | ---------------------------------------- |
| Min Odds       | 98¢ (0.98)    | Only very high buy price bets            |
| Max Odds       | 99.5¢ (0.995) | Skip if buy price > 99.5¢                |
| Max Hours      | 1h            | Market must resolve within 1 hour        |
| High Odds Rule | Disabled      | No special treatment for high buy prices |
| Min Liquidity  | $50           | Minimum market liquidity                 |

### Category-Specific Limits

| Category | Max Hours | Reason                       |
| -------- | --------- | ---------------------------- |
| Crypto   | 30min     | Maximum caution - 30 min max |

### Betting

| Parameter    | Value     | Description           |
| ------------ | --------- | --------------------- |
| Bet Size     | $5.00     | Fixed amount per bet  |
| Daily Budget | Unlimited | No daily spending cap |

### Exit Strategy

| Parameter            | Value      | Description                                    |
| -------------------- | ---------- | ---------------------------------------------- |
| Early Exit           | ✅ Enabled | Sell positions before resolution if profitable |
| Early Exit Min Price | 99.95¢     | Sell when price reaches 99.95¢                 |

### Safety Limits

| Parameter          | Value     | Description        |
| ------------------ | --------- | ------------------ |
| Min Wallet Reserve | $0        | No minimum reserve |
| Max Daily Loss     | Unlimited | No loss limit      |

---

## Environment Variables

### Bot 1 (Default) - Required

```bash
POLYMARKET_PRIVATE_KEY=0x...     # Wallet private key
POLYMARKET_FUNDER_ADDRESS=0x...  # Funder address
BOT_MODE=simulation              # "simulation" or "live"
```

### Bot 2 (Aggressive) - Required when enabled

```bash
WALLET_2_PRIVATE_KEY=0x...
WALLET_2_FUNDER_ADDRESS=0x...
```

### Bot 3 (Safe) - Required when enabled

```bash
WALLET_3_PRIVATE_KEY=0x...
WALLET_3_FUNDER_ADDRESS=0x...
```

---

## PPH Strategy Explained

**PPH = Profit Per Hour**

```
PPH = (1 - Buy Price) / Hours Until Resolution
```

The bot prioritizes bets with the highest PPH score, maximizing capital velocity.

- **Profit if Win:** $1.00 - Buy Price (e.g., buy at 96¢ → profit 4¢)
- **PPH:** Profit per hour of capital locked

### Example

| Market | Buy Price | Resolves In | Profit if Win | PPH     |
| ------ | --------- | ----------- | ------------- | ------- |
| A      | 96¢       | 2 hours     | 4¢            | 2.0¢/hr |
| B      | 98¢       | 1 hour      | 2¢            | 2.0¢/hr |
| C      | 95¢       | 10 hours    | 5¢            | 0.5¢/hr |

Markets A and B have equal PPH, both better than C.

---

## Early Exit Strategy

When `enableEarlyExit: true`, the bot will sell positions before resolution if:

1. Current market price ≥ `earlyExitMinPrice` (99.95¢)
2. Selling would lock in profit immediately
3. Position hasn't already resolved

**Why?** Sometimes it's better to take guaranteed profit now rather than wait for resolution.

---

## Cron Schedule

| Job              | Schedule                 | Description                 |
| ---------------- | ------------------------ | --------------------------- |
| Trading Scan     | Every 5 min              | Scan markets, place bets    |
| Resolution Check | Every 10 min (offset +2) | Check if positions resolved |

---

## Changelog

| Date       | Change                                                     |
| ---------- | ---------------------------------------------------------- |
| 2026-01-02 | Switched all entry checks to use buyPrice, not probability |
| 2026-01-02 | Created bot configurations documentation                   |
| 2026-01-02 | Added bot2-aggressive and bot3-safe (disabled)             |
| 2026-01-01 | Refactored config to fully explicit (no inheritance)       |
