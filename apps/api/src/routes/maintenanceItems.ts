import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { maintenanceCreateSchema, maintenanceUpdateSchema } from "@mototracker/shared";
import { authorizeRecord, canAccessBike } from "../lib/orgAccess.js";

interface Row {
  id: string;
  bike_id: string;
  user_id: string;
  kind: "engine_oil" | "brakes" | "tires" | "battery" | "coolant" | "air_filter" | "chain" | "custom";
  custom_label: string | null;
  last_done_on: string | null;
  last_done_km: number | null;
  interval_months: number | null;
  interval_km: number | null;
  cost: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToMaintenance(r: Row) {
  return {
    id: r.id,
    bikeId: r.bike_id,
    userId: r.user_id,
    kind: r.kind,
    customLabel: r.custom_label,
    lastDoneOn: r.last_done_on,
    lastDoneKm: r.last_done_km,
    intervalMonths: r.interval_months,
    intervalKm: r.interval_km,
    cost: r.cost,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * These records ARE facts about the vehicle — a renewal deadline, a service
 * interval — not facts about the person who typed them. That distinction is the
 * whole sharing model: it is what a personal-group GUEST (a mechanic, an
 * inspection agency) is allowed to see and edit, whereas trips, fuel spending
 * and scanned documents stay with their author. The flag defaults to false in
 * `lib/orgAccess.ts`, so a record type is private until a route says otherwise.
 */
const VEHICLE_FACT = { vehicleFact: true } as const;

export const bikesNestedMaintRouter: Router = Router({ mergeParams: true });
bikesNestedMaintRouter.use(requireUser);

// A vehicle's service schedule belongs to the vehicle, not to whoever entered
// it: on an org fleet every member who can see the van sees its maintenance.
bikesNestedMaintRouter.get(
  "/:id/maintenance-items",
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (!canAccessBike(req.user!.id, req.params.id!, "read", db)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rows = db
      .prepare("SELECT * FROM maintenance_item WHERE bike_id = ? ORDER BY kind ASC")
      .all(req.params.id) as Row[];
    res.json(rows.map(rowToMaintenance));
  }),
);

bikesNestedMaintRouter.post(
  "/:id/maintenance-items",
  asyncHandler(async (req, res) => {
    const body = maintenanceCreateSchema.parse(req.body);
    const db = getDb();
    if (!canAccessBike(req.user!.id, req.params.id!, "write", db)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO maintenance_item
         (id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km, cost, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.params.id,
      req.user!.id,
      body.kind,
      body.customLabel ?? null,
      body.lastDoneOn ?? null,
      body.lastDoneKm ?? null,
      body.intervalMonths ?? null,
      body.intervalKm ?? null,
      body.cost ?? null,
      body.notes ?? null,
    );
    const row = db.prepare("SELECT * FROM maintenance_item WHERE id = ?").get(id) as Row;
    res.status(201).json(rowToMaintenance(row));
  }),
);

export const maintenanceItemsRouter: Router = Router();
maintenanceItemsRouter.use(requireUser);

/** Fetch by id, unfiltered — the caller is authorised separately. */
function findItem(id: string): Row | undefined {
  return getDb().prepare("SELECT * FROM maintenance_item WHERE id = ?").get(id) as Row | undefined;
}

function recordOf(row: Row) {
  return { bikeId: row.bike_id, userId: row.user_id };
}

maintenanceItemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = findItem(req.params.id!);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(row), "read", VEHICLE_FACT)) return;
    res.json(rowToMaintenance(row));
  }),
);

maintenanceItemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = maintenanceUpdateSchema.parse(req.body);
    const db = getDb();
    const exists = findItem(req.params.id!);
    if (!exists) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(exists), "write", { db, ...VEHICLE_FACT })) return;
    const fieldMap: Record<string, string> = {
      kind: "kind",
      customLabel: "custom_label",
      lastDoneOn: "last_done_on",
      lastDoneKm: "last_done_km",
      intervalMonths: "interval_months",
      intervalKm: "interval_km",
      cost: "cost",
      notes: "notes",
    };
    const sets: string[] = [];
    const values: (string | number | null | undefined)[] = [];
    for (const [k, col] of Object.entries(fieldMap)) {
      if (k in body) {
        sets.push(`${col} = ?`);
        values.push((body as Record<string, unknown>)[k] as string | number | null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(req.params.id);
      db.prepare(`UPDATE maintenance_item SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM maintenance_item WHERE id = ?").get(req.params.id) as Row;
    res.json(rowToMaintenance(row));
  }),
);

maintenanceItemsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const existing = findItem(req.params.id!);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(existing), "write", { db, ...VEHICLE_FACT })) return;
    db.prepare("DELETE FROM maintenance_item WHERE id = ?").run(req.params.id);
    res.status(204).end();
  }),
);
