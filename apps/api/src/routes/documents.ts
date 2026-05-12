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
      | "unknown"
      | null,
    ocrExtracted: r.ocr_extracted_json ? JSON.parse(r.ocr_extracted_json) : null,
    ocrStatus: r.ocr_status,
    ocrModel: r.ocr_model,
    ocrError: r.ocr_error,
    appliedDatedItemId: r.applied_dated_item_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const upload = multer({
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

export const documentsRouter: Router = Router();
documentsRouter.use(requireUser);

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
    if (bikeId) {
      const exists = db
        .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
        .get(bikeId, req.user!.id);
      if (!exists) {
        res.status(404).json({ error: "bike_not_found" });
        return;
      }
    }

    const id = newId();
    const userDir = path.join(config.UPLOADS_DIR, req.user!.id);
    await fs.mkdir(userDir, { recursive: true });
    const outPath = path.join(userDir, `${id}.jpg`);

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

    void enqueueDocument(id);

    const row = db.prepare("SELECT * FROM document WHERE id = ?").get(id) as DocRow;
    res.status(201).json(rowToDocument(row));
  }),
);

documentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM document WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as DocRow | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToDocument(row));
  }),
);

documentsRouter.get(
  "/:id/file",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT id, user_id, file_path, mime_type FROM document WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as
      | { id: string; user_id: string; file_path: string; mime_type: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(path.resolve(row.file_path));
  }),
);
