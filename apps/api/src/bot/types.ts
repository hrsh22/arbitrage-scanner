/**
 * Trading Bot Types
 */

export interface ScoredOpportunity {
  marketId: string;
  marketQuestion: string;
  marketSlug?: string;
  tokenId: string;
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
  conditionId?: string; // Polymarket's condition ID
  marketQuestion: string;
  marketSlug?: string;
  tokenId: string;
  eventSlug?: string;
  outcome: string;
  entryPrice: number;
  shares?: number; // Actual share count from Polymarket
  cost: number;
  currentPrice?: number; // Latest price from Polymarket
  closesAt?: Date;
  hoursUntilCloseAtEntry?: number;
  pphScore?: number;
  status: "open" | "in_review" | "won" | "lost" | "expired" | "sold";
  resolvedAt?: Date;
  profitLoss?: number;
  realizedPnL?: number; // P/L from shares already sold
  unrealizedPnL?: number; // P/L from shares still held (based on currentPrice)
  isSimulated: boolean;
  source?: "bot" | "external"; // Where the position originated
  lastSyncedAt?: Date;
  createdAt: Date;
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
  isRunning: boolean;
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
  eventType: "circuit_breaker" | "error" | "trade" | "mode_change" | "info";
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

/**
 * Individual trade record from Polymarket
 */
export interface Trade {
  id: number;
  transactionHash: string;
  positionId?: number;
  tokenId: string;
  side: "BUY" | "SELL";
  shares: number;
  price: number;
  usdcSize: number;
  conditionId?: string;
  title?: string;
  slug?: string;
  outcome?: string;
  eventSlug?: string;
  tradeTimestamp?: Date;
  syncedAt: Date;
}

/**
 * Activity record from Polymarket Activity API
 */
export interface ActivityRecord {
  proxyWallet: string;
  timestamp: number; // Unix timestamp
  conditionId: string;
  type: string; // "TRADE"
  size: number; // shares
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string; // tokenId
  side: "BUY" | "SELL";
  outcomeIndex: number;
  title: string;
  slug: string;
  icon?: string;
  eventSlug: string;
  outcome: string;
  name?: string;
  pseudonym?: string;
}

/**
 * Position aggregates calculated from trades
 */
export interface PositionAggregates {
  totalSharesBought: number;
  totalSharesSold: number;
  netShares: number;
  totalCost: number; // Total USDC spent on buys
  totalProceeds: number; // Total USDC received from sells
  avgEntryPrice: number;
  realizedPnL: number; // P/L from closed portion
  unrealizedPnL: number; // P/L from open portion (requires currentPrice)
}
