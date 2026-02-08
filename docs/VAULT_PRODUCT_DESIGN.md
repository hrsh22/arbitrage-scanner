# Polymarket Prediction Vault - Product Design Document

## Summary

The Polymarket Prediction Vault is a tokenized vault that allows users to deposit USDC and gain exposure to an automated prediction market trading strategy.

**Key Features:**

- ERC-4626 + ERC-7540 compliant tokenized vault
- Instant deposits at current NAV
- Resolution-based withdrawals (users receive actual position outcomes)
- Gnosis Safe custody for trading funds
- Fully non-custodial with transparent on-chain accounting

**Parameters:**

- Minimum deposit: $10 USDC
- Withdrawal period: ~7 days estimated (depends on position resolution)
- Fees: None initially (infrastructure ready for future)
- Chain: Polygon

---

## How It Works

### User Journey

```
1. DEPOSIT (Instant)
   User deposits USDC → Receives vault shares immediately
   Shares priced at current NAV (mark-to-market)

2. STRATEGY EXECUTION
   Bot deploys capital into prediction markets
   Positions resolve → Profits increase NAV
   Compounding is automatic

3. WITHDRAWAL (Resolution-Based)
   User requests redemption → Shares locked
   User's claim = their % of each open position
   As positions resolve → User receives actual outcomes
   Most complete within 7 days
```

### Why Different Models for Deposit vs Withdrawal?

| Action         | Model            | Reason                                              |
| -------------- | ---------------- | --------------------------------------------------- |
| **Deposit**    | Instant at NAV   | USDC is fungible; user pays fair value              |
| **Withdrawal** | Resolution-based | Positions are binary; must wait for actual outcomes |

**Deposit**: User pays current NAV which reflects position values. If positions are up 10%, user pays 10% more per share (and vice versa). Fair because user takes on existing risk.

**Withdrawal**: User gets their proportional share of actual position outcomes. Can't game by exiting before losses. No forced selling at bad prices.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SYSTEM OVERVIEW                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  USERS                        POLYGON CHAIN                 │
│  ┌───────┐                   ┌─────────────────────────┐    │
│  │ USDC  │──── deposit ────► │   PredictionVault.sol   │    │
│  └───────┘                   │   (ERC-4626 + ERC-7540) │    │
│  ┌───────┐                   └───────────┬─────────────┘    │
│  │Shares │◄─── redeem ─────────────────  │                  │
│  └───────┘                               │ owns             │
│                                          ▼                  │
│                              ┌─────────────────────────┐    │
│                              │      Gnosis Safe        │    │
│                              │   (Trading Wallet)      │    │
│                              │   • Holds USDC          │    │
│                              │   • Holds positions     │    │
│                              └───────────┬─────────────┘    │
│                                          │                  │
│  OFF-CHAIN                               ▼                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Strategy Bot                                      │     │
│  │  • Scans Polymarket for opportunities              │     │
│  │  • Executes trades via CLOB API                    │     │
│  │  • Reports resolutions to vault                    │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Components:**
| Component | Purpose |
|-----------|---------|
| PredictionVault.sol | Share accounting, redemption queue, claim tracking |
| Gnosis Safe | Holds funds, executes Polymarket trades |
| StrategyModule.sol | Authorizes bot to trade from Safe |
| Strategy Bot | Executes trading strategy (existing codebase) |

---

## Deposit Flow

1. User clicks "Deposit" and approves USDC
2. User confirms deposit amount
3. Contract calculates: `shares = amount / NAV`
4. Shares minted to user **immediately**
5. USDC transferred to Gnosis Safe
6. Funds available for bot to deploy

**NAV Calculation:**

```
NAV = (Idle USDC + Position Values) / Total Shares
Position Values = Σ (shares × lastTradePrice)
```

**Share Mechanics (ERC-4626):**
ERC-4626 handles share distribution automatically. Deposits mint shares based on current NAV. Share price rises as vault profits (automatic compounding).

---

## Withdrawal Flow

1. **Request**: User clicks "Withdraw"
   - Shares locked (can't transfer)
   - Ownership % calculated at this moment
   - Claims created for each open position

2. **Resolution**: As positions resolve (YES=$1, NO=$0)
   - User's share of each outcome added to claimable balance
   - User notified of resolved positions

3. **Claim**: User clicks "Claim" anytime
   - Withdraws all available USDC
   - Can claim multiple times as positions resolve
   - When all resolved → shares burned, complete

**Important**: User does NOT receive any USDC immediately. All funds (including idle USDC portion) are claimable only after the ~7 day period. If any positions are still open after 7 days, those funds remain locked until resolution.

**Example:**

```
Vault State at Withdrawal Request:

Vault TVL: $1,000
├── Idle USDC: $400
├── Position A: 200 shares @ $0.95 = $190 value
├── Position B: 210 shares @ $0.95 = $200 value
└── Position C: 220 shares @ $0.95 = $209 value

User owns 10%, requests full withdrawal
Expected value at current NAV: ~$100

User's Claims (locked at request time):
├── Idle: $40
├── Position A: 20 shares
├── Position B: 21 shares
└── Position C: 22 shares
```

**Scenario 1: All Positions Win**

```
Day 0: Request submitted, shares locked
Day 2: Position A resolves YES → 20 × $1.00 = $20 claimable
Day 4: Position B resolves YES → 21 × $1.00 = $21 claimable
Day 6: Position C resolves YES → 22 × $1.00 = $22 claimable
Day 7: Idle portion → $40 claimable

Total: $103 (above expected - positions resolved at $1 vs $0.95 entry)
```

**Scenario 2: One Position Loses**

```
Day 0: Request submitted, shares locked
Day 2: Position A resolves YES → 20 × $1.00 = $20 claimable
Day 4: Position B resolves NO  → 21 × $0.00 = $0 claimable
Day 6: Position C resolves YES → 22 × $1.00 = $22 claimable
Day 7: Idle portion → $40 claimable

Total: $82 (below expected - Position B went to $0)
```

**Key Insight**: User receives actual outcomes, not NAV. Can be higher or lower than expected.

**Note on ERC-7540:**
ERC-7540 provides the async redemption pattern (request → wait → claim). However, our resolution-based payout (tracking claims per position) is custom logic built on top of this standard.

---

## Long Resolution Handling

Most positions resolve within 7 days (our strategy targets near-resolution markets).

If positions take longer:

- User continues waiting
- Gets actual outcome when resolved
- No forced settlement, no penalty
- No early exit option in V1 (prevents gaming)

**We estimate ~7 days but cannot guarantee.** Actual timing depends on when markets resolve.

---

## NAV Fairness

We use simple mark-to-market NAV for deposits. This is fair because:

1. **User pays for gains**: If positions are up, NAV is higher
2. **User gets discount for losses**: If positions are down, NAV is lower
3. **Risk symmetry**: User takes same risk as existing holders
4. **Industry standard**: All major DeFi vaults use this

**Why not track which user's funds go to which position?**

- Capital is fungible - impossible to track
- Some funds may sit idle if no opportunities
- Adds massive complexity for no benefit

---

## Risk Analysis

**Emergency Controls:**

- Admin can pause deposits/withdrawals
- Strategy module can be paused
- Executor key can be rotated

---

## Technical Stack

| Component | Technology                      |
| --------- | ------------------------------- |
| Chain     | Polygon                         |
| Standards | ERC-4626, ERC-7540, Gnosis Safe |
| Bot       | Node.js/TypeScript (existing)   |
| Database  | PostgreSQL (existing)           |

**Polymarket Integration:**

- CLOB API for trading
- Gamma API for market data
- Gnosis Safe with Signature Type 2

---

## Open Questions

**Product:**

- Fee structure for future (management %, performance %)?
- KYC/geo-blocking requirements?

---

## Key Design Decisions

| Decision          | Choice                   | Rationale                            |
| ----------------- | ------------------------ | ------------------------------------ |
| Deposit model     | Instant at NAV           | Fair, simple, industry standard      |
| Withdrawal model  | Resolution-based         | No forced selling, perfect fairness  |
| Withdrawal timing | ~7 days (not guaranteed) | Depends on position resolution times |
| Early settlement  | Not in V1                | Prevents gaming, simpler             |
| Minimum deposit   | $10 USDC                 | Prevents dust                        |
| Fees              | None (V1)                | Can add later                        |
| Custody           | Gnosis Safe              | Polymarket-compatible                |

---

## Appendix

**Standards:**

- ERC-4626: https://eips.ethereum.org/EIPS/eip-4626
- ERC-7540: https://eips.ethereum.org/EIPS/eip-7540

**Glossary:**

- **NAV**: Net Asset Value - vault value per share
- **Claim**: User's locked right to a position's outcome
- **Resolution**: When a prediction market outcome is determined
- **CLOB**: Central Limit Order Book - Polymarket's trading system
