/**
 * Trading Bot Types
 */

export interface ScoredOpportunity {
  marketId: string;
  marketQuestion: string;
  marketSlug?: string;
  tokenId: string;
  oppositeTokenId?: string;
  outcome: string; // "Yes" or "No"
  probability: number; // e.g., 0.96
  buyPrice: number; // Effective price after slippage
  hoursUntilClose: number;
  closesAt: Date;
  liquidity: number;
  pphScore: number; // Profit-per-hour score
  expectedProfit: number; // Expected profit for $1 bet
  canBet: boolean;
  skipReason?: string;
  // Best-case scenario stats
  maxInvestment: number; // Max $ that can be invested (based on liquidity)
  maxProfitPercent: number; // Profit % if outcome is correct: (1 - buyPrice) / buyPrice * 100
  maxProfitAbsolute: number; // Max absolute profit: maxInvestment * (1 - buyPrice) / buyPrice
}

export interface Position {
  id: number;
  marketId: string;
  marketQuestion: string;
  marketSlug?: string;
  tokenId: string;
  outcome: string;
  entryPrice: number;
  cost: number;
  closesAt?: Date;
  hoursUntilCloseAtEntry?: number;
  pphScore?: number;
  status: "open" | "in_review" | "won" | "lost" | "expired";
  resolvedAt?: Date;
  profitLoss?: number;
  isSimulated: boolean;
  createdAt: Date;
  parentPositionId?: number;
}

export interface DailyStats {
  date: string;
  betsPlaced: number;
  amountDeployed: number;
  betsWon: number;
  betsLost: number;
  netPnL: number;
  isSimulated: boolean;
}

export interface OverallStats {
  totalBetsPlaced: number;
  totalAmountDeployed: number;
  totalBetsWon: number;
  totalBetsLost: number;
  totalNetPnL: number;
  winRate: number;
  averagePnLPerBet: number;
}

export interface BotStatus {
  mode: "simulation" | "live";
  lastScanAt?: Date;
  todayBets: number;
  todayDeployed: number;
  todayPnL: number;
  remainingBudget: number;
  openPositions: number;
  walletBalance?: number;
}

export interface BotEvent {
  id: number;
  eventType: "circuit_breaker" | "error" | "trade" | "mode_change" | "info" | "missed_opportunity";
  eventName: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  fillPrice?: number;
  fillSize?: number;
  error?: string;
}

export interface WalletStatus {
  ready: boolean;
  walletAddress: string;
  usdcBalance: number;
  allowanceOk: boolean;
  issues: string[];
}
