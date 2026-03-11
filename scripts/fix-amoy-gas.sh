#!/bin/bash
#
# Quick fix for Amoy deployment gas issue
# Run this to deploy with lower gas settings
#

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Amoy Deployment - Gas Fix Options                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Current gas price: ~66 gwei"
echo "Script maxFeePerGas: 400 gwei (too high!)"
echo ""
echo "OPTION 1: Lower maxFeePerGas in deploy script (RECOMMENDED)"
echo "────────────────────────────────────────────────────────────"
echo "Edit: contracts/scripts/deployEpochTrancheVault.js"
echo ""
echo "Change line 92 from:"
echo '  maxFeePerGas: ethers.parseUnits("400", "gwei"),'
echo ""
echo "To:"
echo '  maxFeePerGas: ethers.parseUnits("100", "gwei"),'
echo ""
echo "Then re-run deployment."
echo ""
echo "OPTION 2: Wait for gas to come down"
echo "────────────────────────────────────────────────────────────"
echo "Gas prices fluctuate. Try again in 10-15 minutes."
echo ""
echo "OPTION 3: Use different RPC endpoint"
echo "────────────────────────────────────────────────────────────"
echo "Try one of these alternative RPCs:"
echo "  • https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY"
echo "  • https://rpc.ankr.com/polygon_amoy"
echo "  • https://polygon-amoy.blockpi.network/v1/rpc/public"
echo ""
echo "OPTION 4: Apply quick fix now"
echo "────────────────────────────────────────────────────────────"
echo "Run this command to patch the script temporarily:"
echo ""
echo 'sed -i.bak "s/parseUnits(\"400\", \"gwei\")/parseUnits(\"100\", \"gwei\")/g" contracts/scripts/deployEpochTrancheVault.js'
echo ""
echo "Then deploy, and restore afterward:"
echo 'mv contracts/scripts/deployEpochTrancheVault.js.bak contracts/scripts/deployEpochTrancheVault.js'
echo ""
