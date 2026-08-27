/**
 * T1: Closed-Book Batch State Machine Tests
 *
 * Tests for:
 * - Closed-book batch lifecycle: OPEN -> CUTOFF -> FLATTENING -> SETTLING -> REOPEN
 * - Batch sealing rule: first request in OPEN seals the batch
 * - Cancellation rule: cancellation IMPOSSIBLE after CUTOFF
 * - State transition validation
 */

import { describe, it, expect } from "vitest";
import {
  ClaimState,
  validClaimTransitions,
  isValidClaimTransition,
  validateClaimTransition,
  validOperationsByState,
  isValidOperationForState,
  ClaimOperation,
  mapRequestStatusToClaimState,
} from "../services/claimStateMachine.js";

describe("T1: Closed-Book Batch State Machine", () => {
  describe("State Definitions", () => {
    it("defines all required closed-book batch states", () => {
      expect(ClaimState.OPEN).toBe("open");
      expect(ClaimState.CUTOFF).toBe("cutoff");
      expect(ClaimState.FLATTENING).toBe("flattening");
      expect(ClaimState.SETTLING).toBe("settling");
      expect(ClaimState.SETTLED).toBe("settled");
      expect(ClaimState.CLOSED).toBe("closed");
      expect(ClaimState.REOPEN).toBe("reopen");
    });
  });

  describe("Valid State Transitions", () => {
    it("allows open -> cutoff (batch sealing)", () => {
      expect(isValidClaimTransition("open", "cutoff")).toBe(true);
    });

    it("allows cutoff -> flattening", () => {
      expect(isValidClaimTransition("cutoff", "flattening")).toBe(true);
    });

    it("allows flattening -> settling", () => {
      expect(isValidClaimTransition("flattening", "settling")).toBe(true);
    });

    it("allows settling -> settled", () => {
      expect(isValidClaimTransition("settling", "settled")).toBe(true);
    });

    it("allows settled -> closed", () => {
      expect(isValidClaimTransition("settled", "closed")).toBe(true);
    });

    it("allows closed -> reopen", () => {
      expect(isValidClaimTransition("closed", "reopen")).toBe(true);
    });

    it("rejects reopen -> any (terminal state)", () => {
      expect(isValidClaimTransition("reopen", "open")).toBe(false);
      expect(isValidClaimTransition("reopen", "cutoff")).toBe(false);
    });

    it("rejects backward transitions", () => {
      expect(isValidClaimTransition("cutoff", "open")).toBe(false);
      expect(isValidClaimTransition("flattening", "cutoff")).toBe(false);
      expect(isValidClaimTransition("settling", "flattening")).toBe(false);
      expect(isValidClaimTransition("settled", "settling")).toBe(false);
    });
  });

  describe("Batch Sealing Rule", () => {
    it("first request in OPEN seals the batch (transitions to CUTOFF)", () => {
      const result = validateClaimTransition("open", "cutoff");
      expect(result.valid).toBe(true);
    });

    it("subsequent requests route to next batch (not current sealed batch)", () => {
      // Once in CUTOFF, no new requests can join
      const canRequestInCutoff = validOperationsByState.cutoff.includes(ClaimOperation.REQUEST);
      expect(canRequestInCutoff).toBe(false);
    });
  });

  describe("Cancellation Rule", () => {
    it("allows cancellation in OPEN state", () => {
      const canCancel = validOperationsByState.open.includes(ClaimOperation.CANCEL);
      expect(canCancel).toBe(true);
    });

    it("REJECTS cancellation in CUTOFF state", () => {
      const canCancel = validOperationsByState.cutoff.includes(ClaimOperation.CANCEL);
      expect(canCancel).toBe(false);
    });

    it("REJECTS cancellation in FLATTENING state", () => {
      const canCancel = validOperationsByState.flattening.includes(ClaimOperation.CANCEL);
      expect(canCancel).toBe(false);
    });

    it("REJECTS cancellation in SETTLING state", () => {
      const canCancel = validOperationsByState.settling.includes(ClaimOperation.CANCEL);
      expect(canCancel).toBe(false);
    });

    it("REJECTS cancellation in SETTLED state", () => {
      const canCancel = validOperationsByState.settled.includes(ClaimOperation.CANCEL);
      expect(canCancel).toBe(false);
    });
  });

  describe("Valid Operations by State", () => {
    it("OPEN: allows VIEW, REQUEST, CANCEL", () => {
      expect(validOperationsByState.open).toContain(ClaimOperation.VIEW);
      expect(validOperationsByState.open).toContain(ClaimOperation.REQUEST);
      expect(validOperationsByState.open).toContain(ClaimOperation.CANCEL);
    });

    it("CUTOFF: allows only VIEW", () => {
      expect(validOperationsByState.cutoff).toContain(ClaimOperation.VIEW);
      expect(validOperationsByState.cutoff).not.toContain(ClaimOperation.REQUEST);
      expect(validOperationsByState.cutoff).not.toContain(ClaimOperation.CANCEL);
    });

    it("SETTLED: allows VIEW, CLAIM, VIEW_HISTORY", () => {
      expect(validOperationsByState.settled).toContain(ClaimOperation.VIEW);
      expect(validOperationsByState.settled).toContain(ClaimOperation.CLAIM);
      expect(validOperationsByState.settled).toContain(ClaimOperation.VIEW_HISTORY);
    });
  });

  describe("State Mapping from Request Status", () => {
    it("maps 'pending' to OPEN", () => {
      expect(mapRequestStatusToClaimState("pending")).toBe(ClaimState.OPEN);
    });

    it("maps 'cutoff' to CUTOFF", () => {
      expect(mapRequestStatusToClaimState("cutoff")).toBe(ClaimState.CUTOFF);
    });

    it("maps 'flattening' to FLATTENING", () => {
      expect(mapRequestStatusToClaimState("flattening")).toBe(ClaimState.FLATTENING);
    });

    it("maps 'settling' to SETTLING", () => {
      expect(mapRequestStatusToClaimState("settling")).toBe(ClaimState.SETTLING);
    });

    it("maps 'claimable' to SETTLED", () => {
      expect(mapRequestStatusToClaimState("claimable")).toBe(ClaimState.SETTLED);
    });

    it("maps 'settled' to SETTLED", () => {
      expect(mapRequestStatusToClaimState("settled")).toBe(ClaimState.SETTLED);
    });

    it("maps 'claimed' to CLOSED", () => {
      expect(mapRequestStatusToClaimState("claimed")).toBe(ClaimState.CLOSED);
    });
  });

  describe("Transition Matrix Verification", () => {
    it("has correct transitions from open", () => {
      expect(validClaimTransitions.open).toEqual(["cutoff"]);
    });

    it("has correct transitions from cutoff", () => {
      expect(validClaimTransitions.cutoff).toEqual(["flattening"]);
    });

    it("has correct transitions from flattening", () => {
      expect(validClaimTransitions.flattening).toEqual(["settling"]);
    });

    it("has correct transitions from settling", () => {
      expect(validClaimTransitions.settling).toEqual(["settled"]);
    });

    it("has correct transitions from settled", () => {
      expect(validClaimTransitions.settled).toEqual(["closed"]);
    });

    it("has correct transitions from closed", () => {
      expect(validClaimTransitions.closed).toEqual(["reopen"]);
    });

    it("has empty transitions from reopen (terminal)", () => {
      expect(validClaimTransitions.reopen).toEqual([]);
    });
  });
});
