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
import { canAddOrgVehicle, canAddVehicle } from "../lib/entitlement.js";
import { authorizeBike, bikeScope, roleInOrg, type BikeAccessFacts } from "../lib/orgAccess.js";
import { ApiCodeError } from "../middleware/errorHandler.js";

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      // Machine code, not prose — the client is bilingual and translates it.
      cb(new ApiCodeError("unsupported_media_type", 415));
      return;
    }
    cb(null, true);
  },
});

export const bikesRouter: Router = Router();

interface BikeRow {
  id: string;
  user_id: string;
  org_id: string | null;
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
    // For an org vehicle this is the CUSTODIAN (who registered it), not who may
    // see it — access comes from orgId + membership. See lib/orgAccess.ts.
    userId: r.user_id,
    orgId: r.org_id,
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

// The caller's own garage plus every org vehicle they may read — one scope,
// computed in lib/orgAccess.ts, never re-derived here. A driver sees only the
// vehicles currently assigned to them, so this endpoint cannot be used to
// enumerate a fleet.
bikesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.archived === "true";
    const db = getDb();
    const scope = bikeScope(req.user!.id, db);
    const rows = db
      .prepare(
        `SELECT * FROM bike
          WHERE id IN (${scope.sql})${includeArchived ? "" : " AND archived = 0"}
          ORDER BY created_at DESC`,
      )
      .all(...scope.params) as BikeRow[];
    res.json(rows.map(rowToBike));
  }),
);

/**
 * A vehicle is created either in the caller's personal garage (no orgId — the
 * consumer app) or in one of their organizations. The two are billed to
 * different ceilings, so the branch has to happen before anything is written.
 */
const bikeOrgSchema = z.object({ orgId: z.string().min(1).optional() });

bikesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = bikeCreateSchema.parse(req.body);
    const { orgId } = bikeOrgSchema.parse(req.body);
    const db = getDb();

    if (orgId) {
      // Adding a vehicle grows the org's bill, so it is an owner/manager act —
      // staff run the fleet, they don't size it. A non-member gets 404: the
      // existence of an organization is not public information.
      const role = roleInOrg(req.user!.id, orgId, db);
      if (role === null) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (role !== "owner" && role !== "manager") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (!canAddOrgVehicle(orgId, db)) {
        res.status(403).json({ error: "vehicle_limit_reached" });
        return;
      }
    } else if (!canAddVehicle(req.user!.id, db)) {
      // First vehicle is free; each additional one needs an active subscription.
      // Enforced here (not just in the UI) so the API is the source of truth.
      res.status(403).json({ error: "vehicle_limit_reached" });
      return;
    }

    const id = newId();
    db.prepare(
      `INSERT INTO bike (id, user_id, org_id, vehicle_type, nickname, plate, make, model, year, current_km, color, chassis_no, engine_no, cylinder_cc, fuel_type, first_registration_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      orgId ?? null,
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
    if (!authorizeBike(req, res, req.params.id!, "read")) return;
    const row = getDb().prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    res.json(rowToBike(row));
  }),
);

bikesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = bikeUpdateSchema.parse(req.body);
    const db = getDb();
    // "manage", not "write": a driver may log a fill-up on the van they are
    // holding, but must not rename or re-plate it.
    if (!authorizeBike(req, res, req.params.id!, "manage")) return;
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
      values.push(req.params.id);
      // Authorised above; an org vehicle's row is not keyed by the caller.
      db.prepare(`UPDATE bike SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    res.json(rowToBike(row));
  }),
);

// ─── vehicle photo ────────────────────────────────────────────────────────────

/**
 * Where a vehicle's photo is written. Personal vehicles keep the per-user
 * directory that DELETE /api/me wipes wholesale; ORG vehicles are written under
 * `org/<orgId>` instead, because a company van's photo must not disappear
 * because the member who uploaded it closed their account.
 */
function photoDirFor(facts: BikeAccessFacts, userId: string): string {
  return facts.orgId
    ? path.join(config.UPLOADS_DIR, "org", facts.orgId)
    : path.join(config.UPLOADS_DIR, userId);
}

function photoUrlOf(id: string): string | null {
  const row = getDb().prepare("SELECT photo_url FROM bike WHERE id = ?").get(id) as
    | { photo_url: string | null }
    | undefined;
  return row?.photo_url ?? null;
}

/**
 * The 320×240 derivative that sits beside the 1280×960 master.
 *
 * A garage list draws 44px squares, and the switcher draws 20px ones; serving
 * the full master for those meant ~200 KB per row — a megabyte to paint five
 * thumbnails, on a phone, over Turkish mobile data. Written once at upload
 * time, so serving it costs nothing at request time.
 *
 * Derived from the master's path rather than stored, so a photo uploaded before
 * this existed simply has no thumb file and falls back (see GET below).
 */
function thumbPathOf(masterPath: string): string {
  return masterPath.replace(/\.jpg$/, "-thumb.jpg");
}

const MASTER = { width: 1280, height: 960 };
const THUMB = { width: 320, height: 240 };

bikesRouter.post(
  "/:id/photo",
  photoUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const db = getDb();
    const facts = authorizeBike(req, res, req.params.id!, "manage");
    if (!facts) return;
    const dir = photoDirFor(facts, req.user!.id);
    await fs.mkdir(dir, { recursive: true });
    const outPath = path.join(dir, `bike-${req.params.id}.jpg`);

    // A real photo — keep colour, a generous size, and a 4:3 crop so it sits
    // predictably in a hero, a list row and a pill.
    //
    // `.rotate()` with no argument applies the EXIF orientation and drops the
    // tag, which is what stops a phone-held-sideways shot arriving on its side.
    // The crop uses sharp's attention strategy rather than the centre: phone
    // photos of a vehicle are usually portrait, and a blind centre crop of a
    // portrait frame throws away the roof and the wheels to keep a door.
    let master: Buffer;
    let thumb: Buffer;
    try {
      master = await sharp(req.file.buffer)
        .rotate()
        .resize({ ...MASTER, fit: "cover", position: sharp.strategy.attention })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      thumb = await sharp(master)
        .resize({ ...THUMB, fit: "cover" })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
    } catch {
      // The mimetype said image; the decoder disagreed. The common real case is
      // HEIC: iOS transcodes to JPEG when a photo is picked in a WebView, but a
      // file chosen out of the Files app arrives as HEVC-coded HEIF, which the
      // prebuilt libvips cannot decode. Answer with the same translatable code
      // the mimetype filter uses, so the client can tell the user to pick a
      // different photo instead of showing "500".
      throw new ApiCodeError("unsupported_media_type", 415);
    }

    await fs.writeFile(outPath, master);
    // A stale thumb next to a fresh master would be served for the list rows
    // while the hero showed the new photo, so this is not best-effort.
    await fs.writeFile(thumbPathOf(outPath), thumb);
    db.prepare("UPDATE bike SET photo_url = ?, updated_at = datetime('now') WHERE id = ?")
      .run(outPath, req.params.id);
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    res.status(201).json(rowToBike(row));
  }),
);

bikesRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    if (!authorizeBike(req, res, req.params.id!, "read")) return;
    const photoUrl = photoUrlOf(req.params.id!);
    if (!photoUrl) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Photos uploaded before the derivative existed have no thumb on disk; fall
    // back to the master rather than 404-ing a vehicle's picture out of the list.
    let file = path.resolve(photoUrl);
    if (req.query.size === "thumb") {
      const thumb = thumbPathOf(file);
      if (await fs.access(thumb).then(() => true, () => false)) file = thumb;
    }
    res.setHeader("Content-Type", "image/jpeg");
    // The URL carries `?v=<updated_at>`, so a replaced photo is a different URL
    // and a long cache is safe. `private` because an org vehicle's photo is
    // authorized per caller and must never land in a shared cache.
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(file);
  }),
);

bikesRouter.delete(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    if (!authorizeBike(req, res, req.params.id!, "manage")) return;
    const photoUrl = photoUrlOf(req.params.id!);
    getDb()
      .prepare("UPDATE bike SET photo_url = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
    if (photoUrl) {
      const file = path.resolve(photoUrl);
      await fs.rm(file, { force: true }).catch(() => {});
      await fs.rm(thumbPathOf(file), { force: true }).catch(() => {});
    }
    res.status(204).end();
  }),
);

// Archiving a vehicle frees a slot against the ceiling that pays for it, so it
// is owner/manager-only on an org fleet (staff and drivers get 403).
bikesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!authorizeBike(req, res, req.params.id!, "delete")) return;
    getDb()
      .prepare("UPDATE bike SET archived = 1, updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
    res.status(204).end();
  }),
);
