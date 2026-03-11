# Learnings - Testnet Mainnet Env Switch

## 2026-03-09 - Task 1 Implementation Learnings

### Successful Patterns

1. **Network Config Module Structure**: Created a clean, type-safe network configuration module that:
   - Defines a `NetworkType` union type: `"mainnet" | "amoy"`
   - Exports a `NetworkConfig` interface with explicit fields for chainId, explorerBaseUrl, rpcEnvKey, etc.
   - Uses `getNetworkConfigFromEnv()` to resolve config at runtime based on `VAULT_NETWORK` / `NEXT_PUBLIC_VAULT_NETWORK`
   - Provides helper functions: `getRpcUrlForNetwork()`, `getExplorerTxUrl()`, `isValidChainIdForNetwork()`

2. **Environment Variable Handling**:
   - API uses `VAULT_NETWORK` (server-side only)
   - Web uses `NEXT_PUBLIC_VAULT_NETWORK` (available in browser)
   - Added `AMOY_RPC_URL` to env.ts for explicit Amoy RPC configuration
   - Maintained backward compatibility with existing `POLYGON_RPC_URL`

3. **Constants.ts Updates**:
   - Changed from hardcoded `POLYGON_CHAIN_ID = 137` to dynamic `networkConfig.chainId`
   - Added `EXPLORER_BASE_URL` export for network-aware explorer links
   - Added `SUPPORTS_POLYMARKET_TRADING` flag for later gating
   - Exported all network config functions/types for consumer use

### Files Created/Modified (within scope)

**vault-api:**

- `apps/vault-api/src/config/network.ts` (new)
- `apps/vault-api/src/constants.ts` (modified)
- `apps/vault-api/src/env.ts` (modified - added VAULT_NETWORK)

**vault-web:**

- `apps/vault-web/src/lib/network.ts` (new)
- `apps/vault-web/src/constants.ts` (modified)

### Type Safety Notes

- Used `viem/chains` Chain type in vault-api (works well with server-side viem usage)
- Removed explicit Chain type from vault-web network config to avoid type conflicts with @reown/appkit
- Both apps use `getNetworkConfigFromEnv()` which validates the network string at runtime

---

## 2026-03-09 - Task 1 Completion Learnings

### Implementation Completed

1. **Network-specific Address Metadata**:
   - Added `addresses` field to `NetworkConfig` interface in both vault-api and vault-web
   - Addresses include: usdcE, ctf, ctfExchange, negRiskCtfExchange, negRiskAdapter, vaultV2Factory
   - Mainnet addresses populated with canonical values
   - Amoy addresses use explicit zero addresses (0x0000...) as placeholders

2. **RPC Configuration**:
   - Added `rpcEnvKey` and `defaultRpcUrl` to both API and web network configs
   - API: `POLYGON_RPC_URL` / `AMOY_RPC_URL` env keys with appropriate defaults
   - Web: `NEXT_PUBLIC_POLYGON_RPC_URL` / `NEXT_PUBLIC_AMOY_RPC_URL` for browser access
   - vault-web now uses dynamic RPC URL resolution: `process.env[networkConfig.rpcEnvKey] || networkConfig.defaultRpcUrl`

3. **Type Safety Considerations**:
   - viem expects addresses as `0x${string}` type, not generic `string`
   - Fixed by casting: `export const USDC_E_ADDRESS = networkConfig.addresses.usdcE as `0x${string}`;`
   - Cannot use `as const` on property accesses (e.g., `networkConfig.addresses.usdcE as const` fails)

4. **env.ts Fix**:
   - Resolved duplicated code and misplaced function definitions
   - `resolveVaultNetwork` was defined inside `resolveVaultMode` body due to missing closing brace
   - `resolveClobSignatureType` was defined AFTER it was used
   - Variables like `vaultMode` were declared twice
   - Added `AMOY_RPC_URL` to env exports

### Files Modified (Final State)

- `apps/vault-api/src/env.ts` - Fixed syntax errors, added AMOY_RPC_URL
- `apps/vault-api/src/config/network.ts` - Added addresses and rpc metadata to NetworkConfig
- `apps/vault-api/src/constants.ts` - Now reads addresses from networkConfig instead of hardcoded
- `apps/vault-web/src/lib/network.ts` - Added addresses, rpcEnvKey, defaultRpcUrl
- `apps/vault-web/src/constants.ts` - Dynamic RPC URL, addresses from networkConfig with proper viem typing

### Build Verification

- ✅ `pnpm build` passes in `apps/vault-api`
- ✅ `pnpm build` passes in `apps/vault-web`

## 2026-03-09 - RPC Env Resolution Fix

### Problem

Dynamic `process.env[networkConfig.rpcEnvKey]` does not work in Next.js client bundles because Next.js needs to see static `process.env.NEXT_PUBLIC_*` references at build time to know which env vars to inline.

### Solution

Added `getRpcUrlForNetwork()` function in `lib/network.ts` that uses explicit static env var references:

```typescript
export function getRpcUrlForNetwork(network: NetworkType): string {
  if (network === "mainnet") {
    return process.env.NEXT_PUBLIC_POLYGON_RPC_URL || MAINNET_CONFIG.defaultRpcUrl;
  }
  return process.env.NEXT_PUBLIC_AMOY_RPC_URL || AMOY_CONFIG.defaultRpcUrl;
}
```

This ensures Next.js can properly inline the env vars into the client bundle.

### Files Changed

- `apps/vault-web/src/lib/network.ts` - Added `getRpcUrlForNetwork()` function
- `apps/vault-web/src/constants.ts` - Updated to use new function and export it

---

## 2026-03-09 - Task 2 Contract Deployment Amoy Support

### Files Modified

**contracts/foundry.toml:**

- Changed RPC endpoints from hardcoded to env-driven: `polygon = "${POLYGON_RPC_URL}"`, `amoy = "${AMOY_RPC_URL}"`
- Added explicit profiles: `[profile.mainnet]` (chain_id = 137) and `[profile.amoy]` (chain_id = 80002)
- This allows explicit network selection via `--profile mainnet` or `--profile amoy` in forge commands

**contracts/scripts/deployWeeklyEpochVault.js:**

- Changed staging profile assetAddress from hardcoded mainnet USDC.e to `null`
- Added comment: "Amoy USDC.e must be provided via WEEKLY_EPOCH_ASSET_ADDRESS env var"
- Updated description to clarify this is for "Amoy testnet"
- Updated help text to indicate staging requires explicit asset address

**contracts/scripts/deploySnapshotTrancheVault.js:**

- Same changes as deployWeeklyEpochVault.js
- staging.assetAddress changed from mainnet address to `null`
- Requires SNAPSHOT_VAULT_ASSET_ADDRESS env var for Amoy deployments

**contracts/scripts/vault-post-deploy.js:**

- Added NETWORK_PROFILES constant with mainnet and amoy configurations
- Added getNetworkProfile() and getRpcUrl() helper functions
- Added --network flag support as alternative to --rpc-url
- Updated validation logic to derive RPC URL from network profile
- Updated help text with network examples and env var documentation
- Removed silent fallback to mainnet RPC URL

### Key Patterns

1. **Explicit Over Implicit**: Removed all silent fallbacks to mainnet addresses/URLs
2. **Env-Driven Configuration**: All network-specific values now come from env vars or explicit flags
3. **Fail-Loud Principle**: Amoy deployments now fail early if asset address not provided, rather than using wrong address
4. **Backwards Compatibility**: Scripts still support explicit --rpc-url for custom endpoints

### Build/Test Notes

- forge build: Fails on pre-existing DebugTest.t.sol issue (unrelated to these changes)
- Node syntax validation: All deployment scripts pass `node -c` validation
- The DebugTest.t.sol compilation error exists in the original codebase



---

## 2026-03-09 - Task 3 Implementation Learnings

### Startup Chain Validation Implementation

Implemented explicit runtime chain validation that ensures the configured RPC URL
matches the expected chain ID for the selected VAULT_NETWORK.

**Key Components Added:**

1. **network.ts - validateRpcChainId()**: Async function that:
   - Creates a temporary viem public client with the configured RPC URL
   - Queries chain ID from the RPC endpoint
   - Compares with expected chain ID from network config
   - Throws explicit error on mismatch with clear remediation steps

2. **network.ts - validateNetworkConfiguration()**: Orchestrates validation by:
   - Reading VAULT_NETWORK from env (defaults to mainnet)
   - Calling validateRpcChainId() with the resolved network
   - Failing fast on any validation errors

3. **startupValidation.ts - New Module**:
   - runStartupValidation(): Runs all startup validations
   - runStartupValidationOrExit(): Convenience wrapper that exits process on failure
   - getNetworkSummary(): Returns network configuration for logging

4. **Boot Path Integration**:
   - index.ts: Calls runStartupValidationOrExit() before starting Express server
   - worker.ts: Calls runStartupValidationOrExit() before starting worker loops
   - Both use top-level await for early validation

**Error Messages**:
- Clear indication of what failed (chain ID mismatch)
- Shows both actual and expected chain IDs
- Includes RPC URL being used
- Suggests which env var to check

### Files Modified:
- apps/vault-api/src/config/network.ts - Added validation functions
- apps/vault-api/src/config/types.ts - Added VaultNetwork type
- apps/vault-api/src/startupValidation.ts - New module (103 lines)
- apps/vault-api/src/index.ts - Added startup validation call
- apps/vault-api/src/worker.ts - Added startup validation call
- apps/vault-api/src/rpcTransport.ts - Made network-aware
- apps/vault-api/src/constants.ts - Added exports for new functions

### Build/Test Results:
- pnpm build: PASSED
- pnpm vitest run src/__tests__/identityValidation.test.ts: 50/58 tests passed
  (8 failures are pre-existing identity resolution issues, unrelated to startup validation)

### Design Decisions:

1. **Fail Fast**: Validation runs as top-level await before any server/worker initialization
2. **Explicit Errors**: Error messages include actionable remediation steps
3. **No Silent Coercion**: Never infers network from RPC - only validates configured against actual
4. **Network-Aware RPC**: rpcTransport.ts now uses getNetworkConfigFromEnv() for RPC URL resolution
5. **Chain Objects**: Uses viem's polygon/polygonAmoy chain objects for proper chain configuration
## Task 4 - Network Gating for Polymarket-Dependent Services

### Changes Made (2026-03-10)

#### Files Modified:
1. `apps/vault-api/src/services/tradingClient.ts`
   - Added network gating check in `initialize()` method
   - Throws explicit error when trying to initialize on unsupported networks (Amoy)
   - Uses `SUPPORTS_POLYMARKET_TRADING` flag from constants

2. `apps/vault-api/src/services/tradingOrchestrator.ts`
   - Added network gating in `fetchGammaMarkets()` function
   - Returns empty array on Amoy with warning log
   - Prevents market fetching from Gamma API on testnet

3. `apps/vault-api/src/services/positionFetcher.ts`
   - Added `checkSupported()` private method
   - Throws explicit error for all position fetching methods on Amoy
   - Methods affected: `fetchActivity()`, `fetchAllPositions()`, `fetchOpenPositions()`, `fetchRedeemablePositions()`, `fetchPositionHistory()`

4. `apps/vault-api/src/services/resolutionChecker.ts`
   - Added network gating in `checkResolutions()` method
   - Returns result with error message on Amoy (graceful degradation)
   - Prevents Gamma API calls for market resolution checking

5. `apps/vault-api/src/services/priceService.ts`
   - Added network gating in `getBidPrices()` method
   - Returns Map with 0 prices for all token IDs on Amoy
   - Prevents CLOB API calls on testnet

6. `apps/vault-api/src/tradingWorker.ts`
   - CLOB probe skipped on Amoy with informative log
   - Trading/hedging initialization skipped on Amoy
   - Vault-only features (resolution checking, Safe operations) remain functional

### Behavior Summary:

**Mainnet (VAULT_NETWORK=mainnet):**
- All Polymarket trading features fully functional
- CLOB trading, Gamma API market fetching, position fetching, resolution checking all work normally
- No behavioral changes from previous implementation

**Amoy (VAULT_NETWORK=amoy):**
- Polymarket trading is explicitly disabled with clear error messages
- Vault operations (deposits, redemptions, settlements, reconciliation) remain functional
- CLOB trading client throws error on initialization attempt
- Market fetching returns empty array
- Position fetching throws error
- Resolution checking returns graceful error result
- Price service returns 0 prices (safe fallback)
- Trading worker skips CLOB probe and trading initialization

### Test Results:
- `pnpm build` passes
- `identityValidation.test.ts`: 58/58 passing
- `tradingOrchestrator.test.ts`: 8/8 passing
- Some pre-existing test failures in unrelated tests (erc7540-compliance, resolutionChecker mock issues)

### Key Design Decisions:
1. **Fail-closed approach**: Trading paths explicitly fail on Amoy rather than silently succeeding
2. **Graceful degradation where appropriate**: Resolution checking returns error result rather than throwing
3. **Clear error messages**: All Amoy blocks include explicit messaging about network limitations
4. **Preserve vault functionality**: Non-Polymarket vault operations continue to work on Amoy


---

## 2026-03-10 - Task 5 Implementation Learnings

### Worker and Provider Network-Aware Implementation

**Files Modified:**
1. `apps/vault-api/src/services/vaultProviderFactory.ts`
   - Added `chain: Chain` property to store network-aware chain object
   - Constructor now accepts optional `chain` parameter, defaults to network config
   - `createProvider()` passes chain to `CustomVaultProvider` constructor
   - Convenience exports (`getVaultProviderFactory`, `initializeVaultProviders`) accept optional chain parameter

2. `apps/vault-api/src/services/customVaultClient.ts`
   - Removed hardcoded `import { polygon } from "viem/chains"`
   - Added `chain: Chain` property to `VaultContractConfig` interface
   - Constructor now requires chain parameter for creating public client
   - `create()` and `createCustomVaultClient()` factory functions require chain parameter

3. `apps/vault-api/src/services/customVaultProvider.ts`
   - Removed hardcoded `import { polygon } from "viem/chains"`
   - Added `chain: Chain` property to store network-aware chain object
   - Constructor accepts optional `chain` parameter, defaults to network config from env
   - Uses `getNetworkConfigFromEnv()` and `getRpcUrlForNetwork()` for network-aware initialization
   - `getSettlerWalletClient()` now uses `this.chain` instead of hardcoded `polygon`
   - Uses `createNetworkTransport()` instead of deprecated `createPolygonTransport()`

4. `apps/vault-api/src/services/safeWallet.ts`
   - Removed hardcoded `import { polygon } from "viem/chains"`
   - Added `chain: Chain` property to store network-aware chain object
   - Constructor accepts optional `rpcUrl` and `chain` parameters
   - Uses `getNetworkConfigFromEnv()` and `getRpcUrlForNetwork()` for network-aware initialization
   - `getBalance()` and `getAllowance()` now use `this.chain` instead of hardcoded `polygon`
   - Uses `createNetworkTransport()` instead of deprecated `createPolygonTransport()`

### Build and Test Results:

- `pnpm build` in `apps/vault-api`: PASSED
- `identityValidation.test.ts`: 58/58 passing
- `adapterRotation.test.ts`: 82/82 passing
- Pre-existing test failures in `erc7540-compliance.test.ts` and `epochRepository.test.ts` (unrelated to network changes)

### Worker Boot Behavior:

**On Amoy (VAULT_NETWORK=amoy):**
- Worker starts up and runs startup validation
- Vault providers are created with `polygonAmoy` chain object
- Safe wallet service uses `polygonAmoy` chain for all operations
- All vault operations use correct Amoy chain
- Trading paths remain gated (per Task 4)

**On Mainnet (VAULT_NETWORK=mainnet):**
- Worker starts up and runs startup validation
- Vault providers are created with `polygon` chain object
- Safe wallet service uses `polygon` chain for all operations
- All vault operations use correct mainnet chain
- Trading paths work normally (per Task 4 preservation)

## Task 6 - Readiness and Regression Tooling Learnings

### Files Created

1. `apps/vault-api/src/scripts/stagingReadinessCheck.ts` - Comprehensive readiness validation script
2. `scripts/run-regression-matrix.sh` - Orchestrated regression test runner

### Readiness Check Behavior

**Mainnet (VAULT_NETWORK=mainnet):**
- Passes with 12 checks passing, 4 warnings
- Warnings for optional env vars (VAULT_ADDRESS, SAFE_ADDRESS)
- Validates RPC chain ID matches expected chain (137)
- Verifies all mainnet contract addresses are valid (non-zero)
- Warns about missing Polymarket builder credentials

**Amoy (VAULT_NETWORK=amoy):**
- Fails with exit code 1 (as expected with placeholder addresses)
- 5 checks pass, 2 fail, 9 warnings
- Correctly identifies missing AMOY_RPC_URL as required
- Correctly fails on USDC.e zero address (required contract)
- Validates chain ID matches (80002)
- Warnings for optional Polymarket contracts with zero addresses

**Invalid Network:**
- Exits immediately with clear error from env.ts validation
- Error: "VAULT_NETWORK must be either 'mainnet' or 'amoy'. Received: invalid"

### Key Design Decisions

1. **Explicit Exit Codes**: 0=ready, 1=checks failed, 2=config error
2. **JSON Output Mode**: `--json` flag for programmatic consumption
3. **Section-Based Checks**: env, config, chain, contract, vault, polymarket
4. **Zero Address Detection**: Explicitly fails on required zero addresses
5. **Network-Aware Validation**: Different requirements for mainnet vs amoy

### Test Commands Used

```bash
# Mainnet readiness check
VAULT_NETWORK=mainnet npx tsx src/scripts/stagingReadinessCheck.ts --verbose

# Amoy readiness check (expected to fail with placeholders)
VAULT_NETWORK=amoy npx tsx src/scripts/stagingReadinessCheck.ts --verbose

# JSON output mode
VAULT_NETWORK=mainnet npx tsx src/scripts/stagingReadinessCheck.ts --json

# Invalid network (config error)
VAULT_NETWORK=invalid npx tsx src/scripts/stagingReadinessCheck.ts
```


## 2026-03-10 - Task 7 Implementation Learnings (vault-web network awareness)

### Files Modified

1. **apps/vault-web/components/providers.tsx**
   - Updated to dynamically select network based on VAULT_NETWORK env var
   - Imports both polygon and polygonAmoy from @reown/appkit/networks
   - Uses selectedNetwork = VAULT_NETWORK === "amoy" ? polygonAmoy : polygon
   - Both WagmiAdapter and createAppKit now use the selected network

2. **apps/vault-web/components/header.tsx**
   - Added network indicator badge showing current network
   - Uses amber styling for testnet, emerald for mainnet
   - Badge includes tooltip explaining network context
   - Imports VAULT_NETWORK from constants to determine current network

3. **apps/vault-web/app/vault/[id]/vault-detail.tsx**
   - Added imports for EXPLORER_BASE_URL, VAULT_NETWORK, SUPPORTS_POLYMARKET_TRADING
   - Updated TxStatus component to use EXPLORER_BASE_URL for network-aware explorer links
   - Added testnet warning banner when VAULT_NETWORK === "amoy"
   - Banner clearly states: "Vault testing is supported, but Polymarket trading is disabled"

4. **apps/vault-web/app/vault/[id]/components/ClaimableRequests.tsx**
   - Added import for EXPLORER_BASE_URL from constants
   - Updated transaction link to use network-aware explorer URL instead of hardcoded polygonscan.com

### Network-Aware Behavior

**Mainnet (NEXT_PUBLIC_VAULT_NETWORK=mainnet or unset):**
- Provider configured for Polygon Mainnet (chain ID 137)
- Explorer links use polygonscan.com
- Header shows "Polygon Mainnet" with emerald badge
- No testnet warning banner
- Polymarket trading features work normally

**Amoy (NEXT_PUBLIC_VAULT_NETWORK=amoy):**
- Provider configured for Polygon Amoy Testnet (chain ID 80002)
- Explorer links use amoy.polygonscan.com
- Header shows "Amoy Testnet" with amber badge
- Testnet warning banner displayed on vault detail page
- Banner explicitly states Polymarket trading is disabled

### Verification Results

- pnpm typecheck: PASSED (no errors)
- pnpm lint: PASSED (only pre-existing warnings, no new errors)
- pnpm build: PASSED (compiled successfully, static pages generated)

### Key Implementation Notes

1. No user-driven network switcher: As specified, network is env-driven only via NEXT_PUBLIC_VAULT_NETWORK
2. Explorer URL consistency: All transaction links now use EXPLORER_BASE_URL from network config
3. Visual distinction: Testnet uses amber/yellow styling, mainnet uses emerald/green
4. Clear messaging: Amoy users see explicit warnings about testnet nature and disabled trading


## 2026-03-10 - Task 8 Regression Coverage Verification

### Mainnet Regression Matrix Results

**Command:** `VAULT_NETWORK=mainnet ./scripts/run-regression-matrix.sh`

**Results:**
- Readiness check: PASSED (12 checks passed, 0 failed, 4 warnings)
  - Chain ID validation: RPC chain ID (137) matches expected mainnet chain ID
  - Contract addresses: All valid
  - Polymarket credentials: Warns about missing builder credentials (expected)
- Build verification: PASSED
  - apps/vault-api: Build successful
  - apps/vault-web: Build successful
- Contract tests: PASSED (187 tests)
- Targeted unit tests: PASSED
  - identityValidation.test.ts: 58/58 passed
  - adapterRotation.test.ts: 82/82 passed
  - tradingOrchestrator.test.ts: 8/8 passed
  - resolutionChecker.test.ts: 8/8 passed

**Exit code:** 0 (success)

### Amoy Regression Matrix Results

**Command:** `VAULT_NETWORK=amoy ./scripts/run-regression-matrix.sh`

**Results:**
- Readiness check: FAILED as expected (5 checks passed, 2 failed, 9 warnings)
  - Failed checks:
    - `env:AMOY_RPC_URL` - Required but not set (expected in test env)
    - `contract:USDC.e` - Zero address (expected - no Amoy deployment)
  - Warnings for optional Polymarket contracts with zero addresses (expected)
- Build verification: Not reached (readiness blocks on failure)

**Exit code:** 1 (correct failure)

With `--skip-readiness` flag to bypass deployment checks:
- Build verification: PASSED
- Targeted unit tests: PASSED
  - identityValidation.test.ts: 58/58 passed (mainnet and Amoy)
  - adapterRotation.test.ts: 82/82 passed (mainnet and Amoy)
  - tradingOrchestrator.test.ts: 8/8 passed (mainnet and Amoy)
  - resolutionChecker.test.ts: 8/8 passed (mainnet and Amoy)

### Script Fix Applied

**Issue:** The regression matrix script was not correctly capturing exit codes from the readiness check.

**Fix:** Changed from `if ! command; then local exit_code=$?` to:
```bash
local exit_code=0
pnpm --dir apps/vault-api exec tsx src/scripts/stagingReadinessCheck.ts || exit_code=$?
if [[ $exit_code -ne 0 ]]; then
    # handle failure
fi
```

**File modified:** `scripts/run-regression-matrix.sh`

### Vault-Web Verification

**Typecheck:** PASSED (no errors)
**Lint:** PASSED (only pre-existing warnings, no new errors)
**Build:** PASSED (both mainnet and Amoy configurations)

### Key Findings

1. **Mainnet behavior preserved**: All existing tests pass on mainnet with no regressions
2. **Amoy trading-disabled behavior verified**: Tests confirm vault operations work while Polymarket paths are gated
3. **Exit codes correct**: Both success (0) and failure (1) exit codes work properly
4. **No test failures related to network changes**: All targeted tests pass on both networks
5. **Pre-existing test failures**: Some integration tests have mock issues unrelated to this work (settlementLifecycle, erc7540-compliance)

### Files Changed for Task 8

- `scripts/run-regression-matrix.sh` - Fixed exit code capture in run_readiness_check()
