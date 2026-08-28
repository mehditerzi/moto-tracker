import { describe, it, expect } from "vitest";
import {
  backstopFromText,
  findMuayeneExpiry,
  findFirstRegistrationDate,
  registrationDates,
  inferDocTypeFromText,
} from "../src/ocr/backstop.js";
import type { ParsedOcr } from "../src/ocr/parser.js";

/**
 * Date extraction, which is the product.
 *
 * Photographing a registration card and having its inspection deadline appear
 * in the app is the whole promise. In production it had a 100% failure rate,
 * and the two ways it failed are both pinned here:
 *
 *   1. THE DATE NEVER ARRIVED. The label is 6pt print in a free-text box at the
 *      bottom of the card, and OCR mangles it differently every single time —
 *      "mua.geç.trh" comes back as "nua ge; thr", "tua ge: th", "no geq trh",
 *      or dissolves entirely and leaves a bare "tih:". A keyword list cannot
 *      keep up; the FIELD heading is what survives.
 *
 *   2. THE WRONG DATE ARRIVED, which is worse. A ruhsat prints its
 *      registration dates large and clean at the top, so a model asked for "the
 *      expiry date" reaches for one of those. That is a reminder on a date the
 *      user has no reason to doubt, for a deadline that is not that date.
 *
 * Every string below is a real OCR variant from the production corpus, with the
 * plates, VINs and ID numbers replaced — the corpus itself is not committed.
 */

const base: ParsedOcr = {
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

/** A ruhsat as the OCR stage actually hands it over, `z2` being the (Z.2) line. */
function ruhsatText(z2: string, opts: { ilkTescil?: string; tescil?: string } = {}): string {
  return [
    "(Y.1) VERILDIGI IL /ILCE",
    "ISTANBUL / KADIKOY 1 NOTERLIGI",
    "(A) PLAKA",
    "34ABC123",
    "(B) ILK TESCIL TARIHI",
    opts.ilkTescil ?? "04/01/2016",
    "(Y.2) TESCIL SIRA NO",
    "2025030717295133039",
    "(I) TESCIL TARIHI",
    opts.tescil ?? "07/03/2025",
    "(D.1) MARKASI",
    "YAMAHA",
    "(D.3) TICARI ADI",
    "MT 09",
    "(E) SASE NO",
    "JYARN296000013322",
    "(P.5) MOTOR NO",
    "N701E033981",
    "(P.1) SILINDIR HACMI",
    "847 cm3",
    "(Z.2) DIGER BILGILER",
    z2,
  ].join("\n");
}

describe("findMuayeneExpiry — every way OCR mangles 'mua.geç.trh'", () => {
  // Each of these was produced by a real read of a real card.
  const variants = [
    "mua.geç.trh: 19-08-2026",
    "mua.geç trh: 19-08-2026",
    "mua geç: th: 19-08-2026",
    "mua.ge: th: 19-08-2026",
    "nua.ge; trh: 19-08-2026",
    "mua geç. tih: 19-08-2026",
    "mua ge: thr: 19-08-2026",
    "nua geçt thr: 19-08-2026",
    "nua.gec. th: 19-08-2026",
    "nua ge: tn: 19-08-2026",
    "no geq trh: 19-08-2026",
    "mua.gec.trh: 19-08-2026",
  ];
  for (const v of variants) {
    it(`reads ${JSON.stringify(v)}`, () => {
      expect(findMuayeneExpiry(ruhsatText(v))).toBe("2026-08-19");
    });
  }

  it("falls back to the (Z.2) field heading when the label itself is unreadable", () => {
    // The label is gone entirely — only a stray "tih:" survived the scan.
    expect(findMuayeneExpiry(ruhsatText("tih: 19-08-2026"))).toBe("2026-08-19");
    // ...and here it came back as a word the muayene pattern cannot match.
    expect(findMuayeneExpiry(ruhsatText("tua ge; thr: 19-08-2026"))).toBe("2026-08-19");
  });

  it("does not mistake a registration date for the deadline", () => {
    // No (Z.2) date at all: the answer is "I don't know", not "07/03/2025".
    expect(findMuayeneExpiry(ruhsatText(""))).toBeNull();
  });

  it("reads a standalone muayene card by its own labels", () => {
    expect(findMuayeneExpiry("ARAC MUAYENE RAPORU\nMuayene Tarihi: 19.08.2024\nGecerlilik Tarihi: 19.08.2026")).toBe(
      "2026-08-19",
    );
  });
});

describe("registration dates are facts, not deadlines", () => {
  it("collects every date printed against a TESCİL label", () => {
    const dates = registrationDates(ruhsatText("mua.gec.trh: 19-08-2026"));
    expect(dates.has("2016-01-04")).toBe(true); // (B) İlk Tescil
    expect(dates.has("2025-03-07")).toBe(true); // (I) Tescil
    expect(dates.has("2026-08-19")).toBe(false); // the actual deadline
  });

  it("extracts the first-registration date into its own field", () => {
    expect(findFirstRegistrationDate(ruhsatText(""))).toBe("2016-01-04");
  });

  it("OVERRULES a model that reported the first-registration date as the deadline", () => {
    // The exact production failure: a Vespa whose inspection runs to 2027-11-01
    // came back with muayene = its first-registration date, 2025-02-22.
    const text = ruhsatText("mua.gec.trh: 01-11-2027", { ilkTescil: "22/02/2025" });
    const out = backstopFromText(
      { ...base, docType: "ruhsat", confidence: 0.9, dates: { ...base.dates, muayeneExpiresOn: "2025-02-22" } },
      text,
    );
    expect(out.dates.muayeneExpiresOn).toBe("2027-11-01");
  });

  it("OVERRULES the current-registration date too", () => {
    const text = ruhsatText("mua.gec.trh: 17-05-2027", { tescil: "08/05/2026" });
    const out = backstopFromText(
      { ...base, docType: "ruhsat", confidence: 0.9, dates: { ...base.dates, muayeneExpiresOn: "2026-05-08" } },
      text,
    );
    expect(out.dates.muayeneExpiresOn).toBe("2027-05-17");
  });

  it("drops a misfiled sigorta date rather than keeping it", () => {
    // A plain ruhsat has no insurance expiry. Reporting its registration date
    // as one would put a renewal reminder on the calendar out of nothing.
    const out = backstopFromText(
      { ...base, docType: "ruhsat", confidence: 0.9, dates: { ...base.dates, sigortaExpiresOn: "2026-01-06" } },
      ruhsatText("mua.gec.trh: 19-04-2027", { tescil: "06/01/2026" }),
    );
    expect(out.dates.sigortaExpiresOn).toBeNull();
    expect(out.dates.muayeneExpiresOn).toBe("2027-04-19");
  });

  it("leaves a deadline the model got right alone", () => {
    const out = backstopFromText(
      { ...base, docType: "ruhsat", confidence: 0.9, dates: { ...base.dates, muayeneExpiresOn: "2026-08-19" } },
      ruhsatText("mua.gec.trh: 19-08-2026"),
    );
    expect(out.dates.muayeneExpiresOn).toBe("2026-08-19");
  });

  it("does not overrule a plausible date it merely disagrees with", () => {
    // Not a registration date, so not provably wrong — the model keeps it.
    const out = backstopFromText(
      { ...base, docType: "ruhsat", confidence: 0.9, dates: { ...base.dates, muayeneExpiresOn: "2027-01-01" } },
      ruhsatText("mua.gec.trh: 19-08-2026"),
    );
    expect(out.dates.muayeneExpiresOn).toBe("2027-01-01");
  });
});

describe("day-first parsing", () => {
  it("reads dd-mm-yyyy as day, month, year", () => {
    // Production produced 2026-02-19 and 2025-08-19 for this same string.
    expect(findMuayeneExpiry(ruhsatText("mua.gec.trh: 19-08-2026"))).toBe("2026-08-19");
  });
  it("accepts dots and slashes as well as dashes", () => {
    expect(findMuayeneExpiry(ruhsatText("mua.gec.trh: 19.08.2026"))).toBe("2026-08-19");
    expect(findMuayeneExpiry(ruhsatText("mua.gec.trh: 19/08/2026"))).toBe("2026-08-19");
  });
});

describe("the degraded path — model said nothing, document still read", () => {
  it("recovers type, plate and deadline from OCR text alone, and scores it usable", () => {
    const out = backstopFromText(base, ruhsatText("nua ge: tn: 19-08-2026"));
    expect(out.docType).toBe("ruhsat");
    expect(out.plate).toBe("34ABC123");
    expect(out.dates.muayeneExpiresOn).toBe("2026-08-19");
    // Enough to auto-apply: the plate passed the plate grammar and the date was
    // anchored to a printed label. It still lands as needs_review.
    expect(out.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not manufacture confidence without both a plate and a date", () => {
    const noDate = backstopFromText(base, ruhsatText(""));
    expect(noDate.docType).toBe("ruhsat");
    expect(noDate.confidence).toBe(0);
  });

  it("never raises confidence on a parse the model did produce", () => {
    const out = backstopFromText(
      { ...base, docType: "ruhsat", confidence: 0.3 },
      ruhsatText("mua.gec.trh: 19-08-2026"),
    );
    expect(out.confidence).toBe(0.3);
  });

  it("only calls a document a ruhsat on strong structural evidence", () => {
    expect(inferDocTypeFromText("SHELL PETROL\nLITRE 12,45\nTUTAR 1.037,93")).toBeNull();
    expect(inferDocTypeFromText("(A) PLAKA 34ABC123")).toBeNull(); // one marker is not enough
    expect(inferDocTypeFromText(ruhsatText(""))).toBe("ruhsat");
  });
});
