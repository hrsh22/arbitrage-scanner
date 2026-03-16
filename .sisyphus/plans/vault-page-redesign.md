# Vault Page Redesign Plan

## Goal

Replace the current vault detail page with a simplified Morpho-inspired layout that keeps only the sections requested by the user and preserves working deposit and withdrawal flows.

## Files

- `apps/vault-web/app/vault/[id]/vault-detail.tsx`

## Must-Keep Data Dependencies

- `useVaultInstances` for the base vault entity and all `vault.profile` / `vault.config` content used in summary, strategy/operator, and risk/terms sections.
- `useVaultStatus` for live NAV, TVL, mode, deployed ratio, and last updated time.
- `useVaultNavHistory` for the NAV chart and derived return/drawdown metrics.
- `useCycleStatus` and `useDepositQueue` for action-rail status, next processing window, and deposit messaging.
- `useWalletBalance`, `useUsdcAllowance`, `usePreviewDeposit`, `useUsdcApprove`, `useVaultDeposit`, `useQueueDeposit` for deposit behavior.
- `useVaultShares`, `usePreviewRedeem`, `useWithdrawalQueue`, `useVaultRedeem`, `preflightWithdrawal`, `postPrepareWithdrawalRequest`, `postCompleteWithdrawalRequest`, `postCancelWithdrawalRequest`, and `postWithdrawalRequest` for the full withdraw/request/claim/cancel flow.
- `useRequests` and `RedemptionPanel` for preserving the non-custom exit and claim flow.

## Implementation

1. Replace the current page composition with a two-column layout: summary content on the left and a sticky action rail on the right.
2. Keep only these content sections on the page body:
   - Vault summary header
   - Performance
   - Strategy & Operator
   - Risk & Terms
   - Activity with `Vault` and `Strategy` tabs
3. Remove lifecycle, treasury, positions, history, flow, and footer sections that are not part of the requested information architecture.
4. Preserve the working deposit and withdrawal logic, but restyle both flows into one sticky card with tabs, required stats, CTA, and the claim tooltip.
5. Keep the sticky action rail behaviorally complete for custom vaults:
   - queued withdrawal request state
   - ready-to-claim state
   - cancel request path
   - wallet popup cancellation / retry messaging
   - claim action after readiness checks
6. Derive page metrics from existing hooks/data only:
   - `useVaultStatus`
   - `useVaultNavHistory`
   - `useCycleStatus`
   - `useDepositQueue`
   - `useWalletBalance`
   - `useVaultShares`
   - `useWithdrawalQueue`
7. Build lightweight derived activity rows from current vault, cycle, NAV, and withdrawal state when no dedicated activity API exists.
8. Keep existing loading and error states intact enough to avoid regressions.

## Verification

1. Run `lsp_diagnostics` on the modified file.
2. Run `npx -y react-doctor@latest . --verbose --diff` inside `apps/vault-web`.
3. Run project type/build verification for `vault-web` or the monorepo as needed.
4. Verify these UI paths with Playwright against the local `vault-web` app:
   - Deposit tab renders sticky rail and shows status, NAV, min deposit, next processing window, wallet balance, and CTA.
   - Withdraw tab renders share balance, estimated value, next withdrawal window, claim tooltip, and CTA.
   - Active queued withdrawal request shows status copy and cancel button.
   - Ready withdrawal request shows claim action and cancel path.
   - Non-custom exit flow preserves start exit, pending, claimable, and claim success states.
   - Activity tabs switch cleanly between `Vault` and `Strategy`.
   - Loading and API error states still render without layout breakage.
