# Testnet Mainnet Env Switch

## TL;DR

> **Summary**: Add an explicit env-driven network layer so the vault stack can run on Polygon Amoy for vault and worker testing, while Polymarket-dependent trading paths remain mainnet-only and fail closed on testnet.
> **Deliverables**:
>
> - Shared network configuration for mainnet and Amoy across contracts, vault-api, and vault-web
> - Testnet-safe worker/runtime gating that disables unsupported Polymarket trading paths
> - Network-aware deploy/readiness scripts and explorer/address handling
> - Regression coverage proving mainnet behavior is preserved and Amoy behavior is testable
>   **Effort**: Large
>   **Parallel**: YES - 4 waves
>   **Critical Path**: 1 -> 2 -> 4 -> 5 -> 7 -> F3

## Context

### Original Request

Add testnet support first so the full vault stack can be tested before mainnet deployment. Switching between testnet and mainnet must happen through env. Polymarket trading does not need to work on testnet, but vault features, workers, and overall app behavior should.

### Interview Summary

- Polygon Amoy is the chosen first-class testnet target.
- Testnet support is for the vault system, not public Polymarket testnet trading.
- Mainnet/testnet switching must be environment-driven, not manual code edits.
- The user wants to test workers and end-to-end vault behavior safely before mainnet deployment.

### Metis Review (gaps addressed)

- Treat `network` as a first-class env dimension instead of overloading `VAULT_MODE`.
- Fail closed on unsupported mainnet-only dependencies rather than silently downgrading behavior.
- Require startup validation that RPC chain ID matches configured network.
- Keep `apps/api/` Polymarket bot out of scope to avoid accidental expansion.
- Add explicit readiness checks so Amoy/mainnet rollout is not driven by memory or manual inspection.

## Work Objectives

### Core Objective

Make `contracts`, `apps/vault-api`, and `apps/vault-web` env-switch cleanly between Polygon mainnet and Polygon Amoy, with testnet-safe behavior for the vault product and strict mainnet-only gating for Polymarket trading.

### Deliverables

- Network-aware configuration for chain ID, RPC, explorer, and contract addresses.
- Amoy-compatible contract deployment and script support.
- vault-api runtime guards that disable Polymarket-dependent trading paths on Amoy while keeping vault workers functional.
- vault-web network-aware wallet, explorer, and status behavior.
- An automated readiness/check script that validates config, chain, and deployed contract compatibility before testing or rollout.

### Definition of Done (verifiable conditions with commands)

- `forge build && forge test` passes in `contracts/`.
- `pnpm build && pnpm test --run` passes in `apps/vault-api/`.
- `pnpm typecheck && pnpm lint && pnpm build` passes in `apps/vault-web/`.
- `pnpm exec playwright test --project=chromium --workers=1 --reporter=line` passes in `apps/vault-web/` with only intentional skips.
- Starting `vault-api` with `VAULT_NETWORK=amoy` succeeds against an Amoy RPC and skips Polymarket trading paths without runtime crashes.
- Starting `vault-api` with `VAULT_NETWORK=mainnet` preserves current mainnet behavior.

### Must Have

- `VAULT_NETWORK` (or equivalent) explicitly selects `mainnet` or `amoy`.
- RPC chain ID must be validated against configured network at startup.
- Testnet mode must disable Polymarket trading/CLOB-dependent paths.
- The vault UI must show the correct network and use the correct explorer URLs.
- Contract deploy/readiness scripts must support Amoy without hardcoded mainnet defaults leaking through.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- Must NOT support networks other than Polygon mainnet and Polygon Amoy.
- Must NOT attempt real Polymarket trading on testnet.
- Must NOT modify `apps/api/` trading bot scope for this work.
- Must NOT require code edits to switch networks.
- Must NOT allow a mismatched RPC/chain configuration to start silently.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after using Foundry + Vitest + Playwright
- QA policy: Every task includes agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: network config foundation + contract/deploy network support + runtime env modeling
Wave 2: vault-api service gating + worker/provider startup validation + script/readiness alignment
Wave 3: vault-web network awareness + regression test updates
Wave 4: full mainnet/amoy verification and rollout readiness

### Dependency Matrix (full, all tasks)

1 blocks 3, 4, 5, 6, 7
2 blocks 4, 6, 7
3 blocks 4, 5, 6, 7
4 blocks 6, 7
5 blocks 6, 7
6 blocks 7

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 -> 3 tasks -> `deep`, `unspecified-high`, `quick`
- Wave 2 -> 3 tasks -> `deep`, `unspecified-high`, `quick`
- Wave 3 -> 1 task -> `visual-engineering`
- Wave 4 -> 1 task -> `deep`

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Add a first-class network configuration layer for mainnet and Amoy

  **What to do**: Introduce a single source of truth for `mainnet` and `amoy` network metadata across the vault stack. This must include chain ID, RPC env key, explorer base URL, and network-specific contract addresses. Update current hardcoded exports in `apps/vault-api/src/constants.ts`, `apps/vault-web/src/constants.ts`, and any equivalent contract-side script constants to consume the network config instead of embedding mainnet-only values.
  **Must NOT do**: Do not overload `VAULT_MODE` to mean network. Do not leave mainnet addresses as implicit defaults for Amoy.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this is the cross-cutting foundation for every later task
  - Skills: []
  - Omitted: [`playwright`] — not needed at this stage

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3, 4, 5, 6, 7 | Blocked By: none

  **References**:
  - Env: `apps/vault-api/src/env.ts`
  - API constants: `apps/vault-api/src/constants.ts`
  - Web constants: `apps/vault-web/src/constants.ts`
  - Existing profile precedent: `contracts/scripts/deployWeeklyEpochVault.js`, `contracts/scripts/deploySnapshotTrancheVault.js`

  **Acceptance Criteria**:
  - [ ] A dedicated network config module exists and supports only `mainnet` and `amoy`.
  - [ ] API and web no longer hardcode Polygon mainnet addresses or chain ID 137 inline.
  - [ ] `pnpm build` passes in `apps/vault-api` and `apps/vault-web`.

  **QA Scenarios**:

  ```
  Scenario: API resolves mainnet network config correctly
    Tool: Bash
    Steps: Run `VAULT_NETWORK=mainnet pnpm --dir apps/vault-api build`
    Expected: Build succeeds with network-aware constants and no hardcoded-mainnet regressions
    Evidence: .sisyphus/evidence/task-1-network-config-mainnet.txt

  Scenario: API resolves Amoy network config correctly
    Tool: Bash
    Steps: Run `VAULT_NETWORK=amoy pnpm --dir apps/vault-api build`
    Expected: Build succeeds with Amoy config selected and no missing-address crashes
    Evidence: .sisyphus/evidence/task-1-network-config-amoy.txt
  ```

  **Commit**: YES | Message: `refactor(network): centralize mainnet and amoy config` | Files: API/web constants and new config module(s)

- [ ] 2. Make contract deployment and contract-side address handling Amoy-aware

  **What to do**: Update Foundry/deploy script configuration so Amoy is a first-class deployment target with correct RPC endpoint and address inputs. Replace any incorrect staging defaults that currently reuse mainnet addresses. Ensure constructor/deployment args and post-deploy scripts can be driven by env/profile without manual code edits.
  **Must NOT do**: Do not assume mainnet addresses exist on Amoy. Do not keep scripts that default to mainnet Alchemy URLs when running Amoy flows.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: script and deployment configuration work is broad but bounded
  - Skills: []
  - Omitted: [`frontend-design`] — not relevant

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 6, 7 | Blocked By: none

  **References**:
  - `contracts/foundry.toml`
  - `contracts/scripts/deployWeeklyEpochVault.js`
  - `contracts/scripts/deploySnapshotTrancheVault.js`
  - `contracts/scripts/vault-post-deploy.js`

  **Acceptance Criteria**:
  - [ ] Foundry and deployment scripts have explicit Amoy support.
  - [ ] No staging/testnet deployment script reuses mainnet token/contract addresses by default.
  - [ ] `forge build && forge test` still passes.

  **QA Scenarios**:

  ```
  Scenario: Deploy script validates Amoy profile cleanly
    Tool: Bash
    Steps: Run the relevant deploy script in dry-run/profile-validation mode for Amoy
    Expected: Script resolves Amoy chainId/RPC/address inputs without falling back to mainnet constants
    Evidence: .sisyphus/evidence/task-2-amoy-deploy-profile.txt

  Scenario: Contract test suite remains green after network config changes
    Tool: Bash
    Steps: Run `forge test`
    Expected: All contract tests pass
    Evidence: .sisyphus/evidence/task-2-contract-suite.txt
  ```

  **Commit**: YES | Message: `build(contracts): add amoy deployment support` | Files: `contracts/foundry.toml`, deploy/admin scripts

- [ ] 3. Extend vault runtime env modeling with explicit network and startup chain validation

  **What to do**: Add `VAULT_NETWORK`-style env support to `apps/vault-api/src/env.ts` and any related config types so runtime boot understands `mainnet` vs `amoy`. Add startup validation that the configured RPC actually points at the expected chain ID. Make failure explicit and early if the environment is inconsistent.
  **Must NOT do**: Do not let `VAULT_NETWORK=amoy` start against a mainnet RPC, or vice versa. Do not silently coerce network from chain ID.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: limited but foundational env/type work
  - Skills: []
  - Omitted: [`playwright`] — not needed

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 6, 7 | Blocked By: 1

  **References**:
  - `apps/vault-api/src/env.ts`
  - `apps/vault-api/src/config/types.ts`
  - `apps/vault-api/src/rpcTransport.ts`
  - Worker boot: `apps/vault-api/src/worker.ts`

  **Acceptance Criteria**:
  - [ ] `VAULT_NETWORK` is required or explicitly defaulted in a documented way.
  - [ ] Startup fails with a clear error when RPC chain ID and env network disagree.
  - [ ] `pnpm test --run src/__tests__/identityValidation.test.ts` passes if relevant validation coverage is updated.

  **QA Scenarios**:

  ```
  Scenario: Mainnet startup validates chain ID
    Tool: Bash
    Steps: Start the relevant boot path with `VAULT_NETWORK=mainnet` and a mainnet RPC
    Expected: Startup proceeds past chain validation
    Evidence: .sisyphus/evidence/task-3-startup-mainnet.txt

  Scenario: Mismatched RPC/network fails fast
    Tool: Bash
    Steps: Start the same boot path with `VAULT_NETWORK=amoy` and a mainnet RPC
    Expected: Process exits with an explicit chain mismatch error
    Evidence: .sisyphus/evidence/task-3-startup-mismatch.txt
  ```

  **Commit**: YES | Message: `feat(vault-api): add explicit network env validation` | Files: env/config/runtime validation

- [ ] 4. Gate Polymarket-dependent API services and trading paths on network

  **What to do**: Update `vault-api` services so `mainnet` keeps current Polymarket behavior, while `amoy` disables or short-circuits Polymarket-only functionality with explicit status/errors. This includes CLOB trading, Gamma/Data API fetches, position fetching, resolution checks that require Polymarket APIs, and any worker paths that would otherwise try to trade. Preserve vault-only features (deposits, redemptions, settlements, worker housekeeping) on Amoy.
  **Must NOT do**: Do not point testnet mode at production Polymarket endpoints. Do not silently claim trading succeeded on Amoy.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: multiple service boundaries and failure modes
  - Skills: []
  - Omitted: [`git-master`] — not needed

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6, 7 | Blocked By: 1, 2, 3

  **References**:
  - `apps/vault-api/src/services/tradingClient.ts`
  - `apps/vault-api/src/services/tradingOrchestrator.ts`
  - `apps/vault-api/src/services/positionFetcher.ts`
  - `apps/vault-api/src/services/resolutionChecker.ts`
  - `apps/vault-api/src/services/navOracle.ts`
  - `apps/vault-api/src/tradingWorker.ts`

  **Acceptance Criteria**:
  - [ ] Amoy mode does not initialize or call unsupported Polymarket trading paths.
  - [ ] Mainnet mode preserves current trading behavior.
  - [ ] `pnpm build && pnpm test --run` passes in `apps/vault-api`.

  **QA Scenarios**:

  ```
  Scenario: Mainnet trading path remains enabled
    Tool: Bash
    Steps: Run targeted vault-api tests for trading and position fetching under mainnet config
    Expected: Existing mainnet tests still pass
    Evidence: .sisyphus/evidence/task-4-mainnet-trading.txt

  Scenario: Amoy mode blocks Polymarket trading cleanly
    Tool: Bash
    Steps: Start the relevant worker/service path with `VAULT_NETWORK=amoy`
    Expected: Trading-dependent paths log/return a clear unsupported-on-testnet result without crashing
    Evidence: .sisyphus/evidence/task-4-amoy-trading-block.txt
  ```

  **Commit**: YES | Message: `fix(vault-api): disable polymarket trading outside mainnet` | Files: trading/position/resolution services and workers

- [ ] 5. Make worker and provider flows testnet-safe while preserving vault operations

  **What to do**: Update worker boot, provider factory, and client initialization so vault lifecycle operations still work on Amoy with the correct viem chain object and network-specific addresses. Workers should continue to run reconciliation, settlement, and non-trading health flows where supported, while clearly skipping unsupported actions. Remove hardcoded `polygon` imports where a network-aware chain object should be used.
  **Must NOT do**: Do not shut down the entire worker stack on Amoy just because trading is disabled. Do not keep hardcoded `polygon` chain objects in code paths that must support Amoy.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: worker/provider boot paths are coupled and easy to break
  - Skills: []
  - Omitted: [`frontend-design`] — not relevant

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6, 7 | Blocked By: 1, 3, 4

  **References**:
  - `apps/vault-api/src/worker.ts`
  - `apps/vault-api/src/services/vaultProviderFactory.ts`
  - `apps/vault-api/src/services/customVaultClient.ts`
  - `apps/vault-api/src/services/customVaultProvider.ts`
  - `apps/vault-api/src/services/safeWallet.ts`

  **Acceptance Criteria**:
  - [ ] Worker boot succeeds on Amoy with vault features enabled and trading paths gated.
  - [ ] Provider/client creation uses the correct chain object per network.
  - [ ] No remaining mainnet-only chain imports in dual-network runtime paths.

  **QA Scenarios**:

  ```
  Scenario: Worker boots on Amoy without trading crashes
    Tool: Bash
    Steps: Start `apps/vault-api` worker with `VAULT_NETWORK=amoy`
    Expected: Worker schedules supported tasks and explicitly skips unsupported trading paths
    Evidence: .sisyphus/evidence/task-5-worker-amoy.txt

  Scenario: Provider uses correct chain object for selected network
    Tool: Bash
    Steps: Run targeted provider/client tests or a startup probe under both networks
    Expected: Mainnet uses Polygon chain 137 and Amoy uses chain 80002
    Evidence: .sisyphus/evidence/task-5-provider-network.txt
  ```

  **Commit**: YES | Message: `feat(vault-api): support amoy vault operations` | Files: worker/provider/client/runtime network handling

- [ ] 6. Update scripts and readiness tooling for env-switched mainnet and Amoy flows

  **What to do**: Update staging/readiness and regression scripts so they operate within `apps/vault-api`, respect `VAULT_NETWORK`, and report actionable failures for missing env vars, wrong chain, wrong explorer/address config, or old contract shapes. Ensure the deploy/readiness experience is deterministic for both Amoy testing and mainnet rollout.
  **Must NOT do**: Do not let readiness scripts hardcode placeholder role hashes or generic env names that can pass falsely. Do not treat a failed readiness check as success in wrapper scripts.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: bounded scripting work with high operational value
  - Skills: []
  - Omitted: [`playwright`] — not needed

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 1, 2, 3, 4, 5

  **References**:
  - `apps/vault-api/src/scripts/stagingReadinessCheck.ts`
  - `scripts/run-regression-matrix.sh`
  - Any deployment helper scripts touched in `contracts/scripts/`

  **Acceptance Criteria**:
  - [ ] Readiness script runs from the owning package and respects env-selected network.
  - [ ] Readiness script fails with explicit reasons on old contracts, missing env vars, or chain mismatch.
  - [ ] Regression runner no longer masks readiness failures.

  **QA Scenarios**:

  ```
  Scenario: Readiness script passes on correct Amoy config
    Tool: Bash
    Steps: Run the readiness script with valid Amoy env and deployed Amoy contract inputs
    Expected: Script exits 0 and reports pass/warn states only
    Evidence: .sisyphus/evidence/task-6-readiness-amoy.txt

  Scenario: Readiness script blocks invalid or legacy deployment target
    Tool: Bash
    Steps: Run the same script against a mainnet-only or old-shape contract address
    Expected: Script exits non-zero with explicit failure reasons
    Evidence: .sisyphus/evidence/task-6-readiness-legacy-error.txt
  ```

  **Commit**: YES | Message: `chore(vault): harden readiness checks for mainnet and amoy` | Files: readiness/regression scripts

- [ ] 7. Make vault-web network-aware for wallet, explorer, and status surfaces

  **What to do**: Update `vault-web` so it uses the selected network for wallet providers, chain validation, explorer links, and any displayed network metadata. Show the current network clearly, prevent misleading mainnet-only copy on Amoy, and keep the UI aligned with the API's supported features (vault testing yes, Polymarket trading no). Ensure block explorer links switch between Polygon mainnet and Amoy.
  **Must NOT do**: Do not add user-driven network switching UI. Do not keep `polygonscan.com` links on Amoy or show trading-capable messaging on testnet.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: user-facing network semantics and wallet behavior need deliberate UX treatment
  - Skills: []
  - Omitted: [`git-master`] — not relevant

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: final verification | Blocked By: 1, 3, 4, 5, 6

  **References**:
  - `apps/vault-web/src/constants.ts`
  - `apps/vault-web/components/providers.tsx`
  - `apps/vault-web/src/lib/hooks.ts`
  - `apps/vault-web/app/vault/[id]/components/DepositForm.tsx`
  - `apps/vault-web/app/vault/[id]/components/WithdrawForm.tsx`
  - `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx`

  **Acceptance Criteria**:
  - [ ] Wallet/provider config supports both Polygon mainnet and Amoy.
  - [ ] Explorer links and chain IDs are network-aware.
  - [ ] UI makes it clear that Amoy is a vault-testing network and Polymarket trading is disabled.
  - [ ] `pnpm typecheck && pnpm lint && pnpm build` passes in `apps/vault-web`.

  **QA Scenarios**:

  ```
  Scenario: Mainnet UI remains unchanged functionally
    Tool: Bash
    Steps: Run `pnpm exec playwright test --project=chromium --workers=1 --reporter=line`
    Expected: Existing lifecycle and redemption UI tests still pass in mainnet-configured mode
    Evidence: .sisyphus/evidence/task-7-web-mainnet.txt

  Scenario: Amoy UI uses Amoy network semantics
    Tool: Playwright
    Steps: Launch the app with Amoy env, open the vault page, inspect network indicators and explorer links
    Expected: UI shows Amoy/testnet context, uses Amoy explorer URLs, and does not imply Polymarket trading is active
    Evidence: .sisyphus/evidence/task-7-web-amoy.txt
  ```

  **Commit**: YES | Message: `feat(vault-web): add mainnet and amoy network awareness` | Files: provider/hooks/constants/UI copy/tests

- [ ] 8. Add full mainnet/Amoy regression coverage and rollout verification

  **What to do**: Expand or add regression coverage so both network modes are provable. Mainnet tests must prove nothing regressed; Amoy tests must prove vault/worker/UI flows start and behave safely with trading disabled. Include one top-level verification command or scripted matrix that runs the relevant suites and readiness checks for both environments.
  **Must NOT do**: Do not leave testnet support verified only by manual memory. Do not rely on partial suites that skip startup/network validation.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: this ties together contracts, API, web, and operational scripts
  - Skills: [`playwright`] — browser coverage is required
  - Omitted: [`frontend-design`] — not needed for verification orchestration

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: final verification | Blocked By: 1, 2, 3, 4, 5, 6, 7

  **References**:
  - `contracts/test/EpochTrancheVault.t.sol`
  - `apps/vault-api/src/__tests__/dualSafeCapitalFlow.integration.test.ts`
  - `apps/vault-api/src/__tests__/settlementLifecycle.integration.test.ts`
  - `apps/vault-web/e2e/*.spec.ts`
  - `scripts/run-regression-matrix.sh`

  **Acceptance Criteria**:
  - [ ] Full regression matrix passes for mainnet-configured mode.
  - [ ] Amoy readiness/startup/worker/browser checks pass with trading disabled.
  - [ ] Regression runner documents both environments and exits non-zero on failures.

  **QA Scenarios**:

  ```
  Scenario: Mainnet regression matrix passes
    Tool: Bash
    Steps: Run the final matrix script with `VAULT_NETWORK=mainnet`
    Expected: Contracts, API, web, and readiness checks pass for mainnet mode
    Evidence: .sisyphus/evidence/task-8-mainnet-matrix.txt

  Scenario: Amoy regression matrix passes with trading disabled
    Tool: Bash
    Steps: Run the final matrix script with `VAULT_NETWORK=amoy`
    Expected: Vault/API/web checks pass, and trading-dependent paths are explicitly skipped or blocked without crashing
    Evidence: .sisyphus/evidence/task-8-amoy-matrix.txt
  ```

  **Commit**: YES | Message: `test(vault): verify mainnet and amoy environment switching` | Files: regression scripts/tests across contracts/api/web

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- Commit 1: network config foundation and env modeling
- Commit 2: contract/deploy and runtime gating changes
- Commit 3: readiness tooling and worker/provider validation
- Commit 4: vault-web network awareness and regression updates

## Success Criteria

- The vault stack can switch between mainnet and Amoy entirely through env.
- Mainnet behavior remains intact for current trading-capable deployment.
- Amoy mode supports vault, worker, and UI testing without attempting unsupported Polymarket trading.
- Startup and readiness checks fail explicitly on wrong chain, wrong addresses, missing env vars, or legacy contract shapes.
- All scoped verification passes for the selected environment.
<!-- OMO_INTERNAL_INITIATOR -->
