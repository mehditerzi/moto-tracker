import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { tripCreateSchema } from "@mototracker/shared";

export const tripsRouter: Router = Router();
tripsRouter.use(requireUser);

interface TripRow {
  id: string;
  bike_id: string;
  distance_km: number;
  started_at: string;
  ended_at: string;
  point_count: number;
  created_at: string;
}

function rowToTrip(r: TripRow, userId: string) {
  return {
    id: r.id,
    userId,
    bikeId: r.bike_id,
    distanceKm: r.distance_km,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    pointCount: r.point_count,
    createdAt: r.created_at,
  };
}

// GET /api/trips           → all the user's trips, newest first
// GET /api/trips?bikeId=…  → scoped to one vehicle
tripsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    const rows = (
      bikeId
        ? db
            .prepare(
              "SELECT * FROM trip WHERE user_id = ? AND bike_id = ? ORDER BY ended_at DESC LIMIT 200",
            )
            .all(req.user!.id, bikeId)
        : db
            .prepare("SELECT * FROM trip WHERE user_id = ? ORDER BY ended_at DESC LIMIT 200")
            .all(req.user!.id)
    ) as TripRow[];
    res.json(rows.map((r) => rowToTrip(r, req.user!.id)));
  }),
);

tripsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = tripCreateSchema.parse(req.body);
    const db = getDb();
    // Only attribute a trip to a vehicle the caller actually owns.
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ? AND archived = 0")
      .get(body.bikeId, req.user!.id) as { id: string } | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO trip (id, user_id, bike_id, distance_km, started_at, ended_at, point_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.bikeId,
      body.distanceKm,
      body.startedAt,
      body.endedAt,
      body.pointCount,
    );
    const row = db.prepare("SELECT * FROM trip WHERE id = ?").get(id) as TripRow;
    res.status(201).json(rowToTrip(row, req.user!.id));
  }),
);

tripsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    getDb()
      .prepare("DELETE FROM trip WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    res.status(204).end();
  }),
);
