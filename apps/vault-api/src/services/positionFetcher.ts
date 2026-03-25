/**
 * Position Fetcher — Fetches live positions from Polymarket Data API
 *
 * Replaces DB-based position reads with live on-chain/API data.
 * Uses the same Data API as apps/web position-analytics page.
 *
 * Endpoint: GET https://data-api.polymarket.com/positions?user={address}
 */

import { logger } from "../logger.js";
import { SUPPORTS_POLYMARKET_TRADING } from "../constants.js";

const DATA_API_BASE = "https://data-api.polymarket.com";

/** Request timeout for Data API calls (ms) */
const FETCH_TIMEOUT_MS = 30_000;

/** Maximum positions per page (API limit) */
const BATCH_SIZE = 500;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// ===== Types =====

/**
 * Raw position from Polymarket Data API.
 * Fields match the API response shape.
 */
export interface PolymarketPosition {
  proxyWallet: string;
  asset: string; // tokenId
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

interface PolymarketActivity {
  timestamp: number;
  conditionId: string;
  type: "TRADE" | "REDEEM" | "MAKER_REBATE";
  size: number;
  usdcSize: number;
  price: number;
  asset: string;
  side: "BUY" | "SELL";
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
}

/**
 * Simplified open position for NAV calculation.
 * Extracted from PolymarketPosition with only what NAV needs.
 */
export interface OpenPosition {
  /** Conditional token ID (used for CLOB price lookup) */
  tokenId: string;
  /** Condition ID (used for resolution/redemption) */
  conditionId: string;
  /** Number of shares held */
  size: number;
  /** Average purchase price per share */
  avgPrice: number;
  /** Total cost basis (size × avgPrice) */
  costBasis: number;
  /** Current mid-price from Data API */
  curPrice: number;
  currentValue?: number;
  /** Market title for logging */
  title: string;
  slug: string;
  eventSlug?: string;
  /** Outcome name (e.g., "Yes", "No") */
  outcome: string;
  /** Market end date */
  endDate: string;
  /** Whether the position is redeemable (resolved) */
  redeemable: boolean;
}

export interface PositionHistoryItem {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  costBasis: number;
  curPrice: number;
  currentValue: number;
  realizedPnl: number;
  cashPnl: number;
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
  endDate: string;
  redeemable: boolean;
  status: "redeemable" | "closed";
}

// ===== Service =====

export class PositionFetcher {
  private checkSupported(): void {
    if (!SUPPORTS_POLYMARKET_TRADING) {
      throw new Error(
        "PositionFetcher: Polymarket Data API is not available on the current network. " +
          "Position fetching is only supported on Polygon mainnet.",
      );
    }
  }

  async fetchActivity(walletAddress: string, maxRecords = 5000): Promise<PolymarketActivity[]> {
    if (!SUPPORTS_POLYMARKET_TRADING) {
      return [];
    }
    this.checkSupported();
    const allActivities: PolymarketActivity[] = [];
    let offset = 0;

    while (allActivities.length < maxRecords) {
      const url = `${DATA_API_BASE}/activity?user=${walletAddress}&limit=${BATCH_SIZE}&offset=${offset}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Data API returned ${response.status}: ${response.statusText}`);
        }

        const batch = (await response.json()) as PolymarketActivity[];
        if (batch.length === 0) break;

        allActivities.push(...batch);
        offset += BATCH_SIZE;

        if (batch.length < BATCH_SIZE) break;
      } catch (error) {
        const message = getErrorMessage(error);
        const isTimeout =
          (error instanceof Error && error.name === "AbortError") || message.includes("aborted");

        throw new Error(
          `PositionFetcher: Activity API request failed (wallet=${walletAddress}, offset=${offset}, limit=${BATCH_SIZE}, url=${url}, timeoutMs=${FETCH_TIMEOUT_MS}, timeout=${isTimeout}): ${message}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    return allActivities;
  }

  /**
   * Fetch ALL positions for a wallet from Polymarket Data API.
   * Handles pagination automatically.
   */
  async fetchAllPositions(walletAddress: string): Promise<PolymarketPosition[]> {
    if (!SUPPORTS_POLYMARKET_TRADING) {
      return [];
    }
    this.checkSupported();
    const allPositions: PolymarketPosition[] = [];
    let offset = 0;

    while (true) {
      const url = `${DATA_API_BASE}/positions?user=${walletAddress}&sizeThreshold=0&limit=${BATCH_SIZE}&offset=${offset}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Data API returned ${response.status}: ${response.statusText}`);
        }

        const batch = (await response.json()) as PolymarketPosition[];

        if (batch.length === 0) break;

        allPositions.push(...batch);
        offset += BATCH_SIZE;

        if (batch.length < BATCH_SIZE) break;
      } catch (error) {
        const message = getErrorMessage(error);
        const isTimeout =
          (error instanceof Error && error.name === "AbortError") || message.includes("aborted");

        throw new Error(
          `PositionFetcher: Data API request failed (wallet=${walletAddress}, offset=${offset}, limit=${BATCH_SIZE}, url=${url}, timeoutMs=${FETCH_TIMEOUT_MS}, timeout=${isTimeout}): ${message}`,
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    logger.info("PositionFetcher: Fetched positions from Data API", {
      walletAddress: walletAddress.slice(0, 10) + "...",
      total: allPositions.length,
    });

    return allPositions;
  }

  /**
   * Fetch only OPEN positions (size > 0, not redeemable).
   * These are the positions that need mark-to-market valuation.
   */
  async fetchOpenPositions(walletAddress: string): Promise<OpenPosition[]> {
    const all = await this.fetchAllPositions(walletAddress);

    const open = all
      .filter((p) => p.size > 0 && !p.redeemable)
      .map(
        (p): OpenPosition => ({
          tokenId: p.asset,
          conditionId: p.conditionId,
          size: p.size,
          avgPrice: p.avgPrice,
          costBasis: p.size * p.avgPrice,
          curPrice: p.curPrice,
          currentValue: p.currentValue,
          title: p.title,
          slug: p.slug,
          eventSlug: p.eventSlug,
          outcome: p.outcome,
          endDate: p.endDate,
          redeemable: p.redeemable,
        }),
      );

    logger.info("PositionFetcher: Filtered open positions", {
      walletAddress: walletAddress.slice(0, 10) + "...",
      total: all.length,
      open: open.length,
      redeemable: all.filter((p) => p.redeemable).length,
      zeroed: all.filter((p) => p.size === 0).length,
    });

    return open;
  }

  /**
   * Fetch positions that are redeemable (resolved, need CT redemption).
   */
  async fetchRedeemablePositions(walletAddress: string): Promise<OpenPosition[]> {
    const all = await this.fetchAllPositions(walletAddress);

    return all
      .filter((p) => p.redeemable && p.size > 0)
      .map(
        (p): OpenPosition => ({
          tokenId: p.asset,
          conditionId: p.conditionId,
          size: p.size,
          avgPrice: p.avgPrice,
          costBasis: p.size * p.avgPrice,
          curPrice: p.curPrice,
          currentValue: p.currentValue,
          title: p.title,
          slug: p.slug,
          eventSlug: p.eventSlug,
          outcome: p.outcome,
          endDate: p.endDate,
          redeemable: p.redeemable,
        }),
      );
  }

  async fetchPositionHistory(walletAddress: string): Promise<PositionHistoryItem[]> {
    const [all, activity] = await Promise.all([
      this.fetchAllPositions(walletAddress),
      this.fetchActivity(walletAddress),
    ]);

    const fromPositions = all
      .filter((p) => p.redeemable || p.size <= 0)
      .map(
        (p): PositionHistoryItem => ({
          tokenId: p.asset,
          conditionId: p.conditionId,
          size: p.size,
          avgPrice: p.avgPrice,
          costBasis: p.size * p.avgPrice,
          curPrice: p.curPrice,
          currentValue: p.currentValue,
          realizedPnl: p.realizedPnl,
          cashPnl: p.cashPnl,
          title: p.title,
          slug: p.slug,
          eventSlug: p.eventSlug,
          outcome: p.outcome,
          endDate: p.endDate,
          redeemable: p.redeemable,
          status: p.redeemable ? "redeemable" : "closed",
        }),
      );

    const liveTokenIds = new Set(all.map((p) => p.asset));
    const fromActivity = this.reconstructClosedFromActivity(activity, liveTokenIds);

    return [...fromPositions, ...fromActivity]
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())
      .slice(0, 200);
  }

  private reconstructClosedFromActivity(
    activity: PolymarketActivity[],
    liveTokenIds: Set<string>,
  ): PositionHistoryItem[] {
    const byCondition = new Map<string, PolymarketActivity[]>();

    for (const entry of activity) {
      if (entry.type !== "TRADE" && entry.type !== "REDEEM") continue;
      const list = byCondition.get(entry.conditionId) ?? [];
      list.push(entry);
      byCondition.set(entry.conditionId, list);
    }

    const closed: PositionHistoryItem[] = [];

    for (const entries of byCondition.values()) {
      const buys = entries.filter((a) => a.type === "TRADE" && a.side === "BUY");
      if (buys.length === 0) continue;

      const firstBuy = buys.sort((a, b) => a.timestamp - b.timestamp)[0]!;
      if (liveTokenIds.has(firstBuy.asset)) continue;

      const sells = entries.filter((a) => a.type === "TRADE" && a.side === "SELL");
      const redeems = entries.filter((a) => a.type === "REDEEM");

      const totalBought = buys.reduce((sum, item) => sum + item.usdcSize, 0);
      const totalSold = sells.reduce((sum, item) => sum + item.usdcSize, 0);
      const totalRedeemed = redeems.reduce((sum, item) => sum + item.usdcSize, 0);

      const effectivelyClosed = redeems.length > 0 || totalSold >= totalBought * 0.9;
      if (!effectivelyClosed) continue;

      const last = entries.sort((a, b) => b.timestamp - a.timestamp)[0]!;
      const currentValue = totalRedeemed > 0 ? totalRedeemed : totalSold;
      const realizedPnl = currentValue - totalBought;

      closed.push({
        tokenId: firstBuy.asset,
        conditionId: firstBuy.conditionId,
        size: buys.reduce((sum, item) => sum + item.size, 0),
        avgPrice:
          buys.reduce((sum, item) => sum + item.price * item.size, 0) /
          Math.max(
            1,
            buys.reduce((sum, item) => sum + item.size, 0),
          ),
        costBasis: totalBought,
        curPrice: sells[0]?.price ?? (totalRedeemed > 0 ? 1 : 0),
        currentValue,
        realizedPnl,
        cashPnl: realizedPnl,
        title: firstBuy.title,
        slug: firstBuy.slug,
        eventSlug: firstBuy.eventSlug,
        outcome: firstBuy.outcome,
        endDate: new Date(last.timestamp * 1000).toISOString(),
        redeemable: false,
        status: "closed",
      });
    }

    return closed;
  }
}

export const positionFetcher = new PositionFetcher();
