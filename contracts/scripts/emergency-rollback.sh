#!/bin/bash
#================================================================================
# emergency-rollback.sh
# Emergency rollback script for adapter cutover
# Usage: ./emergency-rollback.sh
# WARNING: This will revert to the old adapter!
#================================================================================

set -e

# Configuration
VAULT_ADDRESS="0x066A4678935b78FA4E89e914dBE8F077764F0c74"
OLD_ADAPTER="0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525"
NEW_ADAPTER="0xD59CfD8D1BE7f44Bd83DC1896e5BD64e12E409b5"
RPC_URL="${POLYGON_RPC_URL:-https://polygon-mainnet.g.alchemy.com/v2/XeqbzKzOklvVcN5tsLW5VnSZ5ETutKuc}"
CONFIG_FILE="$(dirname "$0")/../../apps/vault-api/src/config/vaults/vault1-pph.ts"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "${RED}⚠️  EMERGENCY ROLLBACK ⚠️${NC}"
echo "================================================================================"
echo ""
echo "This will ROLLBACK the vault to the old adapter!"
echo ""
echo "From: $NEW_ADAPTER (new, 100% ratio)"
echo "To:   $OLD_ADAPTER (old, 25% ratio)"
echo ""
echo "Services will be stopped and config will be reverted."
echo ""

# Confirmation
read -p "Type 'ROLLBACK' to confirm: " confirm
if [ "$confirm" != "ROLLBACK" ]; then
  echo ""
  echo "Aborted. No changes made."
  exit 1
fi

echo ""
echo "${YELLOW}Starting rollback in 5 seconds... Press Ctrl+C to cancel${NC}"
sleep 5

echo ""
echo "================================================================================"
echo "STEP 1: STOPPING SERVICES"
echo "================================================================================"

echo "Stopping worker process..."
pkill -f "vault.*worker" 2>/dev/null || true
sleep 1

echo "Stopping API server..."
pkill -f "vault.*start" 2>/dev/null || true
sleep 2

# Verify stopped
RUNNING_PROCS=$(ps aux | grep -E "(vault|worker)" | grep -v grep | wc -l)
if [ "$RUNNING_PROCS" -eq 0 ]; then
  echo -e "${GREEN}✅ All services stopped${NC}"
else
  echo -e "${YELLOW}⚠️  Some processes may still be running${NC}"
  ps aux | grep -E "(vault|worker)" | grep -v grep || true
fi

echo ""
echo "================================================================================"
echo "STEP 2: CHECKING NEW ADAPTER STATE"
echo "================================================================================"

# Check if cast is available
if ! command -v cast &> /dev/null; then
  echo -e "${YELLOW}⚠️  Foundry (cast) not found. Skipping on-chain checks.${NC}"
  echo "Install Foundry for automatic deallocation: https://book.getfoundry.sh"
else
  echo "Checking new adapter totalDeployed..."
  NEW_DEPLOYED=$(cast call $NEW_ADAPTER "totalDeployed()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "0")
  echo "  New adapter totalDeployed: $NEW_DEPLOYED"
  
  if [ "$NEW_DEPLOYED" != "0" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Funds detected in new adapter!${NC}"
    echo "You need to deallocate before rollback."
    echo ""
    
    if [ -z "$VAULT_1_ALLOCATOR_NAV_KEY" ]; then
      echo -e "${RED}❌ VAULT_1_ALLOCATOR_NAV_KEY not set${NC}"
      echo "Set this environment variable to auto-deallocate:"
      echo "  export VAULT_1_ALLOCATOR_NAV_KEY=0x..."
      echo ""
      echo "Or manually deallocate:"
      echo "  cast send $VAULT_ADDRESS \"forceDeallocate(address,bytes,uint256,address)\" $NEW_ADAPTER \"0x\" $NEW_DEPLOYED $VAULT_ADDRESS --rpc-url \$RPC_URL --private-key \$PRIVATE_KEY"
      exit 1
    fi
    
    read -p "Deallocate $NEW_DEPLOYED from new adapter? (yes/no): " dealloc_confirm
    if [ "$dealloc_confirm" == "yes" ]; then
      echo "Deallocating..."
      cast send $VAULT_ADDRESS \
        "forceDeallocate(address,bytes,uint256,address)" \
        $NEW_ADAPTER \
        "0x" \
        $NEW_DEPLOYED \
        $VAULT_ADDRESS \
        --rpc-url $RPC_URL \
        --private-key $VAULT_1_ALLOCATOR_NAV_KEY \
        --gas-limit 300000
      
      # Verify
      sleep 5
      NEW_DEPLOYED_AFTER=$(cast call $NEW_ADAPTER "totalDeployed()(uint256)" --rpc-url $RPC_URL 2>/dev/null || echo "0")
      if [ "$NEW_DEPLOYED_AFTER" == "0" ]; then
        echo -e "${GREEN}✅ Deallocation successful${NC}"
      else
        echo -e "${RED}❌ Deallocation may have failed. Remaining: $NEW_DEPLOYED_AFTER${NC}"
        read -p "Continue anyway? (yes/no): " continue_anyway
        if [ "$continue_anyway" != "yes" ]; then
          exit 1
        fi
      fi
    else
      echo "Skipping deallocation. Funds will remain in new adapter."
    fi
  else
    echo -e "${GREEN}✅ No funds in new adapter${NC}"
  fi
fi

echo ""
echo "================================================================================"
echo "STEP 3: BACKING UP CURRENT CONFIG"
echo "================================================================================"

if [ -f "$CONFIG_FILE" ]; then
  BACKUP_FILE="${CONFIG_FILE}.cutover-failed.$(date +%Y%m%d-%H%M%S)"
  cp "$CONFIG_FILE" "$BACKUP_FILE"
  echo -e "${GREEN}✅ Config backed up to:${NC}"
  echo "  $BACKUP_FILE"
else
  echo -e "${YELLOW}⚠️  Config file not found at $CONFIG_FILE${NC}"
  echo "Searching for vault1-pph.ts..."
  find . -name "vault1-pph.ts" 2>/dev/null | head -5
  read -p "Enter path to config file: " CONFIG_FILE
fi

echo ""
echo "================================================================================"
echo "STEP 4: REVERTING CONFIG TO OLD ADAPTER"
echo "================================================================================"

echo "Current adapter in config:"
grep "adapterAddress:" "$CONFIG_FILE" | head -1

echo ""
echo "Reverting to old adapter..."

# Create reverted config
REVERTED_CONFIG='import type { VaultInstanceConfig, VaultMode } from "../types.js";

const config: VaultInstanceConfig = {
  id: 1,
  name: "Vault Mid-Risk",
  enabled: true,
  type: "bot",

  vaultAddress: "0x066A4678935b78FA4E89e914dBE8F077764F0c74",
  adapterAddress: "0x0cA15c34a35B090a4E46fF9f4D95D4A08DD4b525",  // OLD ADAPTER
  safeAddress: "0x5Eb9f355cCa830Bc1bB928D24509e278A0804b6b",
  allocatorNavSignerKeyEnv: "VAULT_1_ALLOCATOR_NAV_KEY",
  safeOperatorKeyEnv: "VAULT_1_SAFE_OPERATOR_KEY",
  tradingSignerKeyEnv: "VAULT_1_TRADING_SIGNER_KEY",
  tradingSignatureType: 2,
  tradingFunderAddress: "0x5Eb9f355cCa830Bc1bB928D24509e278A0804b6b",
  singleSafeMode: true,

  betSize: 1.0,
  dailyBudget: Infinity,
  minOdds: 0.9,
  maxOdds: 0.995,
  maxHoursGeneral: 1,
  maxHoursForHighOdds: 1,
  highOddsThreshold: 0.99,
  marketFetchMaxEvents: 2000,
  categoryTimeLimits: {
    crypto: 1,
    sports: 1,
    esports: 0.5,
  },
  skipCategories: ["crypto", "up-or-down", "weather"],
  minWalletReserve: 0,
  maxDailyLoss: Infinity,
  enableEarlyExit: true,
  earlyExitMinPrice: 0.9995,
  useMarketOrders: true,
  vaultReserveUsdc: 0,
  minAllocationAmountUsdc: 1,
  maxDeployedRatio: 0.25,  // OLD ADAPTER: 25% max

  hedging: {
    enabled: false,
    dropThresholdPercent: 60,
    multiplier: 2,
    spreadTolerance: 0.1,
    minPositionAgeMinutes: 0,
    onlyNearResolution: false,
    nearResolutionMinutes: 60,
    skipCategories: ["sports", "nfl", "nba"],
  },

  navRefreshIntervalMin: 2,
  reconciliationIntervalMin: 2,
  tradingScanIntervalMin: 1,
  resolutionCheckIntervalMin: 5,

  defaultMode: (process.env.VAULT_MODE || "simulation") as VaultMode,
};

export default config;
'

echo "$REVERTED_CONFIG" > "$CONFIG_FILE"

echo ""
echo "New adapter in config:"
grep "adapterAddress:" "$CONFIG_FILE" | head -1
echo "maxDeployedRatio:"
grep "maxDeployedRatio:" "$CONFIG_FILE" | head -1

echo -e "${GREEN}✅ Config reverted${NC}"

echo ""
echo "================================================================================"
echo "STEP 5: REBUILDING"
echo "================================================================================"

cd "$(dirname "$0")/../.."
echo "Building in $(pwd)..."

if ! pnpm --filter vault build; then
  echo -e "${RED}❌ Build failed!${NC}"
  echo ""
  echo "Possible causes:"
  echo "  - Config syntax error"
  echo "  - Missing dependencies"
  echo "  - Type errors"
  echo ""
  echo "To restore from backup:"
  echo "  cp $BACKUP_FILE $CONFIG_FILE"
  exit 1
fi

echo -e "${GREEN}✅ Build successful${NC}"

echo ""
echo "================================================================================"
echo "STEP 6: RESTARTING SERVICES"
echo "================================================================================"

cd apps/vault-api

echo "Starting API server..."
pnpm start &
API_PID=$!
echo "  PID: $API_PID"

sleep 5

echo ""
echo "Starting worker..."
pnpm worker &
WORKER_PID=$!
echo "  PID: $WORKER_PID"

echo ""
sleep 3

echo "================================================================================"
echo "STEP 7: POST-ROLLBACK VERIFICATION"
echo "================================================================================"

echo ""
echo "Checking health endpoint..."
if curl -s http://localhost:8081/health | grep -q '"status":"ok"'; then
  echo -e "${GREEN}✅ Health check passed${NC}"
else
  echo -e "${YELLOW}⚠️  Health check failed or API not ready yet${NC}"
  echo "Check manually: curl http://localhost:8081/health"
fi

echo ""
echo "Checking vault status..."
VAULT_STATUS=$(curl -s http://localhost:8081/vault/status 2>/dev/null || echo '{}')
if echo "$VAULT_STATUS" | grep -q "adapterAddress"; then
  echo "Vault status available"
  if command -v jq &> /dev/null; then
    CURRENT_ADAPTER=$(echo "$VAULT_STATUS" | jq -r '.adapterAddress // "unknown"')
    echo "  Current adapter: $CURRENT_ADAPTER"
    if [ "$CURRENT_ADAPTER" == "$OLD_ADAPTER" ]; then
      echo -e "${GREEN}✅ Rollback verified - using old adapter${NC}"
    else
      echo -e "${YELLOW}⚠️  Adapter mismatch - expected old adapter${NC}"
    fi
  fi
else
  echo -e "${YELLOW}⚠️  Could not fetch vault status${NC}"
fi

echo ""
echo "================================================================================"
echo "ROLLBACK COMPLETE"
echo "================================================================================"

echo ""
echo -e "${GREEN}✅ Rollback completed successfully!${NC}"
echo ""
echo "Summary:"
echo "  - Services stopped and restarted"
echo "  - Config reverted to old adapter"
echo "  - Build successful"
echo "  - Services running"
echo ""
echo "Next steps:"
echo "  1. Verify services are stable"
echo "  2. Test allocation/deallocation"
echo "  3. Document the failure reason"
echo "  4. Fix the issue that caused rollback"
echo "  5. Plan retry after fixes"
echo ""
echo "Files:"
echo "  Backup config: $BACKUP_FILE"
echo "  Current config: $CONFIG_FILE"
echo ""
echo "To verify status:"
echo "  ./contracts/scripts/verify-cutover.sh"
echo ""
echo -e "${BLUE}Monitor logs with:${NC}"
echo "  tail -f apps/vault-api/logs/vault-api.log"
echo ""
