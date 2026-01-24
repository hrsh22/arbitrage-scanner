import { Router, type Request, type Response, type IRouter } from "express";
import { vaultService } from "../services/vaultService";
import type { ApiResponse, VaultStatus, PositionRecord } from "../types";
import type { Vault } from "../db/schema";

export const vaultRoutes: IRouter = Router();

vaultRoutes.get("/", async (_req: Request, res: Response) => {
  try {
    const vaults = await vaultService.getPublicVaults();
    const response: ApiResponse<Vault[]> = { success: true, data: vaults };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: (error as Error).message,
    };
    res.status(500).json(response);
  }
});

vaultRoutes.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const vault = await vaultService.getVaultBySlug(slug!);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }
    const response: ApiResponse<Vault> = { success: true, data: vault };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: (error as Error).message,
    };
    res.status(500).json(response);
  }
});

vaultRoutes.get("/:slug/status", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const vault = await vaultService.getVaultBySlug(slug!);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }
    const status = await vaultService.getVaultStatus(vault.id);
    const response: ApiResponse<VaultStatus> = { success: true, data: status };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: (error as Error).message,
    };
    res.status(500).json(response);
  }
});

vaultRoutes.get("/:slug/positions", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const vault = await vaultService.getVaultBySlug(slug!);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }
    const positions = await vaultService.getAllPositions(vault.id);
    const response: ApiResponse<PositionRecord[]> = { success: true, data: positions };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: (error as Error).message,
    };
    res.status(500).json(response);
  }
});

vaultRoutes.get("/:slug/positions/open", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const vault = await vaultService.getVaultBySlug(slug!);
    if (!vault) {
      res.status(404).json({ success: false, error: "Vault not found" });
      return;
    }
    const positions = await vaultService.getOpenPositions(vault.id);
    const response: ApiResponse<PositionRecord[]> = { success: true, data: positions };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: (error as Error).message,
    };
    res.status(500).json(response);
  }
});
