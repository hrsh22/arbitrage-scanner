import { Router, type Request, type Response, type IRouter } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { vaults, withdrawalRequests, type Vault, type NewVault } from "../db/schema";
import { vaultService } from "../services/vaultService";
import { logger } from "../logger";
import type { ApiResponse } from "../types";
import { getTradingService } from "../trading/tradingService";
import { hasTradingWallet } from "../env";

export const adminRoutes: IRouter = Router();

const createVaultSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  safeAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const updateVaultSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "public", "paused"]).optional(),
});

const updateNavSchema = z.object({
  totalAssetsUsdc: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "totalAssetsUsdc must be a valid non-negative number string",
  }),
});

const placeOrderSchema = z.object({
  tokenId: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  price: z.number().min(0.001).max(0.999),
  size: z.number().min(0.01),
  feeRateBps: z.number().int().min(0).max(1000).optional(),
});

const adminAuth = (req: Request, res: Response, next: () => void) => {
  const adminAddress = req.headers["x-admin-address"] as string | undefined;

  if (!adminAddress) {
    res.status(401).json({ success: false, error: "Admin address header required" });
    return;
  }

  (req as Request & { adminAddress: string }).adminAddress = adminAddress.toLowerCase();
  next();
};

adminRoutes.get("/vaults", adminAuth, async (req: Request, res: Response) => {
  try {
    const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
    const adminVaults = await vaultService.getVaultsByAdmin(adminAddress);

    const response: ApiResponse<Vault[]> = { success: true, data: adminVaults };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.post("/vaults", adminAuth, async (req: Request, res: Response) => {
  try {
    const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
    const parsed = createVaultSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }

    const existingSlug = await vaultService.getVaultBySlug(parsed.data.slug);
    if (existingSlug) {
      res.status(400).json({ success: false, error: "Vault slug already exists" });
      return;
    }

    const newVault: NewVault = {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      contractAddress: parsed.data.contractAddress.toLowerCase(),
      safeAddress: parsed.data.safeAddress.toLowerCase(),
      adminAddress,
      status: "draft",
    };

    const [created] = await db.insert(vaults).values(newVault).returning();

    await vaultService.getOrCreateVaultState(created!.id);

    logger.info("Vault created", {
      vaultId: created!.id,
      name: created!.name,
      admin: adminAddress,
    });

    const response: ApiResponse<Vault> = { success: true, data: created! };
    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.get("/vaults/:id", adminAuth, async (req: Request, res: Response) => {
  try {
    const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
    const vaultId = parseInt(req.params.id!, 10);

    if (isNaN(vaultId)) {
      res.status(400).json({ success: false, error: "Invalid vault ID" });
      return;
    }

    const vault = await vaultService.getVaultById(vaultId);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }

    if (vault.adminAddress !== adminAddress) {
      res.status(403).json({ success: false, error: "Not authorized to manage this vault" });
      return;
    }

    const state = await vaultService.getOrCreateVaultState(vaultId);

    res.json({ success: true, data: { vault, state } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.patch("/vaults/:id", adminAuth, async (req: Request, res: Response) => {
  try {
    const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
    const vaultId = parseInt(req.params.id!, 10);

    if (isNaN(vaultId)) {
      res.status(400).json({ success: false, error: "Invalid vault ID" });
      return;
    }

    const vault = await vaultService.getVaultById(vaultId);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }

    if (vault.adminAddress !== adminAddress) {
      res.status(403).json({ success: false, error: "Not authorized to manage this vault" });
      return;
    }

    const parsed = updateVaultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .update(vaults)
      .set({
        ...parsed.data,
        updatedAt: new Date(),
      })
      .where(eq(vaults.id, vaultId))
      .returning();

    logger.info("Vault updated", { vaultId, changes: parsed.data });

    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.post("/vaults/:id/nav", adminAuth, async (req: Request, res: Response) => {
  try {
    const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
    const vaultId = parseInt(req.params.id!, 10);

    if (isNaN(vaultId)) {
      res.status(400).json({ success: false, error: "Invalid vault ID" });
      return;
    }

    const vault = await vaultService.getVaultById(vaultId);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }

    if (vault.adminAddress !== adminAddress) {
      res.status(403).json({ success: false, error: "Not authorized to manage this vault" });
      return;
    }

    const parsed = updateNavSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }

    const updated = await vaultService.updateNav(vaultId, parsed.data.totalAssetsUsdc);

    logger.info("Admin updated NAV", {
      vaultId,
      totalAssetsUsdc: parsed.data.totalAssetsUsdc,
      newNavPerShare: updated.navPerShare,
    });

    res.json({ success: true, data: { navPerShare: updated.navPerShare } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.get("/vaults/:id/withdrawals", adminAuth, async (req: Request, res: Response) => {
  try {
    const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
    const vaultId = parseInt(req.params.id!, 10);

    if (isNaN(vaultId)) {
      res.status(400).json({ success: false, error: "Invalid vault ID" });
      return;
    }

    const vault = await vaultService.getVaultById(vaultId);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }

    if (vault.adminAddress !== adminAddress) {
      res.status(403).json({ success: false, error: "Not authorized to manage this vault" });
      return;
    }

    const pending = await db
      .select()
      .from(withdrawalRequests)
      .where(
        and(eq(withdrawalRequests.vaultId, vaultId), eq(withdrawalRequests.status, "pending")),
      );

    res.json({ success: true, data: pending });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.post(
  "/vaults/:id/withdrawals/:withdrawalId/fulfill",
  adminAuth,
  async (req: Request, res: Response) => {
    try {
      const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
      const vaultId = parseInt(req.params.id!, 10);
      const withdrawalId = parseInt(req.params.withdrawalId!, 10);

      if (isNaN(vaultId) || isNaN(withdrawalId)) {
        res.status(400).json({ success: false, error: "Invalid vault ID or withdrawal ID" });
        return;
      }

      const vault = await vaultService.getVaultById(vaultId);
      if (!vault) {
        res.status(404).json({ success: false, error: "Vault not found" });
        return;
      }

      if (vault.adminAddress !== adminAddress) {
        res.status(403).json({ success: false, error: "Not authorized to manage this vault" });
        return;
      }

      const [withdrawal] = await db
        .select()
        .from(withdrawalRequests)
        .where(
          and(eq(withdrawalRequests.id, withdrawalId), eq(withdrawalRequests.vaultId, vaultId)),
        );

      if (!withdrawal) {
        res.status(404).json({ success: false, error: "Withdrawal request not found" });
        return;
      }

      if (withdrawal.status !== "pending") {
        res.status(400).json({ success: false, error: "Withdrawal is not pending" });
        return;
      }

      const [updated] = await db
        .update(withdrawalRequests)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(withdrawalRequests.id, withdrawalId))
        .returning();

      logger.info("Withdrawal fulfilled", { vaultId, withdrawalId });

      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

async function getVaultWithAuth(req: Request, res: Response): Promise<Vault | null> {
  const adminAddress = (req as Request & { adminAddress: string }).adminAddress;
  const vaultId = parseInt(req.params.id!, 10);

  if (isNaN(vaultId)) {
    res.status(400).json({ success: false, error: "Invalid vault ID" });
    return null;
  }

  const vault = await vaultService.getVaultById(vaultId);
  if (!vault) {
    res.status(404).json({ success: false, error: "Vault not found" });
    return null;
  }

  if (vault.adminAddress !== adminAddress) {
    res.status(403).json({ success: false, error: "Not authorized to manage this vault" });
    return null;
  }

  if (!hasTradingWallet()) {
    res.status(503).json({ success: false, error: "Trading wallet not configured" });
    return null;
  }

  return vault;
}

adminRoutes.get("/vaults/:id/orders", adminAuth, async (req: Request, res: Response) => {
  try {
    const vault = await getVaultWithAuth(req, res);
    if (!vault) return;

    const tradingService = getTradingService(vault.safeAddress);
    const orders = await tradingService.getOpenOrders();

    res.json({ success: true, data: orders });
  } catch (error) {
    logger.error("Failed to get orders", { error: (error as Error).message });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.post("/vaults/:id/orders", adminAuth, async (req: Request, res: Response) => {
  try {
    const vault = await getVaultWithAuth(req, res);
    if (!vault) return;

    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }

    const tradingService = getTradingService(vault.safeAddress);
    const result = await tradingService.placeOrder({
      tokenId: parsed.data.tokenId,
      side: parsed.data.side,
      price: parsed.data.price,
      size: parsed.data.size,
      feeRateBps: parsed.data.feeRateBps,
    });

    logger.info("Order placed via admin API", {
      vaultId: vault.id,
      orderId: result.orderId,
      tokenId: parsed.data.tokenId,
      side: parsed.data.side,
      price: parsed.data.price,
      size: parsed.data.size,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to place order", { error: (error as Error).message });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.delete(
  "/vaults/:id/orders/:orderId",
  adminAuth,
  async (req: Request, res: Response) => {
    try {
      const vault = await getVaultWithAuth(req, res);
      if (!vault) return;

      const { orderId } = req.params;
      if (!orderId) {
        res.status(400).json({ success: false, error: "Order ID required" });
        return;
      }

      const tradingService = getTradingService(vault.safeAddress);
      const success = await tradingService.cancelOrder(orderId);

      if (success) {
        logger.info("Order cancelled via admin API", { vaultId: vault.id, orderId });
        res.json({ success: true, data: { cancelled: true, orderId } });
      } else {
        res.status(400).json({ success: false, error: "Failed to cancel order" });
      }
    } catch (error) {
      logger.error("Failed to cancel order", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

adminRoutes.delete("/vaults/:id/orders", adminAuth, async (req: Request, res: Response) => {
  try {
    const vault = await getVaultWithAuth(req, res);
    if (!vault) return;

    const tradingService = getTradingService(vault.safeAddress);
    const success = await tradingService.cancelAllOrders();

    if (success) {
      logger.info("All orders cancelled via admin API", { vaultId: vault.id });
      res.json({ success: true, data: { cancelledAll: true } });
    } else {
      res.status(400).json({ success: false, error: "Failed to cancel orders" });
    }
  } catch (error) {
    logger.error("Failed to cancel all orders", { error: (error as Error).message });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.get("/vaults/:id/market/:tokenId", adminAuth, async (req: Request, res: Response) => {
  try {
    const vault = await getVaultWithAuth(req, res);
    if (!vault) return;

    const { tokenId } = req.params;
    if (!tokenId) {
      res.status(400).json({ success: false, error: "Token ID required" });
      return;
    }

    const tradingService = getTradingService(vault.safeAddress);
    const price = await tradingService.getMarketPrice(tokenId);

    if (price) {
      res.json({ success: true, data: price });
    } else {
      res.status(404).json({ success: false, error: "Could not fetch market price" });
    }
  } catch (error) {
    logger.error("Failed to get market price", { error: (error as Error).message });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.get(
  "/vaults/:id/orderbook/:tokenId",
  adminAuth,
  async (req: Request, res: Response) => {
    try {
      const vault = await getVaultWithAuth(req, res);
      if (!vault) return;

      const { tokenId } = req.params;
      if (!tokenId) {
        res.status(400).json({ success: false, error: "Token ID required" });
        return;
      }

      const tradingService = getTradingService(vault.safeAddress);
      const orderbook = await tradingService.getOrderBook(tokenId);

      res.json({ success: true, data: orderbook });
    } catch (error) {
      logger.error("Failed to get order book", { error: (error as Error).message });
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);
