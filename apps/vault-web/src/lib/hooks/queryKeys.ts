import { getVaultScope } from "./shared";

export const vaultQueryKeys = {
  scope: (vaultId?: number) => ["vault", getVaultScope(vaultId)] as const,

  discover: {
    instances: () => ["vault", "discover", "instances"] as const,
  },

  publicDetail: {
    root: (vaultId?: number) => [...vaultQueryKeys.scope(vaultId), "public-detail"] as const,
    status: (vaultId?: number) => [...vaultQueryKeys.publicDetail.root(vaultId), "status"] as const,
    tradingAnalytics: (vaultId?: number) =>
      [...vaultQueryKeys.publicDetail.root(vaultId), "trading-analytics"] as const,
    eventsRoot: (vaultId?: number) =>
      [...vaultQueryKeys.publicDetail.root(vaultId), "events"] as const,
    events: (vaultId?: number, limit = 50, offset = 0) =>
      [...vaultQueryKeys.publicDetail.eventsRoot(vaultId), limit, offset] as const,
    navHistoryRoot: (vaultId?: number) =>
      [...vaultQueryKeys.publicDetail.root(vaultId), "nav-history"] as const,
    navHistory: (vaultId?: number, limit?: number) =>
      [...vaultQueryKeys.publicDetail.navHistoryRoot(vaultId), limit ?? "all"] as const,
    cycleRoot: (vaultId?: number) =>
      [...vaultQueryKeys.publicDetail.root(vaultId), "cycle"] as const,
    cycleStatus: (vaultId?: number, cycleId?: number) =>
      [...vaultQueryKeys.publicDetail.cycleRoot(vaultId), cycleId ?? "current"] as const,
    cycleHistoryRoot: (vaultId?: number) =>
      [...vaultQueryKeys.publicDetail.root(vaultId), "cycle-history"] as const,
    cycleHistory: (vaultId?: number, limit = 6) =>
      [...vaultQueryKeys.publicDetail.cycleHistoryRoot(vaultId), limit] as const,
    positionHistoryRoot: (vaultId?: number) =>
      [...vaultQueryKeys.publicDetail.root(vaultId), "position-history"] as const,
    positionHistory: (vaultId?: number) =>
      [...vaultQueryKeys.publicDetail.positionHistoryRoot(vaultId)] as const,
  },

  userDetail: {
    family: (vaultId?: number) => [...vaultQueryKeys.scope(vaultId), "user-detail"] as const,
    root: (vaultId: number | undefined, userScope: string) =>
      [...vaultQueryKeys.userDetail.family(vaultId), userScope] as const,
    historyRoot: (vaultId: number | undefined, userScope: string) =>
      [...vaultQueryKeys.userDetail.root(vaultId, userScope), "history"] as const,
    history: (vaultId: number | undefined, userScope: string, limit = 100, offset = 0) =>
      [...vaultQueryKeys.userDetail.historyRoot(vaultId, userScope), limit, offset] as const,
    requests: (vaultId: number | undefined, userScope: string) =>
      [...vaultQueryKeys.userDetail.root(vaultId, userScope), "requests"] as const,
    depositQueue: (vaultId: number | undefined, userScope: string) =>
      [...vaultQueryKeys.userDetail.root(vaultId, userScope), "deposit-queue"] as const,
    trancheStatus: (vaultId?: number, cycleId?: number, userScope = "global") =>
      [
        ...vaultQueryKeys.userDetail.root(vaultId, userScope),
        "tranche-status",
        cycleId ?? "current",
      ] as const,
    carryEligibility: (vaultId?: number, requestId?: string, userScope = "global") =>
      [
        ...vaultQueryKeys.userDetail.root(vaultId, userScope),
        "carry-eligibility",
        requestId ?? "all",
      ] as const,
  },

  status: (vaultId?: number) => vaultQueryKeys.publicDetail.status(vaultId),
  tradingAnalytics: (vaultId?: number) => vaultQueryKeys.publicDetail.tradingAnalytics(vaultId),
  events: (vaultId?: number) => vaultQueryKeys.publicDetail.eventsRoot(vaultId),
  history: (vaultId: number | undefined, userScope: string) =>
    vaultQueryKeys.userDetail.historyRoot(vaultId, userScope),
  navHistory: (vaultId?: number, limit?: number) =>
    vaultQueryKeys.publicDetail.navHistory(vaultId, limit),
  cycleStatus: (vaultId?: number, cycleId?: number) =>
    vaultQueryKeys.publicDetail.cycleStatus(vaultId, cycleId),
  positionHistory: (vaultId?: number) => vaultQueryKeys.publicDetail.positionHistory(vaultId),
  requests: (vaultId: number | undefined, userScope: string) =>
    vaultQueryKeys.userDetail.requests(vaultId, userScope),
  withdrawalQueue: (vaultAddress?: string, userScope = "anonymous") =>
    ["vault", "withdrawal-queue", userScope, vaultAddress ?? "all"] as const,
  depositQueue: (vaultId: number | undefined, userScope: string) =>
    vaultQueryKeys.userDetail.depositQueue(vaultId, userScope),
  trancheStatus: (vaultId?: number, cycleId?: number, userScope = "global") =>
    vaultQueryKeys.userDetail.trancheStatus(vaultId, cycleId, userScope),
  carryEligibility: (vaultId?: number, requestId?: string, userScope = "global") =>
    vaultQueryKeys.userDetail.carryEligibility(vaultId, requestId, userScope),
};
