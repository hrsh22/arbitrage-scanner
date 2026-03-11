import "dotenv/config";
import cookieSession from "cookie-session";
import express from "express";
import type { Server } from "node:http";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { runStartupValidationOrExit } from "./startupValidation.js";
import { buildAuthRouter } from "./routes/authRoutes.js";
import { buildVaultRouter } from "./routes/vaultRoutes.js";
import { buildCustomVaultRouter } from "./routes/customVaultRoutes.js";
import { initializeVaultProviders } from "./services/vaultProviderFactory.js";

// Run startup validation early - this will exit if validation fails
await runStartupValidationOrExit();

if (env.VAULT_SESSION_SECRET === "vault-dev-secret-change-me") {
  logger.warn("VAULT_SESSION_SECRET is using default dev value — set a real secret in production");
}

const VAULT_WEB_ORIGIN = process.env.VAULT_WEB_ORIGIN || "http://localhost:3000";

const app = express();
const PORT = env.PORT;
const SHUTDOWN_TIMEOUT_MS = 10_000;

initializeVaultProviders();

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", VAULT_WEB_ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

app.use(
  cookieSession({
    name: "vault_sess",
    secret: env.VAULT_SESSION_SECRET,
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: false,
    sameSite: "lax",
  }),
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "vault", uptime: process.uptime() });
});

app.use("/auth", buildAuthRouter());
app.use("/vault", buildVaultRouter());
app.use("/api/vaults", buildCustomVaultRouter());

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  logger.info(`Vault service listening on port ${PORT}`);
  logger.info("Capital crons (NAV + reconciliation) run in worker process (pnpm worker)");
  logger.info(
    "Trading crons (trading + resolution + hedging) run in worker process (pnpm worker:trading)",
  );
});

function shutdown(signal: string, httpServer: Server): void {
  logger.info(`Vault API: Received ${signal}, shutting down gracefully`);

  const forceExitTimer = setTimeout(() => {
    logger.error("Vault API: Forced shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  httpServer.close((error?: Error) => {
    clearTimeout(forceExitTimer);
    if (error) {
      logger.error("Vault API: Error during server close", { error: error.message });
      process.exit(1);
      return;
    }

    logger.info("Vault API: HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT", server));
process.on("SIGTERM", () => shutdown("SIGTERM", server));

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error("Vault API: Port already in use", {
      port: PORT,
      message: `Port ${PORT} is already in use. Stop existing process or change VAULT_PORT.`,
    });
    process.exit(1);
  }
});
