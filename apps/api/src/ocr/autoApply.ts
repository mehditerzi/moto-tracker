import type Database from "better-sqlite3";
import { newId } from "../lib/ulid.js";
import type { ParsedOcr } from "./parser.js";
import { inferVehicleType } from "./catalog.js";
import { bikeFacts, permits } from "../lib/orgAccess.js";

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
 * Does this plate already name a vehicle in an organization the user is an
 * active member of? Plates are unique to a real vehicle, so the answer decides
 * whether "create a vehicle from this ruhsat" would in fact be "duplicate a
 * company vehicle into a private garage".
 *
 * Deliberately scoped to the user's OWN orgs rather than every org in the
 * database: it must not become an oracle for whether a stranger's plate is on
 * the platform. A driver's unassigned vehicle is included on purpose — they
 * must not be able to make a personal copy of a fleet vehicle they merely
 * photographed.
 */
function plateBelongsToUsersOrg(
  db: Database.Database,
  userId: string,
  normalizedPlate: string,
): boolean {
  const rows = db
    .prepare(
      `SELECT b.plate FROM bike b
         JOIN org_member m ON m.org_id = b.org_id AND m.user_id = ? AND m.status = 'active'
        WHERE b.org_id IS NOT NULL AND b.plate IS NOT NULL`,
    )
    .all(userId) as { plate: string }[];
  return rows.some((r) => normalizePlate(r.plate) === normalizedPlate);
}

// ─── batch review: suggest, never apply ───────────────────────────────────────

/**
 * What an existing garage says about one scanned document, WITHOUT writing
 * anything. This is the read-only half of `pickOrCreateBike`, used by the bulk
 * review flow: inside a batch nothing is created or patched until the user
 * applies the batch, so the worker's job is to answer the question the review
 * screen asks — "is this a vehicle I already have?" — and stop.
 *
 *   update      — the plate (or chassis number) names a vehicle already in the
 *                 target garage. This is also the duplicate-plate answer: a
 *                 second photo of a vehicle you own is not a new vehicle, it is
 *                 an update, and the review screen says so rather than offering
 *                 to create a twin.
 *   create      — identifying details, no match. A new vehicle.
 *   org_conflict— the plate belongs to a vehicle in one of the uploader's own
 *                 organizations, but this batch targets their personal garage.
 *                 Creating here would copy company registration data into a
 *                 private garage (the leak `plateBelongsToUsersOrg` exists to
 *                 stop) — so the review screen refuses and explains, instead of
 *                 silently doing nothing.
 *   none        — nothing identifying was read; there is no vehicle to propose.
 */
export type ScanSuggestion =
  | { kind: "update"; bikeId: string }
  | { kind: "create" }
  | { kind: "org_conflict"; bikeId: string }
  | { kind: "none" };

/**
 * Vehicles a batch may match against: the batch's ORG garage, or — for a
 * personal batch — the uploader's own vehicles. Never both. A batch declares its
 * target garage when it is created and every vehicle it touches lives there.
 */
function garageBikes(db: Database.Database, userId: string, orgId: string | null): BikeRow[] {
  return (
    orgId
      ? db
          .prepare(
            "SELECT id, plate, make, model, year, chassis_no, engine_no, cylinder_cc FROM bike WHERE org_id = ? AND archived = 0",
          )
          .all(orgId)
      : db
          .prepare(
            "SELECT id, plate, make, model, year, chassis_no, engine_no, cylinder_cc FROM bike WHERE user_id = ? AND org_id IS NULL AND archived = 0",
          )
          .all(userId)
  ) as BikeRow[];
}

export function suggestBikeForScan(
  db: Database.Database,
  userId: string,
  orgId: string | null,
  parsed: ParsedOcr,
): ScanSuggestion {
  const np = normalizePlate(parsed.plate);
  const chassis = parsed.chassisNo?.replace(/\s+/g, "").toUpperCase() ?? null;
  const bikes = garageBikes(db, userId, orgId);

  if (np) {
    const hit = bikes.find((b) => normalizePlate(b.plate) === np);
    if (hit) return { kind: "update", bikeId: hit.id };
  }
  // Chassis is the stronger identifier when a plate was misread or is absent —
  // a VIN is unique to a vehicle for life, a plate only until it is re-issued.
  if (chassis && chassis.length >= 10) {
    const hit = bikes.find((b) => b.chassis_no?.replace(/\s+/g, "").toUpperCase() === chassis);
    if (hit) return { kind: "update", bikeId: hit.id };
  }

  if (!parsed.plate && !parsed.make && !parsed.model && !parsed.chassisNo) return { kind: "none" };

  // Personal batch, company plate: the one case where "create" is wrong even
  // though nothing in this garage matches.
  if (!orgId && np) {
    const orgHit = db
      .prepare(
        `SELECT b.id, b.plate FROM bike b
           JOIN org_member m ON m.org_id = b.org_id AND m.user_id = ? AND m.status = 'active'
          WHERE b.org_id IS NOT NULL AND b.plate IS NOT NULL AND b.archived = 0`,
      )
      .all(userId) as { id: string; plate: string }[];
    const conflict = orgHit.find((r) => normalizePlate(r.plate) === np);
    if (conflict) return { kind: "org_conflict", bikeId: conflict.id };
  }

  return { kind: "create" };
}

/**
 * Decide which bike this scan applies to. Strategy:
 *   1. Honour the explicit bikeIdHint — the vehicle the document was uploaded
 *      against — whenever the uploader may WRITE it. On an org vehicle that is
 *      decided by membership (lib/orgAccess.ts), NOT by `bike.user_id`: the
 *      custodian of a company van is whoever registered it, and a colleague
 *      scanning its ruhsat is the normal case.
 *   2. Match by normalized plate — PERSONAL vehicles only.
 *   3. If the user has exactly one non-archived PERSONAL bike, use it.
 *   4. If allowCreate (typically ruhsat scans) and we have any identifying
 *      info, create a new PERSONAL bike.
 *
 * Steps 2–4 are deliberately confined to `org_id IS NULL`. A scan carries no
 * org context of its own — only the hinted vehicle does — so guessing into a
 * fleet would let any member's stray photo mutate company records, and
 * guessing OUT of one (the old behaviour) silently copied company data into a
 * private garage. When a hint exists we therefore never fall through to a
 * guess: the uploader already said which vehicle this is about.
 */
function pickOrCreateBike(
  db: Database.Database,
  userId: string,
  bikeIdHint: string | null,
  parsed: ParsedOcr,
  allowCreate: boolean,
): BikePick | null {
  if (bikeIdHint) {
    const facts = bikeFacts(userId, bikeIdHint, db);
    if (facts) {
      // The hint names a real vehicle. Either we may write it — then it is the
      // answer — or we may not, and this scan applies to nothing at all. Never
      // fall through: a document attached to a company van must not end up
      // creating or patching a vehicle in the uploader's own garage.
      if (!facts.archived && permits(facts, userId, "write")) {
        return { bikeId: facts.bikeId, action: "matched" };
      }
      return null;
    }
    // The hinted vehicle no longer exists (deleted between upload and scan);
    // fall through to the personal-garage heuristics below.
  }

  const np = normalizePlate(parsed.plate);
  const allBikes = db
    .prepare("SELECT id, plate, make, model, year, chassis_no, engine_no, cylinder_cc FROM bike WHERE user_id = ? AND org_id IS NULL AND archived = 0")
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

    // A plate that already belongs to a vehicle in one of the uploader's own
    // organizations is a company vehicle, whatever this photo was attached to.
    // Minting a personal duplicate of it would copy the company's registration
    // details into a private garage the org cannot see or delete — and burn a
    // slot of the member's personal quota doing it. Do nothing instead; the
    // review screen still lets them attach the scan to the right vehicle.
    if (np && plateBelongsToUsersOrg(db, userId, np)) return null;

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
 * No ownership predicate here on purpose: the caller has already authorised
 * `write` on this vehicle through orgAccess, and re-checking with
 * `user_id = ?` would silently skip every org vehicle whose custodian is
 * somebody other than the person holding the camera.
 *
 * Returns true if at least one field was actually updated.
 */
function patchBikeBlanks(
  db: Database.Database,
  bikeId: string,
  parsed: ParsedOcr,
): boolean {
  const row = db
    .prepare("SELECT plate, make, model, year, first_registration_date, color, chassis_no, engine_no, cylinder_cc, fuel_type FROM bike WHERE id = ?")
    .get(bikeId) as
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
  values.push(bikeId);
  db.prepare(`UPDATE bike SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return true;
}

const TYPE_TO_KEY = {
  sigorta: "sigortaExpiresOn",
  kasko: "kaskoExpiresOn",
  muayene: "muayeneExpiresOn",
} as const;

export type DatedType = keyof typeof TYPE_TO_KEY;
export interface DatedApplication {
  type: DatedType;
  expiresOn: string;
}

/**
 * Every renewal deadline this scan warrants, regardless of what KIND of
 * document it is.
 *
 * This used to be "the one date whose name matches doc_type", which threw away
 * the single most common deadline in the corpus: a Turkish ruhsat prints the
 * inspection expiry in its (Z.2) DİĞER BİLGİLER field ("mua.geç.trh:
 * 19-08-2026"), and `doc_type` for a ruhsat is `ruhsat`, so `autoApply`
 * returned `doc_type_not_dated` and dropped it. 24 of 25 production documents
 * were ruhsat photos carrying a visible muayene date; none of them ever became
 * a reminder. A date is a date wherever it was printed — the document type
 * decides which FIELDS to look for, not whether a deadline counts.
 */
export function applicableDatedItems(parsed: ParsedOcr): DatedApplication[] {
  const out: DatedApplication[] = [];
  for (const type of ["muayene", "sigorta", "kasko"] as const) {
    const expiresOn = parsed.dates[TYPE_TO_KEY[type]];
    if (expiresOn) out.push({ type, expiresOn });
  }
  return out;
}

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
      if (patchBikeBlanks(db, bike.bikeId, parsed)) bikeAction = "updated";
    }
  }

  // A ruhsat or an unidentified document used to stop here, on the theory that
  // "they don't carry an expiry date". A Turkish ruhsat does: the inspection
  // deadline is printed in its (Z.2) DİĞER BİLGİLER field, and 24 of the 25
  // documents in the production corpus were ruhsat photos showing one. This
  // early return is why auto-apply had never once fired. What remains true is
  // that such a document may carry NO deadline — that case is now decided by
  // looking (`applicableDatedItems` below), not by assuming from the type.
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

  // Every deadline the document carries — not just the one named after its
  // doc_type. See `applicableDatedItems`: this is what took auto-apply from
  // never firing to firing on nearly every ruhsat in the corpus.
  const dated = applicableDatedItems(parsed);
  if (dated.length === 0) {
    return {
      appliedDatedItemId: null,
      appliedFuelLogId: null,
      appliedBikeId: bike?.bikeId ?? null,
      bikeAction,
      // A ruhsat with no readable deadline still did its main job when it
      // matched or created the vehicle, so it reports `bike_only` rather than
      // the flat "no date" a policy document would.
      reason:
        parsed.docType === "ruhsat" || parsed.docType === "unknown"
          ? bike
            ? "bike_only"
            : "doc_type_not_dated"
          : "no_matching_date",
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

  // The document row holds ONE applied_dated_item_id, so when a scan yields
  // several, the one that matches its doc_type is the headline; a ruhsat's
  // inspection date is the headline on a ruhsat.
  const ordered = [...dated].sort((a, b) => Number(b.type === parsed.docType) - Number(a.type === parsed.docType));

  let primaryId: string | null = null;
  for (const { type, expiresOn } of ordered) {
    // A user photographs the same registration card repeatedly — twenty times,
    // in this corpus — and every photo carries the same inspection date. Each
    // one used to be a fresh row; the garage would fill with identical
    // reminders for the same deadline. The deadline is the thing, not the
    // photo of it: if this vehicle already has this renewal on this date,
    // there is nothing to add.
    const existing = db
      .prepare("SELECT id FROM dated_item WHERE bike_id = ? AND type = ? AND expires_on = ?")
      .get(bike.bikeId, type, expiresOn) as { id: string } | undefined;
    if (existing) {
      primaryId ??= existing.id;
      continue;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO dated_item
         (id, bike_id, user_id, type, expires_on, source_document_id, ocr_confidence, needs_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(id, bike.bikeId, userId, type, expiresOn, documentId, parsed.confidence);
    primaryId ??= id;
  }

  return {
    appliedDatedItemId: primaryId,
    appliedFuelLogId: null,
    appliedBikeId: bike.bikeId,
    bikeAction,
    reason: "applied",
  };
}
