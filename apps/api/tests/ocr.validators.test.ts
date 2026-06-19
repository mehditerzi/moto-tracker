import { describe, it, expect } from "vitest";
import {
  normalizePlate,
  isValidTrPlate,
  isVin,
  validateAndCorrect,
} from "../src/ocr/validators.js";
import type { ParsedOcr } from "../src/ocr/parser.js";

function base(overrides: Partial<ParsedOcr> = {}): ParsedOcr {
  return {
    docType: "ruhsat",
    plate: null,
    make: null,
    model: null,
    year: null,
    chassisNo: null,
    engineNo: null,
    cylinderCc: null,
    dates: { sigortaExpiresOn: null, kaskoExpiresOn: null, muayeneExpiresOn: null },
    confidence: 0.9,
    ...overrides,
  };
}

describe("normalizePlate", () => {
  it("strips spaces and uppercases", () => {
    expect(normalizePlate("46 ahl 973")).toBe("46AHL973");
    expect(normalizePlate(" 48 VJ 105 ")).toBe("48VJ105");
  });
  it("returns null for empty", () => {
    expect(normalizePlate("")).toBeNull();
    expect(normalizePlate(null)).toBeNull();
  });
});

describe("isValidTrPlate", () => {
  it("accepts real Turkish plates", () => {
    for (const p of ["46AHL973", "53ADC489", "48VJ105", "34GTC656", "06A1234"])
      expect(isValidTrPlate(p)).toBe(true);
  });
  it("rejects malformed / out-of-range province", () => {
    expect(isValidTrPlate("99ABC12")).toBe(false); // province > 81
    expect(isValidTrPlate("4AHL973")).toBe(false); // 1-digit province
    expect(isValidTrPlate("ABCDEF")).toBe(false);
  });
});

describe("isVin", () => {
  it("accepts 17-char VINs from the sample ruhsats", () => {
    for (const v of ["JYARN296000013322", "JM7UFY0W5V0115894", "NM417800006470359"])
      expect(isVin(v)).toBe(true);
  });
  it("rejects wrong length or forbidden letters (I/O/Q)", () => {
    expect(isVin("N701E033981")).toBe(false); // too short (engine no)
    expect(isVin("JYARN29600001332I")).toBe(false); // contains I
    expect(isVin("")).toBe(false);
  });
});

describe("validateAndCorrect", () => {
  it("swaps chassis/engine when the VIN is in the engine field (the live bug)", () => {
    const { parsed, issues } = validateAndCorrect(
      base({ chassisNo: "N701E033981", engineNo: "JYARN296000013322" }),
    );
    expect(parsed.chassisNo).toBe("JYARN296000013322");
    expect(parsed.engineNo).toBe("N701E033981");
    expect(issues.some((i) => i.field === "chassisNo" && i.kind === "corrected")).toBe(true);
  });

  it("leaves fields untouched when chassis already holds the VIN", () => {
    const { parsed, issues } = validateAndCorrect(
      base({ chassisNo: "JM7UFY0W5V0115894", engineNo: "WL326841" }),
    );
    expect(parsed.chassisNo).toBe("JM7UFY0W5V0115894");
    expect(parsed.engineNo).toBe("WL326841");
    expect(issues.some((i) => i.kind === "corrected")).toBe(false);
  });

  it("validates a spaced plate without rewriting the stored value", () => {
    const { parsed, issues } = validateAndCorrect(base({ plate: "46 AHL 973" }));
    expect(parsed.plate).toBe("46 AHL 973");
    expect(issues.some((i) => i.field === "plate")).toBe(false);
  });

  it("flags a malformed plate and caps confidence", () => {
    const { parsed, issues } = validateAndCorrect(base({ plate: "XYZ", confidence: 0.95 }));
    expect(issues.some((i) => i.field === "plate" && i.kind === "suspect")).toBe(true);
    expect(parsed.confidence).toBeLessThanOrEqual(0.5);
  });

  it("flags an engine number that looks like an 11-digit national ID", () => {
    const { issues } = validateAndCorrect(base({ engineNo: "12345678901" }));
    expect(issues.some((i) => i.field === "engineNo" && i.kind === "suspect")).toBe(true);
  });

  it("flags an implausible cylinder capacity for a motorcycle app", () => {
    const { issues } = validateAndCorrect(base({ cylinderCc: 9000 }));
    expect(issues.some((i) => i.field === "cylinderCc" && i.kind === "suspect")).toBe(true);
  });

  it("does not flag a valid clean ruhsat and preserves confidence", () => {
    const { parsed, issues } = validateAndCorrect(
      base({
        plate: "46AHL973",
        chassisNo: "JYARN296000013322",
        engineNo: "N701E033981",
        cylinderCc: 847,
        year: 2015,
        confidence: 0.9,
      }),
    );
    expect(issues).toHaveLength(0);
    expect(parsed.confidence).toBe(0.9);
  });
});
