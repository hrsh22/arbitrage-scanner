import type { QueryClient } from "@tanstack/react-query";
import { vaultQueryKeys } from "./queryKeys";

export async function invalidatePublicVaultDetailQueries(
  queryClient: QueryClient,
  vaultId?: number,
): Promise<void> {
  if (vaultId === undefined) {
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: vaultQueryKeys.publicDetail.root(vaultId),
  });
}

export async function invalidateUserVaultDetailQueries(
  queryClient: QueryClient,
  vaultId?: number,
  userScope?: string,
): Promise<void> {
  if (vaultId === undefined) {
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: userScope
      ? vaultQueryKeys.userDetail.root(vaultId, userScope)
      : vaultQueryKeys.userDetail.family(vaultId),
  });
}

export async function invalidateVaultDetailQueries(
  queryClient: QueryClient,
  vaultId?: number,
  userScope?: string,
): Promise<void> {
  await Promise.all([
    invalidatePublicVaultDetailQueries(queryClient, vaultId),
    invalidateUserVaultDetailQueries(queryClient, vaultId, userScope),
  ]);
}

export async function invalidateVaultQueries(
  queryClient: QueryClient,
  vaultId?: number,
): Promise<void> {
  await invalidateVaultDetailQueries(queryClient, vaultId);
}
