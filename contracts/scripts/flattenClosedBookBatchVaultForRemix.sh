#!/usr/bin/env bash
#
# Flatten ClosedBookBatchVault for Remix IDE Deployment
#
# This script generates a flattened contract file suitable for deployment
# via Remix IDE (https://remix.ethereum.org).
#
# IMPORTANT - Remix Deployment Procedure:
# 1. Run this script to generate the flattened file
# 2. Open Remix IDE and create a new file
# 3. Copy the contents of the generated flattened file
# 4. Select Solidity compiler version 0.8.28
# 5. COMPILE THE CONTRACT
# 6. IN THE DEPLOY SECTION, SELECT: "ClosedBookBatchVault" (NOT abstract bases)
#    - The flattened file contains multiple contracts (ERC20, AccessControl, etc.)
#    - You MUST select the concrete "ClosedBookBatchVault" contract
#    - Selecting abstract contracts will deploy non-functional bytecode
# 7. Enter constructor arguments as documented in operator-runbook-amoy.md
# 8. Deploy to Polygon Amoy (Chain ID: 80002)
#
# CRITICAL WARNING:
# The flattened file contains many contracts (libraries, abstract contracts,
# interfaces). In Remix's "Deploy" dropdown, you MUST select:
#   ✅ ClosedBookBatchVault (concrete contract)
# NOT:
#   ❌ ERC20 (abstract)
#   ❌ AccessControl (abstract)
#   ❌ ReentrancyGuard (abstract)
#   ❌ Any interface (I*)
#
# MIGRATION NOTE:
# This is the NEW ClosedBookBatchVault contract, intended to replace
# EpochTrancheVault. The legacy contract remains at:
#   0x8D87Cc370e3751d5bBDBaE702e6618D59D950b2D (Amoy)
#
set -euo pipefail

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_PATH="${CONTRACTS_DIR}/flattened/ClosedBookBatchVault.flattened.sol"

cd "${CONTRACTS_DIR}"

forge flatten "src/ClosedBookBatchVault.sol" > "${OUTPUT_PATH}"

python3 - <<'PY'
from pathlib import Path

output_path = Path("flattened/ClosedBookBatchVault.flattened.sol")
text = output_path.read_text()

original = "interface IERC1363 is IERC20_1, IERC165_1 {"
patched = "interface IERC1363 is IERC20_0, IERC165_1 {"

if original not in text:
    raise SystemExit("Expected IERC1363 inheritance pattern not found in flattened output")

text = text.replace(original, patched, 1)
output_path.write_text(text)
PY

forge build --contracts flattened --skip test >/dev/null

printf 'Generated and verified %s\n' "${OUTPUT_PATH}"
