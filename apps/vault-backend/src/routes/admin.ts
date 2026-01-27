import { Router, type Request, type Response, type IRouter } from "express";
import crypto from "crypto";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { verifyMessage } from "viem";
import { db } from "../db/client";
import { vaults, withdrawalRequests, type Vault, type NewVault } from "../db/schema";
import { vaultService } from "../services/vaultService";
import { getVaultContract } from "../services/vaultContractService";
import { logger } from "../logger";
import type { ApiResponse } from "../types";
import { getTradingService } from "../trading/tradingService";
import { createSafeWalletService } from "../trading/safeWallet.js";
import { env, hasTradingWallet, getChainIdForNetwork, isTestnet } from "../env";

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

const adminNonceSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const adminVerifySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().min(1),
});

const ADMIN_MESSAGE_PREFIX = "Polymarket Vault Admin Login";
const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const adminAllowlist = new Set(
  env.ADMIN_WALLET_ALLOWLIST.split(",")
    .map((address) => address.trim().toLowerCase())
    .filter((address) => address.length > 0),
);

const pendingNonces = new Map<string, { nonce: string; expiresAt: number }>();
const activeSessions = new Map<string, { address: string; expiresAt: number }>();

const normalizeAddress = (address: string): string => address.toLowerCase();

const buildAdminMessage = (address: string, nonce: string): string =>
  `${ADMIN_MESSAGE_PREFIX}\nAddress: ${address}\nNonce: ${nonce}`;

const adminAuth = (req: Request, res: Response, next: () => void) => {
  if (adminAllowlist.size === 0) {
    res.status(503).json({ success: false, error: "Admin allowlist not configured" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Authorization token required" });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const session = activeSessions.get(token);

  if (!session) {
    res.status(401).json({ success: false, error: "Invalid or expired session" });
    return;
  }

  if (session.expiresAt < Date.now()) {
    activeSessions.delete(token);
    res.status(401).json({ success: false, error: "Session expired" });
    return;
  }

  if (!adminAllowlist.has(session.address)) {
    res.status(403).json({ success: false, error: "Admin address not allowed" });
    return;
  }

  const headerAddress = req.headers["x-admin-address"] as string | undefined;
  if (headerAddress && normalizeAddress(headerAddress) !== session.address) {
    res.status(403).json({ success: false, error: "Admin address mismatch" });
    return;
  }

  (req as Request & { adminAddress: string }).adminAddress = session.address;
  next();
};

adminRoutes.post("/auth/nonce", async (req: Request, res: Response) => {
  const parsed = adminNonceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }

  if (adminAllowlist.size === 0) {
    res.status(503).json({ success: false, error: "Admin allowlist not configured" });
    return;
  }

  const address = normalizeAddress(parsed.data.address);
  if (!adminAllowlist.has(address)) {
    res.status(403).json({ success: false, error: "Admin address not allowed" });
    return;
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + NONCE_TTL_MS;
  pendingNonces.set(address, { nonce, expiresAt });

  const response: ApiResponse<{ nonce: string; message: string; expiresAt: number }> = {
    success: true,
    data: {
      nonce,
      message: buildAdminMessage(address, nonce),
      expiresAt,
    },
  };
  res.json(response);
});

adminRoutes.post("/auth/verify", async (req: Request, res: Response) => {
  const parsed = adminVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }

  if (adminAllowlist.size === 0) {
    res.status(503).json({ success: false, error: "Admin allowlist not configured" });
    return;
  }

  const address = normalizeAddress(parsed.data.address);
  if (!adminAllowlist.has(address)) {
    res.status(403).json({ success: false, error: "Admin address not allowed" });
    return;
  }

  const nonceEntry = pendingNonces.get(address);
  if (!nonceEntry || nonceEntry.expiresAt < Date.now()) {
    res.status(400).json({ success: false, error: "Nonce expired or not found" });
    return;
  }

  const message = buildAdminMessage(address, nonceEntry.nonce);
  const isValid = await verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: parsed.data.signature as `0x${string}`,
  });

  if (!isValid) {
    res.status(401).json({ success: false, error: "Invalid signature" });
    return;
  }

  pendingNonces.delete(address);

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  activeSessions.set(token, { address, expiresAt });

  const response: ApiResponse<{ token: string; expiresAt: number }> = {
    success: true,
    data: { token, expiresAt },
  };
  res.json(response);
});

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
      chainId: getChainIdForNetwork(),
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

    if (!hasTradingWallet()) {
      res.status(503).json({ success: false, error: "Trading wallet not configured" });
      return;
    }

    if (!vault.contractAddress) {
      res.status(400).json({ success: false, error: "Vault contract address missing" });
      return;
    }

    const totalAssetsValue = parseFloat(parsed.data.totalAssetsUsdc);
    const totalAssetsOnChain = BigInt(Math.floor(totalAssetsValue * 1e6));
    const vaultContract = getVaultContract(vault.contractAddress);
    const { hash } = await vaultContract.updateNav(totalAssetsOnChain);

    const updated = await vaultService.updateNav(vaultId, parsed.data.totalAssetsUsdc);

    logger.info("Admin updated NAV", {
      vaultId,
      totalAssetsUsdc: parsed.data.totalAssetsUsdc,
      newNavPerShare: updated.navPerShare,
      txHash: hash,
    });

    res.json({ success: true, data: { navPerShare: updated.navPerShare, txHash: hash } });
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

adminRoutes.get("/vaults/:id/setup-status", adminAuth, async (req: Request, res: Response) => {
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

    if (!hasTradingWallet()) {
      res.status(503).json({ success: false, error: "Trading wallet not configured" });
      return;
    }

    const safeWallet = createSafeWalletService(vault.safeAddress);
    const setupStatus = await safeWallet.getSetupStatus(vault.contractAddress);

    res.json({ success: true, data: setupStatus });
  } catch (error) {
    logger.error("Failed to get setup status", { error: (error as Error).message });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.post("/vaults/:id/approve-vault", adminAuth, async (req: Request, res: Response) => {
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

    if (!hasTradingWallet()) {
      res.status(503).json({ success: false, error: "Trading wallet not configured" });
      return;
    }

    const safeWallet = createSafeWalletService(vault.safeAddress);
    const txHash = await safeWallet.approveUsdcForSpender(vault.contractAddress);

    logger.info("Approved USDC for vault contract via admin API", {
      vaultId,
      contractAddress: vault.contractAddress,
      txHash,
    });

    res.json({ success: true, data: { txHash } });
  } catch (error) {
    logger.error("Failed to approve vault", { error: (error as Error).message });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

adminRoutes.post(
  "/vaults/:id/approve-polymarket",
  adminAuth,
  async (req: Request, res: Response) => {
    try {
      if (isTestnet()) {
        res.status(400).json({
          success: false,
          error: "Polymarket approvals not available on testnet",
        });
        return;
      }

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

      if (!hasTradingWallet()) {
        res.status(503).json({ success: false, error: "Trading wallet not configured" });
        return;
      }

      const safeWallet = createSafeWalletService(vault.safeAddress);
      const txHash = await safeWallet.approveAllForPolymarket();

      logger.info("Approved all Polymarket contracts via admin API", {
        vaultId,
        safeAddress: vault.safeAddress,
        txHash,
      });

      res.json({ success: true, data: { txHash } });
    } catch (error) {
      logger.error("Failed to approve Polymarket", { error: (error as Error).message });
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
