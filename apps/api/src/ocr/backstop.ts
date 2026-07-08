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

/** Turkish-formatted decimal ("1.234,56" or "45,50" or "45.50") → number. */
function parseTrNumber(s: string): number | null {
  let t = s.trim();
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const NUM_TOKEN = "(\\d{1,3}(?:\\.\\d{3})*,\\d{1,3}|\\d+(?:[.,]\\d{1,3})?)";

/** First positive number appearing after any of `keywords` (case-insensitive). */
function numberNearKeyword(text: string, keywords: string[]): number | null {
  for (const kw of keywords) {
    const re = new RegExp(`${kw}[^\\d-]{0,25}?${NUM_TOKEN}`, "i");
    const m = text.match(re);
    if (m) {
      const n = parseTrNumber(m[1]!);
      if (n != null) return n;
    }
  }
  return null;
}

/**
 * Fill plate / dates / receipt amounts the LLM left null using the raw OCR
 * text. Returns a new object; never mutates the input and never overwrites a
 * non-null field.
 */
export function backstopFromText(parsed: ParsedOcr, sourceText: string | null | undefined): ParsedOcr {
  if (!sourceText || sourceText.trim().length === 0) return parsed;
  const out: ParsedOcr = {
    ...parsed,
    dates: { ...parsed.dates },
    fuel: parsed.fuel ? { ...parsed.fuel } : null,
  };

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

  // Pump receipt amounts, matched by their printed labels. Only for documents
  // the model already identified as a receipt — these keywords are too generic
  // ("TOPLAM") to trust on other document types. `[İIiı]` classes because
  // JS /i doesn't case-fold Turkish dotted/dotless i.
  if (out.docType === "yakit") {
    const I = "[İIiı]";
    const fuel = out.fuel ?? { filledOn: null, liters: null, totalCost: null, unitPrice: null };
    if (fuel.liters == null) {
      // "12,45 LT" (amount before the unit) is checked first — it's the more
      // specific shape, and a trailing "\bLT\b … TUTAR 1.037,93" would
      // otherwise hand the total to the litres field. The number must carry a
      // fraction and sit on the same line: pump quantities always print
      // decimals, while an octane grade ("KURŞUNSUZ 95") right before "LİTRE"
      // doesn't.
      const DEC_TOKEN = "(\\d{1,3}(?:\\.\\d{3})*,\\d{1,3}|\\d+\\.\\d{1,3})";
      const before = sourceText.match(new RegExp(`${DEC_TOKEN}[ \\t]*(?:LT|L${I}TRE)\\b`, "i"));
      fuel.liters =
        (before ? parseTrNumber(before[1]!) : null) ??
        numberNearKeyword(sourceText, [`l${I}tre`, "\\bLT\\b", `m${I}ktar`]);
    }
    if (fuel.totalCost == null) {
      fuel.totalCost = numberNearKeyword(sourceText, ["tutar", "toplam"]);
    }
    if (fuel.unitPrice == null) {
      fuel.unitPrice = numberNearKeyword(sourceText, [`b${I}r${I}m\\s*f${I}yat`, `b\\.?\\s*f${I}yat`]);
    }
    if (fuel.filledOn == null) {
      fuel.filledOn =
        dateNearKeyword(sourceText, [`tar${I}h`]) ??
        // Fall back to the first date printed anywhere on the receipt.
        (() => {
          const m = sourceText.match(new RegExp(DATE_TOKEN));
          return m ? normalizeDate(m[1]) : null;
        })();
    }
    out.fuel = fuel;
  }

  return out;
}
