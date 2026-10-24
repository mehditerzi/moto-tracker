import { backstopFromText, inferDocTypeFromText } from "./backstop.js";
import { emptyParsedOcr, type ParsedOcr } from "./parser.js";
import { linesFromText, readRuhsat, type OcrLine } from "./ruhsatLayout.js";
import { validateAndCorrect } from "./validators.js";
import { matchMake, norm, similarity } from "./catalog.js";

/**
 * The model-free reading of a document: OCR text (with positions when we have
 * them) → the same ParsedOcr the language-model path produces, in milliseconds.
 *
 * It is the fast path, not a fallback. On a registration card the labels make
 * a model unnecessary for every field it can see, and on a field it cannot see
 * it returns null instead of a plausible guess — so a local reading is only
 * ever incomplete, never confidently wrong. Policies and inspection papers are
 * read by the label-anchored backstop that already gets plate and inspection
 * date right on the whole production corpus.
 */
export function readLocally(input: { text: string; lines?: OcrLine[] | null }): ParsedOcr {
  const text = input.text ?? "";
  const geometric = !!input.lines?.length;
  const lines = geometric ? input.lines! : linesFromText(text);

  const r = readRuhsat(lines, geometric);
  let parsed: ParsedOcr = emptyParsedOcr();
  const isRuhsat = r.labelsFound >= 4 || inferDocTypeFromText(text) === "ruhsat";
  if (isRuhsat) {
    parsed = {
      ...parsed,
      docType: "ruhsat",
      make: r.make,
      model: r.model,
      year: r.year,
      firstRegistrationDate: r.firstRegistrationDate,
      color: r.color,
      chassisNo: r.chassisNo,
      engineNo: r.engineNo,
      cylinderCc: r.cylinderCc,
      fuelType: r.fuelType,
    };
  }

  if (isRuhsat) {
    parsed.model = snapModel(parsed.make, parsed.model);
    // The layout reader's inspection date is position-anchored; it is used
    // when the text-only backstop below finds nothing.
    parsed.dates.muayeneExpiresOn = plausibleInspection(r.muayeneExpiresOn, r.firstRegistrationDate);
  }

  // Plate and every date come from the label backstop (it may also infer the
  // document type for policies and inspection papers).
  parsed = backstopFromText(parsed, text);

  // Confidence the way the model is asked to state it: high only when the
  // fields that become reminders or a vehicle record are actually present.
  const core = [parsed.plate, parsed.make, parsed.chassisNo].filter(Boolean).length;
  const dated = Object.values(parsed.dates).some(Boolean);
  parsed.confidence =
    parsed.docType === "ruhsat"
      ? core === 3
        ? 0.9
        : core === 2
          ? 0.75
          : 0.5
      : parsed.docType !== "unknown" && parsed.plate && dated
        ? 0.8
        : dated
          ? 0.55
          : 0.2;

  return validateAndCorrect(parsed).parsed;
}

/**
 * OCR reads "MT-09" as "NT 09", "1T 09", "AT.09" or "T 09": the digits survive,
 * a letter does not. With the make known, the catalogue model whose digits
 * match exactly and whose letters are closest is almost certainly it. Looser
 * than the validator's snap (which must also serve the model path) because
 * here the digits have to agree, and an unmatched model is kept as read.
 */
function snapModel(make: string | null, model: string | null): string | null {
  if (!make || !model) return model;
  const mk = matchMake(make);
  if (!mk) return model;
  const n0 = norm(model);
  // A leading "M" read as "1" or "4" ("1T 09") also corrupts the digits, so the
  // reading without its first glyph is tried too.
  const variants = /^\d[A-Z]/.test(n0) ? [n0, n0.slice(1)] : [n0];
  let best: { name: string; score: number } | null = null;
  for (const n of variants) {
    const digits = n.replace(/\D/g, "");
    if (!digits) continue;
    for (const md of mk.make.models) {
      if (md.norm.replace(/\D/g, "") !== digits) continue;
      if (md.norm === n) return md.name;
      const score = similarity(n, md.norm);
      if (score >= 0.6 && (!best || score > best.score)) best = { name: md.name, score };
    }
  }
  return best?.name ?? model;
}

/**
 * An inspection is valid for at most three years, so a "valid until" date
 * more than three years in the past — or before the vehicle was even
 * registered — is some other date on the card, not the inspection note.
 */
function plausibleInspection(d: string | null, firstReg: string | null): string | null {
  if (!d) return null;
  const floor = new Date();
  floor.setUTCFullYear(floor.getUTCFullYear() - 3);
  if (d < floor.toISOString().slice(0, 10)) return null;
  if (firstReg && d < firstReg) return null;
  return d;
}

/**
 * Combine a local reading with a model's. The local value wins wherever it
 * exists — it is anchored to a printed label and cannot be invented — and the
 * model only fills what the layout reader could not see.
 */
export function mergeReadings(local: ParsedOcr, model: ParsedOcr): ParsedOcr {
  const pick = <T>(a: T | null, b: T | null): T | null => (a ?? b);
  return {
    docType: local.docType !== "unknown" ? local.docType : model.docType,
    plate: pick(local.plate, model.plate),
    make: pick(local.make, model.make),
    model: pick(local.model, model.model),
    year: pick(local.year, model.year),
    firstRegistrationDate: pick(local.firstRegistrationDate, model.firstRegistrationDate),
    color: pick(local.color, model.color),
    chassisNo: pick(local.chassisNo, model.chassisNo),
    engineNo: pick(local.engineNo, model.engineNo),
    cylinderCc: pick(local.cylinderCc, model.cylinderCc),
    fuelType: pick(local.fuelType, model.fuelType),
    dates: {
      sigortaExpiresOn: pick(local.dates.sigortaExpiresOn, model.dates.sigortaExpiresOn),
      kaskoExpiresOn: pick(local.dates.kaskoExpiresOn, model.dates.kaskoExpiresOn),
      muayeneExpiresOn: pick(local.dates.muayeneExpiresOn, model.dates.muayeneExpiresOn),
    },
    fuel: local.fuel ?? model.fuel,
    confidence: Math.max(local.confidence, model.confidence),
  };
}
