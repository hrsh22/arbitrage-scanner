import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.address) {
    logger.warn("Auth guard: unauthenticated request blocked", {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}
