import { describe, it, expect } from "vitest";
import { parseOcr } from "../src/ocr/parser.js";

describe("parseOcr", () => {
  it("parses a clean JSON response", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "sigorta",
        plate: "34 ABC 123",
        dates: { sigorta_expires_on: "2027-06-01" },
        confidence: 0.92,
      }),
    );
    expect(r.docType).toBe("sigorta");
    expect(r.plate).toBe("34 ABC 123");
    expect(r.dates.sigortaExpiresOn).toBe("2027-06-01");
    expect(r.dates.kaskoExpiresOn).toBeNull();
    expect(r.confidence).toBeCloseTo(0.92);
  });

  it("normalizes Turkish date formats", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "muayene",
        plate: null,
        dates: { muayene_expires_on: "01.06.2027" },
        confidence: 0.8,
      }),
    );
    expect(r.dates.muayeneExpiresOn).toBe("2027-06-01");
  });

  it("strips a markdown code fence", () => {
    const r = parseOcr("```json\n" + JSON.stringify({ doc_type: "kasko", plate: "x", dates: {}, confidence: 0.5 }) + "\n```");
    expect(r.docType).toBe("kasko");
  });

  it("extracts JSON from surrounding prose", () => {
    const r = parseOcr(
      "Belgeye baktım. {\"doc_type\":\"sigorta\",\"plate\":\"34X\",\"dates\":{\"sigorta_expires_on\":\"2026-12-31\"},\"confidence\":0.7} (kesin değil)",
    );
    expect(r.dates.sigortaExpiresOn).toBe("2026-12-31");
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseOcr("hiçbir şey yok")).toThrow();
  });

  it("defaults docType to 'unknown' and confidence to 0 when missing", () => {
    const r = parseOcr("{}");
    expect(r.docType).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("treats blank plate as null", () => {
    const r = parseOcr(JSON.stringify({ doc_type: "ruhsat", plate: "   ", dates: {}, confidence: 0.4 }));
    expect(r.plate).toBeNull();
  });

  it("rejects an impossible Turkish date (month > 12 / day > 31) as null", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "muayene",
        plate: null,
        dates: { muayene_expires_on: "32.13.2027" },
        confidence: 0.9,
      }),
    );
    expect(r.dates.muayeneExpiresOn).toBeNull();
  });

  it("rejects an impossible ISO date (e.g. 30 February) as null", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "sigorta",
        plate: null,
        dates: { sigorta_expires_on: "2027-02-30" },
        confidence: 0.9,
      }),
    );
    expect(r.dates.sigortaExpiresOn).toBeNull();
  });

  it("accepts a real leap day", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "sigorta",
        plate: null,
        dates: { sigorta_expires_on: "29.02.2028" },
        confidence: 0.9,
      }),
    );
    expect(r.dates.sigortaExpiresOn).toBe("2028-02-29");
  });

  it("rejects a non-leap-year Feb 29 as null", () => {
    const r = parseOcr(
      JSON.stringify({
        doc_type: "sigorta",
        plate: null,
        dates: { sigorta_expires_on: "29.02.2027" },
        confidence: 0.9,
      }),
    );
    expect(r.dates.sigortaExpiresOn).toBeNull();
  });
});
