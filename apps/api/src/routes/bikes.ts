import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { bikeCreateSchema, bikeUpdateSchema } from "@mototracker/shared";

export const bikesRouter: Router = Router();

interface BikeRow {
  id: string;
  user_id: string;
  nickname: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  current_km: number | null;
  color: string | null;
  photo_url: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

function rowToBike(r: BikeRow) {
  return {
    id: r.id,
    userId: r.user_id,
    nickname: r.nickname,
    plate: r.plate,
    make: r.make,
    model: r.model,
    year: r.year,
    currentKm: r.current_km,
    color: r.color,
    photoUrl: r.photo_url,
    archived: r.archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

bikesRouter.use(requireUser);

bikesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.archived === "true";
    const db = getDb();
    const rows = (
      includeArchived
        ? db.prepare("SELECT * FROM bike WHERE user_id = ? ORDER BY created_at DESC").all(req.user!.id)
        : db
            .prepare("SELECT * FROM bike WHERE user_id = ? AND archived = 0 ORDER BY created_at DESC")
            .all(req.user!.id)
    ) as BikeRow[];
    res.json(rows.map(rowToBike));
  }),
);

bikesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = bikeCreateSchema.parse(req.body);
    const id = newId();
    const db = getDb();
    db.prepare(
      `INSERT INTO bike (id, user_id, nickname, plate, make, model, year, current_km, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.nickname,
      body.plate ?? null,
      body.make ?? null,
      body.model ?? null,
      body.year ?? null,
      body.currentKm ?? null,
      body.color ?? null,
    );
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(id) as BikeRow;
    res.status(201).json(rowToBike(row));
  }),
);

bikesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as BikeRow | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToBike(row));
  }),
);

bikesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = bikeUpdateSchema.parse(req.body);
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const fieldMap: Record<string, string> = {
      nickname: "nickname",
      plate: "plate",
      make: "make",
      model: "model",
      year: "year",
      currentKm: "current_km",
      color: "color",
    };
    const sets: string[] = [];
    const values: (string | number | null | undefined)[] = [];
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body) {
        sets.push(`${col} = ?`);
        values.push((body as Record<string, unknown>)[key] as string | number | null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(req.params.id, req.user!.id);
      db.prepare(`UPDATE bike SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    res.json(rowToBike(row));
  }),
);

bikesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db
      .prepare("UPDATE bike SET archived = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  }),
);
