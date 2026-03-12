# T13 Evidence: Closed-Book Batch System Documentation

## Task Summary

Rewrote operator/docs/disclosure language for the closed-book batch system, documenting the deployment gap where Amoy still runs legacy EpochTrancheVault.

## Files Modified

### 1. docs/operator-runbook-amoy.md

- **Lines changed:** Complete rewrite (961 lines)
- **Key changes:**
  - Changed target contract from EpochTrancheVault to ClosedBookBatchVault
  - Updated lifecycle from `Active -> Frozen -> Settled -> Finalized` to `Open -> Cutoff -> Flattening -> Settling -> Settled -> Closed -> Reopen`
  - Documented batch/cycle terminology (queue -> cutoff -> flatten -> settle -> claim -> reopen)
  - Added "Current State Notice" banner explaining deployment gap
  - Added Section 9: "Current Deployment Gap" documenting:
    - The problem (codebase targets ClosedBookBatchVault, Amoy still has EpochTrancheVault)
    - Affected functionality table
    - Integrated QA finding about `/cycles/current` endpoint failure
    - Operator guidance for pre/post cutover
  - Added Appendix C with legacy procedures for current Amoy use

### 2. VAULT_KNOWLEDGE.md

- **Lines changed:** Complete rewrite (753 lines)
- **Key changes:**
  - Updated architecture description to ClosedBookBatchVault
  - Changed core flow to batch/cycle terminology
  - Documented deployment gap in component table
  - Added "Current Deployment Gap" section (Section 12):
    - The problem statement
    - Affected endpoints table showing `/cycles/current` is broken
    - QA finding about `currentBatchId()` function not found
    - Operator actions for pre/post cutover
  - Removed carry mechanics (not present in closed-book system)
  - Updated API endpoints from `/epochs/*` to `/cycles/*`

## Verification Results

### Grep Audit

Command: `grep -n "carry\|epoch.*settlement\|EpochTrancheVault" docs/operator-runbook-amoy.md VAULT_KNOWLEDGE.md`

**Findings:**

- All matches are contextually appropriate references to the legacy system
- No stale claims that "current production-ready model is epoch/carry settlement"
- EpochTrancheVault references appear only in:
  - Deployment gap disclosure sections
  - Appendix C (explicitly labeled "Legacy")
  - Component table (explicitly labeled "Legacy Contract")

### Closed-Book Language Verification

The following closed-book terminology is now present in both docs:

| Concept                                                 | Present in operator-runbook | Present in VAULT_KNOWLEDGE |
| ------------------------------------------------------- | --------------------------- | -------------------------- |
| ClosedBookBatchVault                                    | Yes                         | Yes                        |
| Batch/cycle lifecycle                                   | Yes                         | Yes                        |
| Open/Cutoff/Flattening/Settling/Settled/Closed/Reopen   | Yes                         | Yes                        |
| queue -> cutoff -> flatten -> settle -> claim -> reopen | Yes                         | Yes                        |
| Deployment gap disclosure                               | Yes                         | Yes                        |
| `/cycles/current` QA finding                            | Yes                         | Yes                        |

## Success Criteria

| Criterion                                 | Status |
| ----------------------------------------- | ------ |
| Docs explain closed-book cycle flow       | PASS   |
| Auth/runtime expectations documented      | PASS   |
| Deployment blocker documented             | PASS   |
| No stale epoch/carry model claims         | PASS   |
| Grep/doc audit shows closed-book language | PASS   |

## Notes

- The documents truthfully describe the current state: codebase targets ClosedBookBatchVault, but Amoy deployment is still EpochTrancheVault
- Legacy procedures are preserved in Appendix C for operators until cutover
- The `/cycles/current` endpoint QA finding is explicitly documented
- All operator guidance is concrete and action-oriented
