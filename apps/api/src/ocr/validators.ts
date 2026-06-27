import type { ParsedOcr } from "./parser.js";
import { canonicalize } from "./catalog.js";

/**
 * Deterministic, format-agnostic checks over a parsed ruhsat. Three jobs:
 *  - CORRECT what we can prove (chassis/engine swap, plate normalization,
 *    make/model snapped to the catalog's canonical spelling).
 *  - FLAG what's merely suspicious (bad plate/VIN shape, ID-shaped engine no,
 *    implausible displacement) and cap confidence so it can't silently
 *    auto-apply and the review screen nudges the user to check it.
 *
 * These run after the LLM/OCR parse and never depend on the document layout,
 * so they cover old cards, new cards and booklets alike.
 */

export type IssueKind = "corrected" | "suspect";

export interface FieldIssue {
  field: keyof ParsedOcr;
  kind: IssueKind;
  message: string;
}

/** Confidence ceiling applied when a field is flagged suspect. */
const SUSPECT_CONFIDENCE_CAP = 0.5;

/** Plausible engine displacement window for vehicles (cm³). */
const CC_MIN = 20;
const CC_MAX = 8000;

/** Strip spaces and uppercase a plate; null when empty. */
export function normalizePlate(plate: string | null): string | null {
  if (!plate) return null;
  const p = plate.replace(/\s+/g, "").toUpperCase();
  return p.length > 0 ? p : null;
}

/**
 * Turkish plate shape: province 01–81, 1–3 letters, 2–4 digits. Validates the
 * normalized (space-free, upper) form.
 */
export function isValidTrPlate(plate: string): boolean {
  return /^(0[1-9]|[1-7]\d|8[01])[A-Z]{1,4}\d{2,5}$/.test(plate);
}

/** VIN/şase shape: exactly 17 chars, no I/O/Q. */
export function isVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(value.toUpperCase());
}

export function validateAndCorrect(input: ParsedOcr): {
  parsed: ParsedOcr;
  issues: FieldIssue[];
} {
  const parsed: ParsedOcr = { ...input, dates: { ...input.dates } };
  const issues: FieldIssue[] = [];

  // ── plate: validate shape on a normalized copy, but do NOT rewrite the
  //    stored value here — consistent system-wide plate normalization
  //    (incl. Turkish İ/I casing) is handled in autoApply/bike layer ───────
  const normPlate = normalizePlate(parsed.plate);
  if (normPlate && !isValidTrPlate(normPlate)) {
    issues.push({
      field: "plate",
      kind: "suspect",
      message: "Plaka biçimi tanınmadı",
    });
  }

  // ── chassis ↔ engine: the VIN (17 chars) belongs in chassisNo ────────────
  const chassis = parsed.chassisNo?.toUpperCase() ?? null;
  const engine = parsed.engineNo?.toUpperCase() ?? null;
  if (chassis && engine && !isVin(chassis) && isVin(engine)) {
    parsed.chassisNo = engine;
    parsed.engineNo = chassis;
    issues.push({
      field: "chassisNo",
      kind: "corrected",
      message: "Şase ve motor numarası yer değiştirildi",
    });
  }

  // ── engine no: must not be a national ID (11 digits) or the VIN ──────────
  if (parsed.engineNo) {
    const e = parsed.engineNo.toUpperCase();
    if (/^\d{11}$/.test(e) || isVin(e)) {
      issues.push({
        field: "engineNo",
        kind: "suspect",
        message: "Motor numarası geçersiz görünüyor",
      });
    }
  }

  // ── cylinder cc: plausibility for vehicles ───────────────────────
  if (parsed.cylinderCc != null && parsed.cylinderCc > 0 && (parsed.cylinderCc < CC_MIN || parsed.cylinderCc > CC_MAX)) {
    issues.push({
      field: "cylinderCc",
      kind: "suspect",
      message: "Silindir hacmi beklenen aralık dışında",
    });
  }

  // ── make / model: snap to the catalog's canonical spelling when matched.
  //    Pure string cleanup — does NOT touch confidence (a make match says
  //    nothing about whether the expiry date was read correctly).
  if (parsed.make || parsed.model) {
    const canon = canonicalize(parsed.make, parsed.model);
    if (canon.make && canon.make !== parsed.make) {
      parsed.make = canon.make;
      if (canon.makeVia === "fuzzy") {
        issues.push({ field: "make", kind: "corrected", message: "Marka kataloğa göre düzeltildi" });
      }
    }
    if (canon.model && canon.model !== parsed.model) {
      parsed.model = canon.model;
      if (canon.modelVia === "fuzzy") {
        issues.push({ field: "model", kind: "corrected", message: "Model kataloğa göre düzeltildi" });
      }
    }
  }

  // Any genuine doubt caps confidence so it won't auto-apply silently.
  if (issues.some((i) => i.kind === "suspect")) {
    parsed.confidence = Math.min(parsed.confidence, SUSPECT_CONFIDENCE_CAP);
  }

  return { parsed, issues };
}
