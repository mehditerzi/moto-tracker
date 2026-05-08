import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { rowToDatedItem } from "./datedItems.js";

interface BikeRow {
  id: string;
  nickname: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  photo_url: string | null;
}

export const dashboardRouter: Router = Router();
dashboardRouter.use(requireUser);

const ITEM_TYPES = ["sigorta", "kasko", "muayene"] as const;

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikes = db
      .prepare(
        `SELECT id, nickname, plate, make, model, year, color, photo_url
         FROM bike
         WHERE user_id = ? AND archived = 0
         ORDER BY created_at ASC`,
      )
      .all(req.user!.id) as BikeRow[];

    const latestStmt = db.prepare(
      `SELECT * FROM dated_item
       WHERE bike_id = ? AND user_id = ? AND type = ?
       ORDER BY expires_on DESC, created_at DESC
       LIMIT 1`,
    );

    const result = bikes.map((b) => {
      const items: Record<string, ReturnType<typeof rowToDatedItem> | null> = {
        sigorta: null,
        kasko: null,
        muayene: null,
      };
      for (const t of ITEM_TYPES) {
        const row = latestStmt.get(b.id, req.user!.id, t) as
          | Parameters<typeof rowToDatedItem>[0]
          | undefined;
        items[t] = row ? rowToDatedItem(row) : null;
      }
      return {
        bike: {
          id: b.id,
          nickname: b.nickname,
          plate: b.plate,
          make: b.make,
          model: b.model,
          year: b.year,
          color: b.color,
          photoUrl: b.photo_url,
        },
        items,
      };
    });
    res.json(result);
  }),
);
