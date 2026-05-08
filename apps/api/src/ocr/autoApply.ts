import type Database from "better-sqlite3";
import { newId } from "../lib/ulid.js";
import type { ParsedOcr } from "./parser.js";

export interface AutoApplyInput {
  db: Database.Database;
  userId: string;
  documentId: string;
  bikeIdHint: string | null;
  parsed: ParsedOcr;
  threshold: number;
}

export interface AutoApplyOutput {
  appliedDatedItemId: string | null;
  reason:
    | "applied"
    | "low_confidence"
    | "doc_type_not_dated"
    | "no_matching_date"
    | "no_bike_match";
}

interface BikeRow {
  id: string;
  plate: string | null;
}

function normalizePlate(p: string | null | undefined): string | null {
  if (!p) return null;
  return p.replace(/\s+/g, "").toUpperCase();
}

function pickBikeId(
  db: Database.Database,
  userId: string,
  bikeIdHint: string | null,
  plate: string | null,
): string | null {
  if (bikeIdHint) {
    const r = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ? AND archived = 0")
      .get(bikeIdHint, userId) as { id: string } | undefined;
    if (r) return r.id;
  }
  const np = normalizePlate(plate);
  if (np) {
    const rows = db
      .prepare("SELECT id, plate FROM bike WHERE user_id = ? AND archived = 0")
      .all(userId) as BikeRow[];
    for (const b of rows) {
      if (normalizePlate(b.plate) === np) return b.id;
    }
  }
  const all = db
    .prepare("SELECT id FROM bike WHERE user_id = ? AND archived = 0")
    .all(userId) as { id: string }[];
  if (all.length === 1) return all[0]!.id;
  return null;
}

const TYPE_TO_KEY = {
  sigorta: "sigortaExpiresOn",
  kasko: "kaskoExpiresOn",
  muayene: "muayeneExpiresOn",
} as const;

export function autoApply(input: AutoApplyInput): AutoApplyOutput {
  const { db, userId, documentId, bikeIdHint, parsed, threshold } = input;

  if (parsed.docType === "ruhsat" || parsed.docType === "unknown") {
    return { appliedDatedItemId: null, reason: "doc_type_not_dated" };
  }
  if (parsed.confidence < threshold) {
    return { appliedDatedItemId: null, reason: "low_confidence" };
  }

  const dateKey = TYPE_TO_KEY[parsed.docType];
  const expiresOn = parsed.dates[dateKey];
  if (!expiresOn) {
    return { appliedDatedItemId: null, reason: "no_matching_date" };
  }

  const bikeId = pickBikeId(db, userId, bikeIdHint, parsed.plate);
  if (!bikeId) {
    return { appliedDatedItemId: null, reason: "no_bike_match" };
  }

  const id = newId();
  db.prepare(
    `INSERT INTO dated_item
       (id, bike_id, user_id, type, expires_on, source_document_id, ocr_confidence, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(id, bikeId, userId, parsed.docType, expiresOn, documentId, parsed.confidence);
  return { appliedDatedItemId: id, reason: "applied" };
}
