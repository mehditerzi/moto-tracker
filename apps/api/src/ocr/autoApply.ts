import type Database from "better-sqlite3";
import { newId } from "../lib/ulid.js";
import type { ParsedOcr } from "./parser.js";
import { inferVehicleType } from "./catalog.js";

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
  appliedFuelLogId: string | null;
  appliedBikeId: string | null;
  bikeAction: BikeAction;
  reason:
    | "applied"
    | "low_confidence"
    | "doc_type_not_dated"
    | "no_matching_date"
    | "no_fuel_data"
    | "no_bike_match"
    | "bike_only";
}

interface BikeRow {
  id: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  chassis_no: string | null;
  engine_no: string | null;
  cylinder_cc: number | null;
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
    .prepare("SELECT id, plate, make, model, year, chassis_no, engine_no, cylinder_cc FROM bike WHERE user_id = ? AND archived = 0")
    .all(userId) as BikeRow[];

  if (np) {
    for (const b of allBikes) {
      if (normalizePlate(b.plate) === np) return { bikeId: b.id, action: "matched" };
    }
  }

  // Only fall back to the user's sole bike when OCR found no plate to compare.
  // If a plate was extracted but didn't match, don't silently merge.
  if (allBikes.length === 1 && !np) {
    return { bikeId: allBikes[0]!.id, action: "matched" };
  }

  if (allowCreate) {
    const hasIdentifyingInfo = !!(parsed.plate || parsed.make || parsed.model || parsed.year);
    if (!hasIdentifyingInfo) return null;

    const id = newId();
    const nickname =
      [parsed.make, parsed.model].filter(Boolean).join(" ").trim() ||
      parsed.plate ||
      "Araç";
    // Infer car vs motorcycle from the catalog match; fall back to motorcycle
    // when the make/model is ambiguous (e.g. a brand that builds both).
    const vehicleType = inferVehicleType(parsed.make, parsed.model) ?? "motorcycle";
    db.prepare(
      `INSERT INTO bike (id, user_id, vehicle_type, nickname, plate, make, model, year, first_registration_date, color, chassis_no, engine_no, cylinder_cc, fuel_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      vehicleType,
      nickname,
      parsed.plate,
      parsed.make,
      parsed.model,
      parsed.year,
      parsed.firstRegistrationDate,
      parsed.color,
      parsed.chassisNo,
      parsed.engineNo,
      parsed.cylinderCc,
      parsed.fuelType,
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
    .prepare("SELECT plate, make, model, year, first_registration_date, color, chassis_no, engine_no, cylinder_cc, fuel_type FROM bike WHERE id = ? AND user_id = ?")
    .get(bikeId, userId) as
    | { plate: string | null; make: string | null; model: string | null; year: number | null; first_registration_date: string | null; color: string | null; chassis_no: string | null; engine_no: string | null; cylinder_cc: number | null; fuel_type: string | null }
    | undefined;
  if (!row) return false;

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  const wants: Array<[keyof typeof row, string | number | null]> = [
    ["plate", parsed.plate],
    ["make", parsed.make],
    ["model", parsed.model],
    ["year", parsed.year],
    ["first_registration_date", parsed.firstRegistrationDate],
    ["color", parsed.color],
    ["chassis_no", parsed.chassisNo],
    ["engine_no", parsed.engineNo],
    ["cylinder_cc", parsed.cylinderCc],
    ["fuel_type", parsed.fuelType],
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
      appliedFuelLogId: null,
      appliedBikeId: bike?.bikeId ?? null,
      bikeAction,
      reason: bike ? "bike_only" : "doc_type_not_dated",
    };
  }

  if (parsed.confidence < threshold) {
    return {
      appliedDatedItemId: null,
      appliedFuelLogId: null,
      appliedBikeId: bike?.bikeId ?? null,
      bikeAction,
      reason: "low_confidence",
    };
  }

  // A pump receipt becomes a fuel_log rather than a dated_item.
  if (parsed.docType === "yakit") {
    const fuel = parsed.fuel;
    if (!fuel?.filledOn || !fuel.liters) {
      return {
        appliedDatedItemId: null,
        appliedFuelLogId: null,
        appliedBikeId: bike?.bikeId ?? null,
        bikeAction,
        reason: "no_fuel_data",
      };
    }
    if (!bike) {
      return {
        appliedDatedItemId: null,
        appliedFuelLogId: null,
        appliedBikeId: null,
        bikeAction,
        reason: "no_bike_match",
      };
    }
    const id = newId();
    // is_full=1: a station fill is a full tank far more often than not, and the
    // review screen lets the user flip it. Odometer isn't on a receipt.
    db.prepare(
      `INSERT INTO fuel_log
         (id, user_id, bike_id, filled_on, liters, total_cost, odometer_km, is_full, notes, source_document_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 1, NULL, ?)`,
    ).run(id, userId, bike.bikeId, fuel.filledOn, fuel.liters, fuel.totalCost, documentId);
    return {
      appliedDatedItemId: null,
      appliedFuelLogId: id,
      appliedBikeId: bike.bikeId,
      bikeAction,
      reason: "applied",
    };
  }

  const dateKey = TYPE_TO_KEY[parsed.docType];
  const expiresOn = parsed.dates[dateKey];
  if (!expiresOn) {
    return {
      appliedDatedItemId: null,
      appliedFuelLogId: null,
      appliedBikeId: bike?.bikeId ?? null,
      bikeAction,
      reason: "no_matching_date",
    };
  }

  if (!bike) {
    return {
      appliedDatedItemId: null,
      appliedFuelLogId: null,
      appliedBikeId: null,
      bikeAction,
      reason: "no_bike_match",
    };
  }

  const id = newId();
  db.prepare(
    `INSERT INTO dated_item
       (id, bike_id, user_id, type, expires_on, source_document_id, ocr_confidence, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(id, bike.bikeId, userId, parsed.docType, expiresOn, documentId, parsed.confidence);
  return {
    appliedDatedItemId: id,
    appliedFuelLogId: null,
    appliedBikeId: bike.bikeId,
    bikeAction,
    reason: "applied",
  };
}
