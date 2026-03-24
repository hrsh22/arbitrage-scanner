# VAULT_KNOWLEDGE.md

Canonical knowledge base for the vault stack in this repo.

Read this file before making any vault-related change in:

- `apps/vault-api/`
- `apps/vault-web/`
- `contracts/`

---

## 1) Current State

As of March 2026, the active custom vault flow in this repo is built around `FlatBookVaultV2`, not `ClosedBookBatchVault` and not `EpochTrancheVault`.

That distinction matters because the deployed contract semantics are materially different:

- queued deposits auto-mint into shares during processing at the locked NAV
- queued redeems are queue-first requests, not DB-only intents; they should be accepted immediately and later become controller-level claimable redemption balances during processing
- `currentNAV` and all custom-vault pricing must exclude:
  - queued deposits
  - claimable redemption liabilities

If an agent prices shares from raw `totalAssets / totalSupply` or treats queued redeems as free allocatable liquidity, it will break accounting.

---

## 2) Active Deployments And Config

Primary custom vault configs live in:

- `apps/vault-api/src/config/vaults/mainnet/vault1-pph.ts`
- `apps/vault-api/src/config/vaults/amoy/vault1-pph.ts`

Current configured deployments:

| Network | Contract Type     | Vault Address                                | Trading Safe                                 |
| ------- | ----------------- | -------------------------------------------- | -------------------------------------------- |
| Mainnet | `flatBookVaultV2` | `0xfE5F6D149148aD5F31f6868152698E19A0F73a58` | `0xc8447F7d4dF6d717684fC9A3d242ee7713F43927` |
| Amoy    | `flatBookVaultV2` | `0x62646C39547c004a922D928DCe247Cae11F7d2d2` | `0x5991fd6Ecc5634C4de497b47Eb0Aa0065fffb214` |

The config field to trust is:

```ts
vaultContractType: "flatBookVaultV2";
```

---

## 3) FlatBookVaultV2 Lifecycle

File: `contracts/src/FlatBookVaultV2.sol`

Core lifecycle:

```text
Open -> BookClosed -> Processing -> Open(next cycle)
```

High-level behavior:

- while `Open`
  - instant deposits mint immediately using `currentNAV`
  - redeem requests can now also be queued for the current cycle
- while `Closed`
  - deposits are queued into `queuedDepositAssets[currentCycleId][controller]`
  - redeems are queued into `queuedRedeemShares[currentCycleId][controller]`
- while `Processing`
  - no new requests can be created
- during `Processing`
  - `processDeposits(maxUsers)` moves queued deposits into:
    - `claimableDepositAssetsByController`
    - `claimableDepositSharesByController`
  - `processRedeems(maxUsers)` moves queued redeems into:
    - `claimableRedeemAssetsByController`
    - `claimableRedeemSharesByController`
- `finalizeProcessing()` advances `currentCycleId` and reopens the next cycle

Important: queued deposits are minted during `processDeposits()` at the cycle's locked NAV; `finalizeProcessing()` reopens the next cycle after both deposit and redeem processing complete.

---

## 4) Deposit Semantics

### 4.1 Open-State Instant Deposit

Contract entrypoint:

```solidity
deposit(uint256 assets, address receiver)
```

File reference: `contracts/src/FlatBookVaultV2.sol:296`

Properties:

- only works while vault state is `Open`
- prices at `currentNAV`
- transfers USDC in and mints shares immediately

### 4.2 Closed-State Queued Deposit

Contract entrypoint:

```solidity
requestDeposit(uint256 assets)
requestDeposit(uint256 assets, address controller, address owner)
```

File reference: `contracts/src/FlatBookVaultV2.sol:165`

Properties:

- accumulates into `queuedDepositAssets[currentCycleId][controller]`
- no shares are minted yet
- assets are already inside the vault accounting perimeter

### 4.3 Processed Queued Deposit

Contract behavior during processing:

```solidity
processDeposits(uint256 maxUsers)
```

File reference: `contracts/src/FlatBookVaultV2.sol:574`

Properties:

- queued deposit assets are removed from `queuedDepositAssets`
- shares are minted directly to the `controller` during `processDeposits()` using the cycle's locked NAV
- there is no manual claim-shares step for new queued deposits in this contract version

---

## 5) Redemption Semantics

Queued redemption path:

- `requestRedeem(shares)` is the queue-first redeem request path
- in the updated source contract, redeem requests are accepted while `Open` or `Closed`
- the request immediately locks shares on-chain by moving them into vault custody
- while the vault is still `Open`, accepted queued redeems also reserve estimated redeem assets in cycle accounting so admin allocation cannot strand them before processing starts
- worker processing later converts them into:
  - `claimableRedeemSharesByController`
  - `claimableRedeemAssetsByController`
- user later claims with `redeem(...)` / `withdraw(...)` against that claimable redeem balance

Important redeem invariant:

- once a queued redeem has been processed into `claimableRedeem*ByController`, the claimable amount is locked on-chain and later cycles must not reprice it

Operational implication:

- custom withdrawals are now request-first in both `Open` and `Closed` states
- users do not need a separate "instant withdraw" path for the custom vault
- if the vault is already flat, worker processing can still happen quickly, but the mental model stays `request -> process -> claim`

Relevant contract refs:

- `contracts/src/FlatBookVaultV2.sol:217`
- `contracts/src/FlatBookVaultV2.sol:391`

Custom vault redeem claims are controller-level on-chain claimables after processing. They are fundamentally different from the legacy DB-only withdrawal-ready model that was previously attempted in `vault-api`.

---

## 6) NAV And Pricing Rules

### 6.1 Correct Pricing Rule

For custom vaults, all share pricing must use liability-adjusted NAV, not raw `totalAssets / totalSupply`.

Liabilities to exclude:

- queued deposits
- claimable redeem assets / reserved redemption liabilities

If these are not excluded:

- existing holders get an inflated share price
- new open-state deposits mint too few shares
- withdraw estimates are overstated
- TVL/NAV in the UI become economically wrong

### 6.2 Backend Source Of Truth

Files:

- `apps/vault-api/src/services/navOracle.ts`
- `apps/vault-api/src/routes/vaultRoutes.ts`

Key facts:

- `NavOracleService.getLiveNavPreview()` is the canonical custom-vault preview used by `/vault/status`
- `calculateAndPushNavCustom()` republishes `currentNAV` on-chain using that same liability-adjusted calculation
- custom vault status should prefer the live preview path and only fall back if that path fails

### 6.3 Frontend Source Of Truth

Files:

- `apps/vault-web/app/vault/[id]/vault-detail.tsx`
- `apps/vault-web/src/lib/hooks.ts`

Rules:

- show custom-vault NAV from backend `status.nav.sharePrice`
- custom-vault withdraw estimates should use backend liability-adjusted share price, not raw on-chain `totalAssets / totalSupply`
- queued deposits should surface only two meaningful user states: queued, then minted

---

## 7) API Surface That Matters

Primary backend routes for the custom vault flow:

File: `apps/vault-api/src/routes/customVaultRoutes.ts`

| Endpoint                     | Method | Purpose                                             |
| ---------------------------- | ------ | --------------------------------------------------- |
| `/:vaultId/info`             | GET    | vault metadata and high-level state                 |
| `/:vaultId/redemptions`      | GET    | user redemption queue and claim state               |
| `/:vaultId/deposit-queue`    | GET    | user queued deposit and minted-share estimate state |
| `/:vaultId/activity/deposit` | POST   | append canonical deposit activity after wallet txs  |

Important deposit-queue semantics:

- queued deposits should remain visible until processing completes
- after processing, shares should already be minted for new queued deposits
- the UI should not expose a manual post-processing deposit claim step for the updated contract version

---

## 8) Projection Tables And Why They Exist

Relevant DB tables:

- `flat_book_cycles`
- `flat_book_queue_participants`
- `flat_book_processing_events`
- `user_vault_activity_events`
- `vault_lifecycle_events`

Purpose:

- these are off-chain projections and history helpers
- they are not the contract source of truth
- they exist so the UI can show lifecycle history and queue state cleanly

Critical rule:

- if projection tables are stale or incomplete, fallback discovery must still be able to reconstruct liability-relevant addresses from activity history and on-chain state

Address normalization matters:

- normalize vault and user addresses for reads/writes
- do not rely on exact-case string equality for address joins or lookups
- a mixed-case vs lowercase mismatch can silently zero out liabilities in NAV calculations

---

## 9) Recent Production Lessons

### 9.1 Legacy Processed Deposits Were Liabilities Until Claimed

Observed in the previous contract/app flow:

- a queued `1 USDC` deposit could process into:
  - `claimableDepositRequest(0, controller) = 1 USDC`
  - `claimableDepositSharesByController(controller) = 0.617239 shares`
- but ERC20 vault shares were not minted yet

If the app assumes those shares already exist, NAV and withdraw math become wrong.

For the updated contract version, queued deposits auto-mint during processing and this legacy claim step should no longer appear for new deposits.

### 9.2 On-Chain `currentNAV` Can Stay Wrong Until Worker Republishes

Even after backend math is fixed:

- the UI can still show stale inflated NAV if prod is running old code
- `currentNAV` stays wrong until `vault-api` is redeployed and the NAV worker refreshes/publishes a new value

### 9.3 UI Auth Can Hide Real Queue State

The deposit queue route is auth-scoped.

If the wallet is connected but the SIWE session is stale:

- queued deposit state may disappear from the UI if auth is stale
- the user can incorrectly think the queue state is gone

Always surface auth gating clearly in the UI.

---

## 10) Operational Guidance

### 10.1 When Debugging Bad NAV

Check all three layers:

1. contract state
   - `currentNAV`
   - `totalSupply`
2. backend live preview
   - `createNavOracle(config).getLiveNavPreview()`
3. frontend status consumption
   - `status.nav.sharePrice`
   - custom withdraw estimate source

### 10.2 When Debugging Missing Shares

First determine which state the deposit is in:

- queued: still in `queuedDepositAssets`
- minted: already converted into ERC20 shares during processing

For the updated contract version, queued deposits should not enter a separate manual claim state.

### 10.3 When Adding New Vault UX

Never build custom-vault UX from assumptions copied from:

- legacy ERC-4626 instant mint flows
- `ClosedBookBatchVault`
- `EpochTrancheVault`

Always verify against `FlatBookVaultV2.sol` first.

---

## 11) Checklist For Future Agents

Before changing vault code, verify all of the following:

- [ ] Is this vault path using `flatBookVaultV2` semantics?
- [ ] Am I treating queued deposits as auto-minted during processing for the updated contract version?
- [ ] Am I pricing from liability-adjusted NAV rather than raw `totalAssets / totalSupply`?
- [ ] Am I normalizing addresses for DB lookups and projections?
- [ ] If I changed deposit or withdraw math, did I verify the result against on-chain state and backend live preview?
- [ ] If I changed deposit or withdrawal queue UI, does it match the actual on-chain claim/mint path rather than a legacy DB-only flow?

---

_Last updated: March 2026 - FlatBookVaultV2 request-anytime queued redeems and auto-mint queued deposit behavior documented._
