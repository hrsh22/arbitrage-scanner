import { Router } from "express";
import { OpportunityRepository } from "../db/repositories/opportunityRepository.js";
import type { OpportunityStore } from "../services/opportunityStore.js";
import { env } from "../env.js";

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const buildOpportunitiesRouter = (
  store: OpportunityStore,
  repository: OpportunityRepository,
): Router => {
  const router = Router();

  // Feature flag check - return disabled response if Polymarket arbitrage is off
  const isDisabled = !env.ENABLE_POLYMARKET_ARBITRAGE;
  const disabledResponse = {
    opportunities: [],
    enabled: false,
    message: "Polymarket arbitrage detection is temporarily disabled",
  };

  // Build Polymarket URL from eventSlug
  const attachLink = <T extends { eventSlug?: string | null; marketSlug?: string | null }>(
    opportunity: T,
  ) => ({
    ...opportunity,
    marketUrl: opportunity.eventSlug
      ? `https://polymarket.com/event/${opportunity.eventSlug}`
      : opportunity.marketSlug
        ? `https://polymarket.com/event/${opportunity.marketSlug}`
        : undefined,
  });

  // GET /opportunities - current in-memory opportunities
  router.get("/", (req, res) => {
    if (isDisabled) {
      return res.json(disabledResponse);
    }

    const filter = {
      minProfitPct: parseNumber(req.query.minProfitPct),
      minLiquidity: parseNumber(req.query.minLiquidity),
      sort: (req.query.sort as "score" | "profit" | "liquidity" | "newest") ?? "score",
    };

    const opportunities = store.all(filter).map((item) => attachLink(item));

    res.json({
      opportunities,
      enabled: true,
      lastUpdated: store.getLastUpdated(),
    });
  });

  // GET /opportunities/history - historical opportunities from DB
  router.get("/history", async (req, res) => {
    if (isDisabled) {
      return res.json(disabledResponse);
    }

    try {
      const limit = parseNumber(req.query.limit) ?? 100;
      const includeExpired = req.query.includeExpired !== "false";
      const history = await repository.recent(limit, includeExpired);

      // Map DB records to API format
      const mapped = history.map((item) => ({
        key: item.opportunityKey,
        type: item.type,
        marketId: item.marketId,
        marketSlug: item.marketSlug,
        eventSlug: item.eventSlug,
        question: item.marketQuestion,
        outcomes: item.outcomes,
        profitPercentage: parseFloat(item.profitPct ?? "0"),
        profitAbsolute: parseFloat(item.profitAbs ?? "0"),
        totalCost: parseFloat(item.totalCost ?? "0"),
        availableLiquidity: parseFloat(item.liquidity ?? "0"),
        score: parseFloat(item.score ?? "0"),
        closesAt: item.closesAt,
        detectedAt: item.detectedAt,
        expiredAt: item.expiredAt,
        isActive: item.expiredAt === null,
      }));

      res.json({
        opportunities: mapped.map((item) => attachLink(item)),
        total: mapped.length,
        active: mapped.filter((o) => o.isActive).length,
        expired: mapped.filter((o) => !o.isActive).length,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // GET /opportunities/stats - aggregated stats
  router.get("/stats", async (_req, res) => {
    try {
      const stats = await repository.stats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // POST /opportunities/:key/action - record action on opportunity
  router.post("/:key/action", async (req, res) => {
    const { key } = req.params;
    const { action, investment, actualProfit } = req.body ?? {};

    if (action !== "executed" && action !== "missed") {
      return res.status(400).json({ error: "action must be 'executed' or 'missed'" });
    }

    try {
      await repository.recordAction(
        key,
        action,
        investment ? Number(investment) : undefined,
        actualProfit ? Number(actualProfit) : undefined,
      );
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  return router;
};
