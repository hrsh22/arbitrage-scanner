#!/bin/bash
#================================================================================
# verify-cutover.sh
# Quick verification script for adapter cutover state
# Usage: ./verify-cutover.sh
#================================================================================

set -e

# Configuration
VAULT_ADDRESS="0x066A4678935b78FA4E89e914dBE8F077764F0c74"
OLD_ADAPTER="0x4CC11626A7E96DF5033d24Bd4D1C608749b68730"
NEW_ADAPTER="0x29AAe313f2129Fb6bd25f12aaf515d00aa4B3d84"
RPC_URL="${POLYGON_RPC_URL:-}"

# Validate RPC_URL is set
if [ -z "$RPC_URL" ]; then
  echo "Error: POLYGON_RPC_URL environment variable must be set"
  echo "Usage: POLYGON_RPC_URL=<your_rpc_url> ./verify-cutover.sh"
  exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "CUT-OVER STATE VERIFICATION"
echo "================================================================================"
echo ""
echo "Vault: $VAULT_ADDRESS"
echo "RPC: $RPC_URL"
echo ""

# Helper functions
check_command() {
  if command -v "$1" &> /dev/null; then
    return 0
  else
    return 1
  fi
}

print_status() {
  if [ "$2" == "pass" ]; then
    echo -e "  ${GREEN}✅ $1${NC}"
  elif [ "$2" == "fail" ]; then
    echo -e "  ${RED}❌ $1${NC}"
  else
    echo -e "  ${YELLOW}⚠️  $1${NC}"
  fi
}

# Check dependencies
echo "Checking dependencies..."
if check_command cast; then
  print_status "Foundry (cast) installed" "pass"
else
  print_status "Foundry (cast) not installed" "fail"
  echo "Please install Foundry: https://book.getfoundry.sh/getting-started/installation"
  exit 1
fi

if check_command curl; then
  print_status "curl installed" "pass"
else
  print_status "curl not installed" "warn"
fi

if check_command jq; then
  print_status "jq installed" "pass"
else
  print_status "jq not installed (optional)" "warn"
fi

echo ""
echo "================================================================================"
echo "ADAPTER REGISTRATION STATUS"
echo "================================================================================"

# Check new adapter registration
echo ""
echo "New Adapter ($NEW_ADAPTER):"
NEW_ADAPTER_REGISTERED=$(cast call $VAULT_ADDRESS "isAdapter(address)(bool)" $NEW_ADAPTER --rpc-url $RPC_URL 2>/dev/null || echo "false")
if [ "$NEW_ADAPTER_REGISTERED" == "true" ]; then
  print_status "Registered on vault" "pass"
else
  print_status "NOT registered on vault" "fail"
fi

# Check new adapter caps
NEW_ADAPTER_ID=$(cast keccak $(cast abi-encode "x(string,address)" "PolymarketAdapter" $NEW_ADAPTER) 2>/dev/null)
NEW_ABS_CAP=$(cast call $VAULT_ADDRESS "absoluteCap(bytes32)(uint256)" $NEW_ADAPTER_ID --rpc-url $RPC_URL 2>/dev/null || echo "0")
NEW_REL_CAP=$(cast call $VAULT_ADDRESS "relativeCap(bytes32)(uint256)" $NEW_ADAPTER_ID --rpc-url $RPC_URL 2>/dev/null || echo "0")

if [ "$NEW_ABS_CAP" != "0" ]; then
  print_status "Absolute cap set ($NEW_ABS_CAP)" "pass"
else
  print_status "Absolute cap NOT set (ZeroAbsoluteCap risk)" "fail"
fi

if [ "$NEW_REL_CAP" != "0" ]; then
  print_status "Relative cap set ($NEW_REL_CAP bps)" "pass"
else
  print_status "Relative cap NOT set" "warn"
fi

# Check old adapter registration
echo ""
echo "Old Adapter ($OLD_ADAPTER):"
OLD_ADAPTER_REGISTERED=$(cast call $VAULT_ADDRESS "isAdapter(address)(bool)" $OLD_ADAPTER --rpc-url $RPC_URL 2>/dev/null || echo "false")
if [ "$OLD_ADAPTER_REGISTERED" == "true" ]; then
  print_status "Still registered on vault (removal pending)" "warn"
else
  print_status "Already removed from vault (cutover complete)" "pass"
fi

# Check old adapter state
OLD_ADAPTER_ID=$(cast keccak $(cast abi-encode "x(string,address)" "PolymarketAdapter" $OLD_ADAPTER) 2>/dev/null)
OLD_DEPLOYED_RAW=$(cast call $OLD_ADAPTER "totalDeployed()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "0")
OLD_COST_BASIS_RAW=$(cast call $OLD_ADAPTER "totalPositionCostBasis()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "0")
OLD_DEPLOYED=$(echo "$OLD_DEPLOYED_RAW" | awk '{print $1}')
OLD_COST_BASIS=$(echo "$OLD_COST_BASIS_RAW" | awk '{print $1}')

OLD_ASSET=$(cast call $OLD_ADAPTER "asset()(address)" --rpc-url $RPC_URL 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
OLD_SAFE=$(cast call $OLD_ADAPTER "safe()(address)" --rpc-url $RPC_URL 2>/dev/null || echo "0x0000000000000000000000000000000000000000")
OLD_SAFE_BALANCE_RAW=$(cast call $OLD_ASSET "balanceOf(address)(uint256)" $OLD_SAFE --rpc-url $RPC_URL 2>/dev/null || echo "0")
OLD_ADAPTER_BALANCE_RAW=$(cast call $OLD_ASSET "balanceOf(address)(uint256)" $OLD_ADAPTER --rpc-url $RPC_URL 2>/dev/null || echo "0")
OLD_SAFE_BALANCE=$(echo "$OLD_SAFE_BALANCE_RAW" | awk '{print $1}')
OLD_ADAPTER_BALANCE=$(echo "$OLD_ADAPTER_BALANCE_RAW" | awk '{print $1}')
OLD_LIVE_EXPOSURE=$((OLD_SAFE_BALANCE + OLD_ADAPTER_BALANCE + OLD_COST_BASIS))

echo "  totalDeployed: $OLD_DEPLOYED_RAW"
echo "  totalPositionCostBasis: $OLD_COST_BASIS_RAW"
echo "  safeBalance: $OLD_SAFE_BALANCE_RAW"
echo "  adapterBalance: $OLD_ADAPTER_BALANCE_RAW"
echo "  liveExposure(raw): $OLD_LIVE_EXPOSURE"

if [ "$OLD_LIVE_EXPOSURE" == "0" ]; then
  print_status "No live exposure in old adapter (safe post-removal state)" "pass"
  if [ "$OLD_DEPLOYED" != "0" ]; then
    print_status "totalDeployed is stale historical accounting (known legacy state)" "warn"
  fi
else
  print_status "Funds still in old adapter (deallocate before removal)" "warn"
fi

echo ""
echo "================================================================================"
echo "NEW ADAPTER STATE"
echo "================================================================================"

NEW_DEPLOYED=$(cast call $NEW_ADAPTER "totalDeployed()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "0")
NEW_COST_BASIS=$(cast call $NEW_ADAPTER "totalPositionCostBasis()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "0")
LAST_NAV_UPDATE=$(cast call $NEW_ADAPTER "lastNavUpdate()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "0")

echo "  totalDeployed: $NEW_DEPLOYED"
echo "  totalPositionCostBasis: $NEW_COST_BASIS"
echo "  lastNavUpdate: $LAST_NAV_UPDATE"

if [ "$NEW_DEPLOYED" == "0" ]; then
  print_status "No funds allocated yet" "pass"
else
  print_status "Funds allocated to new adapter" "pass"
fi

echo ""
echo "================================================================================"
echo "VAULT BALANCES"
echo "================================================================================"

USDC_ADDRESS="0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
VAULT_BALANCE=$(cast call $USDC_ADDRESS "balanceOf(address)(uint256)" $VAULT_ADDRESS --rpc-url $RPC_URL 2>/dev/null || echo "0")
SAFE_BALANCE=$(cast call $USDC_ADDRESS "balanceOf(address)(uint256)" "0xc8447F7d4dF6d717684fC9A3d242ee7713F43927" --rpc-url $RPC_URL 2>/dev/null || echo "0")

echo "  Vault USDC.e balance: $VAULT_BALANCE"
echo "  Safe USDC.e balance: $SAFE_BALANCE"

TOTAL_BALANCE=$((VAULT_BALANCE + SAFE_BALANCE))
echo "  Total: $TOTAL_BALANCE"

echo ""
echo "================================================================================"
echo "CONFIGURATION CHECK"
echo "================================================================================"

CONFIG_FILE="$(dirname "$0")/../../apps/vault-api/src/config/vaults/vault1-pph.ts"
if [ -f "$CONFIG_FILE" ]; then
  echo "Config file: $CONFIG_FILE"
  CURRENT_ADAPTER=$(grep "adapterAddress:" "$CONFIG_FILE" | head -1 | sed 's/.*adapterAddress: "\([^"]*\)".*/\1/')
  echo "  Configured adapter: $CURRENT_ADAPTER"
  
  if [ "$CURRENT_ADAPTER" == "$NEW_ADAPTER" ]; then
    print_status "Config points to NEW adapter" "pass"
  elif [ "$CURRENT_ADAPTER" == "$OLD_ADAPTER" ]; then
    print_status "Config points to OLD adapter" "warn"
  else
    print_status "Config points to UNKNOWN adapter" "fail"
  fi
  
  MAX_RATIO=$(grep "maxDeployedRatio:" "$CONFIG_FILE" | head -1 | sed 's/.*maxDeployedRatio: \([0-9.]*\).*/\1/')
  echo "  maxDeployedRatio: $MAX_RATIO"
  
  if [ "$MAX_RATIO" == "1.0" ] || [ "$MAX_RATIO" == "1" ]; then
    print_status "100% max ratio (new adapter)" "pass"
  else
    print_status "Limited ratio (old adapter: 25%)" "warn"
  fi
else
  print_status "Config file not found at $CONFIG_FILE" "fail"
fi

echo ""
echo "================================================================================"
echo "SERVICE STATUS"
echo "================================================================================"

if check_command curl; then
  HEALTH_STATUS=$(curl -s http://localhost:8081/health 2>/dev/null || echo '{"status":"unreachable"}')
  if echo "$HEALTH_STATUS" | grep -q '"status":"ok"'; then
    print_status "API server healthy" "pass"
  else
    print_status "API server not responding (may be stopped)" "warn"
  fi
  
  # Try to get vault status
  VAULT_STATUS=$(curl -s http://localhost:8081/vault/status 2>/dev/null || echo '{}')
  if [ "$VAULT_STATUS" != "{}" ]; then
    echo "  Vault status available via API"
    if command -v jq &> /dev/null; then
      VAULT_INSTANCES=$(curl -s http://localhost:8081/vault/instances 2>/dev/null || echo '{}')
      ADAPTER_FROM_API=$(echo "$VAULT_INSTANCES" | jq -r '.instances[0].config.adapterAddress // "unknown"')
      echo "  Adapter from API: $ADAPTER_FROM_API"
    fi
  fi
else
  print_status "curl not available, skipping service check" "warn"
fi

echo ""
echo "================================================================================"
echo "SUMMARY"
echo "================================================================================"

# Determine overall status
if [ "$NEW_ADAPTER_REGISTERED" == "true" ] && [ "$NEW_ABS_CAP" != "0" ]; then
  if [ "$OLD_ADAPTER_REGISTERED" != "true" ]; then
    echo -e "${GREEN}✅ CUT-OVER COMPLETE${NC}"
    echo ""
    echo "The new adapter is fully configured and the old adapter has been removed."
    echo "Rotation is complete."
  else
    echo -e "${YELLOW}⚠️  READY FOR PHASE 2${NC}"
    echo ""
    echo "New adapter is registered and ready."
    echo "Old adapter still registered - run phase2 removal when ready:"
    echo "  node adapter-rotate.js phase2 --vault $VAULT_ADDRESS --old-adapter $OLD_ADAPTER --rpc-url $RPC_URL --confirm-remove-old"
  fi
  elif [ "$NEW_ADAPTER_REGISTERED" == "true" ]; then
  echo -e "${YELLOW}⚠️  CAPS NOT SET${NC}"
  echo ""
  echo "New adapter is registered but caps are not set."
  echo "Run cap setting scripts first."
  else
  echo -e "${RED}❌ NOT READY${NC}"
  echo ""
  echo "New adapter is not fully set up."
  echo "Run registration and cap setting scripts first."
fi

echo ""
echo "================================================================================"
