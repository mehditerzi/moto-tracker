import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { fuelLogCreateSchema } from "@mototracker/shared";

export const fuelLogsRouter: Router = Router();
fuelLogsRouter.use(requireUser);

interface FuelRow {
  id: string;
  bike_id: string;
  filled_on: string;
  liters: number;
  total_cost: number | null;
  odometer_km: number | null;
  is_full: number;
  notes: string | null;
  created_at: string;
}

function rowToFuelLog(r: FuelRow, userId: string) {
  return {
    id: r.id,
    userId,
    bikeId: r.bike_id,
    filledOn: r.filled_on,
    liters: r.liters,
    totalCost: r.total_cost,
    odometerKm: r.odometer_km,
    isFull: r.is_full === 1,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

// GET /api/fuel-logs?bikeId=… — a vehicle's fuel-ups, most recent first.
fuelLogsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    const rows = (
      bikeId
        ? db
            .prepare(
              "SELECT * FROM fuel_log WHERE user_id = ? AND bike_id = ? ORDER BY filled_on DESC, created_at DESC LIMIT 500",
            )
            .all(req.user!.id, bikeId)
        : db
            .prepare("SELECT * FROM fuel_log WHERE user_id = ? ORDER BY filled_on DESC, created_at DESC LIMIT 500")
            .all(req.user!.id)
    ) as FuelRow[];
    res.json(rows.map((r) => rowToFuelLog(r, req.user!.id)));
  }),
);

fuelLogsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = fuelLogCreateSchema.parse(req.body);
    const db = getDb();
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ? AND archived = 0")
      .get(body.bikeId, req.user!.id) as { id: string } | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO fuel_log (id, user_id, bike_id, filled_on, liters, total_cost, odometer_km, is_full, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.bikeId,
      body.filledOn,
      body.liters,
      body.totalCost ?? null,
      body.odometerKm ?? null,
      body.isFull ? 1 : 0,
      body.notes ?? null,
    );
    const row = db.prepare("SELECT * FROM fuel_log WHERE id = ?").get(id) as FuelRow;
    res.status(201).json(rowToFuelLog(row, req.user!.id));
  }),
);

fuelLogsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    getDb()
      .prepare("DELETE FROM fuel_log WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    res.status(204).end();
  }),
);
