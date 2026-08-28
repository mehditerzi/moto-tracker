import type { Bike, Document, OcrFieldIssue, ReviewDecision } from "@mototracker/shared";

/**
 * The rules behind the bulk review screen, kept free of React so they can be
 * tested and — more importantly — argued about on their own.
 *
 * The screen has exactly one job: make "yes, that's right" cost one tap, and
 * make the exceptions impossible to walk past. Everything here exists to sort
 * documents into those two piles.
 */

export type FieldKey =
  | "plate"
  | "make"
  | "model"
  | "year"
  | "firstRegistrationDate"
  | "color"
  | "chassisNo"
  | "engineNo"
  | "cylinderCc"
  | "fuelType";

/**
 * Printed order on a Turkish ruhsat (araç tescil belgesi): (A) plate,
 * (D.1) make, (D.3) model, (B) year, (E) chassis, (P.1) displacement,
 * (P.5) engine number. The review screen reads in the same sequence as the card
 * in the user's hand — checking a value should be a glance, not a search.
 */
export const RUHSAT_FIELDS: readonly FieldKey[] = [
  "plate",
  "make",
  "model",
  "year",
  "firstRegistrationDate",
  "color",
  "chassisNo",
  "cylinderCc",
  "fuelType",
  "engineNo",
] as const;

/**
 * The four fields that decide whether a scan is usable at all. A missing colour
 * is a shrug; a missing plate means we do not know which vehicle this is.
 */
export const CORE_FIELDS: readonly FieldKey[] = ["plate", "make", "model", "year"] as const;

/** Below this the parse is not trustworthy enough to wave through. */
export const LOW_CONFIDENCE = 0.7;

export type DraftFields = Record<FieldKey, string>;

export const EMPTY_FIELDS: DraftFields = {
  plate: "",
  make: "",
  model: "",
  year: "",
  firstRegistrationDate: "",
  color: "",
  chassisNo: "",
  engineNo: "",
  cylinderCc: "",
  fuelType: "",
};

/** The dates a review can record alongside a vehicle. */
export const DATE_TYPES = ["muayene", "sigorta", "kasko"] as const;
export type DateType = (typeof DATE_TYPES)[number];
export type DraftDates = Partial<Record<DateType, string>>;

// ─── reading a document ───────────────────────────────────────────────────────

/** OCR's proposal for one document, as editable text. */
export function fieldsFromDocument(doc: Document): DraftFields {
  const ex = doc.ocrExtracted;
  if (!ex) return { ...EMPTY_FIELDS };
  return {
    plate: ex.plate ?? "",
    make: ex.make ?? "",
    model: ex.model ?? "",
    year: ex.year != null ? String(ex.year) : "",
    firstRegistrationDate: ex.firstRegistrationDate ?? "",
    color: ex.color ?? "",
    chassisNo: ex.chassisNo ?? "",
    engineNo: ex.engineNo ?? "",
    cylinderCc: ex.cylinderCc != null ? String(ex.cylinderCc) : "",
    fuelType: ex.fuelType ?? "",
  };
}

export function fieldsFromBike(bike: Bike): DraftFields {
  return {
    plate: bike.plate ?? "",
    make: bike.make ?? "",
    model: bike.model ?? "",
    year: bike.year != null ? String(bike.year) : "",
    firstRegistrationDate: bike.firstRegistrationDate ?? "",
    color: bike.color ?? "",
    chassisNo: bike.chassisNo ?? "",
    engineNo: bike.engineNo ?? "",
    cylinderCc: bike.cylinderCc != null ? String(bike.cylinderCc) : "",
    fuelType: bike.fuelType ?? "",
  };
}

export function datesFromDocument(doc: Document): DraftDates {
  const d = doc.ocrExtracted?.dates;
  if (!d) return {};
  const out: DraftDates = {};
  if (d.muayeneExpiresOn) out.muayene = d.muayeneExpiresOn;
  if (d.sigortaExpiresOn) out.sigorta = d.sigortaExpiresOn;
  if (d.kaskoExpiresOn) out.kasko = d.kaskoExpiresOn;
  return out;
}

/** Per-field notes the API's validators recorded, indexed for lookup. */
export function issuesByField(doc: Document): Map<string, OcrFieldIssue> {
  const map = new Map<string, OcrFieldIssue>();
  for (const issue of doc.ocrExtracted?.issues ?? []) {
    // A suspect note always wins over a corrected one on the same field: the
    // first asks for the user's eyes, the second only reports what we did.
    const existing = map.get(issue.field);
    if (existing && existing.kind === "suspect") continue;
    map.set(issue.field, issue);
  }
  return map;
}

/**
 * The fields worth looking at, and nothing else.
 *
 * This is the single most important function on the screen. OCR reads ten
 * fields; asking a user to verify all ten, twenty times over, is slower than
 * typing them. So we point at three kinds of trouble and stay quiet about the
 * rest:
 *
 *   • a core field OCR could not read at all;
 *   • a field the validators flagged as the shape of a mistake (a plate that
 *     is not a plate, an engine number that is a national ID);
 *   • everything core, when the parse as a whole scored badly — at that point
 *     no individual field has earned trust.
 */
export function attentionFields(doc: Document): Set<FieldKey> {
  const out = new Set<FieldKey>();
  const ex = doc.ocrExtracted;
  if (!ex) return out;
  const fields = fieldsFromDocument(doc);
  const lowOverall = ex.confidence < LOW_CONFIDENCE;

  // Only a registration is expected to carry vehicle identity. An insurance
  // policy has no make or model on it, and flagging four blank fields on every
  // one of them would train the user to ignore the warning that matters.
  if (ex.docType === "ruhsat") {
    for (const key of CORE_FIELDS) {
      if (lowOverall || fields[key].trim() === "") out.add(key);
    }
  }
  for (const issue of ex.issues ?? []) {
    if (issue.kind === "suspect" && (RUHSAT_FIELDS as readonly string[]).includes(issue.field)) {
      out.add(issue.field as FieldKey);
    }
  }
  return out;
}

/**
 * Can this document be waved through without opening anything?
 *
 * Deliberately strict. A false "one tap" costs a wrong vehicle in someone's
 * garage; a false "needs a look" costs one extra glance.
 */
export function isOneTap(doc: Document): boolean {
  if (doc.ocrStatus !== "done") return false;
  const ex = doc.ocrExtracted;
  if (!ex || ex.docType !== "ruhsat") return false;
  if (ex.confidence < LOW_CONFIDENCE) return false;
  return attentionFields(doc).size === 0;
}

// ─── outcomes ─────────────────────────────────────────────────────────────────

/**
 * What this document needs from the user, in priority order. The review screen
 * renders one of five shapes and nothing else — every document, however it
 * failed, lands on exactly one of them, which is what stops the flow from ever
 * dead-ending.
 */
export type DocumentOutcome =
  /** Still in the OCR queue. */
  | "reading"
  /** OCR failed or produced nothing usable: retry, skip, or type it in. */
  | "unreadable"
  /** Read fine, but it is not a vehicle registration. */
  | "not_a_ruhsat"
  /** The plate belongs to a company vehicle and this is a personal batch. */
  | "org_conflict"
  /** A vehicle already in this garage — an update, not a new vehicle. */
  | "update"
  /** A new vehicle. */
  | "create";

export function outcomeOf(doc: Document): DocumentOutcome {
  if (doc.ocrStatus === "pending") return "reading";
  if (doc.ocrStatus === "failed" || !doc.ocrExtracted) return "unreadable";
  if (doc.suggestion === "org_conflict") return "org_conflict";
  const type = doc.ocrExtracted.docType;
  if (type !== "ruhsat") {
    // A dated document (insurance, inspection) still has something to give if
    // it names a vehicle we can attach it to; otherwise it is just not a ruhsat.
    return doc.suggestion === "update" ? "update" : "not_a_ruhsat";
  }
  // "none" means nothing identifying was read — there is no vehicle to propose.
  if (doc.suggestion === "none") return "unreadable";
  return doc.suggestion === "update" ? "update" : "create";
}

/** Seed the decision the user is about to confirm or correct. */
export function seedDecision(doc: Document, target: Bike | undefined): ReviewDecision {
  const scanned = fieldsFromDocument(doc);
  const outcome = outcomeOf(doc);

  if (outcome === "update" && target) {
    // Updating: start from what the vehicle already knows and let the scan fill
    // the blanks. A confident OCR value never silently overwrites a value the
    // user typed themselves — that is a decision, and it belongs to them.
    const current = fieldsFromBike(target);
    const merged = { ...current };
    for (const key of RUHSAT_FIELDS) {
      if (merged[key].trim() === "" && scanned[key].trim() !== "") merged[key] = scanned[key];
    }
    return {
      action: "update",
      targetBikeId: target.id,
      fields: merged,
      dates: datesFromDocument(doc),
    };
  }

  return {
    action: outcome === "create" ? "create" : "skip",
    targetBikeId: null,
    nickname: suggestNickname(scanned),
    fields: scanned,
    dates: datesFromDocument(doc),
  };
}

/** "Ducati Monster 937" beats "34 ABC 123" beats nothing. */
export function suggestNickname(fields: DraftFields): string {
  const named = [fields.make, fields.model].map((s) => s.trim()).filter(Boolean).join(" ");
  return named || fields.plate.trim() || "";
}

/** A confirmed decision must actually say something. */
export function canConfirm(decision: ReviewDecision): boolean {
  if (decision.action === "skip") return true;
  if (decision.action === "update") return !!decision.targetBikeId;
  // Creating a vehicle needs a name and at least one identifying detail —
  // otherwise the garage fills with rows called "Araç".
  const f = decision.fields;
  const identified = !!(f.plate?.trim() || f.chassisNo?.trim() || (f.make?.trim() && f.model?.trim()));
  return identified && !!(decision.nickname ?? "").trim();
}

// ─── the batch as a whole ─────────────────────────────────────────────────────

export interface BatchStats {
  total: number;
  /** Still being read by the worker. */
  reading: number;
  /** Read, but the user has not decided yet. */
  awaiting: number;
  confirmed: number;
  skipped: number;
  failed: number;
  /** True when every document has an answer and the batch can be applied. */
  ready: boolean;
  /** How many vehicles applying would create — the number on the button. */
  creates: number;
  updates: number;
}

export function batchStats(docs: Document[]): BatchStats {
  const s: BatchStats = {
    total: docs.length,
    reading: 0,
    awaiting: 0,
    confirmed: 0,
    skipped: 0,
    failed: 0,
    ready: false,
    creates: 0,
    updates: 0,
  };
  for (const d of docs) {
    if (d.ocrStatus === "pending") s.reading += 1;
    if (d.ocrStatus === "failed") s.failed += 1;
    const state = d.reviewState ?? "pending";
    if (state === "confirmed" || state === "applied") {
      s.confirmed += 1;
      if (d.reviewDecision?.action === "create") s.creates += 1;
      if (d.reviewDecision?.action === "update") s.updates += 1;
    } else if (state === "skipped") s.skipped += 1;
    else if (d.ocrStatus !== "pending") s.awaiting += 1;
  }
  // A batch is applicable once nothing is unanswered — including nothing still
  // being read, because a document that arrives after the apply would be lost.
  s.ready = s.total > 0 && s.reading === 0 && s.awaiting === 0 && s.confirmed > 0;
  return s;
}

/**
 * Where the cursor should go after a decision: the next document that still
 * needs one, searching forward from `from` and wrapping once.
 *
 * Wrapping is what lets the user confirm the eight easy ones first and come
 * back to the two hard ones, without ever navigating anywhere. Documents still
 * being read are skipped rather than blocking — they are polled and the user is
 * brought back to them when they land.
 */
export function nextUndecidedIndex(docs: Document[], from: number): number | null {
  const n = docs.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    const d = docs[i]!;
    if (d.ocrStatus === "pending") continue;
    if ((d.reviewState ?? "pending") === "pending") return i;
  }
  // Nothing undecided but something still reading: park on the first of those,
  // so the screen shows honest progress rather than jumping to the end.
  const reading = docs.findIndex((d) => d.ocrStatus === "pending");
  return reading === -1 ? null : reading;
}

/** Normalised plate — spacing and case are not identity. */
export function normalizePlate(plate: string | null | undefined): string | null {
  if (!plate) return null;
  const p = plate.replace(/\s+/g, "").toUpperCase();
  return p.length > 0 ? p : null;
}

/**
 * Documents in this batch that would create a vehicle with a plate another
 * document is already creating — two shots of the same ruhsat. Returns the
 * later document ids mapped to the first one that claimed the plate, so the
 * screen can say "same vehicle as photo 3" instead of quietly making a twin.
 */
export function duplicateWithinBatch(docs: Document[]): Map<string, string> {
  const claimed = new Map<string, string>();
  const dupes = new Map<string, string>();
  for (const d of docs) {
    const decision = d.reviewDecision;
    if (!decision || decision.action !== "create") continue;
    const plate = normalizePlate(decision.fields.plate);
    if (!plate) continue;
    const first = claimed.get(plate);
    if (first) dupes.set(d.id, first);
    else claimed.set(plate, d.id);
  }
  return dupes;
}
