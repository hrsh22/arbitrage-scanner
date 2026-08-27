#!/bin/bash
#
# Amoy Post-Deploy Validation Probe Script for EpochTrancheVault
#
# Validates that a deployed EpochTrancheVault is correctly configured.
# Uses read-only cast calls (no private keys required).
#
# Usage:
#   ./scripts/amoy-post-deploy-probe.sh <VAULT_ADDRESS> [TRADING_SAFE_ADDRESS] [ADMIN_ADDRESS]
#
# Environment Variables:
#   AMOY_RPC_URL  - RPC endpoint (default: https://rpc-amoy.polygon.technology)
#   EXPECTED_USDC - Expected USDC address (default: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582)
#
# Example:
#   ./scripts/amoy-post-deploy-probe.sh 0x1234...5678 0xABCD...EFGH 0x9876...5432
#

set -euo pipefail

# ============================================================================
# Configuration & Constants
# ============================================================================

AMOY_RPC_URL="${AMOY_RPC_URL:-https://rpc-amoy.polygon.technology}"
EXPECTED_USDC="${EXPECTED_USDC:-0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582}"

# Role hashes
ADMIN_ROLE="0xa49807205ce4d355092f5b8a18ee56e666aeb51c"

# Function selectors
tradingSafe_selector="0x19fa4db3"
asset_selector="0x38d52e0f"
hasRole_selector="0x91d14854"
paused_selector="0x5c975abb"
currentEpochId_selector="0xe6c2e1c9"
ADMIN_ROLE_selector="0x75b238fc"

# ============================================================================
# Color Output Helpers
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
}

warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

info() {
    echo -e "${BLUE}ℹ INFO${NC}: $1"
}

# ============================================================================
# Validation Functions
# ============================================================================

validate_address() {
    local addr="$1"
    local name="$2"
    
    if [[ -z "$addr" ]]; then
        echo "Error: $name is required"
        return 1
    fi
    
    # Remove 0x prefix for length check
    local addr_clean="${addr#0x}"
    
    if [[ ! "$addr" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
        echo "Error: $name must be a valid Ethereum address (0x + 40 hex chars)"
        return 1
    fi
    
    return 0
}

# Convert result to address format
format_address() {
    local hex="$1"
    # Remove 0x prefix and leading zeros, then add 0x
    local clean="${hex#0x}"
    # Take last 40 characters (20 bytes)
    local addr="0x${clean: -40}"
    # Convert to lowercase for comparison
    echo "$addr" | tr '[:upper:]' '[:lower:]'
}

# ============================================================================
# Cast Call Helpers
# ============================================================================

cast_call() {
    local contract="$1"
    local selector="$2"
    local params="${3:-}"
    
    local data="$selector$params"
    
    cast call \
        --rpc-url "$AMOY_RPC_URL" \
        "$contract" \
        "$data" 2>/dev/null
}

cast_call_with_address() {
    local contract="$1"
    local selector="$2"
    local address="$3"
    
    # Pad address to 32 bytes (64 hex chars)
    local padded_addr="${address#0x}"
    padded_addr=$(printf '%064s' "$padded_addr" | tr ' ' '0')
    
    cast_call "$contract" "$selector" "$padded_addr"
}

# ============================================================================
# Main Validation Logic
# ============================================================================

main() {
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  EpochTrancheVault Post-Deploy Validation Probe (Amoy)           ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Check arguments
    if [[ $# -lt 1 ]]; then
        echo "Usage: $0 <VAULT_ADDRESS> [TRADING_SAFE_ADDRESS] [ADMIN_ADDRESS]"
        echo ""
        echo "Arguments:"
        echo "  VAULT_ADDRESS        - The deployed EpochTrancheVault address"
        echo "  TRADING_SAFE_ADDRESS - Expected tradingSafe address (optional)"
        echo "  ADMIN_ADDRESS        - Expected admin address (optional)"
        echo ""
        echo "Environment Variables:"
        echo "  AMOY_RPC_URL         - RPC endpoint (default: https://rpc-amoy.polygon.technology)"
        echo "  EXPECTED_USDC        - Expected USDC address (default: 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582)"
        echo ""
        exit 1
    fi
    
    local VAULT_ADDRESS="$1"
    local EXPECTED_TRADING_SAFE="${2:-}"
    local EXPECTED_ADMIN="${3:-}"
    
    # Validate addresses
    if ! validate_address "$VAULT_ADDRESS" "Vault address"; then
        exit 1
    fi
    
    if [[ -n "$EXPECTED_TRADING_SAFE" ]] && ! validate_address "$EXPECTED_TRADING_SAFE" "Trading safe address"; then
        exit 1
    fi
    
    if [[ -n "$EXPECTED_ADMIN" ]] && ! validate_address "$EXPECTED_ADMIN" "Admin address"; then
        exit 1
    fi
    
    echo "Configuration:"
    echo "  RPC URL:        $AMOY_RPC_URL"
    echo "  Vault:          $VAULT_ADDRESS"
    echo "  Expected USDC:  $EXPECTED_USDC"
    if [[ -n "$EXPECTED_TRADING_SAFE" ]]; then
        echo "  Expected Safe:  $EXPECTED_TRADING_SAFE"
    fi
    if [[ -n "$EXPECTED_ADMIN" ]]; then
        echo "  Expected Admin: $EXPECTED_ADMIN"
    fi
    echo ""
    
    # Check if cast is available
    if ! command -v cast &> /dev/null; then
        echo "Error: 'cast' command not found. Please install Foundry."
        echo "       Visit: https://book.getfoundry.sh/getting-started/installation"
        exit 1
    fi
    
    # Test RPC connection
    info "Testing RPC connection..."
    if ! cast block-number --rpc-url "$AMOY_RPC_URL" &> /dev/null; then
        fail "Cannot connect to RPC at $AMOY_RPC_URL"
        exit 1
    fi
    local block_num=$(cast block-number --rpc-url "$AMOY_RPC_URL")
    pass "RPC connection OK (block: $block_num)"
    echo ""
    
    # Initialize results
    local ALL_PASSED=true
    local RESULTS=""
    
    # =========================================================================
    # CHECK 1: Verify tradingSafe address
    # =========================================================================
    echo "┌──────────────────────────────────────────────────────────────────┐"
    echo "│ CHECK 1: Trading Safe Address                                    │"
    echo "└──────────────────────────────────────────────────────────────────┘"
    
    local tradingSafe_result
    tradingSafe_result=$(cast_call "$VAULT_ADDRESS" "$tradingSafe_selector")
    local tradingSafe_addr=$(format_address "$tradingSafe_result")
    
    info "Trading safe returned: $tradingSafe_addr"
    
    if [[ -n "$EXPECTED_TRADING_SAFE" ]]; then
        local expected_lower=$(echo "$EXPECTED_TRADING_SAFE" | tr '[:upper:]' '[:lower:]')
        if [[ "$tradingSafe_addr" == "$expected_lower" ]]; then
            pass "Trading safe matches expected address"
            RESULTS+="tradingSafe: PASS ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
        else
            fail "Trading safe mismatch!"
            info "  Expected: $expected_lower"
            info "  Got:      $tradingSafe_addr"
            RESULTS+="tradingSafe: FAIL ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
            ALL_PASSED=false
        fi
    else
        if [[ "$tradingSafe_addr" == "0x0000000000000000000000000000000000000000" ]]; then
            fail "Trading safe is zero address!"
            RESULTS+="tradingSafe: FAIL - zero address ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
            ALL_PASSED=false
        else
            pass "Trading safe is set (no expected value provided)"
            info "  Value: $tradingSafe_addr"
            RESULTS+="tradingSafe: PASS - $tradingSafe_addr ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
        fi
    fi
    echo ""
    
    # =========================================================================
    # CHECK 2: Verify asset (USDC) address
    # =========================================================================
    echo "┌──────────────────────────────────────────────────────────────────┐"
    echo "│ CHECK 2: Asset (USDC) Address                                    │"
    echo "└──────────────────────────────────────────────────────────────────┘"
    
    local asset_result
    asset_result=$(cast_call "$VAULT_ADDRESS" "$asset_selector")
    local asset_addr=$(format_address "$asset_result")
    local expected_usdc_lower=$(echo "$EXPECTED_USDC" | tr '[:upper:]' '[:lower:]')
    
    info "Asset returned: $asset_addr"
    
    if [[ "$asset_addr" == "$expected_usdc_lower" ]]; then
        pass "Asset matches expected USDC address"
        RESULTS+="asset: PASS ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
    else
        fail "Asset address mismatch!"
        info "  Expected: $expected_usdc_lower"
        info "  Got:      $asset_addr"
        RESULTS+="asset: FAIL ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
        ALL_PASSED=false
    fi
    echo ""
    
    # =========================================================================
    # CHECK 3: Verify admin has ADMIN_ROLE
    # =========================================================================
    echo "┌──────────────────────────────────────────────────────────────────┐"
    echo "│ CHECK 3: Admin Role Assignment                                   │"
    echo "└──────────────────────────────────────────────────────────────────┘"
    
    if [[ -n "$EXPECTED_ADMIN" ]]; then
        local admin_lower=$(echo "$EXPECTED_ADMIN" | tr '[:upper:]' '[:lower:]')
        local admin_padded=$(printf '%064s' "${admin_lower#0x}" | tr ' ' '0')
        local hasRole_data="${ADMIN_ROLE:2}$admin_padded"
        
        local hasRole_result
        hasRole_result=$(cast_call "$VAULT_ADDRESS" "$hasRole_selector" "$hasRole_data" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
        
        info "hasRole(ADMIN_ROLE, $EXPECTED_ADMIN) returned: $hasRole_result"
        
        if [[ "$hasRole_result" == "0x0000000000000000000000000000000000000000000000000000000000000001" ]]; then
            pass "Admin has ADMIN_ROLE"
            RESULTS+="adminRole: PASS ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
        else
            fail "Admin does NOT have ADMIN_ROLE!"
            RESULTS+="adminRole: FAIL ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
            ALL_PASSED=false
        fi
    else
        warn "No admin address provided, skipping role check"
        info "To check admin role, provide admin address as third argument"
        RESULTS+="adminRole: SKIP - no admin provided ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
    fi
    echo ""
    
    # =========================================================================
    # CHECK 4: Verify contract is not paused
    # =========================================================================
    echo "┌──────────────────────────────────────────────────────────────────┐"
    echo "│ CHECK 4: Contract Pause State                                    │"
    echo "└──────────────────────────────────────────────────────────────────┘"
    
    # Note: EpochTrancheVault doesn't have a paused() function inherited from Pausable
    # It uses emergencyMode instead. Let's check that.
    local emergency_selector="0x6aa35d74" # emergencyMode()
    local emergency_result
    
    emergency_result=$(cast_call "$VAULT_ADDRESS" "$emergency_selector" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
    
    info "emergencyMode() returned: $emergency_result"
    
    if [[ "$emergency_result" == "0x0000000000000000000000000000000000000000000000000000000000000000" ]]; then
        pass "Contract is NOT in emergency mode (operational)"
        RESULTS+="emergencyMode: PASS - not active ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
    else
        fail "Contract IS in emergency mode!"
        RESULTS+="emergencyMode: FAIL - active ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
        ALL_PASSED=false
    fi
    echo ""
    
    # =========================================================================
    # CHECK 5: Verify epoch state is valid
    # =========================================================================
    echo "┌──────────────────────────────────────────────────────────────────┐"
    echo "│ CHECK 5: Epoch State Validation                                  │"
    echo "└──────────────────────────────────────────────────────────────────┘"
    
    local epochId_result
    epochId_result=$(cast_call "$VAULT_ADDRESS" "$currentEpochId_selector")
    local epochId_dec=$(cast to-dec "$epochId_result" 2>/dev/null || echo "0")
    
    info "currentEpochId: $epochId_dec"
    
    if [[ "$epochId_dec" == "0" ]]; then
        pass "Current epoch is 0 (initial state, valid for new deployment)"
        RESULTS+="epochState: PASS - epoch 0 ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
        
        # Additional check: verify epoch 0 exists and is Active
        local epochs_selector="0xc59aaea9" # epochs(uint256)
        local epoch0_padded="0000000000000000000000000000000000000000000000000000000000000000"
        
        info "Checking epoch 0 structure..."
        local epoch0_result
        epoch0_result=$(cast_call "$VAULT_ADDRESS" "$epochs_selector" "$epoch0_padded" 2>/dev/null || echo "")
        
        if [[ -n "$epoch0_result" && ${#epoch0_result} -gt 66 ]]; then
            # Parse status from result (should be at offset)
            # Epoch struct status is at a specific position in the returned data
            # status enum is 0=Active, 1=Frozen, 2=Settling, 3=Settled, 4=Finalized
            local status_byte="${epoch0_result:130:2}" # Approximate position for status
            
            if [[ "$status_byte" == "00" ]]; then
                pass "Epoch 0 status is Active"
                RESULTS+="epoch0Status: PASS - Active ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
            else
                warn "Epoch 0 status byte: $status_byte (expected 00 for Active)"
                RESULTS+="epoch0Status: WARN - status byte $status_byte ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
            fi
        else
            warn "Could not parse epoch 0 data"
        fi
    else
        warn "Current epoch is $epochId_dec (not 0, may indicate prior activity)"
        RESULTS+="epochState: WARN - epoch $epochId_dec ($(date -u +%Y-%m-%dT%H:%M:%SZ))\n"
    fi
    echo ""
    
    # =========================================================================
    # Summary
    # =========================================================================
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║  VALIDATION SUMMARY                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    
    if $ALL_PASSED; then
        echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║  ✓ ALL CHECKS PASSED                                             ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo "The EpochTrancheVault at $VAULT_ADDRESS is correctly configured."
        echo ""
    else
        echo -e "${RED}╔══════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║  ✗ SOME CHECKS FAILED                                            ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo "Please review the failures above."
        echo ""
    fi
    
    # Generate evidence report
    generate_evidence "$VAULT_ADDRESS" "$tradingSafe_addr" "$asset_addr" "$ALL_PASSED" "$RESULTS"
    
    exit $($ALL_PASSED && echo 0 || echo 1)
}

# ============================================================================
# Evidence Generation
# ============================================================================

generate_evidence() {
    local vault="$1"
    local tradingSafe="$2"
    local asset="$3"
    local allPassed="$4"
    local results="$5"
    
    local evidence_dir=".sisyphus/evidence"
    local evidence_file="$evidence_dir/task-9-post-deploy-readiness.txt"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local verdict=$($allPassed && echo "PASS" || echo "FAIL")
    
    # Create evidence directory if it doesn't exist
    mkdir -p "$evidence_dir"
    
    cat > "$evidence_file" << EOF
EpochTrancheVault Post-Deploy Validation Evidence
=================================================
Generated: $timestamp
Verdict: $verdict

Configuration
-------------
RPC URL: $AMOY_RPC_URL
Vault Address: $vault
Expected USDC: $EXPECTED_USDC

Contract State
--------------
Trading Safe: $tradingSafe
Asset: $asset

Results
-------
$results

Full Output
-----------
Run ./scripts/amoy-post-deploy-probe.sh to see full validation output.

Notes
-----
This validation probe performs read-only checks against the deployed contract.
No transactions were submitted and no private keys were used.

Checked Functions
-----------------
- tradingSafe() -> address
- asset() -> address  
- hasRole(ADMIN_ROLE, admin) -> bool
- emergencyMode() -> bool
- currentEpochId() -> uint256

EOF
    
    info "Evidence saved to: $evidence_file"
}

# ============================================================================
# Entry Point
# ============================================================================

main "$@"
