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

export type BikeAction = "matched" | "created" | "updated" | "none";

export interface AutoApplyOutput {
  appliedDatedItemId: string | null;
  appliedBikeId: string | null;
  bikeAction: BikeAction;
  reason:
    | "applied"
    | "low_confidence"
    | "doc_type_not_dated"
    | "no_matching_date"
    | "no_bike_match"
    | "bike_only";
}

interface BikeRow {
  id: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
}

function normalizePlate(p: string | null | undefined): string | null {
  if (!p) return null;
  return p.replace(/\s+/g, "").toUpperCase();
}

interface BikePick {
  bikeId: string;
  action: "matched" | "created";
}

/**
 * Decide which bike this scan applies to. Strategy:
 *   1. Honour the explicit bikeIdHint (set when the user uploaded from a
 *      bike-specific context).
 *   2. Match by normalized plate.
 *   3. If the user has exactly one non-archived bike, use it.
 *   4. If allowCreate (typically ruhsat scans) and we have any identifying
 *      info, create a new bike.
 */
function pickOrCreateBike(
  db: Database.Database,
  userId: string,
  bikeIdHint: string | null,
  parsed: ParsedOcr,
  allowCreate: boolean,
): BikePick | null {
  if (bikeIdHint) {
    const r = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ? AND archived = 0")
      .get(bikeIdHint, userId) as { id: string } | undefined;
    if (r) return { bikeId: r.id, action: "matched" };
  }

  const np = normalizePlate(parsed.plate);
  const allBikes = db
    .prepare("SELECT id, plate, make, model, year FROM bike WHERE user_id = ? AND archived = 0")
    .all(userId) as BikeRow[];

  if (np) {
    for (const b of allBikes) {
      if (normalizePlate(b.plate) === np) return { bikeId: b.id, action: "matched" };
    }
  }

  if (allBikes.length === 1) {
    return { bikeId: allBikes[0]!.id, action: "matched" };
  }

  if (allowCreate) {
    const hasIdentifyingInfo = !!(parsed.plate || parsed.make || parsed.model || parsed.year);
    if (!hasIdentifyingInfo) return null;

    const id = newId();
    const nickname =
      [parsed.make, parsed.model].filter(Boolean).join(" ").trim() ||
      parsed.plate ||
      "Motosiklet";
    db.prepare(
      `INSERT INTO bike (id, user_id, nickname, plate, make, model, year)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      nickname,
      parsed.plate,
      parsed.make,
      parsed.model,
      parsed.year,
    );
    return { bikeId: id, action: "created" };
  }

  return null;
}

/**
 * Patch only the bike fields that are currently null/empty. Never overwrites
 * an existing value — users should edit those manually.
 *
 * Returns true if at least one field was actually updated.
 */
function patchBikeBlanks(
  db: Database.Database,
  bikeId: string,
  userId: string,
  parsed: ParsedOcr,
): boolean {
  const row = db
    .prepare("SELECT plate, make, model, year FROM bike WHERE id = ? AND user_id = ?")
    .get(bikeId, userId) as
    | { plate: string | null; make: string | null; model: string | null; year: number | null }
    | undefined;
  if (!row) return false;

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  const wants: Array<[keyof typeof row, string | number | null]> = [
    ["plate", parsed.plate],
    ["make", parsed.make],
    ["model", parsed.model],
    ["year", parsed.year],
  ];
  for (const [col, val] of wants) {
    if (val == null) continue;
    if (row[col] != null && String(row[col]).trim() !== "") continue;
    sets.push(`${col} = ?`);
    values.push(val);
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  values.push(bikeId, userId);
  db.prepare(`UPDATE bike SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...values);
  return true;
}

const TYPE_TO_KEY = {
  sigorta: "sigortaExpiresOn",
  kasko: "kaskoExpiresOn",
  muayene: "muayeneExpiresOn",
} as const;

export function autoApply(input: AutoApplyInput): AutoApplyOutput {
  const { db, userId, documentId, bikeIdHint, parsed, threshold } = input;

  // A ruhsat (or any unknown doc) carries vehicle identification rather than
  // an expiry date — allow creating a brand-new bike when the user has no
  // matching bike yet.
  const allowCreate = parsed.docType === "ruhsat" || parsed.docType === "unknown";
  const bike = pickOrCreateBike(db, userId, bikeIdHint, parsed, allowCreate);

  let bikeAction: BikeAction = "none";
  if (bike) {
    bikeAction = bike.action;
    // For matched (pre-existing) bikes, fill in any blanks we now know.
    if (bike.action === "matched" && parsed.confidence >= threshold) {
      if (patchBikeBlanks(db, bike.bikeId, userId, parsed)) bikeAction = "updated";
    }
  }

  // Ruhsat / unknown stop here — they don't carry an expiry date.
  if (parsed.docType === "ruhsat" || parsed.docType === "unknown") {
    return {
      appliedDatedItemId: null,
      appliedBikeId: bike?.bikeId ?? null,
      bikeAction,
      reason: bike ? "bike_only" : "doc_type_not_dated",
    };
  }

  if (parsed.confidence < threshold) {
    return {
      appliedDatedItemId: null,
      appliedBikeId: bike?.bikeId ?? null,
      bikeAction,
      reason: "low_confidence",
    };
  }

  const dateKey = TYPE_TO_KEY[parsed.docType];
  const expiresOn = parsed.dates[dateKey];
  if (!expiresOn) {
    return {
      appliedDatedItemId: null,
      appliedBikeId: bike?.bikeId ?? null,
      bikeAction,
      reason: "no_matching_date",
    };
  }

  if (!bike) {
    return {
      appliedDatedItemId: null,
      appliedBikeId: null,
      bikeAction,
      reason: "no_bike_match",
    };
  }

  const id = newId();
  db.prepare(
    `INSERT INTO dated_item
       (id, bike_id, user_id, type, expires_on, source_document_id, ocr_confidence, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(id, bike.bikeId, userId, parsed.docType, expiresOn, documentId, parsed.confidence);
  return {
    appliedDatedItemId: id,
    appliedBikeId: bike.bikeId,
    bikeAction,
    reason: "applied",
  };
}
