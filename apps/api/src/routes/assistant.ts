import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import {
  MAX_SOS_CONTACTS,
  mechanicCreateSchema,
  mechanicUpdateSchema,
  sosContactCreateSchema,
  type Mechanic,
} from "@mototracker/shared";

/**
 * The owner's address book for the car: mechanics they trust, and the people
 * to tell when something goes wrong on the road. Both are strictly per-user —
 * nothing here is a fact about a vehicle, so sharing never exposes it.
 */

// ─── mechanics ────────────────────────────────────────────────────────────────

export const mechanicsRouter: Router = Router();
mechanicsRouter.use(requireUser);

/** Nobody keeps more mechanics than this; a bigger list is a scraper. */
const MAX_MECHANICS = 100;

interface MechanicRow {
  id: string;
  user_id: string;
  name: string;
  specialty: Mechanic["specialty"];
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  favorite: number;
  created_at: string;
}

function rowToMechanic(r: MechanicRow): Mechanic {
  return {
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    phone: r.phone,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    notes: r.notes,
    favorite: r.favorite === 1,
    createdAt: r.created_at,
  };
}

mechanicsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare("SELECT * FROM mechanic WHERE user_id = ? ORDER BY favorite DESC, name COLLATE NOCASE")
      .all(req.user!.id) as MechanicRow[];
    res.json(rows.map(rowToMechanic));
  }),
);

mechanicsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = mechanicCreateSchema.parse(req.body);
    const db = getDb();
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM mechanic WHERE user_id = ?").get(req.user!.id) as {
      n: number;
    };
    if (n >= MAX_MECHANICS) {
      res.status(409).json({ error: "limit_reached", limit: MAX_MECHANICS });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO mechanic (id, user_id, name, specialty, phone, address, lat, lng, notes, favorite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.name,
      body.specialty,
      body.phone || null,
      body.address || null,
      body.lat ?? null,
      body.lng ?? null,
      body.notes || null,
      body.favorite ? 1 : 0,
    );
    res.status(201).json(rowToMechanic(db.prepare("SELECT * FROM mechanic WHERE id = ?").get(id) as MechanicRow));
  }),
);

mechanicsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = mechanicUpdateSchema.parse(req.body);
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM mechanic WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as MechanicRow | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const cur = rowToMechanic(row);
    const next = { ...cur, ...body };
    db.prepare(
      `UPDATE mechanic SET name = ?, specialty = ?, phone = ?, address = ?, lat = ?, lng = ?, notes = ?,
              favorite = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      next.name,
      next.specialty ?? cur.specialty,
      next.phone || null,
      next.address || null,
      next.lat ?? null,
      next.lng ?? null,
      next.notes || null,
      next.favorite ? 1 : 0,
      row.id,
    );
    res.json(rowToMechanic(db.prepare("SELECT * FROM mechanic WHERE id = ?").get(row.id) as MechanicRow));
  }),
);

mechanicsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    getDb().prepare("DELETE FROM mechanic WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
    res.status(204).end();
  }),
);

// ─── SOS contacts ─────────────────────────────────────────────────────────────

export const sosContactsRouter: Router = Router();
sosContactsRouter.use(requireUser);

sosContactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare("SELECT id, name, phone FROM sos_contact WHERE user_id = ? ORDER BY created_at")
      .all(req.user!.id);
    res.json(rows);
  }),
);

sosContactsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = sosContactCreateSchema.parse(req.body);
    const db = getDb();
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM sos_contact WHERE user_id = ?").get(req.user!.id) as {
      n: number;
    };
    if (n >= MAX_SOS_CONTACTS) {
      res.status(409).json({ error: "limit_reached", limit: MAX_SOS_CONTACTS });
      return;
    }
    const id = newId();
    db.prepare("INSERT INTO sos_contact (id, user_id, name, phone) VALUES (?, ?, ?, ?)").run(
      id,
      req.user!.id,
      body.name,
      body.phone,
    );
    res.status(201).json({ id, name: body.name, phone: body.phone });
  }),
);

sosContactsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    getDb().prepare("DELETE FROM sos_contact WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
    res.status(204).end();
  }),
);
