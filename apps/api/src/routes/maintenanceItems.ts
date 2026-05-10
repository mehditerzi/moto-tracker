import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { maintenanceCreateSchema, maintenanceUpdateSchema } from "@mototracker/shared";

interface Row {
  id: string;
  bike_id: string;
  user_id: string;
  kind: "engine_oil" | "chain" | "brakes" | "tires" | "coolant" | "custom";
  custom_label: string | null;
  last_done_on: string | null;
  last_done_km: number | null;
  interval_months: number | null;
  interval_km: number | null;
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
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const bikesNestedMaintRouter: Router = Router({ mergeParams: true });
bikesNestedMaintRouter.use(requireUser);

bikesNestedMaintRouter.get(
  "/:id/maintenance-items",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!bike) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rows = db
      .prepare(
        "SELECT * FROM maintenance_item WHERE bike_id = ? AND user_id = ? ORDER BY kind ASC",
      )
      .all(req.params.id, req.user!.id) as Row[];
    res.json(rows.map(rowToMaintenance));
  }),
);

bikesNestedMaintRouter.post(
  "/:id/maintenance-items",
  asyncHandler(async (req, res) => {
    const body = maintenanceCreateSchema.parse(req.body);
    const db = getDb();
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!bike) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO maintenance_item
         (id, bike_id, user_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      body.notes ?? null,
    );
    const row = db.prepare("SELECT * FROM maintenance_item WHERE id = ?").get(id) as Row;
    res.status(201).json(rowToMaintenance(row));
  }),
);

export const maintenanceItemsRouter: Router = Router();
maintenanceItemsRouter.use(requireUser);

maintenanceItemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM maintenance_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as Row | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToMaintenance(row));
  }),
);

maintenanceItemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = maintenanceUpdateSchema.parse(req.body);
    const db = getDb();
    const exists = db
      .prepare("SELECT id FROM maintenance_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!exists) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const fieldMap: Record<string, string> = {
      kind: "kind",
      customLabel: "custom_label",
      lastDoneOn: "last_done_on",
      lastDoneKm: "last_done_km",
      intervalMonths: "interval_months",
      intervalKm: "interval_km",
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
      values.push(req.params.id, req.user!.id);
      db.prepare(`UPDATE maintenance_item SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(
        ...values,
      );
    }
    const row = db.prepare("SELECT * FROM maintenance_item WHERE id = ?").get(req.params.id) as Row;
    res.json(rowToMaintenance(row));
  }),
);

maintenanceItemsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const r = db
      .prepare("DELETE FROM maintenance_item WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    if (r.changes === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  }),
);
