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

/**
 * The car catalog grew from ~340 models to ~890, and every one of them is a new
 * chance for the matcher to answer a scanned ruhsat with the wrong vehicle.
 * These are the cases that would break first.
 */
describe("ocr/catalog Turkish-market cars", () => {
  it("matches the nameplates a Turkish ruhsat prints", () => {
    const cases: [string, string, string, string][] = [
      // raw make, raw model, canonical make, canonical model
      ["FIAT", "EGEA", "Fiat", "Egea"],
      ["FIAT", "DOBLO", "Fiat", "Doblo"],
      ["RENAULT", "SYMBOL", "Renault", "Symbol"],
      ["RENAULT", "MEGANE", "Renault", "Megane"],
      ["DACIA", "SANDERO", "Dacia", "Sandero"],
      ["PEUGEOT", "301", "Peugeot", "301"],
      ["FORD", "TRANSIT CUSTOM", "Ford", "Transit Custom"],
      ["OPEL", "ASTRA", "Opel", "Astra"],
      ["HYUNDAI", "ACCENT BLUE", "Hyundai", "Accent Blue"],
      ["TOYOTA", "COROLLA", "Toyota", "Corolla"],
      ["TOGG", "T10X", "Togg", "T10X"],
    ];
    for (const [rm, rmo, make, model] of cases) {
      const r = canonicalize(rm, rmo);
      expect(r.make, rm).toBe(make);
      expect(r.model, `${rm} ${rmo}`).toBe(model);
    }
  });

  it("folds Turkish characters in both the make and the model", () => {
    // Field D.1 on a Tofaş-era ruhsat, with the dotted/dotless I and ş intact.
    expect(canonicalize("TOFAŞ", "ŞAHİN").model).toBe("Şahin");
    expect(canonicalize("tofas", "dogan").model).toBe("Doğan");
    expect(matchMake("CİTROEN")?.name).toBe("Citroën");
    expect(matchMake("ŞKODA")?.name).toBe("Skoda");
  });

  it("resolves the local assembler printed on the ruhsat", () => {
    expect(matchMake("TOFAS FIAT")?.name).toBe("Fiat");
    expect(matchMake("OYAK RENAULT")?.name).toBe("Renault");
    expect(matchMake("FORD OTOSAN")?.name).toBe("Ford");
    expect(matchMake("HYUNDAI ASSAN")?.name).toBe("Hyundai");
    expect(matchMake("MERCEDES")?.name).toBe("Mercedes-Benz");
  });

  it("never crosses model families that differ only by their number", () => {
    // The car equivalent of CB500F vs CB650F. Digit sequences must be identical
    // for a fuzzy candidate to be considered at all.
    const p = matchMake("Peugeot")!;
    expect(matchModel(p.make, "308")?.name).toBe("308");
    expect(matchModel(p.make, "3008")?.name).toBe("3008");
    expect(matchModel(p.make, "301")?.name).toBe("301");
    const b = matchMake("BMW")!;
    expect(matchModel(b.make, "320i")?.name).toBe("320i");
    expect(matchModel(b.make, "320d")?.name).toBe("320d");
    const a = matchMake("Audi")!;
    expect(matchModel(a.make, "A3")?.name).toBe("A3");
    expect(matchModel(a.make, "Q3")?.name).toBe("Q3");
    const f = matchMake("Fiat")!;
    expect(matchModel(f.make, "500")?.name).toBe("500");
    expect(matchModel(f.make, "500X")?.name).toBe("500X");
  });

  it("keeps the near-miss brands apart despite the bigger overlay", () => {
    // Adding ~35 car brands widened the fuzzy candidate pool. Every one of these
    // is within one or two edits of another catalog make and must NOT match it.
    expect(matchMake("Seat")?.name).toBe("Seat");
    expect(matchMake("Fiat")?.name).toBe("Fiat");
    expect(matchMake("Opel")?.name).toBe("Opel");
    expect(matchMake("BMC")?.name).toBe("BMC");
    expect(matchMake("BMW")?.name).toBe("BMW");
    // …and a plausible OCR mangling of a short brand still resolves to nothing
    // rather than to a neighbour.
    expect(matchMake("Opal")).toBeNull();
    expect(matchMake("Kua")).toBeNull();
    expect(matchMake("BMX")).toBeNull();
  });

  it("infers the vehicle type from a Turkish car model", () => {
    expect(inferVehicleType("Fiat", "Egea")).toBe("car");
    expect(inferVehicleType("Renault", "Clio")).toBe("car");
    expect(inferVehicleType("Togg", "T10X")).toBe("car");
    // Honda still builds both, and "Civic" is what settles it.
    expect(inferVehicleType("Honda", "Civic")).toBe("car");
    expect(inferVehicleType("Honda", "PCX125")).toBe("motorcycle");
  });

  it("tolerates the typos an OCR pass actually makes", () => {
    expect(canonicalize("RENAUT", "CLIO").make).toBe("Renault");
    expect(canonicalize("VOLKSWAGEN", "PASSAT").model).toBe("Passat");
    expect(canonicalize("MERCEDES BENZ", "C 200").model).toBe("C200");
  });
});

describe("ocr/catalog similarity", () => {
  it("is 1 for identical and lower for edits", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("abc", "abd")).toBeCloseTo(2 / 3, 5);
  });
});
