import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { vaultRoutes } from "./routes/vault.js";
import { userRoutes } from "./routes/users.js";
import { adminRoutes } from "./routes/admin.js";
import { webhookRoutes } from "./routes/webhooks.js";
import withdrawalRoutes from "./routes/withdrawals.js";
import { catchUpAllVaults } from "./services/depositListener.js";
import { catchUpAllVaultsWithdrawals } from "./services/withdrawalListener.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    ip: req.ip,
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use("/vaults", vaultRoutes);
app.use("/users", userRoutes);
app.use("/admin", adminRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/withdrawals", withdrawalRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

const PORT = env.PORT;
const HOST = env.HOST;

app.listen(PORT, HOST, () => {
  logger.info(`Vault backend started`, {
    host: HOST,
    port: PORT,
  });

  catchUpAllVaults()
    .then(() => logger.info("Startup deposit catch-up complete"))
    .catch((error) =>
      logger.error("Startup deposit catch-up failed", {
        error: (error as Error).message,
      }),
    );

  catchUpAllVaultsWithdrawals()
    .then(() => logger.info("Startup withdrawal catch-up complete"))
    .catch((error) =>
      logger.error("Startup withdrawal catch-up failed", {
        error: (error as Error).message,
      }),
    );
});
