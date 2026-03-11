#!/bin/bash
#
# Amoy Deployment Environment Setup Helper
#
# This script helps configure the environment for deploying EpochTrancheVault to Amoy.
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Amoy EpochTrancheVault Deployment Setup                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env exists
ENV_FILE="contracts/scripts/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠ .env file not found. Creating from template...${NC}"
    touch "$ENV_FILE"
fi

# Read existing values (if any)
source "$ENV_FILE" 2>/dev/null || true

echo -e "${BLUE}Step 1: Deployer Configuration${NC}"
echo "─────────────────────────────────────────────────────────────────"
echo "The deployer address will be: 0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74"
echo ""
echo -e "${YELLOW}⚠ IMPORTANT: The deployer needs:${NC}"
echo "  • Amoy MATIC for gas (get from https://faucet.polygon.technology)"
echo "  • Private key configured in .env"
echo ""

# Check for private key
if [ -z "${PRIVATE_KEY:-}" ]; then
    echo -e "${RED}✗ PRIVATE_KEY not set in .env${NC}"
    echo "  Add this line to $ENV_FILE:"
    echo "  PRIVATE_KEY=0x..."
    exit 1
else
    echo -e "${GREEN}✓ PRIVATE_KEY is set${NC}"
fi

echo ""
echo -e "${BLUE}Step 2: Role Addresses (EOA Operators for Amoy)${NC}"
echo "─────────────────────────────────────────────────────────────────"
echo "For Amoy testing, these can be the same address or different EOAs."
echo "Each role needs a small amount of MATIC for potential transactions."
echo ""

# Function to check or prompt for address
check_or_prompt() {
    local var_name=$1
    local description=$2
    local current_value=${!var_name:-}
    
    if [ -n "$current_value" ] && [ "$current_value" != "0x0000000000000000000000000000000000000000" ]; then
        echo -e "${GREEN}✓ $var_name${NC}: $current_value"
        return 0
    else
        echo -e "${RED}✗ $var_name${NC}: $description"
        echo "  Add to $ENV_FILE: $var_name=0x..."
        return 1
    fi
}

MISSING=0

check_or_prompt "EPOCH_TRANCHE_ADMIN_ADDRESS" "Admin role - full control over contract" || MISSING=$((MISSING + 1))
check_or_prompt "EPOCH_TRANCHE_SETTLER_ADDRESS" "Settler - handles epoch settlement" || MISSING=$((MISSING + 1))
check_or_prompt "EPOCH_TRANCHE_NAV_UPDATER_ADDRESS" "NAV Updater - updates NAV with freshness checks" || MISSING=$((MISSING + 1))
check_or_prompt "EPOCH_TRANCHE_SNAPSHOTTER_ADDRESS" "Snapshotter - freezes epochs" || MISSING=$((MISSING + 1))
check_or_prompt "EPOCH_TRANCHE_DEPOSIT_PROCESSOR_ADDRESS" "Deposit Processor - processes deposit queue" || MISSING=$((MISSING + 1))
check_or_prompt "EPOCH_TRANCHE_TRADING_SAFE_ADDRESS" "Trading Safe - receives deployed capital" || MISSING=$((MISSING + 1))

echo ""
echo -e "${BLUE}Step 3: Deployment Configuration${NC}"
echo "─────────────────────────────────────────────────────────────────"
echo "Profile: staging (1-hour epochs)"
echo "Network: Polygon Amoy (Chain ID: 80002)"
echo "Asset:   0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 (USDC)"
echo "RPC:     https://rpc-amoy.polygon.technology"
echo ""

if [ $MISSING -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✓ Environment is ready for deployment!                        ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Ensure deployer has Amoy MATIC"
    echo "  2. Run dry-run: node deployEpochTrancheVault.js --profile staging --rpc-url https://rpc-amoy.polygon.technology --dry-run"
    echo "  3. Deploy:      node deployEpochTrancheVault.js --profile staging --rpc-url https://rpc-amoy.polygon.technology"
    echo ""
    exit 0
else
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ⚠ Environment incomplete ($MISSING variables missing)         ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Please add the missing variables to: $ENV_FILE"
    echo ""
    echo "Example configuration:"
    echo "─────────────────────────────────────────────────────────────────"
    echo "# Deployer (your wallet)"
    echo "PRIVATE_KEY=0x..."
    echo ""
    echo "# Role addresses (can be same as deployer for testing)"
    echo "EPOCH_TRANCHE_ADMIN_ADDRESS=0xB78721b29c028B16ab25f4a2adE1d25fbf8B2d74"
    echo "EPOCH_TRANCHE_SETTLER_ADDRESS=0x..."
    echo "EPOCH_TRANCHE_NAV_UPDATER_ADDRESS=0x..."
    echo "EPOCH_TRANCHE_SNAPSHOTTER_ADDRESS=0x..."
    echo "EPOCH_TRANCHE_DEPOSIT_PROCESSOR_ADDRESS=0x..."
    echo "EPOCH_TRANCHE_TRADING_SAFE_ADDRESS=0x...  # Create a Safe at app.safe.global"
    echo ""
    exit 1
fi
