# Vault Config Folder Structure Decisions

## Decision: Per-Network Folder Organization

**Date:** 2026-03-10

**Context:** Need to support both mainnet and Amoy testnet vault deployments with distinct contract addresses and potentially different configurations.

**Decision:** Split configurations into `mainnet/` and `amoy/` subdirectories.

**Rationale:**

1. **Clarity:** Explicit separation prevents accidental mixing of mainnet/testnet addresses
2. **Type Safety:** Each network can have different validation rules
3. **Environment Isolation:** Different env var prefixes prevent key collisions
4. **Future Extensibility:** Easy to add more networks (e.g., Mumbai, Sepolia)

**Rejected Alternatives:**

- Single file with conditional logic: Hard to maintain, less readable
- Environment-specific files: Doesn't scale well with multiple vaults per network
- Database-stored configs: Adds unnecessary complexity for static deployment configs

## Decision: Dynamic require() Loading

**Date:** 2026-03-10

**Decision:** Use `require()` for dynamic module loading based on `VAULT_NETWORK`.

**Rationale:**

- Allows runtime network selection
- Keeps bundle size smaller (only loads one network's configs)
- Works with ES modules when configured properly

## Decision: Amoy Config Disabled by Default

**Date:** 2026-03-10

**Decision:** Amoy vault configs have `enabled: false` until contract addresses are populated.

**Rationale:**

- Prevents accidental activation with placeholder addresses
- Validation still runs (catches config errors)
- Easy to enable after deployment by setting addresses in env vars



---

# EpochTrancheVault Dual-Safe Architecture Decisions

## Decision: Add tradingSafe Parameter to Constructor

**Date:** 2026-03-10

**Context:** Need to restore dual-safe architecture with a dedicated trading safe for the vault to deploy capital to.

**Decision:** Add `address _tradingSafe` parameter to constructor between address params and uint256 params.

**Rationale:**
1. **Explicit Configuration:** tradingSafe address is set at deployment and immutable
2. **Validation:** Zero-address check prevents misconfiguration
3. **Access Control:** ADMIN_ROLE required for capital deployment/recall

**Implementation:**
- Added `address public immutable tradingSafe;` 
- Added `_tradingSafe` parameter to constructor
- Added `if (_tradingSafe == address(0)) revert InvalidAddress();`

---

## Decision: Track deployedCapital as State Variable

**Date:** 2026-03-10

**Context:** Need to track how much capital is deployed to tradingSafe vs held in vault.

**Decision:** Use `uint256 public deployedCapital;` state variable updated on deploy/recall.

**Rationale:**
1. **Transparency:** External view function `getDeployedCapital()` for UI/reporting
2. **Accounting:** totalAssets() adds deployedCapital to vault balance for true AUM
3. **Safety:** Recall operations check against deployedCapital to prevent over-recall

---

## Decision: Use SafeERC20 for Capital Transfers

**Date:** 2026-03-10

**Context:** Need secure USDC transfers between vault and tradingSafe.

**Decision:** 
- `deployCapital`: Use `safeTransfer` (vault is sender)
- `recallCapital`: Use `safeTransferFrom` (requires tradingSafe approval)

**Rationale:**
1. **Security:** SafeERC20 handles non-standard ERC20 tokens
2. **Pull Pattern:** recallCapital uses pull pattern for security
3. **Explicit Approval:** tradingSafe must approve vault for recall operations

---

## Decision: totalAssets() Includes Deployed Capital

**Date:** 2026-03-10

**Context:** totalAssets() should represent total assets under management.

**Decision:** `totalAssets()` returns `asset.balanceOf(address(this)) + deployedCapital`

**Rationale:**
1. **True AUM:** Assets in tradingSafe are still under vault management
2. **ERC-4626 Compatibility:** Share price calculations use totalAssets()
3. **User Expectations:** Depositors see full AUM including deployed capital

---

## Decision: Events for Capital Operations

**Date:** 2026-03-10

**Context:** Need to track capital movements on-chain for monitoring/auditing.

**Decision:** Emit events on capital operations:
- `CapitalDeployed(uint256 amount, uint256 newTotal)`
- `CapitalRecalled(uint256 amount, uint256 newTotal)`

**Rationale:**
1. **Monitoring:** Off-chain services can track capital flows
2. **Accounting:** Event logs provide audit trail
3. **UI Updates:** Frontend can react to capital changes

---

## Decision: Create Dedicated Deploy Script for EpochTrancheVault


---

# Identity Resolver - Dual-Safe Implementation Decisions

## Architectural Decisions

### 1. Single vs Dual Safe Resolution Strategy
**Decision**: In single-safe mode, `resolveTradingSafe()` returns the main `safeAddress`.
**Rationale**: This maintains consistency - callers always get a trading safe address, whether it's dedicated or shared. Prevents undefined checks throughout the codebase.

### 2. Optional vs Required tradingSafeAddress
**Decision**: `tradingSafeAddress` is optional in both config and resolved identity.
**Rationale**: Not all vaults need trading capabilities. Making it optional allows non-trading vaults to exist without configuration overhead.

### 3. Static vs On-Chain Role Validation
**Decision**: `validateTradingSafeRoles()` performs static validation only.
**Rationale**: On-chain role checking requires async contract calls. Static validation catches configuration errors early; runtime verification handles actual role state.

### 4. Network Field Placement
**Decision**: Added `network` to both `VaultInstanceConfig` and `ResolvedVaultIdentity`.
**Rationale**: Enables network-aware resolution and validation. Defaults to "mainnet" for backward compatibility.

### 5. Role Constants as Hardcoded Hashes
**Decision**: Role hashes are hardcoded hex strings rather than computed at runtime.
**Rationale**: Role hashes are deterministic and don't change. Hardcoding eliminates dependencies and computation overhead.

### 6. resolveVaultIdentityComplete() Pattern
**Decision**: Created new function rather than modifying existing `resolveVaultIdentity()`.
**Rationale**: Preserves backward compatibility. Existing callers unaffected; new callers can opt into complete resolution with validation.

## Design Patterns

1. **Defensive Validation**: All functions validate inputs and throw descriptive errors
2. **Consistent Address Formatting**: All addresses lowercased for comparison consistency
3. **Graceful Degradation**: Optional fields allow partial configurations
4. **Clear Separation**: Resolution logic separate from validation logic

## Future Considerations

1. **On-Chain Role Verification**: Consider adding async `verifyTradingSafeRolesOnChain()` for runtime validation
2. **Network-Specific Address Lists**: Could add validation against known contract addresses per network
3. **Role Configuration**: Could make required roles configurable per vault type

## Type Safety

All changes maintain strict TypeScript compatibility:
- Optional fields use `?:` syntax
- Union types for network values
- Return types explicitly declared
- No `any` types introduced


---

# Amoy Live-Only Mode with Trading Disabled Decisions (2026-03-10)

## Decision 1: Always Force Live Mode on Amoy
**Status:** ✅ Implemented

**Rationale:**
- User explicitly stated: "There is no point of vault simulation mode in here, i think we would have to always keep live mode only"
- On testnets, simulation mode provides no value since there's no real capital at risk
- Simulation mode could mask issues that would appear in live mode

**Implementation:**
- Modified `env.ts` to override VAULT_MODE to "live" when VAULT_NETWORK=amoy
- Console warning logged when override occurs
- Amoy vault configs set `defaultMode: "live"`

---

## Decision 2: Explicitly Disable Polymarket Trading on Amoy
**Status:** ✅ Implemented

**Rationale:**
- Polymarket doesn't operate on testnets (no CLOB, no liquidity)
- Attempting to trade on Amoy would fail or produce undefined behavior
- Testnet USDC has no real value, making trading meaningless
- Prevents accidental testnet trading attempts

**Implementation:**
- Added `isTradingEnabled()` helper in `env.ts` that returns false for Amoy
- `tradingWorker.ts` exits immediately with informative message on Amoy
- Capital worker (worker.ts) continues to run for NAV/liquidity management

---

## Decision 3: Exit TradingWorker Early vs. Skip Trading Logic
**Status:** ✅ Implemented

**Options Considered:**
1. **Skip trading logic** - Initialize vaults but skip trading scans
2. **Exit early** - Don't start the worker at all

**Decision:** Exit early with `process.exit(0)`

**Rationale:**
- Clean separation - tradingWorker shouldn't run at all on Amoy
- Prevents unnecessary initialization overhead
- Clearer operational semantics
- Exit code 0 (success) indicates intentional shutdown, not error

---

## Decision 4: Use Console.warn vs. Logger in env.ts
**Status:** ✅ Implemented

**Rationale:**
- `env.ts` is a low-level configuration module
- Importing logger could create circular dependencies
- Console output is acceptable for startup-time warnings
- ESLint disable comment added for `no-console` rule

---

## Decision 5: Capital Worker Continues on Amoy
**Status:** ✅ Implemented

**Rationale:**
- NAV calculation and liquidity management still needed on testnet
- These operations don't interact with Polymarket
- Useful for testing vault mechanics (deposits, withdrawals, NAV)
- Only trading-related operations are disabled

---

## Security Considerations

1. **No simulation bypass** - Amoy ALWAYS runs live, no user override
2. **No trading on testnet** - Prevents confusion and potential bugs
3. **Clear audit trail** - All enforcement actions are logged
4. **Mainnet safety** - All logic is conditional on network detection

## Verification Checklist

- [x] `env.ts` enforces live mode on Amoy
- [x] `isTradingEnabled()` returns false for Amoy
- [x] `worker.ts` logs Amoy status
- [x] `tradingWorker.ts` exits early on Amoy
- [x] Amoy vault config has `defaultMode: "live"`
- [x] TypeScript build passes
- [x] No breaking changes to mainnet functionality



---

# Readiness Check and Regression Matrix Hardening Decisions (2026-03-10)

## Decision 1: Add Four New Dual-Safe Check Functions
**Status:** ✅ Implemented

**Rationale:**
- tradingSafe address validation is critical for dual-safe operations
- Capital function accessibility must be verified before deployment
- USDC balance checks prevent failed capital deployment attempts
- Approval validation catches recallCapital prerequisites early

**Implementation:**
- `checkTradingSafe()`: Validates tradingSafe address format and existence
- `checkCapitalFunctions()`: Verifies deployCapital/recallCapital accessible
- `checkVaultUSDCBalance()`: Confirms vault has USDC for operations
- `checkTradingSafeApproval()`: Validates approval for recall operations

---

## Decision 2: Separate Pre-Deploy and Post-Deploy Validation
**Status:** ✅ Implemented

**Rationale:**
- Pre-deploy validation catches configuration errors before spending gas
- Post-deploy validation confirms successful deployment
- Constructor argument validation prevents failed deployments
- Contract state validation ensures correct initialization

**Implementation:**
- `runPreDeployValidation()`: Validates constructor args, addresses, numeric params
- `runPostDeployValidation()`: Validates contract existence, state, configuration

---

## Decision 3: Add USDC and Dual-Safe ABIs
**Status:** ✅ Implemented

**Rationale:**
- Need to read USDC balance and allowance on-chain
- Need to call tradingSafe and capital functions
- Minimal ABIs reduce bundle size vs. full contract ABIs
- Type-safe with viem's const assertion

**Implementation:**
- `USDC_ABI`: balanceOf, allowance functions
- `VAULT_DUAL_SAFE_ABI`: tradingSafe, deployedCapital, getDeployedCapital, deployCapital, recallCapital

---

## Decision 4: Create 7-Step Amoy Test Suite in Regression Matrix
**Status:** ✅ Implemented

**Rationale:**
- Amoy requires different test flow than mainnet (no Polymarket)
- Dual-safe architecture needs specific validation steps
- Clear test phases enable better debugging
- Integration with existing regression matrix

**Implementation:**
- `run_amoy_predeploy_checks()`: Step 1 - Validate prerequisites
- `run_amoy_deploy_flow()`: Step 2 - Deploy vault
- `run_amoy_postdeploy_checks()`: Step 3 - Validate deployment
- `run_amoy_deposit_flow()`: Step 4 - Test deposits
- `run_amoy_capital_deploy_flow()`: Step 5 - Test capital deploy
- `run_amoy_capital_recall_flow()`: Step 6 - Test capital recall
- `run_amoy_redemption_flow()`: Step 7 - Test redemption

---

## Decision 5: Support Dry-Run Mode
**Status:** ✅ Implemented

**Rationale:**
- Validation shouldn't require real transactions
- Configuration checks can run without spending gas
- Allows testing deployment readiness safely
- Maintains existing dry-run semantics

**Implementation:**
- All checks use view functions where possible
- State-modifying operations only in live mode
- Clear logging of dry-run vs live mode

---

## Decision 6: Add Exit Code 6 for Amoy Test Failures
**Status:** ✅ Implemented

**Rationale:**
- Distinct exit codes enable programmatic handling
- Amoy tests are separate from other test categories
- Clear failure attribution for CI/CD pipelines

**Implementation:**
- Exit code 6: Amoy dual-safe tests failed
- Documented in script header comments
- Used in `run_amoy_dualsafe_tests()` error handling

---

## Decision 7: Maintain Backward Compatibility
**Status:** ✅ Implemented

**Rationale:**
- Mainnet checks should continue to work unchanged
- Existing vaults without tradingSafe should not fail
- Amoy tests only run when explicitly configured
- No breaking changes to existing APIs

**Implementation:**
- Dual-safe checks return "warn" for pre-dual-safe contracts
- Amoy tests only run when VAULT_NETWORK=amoy
- All existing checks preserved
- Optional fields for backward compatibility

---

## Decision 8: Use Warnings for Non-Critical Issues
**Status:** ✅ Implemented

**Rationale:**
- Zero USDC balance is a warning, not a failure (vault may be new)
- Missing tradingSafe approval is a warning until capital needs recall
- Pre-dual-safe contracts should warn, not fail
- Allows progressive adoption of dual-safe architecture

**Implementation:**
- `checkVaultUSDCBalance()`: Warns on zero balance
- `checkTradingSafeApproval()`: Warns on zero allowance
- `checkTradingSafe()`: Warns if function doesn't exist (pre-dual-safe)
- `checkCapitalFunctions()`: Warns if functions not accessible

---

## Verification Checklist

- [x] `checkTradingSafe()` validates tradingSafe address
- [x] `checkCapitalFunctions()` validates deploy/recall accessible
- [x] `checkVaultUSDCBalance()` validates USDC balance
- [x] `checkTradingSafeApproval()` validates recall approval
- [x] `runPreDeployValidation()` validates constructor args
- [x] `runPostDeployValidation()` validates contract state
- [x] `run_amoy_dualsafe_tests()` runs 7-step Amoy suite
- [x] Exit code 6 added for Amoy test failures
- [x] Dry-run mode supported
- [x] Backward compatibility maintained
- [x] TypeScript build passes
- [x] Documentation updated

---

*Last updated: March 10, 2026*


---

# Operator Runbook Creation Decision (2026-03-10)

## Decision: Create Comprehensive Operator Runbook for Amoy
**Status:** ✅ Implemented

**Context:** Need comprehensive documentation for deploying and operating the dual-safe vault on Amoy testnet.

**Decision:** Create operator runbook at `docs/operator-runbook-amoy.md` with 8 major sections covering full deployment and operation lifecycle.

**Rationale:**
1. **Single Source of Truth:** All Amoy vault operations documented in one place
2. **Copy-Paste Ready:** Commands can be executed directly without modification
3. **EOA Operator Model:** Clear documentation of testnet-specific EOA approach (vs. production Safe multisig)
4. **Complete Coverage:** From prerequisites through emergency procedures

**Implementation:**

### Runbook Structure:
- Section 1: Prerequisites (env vars, wallets, RPC endpoints)
- Section 2: Pre-Deployment Checklist (funding, compilation, validation)
- Section 3: Contract Deployment (constructor args, dry run, live deploy)
- Section 4: Post-Deployment Validation (contract state, roles, USDC)
- Section 5: Role Assignment (EOA model, granting/revoking)
- Section 6: End-to-End Test Sequence (12-step deposit to redemption flow)
- Section 7: Troubleshooting Guide (deployment, transaction, role issues)
- Section 8: Emergency Procedures (emergency mode, role transfer, verification)

### Key Constants Documented:
- Chain ID: 80002
- USDC Address: `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`
- RPC URL: `https://rpc-amoy.polygon.technology`
- Deployer: `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`

### Constructor Arguments:
Documented exact order and types for EpochTrancheVault constructor with Amoy-specific values:

```solidity
constructor(
    address _asset,              // USDC: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
    address _admin,              // Deployer: 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74
    address _settler,            // TBD: EOA operator for settlement
    address _navUpdater,         // TBD: EOA operator for NAV updates
    address _snapshotter,        // TBD: EOA operator for snapshots
    address _depositProcessor,   // TBD: EOA operator for deposits
    address _tradingSafe,        // TBD: Safe contract address
    uint256 _epochDuration,      // 3600 (1 hour for staging)
    uint256 _navStalenessThreshold, // 21600 (6 hours)
    uint256 _minClaimThreshold,  // 100000000 (100 USDC)
    uint256 _balancedUpfrontBps  // 0
)
```

### Staging Profile Parameters:
- Epoch Duration: 3600 seconds (1 hour)
- NAV Staleness Threshold: 21600 seconds (6 hours)
- Min Claim Threshold: 100000000 (100 USDC)
- Balanced Upfront Bps: 0

### Appendices:
- Appendix A: Quick reference commands for all operations
- Appendix B: Deployment template for recording deployments

**Verification Checklist:**
- [x] Prerequisites documented with all env vars
- [x] Pre-deployment checklist with 6 validation steps
- [x] Constructor args documented with exact types and order
- [x] Deployment commands (dry run and live) provided
- [x] Post-deployment validation commands with expected outputs
- [x] Role assignment process for EOA model
- [x] 12-step end-to-end test sequence
- [x] Troubleshooting guide with error mapping
- [x] Emergency procedures documented
- [x] Quick reference commands in Appendix A
- [x] Deployment template in Appendix B
- [x] Amoy USDC address included: `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`
- [x] Deployer wallet documented: `0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74`
- [x] All TBD addresses clearly marked

---

*Last updated: March 10, 2026*
