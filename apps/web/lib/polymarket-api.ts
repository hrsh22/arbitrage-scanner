export interface PolymarketPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon?: string;
  eventId?: string;
  eventSlug?: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

export interface PolymarketActivity {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: "TRADE" | "REDEEM" | "MAKER_REBATE";
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: "BUY" | "SELL";
  outcomeIndex: number;
  title: string;
  slug: string;
  icon?: string;
  eventSlug?: string;
  outcome: string;
}

export interface PolymarketPricePoint {
  t: number;
  p: number;
}

const DATA_API_BASE = "https://data-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";

export async function fetchPositions(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<PolymarketPosition[]> {
  const allPositions: PolymarketPosition[] = [];
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const url = `${DATA_API_BASE}/positions?user=${walletAddress}&sizeThreshold=0&limit=${batchSize}&offset=${offset}`;
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`Failed to fetch positions: ${response.status}`);
    }

    const batch = (await response.json()) as PolymarketPosition[];
    if (batch.length === 0) break;

    allPositions.push(...batch);
    offset += batchSize;

    if (batch.length < batchSize) break;
  }

  return allPositions;
}

export async function fetchActivity(
  walletAddress: string,
  maxRecords = 5000,
  signal?: AbortSignal,
): Promise<PolymarketActivity[]> {
  const allActivities: PolymarketActivity[] = [];
  let offset = 0;
  const batchSize = 500;

  while (allActivities.length < maxRecords) {
    const url = `${DATA_API_BASE}/activity?user=${walletAddress}&limit=${batchSize}&offset=${offset}`;
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`Failed to fetch activity: ${response.status}`);
    }

    const batch = (await response.json()) as PolymarketActivity[];
    if (batch.length === 0) break;

    allActivities.push(...batch);
    offset += batchSize;

    if (batch.length < batchSize) break;
  }

  return allActivities;
}

export async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  endTs: number,
  fidelityMinutes: number,
  signal?: AbortSignal,
): Promise<{ timestamp: number; price: number }[]> {
  const url = `${CLOB_API_BASE}/prices-history?market=${tokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=${fidelityMinutes}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    console.warn(`Price history not available for ${tokenId}`);
    return [];
  }

  const data = (await response.json()) as { history?: PolymarketPricePoint[] };
  return (data.history || []).map((p) => ({
    timestamp: p.t,
    price: p.p,
  }));
}

export const DEFAULT_WALLET = "0xabe50375A4064C5d5E0BE39063082e8eeF144097";

export const WALLET_OPTIONS = [{ label: "Default", value: DEFAULT_WALLET }] as const;

export async function fetchEventTags(
  eventSlugs: string[],
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  if (eventSlugs.length === 0) return {};

  const uniqueSlugs = [...new Set(eventSlugs.filter(Boolean))];
  const batchSize = 20;
  const results: Record<string, string[]> = {};

  for (let i = 0; i < uniqueSlugs.length; i += batchSize) {
    const batch = uniqueSlugs.slice(i, i + batchSize);
    const url = `/api/gamma/events?slugs=${batch.join(",")}`;

    try {
      const response = await fetch(url, { signal });
      if (response.ok) {
        const data = (await response.json()) as { events: Record<string, string[]> };
        Object.assign(results, data.events);
      }
    } catch {
      batch.forEach((slug) => {
        results[slug] = [];
      });
    }
  }

  return results;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

export interface ResolvedPositionFromDB {
  id: number;
  walletAddress: string;
  tokenId: string;
  conditionId: string;
  eventSlug: string | null;
  marketSlug: string | null;
  marketQuestion: string | null;
  outcome: string | null;
  entryPrice: string | null;
  cost: string | null;
  size: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  finalPrice: string | null;
  profitLoss: string | null;
  result: string | null;
  maxDrawdownPercent: string | null;
  lowestPrice: string | null;
  highestPrice: string | null;
  priceHistory: { timestamp: number; price: number }[] | null;
  oppositeOutcomePriceHistory: { timestamp: number; price: number }[] | null;
  stopLossSimulations: unknown[] | null;
  hedgingSimulations: unknown[] | null;
  category: string | null;
  tags: string[] | null;
  fidelityMinutes: string | null;
  capturedAt: string;
  updatedAt: string;
}

export interface ResolvedPositionsResponse {
  success: boolean;
  positions: ResolvedPositionFromDB[];
  stats: {
    total: number;
    won: number;
    lost: number;
    totalPnL: number;
  };
  count: number;
}

export interface SyncResponse {
  success: boolean;
  synced: number;
  existing: number;
  total?: number;
  message?: string;
}

export async function fetchResolvedPositionsFromDB(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<ResolvedPositionsResponse> {
  const url = `${API_BASE}/resolved-positions/${walletAddress}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch resolved positions: ${response.status}`);
  }

  return response.json();
}

export async function syncResolvedPositions(
  walletAddress: string,
  fidelity = 5,
  signal?: AbortSignal,
): Promise<SyncResponse> {
  const url = `${API_BASE}/resolved-positions/${walletAddress}/sync?fidelity=${fidelity}`;
  const response = await fetch(url, { method: "POST", signal });

  if (!response.ok) {
    throw new Error(`Failed to sync resolved positions: ${response.status}`);
  }

  return response.json();
}

export interface StopLossAnalysisItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  totalPnlIfSold: number;
  totalPnlIfHeld: number;
  netImpact: number;
  avgImpactPerTriggered: number;
}

export interface HedgingAnalysisItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  fullLockGrossSavings: number;
  fullLockCostOnWinners: number;
  fullLockNetImpact: number;
  doubleOppositeGrossSavings: number;
  doubleOppositeCostOnWinners: number;
  doubleOppositeNetImpact: number;
}

export interface CategoryStopLossItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  netImpact: number;
}

export interface CategoryHedgingItem {
  threshold: number;
  triggeredCount: number;
  recoveredCount: number;
  fullLockGrossSavings: number;
  fullLockCostOnWinners: number;
  fullLockNetImpact: number;
  doubleOppositeGrossSavings: number;
  doubleOppositeCostOnWinners: number;
  doubleOppositeNetImpact: number;
}

export interface BestStrategy {
  type: "none" | "stop-loss" | "hedge-full" | "hedge-double";
  threshold: number | null;
  expectedImprovement: number;
  reason: string;
}

export interface CategoryBreakdownItem {
  category: string;
  positionCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgDrawdown: number;
  stopLossAnalysis: CategoryStopLossItem[];
  hedgingAnalysis: CategoryHedgingItem[];
  bestStrategy: BestStrategy;
}

export interface DailyPnlItem {
  date: string;
  pnl: number;
  positionCount: number;
  cumulativePnl: number;
}

export interface WalletAnalytics {
  id: number;
  walletAddress: string;
  totalPnl: string;
  totalCost: string;
  winCount: string;
  lossCount: string;
  winRate: string;
  avgEntryPrice: string;
  avgPnlPerPosition: string;
  avgHoldingHours: string;
  stopLossAnalysis: StopLossAnalysisItem[];
  hedgingAnalysis: HedgingAnalysisItem[];
  categoryBreakdown: CategoryBreakdownItem[];
  dailyPnl: DailyPnlItem[];
  computedAt: string;
}

export interface WalletAnalyticsResponse {
  success: boolean;
  analytics: WalletAnalytics;
}

export async function fetchWalletAnalytics(
  walletAddress: string,
  signal?: AbortSignal,
): Promise<WalletAnalyticsResponse> {
  const url = `${API_BASE}/resolved-positions/${walletAddress}/analytics`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch wallet analytics: ${response.status}`);
  }

  return response.json();
}

export interface SinglePositionResponse {
  success: boolean;
  position: ResolvedPositionFromDB;
}

export async function fetchSinglePosition(
  walletAddress: string,
  tokenId: string,
  signal?: AbortSignal,
): Promise<SinglePositionResponse> {
  const url = `${API_BASE}/resolved-positions/${walletAddress}/position/${tokenId}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch position: ${response.status}`);
  }

  return response.json();
}

export interface MissedOpportunityEvent {
  id: number;
  eventType: string;
  eventName: string;
  message: string;
  metadata: {
    marketId: string;
    marketQuestion: string;
    outcome: string;
    buyPrice: number;
    pphScore: number;
    expectedProfit: number;
    hoursUntilClose: number;
    potentialProfit: number;
  };
  createdAt: string;
}

export interface MissedOpportunitiesResponse {
  events: MissedOpportunityEvent[];
  total: number;
}

export async function fetchMissedOpportunities(
  botId: number = 1,
  limit: number = 500,
  signal?: AbortSignal,
): Promise<MissedOpportunitiesResponse> {
  const url = `${API_BASE}/bot/${botId}/events?type=missed_opportunity&limit=${limit}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch missed opportunities: ${response.status}`);
  }

  return response.json();
}
