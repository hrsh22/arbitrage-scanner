import { Router } from "express";
import {
  getPositionAnalytics,
  getPositionAnalyticsById,
  type AnalyticsOptions,
} from "../services/positionAnalytics.js";
import { logger } from "../logger.js";

export function buildPositionAnalyticsRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const query = req.query as {
        fidelity?: string;
        stopLossThresholds?: string;
        timeWindows?: string;
        limit?: string;
        status?: string;
      };

      const options: AnalyticsOptions = {};

      if (query.fidelity) {
        const fidelity = parseInt(query.fidelity, 10);
        if (fidelity === 1 || fidelity === 5 || fidelity === 15) {
          options.fidelityMinutes = fidelity;
        }
      }

      if (query.stopLossThresholds) {
        options.stopLossThresholds = query.stopLossThresholds
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0 && n <= 100);
      }

      if (query.timeWindows) {
        options.timeWindows = query.timeWindows
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0);
      }

      if (query.limit) {
        const limit = parseInt(query.limit, 10);
        if (!isNaN(limit) && limit > 0) {
          options.limit = limit;
        }
      }

      if (query.status) {
        const status = query.status as AnalyticsOptions["status"];
        if (["open", "won", "lost", "expired", "all"].includes(status!)) {
          options.status = status;
        }
      }

      logger.info("Position analytics request", { options });

      const result = await getPositionAnalytics(options);

      res.json({
        success: true,
        ...result,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Position analytics failed", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  router.get("/:positionId", async (req, res) => {
    try {
      const positionId = parseInt(req.params.positionId, 10);
      if (isNaN(positionId)) {
        res.status(400).json({ success: false, error: "Invalid position ID" });
        return;
      }

      const query = req.query as {
        fidelity?: string;
        stopLossThresholds?: string;
        timeWindows?: string;
      };

      const options: AnalyticsOptions = {};

      if (query.fidelity) {
        const fidelity = parseInt(query.fidelity, 10);
        if (fidelity === 1 || fidelity === 5 || fidelity === 15) {
          options.fidelityMinutes = fidelity;
        }
      }

      if (query.stopLossThresholds) {
        options.stopLossThresholds = query.stopLossThresholds
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0 && n <= 100);
      }

      if (query.timeWindows) {
        options.timeWindows = query.timeWindows
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0);
      }

      const result = await getPositionAnalyticsById(positionId, options);

      if (!result) {
        res.status(404).json({ success: false, error: "Position not found or is simulated" });
        return;
      }

      res.json({
        success: true,
        analytics: result,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Single position analytics failed", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  return router;
}
