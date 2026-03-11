# Amoy Live Dual-Safe Validation

## TL;DR

> **Summary**: Restore the intended dual-safe vault architecture on the current branch, split vault configuration by network, and create a live-only Amoy rollout path that exercises vault deposits, Safe-to-vault and vault-to-Safe fund movement, redemption requests, settlement, and claims while Polymarket trading remains explicitly disabled on testnet.
> **Deliverables**:
>
> - Dual-safe `EpochTrancheVault` contract and matching deploy/admin scripts
> - Explicit per-network vault config selection for `mainnet` and `amoy`
> - Live-only Amoy runtime/readiness flow for vault operations with trading blocked
> - Operator runbook covering deploy, env, role assignment, readiness, and end-to-end Amoy tests
> - Regression matrix proving mainnet preservation and Amoy safety
>   **Effort**: XL
>   **Parallel**: YES - 4 waves
>   **Critical Path**: 1 -> 2 -> 4 -> 6 -> 8 -> 10 -> F3

## Context

### Original Request

The user wants a proper dual-safe vault architecture, separate testnet/mainnet config files, live-only Amoy testing using the Amoy USDC contract `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`, deployment from wallet `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`, and end-to-end validation of deposits, withdrawals, request fulfillment, and Safe/vault fund movement.

### Interview Summary

- Current repo truth has drifted back to a pre-dual-safe state; the checked-out `EpochTrancheVault` constructor has no `tradingSafe` parameter and no capital deploy/recall surface.
- The user wants separate config files for testnet and mainnet so both can coexist cleanly.
- Amoy testing should be live-only for vault actions; simulation mode is not the target operating model.
- Polymarket trading remains unsupported on Amoy and must stay explicitly disabled.
- Amoy operational roles (`settler`, `navUpdater`, `snapshotter`, `depositProcessor`) should use EOA operators for testing speed, while Safe custody flows must still be exercised.

### Metis Review (gaps addressed)

- Treat this as an architecture restoration, not a small deploy checklist update.
- Do not trust prior conversation memory over current repo state.
- Avoid partial fixes that leave contract, deploy scripts, config selection, and readiness logic out of sync.
- Add explicit verification for the provided Amoy USDC address before using it in deployment/runbook steps.
- Keep mainnet-preservation checks in the plan so Amoy work does not silently break existing flows.

## Work Objectives

### Core Objective

Make the vault stack deployable and testable on Polygon Amoy with the intended dual-safe custody model, explicit per-network config separation, live-only vault operations, and a deterministic operator workflow for full end-to-end validation.

### Deliverables

- A dual-safe `EpochTrancheVault` contract that stores explicit vault/capital and trading Safe relationships and supports controlled fund movement.
- Updated contract deployment and post-deploy scripts that understand Amoy and the restored constructor/role model.
- Per-network vault config selection for `apps/vault-api` and `apps/vault-web`, with Amoy and mainnet variants coexisting safely.
- Live-only Amoy runtime behavior for deposits, redemptions, settlement, and Safe fund movement, with Polymarket trading blocked.
- A markdown runbook with exact env vars, constructor args, role assignments, readiness commands, and Amoy test sequence.

### Definition of Done (verifiable conditions with commands)

- `cd contracts && forge build && forge test` passes.
- `cd apps/vault-api && pnpm build && pnpm test --run` passes for touched suites.
- `cd apps/vault-web && pnpm typecheck && pnpm lint && pnpm build` passes.
- `cd apps/vault-api && VAULT_NETWORK=amoy pnpm exec tsx src/scripts/stagingReadinessCheck.ts` reports only expected deployment/input failures before deploy, then passes after deploy/config.
- `VAULT_NETWORK=mainnet ./scripts/run-regression-matrix.sh` passes.
- `VAULT_NETWORK=amoy ./scripts/run-regression-matrix.sh` passes once Amoy env and deployed addresses are present, with trading paths explicitly skipped or blocked.

### Must Have

- `EpochTrancheVault` constructor includes explicit dual-safe/capital movement inputs required by the intended architecture.
- A dedicated Amoy vault config exists alongside a dedicated mainnet vault config for the same logical vault.
- Amoy uses the provided USDC address `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` only after on-chain verification.
- Live-mode Amoy vault operations are supported; simulation-only shortcuts are not the primary test path.
- The runbook tells the operator exactly what env vars to set, what constructor values to use, and what test sequence to run.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- Must NOT deploy or plan for unsupported Polymarket trading on Amoy.
- Must NOT leave Amoy/mainnet addresses mixed in the same static vault config file.
- Must NOT rely on prior session assumptions that are not present in the repo.
- Must NOT hide missing addresses behind zero-address placeholders once a feature depends on them.
- Must NOT weaken readiness or regression checks just to make Amoy appear green.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after using Foundry + Vitest + Playwright + readiness/regression scripts
- QA policy: Every task includes agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: contract restoration + deploy script alignment + per-network config architecture
Wave 2: runtime/ref resolver updates + live-only Amoy gating + readiness/runbook foundation
Wave 3: web alignment + operator flow verification support
Wave 4: full mainnet/Amoy regression and rollout proof

### Dependency Matrix (full, all tasks)

1 blocks 2, 4, 5, 6, 7, 8, 9, 10
2 blocks 6, 8, 9, 10
3 blocks 4, 5, 6, 7, 8, 9, 10
4 blocks 6, 7, 8, 9, 10
5 blocks 7, 8, 9, 10
6 blocks 8, 9, 10
7 blocks 9, 10
8 blocks 10
9 blocks 10

### Agent Dispatch Summary (wave -> task count -> categories)

- Wave 1 -> 3 tasks -> `deep`, `unspecified-high`, `quick`
- Wave 2 -> 3 tasks -> `deep`, `quick`, `writing`
- Wave 3 -> 2 tasks -> `visual-engineering`, `deep`
- Wave 4 -> 2 tasks -> `deep`, `unspecified-high`

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Restore `EpochTrancheVault` to the intended dual-safe architecture

  **What to do**: Update `contracts/src/EpochTrancheVault.sol` so the current branch matches the intended vault-plus-trading-Safe model. Add explicit constructor inputs for the trading Safe and required capital-operator authority, add vault-to-trading capital deployment and recall functions, and enforce settlement/redemption safety so assets cannot remain deployed when settlement or payout requires recall. Preserve the EOA operator model for Amoy by assigning operational roles to EOAs, not to the Safe itself.
  **Must NOT do**: Do not introduce upgradeability, proxy patterns, or generic N-safe abstractions. Do not leave the contract in a partial state where deploy scripts and runtime still target the old constructor.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: contract storage, roles, and lifecycle invariants all change together
  - Skills: []
  - Omitted: [`playwright`] — not relevant at this layer

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2, 4, 5, 6, 7, 8, 9, 10 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Contract: `contracts/src/EpochTrancheVault.sol` — current pre-dual-safe constructor to replace
  - Related tests: `contracts/test/EpochTrancheVault.t.sol` — lifecycle/invariant expectations to extend
  - Contract style precedent: `contracts/src/WeeklyEpochVault.sol` — role-based pattern already used in repo
  - Requirement source: `.sisyphus/drafts/amoy-live-dual-safe-validation.md`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `EpochTrancheVault` constructor includes explicit dual-safe inputs required by the restored design.
  - [ ] Contract exposes explicit capital deployment/recall surface and settlement safety checks.
  - [ ] `cd contracts && forge build && forge test --match-path test/EpochTrancheVault.t.sol` passes.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Dual-safe constructor and capital lifecycle compile and test
    Tool: Bash
    Steps: Run `cd contracts && forge build && forge test --match-path test/EpochTrancheVault.t.sol`
    Expected: Build succeeds and dual-safe lifecycle tests pass
    Evidence: .sisyphus/evidence/task-1-dual-safe-contract.txt

  Scenario: Settlement blocks while capital remains deployed
    Tool: Bash
    Steps: Add/execute a Foundry test that deploys capital, attempts settlement before recall, and run `cd contracts && forge test --match-test test.*Recall.* -vv`
    Expected: Settlement path reverts with the expected safety error until capital is recalled
    Evidence: .sisyphus/evidence/task-1-dual-safe-settlement-guard.txt
  ```

  **Commit**: YES | Message: `feat(contracts): restore dual-safe epoch tranche vault` | Files: `contracts/src/EpochTrancheVault.sol`, `contracts/test/EpochTrancheVault.t.sol`

- [ ] 2. Align contract deployment and post-deploy scripts with the restored constructor

  **What to do**: Update or replace the current vault deployment scripts so they target the restored `EpochTrancheVault` constructor and dual-safe role model. The scripts must accept Amoy-safe parameters, the provided Amoy USDC asset, and the EOA operator addresses, then emit deployment artifacts that match the new contract shape. Deprecate old script assumptions rather than silently reusing outdated weekly/snapshot constructor signatures for this flow.
  **Must NOT do**: Do not keep deploy scripts that still target pre-dual-safe constructors. Do not hardcode Amoy values into mainnet profiles or vice versa.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: deploy/admin scripts are broad but contained
  - Skills: []
  - Omitted: [`frontend-design`] — not relevant

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6, 8, 9, 10 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Existing scripts: `contracts/scripts/deployWeeklyEpochVault.js`, `contracts/scripts/deploySnapshotTrancheVault.js`
  - Post-deploy orchestration: `contracts/scripts/vault-post-deploy.js`
  - Foundry config: `contracts/foundry.toml`
  - Contract target: `contracts/src/EpochTrancheVault.sol`

  **Acceptance Criteria** (agent-executable only):
  - [ ] A contract deployment path exists for the restored dual-safe `EpochTrancheVault` on Amoy and mainnet.
  - [ ] The deploy path accepts `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` as the Amoy USDC asset input.
  - [ ] `cd contracts && forge build && forge test` passes after script changes.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Amoy deploy script validates dual-safe inputs
    Tool: Bash
    Steps: Run the new deploy script in dry-run/json mode with `--network amoy`, the provided USDC address, a placeholder capital Safe, a placeholder trading Safe, and the operator EOAs
    Expected: Script accepts the new constructor shape, resolves chainId 80002, and emits a dry-run artifact without falling back to legacy constructor arguments
    Evidence: .sisyphus/evidence/task-2-amoy-dual-safe-deploy-dryrun.txt

  Scenario: Full contract suite remains green after deploy-script update
    Tool: Bash
    Steps: Run `cd contracts && forge build && forge test`
    Expected: Contract build and all tests pass
    Evidence: .sisyphus/evidence/task-2-contract-suite.txt
  ```

  **Commit**: YES | Message: `build(contracts): align deploy scripts with dual-safe vault` | Files: `contracts/scripts/*`, `contracts/foundry.toml`

- [ ] 3. Split vault configuration into explicit Amoy and mainnet variants

  **What to do**: Replace the current single static `vault1-pph.ts`-style setup with explicit per-network vault config files and selection logic. Keep both networks in the repo at once, with address and role/env differences isolated by network, not by manual editing. The active `VAULT_CONFIGS` export must be selected from `VAULT_NETWORK` so Amoy never boots with mainnet addresses and vice versa.
  **Must NOT do**: Do not overload one config file with inline `if (process.env...)` branches everywhere. Do not delete the mainnet configuration while adding Amoy.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: mostly config-structure and selection work, but foundational
  - Skills: []
  - Omitted: [`playwright`] — not needed

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 6, 7, 8, 9, 10 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Config index: `apps/vault-api/src/config/vaults/index.ts`
  - Current vault config: `apps/vault-api/src/config/vaults/vault1-pph.ts`
  - Other examples: `apps/vault-api/src/config/vaults/vault2-weekly-epoch-prod.ts`, `apps/vault-api/src/config/vaults/vault3-weekly-epoch-staging.ts`, `apps/vault-api/src/config/vaults/vault4-weekly-epoch-test.ts`
  - Types: `apps/vault-api/src/config/types.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Separate Amoy and mainnet vault config files exist for the same logical vault.
  - [ ] `VAULT_CONFIGS` selection is driven by `VAULT_NETWORK`.
  - [ ] `cd apps/vault-api && VAULT_NETWORK=amoy pnpm build` and `VAULT_NETWORK=mainnet pnpm build` both pass.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Amoy loads Amoy vault config only
    Tool: Bash
    Steps: Run `cd apps/vault-api && VAULT_NETWORK=amoy pnpm exec tsx -e "import { VAULT_CONFIGS } from './src/config/vaults/index.ts'; console.log(VAULT_CONFIGS.map(v => ({ id: v.id, vault: v.vaultAddress, safe: v.safeAddress })));"`
    Expected: Output contains Amoy vault/safe addresses and no active mainnet address leakage for the target vault
    Evidence: .sisyphus/evidence/task-3-amoy-config-selection.txt

  Scenario: Mainnet loads mainnet vault config only
    Tool: Bash
    Steps: Run the same probe with `VAULT_NETWORK=mainnet`
    Expected: Output contains mainnet vault/safe addresses and no active Amoy address leakage
    Evidence: .sisyphus/evidence/task-3-mainnet-config-selection.txt
  ```

  **Commit**: YES | Message: `refactor(vault-api): split vault configs by network` | Files: `apps/vault-api/src/config/vaults/*`

- [ ] 4. Update identity resolution and runtime provider wiring for dual-safe plus per-network configs

  **What to do**: Extend vault identity/config resolution so runtime understands the restored dual-safe model and selected network config together. Resolve the active vault address, capital/trading Safe relationship, EOA operator keys, and correct chain/RPC context without falling back to old single-safe assumptions.
  **Must NOT do**: Do not keep `singleSafeMode` as the effective runtime model for the target vault once the dual-safe path is restored. Do not require Polymarket trading keys on Amoy if a gated path does not use them.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: config identity, runtime providers, and dual-safe semantics are tightly coupled
  - Skills: []
  - Omitted: [`git-master`] — not needed

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6, 7, 8, 9, 10 | Blocked By: 1, 3

  **References** (executor has NO interview context — be exhaustive):
  - Identity resolver: `apps/vault-api/src/config/identityResolver.ts`
  - Types: `apps/vault-api/src/config/types.ts`
  - Provider factory: `apps/vault-api/src/services/vaultProviderFactory.ts`
  - Vault provider/client: `apps/vault-api/src/services/customVaultProvider.ts`, `apps/vault-api/src/services/customVaultClient.ts`
  - Safe runtime: `apps/vault-api/src/services/safeWallet.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Runtime identity resolution supports the restored dual-safe model for the target vault.
  - [ ] Provider/client creation uses the selected network chain and correct active Safe/vault addresses.
  - [ ] `cd apps/vault-api && pnpm test --run src/__tests__/identityValidation.test.ts && pnpm build` passes.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Identity resolution succeeds for live Amoy dual-safe vault
    Tool: Bash
    Steps: Run a `tsx` probe that imports the active vault config and identity resolver with `VAULT_NETWORK=amoy` and required keys set
    Expected: Resolver returns the Amoy vault, the expected safe addresses, and no single-safe validation failure
    Evidence: .sisyphus/evidence/task-4-amoy-identity-resolution.txt

  Scenario: Missing dual-safe key or address fails clearly
    Tool: Bash
    Steps: Run the same probe with one required Amoy dual-safe env missing
    Expected: Process exits non-zero with an explicit missing env or invalid dual-safe config error
    Evidence: .sisyphus/evidence/task-4-amoy-identity-error.txt
  ```

  **Commit**: YES | Message: `feat(vault-api): resolve dual-safe identities by network` | Files: config types/resolver/provider wiring

- [ ] 5. Enforce live-only Amoy vault operations while keeping Polymarket trading disabled

  **What to do**: Audit runtime mode handling so the Amoy operator workflow uses real vault transactions rather than simulation shortcuts, while all unsupported Polymarket trading/data paths remain explicitly blocked. This includes worker boot, API routes that still special-case simulation, and any vault-flow code that silently becomes a no-op outside live mode.
  **Must NOT do**: Do not remove simulation support globally if it is still needed for non-Amoy local workflows. Do not let Amoy appear successful by skipping real vault writes.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: runtime mode and trading gating overlap across routes, workers, and services
  - Skills: []
  - Omitted: [`frontend-design`] — not relevant

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7, 8, 9, 10 | Blocked By: 1, 3, 4

  **References** (executor has NO interview context — be exhaustive):
  - Env: `apps/vault-api/src/env.ts`
  - API mode logic: `apps/vault-api/src/routes/vaultRoutes.ts`
  - Worker mode logic: `apps/vault-api/src/worker.ts`, `apps/vault-api/src/tradingWorker.ts`
  - Trading gating: `apps/vault-api/src/services/tradingClient.ts`, `apps/vault-api/src/services/tradingOrchestrator.ts`, `apps/vault-api/src/services/resolutionChecker.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Amoy vault operations use live transaction paths for deposit/settlement/capital movement.
  - [ ] Unsupported Polymarket trading paths remain explicitly blocked on Amoy.
  - [ ] `cd apps/vault-api && pnpm build` and touched tests pass.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Amoy API exposes live vault mode without simulation shortcuts
    Tool: Bash
    Steps: Start the relevant mode probe or API route under `VAULT_NETWORK=amoy VAULT_MODE=live` and inspect the reported mode/status payload
    Expected: Vault mode reports `live`, and endpoints no longer return simulation-only placeholder messages for supported vault actions
    Evidence: .sisyphus/evidence/task-5-amoy-live-mode.txt

  Scenario: Amoy trading path is still blocked
    Tool: Bash
    Steps: Trigger a trading-dependent worker or service probe under `VAULT_NETWORK=amoy VAULT_MODE=live`
    Expected: Process logs/returns an explicit unsupported-on-testnet result instead of attempting Polymarket trading
    Evidence: .sisyphus/evidence/task-5-amoy-trading-block.txt
  ```

  **Commit**: YES | Message: `fix(vault-api): make amoy vault flows live-only` | Files: env/routes/workers/trading gating

- [ ] 6. Harden readiness and regression tooling for the restored dual-safe Amoy flow

  **What to do**: Extend readiness and regression tooling so it validates the restored constructor shape, dual-safe addresses, operator-role env vars, network-specific vault config selection, and the provided Amoy USDC asset. Wrapper scripts must fail loudly when deployment or config is incomplete.
  **Must NOT do**: Do not keep readiness checks that can pass against zero addresses, stale constructor shapes, or network-mismatched configs. Do not mask failures in wrapper scripts.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: bounded tooling work with high operational impact
  - Skills: []
  - Omitted: [`playwright`] — not required here

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8, 9, 10 | Blocked By: 1, 2, 3, 4

  **References** (executor has NO interview context — be exhaustive):
  - Readiness: `apps/vault-api/src/scripts/stagingReadinessCheck.ts`
  - Regression runner: `scripts/run-regression-matrix.sh`
  - Network config: `apps/vault-api/src/config/network.ts`
  - Vault config selection: `apps/vault-api/src/config/vaults/index.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Readiness fails clearly on missing dual-safe env vars, wrong chain, wrong constructor shape, or zero/invalid Amoy addresses.
  - [ ] Regression runner exits non-zero when readiness fails.
  - [ ] `VAULT_NETWORK=mainnet ./scripts/run-regression-matrix.sh` and invalid-Amoy probes behave as expected.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Invalid Amoy dual-safe config fails fast
    Tool: Bash
    Steps: Run `cd apps/vault-api && VAULT_NETWORK=amoy pnpm exec tsx src/scripts/stagingReadinessCheck.ts --quiet` with one required env unset or a zero address in the active config
    Expected: Script exits non-zero and names the missing/invalid dual-safe requirement
    Evidence: .sisyphus/evidence/task-6-amoy-readiness-error.txt

  Scenario: Mainnet regression runner does not mask readiness failures
    Tool: Bash
    Steps: Run `VAULT_NETWORK=mainnet ./scripts/run-regression-matrix.sh` with intentionally broken readiness input in a controlled probe
    Expected: Wrapper exits non-zero instead of swallowing the readiness failure
    Evidence: .sisyphus/evidence/task-6-regression-wrapper-failure.txt
  ```

  **Commit**: YES | Message: `chore(vault): harden dual-safe readiness and regression checks` | Files: readiness/regression scripts

- [ ] 7. Align vault-web with network-scoped vault metadata and Amoy testing semantics

  **What to do**: Update the web app so it reflects the new per-network vault config selection and dual-safe testing state. The UI must show Amoy context clearly, use correct explorer links, and never imply Polymarket trading is available on Amoy. Any displayed vault/safe addresses or action messaging must line up with the active network config and live-only vault workflow.
  **Must NOT do**: Do not add a user-facing network switcher. Do not keep mainnet-only explorer or trading copy on Amoy.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: user-facing semantics and provider wiring both matter
  - Skills: []
  - Omitted: [`git-master`] — not relevant

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 9, 10 | Blocked By: 3, 4, 5, 6

  **References** (executor has NO interview context — be exhaustive):
  - Providers: `apps/vault-web/components/providers.tsx`
  - Header/network badge: `apps/vault-web/components/header.tsx`
  - Vault detail page: `apps/vault-web/app/vault/[id]/vault-detail.tsx`
  - Claim UI: `apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx`
  - Constants/network config: `apps/vault-web/src/constants.ts`, `apps/vault-web/src/lib/network.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Wallet/provider config supports the active Amoy/mainnet selection.
  - [ ] UI clearly labels Amoy as a vault-testing network with trading disabled.
  - [ ] `cd apps/vault-web && pnpm typecheck && pnpm lint && pnpm build` passes.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Amoy vault page shows testnet semantics
    Tool: Playwright
    Steps: Launch the app with `NEXT_PUBLIC_VAULT_NETWORK=amoy`, open `/vault/1`, and inspect the header badge and testnet warning banner
    Expected: Page shows `Amoy Testnet`/equivalent and explicitly states Polymarket trading is disabled
    Evidence: .sisyphus/evidence/task-7-web-amoy.png

  Scenario: Mainnet UI preserves production semantics
    Tool: Playwright
    Steps: Launch the app with `NEXT_PUBLIC_VAULT_NETWORK=mainnet`, open `/vault/1`, and inspect network badge plus explorer links
    Expected: UI shows Polygon mainnet context and no Amoy warning banner
    Evidence: .sisyphus/evidence/task-7-web-mainnet.png
  ```

  **Commit**: YES | Message: `feat(vault-web): align network UI with amoy dual-safe testing` | Files: `apps/vault-web/**/*`

- [ ] 8. Create the operator runbook for Amoy dual-safe deployment and testing

  **What to do**: Write a markdown runbook that gives the operator exact env vars, constructor arguments, role assignments, Safe prerequisites, readiness commands, and the Amoy end-to-end test sequence. It must explicitly use the provided Amoy USDC asset address, the deployer EOA, EOA operator roles, and separate Amoy/mainnet config expectations.
  **Must NOT do**: Do not leave placeholders where exact commands or example values are already known. Do not make the runbook depend on manual memory.

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: this is a precise operational document with technical accuracy requirements
  - Skills: []
  - Omitted: [`playwright`] — not required for authoring

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 9, 10 | Blocked By: 1, 2, 3, 4, 5, 6

  **References** (executor has NO interview context — be exhaustive):
  - User-provided values: `.sisyphus/drafts/amoy-live-dual-safe-validation.md`
  - Env model: `apps/vault-api/src/env.ts`, `apps/vault-web/src/constants.ts`
  - Readiness: `apps/vault-api/src/scripts/stagingReadinessCheck.ts`
  - Regression runner: `scripts/run-regression-matrix.sh`
  - Deployment scripts: `contracts/scripts/*`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Runbook includes exact Amoy env vars and constructor argument order.
  - [ ] Runbook includes the provided Amoy USDC address and deployer EOA.
  - [ ] Runbook includes a full ordered test sequence for deposit, vault->Safe allocation, Safe->vault recall, redemption request, settlement, and claim.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Runbook contains all required operator sections
    Tool: Bash
    Steps: Run `grep -E "^(##|###)" <runbook-path>` and verify sections for prerequisites, env, deploy, readiness, deposit, allocation, recall, redemption, settlement, claim, rollback, and troubleshooting
    Expected: All required sections exist in one document
    Evidence: .sisyphus/evidence/task-8-runbook-sections.txt

  Scenario: Runbook examples use concrete Amoy values
    Tool: Bash
    Steps: Run `grep -n "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582\|0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74" <runbook-path>`
    Expected: Runbook contains both provided addresses in the correct operational context
    Evidence: .sisyphus/evidence/task-8-runbook-values.txt
  ```

  **Commit**: YES | Message: `docs(vault): add amoy dual-safe deployment runbook` | Files: runbook markdown path

- [ ] 9. Execute live Amoy pre-deploy and post-deploy validation probes

  **What to do**: Build executable probes that verify the provided Amoy USDC contract behaves as expected, the deployed vault exposes the restored constructor/state, the Safe addresses are wired correctly, and the readiness gate reports the exact before/after deployment state. This task is the bridge between code completion and real-network testing.
  **Must NOT do**: Do not assume the provided Amoy USDC address is valid without probing it. Do not claim Amoy deployment readiness without on-chain read verification.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: combines read-only chain verification, readiness, and deployment-state auditing
  - Skills: []
  - Omitted: [`frontend-design`] — not relevant

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 10 | Blocked By: 2, 6, 7, 8

  **References** (executor has NO interview context — be exhaustive):
  - Readiness script: `apps/vault-api/src/scripts/stagingReadinessCheck.ts`
  - Network config: `apps/vault-api/src/config/network.ts`
  - Contract ABI/state target: `contracts/src/EpochTrancheVault.sol`
  - User-provided Amoy values: `.sisyphus/drafts/amoy-live-dual-safe-validation.md`

  **Acceptance Criteria** (agent-executable only):
  - [ ] A probe confirms the Amoy USDC address is reachable and exposes expected ERC-20 metadata/functions.
  - [ ] Post-deploy probes confirm the new vault reports the expected Safe addresses and role wiring.
  - [ ] Readiness moves from expected pre-deploy failure to post-deploy success with the same operator config.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Amoy USDC contract verifies on-chain
    Tool: Bash
    Steps: Run `cast call 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 "decimals()(uint8)" --rpc-url $AMOY_RPC_URL` and `cast call 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 "symbol()(string)" --rpc-url $AMOY_RPC_URL`
    Expected: Calls succeed and return sane ERC-20 values for the Amoy asset
    Evidence: .sisyphus/evidence/task-9-amoy-usdc-probe.txt

  Scenario: Post-deploy vault shape verifies on-chain
    Tool: Bash
    Steps: Run `cast call $VAULT_ADDRESS ...` probes for the restored constructor/state getters and then run the readiness script
    Expected: On-chain getters return expected Safe/role/state values and readiness passes
    Evidence: .sisyphus/evidence/task-9-post-deploy-readiness.txt
  ```

  **Commit**: YES | Message: `test(vault): add amoy on-chain validation probes` | Files: probe script(s) and supporting verification updates

- [ ] 10. Prove full mainnet preservation and Amoy end-to-end vault readiness

  **What to do**: Run the final regression matrix and end-to-end checks for both environments. Mainnet must prove nothing regressed. Amoy must prove the complete vault lifecycle is operational: deploy/readiness, deposit, vault-to-Safe movement, Safe-to-vault recall, redemption request creation, settlement/finalization, and claim flow. Use the runbook and current regression scripts as executable truth.
  **Must NOT do**: Do not rely on partial probes or manual assurances. Do not mark Amoy ready if any required vault lifecycle stage is untested.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: ties together contracts, API, web, scripts, and real-environment execution
  - Skills: [`playwright`] — browser verification is required
  - Omitted: [`frontend-design`] — verification only

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: final verification | Blocked By: 1, 2, 3, 4, 5, 6, 7, 8, 9

  **References** (executor has NO interview context — be exhaustive):
  - Regression runner: `scripts/run-regression-matrix.sh`
  - Readiness: `apps/vault-api/src/scripts/stagingReadinessCheck.ts`
  - Web e2e: `apps/vault-web/e2e/lifecycle-happy-path.spec.ts`, `apps/vault-web/e2e/erc7540-lifecycle.spec.ts`
  - Contract tests: `contracts/test/EpochTrancheVault.t.sol`
  - Runbook produced in task 8

  **Acceptance Criteria** (agent-executable only):
  - [ ] Mainnet regression matrix passes.
  - [ ] Amoy regression matrix passes with trading disabled and all required vault lifecycle stages verified.
  - [ ] Browser/API/contract evidence exists for every Amoy lifecycle step.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Mainnet preservation matrix passes
    Tool: Bash
    Steps: Run `VAULT_NETWORK=mainnet ./scripts/run-regression-matrix.sh`
    Expected: Contracts, API, web, and readiness checks pass for mainnet mode
    Evidence: .sisyphus/evidence/task-10-mainnet-matrix.txt

  Scenario: Amoy full vault lifecycle passes with trading disabled
    Tool: Bash
    Steps: Run the final Amoy matrix plus the runbook-driven deposit/allocation/recall/request/settlement/claim probes, then execute the relevant Playwright flow under Amoy config
    Expected: Every required vault lifecycle step succeeds on Amoy; trading-dependent paths are explicitly skipped or blocked
    Evidence: .sisyphus/evidence/task-10-amoy-lifecycle-matrix.txt
  ```

  **Commit**: YES | Message: `test(vault): prove amoy dual-safe lifecycle and mainnet preservation` | Files: regression/e2e/test/probe updates across contracts/api/web

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- Commit 1: restore dual-safe contract and deploy script shape
- Commit 2: split network-scoped vault configs and runtime selection
- Commit 3: live-only Amoy runtime/readiness/runbook updates
- Commit 4: web alignment and final regression matrix

## Success Criteria

- The current branch once again matches the intended dual-safe vault architecture.
- Amoy and mainnet configs coexist safely without hardcoded address collisions.
- Amoy can run real vault lifecycle operations while Polymarket trading remains blocked.
- The operator has an exact constructor/env/runbook for deploy and testing.
- Regression evidence proves Amoy readiness and mainnet preservation.
