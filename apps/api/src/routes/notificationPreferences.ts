import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import {
  notifCategoryPreferenceUpdateSchema,
  notifCategorySchema,
  notifPreferenceUpdateSchema,
  type NotifCategory,
  type NotifCategoryPreference,
  type NotifItemType,
} from "@mototracker/shared";

const ITEM_TYPES: NotifItemType[] = ["sigorta", "kasko", "muayene", "maintenance", "mtv"];
const DEFAULT_LEAD = "30,7,1";

/** Every category the client may render. One today; the list is the contract. */
const CATEGORIES: NotifCategory[] = ["sharing"];

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

// ─── categories ───────────────────────────────────────────────────────────────
//
// Registered BEFORE `PUT /:itemType`, because `/categories/sharing` is two
// segments and `/:itemType` is one — they cannot collide today, and keeping the
// order explicit means they still cannot if either ever grows a wildcard.
//
// A category defaults to ON when the user has no row, which is the opposite of
// how the reminder preferences default (no row = silence). That asymmetry is
// deliberate: reminders are a schedule you opt into per document type, while
// sharing activity is transactional — somebody is waiting on you — and the
// version of this feature where a brand-new account silently drops the first
// access request it ever receives is not a quieter product, it is a broken one.
//
// Turning the category off does NOT reach every sharing notification, and the
// Settings copy says so out loud rather than leaving it to be discovered:
//
//   - Requests filed against a vehicle the user HOLDS are always delivered. See
//     MUTABLE_KINDS in notify/events.ts for why a toggle must not be able to
//     make the start of a 21-day window undeliverable.
//   - Garage INVITATIONS are always emailed, because they are addressed to an
//     email address rather than to an account — the recipient usually has no
//     preference row to read, and looking for one would mean branching on
//     whether the address is registered.
//
// What is left is exactly what the switch claims: the answer to a request the
// user themselves sent.

function categoryRow(db: ReturnType<typeof getDb>, userId: string, category: NotifCategory) {
  const row = db
    .prepare(
      "SELECT enabled FROM notification_category_preference WHERE user_id = ? AND category = ?",
    )
    .get(userId, category) as { enabled: number } | undefined;
  const pref: NotifCategoryPreference = { category, enabled: row ? row.enabled === 1 : true };
  return pref;
}

notificationPreferencesRouter.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const db = getDb();
    res.json(CATEGORIES.map((c) => categoryRow(db, req.user!.id, c)));
  }),
);

notificationPreferencesRouter.put(
  "/categories/:category",
  asyncHandler(async (req, res) => {
    const parsed = notifCategorySchema.safeParse(req.params.category);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_category" });
      return;
    }
    const body = notifCategoryPreferenceUpdateSchema.parse(req.body);
    const db = getDb();
    db.prepare(
      `INSERT INTO notification_category_preference (user_id, category, enabled)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, category) DO UPDATE SET enabled = excluded.enabled`,
    ).run(req.user!.id, parsed.data, body.enabled ? 1 : 0);
    res.json(categoryRow(db, req.user!.id, parsed.data));
  }),
);

// ─── expiry reminders ─────────────────────────────────────────────────────────

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
