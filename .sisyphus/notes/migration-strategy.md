# Migration Strategy: ERC-7540 Redemption Compliance Rewrite

> **Scope**: Deployment, rollback, and coordination for the ERC-7540 async-redemption rewrite across contracts, vault-api, and vault-web.  
> **Assumption**: No live deployments exist (per plan guardrails). This is a fresh rollout strategy, not a data migration.  
> **Created For**: T16 (Documentation/Runbook Updates) and T17 (Release-Readiness Checklist)

---

## 1) Deployment Overview

### 1.1 System Components

| Component        | Stack              | Deploy Target   | Rollback Complexity       |
| ---------------- | ------------------ | --------------- | ------------------------- |
| WeeklyEpochVault | Solidity (Foundry) | Polygon mainnet | High (immutable contract) |
| vault-api        | Node.js/Express    | VPS/Container   | Low (blue/green capable)  |
| vault-web        | Next.js            | Static/Vercel   | Low (instant rollback)    |

### 1.2 Deployment Philosophy

- **Contracts**: Immutable once deployed. Extensive pre-deployment verification required.
- **API/Web**: Blue/green deployment with instant rollback via traffic switch.
- **No Data Migration**: Clean slate deployment per "no-migration-path" plan constraint.

---

## 2) Deployment Phase Sequence

### Phase 0: Pre-Deployment Validation (Mandatory)

**Gate Criteria** (ALL must pass):

```bash
# 1. Contract test suite
cd contracts && forge test --match-contract WeeklyEpochVault

# 2. Backend build and test
pnpm --filter vault build
pnpm --filter vault exec vitest --run

# 3. Frontend build
pnpm --filter vault-web build

# 4. Interface ID verification
cd contracts && forge test --match-test "testInterfaceId"

# 5. ERC-165 support check
cd contracts && forge test --match-test "testSupportsInterface"
```

**Evidence Required**:

- `.sisyphus/evidence/task-15-full-pass.txt`
- `.sisyphus/evidence/task-8-interface-ids.txt`
- Contract deployment artifact from dry-run

**Duration**: 15 minutes  
**Rollback**: N/A (gate check only)

---

### Phase 1: Contract Deployment

**Order**: Contracts first (immutable foundation)  
**Parallel**: No (sequential dependency for all other phases)

#### Step 1.1: Pre-Deploy Configuration

Verify constructor parameters:

```javascript
// contracts/scripts/deployWeeklyEpochVault.js expected params
const deploymentParams = {
  asset: "0x...", // USDC on Polygon
  admin: "0x...", // Multisig admin
  settler: "0x...", // Settlement bot address
  navUpdater: "0x...", // NAV oracle address
  epochDuration: 3600, // 1 hour (matches VAULT_1_EPOCH_DURATION_SECONDS)
  navStalenessThreshold: 21600, // 6 hours (per VAULT_KNOWLEDGE.md)
};
```

#### Step 1.2: Deploy Command

```bash
cd contracts
source .env.production  # Verify: POLYGON_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY

# Dry run
forge script scripts/deployWeeklyEpochVault.js \
  --rpc-url $POLYGON_RPC_URL \
  --private-key $PRIVATE_KEY \
  --verify \
  --dry-run

# Live deploy (executed only after dry-run success)
forge script scripts/deployWeeklyEpochVault.js \
  --rpc-url $POLYGON_RPC_URL \
  --private-key $PRIVATE_KEY \
  --verify \
  --broadcast
```

#### Step 1.3: Post-Deploy Verification

```bash
# Verify contract on Polygonscan
# Verify ERC-165 interface support
cast call $DEPLOYED_CONTRACT "supportsInterface(bytes4)" "0x..." --rpc-url $POLYGON_RPC_URL

# Log deployment
export VAULT_1_CONTRACT_ADDRESS=$DEPLOYED_CONTRACT
echo "Contract deployed at: $VAULT_1_CONTRACT_ADDRESS" >> .sisyphus/deployment-log.txt
```

**Duration**: 10 minutes (includes verification)  
**Rollback**: See Section 4 (contract rollback procedures)

---

### Phase 2: Backend Deployment (vault-api)

**Order**: After contract deployment confirmed  
**Parallel**: Web deployment can start in parallel after API health confirmed

#### Step 2.1: Environment Configuration

Required environment updates:

```bash
# apps/vault-api/.env.production
VAULT_MODE=production
POLYGON_RPC_URL=https://polygon-rpc.com

# Contract address from Phase 1
VAULT_1_CONTRACT_ADDRESS=0x...DEPLOYED_ADDRESS...

# Epoch duration must match contract constructor
VAULT_1_EPOCH_DURATION_SECONDS=3600

# Wallet keys (existing, no change needed)
VAULT_1_ALLOCATOR_NAV_KEY=...
VAULT_1_SAFE_OPERATOR_KEY=...
VAULT_1_TRADING_SIGNER_KEY=...
```

#### Step 2.2: Deploy Commands

```bash
# Build verification
pnpm --filter vault build

# Database readiness check (no migrations needed for fresh deploy)
pnpm --filter vault exec tsx scripts/verify-db-connection.ts

# Start with health check
pnpm --filter vault start:prod &
sleep 5

# Health verification
curl -s http://localhost:3001/health | jq '.status'
curl -s http://localhost:3001/api/vaults/1/info | jq '.contractAddress'
```

#### Step 2.3: API Validation

```bash
# Test endpoints
curl -X POST http://localhost:3001/api/vaults/1/redeem \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"shares": "1000000", "controller": "0x..."}'

curl http://localhost:3001/api/vaults/1/epochs/current
```

**Duration**: 5 minutes  
**Rollback**: See Section 4 (API rollback procedures)

---

### Phase 3: Frontend Deployment (vault-web)

**Order**: After API health confirmed  
**Parallel**: Yes (with API finalization)

#### Step 3.1: Environment Configuration

```bash
# apps/vault-web/.env.production
NEXT_PUBLIC_API_URL=https://api.vault.yourdomain.com
NEXT_PUBLIC_REOWN_PROJECT_ID=...
```

#### Step 3.2: Build and Deploy

```bash
# Build
pnpm --filter vault-web build

# Deploy (example: Vercel)
vercel --prod --cwd apps/vault-web

# Or: Static export to CDN
pnpm --filter vault-web export
# Upload dist/ to S3/CloudFront
```

#### Step 3.3: Smoke Test

```bash
# Verify frontend loads
curl -s https://vault.yourdomain.com | grep -q "ERC-7540"

# E2E verification
pnpm --filter vault-web exec playwright test --grep "lifecycle"
```

**Duration**: 5 minutes  
**Rollback**: See Section 4 (web rollback procedures)

---

### Phase 4: Integration Validation

**Order**: After all components deployed  
**Parallel**: No (end-to-end verification)

#### Step 4.1: Contract/API Alignment

```bash
# Verify API reads correct contract state
curl http://localhost:3001/api/vaults/1/info | jq '.epochDuration'
# Expected: 3600 (matches contract)

curl http://localhost:3001/api/vaults/1/epochs/current | jq '.status'
# Expected: "active" or "settled"
```

#### Step 4.2: Full Lifecycle E2E

```bash
# Execute T14 QA scenario
cd apps/vault-web
pnpm exec playwright test e2e/erc7540-lifecycle.spec.ts

# Evidence capture
cp -r test-results .sisyphus/evidence/deployment-e2e/
```

**Duration**: 10 minutes  
**Rollback**: Trigger Phase 4.3 if any check fails

#### Step 4.3: Rollback Trigger Conditions

| Condition                   | Action                                  | Responsible   |
| --------------------------- | --------------------------------------- | ------------- |
| Contract interface mismatch | Full rollback (Phase 4)                 | Deploy Lead   |
| API health fail             | Rollback API (Phase 2)                  | Backend Lead  |
| E2E test failure            | Decision point: fix-forward vs rollback | Tech Lead     |
| 5xx errors > 1%             | Immediate web rollback (Phase 3)        | Frontend Lead |

**Duration**: 5 minutes (decision) + rollback execution time

---

### Phase 5: Monitoring Handoff

**Order**: After integration validation passes  
**Duration**: 5 minutes

#### Step 5.1: Verification Checklist

- [ ] Contract verified on Polygonscan
- [ ] API health endpoint returns 200
- [ ] Frontend loads without console errors
- [ ] E2E lifecycle test passes
- [ ] All evidence artifacts captured

#### Step 5.2: Handoff Documentation

```bash
# Generate deployment report
cat > .sisyphus/deployment-report-$(date +%Y%m%d).md << 'EOF'
# Deployment Report: ERC-7540 Rewrite

## Deployment Time
$(date -u +"%Y-%m-%d %H:%M:%S UTC")

## Contract
- Address: $VAULT_1_CONTRACT_ADDRESS
- Tx Hash: $DEPLOY_TX_HASH
- Verified: Yes

## API
- Version: $(git rev-parse --short HEAD)
- Health: OK

## Web
- Version: $(git rev-parse --short HEAD)
- Status: Live

## Evidence
- E2E: .sisyphus/evidence/deployment-e2e/
- Interface: .sisyphus/evidence/task-8-interface-ids.txt
EOF
```

---

## 3) Database Migration Scripts

### 3.1 Schema State

**Status**: No breaking schema changes required for ERC-7540 rewrite.

The existing schema in `apps/vault-api/src/db/schema.ts` already supports:

- Request tracking with controller/owner fields
- Epoch-based settlement records
- NAV update history

### 3.2 Fresh Deploy Script

For clean environment setup:

```bash
#!/bin/bash
# scripts/init-db-fresh.sh

set -e

echo "Initializing fresh database for ERC-7540 deployment..."

# Generate migrations (if schema changed)
cd apps/vault-api
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Verify schema
pnpm exec tsx scripts/verify-schema.ts

echo "Database initialization complete."
```

### 3.3 Verification Queries

```sql
-- Verify request table supports ERC-7540 lifecycle
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'redemption_requests'
AND column_name IN ('status', 'controller', 'owner', 'shares', 'claimable_assets');

-- Expected: All columns present with appropriate types
```

---

## 4) Rollback Procedures

### 4.1 Contract Rollback (High Complexity)

**Critical**: Contracts are immutable. True rollback requires contract redeployment.

#### Option A: Emergency Pause (Recommended First Response)

```solidity
// WeeklyEpochVault.sol has emergency mode
// Admin can trigger via multisig

function enableEmergencyMode() external onlyRole(ADMIN_ROLE) {
    emergencyMode = true;
    emit EmergencyModeEnabled();
}
```

**Effect**: Blocks new redemption requests. Existing claims remain functional.

**Execution**:

```bash
# Via cast
cast send $VAULT_1_CONTRACT_ADDRESS \
  "enableEmergencyMode()" \
  --rpc-url $POLYGON_RPC_URL \
  --private-key $ADMIN_KEY
```

#### Option B: Contract Redeployment (Nuclear Option)

If contract has critical flaw:

1. **Pause current contract** (Option A)
2. **Deploy new contract** with fix
3. **Update API environment** with new address
4. **Redeploy API** (Phase 2)
5. **Redeploy Web** (Phase 3)
6. **Notify users** of new vault address

**Downtime**: 30+ minutes  
**User Impact**: High (must migrate to new vault)

### 4.2 API Rollback (Low Complexity)

**Blue/Green Rollback**:

```bash
# If using PM2 with blue/green
pm2 stop vault-api-green
pm2 start vault-api-blue  # Previous version

# Or: Docker compose
docker-compose down
docker-compose -f docker-compose.previous.yml up -d

# Verify rollback
curl http://localhost:3001/health
```

**Duration**: 30 seconds  
**User Impact**: Minimal (brief connection reset)

### 4.3 Web Rollback (Low Complexity)

**Vercel Rollback**:

```bash
# List deployments
vercel ls

# Rollback to previous
vercel --prod --cwd apps/vault-web [PREVIOUS_DEPLOYMENT_ID]
```

**CDN Rollback**:

```bash
# If using S3/CloudFront
aws s3 sync s3://vault-web-backup/$(date -d '1 hour ago' +%Y%m%d-%H) s3://vault-web-prod
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

**Duration**: 1-2 minutes  
**User Impact**: None (atomic switch)

### 4.4 Full System Rollback Decision Tree

```
                        ┌─────────────────┐
                        │  Issue Detected │
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │ Contract │      │   API    │      │   Web    │
        │   Bug    │      │   Bug    │      │   Bug    │
        └────┬─────┘      └────┬─────┘      └────┬─────┘
             │                 │                 │
             ▼                 ▼                 ▼
    ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
    │ Enable Emergency│  │ Rollback API │  │ Rollback Web │
    │     Mode       │  │   (30s)      │  │   (1 min)    │
    └───────┬────────┘  └──────┬───────┘  └──────┬───────┘
            │                  │                 │
            ▼                  ▼                 ▼
    ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
    │ If Critical:   │  │ Verify       │  │ Verify       │
    │ Redeploy       │  │ /health      │  │ smoke test   │
    │ Contract       │  │              │  │              │
    └────────────────┘  └──────────────┘  └──────────────┘
```

---

## 5) Health Check Commands

### 5.1 Contract Health

```bash
# Verify contract is reachable and not paused
cast call $VAULT_1_CONTRACT_ADDRESS "emergencyMode()" --rpc-url $POLYGON_RPC_URL
# Expected: false

# Verify epoch progression
cast call $VAULT_1_CONTRACT_ADDRESS "currentEpoch()" --rpc-url $POLYGON_RPC_URL

# Verify NAV freshness
cast call $VAULT_1_CONTRACT_ADDRESS "latestNAV()" --rpc-url $POLYGON_RPC_URL
cast call $VAULT_1_CONTRACT_ADDRESS "latestNAVTimestamp()" --rpc-url $POLYGON_RPC_URL
```

### 5.2 API Health

```bash
# Basic health
curl -s http://$API_HOST/health | jq -e '.status == "healthy"'

# Vault info alignment
curl -s http://$API_HOST/api/vaults/1/info | jq -e '.contractAddress == env.VAULT_1_CONTRACT_ADDRESS'

# Epoch status
curl -s http://$API_HOST/api/vaults/1/epochs/current | jq -e '.epochId >= 0'
```

### 5.3 Web Health

```bash
# Page load
curl -s -o /dev/null -w "%{http_code}" https://$WEB_HOST
# Expected: 200

# API connectivity (from browser perspective)
curl -s https://$WEB_HOST/api/health  # If using Next.js API routes

# E2E health
pnpm --filter vault-web exec playwright test e2e/smoke.spec.ts
```

### 5.4 Integration Health (All Systems)

```bash
#!/bin/bash
# scripts/full-health-check.sh

set -e

echo "=== Contract Health ==="
cast call $VAULT_1_CONTRACT_ADDRESS "supportsInterface(bytes4)" "0xe155a385" \
  --rpc-url $POLYGON_RPC_URL | grep -q "0x0000000000000000000000000000000000000000000000000000000000000001"
echo "✓ ERC-7540 interface supported"

echo "=== API Health ==="
curl -sf http://$API_HOST/health > /dev/null
echo "✓ API healthy"

echo "=== Web Health ==="
curl -sf https://$WEB_HOST > /dev/null
echo "✓ Web accessible"

echo "=== Integration ==="
EPOCH_API=$(curl -s http://$API_HOST/api/vaults/1/epochs/current | jq '.epochId')
EPOCH_CHAIN=$(cast call $VAULT_1_CONTRACT_ADDRESS "currentEpoch()" --rpc-url $POLYGON_RPC_URL | cast to-dec)
[ "$EPOCH_API" = "$EPOCH_CHAIN" ] && echo "✓ Epoch sync OK"

echo "=== All Health Checks Passed ==="
```

---

## 6) Coordination Checklist

### 6.1 Pre-Deployment

#### Technical Readiness

- [ ] All T1-T15 tasks completed and evidence captured
- [ ] Final verification (F1-F4) passed
- [ ] Contract bytecode audited (if required by policy)
- [ ] Gas estimates reviewed and funded
- [ ] Environment variables configured for production
- [ ] Database connection verified
- [ ] Monitoring dashboards configured

#### Team Coordination

| Role         | Responsibility       | Pre-Deploy Action         |
| ------------ | -------------------- | ------------------------- |
| Deploy Lead  | Overall coordination | Confirm all gates passed  |
| Contract Dev | Contract deployment  | Verify constructor params |
| Backend Dev  | API deployment       | Confirm env vars set      |
| Frontend Dev | Web deployment       | Confirm build passes      |
| QA           | Validation           | Run final E2E suite       |
| Security     | Emergency procedures | Verify multisig access    |

#### Communication Plan

- [ ] Deploy window announced (recommend: low-traffic hours)
- [ ] Rollback team on standby
- [ ] Status page prepared for updates
- [ ] Incident response channel active

### 6.2 Deployment Execution

#### Phase Gates

| Phase | Gate Check                       | Sign-off Required |
| ----- | -------------------------------- | ----------------- |
| 0     | All tests green                  | Deploy Lead       |
| 1     | Contract verified on Polygonscan | Contract Dev      |
| 2     | API health returns 200           | Backend Dev       |
| 3     | Web smoke test passes            | Frontend Dev      |
| 4     | E2E lifecycle complete           | QA                |
| 5     | Monitoring handoff               | Deploy Lead       |

#### Real-Time Coordination

```
Time    Channel                    Message
T-30min #deploy-war-room           "Starting Phase 0 validation"
T-15min #deploy-war-room           "Phase 0 complete. Proceeding to Phase 1."
T-5min  #deploy-war-room           "Contract deployment starting."
T+0     #deploy-war-room           "Contract deployed at 0x..."
T+10min #deploy-war-room           "Phase 1 complete. Starting Phase 2."
T+15min #deploy-war-room           "API deployed and healthy."
T+20min #deploy-war-room           "Web deployed. Starting Phase 4."
T+30min #deploy-war-room           "All phases complete. Deployment successful."
```

### 6.3 Post-Deployment

#### Immediate (0-1 hour)

- [ ] Full health check executed
- [ ] Evidence artifacts archived
- [ ] Deployment report generated
- [ ] Team notified of success

#### Short-term (1-24 hours)

- [ ] Monitor error rates
- [ ] Monitor gas usage patterns
- [ ] Verify epoch progression
- [ ] Check redemption request volume

#### Long-term (1-7 days)

- [ ] Review operator action logs
- [ ] Verify NAV updates occurring
- [ ] Analyze claim patterns
- [ ] Document lessons learned

---

## 7) Risk Mitigation

### 7.1 Risk Register

| Risk                      | Likelihood | Impact   | Mitigation                                             |
| ------------------------- | ---------- | -------- | ------------------------------------------------------ |
| Contract deployment fails | Low        | High     | Pre-deploy dry-run; funded wallet; retry logic         |
| Wrong constructor params  | Low        | Critical | Triple-check against VAULT_KNOWLEDGE.md; peer review   |
| API contract mismatch     | Medium     | High     | Automated ABI verification in CI; T9 integration tests |
| Front-end API mismatch    | Medium     | Medium   | Type generation from OpenAPI; E2E coverage             |
| Gas price spike           | Medium     | Medium   | Deploy during low-traffic window; max gas limit set    |
| RPC node failure          | Low        | High     | Multi-RPC fallback; retry with exponential backoff     |
| Operator permission issue | Low        | High     | T7 operator tests; multisig for admin actions          |
| Epoch/NAV desync          | Low        | High     | T12 extension tests; monitoring alerts                 |

### 7.2 Contingency Procedures

#### Gas Price Spike

```bash
# If gas > 500 gwei, pause and retry
GAS_PRICE=$(cast gas-price --rpc-url $POLYGON_RPC_URL | cast to-gwei)
if [ "$GAS_PRICE" -gt 500 ]; then
  echo "Gas price too high ($GAS_PRICE gwei). Pausing deployment."
  exit 1
fi
```

#### RPC Node Failure

```bash
# Multi-RPC fallback
RPC_URLS=(
  "https://polygon-rpc.com"
  "https://rpc.ankr.com/polygon"
  "https://polygon.llamarpc.com"
)

for url in "${RPC_URLS[@]}"; do
  if cast block-number --rpc-url $url > /dev/null 2>&1; then
    export POLYGON_RPC_URL=$url
    echo "Using RPC: $url"
    break
  fi
done
```

#### Stuck Deployment

If contract deployment transaction is pending > 10 minutes:

1. **Do NOT** resubmit (risk of double deploy)
2. Check transaction status on Polygonscan
3. If pending: wait or speed up with higher gas
4. If failed: analyze revert reason, fix, retry

```bash
# Speed up pending transaction
cast publish --rpc-url $POLYGON_RPC_URL <raw-signed-tx-with-higher-gas>
```

### 7.3 Monitoring Alerts

Configure alerts for:

```yaml
# Example alert rules
alerts:
  - name: ContractEmergencyMode
    condition: emergencyMode == true
    severity: critical
    action: Page on-call immediately

  - name: HighErrorRate
    condition: error_rate_5m > 5%
    severity: warning
    action: Investigate API logs

  - name: EpochStalled
    condition: current_epoch_unchanged_for > 2_hours
    severity: warning
    action: Check settlement bot

  - name: NAVStale
    condition: nav_age > 6_hours
    severity: warning
    action: Check NAV oracle

  - name: FailedRedemptions
    condition: failed_redeems_1h > 10
    severity: warning
    action: Review contract state
```

---

## 8) Environment Variable Reference

### 8.1 Contract Deployment (.env)

```bash
# Required for forge script
POLYGON_RPC_URL=https://polygon-rpc.com
PRIVATE_KEY=0x...                              # Deployer key
ETHERSCAN_API_KEY=...                          # For verification

# Constructor parameters
DEPLOY_ASSET=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174  # USDC
DEPLOY_ADMIN=0x...                             # Multisig
DEPLOY_SETTLER=0x...                           # Bot address
DEPLOY_NAV_UPDATER=0x...                       # Oracle address
DEPLOY_EPOCH_DURATION=3600                     # 1 hour
DEPLOY_NAV_STALENESS=21600                     # 6 hours
```

### 8.2 vault-api (.env.production)

```bash
# Server
VAULT_PORT=3001
VAULT_SESSION_SECRET=...

# Database
VAULT_DATABASE_URL=postgresql://...

# Blockchain
POLYGON_RPC_URL=https://polygon-rpc.com

# Deployment-specific (from Phase 1)
VAULT_1_CONTRACT_ADDRESS=0x...DEPLOYED_ADDRESS...
VAULT_1_EPOCH_DURATION_SECONDS=3600

# Runtime mode
VAULT_MODE=production
VAULT_CLOB_SIGNATURE_TYPE=prod

# Wallets
VAULT_1_ALLOCATOR_NAV_KEY=...
VAULT_1_SAFE_OPERATOR_KEY=...
VAULT_1_TRADING_SIGNER_KEY=...
```

### 8.3 vault-web (.env.production)

```bash
NEXT_PUBLIC_API_URL=https://api.vault.yourdomain.com
NEXT_PUBLIC_REOWN_PROJECT_ID=...
```

---

## 9) Evidence Artifact Mapping

| Evidence File                   | Source  | Description                 | Gate    |
| ------------------------------- | ------- | --------------------------- | ------- |
| `task-15-full-pass.txt`         | T15     | Full build/test pass        | Phase 0 |
| `task-8-interface-ids.txt`      | T8      | ERC-165 verification        | Phase 0 |
| `deployment-contract.json`      | Phase 1 | Contract deployment receipt | Phase 1 |
| `deployment-e2e/`               | Phase 4 | E2E test results            | Phase 4 |
| `deployment-report-YYYYMMDD.md` | Phase 5 | Final report                | Phase 5 |

---

## 10) Quick Reference Card

### Emergency Contacts

| Role         | Contact | Escalation |
| ------------ | ------- | ---------- |
| Deploy Lead  | ...     | CEO        |
| Contract Dev | ...     | CTO        |
| Backend Dev  | ...     | Tech Lead  |
| Frontend Dev | ...     | Tech Lead  |

### Critical Commands

```bash
# Emergency pause
cast send $VAULT_1_CONTRACT_ADDRESS "enableEmergencyMode()" --rpc-url $POLYGON_RPC_URL --private-key $ADMIN_KEY

# API rollback
pm2 stop vault-api-green && pm2 start vault-api-blue

# Web rollback
vercel --prod [PREVIOUS_DEPLOYMENT]

# Full health check
./scripts/full-health-check.sh

# View logs
pm2 logs vault-api
docker logs vault-api-container
```

### Key URLs

| Resource       | URL                                                       |
| -------------- | --------------------------------------------------------- |
| Production API | https://api.vault.yourdomain.com                          |
| Production Web | https://vault.yourdomain.com                              |
| Polygonscan    | https://polygonscan.com/address/$VAULT_1_CONTRACT_ADDRESS |
| Status Page    | https://status.yourdomain.com                             |

---

## Appendix A: Deployment Runbook Template

```bash
#!/bin/bash
# deploy-production.sh - Executable runbook

set -euo pipefail

# Configuration
export VAULT_1_CONTRACT_ADDRESS=""  # Set after Phase 1
export POLYGON_RPC_URL="https://polygon-rpc.com"
export API_HOST="api.vault.yourdomain.com"
export WEB_HOST="vault.yourdomain.com"

log() { echo "[$(date +%H:%M:%S)] $*"; }

gate_check() {
  log "Phase 0: Pre-deployment validation"
  cd contracts && forge test --match-contract WeeklyEpochVault
  cd ..
  pnpm --filter vault build
  pnpm --filter vault exec vitest --run
  pnpm --filter vault-web build
  log "✓ Phase 0 complete"
}

deploy_contract() {
  log "Phase 1: Contract deployment"
  cd contracts
  forge script scripts/deployWeeklyEpochVault.js --rpc-url $POLYGON_RPC_URL --verify --broadcast
  export VAULT_1_CONTRACT_ADDRESS=$(cat broadcast/WeeklyEpochVault.s.sol/137/run-latest.json | jq -r '.receipts[0].contractAddress')
  log "✓ Contract deployed at $VAULT_1_CONTRACT_ADDRESS"
  cd ..
}

deploy_api() {
  log "Phase 2: API deployment"
  echo "VAULT_1_CONTRACT_ADDRESS=$VAULT_1_CONTRACT_ADDRESS" >> apps/vault-api/.env.production
  pnpm --filter vault build
  # Deploy logic here
  log "✓ API deployed"
}

deploy_web() {
  log "Phase 3: Web deployment"
  pnpm --filter vault-web build
  # Deploy logic here
  log "✓ Web deployed"
}

validate() {
  log "Phase 4: Integration validation"
  ./scripts/full-health-check.sh
  pnpm --filter vault-web exec playwright test e2e/erc7540-lifecycle.spec.ts
  log "✓ Validation complete"
}

# Main
log "Starting deployment..."
gate_check
deploy_contract
deploy_api
deploy_web
validate
log "Deployment complete!"
```

---

_Document Version: 1.0_  
_Created: 2025-03-03_  
_Related: T16 (Documentation), T17 (Release Checklist), VAULT_KNOWLEDGE.md_
