export interface VaultStatus {
  totalShares: string;
  totalAssetsUsdc: string;
  idleUsdc: string;
  navPerShare: string;
  lastNavUpdateAt: string;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  openPositionsCount: number;
  contractAddress: string;
  treasuryAddress: string;
}

export interface UserPosition {
  shares: string;
  valueUsdc: string;
  ownershipPct: string;
  pendingWithdrawal: boolean;
}

export interface DepositRecord {
  id: number;
  txHash: string;
  amountUsdc: string;
  sharesReceived: string;
  navAtDeposit: string;
  createdAt: string;
}

export interface WithdrawalRequestRecord {
  id: number;
  sharesLocked: string;
  ownershipPct: string;
  idleUsdcClaim: string;
  status: "pending" | "processing" | "completed" | "cancelled";
  requestedAt: string;
  completedAt: string | null;
  totalClaimedUsdc: string;
  claims: ClaimRecord[];
}

export interface ClaimRecord {
  id: number;
  positionId: number;
  marketQuestion: string;
  sharesClaimed: string;
  status: "pending" | "resolved_win" | "resolved_loss" | "claimed";
  resolutionValueUsdc: string | null;
  claimedAt: string | null;
}

export interface PositionRecord {
  id: number;
  marketId: string;
  marketQuestion: string;
  marketSlug: string | null;
  tokenId: string;
  outcome: string;
  shares: string;
  entryPrice: string;
  costUsdc: string;
  currentPrice: string | null;
  currentValueUsdc: string;
  status: "open" | "won" | "lost";
  closesAt: string | null;
  resolvedAt: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
