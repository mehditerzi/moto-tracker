import { z } from "zod";

const optionalString = z
  .union([z.string(), z.null()])
  .optional()
  .default(null)
  .transform((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null));

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

const RawSchema = z.object({
  doc_type: z.enum(["ruhsat", "sigorta", "kasko", "muayene", "unknown"]).default("unknown"),
  plate: optionalString,
  make: optionalString,
  model: optionalString,
  year: optionalInt,
  chassis_no: optionalString,
  engine_no: optionalString,
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
  confidence: z.coerce.number().min(0).max(1).default(0),
});

export interface ParsedOcr {
  docType: "ruhsat" | "sigorta" | "kasko" | "muayene" | "unknown";
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  chassisNo: string | null;
  engineNo: string | null;
  cylinderCc: number | null;
  dates: {
    sigortaExpiresOn: string | null;
    kaskoExpiresOn: string | null;
    muayeneExpiresOn: string | null;
  };
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
function normalizeDate(s: string | null | undefined): string | null {
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
    chassisNo: parsed.chassis_no,
    engineNo: parsed.engine_no,
    cylinderCc: parsed.cylinder_cc,
    dates: {
      sigortaExpiresOn: normalizeDate(parsed.dates.sigorta_expires_on),
      kaskoExpiresOn: normalizeDate(parsed.dates.kasko_expires_on),
      muayeneExpiresOn: normalizeDate(parsed.dates.muayene_expires_on),
    },
    confidence: parsed.confidence,
  };
}
