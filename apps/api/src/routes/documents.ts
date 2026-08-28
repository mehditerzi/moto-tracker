import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { config } from "../config.js";
import { enqueueDocument } from "../ocr/worker.js";
import {
  authorizeBike,
  authorizeRecord,
  bikeScope,
  canAccessBike,
  roleInOrg,
} from "../lib/orgAccess.js";
import {
  countActiveBikes,
  countActiveOrgBikes,
  getMaxVehicles,
  getOrgMaxVehicles,
} from "../lib/entitlement.js";
import { inferVehicleType } from "../ocr/catalog.js";
import { suggestBikeForScan } from "../ocr/autoApply.js";
import type { ParsedOcr } from "../ocr/parser.js";
import { reviewDecisionSchema, type ReviewDecision } from "@mototracker/shared";
import { ApiCodeError } from "../middleware/errorHandler.js";

/**
 * Upload ceilings.
 *
 * `perDay` was 20, which is exactly the size of the stack a fleet manager sits
 * down with — one onboarding session and the second half of the pile is refused
 * until tomorrow, with a message that reads like a fault. Bulk capture makes 20
 * a normal afternoon rather than an abusive one, so the day allowance is 60 and
 * the real protection moved to where the cost actually is:
 *
 *   • `perBatch` bounds one sitting (and therefore one review pass — nobody
 *     reviews sixty documents in one go, and a batch that large is a UI you
 *     abandon halfway through).
 *   • The OCR scheduler (ocr/worker.ts) bounds the machine: a batch runs at
 *     BULK priority behind every interactive scan, one document at a time per
 *     user, inside a global cap of OCR_CONCURRENCY. Sixty documents therefore
 *     cost the box exactly what two do; they only take longer.
 *   • `MAX_CONCURRENT_ENCODES` bounds memory: multer holds each upload in RAM
 *     and sharp decodes it, so twenty simultaneous 10 MB uploads is the one way
 *     bulk capture could genuinely hurt the process.
 *
 * Exported so tests can lower them instead of uploading sixty JPEGs.
 */
export const documentLimits = { perDay: 60, perBatch: 25 };

/**
 * Admission control around sharp. An upload is a 10 MB buffer in memory plus a
 * decoded bitmap several times that; the client uploads a batch a few at a time
 * but nothing stops two clients doing so at once. Encoding is serialised to a
 * small number of concurrent jobs — waiting a moment is invisible next to the
 * OCR that follows, and the ceiling turns "twenty uploads land together" from
 * an out-of-memory risk into a queue.
 */
const MAX_CONCURRENT_ENCODES = 3;
let activeEncodes = 0;
const encodeWaiters: Array<() => void> = [];

async function withEncodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeEncodes >= MAX_CONCURRENT_ENCODES) {
    await new Promise<void>((resolve) => encodeWaiters.push(resolve));
  }
  activeEncodes++;
  try {
    return await fn();
  } finally {
    activeEncodes--;
    encodeWaiters.shift()?.();
  }
}

interface DocRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  doc_type: string | null;
  ocr_raw_json: string | null;
  ocr_extracted_json: string | null;
  ocr_status: "pending" | "done" | "failed";
  ocr_model: string | null;
  ocr_error: string | null;
  applied_dated_item_id: string | null;
  applied_fuel_log_id: string | null;
  batch_id: string | null;
  batch_seq: number | null;
  review_state: "pending" | "confirmed" | "skipped" | "applied";
  review_decision_json: string | null;
  suggested_bike_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDocument(r: DocRow) {
  return {
    id: r.id,
    userId: r.user_id,
    bikeId: r.bike_id,
    filePath: r.file_path,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    docType: r.doc_type as
      | "ruhsat"
      | "sigorta"
      | "kasko"
      | "muayene"
      | "yakit"
      | "unknown"
      | null,
    ocrExtracted: r.ocr_extracted_json ? JSON.parse(r.ocr_extracted_json) : null,
    ocrStatus: r.ocr_status,
    ocrModel: r.ocr_model,
    ocrError: r.ocr_error,
    appliedDatedItemId: r.applied_dated_item_id,
    appliedFuelLogId: r.applied_fuel_log_id,
    batchId: r.batch_id,
    batchSeq: r.batch_seq,
    reviewState: r.review_state,
    reviewDecision: r.review_decision_json
      ? (JSON.parse(r.review_decision_json) as ReviewDecision)
      : null,
    suggestedBikeId: r.suggested_bike_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const upload = multer({
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

export const documentsRouter: Router = Router();
documentsRouter.use(requireUser);

/** The row shape `authorizeRecord` needs: which vehicle, and who uploaded it. */
function recordOf(r: { bike_id: string | null; user_id: string }) {
  return { bikeId: r.bike_id, userId: r.user_id };
}

// ═══ bulk capture: batches ════════════════════════════════════════════════════
//
// Everything below is registered BEFORE `GET /:id`, because `/batches` is a
// single path segment and would otherwise be read as a document id.

interface BatchRow {
  id: string;
  user_id: string;
  org_id: string | null;
  status: "open" | "applied" | "discarded";
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProgressRow {
  total: number;
  pending: number;
  done: number;
  failed: number;
  decided: number;
}

function batchProgress(db: ReturnType<typeof getDb>, batchId: string): ProgressRow {
  return db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(ocr_status = 'pending') AS pending,
              SUM(ocr_status = 'done')    AS done,
              SUM(ocr_status = 'failed')  AS failed,
              SUM(review_state IN ('confirmed','skipped','applied')) AS decided
         FROM document WHERE batch_id = ?`,
    )
    .get(batchId) as ProgressRow;
}

function rowToBatch(db: ReturnType<typeof getDb>, r: BatchRow) {
  const p = batchProgress(db, r.id);
  return {
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id,
    status: r.status,
    appliedAt: r.applied_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // SUM() over zero rows is NULL in sqlite, not 0.
    progress: {
      total: p.total ?? 0,
      pending: p.pending ?? 0,
      done: p.done ?? 0,
      failed: p.failed ?? 0,
      decided: p.decided ?? 0,
    },
  };
}

/**
 * Load a batch the caller owns, or answer 404 and return null.
 *
 * A batch belongs to the person who shot it, full stop — even an org batch. It
 * is a private work-in-progress: half-reviewed scans with unconfirmed OCR are
 * not fleet records yet, and letting a colleague apply someone else's
 * half-checked pile is exactly the accident bulk capture must not enable. The
 * vehicles it creates are org-visible the moment it is applied.
 */
function loadOwnBatch(
  db: ReturnType<typeof getDb>,
  userId: string,
  batchId: string,
): BatchRow | null {
  const row = db.prepare("SELECT * FROM document_batch WHERE id = ?").get(batchId) as
    | BatchRow
    | undefined;
  if (!row || row.user_id !== userId) return null;
  return row;
}

const batchCreateSchema = z.object({ orgId: z.string().min(1).nullish() });

// POST /api/documents/batches → start a capture session.
documentsRouter.post(
  "/batches",
  asyncHandler(async (req, res) => {
    const { orgId } = batchCreateSchema.parse(req.body ?? {});
    const db = getDb();
    if (orgId) {
      // The batch's whole purpose is creating vehicles, and adding a vehicle
      // grows an org's bill — so the same gate as POST /api/bikes: owners and
      // managers size the fleet, staff and drivers run it. A non-member gets
      // 404; the existence of an organization is not public information.
      const role = roleInOrg(req.user!.id, orgId, db);
      if (role === null) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (role !== "owner" && role !== "manager") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    }
    const id = newId();
    db.prepare("INSERT INTO document_batch (id, user_id, org_id) VALUES (?, ?, ?)").run(
      id,
      req.user!.id,
      orgId ?? null,
    );
    const row = db.prepare("SELECT * FROM document_batch WHERE id = ?").get(id) as BatchRow;
    res.status(201).json(rowToBatch(db, row));
  }),
);

// GET /api/documents/batches → the caller's unfinished batches, newest first.
// This is the resume path: the worker keeps reading after the app is closed, so
// coming back must land on the pile rather than an empty camera.
documentsRouter.get(
  "/batches",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT * FROM document_batch WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 20",
      )
      .all(req.user!.id) as BatchRow[];
    // A batch nobody ever photographed into is noise on the resume prompt.
    res.json(rows.map((r) => rowToBatch(db, r)).filter((b) => b.progress.total > 0));
  }),
);

// GET /api/documents/batches/:id → the batch and its documents, in capture order.
documentsRouter.get(
  "/batches/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const batch = loadOwnBatch(db, req.user!.id, req.params.id!);
    if (!batch) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const docs = db
      .prepare("SELECT * FROM document WHERE batch_id = ? ORDER BY batch_seq ASC, created_at ASC")
      .all(batch.id) as DocRow[];

    // Recompute the create-vs-update proposal now rather than trusting what OCR
    // wrote: applying an earlier batch (or hand-adding the vehicle in another
    // tab) changes the right answer, and a review screen that offers to create
    // a vehicle you already have is how duplicates get made.
    res.json({
      batch: rowToBatch(db, batch),
      documents: docs.map((d) => {
        const doc = rowToDocument(d);
        if (d.ocr_status !== "done" || !d.ocr_extracted_json)
          return { ...doc, suggestion: "none" as const };
        // ocr_extracted_json is the validated ParsedOcr plus two derived fields,
        // so it is the corrected view — re-parsing the raw model output here
        // would undo the chassis/engine swap and the catalog canonicalisation.
        const s = suggestBikeForScan(
          db,
          batch.user_id,
          batch.org_id,
          JSON.parse(d.ocr_extracted_json) as ParsedOcr,
        );
        return {
          ...doc,
          suggestion: s.kind,
          suggestedBikeId: s.kind === "update" || s.kind === "org_conflict" ? s.bikeId : null,
        };
      }),
    });
  }),
);

// DELETE /api/documents/batches/:id → throw the whole pile away.
// The images carry personal data (TC kimlik, address) so they go with it; the
// row survives as 'discarded' so an OCR job still in flight has somewhere to
// land instead of crashing on a missing parent.
documentsRouter.delete(
  "/batches/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const batch = loadOwnBatch(db, req.user!.id, req.params.id!);
    if (!batch) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (batch.status === "applied") {
      // Applied vehicles are real records now; deleting the scans behind them is
      // per-document, so the provenance link is cleared deliberately each time.
      res.status(409).json({ error: "batch_already_applied" });
      return;
    }
    const docs = db
      .prepare("SELECT id, file_path FROM document WHERE batch_id = ?")
      .all(batch.id) as { id: string; file_path: string }[];
    db.transaction(() => {
      db.prepare(
        "UPDATE dated_item SET source_document_id = NULL WHERE source_document_id IN (SELECT id FROM document WHERE batch_id = ?)",
      ).run(batch.id);
      db.prepare("DELETE FROM document WHERE batch_id = ?").run(batch.id);
      db.prepare(
        "UPDATE document_batch SET status = 'discarded', updated_at = datetime('now') WHERE id = ?",
      ).run(batch.id);
    })();
    await Promise.all(
      docs.map((d) => fs.rm(path.resolve(d.file_path), { force: true }).catch(() => {})),
    );
    res.status(204).end();
  }),
);

// ─── applying a batch ─────────────────────────────────────────────────────────

interface PlannedCreate {
  documentId: string;
  decision: ReviewDecision;
}
interface PlannedUpdate {
  documentId: string;
  bikeId: string;
  decision: ReviewDecision;
}

/** "12,5" / "" / "abc" → a number or null. Decisions arrive as text fields. */
function numOrNull(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function strOrNull(v: string | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

function normPlate(v: string | null | undefined): string | null {
  if (!v) return null;
  const p = v.replace(/\s+/g, "").toUpperCase();
  return p.length > 0 ? p : null;
}

/**
 * POST /api/documents/batches/:id/apply — commit every confirmed decision.
 *
 * One transaction, one terminal state. The batch flips to 'applied' inside the
 * same transaction as the writes, so a second request (a double tap, a retry
 * after a flaky response, the same link opened twice) can only ever see
 * 'applied' and is refused with 409 — the alternative is a fleet manager who
 * taps twice and owns forty vehicles.
 *
 * Everything that could fail is checked BEFORE anything is written: the vehicle
 * ceiling for the whole batch at once, and write permission on every update
 * target. A batch that would half-apply and then stop is worse than one that
 * refuses and says why.
 */
documentsRouter.post(
  "/batches/:id/apply",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const userId = req.user!.id;
    const batch = loadOwnBatch(db, userId, req.params.id!);
    if (!batch) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (batch.status !== "open") {
      res.status(409).json({
        error: batch.status === "applied" ? "batch_already_applied" : "batch_discarded",
      });
      return;
    }

    const docs = db
      .prepare(
        "SELECT * FROM document WHERE batch_id = ? AND review_state = 'confirmed' ORDER BY batch_seq ASC, created_at ASC",
      )
      .all(batch.id) as DocRow[];

    const creates: PlannedCreate[] = [];
    const updates: PlannedUpdate[] = [];
    /** Normalised plate → the create that claimed it, for in-batch de-duping. */
    const claimedPlates = new Map<string, PlannedCreate>();
    /** Documents that are a second photo of a vehicle this batch is creating. */
    const mergedIntoCreate: Array<{ documentId: string; into: PlannedCreate }> = [];

    for (const d of docs) {
      const decision = d.review_decision_json
        ? (JSON.parse(d.review_decision_json) as ReviewDecision)
        : null;
      if (!decision || decision.action === "skip") continue;

      if (decision.action === "update") {
        const bikeId = decision.targetBikeId;
        if (!bikeId) continue;
        updates.push({ documentId: d.id, bikeId, decision });
        continue;
      }

      // Two shots of the same ruhsat — front and back, or a shaky first
      // attempt — are one vehicle, not two. The first claim creates; the rest
      // fold into it, so their dates and any field the first shot missed still
      // land, and the plate does not appear twice in the garage.
      const plate = normPlate(decision.fields.plate);
      const planned: PlannedCreate = { documentId: d.id, decision };
      if (plate && claimedPlates.has(plate)) {
        mergedIntoCreate.push({ documentId: d.id, into: claimedPlates.get(plate)! });
        continue;
      }
      if (plate) claimedPlates.set(plate, planned);
      creates.push(planned);
    }

    // ── pre-flight 1: may we write every update target? ──────────────────────
    // "manage", not "write": these decisions change plate/make/model on the
    // vehicle record itself, which a driver may never do to a company van.
    const forbidden = updates
      .filter((u) => !canAccessBike(userId, u.bikeId, "manage", db))
      .map((u) => u.documentId);
    if (forbidden.length > 0) {
      res.status(403).json({ error: "forbidden", documentIds: forbidden });
      return;
    }

    // ── pre-flight 2: does the whole batch fit under the ceiling? ────────────
    // Checked as a total, not one at a time: a batch that creates six of eight
    // vehicles and then stops leaves the user with no idea which two are
    // missing, and no way to retry (the batch is spent).
    if (creates.length > 0) {
      const used = batch.org_id ? countActiveOrgBikes(batch.org_id, db) : countActiveBikes(userId, db);
      const max = batch.org_id ? getOrgMaxVehicles(batch.org_id, db) : getMaxVehicles(userId, db);
      if (used + creates.length > max) {
        res.status(403).json({
          error: "vehicle_limit_reached",
          // Enough for the UI to say "room for 2 of these 6" rather than a bare
          // refusal — the user can then skip the ones they care about least.
          needed: creates.length,
          available: Math.max(0, max - used),
        });
        return;
      }
    }

    const createdBikeIds: string[] = [];
    const bikeForDocument = new Map<string, string>();
    let datedItemCount = 0;

    const addDates = (documentId: string, bikeId: string, decision: ReviewDecision) => {
      for (const type of ["muayene", "sigorta", "kasko"] as const) {
        const expiresOn = strOrNull(decision.dates[type]);
        if (!expiresOn) continue;
        // A confirmed date is a date a human read off the document and agreed
        // with, so needs_review is 0 — unlike the auto-applied path, where
        // nobody has seen it yet.
        db.prepare(
          `INSERT INTO dated_item (id, bike_id, user_id, type, expires_on, source_document_id, needs_review)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
        ).run(newId(), bikeId, userId, type, expiresOn, documentId);
        datedItemCount += 1;
      }
    };

    const commit = db.transaction(() => {
      for (const c of creates) {
        const f = c.decision.fields;
        const make = strOrNull(f.make);
        const model = strOrNull(f.model);
        const id = newId();
        db.prepare(
          `INSERT INTO bike (id, user_id, org_id, vehicle_type, nickname, plate, make, model, year,
                             first_registration_date, color, chassis_no, engine_no, cylinder_cc, fuel_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          userId,
          batch.org_id,
          inferVehicleType(make, model) ?? "motorcycle",
          strOrNull(c.decision.nickname) ??
            ([make, model].filter(Boolean).join(" ") || strOrNull(f.plate) || "Araç"),
          strOrNull(f.plate),
          make,
          model,
          numOrNull(f.year),
          strOrNull(f.firstRegistrationDate),
          strOrNull(f.color),
          strOrNull(f.chassisNo),
          strOrNull(f.engineNo),
          numOrNull(f.cylinderCc),
          strOrNull(f.fuelType),
        );
        createdBikeIds.push(id);
        bikeForDocument.set(c.documentId, id);
        addDates(c.documentId, id, c.decision);
      }

      // A merged duplicate contributes its dates and fills any blank the first
      // shot left, then points at the same vehicle.
      for (const m of mergedIntoCreate) {
        const bikeId = bikeForDocument.get(m.into.documentId);
        if (!bikeId) continue;
        bikeForDocument.set(m.documentId, bikeId);
      }

      for (const u of updates) {
        const f = u.decision.fields;
        const cols: Array<[string, string | number | null]> = [
          ["plate", strOrNull(f.plate)],
          ["make", strOrNull(f.make)],
          ["model", strOrNull(f.model)],
          ["year", numOrNull(f.year)],
          ["first_registration_date", strOrNull(f.firstRegistrationDate)],
          ["color", strOrNull(f.color)],
          ["chassis_no", strOrNull(f.chassisNo)],
          ["engine_no", strOrNull(f.engineNo)],
          ["cylinder_cc", numOrNull(f.cylinderCc)],
          ["fuel_type", strOrNull(f.fuelType)],
        ];
        // Only what the user left filled in. A blank means "I did not decide
        // this", never "erase what the vehicle already has" — the review screen
        // seeds every field from the vehicle, so a cleared field is far more
        // likely a mis-tap than an intention to delete a chassis number.
        const set = cols.filter(([, v]) => v !== null);
        if (set.length > 0) {
          db.prepare(
            `UPDATE bike SET ${set.map(([c]) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
          ).run(...set.map(([, v]) => v), u.bikeId);
        }
        bikeForDocument.set(u.documentId, u.bikeId);
        addDates(u.documentId, u.bikeId, u.decision);
      }

      for (const [documentId, bikeId] of bikeForDocument) {
        db.prepare(
          "UPDATE document SET bike_id = ?, review_state = 'applied', updated_at = datetime('now') WHERE id = ?",
        ).run(bikeId, documentId);
      }
      db.prepare(
        "UPDATE document_batch SET status = 'applied', applied_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'open'",
      ).run(batch.id);
    });
    commit();

    res.json({
      batchId: batch.id,
      created: createdBikeIds.length,
      updated: updates.length,
      merged: mergedIntoCreate.length,
      datedItems: datedItemCount,
      bikeIds: createdBikeIds,
    });
  }),
);

// GET /api/documents?bikeId=… → a vehicle's scanned documents (the wallet).
//
// A document attached to a vehicle is visible to whoever can read that vehicle
// (so a fleet's insurance scans are not trapped behind the driver who took the
// photo); a document uploaded with NO vehicle is purely personal and stays with
// its uploader. `bikeId` is client-supplied and therefore authorised.
documentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    const opts = { db, notFoundCode: "bike_not_found" };
    if (bikeId && !authorizeBike(req, res, bikeId, "read", opts)) return;
    const scope = bikeScope(req.user!.id, db);
    const rows = (
      bikeId
        ? db
            .prepare("SELECT * FROM document WHERE bike_id = ? ORDER BY created_at DESC LIMIT 100")
            .all(bikeId)
        : db
            .prepare(
              `SELECT * FROM document
                WHERE bike_id IN (${scope.sql})
                   OR (bike_id IS NULL AND user_id = ?)
                ORDER BY created_at DESC LIMIT 100`,
            )
            .all(...scope.params, req.user!.id)
    ) as DocRow[];
    res.json(rows.map(rowToDocument));
  }),
);

documentsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "file_required" });
      return;
    }

    // Silent per-user daily cap — do not surface limit details to the client.
    const db = getDb();
    const { cnt } = db
      .prepare("SELECT COUNT(*) AS cnt FROM document WHERE user_id = ? AND date(created_at) = date('now')")
      .get(req.user!.id) as { cnt: number };
    if (cnt >= documentLimits.perDay) {
      res.status(429).json({ error: "service_unavailable" });
      return;
    }

    // A batch upload names its session. The batch decides the target garage, so
    // there is no bikeId on this path — the vehicles do not exist yet.
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : null;
    let batch: BatchRow | null = null;
    let seq: number | null = null;
    if (batchId) {
      batch = loadOwnBatch(db, req.user!.id, batchId);
      if (!batch) {
        res.status(404).json({ error: "batch_not_found" });
        return;
      }
      if (batch.status !== "open") {
        res.status(409).json({ error: "batch_already_applied" });
        return;
      }
      const { n } = db
        .prepare("SELECT COUNT(*) AS n FROM document WHERE batch_id = ?")
        .get(batch.id) as { n: number };
      if (n >= documentLimits.perBatch) {
        // Named, not silent: unlike the daily cap this is a shape-of-the-task
        // limit the user can act on — finish this pile, then start another.
        res.status(409).json({ error: "batch_full", limit: documentLimits.perBatch });
        return;
      }
      seq = n;
    }

    const bikeId = !batchId && typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    // Attaching a scan to a vehicle is a day-to-day act, so "write": the driver
    // holding a van may photograph its insurance; a driver who is not holding it
    // cannot even name it.
    const facts = bikeId
      ? authorizeBike(req, res, bikeId, "write", { db, notFoundCode: "bike_not_found" })
      : null;
    if (bikeId && !facts) return;

    const id = newId();
    // Org scans go under org/<orgId>, NOT the uploader's directory: DELETE
    // /api/me removes UPLOADS_DIR/<userId> wholesale, and a member closing their
    // account must not take the company's documents with them. A batch aimed at
    // an org is org scanning before the vehicle exists, so it lands there too.
    const orgId = facts?.orgId ?? batch?.org_id ?? null;
    const dir = orgId
      ? path.join(config.UPLOADS_DIR, "org", orgId)
      : path.join(config.UPLOADS_DIR, req.user!.id);
    await fs.mkdir(dir, { recursive: true });
    const outPath = path.join(dir, `${id}.jpg`);

    const buf = await withEncodeSlot(() =>
      sharp(req.file!.buffer)
        .rotate()
        .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
        .grayscale()
        .jpeg({ quality: 80 })
        .toBuffer(),
    );

    await fs.writeFile(outPath, buf);
    db.prepare(
      `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, ocr_status, batch_id, batch_seq)
       VALUES (?, ?, ?, ?, 'image/jpeg', ?, 'pending', ?, ?)`,
    ).run(id, req.user!.id, bikeId, outPath, buf.length, batch?.id ?? null, seq);

    // Bulk work yields to anyone watching a spinner — see ocr/worker.ts.
    void enqueueDocument(id, req.user!.id, { priority: batch ? "bulk" : "interactive" });

    const row = db.prepare("SELECT * FROM document WHERE id = ?").get(id) as DocRow;
    res.status(201).json(rowToDocument(row));
  }),
);

documentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM document WHERE id = ?").get(req.params.id) as
      | DocRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(row), "read", { db })) return;
    res.json(rowToDocument(row));
  }),
);

documentsRouter.get(
  "/:id/file",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT id, user_id, bike_id, file_path, mime_type FROM document WHERE id = ?")
      .get(req.params.id) as
      | { id: string; user_id: string; bike_id: string | null; file_path: string; mime_type: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(row), "read", { db })) return;
    res.setHeader("Content-Type", row.mime_type);
    // The image at a given id never changes, so it's safe to cache hard.
    res.setHeader("Cache-Control", "private, max-age=300, immutable");
    res.sendFile(path.resolve(row.file_path));
  }),
);

// ─── one document's place in the review pass ─────────────────────────────────

const decisionBodySchema = z.object({
  /**
   * pending is a real choice, not a no-op: it is "put this back on the pile",
   * the undo for a confirm the user changed their mind about.
   */
  state: z.enum(["pending", "confirmed", "skipped"]),
  decision: reviewDecisionSchema.optional(),
});

/**
 * PATCH /api/documents/:id/decision — record what the user decided about one
 * scan, without applying it.
 *
 * Saved on every confirm rather than accumulated in the browser, because the
 * review pass is explicitly resumable: a batch half-checked on a phone that
 * then rang, or an app the OS evicted, must not cost the eleven documents
 * already looked at.
 */
documentsRouter.patch(
  "/:id/decision",
  asyncHandler(async (req, res) => {
    const body = decisionBodySchema.parse(req.body ?? {});
    const db = getDb();
    const row = db.prepare("SELECT * FROM document WHERE id = ?").get(req.params.id) as
      | DocRow
      | undefined;
    if (!row || row.user_id !== req.user!.id) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!row.batch_id) {
      res.status(400).json({ error: "not_in_batch" });
      return;
    }
    const batch = loadOwnBatch(db, req.user!.id, row.batch_id);
    if (!batch) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (batch.status !== "open") {
      res.status(409).json({ error: "batch_already_applied" });
      return;
    }

    const decision = body.state === "confirmed" ? body.decision : (body.decision ?? null);
    if (body.state === "confirmed" && !decision) {
      res.status(400).json({ error: "decision_required" });
      return;
    }
    if (decision?.action === "update") {
      // The target must be a vehicle the caller may actually change, and it must
      // live in the batch's garage: a personal batch may not reach into a fleet,
      // and a fleet batch may not quietly patch the manager's own motorcycle.
      const target = decision.targetBikeId;
      const inGarage =
        !!target &&
        !!db
          .prepare(
            batch.org_id
              ? "SELECT 1 FROM bike WHERE id = ? AND org_id = ?"
              : "SELECT 1 FROM bike WHERE id = ? AND org_id IS NULL AND user_id = ?",
          )
          .get(target, batch.org_id ?? req.user!.id);
      if (!inGarage || !canAccessBike(req.user!.id, target!, "manage", db)) {
        res.status(404).json({ error: "bike_not_found" });
        return;
      }
    }

    db.prepare(
      "UPDATE document SET review_state = ?, review_decision_json = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(body.state, decision ? JSON.stringify(decision) : null, row.id);
    const updated = db.prepare("SELECT * FROM document WHERE id = ?").get(row.id) as DocRow;
    res.json(rowToDocument(updated));
  }),
);

/**
 * POST /api/documents/:id/rescan — read this one again.
 *
 * The escape from every dead end on the review screen that isn't the user's
 * fault: an OCR failure, a timeout under load, a result so garbled it is
 * obviously wrong. It re-queues the image already on disk, so it costs no
 * upload and does not touch the daily allowance — the photo was already paid
 * for, and charging twice for our own bad read would be indefensible.
 */
documentsRouter.post(
  "/:id/rescan",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM document WHERE id = ?").get(req.params.id) as
      | DocRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(row), "write", { db })) return;
    if (row.ocr_status === "pending") {
      // Already in the queue; re-queuing would run the same image twice.
      res.json(rowToDocument(row));
      return;
    }
    if (row.review_state === "applied") {
      res.status(409).json({ error: "already_applied" });
      return;
    }
    db.prepare(
      `UPDATE document
          SET ocr_status = 'pending', ocr_error = NULL, review_state = 'pending',
              review_decision_json = NULL, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(row.id);
    void enqueueDocument(row.id, row.user_id, {
      // A retry is someone waiting and looking at it, even inside a batch.
      priority: "interactive",
    });
    const updated = db.prepare("SELECT * FROM document WHERE id = ?").get(row.id) as DocRow;
    res.json(rowToDocument(updated));
  }),
);

// Delete a scanned document and its stored image. Scanned ruhsat/sigorta photos
// carry personal data (TC kimlik, address), so users need a way to remove them.
// Any dated_item already created from the scan is kept; we just null its link.
documentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT id, user_id, bike_id, file_path FROM document WHERE id = ?")
      .get(req.params.id) as
      | { id: string; user_id: string; bike_id: string | null; file_path: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(row), "write", { db })) return;
    // Drop the provenance link first so the FK ON DELETE SET NULL isn't relied on
    // across SQLite configs, then remove the row and the file. The link is
    // cleared by document id alone: on an org vehicle the dated item may have
    // been recorded by a different member than the one deleting the scan.
    db.prepare("UPDATE dated_item SET source_document_id = NULL WHERE source_document_id = ?").run(row.id);
    db.prepare("DELETE FROM document WHERE id = ?").run(row.id);
    await fs.rm(path.resolve(row.file_path), { force: true }).catch(() => {});
    res.status(204).end();
  }),
);
