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
  const url = `${DATA_API_BASE}/positions?user=${walletAddress}&sizeThreshold=0`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch positions: ${response.status}`);
  }

  return response.json();
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

export async function fetchMarketTags(
  _eventSlug: string,
  _signal?: AbortSignal,
): Promise<string[]> {
  return [];
}

export const DEFAULT_WALLET = "0xabe50375A4064C5d5E0BE39063082e8eeF144097";

export const WALLET_OPTIONS = [{ label: "Default", value: DEFAULT_WALLET }] as const;
