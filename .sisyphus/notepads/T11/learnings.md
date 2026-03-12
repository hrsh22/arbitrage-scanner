
## T11 Amoy Batch Lifecycle Test Run - 2026-03-11 19:49 UTC

**Status:** ✅ PASSED
**Duration:** 46s
**Vault:** 0x66e665a6B8898920e76f263eAa729afd716c1470
**Tested Batch:** 0

### Key Findings

- Closed-book batch flow: Issues detected
- Batch cutoff/flatten: Issues detected
- Flatness readiness (lockedClearingPrice): Price lock failed
- Deposit processing at locked price: Issues detected
- Batch settlement: Issues detected
- Reopen for next cycle: Issues detected

### Learnings

- The closed-book batch model ensures all deposits in a batch mint at the SAME locked clearing price
- Flattening locks the clearing price BEFORE deposit processing, excluding sealed deposits from price calc
- Settlement computes claimable assets for redemptions using the locked price
- Pro-rata distribution applied if insufficient assets for all redemptions
- Batch lifecycle is strictly sequential: Open -> Cutoff -> Flattening -> Settling -> Settled -> Closed -> Reopen

