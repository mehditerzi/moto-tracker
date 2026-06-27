/**
 * Deterministic detection backstops over the raw OCR text (Tesseract output).
 *
 * The vision/text LLM occasionally drops a field it should have read — most
 * often the plate or the muayene date on a busy ruhsat. When we have the raw
 * OCR text alongside the parsed JSON, we can recover those with tight regexes:
 * a plate has a rigid Turkish shape, and dates near their Turkish keyword are
 * unambiguous. We ONLY fill fields the LLM left null — never overwrite a value
 * it produced — so a backstop can add signal but never fight the model.
 */
import type { ParsedOcr } from "./parser.js";
import { normalizeDate } from "./parser.js";
import { isValidTrPlate, normalizePlate } from "./validators.js";

/** Turkish plate with optional spaces between the three groups. */
const PLATE_RE = /\b(0[1-9]|[1-7]\d|8[01])\s?([A-Z]{1,4})\s?(\d{2,5})\b/g;
const DATE_TOKEN = "(\\d{1,2}[./-]\\d{1,2}[./-]\\d{4})";

/** Find the first valid Turkish plate in free text, normalized (space-free, upper). */
export function findPlate(text: string): string | null {
  const up = text.toUpperCase();
  PLATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLATE_RE.exec(up))) {
    const candidate = `${m[1]}${m[2]}${m[3]}`;
    if (isValidTrPlate(candidate)) return candidate;
  }
  return null;
}

/** First normalized date appearing after any of `keywords` (case-insensitive). */
function dateNearKeyword(text: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    // keyword … up to ~40 chars … date
    const re = new RegExp(`${kw}[^\\d]{0,40}?${DATE_TOKEN}`, "i");
    const m = text.match(re);
    if (m) {
      const iso = normalizeDate(m[1]);
      if (iso) return iso;
    }
  }
  return null;
}

/**
 * Fill plate / dates the LLM left null using the raw OCR text. Returns a new
 * object; never mutates the input and never overwrites a non-null field.
 */
export function backstopFromText(parsed: ParsedOcr, sourceText: string | null | undefined): ParsedOcr {
  if (!sourceText || sourceText.trim().length === 0) return parsed;
  const out: ParsedOcr = { ...parsed, dates: { ...parsed.dates } };

  // Plate: fill when missing OR when the LLM's value doesn't pass plate shape.
  const current = normalizePlate(out.plate);
  if (!current || !isValidTrPlate(current)) {
    const found = findPlate(sourceText);
    if (found) out.plate = found;
  }

  // Dates: only fill a missing field, matched by its Turkish keyword.
  if (!out.dates.muayeneExpiresOn) {
    out.dates.muayeneExpiresOn = dateNearKeyword(sourceText, [
      "muayene", "mua\\.?\\s*ge[cç]", "ge[cç]erlilik",
    ]);
  }
  if (!out.dates.sigortaExpiresOn) {
    out.dates.sigortaExpiresOn = dateNearKeyword(sourceText, ["sigorta", "trafik sigorta", "zmms"]);
  }
  if (!out.dates.kaskoExpiresOn) {
    out.dates.kaskoExpiresOn = dateNearKeyword(sourceText, ["kasko"]);
  }

  return out;
}
