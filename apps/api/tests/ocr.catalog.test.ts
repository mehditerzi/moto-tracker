import { describe, it, expect } from "vitest";
import { matchMake, matchModel, canonicalize, norm, similarity, inferVehicleType } from "../src/ocr/catalog.js";

describe("ocr/catalog norm", () => {
  it("is Turkish-aware and strips punctuation/spaces", () => {
    expect(norm("MT-09")).toBe("MT09");
    expect(norm("Royal Enfield")).toBe("ROYALENFIELD");
    expect(norm("Şahin")).toBe("SAHIN");
    expect(norm("İstanbul")).toBe("ISTANBUL");
    expect(norm(null)).toBe("");
  });
});

describe("ocr/catalog matchMake", () => {
  it("matches exact (case/spacing-insensitive)", () => {
    expect(matchMake("YAMAHA")?.name).toBe("Yamaha");
    expect(matchMake("  honda ")?.name).toBe("Honda");
    expect(matchMake("royalenfield")?.name).toBe("Royal Enfield");
  });

  it("resolves aliases to the canonical overlay make", () => {
    expect(matchMake("harley")?.name).toBe("Harley-Davidson");
  });

  it("fuzzy-matches small OCR typos", () => {
    expect(matchMake("yamana")?.name).toBe("Yamaha");
    expect(matchMake("duccati")?.name).toBe("Ducati");
  });

  it("is strict on very short brands (no false positives)", () => {
    // 3-char brands: a single edit must not match.
    expect(matchMake("ktn")).toBeNull();
    expect(matchMake("xyzzy123")).toBeNull();
  });
});

describe("ocr/catalog matchModel", () => {
  it("matches a model after normalization", () => {
    const y = matchMake("Yamaha")!;
    expect(matchModel(y.make, "mt 09")?.name).toBe("MT-09");
    const h = matchMake("Honda")!;
    expect(matchModel(h.make, "cb 500 f")?.name).toBe("CB500F");
  });

  it("never crosses digit boundaries (CB500F vs CB650F)", () => {
    const h = matchMake("Honda")!;
    expect(matchModel(h.make, "cb650f")?.name).toBe("CB650F");
    expect(matchModel(h.make, "cb500f")?.name).toBe("CB500F");
  });
});

describe("ocr/catalog canonicalize", () => {
  it("rewrites make + model to canonical spelling", () => {
    const r = canonicalize("yamana", "mt09");
    expect(r.make).toBe("Yamaha");
    expect(r.model).toBe("MT-09");
    expect(r.makeMatched).toBe(true);
    expect(r.modelMatched).toBe(true);
  });

  it("leaves unknown values untouched", () => {
    const r = canonicalize("NoSuchBrandXYZ", "WeirdModel");
    expect(r.make).toBe("NoSuchBrandXYZ");
    expect(r.model).toBe("WeirdModel");
    expect(r.makeMatched).toBe(false);
  });
});

describe("ocr/catalog inferVehicleType", () => {
  it("uses the matched model's type", () => {
    expect(inferVehicleType("Honda", "Civic")).toBe("car");
    expect(inferVehicleType("Honda", "CBR650R")).toBe("motorcycle");
  });

  it("uses a single-type make when no model matches", () => {
    expect(inferVehicleType("Fiat", "")).toBe("car");
    expect(inferVehicleType("Yamaha", "")).toBe("motorcycle");
  });

  it("returns null when genuinely ambiguous", () => {
    // Honda builds both and no model match → caller picks the default.
    expect(inferVehicleType("Honda", "")).toBeNull();
    expect(inferVehicleType("NoSuchBrand", "Whatever")).toBeNull();
  });
});

describe("ocr/catalog similarity", () => {
  it("is 1 for identical and lower for edits", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("abc", "abd")).toBeCloseTo(2 / 3, 5);
  });
});
