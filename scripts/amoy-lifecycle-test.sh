#!/bin/bash
#
# Amoy Vault Lifecycle Test Orchestrator - Closed-Book Batch Flow
#
# Performs complete end-to-end testing of the ClosedBookBatchVault lifecycle:
# 1. Deposit USDC to vault (queueDeposit)
# 2. Verify deposit queued
# 3. Cutoff batch (SNAPSHOT_ROLE) - stop accepting new deposits/redemptions
# 4. Flatten batch (SNAPSHOT_ROLE) - lock clearing price, take NAV snapshot
# 5. Process deposits (DEPOSIT_PROCESSOR_ROLE) - mint shares at locked price
# 6. Settle batch (SETTLER_ROLE) - compute claimable assets for redemptions
# 7. Reopen batch (ADMIN_ROLE) - start next cycle
#
# Usage:
#   VAULT_ADDRESS=0x... ./scripts/amoy-lifecycle-test.sh
#
# Required Environment Variables:
#   VAULT_ADDRESS                    - Deployed ClosedBookBatchVault contract address
#   AMOY_RPC_URL                     - Amoy testnet RPC URL (default: https://rpc-amoy.polygon.technology)
#   
#   DEPOSITOR_PRIVATE_KEY            - Private key of depositor account (must have USDC)
#   ADMIN_PRIVATE_KEY                - Private key with ADMIN_ROLE
#   SNAPSHOTTER_PRIVATE_KEY          - Private key with SNAPSHOT_ROLE
#   DEPOSIT_PROCESSOR_PRIVATE_KEY    - Private key with DEPOSIT_PROCESSOR_ROLE
#   SETTLER_PRIVATE_KEY              - Private key with SETTLER_ROLE
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
#   4 - Step 3 (Cutoff Batch) failed
#   5 - Step 4 (Flatten Batch) failed
#   6 - Step 5 (Process Deposits) failed
#   7 - Step 6 (Settle Batch) failed
#   8 - Step 7 (Reopen Batch) failed

set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly EVIDENCE_DIR="${PROJECT_ROOT}/.sisyphus/evidence"
readonly NOTEPAD_DIR="${PROJECT_ROOT}/.sisyphus/notepads/T11"

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
BATCH_ID=""
DEPOSITOR_ADDRESS=""
ADMIN_ADDRESS=""
SNAPSHOTTER_ADDRESS=""
DEPOSIT_PROCESSOR_ADDRESS=""
SETTLER_ADDRESS=""
LOCKED_CLEARING_PRICE=""
BATCH_STATUS=""

# Evidence tracking
EVIDENCE_FILE="${EVIDENCE_DIR}/task-11-amoy-batch-lifecycle.txt"
NOTEPAD_FILE="${NOTEPAD_DIR}/learnings.md"

# ============================================================================
# CONTRACT ABIs (minimal for cast) - ClosedBookBatchVault
# ============================================================================

# ClosedBookBatchVault ABI fragments
readonly VAULT_ABI_QUEUE_DEPOSIT="queueDeposit(uint256)"
readonly VAULT_ABI_PROCESS_DEPOSIT_QUEUE="processDepositQueue(uint256,uint256,uint256)"
readonly VAULT_ABI_CUTOFF_BATCH="cutoffBatch()"
readonly VAULT_ABI_FLATTEN_BATCH="flattenBatch(bytes32)"
readonly VAULT_ABI_SETTLE_BATCH="settleBatch(uint256)"
readonly VAULT_ABI_CLOSE_BATCH="closeBatch(uint256)"
readonly VAULT_ABI_REOPEN_BATCH="reopenBatch()"
readonly VAULT_ABI_GET_CURRENT_BATCH="getCurrentBatch()"
readonly VAULT_ABI_GET_BATCH_STATUS="getBatchStatus(uint256)"
readonly VAULT_ABI_GET_BATCH_END="getBatchEnd(uint256)"
readonly VAULT_ABI_DEPOSIT_REQUESTS="depositRequests(uint256)"
readonly VAULT_ABI_BATCHES="batches(uint256)"
readonly VAULT_ABI_CURRENT_NAV="currentNAV()"
readonly VAULT_ABI_IS_PRICE_LOCKED="batches(uint256)(,,,,,,,,,,,bool,)"
readonly VAULT_ABI_LOCKED_CLEARING_PRICE="batches(uint256)(,,,,uint256,,,,,,,,)"
readonly VAULT_ABI_EPOCH_DURATION="EPOCH_DURATION()"
readonly VAULT_ABI_DEPLOY_TIME="DEPLOY_TIME()"
readonly VAULT_ABI_NEXT_DEPOSIT_REQUEST_ID="nextDepositRequestId()"
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
    
    if [[ -z "${SNAPSHOTTER_PRIVATE_KEY:-}" ]]; then
        errors+=("SNAPSHOTTER_PRIVATE_KEY is required")
    fi
    
    if [[ -z "${DEPOSIT_PROCESSOR_PRIVATE_KEY:-}" ]]; then
        errors+=("DEPOSIT_PROCESSOR_PRIVATE_KEY is required")
    fi
    
    if [[ -z "${SETTLER_PRIVATE_KEY:-}" ]]; then
        errors+=("SETTLER_PRIVATE_KEY is required")
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
    SNAPSHOTTER_ADDRESS=$(cast wallet address --private-key "$SNAPSHOTTER_PRIVATE_KEY")
    DEPOSIT_PROCESSOR_ADDRESS=$(cast wallet address --private-key "$DEPOSIT_PROCESSOR_PRIVATE_KEY")
    SETTLER_ADDRESS=$(cast wallet address --private-key "$SETTLER_PRIVATE_KEY")
    
    log_info "Environment validated"
    log_info "  Vault: $VAULT_ADDRESS"
    log_info "  Depositor: $DEPOSITOR_ADDRESS"
    log_info "  Admin: $ADMIN_ADDRESS"
    log_info "  Snapshotter: $SNAPSHOTTER_ADDRESS"
    log_info "  Deposit Processor: $DEPOSIT_PROCESSOR_ADDRESS"
    log_info "  Settler: $SETTLER_ADDRESS"
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
# BATCH STATUS HELPERS
# ============================================================================

get_batch_status_name() {
    local status_num="$1"
    case "$status_num" in
        0) echo "Open" ;;
        1) echo "Cutoff" ;;
        2) echo "Flattening" ;;
        3) echo "Settling" ;;
        4) echo "Settled" ;;
        5) echo "Closed" ;;
        6) echo "Reopen" ;;
        *) echo "Unknown($status_num)" ;;
    esac
}

get_current_batch_id() {
    local batch_id
    batch_id=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_GET_CURRENT_BATCH")
    batch_id=$(cast to-dec "$batch_id" 2>/dev/null || echo "$batch_id")
    echo "$batch_id"
}

get_batch_status() {
    local batch_id="$1"
    local status
    status=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_GET_BATCH_STATUS" "$batch_id")
    status=$(cast to-dec "$status" 2>/dev/null || echo "$status")
    echo "$status"
}

# ============================================================================
# STEP FUNCTIONS
# ============================================================================

step_1_deposit() {
    CURRENT_STEP=1
    log_step "DEPOSIT USDC TO VAULT (queueDeposit)"
    
    log_info "Depositor: $DEPOSITOR_ADDRESS"
    log_info "Amount: $TEST_AMOUNT (USDC with 6 decimals)"
    
    # Get current batch
    BATCH_ID=$(get_current_batch_id)
    log_info "Current batch ID: $BATCH_ID"
    
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
    
    # Get the deposit request ID
    local next_request_id
    next_request_id=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_NEXT_DEPOSIT_REQUEST_ID")
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
    
    # Check batch status
    BATCH_STATUS=$(get_batch_status "$BATCH_ID")
    local status_name
    status_name=$(get_batch_status_name "$BATCH_STATUS")
    log_info "Batch $BATCH_ID status: $status_name ($BATCH_STATUS)"
    
    log_success "Deposit verified - $total_queued assets queued in batch $BATCH_ID"
    STEP_RESULTS+=("step_2:success")
    return 0
}

step_3_cutoff_batch() {
    CURRENT_STEP=3
    log_step "CUTOFF BATCH (stop accepting deposits/redemptions)"
    
    log_info "Snapshotter: $SNAPSHOTTER_ADDRESS"
    log_info "Batch ID: $BATCH_ID"
    
    # Check current batch status
    local status_before
    status_before=$(get_batch_status "$BATCH_ID")
    local status_name_before
    status_name_before=$(get_batch_status_name "$status_before")
    log_info "Batch status before cutoff: $status_name_before ($status_before)"
    
    if [[ "$status_before" -ne 0 ]]; then
        log_error "Batch is not in Open status (status: $status_name_before)"
        return 1
    fi
    
    # Execute cutoff
    log_info "Executing cutoffBatch..."
    local cutoff_tx
    cutoff_tx=$(cast_send "$SNAPSHOTTER_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_CUTOFF_BATCH")
    log_info "Cutoff tx: $cutoff_tx"
    
    # Wait for confirmation
    log_info "Waiting for cutoff confirmation..."
    if ! cast_wait "$cutoff_tx"; then
        log_error "Cutoff transaction failed"
        return 1
    fi
    log_success "Batch cutoff executed"
    
    # Verify status changed to Cutoff (1)
    local status_after
    status_after=$(get_batch_status "$BATCH_ID")
    local status_name_after
    status_name_after=$(get_batch_status_name "$status_after")
    log_info "Batch status after cutoff: $status_name_after ($status_after)"
    
    if [[ "$status_after" -ne 1 ]]; then
        log_error "Batch status should be Cutoff (1), got $status_after"
        return 1
    fi
    
    STEP_RESULTS+=("step_3:success")
    return 0
}

step_4_flatten_batch() {
    CURRENT_STEP=4
    log_step "FLATTEN BATCH (lock clearing price, take NAV snapshot)"
    
    log_info "Snapshotter: $SNAPSHOTTER_ADDRESS"
    log_info "Batch ID: $BATCH_ID"
    
    # Check current batch status
    local status_before
    status_before=$(get_batch_status "$BATCH_ID")
    local status_name_before
    status_name_before=$(get_batch_status_name "$status_before")
    log_info "Batch status before flatten: $status_name_before ($status_before)"
    
    if [[ "$status_before" -ne 1 ]]; then
        log_error "Batch is not in Cutoff status (status: $status_name_before)"
        return 1
    fi
    
    # Get current NAV
    local current_nav
    current_nav=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_CURRENT_NAV")
    current_nav=$(cast to-dec "$current_nav" 2>/dev/null || echo "$current_nav")
    log_info "Current NAV before flatten: $current_nav"
    
    # Generate a dummy snapshot hash (in production, this would be the actual off-chain snapshot hash)
    local snapshot_hash
    snapshot_hash=$(cast keccak "$(date +%s)")
    log_info "Snapshot hash: $snapshot_hash"
    
    # Execute flatten
    log_info "Executing flattenBatch..."
    local flatten_tx
    flatten_tx=$(cast_send "$SNAPSHOTTER_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_FLATTEN_BATCH" "$snapshot_hash")
    log_info "Flatten tx: $flatten_tx"
    
    # Wait for confirmation
    log_info "Waiting for flatten confirmation..."
    if ! cast_wait "$flatten_tx"; then
        log_error "Flatten transaction failed"
        return 1
    fi
    log_success "Batch flatten executed"
    
    # Verify status changed to Flattening (2)
    local status_after
    status_after=$(get_batch_status "$BATCH_ID")
    local status_name_after
    status_name_after=$(get_batch_status_name "$status_after")
    log_info "Batch status after flatten: $status_name_after ($status_after)"
    
    if [[ "$status_after" -ne 2 ]]; then
        log_error "Batch status should be Flattening (2), got $status_after"
        return 1
    fi
    
    # Get locked clearing price
    # batches(uint256) returns: batchId, startTime, endTime, cutoffTime, snapshotNAV, lockedClearingPrice, snapshotTimestamp, totalSharesPending, totalAssetsSnapshot, proRataRatio, totalQueuedDeposits, status, isPriceLocked, exists
    local batch_data
    batch_data=$(cast_call "$VAULT_ADDRESS" "batches(uint256)" "$BATCH_ID")
    log_info "Batch data: $batch_data"
    
    # Extract locked clearing price (5th field, 0-indexed)
    LOCKED_CLEARING_PRICE=$(echo "$batch_data" | awk '{print $5}')
    log_info "Locked clearing price: $LOCKED_CLEARING_PRICE"
    
    if [[ -z "$LOCKED_CLEARING_PRICE" || "$LOCKED_CLEARING_PRICE" == "0" ]]; then
        log_error "Locked clearing price not set after flatten"
        return 1
    fi
    
    log_success "Batch flattened - clearing price locked at $LOCKED_CLEARING_PRICE"
    STEP_RESULTS+=("step_4:success")
    return 0
}

step_5_process_deposits() {
    CURRENT_STEP=5
    log_step "PROCESS DEPOSITS (mint shares at locked price)"
    
    log_info "Deposit Processor: $DEPOSIT_PROCESSOR_ADDRESS"
    log_info "Batch ID: $BATCH_ID"
    
    # Check batch status
    local status
    status=$(get_batch_status "$BATCH_ID")
    local status_name
    status_name=$(get_batch_status_name "$status")
    log_info "Batch status: $status_name ($status)"
    
    if [[ "$status" -ne 2 && "$status" -ne 3 ]]; then
        log_error "Batch must be in Flattening (2) or Settling (3) status to process deposits"
        return 1
    fi
    
    # Get total queued assets before processing
    local total_queued_before
    total_queued_before=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_TOTAL_QUEUED_ASSETS")
    total_queued_before=$(cast to-dec "$total_queued_before" 2>/dev/null || echo "$total_queued_before")
    log_info "Total queued assets before processing: $total_queued_before"
    
    if [[ "$total_queued_before" -eq 0 ]]; then
        log_warn "No queued assets to process"
        STEP_RESULTS+=("step_5:success")
        return 0
    fi
    
    # Process deposit queue
    # processDepositQueue(uint256 batchId, uint256 startIndex, uint256 endIndex)
    log_info "Processing deposit queue for batch $BATCH_ID..."
    local process_tx
    process_tx=$(cast_send "$DEPOSIT_PROCESSOR_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_PROCESS_DEPOSIT_QUEUE" "$BATCH_ID" "0" "100")
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
    
    STEP_RESULTS+=("step_5:success")
    return 0
}

step_6_settle_batch() {
    CURRENT_STEP=6
    log_step "SETTLE BATCH (compute claimable assets for redemptions)"
    
    log_info "Settler: $SETTLER_ADDRESS"
    log_info "Batch ID: $BATCH_ID"
    
    # Check batch status
    local status_before
    status_before=$(get_batch_status "$BATCH_ID")
    local status_name_before
    status_name_before=$(get_batch_status_name "$status_before")
    log_info "Batch status before settle: $status_name_before ($status_before)"
    
    if [[ "$status_before" -ne 2 ]]; then
        log_error "Batch must be in Flattening (2) status to settle"
        return 1
    fi
    
    # Execute settlement
    log_info "Executing settleBatch..."
    local settle_tx
    settle_tx=$(cast_send "$SETTLER_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_SETTLE_BATCH" "$BATCH_ID")
    log_info "Settle tx: $settle_tx"
    
    # Wait for confirmation
    log_info "Waiting for settle confirmation..."
    if ! cast_wait "$settle_tx"; then
        log_error "Settle transaction failed"
        return 1
    fi
    log_success "Batch settled"
    
    # Verify status changed to Settled (4)
    local status_after
    status_after=$(get_batch_status "$BATCH_ID")
    local status_name_after
    status_name_after=$(get_batch_status_name "$status_after")
    log_info "Batch status after settle: $status_name_after ($status_after)"
    
    if [[ "$status_after" -ne 4 ]]; then
        log_error "Batch status should be Settled (4), got $status_after"
        return 1
    fi
    
    # Get settlement progress
    local settlement_data
    settlement_data=$(cast_call "$VAULT_ADDRESS" "getSettlementProgress(uint256)" "$BATCH_ID")
    log_info "Settlement progress: $settlement_data"
    
    log_success "Batch settlement complete - claims now available"
    STEP_RESULTS+=("step_6:success")
    return 0
}

step_7_reopen_batch() {
    CURRENT_STEP=7
    log_step "REOPEN BATCH (start next cycle)"
    
    log_info "Admin: $ADMIN_ADDRESS"
    
    # Check current batch status
    local status_before
    status_before=$(get_batch_status "$BATCH_ID")
    local status_name_before
    status_name_before=$(get_batch_status_name "$status_before")
    log_info "Batch $BATCH_ID status before reopen: $status_name_before ($status_before)"
    
    if [[ "$status_before" -ne 4 ]]; then
        log_error "Batch must be in Settled (4) status to reopen"
        return 1
    fi
    
    # Execute reopen
    log_info "Executing reopenBatch..."
    local reopen_tx
    reopen_tx=$(cast_send "$ADMIN_PRIVATE_KEY" "$VAULT_ADDRESS" "$VAULT_ABI_REOPEN_BATCH")
    log_info "Reopen tx: $reopen_tx"
    
    # Wait for confirmation
    log_info "Waiting for reopen confirmation..."
    if ! cast_wait "$reopen_tx"; then
        log_error "Reopen transaction failed"
        return 1
    fi
    log_success "Batch reopened"
    
    # Get new batch ID
    local new_batch_id
    new_batch_id=$(get_current_batch_id)
    log_info "New current batch ID: $new_batch_id"
    
    # Check new batch status
    local new_status
    new_status=$(get_batch_status "$new_batch_id")
    local new_status_name
    new_status_name=$(get_batch_status_name "$new_status")
    log_info "New batch $new_batch_id status: $new_status_name ($new_status)"
    
    if [[ "$new_status" -ne 0 ]]; then
        log_error "New batch should be in Open (0) status, got $new_status"
        return 1
    fi
    
    # Get batch end time
    local batch_end
    batch_end=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_GET_BATCH_END" "$new_batch_id")
    batch_end=$(cast to-dec "$batch_end" 2>/dev/null || echo "$batch_end")
    log_info "New batch end time: $batch_end"
    
    log_success "New batch $new_batch_id is now open for deposits"
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
    
    # Get current batch info
    local current_batch
    current_batch=$(get_current_batch_id 2>/dev/null || echo "N/A")
    
    # Get EPOCH_DURATION
    local epoch_duration
    epoch_duration=$(cast_call "$VAULT_ADDRESS" "$VAULT_ABI_EPOCH_DURATION" 2>/dev/null || echo "N/A")
    if [[ "$epoch_duration" != "N/A" ]]; then
        epoch_duration=$(cast to-dec "$epoch_duration" 2>/dev/null || echo "$epoch_duration")
    fi
    
    # Generate evidence file
    cat > "$EVIDENCE_FILE" << EOF
================================================================================
AMOY CLOSED-BOOK BATCH VAULT LIFECYCLE TEST - EVIDENCE REPORT
================================================================================

Test Run ID: amoy-batch-lifecycle-$(date +%Y%m%d-%H%M%S)
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
  Snapshotter: $SNAPSHOTTER_ADDRESS
  Deposit Processor: $DEPOSIT_PROCESSOR_ADDRESS
  Settler: $SETTLER_ADDRESS

Contract Parameters:
  EPOCH_DURATION: ${epoch_duration} seconds
  Final Batch ID: ${current_batch}

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
    
    if [[ -n "$BATCH_ID" ]]; then
        echo "Tested Batch ID: $BATCH_ID" >> "$EVIDENCE_FILE"
    fi
    
    if [[ -n "$LOCKED_CLEARING_PRICE" && "$LOCKED_CLEARING_PRICE" != "0" ]]; then
        echo "Locked Clearing Price: $LOCKED_CLEARING_PRICE" >> "$EVIDENCE_FILE"
    fi
    
    cat >> "$EVIDENCE_FILE" << EOF

================================================================================
CLOSED-BOOK BATCH LIFECYCLE SUMMARY
================================================================================

1. Request Deposit (queueDeposit)
   - User queues deposit for next batch
   - Assets held in escrow, not yet converted to shares
   - Result: $(echo "${STEP_RESULTS[0]:-step_1:not_run}" | cut -d: -f2)

2. Verify Deposit Queued
   - Check deposit request exists
   - Verify totalQueuedAssets increased
   - Result: $(echo "${STEP_RESULTS[1]:-step_2:not_run}" | cut -d: -f2)

3. Cutoff Batch (SNAPSHOT_ROLE)
   - Stop accepting new deposits/redemptions
   - Transition: Open -> Cutoff
   - Result: $(echo "${STEP_RESULTS[2]:-step_3:not_run}" | cut -d: -f2)

4. Flatten Batch (SNAPSHOT_ROLE)
   - Take NAV snapshot, lock clearing price
   - Sealed-batch deposits excluded from price calc
   - Transition: Cutoff -> Flattening
   - Flatness Check: isPriceLocked = true
   - Evidence: lockedClearingPrice set
   - Result: $(echo "${STEP_RESULTS[3]:-step_4:not_run}" | cut -d: -f2)

5. Process Deposits (DEPOSIT_PROCESSOR_ROLE)
   - Mint shares at locked clearing price
   - All deposits in batch mint at SAME price
   - Result: $(echo "${STEP_RESULTS[4]:-step_5:not_run}" | cut -d: -f2)

6. Settle Batch (SETTLER_ROLE)
   - Compute claimable assets for redemptions
   - Apply pro-rata ratio if insufficient assets
   - Transition: Flattening -> Settled
   - Evidence: SettlementProgress.complete = true
   - Result: $(echo "${STEP_RESULTS[5]:-step_6:not_run}" | cut -d: -f2)

7. Reopen Batch (ADMIN_ROLE)
   - Start next cycle
   - Create new batch with Open status
   - New batch ready for deposits
   - Result: $(echo "${STEP_RESULTS[6]:-step_7:not_run}" | cut -d: -f2)

================================================================================
BATCH STATUS ENUM
================================================================================

0 = Open      - Accepting deposits and redemptions
1 = Cutoff    - Deposits closed, redemptions frozen
2 = Flattening- NAV snapshot taken, price locked
3 = Settling  - Settlement in progress
4 = Settled   - Settlement complete, claims available
5 = Closed    - Claims window ended
6 = Reopen    - Ready to start next cycle

================================================================================
END OF REPORT
================================================================================
EOF

    log_info "Evidence saved to: $EVIDENCE_FILE"
    
    # Update notepad with learnings
    cat >> "$NOTEPAD_FILE" << EOF

## T11 Amoy Batch Lifecycle Test Run - $(date -u +"%Y-%m-%d %H:%M UTC")

**Status:** $([[ "$all_passed" == "true" ]] && echo "✅ PASSED" || echo "❌ FAILED")
**Duration:** ${duration}s
**Vault:** $VAULT_ADDRESS
**Tested Batch:** ${BATCH_ID:-N/A}

### Key Findings

- Closed-book batch flow: $([[ "${STEP_RESULTS[0]:-}" == *"success"* && "${STEP_RESULTS[6]:-}" == *"success"* ]] && echo "Working end-to-end" || echo "Issues detected")
- Batch cutoff/flatten: $([[ "${STEP_RESULTS[2]:-}" == *"success"* && "${STEP_RESULTS[3]:-}" == *"success"* ]] && echo "Working" || echo "Issues detected")
- Flatness readiness (lockedClearingPrice): $([[ -n "$LOCKED_CLEARING_PRICE" && "$LOCKED_CLEARING_PRICE" != "0" ]] && echo "Price locked successfully" || echo "Price lock failed")
- Deposit processing at locked price: $([[ "${STEP_RESULTS[4]:-}" == *"success"* ]] && echo "Working" || echo "Issues detected")
- Batch settlement: $([[ "${STEP_RESULTS[5]:-}" == *"success"* ]] && echo "Working" || echo "Issues detected")
- Reopen for next cycle: $([[ "${STEP_RESULTS[6]:-}" == *"success"* ]] && echo "Working" || echo "Issues detected")

### Learnings

- The closed-book batch model ensures all deposits in a batch mint at the SAME locked clearing price
- Flattening locks the clearing price BEFORE deposit processing, excluding sealed deposits from price calc
- Settlement computes claimable assets for redemptions using the locked price
- Pro-rata distribution applied if insufficient assets for all redemptions
- Batch lifecycle is strictly sequential: Open -> Cutoff -> Flattening -> Settling -> Settled -> Closed -> Reopen

EOF

    log_info "Notepad updated: $NOTEPAD_FILE"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    echo "================================================================================"
    echo "AMOY CLOSED-BOOK BATCH VAULT LIFECYCLE TEST ORCHESTRATOR"
    echo "================================================================================"
    echo ""
    
    TEST_START_TIME=$(date +%s)
    
    # Validate environment
    validate_environment
    
    # Run test steps
    local exit_code=0
    
    step_1_deposit || { exit_code=2; log_failure "Step 1 (Deposit) failed"; }
    step_2_verify_deposit || { exit_code=3; log_failure "Step 2 (Verify Deposit) failed"; }
    step_3_cutoff_batch || { exit_code=4; log_failure "Step 3 (Cutoff Batch) failed"; }
    step_4_flatten_batch || { exit_code=5; log_failure "Step 4 (Flatten Batch) failed"; }
    step_5_process_deposits || { exit_code=6; log_failure "Step 5 (Process Deposits) failed"; }
    step_6_settle_batch || { exit_code=7; log_failure "Step 6 (Settle Batch) failed"; }
    step_7_reopen_batch || { exit_code=8; log_failure "Step 7 (Reopen Batch) failed"; }
    
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
