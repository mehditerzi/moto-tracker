import { Router } from "express";
import { config } from "../config.js";

/**
 * Unauthenticated config the sign-in screen needs before a user exists — namely
 * which social providers are wired, so we only render a button that actually
 * works. Returns booleans only; never the secrets themselves.
 */
export const publicConfigRouter: Router = Router();

publicConfigRouter.get("/", (_req, res) => {
  res.json({
    appleSignIn: !!(config.APPLE_CLIENT_ID && config.APPLE_CLIENT_SECRET),
    googleSignIn: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
  });
});
