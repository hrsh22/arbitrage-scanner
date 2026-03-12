#!/bin/bash
#================================================================================
# verify-amoy-deployment.sh
# On-chain verification for ClosedBookBatchVault Amoy deployment
# Target: Closed-book batch vault contract
#================================================================================

set -e

# Configuration
VAULT_ADDRESS="${VAULT_ADDRESS:-0x0000000000000000000000000000000000000000}"
RPC_URL="${AMOY_RPC_URL:-https://rpc-amoy.polygon.technology}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "AMOY DEPLOYMENT VERIFICATION - ClosedBookBatchVault"
echo "================================================================================"
echo ""
echo "Vault Address: ${VAULT_ADDRESS}"
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
echo "BATCH/CYCLE CONFIGURATION"
echo "================================================================================"
echo ""

# Check DEPLOY_TIME
DEPLOY_TIME=$(cast call $VAULT_ADDRESS "DEPLOY_TIME()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$DEPLOY_TIME" != "ERROR" ]; then
  DEPLOY_DATE=$(date -r $DEPLOY_TIME 2>/dev/null || date -d @$DEPLOY_TIME 2>/dev/null || echo "unknown")
  print_status "Deploy Time: $DEPLOY_TIME" "pass"
  print_status "Deploy Date: $DEPLOY_DATE" "info"
else
  print_status "Failed to read deploy time" "fail"
fi

# Check current batch
CURRENT_BATCH=$(cast call $VAULT_ADDRESS "getCurrentBatch()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$CURRENT_BATCH" != "ERROR" ]; then
  CURRENT_BATCH_DEC=$(cast to-dec $CURRENT_BATCH 2>/dev/null || echo "$CURRENT_BATCH")
  print_status "Current Batch: $CURRENT_BATCH_DEC" "pass"
else
  print_status "Failed to read current batch" "fail"
fi

# Check batch status
if [ "$CURRENT_BATCH" != "ERROR" ]; then
  BATCH_STATUS=$(cast call $VAULT_ADDRESS "getBatchStatus(uint256)(uint8)" $CURRENT_BATCH --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
  if [ "$BATCH_STATUS" != "ERROR" ]; then
    BATCH_STATUS_DEC=$(cast to-dec $BATCH_STATUS 2>/dev/null || echo "$BATCH_STATUS")
    case "$BATCH_STATUS_DEC" in
      0) STATUS_NAME="Open" ;;
      1) STATUS_NAME="Cutoff" ;;
      2) STATUS_NAME="Flattening" ;;
      3) STATUS_NAME="Settling" ;;
      4) STATUS_NAME="Settled" ;;
      5) STATUS_NAME="Closed" ;;
      6) STATUS_NAME="Reopen" ;;
      *) STATUS_NAME="Unknown($BATCH_STATUS_DEC)" ;;
    esac
    print_status "Batch Status: $STATUS_NAME ($BATCH_STATUS_DEC)" "pass"
  else
    print_status "Failed to read batch status" "fail"
  fi
fi

# Check NAV_STALENESS_THRESHOLD
NAV_THRESHOLD=$(cast call $VAULT_ADDRESS "NAV_STALENESS_THRESHOLD()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$NAV_THRESHOLD" != "ERROR" ]; then
  NAV_THRESHOLD_HOURS=$((NAV_THRESHOLD / 3600))
  print_status "NAV Staleness Threshold: $NAV_THRESHOLD seconds ($NAV_THRESHOLD_HOURS hours)" "pass"
else
  print_status "Failed to read NAV staleness threshold" "fail"
fi

# Check current NAV
CURRENT_NAV=$(cast call $VAULT_ADDRESS "currentNAV()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$CURRENT_NAV" != "ERROR" ]; then
  CURRENT_NAV_FMT=$(cast from-wei $CURRENT_NAV 2>/dev/null || echo $CURRENT_NAV)
  print_status "Current NAV: $CURRENT_NAV_FMT" "pass"
else
  print_status "Failed to read current NAV" "fail"
fi

TRADING_WALLET=$(cast call $VAULT_ADDRESS "tradingWallet()(address)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$TRADING_WALLET" != "ERROR" ]; then
  print_status "Trading Wallet: $TRADING_WALLET" "pass"
else
  print_status "Failed to read trading wallet" "fail"
fi

# Check last NAV update
LAST_NAV_UPDATE=$(cast call $VAULT_ADDRESS "lastNAVUpdate()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$LAST_NAV_UPDATE" != "ERROR" ]; then
  LAST_NAV_DATE=$(date -r $LAST_NAV_UPDATE 2>/dev/null || date -d @$LAST_NAV_UPDATE 2>/dev/null || echo "unknown")
  print_status "Last NAV Update: $LAST_NAV_UPDATE" "pass"
  print_status "Last NAV Date: $LAST_NAV_DATE" "info"
else
  print_status "Failed to read last NAV update" "fail"
fi

# Check NAV freshness
NAV_FRESH=$(cast call $VAULT_ADDRESS "isNAVFresh()(bool)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$NAV_FRESH" != "ERROR" ]; then
  if [ "$NAV_FRESH" == "true" ]; then
    print_status "NAV is fresh" "pass"
  else
    print_status "NAV is stale" "warn"
  fi
else
  print_status "Failed to check NAV freshness" "fail"
fi

echo ""
echo "================================================================================"
echo "ACCESS CONTROL / ROLES"
echo "================================================================================"
echo ""

# Define role hashes
DEFAULT_ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
OPERATOR_ROLE=$(cast keccak "OPERATOR_ROLE" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
SETTLER_ROLE=$(cast keccak "SETTLER_ROLE" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
SNAPSHOT_ROLE=$(cast keccak "SNAPSHOT_ROLE" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
NAV_UPDATER_ROLE=$(cast keccak "NAV_UPDATER_ROLE" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")
DEPOSIT_PROCESSOR_ROLE=$(cast keccak "DEPOSIT_PROCESSOR_ROLE" 2>/dev/null || echo "0x0000000000000000000000000000000000000000000000000000000000000000")

# Check if contract has getRoleAdmin function
HAS_ACCESS_CONTROL=$(cast call $VAULT_ADDRESS "getRoleAdmin(bytes32)(bytes32)" $DEFAULT_ADMIN_ROLE --rpc-url $RPC_URL 2>/dev/null && echo "yes" || echo "no")

if [ "$HAS_ACCESS_CONTROL" == "yes" ]; then
  print_status "AccessControl interface supported" "pass"
else
  print_status "AccessControl may not be supported or role doesn't exist" "warn"
fi

# Check emergency mode
EMERGENCY_MODE=$(cast call $VAULT_ADDRESS "emergencyMode()(bool)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$EMERGENCY_MODE" != "ERROR" ]; then
  if [ "$EMERGENCY_MODE" == "false" ]; then
    print_status "Emergency Mode: Inactive" "pass"
  else
    print_status "Emergency Mode: ACTIVE" "warn"
  fi
else
  print_status "Failed to read emergency mode" "fail"
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
ERC7540_REDEEM_ID="0x620ee8e4"
SUPPORTS_ERC7540_REDEEM=$(cast call $VAULT_ADDRESS "supportsInterface(bytes4)(bool)" $ERC7540_REDEEM_ID --rpc-url $RPC_URL 2>/dev/null || echo "false")
if [ "$SUPPORTS_ERC7540_REDEEM" == "true" ]; then
  print_status "ERC7540 redeem interface supported" "pass"
else
  print_status "ERC7540 redeem interface not detected" "info"
fi

ERC7540_CLAIM_ID="0x2f0a18c5"
SUPPORTS_ERC7540_CLAIM=$(cast call $VAULT_ADDRESS "supportsInterface(bytes4)(bool)" $ERC7540_CLAIM_ID --rpc-url $RPC_URL 2>/dev/null || echo "false")
if [ "$SUPPORTS_ERC7540_CLAIM" == "true" ]; then
  print_status "ERC7540 claim interface supported" "pass"
else
  print_status "ERC7540 claim interface not detected" "info"
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

# Check total queued assets
TOTAL_QUEUED=$(cast call $VAULT_ADDRESS "totalQueuedAssets()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$TOTAL_QUEUED" != "ERROR" ]; then
  TOTAL_QUEUED_FMT=$(cast from-wei $TOTAL_QUEUED 2>/dev/null || echo $TOTAL_QUEUED)
  print_status "Total Queued Assets: $TOTAL_QUEUED_FMT" "pass"
else
  print_status "Failed to read total queued assets" "fail"
fi

# Check total pending redeem shares
PENDING_REDEEM=$(cast call $VAULT_ADDRESS "totalPendingRedeemShares()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
if [ "$PENDING_REDEEM" != "ERROR" ]; then
  PENDING_REDEEM_FMT=$(cast from-wei $PENDING_REDEEM 2>/dev/null || echo $PENDING_REDEEM)
  print_status "Total Pending Redeem Shares: $PENDING_REDEEM_FMT" "pass"
else
  print_status "Failed to read pending redeem shares" "fail"
fi

echo ""
echo "================================================================================"
echo "FLATNESS CHECK (Batch Status Indicators)"
echo "================================================================================"
echo ""

# If we have a current batch, check its flatness indicators
if [ "$CURRENT_BATCH" != "ERROR" ] && [ "$CURRENT_BATCH_DEC" != "0" ]; then
  # Get batch details
  BATCH_DATA=$(cast call $VAULT_ADDRESS "batches(uint256)(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,bool,bool)" $CURRENT_BATCH --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
  
  if [ "$BATCH_DATA" != "ERROR" ]; then
    # Parse the tuple - isPriceLocked is the 13th field (index 12)
    IS_PRICE_LOCKED=$(echo $BATCH_DATA | awk '{print $13}')
    LOCKED_CLEARING_PRICE=$(echo $BATCH_DATA | awk '{print $7}')
    
    if [ "$IS_PRICE_LOCKED" == "true" ]; then
      print_status "Batch is FLAT - Price Locked" "pass"
      print_status "Locked Clearing Price: $LOCKED_CLEARING_PRICE" "info"
    else
      print_status "Batch is NOT flat - Price not locked" "info"
    fi
    
    # Show batch end time
    BATCH_END=$(cast call $VAULT_ADDRESS "getBatchEnd(uint256)(uint256)" $CURRENT_BATCH --rpc-url $RPC_URL 2>/dev/null || echo "ERROR")
    if [ "$BATCH_END" != "ERROR" ]; then
      BATCH_END_DEC=$(cast to-dec $BATCH_END 2>/dev/null || echo "$BATCH_END")
      BATCH_END_DATE=$(date -r $BATCH_END_DEC 2>/dev/null || date -d @$BATCH_END_DEC 2>/dev/null || echo "unknown")
      print_status "Batch End: $BATCH_END_DATE" "info"
    fi
  fi
else
  print_status "No batch data available for flatness check" "info"
fi

echo ""
echo "================================================================================"
echo "VERIFICATION SUMMARY"
echo "================================================================================"
echo ""
echo "Vault Address: ${VAULT_ADDRESS}"
echo "Status: $(if [ $BYTECODE_SIZE_BYTES -gt 0 ]; then echo "VERIFIED"; else echo "FAILED"; fi)"
echo ""
echo "Contract Parameters:"
echo "  - Name: $NAME"
echo "  - Symbol: $SYMBOL"
echo "  - Decimals: $DECIMALS"
echo "  - Asset: $ASSET"
echo "  - Deploy Time: ${DEPLOY_TIME:-N/A}"
echo "  - Current Batch: ${CURRENT_BATCH_DEC:-N/A}"
echo "  - Batch Status: ${STATUS_NAME:-N/A}"
echo "  - NAV Staleness Threshold: ${NAV_THRESHOLD:-N/A} seconds"
echo "  - Current NAV: ${CURRENT_NAV_FMT:-N/A}"
echo "  - Trading Wallet: ${TRADING_WALLET:-N/A}"
echo "  - Last NAV Update: ${LAST_NAV_DATE:-N/A}"
echo "  - Total Supply: ${TOTAL_SUPPLY_FMT:-N/A}"
echo "  - Total Assets: ${TOTAL_ASSETS_FMT:-N/A}"
echo "  - Total Queued: ${TOTAL_QUEUED_FMT:-N/A}"
echo ""
echo "Interface Support:"
echo "  - ERC165: $SUPPORTS_IERC165"
echo "  - ERC4626: $SUPPORTS_ERC4626"
echo "  - ERC7540 Redeem: $SUPPORTS_ERC7540_REDEEM"
echo "  - ERC7540 Claim: $SUPPORTS_ERC7540_CLAIM"
echo ""
echo "Closed-Book Batch Lifecycle:"
echo "  0 = Open       - Accepting deposits and redemptions"
echo "  1 = Cutoff     - Deposits closed, redemptions frozen"
echo "  2 = Flattening - NAV snapshot taken, price locked"
echo "  3 = Settling   - Settlement in progress"
echo "  4 = Settled    - Settlement complete, claims available"
echo "  5 = Closed     - Claims window ended"
echo "  6 = Reopen     - Ready to start next cycle"
echo ""
echo "CRITICAL REMINDER:"
echo "  Ensure VAULT_ADDRESS is the ClosedBookBatchVault, NOT EpochTrancheVault"
echo ""
echo "================================================================================"
