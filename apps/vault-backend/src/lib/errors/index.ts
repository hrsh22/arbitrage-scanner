/**
 * Typed error system using Effect.ts Data.TaggedError
 *
 * All errors are discriminated by their _tag property, enabling
 * pattern matching and type-safe error handling.
 */
import { Data } from "effect";

// =============================================================================
// RPC / Blockchain Errors
// =============================================================================

/** All RPC endpoints failed after fallback attempts */
export class RpcError extends Data.TaggedError("RpcError")<{
  readonly method: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** HTTP request failed (non-2xx status code) */
export class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number;
  readonly url: string;
  readonly message: string;
}> {}

/** Request timed out */
export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly timeoutMs: number;
  readonly operation: string;
}> {}

/** JSON-RPC returned an error response */
export class JsonRpcError extends Data.TaggedError("JsonRpcError")<{
  readonly code?: number;
  readonly message: string;
  readonly data?: unknown;
}> {}

// =============================================================================
// Database Errors
// =============================================================================

/** Record not found in database */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entity: string;
  readonly id: string | number;
}> {}

/** Database operation failed */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Duplicate record constraint violation */
export class DuplicateError extends Data.TaggedError("DuplicateError")<{
  readonly entity: string;
  readonly field: string;
  readonly value: string;
}> {}

// =============================================================================
// Vault / Contract Errors
// =============================================================================

/** Smart contract call failed */
export class ContractError extends Data.TaggedError("ContractError")<{
  readonly contract: string;
  readonly method: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Wallet not configured for signing transactions */
export class WalletNotConfiguredError extends Data.TaggedError("WalletNotConfiguredError")<{
  readonly message: string;
}> {}

/** Vault not found or not accessible */
export class VaultNotFoundError extends Data.TaggedError("VaultNotFoundError")<{
  readonly vaultId: number;
}> {}

/** User not authorized for this operation */
export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
  readonly reason: string;
}> {}

// =============================================================================
// Sync / Event Errors
// =============================================================================

/** Failed to decode blockchain event */
export class EventDecodeError extends Data.TaggedError("EventDecodeError")<{
  readonly txHash: string;
  readonly logIndex: number;
  readonly message: string;
}> {}

/** Event already processed (idempotency check) */
export class AlreadyProcessedError extends Data.TaggedError("AlreadyProcessedError")<{
  readonly txHash: string;
  readonly eventType: string;
}> {}

/** Sync state is invalid or corrupted */
export class SyncStateError extends Data.TaggedError("SyncStateError")<{
  readonly vaultId: number;
  readonly message: string;
}> {}

// =============================================================================
// Validation Errors
// =============================================================================

/** Input validation failed */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}> {}

/** Configuration is missing or invalid */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly key: string;
  readonly message: string;
}> {}

// =============================================================================
// Trading Errors
// =============================================================================

/** Order placement failed */
export class OrderError extends Data.TaggedError("OrderError")<{
  readonly orderId?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Insufficient funds for operation */
export class InsufficientFundsError extends Data.TaggedError("InsufficientFundsError")<{
  readonly required: string;
  readonly available: string;
  readonly currency: string;
}> {}

// =============================================================================
// Type Unions for Error Handling
// =============================================================================

/** All RPC-related errors */
export type RpcErrors = RpcError | HttpError | TimeoutError | JsonRpcError;

/** All database-related errors */
export type DatabaseErrors = NotFoundError | DatabaseError | DuplicateError;

/** All vault/contract-related errors */
export type VaultErrors =
  | ContractError
  | WalletNotConfiguredError
  | VaultNotFoundError
  | UnauthorizedError;

/** All sync-related errors */
export type SyncErrors = EventDecodeError | AlreadyProcessedError | SyncStateError;

/** All trading-related errors */
export type TradingErrors = OrderError | InsufficientFundsError;

/** Any application error */
export type AppError =
  | RpcErrors
  | DatabaseErrors
  | VaultErrors
  | SyncErrors
  | TradingErrors
  | ValidationError
  | ConfigError;
