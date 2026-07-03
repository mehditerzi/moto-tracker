import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getEntitlementSummary } from "../lib/entitlement.js";

export const entitlementRouter: Router = Router();

entitlementRouter.use(requireUser);

// What the client needs to decide whether "add vehicle" is enabled and what the
// paywall should offer. Cheap enough to fetch alongside the bikes list.
entitlementRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(getEntitlementSummary(req.user!.id));
  }),
);
