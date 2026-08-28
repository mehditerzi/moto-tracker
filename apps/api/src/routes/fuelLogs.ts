import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { fuelLogCreateSchema } from "@mototracker/shared";
import { bikeScope, canAccessRecord, canAttachRecord, canReadPersonalLayer } from "../lib/orgAccess.js";

export const fuelLogsRouter: Router = Router();
fuelLogsRouter.use(requireUser);

interface FuelRow {
  id: string;
  user_id: string;
  bike_id: string;
  filled_on: string;
  liters: number;
  total_cost: number | null;
  odometer_km: number | null;
  is_full: number;
  notes: string | null;
  source_document_id: string | null;
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
    sourceDocumentId: r.source_document_id,
    createdAt: r.created_at,
  };
}

// GET /api/fuel-logs?bikeId=… — a vehicle's fuel-ups, most recent first.
// `bikeId` comes from the client, so it is AUTHORISED (404 when the caller may
// not read that vehicle) rather than merely and-ed into the WHERE clause.
fuelLogsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    // `canReadPersonalLayer`, not `canAccessBike`: with a bikeId this query
    // reads the table directly rather than through `bikeScope`, so what somebody
    // SPENT on fuel would otherwise be visible to anyone the car was shared with.
    if (bikeId && !canReadPersonalLayer(req.user!.id, bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const scope = bikeScope(req.user!.id, db);
    const rows = (
      bikeId
        ? db
            .prepare(
              "SELECT * FROM fuel_log WHERE bike_id = ? ORDER BY filled_on DESC, created_at DESC LIMIT 500",
            )
            .all(bikeId)
        : db
            .prepare(
              `SELECT * FROM fuel_log WHERE bike_id IN (${scope.sql}) ORDER BY filled_on DESC, created_at DESC LIMIT 500`,
            )
            .all(...scope.params)
    ) as FuelRow[];
    // The recorder is whoever entered the fill; on an org vehicle that need not
    // be the caller, so report the stored value rather than assuming.
    res.json(rows.map((r) => rowToFuelLog(r, r.user_id)));
  }),
);

fuelLogsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = fuelLogCreateSchema.parse(req.body);
    const db = getDb();
    // A driver logging a fill-up on the vehicle they are holding is the whole
    // point of "write"; an org vehicle they are NOT holding is invisible to them.
    // `canAttachRecord` additionally refuses a personal-group GUEST: a fuel log
    // is what somebody SPENT, it is not a fact about the car, and a guest has no
    // personal layer on a vehicle that was merely shared with them.
    if (!canAttachRecord(req.user!.id, body.bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND archived = 0")
      .get(body.bikeId) as { id: string } | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    // Same rule as dated items: a receipt link is only honoured when the caller
    // may actually read that document, so the field can't be used to probe ids.
    let sourceDocumentId: string | null = null;
    if (body.sourceDocumentId) {
      const doc = db
        .prepare("SELECT bike_id, user_id FROM document WHERE id = ?")
        .get(body.sourceDocumentId) as { bike_id: string | null; user_id: string } | undefined;
      if (doc && canAccessRecord(req.user!.id, { bikeId: doc.bike_id, userId: doc.user_id }, "read", db)) {
        sourceDocumentId = body.sourceDocumentId;
      }
    }
    const id = newId();
    db.prepare(
      `INSERT INTO fuel_log (id, user_id, bike_id, filled_on, liters, total_cost, odometer_km, is_full, notes, source_document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      sourceDocumentId,
    );
    const row = db.prepare("SELECT * FROM fuel_log WHERE id = ?").get(id) as FuelRow;
    res.status(201).json(rowToFuelLog(row, req.user!.id));
  }),
);

// Deliberately silent: an unknown id — or one the caller may not touch — is a
// 204 with nothing deleted, exactly as before organizations existed.
fuelLogsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT id, bike_id, user_id FROM fuel_log WHERE id = ?").get(req.params.id) as
      | { id: string; bike_id: string; user_id: string }
      | undefined;
    // Record-scoped: deleting somebody else's fill-up off a shared vehicle is
    // not something a guest may do, and it is not something the vehicle-level
    // check could have told us.
    if (row && canAccessRecord(req.user!.id, { bikeId: row.bike_id, userId: row.user_id }, "write", db)) {
      db.prepare("DELETE FROM fuel_log WHERE id = ?").run(row.id);
    }
    res.status(204).end();
  }),
);
