import { z } from "zod";

const optionalString = z
  .union([z.string(), z.null()])
  .optional()
  .default(null)
  .transform((v) => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    // Some models emit the literal string "null" for an absent field.
    if (t.length === 0 || t.toLowerCase() === "null") return null;
    return t;
  });

const optionalInt = z
  .union([z.coerce.number(), z.string(), z.null()])
  .optional()
  .default(null)
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    if (i < 1900 || i > 2100) return null;
    return i;
  });

// Positive decimal for fuel amounts/prices. Tolerates Turkish comma decimals
// ("45,50") and thousands dots the model may echo verbatim from the receipt.
const optionalDecimal = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .default(null)
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    let n: number;
    if (typeof v === "number") {
      n = v;
    } else {
      let s = v.trim().replace(/[^\d.,-]/g, "");
      if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
      n = Number(s);
    }
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  });

const RawSchema = z.object({
  doc_type: z.enum(["ruhsat", "sigorta", "kasko", "muayene", "yakit", "unknown"]).default("unknown"),
  plate: optionalString,
  make: optionalString,
  model: optionalString,
  year: optionalInt,
  first_registration_date: optionalString,
  color: optionalString,
  chassis_no: optionalString,
  engine_no: optionalString,
  fuel_type: optionalString,
  cylinder_cc: z
    .union([z.coerce.number(), z.string(), z.null()])
    .optional()
    .default(null)
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return null;
      const i = Math.trunc(n);
      // <= 0 means absent (a missing field coerces null→0 through the union)
      // or nonsensical — no engine is 0 cm³.
      if (i <= 0 || i > 10000) return null;
      return i;
    }),
  dates: z
    .object({
      sigorta_expires_on: z.union([z.string(), z.null()]).optional(),
      kasko_expires_on: z.union([z.string(), z.null()]).optional(),
      muayene_expires_on: z.union([z.string(), z.null()]).optional(),
    })
    .default({}),
  fuel: z
    .object({
      filled_on: z.union([z.string(), z.null()]).optional(),
      liters: optionalDecimal,
      total_cost: optionalDecimal,
      unit_price: optionalDecimal,
    })
    .nullable()
    .default(null),
  // Clamp instead of reject: models occasionally emit confidence outside
  // [0,1] (even negative), and a bad self-score shouldn't discard an
  // otherwise usable parse.
  confidence: z.coerce
    .number()
    .catch(0)
    .transform((n) => Math.min(1, Math.max(0, n))),
});

export interface ParsedFuel {
  filledOn: string | null;
  liters: number | null;
  totalCost: number | null;
  unitPrice: number | null;
}

export interface ParsedOcr {
  docType: "ruhsat" | "sigorta" | "kasko" | "muayene" | "yakit" | "unknown";
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  firstRegistrationDate: string | null;
  color: string | null;
  chassisNo: string | null;
  engineNo: string | null;
  cylinderCc: number | null;
  fuelType: string | null;
  dates: {
    sigortaExpiresOn: string | null;
    kaskoExpiresOn: string | null;
    muayeneExpiresOn: string | null;
  };
  /** Pump receipt fields — null unless the document is a yakit fişi. */
  fuel: ParsedFuel | null;
  confidence: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TR_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

/**
 * Normalize a date to ISO `YYYY-MM-DD`, accepting either ISO or Turkish
 * `DD.MM.YYYY`. Rejects impossible calendar dates (month > 12, day out of
 * range for the month, e.g. 30 February) — these are almost always OCR
 * garbage, and silently storing them as a deadline would surface as
 * "Invalid Date"/NaN day-counts downstream. Returns null when unparseable,
 * which routes the document to manual review instead of auto-applying.
 */
export function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();

  let y: number, mo: number, d: number;
  const iso = t.match(ISO_DATE);
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    const m = t.match(TR_DATE);
    if (!m) return null;
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
  }

  if (mo < 1 || mo > 12 || d < 1) return null;
  // Last day of month `mo` (1-based) — Date handles leap years for us.
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > daysInMonth) return null;

  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A parse that identified nothing — the floor a failed parse degrades to. */
export function emptyParsedOcr(): ParsedOcr {
  return {
    docType: "unknown",
    plate: null,
    make: null,
    model: null,
    year: null,
    firstRegistrationDate: null,
    color: null,
    chassisNo: null,
    engineNo: null,
    cylinderCc: null,
    fuelType: null,
    dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: null },
    fuel: null,
    confidence: 0,
  };
}

/**
 * `parseOcr` that never throws.
 *
 * A model that returns prose, an empty string or a truncated object used to
 * fail the whole document — 16% of production scans died this way, and the user
 * got "tarama başarısız" for a photo whose plate and expiry date were sitting
 * right there in the OCR text. Degrading to an empty parse instead lets the
 * deterministic backstop recover those fields; a document the model fumbled is
 * then merely low-confidence (manual review) rather than lost.
 */
export function safeParseOcr(rawText: string): { parsed: ParsedOcr; error?: string } {
  try {
    return { parsed: parseOcr(rawText) };
  } catch (e) {
    return { parsed: emptyParsedOcr(), error: (e as Error).message };
  }
}

/**
 * Pull the JSON object out of whatever the model actually said.
 *
 * Models wrap their answer in ```json fences, in Turkish prose ("Belgeye
 * baktım: {...} umarım doğrudur"), or in both. Take the outermost brace pair
 * and let the repair pass below deal with what is inside.
 */
function isolateJsonObject(rawText: string): string | null {
  let t = rawText.trim();
  // Fences may be unterminated when generation was cut off mid-object.
  t = t.replace(/^```(?:json|JSON)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = t.indexOf("{");
  if (start === -1) return null;
  const end = t.lastIndexOf("}");
  return end > start ? t.slice(start, end + 1) : t.slice(start);
}

/**
 * Best-effort repair of malformed model JSON.
 *
 * Two shapes account for essentially all of it:
 *
 *   trailing commas   `{"a":1,}` — a grammar-free model imitating JS.
 *   truncation        generation hit num_predict mid-object, so the text just
 *                     stops: `{"plate":"34ABC12` with nothing after it.
 *
 * For truncation the safe repair is to discard the member that was cut off
 * rather than to close the quote around it. Closing the quote would "recover"
 * `"34ABC12` as a plate that is one digit short of the real one — a plausible
 * wrong answer, which is the worst thing a document scanner can produce. So we
 * cut back to the last completed member and close the brackets; the field
 * simply comes back null and the deterministic backstop gets its turn.
 */
export function repairJson(src: string): unknown | null {
  const attempt = (s: string): unknown | null => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const direct = attempt(src);
  if (direct !== null) return direct;

  // 1. trailing commas before a closer
  const noTrailing = src.replace(/,\s*([}\]])/g, "$1");
  const fixed = attempt(noTrailing);
  if (fixed !== null) return fixed;

  // 2. truncation — walk the text tracking string/bracket state
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  /** Index just past the last point at which the object was structurally whole. */
  let lastComplete = -1;
  for (let i = 0; i < noTrailing.length; i++) {
    const ch = noTrailing[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      lastComplete = i + 1;
    } else if (ch === ",") lastComplete = i;
  }
  if (lastComplete > 0) {
    // Re-derive the bracket depth at the cut so we close exactly what is open.
    const head = noTrailing.slice(0, lastComplete);
    const closers: string[] = [];
    let s2 = false;
    let e2 = false;
    for (const ch of head) {
      if (s2) {
        if (e2) e2 = false;
        else if (ch === "\\") e2 = true;
        else if (ch === '"') s2 = false;
        continue;
      }
      if (ch === '"') s2 = true;
      else if (ch === "{") closers.push("}");
      else if (ch === "[") closers.push("]");
      else if (ch === "}" || ch === "]") closers.pop();
    }
    const repaired = attempt(head + closers.reverse().join(""));
    if (repaired !== null && typeof repaired === "object") return repaired;
  }
  return null;
}

export function parseOcr(rawText: string): ParsedOcr {
  const jsonText = isolateJsonObject(rawText);
  if (jsonText === null) {
    console.error("[ocr] no JSON found in response:", rawText.slice(0, 300));
    throw new Error("OCR response did not contain a JSON object");
  }

  const raw = repairJson(jsonText);
  if (raw === null || typeof raw !== "object") {
    console.error("[ocr] unrepairable JSON in response:", rawText.slice(0, 300));
    throw new Error("OCR response was not valid JSON");
  }

  const parsed = RawSchema.parse(raw);
  return {
    docType: parsed.doc_type,
    plate: parsed.plate,
    make: parsed.make,
    model: parsed.model,
    year: parsed.year,
    firstRegistrationDate: normalizeDate(parsed.first_registration_date),
    color: parsed.color,
    chassisNo: parsed.chassis_no,
    engineNo: parsed.engine_no,
    cylinderCc: parsed.cylinder_cc,
    fuelType: parsed.fuel_type,
    dates: {
      sigortaExpiresOn: normalizeDate(parsed.dates.sigorta_expires_on),
      kaskoExpiresOn: normalizeDate(parsed.dates.kasko_expires_on),
      muayeneExpiresOn: normalizeDate(parsed.dates.muayene_expires_on),
    },
    fuel: parsed.fuel
      ? {
          filledOn: normalizeDate(parsed.fuel.filled_on),
          liters: parsed.fuel.liters,
          totalCost: parsed.fuel.total_cost,
          unitPrice: parsed.fuel.unit_price,
        }
      : null,
    confidence: parsed.confidence,
  };
}
