export interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refetch: () => Promise<T | null>;
}

export const DEFAULT_POLL_INTERVAL_MS = 30_000;

export function getErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : "Unknown error";
}

export function isUnauthorizedError(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (!message) {
    return false;
  }

  return (
    message.includes("401") || message.includes("unauthorized") || message.includes("Unauthorized")
  );
}

export function getLastRefresh(dataUpdatedAt: number, hasData: boolean): Date | null {
  if (!hasData || dataUpdatedAt <= 0) {
    return null;
  }

  return new Date(dataUpdatedAt);
}

export function getVaultScope(vaultId?: number): number | "default" {
  return vaultId ?? "default";
}

export function getUserScope(isAuthenticated: boolean, address?: string): string {
  if (!isAuthenticated || !address) {
    return "anonymous";
  }

  return address.toLowerCase();
}
