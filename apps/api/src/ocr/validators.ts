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
 * Turkish plate structure: a two-digit province code 01–81, then a letter
 * group, then a digit group. The two groups are not independent — the issued
 * combinations are 1+4, 1+5, 2+3, 2+4, 3+2 and 3+3, i.e. one to three letters
 * followed by two to five digits, totalling five or six characters.
 *
 * The old pattern was `[A-Z]{1,4}\d{2,5}`, which is a different and much larger
 * language. It accepted "34KEHL973" — four letters, a plate that cannot exist —
 * so the validator that was supposed to catch OCR garbage waved it through with
 * confidence 0.9, and `autoApply` was ready to mint a vehicle named after it.
 */
export function isValidTrPlate(plate: string): boolean {
  const m = /^(0[1-9]|[1-7]\d|8[01])([A-Z]{1,3})(\d{2,5})$/.exec(plate);
  if (!m) return false;
  const total = m[2]!.length + m[3]!.length;
  return total === 5 || total === 6;
}

/**
 * OCR confusions, and the fact that they are DIRECTIONAL.
 *
 * A glyph misread as `S` where a digit belongs is a `5`; the same glyph misread
 * as `5` where a letter belongs is an `S`. Applying both directions everywhere
 * would turn "34GTC656" into "34GTC6S6" as happily as the reverse. So each map
 * is only ever consulted for the group it belongs to, which is the entire
 * reason plate correction has to know where the letter group ends.
 */
const AS_DIGIT: Record<string, string> = { O: "0", I: "1", S: "5", B: "8" };
const AS_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B" };

/** Uppercase and fold Turkish letters — plates are ASCII A–Z only. */
function foldPlate(raw: string): string {
  return raw
    .replace(/[İıIi]/g, "I")
    .replace(/[Şş]/g, "S")
    .replace(/[Ğğ]/g, "G")
    .replace(/[Üü]/g, "U")
    .replace(/[Öö]/g, "O")
    .replace(/[Çç]/g, "C")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export interface PlateCorrection {
  plate: string;
  /** How many characters had to be swapped to reach a legal plate. */
  corrections: number;
}

/**
 * Snap an OCR'd plate onto the Turkish plate grammar, correcting the standard
 * confusions in — and only in — the group where they are possible.
 *
 * Returns null when no legal plate is reachable. That is a deliberate answer,
 * not a failure to try: "34KEHL973" is not a plate with a typo, it is a misread
 * of something we cannot recover, and storing it would put a fictional
 * registration on a real vehicle. The caller nulls the field and drops
 * confidence so the document goes to a human instead.
 */
export function correctTrPlate(raw: string | null | undefined): PlateCorrection | null {
  if (!raw) return null;
  const s = foldPlate(raw);
  if (s.length < 5 || s.length > 8) return null;

  // Province: two characters that must end up as digits 01–81.
  let province = "";
  let cost = 0;
  for (const ch of s.slice(0, 2)) {
    if (ch >= "0" && ch <= "9") province += ch;
    else if (AS_DIGIT[ch]) {
      province += AS_DIGIT[ch];
      cost++;
    } else return null;
  }
  const p = Number(province);
  if (!(p >= 1 && p <= 81)) return null;

  const rest = s.slice(2);
  let best: PlateCorrection | null = null;
  for (let k = 1; k <= 3 && k < rest.length; k++) {
    const letterPart = rest.slice(0, k);
    const digitPart = rest.slice(k);
    if (digitPart.length < 2 || digitPart.length > 5) continue;
    if (k + digitPart.length !== 5 && k + digitPart.length !== 6) continue;

    let c = cost;
    let letters = "";
    let ok = true;
    for (const ch of letterPart) {
      if (ch >= "A" && ch <= "Z") letters += ch;
      else if (AS_LETTER[ch]) {
        letters += AS_LETTER[ch];
        c++;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let digits = "";
    for (const ch of digitPart) {
      if (ch >= "0" && ch <= "9") digits += ch;
      else if (AS_DIGIT[ch]) {
        digits += AS_DIGIT[ch];
        c++;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // Fewest edits wins; a split needing no correction always beats one that does.
    if (!best || c < best.corrections) best = { plate: `${province}${letters}${digits}`, corrections: c };
  }
  return best;
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

  // ── plate ───────────────────────────────────────────────────────────────
  //
  // Three outcomes, and the third one is the point:
  //   already legal  — left exactly as read (spacing and all; system-wide
  //                    normalization still belongs to the autoApply/bike layer)
  //   fixable        — rewritten to the corrected form, flagged `corrected`
  //   not a plate    — DROPPED, flagged `suspect`, confidence capped
  //
  // Dropping matters because `plate` is not a display string: `autoApply`
  // matches vehicles on it and will create one from it. A plate that cannot
  // exist must not become a vehicle's registration, and — since
  // OCR_AUTO_APPLY_THRESHOLD gates on confidence — it must also drag the score
  // down, or the pipeline would go on being confidently wrong.
  const normPlate = normalizePlate(parsed.plate);
  if (normPlate && !isValidTrPlate(normPlate)) {
    const fixed = correctTrPlate(normPlate);
    if (fixed) {
      parsed.plate = fixed.plate;
      issues.push({
        field: "plate",
        kind: fixed.corrections > 1 ? "suspect" : "corrected",
        message: `Plaka düzeltildi: ${normPlate} → ${fixed.plate}`,
      });
    } else {
      parsed.plate = null;
      issues.push({
        field: "plate",
        kind: "suspect",
        message: `Plaka biçimi tanınmadı: ${normPlate}`,
      });
    }
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
  //
  // Dropped, not flagged. A ruhsat prints (P.1) SİLİNDİR HACMİ next to (P.2)
  // MOTOR GÜCÜ and (G.1) NET AĞIRLIĞI, and a model that grabs the wrong one
  // reports things like 16 cm³ — provably not an engine. Keeping that value and
  // capping the document's confidence for it used to block a scan whose plate
  // AND inspection date were both read perfectly, which trades the feature away
  // over a field nobody sets a reminder on. So: discard the impossible number,
  // say so in review, and let the fields that actually gate auto-apply speak
  // for themselves.
  if (parsed.cylinderCc != null && parsed.cylinderCc > 0 && (parsed.cylinderCc < CC_MIN || parsed.cylinderCc > CC_MAX)) {
    issues.push({
      field: "cylinderCc",
      kind: "corrected",
      message: `Silindir hacmi beklenen aralık dışında, yok sayıldı: ${parsed.cylinderCc}`,
    });
    parsed.cylinderCc = null;
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

  // ── fuel receipt: litres × unit price must reconcile with the total ──────
  if (parsed.docType === "yakit" && parsed.fuel) {
    const f = { ...parsed.fuel };
    // Fill whichever of the three the OCR missed — two determine the third.
    if (f.liters == null && f.totalCost != null && f.unitPrice != null && f.unitPrice > 0) {
      f.liters = Math.round((f.totalCost / f.unitPrice) * 100) / 100;
      issues.push({ field: "fuel", kind: "corrected", message: "Litre tutar/birim fiyattan hesaplandı" });
    } else if (f.totalCost == null && f.liters != null && f.unitPrice != null) {
      f.totalCost = Math.round(f.liters * f.unitPrice * 100) / 100;
      issues.push({ field: "fuel", kind: "corrected", message: "Tutar litre×birim fiyattan hesaplandı" });
    } else if (f.liters != null && f.totalCost != null && f.unitPrice != null) {
      const expected = f.liters * f.unitPrice;
      if (Math.abs(expected - f.totalCost) > f.totalCost * 0.1) {
        issues.push({ field: "fuel", kind: "suspect", message: "Litre × birim fiyat toplam tutarla uyuşmuyor" });
      }
    }
    // Plausibility — a passenger-vehicle fill, not a tanker.
    if (f.liters != null && (f.liters < 0.5 || f.liters > 200)) {
      issues.push({ field: "fuel", kind: "suspect", message: "Litre beklenen aralık dışında" });
    }
    parsed.fuel = f;
  }

  // Any genuine doubt caps confidence so it won't auto-apply silently.
  if (issues.some((i) => i.kind === "suspect")) {
    parsed.confidence = Math.min(parsed.confidence, SUSPECT_CONFIDENCE_CAP);
  }

  return { parsed, issues };
}
