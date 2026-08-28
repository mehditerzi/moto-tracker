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
import {
  authorizeBike,
  groupIdsForBikes,
  orgMode,
  readableBikeScope,
  roleInOrg,
  type BikeAccessFacts,
} from "../lib/orgAccess.js";
import {
  bikeIsReachable,
  findIdentityMatch,
  mintClaimToken,
  registerIdentities,
} from "../lib/vehicleIdentity.js";
import { vehicleCreateLimiter } from "../lib/shareLimits.js";
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

function rowToBike(r: BikeRow, groupIds: string[] = []) {
  return {
    id: r.id,
    // For an org vehicle this is the CUSTODIAN (who registered it), not who may
    // see it — access comes from orgId + membership. See lib/orgAccess.ts.
    userId: r.user_id,
    orgId: r.org_id,
    // The garage groups this vehicle is filed in, restricted to groups the
    // caller belongs to (lib/orgAccess.ts → groupIdsForBikes). Always present so
    // the client never has to distinguish "no groups" from "not told".
    groupIds,
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

/**
 * Every `authorizeBike` call in this file deals with the VEHICLE'S OWN RECORD —
 * its attributes and its photo — which is precisely the facts layer a share
 * conveys. Declaring it here means a personal-group GUEST (a mechanic) can open
 * the vehicle and see its plate and photo, while the same default keeps them out
 * of the document wallet, the trip list and the fuel log without those routes
 * having to know that sharing exists (lib/orgAccess.ts).
 */
const VEHICLE_FACT = { vehicleFact: true } as const;

/** The caller's groups for ONE vehicle — the single-row form of the batched
 *  lookup the list uses. */
function groupsOf(userId: string, bikeId: string, db: Parameters<typeof groupIdsForBikes>[2]) {
  return groupIdsForBikes(userId, [bikeId], db).get(bikeId) ?? [];
}

bikesRouter.use(requireUser);

// The caller's own garage, every org vehicle they may read, and every vehicle
// in a garage group they belong to — one scope, computed in lib/orgAccess.ts,
// never re-derived here. A driver sees only the vehicles currently assigned to
// them, so this endpoint cannot be used to enumerate a fleet.
//
// `readableBikeScope`, not `bikeScope`: this list is about VEHICLES, so a
// personal-group guest (a mechanic) belongs on it. The narrower `bikeScope` is
// what keeps that same guest out of the trip, fuel and document lists.
bikesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.archived === "true";
    const db = getDb();
    const scope = readableBikeScope(req.user!.id, db);
    const rows = db
      .prepare(
        `SELECT * FROM bike
          WHERE id IN (${scope.sql})${includeArchived ? "" : " AND archived = 0"}
          ORDER BY created_at DESC`,
      )
      .all(...scope.params) as BikeRow[];
    // One query for the whole list, not one per row: the garage screen sections
    // and filters by group, so this would otherwise be an N+1 that grows with
    // the size of the garage.
    const groups = groupIdsForBikes(req.user!.id, rows.map((r) => r.id), db);
    res.json(rows.map((r) => rowToBike(r, groups.get(r.id) ?? [])));
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
  vehicleCreateLimiter,
  asyncHandler(async (req, res) => {
    const body = bikeCreateSchema.parse(req.body);
    const { orgId } = bikeOrgSchema.parse(req.body);
    const db = getDb();

    // A personal garage GROUP is not a tenancy, so `orgId` naming one does NOT
    // become `bike.org_id`. The vehicle is created as an ordinary personal
    // vehicle and then filed in the group (029) — which is why grouping cannot
    // mint free capacity: there is no org for the bill to fall to.
    let personalGroupId: string | null = null;

    if (orgId) {
      const role = roleInOrg(req.user!.id, orgId, db);
      if (role === null) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (orgMode(orgId, db) === "personal") {
        // ── a personal garage GROUP ──────────────────────────────────────────
        //
        // Two differences from a fleet, both deliberate.
        //
        // WHO MAY ADD: an owner or a member, but never a guest. A mechanic with
        // access to your bike has no business putting new cars in your garage.
        //
        // WHO PAYS: the person adding it, against their OWN entitlement — never
        // `organization.max_vehicles`, which for a personal group is 0 and means
        // nothing, because nobody bought it. This is the line that stops garage
        // groups being a source of free vehicles: `bike.user_id` stays the
        // adder, `countActiveBikes` counts personal-group vehicles for their
        // custodian, and so a group of eight people still pays for every car in
        // it exactly once.
        if (role === "driver") {
          res.status(403).json({ error: "forbidden" });
          return;
        }
        if (!canAddVehicle(req.user!.id, db)) {
          res.status(403).json({ error: "vehicle_limit_reached" });
          return;
        }
        personalGroupId = orgId;
      } else {
        // Adding a vehicle grows the org's bill, so it is an owner/manager act —
        // staff run the fleet, they don't size it. A non-member gets 404: the
        // existence of an organization is not public information.
        if (role !== "owner" && role !== "manager") {
          res.status(403).json({ error: "forbidden" });
          return;
        }
        if (!canAddOrgVehicle(orgId, db)) {
          res.status(403).json({ error: "vehicle_limit_reached" });
          return;
        }
      }
    } else if (!canAddVehicle(req.user!.id, db)) {
      // First vehicle is free; each additional one needs an active subscription.
      // Enforced here (not just in the UI) so the API is the source of truth.
      res.status(403).json({ error: "vehicle_limit_reached" });
      return;
    }

    // ── is this vehicle already in the system? ───────────────────────────────
    //
    // Checked AFTER the entitlement gate on purpose: a user who cannot add a
    // vehicle at all must not be able to use this endpoint as a lookup service.
    //
    // The answer is deliberately almost empty. It says THAT the vehicle is
    // tracked and nothing else — not by whom, not its nickname, not its id, not
    // even whether the holder is a person or a company. What the caller gets
    // instead is an opaque token that lets them knock (routes/vehicleShares.ts).
    //
    // Note which identifiers can trigger this: chassis and engine only. A plate
    // is not an identity — Turkish plates are re-issued and change on a
    // provincial transfer — and it is the one identifier a stranger can read off
    // a bumper, so matching on it would turn this endpoint into a plate-to-user
    // oracle. See lib/vehicleIdentity.ts.
    const match = findIdentityMatch(db, {
      chassisNo: body.chassisNo,
      engineNo: body.engineNo,
    });
    if (match) {
      if (bikeIsReachable(db, req.user!.id, match.bikeId)) {
        // It is already in a garage this caller can see. There is nobody to ask,
        // so say so plainly and point at the record they already have.
        res.status(409).json({ error: "vehicle_already_in_garage", bikeId: match.bikeId });
        return;
      }
      const { token } = mintClaimToken(db, match, req.user!.id);
      res.status(409).json({
        error: "vehicle_already_registered",
        matchedOn: match.kind,
        claimToken: token,
      });
      return;
    }

    const id = newId();
    db.prepare(
      `INSERT INTO bike (id, user_id, org_id, vehicle_type, nickname, plate, make, model, year, current_km, color, chassis_no, engine_no, cylinder_cc, fuel_type, first_registration_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      // A garage group never lands here — see `personalGroupId` above.
      personalGroupId ? null : (orgId ?? null),
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
    // Claim the identity. The unique index on the chassis key is the real
    // guarantee — the check above can lose a race with a simultaneous add, and
    // this INSERT is where that race is actually decided.
    registerIdentities(db, id, { chassisNo: body.chassisNo, engineNo: body.engineNo });
    if (personalGroupId) {
      db.prepare(
        "INSERT OR IGNORE INTO bike_group (bike_id, org_id, added_by) VALUES (?, ?, ?)",
      ).run(id, personalGroupId, req.user!.id);
    }
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(id) as BikeRow;
    res.status(201).json(rowToBike(row, groupsOf(req.user!.id, id, db)));
  }),
);

bikesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!authorizeBike(req, res, req.params.id!, "read", VEHICLE_FACT)) return;
    const db = getDb();
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    res.json(rowToBike(row, groupsOf(req.user!.id, row.id, db)));
  }),
);

bikesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = bikeUpdateSchema.parse(req.body);
    const db = getDb();
    // "manage", not "write": a driver may log a fill-up on the van they are
    // holding, but must not rename or re-plate it.
    if (!authorizeBike(req, res, req.params.id!, "manage", VEHICLE_FACT)) return;
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

    // ── editing an identity is still a claim on it ──────────────────────────
    //
    // Without this check, the duplicate rule would be one PATCH away from being
    // off: add an empty vehicle, then edit somebody else's VIN onto it. So the
    // same question is asked here as at creation, excluding this vehicle (a
    // record is never a duplicate of itself).
    //
    // The refusal is the same 409 with the same opaque token, so the edit screen
    // can offer the same "request access / I bought this" conversation. It does
    // not reveal the other record either.
    const touchesIdentity = "chassisNo" in body || "engineNo" in body;
    if (touchesIdentity) {
      const current = db
        .prepare("SELECT chassis_no, engine_no FROM bike WHERE id = ?")
        .get(req.params.id) as { chassis_no: string | null; engine_no: string | null };
      const next = {
        chassisNo: "chassisNo" in body ? (body.chassisNo ?? null) : current.chassis_no,
        engineNo: "engineNo" in body ? (body.engineNo ?? null) : current.engine_no,
      };
      const match = findIdentityMatch(db, next, req.params.id!);
      if (match) {
        if (bikeIsReachable(db, req.user!.id, match.bikeId)) {
          res.status(409).json({ error: "vehicle_already_in_garage", bikeId: match.bikeId });
          return;
        }
        const { token } = mintClaimToken(db, match, req.user!.id);
        res.status(409).json({
          error: "vehicle_already_registered",
          matchedOn: match.kind,
          claimToken: token,
        });
        return;
      }
    }

    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(req.params.id);
      // Authorised above; an org vehicle's row is not keyed by the caller.
      db.prepare(`UPDATE bike SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM bike WHERE id = ?").get(req.params.id) as BikeRow;
    if (touchesIdentity) {
      // Refresh the registry from the row that was actually written. Identities
      // are added and replaced, never dropped: clearing the chassis field must
      // not release the VIN to whoever types it next, or the uniqueness rule
      // would survive only as long as nobody edited anything.
      registerIdentities(db, row.id, { chassisNo: row.chassis_no, engineNo: row.engine_no });
    }
    res.json(rowToBike(row, groupsOf(req.user!.id, row.id, db)));
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
    const facts = authorizeBike(req, res, req.params.id!, "manage", VEHICLE_FACT);
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
    res.status(201).json(rowToBike(row, groupsOf(req.user!.id, row.id, db)));
  }),
);

bikesRouter.get(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    if (!authorizeBike(req, res, req.params.id!, "read", VEHICLE_FACT)) return;
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
    if (!authorizeBike(req, res, req.params.id!, "manage", VEHICLE_FACT)) return;
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
    if (!authorizeBike(req, res, req.params.id!, "delete", VEHICLE_FACT)) return;
    getDb()
      .prepare("UPDATE bike SET archived = 1, updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
    res.status(204).end();
  }),
);
