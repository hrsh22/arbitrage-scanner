/**
 * Claim State Machine
 *
 * Manages deterministic state transitions for the redemption claim lifecycle.
 *
 * SUPPORTED MODEL: Closed-Book Batch Processing (Flat-then-Process)
 * - OPEN: Batch is accepting new redemption requests
 * - CUTOFF: First request accepted in OPEN seals the batch; no new requests accepted
 * - FLATTENING: Vault positions are being flattened to prepare for settlement
 * - SETTLING: Batch settlement in progress, entitlements being calculated
 * - REOPEN: Settlement complete, vault reopens for next batch
 *
 * BATCH SEALING RULE:
 * - First accepted redemption request in OPEN state seals the active batch
 * - Subsequent requests route to the next batch (queued for future processing)
 *
 * CANCELLATION RULE:
 * - Cancellation is IMPOSSIBLE after CUTOFF
 * - Requests are irreversible once the batch is sealed
 *
 * LEGACY/DEPRECATED (WeeklyEpochVault/EpochTrancheVault reference only):
 * - Epoch-based settlement with time-driven boundaries
 * - Partial realization between settlement boundaries
 * - These patterns are NOT supported in the closed-book batch model
 *
 * This module enforces valid state transitions and provides validation
 * for claim operations at each lifecycle stage.
 */

import { logger } from "../logger.js";

// ============================================================================
// State Enum - Closed-Book Batch Model
// ============================================================================

/**
 * Claim lifecycle states for closed-book batch processing
 *
 * Lifecycle: OPEN -> CUTOFF -> FLATTENING -> SETTLING -> SETTLED -> CLOSED -> REOPEN
 */
export const ClaimState = {
  /** Batch is open and accepting redemption requests */
  OPEN: "open",
  /**
   * CUTOFF: First request has sealed the batch
   * - No new redemption requests accepted in this batch
   * - Cancellation is IMPOSSIBLE from this point forward
   */
  CUTOFF: "cutoff",
  /** Flattening positions to prepare for settlement */
  FLATTENING: "flattening",
  /** Settlement in progress, calculating entitlements */
  SETTLING: "settling",
  /** Settlement complete, ready for claims */
  SETTLED: "settled",
  /** All claims processed, batch complete */
  CLOSED: "closed",
  /**
   * REOPEN: Vault has reopened for next batch (terminal state for previous batch)
   * - All previous batch claims must be completed
   */
  REOPEN: "reopen",
  /**
   * LEGACY/FUTURE: Gradual realization state - NOT supported in closed-book model
   * NOTE: Requires cohort-accounting architecture (not built).
   * For closed-book batch settlement, use SETTLING -> SETTLED path only.
   */
  FUTURE_PARTIALLY_REALIZED: "future_partially_realized",
  /**
   * LEGACY/FUTURE: Gradual realization complete - NOT supported in closed-book model
   * NOTE: For batch settlement, entitlements go directly to claimable
   */
  FUTURE_FULLY_REALIZED: "future_fully_realized",
} as const;

export type ClaimState = (typeof ClaimState)[keyof typeof ClaimState];

// ============================================================================
// Valid State Transitions - Closed-Book Batch Model
// ============================================================================

/**
 * Valid state transitions matrix
 *
 * CLOSED-BOOK BATCH MODEL (Current Supported):
 * - open -> cutoff: First request seals the batch
 * - cutoff -> flattening: Begin position flattening
 * - flattening -> settling: Positions flattened, begin settlement
 * - settling -> settled: Settlement complete, entitlements available
 * - settled -> closed: All claims processed
 * - closed -> reopen: Batch fully complete, vault ready for next batch
 *
 * CANCELLATION RULE:
 * - Cancellation only possible in OPEN state (before batch is sealed)
 * - Once CUTOFF is reached, cancellation is IMPOSSIBLE
 *
 * LEGACY/FUTURE (NOT supported in closed-book model):
 * - frozen -> FUTURE_PARTIALLY_REALIZED -> FUTURE_FULLY_REALIZED
 * - These transitions exist for type safety but gradual realization is NOT supported
 */
export const validClaimTransitions: Record<ClaimState, ClaimState[]> = {
  // CLOSED-BOOK BATCH: First request seals the batch
  open: ["cutoff"],
  // CLOSED-BOOK BATCH: Cutoff triggers flattening phase
  cutoff: ["flattening"],
  // CLOSED-BOOK BATCH: Flattening completes, begin settlement
  flattening: ["settling"],
  // CLOSED-BOOK BATCH: Settlement in progress
  settling: ["settled"],
  // CLOSED-BOOK BATCH: Settlement complete, process claims
  settled: ["closed"],
  // CLOSED-BOOK BATCH: All claims complete, reopen for next batch
  closed: ["reopen"],
  // Terminal state for batch lifecycle - no further transitions
  reopen: [],
  // LEGACY/FUTURE: gradual realization paths - NOT supported in closed-book model
  future_partially_realized: ["future_fully_realized", "settled"],
  future_fully_realized: ["settled", "closed"],
};

// ============================================================================
// State Validation
// ============================================================================

/**
 * Check if a state transition is valid
 */
export function isValidClaimTransition(fromState: ClaimState, toState: ClaimState): boolean {
  if (fromState === toState) return true; // Same state is always valid
  return validClaimTransitions[fromState]?.includes(toState) ?? false;
}

/**
 * Result of state transition validation
 */
export interface StateTransitionResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a state transition and return detailed result
 */
export function validateClaimTransition(
  fromState: ClaimState,
  toState: ClaimState,
): StateTransitionResult {
  if (fromState === toState) {
    return { valid: true };
  }

  const validTransitions = validClaimTransitions[fromState];
  if (!validTransitions?.includes(toState)) {
    return {
      valid: false,
      error:
        `Invalid state transition: ${fromState} -> ${toState}. ` +
        `Valid transitions from ${fromState}: ${validTransitions?.join(", ") || "none"}`,
    };
  }

  return { valid: true };
}

// ============================================================================
// Claim Operation Validation
// ============================================================================

/**
 * Operations that can be performed on a claim
 */
export const ClaimOperation = {
  /** Query claim status */
  VIEW: "view",
  /** Request redemption (creates new claim) - only in OPEN state */
  REQUEST: "request",
  /** Cancel pending request - only in OPEN state (before CUTOFF) */
  CANCEL: "cancel",
  /** Claim available payouts - only after SETTLED */
  CLAIM: "claim",
  /** View realization history */
  VIEW_HISTORY: "view_history",
} as const;

export type ClaimOperation = (typeof ClaimOperation)[keyof typeof ClaimOperation];

/**
 * Valid operations per state - Closed-Book Batch Model
 *
 * CLOSED-BOOK BATCH MODEL:
 * - REQUEST: Only allowed in OPEN state (before batch is sealed)
 * - CANCEL: Only allowed in OPEN state (before CUTOFF)
 * - CLAIM: Only allowed after settlement is complete (SETTLED state)
 * - VIEW: Always allowed
 *
 * CANCELLATION RULE:
 * - Cancellation is IMPOSSIBLE after CUTOFF
 * - Once batch is sealed (CUTOFF reached), requests are irreversible
 *
 * LEGACY/FUTURE:
 * - FUTURE_PARTIALLY_REALIZED and FUTURE_FULLY_REALIZED have limited operations
 *   because gradual realization is not implemented in closed-book model
 */
export const validOperationsByState: Record<ClaimState, ClaimOperation[]> = {
  // CLOSED-BOOK BATCH: OPEN state accepts new requests and allows cancellation
  open: [ClaimOperation.VIEW, ClaimOperation.REQUEST, ClaimOperation.CANCEL],
  // CLOSED-BOOK BATCH: CUTOFF state - batch sealed, no new requests or cancellation
  cutoff: [ClaimOperation.VIEW],
  // CLOSED-BOOK BATCH: FLATTENING state - positions being flattened
  flattening: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
  // CLOSED-BOOK BATCH: SETTLING state - calculating entitlements
  settling: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
  // CLOSED-BOOK BATCH: SETTLED state - claims available
  settled: [ClaimOperation.VIEW, ClaimOperation.CLAIM, ClaimOperation.VIEW_HISTORY],
  // CLOSED-BOOK BATCH: CLOSED state - all claims processed
  closed: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
  // CLOSED-BOOK BATCH: REOPEN state - ready for next batch
  reopen: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
  // LEGACY/FUTURE: No claim operations in gradual realization states
  future_partially_realized: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
  future_fully_realized: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
};

/**
 * Check if an operation is valid for a given state
 */
export function isValidOperationForState(operation: ClaimOperation, state: ClaimState): boolean {
  return validOperationsByState[state]?.includes(operation) ?? false;
}

/**
 * Validate claim operation and return detailed result
 */
export function validateClaimOperation(
  operation: ClaimOperation,
  state: ClaimState,
): { valid: boolean; error?: string } {
  if (isValidOperationForState(operation, state)) {
    return { valid: true };
  }

  const validOps = validOperationsByState[state];
  return {
    valid: false,
    error:
      `Operation '${operation}' is not valid for claim in state '${state}'. ` +
      `Valid operations: ${validOps?.join(", ") || "none"}`,
  };
}

// ============================================================================
// Ownership Validation
// ============================================================================

/**
 * Result of ownership verification
 */
export interface OwnershipResult {
  isOwner: boolean;
  actualOwner?: string;
  error?: string;
}

/**
 * Verify that the requesting user owns the claim
 */
export function verifyClaimOwnership(
  claimOwnerAddress: string,
  requestingUserAddress: string,
): OwnershipResult {
  const normalizedOwner = claimOwnerAddress.toLowerCase();
  const normalizedRequester = requestingUserAddress.toLowerCase();

  if (normalizedOwner === normalizedRequester) {
    return { isOwner: true };
  }

  logger.warn("Claim ownership verification failed", {
    claimOwner: normalizedOwner,
    requestingUser: normalizedRequester,
  });

  return {
    isOwner: false,
    actualOwner: normalizedOwner,
    error: "Not authorized: You do not own this claim",
  };
}

// ============================================================================
// State Machine Guard
// ============================================================================

/**
 * High-level guard function that validates both ownership and state
 * for claim operations.
 */
export function guardClaimOperation(options: {
  claimOwner: string;
  requestingUser: string;
  currentState: ClaimState;
  operation: ClaimOperation;
}): { allowed: boolean; error?: string; code?: number } {
  // First check ownership
  const ownership = verifyClaimOwnership(options.claimOwner, options.requestingUser);
  if (!ownership.isOwner) {
    return {
      allowed: false,
      error: ownership.error,
      code: 403, // Forbidden
    };
  }

  // Then check state
  const stateValidation = validateClaimOperation(options.operation, options.currentState);
  if (!stateValidation.valid) {
    return {
      allowed: false,
      error: stateValidation.error,
      code: 409, // Conflict - operation not valid in current state
    };
  }

  return { allowed: true };
}

// ============================================================================
// State Mapping (from DB schema to state machine)
// ============================================================================

/**
 * Map request/batch status to ClaimState
 *
 * CLOSED-BOOK BATCH MAPPING (Supported):
 * - pending -> open: Request created, batch is accepting requests
 * - cutoff -> cutoff: Batch sealed by first request
 * - flattening -> flattening: Flattening positions
 * - settling -> settling: Settlement in progress
 * - claimable/settled -> settled: Batch settlement complete
 * - claimed -> closed: All claims processed for this batch
 *
 * LEGACY MAPPING (for backward compatibility during migration):
 * - Legacy epoch-based status values map to equivalent batch states
 */
export function mapRequestStatusToClaimState(
  requestStatus: string,
  entitlementStatus?: string,
): ClaimState {
  // Use entitlement info to determine state
  if (entitlementStatus) {
    switch (entitlementStatus) {
      case "partially_fulfilled":
        // CLOSED-BOOK BATCH: Treat as SETTLED (full settlement)
        return ClaimState.SETTLED;
      case "fully_fulfilled":
        // CLOSED-BOOK BATCH: Maps to SETTLED (all claims available)
        return ClaimState.SETTLED;
      case "pending":
        return ClaimState.SETTLING;
      default:
        break;
    }
  }

  // Map request status to claim state
  switch (requestStatus) {
    case "pending":
      return ClaimState.OPEN;
    case "cutoff":
      return ClaimState.CUTOFF;
    case "flattening":
      return ClaimState.FLATTENING;
    case "settling":
      return ClaimState.SETTLING;
    case "claimable":
    case "settled":
      // CLOSED-BOOK BATCH: claimable/settled = batch settlement complete
      return ClaimState.SETTLED;
    case "claimed":
      return ClaimState.CLOSED;
    case "cancelled":
      return ClaimState.CLOSED;
    default:
      return ClaimState.OPEN;
  }
}

/**
 * Determine next state based on claim progress
 *
 * CLOSED-BOOK BATCH MODEL (Current - Supported):
 * - Full settlement happens at end of batch cycle: settling -> settled
 * - No gradual realization during batch processing
 * - Claims processed after settlement, then batch closes
 *
 * LEGACY/FUTURE (Gradual Realization - Not Implemented):
 * - Would track partial realizations as positions resolve
 * - Requires cohort-accounting architecture
 */
export function determineNextState(options: {
  currentState: ClaimState;
  totalRealized: string;
  totalEntitlement: string;
  totalClaimed: string;
}): ClaimState {
  const { currentState, totalRealized, totalEntitlement, totalClaimed } = options;

  const realized = BigInt(totalRealized);
  const entitlement = BigInt(totalEntitlement);
  const claimed = BigInt(totalClaimed);

  // CLOSED-BOOK BATCH: If everything is claimed, move to closed
  if (claimed >= entitlement && entitlement > 0n) {
    return ClaimState.CLOSED;
  }

  // CLOSED-BOOK BATCH: After settlement, funds are available
  // This is the ONLY supported path in current runtime
  if (currentState === ClaimState.SETTLED || currentState === ClaimState.SETTLING) {
    // Check if there's anything to claim (realized > 0)
    if (realized > 0n) {
      // If all realized/claimed, close it
      if (claimed >= realized) {
        return ClaimState.CLOSED;
      }
      return ClaimState.SETTLED;
    }
  }

  // LEGACY/FUTURE: Gradual realization logic
  // NOTE: This code path is NOT supported in closed-book batch model
  // Would require cohort-accounting architecture to implement properly

  return currentState;
}

// ============================================================================
// Explicit Field Mapping - Canonical vs Legacy Ledger
// ============================================================================

/**
 * Explicit field mapping between canonical and legacy fields.
 * This mapping ensures deterministic reconciliation between dual-ledger systems.
 *
 * Canonical Schema (single source of truth):
 *   - entitlement: Total entitled amount (immutable after freeze)
 *   - accrued: Amount accrued from realizations
 *   - claimed: Amount claimed by user
 *   - carryRemaining: Remaining to be carried (calculated: entitlement - claimed)
 *
 * Legacy Schema (deprecated, maintained for backward compatibility):
 *   - totalRealizedUsdc: Maps to 'accrued'
 *   - totalClaimedUsdc: Maps to 'claimed'
 */
export const LedgerFieldMapping = {
  // Canonical -> Legacy mapping
  canonical: {
    entitlement: "entitlement",
    accrued: "accrued",
    claimed: "claimed",
    carryRemaining: "carryRemaining",
  },
  // Legacy -> Canonical mapping
  legacy: {
    totalRealizedUsdc: "accrued",
    totalClaimedUsdc: "claimed",
  },
  // Reverse mapping: canonical -> legacy
  toLegacy: {
    accrued: "totalRealizedUsdc",
    claimed: "totalClaimedUsdc",
  },
} as const;

/**
 * Reason codes for ledger mismatches
 */
export const LedgerMismatchReason = {
  CANONICAL_LEGACY_ACCRUED_MISMATCH: "CANONICAL_LEGACY_ACCRUED_MISMATCH",
  CANONICAL_LEGACY_CLAIMED_MISMATCH: "CANONICAL_LEGACY_CLAIMED_MISMATCH",
  CARRY_REMAINING_CALCULATION_ERROR: "CARRY_REMAINING_CALCULATION_ERROR",
  NEGATIVE_VALUE: "NEGATIVE_VALUE",
  INVARIANT_VIOLATION: "INVARIANT_VIOLATION",
  CONTRACT_REPOSITORY_MISMATCH: "CONTRACT_REPOSITORY_MISMATCH",
} as const;

/**
 * Legacy ledger state (for migration/reconciliation)
 */
export interface LegacyLedgerState {
  totalRealizedUsdc: string;
  totalClaimedUsdc: string;
}

// ============================================================================
// Canonical Ledger Semantics
// ============================================================================

/**
 * Canonical ledger state per user
 * Invariants: 0 <= claimed <= accrued <= entitlement
 * carryRemaining = entitlement - claimed (loss-aware)
 */
export interface LedgerState {
  entitlement: string; // Total entitled amount (immutable after freeze)
  accrued: string; // Amount accrued from realizations
  claimed: string; // Amount claimed by user
  carryRemaining: string; // Remaining amount to be carried
}

/**
 * Validate ledger invariants
 * Returns true if: 0 <= claimed <= accrued <= entitlement
 */
export function validateLedgerInvariants(ledger: LedgerState): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const entitlement = BigInt(ledger.entitlement);
  const accrued = BigInt(ledger.accrued);
  const claimed = BigInt(ledger.claimed);
  const carryRemaining = BigInt(ledger.carryRemaining);

  // Invariant 1: claimed >= 0 (implied by BigInt)
  // Invariant 2: claimed <= accrued
  if (claimed > accrued) {
    errors.push(`claimed (${claimed.toString()}) > accrued (${accrued.toString()})`);
  }

  // Invariant 3: accrued <= entitlement
  if (accrued > entitlement) {
    errors.push(`accrued (${accrued.toString()}) > entitlement (${entitlement.toString()})`);
  }

  // Invariant 4: carryRemaining = entitlement - claimed (loss-aware)
  const expectedCarryRemaining = entitlement - claimed;
  if (carryRemaining !== expectedCarryRemaining) {
    errors.push(
      `carryRemaining (${carryRemaining.toString()}) != entitlement - claimed (${expectedCarryRemaining.toString()})`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate deterministic carryRemaining
 * Formula: carryRemaining = entitlement - claimed
 * This is loss-aware: negative carryRemaining indicates over-claim
 */
export function calculateCarryRemaining(entitlement: string, claimed: string): string {
  return (BigInt(entitlement) - BigInt(claimed)).toString();
}

/**
 * Get claimable amount from ledger state
 * claimable = accrued - claimed
 */
export function getClaimableAmount(ledger: LedgerState): string {
  const accrued = BigInt(ledger.accrued);
  const claimed = BigInt(ledger.claimed);
  const claimable = accrued - claimed;
  return claimable > 0n ? claimable.toString() : "0";
}
