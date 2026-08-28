import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { rowToDatedItem } from "./datedItems.js";
import { readableBikeScope } from "../lib/orgAccess.js";

interface BikeRow {
  id: string;
  vehicle_type: "motorcycle" | "car";
  nickname: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  photo_url: string | null;
  current_km: number | null;
  updated_at: string;
}

export const dashboardRouter: Router = Router();
dashboardRouter.use(requireUser);

const ITEM_TYPES = ["sigorta", "kasko", "muayene", "mtv"] as const;

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    // Exactly the vehicles the caller may read: their own garage, the fleets they
    // help run, the garages they have been shared into, or — for a fleet driver —
    // only the vehicle currently in their hands.
    //
    // `readableBikeScope`, not `bikeScope`: a dashboard row is a vehicle and its
    // renewal deadlines, which is precisely what a share conveys. The narrower
    // `bikeScope` is the PERSONAL-LAYER scope and is what keeps a shared-with
    // guest out of the trip, fuel and document lists (lib/orgAccess.ts).
    const scope = readableBikeScope(req.user!.id, db);
    const bikes = db
      .prepare(
        `SELECT id, vehicle_type, nickname, plate, make, model, year, color, photo_url, current_km, updated_at
         FROM bike
         WHERE id IN (${scope.sql}) AND archived = 0
         ORDER BY created_at ASC`,
      )
      .all(...scope.params) as BikeRow[];

    // Scoped by vehicle, not by author: the vehicle above is already authorised,
    // and on an org vehicle the latest policy may have been entered by anyone.
    const latestStmt = db.prepare(
      `SELECT * FROM dated_item
       WHERE bike_id = ? AND type = ?
       ORDER BY expires_on DESC, created_at DESC
       LIMIT 1`,
    );

    const result = bikes.map((b) => {
      const items: Record<string, ReturnType<typeof rowToDatedItem> | null> = {
        sigorta: null,
        kasko: null,
        muayene: null,
        mtv: null,
      };
      for (const t of ITEM_TYPES) {
        const row = latestStmt.get(b.id, t) as
          | Parameters<typeof rowToDatedItem>[0]
          | undefined;
        items[t] = row ? rowToDatedItem(row) : null;
      }
      return {
        bike: {
          id: b.id,
          vehicleType: b.vehicle_type,
          nickname: b.nickname,
          plate: b.plate,
          make: b.make,
          model: b.model,
          year: b.year,
          color: b.color,
          photoUrl: b.photo_url ? `/api/bikes/${b.id}/photo?v=${encodeURIComponent(b.updated_at ?? "")}` : null,
          currentKm: b.current_km,
        },
        items,
      };
    });
    res.json(result);
  }),
);
