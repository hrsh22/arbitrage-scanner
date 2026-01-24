import { Router, type Request, type Response, type Router as RouterType } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults } from "../db/schema.js";
import { processDepositEvent, type DepositEventData } from "../services/depositListener.js";
import { logger } from "../logger.js";
import { env, hasAlchemyWebhook } from "../env.js";

export const webhookRoutes: RouterType = Router();

interface AlchemyWebhookPayload {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event: {
    data: {
      block: {
        number: string;
        hash: string;
        timestamp: string;
        logs: Array<{
          account: { address: string };
          topics: string[];
          data: string;
          transaction: { hash: string };
          index: number;
        }>;
      };
    };
  };
}

const DEPOSIT_EVENT_SIGNATURE =
  "0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15";

function verifyAlchemySignature(body: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const expectedSignature = hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

function decodeDepositLog(
  topics: string[],
  data: string,
  txHash: string,
  blockNumber: number,
  logIndex: number,
): DepositEventData | null {
  if (topics[0]?.toLowerCase() !== DEPOSIT_EVENT_SIGNATURE.toLowerCase()) {
    return null;
  }

  const userAddress = "0x" + topics[1]?.slice(26);

  const cleanData = data.startsWith("0x") ? data.slice(2) : data;
  const assets = BigInt("0x" + cleanData.slice(0, 64));
  const shares = BigInt("0x" + cleanData.slice(64, 128));

  return {
    userAddress,
    assets,
    shares,
    txHash,
    blockNumber,
    logIndex,
  };
}

webhookRoutes.post("/alchemy/deposit", async (req: Request, res: Response) => {
  if (!hasAlchemyWebhook()) {
    logger.warn("Webhook received but ALCHEMY_WEBHOOK_SECRET not configured");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  const signature = req.headers["x-alchemy-signature"] as string;
  if (!signature) {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  if (!verifyAlchemySignature(rawBody, signature, env.ALCHEMY_WEBHOOK_SECRET)) {
    logger.warn("Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as AlchemyWebhookPayload;
  const logs = payload.event?.data?.block?.logs ?? [];
  const blockNumber = parseInt(payload.event?.data?.block?.number ?? "0", 16);

  let processedCount = 0;
  let errorCount = 0;

  for (const log of logs) {
    const contractAddress = log.account.address.toLowerCase();

    const [vault] = await db
      .select()
      .from(vaults)
      .where(eq(vaults.contractAddress, contractAddress))
      .limit(1);

    if (!vault) {
      continue;
    }

    const depositEvent = decodeDepositLog(
      log.topics,
      log.data,
      log.transaction.hash,
      blockNumber,
      log.index,
    );

    if (!depositEvent) {
      continue;
    }

    try {
      const result = await processDepositEvent(vault.id, depositEvent);
      if (result.recorded) {
        processedCount++;
      }
    } catch (error) {
      logger.error("Failed to process deposit from webhook", {
        vaultId: vault.id,
        txHash: log.transaction.hash,
        error: (error as Error).message,
      });
      errorCount++;
    }
  }

  logger.info("Webhook processed", {
    webhookId: payload.webhookId,
    blockNumber,
    logsReceived: logs.length,
    depositsProcessed: processedCount,
    errors: errorCount,
  });

  res.status(200).json({ processed: processedCount, errors: errorCount });
});

webhookRoutes.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    alchemyWebhookConfigured: hasAlchemyWebhook(),
  });
});
