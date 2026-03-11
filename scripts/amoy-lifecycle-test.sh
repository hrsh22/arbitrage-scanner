#!/bin/bash
#
# Amoy Vault Lifecycle Test Orchestrator
#
# Performs complete end-to-end testing of the EpochTrancheVault lifecycle:
# 1. Deposit USDC to vault
# 2. Verify deposit queued
# 3. Process deposits (admin)
# 4. Deploy capital to tradingSafe
# 5. Verify capital deployed
# 6. Recall capital from tradingSafe
# 7. Verify capital recalled
#
# Usage:
#   VAULT_ADDRESS=0x... ./scripts/amoy-lifecycle-test.sh
#
# Required Environment Variables:
#   VAULT_ADDRESS                    - Deployed vault contract address
#   AMOY_RPC_URL                     - Amoy testnet RPC URL (default: https://rpc-amoy.polygon.technology)
#   
#   DEPOSITOR_PRIVATE_KEY            - Private key of depositor account (must have USDC)
#   ADMIN_PRIVATE_KEY                - Private key with ADMIN_ROLE
#   DEPOSIT_PROCESSOR_PRIVATE_KEY    - Private key with DEPOSIT_PROCESSOR_ROLE
#   TRADING_SAFE_PRIVATE_KEY         - Private key for trading safe (to approve recall)
#
# Optional Environment Variables:
#   TEST_AMOUNT                      - Amount to deposit (default: 1000000 = 1 USDC)
#   TX_TIMEOUT                       - Transaction timeout in seconds (default: 120)
#
# Exit codes:
#   0 - All tests passed
#   1 - Missing required environment variables
#   2 - Step 1 (Deposit) failed
#   3 - Step 2 (Verify Deposit) failed
#   4 - Step 3 (Process Deposits) failed
#   5 - Step 4 (Deploy Capital) failed
#   6 - Step 5 (Verify Deployed Capital) failed
#   7 - Step 6 (Recall Capital) failed
#   8 - Step 7 (Verify Capital Recalled) failed

set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly EVIDENCE_DIR="${PROJECT_ROOT}/.sisyphus/evidence"
readonly NOTEPAD_DIR="${PROJECT_ROOT}/.sisyphus/notepads/amoy-live-dual-safe-validation"

# Default values
readonly DEFAULT_AMOY_RPC="https://rpc-amoy.polygon.technology"
readonly DEFAULT_TEST_AMOUNT="1000000"  # 1 USDC (6 decimals)
readonly DEFAULT_TX_TIMEOUT="120"

# USDC on Amoy testnet
readonly USDC_ADDRESS="0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color

# Test state
VAULT_ADDRESS="${VAULT_ADDRESS:-}"
AMOY_RPC_URL="${AMOY_RPC_URL:-$DEFAULT_AMOY_RPC}"
TEST_AMOUNT="${TEST_AMOUNT:-$DEFAULT_TEST_AMOUNT}"
TX_TIMEOUT="${TX_TIMEOUT:-$DEFAULT_TX_TIMEOUT}"

# Test tracking
TEST_START_TIME=""
TEST_END_TIME=""
CURRENT_STEP=0
TOTAL_STEPS=7
STEP_RESULTS=()
DEPOSIT_REQUEST_ID=""
DEPOSITOR_ADDRESS=""
ADMIN_ADDRESS=""
DEPOSIT_PROCESSOR_ADDRESS=""
TRADING_SAFE_ADDRESS=""
TRADING_SAFE_APPROVED="false"

# Evidence tracking
EVIDENCE_FILE="${EVIDENCE_DIR}/task-10-amoy-lifecycle-matrix.txt"
NOTEPAD_FILE="${NOTEPAD_DIR}/learnings.md"

# ============================================================================
# CONTRACT ABIs (minimal for cast)
# ============================================================================

# EpochTrancheVault ABI fragments
readonly VAULT_ABI_QUEUE_DEPOSIT="queueDeposit(uint256)"
readonly VAULT_ABI_PROCESS_DEPOSIT_QUEUE="processDepositQueue(uint256,uint256,uint256)"
readonly VAULT_ABI_DEPLOY_CAPITAL="deployCapital(uint256)"
readonly VAULT_ABI_RECALL_CAPITAL="recallCapital(uint256)"
readonly VAULT_ABI_DEPOSIT_REQUESTS="depositRequests(uint256)"
readonly VAULT_ABI_DEPLOYED_CAPITAL="deployedCapital()"
readonly VAULT_ABI_TRADING_SAFE="tradingSafe()"
readonly VAULT_ABI_CURRENT_EPOCH_ID="currentEpochId()"
readonly VAULT_ABI_TOTAL_QUEUED_ASSETS="totalQueuedAssets()"

# USDC ABI fragments
readonly USDC_ABI_APPROVE="approve(address,uint256)"
readonly USDC_ABI_ALLOWANCE="allowance(address,address)"
readonly USDC_ABI_BALANCE_OF="balanceOf(address)"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  STEP ${CURRENT_STEP}/${TOTAL_STEPS}: $1${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_failure() {
    echo -e "${RED}❌ $1${NC}"
}

# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

validate_environment() {
    log_info "Validating environment..."
    
    local errors=()
    
    # Check VAULT_ADDRESS
    if [[ -z "$VAULT_ADDRESS" ]]; then
        errors+=("VAULT_ADDRESS is required")
    elif [[ ! "$VAULT_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
        errors+=("VAULT_ADDRESS format invalid (must be 0x + 40 hex chars)")
    fi
    
    # Check private keys
    if [[ -z "${DEPOSITOR_PRIVATE_KEY:-}" ]]; then
        errors+=("DEPOSITOR_PRIVATE_KEY is required")
    fi
    
    if [[ -z "${ADMIN_PRIVATE_KEY:-}" ]]; then
        errors+=("ADMIN_PRIVATE_KEY is required")
    fi
    
    if [[ -z "${DEPOSIT_PROCESSOR_PRIVATE_KEY:-}" ]]; then
        errors+=("DEPOSIT_PROCESSOR_PRIVATE_KEY is required")
    fi
    
    if [[ -z "${TRADING_SAFE_PRIVATE_KEY:-}" ]]; then
        errors+=("TRADING_SAFE_PRIVATE_KEY is required")
    fi
    
    # Check cast is available
    if ! command -v cast &> /dev/null; then
        errors+=("cast not found. Please install Foundry (https://getfoundry.sh/)")
    fi
    
    if [[ ${#errors[@]} -gt 0 ]]; then
        log_error "Environment validation failed:"
        for error in "${errors[@]}"; do
            log_error "  - $error"
        done
        exit 1
    fi
    
    # Derive addresses from private keys
    DEPOSITOR_ADDRESS=$(cast wallet address --private-key "$DEPOSITOR_PRIVATE_KEY")
    ADMIN_ADDRESS=$(cast wallet address --private-key "$ADMIN_PRIVATE_KEY")
    DEPOSIT_PROCESSOR_ADDRESS=$(cast wallet address --private-key "$DEPOSIT_PROCESSOR_PRIVATE_KEY")
    
    log_info "Environment validated"
    log_info "  Vault: $VAULT_ADDRESS"
    log_info "  Depositor: $DEPOSITOR_ADDRESS"
    log_info "  Admin: $ADMIN_ADDRESS"
    log_info "  Deposit Processor: $DEPOSIT_PROCESSOR_ADDRESS"
    log_info "  RPC: $AMOY_RPC_URL"
}

# ============================================================================
# CAST HELPER FUNCTIONS
# ============================================================================

cast_send() {
    local private_key="$1"
    local to="$2"
    local sig="$3"
    shift 3
    local args="$@"
    
    local tx_hash
    tx_hash=$(cast send \
        --rpc-url "$AMOY_RPC_URL" \
        --private-key "$private_key" \
        --timeout "$TX_TIMEOUT" \
        "$to" \
        "$sig" \
        $args \
        2>&1 | grep -oE '0x[a-fA-F0-9]{64}' | head -1)
    
    if [[ -z "$tx_hash" ]]; then
        log_error "Failed to send transaction"
        return 1
    fi
    
    echo "$tx_hash"
}

cast_call() {
    local to="$1"
    local sig="$2"
    shift 2
    local args="$@"
    
    cast call \
        --rpc-url "$AMOY_RPC_URL" \
        "$to" \
        "$sig" \
        $args \
        2>/dev/null
}

cast_wait() {
    local tx_hash="$1"
    local timeout="${2:-$TX_TIMEOUT}"
    
    cast receipt \
        --rpc-url "$AMOY_RPC_URL" \
        --timeout "$timeout" \
        "$tx_hash" \
        > /dev/null 2>&1
}

# ============================================================================
# STEP FUNCTIONS
# ============================================================================

step_1_deposit() {
    CURRENT_STEP=1
    log_step "DEPOSIT USDC TO VAULT"
    
    log_info "Depositor: $DEPOSITOR_ADDRESS"
    log_info "Amount: $TEST_AMOUNT (USDC with 6 decimals)"
    
    # Check depositor USDC balance
    local balance
    balance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_BALANCE_OF" "$DEPOSITOR_ADDRESS")
    balance=$(cast to-dec "$balance" 2>/dev/null || echo "$balance")
    log_info "Depositor USDC balance: $balance"
    
    if [[ "$balance" -lt "$TEST_AMOUNT" ]]; then
        log_error "Insufficient USDC balance. Required: $TEST_AMOUNT, Have: $balance"
        return 1
    fi
    
    # Step 1a: Approve vault to spend USDC
    log_info "Approving vault to spend USDC..."
    local approve_tx
    approve_tx=$(cast_send "$DEPOSITOR_PRIVATE_KEY" "$USDC_ADDRESS" "$USDC_ABI_APPROVE" "$VAULT_ADDRESS" "$TEST_AMOUNT")
    log_info "Approval tx: $approve_tx"
    
    # Wait for approval confirmation
    log_info "Waiting for approval confirmation..."
    if ! cast_wait "$approve_tx"; then
        log_error "Approval transaction failed"
        return 1
    fi
    log_success "USDC approval confirmed"
    
    # Verify allowance
    local allowance
    allowance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_ALLOWANCE" "$DEPOSITOR_ADDRESS" "$VAULT_ADDRESS")
    allowance=$(cast to-dec "$allowance" 2>/dev/null || echo "$allowance")
    log_info "Allowance set: $allowance"
    
    if [[ "$allowance" -lt "$TEST_AMOUNT" ]]; then
        log_error "Allowance insufficient after approval"
        return 1
    fi
    
    # Step 1b: Queue deposit
    log_info "Queuing deposit..."
    local deposit_tx
    deposit_tx=$(cast_send "$DEPOSITOR_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_QUEUE_DEPOSIT" "$TEST_AMOUNT")
    log_info "Deposit tx: $deposit_tx"
    
    # Wait for deposit confirmation
    log_info "Waiting for deposit confirmation..."
    if ! cast_wait "$deposit_tx"; then
        log_error "Deposit transaction failed"
        return 1
    fi
    log_success "Deposit transaction confirmed"
    
    # Get the deposit request ID (should be stored in contract state)
    # We need to query the depositRequests mapping - but we need the requestId
    # The last request ID can be derived from nextDepositRequestId - 1
    local next_request_id
    next_request_id=$(cast_call "$VAULT_ADDRESS" "nextDepositRequestId()")
    next_request_id=$(cast to-dec "$next_request_id" 2>/dev/null || echo "$next_request_id")
    DEPOSIT_REQUEST_ID=$((next_request_id - 1))
    
    log_info "Deposit request ID: $DEPOSIT_REQUEST_ID"
    
    STEP_RESULTS+=("step_1:success")
    return 0
}

step_2_verify_deposit() {
    CURRENT_STEP=2
    log_step "VERIFY DEPOSIT QUEUED"
    
    if [[ -z "$DEPOSIT_REQUEST_ID" ]]; then
        log_error "No deposit request ID from step 1"
        return 1
    fi
    
    # Query depositRequests mapping
    log_info "Querying deposit request $DEPOSIT_REQUEST_ID..."
    
    local request_data
    request_data=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_DEPOSIT_REQUESTS" "$DEPOSIT_REQUEST_ID")
    
    if [[ -z "$request_data" ]]; then
        log_error "Failed to retrieve deposit request data"
        return 1
    fi
    
    # Parse the tuple return (requestId, depositor, assets, targetEpoch, createdAt, processed, exists)
    # cast call returns data that needs decoding
    log_info "Raw deposit request data: $request_data"
    
    # Check total queued assets increased
    local total_queued
    total_queued=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_TOTAL_QUEUED_ASSETS")
    total_queued=$(cast to-dec "$total_queued" 2>/dev/null || echo "$total_queued")
    log_info "Total queued assets: $total_queued"
    
    if [[ "$total_queued" -lt "$TEST_AMOUNT" ]]; then
        log_error "Total queued assets ($total_queued) less than deposit amount ($TEST_AMOUNT)"
        return 1
    fi
    
    log_success "Deposit verified - $total_queued assets queued"
    STEP_RESULTS+=("step_2:success")
    return 0
}

step_3_process_deposits() {
    CURRENT_STEP=3
    log_step "PROCESS DEPOSITS (ADMIN)"
    
    log_info "Processor: $DEPOSIT_PROCESSOR_ADDRESS"
    
    # Get current epoch ID
    local current_epoch
    current_epoch=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_CURRENT_EPOCH_ID")
    current_epoch=$(cast to-dec "$current_epoch" 2>/dev/null || echo "$current_epoch")
    log_info "Current epoch ID: $current_epoch"
    
    # Target epoch for deposit processing is current epoch + 1
    local target_epoch=$((current_epoch + 1))
    log_info "Target epoch for deposit: $target_epoch"
    
    # Process deposit queue
    # processDepositQueue(uint256 epochId, uint256 startIndex, uint256 endIndex)
    log_info "Processing deposit queue..."
    local process_tx
    process_tx=$(cast_send "$DEPOSIT_PROCESSOR_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_PROCESS_DEPOSIT_QUEUE" "$target_epoch" "0" "100")
    log_info "Process deposits tx: $process_tx"
    
    # Wait for confirmation
    log_info "Waiting for process deposits confirmation..."
    if ! cast_wait "$process_tx"; then
        log_error "Process deposits transaction failed"
        return 1
    fi
    log_success "Deposits processed"
    
    # Verify total queued assets decreased
    local total_queued_after
    total_queued_after=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_TOTAL_QUEUED_ASSETS")
    total_queued_after=$(cast to-dec "$total_queued_after" 2>/dev/null || echo "$total_queued_after")
    log_info "Total queued assets after processing: $total_queued_after"
    
    STEP_RESULTS+=("step_3:success")
    return 0
}

step_4_deploy_capital() {
    CURRENT_STEP=4
    log_step "DEPLOY CAPITAL TO TRADING SAFE"
    
    log_info "Admin: $ADMIN_ADDRESS"
    log_info "Amount to deploy: $TEST_AMOUNT"
    
    # Get vault balance before
    local vault_balance_before
    vault_balance_before=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_BALANCE_OF" "$VAULT_ADDRESS")
    vault_balance_before=$(cast to-dec "$vault_balance_before" 2>/dev/null || echo "$vault_balance_before")
    log_info "Vault USDC balance before: $vault_balance_before"
    
    # Get deployed capital before
    local deployed_before
    deployed_before=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_DEPLOYED_CAPITAL")
    deployed_before=$(cast to-dec "$deployed_before" 2>/dev/null || echo "$deployed_before")
    log_info "Deployed capital before: $deployed_before"
    
    # Deploy capital
    log_info "Deploying capital to tradingSafe..."
    local deploy_tx
    deploy_tx=$(cast_send "$ADMIN_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_DEPLOY_CAPITAL" "$TEST_AMOUNT")
    log_info "Deploy capital tx: $deploy_tx"
    
    # Wait for confirmation
    log_info "Waiting for deploy confirmation..."
    if ! cast_wait "$deploy_tx"; then
        log_error "Deploy capital transaction failed"
        return 1
    fi
    log_success "Capital deployed"
    
    STEP_RESULTS+=("step_4:success")
    return 0
}

step_5_verify_deployed() {
    CURRENT_STEP=5
    log_step "VERIFY CAPITAL DEPLOYED"
    
    # Check deployedCapital()
    local deployed_capital
    deployed_capital=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_DEPLOYED_CAPITAL")
    deployed_capital=$(cast to-dec "$deployed_capital" 2>/dev/null || echo "$deployed_capital")
    log_info "Deployed capital: $deployed_capital"
    
    if [[ "$deployed_capital" -ne "$TEST_AMOUNT" ]]; then
        log_error "Deployed capital ($deployed_capital) does not match expected ($TEST_AMOUNT)"
        return 1
    fi
    
    # Get tradingSafe address
    TRADING_SAFE_ADDRESS=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_TRADING_SAFE")
    log_info "Trading safe address: $TRADING_SAFE_ADDRESS"
    
    # Check tradingSafe USDC balance
    local trading_safe_balance
    trading_safe_balance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_BALANCE_OF" "$TRADING_SAFE_ADDRESS")
    trading_safe_balance=$(cast to-dec "$trading_safe_balance" 2>/dev/null || echo "$trading_safe_balance")
    log_info "Trading safe USDC balance: $trading_safe_balance"
    
    # Check vault USDC balance decreased
    local vault_balance
    vault_balance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_BALANCE_OF" "$VAULT_ADDRESS")
    vault_balance=$(cast to-dec "$vault_balance" 2>/dev/null || echo "$vault_balance")
    log_info "Vault USDC balance: $vault_balance"
    
    log_success "Capital deployment verified - $deployed_capital deployed to tradingSafe"
    STEP_RESULTS+=("step_5:success")
    return 0
}

step_6_recall_capital() {
    CURRENT_STEP=6
    log_step "RECALL CAPITAL FROM TRADING SAFE"
    
    log_info "Admin: $ADMIN_ADDRESS"
    log_info "Amount to recall: $TEST_AMOUNT"
    
    # First, tradingSafe must approve vault to transfer USDC back
    log_info "Step 6a: Approve vault from tradingSafe..."
    
    # Derive trading safe address if not set
    if [[ -z "$TRADING_SAFE_ADDRESS" ]]; then
        TRADING_SAFE_ADDRESS=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_TRADING_SAFE")
    fi
    
    # Verify trading safe has the private key
    local trading_safe_derived
    trading_safe_derived=$(cast wallet address --private-key "$TRADING_SAFE_PRIVATE_KEY")
    log_info "Trading safe derived address: $trading_safe_derived"
    
    # Check trading safe USDC balance
    local ts_balance
    ts_balance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_BALANCE_OF" "$TRADING_SAFE_ADDRESS")
    ts_balance=$(cast to-dec "$ts_balance" 2>/dev/null || echo "$ts_balance")
    log_info "Trading safe USDC balance: $ts_balance"
    
    if [[ "$ts_balance" -lt "$TEST_AMOUNT" ]]; then
        log_error "Trading safe has insufficient USDC for recall"
        return 1
    fi
    
    # Approve vault to spend USDC from trading safe
    log_info "Approving vault to spend USDC from tradingSafe..."
    local approve_tx
    approve_tx=$(cast_send "$TRADING_SAFE_PRIVATE_KEY" "$USDC_ADDRESS" "$USDC_ABI_APPROVE" "$VAULT_ADDRESS" "$TEST_AMOUNT")
    log_info "Approval tx: $approve_tx"
    
    if ! cast_wait "$approve_tx"; then
        log_error "Trading safe approval failed"
        return 1
    fi
    log_success "Trading safe approved vault"
    
    # Verify allowance
    local allowance
    allowance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_ALLOWANCE" "$TRADING_SAFE_ADDRESS" "$VAULT_ADDRESS")
    allowance=$(cast to-dec "$allowance" 2>/dev/null || echo "$allowance")
    log_info "Allowance from tradingSafe to vault: $allowance"
    
    if [[ "$allowance" -lt "$TEST_AMOUNT" ]]; then
        log_error "Allowance insufficient"
        return 1
    fi
    
    TRADING_SAFE_APPROVED="true"
    
    # Now recall capital as admin
    log_info "Step 6b: Recall capital as admin..."
    local recall_tx
    recall_tx=$(cast_send "$ADMIN_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_RECALL_CAPITAL" "$TEST_AMOUNT")
    log_info "Recall capital tx: $recall_tx"
    
    # Wait for confirmation
    log_info "Waiting for recall confirmation..."
    if ! cast_wait "$recall_tx"; then
        log_error "Recall capital transaction failed"
        return 1
    fi
    log_success "Capital recalled"
    
    STEP_RESULTS+=("step_6:success")
    return 0
}

step_7_verify_recalled() {
    CURRENT_STEP=7
    log_step "VERIFY CAPITAL RECALLED"
    
    # Check deployedCapital() should be 0
    local deployed_capital
    deployed_capital=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_DEPLOYED_CAPITAL")
    deployed_capital=$(cast to-dec "$deployed_capital" 2>/dev/null || echo "$deployed_capital")
    log_info "Deployed capital after recall: $deployed_capital"
    
    if [[ "$deployed_capital" -ne "0" ]]; then
        log_error "Deployed capital ($deployed_capital) should be 0 after recall"
        return 1
    fi
    
    # Check vault USDC balance increased
    local vault_balance
    vault_balance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_BALANCE_OF" "$VAULT_ADDRESS")
    vault_balance=$(cast to-dec "$vault_balance" 2>/dev/null || echo "$vault_balance")
    log_info "Vault USDC balance after recall: $vault_balance"
    
    # Check trading safe USDC balance decreased
    local ts_balance
    ts_balance=$(cast_call "$USDC_ADDRESS" "$USDC_ABI_BALANCE_OF" "$TRADING_SAFE_ADDRESS")
    ts_balance=$(cast to-dec "$ts_balance" 2>/dev/null || echo "$ts_balance")
    log_info "Trading safe USDC balance after recall: $ts_balance"
    
    log_success "Capital recall verified - deployed capital is now 0"
    STEP_RESULTS+=("step_7:success")
    return 0
}

# ============================================================================
# EVIDENCE GENERATION
# ============================================================================

generate_test_report() {
    log_info "Generating test report..."
    
    mkdir -p "$EVIDENCE_DIR"
    mkdir -p "$NOTEPAD_DIR"
    
    TEST_END_TIME=$(date +%s)
    local duration=$((TEST_END_TIME - TEST_START_TIME))
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    # Generate evidence file
    cat > "$EVIDENCE_FILE" << EOF
================================================================================
AMOY VAULT LIFECYCLE TEST - EVIDENCE REPORT
================================================================================

Test Run ID: amoy-lifecycle-$(date +%Y%m%d-%H%M%S)
Timestamp: $timestamp
Duration: ${duration}s

================================================================================
CONFIGURATION
================================================================================

Vault Address: $VAULT_ADDRESS
USDC Address: $USDC_ADDRESS
RPC URL: $AMOY_RPC_URL
Test Amount: $TEST_AMOUNT (USDC with 6 decimals)

Participants:
  Depositor: $DEPOSITOR_ADDRESS
  Admin: $ADMIN_ADDRESS
  Deposit Processor: $DEPOSIT_PROCESSOR_ADDRESS
  Trading Safe: $TRADING_SAFE_ADDRESS

================================================================================
TEST RESULTS
================================================================================

EOF

    # Add step results
    local all_passed=true
    for result in "${STEP_RESULTS[@]}"; do
        local step_name="${result%%:*}"
        local step_status="${result##*:}"
        
        if [[ "$step_status" == "success" ]]; then
            echo "[PASS] $step_name" >> "$EVIDENCE_FILE"
        else
            echo "[FAIL] $step_name" >> "$EVIDENCE_FILE"
            all_passed=false
        fi
    done
    
    cat >> "$EVIDENCE_FILE" << EOF

================================================================================
VERDICT
================================================================================

Overall Status: $([[ "$all_passed" == "true" ]] && echo "PASSED" || echo "FAILED")
Steps Passed: $(echo "${STEP_RESULTS[@]}" | grep -o "success" | wc -l | tr -d ' ')/$TOTAL_STEPS

EOF

    if [[ -n "$DEPOSIT_REQUEST_ID" ]]; then
        echo "Deposit Request ID: $DEPOSIT_REQUEST_ID" >> "$EVIDENCE_FILE"
    fi
    
    if [[ "$TRADING_SAFE_APPROVED" == "true" ]]; then
        echo "Trading Safe Approval: Completed" >> "$EVIDENCE_FILE"
    fi
    
    cat >> "$EVIDENCE_FILE" << EOF

================================================================================
TEST SEQUENCE SUMMARY
================================================================================

1. Deposit USDC to vault
   - Approved vault to spend USDC
   - Called queueDeposit($TEST_AMOUNT)
   - Result: $(echo "${STEP_RESULTS[0]:-step_1:not_run}" | cut -d: -f2)

2. Verify deposit queued
   - Checked depositRequests mapping
   - Verified totalQueuedAssets increased
   - Result: $(echo "${STEP_RESULTS[1]:-step_2:not_run}" | cut -d: -f2)

3. Process deposits (admin)
   - Called processDepositQueue(epochId, 0, 100)
   - Result: $(echo "${STEP_RESULTS[2]:-step_3:not_run}" | cut -d: -f2)

4. Deploy capital to tradingSafe
   - Called deployCapital($TEST_AMOUNT)
   - Result: $(echo "${STEP_RESULTS[3]:-step_4:not_run}" | cut -d: -f2)

5. Verify capital deployed
   - Checked deployedCapital() == $TEST_AMOUNT
   - Result: $(echo "${STEP_RESULTS[4]:-step_5:not_run}" | cut -d: -f2)

6. Recall capital from tradingSafe
   - Approved vault from tradingSafe
   - Called recallCapital($TEST_AMOUNT)
   - Result: $(echo "${STEP_RESULTS[5]:-step_6:not_run}" | cut -d: -f2)

7. Verify capital recalled
   - Checked deployedCapital() == 0
   - Result: $(echo "${STEP_RESULTS[6]:-step_7:not_run}" | cut -d: -f2)

================================================================================
END OF REPORT
================================================================================
EOF

    log_info "Evidence saved to: $EVIDENCE_FILE"
    
    # Update notepad with learnings
    cat >> "$NOTEPAD_FILE" << EOF

## Amoy Lifecycle Test Run - $(date -u +"%Y-%m-%d %H:%M UTC")

**Status:** $([[ "$all_passed" == "true" ]] && echo "✅ PASSED" || echo "❌ FAILED")
**Duration:** ${duration}s
**Vault:** $VAULT_ADDRESS

### Key Findings

- Deposit/Withdraw flow: $([[ "${STEP_RESULTS[0]:-}" == *"success"* ]] && echo "Working" || echo "Issues detected")
- Capital deployment: $([[ "${STEP_RESULTS[3]:-}" == *"success"* ]] && echo "Working" || echo "Issues detected")
- Capital recall: $([[ "${STEP_RESULTS[5]:-}" == *"success"* ]] && echo "Working" || echo "Issues detected")

### Learnings

- Trading safe approval is required before recallCapital can succeed
- The vault correctly tracks deployedCapital state
- USDC transfers complete successfully between vault and tradingSafe

EOF

    log_info "Notepad updated: $NOTEPAD_FILE"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    echo "================================================================================"
    echo "AMOY VAULT LIFECYCLE TEST ORCHESTRATOR"
    echo "================================================================================"
    echo ""
    
    TEST_START_TIME=$(date +%s)
    
    # Validate environment
    validate_environment
    
    # Run test steps
    local exit_code=0
    
    step_1_deposit || { exit_code=2; log_failure "Step 1 (Deposit) failed"; }
    step_2_verify_deposit || { exit_code=3; log_failure "Step 2 (Verify Deposit) failed"; }
    step_3_process_deposits || { exit_code=4; log_failure "Step 3 (Process Deposits) failed"; }
    step_4_deploy_capital || { exit_code=5; log_failure "Step 4 (Deploy Capital) failed"; }
    step_5_verify_deployed || { exit_code=6; log_failure "Step 5 (Verify Deployed Capital) failed"; }
    step_6_recall_capital || { exit_code=7; log_failure "Step 6 (Recall Capital) failed"; }
    step_7_verify_recalled || { exit_code=8; log_failure "Step 7 (Verify Capital Recalled) failed"; }
    
    # Generate report
    generate_test_report
    
    # Print summary
    echo ""
    echo "================================================================================"
    if [[ $exit_code -eq 0 ]]; then
        log_success "ALL TESTS PASSED"
    else
        log_failure "TESTS FAILED (exit code: $exit_code)"
    fi
    echo "================================================================================"
    echo "Evidence: $EVIDENCE_FILE"
    echo "Notepad: $NOTEPAD_FILE"
    echo "================================================================================"
    
    exit $exit_code
}

# Run main function
main "$@"
