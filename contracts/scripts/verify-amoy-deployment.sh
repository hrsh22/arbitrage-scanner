#!/bin/bash
#================================================================================
# verify-amoy-deployment.sh
# On-chain verification for EpochTrancheVault Amoy deployment
# Target: 0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D
#================================================================================

set -e

# Configuration
VAULT_ADDRESS="0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D"
INVALID_ADDRESS="0x7EF2e0048f5bAeDe046f6BF797943daF4ED8CB47"
RPC_URL="${AMOY_RPC_URL:-https://rpc-amoy.polygon.technology}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "AMOY DEPLOYMENT VERIFICATION - Task 7"
echo "================================================================================"
echo ""
echo "Valid Deployment: $VAULT_ADDRESS"
echo "Invalid Address:  $INVALID_ADDRESS"
echo "RPC: $RPC_URL"
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# Helper functions
print_status() {
  if [ "$2" == "pass" ]; then
    echo -e "  ${GREEN}✅ $1${NC}"
  elif [ "$2" == "fail" ]; then
    echo -e "  ${RED}❌ $1${NC}"
  elif [ "$2" == "info" ]; then
    echo -e "  ${BLUE}ℹ️  $1${NC}"
  else
    echo -e "  ${YELLOW}⚠️  $1${NC}"
  fi
}

echo "================================================================================"
echo "BYTECODE VERIFICATION"
echo "================================================================================"
echo ""

# Get deployed bytecode
DEPLOYED_BYTECODE=$(cast code $VAULT_ADDRESS --rpc-url $RPC_URL 2>/dev/null || echo "0x")
BYTECODE_SIZE=${#DEPLOYED_BYTECODE}
BYTECODE_SIZE_BYTES=$((BYTECODE_SIZE / 2 - 1))

echo "Deployed Bytecode Size: $BYTECODE_SIZE_BYTES bytes"
if [ $BYTECODE_SIZE_BYTES -gt 0 ]; then
  print_status "Contract deployed at address" "pass"
else
  print_status "No bytecode found at address" "fail"
fi

# Check if it's an EOA or contract
if [ "$DEPLOYED_BYTECODE" == "0x" ] || [ ${#DEPLOYED_BYTECODE} -le 2 ]; then
  print_status "Address is EOA (no contract code)" "fail"
else
  print_status "Address contains contract bytecode" "pass"
fi

echo ""
echo "================================================================================"
echo "CONTRACT IDENTITY"
echo "================================================================================"
echo ""

# Check name
NAME=$(cast call $VAULT_ADDRESS "name()(string)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$NAME" != "ERROR" ]; then
  print_status "Name: $NAME" "pass"
else
  print_status "Failed to read name" "fail"
fi

# Check symbol
SYMBOL=$(cast call $VAULT_ADDRESS "symbol()(string)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$SYMBOL" != "ERROR" ]; then
  print_status "Symbol: $SYMBOL" "pass"
else
  print_status "Failed to read symbol" "fail"
fi

# Check decimals
DECIMALS=$(cast call $VAULT_ADDRESS "decimals()(uint8)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$DECIMALS" != "ERROR" ]; then
  print_status "Decimals: $DECIMALS" "pass"
else
  print_status "Failed to read decimals" "fail"
fi

# Check asset
ASSET=$(cast call $VAULT_ADDRESS "asset()(address)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$ASSET" != "ERROR" ]; then
  print_status "Asset: $ASSET" "pass"
  
  # Get asset symbol
  ASSET_SYMBOL=$(cast call $ASSET "symbol()(string)" --rpc-url $RPC_URL 2>/dev/null || echo "unknown")
  print_status "Asset Symbol: $ASSET_SYMBOL" "info"
else
  print_status "Failed to read asset" "fail"
fi

echo ""
echo "================================================================================"
echo "EPOCH CONFIGURATION"
echo "================================================================================"
echo ""

# Check epoch duration
EPOCH_DURATION=$(cast call $VAULT_ADDRESS "epochDuration()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$EPOCH_DURATION" != "ERROR" ]; then
  EPOCH_DURATION_HOURS=$((EPOCH_DURATION / 3600))
  print_status "Epoch Duration: $EPOCH_DURATION seconds ($EPOCH_DURATION_HOURS hours)" "pass"
else
  print_status "Failed to read epoch duration" "fail"
fi

# Check genesis timestamp
GENESIS=$(cast call $VAULT_ADDRESS "genesisTimestamp()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$GENESIS" != "ERROR" ]; then
  GENESIS_DATE=$(date -r $GENESIS 2>/dev/null || date -d @$GENESIS 2>/dev/null || echo "unknown")
  print_status "Genesis Timestamp: $GENESIS" "pass"
  print_status "Genesis Date: $GENESIS_DATE" "info"
else
  print_status "Failed to read genesis timestamp" "fail"
fi

# Check current epoch
CURRENT_EPOCH=$(cast call $VAULT_ADDRESS "getCurrentEpoch()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$CURRENT_EPOCH" != "ERROR" ]; then
  print_status "Current Epoch: $CURRENT_EPOCH" "pass"
else
  print_status "Failed to read current epoch (may be before genesis)" "warn"
fi

echo ""
echo "================================================================================"
echo "ACCESS CONTROL / ROLES"
echo "================================================================================"
echo ""

# Define role hashes
DEFAULT_ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
OPERATOR_ROLE=$(cast keccak "OPERATOR_ROLE" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")

# Check if contract has getRoleAdmin function
HAS_ACCESS_CONTROL=$(cast call $VAULT_ADDRESS "getRoleAdmin(bytes32)(bytes32)" $DEFAULT_ADMIN_ROLE --rpc-url $RPC_URL 2>/dev/null && echo "yes" || echo "no")

if [ "$HAS_ACCESS_CONTROL" == "yes" ]; then
  print_status "AccessControl interface supported" "pass"
else
  print_status "AccessControl may not be supported or role doesn't exist" "warn"
fi

echo ""
echo "================================================================================"
echo "INTERFACE SUPPORT"
echo "================================================================================"
echo ""

# ERC165 interface ID for IERC165
IERC165_ID="0x01ffc9a7"

# Check supportsInterface for IERC165
SUPPORTS_IERC165=$(cast call $VAULT_ADDRESS "supportsInterface(bytes4)(bool)" $IERC165_ID --rpc-url $RPC_URL 2>/dev/null || echo "false")
if [ "$SUPPORTS_IERC165" == "true" ]; then
  print_status "ERC165 interface supported" "pass"
else
  print_status "ERC165 interface not detected" "warn"
fi

# ERC4626 interface ID
ERC4626_ID="0x2f0a18b5"
SUPPORTS_ERC4626=$(cast call $VAULT_ADDRESS "supportsInterface(bytes4)(bool)" $ERC4626_ID --rpc-url $RPC_URL 2>/dev/null || echo "false")
if [ "$SUPPORTS_ERC4626" == "true" ]; then
  print_status "ERC4626 interface supported" "pass"
else
  print_status "ERC4626 interface not detected via ERC165" "info"
fi

# ERC7540 interfaces
ERC7540_REDEEM_ID="0x2ba7e2f5"
SUPPORTS_ERC7540_REDEEM=$(cast call $VAULT_ADDRESS "supportsInterface(bytes4)(bool)" $ERC7540_REDEEM_ID --rpc-url $RPC_URL 2>/dev/null || echo "false")
if [ "$SUPPORTS_ERC7540_REDEEM" == "true" ]; then
  print_status "ERC7540 redeem interface supported" "pass"
else
  print_status "ERC7540 redeem interface not detected" "info"
fi

echo ""
echo "================================================================================"
echo "STATE VERIFICATION"
echo "================================================================================"
echo ""

# Check total supply
TOTAL_SUPPLY=$(cast call $VAULT_ADDRESS "totalSupply()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$TOTAL_SUPPLY" != "ERROR" ]; then
  TOTAL_SUPPLY_FMT=$(cast from-wei $TOTAL_SUPPLY 2>/dev/null || echo $TOTAL_SUPPLY)
  print_status "Total Supply: $TOTAL_SUPPLY_FMT" "pass"
else
  print_status "Failed to read total supply" "fail"
fi

# Check total assets
TOTAL_ASSETS=$(cast call $VAULT_ADDRESS "totalAssets()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$TOTAL_ASSETS" != "ERROR" ]; then
  TOTAL_ASSETS_FMT=$(cast from-wei $TOTAL_ASSETS 2>/dev/null || echo $TOTAL_ASSETS)
  print_status "Total Assets: $TOTAL_ASSETS_FMT" "pass"
else
  print_status "Failed to read total assets" "fail"
fi

echo ""
echo "================================================================================"
echo "INVALID ADDRESS CHECK: $INVALID_ADDRESS"
echo "================================================================================"
echo ""
print_status "INVALID DEPLOYMENT - DO NOT USE" "fail"
echo ""
echo "The address $INVALID_ADDRESS is an INVALID deployment."
echo "It was deployed with incorrect parameters or has known issues."
echo "USE ONLY: $VAULT_ADDRESS"
echo ""

# Check if invalid address has code
INVALID_BYTECODE=$(cast code $INVALID_ADDRESS --rpc-url $RPC_URL 2>/dev/null || echo "0x")
if [ ${#INVALID_BYTECODE} -gt 2 ]; then
  print_status "WARNING: Invalid address also has bytecode" "warn"
  print_status "This is why explicit documentation is critical" "warn"
else
  print_status "Invalid address appears empty (no code)" "pass"
fi

echo ""
echo "================================================================================"
echo "VERIFICATION SUMMARY"
echo "================================================================================"
echo ""
echo "Valid Deployment: $VAULT_ADDRESS"
echo "Status: $(if [ $BYTECODE_SIZE_BYTES -gt 0 ]; then echo "VERIFIED"; else echo "FAILED"; fi)"
echo ""
echo "Contract Parameters:"
echo "  - Name: $NAME"
echo "  - Symbol: $SYMBOL"
echo "  - Decimals: $DECIMALS"
echo "  - Asset: $ASSET"
echo "  - Epoch Duration: ${EPOCH_DURATION:-N/A} seconds"
echo "  - Genesis: ${GENESIS:-N/A}"
echo "  - Current Epoch: ${CURRENT_EPOCH:-N/A}"
echo "  - Total Supply: ${TOTAL_SUPPLY_FMT:-N/A}"
echo "  - Total Assets: ${TOTAL_ASSETS_FMT:-N/A}"
echo ""
echo "Interface Support:"
echo "  - ERC165: $SUPPORTS_IERC165"
echo "  - ERC4626: $SUPPORTS_ERC4626"
echo "  - ERC7540 Redeem: $SUPPORTS_ERC7540_REDEEM"
echo ""
echo "CRITICAL REMINDER:"
echo "  ❌ DO NOT USE: $INVALID_ADDRESS"
echo "  ✅ VALID: $VAULT_ADDRESS"
echo ""
echo "================================================================================"
