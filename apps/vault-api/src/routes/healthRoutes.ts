/**
 * Health Check Routes
 *
 * API endpoints for monitoring and alerting:
 * - GET /health - Basic health check
 * - GET /health/detailed - Full health status with all checks
 * - GET /health/:vaultId - Per-vault health check
 * - POST /health/alert/test - Test alert channels
 */

import { Router } from "express";
import { logger } from "../logger.js";
import { getVaultHealthMonitor } from "../services/vaultHealthMonitor.js";
import { getAllVaultConfigs } from "../config/index.js";

export function buildHealthRouter(): Router {
  const router = Router();
  const monitor = getVaultHealthMonitor();

  // Basic health check
  router.get("/", async (_req, res) => {
    try {
      const status = await monitor.runFullHealthCheck();

      const httpStatus =
        status.overall === "healthy" ? 200 : status.overall === "degraded" ? 200 : 503;

      res.status(httpStatus).json({
        status: status.overall,
        timestamp: status.timestamp,
        checks: status.summary,
      });
    } catch (error) {
      logger.error("Health check failed", { error: (error as Error).message });
      res.status(503).json({
        status: "critical",
        error: (error as Error).message,
        timestamp: new Date(),
      });
    }
  });

  // Detailed health check with all results
  router.get("/detailed", async (_req, res) => {
    try {
      const status = await monitor.runFullHealthCheck();

      const httpStatus =
        status.overall === "healthy" ? 200 : status.overall === "degraded" ? 200 : 503;

      res.status(httpStatus).json(status);
    } catch (error) {
      logger.error("Detailed health check failed", {
        error: (error as Error).message,
      });
      res.status(503).json({
        status: "critical",
        error: (error as Error).message,
        timestamp: new Date(),
      });
    }
  });

  // Per-vault health check
  router.get("/:vaultId", async (req, res) => {
    try {
      const vaultId = parseInt(req.params.vaultId, 10);

      if (isNaN(vaultId)) {
        res.status(400).json({ error: "Invalid vault ID" });
        return;
      }

      const status = await monitor.runFullHealthCheck(vaultId);

      const httpStatus =
        status.overall === "healthy" ? 200 : status.overall === "degraded" ? 200 : 503;

      res.status(httpStatus).json({
        vaultId,
        ...status,
      });
    } catch (error) {
      logger.error("Vault health check failed", {
        vaultId: req.params.vaultId,
        error: (error as Error).message,
      });
      res.status(503).json({
        vaultId: req.params.vaultId,
        status: "critical",
        error: (error as Error).message,
        timestamp: new Date(),
      });
    }
  });

  // Individual check endpoints
  router.get("/check/epoch-lag", async (_req, res) => {
    try {
      const result = await monitor.checkEpochSettlementLag();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        name: "epoch_settlement_lag",
        status: "critical",
        error: (error as Error).message,
      });
    }
  });

  router.get("/check/nav-staleness", async (_req, res) => {
    try {
      const result = await monitor.checkNavStaleness();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        name: "nav_staleness",
        status: "critical",
        error: (error as Error).message,
      });
    }
  });

  router.get("/check/claim-backlog", async (_req, res) => {
    try {
      const result = await monitor.checkClaimBacklog();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        name: "claim_backlog",
        status: "critical",
        error: (error as Error).message,
      });
    }
  });

  router.get("/check/failed-settlements", async (_req, res) => {
    try {
      const result = await monitor.checkFailedSettlements();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        name: "failed_settlements",
        status: "critical",
        error: (error as Error).message,
      });
    }
  });

  router.get("/check/worker-heartbeat", async (_req, res) => {
    try {
      const result = await monitor.checkWorkerHeartbeat();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        name: "worker_heartbeat",
        status: "critical",
        error: (error as Error).message,
      });
    }
  });

  // Test alert endpoint
  router.post("/alert/test", async (req, res) => {
    try {
      const { channel } = req.body as { channel?: "pagerduty" | "slack" };

      const testResult = {
        name: "alert_test",
        status: "degraded" as const,
        severity: "warning" as const,
        message: "This is a test alert from the vault health monitor",
        timestamp: new Date(),
        runbookUrl: "https://github.com/polymarket-mvp/runbooks/blob/main/alert-testing.md",
      };

      let payload;
      if (channel === "pagerduty") {
        payload = monitor.formatPagerDutyPayload(testResult);
      } else if (channel === "slack") {
        payload = monitor.formatSlackPayload(testResult);
      }

      res.json({
        success: true,
        channel: channel ?? "none",
        payload,
        message: `Test alert formatted for ${channel ?? "console"}`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // Prometheus-compatible metrics endpoint
  router.get("/metrics", async (_req, res) => {
    try {
      const status = await monitor.runFullHealthCheck();
      const configs = getAllVaultConfigs();

      let metrics = "# Vault Health Metrics\n";
      metrics += "# TYPE vault_health_status gauge\n";
      metrics += `vault_health_status{overall="${status.overall}"} ${status.overall === "healthy" ? 1 : status.overall === "degraded" ? 0.5 : 0}\n`;

      for (const check of status.checks) {
        const value = check.status === "healthy" ? 1 : check.status === "degraded" ? 0.5 : 0;
        metrics += `vault_health_check{name="${check.name}"} ${value}\n`;
      }

      metrics += "# TYPE vault_count gauge\n";
      metrics += `vault_count ${configs.length}\n`;

      res.set("Content-Type", "text/plain");
      res.send(metrics);
    } catch (error) {
      res.status(500).send(`# Error: ${(error as Error).message}`);
    }
  });

  return router;
}
