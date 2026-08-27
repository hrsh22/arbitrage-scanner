import { Router } from "express";
import { SiweMessage, generateNonce } from "siwe";
import { logger } from "../logger.js";

export function buildAuthRouter(): Router {
  const router = Router();

  // GET /auth/siwe/nonce — generate and store nonce in session
  router.get("/siwe/nonce", (req, res) => {
    const nonce = generateNonce();
    req.session!.nonce = nonce;
    res.json({ nonce });
  });


  // GET /auth/siwe/me — check if session is authenticated
  router.get("/siwe/me", (req, res) => {
    if (req.session?.address) {
      res.json({ authenticated: true, address: req.session.address });
    } else {
      res.json({ authenticated: false });
    }
  });

  // POST /auth/siwe/verify — verify SIWE message and set session
  router.post("/siwe/verify", async (req, res) => {
    try {
      const { message, signature } = req.body as {
        message?: string;
        signature?: string;
      };

      if (!message || !signature) {
        res.status(400).json({ error: "message and signature are required" });
        return;
      }

      const siweMessage = new SiweMessage(message);

      if (siweMessage.nonce !== req.session?.nonce) {
        res.status(422).json({ error: "Invalid nonce" });
        return;
      }

      const result = await siweMessage.verify({ signature });

      if (!result.success) {
        res.status(401).json({ error: "Signature verification failed" });
        return;
      }

      req.session!.nonce = null;
      req.session!.address = result.data.address;

      logger.info("SIWE: address authenticated", { address: result.data.address });

      res.json({ ok: true, address: result.data.address });
    } catch (error) {
      logger.error("SIWE: verification error", { error: (error as Error).message });
      res.status(400).json({ error: (error as Error).message });
    }
  });

  return router;
}
