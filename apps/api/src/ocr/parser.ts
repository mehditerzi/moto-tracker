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
      if (i < 0 || i > 10000) return null;
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (ISO_DATE.test(t)) return t;
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  return null;
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
