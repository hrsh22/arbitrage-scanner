## Task 4: Epoch-Open Snapshot Pricing - Learnings

### Pattern: Struct Field Addition

When adding fields to a struct in Solidity:

1. Update the struct definition
2. Update ALL struct initializations (constructor, freezeEpoch, etc.)
3. Update tuple destructuring in tests (match new field count)
4. Use `--via-ir` if stack too deep errors occur

### Pattern: Epoch Pricing Semantics

For epoch-based vaults with delayed mint:

- Capture NAV at epoch open boundary (not processing time)
- Store in `epochOpenNAV` field
- Use for all share calculations in that epoch
- Block processing before epoch start time

### Key Code Locations

- Epoch struct: contracts/src/EpochTrancheVault.sol:31-49
- Constructor init: contracts/src/EpochTrancheVault.sol:200-218
- freezeEpoch capture: contracts/src/EpochTrancheVault.sol:388-407
- processDepositQueue: contracts/src/EpochTrancheVault.sol:261-277

### Build Notes

- Standard build may fail with "Stack too deep"
- Use `forge build --via-ir` to resolve
- Test compilation requires matching tuple destructuring
