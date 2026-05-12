import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { pushSubscriptionInputSchema } from "@mototracker/shared";
import { config } from "../config.js";
import { sendPush } from "../notify/webPushClient.js";

export const pushSubscriptionsRouter: Router = Router();
pushSubscriptionsRouter.use(requireUser);

pushSubscriptionsRouter.get(
  "/public-key",
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: config.VAPID_PUBLIC_KEY ?? null });
  }),
);

pushSubscriptionsRouter.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const body = pushSubscriptionInputSchema.parse(req.body);
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM push_subscription WHERE endpoint = ?")
      .get(body.endpoint) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE push_subscription
           SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, last_seen_at = datetime('now')
         WHERE id = ?`,
      ).run(req.user!.id, body.keys.p256dh, body.keys.auth, body.userAgent ?? null, existing.id);
      res.json({ id: existing.id, status: "updated" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(id, req.user!.id, body.endpoint, body.keys.p256dh, body.keys.auth, body.userAgent ?? null);
    res.status(201).json({ id, status: "created" });
  }),
);

pushSubscriptionsRouter.post(
  "/unsubscribe",
  asyncHandler(async (req, res) => {
    const endpoint = (req.body && (req.body as { endpoint?: string }).endpoint) ?? null;
    if (!endpoint) {
      res.status(400).json({ error: "endpoint_required" });
      return;
    }
    const db = getDb();
    db.prepare("DELETE FROM push_subscription WHERE endpoint = ? AND user_id = ?").run(
      endpoint,
      req.user!.id,
    );
    res.status(204).end();
  }),
);

pushSubscriptionsRouter.post(
  "/test",
  asyncHandler(async (req, res) => {
    if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
      res.status(400).json({ sent: 0, total: 0, error: "vapid_not_configured" });
      return;
    }
    const db = getDb();
    const subs = db
      .prepare("SELECT endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?")
      .all(req.user!.id) as { endpoint: string; p256dh: string; auth: string }[];
    if (subs.length === 0) {
      res.status(404).json({ error: "no_subscriptions" });
      return;
    }
    const results = await Promise.all(
      subs.map((s) =>
        sendPush({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
          payload: {
            title: "MotoTracker test",
            body: "Bildirimler çalışıyor.",
            url: "/dashboard",
            tag: "test",
          },
        }),
      ),
    );
    const sent = results.filter((r) => r.ok).length;
    const firstError = results.find((r) => !r.ok) as { ok: false; message: string } | undefined;
    res.json({
      sent,
      total: results.length,
      error: sent === 0 && firstError ? firstError.message : null,
    });
  }),
);
