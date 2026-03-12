# T13 Closed-Book Docs - Work Log

## 2026-03-12

### Completed

- [x] Read existing docs (operator-runbook-amoy.md, VAULT_KNOWLEDGE.md)
- [x] Read ClosedBookBatchVault.sol to understand new architecture
- [x] Updated operator-runbook-amoy.md with closed-book batch system
- [x] Updated VAULT_KNOWLEDGE.md with closed-book architecture
- [x] Documented deployment gap and QA findings
- [x] Ran grep audit to verify stale language removal
- [x] Created evidence file

### Key Changes Made

#### operator-runbook-amoy.md

- Complete rewrite targeting ClosedBookBatchVault
- Added Current State Notice banner at top
- Documented batch lifecycle: Open -> Cutoff -> Flattening -> Settling -> Settled -> Closed -> Reopen
- Added Section 9: Current Deployment Gap
- Documented QA finding about `/cycles/current` endpoint
- Added Appendix C with legacy procedures

#### VAULT_KNOWLEDGE.md

- Updated architecture to ClosedBookBatchVault
- Removed carry mechanics (not in closed-book system)
- Added deployment gap documentation
- Updated API endpoints to `/cycles/*`
- Added Section 12 documenting the current state gap

### Verification

- Grep audit confirms no stale epoch/carry claims
- All EpochTrancheVault references are contextual (deployment gap or legacy appendix)
- Closed-book terminology present throughout
