/**
 * Deterministic detection backstops over the raw OCR text (Tesseract output).
 *
 * The LLM drops fields it should have read — most often the plate or the
 * muayene date on a busy ruhsat. With the raw OCR text alongside the parsed
 * JSON we can recover those deterministically: a plate has a rigid Turkish
 * shape, and dates sit next to their printed Turkish label.
 *
 * The rule is "fill what the model left empty, and correct only what the model
 * can be PROVEN wrong about". The proof is narrow and specific — a renewal
 * deadline that is also a date printed against a TESCİL label is a
 * registration date, not a deadline (see `registrationDates`). Everything else
 * the model produced stands, because a backstop that starts second-guessing
 * plausible answers loses more documents than it saves.
 *
 * There is one addition beyond recovery: when the model contributed nothing at
 * all, this layer will identify the document and score it on its own evidence
 * (see `DETERMINISTIC_CONFIDENCE`) so that "the model failed" degrades to a
 * usable scan instead of an empty one.
 */
import type { ParsedOcr } from "./parser.js";
import { normalizeDate } from "./parser.js";
import { isValidTrPlate, normalizePlate } from "./validators.js";

/** Turkish plate with optional spaces between the three groups. */
const PLATE_RE = /\b(0[1-9]|[1-7]\d|8[01])\s?([A-Z]{1,4})\s?(\d{2,5})\b/g;
const DATE_TOKEN = "(\\d{1,2}[./-]\\d{1,2}[./-]\\d{4})";

/**
 * Fold Turkish letters onto ASCII and uppercase. Every label regex below runs
 * against this form, because the OCR text mixes İ/I, Ç/C, Ğ/G, Ş/S freely
 * (often within one document) and JS `/i` does not case-fold dotted/dotless i.
 */
export function foldTr(s: string): string {
  return s
    .replace(/[İıIi]/g, "I")
    .replace(/[Şş]/g, "S")
    .replace(/[Ğğ]/g, "G")
    .replace(/[Üü]/g, "U")
    .replace(/[Öö]/g, "O")
    .replace(/[Çç]/g, "C")
    .toUpperCase();
}

/** Find the first valid Turkish plate in free text, normalized (space-free, upper). */
export function findPlate(text: string): string | null {
  const up = foldTr(text);
  PLATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLATE_RE.exec(up))) {
    const candidate = `${m[1]}${m[2]}${m[3]}`;
    if (isValidTrPlate(candidate)) return candidate;
  }
  return null;
}

/** First normalized date appearing after any of `keywords` (case-insensitive). */
function dateNearKeyword(text: string, keywords: string[], window = 40): string | null {
  const folded = foldTr(text);
  for (const kw of keywords) {
    const re = new RegExp(`${kw}[^\\d]{0,${window}}?${DATE_TOKEN}`, "i");
    const m = folded.match(re);
    if (m) {
      // DATE_TOKEN is always the last group in the composed pattern. Indexing
      // from the end rather than at [1] means a keyword may contain groups of
      // its own without silently handing `normalizeDate` the word "TARIHI".
      const iso = normalizeDate(m[m.length - 1]);
      if (iso) return iso;
    }
  }
  return null;
}

// ── which date is which ───────────────────────────────────────────────────────
//
// A Turkish ruhsat prints up to four dates and only ONE of them is a deadline:
//
//   (B) İLK TESCİL TARİHİ   first registration      — a fact, never expires
//   (I) TESCİL TARİHİ       current registration    — a fact, never expires
//   (Y.2) TESCİL SIRA NO    sometimes trails a date — not a date field at all
//   (Z.2) DİĞER BİLGİLER    "mua.geç.trh: 19-08-2026"  ← THE renewal deadline
//
// The LLM confuses them constantly, and always in the same direction: it grabs
// the big, cleanly-printed registration date at the top of the card instead of
// the cramped handwritten-looking string in the free-text field at the bottom.
// In production that produced muayene="2025-02-22" for a card whose inspection
// actually runs to 2027-11-01 — a reminder for the wrong year that the user has
// no reason to distrust.
//
// So we do two things deterministically: find the (Z.2) date by its label, and
// collect the registration dates so a value that IS one can be rejected.

/**
 * `mua.geç.trh` and the dozen ways an OCR pass mangles it. Observed in the real
 * corpus: "mua.geç trh", "mua geç: th", "mua.ge: th", "nua.ge; trh",
 * "mua geç. tih", "mua ge: thr", "nua geçt thr", "nua.gec. th", "nua ge: tn",
 * "no geq trh", "mua.gec.trh".
 *
 * Shape: an M/N word ("mua" → "nua" → "no"), then GE with an optional C/Ç/Q,
 * then a T word ("trh" → "th" → "tih" → "tn"), then the date. The M/N anchor is
 * what keeps this off "BELGE", "DİĞER" and "GEÇERLİ" elsewhere on the card.
 */
const MUAYENE_LABEL = "\\b[MN][A-Z]{0,2}[^A-Z0-9]{0,3}GE[CQ]?[^A-Z0-9]{0,4}T[A-Z]{0,3}";

/** Any label containing TESCİL — i.e. a registration date, never a deadline. */
const REGISTRATION_LABEL = "TESC[A-Z]{0,3}[^0-9]{0,24}?";

/**
 * Every date printed against a TESCİL label. These are the values a renewal
 * date must never take: if the model reports one as an expiry it has read the
 * wrong line, and we can prove it without knowing what the right answer is.
 */
export function registrationDates(text: string): Set<string> {
  const folded = foldTr(text);
  const out = new Set<string>();
  const re = new RegExp(`${REGISTRATION_LABEL}${DATE_TOKEN}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(folded))) {
    const iso = normalizeDate(m[1]);
    if (iso) out.add(iso);
  }
  return out;
}

/** The (B) İlk Tescil date — a vehicle fact worth keeping, but not a deadline. */
export function findFirstRegistrationDate(text: string): string | null {
  return dateNearKeyword(text, ["[IJ]LK\\s*TESC[A-Z]{0,3}[^0-9]{0,20}?", "\\(B\\)[^0-9]{0,30}?"], 4);
}

/**
 * The muayene (roadworthiness) expiry, by label. Tried in order of how strongly
 * the label pins the field down.
 */
export function findMuayeneExpiry(text: string): string | null {
  return dateNearKeyword(
    text,
    // Order is the whole design here. A standalone muayene card prints TWO
    // dates — when the vehicle was inspected, and how long that inspection is
    // good for — and only the second is a deadline. So the patterns that name
    // an expiry are tried before anything that merely names an inspection, and
    // there is deliberately no pattern for a bare "Muayene Tarihi": that label
    // marks the date we specifically must not return.
    [
      MUAYENE_LABEL, // (Z.2) free-text field on a ruhsat — the common case
      "MUAYENE\\s*(?:GECERL[A-Z]*|B[AI]T[AI][SC][A-Z]*|SON[A-Z]*)[^0-9]{0,20}?",
      "GELECEK\\s*MUAYENE[^0-9]{0,20}?",
      "GECERL[A-Z]*\\s*(?:TAR[A-Z]*)?[^0-9]{0,16}?",
    ],
    16,
  ) ?? fieldZ2Date(text);
}

/**
 * Last resort for the muayene date: the (Z.2) DİĞER BİLGİLER field itself.
 *
 * The label inside that field is handwriting-grade small print and OCR
 * sometimes loses its first word entirely — the corpus contains a bare
 * "tih: 19-08-2026" and a "tua ge; thr: 19-08-2026", neither of which any
 * "mua/geç" pattern can reach. But the FIELD heading survives, and on a ruhsat
 * (Z.2) carries the inspection note and nothing else. So: anchor on the
 * heading, take the one date inside it.
 */
function fieldZ2Date(text: string): string | null {
  return dateNearKeyword(text, ["D[AI]GER\\s*B[AI]LG[A-Z]*[^0-9]{0,30}?", "\\(Z\\.2[^)]{0,3}\\)[^0-9]{0,40}?"], 30);
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
/**
 * Confidence floor for a document the LLM said nothing useful about but the
 * deterministic layer read anyway.
 *
 * Without a floor, "degrade to the backstop" degrades to nothing: `autoApply`
 * gates on confidence, an unparseable model response scores 0, and a plate and
 * an inspection date recovered from labelled fields would sit there unused. But
 * the recovery is not a guess — the plate passed the Turkish plate grammar and
 * the date was anchored to its printed label — and every dated_item created
 * this way is still written with `needs_review = 1`, so it surfaces for
 * confirmation rather than sliding in silently.
 *
 * Set at the default apply threshold, not above it: an operator who raises
 * OCR_AUTO_APPLY_THRESHOLD is asking for less automation and should get it.
 */
const DETERMINISTIC_CONFIDENCE = 0.7;

/** Field codes that only ever appear on a Turkish vehicle registration. */
const RUHSAT_MARKERS = [
  /\(A\)\s*PLAKA/,
  /\(D\.1\)\s*MARKA/,
  /\(D\.3\)\s*T[AI]CAR/,
  /\(E\)\s*[SŞ]ASE/,
  /\(P\.5\)\s*MOTOR/,
  /\(P\.1\)\s*S[AI]L[AI]ND[AI]R/,
  /TESC[AI]L\s*BELGES/,
];

/**
 * What kind of document is this, judged only on the text?
 *
 * Deliberately narrow: a ruhsat is unmistakable because it is a government form
 * with printed field codes, so requiring three of them is both cheap and
 * effectively free of false positives. Anything less clear-cut stays `unknown`
 * and waits for the model — guessing a document type wrong is worse than not
 * guessing, because the type decides which fields get read.
 */
export function inferDocTypeFromText(text: string): ParsedOcr["docType"] | null {
  const folded = foldTr(text);
  if (RUHSAT_MARKERS.filter((re) => re.test(folded)).length >= 3) return "ruhsat";
  return null;
}

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

  // ── dates ───────────────────────────────────────────────────────────────
  //
  // Unlike every other backstop here, this one may OVERRULE the model — but
  // only where the model is provably wrong, never merely different. "Provably
  // wrong" has exactly one meaning: the value it reported as a renewal deadline
  // is a date printed against a TESCİL label on the same document, so it is a
  // registration date and cannot be an expiry. That is the failure this whole
  // block exists for; guessing beyond it would be the backstop fighting the
  // model, which is how you lose the cases the model gets right.
  const registrations = registrationDates(sourceText);
  const muayeneByLabel = findMuayeneExpiry(sourceText);

  const misread = (v: string | null): boolean => v != null && registrations.has(v);

  if (!out.dates.muayeneExpiresOn || misread(out.dates.muayeneExpiresOn)) {
    // A label-anchored date beats a registration date every time. With no
    // anchor we drop the bad value rather than keep it: a missing deadline
    // costs one tap in review, a wrong one fires a reminder on the wrong day.
    out.dates.muayeneExpiresOn = muayeneByLabel;
  }
  if (!out.dates.sigortaExpiresOn || misread(out.dates.sigortaExpiresOn)) {
    out.dates.sigortaExpiresOn = dateNearKeyword(sourceText, [
      "TRAF[A-Z]{0,2}K\\s*S[AI]GORTA[^0-9]{0,24}?",
      "S[AI]GORTA[^0-9]{0,24}?",
      "ZMMS[^0-9]{0,24}?",
    ]);
  }
  if (!out.dates.kaskoExpiresOn || misread(out.dates.kaskoExpiresOn)) {
    out.dates.kaskoExpiresOn = dateNearKeyword(sourceText, ["KASKO[^0-9]{0,24}?"]);
  }
  // A registration date is still worth storing — just in the field that means
  // "when this vehicle was first registered", where nothing will alarm on it.
  if (!out.firstRegistrationDate) {
    out.firstRegistrationDate = findFirstRegistrationDate(sourceText);
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

  // ── the degraded path ───────────────────────────────────────────────────
  //
  // Everything above runs on every document. This last part only matters when
  // the model contributed nothing — it crashed, timed out, or answered with
  // something that was not JSON — and it is the difference between that being
  // a failed scan and being a slightly-less-good one.
  if (parsed.docType === "unknown" && parsed.confidence === 0) {
    const inferred = inferDocTypeFromText(sourceText);
    if (inferred) out.docType = inferred;
    const recoveredPlate = out.plate != null && isValidTrPlate(normalizePlate(out.plate) ?? "");
    const recoveredDate =
      out.dates.muayeneExpiresOn != null ||
      out.dates.sigortaExpiresOn != null ||
      out.dates.kaskoExpiresOn != null;
    if (out.docType !== "unknown" && recoveredPlate && recoveredDate) {
      out.confidence = DETERMINISTIC_CONFIDENCE;
    }
  }

  return out;
}
