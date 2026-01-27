import { Router, type Request, type Response, type Router as RouterType } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { vaults } from "../db/schema.js";
import {
  processDepositEvent,
  updateLastSyncedBlock as updateDepositLastSyncedBlock,
  type DepositEventData,
} from "../services/depositListener.js";
import {
  processWithdrawalRequestedEvent,
  processClaimedEvent,
  updateLastSyncedBlock as updateWithdrawalLastSyncedBlock,
  updateLastClaimSyncedBlock as updateClaimedLastSyncedBlock,
  type WithdrawalRequestedEventData,
  type ClaimedEventData,
} from "../services/withdrawalListener.js";
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

const WITHDRAWAL_REQUESTED_EVENT_SIGNATURE =
  "0x38e3d972947cfef94205163d483d6287ef27eb312e20cb8e0b13a49989db232e";
const CLAIMED_EVENT_SIGNATURE =
  "0x47cee97cb7acd717b3c0aa1435d004cd5b3c8c57d70dbceb4e4458bbd60e39d4";

function parseAlchemyBlockNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const parsed = Number.parseInt(trimmed, 16);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

function decodeWithdrawalRequestedLog(
  topics: string[],
  data: string,
  txHash: string,
  blockNumber: number,
  logIndex: number,
): WithdrawalRequestedEventData | null {
  if (topics[0]?.toLowerCase() !== WITHDRAWAL_REQUESTED_EVENT_SIGNATURE.toLowerCase()) {
    return null;
  }

  const userAddress = "0x" + topics[1]?.slice(26);
  const requestId = Number(BigInt(topics[2] ?? "0x0"));

  const cleanData = data.startsWith("0x") ? data.slice(2) : data;
  const shares = BigInt("0x" + cleanData.slice(0, 64));
  const ownershipBps = BigInt("0x" + cleanData.slice(64, 128));

  return {
    userAddress,
    onChainRequestId: requestId,
    shares,
    ownershipBps,
    txHash,
    blockNumber,
    logIndex,
  };
}

function decodeClaimedLog(
  topics: string[],
  data: string,
  txHash: string,
  blockNumber: number,
  logIndex: number,
): ClaimedEventData | null {
  if (topics[0]?.toLowerCase() !== CLAIMED_EVENT_SIGNATURE.toLowerCase()) {
    return null;
  }

  const userAddress = "0x" + topics[1]?.slice(26);
  const requestId = Number(BigInt(topics[2] ?? "0x0"));

  const cleanData = data.startsWith("0x") ? data.slice(2) : data;
  const amount = BigInt("0x" + cleanData.slice(0, 64));

  return {
    userAddress,
    onChainRequestId: requestId,
    amount,
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
  const blockNumber = parseAlchemyBlockNumber(payload.event?.data?.block?.number);

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

      // Advance cursor monotonically (best-effort)
      if (blockNumber > 0) {
        await updateDepositLastSyncedBlock(vault.id, blockNumber);
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

webhookRoutes.post("/alchemy/withdrawal-requested", async (req: Request, res: Response) => {
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
  const blockNumber = parseAlchemyBlockNumber(payload.event?.data?.block?.number);

  let processedCount = 0;
  let errorCount = 0;

  for (const log of logs) {
    const contractAddress = log.account.address.toLowerCase();

    const [vault] = await db
      .select()
      .from(vaults)
      .where(eq(vaults.contractAddress, contractAddress))
      .limit(1);

    if (!vault) continue;

    const event = decodeWithdrawalRequestedLog(
      log.topics,
      log.data,
      log.transaction.hash,
      blockNumber,
      log.index,
    );

    if (!event) continue;

    try {
      const result = await processWithdrawalRequestedEvent(vault.id, event);
      if (result.recorded) {
        processedCount++;
      }
      if (blockNumber > 0) {
        await updateWithdrawalLastSyncedBlock(vault.id, blockNumber);
      }
    } catch (error) {
      logger.error("Failed to process withdrawal from webhook", {
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
    withdrawalRequestsProcessed: processedCount,
    errors: errorCount,
  });

  res.status(200).json({ processed: processedCount, errors: errorCount });
});

webhookRoutes.post("/alchemy/claimed", async (req: Request, res: Response) => {
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
  const blockNumber = parseAlchemyBlockNumber(payload.event?.data?.block?.number);

  let processedCount = 0;
  let errorCount = 0;

  for (const log of logs) {
    const contractAddress = log.account.address.toLowerCase();

    const [vault] = await db
      .select()
      .from(vaults)
      .where(eq(vaults.contractAddress, contractAddress))
      .limit(1);

    if (!vault) continue;

    const event = decodeClaimedLog(
      log.topics,
      log.data,
      log.transaction.hash,
      blockNumber,
      log.index,
    );

    if (!event) continue;

    try {
      const result = await processClaimedEvent(vault.id, event);
      if (result.recorded) {
        processedCount++;
      }
      if (blockNumber > 0) {
        await updateClaimedLastSyncedBlock(vault.id, blockNumber);
      }
    } catch (error) {
      logger.error("Failed to process claim from webhook", {
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
    claimedProcessed: processedCount,
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
