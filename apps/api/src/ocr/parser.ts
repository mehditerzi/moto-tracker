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

export function parseOcr(rawText: string): ParsedOcr {
  let jsonText = rawText.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }
  if (!jsonText.startsWith("{")) {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      console.error("[ocr] no JSON found in response:", rawText.slice(0, 300));
      throw new Error("OCR response did not contain a JSON object");
    }
    jsonText = jsonText.slice(start, end + 1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`OCR response was not valid JSON: ${(e as Error).message}`);
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
