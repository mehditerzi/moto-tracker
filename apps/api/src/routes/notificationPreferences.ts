import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { notifPreferenceUpdateSchema, type NotifItemType } from "@mototracker/shared";

const ITEM_TYPES: NotifItemType[] = ["sigorta", "kasko", "muayene", "maintenance"];
const DEFAULT_LEAD = "30,7,1";

interface Row {
  user_id: string;
  item_type: NotifItemType;
  lead_days_csv: string;
  enabled: number;
}

function rowToPref(r: Row) {
  return {
    userId: r.user_id,
    itemType: r.item_type,
    leadDays: r.lead_days_csv
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => b - a),
    enabled: r.enabled === 1,
  };
}

function ensureAllPrefs(db: ReturnType<typeof getDb>, userId: string) {
  for (const t of ITEM_TYPES) {
    db.prepare(
      `INSERT OR IGNORE INTO notification_preference (user_id, item_type, lead_days_csv, enabled)
       VALUES (?, ?, ?, 1)`,
    ).run(userId, t, DEFAULT_LEAD);
  }
}

export const notificationPreferencesRouter: Router = Router();
notificationPreferencesRouter.use(requireUser);

notificationPreferencesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    ensureAllPrefs(db, req.user!.id);
    const rows = db
      .prepare(
        "SELECT user_id, item_type, lead_days_csv, enabled FROM notification_preference WHERE user_id = ?",
      )
      .all(req.user!.id) as Row[];
    res.json(rows.map(rowToPref));
  }),
);

notificationPreferencesRouter.put(
  "/:itemType",
  asyncHandler(async (req, res) => {
    const itemType = req.params.itemType;
    if (!ITEM_TYPES.includes(itemType as NotifItemType)) {
      res.status(400).json({ error: "bad_item_type" });
      return;
    }
    const body = notifPreferenceUpdateSchema.parse(req.body);
    const csv = [...new Set(body.leadDays)].sort((a, b) => b - a).join(",");
    const db = getDb();
    db.prepare(
      `INSERT INTO notification_preference (user_id, item_type, lead_days_csv, enabled)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, item_type) DO UPDATE
         SET lead_days_csv = excluded.lead_days_csv,
             enabled = excluded.enabled`,
    ).run(req.user!.id, itemType, csv, body.enabled ? 1 : 0);
    const row = db
      .prepare(
        "SELECT user_id, item_type, lead_days_csv, enabled FROM notification_preference WHERE user_id = ? AND item_type = ?",
      )
      .get(req.user!.id, itemType) as Row;
    res.json(rowToPref(row));
  }),
);
