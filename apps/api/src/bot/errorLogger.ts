import { logger } from "../logger.js";
import { getErrorRepository, type LogErrorInput } from "./errorRepository.js";
import type { ErrorSeverity } from "../db/botSchema.js";
import crypto from "crypto";

interface StackFrame {
  functionName: string;
  filePath: string;
  lineNumber: number;
  columnNumber: number;
}

interface ErrorContext {
  positionId?: number;
  marketId?: string;
  tokenId?: string;
  correlationId?: string;
  requestId?: string;
  [key: string]: unknown;
}

const ERROR_CODES = {
  API_ERROR: "API_ERROR",
  ORDER_FAILED: "ORDER_FAILED",
  HEDGE_FAILED: "HEDGE_FAILED",
  RESOLUTION_FAILED: "RESOLUTION_FAILED",
  SCAN_FAILED: "SCAN_FAILED",
  DATABASE_ERROR: "DATABASE_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFIG_ERROR: "CONFIG_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  WALLET_ERROR: "WALLET_ERROR",
  MARKET_DATA_ERROR: "MARKET_DATA_ERROR",
  PRICE_VALIDATION_ERROR: "PRICE_VALIDATION_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

function parseStackTrace(stack: string | undefined): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];
  const lines = stack.split("\n").slice(1);

  for (const line of lines) {
    const match = line.match(/at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/);
    if (match) {
      frames.push({
        functionName: match[1] || "<anonymous>",
        filePath: match[2] || "",
        lineNumber: parseInt(match[3] || "0", 10),
        columnNumber: parseInt(match[4] || "0", 10),
      });
    }
  }

  return frames;
}

function getCallerInfo(error: Error): {
  functionName?: string;
  filePath?: string;
  lineNumber?: number;
} {
  const frames = parseStackTrace(error.stack);
  const relevantFrame = frames.find(
    (f) => !f.filePath.includes("errorLogger") && !f.filePath.includes("node_modules"),
  );

  if (relevantFrame) {
    return {
      functionName: relevantFrame.functionName,
      filePath: relevantFrame.filePath,
      lineNumber: relevantFrame.lineNumber,
    };
  }

  return {};
}

function inferErrorCode(error: Error, component: string): ErrorCode {
  const message = error.message.toLowerCase();

  if (message.includes("timeout") || message.includes("timed out"))
    return ERROR_CODES.TIMEOUT_ERROR;
  if (
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed")
  )
    return ERROR_CODES.NETWORK_ERROR;
  if (
    message.includes("wallet") ||
    message.includes("private key") ||
    message.includes("insufficient")
  )
    return ERROR_CODES.WALLET_ERROR;
  if (message.includes("order") || message.includes("trade")) return ERROR_CODES.ORDER_FAILED;
  if (message.includes("hedge")) return ERROR_CODES.HEDGE_FAILED;
  if (message.includes("resolution") || message.includes("resolve"))
    return ERROR_CODES.RESOLUTION_FAILED;
  if (message.includes("database") || message.includes("postgres") || message.includes("drizzle"))
    return ERROR_CODES.DATABASE_ERROR;
  if (message.includes("validation") || message.includes("invalid"))
    return ERROR_CODES.VALIDATION_ERROR;
  if (message.includes("config") || message.includes("environment"))
    return ERROR_CODES.CONFIG_ERROR;
  if (message.includes("api") || message.includes("request failed")) return ERROR_CODES.API_ERROR;
  if (message.includes("market") || message.includes("price")) return ERROR_CODES.MARKET_DATA_ERROR;

  if (component.includes("hedge")) return ERROR_CODES.HEDGE_FAILED;
  if (component.includes("trading")) return ERROR_CODES.ORDER_FAILED;
  if (component.includes("resolution")) return ERROR_CODES.RESOLUTION_FAILED;
  if (component.includes("scan")) return ERROR_CODES.SCAN_FAILED;

  return ERROR_CODES.UNKNOWN_ERROR;
}

function inferSeverity(error: Error, code: ErrorCode): ErrorSeverity {
  if (code === ERROR_CODES.WALLET_ERROR || code === ERROR_CODES.CONFIG_ERROR) return "critical";
  if (code === ERROR_CODES.DATABASE_ERROR) return "critical";
  if (code === ERROR_CODES.ORDER_FAILED || code === ERROR_CODES.HEDGE_FAILED) return "error";
  if (code === ERROR_CODES.VALIDATION_ERROR || code === ERROR_CODES.PRICE_VALIDATION_ERROR)
    return "warning";
  if (code === ERROR_CODES.TIMEOUT_ERROR || code === ERROR_CODES.NETWORK_ERROR) return "error";
  return "error";
}

let correlationIdGenerator = 0;
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  correlationIdGenerator++;
  return `${timestamp}-${random}-${correlationIdGenerator.toString(36)}`;
}

export function generateRequestId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export class ErrorLogger {
  private botInstanceId: string;
  private correlationId?: string;

  constructor(botInstanceId: string = "1", correlationId?: string) {
    this.botInstanceId = botInstanceId;
    this.correlationId = correlationId;
  }

  withCorrelation(correlationId: string): ErrorLogger {
    return new ErrorLogger(this.botInstanceId, correlationId);
  }

  async logError(
    error: Error,
    component: string,
    options: {
      errorCode?: ErrorCode;
      severity?: ErrorSeverity;
      context?: ErrorContext;
    } = {},
  ): Promise<number> {
    const errorCode = options.errorCode || inferErrorCode(error, component);
    const severity = options.severity || inferSeverity(error, errorCode);
    const callerInfo = getCallerInfo(error);

    const logInput: LogErrorInput = {
      errorCode,
      severity,
      message: error.message,
      stackTrace: error.stack,
      component,
      functionName: callerInfo.functionName,
      filePath: callerInfo.filePath,
      lineNumber: callerInfo.lineNumber,
      requestId: options.context?.requestId as string | undefined,
      correlationId: options.context?.correlationId || this.correlationId,
      positionId: options.context?.positionId,
      marketId: options.context?.marketId,
      tokenId: options.context?.tokenId,
      metadata: {
        errorName: error.name,
        ...options.context,
      },
    };

    const repo = getErrorRepository(this.botInstanceId);
    const errorId = await repo.logError(logInput);

    const logLevel = severity === "critical" || severity === "error" ? "error" : "warn";
    const logMessage = `[${errorCode}] ${component}: ${error.message}`;

    if (logLevel === "error") {
      logger.error(logMessage, {
        errorId,
        severity,
        component,
        correlationId: logInput.correlationId,
        positionId: options.context?.positionId,
        marketId: options.context?.marketId,
      });
    } else {
      logger.warn(logMessage, {
        errorId,
        severity,
        component,
        correlationId: logInput.correlationId,
      });
    }

    return errorId;
  }

  async logApiError(
    error: Error,
    component: string,
    apiDetails: { endpoint?: string; statusCode?: number; response?: unknown },
    context?: ErrorContext,
  ): Promise<number> {
    return this.logError(error, component, {
      errorCode: ERROR_CODES.API_ERROR,
      context: {
        ...context,
        endpoint: apiDetails.endpoint,
        statusCode: apiDetails.statusCode,
        response: apiDetails.response,
      },
    });
  }

  async logOrderError(
    error: Error,
    orderDetails: { marketId: string; tokenId?: string; side?: string; amount?: number },
    context?: ErrorContext,
  ): Promise<number> {
    return this.logError(error, "tradingClient", {
      errorCode: ERROR_CODES.ORDER_FAILED,
      context: {
        ...context,
        marketId: orderDetails.marketId,
        tokenId: orderDetails.tokenId,
        orderSide: orderDetails.side,
        orderAmount: orderDetails.amount,
      },
    });
  }

  async logHedgeError(
    error: Error,
    hedgeDetails: { positionId: number; marketId: string; reason?: string },
    context?: ErrorContext,
  ): Promise<number> {
    return this.logError(error, "hedgingChecker", {
      errorCode: ERROR_CODES.HEDGE_FAILED,
      context: {
        ...context,
        positionId: hedgeDetails.positionId,
        marketId: hedgeDetails.marketId,
        hedgeReason: hedgeDetails.reason,
      },
    });
  }

  async getUnresolvedErrors() {
    const repo = getErrorRepository(this.botInstanceId);
    return repo.getUnresolvedErrors();
  }

  async getCriticalErrors(limit?: number) {
    const repo = getErrorRepository(this.botInstanceId);
    return repo.getCriticalErrors(limit);
  }

  async resolveError(errorId: number, resolvedBy: string, note?: string) {
    const repo = getErrorRepository(this.botInstanceId);
    return repo.resolveError(errorId, resolvedBy, note);
  }

  async getErrorStats() {
    const repo = getErrorRepository(this.botInstanceId);
    return repo.getErrorStats();
  }
}

const errorLoggerInstances: Map<string, ErrorLogger> = new Map();

export function getErrorLogger(botInstanceId: string = "1"): ErrorLogger {
  let instance = errorLoggerInstances.get(botInstanceId);
  if (!instance) {
    instance = new ErrorLogger(botInstanceId);
    errorLoggerInstances.set(botInstanceId, instance);
  }
  return instance;
}

export async function logBotError(
  error: Error,
  component: string,
  botInstanceId: string = "1",
  context?: ErrorContext,
): Promise<number> {
  const errorLogger = getErrorLogger(botInstanceId);
  return errorLogger.logError(error, component, { context });
}

export { ERROR_CODES };
