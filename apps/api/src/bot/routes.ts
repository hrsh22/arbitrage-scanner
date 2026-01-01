/**
 * Bot API Routes
 *
 * Endpoints for monitoring and controlling multiple trading bot instances.
 */

import { Router } from "express";
import { getBotManager } from "./botManager.js";
import { getBotConfig, getEnabledBotConfigs } from "./config/index.js";
import { getBotRepository } from "./repository.js";
import { logger } from "../logger.js";

export function buildBotRouter(): Router {
  const router = Router();
  const manager = getBotManager();

  // ==========================================
  // MULTI-BOT ENDPOINTS
  // ==========================================

  /**
   * GET /bot/instances
   * List all configured bot instances with their status
   */
  router.get("/instances", async (_req, res) => {
    try {
      await manager.initialize();
      const statuses = await manager.getAllStatuses();
      const configs = manager.getBotConfigs();

      const instances = configs.map((config) => {
        const status = statuses.find((s) => s.botId === config.id);
        return {
          id: config.id,
          name: config.name,
          enabled: config.enabled,
          config: {
            betSize: config.betSize,
            dailyBudget: config.dailyBudget,
            minOdds: config.minOdds,
            maxOdds: config.maxOdds,
            maxHoursGeneral: config.maxHoursGeneral,
            walletPrivateKeyEnv: config.walletPrivateKeyEnv,
          },
          status: status ?? null,
        };
      });

      res.json({
        instances,
        total: instances.length,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get instances", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/scan-all
   * Run scan cycle for all enabled bots
   */
  router.post("/scan-all", async (_req, res) => {
    try {
      const startTime = Date.now();
      await manager.initialize();
      const results = await manager.runAllScans();
      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: "Scan completed for all bots",
        durationMs: duration,
        results,
      });
    } catch (error) {
      logger.error("Bot API: Scan-all failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/check-resolutions-all
   * Check resolutions for all enabled bots
   */
  router.post("/check-resolutions-all", async (_req, res) => {
    try {
      const startTime = Date.now();
      const results = await manager.runAllResolutionChecks();
      const duration = Date.now() - startTime;

      // Aggregate totals
      const totals = results.reduce(
        (acc, r) => ({
          checked: acc.checked + r.result.checked,
          resolved: acc.resolved + r.result.resolved,
          won: acc.won + r.result.won,
          lost: acc.lost + r.result.lost,
        }),
        { checked: 0, resolved: 0, won: 0, lost: 0 },
      );

      res.json({
        success: true,
        message: "Resolution check completed for all bots",
        durationMs: duration,
        totals,
        results,
      });
    } catch (error) {
      logger.error("Bot API: Check-resolutions-all failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/stats/aggregate
   * Get aggregate stats across all bots
   */
  router.get("/stats/aggregate", async (req, res) => {
    try {
      const isSimulated = req.query.mode !== "live";
      const stats = await manager.getAggregateStats(isSimulated);

      res.json({
        stats,
        mode: isSimulated ? "simulation" : "live",
      });
    } catch (error) {
      logger.error("Bot API: Failed to get aggregate stats", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ==========================================
  // SINGLE BOT ENDPOINTS (by ID)
  // ==========================================

  /**
   * GET /bot/:botId/status
   * Get status for a specific bot
   */
  router.get("/:botId/status", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      await manager.initialize();
      const bot = manager.getBot(botId);
      if (!bot) {
        res.status(404).json({ error: `Bot ${botId} not found` });
        return;
      }

      const status = await bot.getStatus();
      const config = bot.getConfig();

      res.json({
        ...status,
        config: {
          betSize: config.betSize,
          dailyBudget: config.dailyBudget,
          minOdds: config.minOdds,
          maxOdds: config.maxOdds,
          maxHoursGeneral: config.maxHoursGeneral,
        },
      });
    } catch (error) {
      logger.error("Bot API: Failed to get bot status", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/:botId/wallet
   * Get wallet status for a specific bot
   */
  router.get("/:botId/wallet", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      await manager.initialize();
      const bot = manager.getBot(botId);
      if (!bot) {
        res.status(404).json({ error: `Bot ${botId} not found` });
        return;
      }

      const tradingClient = bot.getTradingClient();
      if (!tradingClient.isInitialized()) {
        res.json({
          initialized: false,
          message: "Trading client not initialized. Set wallet env vars to enable.",
        });
        return;
      }

      const walletStatus = await tradingClient.checkReadiness();
      res.json({
        initialized: true,
        ...walletStatus,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get wallet status", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/:botId/opportunities
   * Get currently detected opportunities for a specific bot
   */
  router.get("/:botId/opportunities", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      await manager.initialize();
      const bot = manager.getBot(botId);
      if (!bot) {
        res.status(404).json({ error: `Bot ${botId} not found` });
        return;
      }

      const opportunities = await bot.getCurrentOpportunities();

      // Separate bettable from skipped
      const bettable = opportunities.filter((o) => o.canBet);
      const skipped = opportunities.filter((o) => !o.canBet);

      res.json({
        bettable,
        skipped,
        total: opportunities.length,
        bettableCount: bettable.length,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get opportunities", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/:botId/positions
   * Get all positions for a specific bot
   */
  router.get("/:botId/positions", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const limit = Number(req.query.limit) || 100;
      const repository = getBotRepository(String(botId));
      const positions = await repository.getPositionHistory(limit);

      res.json({
        positions,
        total: positions.length,
        botId,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get positions", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/:botId/positions/open
   * Get only open positions for a specific bot
   */
  router.get("/:botId/positions/open", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const simulatedParam = req.query.simulated as string | undefined;
      let isSimulated: boolean | undefined;

      if (simulatedParam === "true") {
        isSimulated = true;
      } else if (simulatedParam === "false") {
        isSimulated = false;
      }

      const repository = getBotRepository(String(botId));
      const positions = await repository.getOpenPositions(isSimulated);

      res.json({
        positions,
        total: positions.length,
        botId,
        filter: isSimulated !== undefined ? { simulated: isSimulated } : "all",
      });
    } catch (error) {
      logger.error("Bot API: Failed to get open positions", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/:botId/stats
   * Get statistics for a specific bot
   */
  router.get("/:botId/stats", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const isSimulated = req.query.mode !== "live";
      const repository = getBotRepository(String(botId));
      const overall = await repository.getOverallStats(isSimulated);
      const today = await repository.getTodayStats(isSimulated);

      res.json({
        overall,
        today,
        mode: isSimulated ? "simulation" : "live",
        botId,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get stats", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/:botId/stats/daily
   * Get daily stats history for a specific bot
   */
  router.get("/:botId/stats/daily", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const limit = Number(req.query.limit) || 30;
      const modeParam = req.query.mode as string | undefined;
      let isSimulated: boolean | undefined;

      if (modeParam === "simulation") {
        isSimulated = true;
      } else if (modeParam === "live") {
        isSimulated = false;
      }

      const repository = getBotRepository(String(botId));
      const history = await repository.getDailyStatsHistory(limit, isSimulated);

      res.json({
        days: history,
        total: history.length,
        botId,
        filter: modeParam || "all",
      });
    } catch (error) {
      logger.error("Bot API: Failed to get daily stats", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/:botId/events
   * Get event log for a specific bot
   */
  router.get("/:botId/events", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const limit = Number(req.query.limit) || 100;
      const eventType = req.query.type as string | undefined;

      const repository = getBotRepository(String(botId));
      const events = eventType
        ? await repository.getEventsByType(eventType, limit)
        : await repository.getRecentEvents(limit);

      res.json({
        events,
        total: events.length,
        botId,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get events", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/:botId/scan
   * Run a single scan cycle for a specific bot
   */
  router.post("/:botId/scan", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const startTime = Date.now();
      await manager.initialize();
      await manager.runScan(botId);
      const duration = Date.now() - startTime;

      const bot = manager.getBot(botId);
      const status = bot ? await bot.getStatus() : null;

      res.json({
        success: true,
        message: "Scan cycle completed",
        durationMs: duration,
        botId,
        status,
      });
    } catch (error) {
      logger.error("Bot API: Scan failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/:botId/check-resolutions
   * Check resolutions for a specific bot
   */
  router.post("/:botId/check-resolutions", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const result = await manager.runResolutionCheck(botId);

      res.json({
        success: true,
        message: "Resolution check completed",
        botId,
        ...result,
      });
    } catch (error) {
      logger.error("Bot API: Resolution check failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/:botId/mode
   * Switch mode for a specific bot
   */
  router.post("/:botId/mode", async (req, res) => {
    try {
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) {
        res.status(400).json({ error: "Invalid bot ID" });
        return;
      }

      const { mode } = req.body as { mode?: string };
      if (mode !== "simulation" && mode !== "live") {
        res.status(400).json({ error: "Mode must be 'simulation' or 'live'" });
        return;
      }

      await manager.initialize();
      const bot = manager.getBot(botId);
      if (!bot) {
        res.status(404).json({ error: `Bot ${botId} not found` });
        return;
      }

      await bot.setMode(mode);
      const status = await bot.getStatus();

      res.json({
        success: true,
        message: `Mode switched to ${mode}`,
        botId,
        status,
      });
    } catch (error) {
      logger.error("Bot API: Failed to switch mode", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ==========================================
  // LEGACY ENDPOINTS (for backward compatibility)
  // Route to default bot (ID 1)
  // ==========================================

  /**
   * GET /bot/status
   * Get status for default bot (backward compatibility)
   */
  router.get("/status", async (_req, res) => {
    try {
      await manager.initialize();
      const bot = manager.getBot(1);
      if (!bot) {
        res.status(404).json({ error: "Default bot not configured" });
        return;
      }

      const status = await bot.getStatus();
      const config = bot.getConfig();

      res.json({
        ...status,
        config: {
          betSize: config.betSize,
          dailyBudget: config.dailyBudget,
          minOdds: config.minOdds,
          maxOdds: config.maxOdds,
        },
      });
    } catch (error) {
      logger.error("Bot API: Failed to get status", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/wallet
   * Get wallet status for default bot (backward compatibility)
   */
  router.get("/wallet", async (_req, res) => {
    try {
      await manager.initialize();
      const bot = manager.getBot(1);
      if (!bot) {
        res.status(404).json({ error: "Default bot not configured" });
        return;
      }

      const tradingClient = bot.getTradingClient();
      if (!tradingClient.isInitialized()) {
        res.json({
          initialized: false,
          message: "Trading client not initialized. Set POLYMARKET_PRIVATE_KEY to enable.",
        });
        return;
      }

      const walletStatus = await tradingClient.checkReadiness();
      res.json({
        initialized: true,
        ...walletStatus,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get wallet status", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/opportunities
   * Get opportunities for default bot (backward compatibility)
   */
  router.get("/opportunities", async (_req, res) => {
    try {
      await manager.initialize();
      const bot = manager.getBot(1);
      if (!bot) {
        res.status(404).json({ error: "Default bot not configured" });
        return;
      }

      const opportunities = await bot.getCurrentOpportunities();
      const bettable = opportunities.filter((o) => o.canBet);
      const skipped = opportunities.filter((o) => !o.canBet);

      res.json({
        bettable,
        skipped,
        total: opportunities.length,
        bettableCount: bettable.length,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get opportunities", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/positions
   * Get positions for default bot (backward compatibility)
   */
  router.get("/positions", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const repository = getBotRepository("1");
      const positions = await repository.getPositionHistory(limit);

      res.json({
        positions,
        total: positions.length,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get positions", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/positions/open
   * Get open positions for default bot (backward compatibility)
   */
  router.get("/positions/open", async (req, res) => {
    try {
      const simulatedParam = req.query.simulated as string | undefined;
      let isSimulated: boolean | undefined;

      if (simulatedParam === "true") {
        isSimulated = true;
      } else if (simulatedParam === "false") {
        isSimulated = false;
      }

      const repository = getBotRepository("1");
      const positions = await repository.getOpenPositions(isSimulated);

      res.json({
        positions,
        total: positions.length,
        filter: isSimulated !== undefined ? { simulated: isSimulated } : "all",
      });
    } catch (error) {
      logger.error("Bot API: Failed to get open positions", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/stats
   * Get stats for default bot (backward compatibility)
   */
  router.get("/stats", async (req, res) => {
    try {
      const isSimulated = req.query.mode !== "live";
      const repository = getBotRepository("1");
      const overall = await repository.getOverallStats(isSimulated);
      const today = await repository.getTodayStats(isSimulated);

      res.json({
        overall,
        today,
        mode: isSimulated ? "simulation" : "live",
      });
    } catch (error) {
      logger.error("Bot API: Failed to get stats", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/stats/daily
   * Get daily stats for default bot (backward compatibility)
   */
  router.get("/stats/daily", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 30;
      const modeParam = req.query.mode as string | undefined;
      let isSimulated: boolean | undefined;

      if (modeParam === "simulation") {
        isSimulated = true;
      } else if (modeParam === "live") {
        isSimulated = false;
      }

      const repository = getBotRepository("1");
      const history = await repository.getDailyStatsHistory(limit, isSimulated);

      res.json({
        days: history,
        total: history.length,
        filter: modeParam || "all",
      });
    } catch (error) {
      logger.error("Bot API: Failed to get daily stats", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /bot/events
   * Get events for default bot (backward compatibility)
   */
  router.get("/events", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const eventType = req.query.type as string | undefined;

      const repository = getBotRepository("1");
      const events = eventType
        ? await repository.getEventsByType(eventType, limit)
        : await repository.getRecentEvents(limit);

      res.json({
        events,
        total: events.length,
      });
    } catch (error) {
      logger.error("Bot API: Failed to get events", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/mode
   * Switch mode for default bot (backward compatibility)
   */
  router.post("/mode", async (req, res) => {
    try {
      const { mode } = req.body as { mode?: string };

      if (mode !== "simulation" && mode !== "live") {
        res.status(400).json({ error: "Mode must be 'simulation' or 'live'" });
        return;
      }

      await manager.initialize();
      const bot = manager.getBot(1);
      if (!bot) {
        res.status(404).json({ error: "Default bot not configured" });
        return;
      }

      await bot.setMode(mode);
      const status = await bot.getStatus();

      res.json({
        success: true,
        message: `Mode switched to ${mode}`,
        status,
      });
    } catch (error) {
      logger.error("Bot API: Failed to switch mode", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/scan
   * Run scan for default bot (backward compatibility)
   */
  router.post("/scan", async (_req, res) => {
    try {
      const startTime = Date.now();
      await manager.initialize();
      await manager.runScan(1);
      const duration = Date.now() - startTime;

      const bot = manager.getBot(1);
      const status = bot ? await bot.getStatus() : null;

      res.json({
        success: true,
        message: "Scan cycle completed",
        durationMs: duration,
        status,
      });
    } catch (error) {
      logger.error("Bot API: Scan failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /bot/check-resolutions
   * Check resolutions for default bot (backward compatibility)
   */
  router.post("/check-resolutions", async (_req, res) => {
    try {
      const result = await manager.runResolutionCheck(1);

      res.json({
        success: true,
        message: "Resolution check completed",
        ...result,
      });
    } catch (error) {
      logger.error("Bot API: Resolution check failed", { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
