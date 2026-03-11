# Draft: Polymarket Flat Then Process Vault

## Requirements (confirmed)

- positions will most probably go over epochs
- we want to make sure our vault is fully compatible for polymarket
- we dont want any users to trick the system and take other users money/share of money
- chosen model: queue deposits and withdrawals while positions are open, then process the whole batch only once the portfolio is fully flat
- deposits and withdrawals must not be priced against open-position marks

## Technical Decisions

- model: closed-book async batching with flat-portfolio settlement
- deposit pricing: mint only after the portfolio is flat and the settlement batch closes
- withdrawal pricing: settle only after the portfolio is flat and the settlement batch closes
- payout timing: no open-position cash fulfillment; process the batch once flat, then reopen trading
- fairness rule: no user enters or exits against stale open-position marks

## Research Findings

- `contracts/src/WeeklyEpochVault.sol`: existing flat-at-settlement async redemption model is a strong repo precedent
- `apps/vault-api/src/repositories/withdrawalRepository.ts`: still carries legacy custom-vault queue assumptions that fit closed-book batching better than open-position pricing
- `apps/vault-api/src/repositories/realizationRepository.ts`: contains internal scaffolding for progressive realization/distribution but warns it is not production-supported
- `apps/vault-api/src/repositories/entitlementRepository.ts`: already has entitlement/accrued/claimed/carryRemaining fields suitable for cohort accounting
- `apps/vault-api/src/db/schema.ts`: schema already includes epochs, epoch_requests, nav_snapshots, epoch_position_snapshots, epoch_redemption_entitlements, position_realization_events, realized_payout_distributions
- `contracts/src/EpochTrancheVault.sol`: contract already stores cohort-style redemption fields (`entitlement`, `accrued`, `claimed`, `carryRemaining`) and epoch carry totals

## Open Questions

- resolved default: deposits and withdrawals queue while any positions remain open
- resolved default: batch processing happens only when the portfolio is flat, then a new trading cycle starts

## Scope Boundaries

- INCLUDE: closed-book batch settlement, flat-portfolio processing, queue semantics, anti-sniping rules, API/UI/runtime/docs alignment, verification strategy
- EXCLUDE: open-position mark-to-market pricing for deposits/withdrawals, gradual realization, reintroducing cancellation, implementation work in this planning step
