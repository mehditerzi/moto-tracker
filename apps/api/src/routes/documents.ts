import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { config } from "../config.js";
import { enqueueDocument } from "../ocr/worker.js";
import { authorizeBike, authorizeRecord, bikeScope } from "../lib/orgAccess.js";
import { ApiCodeError } from "../middleware/errorHandler.js";

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
    if (cnt >= 20) {
      res.status(429).json({ error: "service_unavailable" });
      return;
    }

    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
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
    // account must not take the company's documents with them.
    const dir = facts?.orgId
      ? path.join(config.UPLOADS_DIR, "org", facts.orgId)
      : path.join(config.UPLOADS_DIR, req.user!.id);
    await fs.mkdir(dir, { recursive: true });
    const outPath = path.join(dir, `${id}.jpg`);

    const buf = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .grayscale()
      .jpeg({ quality: 80 })
      .toBuffer();

    await fs.writeFile(outPath, buf);
    db.prepare(
      `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, ocr_status)
       VALUES (?, ?, ?, ?, 'image/jpeg', ?, 'pending')`,
    ).run(id, req.user!.id, bikeId, outPath, buf.length);

    void enqueueDocument(id, req.user!.id);

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
