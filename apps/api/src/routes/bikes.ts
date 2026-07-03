import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { config } from "../config.js";
import { bikeCreateSchema, bikeUpdateSchema } from "@mototracker/shared";
import { inferVehicleType } from "../ocr/catalog.js";
import { canAddVehicle } from "../lib/entitlement.js";

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      cb(new Error("Yalnızca jpeg / png / webp / heic kabul ediliyor"));
      return;
    }
    cb(null, true);
  },
});

export const bikesRouter: Router = Router();

interface BikeRow {
  id: string;
  user_id: string;
  vehicle_type: "motorcycle" | "car";
  nickname: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  current_km: number | null;
  color: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  cylinder_cc: number | null;
  fuel_type: string | null;
  first_registration_date: string | null;
  photo_url: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

function rowToBike(r: BikeRow) {
  return {
    id: r.id,
    userId: r.user_id,
    vehicleType: r.vehicle_type,
    nickname: r.nickname,
    plate: r.plate,
    make: r.make,
    model: r.model,
    year: r.year,
    currentKm: r.current_km,
    color: r.color,
    chassisNo: r.chassis_no,
    engineNo: r.engine_no,
    cylinderCc: r.cylinder_cc,
    fuelType: r.fuel_type,
    firstRegistrationDate: r.first_registration_date,
    // photo_url stores the on-disk path; expose a served endpoint instead, with
    // updatedAt as a cache-buster so a replaced photo refreshes.
    photoUrl: r.photo_url ? `/api/bikes/${r.id}/photo?v=${encodeURIComponent(r.updated_at)}` : null,
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
    const db = getDb();
    // First vehicle is free; each additional one needs an active subscription.
    // Enforced here (not just in the UI) so the API is the source of truth.
    if (!canAddVehicle(req.user!.id, db)) {
      res.status(403).json({ error: "vehicle_limit_reached" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO bike (id, user_id, vehicle_type, nickname, plate, make, model, year, current_km, color, chassis_no, engine_no, cylinder_cc, fuel_type, first_registration_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      // Respect an explicit choice; otherwise infer car/motorcycle from the
      // make/model (covers the review screen's "create bike", which omits it).
      body.vehicleType ?? inferVehicleType(body.make ?? null, body.model ?? null) ?? "motorcycle",
      body.nickname,
      body.plate ?? null,
      body.make ?? null,
      body.model ?? null,
      body.year ?? null,
      body.currentKm ?? null,
      body.color ?? null,
      body.chassisNo ?? null,
      body.engineNo ?? null,
      body.cylinderCc ?? null,
      body.fuelType ?? null,
      body.firstRegistrationDate ?? null,
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
      vehicleType: "vehicle_type",
      nickname: "nickname",
      plate: "plate",
      make: "make",
      model: "model",
      year: "year",
      currentKm: "current_km",
      color: "color",
      chassisNo: "chassis_no",
      engineNo: "engine_no",
      cylinderCc: "cylinder_cc",
      fuelType: "fuel_type",
      firstRegistrationDate: "first_registration_date",
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

// ─── vehicle photo ────────────────────────────────────────────────────────────

function ownedBike(userId: string, id: string) {
  return getDb()
    .prepare("SELECT id, photo_url FROM bike WHERE id = ? AND user_id = ?")
    .get(id, userId) as { id: string; photo_url: string | null } | undefined;
}

bikesRouter.post(
  "/:id/photo",
  photoUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const db = getDb();
    if (!ownedBike(req.user!.id, req.params.id!)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const userDir = path.join(config.UPLOADS_DIR, req.user!.id);
    await fs.mkdir(userDir, { recursive: true });
    const outPath = path.join(userDir, `bike-${req.params.id}.jpg`);
    // A real photo — keep colour, a generous size, and a center-cropped 4:3 so it
    // sits nicely as a hero/thumbnail.
    const buf = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1280, height: 960, fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();
    await fs.writeFile(outPath, buf);
    db.prepare("UPDATE bike SET photo_url = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(outPath, req.params.id, req.user!.id);
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    res.status(201).json(rowToBike(row));
  }),
);

bikesRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const bike = ownedBike(req.user!.id, req.params.id!);
    if (!bike?.photo_url) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(path.resolve(bike.photo_url));
  }),
);

bikesRouter.delete(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const bike = ownedBike(req.user!.id, req.params.id!);
    if (!bike) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    getDb()
      .prepare("UPDATE bike SET photo_url = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    if (bike.photo_url) await fs.rm(path.resolve(bike.photo_url), { force: true }).catch(() => {});
    res.status(204).end();
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
