/**
 * Admin Authentication using Effect.ts
 *
 * Provides typed admin authentication middleware with:
 * - Nonce-based challenge/response login
 * - Session token management
 * - Wallet signature verification (SIWE-style)
 * - Allowlist-based access control
 */

import { Effect, Data, Option, pipe } from "effect";
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { verifyMessage, type Hex } from "viem";
import { env } from "../../env.js";

// ============================================================================
// Errors
// ============================================================================

export class AdminAuthError extends Data.TaggedError("AdminAuthError")<{
  readonly code:
    | "ALLOWLIST_NOT_CONFIGURED"
    | "TOKEN_REQUIRED"
    | "INVALID_SESSION"
    | "SESSION_EXPIRED"
    | "ADDRESS_NOT_ALLOWED"
    | "ADDRESS_MISMATCH"
    | "NONCE_EXPIRED"
    | "NONCE_NOT_FOUND"
    | "INVALID_SIGNATURE"
    | "ADDRESS_NOT_IN_ALLOWLIST";
  readonly message: string;
  readonly httpStatus: number;
}> {}

// ============================================================================
// Config
// ============================================================================

const ADMIN_MESSAGE_PREFIX = "Polymarket Vault Admin Login";
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ============================================================================
// State (in-memory for simplicity; could be replaced with Redis)
// ============================================================================

interface NonceEntry {
  nonce: string;
  expiresAt: number;
}

interface SessionEntry {
  address: string;
  expiresAt: number;
}

const pendingNonces = new Map<string, NonceEntry>();
const activeSessions = new Map<string, SessionEntry>();

// ============================================================================
// Helpers
// ============================================================================

const normalizeAddress = (address: string): string => address.toLowerCase();

const buildAdminMessage = (address: string, nonce: string): string =>
  `${ADMIN_MESSAGE_PREFIX}\nAddress: ${address}\nNonce: ${nonce}`;

const parseAllowlist = (): Set<string> =>
  new Set(
    env.ADMIN_WALLET_ALLOWLIST.split(",")
      .map((addr) => addr.trim().toLowerCase())
      .filter((addr) => addr.length > 0),
  );

const adminAllowlist = parseAllowlist();

// ============================================================================
// Effect-based Auth Operations
// ============================================================================

/**
 * Generate a nonce for the given address.
 */
export const generateNonce = (
  address: string,
): Effect.Effect<{ nonce: string; expiresAt: number }, AdminAuthError> =>
  Effect.gen(function* () {
    if (adminAllowlist.size === 0) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "ALLOWLIST_NOT_CONFIGURED",
          message: "Admin allowlist not configured",
          httpStatus: 503,
        }),
      );
    }

    const normalized = normalizeAddress(address);
    if (!adminAllowlist.has(normalized)) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "ADDRESS_NOT_IN_ALLOWLIST",
          message: "Address not in admin allowlist",
          httpStatus: 403,
        }),
      );
    }

    const nonce = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + NONCE_TTL_MS;

    pendingNonces.set(normalized, { nonce, expiresAt });

    return { nonce, expiresAt };
  });

/**
 * Verify a signature and create a session.
 */
export const verifyAndCreateSession = (
  address: string,
  signature: string,
): Effect.Effect<{ token: string; expiresAt: number }, AdminAuthError> =>
  Effect.gen(function* () {
    if (adminAllowlist.size === 0) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "ALLOWLIST_NOT_CONFIGURED",
          message: "Admin allowlist not configured",
          httpStatus: 503,
        }),
      );
    }

    const normalized = normalizeAddress(address);
    const nonceEntry = pendingNonces.get(normalized);

    if (!nonceEntry) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "NONCE_NOT_FOUND",
          message: "No pending nonce for this address. Request a new nonce.",
          httpStatus: 400,
        }),
      );
    }

    if (nonceEntry.expiresAt < Date.now()) {
      pendingNonces.delete(normalized);
      return yield* Effect.fail(
        new AdminAuthError({
          code: "NONCE_EXPIRED",
          message: "Nonce expired. Request a new nonce.",
          httpStatus: 400,
        }),
      );
    }

    const message = buildAdminMessage(address, nonceEntry.nonce);

    const isValid = yield* Effect.tryPromise({
      try: () =>
        verifyMessage({
          address: address as Hex,
          message,
          signature: signature as Hex,
        }),
      catch: () =>
        new AdminAuthError({
          code: "INVALID_SIGNATURE",
          message: "Signature verification failed",
          httpStatus: 401,
        }),
    });

    if (!isValid) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "INVALID_SIGNATURE",
          message: "Invalid signature",
          httpStatus: 401,
        }),
      );
    }

    if (!adminAllowlist.has(normalized)) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "ADDRESS_NOT_IN_ALLOWLIST",
          message: "Address not in admin allowlist",
          httpStatus: 403,
        }),
      );
    }

    // Clean up nonce
    pendingNonces.delete(normalized);

    // Create session
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_TTL_MS;

    activeSessions.set(token, { address: normalized, expiresAt });

    return { token, expiresAt };
  });

/**
 * Validate a session token.
 */
export const validateSession = (
  token: string,
  headerAddress?: string,
): Effect.Effect<{ address: string }, AdminAuthError> =>
  Effect.gen(function* () {
    if (adminAllowlist.size === 0) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "ALLOWLIST_NOT_CONFIGURED",
          message: "Admin allowlist not configured",
          httpStatus: 503,
        }),
      );
    }

    const session = activeSessions.get(token);

    if (!session) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "INVALID_SESSION",
          message: "Invalid or expired session",
          httpStatus: 401,
        }),
      );
    }

    if (session.expiresAt < Date.now()) {
      activeSessions.delete(token);
      return yield* Effect.fail(
        new AdminAuthError({
          code: "SESSION_EXPIRED",
          message: "Session expired",
          httpStatus: 401,
        }),
      );
    }

    if (!adminAllowlist.has(session.address)) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "ADDRESS_NOT_ALLOWED",
          message: "Admin address not allowed",
          httpStatus: 403,
        }),
      );
    }

    if (headerAddress && normalizeAddress(headerAddress) !== session.address) {
      return yield* Effect.fail(
        new AdminAuthError({
          code: "ADDRESS_MISMATCH",
          message: "Admin address mismatch",
          httpStatus: 403,
        }),
      );
    }

    return { address: session.address };
  });

/**
 * Invalidate a session (logout).
 */
export const invalidateSession = (token: string): Effect.Effect<void, never> =>
  Effect.sync(() => {
    activeSessions.delete(token);
  });

// ============================================================================
// Express Middleware
// ============================================================================

export interface AdminRequest extends Request {
  adminAddress: string;
}

/**
 * Express middleware that validates admin authentication.
 * Attaches `adminAddress` to the request on success.
 */
export const adminAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Authorization token required" });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const headerAddress = req.headers["x-admin-address"] as string | undefined;

  const program = pipe(
    validateSession(token, headerAddress),
    Effect.map(({ address }) => {
      (req as AdminRequest).adminAddress = address;
      next();
    }),
    Effect.catchAll((error) => {
      res.status(error.httpStatus).json({ success: false, error: error.message });
      return Effect.void;
    }),
  );

  Effect.runPromise(program).catch(() => {
    res.status(500).json({ success: false, error: "Internal server error" });
  });
};

/**
 * Run an Effect-based nonce generation and send response.
 */
export const handleNonceRequest = (address: string, res: Response): void => {
  const program = pipe(
    generateNonce(address),
    Effect.map(({ nonce, expiresAt }) => {
      res.json({
        success: true,
        data: {
          nonce,
          message: buildAdminMessage(address, nonce),
          expiresAt,
        },
      });
    }),
    Effect.catchAll((error) => {
      res.status(error.httpStatus).json({ success: false, error: error.message });
      return Effect.void;
    }),
  );

  Effect.runPromise(program).catch(() => {
    res.status(500).json({ success: false, error: "Internal server error" });
  });
};

/**
 * Run an Effect-based verification and send response.
 */
export const handleVerifyRequest = (address: string, signature: string, res: Response): void => {
  const program = pipe(
    verifyAndCreateSession(address, signature),
    Effect.map(({ token, expiresAt }) => {
      res.json({ success: true, data: { token, expiresAt } });
    }),
    Effect.catchAll((error) => {
      res.status(error.httpStatus).json({ success: false, error: error.message });
      return Effect.void;
    }),
  );

  Effect.runPromise(program).catch(() => {
    res.status(500).json({ success: false, error: "Internal server error" });
  });
};

/**
 * Run an Effect-based logout and send response.
 */
export const handleLogoutRequest = (token: string, res: Response): void => {
  const program = pipe(
    invalidateSession(token),
    Effect.map(() => {
      res.json({ success: true });
    }),
  );

  Effect.runPromise(program).catch(() => {
    res.status(500).json({ success: false, error: "Internal server error" });
  });
};
