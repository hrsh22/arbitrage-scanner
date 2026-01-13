import { db } from "../db/client.js";
import { botErrors, type ErrorSeverity, type BotError } from "../db/botSchema.js";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import crypto from "crypto";

export interface LogErrorInput {
  errorCode: string;
  severity: ErrorSeverity;
  message: string;
  stackTrace?: string;
  component: string;
  functionName?: string;
  filePath?: string;
  lineNumber?: number;
  requestId?: string;
  correlationId?: string;
  positionId?: number;
  marketId?: string;
  tokenId?: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorQueryOptions {
  severity?: ErrorSeverity;
  component?: string;
  errorCode?: string;
  isResolved?: boolean;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  correlationId?: string;
  positionId?: number;
  marketId?: string;
}

function generateErrorHash(input: LogErrorInput): string {
  const hashContent = `${input.errorCode}:${input.component}:${input.functionName || ""}:${input.message.substring(0, 200)}`;
  return crypto.createHash("sha256").update(hashContent).digest("hex").substring(0, 64);
}

export class ErrorRepository {
  private botInstanceId: string;
  private environment: string;

  constructor(botInstanceId: string = "1") {
    this.botInstanceId = botInstanceId;
    this.environment = process.env.NODE_ENV || "development";
  }

  async logError(input: LogErrorInput): Promise<number> {
    const errorHash = generateErrorHash(input);

    const existing = await db
      .select()
      .from(botErrors)
      .where(and(eq(botErrors.errorHash, errorHash), eq(botErrors.isResolved, false)))
      .limit(1);

    if (existing.length > 0) {
      const existingError = existing[0]!;
      await db
        .update(botErrors)
        .set({
          occurrenceCount: sql`${botErrors.occurrenceCount} + 1`,
          lastSeenAt: new Date(),
          metadata: input.metadata ?? existingError.metadata,
        })
        .where(eq(botErrors.id, existingError.id));
      return existingError.id;
    }

    const result = await db
      .insert(botErrors)
      .values({
        botInstanceId: this.botInstanceId,
        errorCode: input.errorCode,
        severity: input.severity,
        message: input.message,
        stackTrace: input.stackTrace,
        component: input.component,
        functionName: input.functionName,
        filePath: input.filePath,
        lineNumber: input.lineNumber,
        requestId: input.requestId,
        correlationId: input.correlationId,
        positionId: input.positionId,
        marketId: input.marketId,
        tokenId: input.tokenId,
        environment: this.environment,
        nodeVersion: process.version,
        errorHash,
        metadata: input.metadata,
      })
      .returning({ id: botErrors.id });

    return result[0]!.id;
  }

  async getErrors(options: ErrorQueryOptions = {}): Promise<BotError[]> {
    const conditions = [eq(botErrors.botInstanceId, this.botInstanceId)];

    if (options.severity) {
      conditions.push(eq(botErrors.severity, options.severity));
    }
    if (options.component) {
      conditions.push(eq(botErrors.component, options.component));
    }
    if (options.errorCode) {
      conditions.push(eq(botErrors.errorCode, options.errorCode));
    }
    if (options.isResolved !== undefined) {
      conditions.push(eq(botErrors.isResolved, options.isResolved));
    }
    if (options.fromDate) {
      conditions.push(gte(botErrors.createdAt, options.fromDate));
    }
    if (options.toDate) {
      conditions.push(lte(botErrors.createdAt, options.toDate));
    }
    if (options.correlationId) {
      conditions.push(eq(botErrors.correlationId, options.correlationId));
    }
    if (options.positionId) {
      conditions.push(eq(botErrors.positionId, options.positionId));
    }
    if (options.marketId) {
      conditions.push(eq(botErrors.marketId, options.marketId));
    }

    return await db
      .select()
      .from(botErrors)
      .where(and(...conditions))
      .orderBy(desc(botErrors.createdAt))
      .limit(options.limit ?? 100);
  }

  async getUnresolvedErrors(): Promise<BotError[]> {
    return this.getErrors({ isResolved: false });
  }

  async getCriticalErrors(limit: number = 50): Promise<BotError[]> {
    return this.getErrors({ severity: "critical", isResolved: false, limit });
  }

  async resolveError(errorId: number, resolvedBy: string, resolutionNote?: string): Promise<void> {
    await db
      .update(botErrors)
      .set({
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNote,
      })
      .where(eq(botErrors.id, errorId));
  }

  async resolveByHash(
    errorHash: string,
    resolvedBy: string,
    resolutionNote?: string,
  ): Promise<number> {
    const result = await db
      .update(botErrors)
      .set({
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNote,
      })
      .where(and(eq(botErrors.errorHash, errorHash), eq(botErrors.isResolved, false)))
      .returning({ id: botErrors.id });

    return result.length;
  }

  async getErrorStats(): Promise<{
    total: number;
    unresolved: number;
    bySeverity: Record<ErrorSeverity, number>;
    byComponent: Record<string, number>;
  }> {
    const allErrors = await db
      .select({
        severity: botErrors.severity,
        component: botErrors.component,
        isResolved: botErrors.isResolved,
      })
      .from(botErrors)
      .where(eq(botErrors.botInstanceId, this.botInstanceId));

    const bySeverity: Record<ErrorSeverity, number> = {
      critical: 0,
      error: 0,
      warning: 0,
      info: 0,
    };
    const byComponent: Record<string, number> = {};
    let unresolved = 0;

    for (const error of allErrors) {
      bySeverity[error.severity]++;
      byComponent[error.component] = (byComponent[error.component] || 0) + 1;
      if (!error.isResolved) {
        unresolved++;
      }
    }

    return {
      total: allErrors.length,
      unresolved,
      bySeverity,
      byComponent,
    };
  }

  async getErrorById(errorId: number): Promise<BotError | null> {
    const result = await db
      .select()
      .from(botErrors)
      .where(and(eq(botErrors.id, errorId), eq(botErrors.botInstanceId, this.botInstanceId)))
      .limit(1);

    return result[0] ?? null;
  }

  async getRecentErrorsByPosition(positionId: number, limit: number = 10): Promise<BotError[]> {
    return this.getErrors({ positionId, limit });
  }

  async getRecentErrorsByMarket(marketId: string, limit: number = 10): Promise<BotError[]> {
    return this.getErrors({ marketId, limit });
  }
}

const errorRepositoryInstances: Map<string, ErrorRepository> = new Map();

export function getErrorRepository(botInstanceId: string = "1"): ErrorRepository {
  let instance = errorRepositoryInstances.get(botInstanceId);
  if (!instance) {
    instance = new ErrorRepository(botInstanceId);
    errorRepositoryInstances.set(botInstanceId, instance);
  }
  return instance;
}
