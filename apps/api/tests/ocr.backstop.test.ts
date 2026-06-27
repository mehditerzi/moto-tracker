import { describe, it, expect } from "vitest";
import { backstopFromText, findPlate } from "../src/ocr/backstop.js";
import type { ParsedOcr } from "../src/ocr/parser.js";

const base: ParsedOcr = {
  docType: "ruhsat",
  plate: null,
  make: null,
  model: null,
  year: null,
  chassisNo: null,
  engineNo: null,
  cylinderCc: null,
  dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: null },
  confidence: 0.5,
};

describe("ocr/backstop findPlate", () => {
  it("finds a spaced Turkish plate", () => {
    expect(findPlate("Plaka: 34 ABC 123 blah")).toBe("34ABC123");
    expect(findPlate("46AHL973")).toBe("46AHL973");
  });
  it("rejects non-plates", () => {
    expect(findPlate("no plate here 999 999 999")).toBeNull();
    expect(findPlate("99 AB 12")).toBeNull(); // province 99 invalid
  });
});

describe("ocr/backstop backstopFromText", () => {
  it("fills a missing plate from the OCR text", () => {
    const out = backstopFromText(base, "TESCIL BELGESI 34 ABC 123 ...");
    expect(out.plate).toBe("34ABC123");
  });

  it("does not overwrite a plate the LLM already produced", () => {
    const out = backstopFromText({ ...base, plate: "06 XYZ 99" }, "34 ABC 123");
    expect(out.plate).toBe("06 XYZ 99");
  });

  it("recovers a muayene date near its keyword", () => {
    const out = backstopFromText(base, "Mua. Geç. Trh: 15.08.2027");
    expect(out.dates.muayeneExpiresOn).toBe("2027-08-15");
  });

  it("recovers sigorta/kasko dates by keyword", () => {
    const out = backstopFromText(base, "Sigorta bitiş 01.02.2026 Kasko 03.04.2026");
    expect(out.dates.sigortaExpiresOn).toBe("2026-02-01");
    expect(out.dates.kaskoExpiresOn).toBe("2026-04-03");
  });

  it("is a no-op without source text", () => {
    const out = backstopFromText(base, "");
    expect(out).toEqual(base);
  });
});
