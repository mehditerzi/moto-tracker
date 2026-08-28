import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { tripCreateSchema } from "@mototracker/shared";
import { bikeScope, canAccessRecord, canAttachRecord, canReadPersonalLayer } from "../lib/orgAccess.js";

export const tripsRouter: Router = Router();
tripsRouter.use(requireUser);

interface TripRow {
  id: string;
  user_id: string;
  bike_id: string;
  distance_km: number;
  started_at: string;
  ended_at: string;
  point_count: number;
  route: string | null;
  created_at: string;
}

/**
 * List responses only say whether a route exists (a full list of 200 encoded
 * polylines would be hundreds of KB); GET /:id carries the actual route.
 */
function rowToTrip(r: TripRow, userId: string, withRoute = false) {
  return {
    id: r.id,
    userId,
    bikeId: r.bike_id,
    distanceKm: r.distance_km,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    pointCount: r.point_count,
    hasRoute: r.route != null,
    ...(withRoute ? { route: r.route } : {}),
    createdAt: r.created_at,
  };
}

// GET /api/trips           → every trip on a vehicle the caller can see
// GET /api/trips?bikeId=…  → scoped to one vehicle
//
// Trips are scoped by VEHICLE, like every other record: on a fleet vehicle the
// journey log is the org's operational record, so a manager sees the trips its
// drivers recorded. `bikeId` is client-supplied and therefore authorised, not
// merely filtered.
tripsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    // `canReadPersonalLayer`, not `canAccessBike`: supplying a bikeId makes this
    // query bypass `bikeScope` and read the table directly, so the narrower
    // question has to be asked here or a personal-group guest would be handed
    // the owner's entire journey log for a car they were only shown.
    if (bikeId && !canReadPersonalLayer(req.user!.id, bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const scope = bikeScope(req.user!.id, db);
    const rows = (
      bikeId
        ? db
            .prepare("SELECT * FROM trip WHERE bike_id = ? ORDER BY ended_at DESC LIMIT 200")
            .all(bikeId)
        : db
            .prepare(
              `SELECT * FROM trip WHERE bike_id IN (${scope.sql}) ORDER BY ended_at DESC LIMIT 200`,
            )
            .all(...scope.params)
    ) as TripRow[];
    res.json(rows.map((r) => rowToTrip(r, r.user_id)));
  }),
);

// GET /api/trips/:id → one trip including its encoded route (for the map).
tripsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM trip WHERE id = ?").get(req.params.id) as
      | TripRow
      | undefined;
    // `canAccessRecord`, not `canAccessBike`: a trip is a record of where a
    // PERSON went, so reaching it needs more than reaching the vehicle. The
    // difference bites for a personal-group guest — a mechanic can read the
    // car's service history and must never be able to read its owner's routes.
    if (!row || !canAccessRecord(req.user!.id, { bikeId: row.bike_id, userId: row.user_id }, "read", db)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToTrip(row, row.user_id, true));
  }),
);

tripsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = tripCreateSchema.parse(req.body);
    const db = getDb();
    // Only attribute a trip to a vehicle the caller may write to — their own, the
    // org vehicle they are currently holding, or one shared into their garage
    // group as a full member. `canAttachRecord` also refuses a personal-group
    // GUEST: they have write on the vehicle's facts but no personal layer, so a
    // trip saved here would be invisible to its own author the moment it landed.
    if (!canAttachRecord(req.user!.id, body.bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const bike = db.prepare("SELECT id FROM bike WHERE id = ? AND archived = 0").get(body.bikeId) as
      | { id: string }
      | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO trip (id, user_id, bike_id, distance_km, started_at, ended_at, point_count, route)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.bikeId,
      body.distanceKm,
      body.startedAt,
      body.endedAt,
      body.pointCount,
      body.route ?? null,
    );
    const row = db.prepare("SELECT * FROM trip WHERE id = ?").get(id) as TripRow;
    res.status(201).json(rowToTrip(row, req.user!.id));
  }),
);

tripsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT id, bike_id, user_id FROM trip WHERE id = ?").get(req.params.id) as
      | { id: string; bike_id: string; user_id: string }
      | undefined;
    // Unknown id, or a trip on a vehicle the caller can't reach — both look the
    // same to the caller. Record-scoped, so a guest cannot delete somebody's
    // journey log off a vehicle they were merely shown.
    if (!row || !canAccessRecord(req.user!.id, { bikeId: row.bike_id, userId: row.user_id }, "write", db)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    db.prepare("DELETE FROM trip WHERE id = ?").run(row.id);
    res.status(204).end();
  }),
);
