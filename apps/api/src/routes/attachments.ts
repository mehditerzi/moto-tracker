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
import { ApiCodeError } from "../middleware/errorHandler.js";
import { attachmentMetaSchema, attachmentUpdateSchema, type Attachment } from "@mototracker/shared";
import { canAttachRecord, canReadPersonalLayer } from "../lib/orgAccess.js";
import { attachmentAllowance, countAttachments } from "../lib/entitlement.js";

/**
 * The digital glovebox: photos and PDFs filed against a vehicle — licence,
 * registration, invoices, service slips, warranties.
 *
 * Not the OCR pipeline. A scan in `document` is shrunk to a 1024px greyscale
 * JPEG because that is what reads best, which is exactly wrong for "show the
 * policeman my licence". Glovebox files keep colour and resolution.
 *
 * Files live under UPLOADS_DIR/<userId>/attachments, so DELETE /api/me — which
 * removes UPLOADS_DIR/<userId> wholesale — takes them with the account.
 */
export const attachmentsRouter: Router = Router();
attachmentsRouter.use(requireUser);

const MAX_BYTES = 15 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(file.mimetype)) {
      cb(new ApiCodeError("unsupported_media_type", 415));
      return;
    }
    cb(null, true);
  },
});

interface AttachmentRow {
  id: string;
  user_id: string;
  bike_id: string | null;
  kind: Attachment["kind"];
  title: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  expires_on: string | null;
  created_at: string;
}

function rowToAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    bikeId: r.bike_id,
    kind: r.kind,
    title: r.title,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    expiresOn: r.expires_on,
    createdAt: r.created_at,
  };
}

/** Own rows only: a glovebox is personal even when the car is shared. */
function ownRow(id: string, userId: string): AttachmentRow | undefined {
  return getDb().prepare("SELECT * FROM attachment WHERE id = ? AND user_id = ?").get(id, userId) as
    | AttachmentRow
    | undefined;
}

attachmentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bikeId = typeof req.query.bikeId === "string" ? req.query.bikeId : null;
    if (bikeId && !canReadPersonalLayer(req.user!.id, bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const rows = (
      bikeId
        ? db
            .prepare(
              // Files filed against this car, plus the ones filed against no car
              // at all (a driving licence belongs to the person).
              "SELECT * FROM attachment WHERE user_id = ? AND (bike_id = ? OR bike_id IS NULL) ORDER BY created_at DESC",
            )
            .all(req.user!.id, bikeId)
        : db.prepare("SELECT * FROM attachment WHERE user_id = ? ORDER BY created_at DESC").all(req.user!.id)
    ) as AttachmentRow[];
    res.json(rows.map(rowToAttachment));
  }),
);

attachmentsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const meta = attachmentMetaSchema.parse({
      bikeId: req.body.bikeId || null,
      kind: req.body.kind || undefined,
      title: req.body.title,
      expiresOn: req.body.expiresOn || null,
    });
    const db = getDb();
    const userId = req.user!.id;
    if (meta.bikeId && !canAttachRecord(userId, meta.bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const allowance = attachmentAllowance(userId, db);
    if (allowance !== null && countAttachments(userId, db) >= allowance) {
      res.status(402).json({ error: "attachment_limit_reached", limit: allowance });
      return;
    }

    const id = newId();
    const dir = path.join(config.UPLOADS_DIR, userId, "attachments");
    await fs.mkdir(dir, { recursive: true });

    let buf: Buffer;
    let mime: string;
    let ext: string;
    if (req.file.mimetype === "application/pdf") {
      // The mimetype is the client's claim; the magic bytes are the file's.
      if (req.file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
        res.status(415).json({ error: "unsupported_media_type" });
        return;
      }
      buf = req.file.buffer;
      mime = "application/pdf";
      ext = "pdf";
    } else {
      // Re-encoding also drops EXIF — including the GPS position a phone
      // writes into every photo, which has no business sitting next to a
      // licence plate in a file somebody might later share.
      buf = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      mime = "image/jpeg";
      ext = "jpg";
    }
    const filePath = path.join(dir, `${id}.${ext}`);
    await fs.writeFile(filePath, buf);
    db.prepare(
      `INSERT INTO attachment (id, user_id, bike_id, kind, title, file_path, mime_type, size_bytes, expires_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, meta.bikeId ?? null, meta.kind, meta.title, filePath, mime, buf.length, meta.expiresOn ?? null);
    res.status(201).json(rowToAttachment(ownRow(id, userId)!));
  }),
);

attachmentsRouter.get(
  "/:id/file",
  asyncHandler(async (req, res) => {
    const row = ownRow(req.params.id!, req.user!.id);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Cache-Control", "private, max-age=300, immutable");
    // inline: open in the viewer, not as a download.
    res.setHeader("Content-Disposition", `inline; filename="${row.id}.${row.mime_type === "application/pdf" ? "pdf" : "jpg"}"`);
    res.sendFile(path.resolve(row.file_path));
  }),
);

attachmentsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = attachmentUpdateSchema.parse(req.body);
    const row = ownRow(req.params.id!, req.user!.id);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const db = getDb();
    db.prepare("UPDATE attachment SET kind = ?, title = ?, expires_on = ? WHERE id = ?").run(
      body.kind ?? row.kind,
      body.title ?? row.title,
      body.expiresOn === undefined ? row.expires_on : body.expiresOn,
      row.id,
    );
    res.json(rowToAttachment(ownRow(row.id, req.user!.id)!));
  }),
);

attachmentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = ownRow(req.params.id!, req.user!.id);
    if (row) {
      getDb().prepare("DELETE FROM attachment WHERE id = ?").run(row.id);
      await fs.rm(path.resolve(row.file_path), { force: true }).catch(() => {});
    }
    res.status(204).end();
  }),
);
