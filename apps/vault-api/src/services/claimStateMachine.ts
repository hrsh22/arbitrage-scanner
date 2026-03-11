/**
 * Claim State Machine
 *
 * Manages deterministic state transitions for the progressive claim lifecycle:
 * pending -> frozen -> partially_realized -> fully_realized -> closed
 *
 * This module enforces valid state transitions and provides validation
 * for claim operations at each lifecycle stage.
 */

import { logger } from "../logger.js";

// ============================================================================
// State Enum
// ============================================================================

/**
 * Claim lifecycle states
 */
export const ClaimState = {
  /** Request created, awaiting epoch freeze */
  PENDING: "pending",
  /** Epoch frozen, snapshot captured, entitlement locked */
  FROZEN: "frozen",
  /** Some realizations processed, partial payouts available */
  PARTIALLY_REALIZED: "partially_realized",
  /** All realizations complete, full entitlement available */
  FULLY_REALIZED: "fully_realized",
  /** All claims settled, request complete */
  CLOSED: "closed",
} as const;

export type ClaimState = (typeof ClaimState)[keyof typeof ClaimState];

// ============================================================================
// Valid State Transitions
// ============================================================================

/**
 * Valid state transitions matrix
 * Defines which states can transition to which other states
 */
export const validClaimTransitions: Record<ClaimState, ClaimState[]> = {
  pending: ["frozen"],
  frozen: ["partially_realized", "fully_realized"],
  partially_realized: ["fully_realized"],
  fully_realized: ["closed"],
  closed: [], // Terminal state - no further transitions
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
  /** Request redemption (creates new claim) */
  REQUEST: "request",
  /** Cancel pending request */
  CANCEL: "cancel",
  /** Claim available payouts */
  CLAIM: "claim",
  /** View realization history */
  VIEW_HISTORY: "view_history",
} as const;

export type ClaimOperation = (typeof ClaimOperation)[keyof typeof ClaimOperation];

/**
 * Valid operations per state
 */
export const validOperationsByState: Record<ClaimState, ClaimOperation[]> = {
  pending: [ClaimOperation.VIEW, ClaimOperation.CANCEL],
  frozen: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
  partially_realized: [ClaimOperation.VIEW, ClaimOperation.CLAIM, ClaimOperation.VIEW_HISTORY],
  fully_realized: [ClaimOperation.VIEW, ClaimOperation.CLAIM, ClaimOperation.VIEW_HISTORY],
  closed: [ClaimOperation.VIEW, ClaimOperation.VIEW_HISTORY],
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
 * Map epoch_request_status enum to ClaimState
 */
export function mapRequestStatusToClaimState(
  requestStatus: string,
  entitlementStatus?: string,
): ClaimState {
  // If we have entitlement info, use it for realized states
  if (entitlementStatus) {
    switch (entitlementStatus) {
      case "partially_fulfilled":
        return ClaimState.PARTIALLY_REALIZED;
      case "fully_fulfilled":
        return ClaimState.FULLY_REALIZED;
      case "pending":
        return ClaimState.FROZEN;
      default:
        break;
    }
  }

  // Fall back to request status mapping
  switch (requestStatus) {
    case "pending":
      return ClaimState.PENDING;
    case "claimable":
    case "settled":
      // ERC-7540: claimable (was settled) = ready to claim
      return ClaimState.FROZEN;
    case "claimed":
      return ClaimState.CLOSED;
    case "cancelled":
      return ClaimState.CLOSED;
    default:
      return ClaimState.PENDING;
  }
  switch (requestStatus) {
    case "pending":
      return ClaimState.PENDING;
    case "settled":
      // Settled but not yet claimed = frozen (awaiting realizations)
      return ClaimState.FROZEN;
    case "claimed":
      return ClaimState.CLOSED;
    case "cancelled":
      return ClaimState.CLOSED;
    default:
      return ClaimState.PENDING;
  }
}

/**
 * Determine next state based on realization progress
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

  // If everything is claimed, move to closed
  if (claimed >= entitlement && entitlement > 0n) {
    return ClaimState.CLOSED;
  }

  // If fully realized
  if (realized >= entitlement && entitlement > 0n) {
    // Only move to fully_realized if we haven't claimed everything
    return claimed >= entitlement ? ClaimState.CLOSED : ClaimState.FULLY_REALIZED;
  }

  // If partially realized
  if (realized > 0n) {
    return ClaimState.PARTIALLY_REALIZED;
  }

  // If frozen but no realizations yet
  if (currentState === ClaimState.FROZEN || currentState === ClaimState.PENDING) {
    return realized > 0n ? ClaimState.PARTIALLY_REALIZED : ClaimState.FROZEN;
  }

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
    entitlement: 'entitlement',
    accrued: 'accrued',
    claimed: 'claimed',
    carryRemaining: 'carryRemaining',
  },
  // Legacy -> Canonical mapping
  legacy: {
    totalRealizedUsdc: 'accrued',
    totalClaimedUsdc: 'claimed',
  },
  // Reverse mapping: canonical -> legacy
  toLegacy: {
    accrued: 'totalRealizedUsdc',
    claimed: 'totalClaimedUsdc',
  },
} as const;

/**
 * Reason codes for ledger mismatches
 */
export const LedgerMismatchReason = {
  CANONICAL_LEGACY_ACCRUED_MISMATCH: 'CANONICAL_LEGACY_ACCRUED_MISMATCH',
  CANONICAL_LEGACY_CLAIMED_MISMATCH: 'CANONICAL_LEGACY_CLAIMED_MISMATCH',
  CARRY_REMAINING_CALCULATION_ERROR: 'CARRY_REMAINING_CALCULATION_ERROR',
  NEGATIVE_VALUE: 'NEGATIVE_VALUE',
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  CONTRACT_REPOSITORY_MISMATCH: 'CONTRACT_REPOSITORY_MISMATCH',
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

/**
 * Canonical ledger state per user
 * Invariants: 0 <= claimed <= accrued <= entitlement
 * carryRemaining = entitlement - claimed (loss-aware)
 */
export interface LedgerState {
  entitlement: string;  // Total entitled amount (immutable after freeze)
  accrued: string;      // Amount accrued from realizations
  claimed: string;      // Amount claimed by user
  carryRemaining: string;  // Remaining amount to be carried
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
    errors.push(`carryRemaining (${carryRemaining.toString()}) != entitlement - claimed (${expectedCarryRemaining.toString()})`);
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
